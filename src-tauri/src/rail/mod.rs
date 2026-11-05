mod model;
mod desktop;
#[cfg(windows)]
mod windows;
use base64::{engine::general_purpose::STANDARD, Engine};
pub use model::{RailGroup, RailItem, RailSettings};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

pub struct RailState {
    pub settings: Mutex<Result<RailSettings, String>>,
    operation: Mutex<()>,
    desktop_error: Mutex<Option<String>>,
    popup_groups: Mutex<HashSet<String>>,
}
impl RailState {
    pub fn new(app: &AppHandle) -> Self {
        Self {
            settings: Mutex::new(read(app)),
            operation: Mutex::new(()),
            desktop_error: Mutex::new(None),
            popup_groups: Mutex::new(HashSet::new()),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    settings: RailSettings,
    missing: Vec<String>,
    desktop_error: Option<String>,
    supported: bool,
}
fn snapshot(settings: RailSettings, error: Option<String>) -> Snapshot {
    Snapshot {
        missing: settings
            .groups
            .iter()
            .flat_map(|g| &g.items)
            .filter(|i| i.kind != "note" && !Path::new(&i.path).exists())
            .map(|i| i.id.clone())
            .collect(),
        settings,
        desktop_error: error,
        supported: cfg!(windows),
    }
}
fn path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("rail.json"))
}
fn read(app: &AppHandle) -> Result<RailSettings, String> {
    let path = path(app)?;
    if !path.exists() {
        return Ok(RailSettings::default());
    }
    let settings: RailSettings =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("挂架配置读取失败，原文件已保留：{e}"))?;
    settings.validate()?;
    Ok(settings)
}
fn write(app: &AppHandle, settings: &RailSettings) -> Result<(), String> {
    let path = path(app)?;
    std::fs::create_dir_all(path.parent().ok_or("无法定位挂架配置目录")?)
        .map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(
        &tmp,
        serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(tmp, path).map_err(|e| format!("挂架保存失败：{e}"))
}
fn allowed(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "settings" || window.label().starts_with("rail-") {
        Ok(())
    } else {
        Err("此窗口不能操作挂架".into())
    }
}
fn broadcast(
    app: &AppHandle,
    state: &RailState,
    settings: RailSettings,
) -> Result<Snapshot, String> {
    let value = snapshot(
        settings,
        state
            .desktop_error
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
    );
    app.emit("rail-changed", &value)
        .map_err(|e| e.to_string())?;
    Ok(value)
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Change {
    Enable {
        enabled: bool,
    },
    Group {
        id: String,
        name: Option<String>,
        x: Option<f64>,
        y: Option<f64>,
        width: Option<f64>,
        collapsed: Option<bool>,
    },
    AddGroup,
    AddNote { group_id: String, text: String },
    RemoveGroup {
        id: String,
    },
    Item {
        id: String,
        name: Option<String>,
        crop: Option<String>,
        text: Option<String>,
    },
    Move {
        id: String,
        group_id: String,
        index: usize,
    },
    Remove {
        id: String,
    },
}
fn change(settings: &mut RailSettings, change: Change) -> Result<(), String> {
    match change {
        Change::Enable { enabled } => {
            if enabled && !cfg!(windows) {
                return Err("桌面挂轨目前支持 Windows，其他平台可编辑布局".into());
            }
            settings.enabled = enabled;
        }
        Change::Group {
            id,
            name,
            x,
            y,
            width,
            collapsed,
        } => {
            let g = settings.group_mut(&id)?;
            if let Some(name) = name {
                g.name = name.trim().into();
            }
            if let Some(x) = x {
                g.x = x;
            }
            if let Some(y) = y {
                g.y = y;
            }
            if let Some(width) = width {
                g.width = width;
                g.x = g.x.min(1.0 - width);
            }
            if let Some(collapsed) = collapsed {
                g.collapsed = collapsed;
            }
        }
        Change::AddGroup => settings.groups.push(RailGroup {
            id: model::new_id(),
            name: "新挂架".into(),
            x: 0.54,
            y: 0.54,
            width: 0.38,
            collapsed: false,
            items: vec![],
        }),
        Change::RemoveGroup { id } => {
            let group = settings.group_mut(&id)?;
            if !group.items.is_empty() {
                return Err("请先移走或取消挂载这一组的项目".into());
            }
            settings.groups.retain(|g| g.id != id);
        }
        Change::AddNote { group_id, text } => {
            let group = settings.group_mut(&group_id)?;
            let text = text.trim().to_string();
            group.items.push(RailItem {
                id: model::new_id(), name: text.lines().next().unwrap_or("").chars().take(18).collect(),
                path: String::new(), kind: "note".into(), crop: "cover".into(), text,
            });
        }
        Change::Item { id, name, crop, text } => {
            let item = settings
                .groups
                .iter_mut()
                .flat_map(|g| &mut g.items)
                .find(|i| i.id == id)
                .ok_or("找不到这个挂件")?;
            if let Some(name) = name {
                item.name = name.trim().into();
            }
            if let Some(crop) = crop {
                item.crop = crop;
            }
            if let Some(text) = text {
                if item.kind != "note" { return Err("请选择便签".into()); }
                item.text = text.trim().into();
            }
        }
        Change::Move {
            id,
            group_id,
            index,
        } => {
            settings.group_mut(&group_id)?;
            let source = settings
                .groups
                .iter()
                .position(|g| g.items.iter().any(|i| i.id == id))
                .ok_or("找不到这个挂件")?;
            let position = settings.groups[source]
                .items
                .iter()
                .position(|i| i.id == id)
                .unwrap();
            let item = settings.groups[source].items.remove(position);
            let target = settings.group_mut(&group_id)?;
            target.items.insert(index.min(target.items.len()), item);
        }
        Change::Remove { id } => {
            settings.item(&id)?;
            for group in &mut settings.groups {
                group.items.retain(|i| i.id != id);
            }
        }
    }
    settings.validate()
}

fn commit(
    app: &AppHandle,
    state: &RailState,
    edit: impl FnOnce(&mut RailSettings) -> Result<(), String>,
) -> Result<Snapshot, String> {
    let _operation = state.operation.lock().map_err(|e| e.to_string())?;
    let previous = state.settings.lock().map_err(|e| e.to_string())?.clone()?;
    let mut next = previous.clone();
    edit(&mut next)?;
    next.validate()?;
    // The file is committed before publishing a new snapshot; failure leaves live state intact.
    write(app, &next)?;
    *state.settings.lock().map_err(|e| e.to_string())? = Ok(next.clone());
    let error = sync_on_main(app, next.clone()).err();
    *state.desktop_error.lock().map_err(|e| e.to_string())? = error;
    broadcast(app, state, next)
}
#[tauri::command]
pub async fn rail_get(
    window: WebviewWindow,
    state: State<'_, RailState>,
) -> Result<Snapshot, String> {
    allowed(&window)?;
    Ok(snapshot(
        state.settings.lock().map_err(|e| e.to_string())?.clone()?,
        state
            .desktop_error
            .lock()
            .map_err(|e| e.to_string())?
            .clone(),
    ))
}
#[tauri::command]
pub async fn rail_change(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, RailState>,
    change: Change,
) -> Result<Snapshot, String> {
    allowed(&window)?;
    commit(&app, &state, |settings| self::change(settings, change))
}

#[tauri::command]
pub async fn rail_add_paths(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, RailState>,
    group_id: String,
    paths: Vec<String>,
    replace_id: Option<String>,
) -> Result<Snapshot, String> {
    allowed(&window)?;
    if paths.is_empty() || paths.len() > 48 {
        return Err("每次请选择 1～48 个项目".into());
    }
    let mut items = vec![];
    for value in paths {
        let path = Path::new(&value);
        if !path.is_absolute() || !path.exists() {
            return Err(format!("目标不存在：{value}"));
        }
        let kind = model::classify(path);
        items.push(RailItem {
            id: model::new_id(),
            name: path
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("未命名")
                .into(),
            path: value,
            kind: kind.into(),
            crop: "cover".into(),
            text: String::new(),
        });
    }
    commit(&app, &state, |settings| {
        if let Some(id) = replace_id {
            if items.len() != 1 {
                return Err("重新关联时请选择一个目标".into());
            }
            let item = settings
                .groups
                .iter_mut()
                .flat_map(|g| &mut g.items)
                .find(|i| i.id == id)
                .ok_or("找不到这个挂件")?;
            if item.kind == "note" { return Err("便签不需要关联文件".into()); }
            item.path = items[0].path.clone();
            item.kind = items[0].kind.clone();
        } else {
            let group = settings.group_mut(&group_id)?;
            for item in items {
                if !group
                    .items
                    .iter()
                    .any(|old| old.path.eq_ignore_ascii_case(&item.path))
                {
                    group.items.push(item);
                }
            }
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn rail_pick(window: WebviewWindow, folder: bool) -> Result<Vec<String>, String> {
    allowed(&window)?;
    #[cfg(windows)]
    {
        windows::pick(&window, folder)
    }
    #[cfg(not(windows))]
    {
        let _ = folder;
        Err("当前平台请使用本地路径添加".into())
    }
}
#[tauri::command]
pub async fn rail_desktop_entries(window: WebviewWindow) -> Result<desktop::DesktopEntries, String> {
    allowed(&window)?;
    tauri::async_runtime::spawn_blocking(desktop::read).await.map_err(|error| error.to_string())?
}
fn saved_item(state: &RailState, id: &str) -> Result<RailItem, String> {
    Ok(state
        .settings
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .map_err(Clone::clone)?
        .item(id)?
        .clone())
}
fn item_path(item: &RailItem) -> Result<PathBuf, String> {
    if item.kind == "note" { return Err("便签没有关联文件".into()); }
    let path = PathBuf::from(&item.path);
    if !path.exists() {
        return Err("目标已移动或删除，请重新关联".into());
    }
    Ok(path)
}
#[tauri::command]
pub async fn rail_open(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, RailState>,
    id: String,
    reveal: bool,
) -> Result<(), String> {
    allowed(&window)?;
    let path = item_path(&saved_item(&state, &id)?)?;
    if reveal {
        app.opener()
            .reveal_item_in_dir(path)
            .map_err(|e| e.to_string())
    } else {
        app.opener()
            .open_path(path.to_string_lossy().to_string(), None::<&str>)
            .map_err(|e| e.to_string())
    }
}
#[tauri::command]
pub async fn rail_media(
    window: WebviewWindow,
    state: State<'_, RailState>,
    id: String,
) -> Result<Option<String>, String> {
    allowed(&window)?;
    let item = saved_item(&state, &id)?;
    let path = item_path(&item)?;
    if item.kind == "image" {
        if std::fs::metadata(&path).map_err(|e| e.to_string())?.len() > 12 * 1024 * 1024 {
            return Err("图片超过 12 MB，请从原图查看".into());
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        let mime = match path
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            _ => "image/png",
        };
        return Ok(Some(format!(
            "data:{mime};base64,{}",
            STANDARD.encode(bytes)
        )));
    }
    #[cfg(windows)]
    {
        windows::icon(&path)
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

fn sync_on_main(app: &AppHandle, settings: RailSettings) -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(sync_windows(&handle, &settings));
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(15))
        .map_err(|e| e.to_string())?
}
fn sync_windows(app: &AppHandle, settings: &RailSettings) -> Result<(), String> {
    let state = app.state::<RailState>();
    let mut popups = state.popup_groups.lock().map_err(|e| e.to_string())?;
    popups.retain(|id| settings.enabled && settings.groups.iter().any(|g| &g.id == id));
    for (label, window) in app.webview_windows() {
        if label.starts_with("rail-")
            && (!settings.enabled
                || !settings
                    .groups
                    .iter()
                    .any(|g| label == format!("rail-{}", g.id)))
        {
            let _ = window.hide();
        }
    }
    if !settings.enabled {
        return Ok(());
    }
    #[cfg(windows)]
    for group in &settings.groups {
        let label = format!("rail-{}", group.id);
        let window = match app.get_webview_window(&label) {
            Some(window) => window,
            None => tauri::WebviewWindowBuilder::new(
                app,
                &label,
                tauri::WebviewUrl::App(format!("index.html?window=rail&group={}", group.id).into()),
            )
            .title(format!("SoundSpectra · {}", group.name))
            .inner_size(780.0, 220.0)
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .resizable(false)
            .build()
            .map_err(|e| e.to_string())?,
        };
        windows::attach(&window, group, popups.contains(&group.id))?;
    }
    Ok(())
}
#[tauri::command]
pub async fn rail_popup(
    window: WebviewWindow,
    state: State<'_, RailState>,
    open: bool,
) -> Result<(), String> {
    let id = window
        .label()
        .strip_prefix("rail-")
        .ok_or("仅供桌面挂架使用")?.to_owned();
    #[cfg(windows)]
    {
        let _ = state;
        let (tx, rx) = std::sync::mpsc::channel();
        let target = window.clone();
        window.run_on_main_thread(move || {
            let result = (|| {
                let state = target.state::<RailState>();
                let settings = state.settings.lock().map_err(|e| e.to_string())?.clone()?;
                if !settings.enabled { return Ok(()); }
                let group = settings.groups.iter().find(|g| g.id == id).ok_or("找不到挂架")?;
                let mut popups = state.popup_groups.lock().map_err(|e| e.to_string())?;
                let opening = open && !popups.contains(&id);
                windows::attach(&target, group, open)?;
                if open { popups.insert(id); } else { popups.remove(&id); }
                // Only the explicit open action may activate this editable window.
                if opening { target.set_focus().map_err(|e| e.to_string())?; }
                Ok(())
            })();
            let _ = tx.send(result);
        }).map_err(|e| e.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(15)).map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (id, state, open);
        Ok(())
    }
}
#[derive(Deserialize)]
pub struct HitRect { x: f64, y: f64, width: f64, height: f64 }
#[tauri::command]
pub async fn rail_hit_regions(window: WebviewWindow, regions: Vec<HitRect>) -> Result<(), String> {
    if !window.label().starts_with("rail-") { return Err("仅供桌面挂件使用".into()); }
    if regions.len() > 256 || regions.iter().any(|r| ![r.x, r.y, r.width, r.height].iter().all(|v| v.is_finite()) || r.width < 0.0 || r.height < 0.0) {
        return Err("挂件点击区域无效".into());
    }
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let target = window.clone();
        window.run_on_main_thread(move || { let _ = tx.send(windows::hit_regions(&target, &regions)); }).map_err(|e| e.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(15)).map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    { let _ = regions; Ok(()) }
}
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(3));
        let state = app.state::<RailState>();
        let Ok(_operation) = state.operation.try_lock() else {
            continue;
        };
        let Ok(settings) = state.settings.lock().map(|s| s.clone()) else {
            continue;
        };
        let Ok(settings) = settings else {
            continue;
        };
        // Avoid resizing an open popup on every recovery tick.
        #[cfg(windows)]
        let popups = state.popup_groups.lock().map(|value| value.clone()).unwrap_or_default();
        #[cfg(windows)]
        let healthy = !settings.enabled
            || settings.groups.iter().all(|g| {
                app.get_webview_window(&format!("rail-{}", g.id))
                    .is_some_and(|w| windows::attached(&w, popups.contains(&g.id)))
            });
        #[cfg(not(windows))]
        let healthy = true;
        if healthy {
            continue;
        }
        let error = sync_on_main(&app, settings.clone()).err();
        if let Ok(mut current) = state.desktop_error.lock() {
            *current = error;
        }
        let _ = broadcast(&app, &state, settings);
    });
}
