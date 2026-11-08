//! Reusable companion windows keep Explorer's rail HWND attached and visible.
use super::{RailGroup, RailState};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
use tauri::{Emitter, Manager, WebviewWindow};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Menu,
    More,
    Add,
    Note,
    Folder,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub token: String,
    pub mode: Mode,
    pub item_id: Option<String>,
    pub left: f64,
    pub top: f64,
    pub width: f64,
}
struct Entry {
    request: Request,
    ready: bool,
}
#[derive(Default)]
pub struct PopupWindows(Mutex<HashMap<String, Entry>>);
impl PopupWindows {
    #[cfg(windows)]
    pub fn token(&self, id: &str) -> Option<String> {
        self.0
            .try_lock()
            .ok()?
            .get(id)
            .map(|entry| entry.request.token.clone())
    }
    #[cfg(windows)]
    pub fn is_open(&self, id: &str) -> bool {
        self.0
            .try_lock()
            .is_ok_and(|entries| entries.contains_key(id))
    }
    pub fn retain(&self, settings: &super::RailSettings) {
        if let Ok(mut entries) = self.0.lock() {
            entries.retain(|id, _| settings.enabled && settings.groups.iter().any(|g| &g.id == id));
        }
    }
}
fn host_id(window: &WebviewWindow) -> Result<String, String> {
    window
        .label()
        .strip_prefix("rail-popup-")
        .map(str::to_owned)
        .ok_or("仅供挂件面板使用".into())
}
fn validate(request: &Request, group: &RailGroup) -> Result<(), String> {
    if request.token.is_empty()
        || request.token.len() > 64
        || ![request.left, request.top, request.width]
            .iter()
            .all(|v| v.is_finite() && *v >= 0.0 && *v < 100000.0)
        || !(100.0..=440.0).contains(&request.width)
        || request
            .item_id
            .as_ref()
            .is_some_and(|id| !group.items.iter().any(|item| &item.id == id))
        || (matches!(request.mode, Mode::Menu | Mode::Note | Mode::Folder)
            && request.item_id.is_none())
    {
        return Err("挂件面板参数无效".into());
    }
    Ok(())
}
fn on_main<T: Send + 'static>(
    window: &WebviewWindow,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .run_on_main_thread(move || {
            let _ = tx.send(operation());
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(15))
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rail_popup(
    window: WebviewWindow,
    open: bool,
    request: Option<Request>,
) -> Result<(), String> {
    let id = window
        .label()
        .strip_prefix("rail-")
        .filter(|id| !id.starts_with("popup-"))
        .ok_or("仅供桌面拾光绳使用")?
        .to_owned();
    let target = window.clone();
    on_main(&window, move || {
        let app = target.app_handle();
        let state = target.state::<RailState>();
        let label = format!("rail-popup-{id}");
        if !open {
            if let Some(panel) = app.get_webview_window(&label) {
                panel
                    .emit("rail-dismiss-popup", ())
                    .map_err(|e| e.to_string())?;
            }
            return Ok(());
        }
        let request = request.ok_or("缺少挂件面板参数")?;
        let settings = state.settings.lock().map_err(|e| e.to_string())?.clone()?;
        let group = settings
            .groups
            .iter()
            .find(|g| g.id == id && settings.enabled)
            .ok_or("找不到已启用的拾光绳")?;
        validate(&request, group)?;
        state
            .popup_windows
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(
                id.clone(),
                Entry {
                    request: request.clone(),
                    ready: false,
                },
            );
        let result = (|| {
            let panel = match app.get_webview_window(&label) {
                Some(panel) => panel,
                None => tauri::WebviewWindowBuilder::new(
                    app,
                    &label,
                    tauri::WebviewUrl::App(
                        format!("index.html?window=rail-popup&group={id}").into(),
                    ),
                )
                .title(format!("SoundSpectra · {}", group.name))
                .inner_size(request.width + 24.0, 344.0)
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
            #[cfg(windows)]
            {
                super::native_drop::install(&panel)?;
                super::popup_focus::install(&panel)?;
            }
            // The panel stays hidden until its content is measured and painted.
            panel
                .emit("rail-popup-show", &request)
                .map_err(|e| e.to_string())
        })();
        if result.is_err() {
            state
                .popup_windows
                .0
                .lock()
                .map_err(|e| e.to_string())?
                .remove(&id);
        }
        result
    })
}

#[tauri::command]
pub fn rail_popup_get(window: WebviewWindow) -> Result<Option<Request>, String> {
    let id = host_id(&window)?;
    let state = window.state::<RailState>();
    let entries = state.popup_windows.0.lock().map_err(|e| e.to_string())?;
    Ok(entries.get(&id).map(|entry| entry.request.clone()))
}

#[tauri::command]
pub async fn rail_popup_resize(
    window: WebviewWindow,
    token: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let id = host_id(&window)?;
    if !width.is_finite()
        || !height.is_finite()
        || !(1.0..=440.0).contains(&width)
        || !(1.0..=360.0).contains(&height)
    {
        return Err("面板尺寸无效".into());
    }
    let target = window.clone();
    on_main(&window, move || {
        let state = target.state::<RailState>();
        let mut entries = state.popup_windows.0.lock().map_err(|e| e.to_string())?;
        let Some(entry) = entries
            .get_mut(&id)
            .filter(|entry| entry.request.token == token)
        else {
            return Ok(());
        };
        let source = target
            .app_handle()
            .get_webview_window(&format!("rail-{id}"))
            .ok_or("找不到原拾光绳窗口")?;
        let origin = source.outer_position().map_err(|e| e.to_string())?;
        let monitor = source
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("找不到拾光绳所在显示器")?;
        let dpi = monitor.scale_factor();
        let area = monitor.work_area();
        let w = ((width + 24.0) * dpi).ceil() as u32;
        let h = ((height + 24.0) * dpi).ceil() as u32;
        let left = origin.x
            + ((entry.request.left + (entry.request.width - width) / 2.0 - 12.0) * dpi).round()
                as i32;
        let top = origin.y + ((entry.request.top - 12.0) * dpi).round() as i32;
        let left = left.clamp(
            area.position.x,
            (area.position.x + area.size.width as i32 - w as i32).max(area.position.x),
        );
        let top = top.clamp(
            area.position.y,
            (area.position.y + area.size.height as i32 - h as i32).max(area.position.y),
        );
        target
            .set_position(tauri::PhysicalPosition::new(left, top))
            .map_err(|e| e.to_string())?;
        target
            .set_size(tauri::PhysicalSize::new(w, h))
            .map_err(|e| e.to_string())?;
        if !entry.ready {
            target.show().map_err(|e| e.to_string())?;
            target.set_focus().map_err(|e| e.to_string())?;
            entry.ready = true;
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn rail_popup_hide(window: WebviewWindow, token: String) -> Result<(), String> {
    let id = host_id(&window)?;
    let target = window.clone();
    on_main(&window, move || {
        let state = target.state::<RailState>();
        let mut entries = state.popup_windows.0.lock().map_err(|e| e.to_string())?;
        if !entries
            .get(&id)
            .is_some_and(|entry| entry.request.token == token)
        {
            return Ok(());
        }
        target.hide().map_err(|e| e.to_string())?;
        entries.remove(&id);
        target
            .emit_to(format!("rail-{id}"), "rail-popup-closed", token)
            .map_err(|e| e.to_string())
    })
}

#[tauri::command]
pub fn rail_popup_select(window: WebviewWindow, item_id: String) -> Result<(), String> {
    let id = host_id(&window)?;
    let state = window.state::<RailState>();
    let settings = state.settings.lock().map_err(|e| e.to_string())?.clone()?;
    let group = settings
        .groups
        .iter()
        .find(|group| group.id == id)
        .ok_or("找不到拾光绳")?;
    if !group.items.iter().any(|item| item.id == item_id) {
        return Err("挂件已移除".into());
    }
    window
        .emit_to(format!("rail-{id}"), "rail-select-item", item_id)
        .map_err(|e| e.to_string())
}
