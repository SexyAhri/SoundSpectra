use crate::{now_playing::NowPlaying, AppState};
use regex::Regex;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};
use tauri::{State, WebviewWindow};
pub mod discovery;
mod locations;
mod lookup;
mod netease;
mod online;
mod platform;
mod soda;
mod storage;
mod ttml;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start: u64,
    pub end: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub text: String,
    pub start: u64,
    pub end: u64,
    pub words: Vec<Word>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricDocument {
    pub key: String,
    pub status: String,
    pub message: String,
    pub file: Option<String>,
    pub lines: Vec<Line>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue: Option<String>,
}
#[derive(Default)]
pub struct LyricCache {
    key: String,
    read_at: Option<Instant>,
    document: LyricDocument,
    generation: u64,
    sequence: u64,
    flight: Option<SearchFlight>,
}
struct SearchFlight {
    key: String,
    generation: u64,
    id: u64,
    cancel: Arc<lookup::Cancellation>,
    result: tokio::sync::watch::Receiver<Option<LyricDocument>>,
}

impl LyricCache {
    fn reusable(&self, key: &str, generation: u64, refresh: bool) -> bool {
        !refresh
            && self.key == key
            && self.generation == generation
            && self
                .read_at
                .is_some_and(|t| t.elapsed() < Duration::from_secs(30))
    }
}

// Keep the presentation key stable, but revalidate changes to the recording,
// selected player, duration and user directory independently of that key.
fn lookup_key(info: &NowPlaying, folder: &str) -> String {
    format!(
        "{}\u{1f}{:.3}\u{1f}{}\u{1f}{:?}\u{1f}{}\u{1f}{}\u{1f}{folder}",
        track_key(info),
        info.duration,
        info.source,
        info.process_id,
        info.session_id,
        info.track_id
    )
}

pub fn cancel_search(state: &AppState) {
    if let Ok(cache) = state.lyric_cache.lock() {
        if let Some(flight) = &cache.flight {
            flight.cancel.cancel();
        }
    }
}

fn track_key(info: &NowPlaying) -> String {
    format!("{}\u{1f}{}\u{1f}{}", info.title, info.artist, info.album)
}
fn folded(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

// QMC1 static-key envelope, from qmc-decode (MIT, Copyright 2019 Jixun Wu).
// Its local QRC header occupies eleven bytes before the encrypted QRC payload.
const QMC_KEY: [u8; 128] = [
    0xc3, 0x4a, 0xd6, 0xca, 0x90, 0x67, 0xf7, 0x52, 0xd8, 0xa1, 0x66, 0x62, 0x9f, 0x5b, 0x09, 0x00,
    0xc3, 0x5e, 0x95, 0x23, 0x9f, 0x13, 0x11, 0x7e, 0xd8, 0x92, 0x3f, 0xbc, 0x90, 0xbb, 0x74, 0x0e,
    0xc3, 0x47, 0x74, 0x3d, 0x90, 0xaa, 0x3f, 0x51, 0xd8, 0xf4, 0x11, 0x84, 0x9f, 0xde, 0x95, 0x1d,
    0xc3, 0xc6, 0x09, 0xd5, 0x9f, 0xfa, 0x66, 0xf9, 0xd8, 0xf0, 0xf7, 0xa0, 0x90, 0xa1, 0xd6, 0xf3,
    0xc3, 0xf3, 0xd6, 0xa1, 0x90, 0xa0, 0xf7, 0xf0, 0xd8, 0xf9, 0x66, 0xfa, 0x9f, 0xd5, 0x09, 0xc6,
    0xc3, 0x1d, 0x95, 0xde, 0x9f, 0x84, 0x11, 0xf4, 0xd8, 0x51, 0x3f, 0xaa, 0x90, 0x3d, 0x74, 0x47,
    0xc3, 0x0e, 0x74, 0xbb, 0x90, 0xbc, 0x3f, 0x92, 0xd8, 0x7e, 0x11, 0x13, 0x9f, 0x23, 0x95, 0x5e,
    0xc3, 0x00, 0x09, 0x5b, 0x9f, 0x62, 0x66, 0xa1, 0xd8, 0x52, 0xf7, 0x67, 0x90, 0xca, 0xd6, 0x4a,
];

pub(crate) fn decode(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() || bytes.len() > 1_048_576 {
        return Err("歌词文件为空或超过 1 MB".into());
    }
    if bytes.starts_with(b"krc1") {
        return lyrics_crypto::decrypter::krc::decrypter::decrypt_lyrics_from_file(bytes)
            .ok_or_else(|| "KRC 歌词无法解码".into());
    }
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        let units: Vec<_> = bytes[2..]
            .chunks_exact(2)
            .map(|pair| {
                if little {
                    u16::from_le_bytes([pair[0], pair[1]])
                } else {
                    u16::from_be_bytes([pair[0], pair[1]])
                }
            })
            .collect();
        return String::from_utf16(&units).map_err(|_| "歌词文本编码无效".into());
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        let text = text.trim_start_matches('\u{feff}').trim_start();
        if text.starts_with('<') || text.starts_with('[') || text.starts_with('{') {
            return Ok(text.into());
        }
        if let Some(text) = lyrics_crypto::decrypter::qrc::decrypter::decrypt_lyrics(text) {
            return Ok(text);
        }
    }
    let mut decoded = bytes.to_vec();
    if bytes.starts_with(&[
        0x98, 0x25, 0xb0, 0xac, 0xe3, 0x02, 0x83, 0x68, 0xe8, 0xfc, 0x6c,
    ]) {
        for (i, byte) in decoded.iter_mut().enumerate() {
            let position = if i > 0x7fff { i % 0x7fff } else { i };
            *byte ^= QMC_KEY[position % QMC_KEY.len()];
        }
        decoded.drain(..11);
    }
    let encrypted: String = decoded.iter().map(|byte| format!("{byte:02x}")).collect();
    lyrics_crypto::decrypter::qrc::decrypter::decrypt_lyrics(&encrypted)
        .ok_or_else(|| "这个 QRC 缓存暂时无法解码".into())
}

fn json_lyric(value: &serde_json::Value) -> Option<String> {
    for key in [
        "yrc",
        "qrc",
        "krc",
        "lyric_content",
        "lyric",
        "lrc",
        "lyrics",
    ] {
        if let Some(item) = value.get(key) {
            if let Some(text) = item.as_str().filter(|s| !s.trim().is_empty()) {
                return Some(text.into());
            }
            if let Some(text) = item
                .get("lyric")
                .and_then(serde_json::Value::as_str)
                .filter(|s| !s.trim().is_empty())
            {
                return Some(text.into());
            }
        }
    }
    value.get("data").and_then(json_lyric)
}

fn credit_preamble(text: &str) -> bool {
    text.lines()
        .next()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .is_some_and(|v| {
            v.get("t").is_some_and(|v| v.is_number()) && v.get("c").is_some_and(|v| v.is_array())
        })
}

fn parse(text: &str) -> Result<Vec<Line>, String> {
    if text.len() > 2_097_152 {
        return Err("歌词正文过大".into());
    }
    if ttml::is_ttml(text) {
        return ttml::parse(text);
    }
    // NetEase can prefix a timed lyric with individual JSON credit records.
    // Those are not a JSON response envelope and must not hide the LRC/YRC.
    if text.trim_start().starts_with('{') && !credit_preamble(text) {
        let json: serde_json::Value = serde_json::from_str(text).map_err(|_| "歌词缓存格式无效")?;
        // An empty/broken word-timed field must not hide a valid line-timed
        // fallback in the same response.
        for key in [
            "yrc",
            "qrc",
            "krc",
            "lyric_content",
            "lyric",
            "lrc",
            "lyrics",
        ] {
            if let Some(value) = json.get(key) {
                let wrapper = serde_json::json!({ (key): value });
                if let Some(body) = json_lyric(&wrapper) {
                    if !body.trim_start().starts_with('{') || credit_preamble(&body) {
                        if let Ok(lines) = parse(&body) {
                            return Ok(lines);
                        }
                    }
                }
            }
        }
        if let Some(data) = json.get("data") {
            if data.is_object() {
                if let Ok(lines) = parse(&data.to_string()) {
                    return Ok(lines);
                }
            }
        }
        let lyric = json_lyric(&json).ok_or("缓存中没有歌词正文")?;
        if lyric.trim_start().starts_with('{') && !credit_preamble(&lyric) {
            return Err("歌词正文格式无效".into());
        }
        return parse(&lyric);
    }
    let body = if text.trim_start().starts_with('<') {
        // Preserve literal line breaks in QQ's attribute; ordinary XML attribute
        // normalization would flatten the entire timed lyric into a single line.
        static ATTRIBUTE: OnceLock<Regex> = OnceLock::new();
        let attribute = ATTRIBUTE
            .get_or_init(|| Regex::new(r#"(?s)LyricContent\s*=\s*"(.*?)"\s*/?>"#).unwrap());
        let captured = attribute.captures(text).ok_or("歌词正文缺失")?;
        // Local QRC files can also contain bare '&' and quotes in metadata;
        // decode recognized entities without rejecting otherwise usable lyrics.
        static ENTITY: OnceLock<Regex> = OnceLock::new();
        ENTITY
            .get_or_init(|| Regex::new(r"&(#x[0-9a-fA-F]+|#[0-9]+|amp|quot|apos|lt|gt);").unwrap())
            .replace_all(&captured[1], |m: &regex::Captures<'_>| match &m[1] {
                "amp" => "&".into(),
                "quot" => "\"".into(),
                "apos" => "'".into(),
                "lt" => "<".into(),
                "gt" => ">".into(),
                entity => {
                    let scalar = if let Some(hex) = entity.strip_prefix("#x") {
                        u32::from_str_radix(hex, 16).ok()
                    } else {
                        entity[1..].parse().ok()
                    };
                    scalar
                        .and_then(char::from_u32)
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| m[0].into())
                }
            })
            .into_owned()
    } else {
        text.to_string()
    };
    static LINE: OnceLock<Regex> = OnceLock::new();
    static WORD: OnceLock<Regex> = OnceLock::new();
    static LRC: OnceLock<Regex> = OnceLock::new();
    static PREFIX: OnceLock<Regex> = OnceLock::new();
    let line_pattern = LINE.get_or_init(|| Regex::new(r"^\[(\d+),(\d+)\](.*)$").unwrap());
    let word_pattern = WORD.get_or_init(|| Regex::new(r"\((\d+),(\d+)\)").unwrap());
    let lrc_pattern =
        LRC.get_or_init(|| Regex::new(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]").unwrap());
    let mut lines = Vec::new();
    for raw in body.lines().take(5000) {
        if let Some(m) = line_pattern.captures(raw.trim()) {
            let start: u64 = m[1].parse().unwrap_or(0);
            let end = start.saturating_add(m[2].parse().unwrap_or(0));
            if end > 86_400_000 {
                continue;
            }
            let mut words = Vec::new();
            let mut end_of_word = 0;
            let prefix = PREFIX.get_or_init(|| Regex::new(r"[<(](\d+),(\d+),\d+[>)]").unwrap());
            let spans: Vec<_> = prefix.captures_iter(&m[3]).collect();
            for (index, word) in spans.iter().enumerate() {
                let tag = word.get(0).unwrap();
                let word_start = word[1].parse::<u64>().unwrap_or(0).saturating_add(
                    if tag.as_str().starts_with('<') {
                        start
                    } else {
                        0
                    },
                );
                let word_end = word_start.saturating_add(word[2].parse().unwrap_or(0));
                if word_start < start || word_end > end.saturating_add(1000) {
                    continue;
                }
                let text = m[3][tag.end()
                    ..spans
                        .get(index + 1)
                        .map_or(m[3].len(), |next| next.get(0).unwrap().start())]
                    .to_string();
                words.push(Word {
                    text,
                    start: word_start,
                    end: word_end,
                });
            }
            if spans.is_empty() {
                for word in word_pattern.captures_iter(&m[3]).take(1000) {
                    let word_start: u64 = word[1].parse().unwrap_or(start);
                    let word_end = word_start.saturating_add(word[2].parse().unwrap_or(0));
                    if word_start < start || word_end > end.saturating_add(1000) {
                        continue;
                    }
                    words.push(Word {
                        text: m[3][end_of_word..word.get(0).unwrap().start()].to_string(),
                        start: word_start,
                        end: word_end,
                    });
                    end_of_word = word.get(0).unwrap().end();
                }
            } else {
                end_of_word = m[3].len();
            }
            let text = if words.is_empty() {
                m[3].to_string()
            } else {
                let trailing = &m[3][end_of_word..];
                if !trailing.is_empty() {
                    if let Some(last) = words.last_mut() {
                        last.text.push_str(trailing);
                    }
                }
                words.iter().map(|w| w.text.as_str()).collect::<String>()
            };
            if !text.trim().is_empty() {
                lines.push(Line {
                    text,
                    start,
                    end: end.max(start + 1),
                    words,
                });
            }
        } else {
            let stamps: Vec<_> = lrc_pattern.captures_iter(raw).collect();
            let Some(last) = stamps.last() else {
                continue;
            };
            let text = raw[last.get(0).unwrap().end()..].trim();
            if text.is_empty() {
                continue;
            }
            for stamp in stamps {
                let fraction = stamp.get(3).map_or(0, |v| {
                    v.as_str().parse::<u64>().unwrap_or(0) * 10u64.pow(3 - v.as_str().len() as u32)
                });
                let start = stamp[1].parse::<u64>().unwrap_or(0) * 60000
                    + stamp[2].parse::<u64>().unwrap_or(0) * 1000
                    + fraction;
                lines.push(Line {
                    text: text.into(),
                    start,
                    end: start + 8000,
                    words: Vec::new(),
                });
            }
        }
    }
    lines.sort_by_key(|line| line.start);
    for index in 0..lines.len().saturating_sub(1) {
        if lines[index].words.is_empty() {
            lines[index].end = lines[index]
                .end
                .min(lines[index + 1].start.max(lines[index].start + 1));
        }
    }
    if lines.is_empty() {
        return Err("缓存中没有可同步的歌词".into());
    }
    Ok(lines)
}

#[cfg(test)]
fn candidate_score(name: &str, info: &NowPlaying) -> Option<i32> {
    if !name.ends_with("_qm.qrc") && !name.ends_with(".lrc") {
        return None;
    }
    let fields: Vec<_> = name.split(" - ").collect();
    if fields.len() < 3 || folded(fields[1]) != folded(&info.title) {
        return None;
    }
    let artist = folded(&info.artist);
    if artist.is_empty() || folded(fields[0]) != artist {
        return None;
    }
    let duration = fields[2].parse::<f64>().ok();
    if info.duration > 0.0 && duration.is_some_and(|d| (d - info.duration).abs() > 4.0) {
        return None;
    }
    Some(
        100 + if !info.album.is_empty()
            && fields
                .get(3)
                .is_some_and(|a| folded(a.trim_end_matches("_qm.qrc")) == folded(&info.album))
        {
            10
        } else {
            0
        },
    )
}

#[cfg(test)]
pub(crate) fn load(entries: &[discovery::Entry], info: &NowPlaying) -> LyricDocument {
    load_cancellable(entries, info, None)
}
fn load_cancellable(
    entries: &[discovery::Entry],
    info: &NowPlaying,
    stop: Option<&lookup::LocalStop>,
) -> LyricDocument {
    let mut result = LyricDocument {
        key: track_key(info),
        status: "missing".into(),
        message: "暂未找到这个版本的歌词，将自动重试".into(),
        ..Default::default()
    };
    if info.title.is_empty() {
        result.status = "waiting".into();
        result.message = "等待播放器提供歌曲名称".into();
        return result;
    }
    let kugou_hash = info.track_id.rsplit_once(":kugou:").map(|(_, hash)| hash);
    let mut matches: Vec<(i32, PathBuf)> = Vec::new();
    for entry in entries {
        if stop.is_some_and(|s| s.is_stopped()) {
            return LyricDocument {
                key: track_key(info),
                status: "cancelled".into(),
                ..Default::default()
            };
        }
        if folded(&entry.title) != folded(&info.title)
            || info.artist.is_empty()
            || !online::same_artists(&entry.artist, &info.artist)
        {
            continue;
        }
        if info.duration > 0.0
            && entry
                .duration
                .is_some_and(|d| (d - info.duration).abs() > 4.0)
        {
            continue;
        }
        if !entry.path.is_file() {
            continue;
        }
        // A matching audio hash strengthens identity. A different embedded
        // lyric hash can belong to another audio quality of the same song;
        // retain normal metadata/version checks instead of rejecting it.
        let score =
            100 + if kugou_hash.is_some() && kugou_hash == entry.recording_id.as_deref() {
                1000
            } else {
                0
            } + if !info.album.is_empty() && folded(&entry.album) == folded(&info.album) {
                10
            } else {
                0
            };
        matches.push((score, entry.path.clone()));
    }
    matches.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    // Failed files do not participate in ambiguity checks or block a lower
    // ranked usable file. Different usable versions at the same rank still do.
    let mut index = 0;
    while index < matches.len() {
        let score = matches[index].0;
        let mut selected: Option<(&PathBuf, Vec<Line>, String)> = None;
        while index < matches.len() && matches[index].0 == score {
            if stop.is_some_and(|s| s.is_stopped()) {
                result.status = "cancelled".into();
                return result;
            }
            let path = &matches[index].1;
            index += 1;
            match read_file_cancellable(path, stop) {
                Ok(lines) => {
                    let signature = serde_json::to_string(&lines).unwrap_or_default();
                    if selected
                        .as_ref()
                        .is_some_and(|(_, _, text)| *text != signature)
                    {
                        result.status = "ambiguous".into();
                        result.message = "找到多个同名版本，无法确定准确歌词".into();
                        return result;
                    }
                    selected = Some((path, lines, signature));
                }
                Err(error) => {
                    result.status = "error".into();
                    result.message = format!("本地歌词读取失败：{error}");
                }
            }
        }
        if let Some((path, lines, _)) = selected {
            result.status = "ready".into();
            result.message = format!("本地歌词已匹配 · {} 行", lines.len());
            result.file = path.file_name().map(|n| n.to_string_lossy().into_owned());
            result.lines = lines;
            return result;
        }
    }
    result
}
#[cfg(test)]
fn read_file(path: &Path) -> Result<Vec<Line>, String> {
    read_file_cancellable(path, None)
}
fn read_file_cancellable(
    path: &Path,
    stop: Option<&lookup::LocalStop>,
) -> Result<Vec<Line>, String> {
    if stop.is_some_and(|s| s.is_stopped()) {
        return Err("歌词读取已取消".into());
    }
    if fs::metadata(path).map_err(|_| "歌词文件无法读取")?.len() > 1_048_576 {
        return Err("歌词文件超过 1 MB".into());
    }
    let bytes = fs::read(path).map_err(|_| "歌词文件读取失败")?;
    if stop.is_some_and(|s| s.is_stopped()) {
        return Err("歌词读取已取消".into());
    }
    let text = decode(&bytes)?;
    if stop.is_some_and(|s| s.is_stopped()) {
        return Err("歌词读取已取消".into());
    }
    parse(&text)
}

async fn race_sources(
    entries: Vec<discovery::Entry>,
    info: NowPlaying,
    cancel: Arc<lookup::Cancellation>,
    cache_directory: PathBuf,
    folder: String,
) -> Option<LyricDocument> {
    let player = current_player(&info);
    let scope = discovery::LocalScope::new(player, &folder);
    let entries = entries
        .into_iter()
        .filter(|entry| scope.accepts(&entry.path))
        .collect::<Vec<_>>();
    let local_stop = Arc::new(lookup::LocalStop::new(cancel.clone()));
    let _stop_local = lookup::StopLocalOnDrop(local_stop.clone());
    let local_info = info.clone();
    let local = async move {
        tauri::async_runtime::spawn_blocking(move || {
            let mut found = load_cancellable(&entries, &local_info, Some(&local_stop));
            if found.status == "ready" || local_stop.is_stopped() {
                return found;
            }
            if let Some(soda) = (player == Some("soda"))
                .then(|| soda::load(&local_info, Some(&local_stop)))
                .flatten()
            {
                if soda.status == "ready" || !matches!(found.status.as_str(), "error" | "ambiguous")
                {
                    return soda;
                }
                found.message.push_str("；");
                found.message.push_str(&soda.message);
            }
            found
        })
        .await
        .ok()
    };
    let remote = async {
        match online::fetch(&info, &cache_directory).await {
            Ok(Some((source, lines))) => Some(LyricDocument {
                key: track_key(&info),
                status: "ready".into(),
                message: format!("歌词已匹配 · {source}"),
                file: None,
                lines,
                ..Default::default()
            }),
            Err(error) => Some(LyricDocument {
                key: track_key(&info),
                status: "error".into(),
                message: error,
                ..Default::default()
            }),
            Ok(None) => None,
        }
    };
    let platform = async {
        if player == Some("netease") {
            netease::fetch(&info, &folder, &cache_directory).await
        } else {
            platform::fetch(player, &info, &cache_directory).await
        }
    };
    let remote = lookup::first_valid(remote, platform, cancel.clone());
    lookup::first_valid(local, remote, cancel).await
}

fn current_player(info: &NowPlaying) -> Option<&'static str> {
    let source = format!("{} {}", info.session_id, info.source).to_lowercase();
    [
        ("qqmusic", &["qqmusic", "qq 音乐", "qq音乐"][..]),
        ("netease", &["cloudmusic", "netease", "网易云"][..]),
        ("kugou", &["kugou", "酷狗"][..]),
        ("soda", &["sodamusic", "汽水"][..]),
    ]
    .into_iter()
    .find_map(|(id, names)| names.iter().any(|name| source.contains(name)).then_some(id))
}

#[tauri::command]
pub async fn get_current_lyrics(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    refresh: bool,
) -> Result<LyricDocument, String> {
    if !["settings", "overlay"].contains(&window.label()) {
        return Err("不支持的窗口".into());
    }
    let settings = state
        .settings
        .lock()
        .map_err(|e| e.to_string())?
        .lyrics
        .clone();
    if !settings.enabled {
        cancel_search(state.inner());
        return Ok(LyricDocument {
            status: "disabled".into(),
            ..Default::default()
        });
    }
    let info = state.now_playing.lock().map_err(|e| e.to_string())?.clone();
    let key = track_key(&info);
    let identity = lookup_key(&info, &settings.folder);
    if info.title.is_empty() {
        cancel_search(state.inner());
        return Ok(LyricDocument {
            key,
            status: "waiting".into(),
            message: "等待播放器提供歌曲名称".into(),
            ..Default::default()
        });
    }
    let state = Arc::clone(state.inner());
    let (entries, generation, issue) = {
        let library = state.lyric_library.lock().map_err(|e| e.to_string())?;
        (
            library.entries.clone(),
            library.generation,
            library.directory_issue.clone(),
        )
    };
    let mut receiver =
        {
            let mut cache = state.lyric_cache.lock().map_err(|e| e.to_string())?;
            if cache.reusable(&identity, generation, refresh) {
                let mut document = cache.document.clone();
                document.issue = issue;
                return Ok(document);
            }
            if let Some(flight) = cache.flight.as_ref().filter(|f| {
                f.key == identity && f.generation == generation && !f.cancel.is_cancelled()
            }) {
                flight.result.clone()
            } else {
                if let Some(previous) = &cache.flight {
                    previous.cancel.cancel();
                }
                cache.sequence = cache.sequence.wrapping_add(1);
                let id = cache.sequence;
                let cancel = Arc::new(lookup::Cancellation::default());
                let task_cancel = cancel.clone();
                let (sender, receiver) = tokio::sync::watch::channel(None);
                cache.flight = Some(SearchFlight {
                    key: identity.clone(),
                    generation,
                    id,
                    cancel,
                    result: receiver.clone(),
                });
                let task_state = state.clone();
                let task_key = key.clone();
                tauri::async_runtime::spawn(async move {
                    let found = race_sources(
                        entries,
                        info,
                        task_cancel.clone(),
                        task_state.path.with_file_name("lyric-cache"),
                        settings.folder,
                    )
                    .await;
                    let mut document = if task_cancel.is_cancelled() {
                        LyricDocument {
                            key: task_key.clone(),
                            status: "cancelled".into(),
                            ..Default::default()
                        }
                    } else {
                        found.unwrap_or_else(|| {
                            let library = task_state.lyric_library.lock().unwrap();
                            LyricDocument {
                                key: task_key.clone(),
                                status: if library.discovering {
                                    "scanning"
                                } else if library.scanning {
                                    "indexing"
                                } else {
                                    "missing"
                                }
                                .into(),
                                message: if library.discovering {
                                    "首次查找歌词目录，找到后会自动记忆"
                                } else if library.scanning {
                                    "正在读取已记忆的歌词目录"
                                } else {
                                    "暂未找到这个版本的歌词，将自动重试"
                                }
                                .into(),
                                ..Default::default()
                            }
                        })
                    };
                    document.issue = task_state
                        .lyric_library
                        .lock()
                        .unwrap()
                        .directory_issue
                        .clone();
                    if !task_cancel.is_cancelled() {
                        let mut cache = task_state.lyric_cache.lock().unwrap();
                        if cache.flight.as_ref().is_some_and(|f| f.id == id) {
                            cache.key = identity;
                            cache.document = document.clone();
                            cache.read_at = Some(Instant::now());
                            cache.generation = generation;
                            cache.flight = None;
                        }
                    }
                    let _ = sender.send(Some(document));
                });
                receiver
            }
        };
    loop {
        if let Some(document) = receiver.borrow_and_update().clone() {
            return Ok(document);
        }
        receiver
            .changed()
            .await
            .map_err(|_| "歌词查找已结束，请重试")?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ready_cache_revalidates_refresh_index_and_recording_changes() {
        let mut info = NowPlaying {
            title: "微光".into(),
            artist: "作者".into(),
            ..Default::default()
        };
        let key = lookup_key(&info, "");
        let mut cache = LyricCache {
            key: key.clone(),
            generation: 1,
            read_at: Some(Instant::now()),
            document: LyricDocument {
                status: "ready".into(),
                ..Default::default()
            },
            ..Default::default()
        };
        assert!(cache.reusable(&key, 1, false));
        assert!(!cache.reusable(&key, 1, true));
        assert!(!cache.reusable(&key, 2, false));
        info.duration = 200.0;
        assert!(!cache.reusable(&lookup_key(&info, ""), 1, false));
        info.duration = 0.0;
        info.source = "cloudmusic.exe".into();
        assert!(!cache.reusable(&lookup_key(&info, ""), 1, false));
        info.source.clear();
        info.track_id = "another-recording".into();
        assert!(!cache.reusable(&lookup_key(&info, ""), 1, false));
        assert!(!cache.reusable(&lookup_key(&info, "new-folder"), 1, false));
        cache.read_at = Some(Instant::now() - Duration::from_secs(31));
        assert!(!cache.reusable(&key, 1, false));
    }

    #[test]
    fn corrupt_candidates_do_not_hide_valid_files_but_valid_versions_stay_ambiguous() {
        let root = std::env::temp_dir().join(format!(
            "soundspectra-lyric-fallback-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let mut entries = Vec::new();
        for (name, album, text) in [("a.lrc", "星海", "bad"), ("b.lrc", "", "[00:01]微光")] {
            let path = root.join(name);
            fs::write(&path, text).unwrap();
            entries.push(discovery::Entry {
                recording_id: None,
                path,
                title: "微光".into(),
                artist: "甲 / 乙".into(),
                album: album.into(),
                duration: None,
            });
        }
        let info = NowPlaying {
            title: "微光".into(),
            artist: "乙、甲".into(),
            album: "星海".into(),
            ..Default::default()
        };
        assert_eq!(load(&entries, &info).status, "ready"); // Corrupt top-ranked file.
        entries[1].album = "星海".into();
        assert_eq!(load(&entries, &info).status, "ready"); // Corrupt tied file.
        fs::write(&entries[0].path, "[00:02]另一个版本").unwrap();
        assert_eq!(load(&entries, &info).status, "ambiguous");
        entries[0].recording_id = Some("00000000000000000000000000000000".into());
        entries[1].recording_id = Some("11111111111111111111111111111111".into());
        let exact = NowPlaying {
            track_id: "session:kugou:11111111111111111111111111111111".into(),
            ..info
        };
        let found = load(&entries, &exact);
        assert_eq!(found.status, "ready");
        assert_eq!(found.lines[0].text, "微光");
        let different_quality = NowPlaying {
            track_id: "session:kugou:22222222222222222222222222222222".into(),
            ..exact
        };
        assert_eq!(load(&entries, &different_quality).status, "ambiguous");
        assert_eq!(load(&entries[1..], &different_quality).status, "ready");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_word_timing_field_falls_back_to_valid_lrc() {
        let lines = parse(r#"{"yrc":{"lyric":"损坏"},"lrc":{"lyric":"[00:01]微光"}}"#).unwrap();
        assert_eq!(lines[0].start, 1000);
        assert_eq!(lines[0].text, "微光");
    }

    #[test]
    fn netease_credit_records_do_not_hide_timed_lyrics() {
        for lyric in [
            "{\"t\":0,\"c\":[{\"tx\":\"原创测试\"}]}\n[00:01.50]微光",
            "{\"t\":0,\"c\":[]}\n[1000,1000](1000,1000,0)微光",
        ] {
            assert_eq!(parse(lyric).unwrap().len(), 1);
            let response = serde_json::json!({"lrc":{"lyric":lyric}}).to_string();
            assert_eq!(parse(&response).unwrap().len(), 1);
        }
    }
    #[test]
    fn qrc_word_times_and_lrc_fallback() {
        let lines =
            parse("[1000,2000]微(1000,500)光(1500,1500)\n[5000,1000]向前(5000,1000)").unwrap();
        assert_eq!(lines[0].text, "微光");
        assert_eq!(lines[0].words[1].start, 1500);
        assert_eq!(lines[0].end, 3000);
        let lrc = parse("[00:01.50][00:05.050]原创测试文字\n[00:09]下一行").unwrap();
        assert_eq!(lrc.len(), 3);
        assert_eq!(lrc[0].start, 1500);
        assert_eq!(lrc[1].start, 5050);
        assert!(parse("没有时间标签").is_err());
        assert!(decode(&[0, 1, 2, 3]).is_err());
        let xml=parse("<QrcInfos><LyricInfo LyricContent=\"[0,500]A &amp; B(0,500)\n[500,500](和声)(500,500)\"/></QrcInfos>").unwrap();
        assert_eq!(xml.len(), 2);
        assert_eq!(xml[0].text, "A & B");
        assert_eq!(xml[1].text, "(和声)");
        assert_eq!(
            parse("<Lyric LyricContent=\"[0,500]A & B(0,500)\"/>").unwrap()[0].text,
            "A & B"
        );
    }
    #[test]
    fn matches_version_not_just_title() {
        let info = NowPlaying {
            title: "测试曲".into(),
            artist: "测试歌手".into(),
            duration: 210.0,
            ..Default::default()
        };
        assert!(candidate_score("测试歌手 - 测试曲 - 210 - 专辑_qm.qrc", &info).is_some());
        assert!(candidate_score("另一歌手 - 测试曲 - 210 - 专辑_qm.qrc", &info).is_none());
        assert!(candidate_score("测试歌手 - 测试曲 (Live) - 210 - 专辑_qm.qrc", &info).is_none());
        assert!(candidate_score("测试歌手 - 测试曲 - 250 - 专辑_qm.qrc", &info).is_none());
        assert!(candidate_score("测试歌手 - 测试曲 - 210 - 专辑_qmts.qrc", &info).is_none());
    }
    #[test]
    fn mainstream_cache_formats_share_the_same_timeline() {
        let krc = parse("[ti:原创]\n[ar:作者]\n[1000,1500]<0,500,0>微<500,1000,0>光").unwrap();
        assert_eq!(krc[0].text, "微光");
        assert_eq!(krc[0].words[1].start, 1500);
        let yrc = parse("[1000,1500](1000,500,0)微(1500,1000,0)光").unwrap();
        assert_eq!(yrc[0].text, "微光");
        assert_eq!(yrc[0].words[1].start, 1500);
        let netease =
            parse(r#"{"yrc":{"lyric":"[1000,1500](1000,500,0)微(1500,1000,0)光"}}"#).unwrap();
        assert_eq!(netease[0].words.len(), 2);
        let soda = parse(r#"{"lyric_content":"[00:01.50]微光\n[00:03.50]星海"}"#).unwrap();
        assert_eq!(soda[0].text, "微光");
        assert_eq!(soda[0].start, 1500);
    }
    #[test]
    #[ignore = "Requires the user's QQ Music cache; read-only local integration check"]
    fn local_cache_decodes_without_writing() {
        let folder = std::env::var("SOUNDSPECTRA_LYRIC_TEST_DIR").unwrap();
        let mut checked = 0;
        let mut word_timed = 0;
        for entry in fs::read_dir(folder).unwrap().flatten() {
            if !entry.file_name().to_string_lossy().ends_with("_qm.qrc") {
                continue;
            }
            let lines = read_file(&entry.path()).unwrap();
            assert!(!lines.is_empty());
            if lines.iter().any(|line| !line.words.is_empty()) {
                word_timed += 1;
            } else {
                let source = decode(&fs::read(entry.path()).unwrap()).unwrap();
                assert!(
                    !Regex::new(r"\(\d+,\d+\)").unwrap().is_match(&source),
                    "Word timing lost in {:?}",
                    entry.file_name()
                );
            }
            checked += 1;
            if checked == 20 {
                break;
            }
        }
        assert_eq!(checked, 20);
        assert!(word_timed > 0);
        eprintln!(
            "Decoded {checked} local caches: {word_timed} word-timed, {} line-timed",
            checked - word_timed
        );
        // Discover from the parent folder, without supplying the actual cache
        // directory to the scanner or hard-coding its name.
        let parent = Path::new(&std::env::var("SOUNDSPECTRA_LYRIC_TEST_DIR").unwrap())
            .parent()
            .unwrap()
            .to_path_buf();
        let mut scanner = discovery::Scanner::new(vec![parent]);
        let mut entries = Vec::new();
        loop {
            let (found, more) = scanner.step();
            entries.extend(found);
            if !more {
                break;
            }
        }
        assert!(entries.len() >= 20);
        let sample = &entries[0];
        let info = NowPlaying {
            title: sample.title.clone(),
            artist: sample.artist.clone(),
            album: sample.album.clone(),
            duration: sample.duration.unwrap_or(0.0),
            ..Default::default()
        };
        assert_eq!(load(&entries, &info).status, "ready");
        eprintln!(
            "Discovered {} indexed local lyrics without an explicit lyric-folder input",
            entries.len()
        );
    }
}
