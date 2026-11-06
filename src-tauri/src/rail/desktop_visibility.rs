use super::RailSettings;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{File, OpenOptions},
    io::Write,
    os::windows::io::AsRawHandle,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
};
use tauri::{AppHandle, Manager};
use windows_sys::Win32::{
    Storage::FileSystem::{
        GetFileAttributesW, GetFileInformationByHandle, GetFinalPathNameByHandleW,
        SetFileAttributesW, BY_HANDLE_FILE_INFORMATION,
    },
    UI::Shell::{SHChangeNotify, SHCNE_ATTRIBUTES, SHCNF_PATHW},
};

const HIDDEN: u32 = 0x2;
const SYSTEM: u32 = 0x4;
const MASK: u32 = HIDDEN | SYSTEM;
static DESKTOP_DIRTY: AtomicBool = AtomicBool::new(false);
// Shared-delete handles follow renames/moves while the app is running, without
// locking the user's files. The journal remains the recovery source on restart.
static TRACKED: OnceLock<Mutex<HashMap<[u32; 3], File>>> = OnceLock::new();
fn tracked() -> &'static Mutex<HashMap<[u32; 3], File>> {
    TRACKED.get_or_init(Mutex::default)
}

#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    path: PathBuf,
    identity: [u32; 3],
    original: u32,
}

fn wide(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}
fn key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}
fn open(path: &Path) -> Result<File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    OpenOptions::new()
        .access_mode(0)
        .share_mode(7)
        .custom_flags(0x02000000 | 0x00200000)
        .open(path)
        .map_err(|e| format!("无法读取桌面项目：{e}"))
}
pub(super) fn identity(path: &Path) -> Result<[u32; 3], String> {
    file_identity(&open(path)?)
}
pub(super) fn file_identity(file: &File) -> Result<[u32; 3], String> {
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok([
        info.dwVolumeSerialNumber,
        info.nFileIndexHigh,
        info.nFileIndexLow,
    ])
}
fn remember(path: &Path, id: [u32; 3]) -> Result<(), String> {
    let file = open(path)?;
    if file_identity(&file)? != id {
        return Err("桌面项目已更换，请重试".into());
    }
    tracked()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, file);
    Ok(())
}
fn locate(entry: &Entry) -> Result<Option<PathBuf>, String> {
    if entry.path.try_exists().map_err(|e| e.to_string())?
        && identity(&entry.path)? == entry.identity
    {
        return Ok(Some(entry.path.clone()));
    }
    {
        let handles = tracked().lock().map_err(|e| e.to_string())?;
        if let Some(file) = handles.get(&entry.identity) {
            let mut buffer = vec![0u16; 32768];
            let len = unsafe {
                GetFinalPathNameByHandleW(
                    file.as_raw_handle(),
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    0,
                )
            } as usize;
            if len > 0 && len < buffer.len() {
                use std::os::windows::ffi::OsStringExt;
                let path = PathBuf::from(std::ffi::OsString::from_wide(&buffer[..len]));
                if path.exists() && identity(&path)? == entry.identity {
                    return Ok(Some(path));
                }
            }
        }
    }
    // After a restart recover renamed desktop entries by file identity. Never
    // recurse into folders or change the attributes of a same-name replacement.
    if let Some(parent) = entry.path.parent().filter(|p| p.exists()) {
        for child in std::fs::read_dir(parent).map_err(|e| e.to_string())? {
            let child = child.map_err(|e| e.to_string())?.path();
            if identity(&child).is_ok_and(|id| id == entry.identity) {
                return Ok(Some(child));
            }
        }
    }
    Ok(None)
}
fn attributes(path: &Path) -> Result<u32, String> {
    let value = unsafe { GetFileAttributesW(wide(path).as_ptr()) };
    if value == u32::MAX {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(value)
}
fn attribute_error(path: &Path, error: std::io::Error) -> String {
    if error.raw_os_error() == Some(5) {
        format!("无法隐藏或恢复桌面项目「{}」：当前账户没有修改此项目的权限。公共桌面项目可能需要管理员权限；原项目保留在原位置。", path.display())
    } else {
        format!("无法更新桌面项目「{}」：{error}", path.display())
    }
}
// Test access without changing attributes. Check before
// saving a mount, so a shared Desktop icon cannot appear successfully moved.
pub(super) fn check_access(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::OpenOptionsExt;
    OpenOptions::new()
        .access_mode(0x100) // FILE_WRITE_ATTRIBUTES only, never file contents.
        .share_mode(7)
        .custom_flags(0x02000000 | 0x00200000)
        .open(path)
        .map(|_| ())
        .or_else(|error| {
            if error.raw_os_error() == Some(5) && is_desktop_item(path) {
                super::attribute_helper::request(path, None)
            } else {
                Err(attribute_error(path, error))
            }
        })
}
fn set(path: &Path, value: u32) -> Result<(), String> {
    let wide_path = wide(path);
    if unsafe { SetFileAttributesW(wide_path.as_ptr(), if value == 0 { 0x80 } else { value }) } == 0
    {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(5) && is_desktop_item(path) {
            super::attribute_helper::request(path, Some(value & MASK))?;
        } else {
            return Err(attribute_error(path, error));
        }
    }
    unsafe {
        SHChangeNotify(
            SHCNE_ATTRIBUTES as i32,
            SHCNF_PATHW,
            wide_path.as_ptr().cast(),
            std::ptr::null(),
        );
    }
    mark_changed(path);
    Ok(())
}

pub(super) fn mark_changed(path: &Path) {
    if is_desktop_item(path) {
        DESKTOP_DIRTY.store(true, Ordering::Release);
    }
}

pub fn is_desktop_item(path: &Path) -> bool {
    let Ok(parent) = path
        .parent()
        .ok_or(())
        .and_then(|p| p.canonicalize().map_err(|_| ()))
    else {
        return false;
    };
    super::windows::desktop_directories()
        .0
        .iter()
        .any(|desktop| desktop.canonicalize().is_ok_and(|p| p == parent))
}

fn journal_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("rail-desktop-restore.json"))
}
fn read(path: &Path) -> Result<Vec<Entry>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("桌面恢复记录无法读取，已停止隐藏图标：{e}"))
}
fn write(path: &Path, entries: &[Entry]) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("无法定位恢复记录")?).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(entries).map_err(|e| e.to_string())?;
    let mut file = File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    std::fs::rename(temporary, path).map_err(|e| format!("桌面恢复记录保存失败：{e}"))
}

pub fn sync(app: &AppHandle, settings: &RailSettings, enabled: bool) -> Result<(), String> {
    let journal = journal_path(app)?;
    reconcile(
        &journal,
        settings
            .groups
            .iter()
            .flat_map(|g| &g.items)
            .filter(|i| {
                enabled
                    && i.desktop_managed
                    && is_desktop_item(Path::new(&i.path))
                    && i.desktop_identity.is_some_and(|expected| {
                        identity(Path::new(&i.path)).is_ok_and(|current| current == expected)
                    })
            })
            .map(|i| PathBuf::from(&i.path))
            .collect(),
    )
}
pub fn restore(app: &AppHandle) -> Result<(), String> {
    reconcile(&journal_path(app)?, vec![])
}

fn reconcile(journal: &Path, desired: Vec<PathBuf>) -> Result<(), String> {
    let mut entries = read(journal)?;
    let previous = entries.clone();
    let wanted: HashSet<_> = desired.iter().map(|p| key(p)).collect();
    let mut pending = vec![];
    let mut errors = vec![];
    // Restore before forgetting a record. Match file identity so a replacement
    // at the same path can never inherit another file's original attributes.
    for mut entry in entries.drain(..) {
        let original_path = entry.path.clone();
        match locate(&entry) {
            Ok(Some(path)) => entry.path = path,
            // A deleted/moved-away item may return later. Keep its recovery
            // record without changing any replacement or blocking app exit.
            Ok(None) => {
                pending.push(entry);
                continue;
            }
            Err(error) => {
                errors.push(error);
                pending.push(entry);
                continue;
            }
        }
        if key(&original_path) == key(&entry.path) && wanted.contains(&key(&entry.path)) {
            if let Err(error) = remember(&entry.path, entry.identity) {
                errors.push(error);
                pending.push(entry);
                continue;
            }
            if let Err(error) = attributes(&entry.path)
                .and_then(|a| set_if_changed(&entry.path, a, (a & !0x80) | MASK))
            {
                errors.push(error);
            }
            pending.push(entry);
        } else {
            match attributes(&entry.path)
                .and_then(|a| set_if_changed(&entry.path, a, (a & !MASK) | (entry.original & MASK)))
            {
                Ok(()) => {
                    tracked()
                        .lock()
                        .map_err(|e| e.to_string())?
                        .remove(&entry.identity);
                }
                Err(error) => {
                    errors.push(error);
                    pending.push(entry);
                }
            }
        }
    }
    if previous != pending {
        write(journal, &pending)?;
    }
    for path in desired {
        if pending.iter().any(|e| key(&e.path) == key(&path)) || !path.exists() {
            continue;
        }
        let result = (|| {
            let original = attributes(&path)?;
            // Never claim pre-existing hidden/system items as managed icons.
            if original & MASK != 0 {
                return Ok(());
            }
            let entry = Entry {
                identity: identity(&path)?,
                path: path.clone(),
                original,
            };
            remember(&path, entry.identity)?;
            pending.push(entry);
            write(journal, &pending)?; // Durable recovery comes before hiding.
            set(&path, (original & !0x80) | MASK)
        })();
        if let Err(error) = result {
            errors.push(error);
        }
    }
    if DESKTOP_DIRTY.swap(false, Ordering::AcqRel) {
        if let Err(error) = super::shell_refresh::refresh_and_sort_by_name() {
            DESKTOP_DIRTY.store(true, Ordering::Release);
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}
fn set_if_changed(path: &Path, old: u32, next: u32) -> Result<(), String> {
    if old == next {
        Ok(())
    } else {
        set(path, next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temporary() -> PathBuf {
        let root = std::env::temp_dir().join(super::super::model::new_id());
        std::fs::create_dir_all(&root).unwrap();
        root
    }
    #[test]
    fn hide_restore_restart_and_shared_reference_keep_files_in_place() {
        let root = std::env::temp_dir().join(super::super::model::new_id());
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("mounted.txt");
        let journal = root.join("restore.json");
        std::fs::write(&path, b"original content").unwrap();
        let original = attributes(&path).unwrap();
        reconcile(&journal, vec![path.clone(), path.clone()]).unwrap();
        assert_eq!(attributes(&path).unwrap() & MASK, MASK);
        assert_eq!(read(&journal).unwrap().len(), 1);
        reconcile(&journal, vec![path.clone()]).unwrap();
        assert_eq!(attributes(&path).unwrap() & MASK, MASK);
        reconcile(&journal, vec![]).unwrap();
        assert_eq!(attributes(&path).unwrap() & MASK, original & MASK);
        assert_eq!(std::fs::read(&path).unwrap(), b"original content");
        assert!(read(&journal).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn directories_restore_without_changing_children_or_other_attribute_bits() {
        let root = temporary();
        let folder = root.join("folder");
        std::fs::create_dir(&folder).unwrap();
        let child = folder.join("inside.txt");
        std::fs::write(&child, b"keep").unwrap();
        let child_attributes = attributes(&child).unwrap();
        let journal = root.join("restore.json");
        reconcile(&journal, vec![folder.clone()]).unwrap();
        assert_eq!(attributes(&folder).unwrap() & MASK, MASK);
        assert_eq!(attributes(&child).unwrap(), child_attributes);
        set(&folder, attributes(&folder).unwrap() | 1).unwrap();
        reconcile(&journal, vec![]).unwrap();
        assert_eq!(attributes(&folder).unwrap() & MASK, 0);
        assert_ne!(attributes(&folder).unwrap() & 1, 0);
        set(&folder, attributes(&folder).unwrap() & !1).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn restart_finds_renamed_original_and_leaves_same_name_replacement_alone() {
        let root = temporary();
        let path = root.join("original.txt");
        let renamed = root.join("renamed.txt");
        let journal = root.join("restore.json");
        std::fs::write(&path, b"original").unwrap();
        let id = identity(&path).unwrap();
        reconcile(&journal, vec![path.clone()]).unwrap();
        tracked().lock().unwrap().remove(&id);
        std::fs::rename(&path, &renamed).unwrap();
        std::fs::write(&path, b"replacement").unwrap();
        let replacement_attributes = attributes(&path).unwrap();
        reconcile(&journal, vec![]).unwrap();
        assert_eq!(attributes(&renamed).unwrap() & MASK, 0);
        assert_eq!(attributes(&path).unwrap(), replacement_attributes);
        assert_eq!(std::fs::read(&path).unwrap(), b"replacement");
        assert!(read(&journal).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn live_handle_follows_moves_and_missing_records_are_retained_for_recovery() {
        let root = temporary();
        let path = root.join("original.txt");
        let other = root.join("elsewhere");
        std::fs::create_dir(&other).unwrap();
        let moved = other.join("moved.txt");
        let journal = root.join("restore.json");
        std::fs::write(&path, b"keep").unwrap();
        reconcile(&journal, vec![path.clone()]).unwrap();
        std::fs::rename(&path, &moved).unwrap();
        reconcile(&journal, vec![]).unwrap();
        assert_eq!(attributes(&moved).unwrap() & MASK, 0);
        std::fs::rename(&moved, &path).unwrap();
        reconcile(&journal, vec![path.clone()]).unwrap();
        tracked().lock().unwrap().remove(&identity(&path).unwrap());
        std::fs::rename(&path, &moved).unwrap();
        reconcile(&journal, vec![]).unwrap();
        assert_eq!(read(&journal).unwrap().len(), 1);
        std::fs::rename(&moved, &path).unwrap();
        reconcile(&journal, vec![]).unwrap();
        assert_eq!(attributes(&path).unwrap() & MASK, 0);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_or_corrupt_journal_never_hides_a_new_file() {
        let root = temporary();
        let path = root.join("file.txt");
        std::fs::write(&path, b"keep").unwrap();
        let bad_parent = root.join("not-a-directory");
        std::fs::write(&bad_parent, b"keep").unwrap();
        assert!(reconcile(&bad_parent.join("restore.json"), vec![path.clone()]).is_err());
        assert_eq!(attributes(&path).unwrap() & MASK, 0);
        let journal = root.join("restore.json");
        std::fs::write(&journal, b"broken json").unwrap();
        assert!(reconcile(&journal, vec![path.clone()]).is_err());
        assert_eq!(attributes(&path).unwrap() & MASK, 0);
        tracked().lock().unwrap().remove(&identity(&path).unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn attribute_permission_is_checked_without_changing_the_file() {
        use std::os::windows::process::CommandExt;
        let root = temporary();
        let path = root.join("shared-shortcut.lnk");
        std::fs::write(&path, b"keep").unwrap();
        let original = attributes(&path).unwrap();
        check_access(&path).unwrap();
        let account = format!(
            "{}\\{}",
            std::env::var("USERDOMAIN").unwrap(),
            std::env::var("USERNAME").unwrap()
        );
        let denied = format!("{account}:(WA)");
        let result = std::process::Command::new("icacls")
            .arg(&path)
            .args(["/deny", &denied])
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(result.status.success());
        let error = check_access(&path).unwrap_err();
        let result = std::process::Command::new("icacls")
            .arg(&path)
            .args(["/remove:d", &account])
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(result.status.success());
        assert!(error.contains("shared-shortcut.lnk") && error.contains("没有修改"));
        assert_eq!(attributes(&path).unwrap(), original);
        assert_eq!(std::fs::read(&path).unwrap(), b"keep");
        assert!(!root.join("restore.json").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
