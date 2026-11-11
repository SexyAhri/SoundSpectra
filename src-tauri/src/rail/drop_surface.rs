//! A temporary, application-owned OLE target above the browser. Chromium's
//! cross-process child windows cannot safely host our COM drop target.
use std::{
    cell::RefCell,
    time::{Duration, Instant},
};
use tauri::WebviewWindow;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM},
    Graphics::Gdi::{
        CreateRectRgn, DeleteObject, GetStockObject, GetWindowRgn, SetWindowRgn, BLACK_BRUSH,
    },
    System::{
        LibraryLoader::GetModuleHandleW,
        Threading::{GetCurrentProcessId, GetCurrentThreadId},
    },
    UI::{Shell::*, WindowsAndMessaging::*},
};

const MARKER: &[u16] = &[83, 83, 68, 114, 111, 112, 83, 117, 114, 102, 97, 99, 101, 0];
const SUBCLASS: usize = 0x53534453;
const RELEASE_GRACE: Duration = Duration::from_millis(180);
const CLASS_NAME: windows::core::PCWSTR = windows::core::w!("SoundSpectraExternalDrop");
static CLASS: std::sync::OnceLock<Result<u16, String>> = std::sync::OnceLock::new();

unsafe fn create_surface(root: HWND) -> Result<HWND, String> {
    let instance = GetModuleHandleW(std::ptr::null());
    CLASS
        .get_or_init(|| {
            let mut class: WNDCLASSW = std::mem::zeroed();
            class.lpfnWndProc = Some(DefWindowProcW);
            class.hInstance = instance;
            class.lpszClassName = CLASS_NAME.as_ptr();
            class.hbrBackground = GetStockObject(BLACK_BRUSH) as _;
            let atom = RegisterClassW(&class);
            if atom == 0 {
                Err("无法注册系统拖放接收层类型".into())
            } else {
                Ok(atom)
            }
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        CLASS_NAME.as_ptr(),
        std::ptr::null(),
        WS_POPUP,
        0,
        0,
        1,
        1,
        root,
        std::ptr::null_mut(),
        instance,
        std::ptr::null(),
    );
    if hwnd.is_null() {
        return Err(format!(
            "无法创建系统拖放接收层：{}",
            std::io::Error::last_os_error()
        ));
    }
    // Alpha zero would also remove this window from native hit testing.
    if SetLayeredWindowAttributes(hwnd, 0, 1, LWA_ALPHA) == 0 {
        DestroyWindow(hwnd);
        return Err("无法设置拖放接收层透明度".into());
    }
    Ok(hwnd)
}

#[derive(Default)]
struct Gesture {
    down: bool,
    external: bool,
    finished: bool,
    released: Option<Instant>,
}
impl Gesture {
    fn update(&mut self, down: bool, own_origin: bool, now: Instant) -> bool {
        if down && !self.down {
            self.external = !own_origin;
            self.finished = false;
            self.released = None;
        } else if !down && self.down {
            self.released = Some(now);
        }
        self.down = down;
        self.external
            && !self.finished
            && (down
                || self
                    .released
                    .is_some_and(|at| now.duration_since(at) < RELEASE_GRACE))
    }
}
#[derive(Default)]
struct Controller {
    // Handles only: destroying a rail must not keep its WebviewWindow alive.
    surfaces: Vec<usize>,
    timer: usize,
    gesture: Gesture,
}
thread_local! { static CONTROLLER: RefCell<Controller> = RefCell::default(); }

pub(super) unsafe fn is_surface(hwnd: HWND) -> bool {
    !GetPropW(hwnd, MARKER.as_ptr()).is_null()
}

pub(super) fn handles(root: HWND) -> Vec<HWND> {
    CONTROLLER.with(|slot| {
        slot.borrow()
            .surfaces
            .iter()
            .filter_map(|h| unsafe {
                let hwnd = *h as HWND;
                (GetPropW(hwnd, MARKER.as_ptr()) == root).then_some(hwnd)
            })
            .collect()
    })
}

pub(super) unsafe fn remove(root: HWND) {
    for surface in handles(root) {
        DestroyWindow(surface);
    }
}

unsafe fn owns_point(mut hwnd: HWND) -> bool {
    while !hwnd.is_null() {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == GetCurrentProcessId() {
            return true;
        }
        hwnd = GetParent(hwnd);
    }
    false
}

unsafe fn show_surface(root: HWND, surface: HWND) -> bool {
    let mut rect = std::mem::zeroed();
    if GetWindowRect(root, &mut rect) == 0 {
        return false;
    }
    if IsWindowVisible(surface) == 0 {
        // A top-level receiver must copy the rail's native region, so the
        // transparent space around cards continues to pass through to desktop.
        let region = CreateRectRgn(0, 0, 0, 0);
        if region.is_null() {
            return false;
        }
        if GetWindowRgn(root, region) == 0 {
            DeleteObject(region);
            SetWindowRgn(surface, std::ptr::null_mut(), 0);
        } else if SetWindowRgn(surface, region, 0) == 0 {
            DeleteObject(region);
            return false;
        }
    }
    SetWindowPos(
        surface,
        HWND_TOPMOST,
        rect.left,
        rect.top,
        rect.right - rect.left,
        rect.bottom - rect.top,
        SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_SHOWWINDOW,
    ) != 0
}

unsafe extern "system" fn tick(_: HWND, _: u32, _: usize, _: u32) {
    let down = GetAsyncKeyState(VK_LBUTTON.0 as i32) < 0;
    let mut point = POINT { x: 0, y: 0 };
    if GetCursorPos(&mut point) == 0 {
        return;
    }
    let hit = WindowFromPoint(point);
    let (surfaces, armed) = CONTROLLER.with(|slot| {
        let mut state = slot.borrow_mut();
        let armed = state.gesture.update(down, owns_point(hit), Instant::now());
        (state.surfaces.clone(), armed)
    });
    // Do not hold the controller borrow over window callbacks.
    for handle in surfaces {
        let surface = handle as HWND;
        if !is_surface(surface) {
            continue;
        }
        let root = GetPropW(surface, MARKER.as_ptr()) as HWND;
        let over = hit == surface || hit == root || IsChild(root, hit) != 0;
        if armed && over && IsWindowVisible(root) != 0 && IsIconic(root) == 0 {
            let was_visible = IsWindowVisible(surface) != 0;
            if show_surface(root, surface) {
                if !was_visible {
                    super::native_drop::trace(
                        "surface-shown",
                        serde_json::json!({"root": format!("{:x}", root as usize)}),
                    );
                }
            }
        } else if IsWindowVisible(surface) != 0 {
            ShowWindow(surface, SW_HIDE);
        }
    }
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
        let _ = windows::Win32::System::Ole::RevokeDragDrop(windows::Win32::Foundation::HWND(hwnd));
        RemovePropW(hwnd, MARKER.as_ptr());
        RemoveWindowSubclass(hwnd, Some(receive), SUBCLASS);
        CONTROLLER.with(|slot| {
            let mut state = slot.borrow_mut();
            state.surfaces.retain(|handle| *handle != hwnd as usize);
            if state.surfaces.is_empty() && state.timer != 0 {
                KillTimer(std::ptr::null_mut(), state.timer);
                state.timer = 0;
                state.gesture = Gesture::default();
            }
        });
        drop(Box::from_raw(
            data as *mut windows::Win32::System::Ole::IDropTarget,
        ));
    }
    DefSubclassProc(hwnd, message, wp, lp)
}

pub(super) fn finish(window: &WebviewWindow) {
    let Ok(root) = window.hwnd() else {
        return;
    };
    let surfaces = CONTROLLER.with(|slot| {
        let mut state = slot.borrow_mut();
        state.gesture.finished = true;
        state.surfaces.clone()
    });
    for surface in surfaces {
        unsafe {
            let hwnd = surface as HWND;
            if is_surface(hwnd) && GetPropW(hwnd, MARKER.as_ptr()) == root.0 as HWND {
                ShowWindow(hwnd, SW_HIDE);
            }
        }
    }
}

pub(super) fn install(window: &WebviewWindow) -> Result<(), String> {
    let root = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    unsafe {
        if GetWindowThreadProcessId(root, std::ptr::null_mut()) != GetCurrentThreadId() {
            return Err("拖放接收层必须在窗口 UI 线程创建".into());
        }
        let exists = CONTROLLER.with(|slot| {
            slot.borrow().surfaces.iter().any(|h| {
                let hwnd = *h as HWND;
                is_surface(hwnd) && GetPropW(hwnd, MARKER.as_ptr()) == root
            })
        });
        if exists {
            return Ok(());
        }
        let hwnd = create_surface(root)?;
        let target = match super::ole_drop::register(window, hwnd) {
            Ok(target) => Box::into_raw(Box::new(target)),
            Err(error) => {
                DestroyWindow(hwnd);
                return Err(error);
            }
        };
        if SetWindowSubclass(hwnd, Some(receive), SUBCLASS, target as usize) == 0 {
            let _ =
                windows::Win32::System::Ole::RevokeDragDrop(windows::Win32::Foundation::HWND(hwnd));
            drop(Box::from_raw(target));
            DestroyWindow(hwnd);
            return Err("无法安装拖放接收层".into());
        }
        if SetPropW(hwnd, MARKER.as_ptr(), root) == 0 {
            DestroyWindow(hwnd);
            return Err("无法标记拖放接收层".into());
        }
        let ready = CONTROLLER.with(|slot| {
            let mut state = slot.borrow_mut();
            state.surfaces.push(hwnd as usize);
            if state.timer == 0 {
                state.timer = SetTimer(std::ptr::null_mut(), 0, 25, Some(tick));
            }
            state.timer != 0
        });
        if !ready {
            DestroyWindow(hwnd);
            return Err("无法监测外部拖入".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_surface_is_hidden_initially_and_accepts_hit_testing_when_shown() {
        unsafe {
            let class = windows::core::w!("STATIC");
            let root = CreateWindowExW(
                WS_EX_NOACTIVATE,
                class.as_ptr(),
                std::ptr::null(),
                WS_POPUP,
                0,
                0,
                32,
                32,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!root.is_null());
            let surface = create_surface(root).expect("create layered receiver");
            assert_eq!(IsWindowVisible(surface), 0);
            SetWindowPos(
                root,
                HWND_TOPMOST,
                0,
                0,
                32,
                32,
                SWP_NOACTIVATE | SWP_SHOWWINDOW,
            );
            let region = CreateRectRgn(0, 0, 16, 32);
            assert_ne!(SetWindowRgn(root, region, 0), 0);
            assert!(show_surface(root, surface));
            windows_sys::Win32::Graphics::Gdi::UpdateWindow(surface);
            let hit = WindowFromPoint(POINT { x: 8, y: 16 });
            let outside = WindowFromPoint(POINT { x: 24, y: 16 });
            ShowWindow(surface, SW_HIDE);
            let after = WindowFromPoint(POINT { x: 8, y: 16 });
            DestroyWindow(root);
            assert_eq!(
                hit, surface,
                "external OLE must hit the receiving window directly"
            );
            assert_ne!(
                outside, surface,
                "space outside the rail region must pass through"
            );
            assert_ne!(
                after, surface,
                "hidden receiver must not intercept normal input"
            );
            assert_eq!(
                IsWindow(surface),
                0,
                "root destruction must destroy receiver"
            );
        }
    }
    #[test]
    fn internal_clicks_and_drags_never_arm_surface() {
        let mut gesture = Gesture::default();
        let now = Instant::now();
        assert!(!gesture.update(false, false, now));
        assert!(!gesture.update(true, true, now));
        assert!(!gesture.update(true, false, now));
        assert!(!gesture.update(false, false, now));
    }
    #[test]
    fn external_drag_has_release_grace_and_stays_hidden_after_completion() {
        let mut gesture = Gesture::default();
        let now = Instant::now();
        assert!(gesture.update(true, false, now));
        assert!(gesture.update(true, true, now));
        assert!(gesture.update(false, true, now));
        assert!(!gesture.update(false, true, now + RELEASE_GRACE));
        assert!(gesture.update(true, false, now + RELEASE_GRACE));
        gesture.finished = true;
        assert!(!gesture.update(true, true, now + RELEASE_GRACE));
        assert!(!gesture.update(false, true, now + RELEASE_GRACE));
        assert!(gesture.update(true, false, now + RELEASE_GRACE));
    }
}
