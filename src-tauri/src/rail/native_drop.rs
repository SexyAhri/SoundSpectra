use serde::Serialize;
use std::{ffi::OsString, os::windows::ffi::OsStringExt};
use tauri::{Emitter, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
    Graphics::Gdi::ScreenToClient,
    System::Threading::GetCurrentProcessId,
    UI::{Shell::*, WindowsAndMessaging::*},
};

const SUBCLASS_ID: usize = 0x53535244;
struct Target {
    window: WebviewWindow,
    _ole_target: windows::Win32::System::Ole::IDropTarget,
}
#[derive(Clone, Serialize)]
pub(super) struct Position {
    pub x: i32,
    pub y: i32,
}
#[derive(Clone, Serialize)]
pub(super) struct Drop {
    pub paths: Vec<String>,
    pub position: Position,
}

unsafe extern "system" fn receive(
    hwnd: HWND,
    message: u32,
    wp: WPARAM,
    lp: LPARAM,
    _: usize,
    data: usize,
) -> LRESULT {
    if message == WM_NCDESTROY {
        super::drop_surface::remove(hwnd);
        let _ = windows::Win32::System::Ole::RevokeDragDrop(windows::Win32::Foundation::HWND(hwnd));
        RemoveWindowSubclass(hwnd, Some(receive), SUBCLASS_ID);
        drop(Box::from_raw(data as *mut Target));
        return DefSubclassProc(hwnd, message, wp, lp);
    }
    if message != WM_DROPFILES {
        return DefSubclassProc(hwnd, message, wp, lp);
    }
    let target = &*(data as *const Target);
    let drop = wp as HDROP;
    let paths = read_paths(drop);
    DragFinish(drop);
    if !paths.is_empty() {
        let mut point = POINT { x: 0, y: 0 };
        GetCursorPos(&mut point);
        if let Ok(root) = target.window.hwnd() {
            ScreenToClient(root.0 as HWND, &mut point);
        }
        let _ = target.window.emit_to(
            target.window.label(),
            "rail-native-drop",
            Drop {
                paths,
                position: Position {
                    x: point.x,
                    y: point.y,
                },
            },
        );
    }
    0
}

// The receiver owns the HDROP and frees it exactly once after reading.
pub(super) unsafe fn read_paths(drop: HDROP) -> Vec<String> {
    let count = DragQueryFileW(drop, u32::MAX, std::ptr::null_mut(), 0);
    let mut paths = vec![];
    if (1..=48).contains(&count) {
        for index in 0..count {
            let len = DragQueryFileW(drop, index, std::ptr::null_mut(), 0);
            if len == 0 || len > 32767 {
                paths.clear();
                break;
            }
            let mut buffer = vec![0; len as usize + 1];
            let copied = DragQueryFileW(drop, index, buffer.as_mut_ptr(), buffer.len() as u32);
            if copied != len {
                paths.clear();
                break;
            }
            paths.push(
                OsString::from_wide(&buffer[..len as usize])
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }
    paths
}

unsafe fn register(hwnd: HWND, window: &WebviewWindow) -> Result<(), String> {
    if super::drop_surface::is_surface(hwnd) {
        return Ok(());
    }
    let mut process = 0;
    GetWindowThreadProcessId(hwnd, &mut process);
    if process != GetCurrentProcessId() {
        // Browser-owned HWNDs must retain their own apartment/process targets.
        return Ok(());
    }
    let mut existing = 0;
    if GetWindowSubclass(hwnd, Some(receive), SUBCLASS_ID, &mut existing) != 0 {
        enable_legacy_drop(hwnd);
        return Ok(());
    }
    let data = Box::into_raw(Box::new(Target {
        window: window.clone(),
        _ole_target: super::ole_drop::register(window, hwnd)?,
    }));
    if SetWindowSubclass(hwnd, Some(receive), SUBCLASS_ID, data as usize) == 0 {
        let _ = windows::Win32::System::Ole::RevokeDragDrop(windows::Win32::Foundation::HWND(hwnd));
        drop(Box::from_raw(data));
        return Err("无法注册系统文件拖放".into());
    }
    enable_legacy_drop(hwnd);
    Ok(())
}

unsafe fn enable_legacy_drop(hwnd: HWND) {
    DragAcceptFiles(hwnd, 1);
}

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    super::webview_drop::install(window)?;
    install_targets(window)
}

pub(super) fn install_targets(window: &WebviewWindow) -> Result<(), String> {
    struct Context<'a> {
        window: &'a WebviewWindow,
        error: Option<String>,
    }
    unsafe extern "system" fn child(hwnd: HWND, data: LPARAM) -> i32 {
        let context = &mut *(data as *mut Context<'_>);
        if let Err(error) = register(hwnd, context.window) {
            context.error = Some(error);
            return 0;
        }
        1
    }
    let root = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    let mut context = Context {
        window,
        error: None,
    };
    unsafe {
        register(root, window)?;
        EnumChildWindows(
            root,
            Some(child),
            &mut context as *mut Context<'_> as LPARAM,
        );
    }
    context.error.map_or(Ok(()), Err)?;
    super::drop_surface::install(window)
}

static TRACE: std::sync::Mutex<Vec<serde_json::Value>> = std::sync::Mutex::new(Vec::new());
pub(super) fn trace(stage: &str, detail: serde_json::Value) {
    if let Ok(mut entries) = TRACE.lock() {
        if entries.len() >= 48 {
            entries.remove(0);
        }
        entries.push(serde_json::json!({"stage": stage, "detail": detail,
            "time": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis()}));
    }
}

pub(super) fn diagnostics(window: &WebviewWindow) -> Result<serde_json::Value, String> {
    unsafe fn describe(hwnd: HWND) -> serde_json::Value {
        let mut class = [0u16; 256];
        let length = GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
        let mut process = 0;
        let thread = GetWindowThreadProcessId(hwnd, &mut process);
        let mut subclass = 0;
        let registered = GetWindowSubclass(hwnd, Some(receive), SUBCLASS_ID, &mut subclass) != 0;
        let property: Vec<u16> = "OleDropTargetInterface\0".encode_utf16().collect();
        let mut rect = std::mem::zeroed();
        GetWindowRect(hwnd, &mut rect);
        serde_json::json!({
            "hwnd": format!("{:x}", hwnd as usize),
            "parent": format!("{:x}", GetParent(hwnd) as usize),
            "class": String::from_utf16_lossy(&class[..length.max(0) as usize]),
            "process": process, "thread": thread, "registered": registered,
            "oleTarget": format!("{:x}", GetPropW(hwnd, property.as_ptr()) as usize),
            "rect": [rect.left, rect.top, rect.right, rect.bottom],
            "visible": IsWindowVisible(hwnd) != 0,
            "dropSurface": super::drop_surface::is_surface(hwnd),
            "enabled": GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_DISABLED as isize == 0,
        })
    }
    unsafe extern "system" fn child(hwnd: HWND, data: LPARAM) -> i32 {
        (*(data as *mut Vec<serde_json::Value>)).push(describe(hwnd));
        1
    }
    let root = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    unsafe {
        let mut nodes = vec![describe(root)];
        EnumChildWindows(root, Some(child), &mut nodes as *mut _ as LPARAM);
        nodes.extend(
            super::drop_surface::handles(root)
                .into_iter()
                .map(|hwnd| describe(hwnd)),
        );
        Ok(
            serde_json::json!({ "label": window.label(), "process": GetCurrentProcessId(), "fileObjectBridge": super::webview_drop::ready(root), "nativeDropReady": super::webview_drop::ready(root), "windows": nodes, "trace": TRACE.lock().map(|v| v.clone()).unwrap_or_default() }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows_sys::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE,
    };

    // Build a real Shell HDROP in memory; no clipboard, file, or desktop changes.
    unsafe fn drop_paths(paths: &[String]) -> Vec<String> {
        let names: Vec<u16> = paths
            .iter()
            .flat_map(|path| path.encode_utf16().chain(Some(0)))
            .chain(Some(0))
            .collect();
        let header_size = std::mem::size_of::<DROPFILES>();
        let handle = GlobalAlloc(GMEM_MOVEABLE, header_size + names.len() * 2);
        assert!(!handle.is_null());
        let data = GlobalLock(handle) as *mut u8;
        assert!(!data.is_null());
        data.cast::<DROPFILES>().write(DROPFILES {
            pFiles: header_size as u32,
            pt: POINT { x: 0, y: 0 },
            fNC: 0,
            fWide: 1,
        });
        std::ptr::copy_nonoverlapping(names.as_ptr(), data.add(header_size).cast(), names.len());
        GlobalUnlock(handle);
        let result = read_paths(handle);
        DragFinish(handle);
        result
    }

    #[test]
    fn native_drop_preserves_unicode_spaces_and_long_paths() {
        let paths = vec![
            "C:\\桌面\\工作 文件夹".into(),
            format!("C:\\{}\\照片.png", "很长的文件夹".repeat(60)),
        ];
        assert_eq!(unsafe { drop_paths(&paths) }, paths);
    }

    #[test]
    fn native_drop_rejects_batches_over_the_mount_limit() {
        let paths: Vec<_> = (0..49).map(|i| format!("C:\\{i}.lnk")).collect();
        assert!(unsafe { drop_paths(&paths) }.is_empty());
        assert_eq!(unsafe { drop_paths(&paths[..48]) }, paths[..48]);
        assert!(unsafe { drop_paths(&[]) }.is_empty());
    }
}
