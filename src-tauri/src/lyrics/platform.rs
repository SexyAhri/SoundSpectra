//! Cookie-free lyric lookup against the currently selected platform's public catalogue.
//! No installed-player sessions or credentials are inspected.
use super::{
    folded,
    netease::{self, Track},
    online::same_artists,
    track_key, LyricDocument,
};
use crate::now_playing::NowPlaying;
use base64::Engine;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    hash::{Hash, Hasher},
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const MAX_BYTES: usize = 2_097_152;
const FRESH_SECONDS: u64 = 7 * 24 * 60 * 60;
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
enum Platform {
    Qq,
    Soda,
}
impl Platform {
    fn name(self) -> &'static str {
        match self {
            Self::Qq => "QQ 音乐",
            Self::Soda => "汽水",
        }
    }
    fn prefix(self) -> &'static str {
        match self {
            Self::Qq => "qq",
            Self::Soda => "soda",
        }
    }
}
#[derive(Clone)]
struct Candidate {
    track: Track,
    mid: String,
}
#[derive(Serialize, Deserialize)]
struct Saved {
    version: u8,
    platform: Platform,
    key: String,
    saved_at: u64,
    track: Track,
    lyric: String,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn url(base: &str, query: &[(&str, &str)]) -> Url {
    let mut url = Url::parse(base).expect("constant public lyric endpoint");
    url.query_pairs_mut().extend_pairs(query.iter().copied());
    url
}
async fn request(client: &Client, url: Url) -> Result<Value, String> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "网络歌词连接失败")?
        .error_for_status()
        .map_err(|_| "网络歌词服务暂时不可用")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "网络歌词响应读取失败")? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("网络歌词响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "网络歌词响应格式异常".into())
}
fn text(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_u64().map(|n| n.to_string()))
        .unwrap_or_default()
}
fn numeric_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 24 && value.bytes().all(|b| b.is_ascii_digit())
}
fn qq_mid(value: &str) -> bool {
    (6..=32).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_alphanumeric())
}
fn score(track: &Track, info: &NowPlaying) -> Option<u16> {
    if !numeric_id(&track.id)
        || !info.duration.is_finite()
        || info.duration < 0.0
        || track.duration.is_none_or(|d| !d.is_finite() || d <= 0.0)
    {
        return None;
    }
    netease::score(track, info)
}
fn select(candidates: Vec<Candidate>, info: &NowPlaying) -> Result<Option<Candidate>, String> {
    let mut matches: Vec<_> = candidates
        .into_iter()
        .filter_map(|c| score(&c.track, info).map(|score| (score, c)))
        .collect();
    matches.sort_by(|a, b| b.0.cmp(&a.0));
    let Some((best, first)) = matches.first() else {
        return Ok(None);
    };
    if matches
        .iter()
        .skip(1)
        .take_while(|(score, _)| score == best)
        .any(|(_, c)| c.track.id != first.track.id)
    {
        return Err("网络曲库中存在多个同名版本，无法确定准确歌词".into());
    }
    Ok(matches.into_iter().next().map(|(_, c)| c))
}
fn qq_detail(value: &Value) -> Option<Candidate> {
    let raw = value.pointer("/songinfo/data/track_info")?;
    let id = text(&raw["id"]);
    let mid = text(&raw["mid"]);
    if !numeric_id(&id) || !qq_mid(&mid) {
        return None;
    }
    let mut track = netease::metadata(&json!({
        "id": id, "name": raw["name"], "artists": raw["singer"], "album": raw["album"],
    }))?;
    track.duration = raw["interval"]
        .as_f64()
        .filter(|d| d.is_finite() && *d > 0.0);
    Some(Candidate { track, mid })
}
fn decode_qq(body: &str) -> String {
    let raw = body.trim().trim_start_matches('\u{feff}');
    if raw.starts_with('[') || raw.starts_with('<') {
        return raw.to_owned();
    }
    base64::engine::general_purpose::STANDARD
        .decode(raw)
        .ok()
        .and_then(|b| String::from_utf8(b).ok())
        .unwrap_or_default()
}
async fn qq(client: &Client, info: &NowPlaying) -> Result<Option<(Track, String)>, String> {
    let query = format!("{} {}", info.title, info.artist);
    let response = request(
        client,
        url(
            "https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg",
            &[
                ("format", "json"),
                ("key", &query),
                ("g_tk", "5381"),
                ("platform", "yqq.json"),
            ],
        ),
    )
    .await?;
    if response["code"].as_i64() != Some(0) {
        return Err("QQ 网络曲库暂时不可用".into());
    }
    let mut mids = Vec::new();
    for song in response
        .pointer("/data/song/itemlist")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let mid = text(&song["mid"]);
        if qq_mid(&mid)
            && folded(song["name"].as_str().unwrap_or("")) == folded(&info.title)
            && same_artists(song["singer"].as_str().unwrap_or(""), &info.artist)
            && !mids.contains(&mid)
        {
            mids.push(mid);
        }
    }
    // Never select a convenient subset when all matching versions could not be checked.
    if mids.len() > 4 {
        return Err("QQ 同名候选过多，无法确定歌曲版本".into());
    }
    let mut candidates = Vec::new();
    for mid in mids {
        let data = json!({ "comm": { "ct": 24, "cv": 0 }, "songinfo": {
            "module": "music.pf_song_detail_svr", "method": "get_song_detail_yqq", "param": { "song_mid": mid }
        }}).to_string();
        let response = request(
            client,
            url("https://u.y.qq.com/cgi-bin/musicu.fcg", &[("data", &data)]),
        )
        .await?;
        let candidate = qq_detail(&response)
            .filter(|c| c.mid == mid)
            .ok_or("QQ 歌曲详情身份校验失败")?;
        candidates.push(candidate);
    }
    let Some(candidate) = select(candidates, info)? else {
        return Ok(None);
    };
    let response = request(
        client,
        url(
            "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg",
            &[
                ("songmid", &candidate.mid),
                ("format", "json"),
                ("nobase64", "1"),
                ("g_tk", "5381"),
                ("loginUin", "0"),
                ("hostUin", "0"),
                ("inCharset", "utf8"),
                ("outCharset", "utf-8"),
                ("platform", "yqq.json"),
            ],
        ),
    )
    .await?;
    if response["code"].as_i64() != Some(0) {
        return Err("QQ 网络歌词暂时不可用".into());
    }
    let lyric = decode_qq(response["lyric"].as_str().unwrap_or(""));
    Ok(netease::valid_lines(&lyric, info).map(|_| (candidate.track, lyric)))
}
fn soda_candidate(raw: &Value) -> Option<Candidate> {
    if raw["source"].as_str() != Some("qishui") || raw["media_type"].as_str() != Some("music") {
        return None;
    }
    let id = text(&raw["item_id"]);
    if !numeric_id(&id) {
        return None;
    }
    let mut track = netease::metadata(&json!({
        "id": id, "name": raw["title"], "artist": raw.pointer("/author_info/name")?, "album": raw["collection_name"],
    }))?;
    track.duration = raw["duration"]
        .as_f64()
        .filter(|d| d.is_finite() && *d > 0.0);
    Some(Candidate {
        track,
        mid: String::new(),
    })
}
fn soda_detail(value: &Value, expected: &Track, info: &NowPlaying) -> Option<(Track, String)> {
    let track = netease::metadata(value.pointer("/seo_track/track")?)?;
    if track.id != expected.id || score(&track, info).is_none() {
        return None;
    }
    let lyric = value.get("lyric")?;
    if lyric.get("hide_request_lyrics").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let body = lyric.get("content")?.as_str()?;
    netease::valid_lines(body, info)?;
    Some((track, body.to_owned()))
}
async fn soda(client: &Client, info: &NowPlaying) -> Result<Option<(Track, String)>, String> {
    let query = format!("{} {}", info.title, info.artist);
    let response = request(
        client,
        url(
            "https://api-vehicle.volcengine.com/v2/search/type",
            &[
                ("keyword", &query),
                ("search_type", "music"),
                ("limit", "50"),
                ("real_offset", "0"),
                ("search_source", "qishui"),
            ],
        ),
    )
    .await?;
    if response["errno"].as_i64() != Some(0) {
        return Err("汽水网络曲库暂时不可用".into());
    }
    let candidates = response
        .pointer("/data/list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(soda_candidate)
        .collect();
    let Some(candidate) = select(candidates, info)? else {
        return Ok(None);
    };
    let response = request(
        client,
        url(
            "https://beta-luna.douyin.com/luna/h5/seo_track",
            &[
                ("track_id", &candidate.track.id),
                ("device_platform", "web"),
            ],
        ),
    )
    .await?;
    Ok(soda_detail(&response, &candidate.track, info))
}
fn cache_path(directory: &Path, platform: Platform, info: &NowPlaying) -> PathBuf {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    track_key(info).hash(&mut hash);
    directory.join(format!(
        "platform-{}-{:016x}.json",
        platform.prefix(),
        hash.finish()
    ))
}
fn read_cache(directory: &Path, platform: Platform, info: &NowPlaying) -> Option<(Saved, bool)> {
    let file = cache_path(directory, platform, info);
    if fs::metadata(&file).ok()?.len() > MAX_BYTES as u64 {
        return None;
    }
    let saved: Saved = serde_json::from_slice(&fs::read(file).ok()?).ok()?;
    if saved.version != 1
        || saved.platform != platform
        || saved.key != track_key(info)
        || score(&saved.track, info).is_none()
        || netease::valid_lines(&saved.lyric, info).is_none()
    {
        return None;
    }
    let fresh = now().checked_sub(saved.saved_at)? < FRESH_SECONDS;
    Some((saved, fresh))
}
fn write_cache(directory: &Path, saved: &Saved, info: &NowPlaying) -> std::io::Result<()> {
    let body = serde_json::to_vec(saved)?;
    if body.len() > MAX_BYTES {
        return Ok(());
    }
    fs::create_dir_all(directory)?;
    let target = cache_path(directory, saved.platform, info);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = target.with_extension(format!("{}-{nonce}.tmp", std::process::id()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(&body)?;
        drop(file);
        fs::rename(&temporary, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    let mut files: Vec<_> = fs::read_dir(directory)?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name();
            let name = name.to_str()?;
            let m = e.metadata().ok()?;
            (name.starts_with("platform-") && name.ends_with(".json") && m.is_file())
                .then(|| (m.modified().unwrap_or(UNIX_EPOCH), e.path()))
        })
        .collect();
    files.sort_by_key(|(time, _)| *time);
    for (_, file) in files.iter().take(files.len().saturating_sub(64)) {
        let _ = fs::remove_file(file);
    }
    result
}
fn document(
    platform: Platform,
    info: &NowPlaying,
    lyric: &str,
    suffix: &str,
) -> Option<LyricDocument> {
    Some(LyricDocument {
        key: track_key(info),
        status: "ready".into(),
        message: format!("歌词已匹配 · {}网络歌词{suffix}", platform.name()),
        lines: netease::valid_lines(lyric, info)?,
        ..Default::default()
    })
}
fn client(platform: Platform) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(6))
        .connect_timeout(Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Mozilla/5.0 SoundSpectra")
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::REFERER,
                reqwest::header::HeaderValue::from_static(if platform == Platform::Qq {
                    "https://y.qq.com/"
                } else {
                    "https://www.douyin.com/"
                }),
            );
            h
        })
        .build()
        .map_err(|_| "网络歌词服务初始化失败".to_owned())
}
pub(super) async fn fetch(
    player: Option<&str>,
    info: &NowPlaying,
    directory: &Path,
) -> Option<LyricDocument> {
    let platform = match player {
        Some("qqmusic") => Platform::Qq,
        Some("soda") => Platform::Soda,
        _ => return None,
    };
    if info.title.trim().is_empty() || info.artist.trim().is_empty() {
        return None;
    }
    let root = directory.to_owned();
    let track = info.clone();
    let cached = tauri::async_runtime::spawn_blocking(move || read_cache(&root, platform, &track))
        .await
        .ok()
        .flatten();
    if let Some((saved, true)) = &cached {
        return document(platform, info, &saved.lyric, " · 本地缓存");
    }
    let result = async {
        let client = client(platform)?;
        match platform {
            Platform::Qq => qq(&client, info).await,
            Platform::Soda => soda(&client, info).await,
        }
    };
    match tokio::time::timeout(Duration::from_secs(18), result)
        .await
        .unwrap_or_else(|_| Err("网络歌词查询超时".into()))
    {
        Ok(Some((track, lyric))) => {
            let found = document(platform, info, &lyric, "");
            let saved = Saved {
                version: 1,
                platform,
                key: track_key(info),
                saved_at: now(),
                track,
                lyric,
            };
            let root = directory.to_owned();
            let info = info.clone();
            // Result delivery never waits on disk, and failed writes do not hide lyrics.
            tauri::async_runtime::spawn_blocking(move || {
                let _ = write_cache(&root, &saved, &info);
            });
            found
        }
        result => {
            if let Some((saved, _)) = cached {
                return document(platform, info, &saved.lyric, " · 离线缓存");
            }
            result.err().map(|message| LyricDocument {
                key: track_key(info),
                status: "error".into(),
                message: format!("{}：{message}", platform.name()),
                ..Default::default()
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info() -> NowPlaying {
        NowPlaying {
            title: "微光".into(),
            artist: "乙 / 甲".into(),
            album: "星海".into(),
            duration: 10.0,
            ..Default::default()
        }
    }
    fn candidate(id: &str) -> Candidate {
        Candidate {
            track: Track {
                id: id.into(),
                title: "微光".into(),
                artist: "甲、乙".into(),
                album: "星海".into(),
                duration: Some(10.0),
            },
            mid: "000testMid".into(),
        }
    }
    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }
    const LYRIC: &str = "[1000,2000]<0,900,0>微<900,1100,0>光\n[4000,2000]<0,2000,0>星海";

    #[test]
    fn identity_requires_full_metadata_and_refuses_ambiguous_versions() {
        let song = info();
        assert!(select(vec![candidate("123"), candidate("456")], &song).is_err());
        assert_eq!(
            select(vec![candidate("123"), candidate("123")], &song)
                .unwrap()
                .unwrap()
                .track
                .id,
            "123"
        );
        let mut other_album = candidate("456");
        other_album.track.album = "旧专辑".into();
        assert_eq!(
            select(vec![other_album, candidate("123")], &song)
                .unwrap()
                .unwrap()
                .track
                .id,
            "123"
        );
        let mut variants = Vec::new();
        let mut c = candidate("123");
        c.track.title += " (Live)";
        variants.push(c);
        let mut c = candidate("123");
        c.track.artist = "丙".into();
        variants.push(c);
        let mut c = candidate("123");
        c.track.duration = Some(20.0);
        variants.push(c);
        let mut c = candidate("123");
        c.track.duration = None;
        variants.push(c);
        let mut c = candidate("123");
        c.track.duration = Some(f64::NAN);
        variants.push(c);
        variants.push(candidate("../123"));
        assert!(select(variants, &song).unwrap().is_none());
    }

    #[test]
    fn qq_metadata_and_plain_or_encoded_lyrics_keep_exact_timing() {
        let mut response = json!({ "songinfo": { "data": { "track_info": {
            "id": 123, "mid": "000testMid", "name": "微光", "singer": [{"name":"甲"},{"name":"乙"}],
            "album": {"name":"星海"}, "interval": 10
        }}}});
        let c = qq_detail(&response).unwrap();
        assert_eq!(c.track.id, "123");
        assert_eq!(c.mid, "000testMid");
        assert!(score(&c.track, &info()).is_some());
        response["songinfo"]["data"]["track_info"]["mid"] = json!("../bad");
        assert!(qq_detail(&response).is_none());
        let lrc = "[00:01.00]微光\n[00:04.00]星海";
        assert_eq!(decode_qq(lrc), lrc);
        assert_eq!(
            decode_qq(&base64::engine::general_purpose::STANDARD.encode(lrc)),
            lrc
        );
        assert!(decode_qq("invalid").is_empty());
        let lines = netease::valid_lines(&decode_qq(lrc), &info()).unwrap();
        assert_eq!(lines[0].start, 1000);
        assert!(lines[0].words.is_empty());
    }

    #[test]
    fn soda_reads_only_the_verified_track_and_its_own_visible_word_lyrics() {
        let raw = json!({"source":"qishui", "media_type":"music", "item_id":"123", "title":"微光", "author_info":{"name":"甲 / 乙"}, "duration":10});
        assert!(score(&soda_candidate(&raw).unwrap().track, &info()).is_some());
        let mut wrong_source = raw.clone();
        wrong_source["source"] = json!("other");
        assert!(soda_candidate(&wrong_source).is_none());
        let mut response = json!({"seo_track":{"track":{"id":"123","name":"微光","artists":[{"name":"甲"},{"name":"乙"}],"duration":10000}},
            "lyric":{"content":LYRIC,"hide_request_lyrics":false},
            "album_tracks":[{"lyric":{"content":"[00:01]wrong"}}]});
        let (_, body) = soda_detail(&response, &candidate("123").track, &info()).unwrap();
        let lines = netease::valid_lines(&body, &info()).unwrap();
        assert_eq!(lines[0].words.len(), 2);
        assert_eq!(lines[0].words[1].start, 1900);
        assert!(soda_detail(&response, &candidate("456").track, &info()).is_none());
        response["lyric"]["hide_request_lyrics"] = json!(true);
        assert!(soda_detail(&response, &candidate("123").track, &info()).is_none());
        response.as_object_mut().unwrap().remove("lyric");
        assert!(soda_detail(&response, &candidate("123").track, &info()).is_none());
    }

    #[test]
    fn cache_rechecks_provider_key_identity_and_times_before_offline_use() {
        let root = std::env::temp_dir().join(format!(
            "soundspectra-platform-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let song = info();
        let mut saved = Saved {
            version: 1,
            platform: Platform::Qq,
            key: track_key(&song),
            saved_at: now(),
            track: candidate("123").track,
            lyric: LYRIC.into(),
        };
        write_cache(&root, &saved, &song).unwrap();
        assert!(read_cache(&root, Platform::Qq, &song).unwrap().1);
        assert!(read_cache(&root, Platform::Soda, &song).is_none());
        saved.saved_at = now() - FRESH_SECONDS - 1;
        write_cache(&root, &saved, &song).unwrap();
        assert!(!read_cache(&root, Platform::Qq, &song).unwrap().1);
        saved.track.duration = Some(30.0);
        write_cache(&root, &saved, &song).unwrap();
        assert!(read_cache(&root, Platform::Qq, &song).is_none());
        saved.track.duration = Some(10.0);
        saved.lyric = "[01:00]错误时间".into();
        write_cache(&root, &saved, &song).unwrap();
        assert!(read_cache(&root, Platform::Qq, &song).is_none());
        saved.lyric = LYRIC.into();
        saved.key = "other".into();
        write_cache(&root, &saved, &song).unwrap();
        assert!(read_cache(&root, Platform::Qq, &song).is_none());
        saved.key = track_key(&song);
        saved.platform = Platform::Soda;
        fs::write(
            cache_path(&root, Platform::Qq, &song),
            serde_json::to_vec(&saved).unwrap(),
        )
        .unwrap();
        assert!(read_cache(&root, Platform::Qq, &song).is_none());
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn unrelated_players_never_start_a_platform_lookup() {
        runtime().block_on(async {
            for player in [None, Some("kugou"), Some("netease"), Some("unknown")] {
                assert!(fetch(player, &info(), Path::new("unused-platform-cache"))
                    .await
                    .is_none());
            }
        });
    }

    #[test]
    #[ignore = "Read-only public QQ search/detail/lyric requests; no player or login required"]
    fn public_qq_lyrics_without_login() {
        runtime().block_on(async {
            let song = NowPlaying {
                title: "麻雀".into(),
                artist: "李荣浩".into(),
                album: "麻雀".into(),
                duration: 252.757,
                ..Default::default()
            };
            let (track, body) = qq(&client(Platform::Qq).unwrap(), &song)
                .await
                .unwrap()
                .expect("QQ lyric match");
            let lines = netease::valid_lines(&body, &song).unwrap();
            assert!(score(&track, &song).is_some());
            assert!(lines.len() > 10);
            println!(
                "QQ public lyrics: {} timed lines, id {}",
                lines.len(),
                track.id
            );
        });
    }

    #[test]
    #[ignore = "Read-only public Soda search/detail/lyric requests; no player or login required"]
    fn public_soda_lyrics_without_login() {
        runtime().block_on(async {
            let song = NowPlaying {
                title: "牡丹亭（DJ筱轩版）".into(),
                artist: "浅影阿".into(),
                album: "牡丹亭".into(),
                duration: 182.485624,
                ..Default::default()
            };
            let (track, body) = soda(&client(Platform::Soda).unwrap(), &song)
                .await
                .unwrap()
                .expect("Soda lyric match");
            let lines = netease::valid_lines(&body, &song).unwrap();
            assert!(score(&track, &song).is_some());
            assert!(lines.len() > 10);
            assert!(lines.iter().any(|line| !line.words.is_empty()));
            println!(
                "Soda public lyrics: {} timed lines, id {}",
                lines.len(),
                track.id
            );
        });
    }
}
