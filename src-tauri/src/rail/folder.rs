use super::{allowed, item_path, saved_item, RailState};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    name: String,
    relative_path: String,
    directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderContents {
    entries: Vec<FolderEntry>,
    truncated: bool,
    unreadable: usize,
}

// Resolve only descendants of a mounted folder, including junctions or links.
fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if Path::new(relative)
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err("请从挂载的文件夹内选择项目".into());
    }
    let target = root.join(relative);
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "文件夹已移动或无法访问，请重新关联")?;
    let canonical_target = target
        .canonicalize()
        .map_err(|_| "项目已移动、删除或无法访问，请刷新列表")?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err("此链接指向挂载文件夹之外，请通过资源管理器打开".into());
    }
    Ok(target)
}

fn root_path(state: &RailState, id: &str) -> Result<PathBuf, String> {
    let item = saved_item(state, id)?;
    if item.kind != "folder" {
        return Err("此挂件不是文件夹".into());
    }
    let path = item_path(&item)?;
    if !path.is_dir() {
        return Err("目标不再是文件夹，请重新关联".into());
    }
    Ok(path)
}

fn read(root: PathBuf, relative: String) -> Result<FolderContents, String> {
    let directory = resolve(&root, &relative)?;
    let reader =
        std::fs::read_dir(&directory).map_err(|error| format!("无法读取文件夹：{error}"))?;
    let mut entries = Vec::new();
    let mut unreadable = 0;
    let mut truncated = false;
    // Bound work and IPC payloads for very large directories.
    for (index, entry) in reader.enumerate() {
        if index >= 5_000 {
            truncated = true;
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                unreadable += 1;
                continue;
            }
        };
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                unreadable += 1;
                continue;
            }
        };
        let name = match entry.file_name().into_string() {
            Ok(name) => name,
            Err(_) => {
                unreadable += 1;
                continue;
            }
        };
        let entry_relative = Path::new(&relative).join(&name);
        entries.push(FolderEntry {
            name,
            relative_path: entry_relative.to_string_lossy().into_owned(),
            directory: metadata.is_dir(),
        });
    }
    entries.sort_by_cached_key(|entry| (!entry.directory, entry.name.to_lowercase()));
    if entries.len() > 200 {
        entries.truncate(200);
        truncated = true;
    }
    Ok(FolderContents {
        entries,
        truncated,
        unreadable,
    })
}

#[tauri::command]
pub async fn rail_folder_contents(
    window: WebviewWindow,
    state: State<'_, RailState>,
    id: String,
    relative: String,
) -> Result<FolderContents, String> {
    allowed(&window)?;
    let root = root_path(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || read(root, relative))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn rail_folder_open(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, RailState>,
    id: String,
    relative: String,
    reveal: bool,
) -> Result<(), String> {
    allowed(&window)?;
    let root = root_path(&state, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolve(&root, &relative)?;
        if reveal {
            app.opener()
                .reveal_item_in_dir(path)
                .map_err(|error| error.to_string())
        } else {
            app.opener()
                .open_path(path.to_string_lossy().to_string(), None::<&str>)
                .map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
