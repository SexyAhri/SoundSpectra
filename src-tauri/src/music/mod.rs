//! Account providers are independent from the common library and player.
mod artwork;
mod cache;
mod diagnostics;
mod kugou;
mod kugou_audio;
mod kugou_login;
pub mod login;
mod loudness;
mod lyric_cache;
pub mod model;
mod netease;
mod netease_quality;
pub mod operations;
pub mod playback;
mod qq;
mod qq_quality;
mod queue;
mod session;
mod store;
mod stream;
mod sync;
mod vault;

use crate::AppState;
use model::{Account, Page, Playlist, Provider, Track};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State, WebviewWindow};

pub struct MusicState {
    provider: Mutex<Option<Arc<dyn Provider>>>,
    account: Mutex<Option<Account>>,
    login: Mutex<login::Login>,
    login_generation: AtomicU64,
    session_gate: Mutex<()>,
    tracks: Mutex<HashMap<String, Track>>,
    pub playback: Mutex<playback::Playback>,
    directory: PathBuf,
    cache: Arc<cache::Cache>,
    store: Arc<store::Store>,
    diagnostics: diagnostics::Diagnostics,
    artwork: artwork::Artwork,
    dispatch: Mutex<()>,
}
impl MusicState {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            provider: Mutex::new(None),
            account: Mutex::new(None),
            login: Mutex::new(login::Login::default()),
            login_generation: AtomicU64::new(0),
            session_gate: Mutex::new(()),
            tracks: Mutex::new(HashMap::new()),
            playback: Mutex::new(playback::Playback::default()),
            cache: Arc::new(cache::Cache::new(&directory)),
            store: Arc::new(store::Store::new(directory.join("library.sqlite"))),
            diagnostics: diagnostics::Diagnostics::default(),
            artwork: artwork::Artwork::new(directory.join("covers")),
            dispatch: Mutex::new(()),
            directory,
        }
    }
    pub fn persist(&self) {
        if let Ok(provider) = self.provider() {
            let p = self.playback.lock().unwrap();
            if self.store.save(&provider.scope(), &p.view).is_err() {
                self.diagnostics
                    .record("database", p.view.generation, Some("storage"));
            }
        }
    }
    pub fn provider(&self) -> Result<Arc<dyn Provider>, String> {
        self.provider
            .lock()
            .unwrap()
            .clone()
            .ok_or("请先扫码连接音乐平台".into())
    }
    fn same_provider(&self, provider: &Arc<dyn Provider>) -> Result<(), String> {
        if self
            .provider
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|p| Arc::ptr_eq(p, provider))
        {
            Ok(())
        } else {
            Err("登录账号已变化，请重新打开歌单".into())
        }
    }
    fn attach(
        self: &Arc<Self>,
        mut session: session::Session,
        generation: u64,
    ) -> Result<Option<(u64, u64, usize)>, String> {
        if self.login_generation.load(Ordering::SeqCst) != generation {
            return Err("本次登录已取消".into());
        }
        session.validate()?;
        let provider = session.provider(self.cache.clone())?;
        let account = provider.account()?;
        let _gate = self.session_gate.lock().unwrap();
        if self.login_generation.load(Ordering::SeqCst) != generation {
            return Err("本次登录已取消".into());
        }
        let scope = provider.scope();
        let restored = self.store.restore(&scope)?;
        let resume = restored.as_ref().is_some_and(|view| view.playing);
        let prefs = self
            .store
            .value::<store::Preferences>(&scope, "preferences")?
            .unwrap_or_default();
        self.store.set(&scope, "sync-complete", &false)?;
        self.cache.configure(prefs.lyric_mib, prefs.normalize)?;
        session.save(&self.directory)?;
        let mut tracks = self.tracks.lock().unwrap();
        let mut p = self.playback.lock().unwrap();
        *self.provider.lock().unwrap() = Some(provider.clone());
        *self.account.lock().unwrap() = Some(account);
        tracks.clear();
        p.restore_scene(restored);
        let resume = resume.then_some((p.view.generation, p.view.revision, p.view.index));
        for t in &p.view.queue {
            tracks.insert(format!("{}:{}", t.provider, t.id), t.clone());
        }
        drop(p);
        drop(tracks);
        self.cache.active(None);
        sync::start(Arc::downgrade(self), provider);
        Ok(resume)
    }
    pub fn restore(self: &Arc<Self>, app: AppHandle, app_state: Arc<AppState>) {
        let weak = Arc::downgrade(self);
        std::thread::spawn(move || loop {
            let Some(state) = weak.upgrade() else {
                return;
            };
            state.cache.prune();
            state.artwork.prune();
            drop(state);
            std::thread::sleep(std::time::Duration::from_secs(3600));
        });
        let state = self.clone();
        let generation = state.login_generation.load(Ordering::SeqCst);
        let source_revision = app_state.audio_source.lock().unwrap().revision;
        std::thread::spawn(move || {
            let Some(session) = session::Session::restore(&state.directory) else {
                return;
            };
            let id = session.id();
            let name = session::name(id);
            let gate = state.session_gate.lock().unwrap();
            if state.login_generation.load(Ordering::SeqCst) != generation {
                return;
            }
            *state.login.lock().unwrap() = login::Login {
                provider: Some(id.into()),
                phase: "restoring".into(),
                qr: None,
                message: format!("正在恢复{name}登录…"),
            };
            drop(gate);
            let result = state.attach(session, generation);
            let resume = result.as_ref().ok().copied().flatten();
            login::update(
                &state,
                generation,
                match result {
                    Ok(_) => login::Login {
                        provider: Some(id.into()),
                        phase: "connected".into(),
                        qr: None,
                        message: format!("{name}已连接"),
                    },
                    Err(message) => login::Login {
                        provider: Some(id.into()),
                        phase: "error".into(),
                        qr: None,
                        message,
                    },
                },
            );
            if let Some(point) = resume {
                let _dispatch = state.dispatch.lock().unwrap();
                if state.login_generation.load(Ordering::SeqCst) != generation {
                    return;
                }
                if app_state.audio_source.lock().unwrap().revision != source_revision {
                    let mut p = state.playback.lock().unwrap();
                    if (p.view.generation, p.view.revision) == (point.0, point.1) {
                        p.view.suspended = true;
                        p.view.phase = "suspended".into();
                        p.view.revision += 1;
                    }
                    return;
                }
                if let Err(message) = playback::resume_startup(&app, &app_state, point) {
                    let mut p = state.playback.lock().unwrap();
                    if (p.view.generation, p.view.revision) == (point.0, point.1) {
                        p.view.phase = "error".into();
                        p.view.error = Some(message);
                        p.view.playing = false;
                    }
                }
            }
        });
    }
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn china_timestamp() -> String {
    china_timestamp_at(now())
}
fn china_timestamp_at(milliseconds: u64) -> String {
    let seconds = milliseconds / 1000 + 8 * 3600;
    let days = (seconds / 86400) as i64 + 719468;
    let era = days / 146097;
    let doe = days - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02}",
        seconds / 3600 % 24,
        seconds / 60 % 60,
        seconds % 60
    )
}
fn library_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "settings" {
        Ok(())
    } else {
        Err("此操作仅供音乐库使用".into())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    account: Option<Account>,
    library_key: Option<String>,
    login: login::Login,
    playback: playback::View,
    providers: Vec<ProviderInfo>,
}
#[derive(Serialize)]
pub struct ProviderInfo {
    id: &'static str,
    name: &'static str,
    capabilities: &'static [&'static str],
}

#[tauri::command]
pub fn music_snapshot(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    queue_revision: Option<u64>,
) -> Result<Snapshot, String> {
    library_window(&window)?;
    // End each guard before taking another lock. Login attaches the playback
    // and account state together; retaining an account guard while waiting for
    // playback would invert that order and could stall the status subscription.
    let account = state.music.account.lock().unwrap().clone();
    let library_key = state.music.provider().ok().map(|p| p.scope());
    let login = state.music.login.lock().unwrap().clone();
    Ok(Snapshot {
        account,
        library_key,
        login,
        playback: {
            let p = state.music.playback.lock().unwrap();
            let mut view = p.snapshot(queue_revision);
            view.global_lyric_offset = state.settings.lock().unwrap().lyrics.offset_ms / 1000.0;
            if queue_revision == Some(view.queue_revision) {
                view.queue.clear();
                view.entry_ids.clear();
                view.queue_unchanged = true;
            }
            view
        },
        providers: {
            let current = state.music.provider().ok();
            session::PROVIDERS
                .iter()
                .map(|(id, name)| ProviderInfo {
                    id,
                    name,
                    capabilities: current
                        .as_ref()
                        .filter(|p| p.id() == *id)
                        .map_or_else(|| &["qr-login"][..], |p| p.capabilities()),
                })
                .collect()
        },
    })
}

#[tauri::command]
pub async fn music_login(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    action: String,
    provider: Option<String>,
) -> Result<(), String> {
    library_window(&window)?;
    login::validate_provider(provider.as_deref())?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || match action.as_str() {
        "start" => {
            if playback::active(&state) {
                playback::control(&app, &state, "stop", None)?;
            }
            login::start(
                app,
                state.music.clone(),
                provider.as_deref().unwrap_or("qq"),
            )
        }
        "cancel" => {
            login::cancel_for(&app, &state.music, provider.as_deref())?;
            Ok(())
        }
        "official" => login::official(app, state.music.clone(), provider.as_deref()),
        "logout" => {
            if provider
                .as_deref()
                .is_some_and(|id| state.music.provider().is_ok_and(|p| p.id() != id))
            {
                return Err("音乐平台已变化，请刷新账号状态".into());
            }
            playback::control(&app, &state, "clear", None)?;
            login::logout(&app, &state.music)?;
            playback::control(&app, &state, "clear", None)
        }
        "refresh-account" => {
            let current = state.music.provider()?;
            if provider.as_deref().is_some_and(|id| current.id() != id) {
                return Err("音乐平台已变化，请刷新账号状态".into());
            }
            let account = current.account()?;
            let _gate = state.music.session_gate.lock().unwrap();
            state.music.same_provider(&current)?;
            if let Some(bytes) = current.refreshed_session()? {
                vault::write(
                    &session::vault_path(&state.music.directory, current.id())?,
                    &bytes,
                )?;
            }
            *state.music.account.lock().unwrap() = Some(account);
            Ok(())
        }
        _ => Err("未知登录操作".into()),
    })
    .await
    .map_err(|_| "登录操作失败")?
}

#[tauri::command]
pub async fn music_playlists(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    provider: String,
    collection: String,
    offset: usize,
    limit: usize,
) -> Result<Page<Playlist>, String> {
    library_window(&window)?;
    validate_page(&provider, offset, limit)?;
    let state = state.music.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let current = state.provider()?;
        if current.id() != provider {
            return Err("音乐平台已变化，请重新打开歌单".into());
        }
        let provider = current;
        if !provider.supports("playlists") {
            return Err("当前平台歌单暂未开放".into());
        }
        let mut page = provider.playlists(&collection, offset, limit)?;
        if let Some(liked) = page.items.iter_mut().find(|p| p.id == "liked") {
            // The liked collection always represents the first track's album;
            // an upstream generic playlist image must not override it.
            liked.cover = provider
                .tracks("liked", 0, 1)
                .ok()
                .and_then(|page| page.items.first().and_then(|t| t.cover.clone()));
        }
        state.same_provider(&provider)?;
        Ok(page)
    })
    .await
    .map_err(|_| "歌单加载失败")?
}
#[tauri::command]
pub async fn music_tracks(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    provider: String,
    playlist: String,
    offset: usize,
    limit: usize,
) -> Result<Page<Track>, String> {
    library_window(&window)?;
    validate_page(&provider, offset, limit)?;
    let state = state.music.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let current = state.provider()?;
        if current.id() != provider {
            return Err("音乐平台已变化，请重新打开歌单".into());
        }
        let provider = current;
        if !provider.supports("playlists") {
            return Err("当前平台歌单暂未开放".into());
        }
        let page = provider.tracks(&playlist, offset, limit)?;
        let _gate = state.session_gate.lock().unwrap();
        state.same_provider(&provider)?;
        state
            .store
            .index(&provider.scope(), &playlist, offset, &page)?;
        let mut tracks = state.tracks.lock().unwrap();
        for track in &page.items {
            tracks.insert(format!("{}:{}", track.provider, track.id), track.clone());
        }
        Ok(page)
    })
    .await
    .map_err(|_| "歌曲加载失败")?
}
fn validate_page(provider: &str, offset: usize, limit: usize) -> Result<(), String> {
    if !["qq", "netease", "kugou"].contains(&provider)
        || offset > 100_000
        || !(1..=100).contains(&limit)
    {
        Err("音乐平台或分页参数无效".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn music_play(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    ids: Vec<String>,
    index: usize,
) -> Result<(), String> {
    library_window(&window)?;
    if ids.is_empty() || ids.len() > 20_000 || index >= ids.len() {
        return Err("播放队列无效".into());
    }
    if !state.music.provider()?.supports("playback") {
        return Err("当前平台播放暂未开放".into());
    }
    let queue = {
        let tracks = state.music.tracks.lock().unwrap();
        ids.iter()
            .map(|id| {
                tracks
                    .get(id)
                    .cloned()
                    .ok_or_else(|| "歌曲已过期，请重新打开歌单".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?
    };
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _dispatch = state.music.dispatch.lock().unwrap();
        playback::load(&app, &state, Some(queue), index)
    })
    .await
    .map_err(|_| "播放请求失败")?
}
#[tauri::command]
pub async fn music_control(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    action: String,
    value: Option<f64>,
) -> Result<(), String> {
    library_window(&window)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _dispatch = state.music.dispatch.lock().unwrap();
        playback::control(&app, &state, &action, value)
    })
    .await
    .map_err(|_| "播放操作失败")?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerState {
    generation: u64,
    revision: u64,
    seek_revision: u64,
    ready: bool,
    playing: bool,
    position: f64,
    volume: f64,
    stream_url: Option<String>,
    download_failed: bool,
    metadata: Option<serde_json::Value>,
}
#[tauri::command]
pub fn music_player_state(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
) -> Result<PlayerState, String> {
    if window.label() != "music-player" {
        return Err("仅供内置音频引擎使用".into());
    }
    let p = state.music.playback.lock().unwrap();
    let v = &p.view;
    Ok(PlayerState {
        generation: v.generation,
        revision: v.revision,
        seek_revision: v.seek_revision,
        metadata: if v.suspended || p.audio.is_none() {
            None
        } else {
            v.queue.get(v.index).map(|t|serde_json::json!({"title":t.title,"artist":t.artist,"album":t.album,"artwork":t.cover.as_ref().map(|src|vec![serde_json::json!({"src":src})]).unwrap_or_default()}))
        },
        ready: p.audio.is_some(),
        playing: v.playing,
        position: v.position,
        volume: if v.muted {
            0.0
        } else {
            v.volume * if v.gain > 0.0 { v.gain } else { 1.0 }
        },
        stream_url: p
            .audio
            .as_ref()
            .and_then(|a| a.stream.as_ref().map(|s| s.url())),
        download_failed: p
            .audio
            .as_ref()
            .and_then(|a| a.stream.as_ref())
            .is_some_and(|s| s.progress().status == "failed"),
    })
}
#[tauri::command]
pub async fn music_player_feedback(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    feedback: playback::Feedback,
) -> Result<(), String> {
    if window.label() != "music-player" {
        return Err("仅供内置音频引擎使用".into());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || playback::feedback(&app, &state, feedback))
        .await
        .map_err(|_| "播放器反馈失败")?
}

pub fn current_lyrics(state: &AppState) -> Option<crate::lyrics::LyricDocument> {
    let p = state.music.playback.lock().unwrap();
    if p.view.queue.is_empty() {
        return None;
    }
    let mut document = p
        .lyrics
        .clone()
        .unwrap_or_else(|| crate::lyrics::LyricDocument {
            status: "loading".into(),
            message: "正在获取歌曲歌词…".into(),
            key: p
                .view
                .queue
                .get(p.view.index)
                .map(|t| format!("{}\u{1f}{}\u{1f}{}", t.title, t.artist, t.album))
                .unwrap_or_default(),
            ..Default::default()
        });
    shift_lyrics(&mut document, p.view.lyric_offset);
    Some(document)
}

fn shift_lyrics(document: &mut crate::lyrics::LyricDocument, seconds: f64) {
    let shift = |ms: u64| (ms as f64 + seconds * 1000.0).max(0.0) as u64;
    for line in &mut document.lines {
        line.start = shift(line.start);
        line.end = shift(line.end);
        for word in &mut line.words {
            word.start = shift(word.start);
            word.end = shift(word.end);
        }
    }
}

#[tauri::command]
pub async fn music_lyrics(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    refresh: bool,
) -> Result<crate::lyrics::LyricDocument, String> {
    library_window(&window)?;
    if !refresh {
        return Ok(
            current_lyrics(&state).unwrap_or_else(|| crate::lyrics::LyricDocument {
                status: "idle".into(),
                message: "选择一首歌曲查看歌词".into(),
                ..Default::default()
            }),
        );
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let provider = state.music.provider()?;
        let (track, generation) = {
            let p = state.music.playback.lock().unwrap();
            (
                p.view
                    .queue
                    .get(p.view.index)
                    .ok_or("请先选择歌曲")?
                    .clone(),
                p.view.generation,
            )
        };
        let document = state
            .music
            .cache
            .lyrics(&track, true, || provider.lyrics(&track));
        state.music.same_provider(&provider)?;
        let mut p = state.music.playback.lock().unwrap();
        if p.view.generation != generation {
            return Err("歌曲已切换，请重试".into());
        }
        p.lyrics = Some(document.clone());
        let mut document = document;
        shift_lyrics(&mut document, p.view.lyric_offset);
        Ok(document)
    })
    .await
    .map_err(|_| "歌词刷新失败")?
}
