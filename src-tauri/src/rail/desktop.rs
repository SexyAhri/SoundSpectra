use super::model;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Serialize)]
pub struct DesktopEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub icon: Option<String>,
}
#[derive(Serialize)]
pub struct DesktopEntries {
    pub entries: Vec<DesktopEntry>,
    pub truncated: bool,
    pub issues: Vec<String>,
}

pub fn read() -> Result<DesktopEntries, String> {
    #[cfg(windows)]
    let (directories, mut issues) = super::windows::desktop_directories();
    #[cfg(not(windows))]
    let (directories, mut issues): (Vec<std::path::PathBuf>, Vec<String>) = (vec![], vec![]);
    if directories.is_empty() {
        return Err("无法读取桌面位置，请稍后重试。".into());
    }
    let mut entries = vec![];
    let mut seen = HashSet::new();
    let mut truncated = false;
    for directory in directories {
        let children = match std::fs::read_dir(&directory) {
            Ok(children) => children,
            Err(error) => {
                issues.push(format!("{}：{error}", directory.display()));
                continue;
            }
        };
        for entry in children {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    issues.push(error.to_string());
                    continue;
                }
            };
            let path = entry.path();
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if entry
                    .metadata()
                    .is_ok_and(|m| m.file_attributes() & (0x2 | 0x4) != 0)
                {
                    continue;
                }
            }
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if file_name.eq_ignore_ascii_case("desktop.ini")
                || !seen.insert(file_name.to_lowercase())
            {
                continue;
            }
            if entries.len() == 256 {
                truncated = true;
                break;
            }
            let kind = model::classify(&path).to_string();
            let name = if kind == "app" {
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            } else {
                file_name
            };
            #[cfg(windows)]
            let icon = super::windows::icon(&path).ok().flatten();
            #[cfg(not(windows))]
            let icon = None;
            entries.push(DesktopEntry {
                path: path.display().to_string(),
                name,
                kind,
                icon,
            });
        }
        if truncated {
            break;
        }
    }
    if entries.is_empty() && !issues.is_empty() {
        return Err(issues.join("\n"));
    }
    entries.sort_by(|a, b| {
        (a.kind != "app", a.name.to_lowercase()).cmp(&(b.kind != "app", b.name.to_lowercase()))
    });
    Ok(DesktopEntries {
        entries,
        truncated,
        issues,
    })
}
