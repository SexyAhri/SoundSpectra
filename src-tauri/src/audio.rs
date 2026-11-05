use crate::{
    audio_discovery,
    audio_source::{Selector, SourceState, Target},
    dsp::{Analyzer, BANDS},
    AppState,
};
use std::{
    collections::VecDeque,
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat};

fn source(state: &AppState) -> Result<SourceState, String> {
    state
        .audio_source
        .lock()
        .map(|source| source.clone())
        .map_err(|e| e.to_string())
}
fn status(state: &AppState, kind: &str, message: &str, target: Option<&Target>, revision: u64) {
    // An old stream must not overwrite a newer source selection's status.
    let Ok(source) = state.audio_source.lock() else {
        return;
    };
    if source.revision != revision {
        return;
    }
    if let Ok(mut current) = state.status.lock() {
        current.state = kind.into();
        current.message = message.into();
        current.process_id = target.map(|target| target.pid);
        current.source_name = target.map(|target| target.name.clone());
    }
}
fn discover(state: &AppState) -> Result<Vec<Target>, String> {
    match audio_discovery::scan() {
        Ok(snapshot) => {
            let targets = snapshot.targets.clone();
            *state.audio_discovery.lock().map_err(|e| e.to_string())? = snapshot;
            Ok(targets)
        }
        Err(error) => {
            if let Ok(mut snapshot) = state.audio_discovery.lock() {
                snapshot.targets.clear();
                snapshot.warning = Some(error.clone());
            }
            Err(error)
        }
    }
}
fn emit_bands(app: &AppHandle, state: &AppState, revision: u64, bands: &[f32]) {
    if let Ok(source) = state.audio_source.lock() {
        if source.revision == revision {
            let _ = app.emit("spectrum", bands);
        }
    }
}

fn capture(
    app: &AppHandle,
    state: &AppState,
    target: &Target,
    revision: u64,
    selector: &mut Selector,
) -> Result<(), String> {
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
    let mut client = AudioClient::new_application_loopback_client(target.pid, true)
        .map_err(|e| e.to_string())?;
    client
        .initialize_client(
            &format,
            &Direction::Capture,
            &StreamMode::EventsShared {
                autoconvert: true,
                buffer_duration_hns: 0,
            },
        )
        .map_err(|e| e.to_string())?;
    let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
    let capture = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
    let mut bytes = VecDeque::with_capacity(64 * 1024);
    let mut analyzer = Analyzer::new();
    client.start_stream().map_err(|e| e.to_string())?;
    let result = (|| {
        let mut last_process_check = Instant::now();
        let mut last_packet = Instant::now();
        let mut last_silence = Instant::now();
        status(
            state,
            "silent",
            &format!("已连接 {}，等待播放", target.name),
            Some(target),
            revision,
        );
        while !state.shutdown.load(Ordering::Relaxed) {
            let selected = source(state)?;
            if selected.revision != revision || selected.error.is_some() {
                break;
            }
            if last_process_check.elapsed() >= Duration::from_secs(1) {
                let targets = discover(state)?;
                let next = selector.choose(&selected.selection, &targets);
                if !next.is_some_and(|next| {
                    next.pid == target.pid && next.executable == target.executable
                }) {
                    break;
                }
                last_process_check = Instant::now();
            }
            // A silent app is normal. Timeout is not a broken audio device.
            let _ = event.wait_for_event(100);
            loop {
                if state.shutdown.load(Ordering::Relaxed) || source(state)?.revision != revision {
                    break;
                }
                let frames = capture
                    .get_next_packet_size()
                    .map_err(|e| e.to_string())?
                    .unwrap_or(0) as usize;
                if frames == 0 {
                    break;
                }
                bytes.reserve(frames * 8);
                capture
                    .read_from_device_to_deque(&mut bytes)
                    .map_err(|e| e.to_string())?;
                let samples: Vec<u8> = bytes.drain(..).collect();
                if let Some(bands) = analyzer.push_stereo(&samples) {
                    let active = bands.iter().any(|v| *v > 0.015);
                    status(
                        state,
                        if active { "listening" } else { "silent" },
                        &format!(
                            "{}{}",
                            target.name,
                            if active {
                                " · 正在采集专属音频"
                            } else {
                                " · 当前没有声音"
                            }
                        ),
                        Some(target),
                        revision,
                    );
                    emit_bands(app, state, revision, &bands);
                    if let Ok(source) = state.audio_source.lock() {
                        if source.revision == revision {
                            let _ = app.emit("music-analysis", analyzer.music_analysis());
                        }
                    }
                }
                last_packet = Instant::now();
            }
            if last_packet.elapsed() > Duration::from_millis(500)
                && last_silence.elapsed() > Duration::from_millis(250)
            {
                status(
                    state,
                    "silent",
                    &format!("{} · 当前没有声音", target.name),
                    Some(target),
                    revision,
                );
                emit_bands(app, state, revision, &[0.0; BANDS]);
                last_silence = Instant::now();
            }
        }
        Ok::<(), String>(())
    })();
    let _ = client.stop_stream();
    emit_bands(app, state, revision, &[0.0; BANDS]);
    result
}

fn wait_for_retry(state: &AppState, revision: u64) {
    for _ in 0..10 {
        if state.shutdown.load(Ordering::Relaxed)
            || source(state).is_ok_and(|source| source.revision != revision)
        {
            break;
        }
        thread::sleep(Duration::from_millis(100));
    }
}

pub fn start(app: AppHandle, state: Arc<AppState>) {
    thread::spawn(move || {
        if let Err(error) = wasapi::initialize_mta().ok() {
            status(
                &state,
                "error",
                &format!("音频初始化失败：{error}"),
                None,
                0,
            );
            return;
        }
        let mut selector = Selector::default();
        let mut last_revision = None;
        while !state.shutdown.load(Ordering::Relaxed) {
            let Ok(selected) = source(&state) else { break };
            let revision = selected.revision;
            if last_revision != Some(revision) {
                selector = Selector::default();
                last_revision = Some(revision);
            }
            if let Some(error) = selected.error {
                status(&state, "error", &error, None, revision);
                wait_for_retry(&state, revision);
                continue;
            }
            match discover(&state) {
                Ok(targets) => {
                    if let Some(target) = selector.choose(&selected.selection, &targets) {
                        status(
                            &state,
                            "connecting",
                            &format!("正在连接 {}…", target.name),
                            Some(&target),
                            revision,
                        );
                        match capture(&app, &state, &target, revision, &mut selector) {
                            Ok(()) => continue,
                            Err(error) => {
                                status(
                                    &state,
                                    "error",
                                    &format!("{} 捕获失败：{error}；稍后自动重试", target.name),
                                    Some(&target),
                                    revision,
                                );
                                emit_bands(&app, &state, revision, &[0.0; BANDS]);
                            }
                        }
                    } else {
                        status(
                            &state,
                            "waiting",
                            &format!("请打开 {} 并播放音乐", selected.selection.name()),
                            None,
                            revision,
                        );
                        emit_bands(&app, &state, revision, &[0.0; BANDS]);
                    }
                }
                Err(error) => {
                    status(&state, "error", &error, None, revision);
                    emit_bands(&app, &state, revision, &[0.0; BANDS]);
                }
            }
            wait_for_retry(&state, revision);
        }
        wasapi::deinitialize();
    });
}
