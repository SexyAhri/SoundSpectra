//! Resolve public song IDs from the installed client's read-only metadata DB.
//! Never infer an ID from a title search, read cookies, or modify player files.
use super::{folded, lookup, online::same_artists, parse, track_key, Line, LyricDocument};
use crate::now_playing::NowPlaying;
use reqwest::Client;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const API: &str = "https://music.163.com/api/song/lyric/v1";
const MAX_BYTES: u64 = 2_097_152;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub(super) struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: Option<f64>,
}

pub(super) fn metadata(value: &Value) -> Option<Track> {
    let title = value
        .get("name")
        .or_else(|| value.get("title"))?
        .as_str()?
        .trim()
        .to_owned();
    let artists = value.get("artists").or_else(|| value.get("ar"));
    let artist = artists
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|a| a.get("name").and_then(Value::as_str).or_else(|| a.as_str()))
                .collect::<Vec<_>>()
                .join(" / ")
        })
        .or_else(|| {
            value
                .get("artist")
                .or_else(|| value.get("artistName"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })?;
    if title.is_empty() || artist.trim().is_empty() {
        return None;
    }
    let album = value
        .get("album")
        .or_else(|| value.get("al"))
        .and_then(|v| v.as_str().or_else(|| v.get("name")?.as_str()))
        .unwrap_or("")
        .to_owned();
    let id = value
        .get("id")
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| v.to_string())
        })
        .unwrap_or_default();
    let duration = value
        .get("duration")
        .or_else(|| value.get("dt"))
        .and_then(Value::as_f64)
        .map(|ms| ms / 1000.0)
        .filter(|v| v.is_finite() && *v > 0.0);
    Some(Track {
        id,
        title,
        artist,
        album,
        duration,
    })
}

fn roots(folder: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for variable in ["LOCALAPPDATA", "APPDATA"] {
        if let Some(base) = std::env::var_os(variable) {
            roots.push(PathBuf::from(&base).join("Netease/CloudMusic"));
            roots.push(PathBuf::from(base).join("CloudMusic"));
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        roots.push(home.join("Library/Containers/com.netease.163music/Data/Library/Application Support/netease/CloudMusic"));
        roots.push(home.join("Library/Application Support/CloudMusic"));
    }
    if !folder.is_empty() {
        roots.extend(Path::new(folder).ancestors().take(5).map(Path::to_path_buf));
    }
    roots.sort();
    roots.dedup();
    roots.retain(|p| p.join("Library/webdb.dat").is_file());
    roots
}

pub(super) fn score(track: &Track, info: &NowPlaying) -> Option<u16> {
    if folded(&track.title) != folded(&info.title)
        || !same_artists(&track.artist, &info.artist)
        || info.duration > 0.0
            && track
                .duration
                .is_some_and(|d| (d - info.duration).abs() > 4.0)
    {
        return None;
    }
    Some(
        if !info.album.is_empty() && folded(&track.album) == folded(&info.album) {
            110
        } else {
            100
        },
    )
}

fn identify(
    roots: &[PathBuf],
    info: &NowPlaying,
    stop: Option<&lookup::LocalStop>,
) -> Result<Option<(Track, PathBuf)>, String> {
    let mut candidates = Vec::new();
    for root in roots {
        let db = Connection::open_with_flags(
            root.join("Library/webdb.dat"),
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .map_err(|_| "网易云本地歌曲资料库暂时无法读取")?;
        db.busy_timeout(Duration::from_millis(50))
            .map_err(|_| "网易云本地资料库读取超时")?;
        // Known song metadata tables only. No account/session/request tables.
        for table in ["dbTrack", "historyTracks", "offlineTrack"] {
            let sql = format!(
                "SELECT id,jsonStr FROM {table} WHERE length(jsonStr) <= 1048576 LIMIT 10000"
            );
            let Ok(mut statement) = db.prepare(&sql) else {
                continue;
            };
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|_| "网易云本地歌曲资料库忙，请稍后重试")?;
            for row in rows {
                if stop.is_some_and(|s| s.is_stopped()) {
                    return Ok(None);
                }
                let (id, text) = row.map_err(|_| "网易云本地歌曲资料库读取失败")?;
                if id.is_empty() || id.len() > 24 || !id.bytes().all(|b| b.is_ascii_digit()) {
                    continue;
                }
                let Ok(json) = serde_json::from_str::<Value>(&text) else {
                    continue;
                };
                let Some(mut track) = metadata(&json) else {
                    continue;
                };
                if !track.id.is_empty() && track.id != id {
                    continue;
                }
                track.id = id;
                if let Some(score) = score(&track, info) {
                    candidates.push((score, track, root.clone()));
                }
            }
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    let Some((best, first, _)) = candidates.first() else {
        return Ok(None);
    };
    if candidates
        .iter()
        .take_while(|c| c.0 == *best)
        .any(|c| c.1.id != first.id)
    {
        return Err("网易云本地存在多个同名版本，无法确定歌曲 ID".into());
    }
    Ok(candidates
        .into_iter()
        .next()
        .map(|(_, track, root)| (track, root)))
}

pub(super) fn valid_lines(text: &str, info: &NowPlaying) -> Option<Vec<Line>> {
    let mut lines = parse(text).ok()?;
    if info.duration > 0.0 {
        let limit = ((info.duration + 4.0) * 1000.0) as u64;
        if lines
            .iter()
            .any(|l| l.start > limit || l.words.iter().any(|w| w.end > limit))
        {
            return None;
        }
        for line in &mut lines {
            if line.words.is_empty() && line.start < (info.duration * 1000.0) as u64 {
                line.end = line.end.min((info.duration * 1000.0) as u64);
            }
        }
    }
    Some(lines)
}

fn local_lyric(root: &Path, track: &Track, info: &NowPlaying) -> Option<Vec<Line>> {
    let mut visited = HashSet::new();
    for directory in ["Lyric", "Cache/Lyric", "webdata/lyric"] {
        for extension in ["yrc", "lrc", "lyric", "json", ""] {
            let name = if extension.is_empty() {
                track.id.clone()
            } else {
                format!("{}.{extension}", track.id)
            };
            let path = root.join(directory).join(name);
            if !visited.insert(path.clone()) {
                continue;
            }
            if fs::metadata(&path).ok().is_none_or(|m| m.len() > 1_048_576) {
                continue;
            }
            let Some(text) = fs::read(&path).ok().and_then(|b| super::decode(&b).ok()) else {
                continue;
            };
            if let Some(lines) = valid_lines(&text, info) {
                return Some(lines);
            }
        }
    }
    None
}

#[derive(Deserialize, Serialize)]
struct Saved {
    version: u8,
    track: Track,
    saved_at: u64,
    lyric: String,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn cache_path(directory: &Path, track: &Track) -> PathBuf {
    directory.join(format!("netease-{}.json", track.id))
}
fn read_cache(directory: &Path, track: &Track, info: &NowPlaying) -> Option<(Vec<Line>, bool)> {
    let path = cache_path(directory, track);
    if fs::metadata(&path).ok()?.len() > MAX_BYTES {
        return None;
    }
    let saved: Saved = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if saved.version != 1 || saved.track.id != track.id || score(&saved.track, info).is_none() {
        return None;
    }
    let fresh = now()
        .checked_sub(saved.saved_at)
        .is_some_and(|age| age < 7 * 86400);
    Some((valid_lines(&saved.lyric, info)?, fresh))
}
fn write_cache(directory: &Path, track: Track, lyric: String) -> Result<(), String> {
    let target = cache_path(directory, &track);
    let saved = Saved {
        version: 1,
        track,
        saved_at: now(),
        lyric,
    };
    let bytes = serde_json::to_vec(&saved).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("网易云歌词缓存过大".into());
    }
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let temp = target.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, &target)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(temp);
        return Err(e.to_string());
    }
    let mut files: Vec<_> = fs::read_dir(directory)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name();
            let name = name.to_str()?;
            if !name.starts_with("netease-") || !name.ends_with(".json") {
                return None;
            }
            let m = e.metadata().ok()?;
            m.is_file()
                .then(|| (m.modified().unwrap_or(UNIX_EPOCH), e.path()))
        })
        .collect();
    files.sort_by_key(|v| v.0);
    for (_, path) in files.iter().take(files.len().saturating_sub(64)) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

async fn fetch_from(client: &Client, endpoint: &str, id: &str) -> Result<Option<String>, String> {
    let mut url = reqwest::Url::parse(endpoint).map_err(|_| "网易云歌词服务地址无效")?;
    url.query_pairs_mut().extend_pairs([
        ("id", id),
        ("lv", "-1"),
        ("kv", "-1"),
        ("tv", "-1"),
        ("yv", "-1"),
        ("rv", "-1"),
    ]);
    let mut response = client
        .get(url)
        .header("Referer", "https://music.163.com/")
        .send()
        .await
        .map_err(|_| "网易云歌词服务连接失败")?;
    if response.status().as_u16() == 429 {
        return Err("网易云请求较多，请稍后重试".into());
    }
    response = response
        .error_for_status()
        .map_err(|_| "网易云歌词服务暂时不可用")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "网易云歌词响应读取失败")?
    {
        if bytes.len() as u64 + chunk.len() as u64 > MAX_BYTES {
            return Err("网易云歌词响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "网易云歌词返回格式异常")?;
    if value["code"].as_u64() != Some(200) {
        return Err("网易云歌词服务返回异常".into());
    }
    if value["nolyric"].as_bool() == Some(true) || value["pureMusic"].as_bool() == Some(true) {
        return Ok(None);
    }
    if super::json_lyric(&value).is_none() {
        return Ok(None);
    }
    Ok(Some(value.to_string()))
}

fn document(info: &NowPlaying, status: &str, message: String, lines: Vec<Line>) -> LyricDocument {
    LyricDocument {
        key: track_key(info),
        status: status.into(),
        message,
        lines,
        ..Default::default()
    }
}

pub(super) async fn fetch(
    info: &NowPlaying,
    folder: &str,
    directory: &Path,
) -> Option<LyricDocument> {
    if info.title.is_empty() || info.artist.is_empty() {
        return None;
    }
    let root_list = roots(folder);
    if root_list.is_empty() {
        return None;
    }
    let track_info = info.clone();
    let dir = directory.to_path_buf();
    let stop = Arc::new(lookup::LocalStop::new(Arc::default()));
    let _stop_on_drop = lookup::StopLocalOnDrop(stop.clone());
    let local = tauri::async_runtime::spawn_blocking(move || {
        let matched = identify(&root_list, &track_info, Some(&stop))?;
        Ok::<_, String>(matched.map(|(track, root)| {
            let local = local_lyric(&root, &track, &track_info);
            let cached = read_cache(&dir, &track, &track_info);
            (track, local, cached)
        }))
    })
    .await;
    let (track, local, cached) = match local {
        Ok(Ok(Some(found))) => found,
        Ok(Ok(None)) => return None,
        Ok(Err(error)) => {
            let status = if error.contains("多个同名版本") {
                "ambiguous"
            } else {
                "error"
            };
            return Some(document(info, status, error, vec![]));
        }
        Err(_) => {
            return Some(document(
                info,
                "error",
                "网易云本地歌曲资料库暂时无法读取或准确匹配".into(),
                vec![],
            ))
        }
    };
    if let Some(lines) = local {
        return Some(document(
            info,
            "ready",
            "歌词已匹配 · 网易云本地文件".into(),
            lines,
        ));
    }
    if let Some((lines, true)) = &cached {
        return Some(document(
            info,
            "ready",
            "歌词已匹配 · 网易云本地缓存".into(),
            lines.clone(),
        ));
    }
    let client = match Client::builder()
        .timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::limited(2))
        .user_agent(concat!("SoundSpectra/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return Some(document(
                info,
                "error",
                "网易云歌词服务初始化失败".into(),
                vec![],
            ))
        }
    };
    let result = fetch_from(&client, API, &track.id).await;
    match result {
        Ok(Some(text)) => {
            let Some(lines) = valid_lines(&text, info) else {
                return Some(document(
                    info,
                    "error",
                    "网易云歌词时间或正文无效".into(),
                    vec![],
                ));
            };
            let directory = directory.to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = write_cache(&directory, track, text);
            });
            Some(document(
                info,
                "ready",
                "歌词已匹配 · 网易云歌曲 ID".into(),
                lines,
            ))
        }
        Err(error) => {
            if let Some((lines, _)) = cached {
                return Some(document(
                    info,
                    "ready",
                    "歌词已匹配 · 网易云离线缓存".into(),
                    lines,
                ));
            }
            Some(document(info, "error", error, vec![]))
        }
        Ok(None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn info() -> NowPlaying {
        NowPlaying {
            title: "微光".into(),
            artist: "乙、甲".into(),
            album: "星海".into(),
            duration: 10.0,
            ..Default::default()
        }
    }
    fn song(id: &str) -> Value {
        serde_json::json!({"id": id,"name":"微光","artists":[{"name":"甲"},{"name":"乙"}],"album":{"name":"星海"},"duration":10000})
    }
    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
    }

    #[test]
    fn database_ids_resolve_hashed_metadata_and_refuse_other_recordings() {
        let root =
            std::env::temp_dir().join(format!("soundspectra-netease-db-{}", std::process::id()));
        fs::create_dir_all(root.join("Library")).unwrap();
        let path = root.join("Library/webdb.dat");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE dbTrack(id TEXT PRIMARY KEY,jsonStr TEXT);")
            .unwrap();
        db.execute(
            "INSERT INTO dbTrack VALUES (?1,?2)",
            ["123", &song("123").to_string()],
        )
        .unwrap();
        let before = fs::read(&path).unwrap();
        let (track, _) = identify(&[root.clone()], &info(), None).unwrap().unwrap();
        assert_eq!(track.id, "123");
        assert_eq!(before, fs::read(&path).unwrap()); // Production reader is read-only.
        let mut wrong = info();
        wrong.duration = 30.0;
        assert!(identify(&[root.clone()], &wrong, None).unwrap().is_none());
        wrong = info();
        wrong.artist = "丙".into();
        assert!(identify(&[root.clone()], &wrong, None).unwrap().is_none());
        fs::create_dir_all(root.join("Lyric")).unwrap();
        fs::write(
            root.join("Lyric/123"),
            r#"{"yrc":{"lyric":"[1000,1000](1000,1000,0)微光"}}"#,
        )
        .unwrap();
        let lines = local_lyric(&root, &track, &info()).unwrap();
        assert_eq!(lines[0].words.len(), 1);
        db.execute(
            "INSERT INTO dbTrack VALUES (?1,?2)",
            ["456", &song("456").to_string()],
        )
        .unwrap();
        assert!(identify(&[root.clone()], &info(), None)
            .unwrap_err()
            .contains("多个同名版本"));
        let cancelled = Arc::new(lookup::Cancellation::default());
        cancelled.cancel();
        let stop = lookup::LocalStop::new(cancelled);
        assert!(identify(&[root.clone()], &info(), Some(&stop))
            .unwrap()
            .is_none());
        drop(db);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn disk_cache_validates_identity_timing_and_survives_offline_reads() {
        let root =
            std::env::temp_dir().join(format!("soundspectra-netease-cache-{}", std::process::id()));
        let track = metadata(&song("123")).unwrap();
        write_cache(
            &root,
            track.clone(),
            r#"{"yrc":{"lyric":"bad"},"lrc":{"lyric":"[00:01]微光"}}"#.into(),
        )
        .unwrap();
        let (lines, fresh) = read_cache(&root, &track, &info()).unwrap();
        assert!(fresh);
        assert_eq!(lines[0].text, "微光");
        let mut wrong = info();
        wrong.artist = "丙".into();
        assert!(read_cache(&root, &track, &wrong).is_none());
        let path = cache_path(&root, &track);
        let mut saved: Saved = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        saved.saved_at = now() - 8 * 86400;
        fs::write(&path, serde_json::to_vec(&saved).unwrap()).unwrap();
        assert!(!read_cache(&root, &track, &info()).unwrap().1);
        saved.track.id = "456".into();
        fs::write(&path, serde_json::to_vec(&saved).unwrap()).unwrap();
        assert!(read_cache(&root, &track, &info()).is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn http_contract_uses_verified_id_and_preserves_word_times() {
        use std::{io::Read, net::TcpListener, thread};
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut data = Vec::new();
            let mut buf = [0; 2048];
            while !data.windows(4).any(|s| s == b"\r\n\r\n") {
                let n = socket.read(&mut buf).unwrap();
                assert!(n > 0);
                data.extend_from_slice(&buf[..n]);
            }
            let request = String::from_utf8(data).unwrap();
            assert!(request.starts_with("GET /?id=123&"));
            assert!(!request.to_lowercase().contains("cookie:"));
            let body = r#"{"code":200,"yrc":{"lyric":"[1000,1000](1000,500,0)微(1500,500,0)光"}}"#;
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        runtime().block_on(async {
            let client = Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap();
            let text = fetch_from(&client, &base, "123").await.unwrap().unwrap();
            let lines = valid_lines(&text, &info()).unwrap();
            assert_eq!(lines[0].words.len(), 2);
            assert_eq!(lines[0].words[1].start, 1500);
        });
        server.join().unwrap();
    }

    #[test]
    #[ignore = "Read-only integration with the installed NetEase metadata database and public lyric service"]
    fn installed_client_resolves_and_fetches_without_modifying_player_files() {
        let roots = roots("");
        assert!(!roots.is_empty());
        let path = roots[0].join("Library/webdb.dat");
        let before = fs::read(&path).unwrap();
        let db = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let text: String = db
            .query_row("SELECT jsonStr FROM historyTracks LIMIT 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        let track = metadata(&serde_json::from_str::<Value>(&text).unwrap()).unwrap();
        drop(db);
        let info = NowPlaying {
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration: track.duration.unwrap_or(0.0),
            ..Default::default()
        };
        let (matched, _) = identify(&roots, &info, None).unwrap().unwrap();
        let root = std::env::temp_dir().join(format!(
            "soundspectra-netease-integration-{}",
            std::process::id()
        ));
        runtime().block_on(async {
            let result = fetch(&info, "", &root).await.unwrap();
            assert_eq!(result.status, "ready", "{}", result.message);
            assert!(!result.lines.is_empty());
            eprintln!(
                "Installed NetEase: resolved ID {}, {} lines, {} timed words",
                matched.id,
                result.lines.len(),
                result.lines.iter().map(|l| l.words.len()).sum::<usize>()
            );
            // Wait for the independent cache writer before cleaning our temp directory.
            for _ in 0..100 {
                if cache_path(&root, &matched).is_file() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        });
        assert_eq!(before, fs::read(path).unwrap());
        if root.is_dir() {
            fs::remove_dir_all(root).unwrap();
        }
    }
}
