//! Start menu applications are Shell items, not necessarily disk files.
//! Keep their PIDL in a real .lnk so the existing mount/open/icon pipeline works.
use md5::{Digest, Md5};
use std::path::{Path, PathBuf};
use windows::{
    core::{Interface, HSTRING, PWSTR},
    Win32::{
        System::Com::{
            CoCreateInstance, CoTaskMemFree, IDataObject, IPersistFile, CLSCTX_INPROC_SERVER,
        },
        UI::Shell::{
            IShellItem, IShellItemArray, IShellLinkW, SHCreateItemFromParsingName,
            SHCreateShellItemArrayFromDataObject, SHGetIDListFromObject, ShellLink,
            SICHINT_CANONICAL, SIGDN, SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_FILESYSPATH,
            SIGDN_NORMALDISPLAY,
        },
    },
};

pub(super) enum Item {
    File(String),
    Application {
        item: IShellItem,
        identity: String,
        name: String,
    },
}

fn display_name(item: &IShellItem, kind: SIGDN) -> windows::core::Result<String> {
    unsafe {
        let value: PWSTR = item.GetDisplayName(kind)?;
        let result = value.to_string();
        CoTaskMemFree(Some(value.0.cast()));
        Ok(result?)
    }
}

fn is_application(item: &IShellItem) -> bool {
    unsafe {
        // Some app providers return the bare AUMID as their parsing name.
        // Verify the real Shell parent instead of guessing from that string.
        let Ok(parent) = item.GetParent() else {
            return false;
        };
        let Ok(apps): windows::core::Result<IShellItem> =
            SHCreateItemFromParsingName(&HSTRING::from("shell:AppsFolder"), None)
        else {
            return false;
        };
        parent
            .Compare(&apps, SICHINT_CANONICAL.0 as u32)
            .is_ok_and(|order| order == 0)
    }
}

pub(super) fn read(data: &IDataObject) -> Result<Vec<Item>, String> {
    unsafe {
        let items: IShellItemArray = SHCreateShellItemArrayFromDataObject(data)
            .map_err(|_| "请拖入文件、快捷方式或开始菜单中的应用".to_string())?;
        let count = items.GetCount().map_err(|e| e.to_string())?;
        if !(1..=48).contains(&count) {
            return Err("每次可拖入 1～48 个项目".into());
        }
        (0..count)
            .map(|index| {
                let item = items.GetItemAt(index).map_err(|e| e.to_string())?;
                if let Ok(path) = display_name(&item, SIGDN_FILESYSPATH) {
                    if Path::new(&path).is_absolute() {
                        return Ok(Item::File(path));
                    }
                }
                let identity =
                    display_name(&item, SIGDN_DESKTOPABSOLUTEPARSING).map_err(|e| e.to_string())?;
                if identity.is_empty() || !is_application(&item) {
                    return Err("此系统项目不能挂载，请选择应用、文件或文件夹".into());
                }
                let name = display_name(&item, SIGDN_NORMALDISPLAY).map_err(|e| e.to_string())?;
                Ok(Item::Application {
                    item,
                    identity,
                    name,
                })
            })
            .collect()
    }
}

fn shortcut_path(folder: &Path, identity: &str, name: &str) -> PathBuf {
    let hash: String = Md5::digest(identity.to_lowercase().as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let name: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(100)
        .collect();
    let name = name.trim().trim_end_matches(['.', ' ']);
    let name = if name.is_empty() { "未命名" } else { name };
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL"].contains(&stem.as_str())
        || (stem.len() == 4
            && (stem.starts_with("COM") || stem.starts_with("LPT"))
            && matches!(stem.as_bytes()[3], b'1'..=b'9'));
    // The identity keeps similarly named apps separate; preserve the actual
    // display name except when Windows reserves it as a DOS device name.
    folder
        .join(hash)
        .join(format!("{}{name}.lnk", if reserved { "_" } else { "" }))
}

pub(super) fn materialize(items: Vec<Item>, folder: &Path) -> Result<Vec<String>, String> {
    let mut paths = Vec::with_capacity(items.len());
    for item in items {
        let path = match item {
            Item::File(path) => path,
            Item::Application {
                item,
                identity,
                name,
            } => {
                let path = shortcut_path(folder, &identity, &name);
                if !path.exists() {
                    std::fs::create_dir_all(path.parent().ok_or("应用快捷方式目录无效")?)
                        .map_err(|e| format!("无法保存应用入口：{e}"))?;
                    let temporary = path.with_extension(format!("{}.tmp", super::model::new_id()));
                    let result = unsafe { save_link(&item, &temporary) }.and_then(|_| {
                        std::fs::rename(&temporary, &path).map_err(|e| e.to_string())
                    });
                    if let Err(error) = result {
                        let _ = std::fs::remove_file(temporary);
                        return Err(format!("无法保存应用入口：{error}"));
                    }
                }
                path.to_string_lossy().into_owned()
            }
        };
        if !paths
            .iter()
            .any(|old: &String| old.eq_ignore_ascii_case(&path))
        {
            paths.push(path);
        }
    }
    Ok(paths)
}

unsafe fn save_link(item: &IShellItem, destination: &Path) -> Result<(), String> {
    let link: IShellLinkW =
        CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
    let pidl = SHGetIDListFromObject(item).map_err(|e| e.to_string())?;
    let result = link.SetIDList(pidl);
    CoTaskMemFree(Some(pidl.cast()));
    result.map_err(|e| e.to_string())?;
    let file: IPersistFile = link.cast().map_err(|e| e.to_string())?;
    file.Save(&HSTRING::from(destination.as_os_str()), true)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use windows::Win32::{
        System::{
            Com::STGM_READ,
            Ole::{OleInitialize, OleUninitialize},
        },
        UI::Shell::{
            BHID_DataObject, BHID_EnumItems, IEnumShellItems, SHCreateItemFromIDList,
            SHCreateShellItemArrayFromShellItem,
        },
    };

    pub(in crate::rail) unsafe fn application() -> IShellItem {
        let apps: IShellItem =
            SHCreateItemFromParsingName(&HSTRING::from("shell:AppsFolder"), None).unwrap();
        let items: IEnumShellItems = apps.BindToHandler(None, &BHID_EnumItems).unwrap();
        loop {
            let mut next = [None];
            items.Next(&mut next, None).unwrap();
            let item = next[0]
                .take()
                .expect("Windows must expose an AppsFolder application for this regression");
            if display_name(&item, SIGDN_FILESYSPATH).is_err() && is_application(&item) {
                return item;
            }
        }
    }

    #[test]
    fn applications_without_file_paths_survive_drop_as_real_shell_links() {
        unsafe {
            OleInitialize(None).unwrap();
            let root = std::env::temp_dir().join(super::super::model::new_id());
            let item = application();
            assert!(display_name(&item, SIGDN_FILESYSPATH).is_err());
            let identity = display_name(&item, SIGDN_DESKTOPABSOLUTEPARSING).unwrap();
            let array: IShellItemArray = SHCreateShellItemArrayFromShellItem(&item).unwrap();
            let data: IDataObject = array.BindToHandler(None, &BHID_DataObject).unwrap();
            let entries = read(&data).unwrap();
            assert!(!root.exists(), "hover must not create shortcuts");
            let paths = materialize(entries, &root).unwrap();
            assert_eq!(paths.len(), 1);
            let path = Path::new(&paths[0]);
            assert!(path.is_file());
            assert_eq!(super::super::model::classify(path), "app");
            let link: IShellLinkW =
                CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
            let file: IPersistFile = link.cast().unwrap();
            file.Load(&HSTRING::from(path.as_os_str()), STGM_READ)
                .unwrap();
            let pidl = link.GetIDList().unwrap();
            let restored: IShellItem = SHCreateItemFromIDList(pidl).unwrap();
            CoTaskMemFree(Some(pidl.cast()));
            assert_eq!(
                display_name(&restored, SIGDN_DESKTOPABSOLUTEPARSING).unwrap(),
                identity
            );
            assert_eq!(materialize(read(&data).unwrap(), &root).unwrap(), paths);
            std::fs::remove_dir_all(root).unwrap();
            drop(restored);
            drop(file);
            drop(link);
            drop(data);
            drop(array);
            drop(item);
            OleUninitialize();
        }
    }

    #[test]
    fn names_cannot_escape_the_owned_directory_or_conflate_applications() {
        let root = Path::new("C:\\SoundSpectra\\rail-apps");
        let first = shortcut_path(root, "APP-A", "../CON:*?\\unsafe");
        assert!(first.starts_with(root));
        assert_eq!(first, shortcut_path(root, "app-a", "../CON:*?\\unsafe"));
        assert_ne!(first, shortcut_path(root, "APP-B", "../CON:*?\\unsafe"));
    }
}
