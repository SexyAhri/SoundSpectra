use crate::{audio_source::Target, AppState};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    hash::{DefaultHasher, Hash, Hasher},
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
mod accessibility;
mod kugou;
mod kugou_bridge;
mod netease;
mod netease_cover;
pub(crate) mod netease_transport;

#[link(name = "runtimeobject")]
extern "system" {
    fn RoInitialize(kind: u32) -> i32;
    fn RoUninitialize();
}

pub use crate::now_playing_state::NowPlaying;

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
pub(crate) fn matches_session(id: &str, target: &Target) -> bool {
    let id = id.to_lowercase();
    let aliases: &[&str] = match target.player_id.as_deref() {
        Some("qqmusic") => &["qqmusic"],
        Some("netease") => &["cloudmusic", "netease"],
        Some("kugou") => &["kugou"],
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
fn metadata_signature(properties: &Properties) -> (String, String, String, i32) {
    (
        clean(properties.Title().unwrap_or_default().to_string()),
        clean(properties.Artist().unwrap_or_default().to_string()),
        clean(properties.AlbumTitle().unwrap_or_default().to_string()),
        properties.TrackNumber().unwrap_or_default(),
    )
}
fn observed_position(
    position: f64,
    duration: f64,
    updated_ticks: i64,
    observed: u64,
) -> Option<f64> {
    let unix_ms = updated_ticks / 10_000 - 11_644_473_600_000;
    if !position.is_finite()
        || !duration.is_finite()
        || duration <= 0.0
        || unix_ms <= 0
        || unix_ms > observed as i64 + 2000
    {
        return None;
    }
    Some((position + (observed as i64 - unix_ms).max(0) as f64 / 1000.0).clamp(0.0, duration))
}

fn read(manager: &Manager, target: &Target) -> Result<NowPlaying, String> {
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
    let signature = metadata_signature(&properties);
    let mut value = NowPlaying {
        title: signature.0.clone(),
        artist: signature.1.clone(),
        album: signature.2.clone(),
        playing: *playing,
        playback_available: false,
        ..NowPlaying::default()
    };
    value.cover = cover(&properties);
    let confirmed = session
        .TryGetMediaPropertiesAsync()
        .and_then(|op| op.join())
        .map_err(|error| error.to_string())?;
    if signature != metadata_signature(&confirmed) {
        return Err("歌曲信息正在更新".into());
    }
    match session
        .GetPlaybackInfo()
        .and_then(|playback| playback.PlaybackStatus())
    {
        Ok(status) => {
            value.playing = status.0 == 4;
            value.playback_available = matches!(status.0, 3..=5);
        }
        Err(_) => {
            value.playing = false;
        }
    }
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
                if let Some(position) =
                    observed_position(value.position, value.duration, updated.UniversalTime, now())
                {
                    value.position = position;
                } else {
                    value.timeline_available = false;
                }
            } else {
                value.timeline_available = false;
            }
        }
    }
    value.updated = now();
    value.session_id = session
        .SourceAppUserModelId()
        .unwrap_or_default()
        .to_string();
    value.controls = crate::card_controls::capabilities(session);
    let mut identity = DefaultHasher::new();
    target.pid.hash(&mut identity);
    session
        .SourceAppUserModelId()
        .unwrap_or_default()
        .to_string()
        .hash(&mut identity);
    signature.hash(&mut identity);
    (value.duration * 10.0)
        .round()
        .to_bits()
        .hash(&mut identity);
    value.track_id = format!("{:016x}", identity.finish());
    Ok(value)
}

#[tauri::command]
pub fn get_now_playing(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
) -> Result<NowPlaying, String> {
    if !["settings", "overlay", "card-controls"].contains(&window.label()) {
        return Err("不支持的窗口".into());
    }
    let status = state.status.lock().map_err(|e| e.to_string())?.clone();
    let mut value = state.now_playing.lock().map_err(|e| e.to_string())?.clone();
    if value.process_id != status.process_id || now().saturating_sub(value.updated) > 10_000 {
        value = NowPlaying::default();
    }
    value.source = status.source_name.unwrap_or_default();
    Ok(value)
}

pub fn start(state: Arc<AppState>) {
    thread::spawn(move || {
        let initialized = unsafe { RoInitialize(1) } >= 0;
        let mut manager = None;
        let mut kugou_clock = kugou::Clock::default();
        let mut kugou_bridge = kugou_bridge::Reader::default();
        let mut netease_clock = netease::Clock::default();
        let mut netease_cover =
            netease_cover::Reader::new(state.path.with_file_name("cover-cache"));
        let mut accessibility = accessibility::Reader::default();
        while !state.shutdown.load(Ordering::Relaxed) {
            let status = state.status.lock().unwrap().clone();
            let revision = state.audio_source.lock().unwrap().revision;
            // Performance cues need the player clock even when both visible
            // metadata consumers (card and lyrics) are switched off.
            let target = state
                .audio_discovery
                .lock()
                .unwrap()
                .targets
                .iter()
                .find(|t| Some(t.pid) == status.process_id)
                .cloned();
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
                    read(manager.as_ref().unwrap(), &target)
                })();
                value = result.unwrap_or_else(|error| NowPlaying {
                    issue: Some(error),
                    ..NowPlaying::default()
                });
                value.process_id = Some(target.pid);
                value.source = target.name.clone();
                accessibility.update(Some(&target), &mut value, now());
                netease_clock.update(&target, &mut value, now());
                kugou_bridge.update(Some(&target), &mut value, now());
                kugou_clock.update(&target, &mut value, now());
                netease_transport::attach(&target, &mut value);
                netease_cover.update(&target, netease_clock.cover_url(&value), &mut value);
            } else {
                accessibility.update(None, &mut value, now());
                kugou_bridge.update(None, &mut value, now());
                kugou_clock = kugou::Clock::default();
                netease_clock = netease::Clock::default();
                netease_cover.clear();
            }
            if value.updated == 0 {
                value.updated = now();
            }
            if !value.track_id.is_empty() {
                value.track_id = format!("{revision}:{}", value.track_id);
            }
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
    #[ignore = "Requires a playing NetEase process; only reads SMTC and the encoded event log"]
    fn installed_netease_event_clock_advances_without_playback_controls() {
        let pid: u32 = std::env::var("SOUNDSPECTRA_TEST_NETEASE_PID")
            .expect("set the active NetEase main PID")
            .parse()
            .unwrap();
        let initialized = unsafe { RoInitialize(1) } >= 0;
        struct Apartment(bool);
        impl Drop for Apartment {
            fn drop(&mut self) {
                if self.0 {
                    unsafe { RoUninitialize() }
                }
            }
        }
        let _apartment = Apartment(initialized);
        let manager = Manager::RequestAsync().unwrap().join().unwrap();
        let target = Target {
            pid,
            executable: "cloudmusic.exe".into(),
            name: "网易云音乐".into(),
            player_id: Some("netease".into()),
            audible: true,
        };
        let mut clock = netease::Clock::default();
        let started = std::time::Instant::now();
        let mut first: Option<(String, f64, std::time::Instant)> = None;
        while started.elapsed() < Duration::from_secs(12) {
            let mut value = read(&manager, &target).unwrap();
            assert!(
                !value.title.is_empty(),
                "independent SMTC song metadata is required for this check"
            );
            let title = value.title.clone();
            let artist = value.artist.clone();
            clock.update(&target, &mut value, now());
            assert_eq!(value.title, title);
            assert_eq!(value.artist, artist);
            assert_eq!(
                value.timeline_source,
                Some("netease-events"),
                "no verified event clock for current SMTC song"
            );
            assert!(value.timeline_available && value.duration > 0.0);
            assert!(value.timeline_valid_until.unwrap() >= now());
            if value.playing {
                if let Some((id, position, at)) = &first {
                    if *id == value.track_id && at.elapsed() >= Duration::from_secs(2) {
                        let advance = value.position - position;
                        assert!((advance - at.elapsed().as_secs_f64()).abs() < 0.25);
                        eprintln!("Verified minimized-capable NetEase clock: {} / {}; {:.3}s -> {:.3}s / {:.3}s",value.title,value.artist,position,value.position,value.duration);
                        return;
                    }
                    if *id != value.track_id {
                        first = None
                    }
                }
                if first.is_none() {
                    first = Some((value.track_id, value.position, std::time::Instant::now()))
                }
            } else {
                first = None
            }
            thread::sleep(Duration::from_millis(500));
        }
        panic!("NetEase must remain playing for two consecutive seconds");
    }
    #[test]
    #[ignore = "Reads installed media sessions; never invokes playback controls"]
    fn installed_media_sessions_read_only() {
        let initialized = unsafe { RoInitialize(1) } >= 0;
        let manager = Manager::RequestAsync().unwrap().join().unwrap();
        for (id, executable) in [("netease", "cloudmusic.exe"), ("soda", "SodaMusic.exe")] {
            let target = Target {
                pid: 0,
                executable: executable.into(),
                name: id.into(),
                player_id: Some(id.into()),
                audible: false,
            };
            let value = read(&manager, &target).unwrap();
            eprintln!(
                "{id}: title={}, artist={}, position={}, duration={}, playing={}, timeline={}",
                value.title,
                value.artist,
                value.position,
                value.duration,
                value.playing,
                value.timeline_available
            );
        }
        drop(manager);
        if initialized {
            unsafe { RoUninitialize() };
        }
    }
    #[test]
    #[ignore = "Requires a playing KuGou session; only reads SMTC and playback checkpoints"]
    fn installed_kugou_checkpoint_advances_without_playback_controls() {
        let initialized = unsafe { RoInitialize(1) } >= 0;
        struct Apartment(bool);
        impl Drop for Apartment {
            fn drop(&mut self) {
                if self.0 {
                    unsafe { RoUninitialize() };
                }
            }
        }
        let _apartment = Apartment(initialized);
        let manager = Manager::RequestAsync().unwrap().join().unwrap();
        let target = Target {
            pid: 0,
            executable: "KuGou.exe".into(),
            name: "酷狗音乐".into(),
            player_id: Some("kugou".into()),
            audible: true,
        };
        let mut clock = kugou::Clock::default();
        let config =
            std::path::PathBuf::from(std::env::var_os("APPDATA").unwrap()).join("KuGou8/KuGou.ini");
        let mut scanner = crate::lyrics::discovery::Scanner::new(
            crate::lyrics::discovery::kugou_directories(&config),
        );
        let mut entries = Vec::new();
        loop {
            let (found, more) = scanner.step();
            entries.extend(found);
            if !more {
                break;
            }
        }
        let started = std::time::Instant::now();
        let mut previous: Option<(String, f64)> = None;
        while started.elapsed() < Duration::from_secs(55) {
            let mut value = read(&manager, &target).unwrap();
            clock.update(&target, &mut value, now());
            if value.timeline_source == Some("kugou-checkpoint") && value.playing {
                assert!(value.timeline_available);
                assert!(value.timeline_valid_until.unwrap() >= now());
                assert!(value.track_id.contains(":kugou:"));
                if let Some((id, position)) = &previous {
                    if *id == value.track_id && value.position > *position {
                        let lyrics = crate::lyrics::load(&entries, &value);
                        assert_eq!(
                            lyrics.status, "ready",
                            "{}: {}",
                            value.title, lyrics.message
                        );
                        assert!(lyrics.lines.iter().any(|line| !line.words.is_empty()));
                        eprintln!(
                            "Verified current KuGou song: {} / {}, {} timed lines",
                            value.title,
                            value.artist,
                            lyrics.lines.len()
                        );
                        eprintln!("Verified live KuGou checkpoint clock: {:.3}s -> {:.3}s; duration {:.3}s",position,value.position,value.duration);
                        return;
                    }
                }
                previous = Some((value.track_id, value.position));
            }
            thread::sleep(Duration::from_millis(500));
        }
        panic!("KuGou must remain playing and publish a changed checkpoint within 55 seconds");
    }
    #[test]
    fn media_timestamp_is_winrt_epoch_and_seek_is_not_smoothed() {
        let observed = 1_700_000_000_000;
        let ticks = (observed as i64 - 750 + 11_644_473_600_000) * 10_000;
        assert_eq!(observed_position(12.0, 100.0, ticks, observed), Some(12.75));
        assert_eq!(
            observed_position(3.0, 100.0, ticks + 7_500_000, observed),
            Some(3.0)
        );
        assert_eq!(observed_position(99.8, 100.0, ticks, observed), Some(100.0));
        assert_eq!(observed_position(3.0, 100.0, 0, observed), None);
        assert_eq!(observed_position(3.0, 0.0, ticks, observed), None);
        assert_eq!(
            observed_position(3.0, 100.0, ticks + 30_000_000, observed),
            None
        );
    }
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
