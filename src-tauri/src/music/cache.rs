//! Persist lyrics and small loudness measurements, never complete audio or playback URLs.
use super::{
    lyric_cache,
    model::{Audio, Track},
    qq_quality::MAX_AUDIO_BYTES,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const RETENTION: u64 = 7 * 24 * 60 * 60 * 1000;
const MAX_TOTAL: u64 = 32 * 1024 * 1024;
const MAX_TRACKS: usize = 4096;

pub fn identity(track: &Track) -> String {
    format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{:.3}",
        track.provider, track.id, track.title, track.artist, track.album, track.duration
    )
}
pub(super) fn hash(bytes: &[u8]) -> u64 {
    extend_hash(0xcbf29ce484222325, bytes)
}
pub(super) fn extend_hash(initial: u64, bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .fold(initial, |h, b| (h ^ *b as u64).wrapping_mul(0x100000001b3))
}
fn name(identity: &str) -> String {
    format!("track-{:016x}", hash(identity.as_bytes()))
}
fn temporary(filename: &str, track: &str) -> bool {
    let Some((base, tail)) = filename.split_once('.') else {
        return false;
    };
    if base != "audio" && base != "entry" && base != "loudness" && base != track {
        return false;
    }
    let Some(tail) = tail.strip_suffix(".tmp") else {
        return false;
    };
    let Some((pid, nonce)) = tail.split_once('-') else {
        return false;
    };
    !pid.is_empty()
        && !nonce.is_empty()
        && pid.bytes().chain(nonce.bytes()).all(|b| b.is_ascii_digit())
}
pub fn scope(account: &str) -> String {
    format!("{:016x}", hash(account.as_bytes()))
}

#[derive(Serialize, Deserialize)]
struct Entry {
    version: u8,
    identity: String,
    last_played: u64,
    audio: Option<SavedAudio>,
}
#[derive(Serialize, Deserialize)]
struct SavedAudio {
    scope: String,
    variant: String,
    size: u64,
    hash: u64,
}

#[derive(Default)]
struct Policy {
    limit: u64,
    active: Option<String>,
    pending: Vec<(String, String)>,
    audio_epoch: u64,
    normalize: bool,
    lyric_epoch: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub audio_bytes: u64,
    pub lyric_bytes: u64,
    pub metadata_bytes: u64,
    pub limit_bytes: u64,
    pub pending: usize,
}
pub struct Cache {
    root: PathBuf,
    legacy: PathBuf,
    gate: Mutex<()>,
    policy: Mutex<Policy>,
}
impl Cache {
    pub fn new(directory: &Path) -> Self {
        Self {
            root: directory.join("cache"),
            legacy: directory.join("lyrics"),
            gate: Mutex::new(()),
            policy: Mutex::new(Policy {
                limit: MAX_TOTAL,
                ..Policy::default()
            }),
        }
    }
    pub fn configure(&self, mib: u8, normalize: bool) -> Result<(), String> {
        if ![8, 16, 32, 64].contains(&mib) {
            return Err("缓存容量无效".into());
        }
        let mut policy = self.policy.lock().unwrap();
        policy.limit = mib as u64 * 1024 * 1024;
        policy.normalize = normalize;
        drop(policy);
        self.prune();
        Ok(())
    }
    pub fn audio_epoch(&self) -> u64 {
        self.policy.lock().unwrap().audio_epoch
    }
    pub fn active(self: &Arc<Self>, track: Option<&Track>) {
        let next = track.map(|t| self.directory(&identity(t)).to_string_lossy().into_owned());
        let mut policy = self.policy.lock().unwrap();
        policy.active = next;
        let pending = !policy.pending.is_empty();
        drop(policy);
        if pending {
            let cache = self.clone();
            std::thread::spawn(move || cache.finish_pending());
        }
    }
    fn finish_pending(&self) {
        let _gate = self.gate.lock().unwrap();
        let mut policy = self.policy.lock().unwrap();
        let pending = std::mem::take(&mut policy.pending);
        let active = policy.active.clone();
        drop(policy);
        for (path, kind) in pending {
            if active.as_deref() == Some(&path) {
                self.policy.lock().unwrap().pending.push((path, kind));
            } else {
                let mut policy = self.policy.lock().unwrap();
                if kind == "audio" {
                    policy.audio_epoch += 1;
                } else {
                    policy.lyric_epoch += 1;
                }
                drop(policy);
                self.clear_directory(Path::new(&path), &kind);
            }
        }
    }
    fn clear_directory(&self, path: &Path, kind: &str) {
        if path.parent() != Some(self.root.as_path())
            || fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink())
        {
            return;
        }
        if kind == "audio" {
            let _ = fs::remove_file(path.join("audio.bin"));
            let _ = fs::remove_file(path.join("loudness.json"));
            if let Some(mut entry) = Self::read_entry(path) {
                entry.audio = None;
                let _ = Self::save_entry(path, &entry);
            }
        } else if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
            let _ = fs::remove_file(path.join(format!("{name}.json")));
        }
    }
    pub fn manage(&self, kind: Option<&str>) -> Result<Stats, String> {
        if kind.is_some_and(|k| k != "audio" && k != "lyrics") {
            return Err("缓存类别无效".into());
        }
        let _gate = self.gate.lock().unwrap();
        if let Some(kind) = kind {
            let mut policy = self.policy.lock().unwrap();
            if kind == "audio" {
                policy.audio_epoch += 1;
            } else {
                policy.lyric_epoch += 1;
            }
        }
        let mut audio = 0;
        let mut lyrics = 0;
        let mut metadata = 0;
        for item in fs::read_dir(&self.root).into_iter().flatten().flatten() {
            let path = item.path();
            if !item.file_type().is_ok_and(|t| t.is_dir()) || Self::read_entry(&path).is_none() {
                continue;
            }
            if let Some(kind) = kind {
                let text = path.to_string_lossy().into_owned();
                let mut policy = self.policy.lock().unwrap();
                if policy.active.as_deref() == Some(&text) {
                    if !policy.pending.contains(&(text.clone(), kind.to_string())) {
                        policy.pending.push((text, kind.to_string()));
                    }
                } else {
                    drop(policy);
                    self.clear_directory(&path, kind);
                }
            }
            // Playback owns an in-memory buffer. Old audio files are never read again.
            Self::remove_legacy_audio(&path);
            audio += fs::metadata(path.join("audio.bin")).map_or(0, |m| m.len());
            metadata += ["entry.json", "loudness.json"]
                .iter()
                .map(|name| fs::metadata(path.join(name)).map_or(0, |m| m.len()))
                .sum::<u64>();
            if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                lyrics += fs::metadata(path.join(format!("{name}.json"))).map_or(0, |m| m.len());
            }
        }
        let p = self.policy.lock().unwrap();
        Ok(Stats {
            audio_bytes: audio,
            lyric_bytes: lyrics,
            metadata_bytes: metadata,
            limit_bytes: p.limit,
            pending: p.pending.len(),
        })
    }
    fn directory(&self, identity: &str) -> PathBuf {
        self.root.join(name(identity))
    }
    fn read_entry(directory: &Path) -> Option<Entry> {
        if fs::symlink_metadata(directory)
            .ok()?
            .file_type()
            .is_symlink()
        {
            return None;
        }
        let file = fs::File::open(directory.join("entry.json")).ok()?;
        if file.metadata().ok()?.len() > 16 * 1024 {
            return None;
        }
        let mut bytes = Vec::new();
        file.take(16 * 1024 + 1).read_to_end(&mut bytes).ok()?;
        let entry: Entry = serde_json::from_slice(&bytes).ok()?;
        (entry.version == 1).then_some(entry)
    }
    fn expired(entry: &Entry, now: u64) -> bool {
        now.saturating_sub(entry.last_played) > RETENTION
    }
    fn save_entry(directory: &Path, entry: &Entry) -> std::io::Result<()> {
        atomic_write(&directory.join("entry.json"), &serde_json::to_vec(entry)?)
    }
    fn prepare(&self, track: &Track) -> std::io::Result<(PathBuf, Entry)> {
        let identity = identity(track);
        let directory = self.directory(&identity);
        if fs::symlink_metadata(&directory).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(std::io::Error::other("cache directory is a symlink"));
        }
        let now = super::now();
        if let Some(entry) = Self::read_entry(&directory) {
            if entry.identity == identity && !Self::expired(&entry, now) {
                return Ok((directory, entry));
            }
        }
        self.remove(&directory);
        fs::create_dir_all(&directory)?;
        let mut entry = Entry {
            version: 1,
            identity: identity.clone(),
            last_played: now,
            audio: None,
        };
        // Adopt the previous lyric-only cache without renewing its lifetime.
        let legacy = self.legacy.join(format!("{}.json", name(&identity)));
        if let Ok(meta) = fs::symlink_metadata(&legacy) {
            if meta.file_type().is_file() {
                let age = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                if now.saturating_sub(age) <= RETENTION {
                    if fs::rename(&legacy, directory.join(format!("{}.json", name(&identity))))
                        .is_ok()
                    {
                        entry.last_played = age;
                    }
                } else {
                    let _ = fs::remove_file(legacy);
                }
            }
        }
        Self::save_entry(&directory, &entry)?;
        Ok((directory, entry))
    }
    pub fn lyrics(
        &self,
        track: &Track,
        refresh: bool,
        fetch: impl FnOnce() -> Result<String, String>,
    ) -> crate::lyrics::LyricDocument {
        let (directory, epoch) = {
            let _guard = self.gate.lock().unwrap();
            (
                self.prepare(track).ok().map(|(d, _)| d),
                self.policy.lock().unwrap().lyric_epoch,
            )
        };
        // Keep network requests outside the cache lock, so playback controls stay responsive.
        let document = match directory {
            Some(directory) => {
                lyric_cache::load_guarded(&directory, track, refresh, fetch, |text| {
                    let _guard = self.gate.lock().unwrap();
                    if self.policy.lock().unwrap().lyric_epoch != epoch {
                        return Ok(());
                    }
                    lyric_cache::write(&directory, track, text)
                })
            }
            None => lyric_cache::uncached(track, fetch),
        };
        self.prune();
        document
    }
    pub fn analysis_enabled(&self) -> bool {
        self.policy.lock().unwrap().normalize
    }
    pub fn measure_audio(
        self: &Arc<Self>,
        track: &Track,
        account: &str,
        variant: &str,
        bytes: Arc<Vec<u8>>,
        epoch: u64,
        cancelled: Arc<AtomicBool>,
    ) {
        if !self.analysis_enabled() || bytes.is_empty() || bytes.len() > MAX_AUDIO_BYTES {
            return;
        }
        let cache = self.clone();
        let track = track.clone();
        let account = account.to_owned();
        let variant = variant.to_owned();
        let guard = cancelled.clone();
        super::loudness::schedule(
            bytes,
            cancelled,
            Box::new(move |size, checksum, lufs| {
                cache.save_measurement(
                    &track, &account, &variant, size, checksum, lufs, epoch, &guard,
                );
            }),
        );
    }
    fn save_measurement(
        &self,
        track: &Track,
        account: &str,
        variant: &str,
        size: u64,
        checksum: u64,
        lufs: Option<f64>,
        epoch: u64,
        cancelled: &AtomicBool,
    ) {
        let _guard = self.gate.lock().unwrap();
        if cancelled.load(Ordering::Acquire) || self.audio_epoch() != epoch {
            return;
        }
        let Ok((directory, mut entry)) = self.prepare(track) else {
            return;
        };
        entry.audio = Some(SavedAudio {
            scope: account.into(),
            variant: variant.into(),
            size,
            hash: checksum,
        });
        if Self::save_entry(&directory, &entry).is_ok() {
            super::loudness::save(&directory, size, checksum, lufs);
        }
        let limit = self.policy.lock().unwrap().limit;
        self.prune_inner(super::now(), limit, MAX_TRACKS);
    }
    pub fn gain(&self, track: &Track, audio: &Audio) -> f64 {
        let _guard = self.gate.lock().unwrap();
        let dir = self.directory(&identity(track));
        let Some(entry) = Self::read_entry(&dir).filter(|e| !Self::expired(e, super::now())) else {
            return 1.0;
        };
        let fingerprint = audio.stream.as_ref().map_or_else(
            || Some((audio.bytes.len() as u64, hash(&audio.bytes))),
            |s| s.fingerprint(),
        );
        let Some((size, checksum)) = fingerprint else {
            return 1.0;
        };
        let Some(saved) = entry
            .audio
            .filter(|a| a.variant == audio.quality.id && a.size == size && a.hash == checksum)
        else {
            return 1.0;
        };
        super::loudness::gain(&dir.join("audio.bin"), saved.size, saved.hash)
    }
    fn remove_legacy_audio(directory: &Path) {
        let _ = fs::remove_file(directory.join("audio.bin"));
        if let Ok(files) = fs::read_dir(directory) {
            for file in files.flatten() {
                if file
                    .file_name()
                    .to_str()
                    .is_some_and(|f| f.starts_with("audio.") && temporary(f, "audio"))
                {
                    let _ = fs::remove_file(file.path());
                }
            }
        }
    }
    pub fn played(&self, track: &Track) {
        let _guard = self.gate.lock().unwrap();
        if let Ok((directory, mut entry)) = self.prepare(track) {
            entry.last_played = super::now();
            let _ = Self::save_entry(&directory, &entry);
        }
    }
    fn remove(&self, directory: &Path) {
        // Never traverse unknown files or links, even inside this cache folder.
        if directory.parent() != Some(self.root.as_path())
            || fs::symlink_metadata(directory).is_ok_and(|m| m.file_type().is_symlink())
        {
            return;
        }
        let Some(name) = directory.file_name().and_then(|s| s.to_str()) else {
            return;
        };
        for file in [
            "audio.bin".to_string(),
            "entry.json".into(),
            format!("{name}.json"),
            "loudness.json".into(),
        ] {
            let _ = fs::remove_file(directory.join(file));
        }
        if let Ok(files) = fs::read_dir(directory) {
            for file in files.flatten() {
                if file
                    .file_name()
                    .to_str()
                    .is_some_and(|f| temporary(f, name))
                {
                    let _ = fs::remove_file(file.path());
                }
            }
        }
        let _ = fs::remove_dir(directory);
    }
    pub fn prune(&self) {
        let _guard = self.gate.lock().unwrap();
        let limit = self.policy.lock().unwrap().limit;
        self.prune_inner(super::now(), limit, MAX_TRACKS);
    }
    fn prune_inner(&self, now: u64, max_total: u64, max_tracks: usize) {
        let items = fs::read_dir(&self.root).into_iter().flatten();
        let mut entries = vec![];
        let mut protected_size = 0;
        let mut protected_count = 0;
        for item in items.flatten() {
            let filename = item.file_name();
            let Some(key) = filename.to_str().and_then(|s| s.strip_prefix("track-")) else {
                continue;
            };
            if key.len() != 16
                || !key.bytes().all(|b| b.is_ascii_hexdigit())
                || !item.file_type().is_ok_and(|t| t.is_dir())
            {
                continue;
            }
            let directory = item.path();
            Self::remove_legacy_audio(&directory);
            if let Ok(files) = fs::read_dir(&directory) {
                for file in files.flatten() {
                    if file
                        .file_name()
                        .to_str()
                        .is_some_and(|f| temporary(f, filename.to_str().unwrap()))
                        && file
                            .metadata()
                            .ok()
                            .and_then(|m| m.modified().ok())
                            .and_then(|t| t.elapsed().ok())
                            .is_some_and(|d| d > Duration::from_secs(3600))
                    {
                        let _ = fs::remove_file(file.path());
                    }
                }
            }
            let entry = Self::read_entry(&directory);
            let last = entry.as_ref().map(|e| e.last_played).unwrap_or(0);
            let protected = self.policy.lock().unwrap().active.as_deref()
                == Some(directory.to_string_lossy().as_ref());
            if protected {
                protected_size += fs::read_dir(&directory)
                    .into_iter()
                    .flatten()
                    .flatten()
                    .filter_map(|f| f.metadata().ok().map(|m| m.len()))
                    .sum::<u64>();
                protected_count += 1;
                continue;
            }
            if now.saturating_sub(last) > RETENTION {
                self.remove(&directory);
                continue;
            }
            let size: u64 = fs::read_dir(&directory)
                .into_iter()
                .flatten()
                .flatten()
                .filter_map(|f| f.metadata().ok().map(|m| m.len()))
                .sum();
            entries.push((last, directory, size));
        }
        entries.sort_by_key(|(last, _, _)| *last);
        let mut total: u64 = protected_size + entries.iter().map(|(_, _, size)| size).sum::<u64>();
        let mut count = protected_count + entries.len();
        for (_, directory, size) in entries {
            if total <= max_total && count <= max_tracks {
                break;
            }
            self.remove(&directory);
            total = total.saturating_sub(size);
            count -= 1;
        }
        // Legacy lyric files also obey seven days, including songs never replayed.
        if let Ok(items) = fs::read_dir(&self.legacy) {
            for item in items.flatten() {
                let filename = item.file_name();
                let Some(key) = filename
                    .to_str()
                    .and_then(|s| s.strip_prefix("track-"))
                    .and_then(|s| s.strip_suffix(".json"))
                else {
                    continue;
                };
                if key.len() != 16
                    || !key.bytes().all(|b| b.is_ascii_hexdigit())
                    || !item.file_type().is_ok_and(|t| t.is_file())
                {
                    continue;
                }
                if item
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|d| d > Duration::from_millis(RETENTION))
                {
                    let _ = fs::remove_file(item.path());
                }
            }
        }
    }
}

pub(super) fn atomic_write(target: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = target.with_extension(format!("{}-{nonce}.tmp", std::process::id()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn setup() -> (Arc<Cache>, Track) {
        let root = std::env::temp_dir().join(format!(
            "soundspectra-media-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        (
            Arc::new(Cache::new(&root)),
            super::super::qq::track(
                &serde_json::json!({"mid":"cache1","title":"缓存测试","interval":90}),
            )
            .unwrap(),
        )
    }
    #[test]
    fn legacy_audio_is_removed_without_losing_lyrics_measurements_or_unknown_files() {
        let (cache, track) = setup();
        cache.lyrics(&track, false, || Ok("[00:01]保留歌词".into()));
        let directory = cache.directory(&identity(&track));
        fs::write(directory.join("audio.bin"), b"old full song").unwrap();
        fs::write(directory.join("audio.123-456.tmp"), b"unfinished song").unwrap();
        fs::write(directory.join("keep.txt"), b"unrelated").unwrap();
        super::super::loudness::save(&directory, 13, 123, Some(-12.0));
        cache.prune();
        assert!(!directory.join("audio.bin").exists());
        assert!(!directory.join("audio.123-456.tmp").exists());
        assert!(directory.join("loudness.json").exists());
        assert!(directory.join("keep.txt").exists());
        let stats = cache.manage(None).unwrap();
        assert_eq!(stats.audio_bytes, 0);
        assert!(stats.lyric_bytes > 0);
        assert!(stats.metadata_bytes > 0);
        let lyrics = cache.lyrics(&track, false, || panic!("must reuse lyrics"));
        assert!(!lyrics.lines.is_empty());
        let _ = fs::remove_dir_all(cache.root.parent().unwrap());
    }
    #[test]
    fn analysis_persists_only_small_measurements_and_validates_quality_and_content() {
        let (cache, track) = setup();
        let bytes = Arc::new(super::super::loudness::test_audio());
        let cancel = Arc::new(AtomicBool::new(false));
        cache.measure_audio(
            &track,
            "a",
            "test",
            bytes.clone(),
            cache.audio_epoch(),
            cancel.clone(),
        );
        assert!(!cache.root.exists(), "normalization is off by default");
        cache.configure(32, true).unwrap();
        cache.measure_audio(
            &track,
            "a",
            "test",
            bytes.clone(),
            cache.audio_epoch(),
            cancel,
        );
        let directory = cache.directory(&identity(&track));
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while !directory.join("loudness.json").exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "analysis did not complete"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        let mut audio = Audio {
            bytes: bytes.as_ref().clone(),
            mime: "audio/wav",
            stream: None,
            quality: super::super::model::AudioQuality {
                id: "test".into(),
                label: "test".into(),
                codec: "wav".into(),
                sample_rate: None,
                bit_depth: None,
                channels: None,
                bitrate: None,
                fallback: None,
            },
        };
        assert!(cache.gain(&track, &audio) < 1.0);
        audio.quality.id = "other".into();
        assert_eq!(cache.gain(&track, &audio), 1.0);
        audio.quality.id = "test".into();
        audio.bytes[60] ^= 1;
        assert_eq!(cache.gain(&track, &audio), 1.0);
        assert!(!directory.join("audio.bin").exists());
        let stats = cache.manage(None).unwrap();
        assert_eq!(stats.audio_bytes, 0);
        assert!(stats.metadata_bytes < 4096);
        let _ = fs::remove_dir_all(cache.root.parent().unwrap());
    }
    #[test]
    fn seven_day_expiry_removes_lyrics_and_measurements_and_replay_caches_again() {
        let (cache, track) = setup();
        cache.lyrics(&track, false, || Ok("[00:01]原创歌词".into()));
        let directory = cache.directory(&identity(&track));
        let mut entry = Cache::read_entry(&directory).unwrap();
        entry.last_played = super::super::now() - RETENTION - 1;
        Cache::save_entry(&directory, &entry).unwrap();
        cache.prune();
        assert!(!directory.exists());
        cache.lyrics(&track, false, || Ok("[00:01]重新缓存".into()));
        assert!(directory.exists());
        let _ = fs::remove_dir_all(cache.root.parent().unwrap());
    }
    #[test]
    fn only_playback_renews_age_and_capacity_evicts_oldest_pair() {
        let (cache, track) = setup();
        cache.lyrics(&track, false, || Ok("[00:01]歌词".into()));
        let directory = cache.directory(&identity(&track));
        let mut entry = Cache::read_entry(&directory).unwrap();
        entry.last_played -= 10000;
        Cache::save_entry(&directory, &entry).unwrap();
        cache.lyrics(&track, true, || Ok("[00:01]歌词刷新".into()));
        assert_eq!(
            Cache::read_entry(&directory).unwrap().last_played,
            entry.last_played
        );
        cache.played(&track);
        assert!(Cache::read_entry(&directory).unwrap().last_played > entry.last_played);
        fs::write(cache.root.join("keep.txt"), "unrelated").unwrap();
        cache.prune_inner(super::super::now(), 0, 0);
        assert!(!directory.exists());
        assert!(cache.root.join("keep.txt").exists());
        let _ = fs::remove_dir_all(cache.root.parent().unwrap());
    }
    #[test]
    fn manual_clear_protects_active_lyrics_and_rejects_late_results() {
        let (cache, track) = setup();
        let epoch = cache.audio_epoch();
        cache.active(Some(&track));
        cache.lyrics(&track, false, || Ok("[00:01]正在播放".into()));
        let directory = cache.directory(&identity(&track));
        let lyric_path = directory.join(format!("{}.json", name(&identity(&track))));
        assert_eq!(cache.manage(Some("lyrics")).unwrap().pending, 1);
        assert!(lyric_path.exists());
        cache.active(None);
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while cache.manage(None).unwrap().pending > 0 {
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!lyric_path.exists());
        cache.manage(Some("audio")).unwrap();
        cache.save_measurement(
            &track,
            "a",
            "test",
            20,
            1,
            Some(-12.0),
            epoch,
            &AtomicBool::new(false),
        );
        assert!(!directory.join("loudness.json").exists());
        cache.save_measurement(
            &track,
            "a",
            "test",
            20,
            1,
            Some(-12.0),
            cache.audio_epoch(),
            &AtomicBool::new(true),
        );
        assert!(!directory.join("loudness.json").exists());
        let document = cache.lyrics(&track, true, || {
            cache.manage(Some("lyrics")).unwrap();
            Ok("[00:01]late lyric".into())
        });
        assert!(!document.lines.is_empty());
        assert!(!lyric_path.exists());
        let _ = fs::remove_dir_all(cache.root.parent().unwrap());
    }
    #[test]
    fn accepting_a_new_target_never_waits_for_cache_disk_operations() {
        let (cache, track) = setup();
        let gate = cache.gate.lock().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        let target = cache.clone();
        std::thread::spawn(move || {
            target.active(Some(&track));
            let _ = tx.send(());
        });
        let result = rx.recv_timeout(Duration::from_millis(500));
        drop(gate);
        assert!(
            result.is_ok(),
            "A cache operation blocked a newly accepted playback target"
        );
    }
}
