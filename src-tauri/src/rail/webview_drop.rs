//! WebView2's renderer/D3D HWNDs belong to other processes. Overriding OLE on
//! the host HWND cannot handle their drops. Use the documented File objects in
//! WebMessageReceived.AdditionalObjects to obtain paths without reading data.
use serde::Deserialize;
use std::path::Path;
use tauri::{Emitter, Manager, WebviewWindow};
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller4, ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs,
        ICoreWebView2WebMessageReceivedEventArgs2,
    },
    WebMessageReceivedEventHandler,
};
use windows::core::{Interface, PWSTR};
use windows_sys::Win32::UI::WindowsAndMessaging::{GetPropW, SetPropW};

const KIND: &str = "soundspectra:rail-file-drop";
const READY: &[u16] = &[
    83, 111, 117, 110, 100, 83, 112, 101, 99, 116, 114, 97, 46, 70, 105, 108, 101, 68, 114, 111,
    112, 0,
];

#[derive(Deserialize)]
struct Message {
    kind: String,
    x: f64,
    y: f64,
}
fn trusted_source(expected: &tauri::Url, source: &str) -> bool {
    tauri::Url::parse(source).is_ok_and(|source| {
        source.host_str().is_some()
            && source.scheme() == expected.scheme()
            && source.host_str() == expected.host_str()
            && source.port_or_known_default() == expected.port_or_known_default()
    })
}
fn application_origin(dev_url: Option<&tauri::Url>, packaged: bool) -> tauri::Url {
    // A newly constructed WebView is still about:blank. Capturing its current
    // URL there permanently rejects every later drop after navigation.
    if !packaged {
        if let Some(url) = dev_url {
            return url.clone();
        }
    }
    tauri::Url::parse("http://tauri.localhost").expect("constant Windows app origin")
}
fn configured_origin(dev_url: Option<&tauri::Url>) -> tauri::Url {
    // The CLI enables the dependency feature `tauri/custom-protocol`
    // directly; the similarly named application feature can stay off.
    application_origin(dev_url, !tauri::is_dev())
}
fn read_string(
    read: impl FnOnce(*mut PWSTR) -> windows::core::Result<()>,
) -> Result<String, String> {
    let mut value = PWSTR::null();
    let result = read(&mut value);
    // Free even if a getter returns an error after allocating its buffer.
    let value = webview2_com::take_pwstr(value);
    result.map(|_| value).map_err(|e| e.to_string())
}
fn decode(
    expected: &tauri::Url,
    args: &ICoreWebView2WebMessageReceivedEventArgs,
) -> Result<Option<super::native_drop::Drop>, String> {
    let Ok(raw) = read_string(|value| unsafe { args.TryGetWebMessageAsString(value) }) else {
        return Ok(None); // Other WebView/Tauri messages use this event too.
    };
    if raw.len() > 2048 {
        return Ok(None);
    }
    let Ok(message) = serde_json::from_str::<Message>(&raw) else {
        return Ok(None);
    };
    if message.kind != KIND {
        return Ok(None);
    }
    let source = read_string(|value| unsafe { args.Source(value) })?;
    if !trusted_source(expected, &source) {
        return Ok(None);
    }
    if ![message.x, message.y]
        .iter()
        .all(|v| v.is_finite() && *v >= 0.0 && *v <= i32::MAX as f64)
    {
        return Err("拖放位置无效".into());
    }
    let args: ICoreWebView2WebMessageReceivedEventArgs2 = args
        .cast()
        .map_err(|_| "WebView2 不支持系统文件拖入，请更新 WebView2")?;
    let objects = unsafe { args.AdditionalObjects() }.map_err(|e| e.to_string())?;
    let mut count = 0;
    unsafe { objects.Count(&mut count) }.map_err(|e| e.to_string())?;
    if !(1..=48).contains(&count) {
        return Err("每次可拖入 1～48 个项目".into());
    }
    let mut paths = Vec::new();
    for i in 0..count {
        let object = unsafe { objects.GetValueAtIndex(i) }.map_err(|e| e.to_string())?;
        let file: ICoreWebView2File = object
            .cast()
            .map_err(|_| "请从桌面或资源管理器拖入文件、文件夹或快捷方式")?;
        let path = read_string(|value| unsafe { file.Path(value) })?;
        if path.encode_utf16().count() > 32767 || !Path::new(&path).is_absolute() {
            return Err("拖入的项目没有有效的本地路径".into());
        }
        if !paths.iter().any(|p: &String| p.eq_ignore_ascii_case(&path)) {
            paths.push(path);
        }
    }
    Ok(Some(super::native_drop::Drop {
        paths,
        position: super::native_drop::Position {
            x: message.x.round() as i32,
            y: message.y.round() as i32,
        },
    }))
}

pub fn install(window: &WebviewWindow) -> Result<(), String> {
    let root = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
    let source = configured_origin(window.app_handle().config().build.dev_url.as_ref());
    let target = window.clone();
    window
        .with_webview(move |webview| {
            if unsafe { !GetPropW(root as _, READY.as_ptr()).is_null() } {
                return;
            }
            let result = (|| -> Result<(), String> {
                let controller = webview.controller();
                let external: ICoreWebView2Controller4 =
                    controller.cast().map_err(|e| e.to_string())?;
                let core = unsafe { controller.CoreWebView2() }.map_err(|e| e.to_string())?;
                let receiver = target.clone();
                let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        match decode(&source, &args) {
                            Ok(Some(drop)) => {
                                let _ =
                                    receiver.emit_to(receiver.label(), "rail-native-drop", drop);
                            }
                            Err(error) => {
                                let _ =
                                    receiver.emit_to(receiver.label(), "rail-drop-error", error);
                            }
                            Ok(None) => {}
                        }
                    }
                    Ok(())
                }));
                unsafe {
                    let mut token = 0;
                    core.add_WebMessageReceived(&handler, &mut token)
                        .map_err(|e| e.to_string())?;
                    // Wry disables this by default when it installs its own OLE
                    // targets. Foreign-process renderer children still need it.
                    if let Err(error) = external.SetAllowExternalDrop(true) {
                        let _ = core.remove_WebMessageReceived(token);
                        return Err(error.to_string());
                    }
                    SetPropW(root as _, READY.as_ptr(), 1usize as _);
                }
                Ok(())
            })();
            if let Err(error) = result {
                let _ = target.emit_to(
                    target.label(),
                    "rail-drop-error",
                    format!("无法启用系统拖入：{error}"),
                );
                eprintln!("rail file drop bridge: {error}");
            }
        })
        .map_err(|e| e.to_string())
}

pub(super) unsafe fn ready(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    !GetPropW(hwnd, READY.as_ptr()).is_null()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_the_application_origin_including_the_development_port() {
        let expected = tauri::Url::parse("http://127.0.0.1:1420/?window=rail").unwrap();
        assert!(trusted_source(
            &expected,
            "http://127.0.0.1:1420/index.html?window=rail"
        ));
        for url in [
            "https://example.com",
            "http://127.0.0.1:1421",
            "http://localhost:1420",
            "data:text/html,x",
            "file:///C:/x.html",
        ] {
            assert!(!trusted_source(&expected, url));
        }
        let packaged = tauri::Url::parse("http://tauri.localhost/index.html").unwrap();
        assert!(trusted_source(
            &packaged,
            "http://tauri.localhost/index.html?window=rail"
        ));
    }
    #[test]
    fn cold_start_origin_comes_from_config_instead_of_about_blank() {
        let dev = tauri::Url::parse("http://127.0.0.1:1420").unwrap();
        let expected = application_origin(Some(&dev), false);
        assert!(trusted_source(
            &expected,
            "http://127.0.0.1:1420/index.html?window=rail"
        ));
        assert!(!trusted_source(&expected, "about:blank"));
        let packaged = application_origin(Some(&dev), true);
        assert!(trusted_source(
            &packaged,
            "http://tauri.localhost/index.html"
        ));
        assert!(!trusted_source(&packaged, dev.as_str()));
    }
    #[test]
    fn origin_uses_tauris_mode_when_cli_enables_the_dependency_feature() {
        let dev = tauri::Url::parse("http://127.0.0.1:1420").unwrap();
        let expected = configured_origin(Some(&dev));
        let actual = if tauri::is_dev() {
            "http://127.0.0.1:1420/index.html?window=rail"
        } else {
            "http://tauri.localhost/index.html?window=rail"
        };
        assert!(trusted_source(&expected, actual));
    }
}
