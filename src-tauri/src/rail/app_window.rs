//! Prefer an application's existing user window over launching another instance.
//! Identity comes from the shortcut/Shell app and executable, never its caption.
use std::{collections::HashMap, path::Path, ptr::null_mut};
use windows::{
    core::{Interface, BSTR, HSTRING},
    Win32::{
        Storage::EnhancedStorage::PKEY_AppUserModel_ID,
        System::Com::{
            CoCreateInstance, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER, STGM_READ,
        },
        UI::Shell::{
            IShellItem2, IShellLinkW,
            PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow},
            SHCreateItemFromIDList, ShellLink,
        },
    },
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, HWND, LPARAM},
    Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
    Storage::Packaging::Appx::GetApplicationUserModelId,
    System::{
        Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
        Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    },
    UI::WindowsAndMessaging::*,
};

struct Apartment(bool);
impl Drop for Apartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() }
        }
    }
}

#[derive(Debug, Default)]
struct Identity {
    app_id: Option<String>,
    executables: Vec<String>,
}
#[derive(Default)]
struct Process {
    app_id: Option<String>,
    executable: Option<String>,
}

fn text(buffer: &[u16]) -> String {
    String::from_utf16_lossy(&buffer[..buffer.iter().position(|v| *v == 0).unwrap_or(buffer.len())])
}
fn normalized(path: &Path) -> String {
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let value = path.to_string_lossy().replace('/', "\\");
    value
        .strip_prefix("\\\\?\\")
        .unwrap_or(&value)
        .to_lowercase()
}
fn executable_paths(path: &Path) -> Vec<String> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|v| v.eq_ignore_ascii_case("exe"))
    {
        return vec![];
    }
    let mut paths = vec![normalized(path)];
    // Feishu and similar launchers keep the actual, same-named program in app/.
    // Match that exact file, never arbitrary children or a basename alone.
    if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        let child = parent.join("app").join(name);
        if child.is_file() {
            paths.push(normalized(&child));
        }
    }
    paths
}
fn shared_launcher(path: &str) -> bool {
    [
        "explorer.exe",
        "rundll32.exe",
        "cmd.exe",
        "powershell.exe",
        "pwsh.exe",
        "applicationframehost.exe",
    ]
    .iter()
    .any(|name| {
        path.rsplit('\\')
            .next()
            .is_some_and(|v| v.eq_ignore_ascii_case(name))
    })
}
unsafe fn app_id(store: &IPropertyStore) -> Option<String> {
    let value = store.GetValue(&PKEY_AppUserModel_ID).ok()?;
    BSTR::try_from(&value)
        .ok()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}
unsafe fn identity(path: &Path) -> Option<Identity> {
    if path
        .extension()
        .is_some_and(|v| v.eq_ignore_ascii_case("exe"))
    {
        let paths = executable_paths(path);
        return (!paths.iter().any(|p| shared_launcher(p))).then_some(Identity {
            app_id: None,
            executables: paths,
        });
    }
    if !path
        .extension()
        .is_some_and(|v| v.eq_ignore_ascii_case("lnk"))
    {
        return None;
    }
    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
    let file: IPersistFile = link.cast().ok()?;
    file.Load(&HSTRING::from(path.as_os_str()), STGM_READ)
        .ok()?;
    let mut buffer = vec![0u16; 32768];
    link.GetArguments(&mut buffer).ok()?;
    // Keep document, URL, profile and explicit new-window launch arguments intact.
    if !text(&buffer).trim().is_empty() {
        return None;
    }
    let mut id = link.cast::<IPropertyStore>().ok().and_then(|s| app_id(&s));
    if let Ok(pidl) = link.GetIDList() {
        if !pidl.is_null() {
            let item: windows::core::Result<IShellItem2> = SHCreateItemFromIDList(pidl);
            CoTaskMemFree(Some(pidl.cast()));
            if let Ok(item) = item {
                if let Ok(value) = item.GetString(&PKEY_AppUserModel_ID) {
                    let parsed = value.to_string().ok().filter(|s| !s.is_empty());
                    CoTaskMemFree(Some(value.0.cast()));
                    if id.is_none() {
                        id = parsed;
                    }
                }
            }
        }
    }
    buffer.fill(0);
    let mut executables = if link.GetPath(&mut buffer, null_mut(), 0).is_ok() {
        executable_paths(Path::new(&text(&buffer)))
    } else {
        vec![]
    };
    executables.retain(|p| !shared_launcher(p));
    (id.is_some() || !executables.is_empty()).then_some(Identity {
        app_id: id,
        executables,
    })
}
unsafe fn process(id: u32) -> Process {
    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, id);
    if handle.is_null() {
        return Process::default();
    }
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let executable = if QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length) != 0
    {
        Some(normalized(Path::new(&String::from_utf16_lossy(
            &buffer[..length as usize],
        ))))
    } else {
        None
    };
    buffer.fill(0);
    length = buffer.len() as u32;
    let app_id = (GetApplicationUserModelId(handle, &mut length, buffer.as_mut_ptr()) == 0)
        .then(|| text(&buffer))
        .filter(|s| !s.is_empty());
    CloseHandle(handle);
    Process { app_id, executable }
}
fn match_score(target: &Identity, window_id: Option<&str>, process: &Process) -> u8 {
    if let Some(wanted) = target.app_id.as_deref() {
        if let Some(actual) = window_id.or(process.app_id.as_deref()) {
            return if wanted.eq_ignore_ascii_case(actual) {
                2
            } else {
                0
            };
        }
    }
    u8::from(
        process
            .executable
            .as_ref()
            .is_some_and(|p| target.executables.contains(p)),
    )
}
unsafe fn user_window(hwnd: HWND) -> bool {
    let extended = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    let owner = GetWindow(hwnd, GW_OWNER);
    if IsWindowVisible(hwnd) == 0
        || GetWindowTextLengthW(hwnd) == 0
        || (!owner.is_null()
            && IsWindowVisible(owner) != 0
            && extended & WS_EX_APPWINDOW as isize == 0)
        || extended & ((WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE) as isize) != 0
    {
        return false;
    }
    let mut cloaked = 0u32;
    DwmGetWindowAttribute(
        hwnd,
        DWMWA_CLOAKED as u32,
        (&mut cloaked as *mut u32).cast(),
        4,
    );
    cloaked == 0 || IsIconic(hwnd) != 0
}
struct Search<'a> {
    identity: &'a Identity,
    processes: HashMap<u32, Process>,
    best: HWND,
    score: u8,
}
impl Search<'_> {
    unsafe fn score(&mut self, hwnd: HWND) -> u8 {
        let mut pid = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let process = self.processes.entry(pid).or_insert_with(|| process(pid));
        let id = if self.identity.app_id.is_some() {
            SHGetPropertyStoreForWindow::<IPropertyStore>(windows::Win32::Foundation::HWND(hwnd))
                .ok()
                .and_then(|s| app_id(&s))
        } else {
            None
        };
        match_score(self.identity, id.as_deref(), process)
    }
}
unsafe extern "system" fn child(hwnd: HWND, data: LPARAM) -> i32 {
    let search = &mut *(data as *mut Search<'_>);
    let score = search.score(hwnd);
    search.score = search.score.max(score);
    1
}
unsafe extern "system" fn candidate(hwnd: HWND, data: LPARAM) -> i32 {
    if !user_window(hwnd) {
        return 1;
    }
    let search = &mut *(data as *mut Search<'_>);
    let mut score = search.score(hwnd);
    if score == 0 && search.identity.app_id.is_some() {
        let mut class = [0u16; 64];
        GetClassNameW(hwnd, class.as_mut_ptr(), class.len() as i32);
        if text(&class) == "ApplicationFrameWindow" {
            // Older packaged apps put the actual package process in a child HWND.
            let mut children = Search {
                identity: search.identity,
                processes: HashMap::new(),
                best: null_mut(),
                score: 0,
            };
            EnumChildWindows(hwnd, Some(child), &mut children as *mut _ as LPARAM);
            score = children.score;
        }
    }
    // EnumWindows supplies Z order, so equal scores retain the most recent window.
    if score > search.score {
        search.best = hwnd;
        search.score = score;
    }
    1
}
unsafe fn find(target: &Identity) -> HWND {
    let mut search = Search {
        identity: target,
        processes: HashMap::new(),
        best: null_mut(),
        score: 0,
    };
    EnumWindows(Some(candidate), &mut search as *mut _ as LPARAM);
    search.best
}

pub(super) fn activate(path: &Path) -> Result<bool, String> {
    unsafe {
        let initialized = CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
        if initialized < 0 && initialized != 0x80010106u32 as i32 {
            return Ok(false);
        }
        let _apartment = Apartment(initialized >= 0);
        let Some(target) = identity(path) else {
            return Ok(false);
        };
        let hwnd = find(&target);
        if hwnd.is_null() || IsWindow(hwnd) == 0 {
            return Ok(false);
        }
        if IsIconic(hwnd) != 0 {
            ShowWindowAsync(hwnd, SW_RESTORE);
        }
        let popup = GetLastActivePopup(hwnd);
        let active = if !popup.is_null()
            && IsWindowVisible(popup) != 0
            && GetWindowLongPtrW(popup, GWL_STYLE) & WS_DISABLED as isize == 0
        {
            popup
        } else {
            hwnd
        };
        if SetForegroundWindow(active) != 0 || GetForegroundWindow() == active {
            return Ok(true);
        }
        // An OS focus refusal must not fall through into another application launch.
        let info = FLASHWINFO {
            cbSize: std::mem::size_of::<FLASHWINFO>() as u32,
            hwnd: active,
            dwFlags: FLASHW_TRAY,
            uCount: 2,
            dwTimeout: 0,
        };
        FlashWindowEx(&info);
        Err("应用已打开，但 Windows 暂未允许切换窗口，请再点击一次".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apartment() -> Apartment {
        let result = unsafe { CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32) };
        assert!(result >= 0);
        Apartment(true)
    }
    unsafe fn set_id(store: &IPropertyStore, id: &str) {
        use windows::Win32::System::{Com::StructuredStorage::PROPVARIANT, Variant::VT_LPWSTR};
        let mut value = PROPVARIANT::default();
        let inner = &mut *value.Anonymous.Anonymous;
        inner.vt = VT_LPWSTR;
        inner.Anonymous.pwszVal = windows::Win32::UI::Shell::SHStrDupW(&HSTRING::from(id)).unwrap();
        store.SetValue(&PKEY_AppUserModel_ID, &value).unwrap();
        store.Commit().unwrap();
    }
    #[test]
    fn matching_uses_full_paths_and_specific_application_ids() {
        let target = Identity {
            app_id: Some("profile.one".into()),
            executables: vec!["c:\\apps\\browser.exe".into()],
        };
        let running = Process {
            executable: Some("c:\\apps\\browser.exe".into()),
            ..Process::default()
        };
        assert_eq!(match_score(&target, Some("profile.one"), &running), 2);
        assert_eq!(match_score(&target, Some("profile.two"), &running), 0);
        assert_eq!(match_score(&target, None, &running), 1);
        let unrelated = Process {
            executable: Some("d:\\other\\browser.exe".into()),
            ..Process::default()
        };
        assert_eq!(match_score(&target, None, &unrelated), 0);
        let packaged = Process {
            app_id: Some("profile.one".into()),
            ..Process::default()
        };
        assert_eq!(match_score(&target, None, &packaged), 2);
    }
    #[test]
    fn launcher_matches_only_its_same_named_app_executable() {
        let root = std::env::temp_dir().join(super::super::model::new_id());
        std::fs::create_dir_all(root.join("app")).unwrap();
        std::fs::write(root.join("Feishu.exe"), b"launcher").unwrap();
        std::fs::write(root.join("app/Feishu.exe"), b"program").unwrap();
        let paths = executable_paths(&root.join("Feishu.exe"));
        assert_eq!(
            paths,
            [
                normalized(&root.join("Feishu.exe")),
                normalized(&root.join("app/Feishu.exe"))
            ]
        );
        assert!(!paths.contains(&normalized(&root.join("app/helper.exe"))));
        assert!(executable_paths(&root.join("document.txt")).is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn shortcut_resolution_preserves_explicit_launch_arguments() {
        let _apartment = apartment();
        let path = std::env::temp_dir().join(format!("{}.lnk", super::super::model::new_id()));
        let executable = std::env::current_exe().unwrap();
        unsafe {
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
            link.SetPath(&HSTRING::from(executable.as_os_str()))
                .unwrap();
            let file: IPersistFile = link.cast().unwrap();
            file.Save(&HSTRING::from(path.as_os_str()), true).unwrap();
            assert!(identity(&path)
                .unwrap()
                .executables
                .contains(&normalized(&executable)));
            link.SetArguments(&HSTRING::from("--new-window C:\\Documents\\work.txt"))
                .unwrap();
            file.Save(&HSTRING::from(path.as_os_str()), true).unwrap();
            assert!(identity(&path).is_none());
        }
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn start_menu_shortcut_retains_its_packaged_app_identity() {
        let _apartment = apartment();
        let root = std::env::temp_dir().join(super::super::model::new_id());
        unsafe {
            let item = super::super::shell_drop::tests::application();
            let array: windows::Win32::UI::Shell::IShellItemArray =
                windows::Win32::UI::Shell::SHCreateShellItemArrayFromShellItem(&item).unwrap();
            let data = array
                .BindToHandler::<_, windows::Win32::System::Com::IDataObject>(
                    None,
                    &windows::Win32::UI::Shell::BHID_DataObject,
                )
                .unwrap();
            let paths = super::super::shell_drop::materialize(
                super::super::shell_drop::read(&data).unwrap(),
                &root,
            )
            .unwrap();
            assert!(identity(Path::new(&paths[0])).unwrap().app_id.is_some());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    struct Window(HWND);
    impl Drop for Window {
        fn drop(&mut self) {
            unsafe {
                DestroyWindow(self.0);
            }
        }
    }
    unsafe fn window(id: &str, extended: u32) -> Window {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let hwnd = CreateWindowExW(
            extended,
            class.as_ptr(),
            class.as_ptr(),
            WS_OVERLAPPEDWINDOW | WS_VISIBLE,
            -3000,
            -3000,
            120,
            80,
            null_mut(),
            null_mut(),
            null_mut(),
            std::ptr::null(),
        );
        assert!(!hwnd.is_null());
        let window = Window(hwnd);
        let store: IPropertyStore =
            SHGetPropertyStoreForWindow(windows::Win32::Foundation::HWND(hwnd)).unwrap();
        set_id(&store, id);
        window
    }
    #[test]
    fn real_windows_match_when_minimized_and_exclude_tools_and_hidden_windows() {
        let _apartment = apartment();
        let id = format!("SoundSpectra.test.{}", super::super::model::new_id());
        let target = Identity {
            app_id: Some(id.clone()),
            executables: vec![],
        };
        unsafe {
            let main = window(&id, WS_EX_NOACTIVATE);
            assert!(find(&target).is_null());
            SetWindowLongPtrW(main.0, GWL_EXSTYLE, 0);
            assert_eq!(find(&target), main.0);
            let _tool = window(&id, WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE);
            let _other_app = window("SoundSpectra.different", WS_EX_NOACTIVATE);
            ShowWindow(main.0, SW_MINIMIZE);
            assert_ne!(IsIconic(main.0), 0);
            assert_eq!(find(&target), main.0);
            ShowWindow(main.0, SW_HIDE);
            assert!(find(&target).is_null());
        }
    }
    #[test]
    #[ignore = "read-only matching probe; requires SOUNDSPECTRA_APP_WINDOW_PROBE"]
    fn inspect_existing_application_window() {
        let _apartment = apartment();
        let path = std::env::var_os("SOUNDSPECTRA_APP_WINDOW_PROBE")
            .expect("Set the shortcut path to inspect");
        unsafe {
            let target = identity(Path::new(&path)).expect("Application identity");
            let hwnd = find(&target);
            println!(
                "Application identity: {target:?}; matching HWND: {:x}",
                hwnd as usize
            );
            assert!(!hwnd.is_null(), "No existing user window matched");
        }
    }
}
