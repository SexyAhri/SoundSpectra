//! Sequential background indexing yields between pages and aborts on account replacement.
use super::{model::Provider, MusicState};
use std::sync::{Arc, Weak};
pub fn start(state: Weak<MusicState>, provider: Arc<dyn Provider>) {
    std::thread::spawn(move || {
        let valid = || {
            state
                .upgrade()
                .filter(|s| s.same_provider(&provider).is_ok())
        };
        let mut lists = std::collections::HashSet::from(["liked".to_string()]);
        let mut complete = true;
        for collection in ["created", "collected"] {
            let mut offset = 0;
            loop {
                if valid().is_none() {
                    return;
                }
                let page = match provider.playlists(collection, offset, 100) {
                    Ok(p) => p,
                    Err(_) => {
                        complete = false;
                        break;
                    }
                };
                for p in page.items {
                    lists.insert(p.id);
                }
                match page.next_offset {
                    Some(next) if next > offset && next <= 100_000 => offset = next,
                    None => break,
                    Some(_) => {
                        complete = false;
                        break;
                    }
                }
            }
        }
        for playlist in lists {
            let mut offset = 0;
            loop {
                let Some(music) = valid() else {
                    return;
                };
                // Prioritize audio authorization and its first chunks.
                if music.playback.lock().unwrap().view.phase == "loading" {
                    drop(music);
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    continue;
                }
                drop(music);
                let page = match provider.tracks(&playlist, offset, 100) {
                    Ok(p) => p,
                    Err(_) => {
                        complete = false;
                        break;
                    }
                };
                let Some(music) = valid() else {
                    return;
                };
                let _gate = music.session_gate.lock().unwrap();
                if music.same_provider(&provider).is_err() {
                    return;
                }
                if music
                    .store
                    .index(&provider.scope(), &playlist, offset, &page)
                    .is_err()
                {
                    music.diagnostics.record("sync", 0, Some("storage"));
                    complete = false;
                    break;
                }
                match page.next_offset {
                    Some(next) if next > offset && next <= 100_000 => offset = next,
                    None => break,
                    Some(_) => {
                        complete = false;
                        break;
                    }
                }
                drop(_gate);
                drop(music);
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
        if let Some(music) = valid() {
            let _gate = music.session_gate.lock().unwrap();
            if music.same_provider(&provider).is_ok() {
                let _ = music
                    .store
                    .set(&provider.scope(), "sync-complete", &complete);
            }
        }
    });
}
