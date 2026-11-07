use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    ffi::c_void,
    hash::{Hash, Hasher},
    io::Read,
    ptr::{null, null_mut},
};
use tauri::{AppHandle, Manager, WebviewWindow};
use windows_sys::{
    core::GUID,
    Win32::{Foundation::RECT, System::Com::*},
};

#[derive(Clone, Serialize)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopBackground {
    screen: ScreenRect,
    virtual_screen: ScreenRect,
    position: String,
    color: String,
    image: Option<String>,
    revision: String,
    issue: Option<String>,
}

// Read-only prefix of IDesktopWallpaper's ABI from Windows SDK ShObjIdl_core.h.
// Keeping this narrow avoids the large generated Shell bindings in memory-limited builds.
#[repr(C)]
struct WallpaperVtable {
    query_interface: usize,
    add_ref: usize,
    release: unsafe extern "system" fn(*mut c_void) -> u32,
    set_wallpaper: usize,
    get_wallpaper: unsafe extern "system" fn(*mut c_void, *const u16, *mut *mut u16) -> i32,
    get_monitor_path: unsafe extern "system" fn(*mut c_void, u32, *mut *mut u16) -> i32,
    get_monitor_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    get_monitor_rect: unsafe extern "system" fn(*mut c_void, *const u16, *mut RECT) -> i32,
    set_color: usize,
    get_color: unsafe extern "system" fn(*mut c_void, *mut u32) -> i32,
    set_position: usize,
    get_position: unsafe extern "system" fn(*mut c_void, *mut i32) -> i32,
}
struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() }
    }
}
struct Wallpaper(*mut c_void);
impl Wallpaper {
    unsafe fn table(&self) -> &WallpaperVtable {
        &**(self.0 as *const *const WallpaperVtable)
    }
}
impl Drop for Wallpaper {
    fn drop(&mut self) {
        unsafe {
            (self.table().release)(self.0);
        }
    }
}
struct ComString(*mut u16);
impl Drop for ComString {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(self.0.cast()) }
    }
}
impl ComString {
    unsafe fn text(&self) -> Result<String, String> {
        if self.0.is_null() {
            return Ok(String::new());
        }
        // Windows owns and NUL-terminates this allocation until CoTaskMemFree.
        let mut len = 0;
        while *self.0.add(len) != 0 {
            len += 1;
        }
        String::from_utf16(std::slice::from_raw_parts(self.0, len))
            .map_err(|_| "壁纸路径编码无效".into())
    }
}
fn check(result: i32, operation: &str) -> Result<(), String> {
    if result < 0 {
        Err(format!("{operation}失败（0x{:08X}）", result as u32))
    } else {
        Ok(())
    }
}

fn read_background(result: &mut DesktopBackground, known: Option<&str>) -> Result<(), String> {
    unsafe {
        check(
            CoInitializeEx(null(), COINIT_APARTMENTTHREADED as u32),
            "连接桌面",
        )?;
        let _apartment = Apartment;
        let mut object = null_mut();
        check(
            CoCreateInstance(
                &GUID::from_u128(0xc2cf3110_460e_4fc1_b9d0_8a1c0c9cc4bd),
                null_mut(),
                CLSCTX_ALL,
                &GUID::from_u128(0xb92b56a9_8b55_4e14_9a89_0199bbb6f93b),
                &mut object,
            ),
            "读取桌面背景",
        )?;
        let wallpaper = Wallpaper(object);
        let table = wallpaper.table();
        let mut count = 0;
        check((table.get_monitor_count)(object, &mut count), "读取显示器")?;
        let mut selected = None;
        let mut monitor_error = None;
        let s = &result.screen;
        let mut virtual_rect = RECT {
            left: s.x,
            top: s.y,
            right: s.x + s.width as i32,
            bottom: s.y + s.height as i32,
        };
        for index in 0..count {
            let mut path = ComString(null_mut());
            check(
                (table.get_monitor_path)(object, index, &mut path.0),
                "读取显示器标识",
            )?;
            let mut rect: RECT = std::mem::zeroed();
            let status = (table.get_monitor_rect)(object, path.0, &mut rect);
            // Wallpaper entries can outlive a disconnected display. A failed or
            // empty entry must not prevent reading the remaining active primary.
            if status != 0 || rect.right <= rect.left || rect.bottom <= rect.top {
                if status < 0 && monitor_error.is_none() {
                    monitor_error = check(status, "读取显示器尺寸").err();
                }
                continue;
            }
            virtual_rect.left = virtual_rect.left.min(rect.left);
            virtual_rect.top = virtual_rect.top.min(rect.top);
            virtual_rect.right = virtual_rect.right.max(rect.right);
            virtual_rect.bottom = virtual_rect.bottom.max(rect.bottom);
            if rect.left == s.x
                && rect.top == s.y
                && rect.right - rect.left == s.width as i32
                && rect.bottom - rect.top == s.height as i32
            {
                selected = Some(path);
            }
        }
        result.virtual_screen = ScreenRect {
            x: virtual_rect.left,
            y: virtual_rect.top,
            width: (virtual_rect.right - virtual_rect.left) as u32,
            height: (virtual_rect.bottom - virtual_rect.top) as u32,
        };
        let selected = selected.ok_or_else(|| {
            monitor_error.unwrap_or_else(|| "未找到主屏幕的壁纸，请刷新重试".into())
        })?;
        let mut path = ComString(null_mut());
        check(
            (table.get_wallpaper)(object, selected.0, &mut path.0),
            "读取主屏幕壁纸",
        )?;
        let path = path.text()?;
        let mut position = 0;
        let mut color = 0;
        check((table.get_position)(object, &mut position), "读取壁纸布局")?;
        check((table.get_color)(object, &mut color), "读取桌面颜色")?;
        result.position = ["center", "tile", "stretch", "fit", "fill", "span"]
            .get(position as usize)
            .ok_or("无法识别壁纸布局")?
            .to_string();
        result.color = format!(
            "#{:02x}{:02x}{:02x}",
            color & 255,
            (color >> 8) & 255,
            (color >> 16) & 255
        );
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut hash);
        result.position.hash(&mut hash);
        result.color.hash(&mut hash);
        for n in [
            result.screen.x,
            result.screen.y,
            result.screen.width as i32,
            result.screen.height as i32,
            virtual_rect.left,
            virtual_rect.top,
            virtual_rect.right,
            virtual_rect.bottom,
        ] {
            n.hash(&mut hash);
        }
        let mut file = if path.is_empty() {
            None
        } else {
            let file = std::fs::File::open(&path)
                .map_err(|_| "壁纸文件无法读取，请重新选择壁纸或使用参考图片")?;
            let metadata = file.metadata().map_err(|_| "无法读取壁纸文件信息")?;
            if metadata.len() > 32 * 1024 * 1024 {
                return Err("壁纸文件超过 32 MB，请选择较小的参考图片".into());
            }
            metadata.len().hash(&mut hash);
            metadata.modified().ok().hash(&mut hash);
            Some(file)
        };
        result.revision = format!("{:x}", hash.finish());
        if known == Some(result.revision.as_str()) {
            return Ok(());
        }
        if let Some(file) = file.as_mut() {
            let mut bytes = Vec::new();
            file.take(32 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(|_| "无法加载壁纸图片")?;
            if bytes.len() > 32 * 1024 * 1024 {
                return Err("壁纸文件超过 32 MB".into());
            }
            let mime = if bytes.starts_with(b"\x89PNG") {
                "image/png"
            } else if bytes.starts_with(b"\xff\xd8\xff") {
                "image/jpeg"
            } else if bytes.starts_with(b"BM") {
                "image/bmp"
            } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
                "image/webp"
            } else {
                return Err("此壁纸格式暂不支持，请选择 PNG、JPEG、WebP 或 BMP 参考图片".into());
            };
            result.image = Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)));
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_desktop_background(
    app: AppHandle,
    window: WebviewWindow,
    known_revision: Option<String>,
) -> Result<DesktopBackground, String> {
    if !["settings", "overlay"].contains(&window.label()) {
        return Err("窗口无权读取桌面壁纸".into());
    }
    let monitor = app
        .get_webview_window("overlay")
        .ok_or("找不到桌面效果窗口")?
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("找不到主显示器")?;
    let screen = ScreenRect {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
    };
    // COM objects stay on this blocking worker, never across an await or on the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = DesktopBackground {
            virtual_screen: screen.clone(),
            screen,
            position: "fill".into(),
            color: "#25232c".into(),
            image: None,
            revision: String::new(),
            issue: None,
        };
        if let Err(error) = read_background(&mut result, known_revision.as_deref()) {
            result.issue = Some(error);
            result.revision.clear();
            result.image = None;
        }
        result
    })
    .await
    .map_err(|e| e.to_string())
}
