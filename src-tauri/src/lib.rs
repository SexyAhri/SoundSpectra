mod application;
#[cfg(windows)]
mod audio;
#[cfg(target_os = "macos")]
#[path = "platform/macos/audio.rs"]
mod audio;
#[cfg(windows)]
mod audio_discovery;
#[cfg(target_os = "macos")]
#[path = "platform/macos/discovery.rs"]
mod audio_discovery;
mod audio_source;
mod card_controls;
mod card_window;
#[cfg(windows)]
mod desktop;
#[cfg(target_os = "macos")]
#[path = "platform/macos/desktop.rs"]
mod desktop;
mod dsp;
mod lyrics;
#[cfg(target_os = "macos")]
#[path = "platform/macos/helper.rs"]
mod macos_helper;
#[cfg(windows)]
mod now_playing;
#[cfg(target_os = "macos")]
#[path = "platform/macos/now_playing.rs"]
mod now_playing;
mod rail;
mod scenes;
mod settings;
mod system_tray;
#[cfg(windows)]
mod wallpaper;
#[cfg(target_os = "macos")]
#[path = "platform/macos/wallpaper.rs"]
mod wallpaper;
mod wallpaper_depth;

use serde::Serialize;
use settings::Settings;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    state: String,
    message: String,
    process_id: Option<u32>,
    source_name: Option<String>,
    desktop_attached: bool,
    editing: bool,
    desktop_error: Option<String>,
}

pub struct AppState {
    now_playing: Mutex<now_playing::NowPlaying>,
    lyric_cache: Mutex<lyrics::LyricCache>,
    lyric_library: Mutex<lyrics::discovery::Library>,
    audio_source: Mutex<audio_source::SourceState>,
    audio_discovery: Mutex<audio_source::Discovery>,
    settings: Mutex<Settings>,
    status: Mutex<RuntimeStatus>,
    operation: Mutex<()>,
    config_error: Mutex<Option<String>>,
    path: PathBuf,
    shutdown: AtomicBool,
}

#[tauri::command]
fn get_settings(state: State<'_, Arc<AppState>>) -> Result<Settings, String> {
    if let Some(error) = state
        .config_error
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
    {
        return Err(error.clone());
    }
    Ok(state.settings.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
fn get_status(app: AppHandle, state: State<'_, Arc<AppState>>) -> Result<RuntimeStatus, String> {
    let mut current = state.status.lock().map_err(|e| e.to_string())?.clone();
    current.desktop_attached = app
        .get_webview_window("overlay")
        .is_some_and(|window| desktop::is_attached(&window));
    Ok(current)
}

#[tauri::command]
fn debug_desktop_state(app: AppHandle) -> Result<serde_json::Value, String> {
    if !cfg!(debug_assertions) {
        return Err("此接口仅用于开发验证".into());
    }
    desktop::diagnostics(&app.get_webview_window("overlay").ok_or("找不到效果窗口")?)
}

#[tauri::command]
async fn reset_settings(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<Settings, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || reset_settings_inner(&app, &state))
        .await
        .map_err(|error| error.to_string())?
}

fn reset_settings_inner(app: &AppHandle, state: &AppState) -> Result<Settings, String> {
    let _operation = state.operation.lock().map_err(|e| e.to_string())?;
    if state.path.exists() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis();
        std::fs::copy(
            &state.path,
            state.path.with_extension(format!("{stamp}.backup.json")),
        )
        .map_err(|e| format!("备份原设置失败：{e}"))?;
    }
    let settings = Settings::default();
    apply_display(app, &settings)?;
    settings::write(&state.path, &settings)?;
    *state.settings.lock().map_err(|e| e.to_string())? = settings.clone();
    *state.config_error.lock().map_err(|e| e.to_string())? = None;
    state.status.lock().map_err(|e| e.to_string())?.editing = false;
    state
        .status
        .lock()
        .map_err(|e| e.to_string())?
        .desktop_error = None;
    app.emit("settings-changed", &settings)
        .map_err(|e| e.to_string())?;
    Ok(settings)
}

fn apply_display(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    card_window::sync(app, settings)?;
    let window = app
        .get_webview_window("overlay")
        .ok_or("找不到频谱窗口，请重启客户端")?;
    if let Some(bounds) = settings.display_bounds().filter(|_| settings.enabled) {
        desktop::attach(&window, &bounds)
    } else {
        desktop::hide(&window)
    }
}

#[tauri::command]
async fn update_settings(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    settings: Settings,
) -> Result<Settings, String> {
    let state = state.inner().clone();
    // Creating a WebView2 window from a synchronous IPC handler deadlocks the
    // Windows event loop. Keep the entire serialized transaction off that loop.
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = state.operation.lock().map_err(|e| e.to_string())?;
        commit_settings(&app, &state, settings)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn apply_scene(
    window: tauri::WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    scene: serde_json::Value,
) -> Result<Settings, String> {
    if window.label() != "settings" {
        return Err("请从设置窗口应用桌面方案".into());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _operation = state.operation.lock().map_err(|e| e.to_string())?;
        let current = state.settings.lock().map_err(|e| e.to_string())?.clone();
        let next = scenes::merge(&current, scene)?;
        commit_settings(&app, &state, next)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn commit_settings(
    app: &AppHandle,
    state: &Arc<AppState>,
    settings: Settings,
) -> Result<Settings, String> {
    settings.validate()?;
    let old = state.settings.lock().map_err(|e| e.to_string())?.clone();
    let editing = state.status.lock().map_err(|e| e.to_string())?.editing;
    if editing
        && (settings.regions != old.regions
            || settings.region_visible != old.region_visible
            || settings.desktop_card != old.desktop_card)
    {
        return Err("请先完成桌面位置调整，再修改装饰区域".into());
    }
    let display_changed = settings.enabled != old.enabled
        || settings.desktop_card != old.desktop_card
        || settings.display_bounds() != old.display_bounds()
        || (settings.enabled
            && settings.display_bounds().is_some()
            && !app
                .get_webview_window("overlay")
                .is_some_and(|w| desktop::is_attached(&w)));
    if !editing && display_changed {
        if let Err(error) = apply_display(&app, &settings) {
            let _ = apply_display(&app, &old);
            return Err(error);
        }
    }
    if let Err(error) = settings::write(&state.path, &settings) {
        if !editing && display_changed {
            let _ = apply_display(&app, &old);
        }
        return Err(error);
    }
    *state.settings.lock().map_err(|e| e.to_string())? = settings.clone();
    *state.config_error.lock().map_err(|e| e.to_string())? = None;
    if !editing {
        state
            .status
            .lock()
            .map_err(|e| e.to_string())?
            .desktop_error = None;
    }
    app.emit("settings-changed", &settings)
        .map_err(|e| e.to_string())?;
    Ok(settings)
}

fn change_editing(app: &AppHandle, state: &AppState, editing: bool) -> Result<Settings, String> {
    let _operation = state.operation.lock().map_err(|e| e.to_string())?;
    let mut settings = state.settings.lock().map_err(|e| e.to_string())?.clone();
    if state.status.lock().map_err(|e| e.to_string())?.editing == editing {
        return Ok(settings);
    }
    let window = app.get_webview_window("overlay").ok_or("找不到频谱窗口")?;
    if editing {
        if !settings.regions.is_empty() || !settings.region_visible || settings.desktop_card.enabled
        {
            return Err("多个区域请在设置预览中布置".into());
        }
        if let Err(error) = desktop::begin_edit(&window, &settings.bounds) {
            let _ = apply_display(app, &settings);
            return Err(error);
        }
    } else {
        settings.bounds = desktop::read_bounds(&window)?;
        settings.validate()?;
        if let Err(error) = apply_display(app, &settings) {
            let _ = desktop::begin_edit(&window, &settings.bounds);
            return Err(error);
        }
        if let Err(error) = settings::write(&state.path, &settings) {
            let _ = desktop::begin_edit(&window, &settings.bounds);
            return Err(error);
        }
        *state.settings.lock().map_err(|e| e.to_string())? = settings.clone();
    }
    state.status.lock().map_err(|e| e.to_string())?.editing = editing;
    if !editing {
        app.emit("geometry-changed", &settings)
            .map_err(|e| e.to_string())?;
    }
    app.emit("settings-changed", &settings)
        .map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
async fn set_editing(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    editing: bool,
) -> Result<Settings, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || change_editing(&app, &state, editing))
        .await
        .map_err(|error| error.to_string())?
}

fn show_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn start_desktop_recovery(app: AppHandle, state: Arc<AppState>) {
    std::thread::spawn(move || {
        while !state.shutdown.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_secs(3));
            if state.shutdown.load(Ordering::Relaxed) {
                break;
            }
            // Window creation must stay on this worker, including recovery of
            // the card controls and a destroyed overlay. Never block the event
            // loop on the operation mutex while a worker needs it to build.
            let Ok(_guard) = state.operation.try_lock() else {
                continue;
            };
            if state.status.lock().unwrap().editing {
                continue;
            }
            let settings = state.settings.lock().unwrap().clone();
            let result = (|| {
                card_window::sync(&app, &settings)?;
                if !settings.enabled || settings.display_bounds().is_none() {
                    return Ok(());
                }
                if app
                    .get_webview_window("overlay")
                    .is_some_and(|w| desktop::is_attached(&w))
                {
                    return Ok(());
                }
                if app.get_webview_window("overlay").is_none() {
                    let config = app
                        .config()
                        .app
                        .windows
                        .iter()
                        .find(|c| c.label == "overlay")
                        .ok_or("找不到效果窗口配置")?;
                    tauri::WebviewWindowBuilder::from_config(&app, config)
                        .map_err(|e| e.to_string())?
                        .build()
                        .map_err(|e| e.to_string())?;
                }
                apply_display(&app, &settings)
            })();
            state.status.lock().unwrap().desktop_error = result.err();
        }
    });
}

pub fn run() {
    #[cfg(windows)]
    if rail::attribute_helper::entry() {
        return;
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_settings(app)
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--autostart"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            application::application_info,
            application::get_preferences,
            application::save_preferences,
            application::backup_configuration,
            application::export_diagnostics,
            application::export_scene,
            application::quit_application,
            application::restart_after_update,
            wallpaper::get_desktop_background,
            wallpaper_depth::save_depth_image,
            wallpaper_depth::load_depth_image,
            wallpaper_depth::desktop_pointer,
            audio_source::get_audio_sources,
            audio_source::set_audio_source,
            now_playing::get_now_playing,
            card_controls::control_card_media,
            card_window::card_hit_regions,
            card_window::debug_card_hit_test,
            lyrics::get_current_lyrics,
            lyrics::discovery::rescan_lyric_locations,
            rail::rail_get,
            rail::rail_change,
            rail::rail_add_paths,
            rail::transfer::rail_paste_image,
            rail::transfer::rail_drag_out,
            rail::detach::rail_detach,
            rail::transfer::rail_double_click_interval,
            rail::rail_pick,
            rail::rail_desktop_entries,
            rail::rail_open,
            rail::folder::rail_folder_contents,
            rail::folder::rail_folder_open,
            rail::rail_media,
            rail::popup_window::rail_popup,
            rail::popup_window::rail_popup_get,
            rail::popup_window::rail_popup_resize,
            rail::popup_window::rail_popup_hide,
            rail::popup_window::rail_popup_select,
            rail::rail_hit_regions,
            get_settings,
            debug_desktop_state,
            rail::debug_rail_drop_state,
            get_status,
            update_settings,
            apply_scene,
            system_tray::sync_scene_shortcuts,
            set_editing,
            reset_settings
        ])
        .setup(|app| {
            // Keep the roomier default inside smaller or high-DPI work areas.
            if let Some(window) = app.get_webview_window("settings") {
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let area = monitor.work_area();
                    let scale = monitor.scale_factor();
                    let width = (area.size.width as f64 / scale - 48.0).clamp(1.0, 1440.0);
                    let height = (area.size.height as f64 / scale - 48.0).clamp(1.0, 940.0);
                    let _ = window.set_min_size(Some(tauri::LogicalSize::new(
                        width.min(900.0),
                        height.min(620.0),
                    )));
                    let _ = window.set_size(tauri::LogicalSize::new(width, height));
                    let _ = window.set_position(tauri::PhysicalPosition::new(
                        area.position.x
                            + ((area.size.width as f64 - width * scale) / 2.0).round() as i32,
                        area.position.y
                            + ((area.size.height as f64 - height * scale) / 2.0).round() as i32,
                    ));
                }
            }
            let path = app.path().app_config_dir()?.join("settings.json");
            let (settings, error) = match settings::read(&path) {
                Ok(value) => (value, None),
                Err(error) => (Settings::default(), Some(error)),
            };
            let state = Arc::new(AppState {
                now_playing: Mutex::new(now_playing::NowPlaying::default()),
                lyric_cache: Mutex::new(lyrics::LyricCache::default()),
                lyric_library: Mutex::new(lyrics::discovery::Library::default()),
                audio_source: Mutex::new(audio_source::read(&path)),
                audio_discovery: Mutex::new(audio_source::Discovery::default()),
                settings: Mutex::new(settings.clone()),
                status: Mutex::new(RuntimeStatus {
                    state: "waiting".into(),
                    message: "正在查找音乐客户端…".into(),
                    process_id: None,
                    source_name: None,
                    desktop_attached: false,
                    editing: false,
                    desktop_error: None,
                }),
                operation: Mutex::new(()),
                config_error: Mutex::new(error),
                path,
                shutdown: AtomicBool::new(false),
            });
            app.manage(state.clone());
            app.manage(rail::RailState::new(app.handle()));
            system_tray::setup(app)?;
            if std::env::args().any(|arg| arg == "--autostart") {
                if let Some(window) = app.get_webview_window("settings") {
                    let _ = window.hide();
                }
            }
            start_desktop_recovery(app.handle().clone(), state.clone());
            now_playing::start(state.clone());
            lyrics::discovery::start(state.clone());
            audio::start(app.handle().clone(), state);
            rail::start(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(windows))]
            if window.label().starts_with("rail-")
                && matches!(event, tauri::WindowEvent::Focused(false))
            {
                let _ = window.emit_to(window.label(), "rail-dismiss-popup", ());
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label().starts_with("rail-popup-") {
                    let _ = window.emit_to(window.label(), "rail-dismiss-popup", ());
                    return;
                }
                if window.label() == "settings"
                    && !application::read_preferences(window.app_handle())
                        .unwrap_or_default()
                        .close_to_tray
                {
                    system_tray::dispatch(window.app_handle(), "quit");
                    return;
                }
                let state = window.app_handle().state::<Arc<AppState>>();
                if state.status.lock().map(|s| s.editing).unwrap_or(false) {
                    let state = state.inner().clone();
                    let window = window.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        if change_editing(window.app_handle(), &state, false).is_err() {
                            show_settings(window.app_handle());
                        } else {
                            let _ = window.hide();
                        }
                    });
                    return;
                }
                if window.label() == "overlay" {
                    if let Some(overlay) = window.app_handle().get_webview_window("overlay") {
                        let _ = desktop::hide(&overlay);
                    }
                } else {
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("SoundSpectra 启动失败");
    app.run(|app, event| {
        if let tauri::RunEvent::Ready = event {
            let app = app.clone();
            let state = app.state::<Arc<AppState>>().inner().clone();
            tauri::async_runtime::spawn_blocking(move || {
                let Ok(_operation) = state.operation.lock() else {
                    return;
                };
                let settings = state.settings.lock().unwrap().clone();
                if settings.enabled {
                    let error = apply_display(&app, &settings).err();
                    state.status.lock().unwrap().desktop_error = error;
                }
            });
        }
        if let tauri::RunEvent::Exit = event {
            app.state::<Arc<AppState>>()
                .shutdown
                .store(true, Ordering::Relaxed);
        }
    });
}
