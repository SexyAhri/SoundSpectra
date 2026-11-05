use crate::{audio_source::Target, AppState};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{State, WebviewWindow};
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionMediaProperties as Properties,
    },
    Storage::Streams::DataReader,
};

#[link(name = "runtimeobject")]
extern "system" {
    fn RoInitialize(kind: u32) -> i32;
    fn RoUninitialize();
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover: Option<String>,
    pub position: f64,
    pub duration: f64,
    pub timeline_available: bool,
    pub playing: bool,
    pub source: String,
    pub process_id: Option<u32>,
    pub updated: u64,
    pub issue: Option<String>,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn clean(value: String) -> String {
    value
        .chars()
        .filter(|c| !c.is_control())
        .take(200)
        .collect::<String>()
        .trim()
        .into()
}
// Match only the captured player's registered media session. Never substitute
// the globally focused session, which may be a browser video or another player.
fn matches_session(id: &str, target: &Target) -> bool {
    let id = id.to_lowercase();
    let aliases: &[&str] = match target.player_id.as_deref() {
        Some("qqmusic") => &["qqmusic"],
        Some("netease") => &["cloudmusic", "netease"],
        Some("kugou") => &["kugou"],
        Some("kuwo") => &["kwmusic", "kuwo"],
        Some("soda") => &["sodamusic", "汽水音乐"],
        Some("spotify") => &["spotify"],
        Some("apple") => &["applemusic"],
        Some("itunes") => &["itunes"],
        Some("foobar") => &["foobar2000"],
        Some("musicbee") => &["musicbee"],
        Some("aimp") => &["aimp"],
        _ => &[],
    };
    if !aliases.is_empty() {
        return aliases.iter().any(|alias| id.contains(alias));
    }
    let executable = target.executable.to_lowercase();
    let stem = executable.strip_suffix(".exe").unwrap_or(&executable);
    stem.len() >= 4 && (id == executable || id == stem || id.ends_with(&format!("!{stem}")))
}
fn cover(properties: &Properties) -> Option<String> {
    let stream = properties
        .Thumbnail()
        .ok()?
        .OpenReadAsync()
        .ok()?
        .join()
        .ok()?;
    let size = stream.Size().ok()?;
    if size == 0 || size > 512 * 1024 {
        return None;
    }
    let input = stream.GetInputStreamAt(0).ok()?;
    let reader = DataReader::CreateDataReader(&input).ok()?;
    let loaded = reader.LoadAsync(size as u32).ok()?.join().ok()?;
    if loaded != size as u32 {
        return None;
    }
    let mut bytes = vec![0; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;
    // Some media providers omit ContentType. Validate the actual raster header
    // instead of rejecting usable covers or trusting an arbitrary media type.
    let mime = image_mime(&bytes)?;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}
fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}
fn read(manager: &Manager, target: &Target, old: &NowPlaying) -> Result<NowPlaying, String> {
    let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
    let mut candidates = Vec::new();
    for i in 0..sessions.Size().map_err(|e| e.to_string())? {
        let Ok(session) = sessions.GetAt(i) else {
            continue;
        };
        let Ok(id) = session.SourceAppUserModelId() else {
            continue;
        };
        if matches_session(&id.to_string(), target) {
            let playing = session
                .GetPlaybackInfo()
                .and_then(|p| p.PlaybackStatus())
                .is_ok_and(|s| s.0 == 4);
            candidates.push((playing, session));
        }
    }
    candidates.sort_by_key(|(playing, _)| !playing);
    let Some((playing, session)) = candidates.first() else {
        return Ok(NowPlaying::default());
    };
    let properties = session
        .TryGetMediaPropertiesAsync()
        .and_then(|op| op.join())
        .map_err(|e| e.to_string())?;
    let mut value = NowPlaying {
        title: clean(properties.Title().unwrap_or_default().to_string()),
        artist: clean(properties.Artist().unwrap_or_default().to_string()),
        album: clean(properties.AlbumTitle().unwrap_or_default().to_string()),
        playing: *playing,
        ..NowPlaying::default()
    };
    value.cover = if old.process_id == Some(target.pid)
        && old.title == value.title
        && old.artist == value.artist
        && old.album == value.album
        && !value.title.is_empty()
        && old.cover.is_some()
    {
        old.cover.clone()
    } else {
        cover(&properties)
    };
    if let Ok(timeline) = session.GetTimelineProperties() {
        let start = timeline.StartTime().map_or(0, |t| t.Duration);
        let end = timeline.EndTime().map_or(0, |t| t.Duration);
        value.duration = (end.saturating_sub(start).max(0) as f64 / 10_000_000.0).min(86_400.0);
        value.position = (timeline
            .Position()
            .map_or(start, |t| t.Duration)
            .saturating_sub(start)
            .max(0) as f64
            / 10_000_000.0)
            .min(value.duration);
        value.timeline_available = value.duration > 0.0;
        if value.playing && value.timeline_available {
            if let Ok(updated) = timeline.LastUpdatedTime() {
                // WinRT timestamps count 100 ns ticks since 1601, not Unix time.
                let unix_ms = updated.UniversalTime / 10_000 - 11_644_473_600_000;
                if unix_ms > 0 {
                    let elapsed = (now() as i64 - unix_ms).max(0) as f64 / 1000.0;
                    value.position = (value.position + elapsed).min(value.duration);
                }
            }
        }
    }
    Ok(value)
}

#[tauri::command]
pub fn get_now_playing(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
) -> Result<NowPlaying, String> {
    if !["settings", "overlay"].contains(&window.label()) {
        return Err("不支持的窗口".into());
    }
    let status = state.status.lock().map_err(|e| e.to_string())?.clone();
    let mut value = state.now_playing.lock().map_err(|e| e.to_string())?.clone();
    if value.process_id != status.process_id || now().saturating_sub(value.updated) > 10_000 {
        value = NowPlaying::default();
    }
    if value.title.is_empty() {
        value.playing = status.state == "listening";
    }
    value.source = status.source_name.unwrap_or_default();
    Ok(value)
}

pub fn start(state: Arc<AppState>) {
    thread::spawn(move || {
        let initialized = unsafe { RoInitialize(1) } >= 0;
        let mut manager = None;
        while !state.shutdown.load(Ordering::Relaxed) {
            let status = state.status.lock().unwrap().clone();
            let revision = state.audio_source.lock().unwrap().revision;
            let enabled = {
                let settings = state.settings.lock().unwrap();
                settings.desktop_card.enabled || settings.lyrics.enabled
            };
            let target = if enabled {
                state
                    .audio_discovery
                    .lock()
                    .unwrap()
                    .targets
                    .iter()
                    .find(|t| Some(t.pid) == status.process_id)
                    .cloned()
            } else {
                None
            };
            let old = state.now_playing.lock().unwrap().clone();
            let mut value = NowPlaying::default();
            if let Some(target) = target {
                let result = (|| {
                    if !initialized {
                        return Err("系统媒体信息暂不可用".into());
                    }
                    if manager.is_none() {
                        manager = Some(
                            Manager::RequestAsync()
                                .and_then(|op| op.join())
                                .map_err(|e| e.to_string())?,
                        );
                    }
                    read(manager.as_ref().unwrap(), &target, &old)
                })();
                value = result.unwrap_or_else(|error| NowPlaying {
                    issue: Some(error),
                    ..NowPlaying::default()
                });
                value.process_id = Some(target.pid);
            }
            value.updated = now();
            // A slow metadata/cover request must never overwrite a newer selection.
            let source = state.audio_source.lock().unwrap();
            if source.revision == revision {
                let mut current = state.now_playing.lock().unwrap();
                if current.title != value.title
                    || current.artist != value.artist
                    || current.album != value.album
                    || current.process_id != value.process_id
                {
                    crate::lyrics::cancel_search(&state);
                }
                *current = value;
            }
            drop(source);
            for _ in 0..5 {
                if state.shutdown.load(Ordering::Relaxed) {
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
        if initialized {
            unsafe { RoUninitialize() }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cover_headers_accept_only_supported_raster_formats() {
        assert_eq!(image_mime(b"\x89PNG\r\n\x1a\n"), Some("image/png"));
        assert_eq!(image_mime(&[0xff, 0xd8, 0xff, 0]), Some("image/jpeg"));
        assert_eq!(image_mime(b"RIFF1234WEBP"), Some("image/webp"));
        assert_eq!(image_mime(b"<svg></svg>"), None);
        assert_eq!(image_mime(b"RIFF"), None);
        assert_eq!(image_mime(b""), None);
    }
    #[test]
    fn metadata_matches_only_the_audio_players_session() {
        let target = Target {
            pid: 1,
            executable: "QQMusic.exe".into(),
            name: "QQ 音乐".into(),
            player_id: Some("qqmusic".into()),
            audible: true,
        };
        assert!(matches_session("QQMusic.exe", &target));
        assert!(matches_session("Tencent.QQMusic_abc!QQMusic", &target));
        assert!(!matches_session("chrome.exe", &target));
        assert!(!matches_session("SpotifyAB.SpotifyMusic!Spotify", &target));
        let custom = Target {
            player_id: None,
            executable: "OtherPlayer.exe".into(),
            ..target
        };
        assert!(matches_session("OtherPlayer.exe", &custom));
        assert!(!matches_session("AnotherOtherPlayer.exe", &custom));
    }
}
