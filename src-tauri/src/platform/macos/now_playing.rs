use crate::{audio_discovery, macos_helper, AppState};
use serde::{Deserialize, Serialize};
use std::{
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{State, WebviewWindow};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
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
        while !state.shutdown.load(Ordering::Relaxed) {
            let revision = state.audio_source.lock().unwrap().revision;
            let pid = state.status.lock().unwrap().process_id;
            let enabled = {
                let s = state.settings.lock().unwrap();
                s.lyrics.enabled || s.desktop_card.enabled
            };
            let mut value = NowPlaying::default();
            if enabled {
                if let Some(pid) = pid {
                    let result = (|| {
                        let apps = audio_discovery::running()?;
                        let app = apps
                            .as_array()
                            .and_then(|a| a.iter().find(|a| a["pid"].as_u64() == Some(pid as u64)))
                            .ok_or("播放器已退出")?;
                        let bundle = app["bundle"].as_str().ok_or("播放器标识无效")?;
                        let json =
                            macos_helper::json(&["metadata", bundle], Duration::from_secs(8))?;
                        let mut v: NowPlaying =
                            serde_json::from_value(json).map_err(|e| e.to_string())?;
                        v.timeline_available = !v.title.is_empty()
                            && v.duration.is_finite()
                            && v.duration > 0.0
                            && v.position.is_finite()
                            && v.position >= 0.0;
                        v.title = v
                            .title
                            .chars()
                            .filter(|c| !c.is_control())
                            .take(200)
                            .collect();
                        Ok::<_, String>(v)
                    })();
                    value = result.unwrap_or_else(|error| NowPlaying {
                        issue: Some(format!("播放器未提供可用的自动化歌曲信息：{error}")),
                        ..NowPlaying::default()
                    });
                    value.process_id = Some(pid);
                }
            }
            value.updated = now();
            let guard = state.audio_source.lock().unwrap();
            if guard.revision == revision {
                let mut old = state.now_playing.lock().unwrap();
                if old.title != value.title
                    || old.artist != value.artist
                    || old.album != value.album
                    || old.process_id != value.process_id
                {
                    crate::lyrics::cancel_search(&state);
                }
                *old = value;
            }
            drop(guard);
            for _ in 0..10 {
                if state.shutdown.load(Ordering::Relaxed) {
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    });
}
