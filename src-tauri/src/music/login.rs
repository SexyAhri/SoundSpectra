use super::{qq, vault, MusicState};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "qq-music-auth";
const AUTHORIZE: &str = "https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=100497308&redirect_uri=https%3A%2F%2Fy.qq.com%2Fportal%2Fwx_redirect.html%3Flogin_type%3D1%26surl%3Dhttps%253A%252F%252Fy.qq.com%252Fn%252Fryqq_v2%252Fprofile&state=state&display=pc&scope=get_user_info%2Cget_app_friends";

// The official page retains its cookies, polling, scan confirmation and OAuth
// exchange. Each official frame can send only a QR raster and a short state to
// the top frame. It has no app IPC permission or access to native credentials.
const QR_SCRIPT: &str = r#"(()=>{
  const allowed=new Set(['https://graph.qq.com','https://xui.ptlogin2.qq.com','https://ssl.ptlogin2.qq.com']);
  if(window===window.top){window.__soundspectraQr={};window.addEventListener('message',e=>{
    if(!allowed.has(e.origin)||!e.data||e.data.kind!=='soundspectra-qr')return;
    const d=e.data;if(typeof d.qr==='string'&&d.qr.startsWith('data:image/png;base64,')&&d.qr.length<180000)window.__soundspectraQr.qr=d.qr;
    if(typeof d.status==='string')window.__soundspectraQr.status=d.status.slice(0,80);
  });}
  if(!allowed.has(location.origin))return;
  let previous='';setInterval(()=>{
    const img=[...document.images].find(i=>/ptqrshow/.test(i.src)&&i.complete&&i.naturalWidth>30);
    if(img){try{const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;c.getContext('2d').drawImage(img,0,0);const qr=c.toDataURL('image/png');if(qr!==previous){previous=qr;window.top.postMessage({kind:'soundspectra-qr',qr},'https://graph.qq.com');}}catch{}}
    const t=document.body?.innerText||'';let status='waiting';
    if(/二维码.*失效|二维码.*过期/.test(t))status='expired';
    else if(/扫描成功|扫码成功|手机.*确认|请在.*确认/.test(t))status='scanned';
    else if(/授权并登录|同意.*授权/.test(t)&&!img)status='authorization';
    window.top.postMessage({kind:'soundspectra-qr',status},'https://graph.qq.com');
  },650);
})()"#;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Login {
    pub phase: String,
    pub qr: Option<String>,
    pub message: String,
}

// Legacy callers omit the provider. Explicit platform requests must never
// silently fall through to QQ authentication.
pub fn validate_provider(provider: Option<&str>) -> Result<(), String> {
    match provider {
        None | Some("qq") => Ok(()),
        Some(_) => Err("此音乐平台尚未接入登录".into()),
    }
}

pub fn allowed_navigation(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            matches!(
                host,
                "graph.qq.com"
                    | "xui.ptlogin2.qq.com"
                    | "ssl.ptlogin2.qq.com"
                    | "ptlogin2.qq.com"
                    | "ssl.ptlogin2.graph.qq.com"
                    | "y.qq.com"
                    | "c.y.qq.com"
                    | "u.y.qq.com"
                    | "aq.qq.com"
                    | "captcha.qq.com"
                    | "t.captcha.qq.com"
            )
        })
}

pub fn start(app: AppHandle, state: Arc<MusicState>) -> Result<(), String> {
    let generation = {
        let _gate = state.session_gate.lock().unwrap();
        state.login_generation.fetch_add(1, Ordering::SeqCst) + 1
    };
    if let Some(old) = app.get_webview_window(LABEL) {
        old.destroy().map_err(|_| "无法重置登录窗口")?;
    }
    *state.login.lock().unwrap() = Login {
        phase: "loading".into(),
        qr: None,
        message: "正在获取 QQ 官方二维码…".into(),
    };
    let directory = state
        .vault_path
        .parent()
        .ok_or("登录目录不存在")?
        .join("qq-webview");
    std::fs::create_dir_all(&directory).map_err(|_| "无法创建登录会话目录")?;
    let window = WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::External(AUTHORIZE.parse().unwrap()),
    )
    .title("QQ 音乐 · 官方授权")
    .inner_size(740.0, 620.0)
    .center()
    .visible(false)
    .skip_taskbar(true)
    .data_directory(directory)
    .initialization_script_for_all_frames(QR_SCRIPT)
    .on_navigation(allowed_navigation)
    .build()
    .map_err(|_| "无法打开 QQ 官方登录会话")?;
    std::thread::spawn(move || {
        let started = Instant::now();
        while state.login_generation.load(Ordering::SeqCst) == generation
            && started.elapsed() < Duration::from_secs(300)
        {
            let session = window
                .cookies_for_url("https://y.qq.com/".parse().unwrap())
                .ok()
                .map(|cookies| qq::Session {
                    cookies: cookies
                        .iter()
                        .map(|c| (c.name().to_string(), c.value().to_string()))
                        .collect(),
                });
            if let Some(session) = session.filter(|s| qq::Qq::new(s).is_ok()) {
                let result = state.attach(session, generation);
                if state.login_generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                match result {
                    Ok(()) => {
                        *state.login.lock().unwrap() = Login {
                            phase: "connected".into(),
                            qr: None,
                            message: "QQ 音乐已连接".into(),
                        };
                        let _ = window.hide();
                        return;
                    }
                    Err(message) => {
                        *state.login.lock().unwrap() = Login {
                            phase: "error".into(),
                            qr: None,
                            message,
                        };
                        return;
                    }
                }
            }
            let (send, recv) = std::sync::mpsc::sync_channel(1);
            let _ = window.eval_with_callback("window.__soundspectraQr || {}", move |value| {
                let _ = send.send(value);
            });
            if let Ok(raw) = recv.recv_timeout(Duration::from_secs(2)) {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let mut login = state.login.lock().unwrap();
                    if state.login_generation.load(Ordering::SeqCst) != generation {
                        return;
                    }
                    if let Some(qr) = value["qr"].as_str().filter(|s| valid_qr(s)) {
                        login.qr = Some(qr.to_string());
                    }
                    let phase = value["status"].as_str().unwrap_or("waiting");
                    login.phase = if login.qr.is_none() { "loading" } else { phase }.into();
                    login.message = match phase {
                        "scanned" => "扫码成功，请在手机上确认登录",
                        "expired" => "二维码已过期，请刷新",
                        "authorization" => "QQ 需要额外授权，请打开官方授权窗口完成",
                        _ if login.qr.is_some() => "使用手机 QQ 扫码登录 QQ 音乐",
                        _ if started.elapsed() > Duration::from_secs(15) => {
                            "暂未取得二维码，可打开官方授权窗口继续"
                        }
                        _ => "正在获取 QQ 官方二维码…",
                    }
                    .into();
                }
            }
            std::thread::sleep(Duration::from_millis(800));
        }
        if state.login_generation.load(Ordering::SeqCst) == generation {
            *state.login.lock().unwrap() = Login {
                phase: "expired".into(),
                qr: None,
                message: "登录已超时，请刷新二维码".into(),
            };
            let _ = window.hide();
        }
    });
    Ok(())
}

fn valid_qr(value: &str) -> bool {
    value
        .strip_prefix("data:image/png;base64,")
        .filter(|s| s.len() < 180_000)
        .and_then(|s| STANDARD.decode(s).ok())
        .is_some_and(|bytes| bytes.starts_with(b"\x89PNG\r\n\x1a\n"))
}

pub fn cancel(app: &AppHandle, state: &MusicState) {
    let _gate = state.session_gate.lock().unwrap();
    state.login_generation.fetch_add(1, Ordering::SeqCst);
    *state.login.lock().unwrap() = Login::default();
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.destroy();
    }
}

pub fn logout(app: &AppHandle, state: &MusicState) -> Result<(), String> {
    // Restored sessions may have no open auth window. Clear the separate
    // browser profile as well, so another login cannot silently reuse it.
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            app,
            LABEL,
            WebviewUrl::External("about:blank".parse().unwrap()),
        )
        .visible(false)
        .skip_taskbar(true)
        .data_directory(
            state
                .vault_path
                .parent()
                .ok_or("登录目录不存在")?
                .join("qq-webview"),
        )
        .build()
        .map_err(|_| "无法清理官方登录会话")?,
    };
    window
        .clear_all_browsing_data()
        .map_err(|_| "无法清除官方登录会话")?;
    cancel(app, state);
    let _gate = state.session_gate.lock().unwrap();
    vault::remove(&state.vault_path)?;
    *state.provider.lock().unwrap() = None;
    *state.account.lock().unwrap() = None;
    state.tracks.lock().unwrap().clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn login_rejects_unimplemented_platforms() {
        assert!(super::validate_provider(None).is_ok());
        assert!(super::validate_provider(Some("qq")).is_ok());
        for id in ["netease", "kugou", "qishui", "", "unknown"] {
            assert!(super::validate_provider(Some(id)).is_err());
        }
    }

    #[test]
    fn auth_stays_on_official_https_origins() {
        assert!(super::allowed_navigation(
            &"https://y.qq.com/portal/wx_redirect.html".parse().unwrap()
        ));
        for url in [
            "http://y.qq.com/",
            "https://y.qq.com.evil.test/",
            "file:///C:/secret",
            "https://127.0.0.1/",
        ] {
            assert!(!super::allowed_navigation(&url.parse().unwrap()));
        }
        assert!(!super::valid_qr("data:image/svg+xml;base64,PHN2Zz4="));
    }
}
