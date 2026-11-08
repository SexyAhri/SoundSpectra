use crate::{desktop, settings, AppState};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    pub close_to_tray: bool,
    pub auto_check_updates: bool,
    pub auto_install_updates: bool,
    pub show_update_button: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            auto_check_updates: true,
            auto_install_updates: true,
            show_update_button: true,
        }
    }
}

fn settings_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("此操作仅供设置窗口使用".into());
    }
    Ok(())
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("preferences.json"))
}
pub fn read_preferences(app: &AppHandle) -> Result<Preferences, String> {
    let path = preferences_path(app)?;
    if !path.exists() {
        return Ok(Preferences::default());
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("应用偏好读取失败：{e}"))
}

#[tauri::command]
pub fn get_preferences(window: WebviewWindow, app: AppHandle) -> Result<Preferences, String> {
    settings_window(&window)?;
    read_preferences(&app)
}

#[tauri::command]
pub async fn save_preferences(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    preferences: Preferences,
) -> Result<Preferences, String> {
    settings_window(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = state.operation.lock().map_err(|e| e.to_string())?;
        let path = preferences_path(&app)?;
        std::fs::create_dir_all(path.parent().ok_or("无法定位配置目录")?)
            .map_err(|e| e.to_string())?;
        let tmp = path.with_extension("tmp");
        std::fs::write(
            &tmp,
            serde_json::to_vec_pretty(&preferences).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        std::fs::rename(tmp, path).map_err(|e| e.to_string())?;
        Ok(preferences)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn application_info(app: AppHandle) -> serde_json::Value {
    let repository = app
        .config()
        .plugins
        .0
        .get("distribution")
        .and_then(|v| v.get("repository"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let updater = app.config().plugins.0.get("updater");
    let configured = updater
        .and_then(|v| v.get("pubkey"))
        .and_then(|v| v.as_str())
        .is_some_and(|v| !v.is_empty())
        && updater
            .and_then(|v| v.get("endpoints"))
            .and_then(|v| v.as_array())
            .is_some_and(|v| !v.is_empty());
    serde_json::json!({ "version": app.package_info().version.to_string(), "repository": repository,
        "updaterConfigured": configured && !cfg!(debug_assertions), "development": cfg!(debug_assertions) })
}

#[tauri::command]
pub fn restart_after_update(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    settings_window(&window)?;
    #[cfg(target_os = "macos")]
    app.restart();
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

pub fn backup(app: &AppHandle, state: &AppState) -> Result<PathBuf, String> {
    let _guard = state.operation.lock().map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let folder = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("backups")
        .join(format!("{}-{stamp}", app.package_info().version));
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    if state.path.exists() {
        std::fs::copy(&state.path, folder.join("settings.json")).map_err(|e| e.to_string())?;
    } else {
        let current = state.settings.lock().map_err(|e| e.to_string())?;
        settings::write(&folder.join("settings.json"), &current)?;
    }
    let preferences = preferences_path(app)?;
    if preferences.exists() {
        std::fs::copy(preferences, folder.join("preferences.json")).map_err(|e| e.to_string())?;
    }
    let audio_source = crate::audio_source::path(&state.path);
    let rail_path = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("rail.json");
    if rail_path.exists() {
        std::fs::copy(rail_path, folder.join("rail.json")).map_err(|e| e.to_string())?;
    }
    let images = app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("rail-images");
    if images.exists() {
        let destination = folder.join("rail-images");
        std::fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(images).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().map_err(|e| e.to_string())?.is_file() {
                std::fs::copy(entry.path(), destination.join(entry.file_name()))
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    if audio_source.exists() {
        std::fs::copy(audio_source, folder.join("audio-source.json")).map_err(|e| e.to_string())?;
    }
    Ok(folder)
}

#[tauri::command]
pub async fn backup_configuration(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    settings_window(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let editing = state.status.lock().map_err(|e| e.to_string())?.editing;
        if editing {
            crate::change_editing(&app, &state, false)?;
        }
        Ok(backup(&app, &state)?.display().to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn export_diagnostics(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<String, String> {
    settings_window(&window)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("diagnostics");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let file = folder.join(format!("SoundSpectra-{stamp}.json"));
    let mut current_status = state.status.lock().map_err(|e| e.to_string())?.clone();
    current_status.desktop_attached = app
        .get_webview_window("overlay")
        .is_some_and(|w| desktop::is_attached(&w));
    let data = serde_json::json!({
        "application": application_info(app.clone()), "architecture": std::env::consts::ARCH,
        "status": current_status,
        "settings": state.settings.lock().map_err(|e| e.to_string())?.clone(),
        "audioSource": state.audio_source.lock().map_err(|e| e.to_string())?.selection.clone(),
        "audioDiscovery": state.audio_discovery.lock().map_err(|e| e.to_string())?.clone(),
        "desktop": app.get_webview_window("overlay").map(|w| desktop::diagnostics(&w)),
    });
    std::fs::write(
        &file,
        serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    // Shell calls may block; returning the saved file must not wait for Explorer.
    let reveal_file = file.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = app.opener().reveal_item_in_dir(reveal_file);
    });
    Ok(file.display().to_string())
}

#[tauri::command]
pub async fn quit_application(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    settings_window(&window)?;
    let state = state.inner().clone();
    let target = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::change_editing(&target, &state, false)?;
        crate::rail::restore_desktop(&target)
    })
    .await
    .map_err(|error| error.to_string())??;
    app.exit(0);
    Ok(())
}

fn scene_document(name: &str, settings: &settings::Settings) -> Result<serde_json::Value, String> {
    if name.trim().is_empty() || name.chars().count() > 40 {
        return Err("场景名称无效".into());
    }
    settings.validate()?;
    let mut scene = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    let object = scene.as_object_mut().ok_or("场景格式无效")?;
    for key in ["version", "enabled", "quality"] {
        object.remove(key);
    }
    Ok(
        serde_json::json!({ "format": "SoundSpectra.scene", "version": 1, "name": name.trim(), "scene": scene }),
    )
}

#[tauri::command]
pub fn export_scene(
    window: WebviewWindow,
    app: AppHandle,
    name: String,
    settings: settings::Settings,
) -> Result<String, String> {
    settings_window(&window)?;
    let data = scene_document(&name, &settings)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("scenes");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let file = folder.join(format!("SoundSpectra-{stamp}.scene.json"));
    std::fs::write(
        &file,
        serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let reveal = file.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = app.opener().reveal_item_in_dir(reveal);
    });
    Ok(format!("已导出（不含壁纸图片）：{}", file.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exported_scene_excludes_device_state_and_wallpaper() {
        let settings = settings::Settings::default();
        let data = scene_document("晚风", &settings).unwrap();
        assert_eq!(data["format"], "SoundSpectra.scene");
        let scene = data["scene"].as_object().unwrap();
        for key in ["enabled", "quality", "version", "wallpaper", "image"] {
            assert!(!scene.contains_key(key));
        }
        assert!(scene.contains_key("atmosphere") && scene.contains_key("masks"));
        assert!(scene_document("", &settings).is_err());
    }
    #[test]
    fn earlier_preferences_receive_safe_defaults() {
        let preferences: Preferences = serde_json::from_str(r#"{"closeToTray":false}"#).unwrap();
        assert!(!preferences.close_to_tray);
        assert!(preferences.auto_check_updates);
        assert!(preferences.auto_install_updates);
        assert!(preferences.show_update_button);
    }

    #[test]
    #[ignore = "Requires the public GitHub release service; read-only updater integration"]
    fn public_update_manifest_uses_the_native_updater_schema() {
        let version = std::env::var("SOUNDSPECTRA_RELEASE_TEST_VERSION")
            .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").into());
        let endpoint = format!(
            "https://github.com/SexyAhri/SoundSpectra/releases/download/v{version}/latest.json"
        );
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .unwrap();
        let release: tauri_plugin_updater::RemoteRelease = client
            .get(endpoint)
            .send()
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .unwrap();
        assert_eq!(release.version.to_string(), version);
        for platform in ["windows-x86_64", "darwin-aarch64", "darwin-x86_64"] {
            let url = release.download_url(platform).unwrap();
            assert_eq!(url.scheme(), "https");
            assert_eq!(url.host_str(), Some("github.com"));
            assert!(url
                .path()
                .contains(&format!("/releases/download/v{version}/")));
            assert!(!release.signature(platform).unwrap().is_empty());
        }
    }
}
