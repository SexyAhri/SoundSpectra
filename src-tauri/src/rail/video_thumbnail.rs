//! Read one still from the Shell's video thumbnail provider, never a file icon.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    mem::{size_of, zeroed},
    path::Path,
    ptr::null_mut,
};
use windows::{
    core::HSTRING,
    Win32::{
        Foundation::SIZE,
        UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_THUMBNAILONLY},
    },
};
use windows_sys::Win32::{
    Graphics::Gdi::*,
    System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
};

pub fn supports(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "mp4"
            | "m4v"
            | "mov"
            | "mkv"
            | "avi"
            | "webm"
            | "wmv"
            | "mpeg"
            | "mpg"
            | "mts"
            | "m2ts"
            | "ts"
            | "flv"
    )
}

struct Apartment(bool);
impl Drop for Apartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() }
        }
    }
}
struct Bitmap(HBITMAP);
impl Drop for Bitmap {
    fn drop(&mut self) {
        unsafe {
            DeleteObject(self.0);
        }
    }
}

pub fn load(path: &Path) -> Result<Option<String>, String> {
    unsafe {
        let initialized = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        if initialized < 0 && initialized != 0x80010106u32 as i32 {
            return Err(format!("无法初始化视频预览：{initialized:#x}"));
        }
        let _apartment = Apartment(initialized >= 0);
        let factory: IShellItemImageFactory =
            SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)
                .map_err(|e| e.to_string())?;
        let bitmap = match factory.GetImage(SIZE { cx: 480, cy: 320 }, SIIGBF_THUMBNAILONLY) {
            Ok(bitmap) => Bitmap(bitmap.0),
            // Unsupported codecs must remain a preview placeholder, not a
            // generic Shell icon enlarged to look like a video frame.
            Err(_) => return Ok(None),
        };
        let mut info: BITMAP = zeroed();
        if GetObjectW(
            bitmap.0,
            size_of::<BITMAP>() as i32,
            (&mut info as *mut BITMAP).cast(),
        ) == 0
        {
            return Ok(None);
        }
        let width = info.bmWidth;
        let height = info.bmHeight.checked_abs().unwrap_or(0);
        if width <= 0 || height <= 0 || width > 2048 || height > 2048 {
            return Ok(None);
        }
        let mut format: BITMAPINFO = zeroed();
        format.bmiHeader.biSize = size_of::<BITMAPINFOHEADER>() as u32;
        format.bmiHeader.biWidth = width;
        format.bmiHeader.biHeight = -height;
        format.bmiHeader.biPlanes = 1;
        format.bmiHeader.biBitCount = 32;
        format.bmiHeader.biCompression = BI_RGB;
        let dc = CreateCompatibleDC(null_mut());
        if dc.is_null() {
            return Ok(None);
        }
        let mut pixels = vec![0u8; width as usize * height as usize * 4];
        let copied = GetDIBits(
            dc,
            bitmap.0,
            0,
            height as u32,
            pixels.as_mut_ptr().cast(),
            &mut format,
            DIB_RGB_COLORS,
        );
        DeleteDC(dc);
        if copied != height {
            return Ok(None);
        }
        let has_alpha = pixels.chunks_exact(4).any(|pixel| pixel[3] > 0);
        for pixel in pixels.chunks_exact_mut(4) {
            pixel.swap(0, 2);
            if !has_alpha {
                pixel[3] = 255;
            }
            // Shell bitmaps use premultiplied BGRA; PNG uses straight RGBA.
            if pixel[3] > 0 && pixel[3] < 255 {
                let alpha = pixel[3] as u32;
                for channel in &mut pixel[..3] {
                    *channel = ((*channel as u32 * 255 + alpha / 2) / alpha).min(255) as u8;
                }
            }
        }
        let mut bytes = vec![];
        {
            let mut encoder = png::Encoder::new(&mut bytes, width as u32, height as u32);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder
                .write_header()
                .map_err(|e| e.to_string())?
                .write_image_data(&pixels)
                .map_err(|e| e.to_string())?;
        }
        Ok(Some(format!(
            "data:image/png;base64,{}",
            STANDARD.encode(bytes)
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_video_extensions_without_changing_file_kinds() {
        for extension in [
            "MP4", "m4v", "mov", "mkv", "avi", "webm", "wmv", "mpeg", "mpg", "mts", "m2ts", "ts",
            "flv",
        ] {
            assert!(supports(Path::new(&format!("C:/影片/旅行.{extension}"))));
        }
        for path in ["C:/notes.mp4.txt", "C:/notes.txt", "C:/photo.jpg"] {
            assert!(!supports(Path::new(path)));
        }
    }

    #[test]
    #[ignore = "requires SOUNDSPECTRA_TEST_VIDEO pointing to a local video"]
    fn local_video_produces_a_decodable_frame_on_a_cold_worker() {
        std::thread::spawn(|| {
            let path = std::env::var_os("SOUNDSPECTRA_TEST_VIDEO").expect("video path");
            let data = load(Path::new(&path)).unwrap().expect("video thumbnail");
            let bytes = STANDARD.decode(data.split_once(',').unwrap().1).unwrap();
            let mut reader = png::Decoder::new(std::io::Cursor::new(&bytes))
                .read_info()
                .unwrap();
            let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
            let info = reader.next_frame(&mut pixels).unwrap();
            assert!(
                info.width > 32 && info.height > 32,
                "must be a frame, not a file icon"
            );
            assert!(pixels[..info.buffer_size()]
                .chunks_exact(4)
                .any(|p| p[3] > 0));
            if let Some(output) = std::env::var_os("SOUNDSPECTRA_TEST_VIDEO_OUTPUT") {
                std::fs::write(output, bytes).unwrap();
            }
        })
        .join()
        .unwrap();
    }
}
