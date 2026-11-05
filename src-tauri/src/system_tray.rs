use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter,
};

/// Route tray actions through the settings window so it can save pending edits
/// and show the same confirmation as the in-app exit button.
pub fn dispatch(app: &AppHandle, action: &str) {
    crate::show_settings(app);
    let _ = app.emit_to("settings", "application-action", action);
}

pub fn setup(app: &App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "打开主界面", true, None::<&str>)?;
    let rail = MenuItem::with_id(app, "rail", "桌面挂架", true, None::<&str>)?;
    let scene = MenuItem::with_id(app, "scene", "灯效", true, None::<&str>)?;
    let lyrics = MenuItem::with_id(app, "lyrics", "歌词", true, None::<&str>)?;
    let card = MenuItem::with_id(app, "card", "音乐卡片", true, None::<&str>)?;
    let wallpaper = MenuItem::with_id(app, "wallpaper", "壁纸", true, None::<&str>)?;
    let desktop = Submenu::with_items(
        app, "桌面组件", true, &[&rail, &scene, &lyrics, &card, &wallpaper],
    )?;
    let settings = MenuItem::with_id(app, "settings", "应用设置…", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "检查更新…", true, None::<&str>)?;
    let about = MenuItem::with_id(app, "about", "关于 SoundSpectra", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出应用…", true, None::<&str>)?;
    let settings_separator = PredefinedMenuItem::separator(app)?;
    let quit_separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[
        &open, &desktop, &settings_separator, &settings, &updates, &about,
        &quit_separator, &quit,
    ])?;

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
            if matches!(event, TrayIconEvent::Click {
                button: MouseButton::Left, button_state: MouseButtonState::Up, ..
            }) {
                crate::show_settings(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => crate::show_settings(app),
            "rail" | "scene" | "lyrics" | "card" | "wallpaper" |
            "settings" | "updates" | "about" | "quit" => dispatch(app, event.id.as_ref()),
            _ => (),
        })
        .build(app)?;
    Ok(())
}
