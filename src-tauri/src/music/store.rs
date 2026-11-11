//! Account-scoped library metadata. Authentication and resource URLs never enter this database.
use super::{model::Track, playback::View};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex, time::Duration};

#[derive(Serialize, Deserialize)]
struct StoredTrack {
    track: Track,
    numeric_id: u64,
    media_id: String,
    audio_sizes: std::collections::HashMap<String, u64>,
}
impl StoredTrack {
    fn from(t: &Track) -> Self {
        Self {
            track: t.clone(),
            numeric_id: t.numeric_id,
            media_id: t.media_id.clone(),
            audio_sizes: t.audio_sizes.clone(),
        }
    }
    fn track(mut self) -> Track {
        self.track.numeric_id = self.numeric_id;
        self.track.media_id = self.media_id;
        self.track.audio_sizes = self.audio_sizes;
        self.track
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub lyric_mib: u8,
    pub normalize: bool,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            lyric_mib: 32,
            normalize: false,
        }
    }
}
#[derive(Serialize, Deserialize)]
struct Session {
    queue: Vec<StoredTrack>,
    entry_ids: Vec<String>,
    index: usize,
    position: f64,
    volume: f64,
    muted: bool,
    mode: super::queue::PlayMode,
    #[serde(default)]
    playing: bool,
    #[serde(default)]
    suspended: Option<bool>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedPage {
    pub items: Vec<Track>,
    pub total: usize,
    pub synced: usize,
    pub complete: bool,
    pub updated: u64,
    pub next_offset: Option<usize>,
}
pub struct Store {
    path: PathBuf,
    gate: Mutex<()>,
}
impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            gate: Mutex::new(()),
        }
    }
    fn open(&self) -> Result<Connection, String> {
        let run = || -> Result<Connection, Box<dyn std::error::Error>> {
            if let Some(parent) = self.path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut db = Connection::open(&self.path)?;
            db.busy_timeout(Duration::from_secs(5))?;
            let version: u32 = db.pragma_query_value(None, "user_version", |r| r.get(0))?;
            if version > 2 {
                return Err("音乐库由较新版本创建".into());
            }
            if version < 2 {
                // VACUUM INTO creates a consistent backup, including WAL contents.
                if self.path.metadata().is_ok_and(|m| m.len() > 0) {
                    let backup = self
                        .path
                        .with_extension(format!("migration-{}.bak", super::now()));
                    db.execute("VACUUM INTO ?1", [backup.to_string_lossy().as_ref()])?;
                }
                let tx = db.transaction()?;
                tx.execute_batch("CREATE TABLE IF NOT EXISTS songs(scope TEXT, id TEXT, data TEXT NOT NULL, PRIMARY KEY(scope,id));
                    CREATE TABLE IF NOT EXISTS playlists(scope TEXT, id TEXT, total INTEGER, complete INTEGER, updated INTEGER, PRIMARY KEY(scope,id));
                    CREATE TABLE IF NOT EXISTS playlist_tracks(scope TEXT, playlist TEXT, ordinal INTEGER, song TEXT, PRIMARY KEY(scope,playlist,ordinal));
                    CREATE TABLE IF NOT EXISTS state(scope TEXT, key TEXT, data TEXT NOT NULL, PRIMARY KEY(scope,key));
                    CREATE TABLE IF NOT EXISTS recent(scope TEXT, song TEXT, played INTEGER, PRIMARY KEY(scope,song));
                    CREATE TABLE IF NOT EXISTS offsets(scope TEXT, song TEXT, seconds REAL, PRIMARY KEY(scope,song));
                    PRAGMA user_version=1;")?;
                if version < 2 {
                    tx.execute_batch("ALTER TABLE playlists ADD COLUMN next_offset INTEGER NOT NULL DEFAULT 0; PRAGMA user_version=2;")?;
                }
                tx.commit()?;
            }
            Ok(db)
        };
        run().map_err(|_| "无法读写音乐库数据库，请检查磁盘空间和权限".into())
    }
    pub fn value<T: for<'a> Deserialize<'a>>(
        &self,
        scope: &str,
        key: &str,
    ) -> Result<Option<T>, String> {
        let _gate = self.gate.lock().unwrap();
        let db = self.open()?;
        let data: Option<String> = db
            .query_row(
                "SELECT data FROM state WHERE scope=?1 AND key=?2",
                params![scope, key],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "读取音乐偏好失败")?;
        data.map(|s| serde_json::from_str(&s).map_err(|_| "音乐库数据格式错误".into()))
            .transpose()
    }
    pub fn set<T: Serialize>(&self, scope: &str, key: &str, value: &T) -> Result<(), String> {
        let _gate = self.gate.lock().unwrap();
        self.open()?
            .execute(
                "INSERT OR REPLACE INTO state VALUES(?1,?2,?3)",
                params![
                    scope,
                    key,
                    serde_json::to_string(value).map_err(|_| "音乐库序列化失败")?
                ],
            )
            .map_err(|_| "保存音乐偏好失败")?;
        Ok(())
    }
    pub fn save(&self, scope: &str, view: &View) -> Result<(), String> {
        self.set(
            scope,
            "session",
            &Session {
                queue: view.queue.iter().map(StoredTrack::from).collect(),
                entry_ids: view.entry_ids.clone(),
                index: view.index,
                position: view.position,
                volume: view.volume,
                muted: view.muted,
                mode: view.mode,
                playing: view.playing && !view.suspended,
                suspended: Some(view.suspended),
            },
        )
    }
    pub fn restore(&self, scope: &str) -> Result<Option<View>, String> {
        Ok(self.value::<Session>(scope, "session")?.map(|s| {
            let mut v = View {
                queue: s
                    .queue
                    .into_iter()
                    .take(20_000)
                    .map(StoredTrack::track)
                    .collect(),
                entry_ids: s.entry_ids,
                index: s.index,
                position: s.position.max(0.0),
                volume: s.volume.clamp(0.0, 1.0),
                muted: s.muted,
                mode: s.mode,
                ..View::default()
            };
            v.index = v.index.min(v.queue.len().saturating_sub(1));
            v.duration = v.queue.get(v.index).map_or(0.0, |t| t.duration);
            v.position = v.position.min(v.duration);
            // Legacy sessions did not record playback intent. Keep their queue
            // available without guessing whether the user had paused it.
            v.suspended = !v.queue.is_empty() && s.suspended.unwrap_or(true);
            v.playing = s.playing && !v.suspended && !v.queue.is_empty();
            v.phase = if v.suspended {
                "suspended"
            } else if v.queue.is_empty() {
                "idle"
            } else {
                "paused"
            }
            .into();
            v
        }))
    }
    pub fn index(
        &self,
        scope: &str,
        playlist: &str,
        offset: usize,
        page: &super::model::Page<Track>,
    ) -> Result<(), String> {
        let _gate = self.gate.lock().unwrap();
        let mut db = self.open()?;
        let mut run = || -> rusqlite::Result<()> {
            let tx = db.transaction()?;
            // Replace only the fetched span. Keep last-known later pages while
            // refreshing, so a late first page cannot erase a completed sync.
            let end = page.next_offset.unwrap_or(page.total) as i64;
            tx.execute("DELETE FROM playlist_tracks WHERE scope=?1 AND playlist=?2 AND (ordinal>=?3 AND ordinal<?4 OR ordinal>=?5)",
                params![scope,playlist,offset as i64,end,page.total as i64])?;
            for (i, t) in page.items.iter().enumerate() {
                let id = format!("{}:{}", t.provider, t.id);
                let data = serde_json::to_string(&StoredTrack::from(t)).unwrap();
                tx.execute(
                    "INSERT OR REPLACE INTO songs VALUES(?1,?2,?3)",
                    params![scope, id, data],
                )?;
                tx.execute(
                    "INSERT OR REPLACE INTO playlist_tracks VALUES(?1,?2,?3,?4)",
                    params![scope, playlist, (offset + i) as i64, id],
                )?;
            }
            let previous: i64 = tx
                .query_row(
                    "SELECT next_offset FROM playlists WHERE scope=?1 AND id=?2",
                    params![scope, playlist],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or(0);
            let contiguous = offset == 0 || previous == offset as i64;
            let complete = contiguous && page.next_offset.is_none();
            let next = if contiguous {
                page.next_offset.unwrap_or(page.total) as i64
            } else {
                previous
            };
            tx.execute("INSERT OR REPLACE INTO playlists(scope,id,total,complete,updated,next_offset) VALUES(?1,?2,?3,?4,?5,?6)",params![scope,playlist,page.total as i64,complete,super::now() as i64,next])?;
            tx.commit()
        };
        run().map_err(|_| "保存歌单索引失败".into())
    }
    pub fn tracks(
        &self,
        scope: &str,
        playlist: Option<&str>,
        recent: bool,
    ) -> Result<IndexedPage, String> {
        let _gate = self.gate.lock().unwrap();
        let db = self.open()?;
        let (sql, selector) = if recent {
            ("SELECT s.data FROM recent r JOIN songs s ON s.scope=r.scope AND s.id=r.song WHERE r.scope=?1 AND ?2 IS NOT NULL ORDER BY r.played DESC LIMIT 1000", "recent")
        } else if let Some(p) = playlist {
            ("SELECT s.data FROM playlist_tracks p JOIN songs s ON s.scope=p.scope AND s.id=p.song WHERE p.scope=?1 AND p.playlist=?2 ORDER BY p.ordinal LIMIT 20000", p)
        } else {
            (
                "SELECT data FROM songs WHERE scope=?1 AND ?2 IS NOT NULL LIMIT 100000",
                "all",
            )
        };
        let mut query = db.prepare(sql).map_err(|_| "读取歌曲索引失败")?;
        let items = query
            .query_map(params![scope, selector], |r| r.get::<_, String>(0))
            .map_err(|_| "读取歌曲索引失败")?
            .filter_map(Result::ok)
            .filter_map(|s| serde_json::from_str::<StoredTrack>(&s).ok())
            .map(StoredTrack::track)
            .collect::<Vec<_>>();
        let (total, complete, updated, next_offset) = if let Some(p) = playlist {
            db.query_row(
                "SELECT total,complete,updated,next_offset FROM playlists WHERE scope=?1 AND id=?2",
                params![scope, p],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)? as usize,
                        r.get::<_, bool>(1)?,
                        r.get::<_, i64>(2)? as u64,
                        Some(r.get::<_, i64>(3)? as usize),
                    ))
                },
            )
            .optional()
            .map_err(|_| "读取同步状态失败")?
            .unwrap_or((0, false, 0, Some(0)))
        } else {
            let incomplete: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM playlists WHERE scope=?1 AND complete=0)",
                    [scope],
                    |r| r.get(0),
                )
                .map_err(|_| "读取同步进度失败")?;
            let all_synced = db
                .query_row(
                    "SELECT data FROM state WHERE scope=?1 AND key='sync-complete'",
                    [scope],
                    |r| r.get::<_, String>(0),
                )
                .optional()
                .map_err(|_| "读取同步状态失败")?
                .is_some_and(|s| s == "true");
            (items.len(), recent || (!incomplete && all_synced), 0, None)
        };
        Ok(IndexedPage {
            synced: items.len(),
            items,
            total,
            complete,
            updated,
            next_offset: if complete { None } else { next_offset },
        })
    }
    pub fn played(&self, scope: &str, track: &Track) -> Result<(), String> {
        let _gate = self.gate.lock().unwrap();
        let mut db = self.open()?;
        let mut run = || -> rusqlite::Result<()> {
            let tx = db.transaction()?;
            let id = format!("{}:{}", track.provider, track.id);
            tx.execute(
                "INSERT OR REPLACE INTO songs VALUES(?1,?2,?3)",
                params![
                    scope,
                    id,
                    serde_json::to_string(&StoredTrack::from(track)).unwrap()
                ],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO recent VALUES(?1,?2,?3)",
                params![scope, id, super::now() as i64],
            )?;
            tx.execute("DELETE FROM recent WHERE scope=?1 AND song NOT IN (SELECT song FROM recent WHERE scope=?1 ORDER BY played DESC LIMIT 1000)",[scope])?;
            tx.commit()
        };
        run().map_err(|_| "保存最近播放失败".into())
    }
    pub fn offset(&self, scope: &str, song: &str, value: Option<f64>) -> Result<f64, String> {
        let _gate = self.gate.lock().unwrap();
        let db = self.open()?;
        if let Some(v) = value {
            if !v.is_finite() || !(-10.0..=10.0).contains(&v) || (v * 2.0).fract() != 0.0 {
                return Err("歌词偏移必须为 ±10 秒内的 0.5 秒倍数".into());
            }
            db.execute(
                "INSERT OR REPLACE INTO offsets VALUES(?1,?2,?3)",
                params![scope, song, v],
            )
            .map_err(|_| "保存歌词偏移失败")?;
        }
        db.query_row(
            "SELECT seconds FROM offsets WHERE scope=?1 AND song=?2",
            params![scope, song],
            |r| r.get(0),
        )
        .optional()
        .map(|v| v.unwrap_or(0.0))
        .map_err(|_| "读取歌词偏移失败".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_gib_preference_migrates_to_small_lyric_budget_without_losing_normalization() {
        let prefs: Preferences =
            serde_json::from_value(serde_json::json!({"cacheGib":8,"normalize":true})).unwrap();
        assert_eq!(prefs.lyric_mib, 32);
        assert!(prefs.normalize);
        let value = serde_json::to_value(prefs).unwrap();
        assert!(value.get("cacheGib").is_none());
        assert_eq!(value["lyricMib"], 32);
    }
    #[test]
    fn account_isolation_native_identifiers_and_playback_intent_restore() {
        let path = std::env::temp_dir().join(format!(
            "music-store-{}-{}.sqlite",
            std::process::id(),
            super::super::now()
        ));
        let store = Store::new(path.clone());
        let t = super::super::qq::track(
            &serde_json::json!({"mid":"native","id":123,"title":"原版 (Live)","interval":90}),
        )
        .unwrap();
        // Existing caches may contain metadata from the retired cloud editor.
        let mut legacy = serde_json::to_value(StoredTrack::from(&t)).unwrap();
        legacy["song_type"] = serde_json::json!(111);
        let t = serde_json::from_value::<StoredTrack>(legacy)
            .unwrap()
            .track();
        let view = View {
            queue: vec![t],
            entry_ids: vec!["stable".into()],
            position: 42.0,
            playing: true,
            volume: 0.4,
            ..View::default()
        };
        store.save("a", &view).unwrap();
        assert!(store.restore("b").unwrap().is_none());
        let r = store.restore("a").unwrap().unwrap();
        assert!(r.playing);
        assert!(!r.suspended);
        assert_eq!(r.position, 42.0);
        assert_eq!(r.queue[0].numeric_id, 123);
        assert_eq!(r.entry_ids, vec!["stable"]);
        let mut paused = view.clone();
        paused.playing = false;
        store.save("paused", &paused).unwrap();
        let restored = store.restore("paused").unwrap().unwrap();
        assert!(!restored.playing);
        assert!(!restored.suspended);
        assert_eq!(restored.phase, "paused");
        assert_eq!(restored.position, 42.0);
        paused.suspended = true;
        store.save("external", &paused).unwrap();
        let restored = store.restore("external").unwrap().unwrap();
        assert!(!restored.playing);
        assert!(restored.suspended);
        let mut legacy =
            serde_json::to_value(store.value::<Session>("a", "session").unwrap().unwrap()).unwrap();
        legacy.as_object_mut().unwrap().remove("playing");
        legacy.as_object_mut().unwrap().remove("suspended");
        store.set("legacy", "session", &legacy).unwrap();
        let restored = store.restore("legacy").unwrap().unwrap();
        assert!(!restored.playing);
        assert!(restored.suspended);
        assert_eq!(restored.position, 42.0);
        store.played("a", &r.queue[0]).unwrap();
        store.played("a", &r.queue[0]).unwrap();
        assert_eq!(store.tracks("a", None, true).unwrap().total, 1);
        assert_eq!(store.tracks("b", None, true).unwrap().total, 0);
        assert_eq!(store.offset("a", "native", Some(0.5)).unwrap(), 0.5);
        assert_eq!(store.offset("b", "native", None).unwrap(), 0.0);
        assert!(store.offset("a", "native", Some(f64::NAN)).is_err());
        let _ = std::fs::remove_file(path);
    }
    #[test]
    fn migration_preserves_state_and_filtered_pages_must_be_contiguous() {
        let root = std::env::temp_dir().join(format!(
            "music-migration-{}-{}",
            std::process::id(),
            super::super::now()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("library.sqlite");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE playlists(scope TEXT,id TEXT,total INTEGER,complete INTEGER,updated INTEGER,PRIMARY KEY(scope,id)); CREATE TABLE state(scope TEXT,key TEXT,data TEXT NOT NULL,PRIMARY KEY(scope,key)); PRAGMA user_version=1;").unwrap();
        db.execute("INSERT INTO state VALUES('a','fixture','42')", [])
            .unwrap();
        drop(db);
        let store = Store::new(path);
        assert_eq!(store.value::<i32>("a", "fixture").unwrap(), Some(42));
        assert!(std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .any(|f| f.path().extension().is_some_and(|e| e == "bak")));
        let t =
            super::super::qq::track(&serde_json::json!({"mid":"first","title":"first"})).unwrap();
        let mut page = super::super::model::Page {
            items: vec![t],
            total: 201,
            next_offset: Some(100),
            filtered: 99,
        };
        store.index("a", "list", 0, &page).unwrap();
        page.items.clear();
        page.next_offset = None;
        store.index("a", "list", 200, &page).unwrap();
        let index = store.tracks("a", Some("list"), false).unwrap();
        assert!(!index.complete);
        assert_eq!(index.next_offset, Some(100));
        page.next_offset = Some(200);
        store.index("a", "list", 100, &page).unwrap();
        page.next_offset = None;
        store.index("a", "list", 200, &page).unwrap();
        assert!(store.tracks("a", Some("list"), false).unwrap().complete);
        for i in 0..1003 {
            let t = super::super::qq::track(
                &serde_json::json!({"mid":format!("song{i}"),"title":"history"}),
            )
            .unwrap();
            store.played("a", &t).unwrap();
        }
        assert_eq!(store.tracks("a", None, true).unwrap().items.len(), 1000);
        let _ = std::fs::remove_dir_all(root);
    }
    #[test]
    fn partial_refresh_retains_later_pages_until_their_replacement_arrives() {
        let root = std::env::temp_dir().join(format!(
            "music-index-refresh-{}-{}",
            std::process::id(),
            super::super::now()
        ));
        let store = Store::new(root.join("library.sqlite"));
        let track =
            |id: &str| super::super::qq::track(&serde_json::json!({"mid":id,"title":id})).unwrap();
        let first = super::super::model::Page {
            items: vec![track("a")],
            total: 2,
            next_offset: Some(1),
            filtered: 0,
        };
        let last = super::super::model::Page {
            items: vec![track("b")],
            total: 2,
            next_offset: None,
            filtered: 0,
        };
        store.index("a", "list", 0, &first).unwrap();
        store.index("a", "list", 1, &last).unwrap();
        assert!(store.tracks("a", Some("list"), false).unwrap().complete);
        store.index("a", "list", 0, &first).unwrap();
        let partial = store.tracks("a", Some("list"), false).unwrap();
        assert_eq!(partial.items.len(), 2);
        assert!(!partial.complete);
        let shorter = super::super::model::Page {
            items: vec![track("new")],
            total: 1,
            next_offset: None,
            filtered: 0,
        };
        store.index("a", "list", 0, &shorter).unwrap();
        let final_page = store.tracks("a", Some("list"), false).unwrap();
        assert_eq!(final_page.items.len(), 1);
        assert_eq!(final_page.items[0].id, "new");
        assert!(final_page.complete);
        let _ = std::fs::remove_dir_all(root);
    }
}
