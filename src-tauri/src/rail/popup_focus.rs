use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tauri::{Emitter, Manager, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{Shell::*, WindowsAndMessaging::*},
};

const SUBCLASS_ID: usize = 0x53535250;
struct Target {
    window: WebviewWindow,
    generation: AtomicU64,
}

fn open(window: &WebviewWindow) -> bool {
    window
        .state::<super::RailState>()
        .popup_windows
        .is_open(window.label().strip_prefix("rail-popup-").unwrap_or(""))
}

fn left_pressed() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0 }
}

fn dismiss_after_release(target: Arc<Target>, generation: u64, token: String) {
    // A desktop icon drag starts by activating Explorer. Keep the panel open
    // through that press; decide after release without installing input hooks.
    std::thread::spawn(move || {
        for _ in 0..3750 {
            if target.generation.load(Ordering::Acquire) != generation {
                return;
            }
            if !left_pressed() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(16));
        }
        if left_pressed() {
            return;
        }
        let window = target.window.clone();
        let _ = window.run_on_main_thread(move || unsafe {
            if target.generation.load(Ordering::Acquire) != generation || !open(&target.window) {
                return;
            }
            let Ok(root) = target.window.hwnd() else {
                return;
            };
            let mut point = std::mem::zeroed();
            if GetCursorPos(&mut point) == 0 {
                return;
            }
            if external_target(root.0 as HWND, WindowFromPoint(point)) {
                let _ = target
                    .window
                    .emit_to(target.window.label(), "rail-dismiss-popup", &token);
            }
        });
    });
}

// WM_ACTIVATE describes a top-level window switch. WebView child focus changes
// also emit Tauri Focused(false), so that event cannot dismiss a desktop popup.
unsafe fn external_target(root: HWND, mut target: HWND) -> bool {
    if target.is_null() {
        return false;
    }
    while !target.is_null() {
        if target == root || IsChild(root, target) != 0 {
            return false;
        }
        target = GetWindow(target, GW_OWNER);
    }
    true
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
        RemoveWindowSubclass(hwnd, Some(receive), SUBCLASS_ID);
        let target = Box::from_raw(data as *mut Arc<Target>);
        target.generation.fetch_add(1, Ordering::AcqRel);
    } else if message == WM_ACTIVATE {
        let target = &*(data as *const Arc<Target>);
        let generation = target.generation.fetch_add(1, Ordering::AcqRel) + 1;
        // Ignore our own host/activation transition while rail_popup holds
        // this lock; only a switch to another application's window dismisses.
        if wp & 0xffff == WA_INACTIVE as usize
            && external_target(hwnd, lp as HWND)
            && open(&target.window)
        {
            let id = target
                .window
                .label()
                .strip_prefix("rail-popup-")
                .unwrap_or("");
            let Some(token) = target
                .window
                .state::<super::RailState>()
                .popup_windows
                .token(id)
            else {
                return DefSubclassProc(hwnd, message, wp, lp);
            };
            if left_pressed() {
                dismiss_after_release(target.clone(), generation, token);
            } else {
                let _ = target
                    .window
                    .emit_to(target.window.label(), "rail-dismiss-popup", token);
            }
        }
    }
    DefSubclassProc(hwnd, message, wp, lp)
}

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    unsafe {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as HWND;
        let mut data = 0;
        if GetWindowSubclass(hwnd, Some(receive), SUBCLASS_ID, &mut data) != 0 {
            return Ok(());
        }
        let window = Box::into_raw(Box::new(Arc::new(Target {
            window: window.clone(),
            generation: AtomicU64::new(0),
        })));
        if SetWindowSubclass(hwnd, Some(receive), SUBCLASS_ID, window as usize) == 0 {
            drop(Box::from_raw(window));
            return Err("无法注册拾光绳弹窗关闭事件".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestWindow(HWND);
    impl TestWindow {
        unsafe fn new(style: u32, parent: HWND) -> Self {
            let class: Vec<_> = "STATIC\0".encode_utf16().collect();
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                style,
                0,
                0,
                10,
                10,
                parent,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!hwnd.is_null());
            Self(hwnd)
        }
    }
    impl Drop for TestWindow {
        fn drop(&mut self) {
            unsafe {
                DestroyWindow(self.0);
            }
        }
    }

    #[test]
    fn internal_child_and_owned_dialog_activation_keep_popup_open() {
        unsafe {
            let root = TestWindow::new(WS_POPUP, std::ptr::null_mut());
            let webview = TestWindow::new(WS_CHILD, root.0);
            let dialog = TestWindow::new(WS_POPUP, root.0);
            let nested_dialog = TestWindow::new(WS_POPUP, dialog.0);
            let other_window = TestWindow::new(WS_POPUP, std::ptr::null_mut());
            assert!(!external_target(root.0, root.0));
            assert!(!external_target(root.0, webview.0));
            assert!(!external_target(root.0, dialog.0));
            assert!(!external_target(root.0, nested_dialog.0));
            assert!(!external_target(root.0, std::ptr::null_mut()));
            assert!(external_target(root.0, other_window.0));
        }
    }
}
