//! Lyric text storage inside the shared seven-day media cache.
use super::model::Track;
use crate::lyrics::{parse, LyricDocument};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_ENTRY: u64 = 2 * 1024 * 1024;
const MAX_FILES: usize = 4096;
const MAX_TOTAL: u64 = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Saved {
    version: u8,
    identity: String,
    lyric: String,
}

fn identity(track: &Track) -> String {
    super::cache::identity(track)
}
fn path(directory: &Path, identity: &str) -> PathBuf {
    let hash = identity.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ b as u64).wrapping_mul(0x100000001b3)
    });
    directory.join(format!("track-{hash:016x}.json"))
}
fn read(directory: &Path, track: &Track) -> Option<String> {
    let key = identity(track);
    let path = path(directory, &key);
    let file = fs::File::open(&path).ok()?;
    if file.metadata().ok()?.len() > MAX_ENTRY {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_ENTRY + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() as u64 > MAX_ENTRY {
        return None;
    }
    let saved: Saved = serde_json::from_slice(&bytes).ok()?;
    if saved.version != 1 || saved.identity != key || parse(&saved.lyric).ok()?.is_empty() {
        return None;
    }
    Some(saved.lyric)
}
pub(super) fn write(directory: &Path, track: &Track, lyric: &str) -> Result<(), String> {
    if parse(lyric)?.is_empty() {
        return Err("不缓存空歌词".into());
    }
    let key = identity(track);
    let bytes = serde_json::to_vec(&Saved {
        version: 1,
        identity: key.clone(),
        lyric: lyric.into(),
    })
    .map_err(|_| "歌词缓存无法编码")?;
    if bytes.len() as u64 > MAX_ENTRY {
        return Err("歌词缓存超过单曲大小上限".into());
    }
    fs::create_dir_all(directory).map_err(|_| "无法创建歌词缓存目录")?;
    let target = path(directory, &key);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = target.with_extension(format!("{}-{nonce}.tmp", std::process::id()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
        return Err("本地歌词缓存保存失败".into());
    }
    prune(directory, MAX_FILES, MAX_TOTAL);
    Ok(())
}
fn prune(directory: &Path, max_files: usize, max_total: u64) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let hash = name
                .to_str()?
                .strip_prefix("track-")?
                .strip_suffix(".json")?;
            if hash.len() != 16
                || !hash.bytes().all(|c| c.is_ascii_hexdigit())
                || !entry.file_type().ok()?.is_file()
            {
                return None;
            }
            let m = entry.metadata().ok()?;
            Some((m.modified().unwrap_or(UNIX_EPOCH), entry.path(), m.len()))
        })
        .collect();
    files.sort_by_key(|(modified, _, _)| *modified);
    let mut total: u64 = files.iter().map(|(_, _, size)| size).sum();
    let mut count = files.len();
    for (_, path, size) in files {
        if count <= max_files && total <= max_total {
            break;
        }
        if fs::remove_file(path).is_ok() {
            count -= 1;
            total = total.saturating_sub(size);
        }
    }
}

#[cfg(test)]
pub fn load(
    directory: &Path,
    track: &Track,
    refresh: bool,
    fetch: impl FnOnce() -> Result<String, String>,
) -> LyricDocument {
    load_guarded(directory, track, refresh, fetch, |text| {
        write(directory, track, text)
    })
}
pub fn uncached(track: &Track, fetch: impl FnOnce() -> Result<String, String>) -> LyricDocument {
    load_inner(None, track, false, fetch, |_| Ok(()))
}
pub fn load_guarded(
    directory: &Path,
    track: &Track,
    refresh: bool,
    fetch: impl FnOnce() -> Result<String, String>,
    commit: impl FnOnce(&str) -> Result<(), String>,
) -> LyricDocument {
    load_inner(Some(directory), track, refresh, fetch, commit)
}
fn load_inner(
    directory: Option<&Path>,
    track: &Track,
    refresh: bool,
    fetch: impl FnOnce() -> Result<String, String>,
    commit: impl FnOnce(&str) -> Result<(), String>,
) -> LyricDocument {
    let cached = directory.and_then(|d| read(d, track));
    let (lyric, message, mut issue) = if !refresh && cached.is_some() {
        (cached.unwrap(), "本地歌词缓存", None)
    } else {
        match fetch().and_then(|text| {
            if parse(&text)?.is_empty() {
                Err("该歌曲暂未提供可用歌词".into())
            } else {
                Ok(text)
            }
        }) {
            Ok(text) => {
                let issue = directory.map_or_else(
                    || Some("本地缓存不可用，本次歌词未保存".into()),
                    |_| commit(&text).err(),
                );
                (text, "QQ 音乐歌词", issue)
            }
            Err(error) => match cached {
                Some(text) => (text, "本地歌词缓存", Some(error)),
                None => (String::new(), "该歌曲暂未提供可用歌词", Some(error)),
            },
        }
    };
    let lines = parse(&lyric).unwrap_or_default();
    if lines.is_empty() && issue.is_none() {
        issue = Some("歌词内容不可用".into());
    }
    LyricDocument {
        key: format!("{}\u{1f}{}\u{1f}{}", track.title, track.artist, track.album),
        status: if lines.is_empty() { "missing" } else { "ready" }.into(),
        message: message.into(),
        lines,
        issue,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                    "soundspectra-music-lyrics-{}-{}",
                    std::process::id(),
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                )))
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn track() -> Track {
        super::super::qq::track(&json!({"mid":"example1","title":"原创歌曲","interval":100}))
            .unwrap()
    }
    #[test]
    fn survives_restart_skips_network_and_keeps_cached_lyrics_on_refresh_failure() {
        let dir = Temp::new();
        let t = track();
        assert_eq!(
            load(&dir.0, &t, false, || Ok("[00:01]原创测试".into())).status,
            "ready"
        );
        let hit = load(&dir.0, &t, false, || {
            panic!("valid local lyrics must skip the network")
        });
        assert_eq!(hit.message, "本地歌词缓存");
        assert_eq!(hit.lines[0].text, "原创测试");
        let stale = load(&dir.0, &t, true, || Err("离线".into()));
        assert_eq!(stale.status, "ready");
        assert_eq!(stale.issue.as_deref(), Some("离线"));
        let fresh = load(&dir.0, &t, true, || Ok("[00:02]更新后的歌词".into()));
        assert!(fresh.issue.is_none());
        assert_eq!(
            load(&dir.0, &t, false, || panic!(
                "refresh must replace the local cache"
            ))
            .lines[0]
                .text,
            "更新后的歌词"
        );
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }
    #[test]
    fn corrupt_mismatched_and_empty_lyrics_do_not_hide_real_results() {
        let dir = Temp::new();
        let t = track();
        write(&dir.0, &t, "[00:01]正确版本").unwrap();
        let file = path(&dir.0, &identity(&t));
        let mut saved: Saved = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        saved.identity = "不同平台或歌曲版本".into();
        fs::write(&file, serde_json::to_vec(&saved).unwrap()).unwrap();
        assert!(read(&dir.0, &t).is_none());
        fs::write(&file, "broken").unwrap();
        assert_eq!(
            load(&dir.0, &t, false, || Ok("[00:02]重新获取".into())).lines[0].text,
            "重新获取"
        );
        assert!(write(&dir.0, &t, "").is_err());
        let mut other = t.clone();
        other.provider = "other".into();
        assert!(read(&dir.0, &other).is_none());
        other = t;
        other.album = "现场版".into();
        assert!(read(&dir.0, &other).is_none());
    }
    #[test]
    fn bounds_storage_without_removing_unrelated_files() {
        let dir = Temp::new();
        fs::create_dir_all(&dir.0).unwrap();
        fs::write(dir.0.join("keep.txt"), "safe").unwrap();
        fs::write(dir.0.join("track-private.json"), "safe").unwrap();
        for i in 0..4 {
            fs::write(dir.0.join(format!("track-{i:016x}.json")), vec![0; 16]).unwrap();
        }
        prune(&dir.0, 2, 16);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 3);
        assert!(dir.0.join("keep.txt").exists());
        assert!(dir.0.join("track-private.json").exists());
    }
}
