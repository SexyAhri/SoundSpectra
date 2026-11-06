use super::{
    online::{self, Song},
    track_key,
};
use crate::now_playing::NowPlaying;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_BYTES: u64 = 2_097_152;
const MAX_FILES: usize = 64;
const FRESH_SECONDS: u64 = 7 * 24 * 60 * 60;

#[derive(Serialize, Deserialize)]
struct Saved {
    version: u8,
    key: String,
    duration: f64,
    saved_at: u64,
    song: Song,
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn path(directory: &Path, info: &NowPlaying) -> PathBuf {
    // Stable filename only; the full key and duration are checked after reading,
    // so a hash collision cannot associate another track's lyrics.
    let key = format!("{}\u{1f}{:.3}", track_key(info), info.duration);
    let hash = key.bytes().fold(0xcbf29ce484222325u64, |hash, b| {
        (hash ^ b as u64).wrapping_mul(0x100000001b3)
    });
    directory.join(format!("amll-{hash:016x}.json"))
}
pub(super) fn read(directory: &Path, info: &NowPlaying) -> Option<(Song, bool)> {
    let path = path(directory, info);
    if fs::metadata(&path).ok()?.len() > MAX_BYTES {
        return None;
    }
    let saved: Saved = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if saved.version != 1
        || saved.key != track_key(info)
        || !saved.duration.is_finite()
        || !info.duration.is_finite()
        || (saved.duration - info.duration).abs() > 0.001
        || online::lines(&saved.song, info).is_none()
    {
        return None;
    }
    let fresh = now()
        .checked_sub(saved.saved_at)
        .is_some_and(|age| age < FRESH_SECONDS);
    Some((saved.song, fresh))
}
pub(super) fn write(directory: &Path, info: &NowPlaying, song: Song) -> Result<(), String> {
    if online::lines(&song, info).is_none() {
        return Err("不缓存无效歌词".into());
    }
    let saved = Saved {
        version: 1,
        key: track_key(info),
        duration: info.duration,
        saved_at: now(),
        song,
    };
    let bytes = serde_json::to_vec(&saved).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("歌词缓存过大".into());
    }
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let target = path(directory, info);
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
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    prune(directory);
    Ok(())
}
fn prune(directory: &Path) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut files: Vec<_> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            if !name.starts_with("amll-") || !name.ends_with(".json") {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            metadata
                .is_file()
                .then(|| (metadata.modified().unwrap_or(UNIX_EPOCH), entry.path()))
        })
        .collect();
    files.sort_by_key(|(modified, _)| *modified);
    for (_, path) in files.iter().take(files.len().saturating_sub(MAX_FILES)) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn track() -> NowPlaying {
        NowPlaying {
            title: "微光".into(),
            artist: "原创作者".into(),
            duration: 10.0,
            ..Default::default()
        }
    }
    fn song() -> Song {
        Song { id: 1, filename: "1.ttml".into(), music_names: vec!["微光".into()], artist_names: vec!["原创作者".into()], lyrics: Some(r#"<tt xmlns="http://www.w3.org/ns/ttml"><body dur="10"><div><p begin="1" end="2">原创测试</p></div></body></tt>"#.into()), ..Default::default() }
    }
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!(
                    "soundspectra-lyrics-{}-{}",
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
    #[test]
    fn persists_across_reads_and_replaces_atomically() {
        let dir = Temp::new();
        write(&dir.0, &track(), song()).unwrap();
        assert!(read(&dir.0, &track()).unwrap().1);
        let mut revision = song();
        revision.id = 2;
        write(&dir.0, &track(), revision).unwrap();
        assert_eq!(read(&dir.0, &track()).unwrap().0.id, 2);
        let mut other = track();
        other.duration = 20.0;
        assert!(read(&dir.0, &other).is_none());
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }
    #[test]
    fn detects_staleness_corruption_and_identity_collisions() {
        let dir = Temp::new();
        write(&dir.0, &track(), song()).unwrap();
        let file = path(&dir.0, &track());
        let mut saved: Saved = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        saved.saved_at = now() - FRESH_SECONDS - 1;
        fs::write(&file, serde_json::to_vec(&saved).unwrap()).unwrap();
        assert!(!read(&dir.0, &track()).unwrap().1);
        saved.key = "另一个歌曲".into();
        fs::write(&file, serde_json::to_vec(&saved).unwrap()).unwrap();
        assert!(read(&dir.0, &track()).is_none());
        fs::write(&file, "broken").unwrap();
        assert!(read(&dir.0, &track()).is_none());
    }
    #[test]
    fn cache_limit_preserves_unrelated_files() {
        let dir = Temp::new();
        fs::create_dir_all(&dir.0).unwrap();
        fs::write(dir.0.join("keep.txt"), "keep").unwrap();
        for i in 0..MAX_FILES + 3 {
            fs::write(dir.0.join(format!("amll-{i:016x}.json")), "{}").unwrap();
        }
        prune(&dir.0);
        assert!(dir.0.join("keep.txt").exists());
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), MAX_FILES + 1);
    }
}
