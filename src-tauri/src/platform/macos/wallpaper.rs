use crate::macos_helper;
use serde::Serialize;
use std::{
    hash::{Hash, Hasher},
    path::PathBuf,
    time::Duration,
};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Serialize)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBackground {
    screen: ScreenRect,
    virtual_screen: ScreenRect,
    position: String,
    color: String,
    image: Option<String>,
    revision: String,
    issue: Option<String>,
}
#[tauri::command]
pub async fn get_desktop_background(
    app: AppHandle,
    window: WebviewWindow,
    known_revision: Option<String>,
) -> Result<DesktopBackground, String> {
    if !["settings", "overlay"].contains(&window.label()) {
        return Err("窗口无权读取桌面壁纸".into());
    }
    let overlay = app
        .get_webview_window("overlay")
        .ok_or("找不到桌面效果窗口")?;
    let monitor = overlay
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("找不到主显示器")?;
    let screen = ScreenRect {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
    };
    let monitors = overlay.available_monitors().map_err(|e| e.to_string())?;
    let left = monitors
        .iter()
        .map(|m| m.position().x)
        .min()
        .unwrap_or(screen.x);
    let top = monitors
        .iter()
        .map(|m| m.position().y)
        .min()
        .unwrap_or(screen.y);
    let right = monitors
        .iter()
        .map(|m| m.position().x as i64 + m.size().width as i64)
        .max()
        .unwrap_or(screen.width as i64);
    let bottom = monitors
        .iter()
        .map(|m| m.position().y as i64 + m.size().height as i64)
        .max()
        .unwrap_or(screen.height as i64);
    let virtual_screen = ScreenRect {
        x: left,
        y: top,
        width: (right - left as i64).max(1) as u32,
        height: (bottom - top as i64).max(1) as u32,
    };
    let result = tauri::async_runtime::spawn_blocking(move || {
        let response = macos_helper::json(&["wallpaper"], Duration::from_secs(5))?;
        let path = PathBuf::from(response["path"].as_str().ok_or("壁纸路径无效")?);
        let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() > 32 * 1024 * 1024 {
            return Err("当前壁纸超过 32 MB，预览使用纯色背景".into());
        }
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut hash);
        metadata.len().hash(&mut hash);
        metadata.modified().ok().hash(&mut hash);
        let revision = format!("{:016x}", hash.finish());
        let image = if known_revision.as_deref() == Some(&revision) {
            None
        } else {
            macos_helper::json(
                &["image", path.to_str().ok_or("壁纸路径无效")?],
                Duration::from_secs(8),
            )?["image"]
                .as_str()
                .map(str::to_owned)
        };
        Ok::<_, String>((revision, image))
    })
    .await
    .map_err(|e| e.to_string())?;
    let (revision, image, issue) = match result {
        Ok((revision, image)) => (revision, image, None),
        Err(error) => ("solid".into(), None, Some(error)),
    };
    Ok(DesktopBackground {
        screen,
        virtual_screen,
        position: "fill".into(),
        color: "#141417".into(),
        image,
        revision,
        issue,
    })
}
