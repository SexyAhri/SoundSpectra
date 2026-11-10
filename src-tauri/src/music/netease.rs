//! Official-web sessions and authorized NetEase resources. No passwords,
//! third-party audio matching, download-permission substitutes, or public API server.
use super::{model::*, netease_quality as quality, qq_quality::MAX_AUDIO_BYTES};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{blocking::Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

const MAX_JSON: u64 = 8 * 1024 * 1024;
const PREFETCH: usize = 4 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    pub domain: Option<String>,
    pub path: Option<String>,
    pub secure: bool,
    pub expires: Option<i64>,
}
#[derive(Serialize, Deserialize)]
pub struct Session {
    pub cookies: Vec<Cookie>,
}

struct Index {
    at: Instant,
    created: Vec<Playlist>,
    collected: Vec<Playlist>,
    liked: Option<u64>,
}
#[derive(Clone)]
struct TrackList {
    at: Instant,
    ids: Vec<Option<u64>>,
    version: Option<u64>,
}
struct Prepared {
    track: String,
    level: String,
    format: String,
    bytes: Vec<u8>,
    total: usize,
}
struct Gate {
    next: Instant,
    blocked: Option<(Instant, &'static str)>,
}
struct Source {
    url: Url,
    level: String,
    format: String,
    bitrate: Option<u32>,
}
struct AudioAttempts {
    tried: HashSet<String>,
    last: String,
    fallback: Option<String>,
}

fn try_audio(
    source: Source,
    attempts: &mut AudioAttempts,
    download: &mut impl FnMut(Source, Option<String>) -> Result<Audio, String>,
) -> Result<Option<Audio>, String> {
    if !attempts.tried.insert(source.level.clone()) {
        return Ok(None);
    }
    let label = quality::label(&source.level).unwrap_or("当前");
    match download(source, attempts.fallback.clone()) {
        Ok(audio) => Ok(Some(audio)),
        Err(error) => {
            let failure = super::diagnostics::Failure::classify(&error);
            if failure.retryable
                || failure.login_required
                || matches!(failure.kind, "risk" | "rate_limit" | "cancelled")
            {
                return Err(error);
            }
            attempts.last = error;
            attempts.fallback = Some(format!("{label}资源无法播放，已切换到可播放的授权音质"));
            Ok(None)
        }
    }
}

fn select_audio(
    levels: &[&str],
    below: Option<&str>,
    request: &AudioRequest,
    mut authorize: impl FnMut(&str) -> Result<Option<Source>, String>,
    mut download: impl FnMut(Source, Option<String>) -> Result<Audio, String>,
) -> Result<Audio, String> {
    let mut attempts = AudioAttempts {
        tried: HashSet::new(),
        last: "[unavailable] 该歌曲暂不可播放，可能受版权、会员或地区限制".into(),
        fallback: below.map(|id| {
            format!(
                "{}播放失败，已自动切换音质",
                quality::label(id).unwrap_or("上一档音质")
            )
        }),
    };
    let mut pending: Option<Source> = None;
    for level in levels {
        request.check()?;
        let requested_rank = quality::rank(level).unwrap();
        // Retain a lower grant while checking intervening modes: a standard
        // response to vivid must not hide a valid master or lossless resource.
        if pending
            .as_ref()
            .is_some_and(|source| quality::rank(&source.level).unwrap() <= requested_rank)
        {
            if let Some(audio) = try_audio(pending.take().unwrap(), &mut attempts, &mut download)? {
                return Ok(audio);
            }
        }
        if attempts.tried.contains(*level) {
            continue;
        }
        let source = match authorize(level) {
            Ok(Some(source)) => source,
            Ok(None) => continue,
            Err(error)
                if matches!(
                    super::diagnostics::Failure::classify(&error).kind,
                    "decode" | "permission" | "unavailable"
                ) =>
            {
                attempts.last = error;
                continue;
            }
            Err(error) => return Err(error),
        };
        if attempts.tried.contains(&source.level) {
            continue;
        }
        let granted_rank = quality::rank(&source.level).unwrap();
        if granted_rank > requested_rank {
            if pending
                .as_ref()
                .is_none_or(|old| granted_rank < quality::rank(&old.level).unwrap())
            {
                pending = Some(source);
            }
            continue;
        }
        if let Some(audio) = try_audio(source, &mut attempts, &mut download)? {
            return Ok(audio);
        }
    }
    if let Some(source) = pending {
        request.check()?;
        if let Some(audio) = try_audio(source, &mut attempts, &mut download)? {
            return Ok(audio);
        }
    }
    Err(attempts.last)
}

pub struct Netease {
    client: Client,
    cookie: String,
    csrf: String,
    uid: AtomicU64,
    gate: Mutex<Gate>,
    index: Mutex<Option<Index>>,
    lists: Mutex<HashMap<String, TrackList>>,
    prepared: Mutex<Option<Prepared>>,
    cache: Option<Arc<super::cache::Cache>>,
}

fn id(v: &Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| *n > 0)
}
fn official_asset(host: &str) -> bool {
    host.ends_with(".music.126.net")
}
fn asset_url(value: &str) -> Option<Url> {
    let mut url = Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
        || !url.host_str().is_some_and(official_asset)
    {
        return None;
    }
    url.set_scheme("https").ok()?;
    url.set_fragment(None);
    Some(url)
}
fn client(api: bool) -> Result<Client, String> {
    Client::builder().connect_timeout(Duration::from_secs(8)).timeout(Duration::from_secs(18))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/142.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if !api && attempt.previous().len()<5 && asset_url(attempt.url().as_str()).is_some_and(|url|url==*attempt.url()) { attempt.follow() } else { attempt.stop() }
        })).build().map_err(|_|"无法创建网易云音乐网络会话".into())
}
fn cookie_header(session: &Session, now: u64) -> Result<(String, String), String> {
    if session.cookies.len() > 256 {
        return Err("[authentication] 网易云登录凭据无效，请重新扫码".into());
    }
    let mut names = HashSet::new();
    let mut rows = Vec::new();
    let mut csrf = String::new();
    let mut logged = false;
    for c in &session.cookies {
        let domain = c
            .domain
            .as_deref()
            .unwrap_or("music.163.com")
            .trim_start_matches('.');
        if domain != "music.163.com"
            || c.path.as_deref().is_some_and(|p| p != "/")
            || c.expires.is_some_and(|t| t <= now as i64 / 1000)
        {
            continue;
        }
        if c.name.is_empty()
            || c.name.len() > 256
            || c.value.len() > 8192
            || !c
                .name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            || c.value.bytes().any(|b| b <= 0x20 || b >= 0x7f || b == b';')
            || !names.insert(c.name.as_str())
        {
            continue;
        }
        if c.name == "MUSIC_U" && !c.value.is_empty() {
            logged = true;
        }
        if c.name == "__csrf" {
            csrf = c.value.clone();
        }
        rows.push(format!("{}={}", c.name, c.value));
    }
    let header = rows.join("; ");
    if !logged || header.len() > 65536 {
        return Err("[authentication] 网易云登录已失效，请重新扫码".into());
    }
    Ok((header, csrf))
}
fn check(value: &Value) -> Result<(), String> {
    match value["code"].as_i64() {
        Some(200) => Ok(()),
        Some(301 | 401) => Err("[authentication] 网易云登录已失效，请重新扫码".into()),
        Some(-460) => Err("[risk] 网易云暂时限制了此会话，请稍后手动重试".into()),
        Some(429) => Err("[rate_limit] 网易云请求过于频繁，请稍后手动重试".into()),
        Some(403) => Err("[permission] 当前账号没有此项访问权限".into()),
        _ => Err("[unavailable] 网易云暂未提供此项数据".into()),
    }
}

impl Netease {
    pub fn new(session: &Session) -> Result<Self, String> {
        let (cookie, csrf) = cookie_header(session, super::now())?;
        Ok(Self {
            client: client(true)?,
            cookie,
            csrf,
            uid: AtomicU64::new(0),
            gate: Mutex::new(Gate {
                next: Instant::now(),
                blocked: None,
            }),
            index: Mutex::new(None),
            lists: Mutex::new(HashMap::new()),
            prepared: Mutex::new(None),
            cache: None,
        })
    }
    pub fn with_cache(mut self, cache: Arc<super::cache::Cache>) -> Self {
        self.cache = Some(cache);
        self
    }
    fn get(&self, path: &str, params: &[(&str, String)]) -> Result<Value, String> {
        if !path.starts_with("/api/") || path.contains(['?', '#']) || path.contains("..") {
            return Err("网易云接口地址无效".into());
        }
        self.wait_gate()?;
        let mut url = Url::parse(&format!("https://music.163.com{path}"))
            .map_err(|_| "网易云接口地址无效")?;
        url.query_pairs_mut()
            .extend_pairs(params.iter().map(|(k, v)| (*k, v.as_str())))
            .append_pair("csrf_token", &self.csrf);
        let response = self
            .client
            .get(url)
            .header("Referer", "https://music.163.com/")
            .header("Cookie", &self.cookie)
            .send()
            .map_err(|_| "[network] 网易云请求超时或连接失败")?;
        self.response(response)
    }
    fn response(&self, response: reqwest::blocking::Response) -> Result<Value, String> {
        let status = response.status();
        if status.as_u16() == 429 {
            self.block("rate_limit");
            return Err("[rate_limit] 网易云请求过于频繁，请稍后手动重试".into());
        }
        if status.as_u16() == 401 {
            return Err("[authentication] 网易云登录已失效，请重新扫码".into());
        }
        if status.as_u16() == 403 {
            return Err("[permission] 网易云拒绝了此项访问".into());
        }
        if !status.is_success() {
            return Err("[unavailable] 网易云服务暂不可用".into());
        }
        let mut bytes = Vec::new();
        response
            .take(MAX_JSON + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "[network] 网易云数据传输中断")?;
        if bytes.len() as u64 > MAX_JSON {
            return Err("网易云返回的数据超过大小上限".into());
        }
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| "网易云返回了无法识别的数据")?;
        if value["code"] == -460 {
            self.block("risk");
        }
        if value["code"] == 429 {
            self.block("rate_limit");
        }
        check(&value)?;
        Ok(value)
    }
    fn wait_gate(&self) -> Result<(), String> {
        {
            let mut gate = self.gate.lock().unwrap();
            if let Some((until, kind)) = gate.blocked {
                if until > Instant::now() {
                    return Err(format!("[{kind}] 网易云请求已暂停，请稍后手动重试"));
                }
                gate.blocked = None;
            }
            if let Some(wait) = gate.next.checked_duration_since(Instant::now()) {
                std::thread::sleep(wait);
            }
            gate.next = Instant::now() + Duration::from_millis(500);
        }
        Ok(())
    }
    fn block(&self, kind: &'static str) {
        // This is a local request budget, not a claim about the service's cooldown.
        self.gate.lock().unwrap().blocked = Some((Instant::now() + Duration::from_secs(60), kind));
    }
    fn playlist_index(&self) -> Result<Index, String> {
        let mut cached = self.index.lock().unwrap();
        if cached
            .as_ref()
            .is_none_or(|index| index.at.elapsed() > Duration::from_secs(60))
        {
            let uid = self.uid.load(Ordering::Acquire);
            if uid == 0 {
                return Err("[authentication] 请先完成网易云账号验证".into());
            }
            let mut created = Vec::new();
            let mut collected = Vec::new();
            let mut liked = None;
            let mut offset = 0;
            let mut seen = HashSet::new();
            loop {
                let data = self.get(
                    "/api/user/playlist",
                    &[
                        ("uid", uid.to_string()),
                        ("offset", offset.to_string()),
                        ("limit", "100".into()),
                        ("includeVideo", "false".into()),
                    ],
                )?;
                let rows = data["playlist"].as_array().ok_or("网易云未返回歌单列表")?;
                for row in rows {
                    let Some(pid) = id(&row["id"]) else {
                        continue;
                    };
                    if !seen.insert(pid) {
                        continue;
                    }
                    let Some(owner) = id(&row["creator"]["userId"]) else {
                        continue;
                    };
                    let heart = owner == uid && row["specialType"].as_u64() == Some(5);
                    if heart {
                        liked = Some(pid);
                    }
                    let playlist = Playlist {
                        id: if heart {
                            "liked".into()
                        } else {
                            pid.to_string()
                        },
                        name: row["name"].as_str().unwrap_or("未命名歌单").into(),
                        cover: row["coverImgUrl"]
                            .as_str()
                            .and_then(asset_url)
                            .map(String::from),
                        count: row["trackCount"].as_u64().unwrap_or(0) as usize,
                    };
                    if owner == uid {
                        created.push(playlist);
                    } else {
                        collected.push(playlist);
                    }
                }
                let more = data["more"].as_bool().ok_or("网易云歌单分页信息不可用")?;
                if !more {
                    break;
                }
                if rows.is_empty() || offset + rows.len() > 100_000 {
                    return Err("网易云歌单列表尚未完整加载，请稍后重试".into());
                }
                offset += rows.len();
            }
            *cached = Some(Index {
                at: Instant::now(),
                created,
                collected,
                liked,
            });
        }
        let index = cached.as_ref().unwrap();
        Ok(Index {
            at: index.at,
            created: index.created.clone(),
            collected: index.collected.clone(),
            liked: index.liked,
        })
    }
    fn list(&self, playlist: &str, offset: usize) -> Result<TrackList, String> {
        if let Some(list) = self
            .lists
            .lock()
            .unwrap()
            .get(playlist)
            .filter(|list| offset > 0 || list.at.elapsed() < Duration::from_secs(30))
            .cloned()
        {
            return Ok(list);
        }
        let pid = if playlist == "liked" {
            match self.playlist_index()?.liked {
                Some(id) => id,
                None => {
                    return Ok(TrackList {
                        at: Instant::now(),
                        ids: vec![],
                        version: None,
                    })
                }
            }
        } else {
            playlist
                .parse::<u64>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or("歌单标识无效")?
        };
        let data = self.get(
            "/api/v6/playlist/detail",
            &[
                ("id", pid.to_string()),
                ("n", "0".into()),
                ("s", "0".into()),
            ],
        )?;
        let list = track_list(&data["playlist"])?;
        let mut lists = self.lists.lock().unwrap();
        if lists.len() >= 64 {
            lists.clear();
        }
        lists.insert(playlist.into(), list.clone());
        Ok(list)
    }
    fn download(
        &self,
        source: Source,
        track: &Track,
        fallback: Option<String>,
        request: &AudioRequest,
    ) -> Result<Audio, String> {
        request.check()?;
        (request.buffering)();
        let client = client(false)?;
        let cache_epoch = self.cache.as_ref().map_or(0, |c| c.audio_epoch());
        let prepared = if request.prefetch {
            None
        } else {
            self.prepared.lock().unwrap().take().filter(|p| {
                p.track == track.id && p.level == source.level && p.format == source.format
            })
        };
        let decode = |bytes| {
            quality::audio(
                bytes,
                &source.level,
                &source.format,
                source.bitrate,
                fallback.clone(),
            )
        };
        if let Some(p) = prepared.as_ref().filter(|p| p.bytes.len() == p.total) {
            return decode(p.bytes.clone());
        }
        let mut get = client
            .get(source.url.clone())
            .header("Referer", "https://music.163.com/");
        if request.prefetch {
            get = get.header("Range", "bytes=0-4194303");
        } else if let Some(p) = &prepared {
            get = get.header("Range", format!("bytes={}-", p.bytes.len()));
        }
        let mut response = get.send().map_err(|_| "[network] 网易云音频连接失败")?;
        if !response.status().is_success() {
            return Err("[unavailable] 网易云音频授权或资源已不可用".into());
        }
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
            while bytes.len() < total.min(PREFETCH) {
                request.check()?;
                let limit = chunk.len().min(total.min(PREFETCH) - bytes.len());
                let n = response
                    .read(&mut chunk[..limit])
                    .map_err(|_| "[network] 预加载传输中断")?;
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&chunk[..n]);
            }
            request.check()?;
            let mut audio = decode(bytes)?;
            let mut prepared = self.prepared.lock().unwrap();
            request.check()?;
            *prepared = Some(Prepared {
                track: track.id.clone(),
                level: source.level,
                format: source.format,
                total,
                bytes: std::mem::take(&mut audio.bytes),
            });
            return Ok(audio);
        }
        let prefix = if let Some(p) = prepared {
            if response.status() == reqwest::StatusCode::PARTIAL_CONTENT
                && response
                    .headers()
                    .get("content-range")
                    .and_then(|v| v.to_str().ok())
                    == Some(format!("bytes {}-{}/{}", p.bytes.len(), p.total - 1, p.total).as_str())
            {
                Some(p)
            } else {
                response = client
                    .get(source.url.clone())
                    .header("Referer", "https://music.163.com/")
                    .send()
                    .map_err(|_| "[network] 网易云音频连接失败")?
                    .error_for_status()
                    .map_err(|_| "网易云音频授权或资源不可用")?;
                None
            }
        } else {
            None
        };
        let total = prefix
            .as_ref()
            .map(|p| p.total as u64)
            .or_else(|| response.content_length());
        if total.is_some_and(|n| n == 0 || n > MAX_AUDIO_BYTES as u64) {
            return Err("音频资源超过单曲大小上限或为空".into());
        }
        let mut bytes = prefix.map(|p| p.bytes).unwrap_or_default();
        if let Some(total) = total.map(|n| n as usize) {
            (&mut response)
                .take(total.min(16 * 1024).saturating_sub(bytes.len()) as u64)
                .read_to_end(&mut bytes)
                .map_err(|_| "[network] 音频首段传输中断")?;
            request.check()?;
            let mut audio = decode(bytes)?;
            let url = source.url;
            let cache = self.cache.clone();
            let track = track.clone();
            let scope = self.scope();
            let variant = source.level;
            let cancelled = request.cancelled.clone();
            audio.stream = Some(super::stream::Stream::start(
                std::mem::take(&mut audio.bytes),
                total,
                audio.mime,
                response,
                Box::new(move |start, end| {
                    let mut response = client
                        .get(url.clone())
                        .header("Referer", "https://music.163.com/")
                        .header("Range", format!("bytes={start}-{end}"))
                        .send()
                        .map_err(|_| "[network] 网易云音频分段请求失败")?;
                    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT
                        || response
                            .headers()
                            .get("content-range")
                            .and_then(|v| v.to_str().ok())
                            != Some(format!("bytes {start}-{end}/{total}").as_str())
                    {
                        return Err("网易云音频服务器未返回匹配的分段".into());
                    }
                    let mut bytes = Vec::new();
                    (&mut response)
                        .take((end - start + 2) as u64)
                        .read_to_end(&mut bytes)
                        .map_err(|_| "[network] 网易云音频分段传输中断")?;
                    if bytes.len() != end - start + 1 {
                        return Err("网易云音频分段不完整".into());
                    }
                    Ok(bytes)
                }),
                Box::new(move |bytes| {
                    if !cancelled.load(Ordering::Acquire) {
                        if let Some(cache) = cache {
                            cache.measure_audio(
                                &track,
                                &scope,
                                &variant,
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
        let mut chunk = [0u8; 64 * 1024];
        loop {
            request.check()?;
            let n = response
                .read(&mut chunk)
                .map_err(|_| "[network] 网易云音频传输中断")?;
            if n == 0 {
                break;
            }
            if bytes.len() + n > MAX_AUDIO_BYTES {
                return Err("音频资源超过单曲大小上限".into());
            }
            bytes.extend_from_slice(&chunk[..n]);
        }
        request.check()?;
        let audio = decode(bytes)?;
        if let Some(cache) = self.cache.as_ref().filter(|c| c.analysis_enabled()) {
            cache.measure_audio(
                track,
                &self.scope(),
                &source.level,
                Arc::new(audio.bytes.clone()),
                cache_epoch,
                request.cancelled.clone(),
            );
        }
        Ok(audio)
    }
}

fn track_list(value: &Value) -> Result<TrackList, String> {
    let rows = value["trackIds"]
        .as_array()
        .ok_or("网易云未返回完整歌单索引")?;
    let total = value["trackCount"].as_u64().ok_or("网易云歌单总数不可用")? as usize;
    if total != rows.len() || total > 100_000 {
        return Err("网易云歌单索引尚未完整返回，请刷新后重试".into());
    }
    Ok(TrackList {
        at: Instant::now(),
        ids: rows.iter().map(|v| id(&v["id"])).collect(),
        version: value["trackUpdateTime"].as_u64(),
    })
}
pub fn track(value: &Value) -> Option<Track> {
    let numeric_id = id(&value["id"])?;
    let name = value["name"].as_str().filter(|s| !s.is_empty())?;
    let additional = value["additionalTitle"].as_str().filter(|s| !s.is_empty());
    let title = match additional {
        Some(extra) if !name.contains(extra) => format!("{name} ({extra})"),
        _ => name.to_owned(),
    };
    let album = value
        .get("al")
        .or(value.get("album"))
        .unwrap_or(&Value::Null);
    let artists = value.get("ar").or(value.get("artists"));
    Some(Track {
        id: numeric_id.to_string(),
        provider: "netease".into(),
        title,
        artist: artists
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|row| row["name"].as_str())
                    .collect::<Vec<_>>()
                    .join(" / ")
            })
            .unwrap_or_default(),
        album: album["name"].as_str().unwrap_or_default().into(),
        cover: album["picUrl"]
            .as_str()
            .and_then(asset_url)
            .map(String::from),
        duration: value["dt"]
            .as_f64()
            .or_else(|| value["duration"].as_f64())
            .unwrap_or(0.0)
            .max(0.0)
            / 1000.0,
        paid: matches!(value["fee"].as_u64(), Some(1 | 4 | 8)),
        numeric_id,
        media_id: String::new(),
        audio_sizes: quality::sizes(value),
    })
}
fn fill_search_covers(items: &mut [Track], rows: &[Value]) {
    let covers: HashMap<_, _> = rows
        .iter()
        .filter_map(track)
        .filter_map(|t| t.cover.map(|cover| (t.numeric_id, cover)))
        .collect();
    for item in items.iter_mut().filter(|t| t.cover.is_none()) {
        item.cover = covers.get(&item.numeric_id).cloned();
    }
}

fn track_page(ids: &[Option<u64>], rows: &[Value], offset: usize, limit: usize) -> Page<Track> {
    let songs: HashMap<_, _> = rows
        .iter()
        .filter_map(track)
        .map(|t| (t.numeric_id, t))
        .collect();
    let span = ids.len().saturating_sub(offset).min(limit);
    let items: Vec<_> = ids
        .iter()
        .skip(offset)
        .take(span)
        .filter_map(|id| songs.get(&(*id)?).cloned())
        .collect();
    Page {
        total: ids.len(),
        next_offset: (offset + span < ids.len()).then_some(offset + span),
        filtered: span - items.len(),
        items,
    }
}
fn membership(data: &Value, now: u64) -> Option<Membership> {
    let candidates = [
        ("redplus", "SVIP"),
        ("associator", "黑胶 VIP"),
        ("musicPackage", "音乐包"),
    ];
    let mut known = false;
    for (key, name) in candidates {
        // The client endpoint returns expireTime; the front endpoint and older
        // payloads use endTime. A growth level alone does not prove entitlement.
        let Some(end) = data[key]["expireTime"]
            .as_u64()
            .or_else(|| data[key]["endTime"].as_u64())
        else {
            continue;
        };
        known = true;
        if end > now {
            return Some(Membership {
                active: true,
                name: name.into(),
                level: data["redVipLevel"].as_u64().unwrap_or(0),
                expires: Some(super::china_timestamp_at(end)),
            });
        }
    }
    known.then(|| Membership {
        active: false,
        name: "普通用户".into(),
        level: 0,
        expires: None,
    })
}
fn source(value: &Value, track: &Track, minimum: usize) -> Result<Option<Source>, String> {
    let row = value["data"]
        .as_array()
        .and_then(|rows| rows.iter().find(|v| id(&v["id"]) == Some(track.numeric_id)))
        .ok_or("网易云未返回此歌曲的播放授权")?;
    if row["code"] == -460 {
        return Err("[risk] 网易云暂时限制了播放请求，请稍后手动重试".into());
    }
    if row["code"] == 429 {
        return Err("[rate_limit] 网易云播放请求过于频繁，请稍后手动重试".into());
    }
    if row["code"] == 301 || row["code"] == 401 {
        return Err("[authentication] 网易云登录已失效，请重新扫码".into());
    }
    if row["code"] != 200 {
        return Ok(None);
    }
    if !row["freeTrialInfo"].is_null()
        && row["freeTrialInfo"] != "null"
        && row["freeTrialInfo"] != false
    {
        return Ok(None);
    }
    let Some(url) = row["url"].as_str().filter(|s| !s.is_empty()) else {
        return Ok(None);
    };
    let url = asset_url(url).ok_or("网易云返回了未知的音频服务器")?;
    let level = row["level"]
        .as_str()
        .ok_or("[decode] 网易云音质信息不可用")?;
    if quality::rank(level).is_none_or(|rank| rank < minimum) {
        return Err("[decode] 网易云未返回匹配的授权音质".into());
    }
    let format = row["type"]
        .as_str()
        .filter(|s| matches!(*s, "mp3" | "flac"))
        .ok_or("[decode] 网易云返回了不支持的音频格式")?;
    if row["size"]
        .as_u64()
        .is_some_and(|size| size == 0 || size > MAX_AUDIO_BYTES as u64)
    {
        return Err("音频资源大小无效或超过单曲上限".into());
    }
    Ok(Some(Source {
        url,
        level: level.into(),
        format: format.into(),
        bitrate: row["br"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= u32::MAX as u64)
            .map(|n| n as u32),
    }))
}

impl Provider for Netease {
    fn id(&self) -> &'static str {
        "netease"
    }
    fn name(&self) -> &'static str {
        "网易云音乐"
    }
    fn scope(&self) -> String {
        super::cache::scope(&format!("netease:{}", self.uid.load(Ordering::Acquire)))
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
    fn discard_prefetch(&self) {
        self.prepared.lock().unwrap().take();
    }
    fn account(&self) -> Result<Account, String> {
        let value = self.get("/api/nuser/account/get", &[])?;
        let profile = &value["profile"];
        let uid = id(&profile["userId"])
            .ok_or("[authentication] 网易云账号校验未通过，请完成官方登录")?;
        let old = self.uid.load(Ordering::Acquire);
        if old != 0 && old != uid {
            return Err("[authentication] 网易云账号已变化，请重新登录".into());
        }
        let nickname = profile["nickname"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or("网易云账号资料暂不可用")?
            .to_string();
        self.uid.store(uid, Ordering::Release);
        let (membership, membership_issue) = match self.get(
            "/api/music-vip-membership/client/vip/info",
            &[("userId", uid.to_string())],
        ) {
            Ok(value) => match membership(&value["data"], super::now()) {
                Some(member) => (Some(member), None),
                None => (
                    None,
                    Some("暂未取得完整会员信息，播放权限由服务端确认".into()),
                ),
            },
            Err(_) => (None, Some("会员信息暂不可用，播放权限由服务端确认".into())),
        };
        Ok(Account {
            provider: "netease".into(),
            nickname,
            avatar: profile["avatarUrl"]
                .as_str()
                .and_then(asset_url)
                .map(String::from),
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
        let index = self.playlist_index()?;
        let rows = match collection {
            "created" => index.created,
            "collected" => index.collected,
            _ => return Err("未知歌单分类".into()),
        };
        let total = rows.len();
        let items = rows.into_iter().skip(offset).take(limit).collect();
        Ok(Page {
            items,
            total,
            next_offset: (offset + limit < total).then_some(offset + limit),
            filtered: 0,
        })
    }
    fn tracks(&self, playlist: &str, offset: usize, limit: usize) -> Result<Page<Track>, String> {
        let list = self.list(playlist, offset)?;
        let ids: Vec<_> = list
            .ids
            .iter()
            .skip(offset)
            .take(limit)
            .flatten()
            .map(|id| json!({"id":id}))
            .collect();
        let rows = if ids.is_empty() {
            vec![]
        } else {
            self.get(
                "/api/v3/song/detail",
                &[("c", Value::Array(ids).to_string())],
            )?["songs"]
                .as_array()
                .ok_or("网易云未返回歌曲详情")?
                .clone()
        };
        if offset > 0 && offset + limit >= list.ids.len() {
            self.lists.lock().unwrap().remove(playlist);
            let current = self.list(playlist, 0)?;
            if current.ids != list.ids || current.version != list.version {
                return Err("歌单已更新，请刷新后重新加载".into());
            }
        }
        Ok(track_page(&list.ids, &rows, offset, limit))
    }
    fn search(&self, query: &str, offset: usize, limit: usize) -> Result<Page<Track>, String> {
        let data = self.get(
            "/api/search/get",
            &[
                ("s", query.into()),
                ("type", "1".into()),
                ("offset", offset.to_string()),
                ("limit", limit.to_string()),
            ],
        )?;
        let total = data["result"]["songCount"]
            .as_u64()
            .ok_or("网易云搜索总数不可用")? as usize;
        let rows = match data["result"]["songs"].as_array() {
            Some(rows) => rows.as_slice(),
            None if total == 0 => &[],
            None => return Err("网易云搜索结果暂不可用".into()),
        };
        let mut items: Vec<_> = rows.iter().filter_map(track).collect();
        // Search returns album.picId but omits picUrl. Resolve missing artwork
        // in one detail request, keeping search ranking and version metadata.
        let missing: Vec<_> = items
            .iter()
            .filter(|t| t.cover.is_none())
            .map(|t| json!({"id": t.numeric_id}))
            .collect();
        if !missing.is_empty() {
            // Artwork is optional: a failed detail request must not discard
            // otherwise usable search results.
            if let Ok(details) = self.get(
                "/api/v3/song/detail",
                &[("c", Value::Array(missing).to_string())],
            ) {
                if let Some(songs) = details["songs"].as_array() {
                    fill_search_covers(&mut items, songs);
                }
            }
        }
        let next = offset + rows.len();
        if rows.is_empty() && offset < total {
            return Err("网易云搜索分页尚未完整返回".into());
        }
        Ok(Page {
            filtered: rows.len() - items.len(),
            items,
            total,
            next_offset: (next < total && data["result"]["hasMore"] != false).then_some(next),
        })
    }
    fn audio(
        &self,
        track: &Track,
        below: Option<&str>,
        request: AudioRequest,
    ) -> Result<Audio, String> {
        request.check()?;
        if track.provider != "netease"
            || id(&Value::String(track.id.clone())) != Some(track.numeric_id)
        {
            return Err("歌曲平台或标识无效".into());
        }
        let levels = quality::candidates(track, below);
        let result = select_audio(
            &levels,
            below,
            &request,
            |level| {
                let data = self.get(
                    "/api/song/enhance/player/url/v1",
                    &[
                        ("ids", json!([track.numeric_id]).to_string()),
                        ("level", level.into()),
                        ("encodeType", quality::encode_type(level).into()),
                    ],
                )?;
                source(&data, track, quality::rank(level).unwrap())
            },
            |source, fallback| self.download(source, track, fallback, &request),
        );
        if let Err(error) = &result {
            let kind = super::diagnostics::Failure::classify(error).kind;
            if matches!(kind, "risk" | "rate_limit") {
                self.block(kind);
            }
        }
        result
    }
    fn lyrics(&self, track: &Track) -> Result<String, String> {
        if track.provider != "netease" {
            return Err("歌曲平台无效".into());
        }
        let data = self.get(
            "/api/song/lyric/v1",
            &[
                ("id", track.numeric_id.to_string()),
                ("cp", "false".into()),
                ("lv", "0".into()),
                ("kv", "0".into()),
                ("tv", "0".into()),
                ("rv", "0".into()),
                ("yv", "0".into()),
                ("ytv", "0".into()),
                ("yrv", "0".into()),
            ],
        )?;
        // Only the primary lyric tracks enter the shared parser/cache.
        Ok(json!({"yrc":{"lyric":data["yrc"]["lyric"].as_str().unwrap_or_default()},"lrc":{"lyric":data["lrc"]["lyric"].as_str().unwrap_or_default()}}).to_string())
    }
    fn artwork(&self, url: &str) -> Option<String> {
        let mut url = asset_url(url)?;
        // Original album artwork can exceed the bounded image loader. Ask the
        // official CDN for the same thumbnail size used by the other providers.
        url.set_query(Some("param=300y300"));
        let response = client(false)
            .ok()?
            .get(url)
            .send()
            .ok()?
            .error_for_status()
            .ok()?;
        let mut bytes = Vec::new();
        response.take(512 * 1024 + 1).read_to_end(&mut bytes).ok()?;
        if bytes.len() > 512 * 1024 {
            return None;
        }
        let mime = if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
            "image/jpeg"
        } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
            "image/webp"
        } else {
            return None;
        };
        Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quality_request() -> AudioRequest {
        AudioRequest {
            prefetch: false,
            cancelled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            buffering: Box::new(|| {}),
        }
    }
    fn quality_source(level: &str) -> Source {
        Source {
            url: "https://m701.music.126.net/fixture".parse().unwrap(),
            level: level.into(),
            format: "mp3".into(),
            bitrate: Some(128000),
        }
    }
    fn fixture_audio(source: Source, fallback: Option<String>) -> Result<Audio, String> {
        quality::audio(
            b"ID3fixture".to_vec(),
            &source.level,
            &source.format,
            source.bitrate,
            fallback,
        )
    }
    #[test]
    fn lower_initial_grant_does_not_mask_intermediate_authorized_modes() {
        let levels: Vec<_> = quality::LEVELS.iter().map(|entry| entry.0).collect();
        let mut requested = vec![];
        let result = select_audio(
            &levels,
            None,
            &quality_request(),
            |level| {
                requested.push(level.to_string());
                Ok(match level {
                    "vivid" => Some(quality_source("standard")),
                    "jymaster" => Some(quality_source("lossless")),
                    "jyeffect" => Some(quality_source("jyeffect")),
                    _ => None,
                })
            },
            fixture_audio,
        )
        .unwrap();
        assert_eq!(requested, ["vivid", "dolby", "jymaster", "sky", "jyeffect"]);
        assert_eq!(result.quality.label, "高清臻音");
        assert!(result.quality.fallback.is_none());
    }
    #[test]
    fn ordinary_authorization_selection_is_not_labeled_as_playback_downgrade() {
        let levels: Vec<_> = quality::LEVELS.iter().map(|entry| entry.0).collect();
        let mut requested = vec![];
        let result = select_audio(
            &levels,
            None,
            &quality_request(),
            |level| {
                requested.push(level.to_string());
                Ok((level == "vivid").then(|| quality_source("lossless")))
            },
            fixture_audio,
        )
        .unwrap();
        assert_eq!(requested.last().unwrap(), "hires");
        assert_eq!(result.quality.id, "lossless");
        assert!(result.quality.fallback.is_none());
    }
    #[test]
    fn failed_resource_falls_back_once_and_stops_on_account_or_network_errors() {
        let levels = ["vivid", "lossless", "standard"];
        let mut downloaded = vec![];
        let result = select_audio(
            &levels,
            None,
            &quality_request(),
            |level| Ok(Some(quality_source(level))),
            |source, fallback| {
                downloaded.push(source.level.clone());
                if source.level == "vivid" {
                    return Err("[decode] 当前音频不可解码".into());
                }
                fixture_audio(source, fallback)
            },
        )
        .unwrap();
        assert_eq!(downloaded, ["vivid", "lossless"]);
        assert!(result
            .quality
            .fallback
            .as_deref()
            .unwrap()
            .contains("臻音全景声"));
        for message in [
            "[authentication] 登录已失效",
            "[risk] 请求暂停",
            "[rate_limit] 请求暂停",
            "[network] 连接失败",
        ] {
            let mut calls = 0;
            let result = select_audio(
                &levels,
                None,
                &quality_request(),
                |_| {
                    calls += 1;
                    Err(message.into())
                },
                fixture_audio,
            );
            assert_eq!(result.err().unwrap(), message);
            assert_eq!(calls, 1);
        }
    }
    fn session() -> Session {
        Session {
            cookies: vec![Cookie {
                name: "MUSIC_U".into(),
                value: "fixture-only".into(),
                domain: Some(".music.163.com".into()),
                path: Some("/".into()),
                secure: true,
                expires: None,
            }],
        }
    }
    #[test]
    fn cookie_scope_expiry_and_header_injection_are_rejected() {
        assert!(cookie_header(&session(), 0).is_ok());
        let mut s = session();
        s.cookies[0].domain = Some("music.163.com.evil.test".into());
        assert!(cookie_header(&s, 0).is_err());
        s = session();
        s.cookies[0].value = "x\r\nInjected: yes".into();
        assert!(cookie_header(&s, 0).is_err());
        s = session();
        s.cookies[0].expires = Some(1);
        assert!(cookie_header(&s, 2000).is_err());
    }
    #[test]
    fn authorized_assets_cannot_redirect_to_arbitrary_hosts_or_ports() {
        assert_eq!(
            asset_url("http://m701.music.126.net/fixture.mp3")
                .unwrap()
                .scheme(),
            "https"
        );
        for url in [
            "https://music.126.net.evil.test/a",
            "https://evil.music.126.net@127.0.0.1/a",
            "https://m701.music.126.net:9443/a",
            "http://127.0.0.1/a",
            "file:///a",
        ] {
            assert!(asset_url(url).is_none());
        }
    }
    #[test]
    fn pages_follow_original_track_ids_even_when_details_are_missing_or_reordered() {
        let ids = vec![Some(3), Some(2), None, Some(1)];
        let rows = vec![json!({"id":2,"name":"二"}), json!({"id":3,"name":"三"})];
        let page = track_page(&ids, &rows, 0, 3);
        assert_eq!(
            page.items.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(),
            vec!["3", "2"]
        );
        assert_eq!(
            (page.total, page.next_offset, page.filtered),
            (4, Some(3), 1)
        );
        assert!(track_list(&json!({"trackCount":4,"trackIds":[{"id":1}]})).is_err());
    }
    #[test]
    fn source_requires_same_identity_complete_authorization_and_terminating_quality() {
        let t = track(&json!({"id":7,"name":"原创测试","dt":180000})).unwrap();
        let mut data = json!({"data":[{"id":7,"code":200,"url":"https://m701.music.126.net/fixture.mp3","level":"standard","type":"mp3","freeTrialInfo":null}]});
        assert!(source(&data, &t, 0).unwrap().is_some());
        data["data"][0]["freeTrialInfo"] = json!({"start":0,"end":30});
        assert!(source(&data, &t, 0).unwrap().is_none());
        data["data"][0]["freeTrialInfo"] = Value::Null;
        data["data"][0]["code"] = json!(-460);
        assert_eq!(
            super::super::diagnostics::Failure::classify(&source(&data, &t, 0).err().unwrap()).kind,
            "risk"
        );
        data["data"][0]["code"] = json!(200);
        data["data"][0]["level"] = json!("hires");
        assert!(source(&data, &t, quality::rank("standard").unwrap()).is_err());
        data["data"][0]["id"] = json!(8);
        assert!(source(&data, &t, 0).is_err());
    }
    #[test]
    fn full_quality_authorizations_keep_the_returned_level_and_reject_unsupported_codecs() {
        let track = track(&json!({"id":7,"name":"测试","dt":180000})).unwrap();
        for level in quality::LEVELS.iter().map(|entry| entry.0) {
            let format = if level == "vivid" { "mp3" } else { "flac" };
            let data = json!({"data":[{"id":7,"code":200,"url":"https://m701.music.126.net/fixture","level":level,"type":format,"freeTrialInfo":null}]});
            let authorized = source(&data, &track, 0).unwrap().unwrap();
            assert_eq!(authorized.level, level);
            assert_eq!(authorized.format, format);
        }
        let data = json!({"data":[{"id":7,"code":200,"url":"https://m701.music.126.net/fixture","level":"lossless","type":"flac","freeTrialInfo":null}]});
        assert_eq!(
            source(&data, &track, quality::rank("vivid").unwrap())
                .unwrap()
                .unwrap()
                .level,
            "lossless"
        );
        assert!(source(&data, &track, quality::rank("standard").unwrap()).is_err());
        let unsupported = json!({"data":[{"id":7,"code":200,"url":"https://m701.music.126.net/fixture","level":"dolby","type":"eac3","freeTrialInfo":null}]});
        assert_eq!(
            super::super::diagnostics::Failure::classify(
                &source(&unsupported, &track, 0).err().unwrap()
            )
            .kind,
            "decode"
        );
    }
    #[test]
    fn membership_expiry_does_not_confuse_growth_with_entitlement() {
        assert!(membership(&json!({"redVipLevel":9}), 1000).is_none());
        assert!(
            !membership(&json!({"associator":{"endTime":999},"redVipLevel":9}), 1000)
                .unwrap()
                .active
        );
        assert_eq!(
            membership(&json!({"redplus":{"endTime":2000}}), 1000)
                .unwrap()
                .name,
            "SVIP"
        );
    }
    #[test]
    fn client_membership_expire_time_preserves_active_and_expired_states() {
        let now = 1_800_000_000_000;
        let data = json!({
            "associator": {"expireTime": now + 86_400_000, "vipLevel": 1},
            "musicPackage": {"expireTime": 0},
            "redVipLevel": 5
        });
        let member = membership(&data, now).unwrap();
        assert!(member.active);
        assert_eq!(member.name, "黑胶 VIP");
        assert!(member.expires.is_some());
        assert!(!membership(&data, now + 86_400_000).unwrap().active);
        assert!(membership(
            &json!({"associator": {"vipLevel": 1}, "redVipLevel": 5}),
            now
        )
        .is_none());
        assert!(
            !membership(
                &json!({"associator": {"expireTime": 0, "endTime": now + 86_400_000}}),
                now
            )
            .unwrap()
            .active
        );
    }
    #[test]
    fn search_and_detail_track_shapes_keep_platform_identity_and_version() {
        let t=track(&json!({"id":5,"name":"歌名","additionalTitle":"Live","artists":[{"name":"甲"},{"name":"乙"}],"album":{"name":"现场"},"duration":180000})).unwrap();
        assert_eq!(
            (
                t.provider.as_str(),
                t.id.as_str(),
                t.artist.as_str(),
                t.title.as_str(),
                t.duration
            ),
            ("netease", "5", "甲 / 乙", "歌名 (Live)", 180.0)
        );
    }

    #[test]
    fn search_covers_match_ids_without_reordering_or_replacing_search_metadata() {
        let mut items = vec![
            track(&json!({"id":5,"name":"歌曲","additionalTitle":"Live","duration":180000})).unwrap(),
            track(&json!({"id":9,"name":"已有封面","al":{"picUrl":"https://p1.music.126.net/existing.jpg"}})).unwrap(),
            track(&json!({"id":7,"name":"无详情"})).unwrap(),
            track(&json!({"id":8,"name":"无效封面"})).unwrap(),
        ];
        fill_search_covers(
            &mut items,
            &[
                json!({"id":9,"name":"详情","al":{"picUrl":"https://p2.music.126.net/other.jpg"}}),
                json!({"id":8,"name":"详情","al":{"picUrl":"https://example.com/cover.jpg"}}),
                json!({"id":5,"name":"详情不同版本","dt":120000,"al":{"picUrl":"http://p2.music.126.net/live.jpg"}}),
            ],
        );
        assert_eq!(
            items.iter().map(|t| t.numeric_id).collect::<Vec<_>>(),
            vec![5, 9, 7, 8]
        );
        assert_eq!(
            items[0].cover.as_deref(),
            Some("https://p2.music.126.net/live.jpg")
        );
        assert_eq!(items[0].title, "歌曲 (Live)");
        assert_eq!(items[0].duration, 180.0);
        assert_eq!(
            items[1].cover.as_deref(),
            Some("https://p1.music.126.net/existing.jpg")
        );
        assert!(items[2].cover.is_none());
        assert!(items[3].cover.is_none());
        fill_search_covers(&mut items, &[]);
        assert!(items[0].cover.is_some());
    }
}
