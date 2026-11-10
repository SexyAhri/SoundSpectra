//! Native QR worker. Cancellation generations also gate the final vault write.
use super::{
    kugou::QrLogin,
    login::{self, Login},
    session::Session,
    MusicState,
};
use std::{
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "kugou-music-auth";
pub fn start(app: AppHandle, state: Arc<MusicState>) -> Result<(), String> {
    login::cancel(&app, &state);
    let generation = {
        let _gate = state.session_gate.lock().unwrap();
        let generation = state.login_generation.fetch_add(1, Ordering::SeqCst) + 1;
        *state.login.lock().unwrap() = Login {
            provider: Some("kugou".into()),
            phase: "loading".into(),
            qr: None,
            message: "正在获取酷狗官方二维码…".into(),
        };
        generation
    };
    std::thread::spawn(move || {
        let update = |phase: &str, qr: Option<String>, message: &str| {
            let mut login = state.login.lock().unwrap();
            if state.login_generation.load(Ordering::SeqCst) != generation {
                return false;
            }
            *login = Login {
                provider: Some("kugou".into()),
                phase: phase.into(),
                qr,
                message: message.into(),
            };
            true
        };
        let run = || -> Result<(), String> {
            let qr = QrLogin::create()?;
            if !update(
                "waiting",
                Some(qr.image.clone()),
                "使用酷狗音乐 App 扫码并确认登录",
            ) {
                return Ok(());
            }
            let started = Instant::now();
            while started.elapsed() < Duration::from_secs(270) {
                // Short sleeps let cancelled workers release QR/credentials promptly.
                for _ in 0..12 {
                    if state.login_generation.load(Ordering::SeqCst) != generation {
                        return Ok(());
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                let (phase, session) = qr.poll()?;
                if let Some(session) = session {
                    if !update("verifying", None, "正在验证酷狗官网会话…") {
                        return Ok(());
                    }
                    state.attach(Session::Kugou(session), generation)?;
                    update("connected", None, "酷狗音乐已连接");
                    return Ok(());
                }
                match phase {
                    0 => {
                        update("expired", None, "二维码已过期，请刷新");
                        return Ok(());
                    }
                    2 => {
                        if !update("scanned", None, "扫码成功，请在手机上确认登录") {
                            return Ok(());
                        }
                    }
                    _ => {
                        if !update(
                            "waiting",
                            Some(qr.image.clone()),
                            "使用酷狗音乐 App 扫码并确认登录",
                        ) {
                            return Ok(());
                        }
                    }
                }
            }
            update("expired", None, "登录已超时，请刷新二维码");
            Ok(())
        };
        if let Err(message) = run() {
            update(
                if message.starts_with("[risk]") {
                    "authorization"
                } else {
                    "error"
                },
                None,
                &message,
            );
        }
    });
    Ok(())
}

pub fn navigation(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none_or(|p| p == 443)
        && url.host_str().is_some_and(|h| {
            matches!(
                h,
                "www.kugou.com"
                    | "login-user.kugou.com"
                    | "loginservice.kugou.com"
                    | "staticssl.kugou.com"
                    | "h5.kugou.com"
                    | "verify.kugou.com"
            )
        })
}
// A challenge stops the native worker; only the official UI handles verification.
// No browser cookies, fingerprints or verification tokens are extracted here.
pub fn official(app: &AppHandle, state: &MusicState) -> Result<(), String> {
    let window = match app.get_webview_window(LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(
            app,
            LABEL,
            WebviewUrl::External("https://www.kugou.com/".parse().unwrap()),
        )
        .title("酷狗音乐 · 官方验证")
        .inner_size(900.0, 700.0)
        .center()
        .data_directory(state.directory.join("kugou-webview"))
        .on_navigation(navigation)
        .build()
        .map_err(|_| "无法打开酷狗官方验证窗口")?,
    };
    window
        .set_skip_taskbar(false)
        .map_err(|_| "无法显示官方窗口")?;
    window.show().map_err(|_| "无法显示官方窗口")?;
    window.set_focus().map_err(|_| "无法聚焦官方窗口".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn verification_window_is_restricted_to_explicit_official_https_hosts() {
        assert!(super::navigation(
            &"https://login-user.kugou.com/login/".parse().unwrap()
        ));
        for url in [
            "http://www.kugou.com/",
            "https://www.kugou.com.evil.test/",
            "https://user@www.kugou.com/",
            "https://127.0.0.1/",
            "https://www.kugou.com:444/",
        ] {
            assert!(!super::navigation(&url.parse().unwrap()));
        }
    }
}
