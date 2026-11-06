//! Register both the rail root and WebView child HWNDs, including children
//! created after Wry's one-time enumeration. All registration is on the UI thread.
use std::cell::{Cell, OnceCell};
use tauri::{Emitter, WebviewWindow};
use windows::{
    core::{implement, Ref},
    Win32::{
        Foundation::{HWND, POINTL},
        System::{
            Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL},
            Ole::{
                IDropTarget, IDropTarget_Impl, OleInitialize, OleUninitialize, RegisterDragDrop,
                ReleaseStgMedium, RevokeDragDrop, CF_HDROP, DROPEFFECT, DROPEFFECT_COPY,
                DROPEFFECT_LINK, DROPEFFECT_NONE,
            },
            SystemServices::MODIFIERKEYS_FLAGS,
        },
    },
};

struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            OleUninitialize();
        }
    }
}
thread_local! { static APARTMENT: OnceCell<Result<Apartment, String>> = const { OnceCell::new() }; }

#[implement(IDropTarget)]
struct FileTarget {
    publish: Box<dyn Fn(Vec<String>, &POINTL) -> bool>,
    valid: Cell<bool>,
}

fn paths(data: Ref<'_, IDataObject>) -> Vec<String> {
    let Some(data) = data.as_ref() else {
        return vec![];
    };
    let format = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: std::ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    unsafe {
        let Ok(mut medium) = data.GetData(&format) else {
            return vec![];
        };
        let paths = if medium.tymed == TYMED_HGLOBAL.0 as u32 {
            super::native_drop::read_paths(medium.u.hGlobal.0)
        } else {
            vec![]
        };
        // The IDataObject owns the medium policy, including pUnkForRelease.
        // DragFinish is only for WM_DROPFILES; OLE data uses ReleaseStgMedium.
        ReleaseStgMedium(&mut medium);
        paths
    }
}
fn effect(valid: bool, offered: DROPEFFECT) -> DROPEFFECT {
    if valid && offered.0 & DROPEFFECT_COPY.0 != 0 {
        DROPEFFECT_COPY
    } else if valid && offered.0 & DROPEFFECT_LINK.0 != 0 {
        // A mounted item is a reference. Never claim MOVE: Explorer must retain
        // the original file so unmounting can restore its desktop visibility.
        DROPEFFECT_LINK
    } else {
        DROPEFFECT_NONE
    }
}
#[allow(non_snake_case)]
impl IDropTarget_Impl for FileTarget_Impl {
    fn DragEnter(
        &self,
        data: Ref<'_, IDataObject>,
        _: MODIFIERKEYS_FLAGS,
        _: &POINTL,
        output: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        self.valid.set(!paths(data).is_empty());
        unsafe {
            *output = effect(self.valid.get(), *output);
        }
        Ok(())
    }
    fn DragOver(
        &self,
        _: MODIFIERKEYS_FLAGS,
        _: &POINTL,
        output: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        unsafe {
            *output = effect(self.valid.get(), *output);
        }
        Ok(())
    }
    fn DragLeave(&self) -> windows::core::Result<()> {
        self.valid.set(false);
        Ok(())
    }
    fn Drop(
        &self,
        data: Ref<'_, IDataObject>,
        _: MODIFIERKEYS_FLAGS,
        point: &POINTL,
        output: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let paths = paths(data);
        unsafe {
            *output = effect(!paths.is_empty(), *output);
            if *output == DROPEFFECT_NONE {
                return Ok(());
            }
        }
        if !(self.publish)(paths, point) {
            unsafe {
                *output = DROPEFFECT_NONE;
            }
        }
        self.valid.set(false);
        Ok(())
    }
}
pub(super) fn register(
    window: &WebviewWindow,
    hwnd: windows_sys::Win32::Foundation::HWND,
) -> Result<IDropTarget, String> {
    let window = window.clone();
    let target: IDropTarget = FileTarget {
        publish: Box::new(move |paths, point| {
            let mut position = windows_sys::Win32::Foundation::POINT {
                x: point.x,
                y: point.y,
            };
            if let Ok(root) = window.hwnd() {
                unsafe {
                    windows_sys::Win32::Graphics::Gdi::ScreenToClient(root.0 as _, &mut position);
                }
            }
            window
                .emit_to(
                    window.label(),
                    "rail-native-drop",
                    super::native_drop::Drop {
                        paths,
                        position: super::native_drop::Position {
                            x: position.x,
                            y: position.y,
                        },
                    },
                )
                .is_ok()
        }),
        valid: Cell::new(false),
    }
    .into();
    install(hwnd, &target)?;
    Ok(target)
}
fn install(hwnd: windows_sys::Win32::Foundation::HWND, target: &IDropTarget) -> Result<(), String> {
    APARTMENT.with(|slot| {
        slot.get_or_init(|| unsafe {
            OleInitialize(None)
                .map(|_| Apartment)
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map(|_| ())
        .map_err(Clone::clone)
    })?;
    unsafe {
        let _ = RevokeDragDrop(HWND(hwnd));
        RegisterDragDrop(HWND(hwnd), target).map_err(|e| format!("无法注册系统拖放目标：{e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn drag_feedback_only_accepts_files_and_preserves_source_copy_permissions() {
        assert_eq!(effect(true, DROPEFFECT_COPY), DROPEFFECT_COPY);
        assert_eq!(effect(false, DROPEFFECT_COPY), DROPEFFECT_NONE);
        assert_eq!(effect(true, DROPEFFECT(2)), DROPEFFECT_NONE);
        assert_eq!(effect(true, DROPEFFECT(3)), DROPEFFECT_COPY);
        assert_eq!(effect(true, DROPEFFECT_LINK), DROPEFFECT_LINK);
        assert_eq!(effect(true, DROPEFFECT(6)), DROPEFFECT_LINK);
    }
    #[test]
    fn registers_real_window_and_accepts_shell_files_folders_and_images() {
        use std::{cell::RefCell, rc::Rc};
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::{
            BHID_DataObject, IShellItem, IShellItemArray, SHCreateItemFromParsingName,
            SHCreateShellItemArrayFromShellItem,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow};
        let root = std::env::temp_dir().join(super::super::model::new_id());
        std::fs::create_dir(&root).unwrap();
        let file = root.join("测试文件.txt");
        let image = root.join("照片.png");
        std::fs::write(&file, b"keep").unwrap();
        std::fs::write(&image, b"png fixture").unwrap();
        let received = Rc::new(RefCell::new(vec![]));
        let sink = received.clone();
        let target: IDropTarget = FileTarget {
            publish: Box::new(move |paths, _| {
                sink.borrow_mut().extend(paths);
                true
            }),
            valid: Cell::new(false),
        }
        .into();
        unsafe {
            let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0,
                0,
                0,
                1,
                1,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null(),
            );
            assert!(!hwnd.is_null());
            install(hwnd, &target).unwrap();
            for path in [&file, &root, &image] {
                let item: IShellItem =
                    SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None).unwrap();
                let array: IShellItemArray = SHCreateShellItemArrayFromShellItem(&item).unwrap();
                let data: IDataObject = array.BindToHandler(None, &BHID_DataObject).unwrap();
                let point = POINTL { x: 0, y: 0 };
                let keys = MODIFIERKEYS_FLAGS(0);
                let mut feedback = DROPEFFECT(3);
                target.DragEnter(&data, keys, point, &mut feedback).unwrap();
                assert_eq!(feedback, DROPEFFECT_COPY);
                feedback = DROPEFFECT(3);
                target.DragOver(keys, point, &mut feedback).unwrap();
                assert_eq!(feedback, DROPEFFECT_COPY);
                feedback = DROPEFFECT(3);
                target.Drop(&data, keys, point, &mut feedback).unwrap();
                assert_eq!(feedback, DROPEFFECT_COPY);
            }
            RevokeDragDrop(HWND(hwnd)).unwrap();
            DestroyWindow(hwnd);
        }
        assert_eq!(received.borrow().len(), 3);
        assert_eq!(std::fs::read(&file).unwrap(), b"keep");
        std::fs::remove_dir_all(root).unwrap();
    }
}
