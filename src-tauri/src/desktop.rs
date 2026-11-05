use crate::settings::Bounds;
use std::ptr::null_mut;
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{SetLastError, HWND, LPARAM, POINT},
    UI::WindowsAndMessaging::*,
};

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

unsafe extern "system" fn find_host(window: HWND, result: LPARAM) -> i32 {
    let view = FindWindowExW(
        window,
        null_mut(),
        wide("SHELLDLL_DefView").as_ptr(),
        std::ptr::null(),
    );
    if !view.is_null() {
        let worker = FindWindowExW(
            null_mut(),
            window,
            wide("WorkerW").as_ptr(),
            std::ptr::null(),
        );
        if !worker.is_null() {
            *(result as *mut HWND) = worker;
            return 0;
        }
    }
    1
}

struct DesktopHost {
    parent: HWND,
    insert_after: HWND,
    wallpaper: Option<HWND>,
}

fn desktop_host(prepare: bool) -> Result<DesktopHost, String> {
    unsafe {
        let progman = FindWindowW(wide("Progman").as_ptr(), std::ptr::null());
        if progman.is_null() {
            return Err("找不到 Windows 桌面，请确认资源管理器正在运行".into());
        }
        // Explorer's WorkerW convention is undocumented. Fail explicitly if this Windows build
        // does not expose it; never place a top-level always-on-top window as a silent fallback.
        if prepare {
            SendMessageTimeoutW(
                progman,
                0x052c,
                0xD,
                1,
                SMTO_ABORTIFHUNG,
                1000,
                std::ptr::null_mut(),
            );
        }
        // Recent Explorer versions keep the icon view and wallpaper WorkerW as
        // siblings under Progman. Our layered child belongs between those two.
        let view = FindWindowExW(
            progman,
            null_mut(),
            wide("SHELLDLL_DefView").as_ptr(),
            std::ptr::null(),
        );
        let wallpaper = FindWindowExW(
            progman,
            null_mut(),
            wide("WorkerW").as_ptr(),
            std::ptr::null(),
        );
        if !view.is_null()
            && !wallpaper.is_null()
            && GetWindowLongPtrW(progman, GWL_EXSTYLE) & WS_EX_NOREDIRECTIONBITMAP as isize != 0
            && IsWindowVisible(view) != 0
            && IsWindowVisible(wallpaper) != 0
        {
            return Ok(DesktopHost {
                parent: progman,
                insert_after: view,
                wallpaper: Some(wallpaper),
            });
        }
        let mut host: HWND = null_mut();
        EnumWindows(Some(find_host), &mut host as *mut HWND as LPARAM);
        if host.is_null() || IsWindowVisible(host) == 0 {
            Err("此 Windows 桌面结构暂未通过兼容验证，未找到图标后方的效果层".into())
        } else {
            Ok(DesktopHost {
                parent: host,
                insert_after: HWND_BOTTOM,
                wallpaper: None,
            })
        }
    }
}

fn hwnd(window: &WebviewWindow) -> Result<HWND, String> {
    window
        .hwnd()
        .map(|handle| handle.0 as HWND)
        .map_err(|e| e.to_string())
}

fn primary_geometry(
    window: &WebviewWindow,
    bounds: &Bounds,
) -> Result<(i32, i32, i32, i32), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("找不到主显示器")?;
    let origin = monitor.position();
    let size = monitor.size();
    Ok((
        origin.x + (bounds.x * size.width as f64).round() as i32,
        origin.y + (bounds.y * size.height as f64).round() as i32,
        (bounds.width * size.width as f64).round() as i32,
        (bounds.height * size.height as f64).round() as i32,
    ))
}

pub fn attach(window: &WebviewWindow, bounds: &Bounds) -> Result<(), String> {
    let host = desktop_host(true)?;
    let handle = hwnd(window)?;
    let (x, y, width, height) = primary_geometry(window, bounds)?;
    unsafe {
        // Own the overlay styles here: Tao's high-level style setters rebuild
        // them from its original top-level window state and would undo WS_CHILD.
        ShowWindow(handle, SW_HIDE);
        SetWindowPos(
            handle,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
        let old_style = GetWindowLongPtrW(handle, GWL_STYLE);
        SetWindowLongPtrW(
            handle,
            GWL_STYLE,
            (old_style & !((WS_POPUP | WS_CAPTION | WS_THICKFRAME) as isize)) | WS_CHILD as isize,
        );
        let extended = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        SetWindowLongPtrW(
            handle,
            GWL_EXSTYLE,
            (extended & !((WS_EX_APPWINDOW | WS_EX_TOPMOST) as isize))
                | (WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_LAYERED)
                    as isize,
        );
        if SetLayeredWindowAttributes(handle, 0, 255, LWA_ALPHA) == 0 {
            return Err(format!(
                "设置透明桌面层失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        SetLastError(0);
        SetParent(handle, host.parent);
        let parent_error = std::io::Error::last_os_error();
        // A successful SetParent may leave a nonzero last-error value after
        // synchronous window callbacks. Check the resulting parent instead.
        if GetParent(handle) != host.parent {
            SetWindowLongPtrW(handle, GWL_STYLE, old_style);
            return Err(format!("嵌入桌面失败：{parent_error}"));
        }
        let mut point = POINT { x, y };
        windows_sys::Win32::Graphics::Gdi::MapWindowPoints(null_mut(), host.parent, &mut point, 1);
        if SetWindowPos(
            handle,
            host.insert_after,
            point.x,
            point.y,
            width,
            height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        ) == 0
        {
            return Err(format!(
                "设置桌面尺寸失败：{}",
                std::io::Error::last_os_error()
            ));
        }
    }
    Ok(())
}

pub fn begin_edit(window: &WebviewWindow, bounds: &Bounds) -> Result<(), String> {
    let handle = hwnd(window)?;
    let (x, y, width, height) = primary_geometry(window, bounds)?;
    unsafe {
        ShowWindow(handle, SW_HIDE);
        SetLastError(0);
        SetParent(handle, null_mut());
        let parent_error = std::io::Error::last_os_error();
        // WS_CHILD is removed below; until then Win32 reports the desktop HWND
        // (rather than NULL) after a successful detach.
        let parent = GetParent(handle);
        if !parent.is_null() && parent != GetDesktopWindow() {
            return Err(parent_error.to_string());
        }
        let style = GetWindowLongPtrW(handle, GWL_STYLE);
        SetWindowLongPtrW(
            handle,
            GWL_STYLE,
            (style & !(WS_CHILD as isize)) | WS_POPUP as isize,
        );
        let extended = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        SetWindowLongPtrW(
            handle,
            GWL_EXSTYLE,
            extended & !((WS_EX_NOACTIVATE | WS_EX_TRANSPARENT | WS_EX_LAYERED) as isize),
        );
        if SetWindowPos(
            handle,
            HWND_TOPMOST,
            x,
            y,
            width,
            height,
            SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        ) == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        SetForegroundWindow(handle);
    }
    Ok(())
}

pub fn hide(window: &WebviewWindow) -> Result<(), String> {
    unsafe {
        ShowWindow(hwnd(window)?, SW_HIDE);
    }
    Ok(())
}

pub fn read_bounds(window: &WebviewWindow) -> Result<Bounds, String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("找不到主显示器")?;
    let point = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let screen = monitor.size();
    let origin = monitor.position();
    let width = (size.width as f64 / screen.width as f64).clamp(0.2, 1.0);
    let height = (size.height as f64 / screen.height as f64).clamp(0.08, 1.0);
    Ok(Bounds {
        x: ((point.x - origin.x) as f64 / screen.width as f64).clamp(0.0, 1.0 - width),
        y: ((point.y - origin.y) as f64 / screen.height as f64).clamp(0.0, 1.0 - height),
        width,
        height,
    })
}

pub fn is_attached(window: &WebviewWindow) -> bool {
    let Ok(handle) = hwnd(window) else {
        return false;
    };
    // Changing wallpaper can recreate/reorder WorkerW while Progman and our HWND
    // remain alive. Parent class + visibility alone incorrectly reports success.
    // Resolve the current host without sending Explorer's creation message.
    let Ok(host) = desktop_host(false) else {
        return false;
    };
    unsafe {
        let extended = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        GetParent(handle) == host.parent
            && IsWindow(host.parent) != 0
            && IsWindowVisible(host.parent) != 0
            && IsWindowVisible(handle) != 0
            && GetWindowLongPtrW(handle, GWL_STYLE) & WS_CHILD as isize != 0
            && extended & WS_EX_TRANSPARENT as isize != 0
            && extended & WS_EX_NOACTIVATE as isize != 0
            && extended & WS_EX_TOPMOST as isize == 0
            && host.wallpaper.is_none_or(|wallpaper| {
                sibling_on_side(handle, host.insert_after, GW_HWNDPREV)
                    && sibling_on_side(handle, wallpaper, GW_HWNDNEXT)
            })
    }
}

unsafe fn sibling_on_side(window: HWND, target: HWND, direction: u32) -> bool {
    let mut sibling = GetWindow(window, direction);
    for _ in 0..512 {
        if sibling.is_null() {
            break;
        }
        if sibling == target {
            return true;
        }
        sibling = GetWindow(sibling, direction);
    }
    false
}

pub fn diagnostics(window: &WebviewWindow) -> Result<serde_json::Value, String> {
    let handle = hwnd(window)?;
    unsafe {
        let parent = GetParent(handle);
        let mut class = [0u16; 256];
        let length = GetClassNameW(parent, class.as_mut_ptr(), class.len() as i32).max(0) as usize;
        let mut rect: windows_sys::Win32::Foundation::RECT = std::mem::zeroed();
        GetWindowRect(handle, &mut rect);
        let style = GetWindowLongPtrW(handle, GWL_STYLE);
        let ex_style = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        let parent_class = String::from_utf16_lossy(&class[..length]);
        let view = FindWindowExW(
            parent,
            null_mut(),
            wide("SHELLDLL_DefView").as_ptr(),
            std::ptr::null(),
        );
        let wallpaper = FindWindowExW(
            parent,
            null_mut(),
            wide("WorkerW").as_ptr(),
            std::ptr::null(),
        );
        let between_desktop_layers = parent_class == "Progman"
            && !view.is_null()
            && !wallpaper.is_null()
            && sibling_on_side(handle, view, GW_HWNDPREV)
            && sibling_on_side(handle, wallpaper, GW_HWNDNEXT);
        Ok(serde_json::json!({
            "handle": handle as usize,
            "processId": std::process::id(),
            "wallpaper": wallpaper as usize,
            "iconView": view as usize,
            "attached": is_attached(window),
            "parentClass": parent_class,
            "betweenDesktopLayers": between_desktop_layers,
            "parent": parent as usize,
            "visible": IsWindowVisible(handle) != 0,
            "child": style & WS_CHILD as isize != 0,
            "transparent": ex_style & WS_EX_TRANSPARENT as isize != 0,
            "noActivate": ex_style & WS_EX_NOACTIVATE as isize != 0,
            "topmost": ex_style & WS_EX_TOPMOST as isize != 0,
            "rect": [rect.left, rect.top, rect.right, rect.bottom],
        }))
    }
}
