use super::RailGroup;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    mem::{size_of, zeroed},
    path::Path,
    ptr::{null, null_mut},
};
use tauri::WebviewWindow;
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, POINT},
    Graphics::Gdi::*,
    UI::{Controls::Dialogs::*, Shell::*, WindowsAndMessaging::*},
};
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
pub fn desktop_directories() -> (Vec<std::path::PathBuf>, Vec<String>) {
    let mut directories = vec![];
    let mut issues = vec![];
    for (id, label) in [(FOLDERID_Desktop, "个人桌面"), (FOLDERID_PublicDesktop, "公共桌面")] {
        unsafe {
            let mut value = null_mut();
            let result = SHGetKnownFolderPath(&id, 0, null_mut(), &mut value);
            if result < 0 || value.is_null() { issues.push(format!("无法读取{label}：{result}")); continue; }
            let mut length = 0;
            while *value.add(length) != 0 { length += 1; }
            let path = String::from_utf16_lossy(std::slice::from_raw_parts(value,length));
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
pub fn attached(window: &WebviewWindow, expanded: bool) -> bool {
    unsafe {
        match (window.hwnd(), host()) {
            (Ok(hwnd), Ok(host)) => {
                let handle = hwnd.0 as HWND;
                let parent = if expanded { null_mut() } else { host };
                GetParent(handle) == parent && IsWindowVisible(handle) != 0
            }
            _ => false,
        }
    }
}
pub fn attach(window: &WebviewWindow, group: &RailGroup, expanded: bool) -> Result<(), String> {
    // Editable popups need an activatable top-level window. The resting rail
    // remains a non-activating child of Explorer, without any global input hooks.
    let parent = if expanded { null_mut() } else { host()? };
    let handle = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
    let monitor = window
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("找不到主屏幕")?;
    let screen = monitor.size();
    let origin = monitor.position();
    let width = (screen.width as f64 * group.width).round() as i32;
    let dpi = monitor.scale_factor();
    let unit = (width as f64 / dpi / 880.0).clamp(0.65, 1.35);
    let logical_height = if group.collapsed { 36.0 } else { 226.0 * unit + 28.0 };
    let height = ((logical_height + if expanded { 320.0 } else { 0.0 }) * dpi)
        .ceil().min(screen.height as f64 * (1.0 - group.y)) as i32;
    let x = origin.x + (screen.width as f64 * group.x).round() as i32;
    let y = origin.y + (screen.height as f64 * group.y).round() as i32;
    unsafe {
        let mut current = std::mem::zeroed();
        GetWindowRect(handle, &mut current);
        if GetParent(handle) == parent
            && IsWindowVisible(handle) != 0
            && current.left == x
            && current.top == y
            && current.right - current.left == width
            && current.bottom - current.top == height
        {
            return Ok(());
        }
        let changing_parent = GetParent(handle) != parent;
        if changing_parent { ShowWindow(handle, SW_HIDE); }
        SetWindowPos(
            handle,
            HWND_NOTOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
        let style = GetWindowLongPtrW(handle, GWL_STYLE);
        SetWindowLongPtrW(
            handle,
            GWL_STYLE,
            (style & !((WS_POPUP | WS_CHILD | WS_CAPTION | WS_THICKFRAME) as isize))
                | if expanded { WS_POPUP as isize } else { WS_CHILD as isize },
        );
        let ex = GetWindowLongPtrW(handle, GWL_EXSTYLE);
        SetWindowLongPtrW(
            handle,
            GWL_EXSTYLE,
            (ex & !((WS_EX_APPWINDOW | WS_EX_TOPMOST | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE) as isize))
                | (WS_EX_TOOLWINDOW | WS_EX_LAYERED) as isize
                | if expanded { 0 } else { WS_EX_NOACTIVATE as isize },
        );
        if SetLayeredWindowAttributes(handle, 0, 255, LWA_ALPHA) == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        if changing_parent { SetParent(handle, parent); }
        if GetParent(handle) != parent {
            return Err("挂架挂载到桌面失败".into());
        }
        let mut point = POINT { x, y };
        if !parent.is_null() { MapWindowPoints(null_mut(), parent, &mut point, 1); }
        if SetWindowPos(
            handle,
            HWND_TOP,
            point.x,
            point.y,
            width,
            height,
            SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW
                | if changing_parent { 0 } else { SWP_NOZORDER },
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
        if combined.is_null() { return Err(std::io::Error::last_os_error().to_string()); }
        for r in regions {
            let part = CreateRectRgn(r.x.floor() as i32, r.y.floor() as i32, (r.x + r.width).ceil() as i32, (r.y + r.height).ceil() as i32);
            if part.is_null() { DeleteObject(combined); return Err("无法创建挂件点击区域".into()); }
            CombineRgn(combined, combined, part, RGN_OR);
            DeleteObject(part);
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
pub fn icon(path: &Path) -> Result<Option<String>, String> {
    unsafe {
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
            if !dc.is_null() {
                DeleteDC(dc);
            }
            return Ok(None);
        }
        let previous = SelectObject(dc, dib);
        std::ptr::write_bytes(pixels, 0, 4096);
        DrawIconEx(dc, 0, 0, info.hIcon, 32, 32, 0, null_mut(), DI_NORMAL);
        let mut rgba = std::slice::from_raw_parts(pixels as *const u8, 4096).to_vec();
        SelectObject(dc, previous);
        DeleteObject(dib);
        DeleteDC(dc);
        DestroyIcon(info.hIcon);
        let has_alpha = rgba.chunks_exact(4).any(|pixel| pixel[3] > 0);
        for pixel in rgba.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            if !has_alpha && pixel[..3].iter().any(|v| *v > 0) {
                pixel[3] = 255;
            }
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
