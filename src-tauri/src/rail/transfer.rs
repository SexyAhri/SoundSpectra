use super::{allowed, RailState, Snapshot};
use tauri::{AppHandle, State, WebviewWindow};

#[cfg(windows)]
#[path = "transfer_windows.rs"]
mod platform;

#[tauri::command]
pub fn rail_double_click_interval() -> u32 {
    #[cfg(windows)]
    {
        unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime() }
    }
    #[cfg(not(windows))]
    {
        500
    }
}

#[tauri::command]
pub async fn rail_paste_image(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, RailState>,
    group_id: String,
) -> Result<Snapshot, String> {
    allowed(&window)?;
    #[cfg(windows)]
    {
        // Check capacity before reading the clipboard or creating an owned asset.
        {
            let settings = state.settings.lock().map_err(|e| e.to_string())?;
            let settings = settings.as_ref().map_err(Clone::clone)?;
            let group = settings
                .groups
                .iter()
                .find(|g| g.id == group_id)
                .ok_or("找不到这组拾光绳")?;
            if group.items.len() >= 48 {
                return Err("这组已经挂满，请换一组再粘贴".into());
            }
        }
        let bytes = tauri::async_runtime::spawn_blocking(platform::clipboard_png)
            .await
            .map_err(|e| e.to_string())??;
        let id = super::model::new_id();
        use tauri::Manager;
        let folder = app
            .path()
            .app_config_dir()
            .map_err(|e| e.to_string())?
            .join("rail-images");
        let destination = folder.join(format!("{id}.png"));
        let saved_path = destination.clone();
        tauri::async_runtime::spawn_blocking(move || save_image(&folder, &saved_path, &bytes))
            .await
            .map_err(|e| e.to_string())??;
        let result = super::commit(&app, &state, |settings| {
            settings.group_mut(&group_id)?.items.push(super::RailItem {
                id: id.clone(),
                name: "剪贴板图片".into(),
                path: destination.to_string_lossy().into_owned(),
                kind: "image".into(),
                crop: "contain".into(),
                text: String::new(),
                desktop_managed: false,
                desktop_identity: None,
            });
            Ok(())
        });
        // Publishing can fail after the config was saved. Only clean up assets
        // that never became referenced, so a retry cannot break a saved image.
        if result.is_err() {
            let referenced = state
                .settings
                .lock()
                .ok()
                .map(|s| s.as_ref().map(|s| s.item(&id).is_ok()).unwrap_or(true))
                .unwrap_or(true);
            if !referenced {
                let _ = std::fs::remove_file(&destination);
            }
        }
        result
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state, group_id);
        Err("粘贴图片目前需要 Windows 桌面客户端".into())
    }
}

#[cfg(windows)]
fn save_image(
    folder: &std::path::Path,
    path: &std::path::Path,
    bytes: &[u8],
) -> Result<(), String> {
    use std::io::Write;
    std::fs::create_dir_all(folder).map_err(|e| format!("无法保存剪贴板图片：{e}"))?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| format!("无法保存剪贴板图片：{e}"))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = std::fs::remove_file(path);
        return Err(format!("图片保存失败，请重试：{error}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn rail_drag_out(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, RailState>,
    id: String,
) -> Result<bool, String> {
    allowed(&window)?;
    #[cfg(windows)]
    {
        let item = super::saved_item(&state, &id)?;
        let path = if item.kind == "note" {
            use tauri::Manager;
            let folder = app
                .path()
                .app_cache_dir()
                .map_err(|e| e.to_string())?
                .join("rail-drag");
            std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
            let path = folder.join(format!("便签-{}.txt", super::model::new_id()));
            let mut bytes = b"\xef\xbb\xbf".to_vec();
            bytes.extend_from_slice(item.text.as_bytes());
            save_image(&folder, &path, &bytes)?;
            path
        } else {
            super::item_path(&item)?
        };
        let (tx, rx) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(platform::drag_file(&path));
            })
            .map_err(|e| e.to_string())?;
        // The system owns the drag loop until release or Escape. No timeout can
        // abandon a live drag and leave the UI accepting a second operation.
        rx.await.map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state, id);
        Err("拖出文件目前需要 Windows 桌面客户端".into())
    }
}
