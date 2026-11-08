//! Conservative, per-output occlusion. Unknown/translucent windows keep rendering.
use crate::{AppState, DesktopOcclusion};
use std::sync::{atomic::Ordering, Arc};
use tauri::{Emitter, Manager, WebviewWindow};
use windows_sys::Win32::{
    Foundation::RECT,
    Graphics::{
        Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
        Gdi::{GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONULL},
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

fn covered(foreground: &RECT, output: &RECT, monitor: &RECT, work: &RECT) -> bool {
    if contains(foreground, output) {
        return true;
    }
    // A maximized window covers the work area, not necessarily the taskbar.
    // Never clip a multi-monitor output to just one monitor's work area.
    if !contains(monitor, output) || !valid(work) {
        return false;
    }
    contains(
        foreground,
        &RECT {
            left: output.left.max(work.left),
            top: output.top.max(work.top),
            right: output.right.min(work.right),
            bottom: output.bottom.min(work.bottom),
        },
    )
}

fn is_occluded(window: &WebviewWindow) -> bool {
    let Ok(handle) = window.hwnd() else {
        return false;
    };
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground.is_null()
            || foreground == handle.0 as _
            || IsWindowVisible(foreground) == 0
            || IsIconic(foreground) != 0
            || IsWindowVisible(handle.0 as _) == 0
        {
            return false;
        }
        let mut class = [0u16; 128];
        let length = GetClassNameW(foreground, class.as_mut_ptr(), class.len() as i32);
        if length == 0
            || matches!(
                String::from_utf16_lossy(&class[..length as usize]).as_str(),
                "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
            )
            || GetWindowLongPtrW(foreground, GWL_EXSTYLE)
                & (WS_EX_LAYERED | WS_EX_TRANSPARENT) as isize
                != 0
        {
            return false;
        }
        let mut cloaked = 0u32;
        if DwmGetWindowAttribute(
            foreground,
            DWMWA_CLOAKED as u32,
            &mut cloaked as *mut _ as _,
            std::mem::size_of_val(&cloaked) as u32,
        ) < 0
            || cloaked != 0
        {
            return false;
        }
        let mut front: RECT = std::mem::zeroed();
        let mut output: RECT = std::mem::zeroed();
        if DwmGetWindowAttribute(
            foreground,
            DWMWA_EXTENDED_FRAME_BOUNDS as u32,
            &mut front as *mut _ as _,
            std::mem::size_of_val(&front) as u32,
        ) < 0
            || GetWindowRect(handle.0 as _, &mut output) == 0
            || !valid(&output)
        {
            return false;
        }
        let monitor = MonitorFromRect(&output, MONITOR_DEFAULTTONULL);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of_val(&info) as u32;
        if monitor.is_null() || GetMonitorInfoW(monitor, &mut info) == 0 {
            return contains(&front, &output);
        }
        covered(&front, &output, &info.rcMonitor, &info.rcWork)
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
        let mut gate = OcclusionGate::default();
        while !state.shutdown.load(Ordering::Relaxed) {
            let editing = state.status.lock().map(|s| s.editing).unwrap_or(true);
            let occluded = gate.update(
                !editing
                    && app
                        .get_webview_window("overlay")
                        .is_some_and(|window| is_occluded(&window)),
            );
            if state.desktop_occluded.swap(occluded, Ordering::Relaxed) != occluded {
                let _ = app.emit_to(
                    "overlay",
                    "desktop://occlusion_changed",
                    DesktopOcclusion { occluded },
                );
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

    #[test]
    fn only_the_covered_output_sleeps() {
        let primary = rect(0, 0, 3840, 2160);
        let work = rect(0, 0, 3840, 2100);
        assert!(covered(&work, &primary, &primary, &work));
        assert!(!covered(&rect(0, 0, 1920, 2100), &primary, &primary, &work));
        let secondary = rect(-2560, 0, 0, 1440);
        assert!(!covered(&primary, &secondary, &secondary, &secondary));
        assert!(covered(&secondary, &secondary, &secondary, &secondary));
        let spanning = rect(-2560, 0, 3840, 2160);
        assert!(!covered(&primary, &spanning, &primary, &work));
        assert!(!covered(&rect(0, 0, 0, 0), &primary, &primary, &work));
    }

    #[test]
    fn brief_cover_does_not_sleep_and_uncover_wakes_immediately() {
        let mut gate = OcclusionGate::default();
        assert!(!gate.update(true));
        assert!(!gate.update(false));
        assert!(!gate.update(true));
        assert!(gate.update(true));
        assert!(gate.update(true));
        assert!(!gate.update(false));
    }
}
