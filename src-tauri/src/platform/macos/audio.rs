use crate::{
    audio_discovery,
    audio_source::{Selector, Source, Target},
    dsp::{Analyzer, MusicAnalysis, BANDS},
    macos_helper::{self, ManagedChild},
    AppState,
};
use std::{
    collections::HashMap,
    io::Read,
    process::Stdio,
    sync::{atomic::Ordering, mpsc, Arc},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

fn status(state: &AppState, revision: u64, kind: &str, message: &str, target: Option<&Target>) {
    let source = state.audio_source.lock().unwrap();
    if source.revision != revision {
        return;
    }
    let mut status = state.status.lock().unwrap();
    status.state = kind.into();
    status.message = message.into();
    status.process_id = target.map(|t| t.pid);
    status.source_name = target.map(|t| t.name.clone());
}
fn silence(app: &AppHandle) {
    let _ = app.emit("spectrum", vec![0.0f32; BANDS]);
    let _ = app.emit("music-analysis", MusicAnalysis::default());
}
fn capture(
    app: &AppHandle,
    state: &AppState,
    revision: u64,
    mut targets: Vec<Target>,
    source: Source,
) -> Result<(), String> {
    let included: Vec<_> = targets
        .iter()
        .filter(|t| match &source {
            Source::Auto => true,
            Source::Player { id } => t.player_id.as_ref() == Some(id),
            _ => false,
        })
        .map(|t| t.pid)
        .collect();
    if included.is_empty() {
        return Ok(());
    }
    let ids = included
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let mut child = ManagedChild(
        macos_helper::command()?
            .args(["capture", &ids])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?,
    );
    let mut stdout = child.0.stdout.take().unwrap();
    let stderr = child.0.stderr.take().unwrap();
    let (sender, receiver) = mpsc::sync_channel(16);
    thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            loop {
                let mut header = [0u8; 8];
                stdout.read_exact(&mut header).map_err(|e| e.to_string())?;
                let pid = u32::from_le_bytes(header[..4].try_into().unwrap());
                let len = u32::from_le_bytes(header[4..].try_into().unwrap()) as usize;
                if len == 0 || len > 384_000 || len % 8 != 0 {
                    return Err("原生音频数据格式无效".into());
                }
                let mut bytes = vec![0; len];
                stdout.read_exact(&mut bytes).map_err(|e| e.to_string())?;
                if sender.send(Ok((pid, bytes))).is_err() {
                    return Ok(());
                }
            }
        })();
        if let Err(error) = result {
            let _ = sender.send(Err(error));
        }
    });
    let error = thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.take(4096).read_to_string(&mut text);
        text
    });
    let mut selector = Selector::default();
    let mut selected = None;
    let mut analyzer = Analyzer::new();
    let mut peaks = HashMap::<u32, (bool, Instant)>::new();
    let mut refresh = Instant::now();
    let mut last_packet = Instant::now();
    let mut faded = false;
    let mut last_selection = Instant::now() - Duration::from_secs(1);
    loop {
        if state.shutdown.load(Ordering::Relaxed)
            || state.audio_source.lock().unwrap().revision != revision
        {
            return Ok(());
        }
        if refresh.elapsed() > Duration::from_secs(2) {
            let current = audio_discovery::scan()?;
            if current.targets.iter().map(|t| t.pid).collect::<Vec<_>>()
                != targets.iter().map(|t| t.pid).collect::<Vec<_>>()
            {
                return Ok(());
            }
            refresh = Instant::now();
        }
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok((pid, bytes))) => {
                let power = bytes
                    .chunks_exact(4)
                    .map(|sample| f32::from_le_bytes(sample.try_into().unwrap()))
                    .filter(|s| s.is_finite())
                    .map(|s| s * s)
                    .sum::<f32>()
                    / (bytes.len() / 4).max(1) as f32;
                peaks.insert(pid, (power.sqrt() > 0.001, Instant::now()));
                if last_selection.elapsed() >= Duration::from_millis(100) {
                    for target in &mut targets {
                        target.audible = peaks.get(&target.pid).is_some_and(|(audible, seen)| {
                            *audible && seen.elapsed() < Duration::from_millis(350)
                        });
                    }
                    state.audio_discovery.lock().unwrap().targets = targets.clone();
                    let next = selector.choose(&source, &targets);
                    if selected != next.as_ref().map(|t| t.pid) {
                        analyzer = Analyzer::new();
                        silence(app);
                    }
                    selected = next.as_ref().map(|t| t.pid);
                    last_selection = Instant::now();
                }
                if selected != Some(pid) {
                    continue;
                }
                last_packet = Instant::now();
                faded = false;
                if let Some(bands) = analyzer.push_stereo(&bytes) {
                    let guard = state.audio_source.lock().unwrap();
                    if guard.revision != revision {
                        return Ok(());
                    }
                    let _ = app.emit("spectrum", bands);
                    let _ = app.emit("music-analysis", analyzer.music_analysis());
                    drop(guard);
                    let target = targets.iter().find(|t| t.pid == pid);
                    let audible = analyzer.music_analysis().rms > 0.001;
                    status(
                        state,
                        revision,
                        if audible { "listening" } else { "silent" },
                        if audible {
                            "正在捕获播放器音频"
                        } else {
                            "播放器已连接，等待音乐"
                        },
                        target,
                    );
                }
            }
            Ok(Err(_)) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = child.0.kill();
                let _ = child.0.wait();
                let text = error.join().unwrap_or_default();
                return Err(if text.is_empty() {
                    "音频连接已断开".into()
                } else {
                    text
                });
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if last_packet.elapsed() > Duration::from_millis(350) && !faded {
            silence(app);
            faded = true;
            status(
                state,
                revision,
                "silent",
                "播放器已连接，等待音乐",
                targets.iter().find(|t| Some(t.pid) == selected),
            );
        }
    }
}
pub fn start(app: AppHandle, state: Arc<AppState>) {
    thread::spawn(move || {
        while !state.shutdown.load(Ordering::Relaxed) {
            let selected = state.audio_source.lock().unwrap().clone();
            let result = (|| {
                if let Some(error) = selected.error {
                    return Err(error);
                }
                let found = audio_discovery::scan()?;
                *state.audio_discovery.lock().unwrap() = found.clone();
                status(
                    &state,
                    selected.revision,
                    "waiting",
                    "请打开音乐播放器；首次使用请允许屏幕与系统音频录制",
                    None,
                );
                capture(
                    &app,
                    &state,
                    selected.revision,
                    found.targets,
                    selected.selection,
                )
            })();
            silence(&app);
            if let Err(error) = result {
                status(&state, selected.revision, "error", &error, None);
            }
            for _ in 0..20 {
                if state.shutdown.load(Ordering::Relaxed)
                    || state.audio_source.lock().unwrap().revision != selected.revision
                {
                    break;
                }
                thread::sleep(Duration::from_millis(100));
            }
        }
    });
}
