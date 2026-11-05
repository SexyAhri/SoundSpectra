use super::locations::SavedLocations;
use crate::AppState;
use std::{
    collections::{HashSet, VecDeque},
    fs,
    path::{Path, PathBuf},
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, Instant},
};

#[derive(Clone)]
pub struct Entry {
    pub path: PathBuf,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: Option<f64>,
}
#[derive(Default)]
pub struct Library {
    pub entries: Vec<Entry>,
    pub scanning: bool,
    pub generation: u64,
    pub discovering: bool,
    pub directory_issue: Option<String>,
    pub rescan_requested: bool,
}

pub struct Scanner {
    queue: VecDeque<(PathBuf, u8, bool)>,
    current: Option<(fs::ReadDir, u8, bool)>,
    seen: HashSet<PathBuf>,
    files: HashSet<PathBuf>,
    depth_limit: u8,
}
impl Scanner {
    pub fn new(roots: Vec<PathBuf>) -> Self {
        Self {
            queue: roots.into_iter().map(|p| (p, 0, false)).collect(),
            current: None,
            seen: HashSet::new(),
            files: HashSet::new(),
            depth_limit: 14,
        }
    }
    pub fn locations(roots: Vec<PathBuf>) -> Self {
        Self {
            depth_limit: 0,
            ..Self::new(roots)
        }
    }
    fn targeted(roots: Vec<PathBuf>) -> Self {
        Self {
            depth_limit: 4,
            ..Self::new(roots)
        }
    }
    pub fn step(&mut self) -> (Vec<Entry>, bool) {
        let start = Instant::now();
        let mut entries = Vec::new();
        let mut visited = 0;
        while visited < 512
            && start.elapsed() < Duration::from_millis(100)
            && self.seen.len() < 100_000
            && self.files.len() < 50000
        {
            if self.current.is_none() {
                let Some((directory, depth, parent_cache)) = self.queue.pop_front() else {
                    break;
                };
                if !self.seen.insert(directory.clone()) {
                    continue;
                }
                visited += 1;
                let name = directory
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();
                let cache = parent_cache
                    || [
                        "lyric",
                        "lyrics",
                        "歌词",
                        "lrc",
                        "krc",
                        "qqmusic",
                        "cloudmusic",
                        "kugou",
                        "kuwo",
                        "kwmusic",
                        "sodamusic",
                        "汽水",
                        "酷狗",
                        "酷我",
                        "网易云",
                    ]
                    .iter()
                    .any(|word| name.contains(word));
                let Ok(children) = fs::read_dir(&directory) else {
                    continue;
                };
                self.current = Some((children, depth, cache));
            }
            let (children, depth, cache) = self.current.as_mut().unwrap();
            let (depth, cache) = (*depth, *cache);
            let Some(item) = children.next() else {
                self.current = None;
                continue;
            };
            visited += 1;
            if let Ok(item) = item {
                let Ok(kind) = item.file_type() else { continue };
                if kind.is_symlink() {
                    continue;
                }
                #[cfg(windows)]
                {
                    use std::os::windows::fs::MetadataExt;
                    if item
                        .metadata()
                        .is_ok_and(|m| m.file_attributes() & 0x400 != 0)
                    {
                        continue;
                    }
                }
                let path = item.path();
                if kind.is_dir() {
                    let name = item.file_name().to_string_lossy().to_lowercase();
                    if [
                        "windows",
                        "$recycle.bin",
                        "system volume information",
                        ".git",
                        "node_modules",
                        "target",
                        ".cache",
                        ".codex",
                        ".cargo",
                        ".rustup",
                        "winsxs",
                        "packages",
                        "cache2",
                    ]
                    .contains(&name.as_str())
                    {
                        continue;
                    }
                    if self.queue.len() < 100_000
                        && depth < self.depth_limit
                        && (depth < 8 || cache && depth < 14)
                    {
                        self.queue.push_back((path, depth + 1, cache));
                    }
                } else if kind.is_file() && self.files.len() < 50000 {
                    let extension = path
                        .extension()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_lowercase();
                    if !["qrc", "krc", "lrc", "yrc", "lyric", "lrcx"].contains(&extension.as_str())
                        && !(cache && extension == "json")
                    {
                        continue;
                    }
                    if !self.files.insert(path.clone()) {
                        continue;
                    }
                    if let Some(entry) = describe(path) {
                        entries.push(entry);
                    }
                }
            }
        }
        (
            entries,
            (self.current.is_some() || !self.queue.is_empty())
                && self.seen.len() < 100_000
                && self.files.len() < 50000,
        )
    }
}

fn describe(path: PathBuf) -> Option<Entry> {
    let name = path.file_name()?.to_string_lossy();
    if name.ends_with("_qmts.qrc") || name.ends_with("_qmRoma.qrc") {
        return None;
    }
    let parts: Vec<_> = name.split(" - ").collect();
    if name.ends_with("_qm.qrc") && parts.len() >= 4 {
        return Some(Entry {
            path: path.clone(),
            artist: parts[0].into(),
            title: parts[1].into(),
            duration: parts[2].parse().ok(),
            album: parts[3..].join(" - ").trim_end_matches("_qm.qrc").into(),
        });
    }
    if fs::metadata(&path).ok()?.len() > 1_048_576 {
        return None;
    }
    let content = super::decode(&fs::read(&path).ok()?).ok()?;
    let tag = |name: &str| {
        let prefix = format!("[{name}:");
        content
            .lines()
            .find_map(|line| line.strip_prefix(&prefix).and_then(|s| s.strip_suffix(']')))
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let mut title = tag("ti");
    let mut artist = tag("ar");
    let mut album = tag("al");
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
        let metadata = json
            .get("song")
            .or_else(|| json.get("track"))
            .unwrap_or(&json);
        let field = |keys: &[&str]| {
            keys.iter()
                .find_map(|key| metadata.get(*key)?.as_str())
                .unwrap_or("")
                .to_string()
        };
        title = field(&["title", "songName", "name"]);
        artist = field(&["artist", "artistName", "singer"]);
        album = field(&["album", "albumName"]);
        if title.is_empty() || artist.is_empty() {
            if let Some(lyric) = super::json_lyric(&json) {
                for line in lyric.lines() {
                    if let Some(v) = line.strip_prefix("[ti:").and_then(|s| s.strip_suffix(']')) {
                        title = v.into();
                    }
                    if let Some(v) = line.strip_prefix("[ar:").and_then(|s| s.strip_suffix(']')) {
                        artist = v.into();
                    }
                }
            }
        }
    }
    if title.is_empty() || artist.is_empty() {
        let stem = path.file_stem()?.to_string_lossy();
        if let Some((a, t)) = stem.split_once(" - ") {
            artist = a.into();
            title = t.into();
        }
    }
    if title.is_empty() || artist.is_empty() {
        return None;
    }
    Some(Entry {
        path,
        title,
        artist,
        album,
        duration: None,
    })
}

fn known_roots(hint: &str) -> Vec<PathBuf> {
    let mut result = Vec::new();
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for location in [
            "Library/Caches",
            "Library/Containers/com.tencent.QQMusicMac",
            "Library/Containers/com.netease.163music",
            "Library/Application Support/QQMusic",
            "Library/Application Support/CloudMusic",
            "Music",
        ] {
            let path = home.join(location);
            if path.is_dir() {
                result.push(path);
            }
        }
    }
    if !hint.is_empty() && Path::new(hint).is_dir() {
        result.push(hint.into());
    }
    for variable in ["APPDATA", "LOCALAPPDATA", "USERPROFILE", "PROGRAMDATA"] {
        if let Some(root) = std::env::var_os(variable) {
            let root = PathBuf::from(root);
            for path in [
                "Tencent/QQMusic",
                "QQMusic",
                "NetEase/CloudMusic",
                "CloudMusic",
                "KuGou8",
                "Kugou",
                "KuwoMusic",
                "kuwo",
                "SodaMusic",
                "soda_music",
                "Music",
                "Documents",
            ] {
                let p = root.join(path);
                if p.is_dir() {
                    result.push(p);
                }
            }
        }
    }
    result
}
pub fn roots(hint: &str) -> Vec<PathBuf> {
    let mut result = known_roots(hint);
    for variable in ["APPDATA", "LOCALAPPDATA", "PROGRAMDATA"] {
        if let Some(root) = std::env::var_os(variable) {
            result.push(root.into());
        }
    }
    #[cfg(windows)]
    unsafe {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetLogicalDrives() -> u32;
            fn GetDriveTypeW(root: *const u16) -> u32;
        }
        let drives = GetLogicalDrives();
        for i in 0..26 {
            if drives & (1 << i) != 0 {
                let root = format!("{}:\\", (b'A' + i) as char);
                let wide: Vec<_> = root.encode_utf16().chain(Some(0)).collect();
                if GetDriveTypeW(wide.as_ptr()) == 3 {
                    result.push(root.into());
                }
            }
        }
    }
    result
}

pub fn start(state: Arc<AppState>) {
    thread::spawn(move || {
        let file = super::locations::path(&state.path);
        let (mut saved, mut damaged) = match SavedLocations::read(&file) {
            Ok(saved) => (saved, false),
            Err(error) => {
                state.lyric_library.lock().unwrap().directory_issue = Some(error);
                let mut saved = SavedLocations::default();
                saved.initial_scan_complete = true;
                (saved, true)
            }
        };
        let mut job: Option<(Scanner, ScanKind)> = None;
        let mut initialized = false;
        let mut dirty = false;
        let mut retry_write = Instant::now() - Duration::from_secs(6);
        let mut refreshed = Instant::now();
        let mut source = String::new();
        let mut targeted_pending = false;
        while !state.shutdown.load(Ordering::Relaxed) {
            let settings = state.settings.lock().unwrap().lyrics.clone();
            if settings.enabled {
                let next_source = state
                    .status
                    .lock()
                    .unwrap()
                    .source_name
                    .clone()
                    .unwrap_or_default();
                if !source.is_empty() && !next_source.is_empty() && source != next_source {
                    targeted_pending = true;
                }
                if !next_source.is_empty() {
                    source = next_source;
                }
                let rescan = {
                    let mut library = state.lyric_library.lock().unwrap();
                    std::mem::take(&mut library.rescan_requested)
                };
                if rescan {
                    job = Some((Scanner::new(roots(&settings.folder)), ScanKind::Global));
                    initialized = true;
                    saved.initial_scan_complete = false;
                    dirty = true;
                }
                if !initialized {
                    job = Some(startup_job(&saved, &settings.folder));
                    initialized = true;
                }
                if job.is_none() && targeted_pending {
                    job = Some((
                        Scanner::targeted(known_roots(&settings.folder)),
                        ScanKind::Targeted,
                    ));
                    targeted_pending = false;
                } else if job.is_none() && refreshed.elapsed() > Duration::from_secs(30) {
                    // Refresh only direct files in remembered leaf directories.
                    // Even a saved drive-root location cannot recurse over the drive.
                    let valid = saved.valid_directories();
                    job = Some(if valid.is_empty() {
                        (
                            Scanner::targeted(known_roots(&settings.folder)),
                            ScanKind::Targeted,
                        )
                    } else {
                        (Scanner::locations(valid), ScanKind::Known)
                    });
                    refreshed = Instant::now();
                }
                let mut next_job = None;
                if let Some((work, kind)) = job.as_mut() {
                    let (found, more) = work.step();
                    dirty |= saved.remember(
                        found
                            .iter()
                            .filter_map(|entry| entry.path.parent().map(Path::to_path_buf)),
                    );
                    let mut library = state.lyric_library.lock().unwrap();
                    if !found.is_empty() {
                        for entry in found {
                            if let Some(old) = library
                                .entries
                                .iter_mut()
                                .find(|old| old.path == entry.path)
                            {
                                *old = entry;
                            } else {
                                library.entries.push(entry);
                            }
                        }
                        library.generation += 1;
                    }
                    library.scanning = more;
                    library.discovering = more && *kind == ScanKind::Global;
                    if !more {
                        if *kind == ScanKind::InitialTargeted && saved.directories.is_empty() {
                            next_job =
                                Some((Scanner::new(roots(&settings.folder)), ScanKind::Global));
                            library.scanning = true;
                            library.discovering = true;
                        } else if !saved.initial_scan_complete {
                            saved.initial_scan_complete = true;
                            dirty = true;
                        }
                        library.generation += 1;
                        job = None;
                        refreshed = Instant::now();
                    }
                }
                if next_job.is_some() {
                    job = next_job;
                }
                if dirty && retry_write.elapsed() > Duration::from_secs(5) {
                    let result = (|| {
                        if damaged && file.exists() {
                            let stamp = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis();
                            fs::copy(&file, file.with_extension(format!("{stamp}.backup.json")))
                                .map_err(|e| e.to_string())?;
                            damaged = false;
                        }
                        saved.write(&file)
                    })();
                    let mut library = state.lyric_library.lock().unwrap();
                    match result {
                        Ok(()) => {
                            dirty = false;
                            library.directory_issue = None;
                        }
                        Err(_) => {
                            library.directory_issue =
                                Some("歌词目录记忆保存失败，正在自动重试".into())
                        }
                    }
                    retry_write = Instant::now();
                }
            }
            thread::sleep(Duration::from_millis(
                if settings.enabled && job.is_some() {
                    100
                } else {
                    1000
                },
            ));
        }
    });
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum ScanKind {
    InitialTargeted,
    Global,
    Known,
    Targeted,
}
fn startup_job(saved: &SavedLocations, hint: &str) -> (Scanner, ScanKind) {
    let known = saved.valid_directories();
    if !known.is_empty() {
        return (Scanner::locations(known), ScanKind::Known);
    }
    (
        Scanner::targeted(known_roots(hint)),
        if saved.has_discovered() {
            ScanKind::Targeted
        } else {
            ScanKind::InitialTargeted
        },
    )
}

#[tauri::command]
pub fn rescan_lyric_locations(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Arc<AppState>>,
) -> Result<(), String> {
    if window.label() != "settings" {
        return Err("此操作仅供设置窗口使用".into());
    }
    state
        .lyric_library
        .lock()
        .map_err(|e| e.to_string())?
        .rescan_requested = true;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn indexes_unknown_locations_and_skips_unrelated_data() {
        let root =
            std::env::temp_dir().join(format!("soundspectra-lyric-index-{}", std::process::id()));
        fs::create_dir_all(root.join("custom/lyrics")).unwrap();
        fs::write(
            root.join("custom/lyrics/test.lrc"),
            "[ti:原创测试]\n[ar:测试歌手]\n[00:01]测试歌词",
        )
        .unwrap();
        fs::write(
            root.join("custom/lyrics/unrelated.json"),
            "{\"password\":\"test\"}",
        )
        .unwrap();
        let mut scanner = Scanner::new(vec![root.clone()]);
        let mut entries = Vec::new();
        loop {
            let (found, more) = scanner.step();
            entries.extend(found);
            if !more {
                break;
            }
        }
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "原创测试");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn restart_reuses_saved_directories_without_walking_siblings_or_drive_roots() {
        let root = std::env::temp_dir().join(format!(
            "soundspectra-remembered-scan-{}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("remembered")).unwrap();
        fs::create_dir_all(root.join("unrelated/deep")).unwrap();
        let lyric = "[ti:原创测试]\n[ar:测试歌手]\n[00:01]歌词";
        fs::write(root.join("remembered/one.lrc"), lyric).unwrap();
        fs::write(root.join("unrelated/deep/two.lrc"), lyric).unwrap();
        let file = root.join("locations.json");
        let mut saved = SavedLocations::default();
        saved.remember([root.join("remembered")]);
        saved.write(&file).unwrap();
        let restored = SavedLocations::read(&file).unwrap();
        let (mut scanner, kind) = startup_job(&restored, "");
        assert_eq!(kind, ScanKind::Known);
        let mut entries = Vec::new();
        loop {
            let (found, more) = scanner.step();
            entries.extend(found);
            if !more {
                break;
            }
        }
        assert_eq!(entries.len(), 1);
        assert!(entries[0].path.ends_with("remembered/one.lrc"));
        let mut root_only = Scanner::locations(vec![root.clone()]);
        let mut entries = Vec::new();
        loop {
            let (found, more) = root_only.step();
            entries.extend(found);
            if !more {
                break;
            }
        }
        assert!(entries.is_empty()); // A stored root directory cannot turn into a recursive disk scan.
        fs::remove_dir_all(root.join("remembered")).unwrap();
        assert_eq!(startup_job(&restored, "").1, ScanKind::Targeted);
        fs::remove_dir_all(root).unwrap();
    }
}
