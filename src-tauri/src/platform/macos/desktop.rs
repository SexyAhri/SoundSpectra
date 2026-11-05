use crate::settings::Bounds;
use std::{
    ffi::{c_char, c_void, CStr},
    sync::mpsc,
    time::Duration,
};
use tauri::WebviewWindow;

#[link(name = "objc")]
extern "C" {
    fn objc_getClass(name: *const c_char) -> *mut c_void;
    fn sel_registerName(name: *const c_char) -> *mut c_void;
    fn objc_msgSend();
}
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowLevelForKey(key: i32) -> i32;
}
unsafe fn get_int(object: *mut c_void, method: &CStr) -> isize {
    let send: unsafe extern "C" fn(*mut c_void, *mut c_void) -> isize =
        std::mem::transmute(objc_msgSend as *const ());
    send(object, sel_registerName(method.as_ptr()))
}
unsafe fn get_bool(object: *mut c_void, method: &CStr) -> bool {
    let send: unsafe extern "C" fn(*mut c_void, *mut c_void) -> i8 =
        std::mem::transmute(objc_msgSend as *const ());
    send(object, sel_registerName(method.as_ptr())) != 0
}
unsafe fn set_int(object: *mut c_void, method: &CStr, value: isize) {
    let send: unsafe extern "C" fn(*mut c_void, *mut c_void, isize) =
        std::mem::transmute(objc_msgSend as *const ());
    send(object, sel_registerName(method.as_ptr()), value)
}
unsafe fn set_bool(object: *mut c_void, method: &CStr, value: bool) {
    let send: unsafe extern "C" fn(*mut c_void, *mut c_void, i8) =
        std::mem::transmute(objc_msgSend as *const ());
    send(object, sel_registerName(method.as_ptr()), i8::from(value))
}
fn on_main<T: Send + 'static>(
    window: &WebviewWindow,
    operation: impl FnOnce(*mut c_void) -> T + Send + 'static,
) -> Result<T, String> {
    // AppKit calls must stay on the main thread, including recovery/diagnostics.
    if unsafe { get_bool(objc_getClass(c"NSThread".as_ptr()), c"isMainThread") } {
        return window.ns_window().map(operation).map_err(|e| e.to_string());
    }
    let (tx, rx) = mpsc::sync_channel(1);
    let owned = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(owned.ns_window().map(operation).map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "桌面窗口响应超时".to_string())?
}
fn configure(window: &WebviewWindow, bounds: &Bounds, editing: bool) -> Result<(), String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("找不到主显示器")?;
    let size = monitor.size();
    let origin = monitor.position();
    window.hide().map_err(|e| e.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(
            (size.width as f64 * bounds.width).round() as u32,
            (size.height as f64 * bounds.height).round() as u32,
        ))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(
            origin.x + (size.width as f64 * bounds.x).round() as i32,
            origin.y + (size.height as f64 * bounds.y).round() as i32,
        ))
        .map_err(|e| e.to_string())?;
    window.set_resizable(editing).map_err(|e| e.to_string())?;
    on_main(window, move |native| unsafe {
        // kCGDesktopWindowLevelKey = 2. One level above wallpaper, below Finder icons.
        set_int(
            native,
            c"setLevel:",
            if editing {
                3
            } else {
                CGWindowLevelForKey(2) as isize + 1
            },
        );
        set_int(native, c"setCollectionBehavior:", 1 | 16 | 64);
        set_bool(native, c"setIgnoresMouseEvents:", !editing);
        set_bool(native, c"setHasShadow:", false);
        set_bool(native, c"setHidesOnDeactivate:", false);
    })?;
    window.show().map_err(|e| e.to_string())?;
    if editing {
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn attach(window: &WebviewWindow, bounds: &Bounds) -> Result<(), String> {
    configure(window, bounds, false)
}
pub fn begin_edit(window: &WebviewWindow, bounds: &Bounds) -> Result<(), String> {
    configure(window, bounds, true)
}
pub fn hide(window: &WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
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
    window.is_visible().unwrap_or(false)
        && on_main(window, |native| unsafe {
            get_int(native, c"level") == CGWindowLevelForKey(2) as isize + 1
                && get_bool(native, c"ignoresMouseEvents")
        })
        .unwrap_or(false)
}
pub fn diagnostics(window: &WebviewWindow) -> Result<serde_json::Value, String> {
    let attached = is_attached(window);
    on_main(window, move |native| unsafe {
        serde_json::json!({"platform":"macos", "attached":attached, "level":get_int(native,c"level"), "clickThrough":get_bool(native,c"ignoresMouseEvents")})
    })
}
