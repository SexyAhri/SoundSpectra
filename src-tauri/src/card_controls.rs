use crate::AppState;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{State, WebviewWindow};

#[cfg(windows)]
static MEDIA_OPERATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCapabilities {
    pub previous: bool,
    pub next: bool,
    pub play: bool,
    pub pause: bool,
}
#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaAction {
    Previous,
    Next,
    Play,
    Pause,
}

#[cfg(windows)]
pub fn capabilities(
    session: &windows::Media::Control::GlobalSystemMediaTransportControlsSession,
) -> MediaCapabilities {
    let Ok(controls) = session.GetPlaybackInfo().and_then(|value| value.Controls()) else {
        return MediaCapabilities::default();
    };
    MediaCapabilities {
        previous: controls.IsPreviousEnabled().unwrap_or(false),
        next: controls.IsNextEnabled().unwrap_or(false),
        play: controls.IsPlayEnabled().unwrap_or(false),
        pause: controls.IsPauseEnabled().unwrap_or(false),
    }
}

#[tauri::command]
pub async fn control_card_media(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    action: MediaAction,
    track_id: String,
    session_id: String,
) -> Result<(), String> {
    if !["settings", "overlay", "card-controls"].contains(&window.label()) {
        return Err("不支持的窗口".into());
    }
    #[cfg(windows)]
    {
        let state = state.inner().clone();
        tokio::task::spawn_blocking(move || control(&state, action, &track_id, &session_id))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (state, action, track_id, session_id);
        Err("当前平台未提供媒体控制".into())
    }
}

#[cfg(windows)]
fn control(
    state: &AppState,
    action: MediaAction,
    track_id: &str,
    session_id: &str,
) -> Result<(), String> {
    let _operation = MEDIA_OPERATION
        .try_lock()
        .map_err(|_| "正在等待播放器响应")?;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager as Manager;
    #[link(name = "runtimeobject")]
    extern "system" {
        fn RoInitialize(kind: u32) -> i32;
        fn RoUninitialize();
    }
    if unsafe { RoInitialize(1) } < 0 {
        return Err("系统媒体控制暂不可用".into());
    }
    struct Apartment;
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() }
        }
    }
    let _apartment = Apartment;
    let revision = state
        .audio_source
        .lock()
        .map_err(|error| error.to_string())?
        .revision;
    let current = state
        .now_playing
        .lock()
        .map_err(|error| error.to_string())?
        .clone();
    let pid = state
        .status
        .lock()
        .map_err(|error| error.to_string())?
        .process_id;
    let observed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    if !current_request(&current, track_id, session_id, pid, revision, observed) {
        return Err("播放器已变化，请稍后重试".into());
    }
    let target = state
        .audio_discovery
        .lock()
        .map_err(|error| error.to_string())?
        .targets
        .iter()
        .find(|target| Some(target.pid) == pid)
        .cloned()
        .ok_or("播放器已断开")?;
    let manager = Manager::RequestAsync()
        .and_then(|operation| operation.join())
        .map_err(|error| error.to_string())?;
    let sessions = manager.GetSessions().map_err(|error| error.to_string())?;
    let mut selected = Vec::new();
    for index in 0..sessions.Size().map_err(|error| error.to_string())? {
        let session = sessions.GetAt(index).map_err(|error| error.to_string())?;
        let id = session
            .SourceAppUserModelId()
            .map_err(|error| error.to_string())?
            .to_string();
        if id == session_id && crate::now_playing::matches_session(&id, &target) {
            selected.push(session);
        }
    }
    if selected.len() != 1 {
        return Err("无法唯一确定播放器会话".into());
    }
    let session = &selected[0];
    let properties = session
        .TryGetMediaPropertiesAsync()
        .and_then(|operation| operation.join())
        .map_err(|error| error.to_string())?;
    if properties.Title().unwrap_or_default().to_string() != current.title
        || properties.Artist().unwrap_or_default().to_string() != current.artist
        || properties.AlbumTitle().unwrap_or_default().to_string() != current.album
    {
        return Err("歌曲正在切换，请稍后重试".into());
    }
    let caps = capabilities(session);
    let allowed = match action {
        MediaAction::Previous => caps.previous,
        MediaAction::Next => caps.next,
        MediaAction::Play => caps.play,
        MediaAction::Pause => caps.pause,
    };
    if !allowed {
        return Err("播放器不支持此操作".into());
    }
    let source = state
        .audio_source
        .lock()
        .map_err(|error| error.to_string())?;
    if source.revision != revision
        || state
            .now_playing
            .lock()
            .map_err(|error| error.to_string())?
            .track_id
            != track_id
        || state
            .status
            .lock()
            .map_err(|error| error.to_string())?
            .process_id
            != pid
    {
        return Err("音源已切换，请稍后重试".into());
    }
    let operation = match action {
        MediaAction::Previous => session.TrySkipPreviousAsync(),
        MediaAction::Next => session.TrySkipNextAsync(),
        MediaAction::Play => session.TryPlayAsync(),
        MediaAction::Pause => session.TryPauseAsync(),
    }
    .map_err(|error| error.to_string())?;
    drop(source);
    if operation.join().map_err(|error| error.to_string())? {
        Ok(())
    } else {
        Err("播放器未接受操作".into())
    }
}

#[cfg(windows)]
fn current_request(
    current: &crate::now_playing::NowPlaying,
    track: &str,
    session: &str,
    pid: Option<u32>,
    revision: u64,
    observed: u64,
) -> bool {
    !track.is_empty()
        && !session.is_empty()
        && current.track_id == track
        && current.track_id.starts_with(&format!("{revision}:"))
        && current.session_id == session
        && current.process_id == pid
        && pid.is_some()
        && current.playback_available
        && observed.saturating_sub(current.updated) <= 4000
        && current.updated <= observed + 2000
        && current.issue.is_none()
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn transport_rejects_old_track_session_source_revision_and_stale_state() {
        let current = crate::now_playing::NowPlaying {
            track_id: "3:song-a".into(),
            session_id: "QQMusic.exe".into(),
            process_id: Some(17),
            updated: 10000,
            playback_available: true,
            ..Default::default()
        };
        assert!(current_request(
            &current,
            "3:song-a",
            "QQMusic.exe",
            Some(17),
            3,
            11000
        ));
        assert!(!current_request(
            &current,
            "3:song-b",
            "QQMusic.exe",
            Some(17),
            3,
            11000
        ));
        assert!(!current_request(
            &current,
            "3:song-a",
            "Spotify.exe",
            Some(17),
            3,
            11000
        ));
        assert!(!current_request(
            &current,
            "3:song-a",
            "QQMusic.exe",
            Some(18),
            3,
            11000
        ));
        assert!(!current_request(
            &current,
            "3:song-a",
            "QQMusic.exe",
            Some(17),
            4,
            11000
        ));
        assert!(!current_request(
            &current,
            "3:song-a",
            "QQMusic.exe",
            Some(17),
            3,
            15000
        ));
        assert!(!current_request(
            &current,
            "3:song-a",
            "QQMusic.exe",
            Some(17),
            3,
            7000
        ));
    }
}
