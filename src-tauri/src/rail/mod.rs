#[cfg(windows)]
pub(crate) mod attribute_helper;
mod desktop;
#[cfg(windows)]
mod desktop_visibility;
pub mod detach;
pub mod folder;
mod model;
#[cfg(windows)]
mod native_drop;
#[cfg(windows)]
mod ole_drop;
#[cfg(windows)]
mod popup_focus;
pub mod popup_window;
#[cfg(windows)]
mod shell_refresh;
pub mod transfer;
#[cfg(windows)]
mod webview_drop;
#[cfg(windows)]
mod windows;
use base64::{engine::general_purpose::STANDARD, Engine};
pub use model::{RailGroup, RailItem, RailSettings};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

pub struct RailState {
    pub settings: Mutex<Result<RailSettings, String>>,
    operation: Mutex<()>,
    desktop_error: Mutex<Option<String>>,
    observed_missing: Mutex<Vec<String>>,
    popup_windows: popup_window::PopupWindows,
    shutting_down: AtomicBool,
}
impl RailState {
    pub fn new(app: &AppHandle) -> Self {
        #[cfg(windows)]
        let recovery_error = desktop_visibility::restore(app).err();
        #[cfg(not(windows))]
        let recovery_error = None;
        Self {
            settings: Mutex::new(read(app)),
            operation: Mutex::new(()),
            desktop_error: Mutex::new(recovery_error),
            observed_missing: Mutex::new(Vec::new()),
            popup_windows: popup_window::PopupWindows::default(),
            shutting_down: AtomicBool::new(false),
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
        missing: missing_targets(&settings),
        settings,
        desktop_error: error,
        supported: cfg!(windows),
    }
}
fn missing_targets(settings: &RailSettings) -> Vec<String> {
    settings
        .groups
        .iter()
        .flat_map(|g| &g.items)
        .filter(|i| i.kind != "note" && !Path::new(&i.path).exists())
        .map(|i| i.id.clone())
        .collect()
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
    let mut settings: RailSettings =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("拾光绳配置读取失败，原文件已保留：{e}"))?;
    settings.validate()?;
    if settings.migrate_default_name() {
        write(app, &settings)?;
    }
    Ok(settings)
}
fn write(app: &AppHandle, settings: &RailSettings) -> Result<(), String> {
    let path = path(app)?;
    std::fs::create_dir_all(path.parent().ok_or("无法定位拾光绳配置目录")?)
        .map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(
        &tmp,
        serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    std::fs::rename(tmp, path).map_err(|e| format!("拾光绳保存失败：{e}"))
}
fn allowed(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "settings" || window.label().starts_with("rail-") {
        Ok(())
    } else {
        Err("此窗口不能操作拾光绳".into())
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
    *state.observed_missing.lock().map_err(|e| e.to_string())? = value.missing.clone();
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
    AddNote {
        group_id: String,
        text: String,
    },
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
                return Err("桌面拾光绳目前支持 Windows，其他平台可编辑布局".into());
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
            name: "新拾光绳".into(),
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
                id: model::new_id(),
                name: text.lines().next().unwrap_or("").chars().take(18).collect(),
                path: String::new(),
                kind: "note".into(),
                crop: "cover".into(),
                text,
                desktop_managed: false,
                desktop_identity: None,
            });
        }
        Change::Item {
            id,
            name,
            crop,
            text,
        } => {
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
                if item.kind != "note" {
                    return Err("请选择便签".into());
                }
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
    if state.shutting_down.load(Ordering::Acquire) {
        return Err("应用正在退出".into());
    }
    let previous = state.settings.lock().map_err(|e| e.to_string())?.clone()?;
    let mut next = previous.clone();
    edit(&mut next)?;
    next.validate()?;
    // The file is committed before publishing a new snapshot; failure leaves live state intact.
    write(app, &next)?;
    *state.settings.lock().map_err(|e| e.to_string())? = Ok(next.clone());
    let error = sync_desktop(app, &next).err();
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
        #[cfg(windows)]
        let desktop_managed = desktop_visibility::is_desktop_item(path);
        #[cfg(windows)]
        if desktop_managed {
            desktop_visibility::check_access(path)?;
        }
        #[cfg(not(windows))]
        let desktop_managed = false;
        #[cfg(windows)]
        let desktop_identity = if desktop_managed {
            Some(desktop_visibility::identity(path)?)
        } else {
            None
        };
        #[cfg(not(windows))]
        let desktop_identity = None;
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
            desktop_managed,
            desktop_identity,
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
            if item.kind == "note" {
                return Err("便签不需要关联文件".into());
            }
            item.path = items[0].path.clone();
            item.kind = items[0].kind.clone();
            item.desktop_managed = items[0].desktop_managed;
            item.desktop_identity = items[0].desktop_identity;
        } else {
            let group = settings.group_mut(&group_id)?;
            for item in items {
                if let Some(old) = group
                    .items
                    .iter_mut()
                    .find(|old| old.path.eq_ignore_ascii_case(&item.path))
                {
                    old.desktop_managed |= item.desktop_managed;
                    old.desktop_identity = item.desktop_identity.or(old.desktop_identity);
                } else {
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
pub async fn rail_desktop_entries(
    window: WebviewWindow,
) -> Result<desktop::DesktopEntries, String> {
    allowed(&window)?;
    tauri::async_runtime::spawn_blocking(desktop::read)
        .await
        .map_err(|error| error.to_string())?
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
    if item.kind == "note" {
        return Err("便签没有关联文件".into());
    }
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
fn sync_desktop(app: &AppHandle, settings: &RailSettings) -> Result<(), String> {
    let result = sync_on_main(app, settings.clone());
    #[cfg(windows)]
    {
        let visible = settings.enabled && result.is_ok();
        desktop_visibility::sync(app, settings, visible)?;
    }
    result
}
pub fn restore_desktop(app: &AppHandle) -> Result<(), String> {
    #[cfg(not(windows))]
    let _ = app;
    #[cfg(windows)]
    {
        let state = app.state::<RailState>();
        let _operation = state.operation.lock().map_err(|e| e.to_string())?;
        desktop_visibility::restore(app)?;
        state.shutting_down.store(true, Ordering::Release);
    }
    Ok(())
}
fn sync_windows(app: &AppHandle, settings: &RailSettings) -> Result<(), String> {
    #[cfg(windows)]
    if let Some(window) = app.get_webview_window("settings") {
        native_drop::install(&window)?;
    }
    let state = app.state::<RailState>();
    state.popup_windows.retain(settings);
    for (label, window) in app.webview_windows() {
        if let Some(id) = label.strip_prefix("rail-popup-") {
            if !settings.enabled || !settings.groups.iter().any(|group| group.id == id) {
                window.hide().map_err(|e| e.to_string())?;
            }
            continue;
        }
        if label.starts_with("rail-")
            && (!settings.enabled
                || !settings
                    .groups
                    .iter()
                    .any(|g| label == format!("rail-{}", g.id)))
        {
            window
                .hide()
                .map_err(|e| format!("隐藏桌面拾光绳失败：{e}"))?;
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
        windows::attach(&window, group)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn debug_rail_drop_state(app: AppHandle) -> Result<Vec<serde_json::Value>, String> {
    if !cfg!(debug_assertions) {
        return Err("此接口仅用于开发验证".into());
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        #[cfg(windows)]
        let result: Result<Vec<_>, _> = handle
            .webview_windows()
            .into_iter()
            .filter(|(label, _)| label == "settings" || label.starts_with("rail-"))
            .map(|(_, window)| {
                let mut result = native_drop::diagnostics(&window)?;
                if let Ok(settings) = handle.state::<RailState>().settings.lock() {
                    if let Ok(settings) = settings.as_ref() {
                        if let Some(group) = settings
                            .groups
                            .iter()
                            .find(|group| window.label() == format!("rail-{}", group.id))
                        {
                            result["layoutHealthy"] = windows::attached(&window, group).into();
                        }
                    }
                }
                Ok(result)
            })
            .collect();
        #[cfg(not(windows))]
        let result: Result<Vec<serde_json::Value>, String> = {
            let _ = handle;
            Ok(vec![])
        };
        let _ = tx.send(result);
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?
}
#[derive(Deserialize)]
pub struct HitRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[tauri::command]
pub async fn debug_rail_visibility(
    app: AppHandle,
    group_id: String,
    mode: String,
) -> Result<(), String> {
    #[cfg(all(windows, debug_assertions))]
    {
        let window = app
            .get_webview_window(&format!("rail-{group_id}"))
            .ok_or("找不到测试用拾光绳")?;
        let (tx, rx) = std::sync::mpsc::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(windows::obscure_for_test(&target, &mode));
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(all(windows, debug_assertions)))]
    {
        let _ = (app, group_id, mode);
        Err("此接口仅用于 Windows 开发验证".into())
    }
}
#[tauri::command]
pub async fn rail_hit_regions(window: WebviewWindow, regions: Vec<HitRect>) -> Result<(), String> {
    if !window.label().starts_with("rail-") {
        return Err("仅供桌面挂件使用".into());
    }
    if regions.len() > 256
        || regions.iter().any(|r| {
            ![r.x, r.y, r.width, r.height].iter().all(|v| v.is_finite())
                || r.width < 0.0
                || r.height < 0.0
        })
    {
        return Err("挂件点击区域无效".into());
    }
    #[cfg(windows)]
    {
        let (tx, rx) = std::sync::mpsc::channel();
        let target = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(windows::hit_regions(&target, &regions));
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(std::time::Duration::from_secs(15))
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = regions;
        Ok(())
    }
}
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_tick = std::time::SystemTime::now();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            // Repair once after a scheduling gap, including sleep/resume. This
            // reuses the normal recovery path without global input or power hooks.
            let now = std::time::SystemTime::now();
            let resumed = now
                .duration_since(last_tick)
                .map_or(true, |gap| gap > std::time::Duration::from_secs(10));
            last_tick = now;
            let state = app.state::<RailState>();
            if state.shutting_down.load(Ordering::Acquire) {
                break;
            }
            let Ok(_operation) = state.operation.try_lock() else {
                continue;
            };
            if state.shutting_down.load(Ordering::Acquire) {
                break;
            }
            let Ok(settings) = state.settings.lock().map(|s| s.clone()) else {
                continue;
            };
            let Ok(settings) = settings else {
                continue;
            };
            #[cfg(windows)]
            let healthy = !settings.enabled
                || (!resumed
                    && settings.groups.iter().all(|g| {
                        app.get_webview_window(&format!("rail-{}", g.id))
                            .is_some_and(|w| windows::attached(&w, g))
                    }));
            #[cfg(windows)]
            {
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    for (label, window) in handle.webview_windows() {
                        if label == "settings" || label.starts_with("rail-") {
                            let _ = native_drop::install(&window);
                        }
                    }
                });
            }
            #[cfg(not(windows))]
            let healthy = {
                let _ = resumed;
                true
            };
            let has_error = state
                .desktop_error
                .lock()
                .map(|error| error.is_some())
                .unwrap_or(true);
            let error = if healthy && !has_error {
                #[cfg(windows)]
                {
                    desktop_visibility::sync(&app, &settings, settings.enabled).err()
                }
                #[cfg(not(windows))]
                {
                    None
                }
            } else {
                sync_desktop(&app, &settings).err()
            };
            let changed = state
                .desktop_error
                .lock()
                .map(|previous| *previous != error)
                .unwrap_or(true);
            if let Ok(mut current) = state.desktop_error.lock() {
                *current = error;
            }
            let missing = missing_targets(&settings);
            let targets_changed = state
                .observed_missing
                .lock()
                .map(|previous| *previous != missing)
                .unwrap_or(true);
            if !healthy || changed || targets_changed {
                let _ = broadcast(&app, &state, settings);
            }
        }
    });
}

#[cfg(test)]
mod recovery_tests {
    use super::*;

    #[test]
    fn missing_targets_follow_move_delete_and_restore_without_losing_references() {
        let root = std::env::temp_dir().join(model::new_id());
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("reference.txt");
        let moved = root.join("moved.txt");
        std::fs::write(&path, "keep this file").unwrap();
        let mut settings = RailSettings::default();
        settings.groups[0].items.push(RailItem {
            id: "reference".into(),
            name: "自定义显示名称".into(),
            path: path.to_string_lossy().into_owned(),
            kind: "file".into(),
            crop: "cover".into(),
            text: String::new(),
            desktop_managed: false,
            desktop_identity: None,
        });
        let original = settings.clone();
        assert!(missing_targets(&settings).is_empty());
        std::fs::rename(&path, &moved).unwrap();
        let moved_snapshot = snapshot(settings.clone(), None);
        assert_eq!(moved_snapshot.missing, ["reference"]);
        assert_eq!(moved_snapshot.settings, original);
        std::fs::rename(&moved, &path).unwrap();
        assert!(snapshot(settings.clone(), None).missing.is_empty());
        std::fs::remove_file(&path).unwrap();
        assert_eq!(missing_targets(&settings), ["reference"]);
        assert_eq!(settings, original);
        std::fs::remove_dir(&root).unwrap();
    }
}
