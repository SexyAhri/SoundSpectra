use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager,
};

pub struct SceneMenu(Submenu<tauri::Wry>);
#[derive(serde::Deserialize)]
pub struct SceneShortcut {
    id: String,
    name: String,
}

#[tauri::command]
pub fn sync_scene_shortcuts(
    window: tauri::WebviewWindow,
    app: AppHandle,
    entries: Vec<SceneShortcut>,
) -> Result<(), String> {
    if window.label() != "settings" || entries.len() > 3 {
        return Err("场景快捷入口无效".into());
    }
    let mut ids = std::collections::HashSet::new();
    for item in &entries {
        if item.id.is_empty()
            || item.id.len() > 64
            || !item
                .id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            || !ids.insert(&item.id)
            || item.name.trim().is_empty()
            || item.name.chars().count() > 40
        {
            return Err("场景快捷入口无效".into());
        }
    }
    let menu = &app.state::<SceneMenu>().0;
    while menu.items().map_err(|e| e.to_string())?.len() > 4 {
        menu.remove_at(4).map_err(|e| e.to_string())?;
    }
    if !entries.is_empty() {
        menu.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    }
    for item in entries {
        menu.append(
            &MenuItem::with_id(
                &app,
                format!("favorite:{}", item.id),
                item.name,
                true,
                None::<&str>,
            )
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Route tray actions through the settings window so it can save pending edits
/// and show the same confirmation as the in-app exit button.
pub fn dispatch(app: &AppHandle, action: &str) {
    crate::show_settings(app);
    let _ = app.emit_to("settings", "application-action", action);
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开主界面", true, None::<&str>)?;
    let collection = MenuItem::with_id(app, "library", "场景收藏…", true, None::<&str>)?;
    let warm = MenuItem::with_id(app, "warm-sand", "暖砂日常", true, None::<&str>)?;
    let dusk = MenuItem::with_id(app, "dusk-blue", "暮蓝听歌", true, None::<&str>)?;
    let quiet = MenuItem::with_id(app, "quiet-mint", "清浅专注", true, None::<&str>)?;
    let scenes = Submenu::with_items(app, "桌面方案", true, &[&collection, &warm, &dusk, &quiet])?;
    app.manage(SceneMenu(scenes.clone()));
    let rail = MenuItem::with_id(app, "rail", "桌面拾光绳", true, None::<&str>)?;
    let scene = MenuItem::with_id(app, "scene", "灯效", true, None::<&str>)?;
    let lyrics = MenuItem::with_id(app, "lyrics", "歌词", true, None::<&str>)?;
    let card = MenuItem::with_id(app, "card", "音乐卡片", true, None::<&str>)?;
    let wallpaper = MenuItem::with_id(app, "wallpaper", "壁纸", true, None::<&str>)?;
    let desktop = Submenu::with_items(
        app,
        "桌面组件",
        true,
        &[&rail, &scene, &lyrics, &card, &wallpaper],
    )?;
    let settings = MenuItem::with_id(app, "settings", "应用设置…", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "检查更新…", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "关于 SoundSpectra", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出应用…", true, None::<&str>)?;
    let settings_separator = PredefinedMenuItem::separator(app)?;
    let quit_separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &scenes,
            &desktop,
            &settings_separator,
            &settings,
            &updates,
            &about,
            &quit_separator,
            &quit,
        ],
    )?;

    let mut pixels = vec![0u8; 32 * 32 * 4];
    for (x, height) in [(6, 10), (12, 24), (18, 18), (24, 12)] {
        for dx in 0..3 {
            for y in (32 - height) / 2..(32 + height) / 2 {
                let offset = (y * 32 + x + dx) * 4;
                pixels[offset..offset + 4].copy_from_slice(&[232, 180, 139, 255]);
            }
        }
    }
    TrayIconBuilder::with_id("main")
        .icon(tauri::image::Image::new_owned(pixels, 32, 32))
        .tooltip("SoundSpectra · 声谱\n单击打开主界面，右键显示菜单")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                crate::show_settings(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => crate::show_settings(app),
            id if ["library", "warm-sand", "dusk-blue", "quiet-mint"].contains(&id)
                || id.starts_with("favorite:") =>
            {
                crate::show_settings(app);
                let _ = app.emit_to("settings", "scene-shortcut", id);
            }
            "rail" | "scene" | "lyrics" | "card" | "wallpaper" | "settings" | "updates"
            | "about" | "quit" => dispatch(app, event.id.as_ref()),
            _ => (),
        })
        .build(app)?;
    Ok(())
}
