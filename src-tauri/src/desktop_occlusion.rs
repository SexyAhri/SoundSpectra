//! Per-window occlusion using the union of opaque windows above each desktop host.
use crate::{AppState, DesktopOcclusion};
use std::{
    collections::HashMap,
    sync::{atomic::Ordering, Arc},
};
use tauri::{Emitter, Manager};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, RECT},
    Graphics::{
        Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
        Gdi::*,
    },
    UI::WindowsAndMessaging::*,
};

fn valid(rect: &RECT) -> bool {
    rect.right > rect.left && rect.bottom > rect.top
}

fn contains(outer: &RECT, inner: &RECT) -> bool {
    valid(outer)
        && valid(inner)
        && outer.left <= inner.left
        && outer.top <= inner.top
        && outer.right >= inner.right
        && outer.bottom >= inner.bottom
}

fn output_bounds(output: &RECT, monitor: &RECT, work: &RECT) -> RECT {
    // Preserve the taskbar allowance for maximized apps, but never clip a
    // spanning output to one monitor. An output wholly outside work stays awake.
    if contains(monitor, output) && valid(work) {
        let clipped = RECT {
            left: output.left.max(work.left),
            top: output.top.max(work.top),
            right: output.right.min(work.right),
            bottom: output.bottom.min(work.bottom),
        };
        if valid(&clipped) {
            return clipped;
        }
    }
    *output
}

struct Region(HRGN);
impl Region {
    fn rect(rect: &RECT) -> Option<Self> {
        let handle = unsafe { CreateRectRgn(rect.left, rect.top, rect.right, rect.bottom) };
        (!handle.is_null()).then_some(Self(handle))
    }

    fn combine(&self, other: &Self, mode: RGN_COMBINE_MODE) -> Option<bool> {
        match unsafe { CombineRgn(self.0, self.0, other.0, mode) } {
            ERROR => None,
            NULLREGION => Some(true),
            _ => Some(false),
        }
    }
}
impl Drop for Region {
    fn drop(&mut self) {
        unsafe {
            DeleteObject(self.0);
        }
    }
}

// Honor shaped windows (including rail hit regions), rather than treating their
// transparent holes as opaque. All coordinates below are physical screen pixels.
unsafe fn window_region(handle: HWND, bounds: &RECT) -> Option<Region> {
    let frame = Region::rect(bounds)?;
    let shape = Region::rect(&std::mem::zeroed())?;
    if GetWindowRgn(handle, shape.0) != ERROR {
        let mut origin = std::mem::zeroed();
        if GetWindowRect(handle, &mut origin) == 0
            || OffsetRgn(shape.0, origin.left, origin.top) == ERROR
        {
            return None;
        }
        frame.combine(&shape, RGN_AND)?;
    }
    Some(frame)
}

unsafe fn opaque_region(handle: HWND) -> Option<Region> {
    if IsWindowVisible(handle) == 0
        || IsIconic(handle) != 0
        || GetWindowLongPtrW(handle, GWL_EXSTYLE) & (WS_EX_LAYERED | WS_EX_TRANSPARENT) as isize
            != 0
    {
        return None;
    }
    let mut class = [0u16; 128];
    let length = GetClassNameW(handle, class.as_mut_ptr(), class.len() as i32);
    if length == 0
        || matches!(
            String::from_utf16_lossy(&class[..length as usize]).as_str(),
            "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
        )
    {
        return None;
    }
    let mut cloaked = 0u32;
    let mut bounds: RECT = std::mem::zeroed();
    if DwmGetWindowAttribute(
        handle,
        DWMWA_CLOAKED as u32,
        &mut cloaked as *mut _ as _,
        std::mem::size_of_val(&cloaked) as u32,
    ) < 0
        || cloaked != 0
        || DwmGetWindowAttribute(
            handle,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            &mut bounds as *mut _ as _,
            std::mem::size_of_val(&bounds) as u32,
        ) < 0
        || !valid(&bounds)
    {
        return None;
    }
    window_region(handle, &bounds)
}

struct WindowSnapshot {
    handle: HWND,
    opaque: Option<Region>,
}

unsafe extern "system" fn collect_window(handle: HWND, data: LPARAM) -> i32 {
    let windows = &mut *(data as *mut Vec<WindowSnapshot>);
    windows.push(WindowSnapshot {
        handle,
        opaque: opaque_region(handle),
    });
    1
}

fn snapshot() -> Option<Vec<WindowSnapshot>> {
    let mut windows = Vec::new();
    // EnumWindows captures top-level Z order once per poll, shared by all rails.
    (unsafe { EnumWindows(Some(collect_window), &mut windows as *mut _ as LPARAM) } != 0)
        .then_some(windows)
}

fn is_occluded(handle: HWND, windows: &[WindowSnapshot]) -> bool {
    unsafe {
        if IsWindow(handle) == 0 {
            return false;
        }
        if IsWindowVisible(handle) == 0 || IsIconic(handle) != 0 {
            return true;
        }
        // Overlay/rails are Explorer children. Only windows above their actual
        // top-level host can cover them; windows behind that host never count.
        let root = GetAncestor(handle, GA_ROOT);
        let Some(index) = windows.iter().position(|entry| entry.handle == root) else {
            return false;
        };
        let mut output: RECT = std::mem::zeroed();
        if GetWindowRect(handle, &mut output) == 0 || !valid(&output) {
            return false;
        }
        let monitor = MonitorFromRect(&output, MONITOR_DEFAULTTONULL);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of_val(&info) as u32;
        let bounds = if !monitor.is_null() && GetMonitorInfoW(monitor, &mut info) != 0 {
            output_bounds(&output, &info.rcMonitor, &info.rcWork)
        } else {
            output
        };
        let Some(remaining) = window_region(handle, &bounds) else {
            return false;
        };
        let mut box_rect = std::mem::zeroed();
        if GetRgnBox(remaining.0, &mut box_rect) <= NULLREGION {
            return false;
        }
        for entry in &windows[..index] {
            if let Some(opaque) = &entry.opaque {
                match remaining.combine(opaque, RGN_DIFF) {
                    Some(true) => return true,
                    None => return false,
                    _ => {}
                }
            }
        }
        false
    }
}

#[derive(Default)]
struct OcclusionGate {
    covered_samples: u8,
}
impl OcclusionGate {
    fn update(&mut self, covered: bool) -> bool {
        self.covered_samples = if covered {
            self.covered_samples.saturating_add(1).min(2)
        } else {
            0
        };
        self.covered_samples >= 2
    }
}

pub fn start(app: tauri::AppHandle, state: Arc<AppState>) {
    std::thread::spawn(move || {
        let mut gates: HashMap<String, (usize, OcclusionGate)> = HashMap::new();
        while !state.shutdown.load(Ordering::Relaxed) {
            let editing = state.status.lock().map(|s| s.editing).unwrap_or(true);
            let windows = app.webview_windows();
            let snapshot = if editing { None } else { snapshot() };
            gates.retain(|label, _| windows.contains_key(label));
            if let Ok(mut values) = state.desktop_occluded.lock() {
                values.retain(|label, _| windows.contains_key(label));
            }
            for (label, window) in windows {
                if label != "overlay" && !label.starts_with("rail-") {
                    continue;
                }
                let handle = window.hwnd().ok().map(|h| h.0 as HWND);
                let identity = handle.unwrap_or_default() as usize;
                let (previous, gate) = gates.entry(label.clone()).or_default();
                if *previous != identity {
                    *previous = identity;
                    *gate = OcclusionGate::default();
                }
                let occluded = gate.update(
                    !editing
                        && handle
                            .zip(snapshot.as_deref())
                            .is_some_and(|(handle, windows)| is_occluded(handle, windows)),
                );
                // Publish state before the event so a newly subscribed WebView
                // reads its own value, never the overlay's monitor-wide result.
                let changed = state
                    .desktop_occluded
                    .lock()
                    .map(|mut values| values.insert(label.clone(), occluded) != Some(occluded))
                    .unwrap_or(false);
                if changed {
                    let _ = app.emit_to(
                        &label,
                        "desktop://occlusion_changed",
                        DesktopOcclusion { occluded },
                    );
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }
    fn union_covers(output: &RECT, covers: &[RECT]) -> bool {
        let remaining = Region::rect(output).unwrap();
        covers
            .iter()
            .any(|cover| remaining.combine(&Region::rect(cover).unwrap(), RGN_DIFF) == Some(true))
    }

    #[test]
    fn union_covers_only_the_correct_output_and_never_clips_spanning_outputs() {
        let primary = rect(0, 0, 3840, 2160);
        let work = rect(0, 0, 3840, 2100);
        let target = output_bounds(&primary, &primary, &work);
        assert!(union_covers(&target, &[work]));
        assert!(union_covers(
            &target,
            &[rect(0, 0, 1920, 2100), rect(1920, 0, 3840, 2100)]
        ));
        assert!(!union_covers(
            &target,
            &[rect(0, 0, 1919, 2100), rect(1920, 0, 3840, 2100)]
        ));
        let secondary = rect(-2560, 0, 0, 1440);
        assert!(!union_covers(&secondary, &[primary]));
        let spanning = rect(-2560, 0, 3840, 2160);
        assert!(!union_covers(
            &output_bounds(&spanning, &primary, &work),
            &[primary]
        ));
        assert!(union_covers(
            &spanning,
            &[primary, secondary, rect(-2560, 1440, 0, 2160)]
        ));
        assert!(!union_covers(
            &output_bounds(&rect(0, 2100, 100, 2160), &primary, &work),
            &[work]
        ));
        let rail = rect(-2000, 200, -1000, 500);
        assert!(!union_covers(&rail, &[primary]));
        assert!(union_covers(&rail, &[secondary]));
    }

    #[test]
    fn brief_cover_does_not_sleep_and_uncover_wakes_on_the_next_sample() {
        let mut overlay = OcclusionGate::default();
        let mut rail = OcclusionGate::default();
        assert!(!overlay.update(true));
        assert!(!overlay.update(false));
        assert!(!overlay.update(true));
        assert!(overlay.update(true));
        assert!(!rail.update(false));
        assert!(overlay.update(true));
        assert!(!overlay.update(false));
    }

    struct TestWindow(HWND);
    impl TestWindow {
        unsafe fn new(parent: HWND, x: i32, width: i32) -> Self {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let handle = CreateWindowExW(
                WS_EX_NOACTIVATE,
                class.as_ptr(),
                std::ptr::null(),
                WS_VISIBLE | if parent.is_null() { WS_POPUP } else { WS_CHILD },
                x,
                if parent.is_null() { -30000 } else { 0 },
                width,
                100,
                parent,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!handle.is_null());
            SetWindowPos(
                handle,
                HWND_TOP,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            Self(handle)
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
    fn native_z_order_union_respects_hidden_transparent_shaped_and_child_windows() {
        unsafe {
            let output = TestWindow::new(std::ptr::null_mut(), -30000, 200);
            let child = TestWindow::new(output.0, 0, 200);
            let left = TestWindow::new(std::ptr::null_mut(), -30000, 100);
            let right = TestWindow::new(std::ptr::null_mut(), -29900, 100);
            let covered = || is_occluded(child.0, &snapshot().unwrap());
            // Neither cover has to own foreground focus, and the child itself
            // is absent from EnumWindows: its Explorer-style root is the cutoff.
            assert!(covered());
            ShowWindow(right.0, SW_HIDE);
            assert!(!covered());
            ShowWindow(right.0, SW_SHOWNOACTIVATE);
            SetWindowLongPtrW(
                right.0,
                GWL_EXSTYLE,
                (WS_EX_NOACTIVATE | WS_EX_TRANSPARENT) as isize,
            );
            assert!(!covered());
            SetWindowLongPtrW(right.0, GWL_EXSTYLE, WS_EX_NOACTIVATE as isize);
            assert!(covered());
            let hole = CreateRectRgn(0, 0, 50, 100);
            assert_ne!(SetWindowRgn(right.0, hole, 0), 0); // OS owns the region.
            assert!(!covered());
            assert_ne!(SetWindowRgn(right.0, std::ptr::null_mut(), 0), 0);
            assert!(covered());
            SetWindowPos(
                right.0,
                output.0,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            assert!(!covered());
            // Only the left half belongs to this shaped output. Transparent
            // rail padding must not prevent sleep when all its pixels are covered.
            assert_ne!(SetWindowRgn(child.0, CreateRectRgn(0, 0, 100, 100), 0), 0);
            assert!(covered());
            ShowWindow(left.0, SW_HIDE);
            assert!(!covered());
        }
    }
}
