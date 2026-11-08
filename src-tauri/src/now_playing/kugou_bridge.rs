//! Optional KuGou clock from its own loopback CDP/native bridge. Query 864 only.
//! Network/native calls stay on a dedicated worker; normal SMTC never waits.
use super::{clean, now, NowPlaying};
use crate::{
    audio_source::Target,
    kugou_sync::{self, PORT},
};
use serde_json::{json, Value};
use std::{
    io::Read,
    net::{Ipv4Addr, SocketAddr, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tungstenite::{protocol::WebSocketConfig, Message, WebSocket};

const FRESH_MS: u64 = 5000;
const POLL_MS: u64 = 2000;
const BACKOFF_MS: u64 = 15000;

#[link(name = "kernel32")]
extern "system" {
    fn GetTickCount64() -> u64;
}
fn interacting(pid: u32) -> bool {
    unsafe {
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId,
        };
        let mut foreground = 0;
        GetWindowThreadProcessId(GetForegroundWindow(), &mut foreground);
        if foreground != pid {
            return false;
        }
        let mut input = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        GetLastInputInfo(&mut input).as_bool()
            && (GetTickCount64() as u32).wrapping_sub(input.dwTime) < 600
    }
}

#[derive(Clone, Debug)]
struct Sample {
    pid: u32,
    observed: u64,
    filename: String,
    hash: String,
    position: f64,
    duration: f64,
    playing: bool,
}
fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|v| v.is_finite())
}
fn parse(value: &Value, pid: u32, observed: u64) -> Option<Sample> {
    if value["available"] != true {
        return None;
    }
    let filename = clean(value["filename"].as_str()?.into());
    let hash = value["hash"].as_str()?.to_ascii_lowercase();
    let position = number(&value["progress"])? / 10_000_000.0;
    let duration = number(&value["duration"])? / 1000.0;
    if filename.is_empty()
        || hash.len() != 32
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
        || !(0.001..=86_400.0).contains(&duration)
        || !(0.0..=duration + 1.0).contains(&position)
    {
        return None;
    }
    let playing = match value["playback"].as_str()? {
        "playing" => true,
        "paused" | "pasued" => false,
        _ => return None,
    };
    Some(Sample {
        pid,
        observed,
        filename,
        hash,
        position: position.min(duration),
        duration,
        playing,
    })
}
fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn apply(sample: &Sample, target: &Target, info: &mut NowPlaying, observed: u64) -> bool {
    if target.player_id.as_deref() != Some("kugou")
        || sample.pid != target.pid
        || info.timeline_available
        || sample.observed > observed
        || observed - sample.observed > FRESH_MS
        || info.title.is_empty()
        || info.artist.is_empty()
        || normalize(&sample.filename) != normalize(&format!("{} - {}", info.artist, info.title))
        || info.duration > 0.0 && (info.duration - sample.duration).abs() > 2.0
        || info.playback_available && info.playing != sample.playing
    {
        return false;
    }
    info.position = (sample.position
        + if sample.playing {
            (observed - sample.observed) as f64 / 1000.0
        } else {
            0.0
        })
    .min(sample.duration);
    info.duration = sample.duration;
    info.playing = sample.playing;
    info.playback_available = true;
    info.timeline_available = true;
    info.timeline_source = Some("kugou-native");
    info.timeline_valid_until = Some(sample.observed + FRESH_MS);
    info.updated = observed;
    info.track_id.push_str(&format!(":kugou:{}", sample.hash));
    true
}

pub(super) struct Reader {
    target: Arc<Mutex<Option<Target>>>,
    latest: Arc<Mutex<Option<Sample>>>,
    stop: Arc<AtomicBool>,
}
impl Default for Reader {
    fn default() -> Self {
        let target = Arc::new(Mutex::new(None::<Target>));
        let latest = Arc::new(Mutex::new(None));
        let stop = Arc::new(AtomicBool::new(false));
        let (request, result, stopped) = (target.clone(), latest.clone(), stop.clone());
        thread::spawn(move || {
            let mut current = None;
            let mut connection = None::<Connection>;
            let mut due = 0;
            while !stopped.load(Ordering::Relaxed) {
                let target = request.lock().unwrap().clone();
                let pid = target.as_ref().map(|t| t.pid);
                if current != pid {
                    connection = None;
                    *result.lock().unwrap() = None;
                    due = 0;
                    if current.is_some() {
                        kugou_sync::report("idle", "");
                    }
                    current = pid;
                }
                if let Some(target) = target.filter(|_| now() >= due) {
                    if kugou_sync::transitioning() || interacting(target.pid) {
                        thread::sleep(Duration::from_millis(200));
                        continue;
                    }
                    let sample = (|| {
                        if kugou_sync::listener()? != Some((target.pid, true)) {
                            return Err("正在等待酷狗增强同步接口，暂时使用兼容进度。".to_string());
                        }
                        if connection.is_none() {
                            kugou_sync::report("connecting", "正在连接酷狗增强同步…");
                            connection = Some(Connection::connect()?);
                        }
                        connection.as_mut().unwrap().sample(target.pid)
                    })();
                    // A request for another player may have arrived during I/O.
                    if request.lock().unwrap().as_ref().map(|t| t.pid) == Some(target.pid) {
                        match sample {
                            Ok(sample) => {
                                *result.lock().unwrap() = sample;
                                due = now() + POLL_MS;
                            }
                            Err(error) => {
                                *result.lock().unwrap() = None;
                                connection = None;
                                kugou_sync::report("unavailable", &error);
                                due = now() + BACKOFF_MS;
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(100));
            }
        });
        Self {
            target,
            latest,
            stop,
        }
    }
}
impl Drop for Reader {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
impl Reader {
    pub(super) fn update(&mut self, target: Option<&Target>, info: &mut NowPlaying, observed: u64) {
        let target = target.filter(|t| t.player_id.as_deref() == Some("kugou"));
        *self.target.lock().unwrap() = target.cloned();
        if let (Some(target), Some(sample)) = (target, self.latest.lock().unwrap().as_ref()) {
            if apply(sample, target, info, observed) {
                kugou_sync::report("ready", "酷狗增强同步已连接，正在读取实时播放进度。");
            }
        }
    }
}

struct Connection {
    socket: WebSocket<TcpStream>,
    serial: u64,
    binding: String,
}
fn official_page(value: &Value) -> bool {
    value["type"] == "page"
        && value["url"]
            .as_str()
            .and_then(|s| reqwest::Url::parse(s).ok())
            .is_some_and(|url| {
                url.scheme() == "https" && url.host_str() == Some("pc.service.kugou.com")
            })
}
fn local_socket(url: &str) -> bool {
    reqwest::Url::parse(url).is_ok_and(|url| {
        url.scheme() == "ws"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(PORT)
            && url.username().is_empty()
            && url.password().is_none()
            && url.path().starts_with("/devtools/page/")
            && url.query().is_none()
            && url.fragment().is_none()
    })
}
impl Connection {
    fn connect() -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(900))
            .build()
            .map_err(|_| "本地同步连接不可用。")?;
        let response = client
            .get(format!("http://127.0.0.1:{PORT}/json/list"))
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| "酷狗增强接口尚未就绪，稍后会自动重试。")?;
        let mut bytes = Vec::new();
        response
            .take(131073)
            .read_to_end(&mut bytes)
            .map_err(|_| "酷狗页面信息读取失败。")?;
        if bytes.len() > 131072 {
            return Err("酷狗页面信息超出读取上限。".into());
        }
        let targets: Vec<Value> =
            serde_json::from_slice(&bytes).map_err(|_| "酷狗页面信息无效。")?;
        // Prefer the long-lived recommendation context, but other official pages
        // expose the same bridge (including the desktop popup on tested clients).
        let mut pages: Vec<_> = targets.iter().filter(|t| official_page(t)).collect();
        pages.sort_by_key(|t| !t["url"].as_str().unwrap_or("").contains("/yueku/"));
        for page in pages.iter().take(8) {
            let Some(url) = page["webSocketDebuggerUrl"]
                .as_str()
                .filter(|s| local_socket(s))
            else {
                continue;
            };
            if let Ok(mut connection) = Self::open(url) {
                let available = connection.rpc("Runtime.evaluate",json!({"expression":"typeof external.SuperCall === 'function'","returnByValue":true}));
                if available.is_ok_and(|r| r["result"]["value"] == true) {
                    connection.rpc("Runtime.addBinding", json!({"name":connection.binding}))?;
                    return Ok(connection);
                }
            }
        }
        Err("未找到可用的酷狗内嵌页面，请在酷狗中打开一次“推荐”页，之后可切换页面或最小化。".into())
    }
    fn open(url: &str) -> Result<Self, String> {
        let stream = TcpStream::connect_timeout(
            &SocketAddr::from((Ipv4Addr::LOCALHOST, PORT)),
            Duration::from_millis(400),
        )
        .map_err(|_| "酷狗本地接口连接失败。")?;
        stream
            .set_read_timeout(Some(Duration::from_millis(200)))
            .map_err(|e| e.to_string())?;
        stream
            .set_write_timeout(Some(Duration::from_millis(400)))
            .map_err(|e| e.to_string())?;
        let config = WebSocketConfig::default()
            .read_buffer_size(4096)
            .max_message_size(Some(131072))
            .max_frame_size(Some(131072));
        let (socket, _) = tungstenite::client::client_with_config(url, stream, Some(config))
            .map_err(|_| "酷狗本地接口握手失败。")?;
        Ok(Self {
            socket,
            serial: 0,
            binding: format!("__soundSpectraClock_{}_{}", std::process::id(), now()),
        })
    }
    fn send(&mut self, method: &str, params: Value) -> Result<u64, String> {
        self.serial += 1;
        self.socket
            .send(Message::Text(
                json!({"id":self.serial,"method":method,"params":params})
                    .to_string()
                    .into(),
            ))
            .map_err(|_| "酷狗本地接口已断开。")?;
        Ok(self.serial)
    }
    fn receive(&mut self, deadline: Instant) -> Result<Value, String> {
        while Instant::now() < deadline {
            match self.socket.read() {
                Ok(Message::Text(text)) => {
                    return serde_json::from_str(&text).map_err(|_| "酷狗本地响应无效。".into())
                }
                Ok(Message::Close(_)) => return Err("酷狗页面已关闭，正在重新连接。".into()),
                Ok(_) => (),
                Err(tungstenite::Error::Io(error))
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    ()
                }
                Err(_) => return Err("酷狗本地接口读取失败，稍后会自动重试。".into()),
            }
        }
        Err("酷狗响应超时，暂时使用兼容进度。".into())
    }
    fn rpc(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.send(method, params)?;
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let value = self.receive(deadline)?;
            if value["id"].as_u64() == Some(id) {
                if value.get("error").is_some() || value["result"].get("exceptionDetails").is_some()
                {
                    return Err("酷狗页面接口不可用，稍后会自动重试。".into());
                }
                return Ok(value["result"].clone());
            }
        }
    }
    fn sample(&mut self, pid: u32) -> Result<Option<Sample>, String> {
        let started = now();
        let callback = format!("{}_{}", self.binding, self.serial + 1);
        let binding = serde_json::to_string(&self.binding).unwrap();
        let callback = serde_json::to_string(&callback).unwrap();
        // The native call is deferred until CDP evaluation returns. A late queued
        // query expires, and every callback/timer is cleaned up. No player actions.
        let expression = format!(
            r#"setTimeout(()=>{{
          if(Date.now()>{expires})return;
          const cb={callback},send=v=>window[{binding}](JSON.stringify(v));
          const timer=setTimeout(()=>{{delete window[cb];send({{tag:cb,error:true}});}},1800);
          window[cb]=value=>{{clearTimeout(timer);delete window[cb];try{{
            const s=typeof value==='string'?JSON.parse(value):value;
            send({{tag:cb,available:String(s.status)==='1',filename:s.filename||'',hash:s.hash||'',
              progress:s.progress??null,duration:s.duration??null,playback:s.play_status||''}});
          }}catch{{send({{tag:cb,error:true}});}}}};
          try{{external.SuperCall(864,JSON.stringify({{callback:cb}}));}}
          catch{{clearTimeout(timer);delete window[cb];send({{tag:cb,error:true}});}}
        }},0);true"#,
            expires = started + 1800
        );
        let id = self.send(
            "Runtime.evaluate",
            json!({"expression":expression,"returnByValue":true,"awaitPromise":false}),
        )?;
        let deadline = Instant::now() + Duration::from_millis(2400);
        let tag: String = serde_json::from_str(&callback).unwrap();
        loop {
            let value = self.receive(deadline)?;
            if value["id"].as_u64() == Some(id)
                && (value.get("error").is_some()
                    || value["result"].get("exceptionDetails").is_some())
            {
                return Err("酷狗页面正在刷新，稍后会自动重试。".into());
            }
            if value["method"] == "Runtime.bindingCalled" && value["params"]["name"] == self.binding
            {
                let payload: Value = serde_json::from_str(
                    value["params"]["payload"]
                        .as_str()
                        .ok_or("酷狗进度响应无效。")?,
                )
                .map_err(|_| "酷狗进度响应无效。")?;
                if payload["tag"] != tag {
                    continue;
                }
                if payload["error"] == true {
                    return Err("酷狗暂未响应进度查询，稍后会自动重试。".into());
                }
                let finished = now();
                if finished.saturating_sub(started) > 750 {
                    return Err("酷狗进度响应较慢，暂时使用兼容进度。".into());
                }
                return Ok(parse(&payload, pid, started + (finished - started) / 2));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn value() -> Value {
        json!({"available":true,"filename":"歌手 - 微光","hash":"0123456789abcdef0123456789abcdef","progress":"125000000","duration":180000,"playback":"playing"})
    }
    fn target() -> Target {
        Target {
            pid: 7,
            executable: "KuGou.exe".into(),
            name: "酷狗音乐".into(),
            player_id: Some("kugou".into()),
            audible: true,
        }
    }
    fn info() -> NowPlaying {
        NowPlaying {
            title: "微光".into(),
            artist: "歌手".into(),
            playing: true,
            playback_available: true,
            ..Default::default()
        }
    }
    #[test]
    fn native_units_and_invalid_snapshots() {
        let sample = parse(&value(), 7, 1000).unwrap();
        assert_eq!(sample.position, 12.5);
        assert_eq!(sample.duration, 180.0);
        for (key, bad) in [
            ("progress", json!(null)),
            ("progress", json!(-1)),
            ("progress", json!("NaN")),
            ("progress", json!("2000000000")),
            ("duration", json!(0)),
            ("hash", json!("bad")),
            ("playback", json!("stopped")),
            ("available", json!(false)),
        ] {
            let mut value = value();
            value[key] = bad;
            assert!(parse(&value, 7, 1000).is_none(), "{key}");
        }
    }
    #[test]
    fn rejects_stale_other_song_process_state_and_authoritative_timeline() {
        let sample = parse(&value(), 7, 1000).unwrap();
        for case in 0..7 {
            let mut info = info();
            let mut target = target();
            let at = match case {
                0 => 999,
                1 => 7000,
                _ => 1500,
            };
            match case {
                2 => info.title = "旧歌".into(),
                3 => target.pid = 8,
                4 => info.playing = false,
                5 => info.timeline_available = true,
                6 => info.duration = 240.0,
                _ => (),
            }
            assert!(!apply(&sample, &target, &mut info, at));
        }
    }
    #[test]
    fn uses_absolute_samples_for_play_pause_seek_and_duration() {
        let mut info = info();
        let sample = parse(&value(), 7, 1000).unwrap();
        assert!(apply(&sample, &target(), &mut info, 1500));
        assert_eq!(info.position, 13.0);
        assert_eq!(info.timeline_valid_until, Some(6000));
        let mut paused = value();
        paused["playback"] = json!("pasued");
        let mut info = super::tests::info();
        info.playing = false;
        assert!(apply(
            &parse(&paused, 7, 2000).unwrap(),
            &target(),
            &mut info,
            3000
        ));
        assert_eq!(info.position, 12.5);
        let mut seek = value();
        seek["progress"] = json!("30000000");
        let mut info = super::tests::info();
        assert!(apply(
            &parse(&seek, 7, 3000).unwrap(),
            &target(),
            &mut info,
            3200
        ));
        assert_eq!(info.position, 3.2);
    }
    #[test]
    fn accepts_only_official_pages_and_fixed_loopback_sockets() {
        assert!(official_page(
            &json!({"type":"page","url":"https://pc.service.kugou.com/apps/pcwv-desktop-popup/dist/index.html"})
        ));
        assert!(!official_page(
            &json!({"type":"page","url":"https://pc.service.kugou.com.evil.invalid/"})
        ));
        assert!(local_socket("ws://127.0.0.1:9225/devtools/page/abc"));
        for url in [
            "ws://example.com:9225/devtools/page/abc",
            "ws://127.0.0.1:9223/devtools/page/abc",
            "ws://user@127.0.0.1:9225/devtools/page/abc",
            "wss://127.0.0.1:9225/devtools/page/abc",
        ] {
            assert!(!local_socket(url));
        }
    }
    #[test]
    #[ignore = "Requires a playing KuGou with temporary debug parameters; no playback controls"]
    fn installed_kugou_native_clock_read_only() {
        let pid: u32 = std::env::var("SOUNDSPECTRA_TEST_KUGOU_PID")
            .expect("set the main KuGou PID")
            .parse()
            .unwrap();
        assert_eq!(kugou_sync::listener().unwrap(), Some((pid, true)));
        let mut connection = Connection::connect().unwrap();
        let first = connection.sample(pid).unwrap().unwrap();
        thread::sleep(Duration::from_secs(2));
        let second = connection.sample(pid).unwrap().unwrap();
        assert_eq!(first.hash, second.hash);
        assert!(first.playing && second.playing);
        assert!(
            ((second.position - first.position)
                - (second.observed - first.observed) as f64 / 1000.0)
                .abs()
                < 0.3
        );
        eprintln!(
            "Verified KuGou native clock: {}; {:.3}s -> {:.3}s / {:.3}s",
            second.filename, first.position, second.position, second.duration
        );
    }
}
