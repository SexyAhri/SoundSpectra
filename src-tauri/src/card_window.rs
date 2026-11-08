use crate::settings::Settings;
use serde::Deserialize;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Deserialize)]
pub struct HitRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

// May lazily build a WebView2 window. Call only from a worker, never a
// synchronous command or event-loop callback (including startup/recovery).
pub fn sync(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    #[cfg(windows)]
    {
        native::sync(app, settings)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, settings);
        Ok(())
    }
}

#[tauri::command]
pub async fn card_hit_regions(window: WebviewWindow, regions: Vec<HitRect>) -> Result<(), String> {
    if window.label() != "card-controls"
        || regions.len() > 4
        || regions.iter().any(|rect| {
            ![rect.x, rect.y, rect.width, rect.height]
                .iter()
                .all(|value| value.is_finite() && *value >= 0.0 && *value < 10000.0)
        })
    {
        return Err("音乐控制区域无效".into());
    }
    #[cfg(windows)]
    {
        let target = window.clone();
        let (sender, receiver) = tokio::sync::oneshot::channel();
        window
            .run_on_main_thread(move || {
                let _ = sender.send(native::regions(&target, &regions));
            })
            .map_err(|error| error.to_string())?;
        receiver.await.map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = regions;
        Ok(())
    }
}

#[tauri::command]
pub fn debug_card_hit_test(
    app: AppHandle,
    points: Vec<[f64; 2]>,
) -> Result<serde_json::Value, String> {
    if !cfg!(debug_assertions)
        || points.len() > 16
        || points
            .iter()
            .flatten()
            .any(|value| !value.is_finite() || value.abs() > 10000.0)
    {
        return Err("仅用于开发验证".into());
    }
    #[cfg(windows)]
    {
        native::diagnostics(
            &app.get_webview_window("card-controls")
                .ok_or("未启用音乐控制")?,
            &points,
        )
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("当前平台未提供桌面音乐控制".into())
    }
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, POINT, RECT},
        Graphics::Gdi::*,
        UI::WindowsAndMessaging::*,
    };
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    unsafe extern "system" fn find_view(window: HWND, output: LPARAM) -> i32 {
        let view = FindWindowExW(
            window,
            null_mut(),
            wide("SHELLDLL_DefView").as_ptr(),
            null(),
        );
        if view.is_null() {
            1
        } else {
            *(output as *mut HWND) = view;
            0
        }
    }
    pub fn sync(app: &AppHandle, settings: &Settings) -> Result<(), String> {
        if !settings.enabled || !settings.desktop_card.enabled {
            if let Some(window) = app.get_webview_window("card-controls") {
                window.hide().map_err(|error| error.to_string())?;
            }
            return Ok(());
        }
        let existing = app.get_webview_window("card-controls");
        let created = existing.is_none();
        let window = match existing {
            Some(window) => window,
            None => tauri::WebviewWindowBuilder::new(
                app,
                "card-controls",
                tauri::WebviewUrl::App("index.html?window=card-controls".into()),
            )
            .title("SoundSpectra 音乐控制")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .resizable(false)
            .build()
            .map_err(|error| error.to_string())?,
        };
        let handle = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
        let monitor = window
            .primary_monitor()
            .map_err(|error| error.to_string())?
            .ok_or("找不到主显示器")?;
        let bounds = &settings.desktop_card.bounds;
        let size = monitor.size();
        let origin = monitor.position();
        let x = origin.x + (bounds.x * size.width as f64).round() as i32;
        let y = origin.y + (bounds.y * size.height as f64).round() as i32;
        let width = (bounds.width * size.width as f64).round().max(1.0) as i32;
        let height = (bounds.height * size.height as f64).round().max(1.0) as i32;
        unsafe {
            let mut parent: HWND = null_mut();
            EnumWindows(Some(find_view), &mut parent as *mut HWND as LPARAM);
            if parent.is_null() {
                let _ = window.hide();
                return Err("找不到桌面音乐控制挂载层".into());
            }
            let mut current: RECT = std::mem::zeroed();
            GetWindowRect(handle, &mut current);
            let changing = GetParent(handle) != parent
                || (
                    current.left,
                    current.top,
                    current.right - current.left,
                    current.bottom - current.top,
                ) != (x, y, width, height);
            if changing || created {
                let style = GetWindowLongPtrW(handle, GWL_STYLE);
                SetWindowLongPtrW(
                    handle,
                    GWL_STYLE,
                    (style & !((WS_POPUP | WS_CAPTION | WS_THICKFRAME) as isize))
                        | WS_CHILD as isize,
                );
                let extended = GetWindowLongPtrW(handle, GWL_EXSTYLE);
                SetWindowLongPtrW(
                    handle,
                    GWL_EXSTYLE,
                    (extended & !((WS_EX_APPWINDOW | WS_EX_TRANSPARENT | WS_EX_TOPMOST) as isize))
                        | (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_LAYERED) as isize,
                );
                if SetLayeredWindowAttributes(handle, 0, 255, LWA_ALPHA) == 0 {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                if created {
                    SetWindowRgn(handle, CreateRectRgn(0, 0, 0, 0), 0);
                }
                if GetParent(handle) != parent {
                    SetParent(handle, parent);
                }
                if GetParent(handle) != parent {
                    return Err("音乐控制挂载失败".into());
                }
                let mut point = POINT { x, y };
                MapWindowPoints(null_mut(), parent, &mut point, 1);
                if SetWindowPos(
                    handle,
                    HWND_TOP,
                    point.x,
                    point.y,
                    width,
                    height,
                    SWP_NOACTIVATE | SWP_FRAMECHANGED,
                ) == 0
                {
                    return Err(std::io::Error::last_os_error().to_string());
                }
            }
            if !created {
                ShowWindow(handle, SW_SHOWNOACTIVATE);
            }
        }
        Ok(())
    }
    pub fn regions(window: &WebviewWindow, regions: &[HitRect]) -> Result<(), String> {
        let handle = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        unsafe {
            let combined = CreateRectRgn(0, 0, 0, 0);
            if combined.is_null() {
                return Err("无法创建音乐按钮区域".into());
            }
            for rect in regions {
                let part = CreateRectRgn(
                    (rect.x * scale).floor() as i32,
                    (rect.y * scale).floor() as i32,
                    ((rect.x + rect.width) * scale).ceil() as i32,
                    ((rect.y + rect.height) * scale).ceil() as i32,
                );
                if part.is_null() {
                    DeleteObject(combined);
                    return Err("无法创建音乐按钮区域".into());
                }
                CombineRgn(combined, combined, part, RGN_OR);
                DeleteObject(part);
            }
            if SetWindowRgn(handle, combined, 1) == 0 {
                DeleteObject(combined);
                return Err(std::io::Error::last_os_error().to_string());
            }
        }
        let state = window.state::<std::sync::Arc<crate::AppState>>();
        let settings = state.settings.lock().map_err(|error| error.to_string())?;
        if settings.enabled && settings.desktop_card.enabled {
            unsafe {
                ShowWindow(handle, SW_SHOWNOACTIVATE);
            }
        }
        Ok(())
    }
    pub fn diagnostics(
        window: &WebviewWindow,
        points: &[[f64; 2]],
    ) -> Result<serde_json::Value, String> {
        let handle = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        unsafe {
            let parent = GetParent(handle);
            let region = CreateRectRgn(0, 0, 0, 0);
            if region.is_null() {
                return Err("无法读取控制区域".into());
            }
            GetWindowRgn(handle, region);
            let mut bounds: RECT = std::mem::zeroed();
            GetWindowRect(handle, &mut bounds);
            let samples: Vec<_> = points.iter().map(|point| {
                let x = (point[0] * scale).round() as i32;
                let y = (point[1] * scale).round() as i32;
                let mut in_parent = POINT { x: bounds.left + x, y: bounds.top + y };
                MapWindowPoints(null_mut(), parent, &mut in_parent, 1);
                let routed = ChildWindowFromPointEx(parent, in_parent, CWP_SKIPDISABLED | CWP_SKIPINVISIBLE | CWP_SKIPTRANSPARENT);
                let hit = WindowFromPoint(POINT { x: bounds.left + x, y: bounds.top + y });
                serde_json::json!({ "point": point, "inRegion": PtInRegion(region, x, y) != 0, "routedToControls": routed == handle, "screenHitControls": hit == handle || IsChild(handle, hit) != 0 })
            }).collect();
            DeleteObject(region);
            Ok(
                serde_json::json!({ "handle": handle as usize, "parent": parent as usize, "visible": IsWindowVisible(handle) != 0, "noActivate": GetWindowLongPtrW(handle, GWL_EXSTYLE) & WS_EX_NOACTIVATE as isize != 0, "topmost": GetWindowLongPtrW(handle, GWL_EXSTYLE) & WS_EX_TOPMOST as isize != 0, "scale": scale, "rect": [bounds.left,bounds.top,bounds.right,bounds.bottom], "samples": samples }),
            )
        }
    }
}
