use super::{cache, diagnostics, library_window, playback, store, AppState};
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, State, WebviewWindow};

#[tauri::command]
pub async fn music_library_data(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    playlist: Option<String>,
    recent: bool,
) -> Result<store::IndexedPage, String> {
    library_window(&window)?;
    let music = state.music.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let provider = music.provider()?;
        let result = music
            .store
            .tracks(&provider.scope(), playlist.as_deref(), recent)?;
        let _gate = music.session_gate.lock().unwrap();
        music.same_provider(&provider)?;
        let mut tracks = music.tracks.lock().unwrap();
        for t in &result.items {
            tracks.insert(format!("{}:{}", t.provider, t.id), t.clone());
        }
        Ok(result)
    })
    .await
    .map_err(|_| "读取本地歌曲失败")?
}
#[tauri::command]
pub fn music_preferences(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    preferences: Option<store::Preferences>,
) -> Result<store::Preferences, String> {
    library_window(&window)?;
    let provider = state.music.provider()?;
    let scope = provider.scope();
    if let Some(p) = preferences {
        state.music.cache.configure(p.lyric_mib, p.normalize)?;
        state.music.store.set(&scope, "preferences", &p)?;
    }
    state
        .music
        .store
        .value(&scope, "preferences")
        .map(|p| p.unwrap_or_default())
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum QueueEdit {
    Append { ids: Vec<String>, next: bool },
    Reorder { entries: Vec<String> },
    Remove { entries: Vec<String> },
    ClearPlayed,
}
#[tauri::command]
pub fn music_queue_edit(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    edit: QueueEdit,
) -> Result<(), String> {
    library_window(&window)?;
    let _dispatch = state.music.dispatch.lock().unwrap();
    if !state.music.provider()?.supports("playback") {
        return Err("当前平台队列暂未开放".into());
    }
    let tracks = state.music.tracks.lock().unwrap();
    let mut p = state.music.playback.lock().unwrap();
    apply_queue_edit(&mut p, &tracks, edit)?;
    if let Ok(provider) = state.music.provider() {
        provider.discard_prefetch();
    }
    drop(p);
    drop(tracks);
    state.music.persist();
    Ok(())
}
fn apply_queue_edit(
    p: &mut playback::Playback,
    tracks: &std::collections::HashMap<String, super::model::Track>,
    edit: QueueEdit,
) -> Result<(), String> {
    let current = p.view.entry_ids.get(p.view.index).cloned();
    match edit {
        QueueEdit::Append { ids, next } => {
            if ids.is_empty() || ids.len() + p.view.queue.len() > 20_000 {
                return Err("队列长度无效".into());
            }
            let additions = ids
                .iter()
                .map(|id| tracks.get(id).cloned().ok_or("歌曲未同步，请刷新歌单"))
                .collect::<Result<Vec<_>, _>>()?;
            let at = if next && !p.view.queue.is_empty() {
                p.view.index + 1
            } else {
                p.view.queue.len()
            };
            let ids = additions
                .iter()
                .enumerate()
                .map(|(i, _)| format!("entry-{}-{}-{i}", super::now(), p.view.queue_revision + 1))
                .collect::<Vec<_>>();
            p.view.queue.splice(at..at, additions);
            p.view.entry_ids.splice(at..at, ids);
        }
        QueueEdit::Reorder { entries } => {
            let unique = entries.iter().collect::<std::collections::HashSet<_>>();
            if unique.len() != p.view.queue.len() || entries.len() != p.view.queue.len() {
                return Err("队列已经变化，请重试".into());
            }
            let positions: std::collections::HashMap<_, _> = p
                .view
                .entry_ids
                .iter()
                .enumerate()
                .map(|(i, id)| (id, i))
                .collect();
            let reordered = entries
                .iter()
                .map(|id| {
                    positions
                        .get(id)
                        .map(|i| p.view.queue[*i].clone())
                        .ok_or("队列已经变化，请重试")
                })
                .collect::<Result<Vec<_>, _>>()?;
            p.view.queue = reordered;
            p.view.entry_ids = entries;
        }
        QueueEdit::Remove { entries } => {
            let remove: std::collections::HashSet<_> = entries.into_iter().collect();
            let keep = |id: &String| Some(id) == current.as_ref() || !remove.contains(id);
            let ids = &p.view.entry_ids;
            let mut i = 0;
            p.view.queue.retain(|_| {
                let retain = keep(&ids[i]);
                i += 1;
                retain
            });
            p.view.entry_ids.retain(keep);
        }
        QueueEdit::ClearPlayed => {
            let index = p.view.index;
            p.view.queue.drain(..index);
            p.view.entry_ids.drain(..index);
        }
    }
    p.view.index = current
        .and_then(|id| p.view.entry_ids.iter().position(|s| s == &id))
        .unwrap_or(0);
    p.view.queue_revision += 1;
    p.view.revision += 1;
    p.order_reset();
    p.refresh_controls();
    Ok(())
}

#[tauri::command]
pub async fn music_cache(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    clear: Option<String>,
) -> Result<cache::Stats, String> {
    library_window(&window)?;
    let music = state.music.clone();
    tauri::async_runtime::spawn_blocking(move || music.cache.manage(clear.as_deref()))
        .await
        .map_err(|_| "缓存管理失败")?
}
#[tauri::command]
pub fn music_offset(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    value: Option<f64>,
) -> Result<f64, String> {
    library_window(&window)?;
    let provider = state.music.provider()?;
    let mut p = state.music.playback.lock().unwrap();
    let track = p.view.queue.get(p.view.index).ok_or("请先选择歌曲")?;
    let offset = state.music.store.offset(
        &provider.scope(),
        &format!("{}:{}", track.provider, track.id),
        value,
    )?;
    p.view.lyric_offset = offset;
    Ok(offset)
}
#[tauri::command]
pub fn music_diagnostics(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<diagnostics::Event>, String> {
    library_window(&window)?;
    Ok(state.music.diagnostics.export())
}
#[tauri::command]
pub async fn music_media_control(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    action: String,
    value: Option<f64>,
) -> Result<(), String> {
    if window.label() != "music-player"
        || ![
            "play", "pause", "stop", "next", "previous", "seek", "recover",
        ]
        .contains(&action.as_str())
    {
        return Err("媒体控制命令无效".into());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _dispatch = state.music.dispatch.lock().unwrap();
        if !playback::active(&state) {
            return Ok(());
        }
        playback::control(&app, &state, &action, value)
    })
    .await
    .map_err(|_| "媒体控制失败")?
}

#[tauri::command]
pub async fn music_artwork(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    url: String,
    refresh: bool,
) -> Result<Option<String>, String> {
    library_window(&window)?;
    let music = state.music.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let provider = music.provider()?;
        Ok(music.artwork.load(&url, refresh, || provider.artwork(&url)))
    })
    .await
    .map_err(|_| "加载封面失败")?
}

#[tauri::command]
pub fn music_browse(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    value: Option<serde_json::Value>,
) -> Result<Option<serde_json::Value>, String> {
    library_window(&window)?;
    let provider = state.music.provider()?;
    if let Some(value) = value {
        if value.to_string().len() > 65536 {
            return Err("浏览现场过大".into());
        }
        state.music.store.set(&provider.scope(), "browse", &value)?;
    }
    state.music.store.value(&provider.scope(), "browse")
}

#[tauri::command]
pub async fn music_search(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    query: String,
    offset: usize,
) -> Result<super::model::Page<super::model::Track>, String> {
    library_window(&window)?;
    if query.trim().is_empty() || query.len() > 512 || offset > 100_000 {
        return Err("搜索参数无效".into());
    }
    let music = state.music.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let provider = music.provider()?;
        if !provider.supports("search") {
            return Err("当前平台搜索尚未通过验证".into());
        }
        let page = provider.search(query.trim(), offset, 30)?;
        let _gate = music.session_gate.lock().unwrap();
        music.same_provider(&provider)?;
        let mut tracks = music.tracks.lock().unwrap();
        for t in &page.items {
            tracks.insert(format!("{}:{}", t.provider, t.id), t.clone());
        }
        drop(tracks);
        let changed = update_queue_artwork(&mut music.playback.lock().unwrap(), &page.items);
        if changed {
            music.persist();
        }
        Ok(page)
    })
    .await
    .map_err(|_| "搜索失败")?
}

fn update_queue_artwork(p: &mut playback::Playback, items: &[super::model::Track]) -> bool {
    let mut changed = false;
    for queued in p.view.queue.iter_mut().filter(|t| t.cover.is_none()) {
        if let Some(cover) = items
            .iter()
            .find(|t| t.provider == queued.provider && t.id == queued.id)
            .and_then(|t| t.cover.as_ref())
        {
            queued.cover = Some(cover.clone());
            changed = true;
        }
    }
    if changed {
        // Publish repaired metadata without restarting audio or moving the queue.
        p.view.queue_revision += 1;
    }
    changed
}
#[tauri::command]
pub async fn music_track_lyrics(
    window: WebviewWindow,
    state: State<'_, Arc<AppState>>,
    id: String,
    refresh: bool,
) -> Result<crate::lyrics::LyricDocument, String> {
    library_window(&window)?;
    let music = state.music.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let provider = music.provider()?;
        if !provider.supports("lyrics") {
            return Err("当前平台歌词暂未开放".into());
        }
        let track = music
            .tracks
            .lock()
            .unwrap()
            .get(&id)
            .cloned()
            .ok_or("歌曲已过期，请重新搜索")?;
        if track.provider != provider.id() {
            return Err("音乐平台已变化，请重新搜索".into());
        }
        let document = music
            .cache
            .lyrics(&track, refresh, || provider.lyrics(&track));
        music.same_provider(&provider)?;
        Ok(document)
    })
    .await
    .map_err(|_| "歌词读取失败")?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repaired_artwork_updates_restored_queue_without_restarting_playback() {
        let track = |provider: &str, cover: Option<&str>| {
            let mut t =
                super::super::netease::track(&serde_json::json!({"id":5,"name":"曲目"})).unwrap();
            t.provider = provider.into();
            t.cover = cover.map(str::to_owned);
            t
        };
        let mut p = playback::Playback::default();
        p.view.queue = vec![
            track("netease", None),
            track("qq", None),
            track("netease", Some("existing")),
        ];
        p.view.entry_ids = vec!["a".into(), "b".into(), "c".into()];
        p.view.position = 42.0;
        p.view.generation = 9;
        p.view.revision = 3;
        p.view.playing = true;
        let details = [track("netease", Some("repaired"))];
        assert!(update_queue_artwork(&mut p, &details));
        assert_eq!(p.view.queue[0].cover.as_deref(), Some("repaired"));
        assert!(p.view.queue[1].cover.is_none());
        assert_eq!(p.view.queue[2].cover.as_deref(), Some("existing"));
        assert_eq!(
            (
                p.view.position,
                p.view.generation,
                p.view.revision,
                p.view.index
            ),
            (42.0, 9, 3, 0)
        );
        assert!(p.view.playing);
        assert_eq!(p.view.entry_ids, vec!["a", "b", "c"]);
        assert_eq!(p.view.queue_revision, 1);
        assert!(!update_queue_artwork(&mut p, &details));
        assert_eq!(p.view.queue_revision, 1);
    }
    #[test]
    fn stable_queue_edits_preserve_current_audio_position_and_generation() {
        let track =
            |id: &str| super::super::qq::track(&serde_json::json!({"mid":id,"title":id})).unwrap();
        let mut p = playback::Playback::default();
        p.view.queue = vec![track("a"), track("b"), track("c")];
        p.view.entry_ids = vec!["a".into(), "b".into(), "c".into()];
        p.view.index = 1;
        p.view.position = 42.0;
        p.view.generation = 9;
        p.view.playing = true;
        let tracks = std::collections::HashMap::from([("qq:d".into(), track("d"))]);
        apply_queue_edit(
            &mut p,
            &tracks,
            QueueEdit::Reorder {
                entries: vec!["c".into(), "a".into(), "b".into()],
            },
        )
        .unwrap();
        assert_eq!(p.view.index, 2);
        assert!(apply_queue_edit(
            &mut p,
            &tracks,
            QueueEdit::Reorder {
                entries: vec!["b".into(), "b".into(), "a".into()]
            }
        )
        .is_err());
        apply_queue_edit(
            &mut p,
            &tracks,
            QueueEdit::Append {
                ids: vec!["qq:d".into()],
                next: true,
            },
        )
        .unwrap();
        assert_eq!(p.view.queue[3].id, "d");
        apply_queue_edit(
            &mut p,
            &tracks,
            QueueEdit::Remove {
                entries: vec!["a".into(), "b".into()],
            },
        )
        .unwrap();
        assert_eq!(p.view.index, 1);
        assert_eq!(p.view.queue[1].id, "b");
        apply_queue_edit(&mut p, &tracks, QueueEdit::ClearPlayed).unwrap();
        assert_eq!(p.view.index, 0);
        assert_eq!(p.view.queue.len(), 2);
        assert_eq!(p.view.generation, 9);
        assert_eq!(p.view.position, 42.0);
        assert!(p.view.playing);
    }
}
