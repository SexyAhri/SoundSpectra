use super::{
    netease, qq,
    session::{self, Session},
    vault, MusicState,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const QQ_LABEL: &str = "qq-music-auth";
const NETEASE_LABEL: &str = "netease-music-auth";
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

// The official component owns QR creation, polling and additional verification.
// Only its rendered QR raster and fixed UI states leave the official frame.
const NETEASE_QR_SCRIPT: &str = r#"(()=>{
  const origin='https://music.163.com';
  if(location.origin!==origin)return;
  const states=new Set(['waiting','scanned','expired','authorization']);
  if(window===window.top){
    window.__soundspectraQr={};
    window.addEventListener('message',e=>{
      if(e.origin!==origin||!e.data||e.data.kind!=='soundspectra-netease-qr')return;
      if(![...document.querySelectorAll('iframe')].some(f=>f.contentWindow===e.source))return;
      const d=e.data;
      if(typeof d.qr==='string'&&d.qr.startsWith('data:image/png;base64,')&&d.qr.length<180000)window.__soundspectraQr.qr=d.qr;
      if(states.has(d.status))window.__soundspectraQr.status=d.status;
    });
    return;
  }
  if(location.pathname!=='/login')return;
  setInterval(()=>{
    const canvases=[...document.querySelectorAll('canvas')].filter(c=>c.width>=80&&c.height>=80&&c.getBoundingClientRect().width>=60&&Math.abs(c.width-c.height)<5);
    let qr;
    if(canvases.length===1){try{qr=canvases[0].toDataURL('image/png');}catch{}}
    const text=document.body?.innerText||'';
    let status='waiting';
    if(/二维码.*(?:过期|失效)|(?:过期|失效).*二维码/.test(text))status='expired';
    else if(/扫码成功|扫描成功|请在手机|手机.*确认/.test(text))status='scanned';
    else if(!qr&&/安全验证|二次验证|安全邮箱|短信验证|身份验证/.test(text))status='authorization';
    window.top.postMessage({kind:'soundspectra-netease-qr',qr,status},origin);
  },650);
})()"#;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Login {
    pub provider: Option<String>,
    pub phase: String,
    pub qr: Option<String>,
    pub message: String,
}

// Check the generation while holding the status lock, so a cancelled worker
// cannot overwrite the idle state or a newer platform's login.
pub(super) fn update(state: &MusicState, generation: u64, next: Login) -> bool {
    let mut login = state.login.lock().unwrap();
    if state.login_generation.load(Ordering::SeqCst) != generation {
        return false;
    }
    *login = next;
    true
}

fn official_target(login: &Login, expected: Option<&str>) -> Result<(String, bool), String> {
    let provider = expected
        .or(login.provider.as_deref())
        .ok_or("请先选择音乐平台")?;
    validate_provider(Some(provider))?;
    if login
        .provider
        .as_deref()
        .is_some_and(|pending| pending != provider)
        && !login.phase.is_empty()
    {
        return Err("登录平台已变化，请重新选择音乐平台".into());
    }
    let live = matches!(
        login.phase.as_str(),
        "loading" | "waiting" | "scanned" | "authorization" | "verifying"
    );
    Ok((provider.to_string(), !live))
}

pub fn official(
    app: AppHandle,
    state: Arc<MusicState>,
    expected: Option<&str>,
) -> Result<(), String> {
    let login = state.login.lock().unwrap().clone();
    let (provider, mut restart) = official_target(&login, expected)?;
    let target = label(&provider)?;
    if provider != "kugou" {
        restart |= app.get_webview_window(target).is_none();
    }
    // Expired/error workers have stopped monitoring cookies. Opening their old
    // window alone cannot complete authentication: create a new monitored session.
    if restart {
        start(app.clone(), state.clone(), &provider)?;
    }
    let generation = state.login_generation.load(Ordering::SeqCst);
    let current = state.login.lock().unwrap().clone();
    if current.provider.as_deref() != Some(provider.as_str()) {
        return Err("登录已取消或平台已变化".into());
    }
    if current.phase == "connected" {
        return Ok(());
    }
    if provider == "kugou" {
        return super::kugou_login::official(&app, &state);
    }
    let window = app
        .get_webview_window(target)
        .ok_or("授权窗口已关闭，请重新获取二维码")?;
    if state.login_generation.load(Ordering::SeqCst) != generation {
        return Err("登录已取消或平台已变化".into());
    }
    window
        .set_skip_taskbar(false)
        .map_err(|_| "无法显示授权窗口")?;
    window.show().map_err(|_| "无法显示授权窗口")?;
    window.set_focus().map_err(|_| "无法聚焦授权窗口".into())
}

// Legacy callers omit the provider. Explicit platform requests must never
// silently fall through to QQ authentication.
pub fn validate_provider(provider: Option<&str>) -> Result<(), String> {
    match provider {
        None | Some("qq" | "netease" | "kugou") => Ok(()),
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

pub fn netease_navigation(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none_or(|p| p == 443)
        && url.host_str().is_some_and(|host| {
            matches!(
                host,
                "music.163.com" | "c.dun.163.com" | "captcha.dun.163.com" | "aq.reg.163.com"
            )
        })
}
pub fn label(provider: &str) -> Result<&'static str, String> {
    match provider {
        "qq" => Ok(QQ_LABEL),
        "netease" => Ok(NETEASE_LABEL),
        "kugou" => Ok(super::kugou_login::LABEL),
        _ => Err("此音乐平台尚未接入登录".into()),
    }
}

fn wait_for_auth_release(
    mut occupied: impl FnMut() -> bool,
    timeout: Duration,
) -> Result<(), String> {
    let started = Instant::now();
    while occupied() {
        if started.elapsed() >= timeout {
            return Err("旧登录窗口尚未关闭，请稍后重新获取二维码".into());
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    Ok(())
}

// Called on a blocking worker. Tauri destroy() only enqueues destruction on the
// event loop; the window AND webview labels must be released before rebuilding.
fn destroy_auth_windows(app: &AppHandle) -> Result<(), String> {
    let labels = [QQ_LABEL, NETEASE_LABEL, super::kugou_login::LABEL];
    for label in labels {
        if let Some(window) = app.get_webview_window(label) {
            window.destroy().map_err(|_| "无法关闭旧登录窗口，请重试")?;
        }
    }
    wait_for_auth_release(
        // Tauri removes the window registration before removing its webview.
        || {
            labels
                .iter()
                .any(|label| app.get_webview_window(label).is_some())
        },
        Duration::from_secs(5),
    )
}

pub fn start(app: AppHandle, state: Arc<MusicState>, provider: &str) -> Result<(), String> {
    if provider == "kugou" {
        return super::kugou_login::start(app, state);
    }
    let (provider, target, authorize, script, cookie_url) = match provider {
        "qq" => ("qq", QQ_LABEL, AUTHORIZE, QR_SCRIPT, "https://y.qq.com/"),
        "netease" => (
            "netease",
            NETEASE_LABEL,
            "https://music.163.com/#/login",
            NETEASE_QR_SCRIPT,
            "https://music.163.com/",
        ),
        _ => return Err("此音乐平台尚未接入登录".into()),
    };
    let name = session::name(provider);
    let generation = {
        let _gate = state.session_gate.lock().unwrap();
        let generation = state.login_generation.fetch_add(1, Ordering::SeqCst) + 1;
        *state.login.lock().unwrap() = Login {
            provider: Some(provider.into()),
            phase: "loading".into(),
            qr: None,
            message: format!("正在获取{name}官方二维码…"),
        };
        generation
    };
    let prepared = (|| -> Result<tauri::WebviewWindow, String> {
        destroy_auth_windows(&app)?;
        if state.login_generation.load(Ordering::SeqCst) != generation {
            return Err("本次登录已取消".into());
        }
        let directory = state.directory.join(format!("{provider}-webview"));
        std::fs::create_dir_all(&directory).map_err(|_| "无法创建登录会话目录")?;
        let window = WebviewWindowBuilder::new(
            &app,
            target,
            WebviewUrl::External(authorize.parse().unwrap()),
        )
        .title(format!("{name} · 官方授权"))
        .inner_size(740.0, 620.0)
        .center()
        .visible(false)
        .skip_taskbar(true)
        .data_directory(directory)
        .initialization_script_for_all_frames(script)
        .on_navigation(move |url| {
            if provider == "netease" {
                netease_navigation(url)
            } else {
                allowed_navigation(url)
            }
        })
        .build()
        .map_err(|_| format!("无法打开{name}官方登录会话"))?;
        Ok(window)
    })();
    let window = match prepared {
        Ok(window) => window,
        Err(message) => {
            update(
                &state,
                generation,
                Login {
                    provider: Some(provider.into()),
                    phase: "error".into(),
                    qr: None,
                    message: message.clone(),
                },
            );
            return Err(message);
        }
    };
    let hidden = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Closing the visible authorization UI should not destroy QR polling.
            // Cancel/refresh still explicitly destroy the isolated webview.
            api.prevent_close();
            let _ = hidden.hide();
            let _ = hidden.set_skip_taskbar(true);
        }
    });
    std::thread::spawn(move || {
        let started = Instant::now();
        while state.login_generation.load(Ordering::SeqCst) == generation
            && started.elapsed() < Duration::from_secs(300)
        {
            let session = window
                .cookies_for_url(cookie_url.parse().unwrap())
                .ok()
                .map(|cookies| {
                    if provider == "qq" {
                        Session::Qq(qq::Session {
                            cookies: cookies
                                .iter()
                                .map(|c| (c.name().to_string(), c.value().to_string()))
                                .collect(),
                        })
                    } else {
                        Session::Netease(netease::Session {
                            cookies: cookies
                                .iter()
                                .map(|c| netease::Cookie {
                                    name: c.name().into(),
                                    value: c.value().into(),
                                    domain: c.domain().map(str::to_owned),
                                    path: c.path().map(str::to_owned),
                                    secure: c.secure().unwrap_or(false),
                                    expires: c.expires_datetime().map(|t| t.unix_timestamp()),
                                })
                                .collect(),
                        })
                    }
                });
            if let Some(session) = session.filter(|s| match s {
                Session::Qq(s) => qq::Qq::new(s).is_ok(),
                Session::Netease(s) => netease::Netease::new(s).is_ok(),
                Session::Kugou(_) => false,
            }) {
                {
                    let mut login = state.login.lock().unwrap();
                    if state.login_generation.load(Ordering::SeqCst) != generation {
                        return;
                    }
                    login.phase = "verifying".into();
                    login.qr = None;
                    login.message = format!("正在验证{name}账号…");
                }
                let result = state.attach(session, generation);
                if state.login_generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                match result {
                    Ok(_) => {
                        update(
                            &state,
                            generation,
                            Login {
                                provider: Some(provider.into()),
                                phase: "connected".into(),
                                qr: None,
                                message: format!("{name}已连接"),
                            },
                        );
                        let _ = window.hide();
                        return;
                    }
                    Err(message) => {
                        update(
                            &state,
                            generation,
                            Login {
                                provider: Some(provider.into()),
                                phase: "error".into(),
                                qr: None,
                                message,
                            },
                        );
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
                    let phase = match value["status"].as_str() {
                        Some(p @ ("scanned" | "expired" | "authorization")) => p,
                        _ => "waiting",
                    };
                    login.phase = if login.qr.is_none() { "loading" } else { phase }.into();
                    if phase != "waiting" {
                        login.phase = phase.into();
                        login.qr = None;
                    }
                    login.message = match phase {
                        "scanned" => "扫码成功，请在手机上确认登录",
                        "expired" => "二维码已过期，请刷新",
                        "authorization" => "需要额外验证，请打开官方授权窗口完成",
                        _ if login.qr.is_some() && provider == "netease" => {
                            "使用手机网易云音乐扫码并确认登录"
                        }
                        _ if login.qr.is_some() => "使用手机 QQ 扫码登录 QQ 音乐",
                        _ if started.elapsed() > Duration::from_secs(15) => {
                            "暂未取得二维码，可打开官方授权窗口继续"
                        }
                        _ if provider == "netease" => "正在获取网易云音乐官方二维码…",
                        _ => "正在获取 QQ 音乐官方二维码…",
                    }
                    .into();
                }
            }
            std::thread::sleep(Duration::from_millis(800));
        }
        if update(
            &state,
            generation,
            Login {
                provider: Some(provider.into()),
                phase: "expired".into(),
                qr: None,
                message: "登录已超时，请刷新二维码".into(),
            },
        ) {
            let _ = window.hide();
        }
    });
    Ok(())
}

pub(super) fn valid_qr(value: &str) -> bool {
    value
        .strip_prefix("data:image/png;base64,")
        .filter(|s| s.len() < 180_000)
        .and_then(|s| STANDARD.decode(s).ok())
        .is_some_and(|bytes| bytes.starts_with(b"\x89PNG\r\n\x1a\n"))
}

pub fn cancel(app: &AppHandle, state: &MusicState) {
    let _ = cancel_for(app, state, None);
}

pub fn cancel_for(
    app: &AppHandle,
    state: &MusicState,
    expected: Option<&str>,
) -> Result<(), String> {
    let _gate = state.session_gate.lock().unwrap();
    if expected.is_some_and(|id| {
        state
            .login
            .lock()
            .unwrap()
            .provider
            .as_deref()
            .is_some_and(|pending| pending != id)
    }) {
        return Err("登录平台已变化，请刷新登录状态".into());
    }
    state.login_generation.fetch_add(1, Ordering::SeqCst);
    *state.login.lock().unwrap() = Login::default();
    destroy_auth_windows(app)
}

pub fn logout(app: &AppHandle, state: &MusicState) -> Result<(), String> {
    let provider = state.provider()?.id();
    let target = label(provider)?;
    // Restored sessions may have no open auth window. Clear the separate
    // browser profile as well, so another login cannot silently reuse it.
    let window = match app.get_webview_window(target) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            app,
            target,
            WebviewUrl::External("about:blank".parse().unwrap()),
        )
        .visible(false)
        .skip_taskbar(true)
        .data_directory(state.directory.join(format!("{provider}-webview")))
        .build()
        .map_err(|_| "无法清理官方登录会话")?,
    };
    window
        .clear_all_browsing_data()
        .map_err(|_| "无法清除官方登录会话")?;
    cancel(app, state);
    let _gate = state.session_gate.lock().unwrap();
    vault::remove(&session::vault_path(&state.directory, provider)?)?;
    *state.provider.lock().unwrap() = None;
    *state.account.lock().unwrap() = None;
    state.tracks.lock().unwrap().clear();
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn refresh_waits_for_both_window_and_webview_release_and_times_out_safely() {
        use super::{wait_for_auth_release, Duration};
        // Simulate independently removed window/webview registrations. A refresh
        // must not return after only the first registration has disappeared.
        let mut registrations = [(true, true), (false, true), (false, false)].into_iter();
        assert!(wait_for_auth_release(
            || {
                let (window, webview) = registrations.next().expect("must stop when both are gone");
                window || webview
            },
            Duration::from_secs(1)
        )
        .is_ok());
        assert!(registrations.next().is_none());
        assert!(wait_for_auth_release(|| true, Duration::ZERO).is_err());
        assert!(wait_for_auth_release(|| false, Duration::ZERO).is_ok());
    }

    #[test]
    fn cancelled_login_cannot_publish_late_success_or_error_over_a_new_session() {
        use super::{update, Login, MusicState, Ordering};
        // MusicState construction is lazy: this test performs no file or network I/O.
        let state = MusicState::new(std::path::PathBuf::from("unused-login-state-test"));
        state.login_generation.store(1, Ordering::SeqCst);
        assert!(update(
            &state,
            1,
            Login {
                provider: Some("qq".into()),
                phase: "waiting".into(),
                ..Login::default()
            }
        ));
        state.login_generation.store(2, Ordering::SeqCst);
        assert!(update(&state, 2, Login::default()));
        assert!(!update(
            &state,
            1,
            Login {
                provider: Some("qq".into()),
                phase: "connected".into(),
                ..Login::default()
            }
        ));
        assert!(state.login.lock().unwrap().phase.is_empty());
        assert!(update(
            &state,
            2,
            Login {
                provider: Some("netease".into()),
                phase: "waiting".into(),
                ..Login::default()
            }
        ));
        assert!(!update(
            &state,
            1,
            Login {
                provider: Some("qq".into()),
                phase: "error".into(),
                ..Login::default()
            }
        ));
        let login = state.login.lock().unwrap();
        assert_eq!(login.provider.as_deref(), Some("netease"));
        assert_eq!(login.phase, "waiting");
    }

    #[test]
    fn official_authorization_restarts_terminal_sessions_and_preserves_live_scans() {
        use super::{official_target, Login};
        assert_eq!(
            official_target(&Login::default(), Some("netease")).unwrap(),
            ("netease".into(), true)
        );
        assert!(official_target(&Login::default(), None).is_err());
        for phase in ["", "error", "expired", "connected", "restoring"] {
            let login = Login {
                provider: Some("netease".into()),
                phase: phase.into(),
                ..Login::default()
            };
            assert!(official_target(&login, Some("netease")).unwrap().1);
        }
        for phase in [
            "loading",
            "waiting",
            "scanned",
            "authorization",
            "verifying",
        ] {
            let login = Login {
                provider: Some("qq".into()),
                phase: phase.into(),
                ..Login::default()
            };
            assert!(!official_target(&login, Some("qq")).unwrap().1);
            assert!(official_target(&login, Some("netease")).is_err());
        }
    }

    #[test]
    fn login_rejects_unimplemented_platforms() {
        assert!(super::validate_provider(None).is_ok());
        assert!(super::validate_provider(Some("qq")).is_ok());
        assert!(super::validate_provider(Some("netease")).is_ok());
        assert!(super::validate_provider(Some("kugou")).is_ok());
        for id in ["", "unknown"] {
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
        assert!(super::netease_navigation(
            &"https://music.163.com/login".parse().unwrap()
        ));
        for url in [
            "http://music.163.com/",
            "https://music.163.com.evil.test/",
            "https://music.163.com:9443/",
            "https://music.163.com@127.0.0.1/",
            "https://mail.163.com/",
        ] {
            assert!(!super::netease_navigation(&url.parse().unwrap()));
        }
    }
}
