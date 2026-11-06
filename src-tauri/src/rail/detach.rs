use super::{allowed, RailItem, RailState, Snapshot};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, State, WebviewWindow};

#[tauri::command]
pub async fn rail_detach(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, RailState>,
    id: String,
) -> Result<Snapshot, String> {
    allowed(&window)?;
    #[cfg(windows)]
    {
        super::commit(&app, &state, |settings| {
            let item = settings.item(&id)?.clone();
            if item.desktop_managed {
                // A replacement must never be mistaken for the hidden original.
                let path = Path::new(&item.path);
                if !item.desktop_identity.is_some_and(|id| {
                    super::desktop_visibility::identity(path).is_ok_and(|actual| actual == id)
                }) {
                    return Err("原桌面项目已移动或更换，请重新关联后再拖出".into());
                }
                super::desktop_visibility::check_access(path)?;
            } else {
                use windows::Win32::UI::Shell::{
                    FOLDERID_Desktop, SHGetKnownFolderPath, KF_FLAG_DEFAULT,
                };
                let desktop = unsafe {
                    let value = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None)
                        .map_err(|e| e.to_string())?;
                    let path = PathBuf::from(value.to_string().map_err(|e| e.to_string())?);
                    windows::Win32::System::Com::CoTaskMemFree(Some(value.0.cast()));
                    path
                };
                export(&item, &desktop)?;
            }
            super::change(settings, super::Change::Remove { id })
        })
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state, id);
        Err("拖出挂件需要 Windows 桌面客户端".into())
    }
}

fn safe_name(name: &str) -> String {
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
    // A prefix also makes DOS device names harmless.
    format!("挂件-{}", if name.is_empty() { "未命名" } else { name })
}

#[cfg(windows)]
fn export(item: &RailItem, desktop: &Path) -> Result<PathBuf, String> {
    let source = Path::new(&item.path);
    if item.kind != "note" && !source.exists() {
        return Err("原项目不存在，请重新关联后再拖出".into());
    }
    // Already present on the Desktop: unmount only, without creating a copy.
    if item.kind != "note" && super::desktop_visibility::is_desktop_item(source) {
        return Ok(source.into());
    }
    let extension = match item.kind.as_str() {
        "note" => "txt",
        "image" => source
            .extension()
            .and_then(|e| e.to_str())
            .ok_or("图片扩展名无效")?,
        _ => "lnk",
    };
    let stem = safe_name(&item.name);
    for number in 0..1000 {
        let suffix = if number == 0 {
            String::new()
        } else {
            format!(" ({number})")
        };
        let path = desktop.join(format!("{stem}{suffix}.{extension}"));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path);
        let mut file = match file {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("无法保存到桌面：{e}")),
        };
        let result = match item.kind.as_str() {
            "note" => file
                .write_all(b"\xef\xbb\xbf")
                .and_then(|_| file.write_all(item.text.as_bytes()))
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string()),
            "image" => std::fs::File::open(source)
                .and_then(|mut input| std::io::copy(&mut input, &mut file))
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string()),
            _ => {
                drop(file);
                create_shortcut(source, &path)
            }
        };
        if let Err(e) = result {
            let _ = std::fs::remove_file(&path);
            return Err(format!("无法保存到桌面，挂件已保留：{e}"));
        }
        super::desktop_visibility::mark_changed(&path);
        return Ok(path);
    }
    Err("桌面已有太多同名项目，请先重命名挂件".into())
}

#[cfg(windows)]
fn create_shortcut(source: &Path, destination: &Path) -> Result<(), String> {
    use windows::{
        core::{Interface, HSTRING},
        Win32::{
            System::Com::{CoCreateInstance, IPersistFile, CLSCTX_INPROC_SERVER},
            UI::Shell::{IShellLinkW, ShellLink},
        },
    };
    unsafe {
        windows::Win32::System::Ole::OleInitialize(None).map_err(|e| e.to_string())?;
        let result = (|| -> windows::core::Result<()> {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            link.SetPath(&HSTRING::from(source.as_os_str()))?;
            let file: IPersistFile = link.cast()?;
            file.Save(&HSTRING::from(destination.as_os_str()), true)
        })();
        windows::Win32::System::Ole::OleUninitialize();
        result.map_err(|e| e.to_string())
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn exports_notes_images_and_shell_links_without_overwriting() {
        let root = std::env::temp_dir().join(super::super::model::new_id());
        std::fs::create_dir(&root).unwrap();
        let mut item = RailItem {
            id: "test".into(),
            name: "CON:/便签".into(),
            path: String::new(),
            kind: "note".into(),
            crop: "contain".into(),
            text: "你好\n保留内容".into(),
            desktop_managed: false,
            desktop_identity: None,
        };
        let first = export(&item, &root).unwrap();
        let second = export(&item, &root).unwrap();
        assert_ne!(first, second);
        assert_eq!(
            std::fs::read_to_string(&first).unwrap(),
            "\u{feff}你好\n保留内容"
        );
        let source = root.join("original.png");
        std::fs::write(&source, b"test image bytes").unwrap();
        item.path = source.to_string_lossy().into();
        item.kind = "image".into();
        let image = export(&item, &root).unwrap();
        assert_eq!(std::fs::read(image).unwrap(), b"test image bytes");
        item.kind = "folder".into();
        item.path = root.to_string_lossy().into();
        let link = export(&item, &root).unwrap();
        assert_eq!(link.extension().unwrap(), "lnk");
        assert!(std::fs::metadata(link).unwrap().len() > 0);
        item.path = root.join("missing").to_string_lossy().into();
        assert!(export(&item, &root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
