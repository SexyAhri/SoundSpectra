//! Register application-owned HWNDs on their UI thread, including the native
//! receiving surface above WebView2 during an external drag.
use std::cell::{Cell, OnceCell};
use tauri::{Emitter, Manager, WebviewWindow};
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
    storage: std::path::PathBuf,
    error: Box<dyn Fn(String)>,
}

fn paths(data: &Ref<'_, IDataObject>) -> Vec<String> {
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
fn items(data: Ref<'_, IDataObject>) -> Result<Vec<super::shell_drop::Item>, String> {
    let files = paths(&data);
    if !files.is_empty() {
        return Ok(files
            .into_iter()
            .map(super::shell_drop::Item::File)
            .collect());
    }
    super::shell_drop::read(data.as_ref().ok_or("拖入的项目为空")?)
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
        let entries = items(data);
        super::native_drop::trace(
            "drag-enter",
            serde_json::json!({"items": entries.as_ref().map(|v| v.len()).ok(), "error": entries.as_ref().err(), "offered": unsafe { (*output).0 }}),
        );
        self.valid.set(entries.is_ok());
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
        super::native_drop::trace("drag-leave", serde_json::json!({}));
        Ok(())
    }
    fn Drop(
        &self,
        data: Ref<'_, IDataObject>,
        _: MODIFIERKEYS_FLAGS,
        point: &POINTL,
        output: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let entries = items(data);
        super::native_drop::trace(
            "drop-received",
            serde_json::json!({"items": entries.as_ref().map(|v| v.len()).ok(), "error": entries.as_ref().err(), "offered": unsafe { (*output).0 }}),
        );
        self.valid.set(false);
        unsafe {
            *output = effect(entries.is_ok(), *output);
            if *output == DROPEFFECT_NONE {
                return Ok(());
            }
        }
        let paths =
            match entries.and_then(|items| super::shell_drop::materialize(items, &self.storage)) {
                Ok(paths) => paths,
                Err(error) => {
                    (self.error)(error);
                    unsafe {
                        *output = DROPEFFECT_NONE;
                    }
                    return Ok(());
                }
            };
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
    let storage = window
        .app_handle()
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("rail-apps");
    let errors = window.clone();
    let window = window.clone();
    let target: IDropTarget = FileTarget {
        publish: Box::new(move |paths, point| {
            let count = paths.len();
            super::drop_surface::finish(&window);
            let mut position = windows_sys::Win32::Foundation::POINT {
                x: point.x,
                y: point.y,
            };
            if let Ok(root) = window.hwnd() {
                unsafe {
                    windows_sys::Win32::Graphics::Gdi::ScreenToClient(root.0 as _, &mut position);
                }
            }
            let result = window
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
                );
            super::native_drop::trace("drop-delivery", serde_json::json!({"label": window.label(), "count": count, "ok": result.is_ok(), "error": result.as_ref().err().map(ToString::to_string)}));
            result.is_ok()
        }),
        valid: Cell::new(false),
        storage,
        error: Box::new(move |error| {
            super::native_drop::trace(
                "drop-error",
                serde_json::json!({"label": errors.label(), "error": error}),
            );
            super::drop_surface::finish(&errors);
            let _ = errors.emit_to(errors.label(), "rail-drop-error", error);
        }),
    }
    .into();
    install(hwnd, &target)?;
    Ok(target)
}
fn install(hwnd: windows_sys::Win32::Foundation::HWND, target: &IDropTarget) -> Result<(), String> {
    // RegisterDragDrop can appear to succeed for a foreign HWND, but its COM
    // target must belong to the window's process and UI apartment. In
    // particular, never revoke/register on WebView2 renderer or GPU HWNDs.
    unsafe {
        use windows_sys::Win32::{System::Threading::*, UI::WindowsAndMessaging::*};
        let mut process = 0;
        let thread = GetWindowThreadProcessId(hwnd, &mut process);
        if process != GetCurrentProcessId() || thread != GetCurrentThreadId() {
            return Err("拖放目标必须在所属窗口的 UI 线程注册".into());
        }
    }
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
            storage: root.join("owned-apps"),
            error: Box::new(|error| panic!("{error}")),
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

    #[test]
    fn shell_app_only_writes_on_accepted_drop_and_publishes_once() {
        use std::{cell::RefCell, rc::Rc};
        use windows::Win32::UI::Shell::{
            BHID_DataObject, IShellItemArray, SHCreateShellItemArrayFromShellItem,
        };
        unsafe {
            OleInitialize(None).unwrap();
            let root = std::env::temp_dir().join(super::super::model::new_id());
            let item = super::super::shell_drop::tests::application();
            let array: IShellItemArray = SHCreateShellItemArrayFromShellItem(&item).unwrap();
            let data: IDataObject = array.BindToHandler(None, &BHID_DataObject).unwrap();
            let received = Rc::new(RefCell::new(Vec::new()));
            let sink = received.clone();
            let target: IDropTarget = FileTarget {
                publish: Box::new(move |paths, point| {
                    sink.borrow_mut().push((paths, point.x, point.y));
                    true
                }),
                valid: Cell::new(false),
                storage: root.clone(),
                error: Box::new(|error| panic!("{error}")),
            }
            .into();
            let point = POINTL { x: 23, y: 41 };
            let keys = MODIFIERKEYS_FLAGS(0);
            let mut feedback = DROPEFFECT_LINK;
            target.DragEnter(&data, keys, point, &mut feedback).unwrap();
            assert_eq!(feedback, DROPEFFECT_LINK);
            assert!(!root.exists());
            target.DragLeave().unwrap();
            feedback = DROPEFFECT_LINK;
            target.DragOver(keys, point, &mut feedback).unwrap();
            assert_eq!(feedback, DROPEFFECT_NONE);
            feedback = DROPEFFECT(2); // MOVE alone must never consume an app.
            target.Drop(&data, keys, point, &mut feedback).unwrap();
            assert_eq!(feedback, DROPEFFECT_NONE);
            assert!(!root.exists());
            assert!(received.borrow().is_empty());
            feedback = DROPEFFECT_LINK;
            target.Drop(&data, keys, point, &mut feedback).unwrap();
            assert_eq!(feedback, DROPEFFECT_LINK);
            let events = received.borrow();
            assert_eq!(events.len(), 1);
            assert_eq!((events[0].1, events[0].2), (23, 41));
            assert_eq!(events[0].0.len(), 1);
            assert!(std::path::Path::new(&events[0].0[0]).is_file());
            std::fs::remove_dir_all(root).unwrap();
            std::mem::drop(events);
            std::mem::drop(data);
            std::mem::drop(array);
            std::mem::drop(item);
            std::mem::drop(target);
            OleUninitialize();
        }
    }

    #[test]
    #[ignore]
    fn foreign_window_fixture() {
        let Some(path) = std::env::var_os("SOUNDSPECTRA_DROP_TEST_HWND") else {
            return;
        };
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::*;
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
            let original: IDropTarget = FileTarget {
                publish: Box::new(|_, _| true),
                valid: Cell::new(false),
                storage: std::path::PathBuf::from(&path).with_extension("original"),
                error: Box::new(|_| {}),
            }
            .into();
            install(hwnd, &original).unwrap();
            std::fs::write(&path, (hwnd as usize).to_string()).unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            while std::time::Instant::now() < deadline {
                let mut msg = std::mem::zeroed();
                while PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            DestroyWindow(hwnd);
        }
    }
    #[test]
    fn rejects_foreign_process_window_without_replacing_its_target() {
        let path = std::env::temp_dir().join(super::super::model::new_id());
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "rail::ole_drop::tests::foreign_window_fixture",
                "--ignored",
            ])
            .env("SOUNDSPECTRA_DROP_TEST_HWND", &path)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !path.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        let hwnd = std::fs::read_to_string(&path)
            .unwrap()
            .parse::<usize>()
            .unwrap() as windows_sys::Win32::Foundation::HWND;
        let target: IDropTarget = FileTarget {
            publish: Box::new(|_, _| true),
            valid: Cell::new(false),
            storage: path.with_extension("apps"),
            error: Box::new(|_| {}),
        }
        .into();
        let property = windows::core::w!("OleDropTargetInterface");
        let before = unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::GetPropW(hwnd, property.as_ptr())
        };
        assert!(!before.is_null(), "fixture must already have a drop target");
        let result = install(hwnd, &target);
        let after = unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::GetPropW(hwnd, property.as_ptr())
        };
        child.kill().unwrap();
        child.wait().unwrap();
        std::fs::remove_file(path).unwrap();
        assert!(result.is_err());
        assert_eq!(after, before, "foreign target must remain untouched");
    }
}
