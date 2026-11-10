use super::RailGroup;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    mem::{size_of, zeroed},
    path::Path,
    ptr::{null, null_mut},
};
use tauri::{Emitter, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, POINT, RECT},
    Graphics::Gdi::*,
    UI::{Controls::Dialogs::*, Shell::*, WindowsAndMessaging::*},
};
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}

const VISIBILITY_SUBCLASS: usize = 0x53535256;
const REPAINT: windows_core::PCWSTR = windows_core::w!("SoundSpectra.RailRepaint");
const BROWSER: windows_core::PCWSTR = windows_core::w!("SoundSpectra.RailBrowser");

unsafe extern "system" fn observe_visibility(
    hwnd: HWND,
    message: u32,
    wp: usize,
    lp: isize,
    _: usize,
    _: usize,
) -> isize {
    if message == WM_SHOWWINDOW && wp == 0 {
        // Remember even a hide/show pair between recovery ticks. Explorer can
        // restore the HWND without restoring WebView2's compositor surface.
        SetPropW(hwnd, REPAINT.as_ptr(), 1usize as _);
    } else if message == WM_NCDESTROY {
        RemovePropW(hwnd, REPAINT.as_ptr());
        RemovePropW(hwnd, BROWSER.as_ptr());
        RemoveWindowSubclass(hwnd, Some(observe_visibility), VISIBILITY_SUBCLASS);
    }
    DefSubclassProc(hwnd, message, wp, lp)
}

unsafe fn browser_visible(handle: HWND) -> bool {
    let browser = GetPropW(handle, BROWSER.as_ptr()) as HWND;
    !browser.is_null() && IsChild(handle, browser) != 0 && IsWindowVisible(browser) != 0
}

unsafe fn needs_repaint(handle: HWND) -> bool {
    !GetPropW(handle, REPAINT.as_ptr()).is_null() || !browser_visible(handle)
}

unsafe fn above_desktop_icons(handle: HWND, parent: HWND) -> bool {
    let icons = FindWindowExW(parent, null_mut(), wide("SysListView32").as_ptr(), null());
    if icons.is_null() {
        return true;
    }
    // Explorer raises its icon list when "Show desktop icons" changes. The
    // rail can remain visible with the correct bounds but be entirely covered.
    let mut sibling = GetWindow(handle, GW_HWNDPREV);
    while !sibling.is_null() {
        if sibling == icons {
            return false;
        }
        sibling = GetWindow(sibling, GW_HWNDPREV);
    }
    true
}

unsafe fn child_styles_healthy(handle: HWND) -> bool {
    let style = GetWindowLongPtrW(handle, GWL_STYLE);
    let extended = GetWindowLongPtrW(handle, GWL_EXSTYLE);
    style & WS_CHILD as isize != 0
        && style & WS_POPUP as isize == 0
        && extended & WS_EX_NOACTIVATE as isize != 0
        && extended & WS_EX_TOPMOST as isize == 0
}

unsafe fn layout_healthy(handle: HWND, parent: HWND, bounds: &Bounds) -> bool {
    if IsWindowVisible(parent) == 0 {
        SetPropW(handle, REPAINT.as_ptr(), 1usize as _);
    }
    GetParent(handle) == parent
        && child_styles_healthy(handle)
        && GetWindowLongPtrW(handle, GWL_STYLE) & WS_VISIBLE as isize != 0
        && bounds.matches(handle)
        // A hidden desktop is intentional. Leave the pending repaint in place
        // until Explorer shows it, instead of repairing it every three seconds.
        && (IsWindowVisible(parent) == 0
            || (!needs_repaint(handle) && above_desktop_icons(handle, parent)))
}

pub fn hide(window: &WebviewWindow) -> Result<(), String> {
    let handle = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    unsafe {
        // Tao still remembers a top-level window. Its visibility setter may
        // rebuild those styles and remove WS_CHILD from our Explorer child.
        ShowWindow(handle, SW_HIDE);
    }
    Ok(())
}

#[cfg(debug_assertions)]
pub fn obscure_for_test(window: &WebviewWindow, mode: &str) -> Result<(), String> {
    let handle = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    unsafe {
        match mode {
            "rail" => {
                ShowWindow(handle, SW_HIDE);
            }
            "cycle" => {
                ShowWindow(handle, SW_HIDE);
                ShowWindow(handle, SW_SHOWNOACTIVATE);
            }
            "behind-icons" => {
                // Reproduce Explorer raising its icon list by lowering only our
                // own child. Never change the user's global icon preference.
                SetWindowPos(
                    handle,
                    HWND_BOTTOM,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
            "browser" => {
                let browser = GetPropW(handle, BROWSER.as_ptr()) as HWND;
                if browser.is_null() || IsChild(handle, browser) == 0 {
                    return Err("拾光绳 WebView 尚未就绪".into());
                }
                ShowWindow(browser, SW_HIDE);
            }
            _ => return Err("未知的拾光绳恢复测试".into()),
        }
    }
    Ok(())
}

fn restore_browser(window: &WebviewWindow) -> Result<(), String> {
    // with_webview runs with the runtime's WebView borrowed. Query HWNDs and
    // emit frontend events outside that callback to avoid reentering Tauri.
    let root = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    window
        .with_webview(move |webview| unsafe {
            let result = (|| -> Result<(), String> {
                let root = root as HWND;
                let controller = webview.controller();
                let mut browser = windows::Win32::Foundation::HWND::default();
                controller
                    .ParentWindow(&mut browser)
                    .map_err(|e| e.to_string())?;
                if SetPropW(root, BROWSER.as_ptr(), browser.0 as _) == 0 {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                if IsWindowVisible(root) == 0 {
                    return Ok(());
                }
                // SetWindowPos only repairs the outer HWND. Restore both the
                // Wry child and the controller, without activating the rail.
                controller.SetIsVisible(false).map_err(|e| e.to_string())?;
                ShowWindow(browser.0 as HWND, SW_SHOWNOACTIVATE);
                controller.SetIsVisible(true).map_err(|e| e.to_string())?;
                controller
                    .NotifyParentWindowPositionChanged()
                    .map_err(|e| e.to_string())?;
                RemovePropW(root, REPAINT.as_ptr());
                Ok(())
            })();
            if let Err(error) = result {
                eprintln!("rail WebView recovery: {error}");
            }
        })
        .map_err(|e| e.to_string())?;
    // attach is called on the main thread, so the callback above has finished.
    unsafe {
        if IsWindowVisible(root as HWND) != 0 && GetPropW(root as HWND, REPAINT.as_ptr()).is_null()
        {
            window
                .emit_to(window.label(), "rail-restored", ())
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod transition_tests {
    use super::*;
    use std::cell::Cell;
    thread_local! {
        static HIDES: Cell<u32> = const { Cell::new(0) };
        static ACTIVATIONS: Cell<u32> = const { Cell::new(0) };
    }
    unsafe extern "system" fn observe(
        hwnd: HWND,
        message: u32,
        wp: usize,
        lp: isize,
        _: usize,
        _: usize,
    ) -> isize {
        if message == WM_SHOWWINDOW && wp == 0 {
            HIDES.with(|count| count.set(count.get() + 1));
        }
        if message == WM_SETFOCUS || (message == WM_ACTIVATE && wp & 0xffff != WA_INACTIVE as usize)
        {
            ACTIVATIONS.with(|count| count.set(count.get() + 1));
        }
        DefSubclassProc(hwnd, message, wp, lp)
    }
    struct TestWindow(HWND);
    impl TestWindow {
        unsafe fn new(visible: bool) -> Self {
            let handle = CreateWindowExW(
                0,
                wide("STATIC").as_ptr(),
                null(),
                WS_POPUP | if visible { WS_VISIBLE } else { 0 },
                -30000,
                -30000,
                100,
                100,
                null_mut(),
                null_mut(),
                null_mut(),
                null(),
            );
            assert!(!handle.is_null());
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
    fn cold_worker_icons_contain_visible_pixels() {
        std::thread::spawn(|| {
            let path =
                std::path::PathBuf::from(std::env::var_os("WINDIR").unwrap()).join("notepad.exe");
            for _ in 0..8 {
                let data = icon(&path).unwrap().expect("Shell icon must load");
                let bytes = STANDARD.decode(data.split_once(',').unwrap().1).unwrap();
                let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
                    .read_info()
                    .unwrap();
                let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
                let info = reader.next_frame(&mut pixels).unwrap();
                assert!(
                    pixels[..info.buffer_size()]
                        .chunks_exact(4)
                        .any(|pixel| pixel[3] > 0),
                    "Shell returned an empty icon"
                );
            }
        })
        .join()
        .unwrap();
    }
    #[test]
    fn desktop_visibility_requires_one_repaint_after_restore() {
        unsafe {
            let parent = TestWindow::new(true);
            let rail = TestWindow::new(false);
            let browser = TestWindow::new(true);
            position_window(rail.0, parent.0, -30000, -30000, 100, 100).unwrap();
            SetParent(browser.0, rail.0);
            SetWindowLongPtrW(browser.0, GWL_STYLE, (WS_CHILD | WS_VISIBLE) as isize);
            SetPropW(rail.0, BROWSER.as_ptr(), browser.0 as _);
            assert_ne!(
                SetWindowSubclass(rail.0, Some(observe_visibility), VISIBILITY_SUBCLASS, 0),
                0
            );
            let bounds = Bounds {
                x: -30000,
                y: -30000,
                width: 100,
                height: 100,
            };
            assert!(layout_healthy(rail.0, parent.0, &bounds));
            // A quick hide/show between polling ticks must not lose recovery.
            ShowWindow(rail.0, SW_HIDE);
            ShowWindow(rail.0, SW_SHOWNOACTIVATE);
            assert!(!layout_healthy(rail.0, parent.0, &bounds));
            RemovePropW(rail.0, REPAINT.as_ptr());
            assert!(layout_healthy(rail.0, parent.0, &bounds));
            // A hidden browser is unhealthy even when the outer rail is visible.
            ShowWindow(browser.0, SW_HIDE);
            assert!(!layout_healthy(rail.0, parent.0, &bounds));
            ShowWindow(browser.0, SW_SHOWNOACTIVATE);
            assert!(layout_healthy(rail.0, parent.0, &bounds));
            // Do not fight Explorer while the entire desktop host is hidden.
            ShowWindow(parent.0, SW_HIDE);
            assert!(layout_healthy(rail.0, parent.0, &bounds));
            ShowWindow(parent.0, SW_SHOWNOACTIVATE);
            assert!(!layout_healthy(rail.0, parent.0, &bounds));
            RemovePropW(rail.0, REPAINT.as_ptr());
            assert!(layout_healthy(rail.0, parent.0, &bounds));
        }
    }
    #[test]
    fn icon_list_reordering_is_detected_and_repaired_without_showing_icons() {
        use windows_sys::Win32::UI::Controls::{
            InitCommonControlsEx, ICC_LISTVIEW_CLASSES, INITCOMMONCONTROLSEX,
        };
        unsafe {
            assert_ne!(
                InitCommonControlsEx(&INITCOMMONCONTROLSEX {
                    dwSize: size_of::<INITCOMMONCONTROLSEX>() as u32,
                    dwICC: ICC_LISTVIEW_CLASSES,
                }),
                0
            );
            let parent = TestWindow::new(true);
            let icons = TestWindow(CreateWindowExW(
                0,
                wide("SysListView32").as_ptr(),
                null(),
                WS_CHILD | WS_VISIBLE,
                0,
                0,
                100,
                100,
                parent.0,
                null_mut(),
                null_mut(),
                null(),
            ));
            assert!(!icons.0.is_null());
            let rail = TestWindow::new(false);
            let browser = TestWindow::new(true);
            let bounds = Bounds {
                x: -30000,
                y: -30000,
                width: 100,
                height: 100,
            };
            position_window(rail.0, parent.0, bounds.x, bounds.y, 100, 100).unwrap();
            SetParent(browser.0, rail.0);
            SetWindowLongPtrW(browser.0, GWL_STYLE, (WS_CHILD | WS_VISIBLE) as isize);
            SetPropW(rail.0, BROWSER.as_ptr(), browser.0 as _);
            assert!(layout_healthy(rail.0, parent.0, &bounds));
            for show_icons in [true, false, true] {
                ShowWindow(
                    icons.0,
                    if show_icons {
                        SW_SHOWNOACTIVATE
                    } else {
                        SW_HIDE
                    },
                );
                SetWindowPos(
                    icons.0,
                    HWND_TOP,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
                assert!(!layout_healthy(rail.0, parent.0, &bounds));
                position_window(rail.0, parent.0, bounds.x, bounds.y, 100, 100).unwrap();
                assert!(layout_healthy(rail.0, parent.0, &bounds));
                assert_eq!(IsWindowVisible(icons.0) != 0, show_icons);
                assert_ne!(IsWindowVisible(parent.0), 0);
                ShowWindow(rail.0, SW_HIDE);
                assert_eq!(IsWindowVisible(icons.0) != 0, show_icons);
                position_window(rail.0, parent.0, bounds.x, bounds.y, 100, 100).unwrap();
                assert!(layout_healthy(rail.0, parent.0, &bounds));
                assert_eq!(IsWindowVisible(icons.0) != 0, show_icons);
            }
        }
    }
    #[test]
    fn layout_updates_keep_the_rail_attached_visible_and_inactive() {
        unsafe {
            let parent = TestWindow::new(true);
            let rail = TestWindow::new(false);
            assert_ne!(SetWindowSubclass(rail.0, Some(observe), 1, 0), 0);
            position_window(rail.0, parent.0, -30000, -30000, 100, 100).unwrap();
            HIDES.with(|count| count.set(0));
            ACTIVATIONS.with(|count| count.set(0));
            for height in [200, 100, 200, 100] {
                position_window(rail.0, parent.0, -30000, -30000, 100, height).unwrap();
                assert_eq!(GetParent(rail.0), parent.0);
                assert_ne!(IsWindowVisible(rail.0), 0);
                assert!(Bounds {
                    x: -30000,
                    y: -30000,
                    width: 100,
                    height
                }
                .matches(rail.0));
                // A visible, attached window still needs repair after the
                // display size or scale changes its expected geometry.
                assert!(!Bounds {
                    x: -30000,
                    y: -30000,
                    width: 120,
                    height
                }
                .matches(rail.0));
            }
            assert_eq!(HIDES.with(Cell::get), 0);
            // Observe this window instead of assuming the user and other
            // concurrently running tests never change the global foreground.
            assert_eq!(ACTIVATIONS.with(Cell::get), 0);
            RemoveWindowSubclass(rail.0, Some(observe), 1);
        }
    }
}
pub fn desktop_directories() -> (Vec<std::path::PathBuf>, Vec<String>) {
    let mut directories = vec![];
    let mut issues = vec![];
    for (id, label) in [
        (FOLDERID_Desktop, "个人桌面"),
        (FOLDERID_PublicDesktop, "公共桌面"),
    ] {
        unsafe {
            let mut value = null_mut();
            let result = SHGetKnownFolderPath(&id, 0, null_mut(), &mut value);
            if result < 0 || value.is_null() {
                issues.push(format!("无法读取{label}：{result}"));
                continue;
            }
            let mut length = 0;
            while *value.add(length) != 0 {
                length += 1;
            }
            let path = String::from_utf16_lossy(std::slice::from_raw_parts(value, length));
            windows_sys::Win32::System::Com::CoTaskMemFree(value.cast());
            directories.push(std::path::PathBuf::from(path));
        }
    }
    (directories, issues)
}
unsafe extern "system" fn find_view(window: HWND, output: LPARAM) -> i32 {
    let view = FindWindowExW(
        window,
        null_mut(),
        wide("SHELLDLL_DefView").as_ptr(),
        null(),
    );
    if !view.is_null() {
        *(output as *mut HWND) = view;
        0
    } else {
        1
    }
}
fn host() -> Result<HWND, String> {
    unsafe {
        let mut view: HWND = null_mut();
        EnumWindows(Some(find_view), &mut view as *mut HWND as LPARAM);
        if view.is_null() {
            Err("找不到桌面图标层，请等待资源管理器恢复后重试".into())
        } else {
            Ok(view)
        }
    }
}
pub fn attached(window: &WebviewWindow, group: &RailGroup) -> bool {
    unsafe {
        match (window.hwnd(), host(), bounds(window, group)) {
            (Ok(hwnd), Ok(host), Ok(bounds)) => {
                let handle = hwnd.0 as HWND;
                layout_healthy(handle, host, &bounds)
            }
            _ => false,
        }
    }
}
struct Bounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}
impl Bounds {
    unsafe fn matches(&self, handle: HWND) -> bool {
        let mut rect: RECT = zeroed();
        GetWindowRect(handle, &mut rect) != 0
            && (
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
            ) == (self.x, self.y, self.width, self.height)
    }
}
pub fn attach(window: &WebviewWindow, group: &RailGroup) -> Result<(), String> {
    super::native_drop::install(window)?;
    super::popup_focus::install(window)?;
    // Menus have a companion window. The rail always remains a non-activating
    // child of Explorer; opening a panel never reparents or resizes this HWND.
    let parent = host()?;
    let handle = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    let Bounds {
        x,
        y,
        width,
        height,
    } = bounds(window, group)?;
    unsafe {
        if SetWindowSubclass(handle, Some(observe_visibility), VISIBILITY_SUBCLASS, 0) == 0 {
            return Err("无法监听拾光绳显示恢复".into());
        }
        let repaint = GetParent(handle) != parent
            || needs_repaint(handle)
            || !above_desktop_icons(handle, parent);
        position_window(handle, parent, x, y, width, height)?;
        if repaint {
            SetPropW(handle, REPAINT.as_ptr(), 1usize as _);
            restore_browser(window)?;
        }
    }
    Ok(())
}
fn bounds(window: &WebviewWindow, group: &RailGroup) -> Result<Bounds, String> {
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("找不到主屏幕")?;
    let screen = monitor.size();
    let origin = monitor.position();
    let width = (screen.width as f64 * group.width).round() as i32;
    let dpi = monitor.scale_factor();
    let unit = (width as f64 / dpi / 880.0).clamp(0.65, 1.35);
    // The native region supplies click-through. Keep the backing surface tall
    // enough for the collapse fade instead of cutting the WebView mid-frame.
    let logical_height = 300.0 * unit + 28.0;
    let height = (logical_height * dpi)
        .ceil()
        .min(screen.height as f64 * (1.0 - group.y)) as i32;
    let x = origin.x + (screen.width as f64 * group.x).round() as i32;
    let y = origin.y + (screen.height as f64 * group.y).round() as i32;
    Ok(Bounds {
        x,
        y,
        width,
        height,
    })
}

unsafe fn position_window(
    handle: HWND,
    parent: HWND,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
) -> Result<(), String> {
    unsafe {
        let mut current = std::mem::zeroed();
        GetWindowRect(handle, &mut current);
        if GetParent(handle) == parent
            && child_styles_healthy(handle)
            && above_desktop_icons(handle, parent)
            && IsWindowVisible(handle) != 0
            && current.left == x
            && current.top == y
            && current.right - current.left == width
            && current.bottom - current.top == height
        {
            return Ok(());
        }
        let changing_parent = GetParent(handle) != parent;
        let style = GetWindowLongPtrW(handle, GWL_STYLE);
        let next_style = (style & !((WS_POPUP | WS_CHILD | WS_CAPTION | WS_THICKFRAME) as isize))
            | WS_CHILD as isize;
        if next_style != style {
            SetWindowLongPtrW(handle, GWL_STYLE, next_style);
        }
        let ex = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        if ex & WS_EX_TOPMOST as isize != 0 {
            SetWindowPos(
                handle,
                HWND_NOTOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
        let next_ex = (ex
            & !((WS_EX_APPWINDOW | WS_EX_TOPMOST | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE) as isize))
            | (WS_EX_TOOLWINDOW | WS_EX_LAYERED) as isize
            | WS_EX_NOACTIVATE as isize;
        if next_ex != ex {
            SetWindowLongPtrW(handle, GWL_EXSTYLE, next_ex);
        }
        let (mut alpha, mut flags) = (0, 0);
        if (GetLayeredWindowAttributes(handle, null_mut(), &mut alpha, &mut flags) == 0
            || alpha != 255
            || flags != LWA_ALPHA)
            && SetLayeredWindowAttributes(handle, 0, 255, LWA_ALPHA) == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
        // Keep the WebView visible throughout the synchronous host change.
        // Hiding it drops its compositor surface and flashes the entire rail.
        if changing_parent {
            SetParent(handle, parent);
        }
        if GetParent(handle) != parent {
            return Err("拾光绳挂载到桌面失败".into());
        }
        let mut point = POINT { x, y };
        if !parent.is_null() {
            MapWindowPoints(null_mut(), parent, &mut point, 1);
        }
        if SetWindowPos(
            handle,
            HWND_TOP,
            point.x,
            point.y,
            width,
            height,
            SWP_NOACTIVATE
                | if next_style != style || next_ex != ex {
                    SWP_FRAMECHANGED
                } else {
                    0
                }
                | if IsWindowVisible(handle) == 0 {
                    SWP_SHOWWINDOW
                } else {
                    0
                }
                | if changing_parent || !above_desktop_icons(handle, parent) {
                    0
                } else {
                    SWP_NOZORDER
                },
        ) == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}
pub fn hit_regions(window: &WebviewWindow, regions: &[super::HitRect]) -> Result<(), String> {
    let handle = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    unsafe {
        let combined = CreateRectRgn(0, 0, 0, 0);
        if combined.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        for r in regions {
            let part = CreateRectRgn(
                r.x.floor() as i32,
                r.y.floor() as i32,
                (r.x + r.width).ceil() as i32,
                (r.y + r.height).ceil() as i32,
            );
            if part.is_null() {
                DeleteObject(combined);
                return Err("无法创建挂件点击区域".into());
            }
            CombineRgn(combined, combined, part, RGN_OR);
            DeleteObject(part);
        }
        let previous = CreateRectRgn(0, 0, 0, 0);
        if !previous.is_null() {
            let unchanged =
                GetWindowRgn(handle, previous) != 0 && EqualRgn(previous, combined) != 0;
            DeleteObject(previous);
            if unchanged {
                DeleteObject(combined);
                return Ok(());
            }
        }
        if SetWindowRgn(handle, combined, 1) == 0 {
            DeleteObject(combined);
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}
pub fn pick(window: &WebviewWindow, folder: bool) -> Result<Vec<String>, String> {
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    unsafe {
        if folder {
            let _ = windows_sys::Win32::System::Com::CoInitializeEx(
                null(),
                windows_sys::Win32::System::Com::COINIT_APARTMENTTHREADED as u32,
            );
            let title = wide("选择要挂在桌面的文件夹");
            let mut info: BROWSEINFOW = zeroed();
            info.hwndOwner = owner;
            info.lpszTitle = title.as_ptr();
            info.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE;
            let pidl = SHBrowseForFolderW(&info);
            if pidl.is_null() {
                return Ok(vec![]);
            }
            let mut buffer = vec![0u16; 32768];
            let ok = SHGetPathFromIDListW(pidl, buffer.as_mut_ptr());
            windows_sys::Win32::System::Com::CoTaskMemFree(pidl as *const _);
            if ok == 0 {
                return Err("无法读取文件夹路径".into());
            }
            return Ok(vec![String::from_utf16_lossy(
                &buffer[..buffer.iter().position(|v| *v == 0).unwrap_or(buffer.len())],
            )]);
        }
        let mut buffer = vec![0u16; 65536];
        let title = wide("选择软件快捷方式、文件或图片");
        let filter = wide("所有文件\0*.*\0");
        let mut info: OPENFILENAMEW = zeroed();
        info.lStructSize = size_of::<OPENFILENAMEW>() as u32;
        info.hwndOwner = owner;
        info.lpstrTitle = title.as_ptr();
        info.lpstrFilter = filter.as_ptr();
        info.lpstrFile = buffer.as_mut_ptr();
        info.nMaxFile = buffer.len() as u32;
        info.Flags = OFN_EXPLORER
            | OFN_FILEMUSTEXIST
            | OFN_PATHMUSTEXIST
            | OFN_ALLOWMULTISELECT
            | OFN_NOCHANGEDIR;
        if GetOpenFileNameW(&mut info) == 0 {
            let error = CommDlgExtendedError();
            return if error == 0 {
                Ok(vec![])
            } else {
                Err(format!("文件选择失败：{error}"))
            };
        }
        let parts = buffer
            .split(|v| *v == 0)
            .take_while(|v| !v.is_empty())
            .map(String::from_utf16_lossy)
            .collect::<Vec<_>>();
        if parts.len() <= 1 {
            Ok(parts)
        } else {
            Ok(parts[1..]
                .iter()
                .map(|name| Path::new(&parts[0]).join(name).display().to_string())
                .collect())
        }
    }
}
struct IconApartment(bool);
impl Drop for IconApartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { windows_sys::Win32::System::Com::CoUninitialize() }
        }
    }
}

pub fn icon(path: &Path) -> Result<Option<String>, String> {
    unsafe {
        use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
        // Async/blocking workers have no guaranteed COM apartment. Shell icon
        // handlers need one, including when resolving a shortcut's target.
        let initialized = CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32);
        if initialized < 0 && initialized != 0x80010106u32 as i32 {
            return Err(format!("无法初始化图标读取：{initialized:#x}"));
        }
        let _apartment = IconApartment(initialized >= 0);
        let mut info: SHFILEINFOW = zeroed();
        if SHGetFileInfoW(
            wide(&path.to_string_lossy()).as_ptr(),
            0,
            &mut info,
            size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        ) == 0
        {
            return Ok(None);
        }
        let dc = CreateCompatibleDC(null_mut());
        let mut bitmap: BITMAPINFO = zeroed();
        bitmap.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        bitmap.bmiHeader.biWidth = 32;
        bitmap.bmiHeader.biHeight = -32;
        bitmap.bmiHeader.biPlanes = 1;
        bitmap.bmiHeader.biBitCount = 32;
        bitmap.bmiHeader.biCompression = BI_RGB;
        let mut pixels = null_mut();
        let dib = CreateDIBSection(dc, &bitmap, DIB_RGB_COLORS, &mut pixels, null_mut(), 0);
        if dc.is_null() || dib.is_null() {
            DestroyIcon(info.hIcon);
            if !dib.is_null() {
                DeleteObject(dib);
            }
            if !dc.is_null() {
                DeleteDC(dc);
            }
            return Ok(None);
        }
        let previous = SelectObject(dc, dib);
        std::ptr::write_bytes(pixels, 0, 4096);
        let drawn = DrawIconEx(dc, 0, 0, info.hIcon, 32, 32, 0, null_mut(), DI_NORMAL);
        // GDI drawing may be batched; synchronize before reading DIB memory.
        let flushed = GdiFlush();
        let mut rgba = std::slice::from_raw_parts(pixels as *const u8, 4096).to_vec();
        SelectObject(dc, previous);
        DeleteObject(dib);
        DeleteDC(dc);
        DestroyIcon(info.hIcon);
        if drawn == 0 || flushed == 0 {
            return Ok(None);
        }
        let has_alpha = rgba.chunks_exact(4).any(|pixel| pixel[3] > 0);
        for pixel in rgba.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            if !has_alpha && pixel[..3].iter().any(|v| *v > 0) {
                pixel[3] = 255;
            }
        }
        if !rgba.chunks_exact(4).any(|pixel| pixel[3] > 0) {
            return Ok(None);
        }
        let mut bytes = vec![];
        {
            let mut encoder = png::Encoder::new(&mut bytes, 32, 32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .map_err(|e| e.to_string())?
                .write_image_data(&rgba)
                .map_err(|e| e.to_string())?;
        }
        Ok(Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(bytes)
        )))
    }
}
