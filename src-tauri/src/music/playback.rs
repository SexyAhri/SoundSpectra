use super::{
    model::{Audio, AudioQuality, AudioRequest, Track},
    queue::{Order, PlayMode},
    MusicState,
};
use crate::{card_controls::MediaCapabilities, now_playing_state::NowPlaying, AppState};
use serde::{Deserialize, Serialize};
use std::{
    ops::RangeInclusive,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
use tauri::{
    http::{Request, Response},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub generation: u64,
    pub revision: u64,
    pub seek_revision: u64,
    pub queue: Vec<Track>,
    pub entry_ids: Vec<String>,
    pub queue_revision: u64,
    pub queue_unchanged: bool,
    pub lyric_offset: f64,
    pub global_lyric_offset: f64,
    pub gain: f64,
    pub sleep_at: Option<u64>,
    pub sleep_after_track: bool,
    pub failure: Option<super::diagnostics::Failure>,
    pub index: usize,
    pub phase: String,
    pub playing: bool,
    pub position: f64,
    pub duration: f64,
    pub volume: f64,
    pub error: Option<String>,
    pub quality: Option<AudioQuality>,
    pub mode: PlayMode,
    pub muted: bool,
    pub can_previous: bool,
    pub can_next: bool,
    pub suspended: bool,
    pub load_stage: String,
    pub transfer: Option<super::stream::Transfer>,
    pub buffered: Vec<[f64; 2]>,
    pub seeking: bool,
}
pub struct Playback {
    pub view: View,
    pub audio: Option<Arc<Audio>>,
    pub cover: Option<String>,
    pub lyrics: Option<crate::lyrics::LyricDocument>,
    pub reported: Instant,
    order: Order,
    restore_volume: f64,
    cache_reported: Option<Instant>,
    cancelled: Arc<AtomicBool>,
    persisted: Instant,
    stream_retries: u8,
    prefetch_key: Option<(u64, u64)>,
    prefetch_cancel: Arc<AtomicBool>,
    auto_skips: u8,
    automatic: bool,
    normalization_pending: bool,
}
impl Default for Playback {
    fn default() -> Self {
        Self {
            view: View {
                volume: 0.7,
                gain: 1.0,
                phase: "idle".into(),
                ..View::default()
            },
            audio: None,
            cover: None,
            lyrics: None,
            reported: Instant::now(),
            order: Order::default(),
            restore_volume: 0.7,
            cache_reported: None,
            cancelled: Arc::new(AtomicBool::new(false)),
            persisted: Instant::now(),
            stream_retries: 0,
            prefetch_key: None,
            prefetch_cancel: Arc::new(AtomicBool::new(false)),
            auto_skips: 0,
            automatic: false,
            normalization_pending: false,
        }
    }
}
impl Playback {
    pub fn restore_scene(&mut self, restored: Option<View>) {
        let counters = (
            self.view.generation + 1,
            self.view.revision + 1,
            self.view.queue_revision + 1,
        );
        *self = Self::default();
        if let Some(view) = restored {
            self.view = view;
        }
        self.view.generation = counters.0;
        self.view.revision = counters.1;
        self.view.queue_revision = counters.2;
        if self.view.entry_ids.len() != self.view.queue.len() {
            self.view.entry_ids = self
                .view
                .queue
                .iter()
                .enumerate()
                .map(|(i, _)| format!("restore-{}-{i}", counters.0))
                .collect();
        }
        self.view.playing = false;
        self.refresh_controls();
    }
    fn prepare(
        &mut self,
        queue: Option<Vec<Track>>,
        index: usize,
        position: f64,
        playing: bool,
    ) -> Result<(u64, Track, Arc<AtomicBool>), String> {
        let track = queue
            .as_ref()
            .unwrap_or(&self.view.queue)
            .get(index)
            .ok_or("播放队列为空")?
            .clone();
        if let Some(queue) = queue {
            self.view.entry_ids = queue
                .iter()
                .enumerate()
                .map(|(i, _)| format!("{}-{}-{i}", super::now(), self.view.generation + 1))
                .collect();
            self.view.queue_revision += 1;
            self.view.queue = queue;
            self.order = Order::default();
        }
        self.invalidate_prefetch();
        self.view.index = index;
        self.view.generation += 1;
        self.view.revision += 1;
        self.view.phase = "loading".into();
        self.view.load_stage = "authorizing".into();
        self.view.buffered.clear();
        self.view.seeking = false;
        self.cancelled.store(true, Ordering::Release);
        self.cancelled = Arc::new(AtomicBool::new(false));
        self.view.suspended = false;
        self.view.position = position;
        self.view.seek_revision += 1;
        self.view.duration = track.duration;
        self.view.playing = playing;
        self.view.failure = None;
        self.view.error = None;
        self.view.quality = None;
        self.audio = None;
        self.normalization_pending = false;
        self.view.gain = 1.0;
        self.cover = None;
        self.lyrics = None;
        self.cache_reported = None;
        self.refresh_controls();
        Ok((self.view.generation, track, self.cancelled.clone()))
    }
    fn commit_audio(&mut self, generation: u64, audio: Audio) -> bool {
        if self.view.generation != generation {
            return false;
        }
        self.view.quality = Some(audio.quality.clone());
        self.audio = Some(Arc::new(audio));
        self.view.phase = "ready".into();
        self.view.load_stage.clear();
        self.view.revision += 1;
        true
    }
    pub fn order_reset(&mut self) {
        self.order = Order::default();
        self.invalidate_prefetch();
    }
    fn invalidate_prefetch(&mut self) {
        self.prefetch_cancel.store(true, Ordering::Release);
        self.prefetch_cancel = Arc::new(AtomicBool::new(false));
        self.prefetch_key = None;
    }
    pub fn snapshot(&self, queue_revision: Option<u64>) -> View {
        let unchanged = queue_revision == Some(self.view.queue_revision);
        let mut view = View {
            generation: self.view.generation.clone(),
            revision: self.view.revision.clone(),
            seek_revision: self.view.seek_revision.clone(),
            queue: if unchanged {
                Vec::new()
            } else {
                self.view.queue.clone()
            },
            entry_ids: if unchanged {
                Vec::new()
            } else {
                self.view.entry_ids.clone()
            },
            queue_revision: self.view.queue_revision.clone(),
            queue_unchanged: unchanged,
            lyric_offset: self.view.lyric_offset.clone(),
            global_lyric_offset: self.view.global_lyric_offset.clone(),
            gain: self.view.gain.clone(),
            sleep_at: self.view.sleep_at.clone(),
            sleep_after_track: self.view.sleep_after_track.clone(),
            failure: self.view.failure.clone(),
            index: self.view.index.clone(),
            phase: self.view.phase.clone(),
            playing: self.view.playing.clone(),
            position: self.view.position.clone(),
            duration: self.view.duration.clone(),
            volume: self.view.volume.clone(),
            error: self.view.error.clone(),
            quality: self.view.quality.clone(),
            mode: self.view.mode.clone(),
            muted: self.view.muted.clone(),
            can_previous: self.view.can_previous.clone(),
            can_next: self.view.can_next.clone(),
            suspended: self.view.suspended.clone(),
            load_stage: self.view.load_stage.clone(),
            transfer: self.view.transfer.clone(),
            buffered: self.view.buffered.clone(),
            seeking: self.view.seeking.clone(),
        };
        view.transfer = self.audio.as_ref().map(|a| {
            a.stream.as_ref().map_or_else(
                || super::stream::Transfer {
                    received: a.bytes.len(),
                    total: a.bytes.len(),
                    status: "cached",
                },
                |s| s.progress(),
            )
        });
        view
    }
    pub fn refresh_controls(&mut self) {
        let v = &mut self.view;
        v.can_previous = self.order.can_previous(v.mode, v.queue.len(), v.index);
        v.can_next = Order::can_next(v.mode, v.queue.len(), v.index);
    }
    fn restart(&mut self) {
        self.view.position = 0.0;
        self.view.seek_revision += 1;
        self.view.revision += 1;
        self.view.playing = true;
        self.reported = Instant::now();
    }
}
impl Drop for Playback {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        self.prefetch_cancel.store(true, Ordering::Release);
    }
}

pub fn active(state: &AppState) -> bool {
    let p = state.music.playback.lock().unwrap();
    !p.view.queue.is_empty() && !p.view.suspended
}
pub fn capture_target(state: &AppState) -> Option<crate::audio_source::Target> {
    if !active(state) {
        return None;
    }
    #[cfg(windows)]
    if let Some(target) = crate::audio_discovery::builtin_target() {
        return Some(target);
    }
    Some(crate::audio_source::Target {
        pid: std::process::id(),
        executable: "soundspectra.exe".into(),
        name: "SoundSpectra · 内置播放".into(),
        player_id: Some("soundspectra".into()),
        audible: true,
    })
}
fn source_changed(app: &AppHandle, state: &AppState) {
    state.audio_source.lock().unwrap().revision += 1;
    crate::lyrics::cancel_search(state);
    let _ = app.emit("spectrum", vec![0.0_f32; crate::dsp::BANDS]);
}
pub fn snapshot(state: &MusicState) -> Option<NowPlaying> {
    let p = state.playback.lock().unwrap();
    let v = &p.view;
    if v.suspended {
        return None;
    }
    let t = v.queue.get(v.index)?;
    let fresh = p.reported.elapsed().as_secs_f64() < 3.0;
    Some(NowPlaying {
        title: t.title.clone(),
        artist: t.artist.clone(),
        album: t.album.clone(),
        cover: p.cover.clone(),
        position: (v.position
            + if v.playing && fresh && v.phase == "playing" {
                p.reported.elapsed().as_secs_f64()
            } else {
                0.0
            })
        .min(v.duration),
        duration: v.duration,
        timeline_available: fresh && v.duration > 0.0 && p.audio.is_some() && v.phase != "error",
        playing: v.playing && fresh && v.phase == "playing",
        source: format!(
            "SoundSpectra · {}",
            state.provider().map_or("音乐库", |p| p.name())
        ),
        process_id: Some(std::process::id()),
        updated: super::now(),
        issue: v.error.clone(),
        track_id: format!("music:{}:{}", v.generation, t.id),
        playback_available: p.audio.is_some(),
        session_id: "soundspectra-music".into(),
        controls: MediaCapabilities {
            previous: v.can_previous,
            next: v.can_next,
            play: p.audio.is_some(),
            pause: p.audio.is_some(),
        },
        ..NowPlaying::default()
    })
}

pub fn ensure_player(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("music-player").is_none() {
        let builder = WebviewWindowBuilder::new(
            app,
            "music-player",
            WebviewUrl::App("index.html?window=music-player".into()),
        )
        .title("SoundSpectra 音频引擎")
        .inner_size(300.0, 160.0)
        .visible(false)
        .skip_taskbar(true)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled);
        builder
            .build()
            .map_err(|error| format!("无法启动内置播放器：{error}"))?;
    }
    Ok(())
}

fn wait_cancelled(cancelled: &AtomicBool, ticks: u64) -> bool {
    for _ in 0..ticks {
        if cancelled.load(Ordering::Acquire) {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    !cancelled.load(Ordering::Acquire)
}

pub fn load(
    app: &AppHandle,
    state: &Arc<AppState>,
    queue: Option<Vec<Track>>,
    index: usize,
) -> Result<(), String> {
    load_variant(app, state, queue, index, None, false, false, None)
}

fn load_variant(
    app: &AppHandle,
    state: &Arc<AppState>,
    queue: Option<Vec<Track>>,
    index: usize,
    fallback: Option<(u64, u64, String)>,
    resume: bool,
    automatic: bool,
    expected: Option<(u64, u64)>,
) -> Result<(), String> {
    ensure_player(app)?;
    let provider = state.music.provider()?;
    let was_active = active(state);
    let (generation, track, cancelled) = {
        let _gate = state.music.session_gate.lock().unwrap();
        state.music.same_provider(&provider)?;
        let mut p = state.music.playback.lock().unwrap();
        if expected.is_some_and(|(g, r)| g != p.view.generation || r != p.view.revision) {
            return Ok(());
        }
        if fallback
            .as_ref()
            .is_some_and(|(g, r, _)| *g != p.view.generation || *r != p.view.revision)
        {
            return Ok(());
        }
        if !automatic {
            p.auto_skips = 0;
            if fallback.is_none() && !resume {
                p.stream_retries = 0;
            }
        }
        if fallback.is_none() && !resume {
            p.automatic = automatic;
        }
        let (position, playing) = if resume {
            (p.view.position, true)
        } else if fallback.is_some() {
            (p.view.position, p.view.playing)
        } else {
            (0.0, true)
        };
        let (generation, track, cancelled) = p.prepare(queue, index, position, playing)?;
        p.view.lyric_offset = state
            .music
            .store
            .offset(
                &provider.scope(),
                &format!("{}:{}", track.provider, track.id),
                None,
            )
            .unwrap_or(0.0);
        (generation, track, cancelled)
    };
    state.music.cache.active(Some(&track));
    if !was_active {
        source_changed(app, state);
    }
    let _ = app.emit_to("music-player", "music-player-wake", ());
    // Lyrics are independent from the audio download. A cached lyric can be
    // displayed immediately while a large master file is still loading.
    let music = state.music.clone();
    let metadata_provider = provider.clone();
    let metadata_track = track.clone();
    std::thread::spawn(move || {
        let document = music.cache.lyrics(&metadata_track, false, || {
            metadata_provider.lyrics(&metadata_track)
        });
        {
            let mut p = music.playback.lock().unwrap();
            if p.view.generation != generation {
                return;
            }
            p.lyrics = Some(document);
        }
        let cover = metadata_track.cover.as_deref().and_then(|url| {
            music
                .artwork
                .load(url, false, || metadata_provider.artwork(url))
        });
        let mut p = music.playback.lock().unwrap();
        if p.view.generation == generation {
            p.cover = cover;
        }
    });
    let app = app.clone();
    let state = state.clone();
    std::thread::spawn(move || {
        let music = state.music.clone();
        music.diagnostics.record("load", generation, None);
        let mut attempt = 0;
        let audio = loop {
            if cancelled.load(Ordering::Acquire) {
                return;
            }
            let result = provider.audio(
                &track,
                fallback.as_ref().map(|(_, _, id)| id.as_str()),
                AudioRequest {
                    prefetch: false,
                    cancelled: cancelled.clone(),
                    buffering: Box::new({
                        let music = music.clone();
                        move || {
                            let mut p = music.playback.lock().unwrap();
                            if p.view.generation == generation {
                                p.view.load_stage = "buffering".into();
                            }
                        }
                    }),
                },
            );
            if let Err(message) = &result {
                let failure = super::diagnostics::Failure::classify(message);
                music
                    .diagnostics
                    .record("request", generation, Some(failure.kind));
                if failure.kind == "network" && attempt < 2 {
                    let ticks = if attempt == 0 { 10 } else { 30 };
                    attempt += 1;
                    if !wait_cancelled(&cancelled, ticks) {
                        return;
                    }
                    continue;
                }
            }
            break result;
        };
        let mut p = state.music.playback.lock().unwrap();
        if p.view.generation != generation {
            return;
        }
        match audio {
            Ok(audio) => {
                let normalize = music
                    .store
                    .value::<super::store::Preferences>(&provider.scope(), "preferences")
                    .ok()
                    .flatten()
                    .is_some_and(|s| s.normalize);
                p.normalization_pending = normalize && audio.stream.is_some();
                p.view.gain = if normalize {
                    music.cache.gain(&track, &audio)
                } else {
                    1.0
                };
                p.commit_audio(generation, audio);
            }
            Err(message) => {
                p.view.phase = "error".into();
                let failure = super::diagnostics::Failure::classify(&message);
                if automatic
                    && ["unavailable", "decode"].contains(&failure.kind)
                    && p.auto_skips < 3
                {
                    let (mode, len, index) = (p.view.mode, p.view.queue.len(), p.view.index);
                    if let Some(next) = p.order.next(mode, len, index, false) {
                        p.auto_skips += 1;
                        let expected = (p.view.generation, p.view.revision);
                        drop(p);
                        let _ = load_variant(
                            &app,
                            &state,
                            None,
                            next,
                            None,
                            false,
                            true,
                            Some(expected),
                        );
                        return;
                    }
                }
                p.view.playing = false;
                p.view.failure = Some(failure);
                p.view.error = Some(message);
                drop(p);
                music.persist();
                let _ = app.emit_to("music-player", "music-player-wake", ());
                return;
            }
        }
        drop(p);
        music.persist();
        let _ = app.emit_to("music-player", "music-player-wake", ());
    });
    Ok(())
}

pub fn control(
    app: &AppHandle,
    state: &Arc<AppState>,
    action: &str,
    value: Option<f64>,
) -> Result<(), String> {
    if action == "recover" {
        let index = state.music.playback.lock().unwrap().view.index;
        return load_variant(app, state, None, index, None, true, false, None);
    }
    if action == "play" && state.music.playback.lock().unwrap().view.suspended {
        let index = state.music.playback.lock().unwrap().view.index;
        return load_variant(app, state, None, index, None, true, false, None);
    }
    if action == "play" && state.music.playback.lock().unwrap().view.phase == "error" {
        let index = state.music.playback.lock().unwrap().view.index;
        return load(app, state, None, index);
    }
    if action == "stop" {
        let mut p = state.music.playback.lock().unwrap();
        p.cancelled.store(true, Ordering::Release);
        p.invalidate_prefetch();
        if let Ok(provider) = state.music.provider() {
            provider.discard_prefetch();
        }
        p.view.generation += 1;
        p.view.revision += 1;
        p.view.playing = false;
        p.view.suspended = !p.view.queue.is_empty();
        p.view.phase = if p.view.suspended {
            "suspended"
        } else {
            "idle"
        }
        .into();
        p.audio = None;
        p.view.buffered.clear();
        p.view.seeking = false;
        drop(p);
        state.music.cache.active(None);
        source_changed(app, state);
    } else if action == "clear" {
        let mut p = state.music.playback.lock().unwrap();
        let generation = p.view.generation + 1;
        let queue_revision = p.view.queue_revision + 1;
        let (volume, muted, mode, restore) =
            (p.view.volume, p.view.muted, p.view.mode, p.restore_volume);
        p.cancelled.store(true, Ordering::Release);
        p.invalidate_prefetch();
        if let Ok(provider) = state.music.provider() {
            provider.discard_prefetch();
        }
        *p = Playback::default();
        p.view.generation = generation;
        p.view.queue_revision = queue_revision;
        p.view.volume = volume;
        p.view.muted = muted;
        p.view.mode = mode;
        p.restore_volume = restore;
        drop(p);
        state.music.cache.active(None);
        source_changed(app, state);
    } else if action == "queue-jump" {
        let mut p = state.music.playback.lock().unwrap();
        let index = value
            .filter(|n| n.is_finite() && *n >= 0.0 && n.fract() == 0.0)
            .map(|n| n as usize)
            .filter(|n| *n < p.view.queue.len())
            .ok_or("队列位置无效")?;
        if index == p.view.index && p.audio.is_some() {
            drop(p);
            return control(app, state, "play", None);
        }
        p.order = Order::default();
        drop(p);
        return load(app, state, None, index);
    } else if action == "next" || action == "previous" || action == "retry" {
        let mut p = state.music.playback.lock().unwrap();
        let (mode, len, current) = (p.view.mode, p.view.queue.len(), p.view.index);
        let index = if action == "next" {
            p.order
                .next(mode, len, current, false)
                .ok_or("已经是最后一首")?
        } else if action == "retry" {
            p.view.index
        } else {
            p.order.previous(mode, len, current).ok_or("已经是第一首")?
        };
        if index >= p.view.queue.len() {
            return Err("已经是最后一首".into());
        }
        if index == current && action != "retry" && p.audio.is_some() {
            p.restart();
            p.refresh_controls();
            drop(p);
            let _ = app.emit_to("music-player", "music-player-wake", ());
            return Ok(());
        }
        drop(p);
        return load(app, state, None, index);
    } else {
        let mut p = state.music.playback.lock().unwrap();
        if !matches!(
            action,
            "volume" | "mute" | "mode" | "pause" | "play" | "sleep" | "sleep-track"
        ) && p.audio.is_none()
        {
            return Err("请先选择一首可播放的歌曲".into());
        }
        match action {
            "play" => {
                if p.view.duration > 0.0 && p.view.position >= p.view.duration - 0.05 {
                    p.restart();
                }
                p.view.playing = true;
            }
            "pause" => p.view.playing = false,
            "seek" => {
                let value = value.filter(|v| v.is_finite()).ok_or("进度无效")?;
                p.view.position = value.clamp(0.0, p.view.duration);
                p.view.seek_revision += 1;
                p.reported = Instant::now();
            }
            "volume" => {
                p.view.volume = value
                    .filter(|v| v.is_finite())
                    .ok_or("音量无效")?
                    .clamp(0.0, 1.0);
                p.view.muted = false;
                if p.view.volume > 0.0 {
                    p.restore_volume = p.view.volume;
                }
            }
            "mute" => {
                if p.view.muted || p.view.volume == 0.0 {
                    p.view.muted = false;
                    if p.view.volume == 0.0 {
                        p.view.volume = p.restore_volume;
                    }
                } else {
                    p.view.muted = true;
                }
            }
            "sleep" => {
                let seconds = value
                    .filter(|v| v.is_finite() && *v >= 0.0 && *v <= 86400.0)
                    .ok_or("定时范围为 0 至 24 小时")?;
                p.view.sleep_at = (seconds > 0.0).then(|| super::now() + (seconds * 1000.0) as u64);
                p.view.sleep_after_track = false;
            }
            "sleep-track" => {
                p.view.sleep_after_track = !p.view.sleep_after_track;
                p.view.sleep_at = None;
            }
            "mode" => {
                p.view.mode = p.view.mode.cycle();
                p.order = Order::default();
                p.invalidate_prefetch();
                if let Ok(provider) = state.music.provider() {
                    provider.discard_prefetch();
                }
            }
            _ => return Err("未知播放操作".into()),
        }
        p.view.revision += 1;
        p.refresh_controls();
    }
    state.music.diagnostics.record(
        match action {
            "play" => "play",
            "pause" => "pause",
            "stop" => "stop",
            "clear" => "clear",
            "seek" => "seek",
            _ => "control",
        },
        state.music.playback.lock().unwrap().view.generation,
        None,
    );
    state.music.persist();
    let _ = app.emit_to("music-player", "music-player-wake", ());
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Feedback {
    pub generation: u64,
    pub revision: u64,
    pub position: f64,
    pub duration: f64,
    pub playing: bool,
    pub ended: bool,
    pub error: bool,
    #[serde(default)]
    pub error_kind: String,
    #[serde(default)]
    pub buffering: bool,
    #[serde(default)]
    pub buffered: Vec<[f64; 2]>,
    #[serde(default)]
    pub seeking: bool,
}

fn playable_ranges(ranges: Vec<[f64; 2]>, duration: f64) -> Vec<[f64; 2]> {
    if !duration.is_finite() || duration <= 0.0 {
        return Vec::new();
    }
    let mut valid: Vec<_> = ranges
        .into_iter()
        .take(64)
        .filter(|[a, b]| a.is_finite() && b.is_finite() && b > a)
        .map(|[a, b]| [a.clamp(0.0, duration), b.clamp(0.0, duration)])
        .filter(|[a, b]| b > a)
        .collect();
    valid.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap());
    let mut merged: Vec<[f64; 2]> = Vec::new();
    for [start, end] in valid {
        if let Some(last) = merged.last_mut().filter(|last| start <= last[1]) {
            last[1] = last[1].max(end);
        } else {
            merged.push([start, end]);
        }
    }
    merged
}
pub fn feedback(app: &AppHandle, state: &Arc<AppState>, f: Feedback) -> Result<(), String> {
    let mut p = state.music.playback.lock().unwrap();
    if f.generation != p.view.generation
        || f.revision != p.view.revision
        || p.audio.is_none()
        || p.view.suspended
    {
        return Ok(());
    }
    if f.playing
        && p.cache_reported
            .is_none_or(|last| last.elapsed().as_secs() >= 60)
    {
        if let Some(track) = p.view.queue.get(p.view.index) {
            state.music.cache.played(track);
            if let Ok(provider) = state.music.provider() {
                let _ = state.music.store.played(&provider.scope(), track);
            }
        }
        p.cache_reported = Some(Instant::now());
        p.auto_skips = 0;
    }
    if f.position.is_finite() && f.position >= 0.0 {
        p.view.position = f.position;
    }
    if f.duration.is_finite() && f.duration > 0.0 {
        p.view.duration = f.duration;
    }
    if f.playing
        && p.cache_reported
            .is_some_and(|last| last.elapsed().as_secs() >= 5)
    {
        p.stream_retries = 0;
    }
    p.view.buffered = playable_ranges(f.buffered, p.view.duration);
    p.view.seeking = f.seeking;
    p.reported = Instant::now();
    let complete = p.audio.as_ref().is_some_and(|a| {
        a.stream
            .as_ref()
            .is_none_or(|s| s.progress().status == "complete")
    });
    if complete && p.normalization_pending {
        if let (Some(track), Some(audio)) = (p.view.queue.get(p.view.index), p.audio.as_ref()) {
            p.view.gain = state.music.cache.gain(track, audio);
        }
        p.normalization_pending = false;
    }
    let key = (p.view.generation, p.view.queue_revision);
    if complete && p.prefetch_key != Some(key) {
        let (mode, len, index) = (p.view.mode, p.view.queue.len(), p.view.index);
        p.prefetch_key = Some(key);
        if let Some(next) = p.order.peek(mode, len, index).filter(|n| *n != index) {
            let track = p.view.queue[next].clone();
            let cancelled = p.prefetch_cancel.clone();
            if let Ok(provider) = state.music.provider() {
                std::thread::spawn(move || {
                    let _ = provider.audio(
                        &track,
                        None,
                        AudioRequest {
                            prefetch: true,
                            cancelled,
                            buffering: Box::new(|| {}),
                        },
                    );
                });
            }
        }
    }
    let persist = p.persisted.elapsed().as_secs() >= 5 && f.playing;
    if persist {
        p.persisted = Instant::now();
    }
    if p.view.sleep_at.is_some_and(|at| super::now() >= at) {
        p.view.sleep_at = None;
        p.view.playing = false;
        p.view.phase = "paused".into();
        p.view.revision += 1;
        drop(p);
        state.music.persist();
        let _ = app.emit_to("music-player", "music-player-wake", ());
        return Ok(());
    }
    if f.error && f.error_kind == "network" {
        if p.stream_retries >= 2 {
            p.view.playing = false;
            p.view.phase = "error".into();
            p.view.error = Some("网络传输失败，已停止自动重试".into());
            p.view.failure = Some(super::diagnostics::Failure::classify("网络传输失败"));
            p.view.revision += 1;
            drop(p);
            state.music.persist();
            return Ok(());
        }
        p.stream_retries += 1;
        let delay = if p.stream_retries == 1 { 10 } else { 30 };
        p.view.revision += 1;
        let expected = (p.view.generation, p.view.revision);
        let index = p.view.index;
        drop(p);
        let app = app.clone();
        let state = state.clone();
        std::thread::spawn(move || {
            let cancelled = state.music.playback.lock().unwrap().cancelled.clone();
            if !wait_cancelled(&cancelled, delay) {
                return;
            }
            let _ = load_variant(&app, &state, None, index, None, true, false, Some(expected));
        });
        return Ok(());
    }
    if f.error {
        let id = p.audio.as_ref().unwrap().quality.id.clone();
        let fallback = (p.view.generation, p.view.revision, id);
        let index = p.view.index;
        let automatic = p.automatic;
        drop(p);
        return load_variant(
            app,
            state,
            None,
            index,
            Some(fallback),
            false,
            automatic,
            None,
        );
    }
    p.view.phase = if f.buffering && p.view.playing {
        "buffering"
    } else if f.playing {
        "playing"
    } else {
        "paused"
    }
    .into();
    if f.ended && p.view.sleep_after_track {
        p.view.sleep_after_track = false;
        p.view.playing = false;
        p.view.revision += 1;
        drop(p);
        state.music.persist();
        return Ok(());
    }
    if f.ended {
        if !p.view.playing {
            return Ok(());
        }
        p.view.playing = false;
        // Consume the ended event before starting a potentially slow request.
        p.view.revision += 1;
        let (mode, len, index) = (p.view.mode, p.view.queue.len(), p.view.index);
        let expected = (p.view.generation, p.view.revision);
        let next = p.order.next(mode, len, index, true);
        p.refresh_controls();
        if next == Some(index) {
            p.restart();
            drop(p);
            let _ = app.emit_to("music-player", "music-player-wake", ());
            return Ok(());
        }
        drop(p);
        if let Some(next) = next {
            return load_variant(app, state, None, next, None, false, true, Some(expected));
        }
        state.music.persist();
        return Ok(());
    }
    drop(p);
    if persist {
        state.music.persist();
    }
    Ok(())
}

pub fn byte_range(
    header: Option<&str>,
    length: usize,
) -> Result<(RangeInclusive<usize>, bool), ()> {
    if length == 0 {
        return Err(());
    }
    let Some(header) = header else {
        return Ok((0..=length - 1, false));
    };
    let value = header.strip_prefix("bytes=").ok_or(())?;
    if value.contains(',') {
        return Err(());
    }
    let (start, end) = value.split_once('-').ok_or(())?;
    let (start, end) = if start.is_empty() {
        let suffix = end.parse::<usize>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        (length.saturating_sub(suffix), length - 1)
    } else {
        (
            start.parse::<usize>().map_err(|_| ())?,
            if end.is_empty() {
                length - 1
            } else {
                end.parse::<usize>().map_err(|_| ())?.min(length - 1)
            },
        )
    };
    if start >= length || start > end {
        return Err(());
    }
    Ok((start..=end, true))
}

pub fn resource(state: &MusicState, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let bad = |status| {
        Response::builder()
            .status(status)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap()
    };
    if !matches!(request.method().as_str(), "GET" | "HEAD") {
        return bad(405);
    }
    let audio = {
        let p = state.playback.lock().unwrap();
        if request.uri().path() != format!("/stream/{}", p.view.generation) {
            return bad(404);
        }
        p.audio.clone()
    };
    let Some(audio) = audio else {
        return bad(404);
    };
    if audio.stream.is_some() {
        return bad(404);
    }
    let length = audio.bytes.len();
    let Ok((range, partial)) = byte_range(
        request.headers().get("range").and_then(|v| v.to_str().ok()),
        length,
    ) else {
        return Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{length}"))
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap();
    };
    let mut builder = Response::builder()
        .status(if partial { 206 } else { 200 })
        .header("Content-Type", audio.mime)
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Content-Length",
            (range.end() - range.start() + 1).to_string(),
        );
    if partial {
        builder = builder.header(
            "Content-Range",
            format!("bytes {}-{}/{length}", range.start(), range.end()),
        );
    }
    builder
        .body(if request.method() == "HEAD" {
            Vec::new()
        } else {
            audio.bytes[range].to_vec()
        })
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn track(id: &str) -> Track {
        super::super::qq::track(&serde_json::json!({"mid":id,"title":id,"interval":90})).unwrap()
    }
    fn audio() -> Audio {
        Audio {
            bytes: vec![1, 2, 3],
            mime: "audio/mpeg",
            stream: None,
            quality: AudioQuality {
                id: "M500".into(),
                label: "标准".into(),
                codec: "MP3".into(),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                bitrate: None,
                fallback: None,
            },
        }
    }
    #[test]
    fn rapid_selection_cancels_old_work_and_pause_survives_audio_completion() {
        let mut p = Playback::default();
        let (first, _, cancelled) = p
            .prepare(
                Some(vec![track("one"), track("two"), track("three")]),
                0,
                0.0,
                true,
            )
            .unwrap();
        let stable = p.view.entry_ids.clone();
        let (second, _, next_cancel) = p.prepare(None, 1, 0.0, true).unwrap();
        assert!(cancelled.load(Ordering::Acquire));
        assert!(!p.commit_audio(first, audio()));
        assert!(p.audio.is_none());
        p.view.playing = false;
        assert!(p.commit_audio(second, audio()));
        assert!(!p.view.playing);
        assert_eq!(p.view.entry_ids, stable);
        let (third, _, _) = p.prepare(None, 2, 0.0, true).unwrap();
        assert!(next_cancel.load(Ordering::Acquire));
        assert!(!p.commit_audio(second, audio()));
        assert!(p.commit_audio(third, audio()));
        assert_eq!(p.view.queue[p.view.index].id, "three");
    }
    #[test]
    fn loading_next_previous_moves_from_the_accepted_target_and_invalid_selection_is_atomic() {
        let mut p = Playback::default();
        p.prepare(
            Some(vec![track("one"), track("two"), track("three")]),
            0,
            0.0,
            true,
        )
        .unwrap();
        for target in [1, 2] {
            let next = p
                .order
                .next(p.view.mode, p.view.queue.len(), p.view.index, false)
                .unwrap();
            assert_eq!(next, target);
            p.prepare(None, next, 0.0, true).unwrap();
        }
        let previous = p
            .order
            .previous(p.view.mode, p.view.queue.len(), p.view.index)
            .unwrap();
        assert_eq!(previous, 1);
        let revision = p.view.queue_revision;
        let generation = p.view.generation;
        assert!(p.prepare(Some(vec![]), 10, 0.0, true).is_err());
        assert_eq!(p.view.queue.len(), 3);
        assert_eq!(p.view.generation, generation);
        assert_eq!(p.view.queue_revision, revision);
    }
    #[test]
    fn replacing_queue_and_mode_cancels_prefetch_without_consuming_shuffle_candidate() {
        let mut p = Playback::default();
        p.prepare(Some(vec![track("one"), track("two")]), 0, 0.0, true)
            .unwrap();
        let token = p.prefetch_cancel.clone();
        let candidate = p.order.peek(PlayMode::Shuffle, 2, 0).unwrap();
        assert_eq!(p.order.next(PlayMode::Shuffle, 2, 0, true), Some(candidate));
        p.order_reset();
        assert!(token.load(Ordering::Acquire));
        assert!(p.prefetch_key.is_none());
    }
    #[test]
    fn cancelled_network_backoff_exits_before_sleeping() {
        let cancelled = AtomicBool::new(true);
        let start = Instant::now();
        assert!(!wait_cancelled(&cancelled, 30));
        assert!(start.elapsed().as_millis() < 100);
    }
    #[test]
    fn playable_ranges_preserve_seek_gaps_and_reject_invalid_feedback() {
        assert_eq!(
            playable_ranges(
                vec![
                    [80.0, 110.0],
                    [0.0, 12.0],
                    [10.0, 15.0],
                    [-8.0, 3.0],
                    [20.0, 18.0],
                    [f64::NAN, 60.0],
                    [40.0, f64::INFINITY]
                ],
                100.0
            ),
            vec![[0.0, 15.0], [80.0, 100.0]]
        );
        assert!(playable_ranges(vec![[0.0, 10.0]], 0.0).is_empty());
        assert_eq!(
            playable_ranges(
                (0..100)
                    .map(|i| [i as f64 * 2.0, i as f64 * 2.0 + 1.0])
                    .collect(),
                300.0
            )
            .len(),
            64
        );
    }
    #[test]
    fn media_ranges_support_seek_suffix_and_reject_invalid_ranges() {
        assert_eq!(byte_range(None, 100), Ok((0..=99, false)));
        assert_eq!(byte_range(Some("bytes=20-29"), 100), Ok((20..=29, true)));
        assert_eq!(byte_range(Some("bytes=90-"), 100), Ok((90..=99, true)));
        assert_eq!(byte_range(Some("bytes=-15"), 100), Ok((85..=99, true)));
        assert_eq!(byte_range(Some("bytes=0-999"), 100), Ok((0..=99, true)));
        for value in [
            "bytes=100-",
            "bytes=20-10",
            "bytes=-0",
            "bytes=0-1,3-4",
            "bad",
        ] {
            assert!(byte_range(Some(value), 100).is_err());
        }
    }
    #[test]
    fn resource_rejects_old_track_generation() {
        let state = MusicState::new(std::path::PathBuf::from("unused"));
        let mut p = state.playback.lock().unwrap();
        p.view.generation = 2;
        p.audio = Some(Arc::new(Audio {
            stream: None,
            bytes: vec![1, 2, 3, 4],
            mime: "audio/mpeg",
            quality: AudioQuality {
                id: "M500".into(),
                label: "标准音质".into(),
                codec: "MP3".into(),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                bitrate: None,
                fallback: None,
            },
        }));
        drop(p);
        assert_eq!(
            resource(
                &state,
                Request::builder()
                    .uri("music://localhost/stream/1")
                    .body(vec![])
                    .unwrap()
            )
            .status(),
            404
        );
        let r = resource(
            &state,
            Request::builder()
                .uri("music://localhost/stream/2")
                .header("range", "bytes=1-2")
                .body(vec![])
                .unwrap(),
        );
        assert_eq!(r.status(), 206);
        assert_eq!(r.body(), &[2, 3]);
    }
    #[test]
    fn unchanged_queue_snapshot_omits_payload_without_mutating_playback() {
        let mut p = Playback::default();
        p.prepare(Some(vec![track("one"), track("two")]), 0, 0.0, true)
            .unwrap();
        let compact = p.snapshot(Some(p.view.queue_revision));
        assert!(compact.queue.is_empty());
        assert!(compact.entry_ids.is_empty());
        assert!(compact.queue_unchanged);
        assert_eq!(p.view.queue.len(), 2);
        let full = p.snapshot(None);
        assert_eq!(full.queue.len(), 2);
        assert!(!full.queue_unchanged);
    }
    #[test]
    fn account_replacement_cancels_old_audio_and_never_inherits_another_queue() {
        let mut p = Playback::default();
        let (old, _, cancelled) = p
            .prepare(Some(vec![track("oldaccount")]), 0, 0.0, true)
            .unwrap();
        p.commit_audio(old, audio());
        p.restore_scene(None);
        assert!(p.view.queue.is_empty());
        assert!(p.audio.is_none());
        assert!(cancelled.load(Ordering::Acquire));
        assert!(!p.view.playing);
        assert!(p.view.generation > old);
        let restored = View {
            queue: vec![track("newaccount")],
            position: 31.0,
            suspended: true,
            ..View::default()
        };
        p.restore_scene(Some(restored));
        assert_eq!(p.view.queue[0].id, "newaccount");
        assert_eq!(p.view.entry_ids.len(), 1);
        assert_eq!(p.view.position, 31.0);
        assert!(!p.view.playing);
    }
}
