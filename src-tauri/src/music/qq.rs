use super::model::*;
use super::qq_quality::{self, Variant, MAX_AUDIO_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Read,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Serialize, Deserialize)]
pub struct Session {
    pub cookies: Vec<(String, String)>,
}

struct Prepared {
    track: String,
    variant: String,
    bytes: Vec<u8>,
    total: usize,
}
pub struct Qq {
    prepared: Mutex<Option<Prepared>>,
    client: Client,
    cookie: String,
    uin: String,
    key: String,
    membership: Mutex<Option<Membership>>,
    cache: Option<Arc<super::cache::Cache>>,
}

fn text(v: &Value) -> String {
    v.as_str()
        .map(str::to_owned)
        .or_else(|| v.as_u64().map(|n| n.to_string()))
        .unwrap_or_default()
}
fn image_url(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(&value.replace("http://", "https://")).ok()?;
    let host = url.host_str()?;
    (url.scheme() == "https"
        && ["gtimg.cn", "qpic.cn", "qlogo.cn", "qq.com"]
            .iter()
            .any(|root| host == *root || host.ends_with(&format!(".{root}"))))
    .then(|| url.to_string())
}
pub fn audio_host(host: &str) -> bool {
    host == "aqqmusic.tc.qq.com"
        || host.ends_with(".stream.qqmusic.qq.com")
        || host == "isure.stream.qqmusic.qq.com"
}
fn client(audio: bool) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(if audio { 15 } else { 18 }))
        .connect_timeout(Duration::from_secs(8))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() < 5 && attempt.url().scheme() == "https" && attempt.url().host_str().is_some_and(|host| if audio { audio_host(host) } else { matches!(host, "c.y.qq.com" | "c6.y.qq.com" | "u.y.qq.com" | "y.qq.com" | "y.gtimg.cn" | "y.qq.com.cn") || host.ends_with(".qpic.cn") }) {
                attempt.follow()
            } else { attempt.stop() }
        }))
        .build().map_err(|_| "无法创建 QQ 音乐网络会话".into())
}

impl Qq {
    pub fn new(session: &Session) -> Result<Self, String> {
        let get = |names: &[&str]| {
            names.iter().find_map(|name| {
                session
                    .cookies
                    .iter()
                    .find(|(k, v)| k == name && !v.is_empty())
                    .map(|(_, v)| v.clone())
            })
        };
        let uin = get(&["uin", "qqmusic_uin"])
            .unwrap_or_default()
            .trim_start_matches('o')
            .trim_start_matches('0')
            .to_string();
        let key = get(&["qm_keyst", "qqmusic_key", "music_key"])
            .ok_or("QQ 音乐登录已失效，请重新扫码")?;
        if uin.is_empty() || !uin.bytes().all(|c| c.is_ascii_digit()) {
            return Err("未取得 QQ 音乐账号，请完成官方授权".into());
        }
        let cookie = session
            .cookies
            .iter()
            .filter(|(k, v)| !k.contains([';', '\r', '\n']) && !v.contains([';', '\r', '\n']))
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join("; ");
        Ok(Self {
            prepared: Mutex::new(None),
            client: client(false)?,
            cookie,
            uin,
            key,
            membership: Mutex::new(None),
            cache: None,
        })
    }
    pub fn with_cache(mut self, cache: Arc<super::cache::Cache>) -> Self {
        self.cache = Some(cache);
        self
    }
    fn get(&self, url: &str, params: &[(&str, String)]) -> Result<Value, String> {
        let mut url = reqwest::Url::parse(url).map_err(|_| "QQ 音乐接口地址无效")?;
        url.query_pairs_mut()
            .extend_pairs(params.iter().map(|(k, v)| (*k, v.as_str())));
        let response = self
            .client
            .get(url)
            .header("Referer", "https://y.qq.com/")
            .header("Cookie", &self.cookie)
            .send()
            .map_err(|_| "QQ 音乐请求失败，请检查网络后重试")?;
        let value: Value = response
            .error_for_status()
            .map_err(|_| "QQ 音乐服务暂不可用")?
            .json()
            .map_err(|_| "QQ 音乐返回了无法识别的数据")?;
        check(&value)?;
        Ok(value)
    }
    fn rpc(&self, module: &str, method: &str, param: Value, audio: bool) -> Result<Value, String> {
        let value: Value = self.client.post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Referer", "https://y.qq.com/").header("Origin", "https://y.qq.com").header("Cookie", &self.cookie)
            .json(&json!({"comm":{"uin":self.uin,"format":"json","ct":if audio {19} else {24},"cv":0,"authst":self.key},"req_0":{"module":module,"method":method,"param":param}}))
            .send().map_err(|_| "QQ 音乐请求超时或网络不可用")?.error_for_status().map_err(|_| "QQ 音乐服务暂不可用")?.json().map_err(|_| "QQ 音乐返回了无法识别的数据")?;
        check(&value)?;
        check(&value["req_0"])?;
        value["req_0"]
            .get("data")
            .cloned()
            .ok_or("QQ 音乐没有返回数据，请重新登录".into())
    }

    fn download(
        &self,
        url: reqwest::Url,
        variant: Variant,
        track: &Track,
        fallback: Option<String>,
        request: &AudioRequest,
        cache_epoch: u64,
    ) -> Result<Audio, String> {
        request.check()?;
        (request.buffering)();
        let client = client(true)?;
        let prepared = if request.prefetch {
            None
        } else {
            self.prepared
                .lock()
                .unwrap()
                .take()
                .filter(|p| p.track == track.id && p.variant == variant.id)
        };
        if let Some(p) = prepared.as_ref().filter(|p| p.bytes.len() == p.total) {
            return variant.audio(p.bytes.clone(), track.duration, fallback);
        }
        let mut get = client
            .get(url.clone())
            .header("Referer", "https://y.qq.com/");
        if request.prefetch {
            get = get.header("Range", "bytes=0-4194303");
        } else if let Some(p) = &prepared {
            get = get.header("Range", format!("bytes={}-", p.bytes.len()));
        }
        let mut response = get
            .send()
            .map_err(|_| "音频网络请求失败")?
            .error_for_status()
            .map_err(|_| "该音质的播放授权或资源不可用")?;
        if request.prefetch {
            let total = response
                .headers()
                .get("content-range")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.rsplit('/').next()?.parse::<usize>().ok())
                .or_else(|| response.content_length().map(|n| n as usize))
                .ok_or("预加载缺少资源长度")?;
            if total == 0 || total > MAX_AUDIO_BYTES {
                return Err("预加载资源大小无效".into());
            }
            let mut bytes = Vec::new();
            let mut chunk = [0u8; 64 * 1024];
            while bytes.len() < total.min(4 * 1024 * 1024) {
                request.check()?;
                let limit = chunk.len().min(total.min(4 * 1024 * 1024) - bytes.len());
                let n = response
                    .read(&mut chunk[..limit])
                    .map_err(|_| "预加载网络中断")?;
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&chunk[..n]);
            }
            request.check()?;
            let mut audio = variant.audio(bytes, track.duration, fallback)?;
            let mut prepared = self.prepared.lock().unwrap();
            request.check()?;
            *prepared = Some(Prepared {
                track: track.id.clone(),
                variant: variant.id.into(),
                total,
                bytes: std::mem::take(&mut audio.bytes),
            });
            return Ok(audio);
        }
        let prefix = if let Some(p) = prepared {
            let expected = format!("bytes {}-{}/{}", p.bytes.len(), p.total - 1, p.total);
            if response.status() == reqwest::StatusCode::PARTIAL_CONTENT
                && response
                    .headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok())
                    == Some(expected.as_str())
            {
                Some(p)
            } else {
                response = client
                    .get(url.clone())
                    .header("Referer", "https://y.qq.com/")
                    .send()
                    .map_err(|_| "音频网络请求失败")?
                    .error_for_status()
                    .map_err(|_| "音频资源不可用")?;
                None
            }
        } else {
            None
        };
        if response
            .content_length()
            .is_some_and(|n| n > MAX_AUDIO_BYTES as u64)
        {
            return Err("该音质超过单曲 256 MiB 上限".into());
        }
        let expected = prefix
            .as_ref()
            .map(|p| p.total as u64)
            .or_else(|| response.content_length());
        let mut bytes = prefix.map(|p| p.bytes).unwrap_or_default();
        if let Some(total) = expected.filter(|n| *n > 0).map(|n| n as usize) {
            (&mut response)
                .take(total.min(16 * 1024).saturating_sub(bytes.len()) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "音频首段传输中断")?;
            request.check()?;
            let mut audio = variant.audio(bytes, track.duration, fallback)?;
            audio.quality.bitrate = (track.duration.is_finite() && track.duration > 0.0)
                .then(|| (total as f64 * 8.0 / track.duration).round() as u32);
            let cache = self.cache.clone();
            let track = track.clone();
            let scope = super::cache::scope(&self.uin);
            let cancelled = request.cancelled.clone();
            audio.stream = Some(super::stream::Stream::start(
                std::mem::take(&mut audio.bytes),
                total,
                audio.mime,
                response,
                Box::new(move |start, end| {
                    let mut response = client
                        .get(url.clone())
                        .header("Referer", "https://y.qq.com/")
                        .header("Range", format!("bytes={start}-{end}"))
                        .send()
                        .map_err(|_| "音频分段请求失败")?;
                    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT
                        || response
                            .headers()
                            .get("content-range")
                            .and_then(|v| v.to_str().ok())
                            != Some(format!("bytes {start}-{end}/{total}").as_str())
                    {
                        return Err("音频服务器不支持此进度的分段读取".into());
                    }
                    let mut bytes = Vec::new();
                    (&mut response)
                        .take((end - start + 2) as u64)
                        .read_to_end(&mut bytes)
                        .map_err(|_| "音频分段传输中断")?;
                    if bytes.len() != end - start + 1 {
                        return Err("音频分段不完整".into());
                    }
                    Ok(bytes)
                }),
                Box::new(move |bytes| {
                    if !cancelled.load(std::sync::atomic::Ordering::Acquire) {
                        if let Some(cache) = cache {
                            cache.measure_audio(
                                &track,
                                &scope,
                                variant.id,
                                bytes,
                                cache_epoch,
                                cancelled.clone(),
                            );
                        }
                    }
                }),
                request.cancelled.clone(),
            )?);
            return Ok(audio);
        }
        // Servers without a length cannot offer honest byte ranges. Keep the
        // bounded complete-file fallback for those unusual responses.
        let mut chunk = [0; 64 * 1024];
        loop {
            request.check()?;
            let n = response.read(&mut chunk).map_err(|_| "音频传输中断")?;
            if n == 0 {
                break;
            }
            if bytes.len() + n > MAX_AUDIO_BYTES {
                return Err("该音质超过单曲 256 MiB 上限".into());
            }
            bytes.extend_from_slice(&chunk[..n]);
        }
        request.check()?;
        if bytes.is_empty()
            || bytes.len() > MAX_AUDIO_BYTES
            || expected.is_some_and(|n| n != bytes.len() as u64)
        {
            return Err("音频数据不完整或超过单曲大小上限".into());
        }
        variant.audio(bytes, track.duration, fallback)
    }
}
fn check(v: &Value) -> Result<(), String> {
    match v.get("code").and_then(Value::as_i64) {
        Some(0) | None => Ok(()),
        Some(1000 | 2000 | -100 | -3000) => Err("QQ 音乐登录已失效，请重新扫码".into()),
        Some(code) => Err(format!("QQ 音乐服务返回错误（{code}），请稍后重试")),
    }
}

pub fn track(v: &Value) -> Option<Track> {
    let id = text(&v["mid"]);
    if id.is_empty() || !id.bytes().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    let title = v["title"]
        .as_str()
        .or(v["name"].as_str())
        .unwrap_or_default()
        .to_string();
    if title.is_empty() {
        return None;
    }
    let album_mid = text(&v["album"]["mid"]);
    Some(Track {
        id,
        provider: "qq".into(),
        title,
        artist: v["singer"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|s| s["name"].as_str())
                    .collect::<Vec<_>>()
                    .join(" / ")
            })
            .unwrap_or_default(),
        album: v["album"]["title"]
            .as_str()
            .or(v["album"]["name"].as_str())
            .unwrap_or_default()
            .to_string(),
        cover: if album_mid.bytes().all(|c| c.is_ascii_alphanumeric()) && !album_mid.is_empty() {
            Some(format!(
                "https://y.gtimg.cn/music/photo_new/T002R300x300M000{album_mid}.jpg"
            ))
        } else {
            None
        },
        duration: v["interval"].as_f64().unwrap_or(0.0),
        paid: v["pay"]["pay_play"].as_u64().unwrap_or(0) != 0,
        numeric_id: v["id"].as_u64().unwrap_or(0),
        media_id: text(&v["file"]["media_mid"]),
        audio_sizes: qq_quality::sizes(&v["file"]),
    })
}

impl Provider for Qq {
    fn name(&self) -> &'static str {
        "QQ 音乐"
    }
    fn discard_prefetch(&self) {
        self.prepared.lock().unwrap().take();
    }
    fn id(&self) -> &'static str {
        "qq"
    }
    fn scope(&self) -> String {
        super::cache::scope(&format!("qq:{}", self.uin))
    }
    fn capabilities(&self) -> &'static [&'static str] {
        &[
            "qr-login",
            "account",
            "membership",
            "playlists",
            "playback",
            "lyrics",
            "search",
        ]
    }
    fn search(&self, query: &str, offset: usize, limit: usize) -> Result<Page<Track>, String> {
        let data = self.rpc("music.search.SearchCgiService", "DoSearchForQQMusicDesktop",
            json!({"query":query,"num_per_page":limit,"page_num":offset / limit + 1,"search_type":0}), false)?;
        search_page(&data, offset, limit)
    }
    fn account(&self) -> Result<Account, String> {
        let value = self.get(
            "https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg",
            &[
                ("cid", "205360838".into()),
                ("userid", self.uin.clone()),
                ("reqfrom", "1".into()),
                ("g_tk", "5381".into()),
                ("loginUin", self.uin.clone()),
                ("hostUin", "0".into()),
                ("format", "json".into()),
                ("inCharset", "utf8".into()),
                ("outCharset", "utf-8".into()),
                ("platform", "yqq.json".into()),
                ("needNewCode", "0".into()),
            ],
        )?;
        let creator = &value["data"]["creator"];
        let nickname = creator["nick"]
            .as_str()
            .filter(|n| !n.is_empty())
            .ok_or("账号信息不可用，请重新登录")?
            .to_string();
        let vip = self.rpc(
            "userInfo.VipQueryServer",
            "SRFVipQuery_V2",
            json!({"uin_list":[self.uin]}),
            false,
        );
        let (membership, membership_issue) = match vip {
            Ok(data) => match data["infoMap"].get(&self.uin) {
                Some(v) => (Some(membership(v)), None),
                None => (None, Some("暂未取得会员信息".into())),
            },
            Err(e) => (None, Some(e)),
        };
        *self.membership.lock().unwrap() = membership.clone();
        Ok(Account {
            provider: "qq".into(),
            nickname,
            avatar: image_url(creator["headpic"].as_str().unwrap_or_default()),
            membership,
            membership_issue,
        })
    }
    fn playlists(
        &self,
        collection: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Page<Playlist>, String> {
        let (value, key, total_key) = if collection == "created" {
            (
                self.get(
                    "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss",
                    &[
                        ("hostUin", "0".into()),
                        ("hostuin", self.uin.clone()),
                        ("sin", offset.to_string()),
                        ("size", limit.to_string()),
                        ("g_tk", "5381".into()),
                        ("loginUin", self.uin.clone()),
                        ("format", "json".into()),
                        ("inCharset", "utf8".into()),
                        ("outCharset", "utf-8".into()),
                        ("platform", "yqq.json".into()),
                        ("needNewCode", "0".into()),
                    ],
                )?,
                "disslist",
                "totoal",
            )
        } else if collection == "collected" {
            (
                self.get(
                    "https://c.y.qq.com/fav/fcgi-bin/fcg_get_profile_order_asset.fcg",
                    &[
                        ("ct", "20".into()),
                        ("cid", "205360956".into()),
                        ("userid", self.uin.clone()),
                        ("reqtype", "3".into()),
                        ("sin", offset.to_string()),
                        ("ein", (offset + limit - 1).to_string()),
                        ("format", "json".into()),
                    ],
                )?,
                "cdlist",
                "totaldiss",
            )
        } else {
            return Err("未知歌单分类".into());
        };
        let rows = value["data"][key]
            .as_array()
            .ok_or("未取得歌单数据，请重试")?;
        let items: Vec<_> = rows
            .iter()
            .filter_map(|v| {
                let dir = v["dirid"].as_u64().unwrap_or(0);
                if matches!(dir, 205 | 206) {
                    return None;
                }
                let id = if dir == 201 {
                    "liked".into()
                } else {
                    let a = text(&v["tid"]);
                    if !a.is_empty() && a != "0" {
                        a
                    } else {
                        text(&v["dissid"])
                    }
                };
                if id.is_empty() || id == "0" {
                    return None;
                }
                Some(Playlist {
                    id,
                    name: v["diss_name"]
                        .as_str()
                        .or(v["dissname"].as_str())
                        .or(v["name"].as_str())
                        .unwrap_or("未命名歌单")
                        .to_string(),
                    cover: image_url(
                        v["diss_cover"]
                            .as_str()
                            .or(v["logo"].as_str())
                            .or(v["picurl"].as_str())
                            .unwrap_or_default(),
                    ),
                    count: v["song_cnt"]
                        .as_u64()
                        .or(v["songnum"].as_u64())
                        .unwrap_or(0) as usize,
                })
            })
            .collect();
        let total = value["data"][total_key]
            .as_u64()
            .unwrap_or((offset + rows.len()) as u64) as usize;
        let filtered = rows.len().saturating_sub(items.len());
        Ok(Page {
            items,
            total,
            next_offset: (offset + limit < total).then_some(offset + limit),
            filtered,
        })
    }
    fn tracks(&self, playlist: &str, offset: usize, limit: usize) -> Result<Page<Track>, String> {
        let (disstid, dirid) = if playlist == "liked" {
            (0, 201)
        } else {
            (playlist.parse::<u64>().map_err(|_| "歌单标识无效")?, 0)
        };
        let data = self.rpc("music.srfDissInfo.DissInfo", "CgiGetDiss", json!({"disstid":disstid,"dirid":dirid,"tag":1,"song_begin":offset,"song_num":limit,"userinfo":1,"orderlist":1}), false)?;
        track_page(&data, offset, limit)
    }
    fn audio(
        &self,
        track: &Track,
        below: Option<&str>,
        request: AudioRequest,
    ) -> Result<Audio, String> {
        request.check()?;
        let cache_epoch = self.cache.as_ref().map_or(0, |c| c.audio_epoch());
        let media = if track.media_id.is_empty() {
            &track.id
        } else {
            &track.media_id
        };
        let variants =
            qq_quality::candidates(self.membership.lock().unwrap().as_ref(), track, below);
        if variants.is_empty() {
            return Err("没有更低的可播放音质，请尝试其他歌曲".into());
        }
        let mut requests = Vec::new();
        for variant in &variants {
            requests.push((*variant, variant.filename(media)));
            if media != &track.id {
                requests.push((*variant, variant.filename(&track.id)));
            }
        }
        let filenames: Vec<_> = requests.iter().map(|(_, name)| name).collect();
        let data = self.rpc("vkey.GetVkeyServer", "CgiGetVkey", json!({"guid":super::now().to_string(),"songmid":vec![&track.id; filenames.len()],"songtype":vec![0; filenames.len()],"uin":self.uin,"loginflag":1,"platform":"20","filename":filenames}), true)?;
        let urls = data["midurlinfo"].as_array().ok_or("未取得播放授权")?;
        let base = data["sip"]
            .as_array()
            .and_then(|a| {
                a.iter().filter_map(Value::as_str).find(|s| {
                    reqwest::Url::parse(s)
                        .ok()
                        .and_then(|u| u.host_str().map(audio_host))
                        == Some(true)
                })
            })
            .ok_or("QQ 音乐返回了未知的音频服务器")?;
        let base = reqwest::Url::parse(&base.replace("http://", "https://"))
            .map_err(|_| "音频地址无效")?;
        let mut last_error = "该歌曲暂不可播放：可能受会员、版权或地区限制".to_string();
        for (variant, filename) in requests {
            request.check()?;
            // Match returned identities explicitly: response order is not a
            // guarantee and an upstream fallback must not be labelled master.
            let Some(row) = urls
                .iter()
                .find(|v| v["filename"].as_str() == Some(&filename))
            else {
                continue;
            };
            let Some(purl) = row["purl"].as_str().filter(|s| !s.is_empty()) else {
                continue;
            };
            let Ok(url) = base.join(purl) else { continue };
            if url.scheme() != "https"
                || !url.host_str().is_some_and(audio_host)
                || !url
                    .path_segments()
                    .and_then(|mut p| p.next_back())
                    .is_some_and(|name| variant.matches_filename(name))
            {
                continue;
            }
            let fallback = if below.is_some() {
                Some("较高音质无法解码，已自动降级到当前可播放音质".into())
            } else if variant.id != variants[0].id {
                Some(format!("较高音质不可用（{last_error}），已自动降级"))
            } else {
                None
            };
            let scope = super::cache::scope(&self.uin);
            match self.download(url, variant, track, fallback, &request, cache_epoch) {
                Ok(audio) => {
                    if audio.stream.is_none() && !request.prefetch {
                        if let Some(cache) = self.cache.as_ref().filter(|c| c.analysis_enabled()) {
                            cache.measure_audio(
                                track,
                                &scope,
                                variant.id,
                                Arc::new(audio.bytes.clone()),
                                cache_epoch,
                                request.cancelled.clone(),
                            );
                        }
                    }
                    return Ok(audio);
                }
                Err(error) => {
                    if super::diagnostics::Failure::classify(&error).retryable {
                        return Err(error);
                    }
                    last_error = error;
                }
            }
        }
        Err(last_error)
    }
    fn lyrics(&self, track: &Track) -> Result<String, String> {
        let data = self.rpc(
            "music.musichallSong.PlayLyricInfo",
            "GetPlayLyricInfo",
            json!({"songMID":track.id,"songID":track.numeric_id}),
            false,
        )?;
        let value = data["lyric"].as_str().unwrap_or_default();
        Ok(STANDARD
            .decode(value)
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .unwrap_or_else(|| value.to_string()))
    }
    fn artwork(&self, url: &str) -> Option<String> {
        let url = image_url(url)?;
        let response = self.client.get(url).send().ok()?.error_for_status().ok()?;
        let mut bytes = Vec::new();
        response.take(512 * 1024 + 1).read_to_end(&mut bytes).ok()?;
        if bytes.len() > 512 * 1024 || !bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            return None;
        }
        Some(format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)))
    }
}

fn search_page(data: &Value, offset: usize, limit: usize) -> Result<Page<Track>, String> {
    let meta = &data["meta"];
    if meta["ret"].as_i64().is_some_and(|r| r != 0)
        || meta["safetyType"].as_u64().is_some_and(|r| r != 0)
    {
        return Err("QQ 音乐搜索暂不可用，请重新登录后重试".into());
    }
    let rows = data["body"]["song"]["list"]
        .as_array()
        .ok_or("未取得搜索结果")?;
    let items: Vec<_> = rows.iter().filter_map(track).collect();
    let total = meta["sum"].as_u64().ok_or("搜索总数不可用")? as usize;
    let more = !rows.is_empty()
        && offset + limit < total
        && meta["nextpage"]
            .as_u64()
            .is_none_or(|n| n > (offset / limit + 1) as u64);
    let filtered = rows.len() - items.len();
    Ok(Page {
        items,
        total,
        filtered,
        next_offset: more.then_some(offset + limit),
    })
}

fn track_page(data: &Value, offset: usize, limit: usize) -> Result<Page<Track>, String> {
    let rows = data["songlist"]
        .as_array()
        .ok_or("未取得歌曲数据，请重试")?;
    let items: Vec<_> = rows.iter().filter_map(track).collect();
    let total = data["total_song_num"]
        .as_u64()
        .ok_or("歌曲总数不可用，请重试")? as usize;
    // QQ can return filter_song_num=0 while filtered_song contains records.
    let excluded = data["filtered_song"].as_array().map_or(0, Vec::len)
        + data["invalid_song"].as_array().map_or(0, Vec::len);
    let filtered = excluded.max(data["filter_song_num"].as_u64().unwrap_or(0) as usize)
        + rows.len().saturating_sub(items.len());
    let next_offset =
        (offset + limit < total && data["hasmore"].as_u64() != Some(0)).then_some(offset + limit);
    Ok(Page {
        items,
        total,
        next_offset,
        filtered,
    })
}

fn membership(v: &Value) -> Membership {
    // QQ timestamps use China local time. Lexicographic comparison is valid for
    // the fixed YYYY-MM-DD HH:mm:ss representation returned by this endpoint.
    let stamp = super::china_timestamp();
    let vip = v["iVipFlag"].as_u64().unwrap_or(0) != 0;
    let super_vip =
        v["iSuperVip"].as_u64().unwrap_or(0) != 0 || v["HugeVip"].as_u64().unwrap_or(0) != 0;
    let expires = if super_vip {
        v["HugeVipEnd"].as_str().or(v["sOverDateTime"].as_str())
    } else {
        v["sOverDateTime"].as_str()
    }
    .filter(|s| s.len() == 19);
    let active = (vip || super_vip) && expires.is_some_and(|s| s > stamp.as_str());
    Membership {
        active,
        name: if active {
            if super_vip {
                "SVIP"
            } else {
                "绿钻"
            }
        } else {
            "普通用户"
        }
        .into(),
        level: v["iCurLevel"].as_u64().unwrap_or(0),
        expires: expires.map(str::to_owned),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filtered_records_count_toward_the_requested_span_and_are_reported() {
        let first=track_page(&json!({"songlist":[{"mid":"one","title":"示例"}],"filtered_song":[{"id":1}],"filter_song_num":0,"total_song_num":201,"hasmore":1}),0,100).unwrap();
        assert_eq!(first.next_offset, Some(100));
        assert_eq!(first.filtered, 1);
        let last=track_page(&json!({"songlist":[],"filtered_song":[{"id":1}],"filter_song_num":0,"total_song_num":201,"hasmore":0}),200,100).unwrap();
        assert_eq!(last.next_offset, None);
        assert_eq!(last.filtered, 1);
    }
    #[test]
    fn maps_version_title_and_native_playback_fields() {
        let t = track(&json!({"mid":"abc123","id":42,"name":"原曲","title":"原曲 (现场版)","singer":[{"name":"甲"},{"name":"乙"}],"album":{"mid":"album1","name":"专辑"},"interval":180,"file":{"media_mid":"media42"},"pay":{"pay_play":1}})).unwrap();
        assert_eq!(t.title, "原曲 (现场版)");
        assert_eq!(t.artist, "甲 / 乙");
        assert!(t.paid);
        let wire = serde_json::to_value(t).unwrap();
        assert!(wire.get("mediaId").is_none());
        assert!(wire.get("numericId").is_none());
    }
    #[test]
    fn rejects_untrusted_stream_hosts_and_malformed_identity() {
        assert!(audio_host("aqqmusic.tc.qq.com"));
        assert!(audio_host("sjy6.stream.qqmusic.qq.com"));
        assert!(!audio_host("qq.com.evil.test"));
        assert!(!audio_host("127.0.0.1"));
        assert!(track(&json!({"mid":"../secret","title":"x"})).is_none());
        assert!(Qq::new(&Session { cookies: vec![] }).is_err());
    }
    #[test]
    fn expired_membership_does_not_inherit_stale_flags() {
        assert!(
            !membership(&json!({"iVipFlag":1,"iCurLevel":8,"sOverDateTime":"2000-01-01 00:00:00"}))
                .active
        );
        let m = membership(
            &json!({"iVipFlag":1,"HugeVip":1,"iCurLevel":8,"HugeVipEnd":"2099-01-01 00:00:00"}),
        );
        assert!(m.active);
        assert_eq!(m.name, "SVIP");
        assert_eq!(m.level, 8);
    }
    #[test]
    fn authenticated_search_schema_preserves_pagination_and_rejects_upstream_errors() {
        let mut data = json!({"meta":{"ret":0,"safetyType":0,"sum":61,"nextpage":2},"body":{"song":{"list":[{"mid":"result","title":"现场版","id":12,"interval":120}]}}});
        let p = search_page(&data, 0, 30).unwrap();
        assert_eq!(p.next_offset, Some(30));
        assert_eq!(p.items[0].numeric_id, 12);
        data["meta"]["nextpage"] = json!(4);
        assert_eq!(search_page(&data, 60, 30).unwrap().next_offset, None);
        data["meta"]["ret"] = json!(1);
        assert!(search_page(&data, 0, 30).is_err());
    }
}
