use windows::{
    core::Interface,
    Win32::{
        Storage::EnhancedStorage::PKEY_ItemNameDisplay,
        System::{
            Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, IServiceProvider,
                CLSCTX_LOCAL_SERVER, COINIT_APARTMENTTHREADED,
            },
            Variant::VARIANT,
        },
        UI::Shell::{
            IFolderView2, IShellBrowser, IShellView, IShellWindows, SID_STopLevelBrowser,
            ShellWindows, SORTCOLUMN, SORT_ASCENDING, SWC_DESKTOP, SWFO_NEEDDISPATCH,
        },
    },
};

struct Apartment(bool);
impl Drop for Apartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                CoUninitialize();
            }
        }
    }
}

// Refresh the desktop's existing Shell view. Attribute notifications alone
// repaint icons as ghosted but do not re-enumerate the visibility filter.
fn desktop_view() -> windows::core::Result<IShellView> {
    unsafe {
        let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_LOCAL_SERVER)?;
        let empty = VARIANT::default();
        let dispatch =
            windows.FindWindowSW(&empty, &empty, SWC_DESKTOP, &mut 0, SWFO_NEEDDISPATCH)?;
        let services: IServiceProvider = dispatch.cast()?;
        let browser: IShellBrowser = services.QueryService(&SID_STopLevelBrowser)?;
        browser.QueryActiveShellView()
    }
}

pub fn refresh_and_sort_by_name() -> Result<(), String> {
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        // RPC_E_CHANGED_MODE means the host already initialized another COM
        // apartment; use it without uninitializing somebody else's reference.
        if initialized.is_err() && initialized.0 != 0x80010106u32 as i32 {
            return Err(format!("无法初始化桌面刷新：{initialized}"));
        }
        let _apartment = Apartment(initialized.is_ok());
        let view = desktop_view().map_err(|error| format!("无法连接桌面图标视图：{error}"))?;
        view.Refresh()
            .map_err(|error| format!("桌面图标已处理，但刷新失败：{error}"))?;
        // Use Explorer's sort operation to close gaps and place restored icons.
        // This is a one-off arrangement, without enabling automatic arrangement.
        let folder: IFolderView2 = view.cast().map_err(|error| error.to_string())?;
        folder
            .SetSortColumns(&[SORTCOLUMN {
                propkey: PKEY_ItemNameDisplay,
                direction: SORT_ASCENDING,
            }])
            .map_err(|error| format!("桌面图标已刷新，但按名称排列失败：{error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        time::{Duration, Instant},
    };
    use windows::{
        core::PCWSTR,
        Win32::{
            Storage::FileSystem::{
                SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_NORMAL,
                FILE_ATTRIBUTE_SYSTEM,
            },
            UI::Shell::{IShellItem, SIGDN_FILESYSPATH, SVGIO_ALLVIEW},
        },
    };

    struct DesktopFiles(Vec<PathBuf>);
    impl Drop for DesktopFiles {
        fn drop(&mut self) {
            for path in &self.0 {
                let name: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
                unsafe {
                    let _ = SetFileAttributesW(PCWSTR(name.as_ptr()), FILE_ATTRIBUTE_NORMAL);
                }
                let _ = std::fs::remove_file(path);
            }
            let _ = refresh_and_sort_by_name();
        }
    }
    use std::os::windows::ffi::OsStrExt;

    fn position(folder: &IFolderView2, path: &std::path::Path) -> Option<(i32, i32)> {
        unsafe {
            for index in 0..folder.ItemCount(SVGIO_ALLVIEW).ok()? {
                let item: IShellItem = folder.GetItem(index).ok()?;
                let Ok(name) = item.GetDisplayName(SIGDN_FILESYSPATH) else {
                    continue;
                };
                let name = webview2_com::take_pwstr(name);
                if name.eq_ignore_ascii_case(&path.to_string_lossy()) {
                    let pidl = folder.Item(index).ok()?;
                    let point = folder.GetItemPosition(pidl);
                    windows::Win32::System::Com::CoTaskMemFree(Some(pidl.cast()));
                    return point.ok().map(|p| (p.x, p.y));
                }
            }
            None
        }
    }
    fn wait_for(mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(4);
        while !condition() {
            assert!(
                Instant::now() < deadline,
                "Explorer did not finish refreshing and arranging icons"
            );
            std::thread::sleep(Duration::from_millis(40));
        }
    }

    #[test]
    #[ignore = "requires a running Windows Explorer desktop; refreshes and sorts its icons by name"]
    fn live_desktop_refresh() {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
        }
        let _apartment = Apartment(true);
        let view = desktop_view().unwrap();
        let folder: IFolderView2 = view.cast().unwrap();
        let flags = unsafe { folder.GetCurrentFolderFlags().unwrap() };
        let desktop = super::super::windows::desktop_directories().0.remove(0);
        let mut files = DesktopFiles(vec![]);
        let prefix = super::super::model::new_id();
        for suffix in ["A", "B", "C"] {
            let path = desktop.join(format!("SoundSpectra-{prefix}-{suffix}.txt"));
            std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
                .unwrap();
            files.0.push(path);
        }
        refresh_and_sort_by_name().unwrap();
        wait_for(|| files.0.iter().all(|path| position(&folder, path).is_some()));
        let first = position(&folder, &files.0[0]).unwrap();
        let middle = position(&folder, &files.0[1]).unwrap();
        let last = position(&folder, &files.0[2]).unwrap();
        assert!(first < middle && middle < last);
        let name: Vec<u16> = files.0[1]
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        unsafe {
            SetFileAttributesW(
                PCWSTR(name.as_ptr()),
                FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM,
            )
            .unwrap();
        }
        refresh_and_sort_by_name().unwrap();
        wait_for(|| {
            position(&folder, &files.0[1]).is_none()
                && position(&folder, &files.0[2]) == Some(middle)
        });
        unsafe {
            SetFileAttributesW(PCWSTR(name.as_ptr()), FILE_ATTRIBUTE_NORMAL).unwrap();
        }
        refresh_and_sort_by_name().unwrap();
        wait_for(|| {
            position(&folder, &files.0[1]) == Some(middle)
                && position(&folder, &files.0[2]) == Some(last)
        });
        let mut columns = [SORTCOLUMN::default()];
        unsafe {
            folder.GetSortColumns(&mut columns).unwrap();
            assert_eq!(columns[0].propkey.fmtid, PKEY_ItemNameDisplay.fmtid);
            assert_eq!(columns[0].propkey.pid, PKEY_ItemNameDisplay.pid);
            assert_eq!(columns[0].direction, SORT_ASCENDING);
            assert_eq!(folder.GetCurrentFolderFlags().unwrap(), flags);
        }
    }
}
