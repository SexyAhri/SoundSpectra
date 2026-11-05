use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::hash::{Hash, Hasher};
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DepthImage {
    data_url: String,
    revision: String,
}

fn validate_image(value: &str) -> Result<(), String> {
    if value.len() > 44 * 1024 * 1024 {
        return Err("图片超过 32 MB".into());
    }
    let (prefix, data) = value.split_once(',').ok_or("图片数据无效")?;
    let bytes = STANDARD.decode(data).map_err(|_| "图片数据无效")?;
    let valid = match prefix {
        "data:image/jpeg;base64" => bytes.starts_with(b"\xff\xd8\xff"),
        "data:image/png;base64" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "data:image/webp;base64" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    if !valid || bytes.len() > 32 * 1024 * 1024 {
        return Err("请选择 32 MB 以内的 JPEG、PNG 或 WebP 图片".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn save_depth_image(
    app: AppHandle,
    window: WebviewWindow,
    data_url: String,
) -> Result<String, String> {
    if window.label() != "settings" {
        return Err("只能在设置窗口选择立体壁纸".into());
    }
    validate_image(&data_url)?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    data_url.hash(&mut hash);
    let revision = format!("{:x}", hash.finish());
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let image = DepthImage {
        data_url,
        revision: revision.clone(),
    };
    let bytes = serde_json::to_vec(&image).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("depth-wallpaper.pending"), bytes).map_err(|e| e.to_string())?;
    std::fs::rename(
        dir.join("depth-wallpaper.pending"),
        dir.join("depth-wallpaper.json"),
    )
    .map_err(|e| e.to_string())?;
    Ok(revision)
}

#[tauri::command]
pub async fn load_depth_image(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<DepthImage>, String> {
    if !["settings", "overlay"].contains(&window.label()) {
        return Err("窗口无权读取立体壁纸".into());
    }
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("depth-wallpaper.json");
    if !path.exists() {
        return Ok(None);
    }
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 44 * 1024 * 1024 {
        return Err("立体壁纸文件过大".into());
    }
    let image: DepthImage =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|_| "立体壁纸文件损坏，请重新选择图片")?;
    validate_image(&image.data_url)?;
    Ok(Some(image))
}

#[tauri::command]
pub fn desktop_pointer(app: AppHandle, window: WebviewWindow) -> Result<[f64; 2], String> {
    if window.label() != "overlay" {
        return Err("只供桌面视差使用".into());
    }
    let monitor = app
        .get_webview_window("overlay")
        .ok_or("桌面窗口未就绪")?
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("主屏幕未就绪")?;
    let point = app.cursor_position().map_err(|e| e.to_string())?;
    Ok([
        ((point.x - monitor.position().x as f64) / monitor.size().width.max(1) as f64 * 2. - 1.)
            .clamp(-1., 1.),
        ((point.y - monitor.position().y as f64) / monitor.size().height.max(1) as f64 * 2. - 1.)
            .clamp(-1., 1.),
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_image_payload_and_rejects_non_image_content() {
        assert!(validate_image("data:image/jpeg;base64,/9j/AA==").is_ok());
        assert!(validate_image("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(validate_image("data:image/jpeg;base64,PHN2Zz4=").is_err());
    }
}
