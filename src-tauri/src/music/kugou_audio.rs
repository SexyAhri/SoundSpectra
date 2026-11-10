//! Full, authorized standard MP3 playback. Signed URLs never leave native RAM.
use super::{cache::Cache, model::*, qq_quality::MAX_AUDIO_BYTES, stream::Stream};
use reqwest::{blocking::Client, StatusCode, Url};
use serde_json::Value;
use std::{
    io::Read,
    sync::{atomic::Ordering, Arc, Mutex},
    time::Duration,
};

pub(super) struct Source {
    url: Url,
    total: usize,
    bitrate: u32,
}
pub(super) struct Prepared {
    track: String,
    total: usize,
    bytes: Vec<u8>,
}

fn integer(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str()?.parse().ok())
}
fn flagged(v: &Value) -> bool {
    !v.is_null() && v != false && v != 0 && v != "0" && v != "false" && v != ""
}
fn media_url(value: &str) -> Option<Url> {
    let mut url = Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || !matches!(
            url.host_str()?,
            "fsandroid.kugou.com" | "fsmobile.tx.kugou.com"
        )
    {
        return None;
    }
    url.set_scheme("https").ok()?;
    Some(url)
}
pub(super) fn source(value: &Value, track: &Track, hash: &str) -> Result<Source, String> {
    if integer(&value["status"]) != Some(1) {
        return Err(
            "[permission] 酷狗未授权此版本的完整播放，请检查会员、购买权限或版权状态".into(),
        );
    }
    if integer(&value["priv_status"]) != Some(1)
        || [
            "is_free_part",
            "IsFreePart",
            "isFreePart",
            "trial",
            "is_trial",
            "isTrial",
            "free_part",
            "freePart",
        ]
        .iter()
        .any(|key| flagged(&value[*key]) || flagged(&value["data"][*key]))
    {
        return Err("[permission] 酷狗仅提供试听，此歌曲无法完整播放".into());
    }
    if value["hash"]
        .as_str()
        .is_none_or(|s| !s.eq_ignore_ascii_case(hash))
    {
        return Err("酷狗返回的音频身份不一致，请刷新歌曲".into());
    }
    let duration = value["timeLength"]
        .as_f64()
        .or_else(|| value["timeLength"].as_str()?.parse().ok())
        .filter(|n| n.is_finite() && *n > 0.0 && *n < 86400.0)
        .ok_or("酷狗音频缺少完整时长")?;
    if !track.duration.is_finite()
        || track.duration <= 0.0
        || (duration - track.duration).abs() > 2.0
    {
        return Err("[permission] 酷狗音频时长与完整歌曲不一致".into());
    }
    let total = integer(&value["fileSize"])
        .filter(|n| *n > 0 && *n <= MAX_AUDIO_BYTES as u64)
        .ok_or("酷狗音频资源大小无效")? as usize;
    let bitrate = integer(&value["bitRate"])
        .filter(|n| *n == 128000)
        .ok_or("酷狗未返回已接入的标准音质")? as u32;
    if value["extName"] != "mp3" {
        return Err("[decode] 酷狗未返回已接入的 MP3 格式".into());
    }
    let url = value["url"]
        .as_array()
        .and_then(|urls| urls.iter().filter_map(Value::as_str).find_map(media_url))
        .ok_or("酷狗未返回支持的官方音频服务器")?;
    Ok(Source {
        url,
        total,
        bitrate,
    })
}

fn audio(bytes: Vec<u8>, bitrate: u32) -> Result<Audio, String> {
    let start = if bytes.starts_with(b"ID3") && bytes.len() >= 10 {
        if bytes[6..10].iter().any(|n| n & 0x80 != 0) {
            return Err("[decode] 酷狗 MP3 标签长度无效".into());
        }
        10 + bytes[6..10]
            .iter()
            .fold(0usize, |size, n| (size << 7) | *n as usize)
    } else {
        0
    };
    let frame = bytes
        .get(start..)
        .and_then(|tail| {
            tail.windows(4).take(4096).find(|h| {
                h[0] == 0xff
                    && h[1] & 0xe0 == 0xe0
                    && h[1] & 0x18 != 0x08
                    && h[1] & 0x06 == 0x02
                    && (1..15).contains(&(h[2] >> 4))
                    && h[2] & 0x0c != 0x0c
            })
        })
        .ok_or("[decode] 酷狗音频缺少有效的 MP3 帧")?;
    let rate = [44100, 48000, 32000][((frame[2] >> 2) & 3) as usize];
    let sample_rate = match (frame[1] >> 3) & 3 {
        3 => rate,
        2 => rate / 2,
        _ => rate / 4,
    };
    let channels = if frame[3] >> 6 == 3 { 1 } else { 2 };
    Ok(Audio {
        bytes,
        mime: "audio/mpeg",
        stream: None,
        quality: AudioQuality {
            id: "standard".into(),
            label: "标准音质".into(),
            codec: "MP3".into(),
            sample_rate: Some(sample_rate),
            bit_depth: None,
            channels: Some(channels),
            bitrate: Some(bitrate),
            fallback: None,
        },
    })
}

pub(super) fn download(
    source: Source,
    track: &Track,
    prepared: &Mutex<Option<Prepared>>,
    cache: Option<Arc<Cache>>,
    scope: String,
    request: &AudioRequest,
) -> Result<Audio, String> {
    request.check()?;
    (request.buffering)();
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法创建酷狗音频连接")?;
    let prefix = if request.prefetch {
        None
    } else {
        prepared
            .lock()
            .unwrap()
            .take()
            .filter(|p| p.track == track.id && p.total == source.total)
    };
    if let Some(p) = prefix.as_ref().filter(|p| p.bytes.len() == source.total) {
        request.check()?;
        let result = audio(p.bytes.clone(), source.bitrate)?;
        if let Some(cache) = cache {
            cache.measure_audio(
                track,
                &scope,
                "standard",
                Arc::new(result.bytes.clone()),
                cache.audio_epoch(),
                request.cancelled.clone(),
            );
        }
        return Ok(result);
    }
    let prefetched = prefix.as_ref().map_or(0, |p| p.bytes.len());
    let mut get = client
        .get(source.url.clone())
        .header("Referer", "https://www.kugou.com/");
    let end = if request.prefetch {
        source.total.min(4 * 1024 * 1024) - 1
    } else {
        source.total - 1
    };
    if request.prefetch || prefetched > 0 {
        get = get.header("Range", format!("bytes={prefetched}-{end}"));
    }
    let mut response = get.send().map_err(|_| "酷狗音频连接失败")?;
    request.check()?;
    let partial = response.status() == StatusCode::PARTIAL_CONTENT;
    if !matches!(
        response.status(),
        StatusCode::OK | StatusCode::PARTIAL_CONTENT
    ) {
        return Err("[unavailable] 酷狗音频授权或资源已不可用".into());
    }
    let mut bytes = if partial {
        let expected = format!("bytes {prefetched}-{end}/{}", source.total);
        if response
            .headers()
            .get("content-range")
            .and_then(|s| s.to_str().ok())
            != Some(expected.as_str())
        {
            return Err("酷狗未返回匹配的音频分段".into());
        }
        prefix.map(|p| p.bytes).unwrap_or_default()
    } else {
        Vec::new()
    };
    let expected_length = if partial {
        end + 1 - bytes.len()
    } else {
        source.total
    };
    if response.content_length() != Some(expected_length as u64) {
        return Err("酷狗音频长度与授权信息不一致".into());
    }
    let target = if request.prefetch {
        source.total.min(4 * 1024 * 1024)
    } else {
        source.total.min(64 * 1024).max(bytes.len())
    };
    let mut chunk = [0u8; 64 * 1024];
    while bytes.len() < target {
        request.check()?;
        let take = chunk.len().min(target - bytes.len());
        let n = response
            .read(&mut chunk[..take])
            .map_err(|_| "酷狗音频首段传输中断")?;
        if n == 0 {
            return Err("酷狗音频首段不完整".into());
        }
        bytes.extend_from_slice(&chunk[..n]);
    }
    request.check()?;
    let mut result = audio(bytes, source.bitrate)?;
    if request.prefetch {
        let mut prepared = prepared.lock().unwrap();
        request.check()?;
        *prepared = Some(Prepared {
            track: track.id.clone(),
            total: source.total,
            bytes: std::mem::take(&mut result.bytes),
        });
        return Ok(result);
    }
    let total = source.total;
    let url = source.url;
    let track = track.clone();
    let cancelled = request.cancelled.clone();
    let cache_epoch = cache.as_ref().map_or(0, |c| c.audio_epoch());
    result.stream = Some(Stream::start(
        std::mem::take(&mut result.bytes),
        total,
        result.mime,
        response,
        Box::new(move |start, end| {
            let mut response = client
                .get(url.clone())
                .header("Referer", "https://www.kugou.com/")
                .header("Range", format!("bytes={start}-{end}"))
                .send()
                .map_err(|_| "酷狗音频分段请求失败")?;
            let expected = format!("bytes {start}-{end}/{total}");
            if response.status() != StatusCode::PARTIAL_CONTENT
                || response
                    .headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok())
                    != Some(expected.as_str())
            {
                return Err("酷狗音频分段不匹配".into());
            }
            let mut bytes = Vec::new();
            (&mut response)
                .take((end - start + 2) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "酷狗音频分段传输中断")?;
            if bytes.len() != end - start + 1 {
                return Err("酷狗音频分段不完整".into());
            }
            Ok(bytes)
        }),
        Box::new(move |bytes| {
            if !cancelled.load(Ordering::Acquire) {
                if let Some(cache) = cache {
                    cache.measure_audio(
                        &track,
                        &scope,
                        "standard",
                        bytes,
                        cache_epoch,
                        cancelled.clone(),
                    );
                }
            }
        }),
        request.cancelled.clone(),
    )?);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn track() -> Track {
        super::super::qq::track(&json!({"mid":"example","title":"示例","interval":186})).unwrap()
    }
    fn reply() -> Value {
        json!({"status":1,"priv_status":1,"hash":"abcdef0123456789abcdef0123456789","timeLength":186,
            "fileSize":2984438,"bitRate":128000,"extName":"mp3","url":["http://fsandroid.kugou.com/audio.mp3?signature=synthetic"]})
    }
    #[test]
    fn authorization_requires_full_matching_identity_duration_and_official_media() {
        let hash = "abcdef0123456789abcdef0123456789";
        assert!(source(&reply(), &track(), hash).is_ok());
        for (key, value) in [
            ("status", json!(2)),
            ("priv_status", json!(0)),
            ("hash", json!("different")),
            ("timeLength", json!(60)),
            ("fileSize", json!(0)),
            ("bitRate", json!(320000)),
            ("is_free_part", json!(1)),
            ("trial", json!(true)),
            ("is_trial", json!("1")),
            ("url", json!(["https://fsandroid.kugou.com.evil.test/a"])),
        ] {
            let mut response = reply();
            response[key] = value;
            assert!(source(&response, &track(), hash).is_err(), "{key}");
        }
        for url in [
            "https://user@fsandroid.kugou.com/a",
            "http://127.0.0.1/a",
            "https://fsandroid.kugou.com:8080/a",
        ] {
            assert!(media_url(url).is_none());
        }
    }
    #[test]
    fn mp3_quality_comes_from_actual_frames_and_html_is_rejected() {
        assert!(audio(b"<html>not audio</html>".to_vec(), 128000).is_err());
        let result = audio(vec![0xff, 0xfb, 0x90, 0x00, 0, 0], 128000).unwrap();
        assert_eq!(result.quality.sample_rate, Some(44100));
        assert_eq!(result.quality.channels, Some(2));
        assert_eq!(result.quality.id, "standard");
    }
}
