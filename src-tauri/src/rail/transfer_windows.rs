use std::path::Path;
use windows::{
    core::{implement, BOOL, HRESULT, HSTRING},
    Win32::{
        Foundation::{DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, S_OK},
        System::{
            Com::IDataObject,
            Ole::{
                DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize,
                DROPEFFECT, DROPEFFECT_COPY,
            },
            SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS},
        },
        UI::{
            Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON},
            Shell::{
                BHID_DataObject, IShellItem, IShellItemArray, SHCreateItemFromParsingName,
                SHCreateShellItemArrayFromShellItem,
            },
        },
    },
};

#[implement(IDropSource)]
struct RailDropSource;

impl IDropSource_Impl for RailDropSource_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        if escape.as_bool() {
            DRAGDROP_S_CANCEL
        } else if keys.0 & MK_LBUTTON.0 == 0 {
            DRAGDROP_S_DROP
        } else {
            S_OK
        }
    }
    fn GiveFeedback(&self, _effect: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

struct OleGuard;
impl Drop for OleGuard {
    fn drop(&mut self) {
        unsafe {
            OleUninitialize();
        }
    }
}

pub fn drag_file(path: &Path) -> Result<bool, String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    static ACTIVE: AtomicBool = AtomicBool::new(false);
    if ACTIVE.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    struct DragGuard;
    impl Drop for DragGuard {
        fn drop(&mut self) {
            ACTIVE.store(false, Ordering::SeqCst);
        }
    }
    let _drag = DragGuard;
    // Read the button only for this user-initiated drag; install no input hooks.
    if unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } >= 0 {
        return Ok(false);
    }
    unsafe {
        OleInitialize(None).map_err(|e| format!("无法开始系统拖放：{e}"))?;
        let _ole = OleGuard;
        let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None)
            .map_err(|e| format!("无法读取拖出的文件，请重新关联：{e}"))?;
        let items: IShellItemArray =
            SHCreateShellItemArrayFromShellItem(&item).map_err(|e| e.to_string())?;
        let data: IDataObject = items
            .BindToHandler(None, &BHID_DataObject)
            .map_err(|e| e.to_string())?;
        let source: IDropSource = RailDropSource.into();
        let mut effect = DROPEFFECT::default();
        let result = DoDragDrop(&data, &source, DROPEFFECT_COPY, &mut effect);
        if result == DRAGDROP_S_CANCEL {
            return Ok(false);
        }
        result.ok().map_err(|e| format!("系统拖放失败：{e}"))?;
        Ok(result == DRAGDROP_S_DROP && effect.0 != 0)
    }
}

pub fn clipboard_png() -> Result<Vec<u8>, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|e| format!("无法读取剪贴板，请重试：{e}"))?;
    let image = clipboard.get_image().map_err(|e| match e {
        arboard::Error::ContentNotAvailable => "剪贴板里没有图片，请先截图或复制图片".to_string(),
        _ => format!("图片读取失败，请重新复制后重试：{e}"),
    })?;
    encode_png(image.width, image.height, &image.bytes)
}

fn encode_png(width: usize, height: usize, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let pixels = width
        .checked_mul(height)
        .filter(|n| *n > 0 && *n <= 16_777_216)
        .ok_or("图片过大，请缩小后再粘贴（最多 1600 万像素）")?;
    if width > 16_384 || height > 16_384 || pixels.checked_mul(4) != Some(rgba.len()) {
        return Err("剪贴板图片尺寸或格式无效".into());
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    if bytes.len() > 12 * 1024 * 1024 {
        return Err("图片超过 12 MB，请缩小后再粘贴".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clipboard_pixels_are_persisted_losslessly_and_invalid_sizes_rejected() {
        let pixels = [255, 0, 0, 128, 0, 255, 0, 255];
        let bytes = encode_png(2, 1, &pixels).unwrap();
        let mut reader = png::Decoder::new(std::io::Cursor::new(bytes))
            .read_info()
            .unwrap();
        let mut decoded = vec![0; reader.output_buffer_size().unwrap()];
        reader.next_frame(&mut decoded).unwrap();
        assert_eq!(decoded, pixels);
        assert!(encode_png(0, 1, &[]).is_err());
        assert!(encode_png(usize::MAX, 2, &[]).is_err());
        assert!(encode_png(2, 2, &pixels).is_err());
    }
}
