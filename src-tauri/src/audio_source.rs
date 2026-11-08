use crate::AppState;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, State, WebviewWindow};

#[derive(Clone, Serialize)]
pub struct Player {
    pub id: &'static str,
    pub name: &'static str,
    pub executables: &'static [&'static str],
}

pub const PLAYERS: &[Player] = &[
    Player {
        id: "qqmusic",
        name: "QQ 音乐",
        executables: &["QQMusic.exe"],
    },
    Player {
        id: "netease",
        name: "网易云音乐",
        executables: &["cloudmusic.exe"],
    },
    Player {
        id: "kugou",
        name: "酷狗音乐",
        executables: &["KuGou.exe"],
    },
    Player {
        id: "soda",
        name: "汽水音乐",
        executables: &["SodaMusic.exe", "汽水音乐.exe"],
    },
];

#[cfg(any(windows, test))]
pub fn player_for(executable: &str) -> Option<&'static Player> {
    PLAYERS.iter().find(|player| {
        player
            .executables
            .iter()
            .any(|name| name.eq_ignore_ascii_case(executable))
    })
}

#[cfg(windows)]
pub fn valid_executable(name: &str) -> bool {
    let lower = name.to_lowercase();
    (5..=128).contains(&name.len())
        && lower.ends_with(".exe")
        && !name
            .chars()
            .any(|c| c.is_control() || "/\\:*?\"<>|".contains(c))
        && ![
            "explorer.exe",
            "svchost.exe",
            "audiodg.exe",
            "dwm.exe",
            "soundspectra.exe",
        ]
        .contains(&lower.as_str())
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum Source {
    #[default]
    Auto,
    Player {
        id: String,
    },
    Process {
        executable: String,
    },
}
impl Source {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Auto => Ok(()),
            Self::Player { id } if PLAYERS.iter().any(|player| player.id == id) => Ok(()),
            _ => Err("音源无效，请重新选择音乐客户端或已检测到的音频应用。".into()),
        }
    }
    #[cfg(windows)]
    pub fn name(&self) -> String {
        match self {
            Self::Auto => "音乐客户端".into(),
            Self::Player { id } => PLAYERS
                .iter()
                .find(|player| player.id == id)
                .map_or("音乐客户端", |player| player.name)
                .into(),
            Self::Process { executable } => executable.clone(),
        }
    }
    fn accepts(&self, target: &Target) -> bool {
        match self {
            Self::Auto => target
                .player_id
                .as_ref()
                .is_some_and(|id| PLAYERS.iter().any(|p| p.id == id)),
            Self::Player { id } => target.player_id.as_ref() == Some(id),
            Self::Process { executable } => target.executable.eq_ignore_ascii_case(executable),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub pid: u32,
    pub executable: String,
    pub name: String,
    pub player_id: Option<String>,
    pub audible: bool,
}

#[derive(Clone, Default, Serialize)]
pub struct Discovery {
    pub targets: Vec<Target>,
    pub warning: Option<String>,
}

#[derive(Clone)]
pub struct SourceState {
    pub selection: Source,
    pub error: Option<String>,
    pub revision: u64,
}
pub fn path(settings_path: &Path) -> PathBuf {
    settings_path.with_file_name("audio-source.json")
}
pub fn read(settings_path: &Path) -> SourceState {
    let result = (|| {
        let file = path(settings_path);
        if !file.exists() {
            return Ok(Source::default());
        }
        let source: Source =
            serde_json::from_slice(&std::fs::read(file).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let source = match source {
            Source::Process { .. } => Source::Auto,
            Source::Player { ref id }
                if [
                    "kuwo", "spotify", "apple", "itunes", "foobar", "musicbee", "aimp",
                ]
                .contains(&id.as_str()) =>
            {
                Source::Auto
            }
            _ => source,
        };
        source.validate()?;
        Ok::<_, String>(source)
    })();
    match result {
        Ok(selection) => SourceState {
            selection,
            error: None,
            revision: 0,
        },
        Err(error) => SourceState {
            selection: Source::Auto,
            error: Some(format!("音源设置读取失败：{error}")),
            revision: 0,
        },
    }
}

#[derive(Serialize)]
pub struct SourceSnapshot {
    selection: Source,
    error: Option<String>,
    catalog: &'static [Player],
    discovery: Discovery,
}
fn settings_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("此操作仅供设置窗口使用".into());
    }
    Ok(())
}
#[tauri::command]
pub fn get_audio_sources(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
) -> Result<SourceSnapshot, String> {
    settings_window(&window)?;
    let source = state
        .audio_source
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    Ok(SourceSnapshot {
        selection: source.selection,
        error: source.error,
        catalog: PLAYERS,
        discovery: state
            .audio_discovery
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
    })
}
#[tauri::command]
pub async fn set_audio_source(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    selection: Source,
) -> Result<Source, String> {
    settings_window(&window)?;
    selection.validate()?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || set_audio_source_inner(&app, &state, selection))
        .await
        .map_err(|error| error.to_string())?
}

fn set_audio_source_inner(
    app: &AppHandle,
    state: &AppState,
    selection: Source,
) -> Result<Source, String> {
    let _operation = state.operation.lock().map_err(|e| e.to_string())?;
    let file = path(&state.path);
    std::fs::create_dir_all(file.parent().ok_or("找不到配置目录")?).map_err(|e| e.to_string())?;
    let mut source = state.audio_source.lock().map_err(|e| e.to_string())?;
    if source.error.is_some() && file.exists() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis();
        std::fs::copy(&file, file.with_extension(format!("{stamp}.backup.json")))
            .map_err(|e| format!("备份旧音源设置失败：{e}"))?;
    }
    let temporary = file.with_extension("tmp");
    std::fs::write(
        &temporary,
        serde_json::to_vec_pretty(&selection).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(temporary, file).map_err(|e| e.to_string())?;
    source.selection = selection.clone();
    source.error = None;
    source.revision = source.revision.wrapping_add(1);
    if let Ok(mut status) = state.status.lock() {
        status.state = "connecting".into();
        status.message = "正在切换音源…".into();
        status.process_id = None;
        status.source_name = None;
    }
    let _ = app.emit("spectrum", vec![0.0f32; crate::dsp::BANDS]);
    Ok(selection)
}

/// Keep a playing source stable. A competing source must be audible for two
/// probes while the current source is quiet, so short gaps do not cause flapping.
#[derive(Default)]
pub struct Selector {
    current: Option<u32>,
    challenger: Option<(u32, u8)>,
}
impl Selector {
    pub fn choose(&mut self, source: &Source, targets: &[Target]) -> Option<Target> {
        let candidates: Vec<_> = targets
            .iter()
            .filter(|target| source.accepts(target))
            .collect();
        let audible = candidates.iter().copied().find(|target| target.audible);
        let current = candidates
            .iter()
            .copied()
            .find(|target| Some(target.pid) == self.current);
        let chosen = if let Some(current) = current {
            if current.audible || audible.is_none() {
                self.challenger = None;
                Some(current)
            } else {
                let next = audible.unwrap();
                let count = self
                    .challenger
                    .filter(|(pid, _)| *pid == next.pid)
                    .map_or(1, |(_, count)| count.saturating_add(1));
                self.challenger = Some((next.pid, count));
                if count >= 2 {
                    self.challenger = None;
                    Some(next)
                } else {
                    Some(current)
                }
            }
        } else {
            self.challenger = None;
            audible.or_else(|| candidates.first().copied())
        };
        self.current = chosen.map(|target| target.pid);
        chosen.cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn target(pid: u32, player: Option<&str>, audible: bool) -> Target {
        Target {
            pid,
            player_id: player.map(str::to_owned),
            audible,
            name: "fixture".into(),
            executable: format!("player{pid}.exe"),
        }
    }
    #[test]
    fn automatic_selection_ignores_other_apps_and_stays_on_playing_music() {
        let mut selector = Selector::default();
        let mut targets = vec![
            target(1, None, true),
            target(2, Some("qqmusic"), false),
            target(3, Some("netease"), true),
        ];
        assert_eq!(selector.choose(&Source::Auto, &targets).unwrap().pid, 3);
        targets[1].audible = true;
        assert_eq!(selector.choose(&Source::Auto, &targets).unwrap().pid, 3);
        targets[2].audible = false;
        assert_eq!(selector.choose(&Source::Auto, &targets).unwrap().pid, 3);
        assert_eq!(selector.choose(&Source::Auto, &targets).unwrap().pid, 2);
        assert!(selector.choose(&Source::Auto, &targets[..1]).is_none());
    }
    #[test]
    fn manual_choice_waits_for_its_player_and_recovers_after_pid_change() {
        let mut selector = Selector::default();
        let source = Source::Player {
            id: "qqmusic".into(),
        };
        assert!(selector
            .choose(&source, &[target(3, Some("netease"), true)])
            .is_none());
        assert_eq!(
            selector
                .choose(&source, &[target(2, Some("qqmusic"), false)])
                .unwrap()
                .pid,
            2
        );
        assert_eq!(
            selector
                .choose(&source, &[target(8, Some("qqmusic"), true)])
                .unwrap()
                .pid,
            8
        );
        assert_eq!(
            selector
                .choose(
                    &Source::Process {
                        executable: "PLAYER9.EXE".into()
                    },
                    &[target(9, None, true)]
                )
                .unwrap()
                .pid,
            9
        );
    }
    #[test]
    fn saved_sources_and_corrupt_files_are_read_without_overwriting() {
        let folder = std::env::temp_dir().join(format!(
            "soundspectra-source-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        let settings = folder.join("settings.json");
        assert_eq!(read(&settings).selection, Source::Auto);
        assert!(!path(&settings).exists());
        let selection = Source::Process {
            executable: "MyMusic.exe".into(),
        };
        std::fs::write(path(&settings), serde_json::to_vec(&selection).unwrap()).unwrap();
        assert_eq!(read(&settings).selection, Source::Auto);
        std::fs::write(path(&settings), "broken config").unwrap();
        assert!(read(&settings).error.is_some());
        assert_eq!(
            std::fs::read_to_string(path(&settings)).unwrap(),
            "broken config"
        );
        std::fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn source_validation_rejects_unknown_players_paths_and_shared_hosts() {
        assert_eq!(
            PLAYERS.iter().map(|p| p.id).collect::<Vec<_>>(),
            ["qqmusic", "netease", "kugou", "soda"]
        );
        assert!(player_for("KwMusic.exe").is_none());
        for name in [
            "explorer.exe",
            "svchost.exe",
            "soundspectra.exe",
            "C:\\music.exe",
            "../music.exe",
            "app",
            "a\n.exe",
        ] {
            assert!(Source::Process {
                executable: name.into()
            }
            .validate()
            .is_err());
        }
        assert!(Source::Process {
            executable: "我的音乐.exe".into(),
        }
        .validate()
        .is_err());
        assert!(Source::Player {
            id: "unknown".into()
        }
        .validate()
        .is_err());
        for player in PLAYERS {
            let source = Source::Player {
                id: player.id.into(),
            };
            source.validate().unwrap();
            assert_eq!(
                serde_json::from_value::<Source>(serde_json::to_value(&source).unwrap()).unwrap(),
                source
            );
            for exe in player.executables {
                assert_eq!(player_for(exe).unwrap().id, player.id);
            }
        }
    }
}
