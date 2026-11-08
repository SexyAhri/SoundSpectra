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
    pub recording_id: Option<String>,
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

// Local caches belong to a player, not to a machine-wide fallback pool.
// Explicit user imports are shared by choice; public network libraries are
// handled separately and never require another desktop client to be installed.
#[derive(Clone)]
pub(super) struct LocalScope {
    player: Option<&'static str>,
    folder: Option<PathBuf>,
    configured: Vec<PathBuf>,
}
fn owner(path: &Path) -> Option<&'static str> {
    path.components().rev().find_map(|part| {
        let name = part.as_os_str().to_string_lossy().to_lowercase();
        if name.contains("qqmusic") || name == "qq音乐" || name == "qq 音乐" {
            Some("qqmusic")
        } else if name.contains("cloudmusic") || name == "netease" || name.contains("网易云") {
            Some("netease")
        } else if name.contains("kugou") || name.contains("酷狗") {
            Some("kugou")
        } else if name.contains("sodamusic") || name == "soda_music" || name.contains("汽水") {
            Some("soda")
        } else {
            None
        }
    })
}
fn within(path: &Path, root: &Path) -> bool {
    let key = |p: &Path| {
        p.to_string_lossy()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_lowercase()
    };
    let (path, root) = (key(path), key(root));
    !root.is_empty()
        && (path == root
            || path
                .strip_prefix(&root)
                .is_some_and(|tail| tail.starts_with('/')))
}
impl LocalScope {
    pub(super) fn new(player: Option<&'static str>, folder: &str) -> Self {
        let configured = if player == Some("kugou") {
            std::env::var_os("APPDATA")
                .map(|base| kugou_directories(&PathBuf::from(base).join("KuGou8/KuGou.ini")))
                .unwrap_or_default()
        } else {
            vec![]
        };
        Self {
            player,
            folder: (!folder.is_empty()).then(|| PathBuf::from(folder)),
            configured,
        }
    }
    fn user_file(&self, path: &Path) -> bool {
        self.folder.as_ref().is_some_and(|root| within(path, root))
    }
    pub(super) fn accepts(&self, path: &Path) -> bool {
        if self.user_file(path) {
            return true;
        }
        let Some(player) = self.player else {
            return false;
        };
        if self.configured.iter().any(|root| within(path, root)) {
            return true;
        }
        if let Some(owner) = owner(path) {
            return owner == player;
        }
        match path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("qrc") => player == "qqmusic",
            Some("krc") => player == "kugou",
            Some("yrc") => player == "netease",
            _ => false,
        }
    }
    fn traverses(&self, path: &Path) -> bool {
        if self.user_file(path)
            || self.folder.as_ref().is_some_and(|root| within(root, path))
            || self
                .configured
                .iter()
                .any(|root| within(path, root) || within(root, path))
        {
            return true;
        }
        owner(path).is_none_or(|owner| Some(owner) == self.player)
    }
}

pub struct Scanner {
    queue: VecDeque<(PathBuf, u8, bool)>,
    current: Option<(fs::ReadDir, u8, bool)>,
    seen: HashSet<PathBuf>,
    files: HashSet<PathBuf>,
    depth_limit: u8,
    scope: Option<LocalScope>,
}
impl Scanner {
    pub fn new(roots: Vec<PathBuf>) -> Self {
        Self {
            queue: roots.into_iter().map(|p| (p, 0, false)).collect(),
            current: None,
            seen: HashSet::new(),
            files: HashSet::new(),
            depth_limit: 14,
            scope: None,
        }
    }
    fn scoped(mut self, scope: LocalScope) -> Self {
        self.queue.retain(|(path, _, _)| scope.traverses(path));
        self.scope = Some(scope);
        self
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
                        "sodamusic",
                        "汽水",
                        "酷狗",
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
                    if self
                        .scope
                        .as_ref()
                        .is_some_and(|scope| !scope.traverses(&path))
                    {
                        continue;
                    }
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
                    if !["qrc", "krc", "lrc", "yrc", "lyric", "lrcx", "ttml"]
                        .contains(&extension.as_str())
                        && !(cache && extension == "json")
                    {
                        continue;
                    }
                    if !self.files.insert(path.clone()) {
                        continue;
                    }
                    if self
                        .scope
                        .as_ref()
                        .is_some_and(|scope| !scope.accepts(&path))
                    {
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

// KuGou names cached lyrics after the requested song, followed by a lyric
// cache hash, numeric ID and flags. The hash is not necessarily the audio hash.
fn kugou_cache_name(stem: &str) -> Option<(&str, &str)> {
    let mut parts = stem.rsplitn(4, '-');
    let flags = parts.next()?;
    let id = parts.next()?;
    let hash = parts.next()?;
    let name = parts.next()?;
    if flags.len() != 8
        || !flags.bytes().all(|b| b.is_ascii_hexdigit())
        || id.is_empty()
        || !id.bytes().all(|b| b.is_ascii_digit())
        || hash.len() != 32
        || !hash.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return None;
    }
    let (artist, title) = name.split_once(" - ")?;
    (!artist.trim().is_empty() && !title.trim().is_empty()).then_some((artist.trim(), title.trim()))
}

fn describe(path: PathBuf) -> Option<Entry> {
    let name = path.file_name()?.to_string_lossy();
    if name.ends_with("_qmts.qrc") || name.ends_with("_qmRoma.qrc") {
        return None;
    }
    let parts: Vec<_> = name.split(" - ").collect();
    if name.ends_with("_qm.qrc") && parts.len() >= 4 {
        return Some(Entry {
            recording_id: None,
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
    let hash = tag("hash").to_ascii_lowercase();
    let recording_id = (path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("krc"))
        && hash.len() == 32
        && hash.bytes().all(|b| b.is_ascii_hexdigit()))
    .then_some(hash);
    let mut duration = None;
    if super::ttml::is_ttml(&content) {
        if let Some((t, a, al)) = super::ttml::metadata(&content) {
            title = t;
            artist = a;
            album = al;
        }
    }
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
        let t = field(&["title", "songName", "name"]);
        let a = field(&["artist", "artistName", "singer"]);
        let al = field(&["album", "albumName"]);
        if !t.is_empty() {
            title = t;
        }
        if !a.is_empty() {
            artist = a;
        }
        if !al.is_empty() {
            album = al;
        }
        if let Some(track) = super::netease::metadata(metadata) {
            title = track.title;
            artist = track.artist;
            album = track.album;
            // Imported JSON has no common unit for `duration`. Only NetEase's
            // `dt` explicitly means milliseconds; client adapters know their
            // own schema and can safely use `duration` as well.
            duration = metadata
                .get("dt")
                .and_then(serde_json::Value::as_f64)
                .map(|ms| ms / 1000.0)
                .filter(|seconds| seconds.is_finite() && *seconds > 0.0);
        }
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
    let stem = path.file_stem()?.to_string_lossy();
    if let Some((a, t)) = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("krc"))
        .then(|| kugou_cache_name(&stem))
        .flatten()
    {
        // Embedded tags can contain soundtrack annotations or omit featured
        // artists. The structured cache name retains the player's song name.
        artist = a.into();
        title = t.into();
    } else if title.is_empty() || artist.is_empty() {
        if let Some((a, t)) = stem.split_once(" - ") {
            if artist.is_empty() {
                artist = a.into();
            }
            if title.is_empty() {
                title = t.into();
            }
        }
    }
    if title.is_empty() || artist.is_empty() {
        return None;
    }
    Some(Entry {
        recording_id,
        path,
        title,
        artist,
        album,
        duration,
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
    if let Some(base) = std::env::var_os("APPDATA") {
        result.extend(kugou_directories(
            &PathBuf::from(base).join("KuGou8/KuGou.ini"),
        ));
    }
    result.sort();
    result.dedup();
    result
}

pub(crate) fn kugou_directories(config: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if fs::metadata(config).ok().is_none_or(|m| m.len() > 131072) {
        return roots;
    }
    let Some(text) = fs::read(config).ok().and_then(|b| super::decode(&b).ok()) else {
        return roots;
    };
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if !["LyricPath", "DownloadPath"]
            .iter()
            .any(|v| key.eq_ignore_ascii_case(v))
        {
            continue;
        }
        let path = PathBuf::from(value.trim().trim_matches('"'));
        if path.is_absolute() && path.is_dir() {
            if key.eq_ignore_ascii_case("LyricPath") {
                roots.push(path);
            } else if path.join("Lyric").is_dir() {
                roots.push(path.join("Lyric"));
            }
        }
    }
    roots.sort();
    roots.dedup();
    roots
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
        let mut folder = String::new();
        let mut targeted_at = Instant::now();
        while !state.shutdown.load(Ordering::Relaxed) {
            let settings = state.settings.lock().unwrap().lyrics.clone();
            if settings.enabled {
                if initialized && folder != settings.folder {
                    targeted_pending = true;
                }
                folder = settings.folder.clone();
                let next_source = state
                    .status
                    .lock()
                    .unwrap()
                    .source_name
                    .clone()
                    .unwrap_or_default();
                if !next_source.is_empty() && source != next_source {
                    targeted_pending = true;
                    job = None;
                    initialized = false;
                    let mut library = state.lyric_library.lock().unwrap();
                    library.entries.clear();
                    library.generation = library.generation.wrapping_add(1);
                }
                if !next_source.is_empty() {
                    source = next_source;
                }
                let scope = LocalScope::new(
                    super::current_player(&crate::now_playing::NowPlaying {
                        source: source.clone(),
                        ..Default::default()
                    }),
                    &settings.folder,
                );
                let rescan = {
                    let mut library = state.lyric_library.lock().unwrap();
                    std::mem::take(&mut library.rescan_requested)
                };
                if rescan {
                    job = Some((
                        Scanner::new(roots(&settings.folder)).scoped(scope.clone()),
                        ScanKind::Global,
                    ));
                    initialized = true;
                    saved.initial_scan_complete = false;
                    dirty = true;
                }
                if !initialized {
                    let (scanner, kind) = startup_job(&saved, &settings.folder);
                    job = Some((scanner.scoped(scope.clone()), kind));
                    initialized = true;
                }
                if job.is_none() && targeted_pending {
                    job = Some((
                        Scanner::targeted(known_roots(&settings.folder)).scoped(scope.clone()),
                        ScanKind::Targeted,
                    ));
                    targeted_pending = false;
                } else if job.is_none() && refreshed.elapsed() > Duration::from_secs(30) {
                    // Refresh only direct files in remembered leaf directories.
                    // Even a saved drive-root location cannot recurse over the drive.
                    let valid = saved.valid_directories();
                    job = Some(
                        if valid.is_empty() || targeted_at.elapsed() > Duration::from_secs(300) {
                            targeted_at = Instant::now();
                            (
                                Scanner::targeted(known_roots(&settings.folder))
                                    .scoped(scope.clone()),
                                ScanKind::Targeted,
                            )
                        } else {
                            (
                                Scanner::locations(valid).scoped(scope.clone()),
                                ScanKind::Known,
                            )
                        },
                    );
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
                            next_job = Some((
                                Scanner::new(roots(&settings.folder)).scoped(scope.clone()),
                                ScanKind::Global,
                            ));
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
    fn each_player_indexes_its_own_cache_with_or_without_other_clients() {
        let root =
            std::env::temp_dir().join(format!("soundspectra-client-scopes-{}", std::process::id()));
        let clients = [
            ("qqmusic", "QQMusic/Lyric"),
            ("netease", "NetEase/CloudMusic/Lyric"),
            ("kugou", "KuGou/Lyric"),
            ("soda", "SodaMusic/Lyric"),
        ];
        fs::create_dir_all(&root).unwrap();
        let scan = |id| {
            let mut scanner = Scanner::new(vec![root.clone()]).scoped(LocalScope {
                player: Some(id),
                folder: None,
                configured: vec![],
            });
            let mut entries = vec![];
            loop {
                let (found, more) = scanner.step();
                entries.extend(found);
                if !more {
                    break;
                }
            }
            entries
        };
        for (id, folder) in clients {
            let path = root.join(folder);
            fs::create_dir_all(&path).unwrap();
            fs::write(
                path.join("song.lrc"),
                format!("[ti:同一首歌]\n[ar:同一歌手]\n[00:01]{id} 的歌词"),
            )
            .unwrap();
            let entries = scan(id);
            assert_eq!(
                entries.len(),
                1,
                "{id} must work with only its own local cache"
            );
            assert!(entries[0].path.starts_with(&path));
        }
        for (id, folder) in clients {
            let entries = scan(id);
            assert_eq!(
                entries.len(),
                1,
                "{id} must not borrow another installed client's same-song lyrics"
            );
            assert!(entries[0].path.starts_with(root.join(folder)));
        }
        let imported = root.join("imports");
        fs::create_dir_all(&imported).unwrap();
        let shared = imported.join("manual.lrc");
        fs::write(&shared, "[ti:导入]\n[ar:歌手]\n[00:01]用户导入").unwrap();
        for (id, _) in clients {
            let scope = LocalScope {
                player: Some(id),
                folder: Some(imported.clone()),
                configured: vec![],
            };
            assert!(scope.accepts(&shared));
            assert!(!scope.accepts(&root.join("imports-sibling/unrelated.lrc")));
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn kugou_configuration_discovers_custom_lyric_directory() {
        let root =
            std::env::temp_dir().join(format!("soundspectra-kugou-config-{}", std::process::id()));
        fs::create_dir_all(root.join("music/Lyric")).unwrap();
        let config = root.join("KuGou.ini");
        fs::write(
            &config,
            format!(
                "[DownloadConfigSection]\nDownloadPath={}\n[LyricConfigSection]\nLyricPath={}\n",
                root.join("music").display(),
                root.join("music/Lyric").display()
            ),
        )
        .unwrap();
        assert_eq!(kugou_directories(&config), vec![root.join("music/Lyric")]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "Read-only integration with the installed KuGou configured lyric directory"]
    fn installed_kugou_lyrics_are_discovered_and_decoded() {
        let config = PathBuf::from(std::env::var_os("APPDATA").unwrap()).join("KuGou8/KuGou.ini");
        let roots = kugou_directories(&config);
        assert!(!roots.is_empty());
        let mut scanner = Scanner::new(roots);
        let mut entries = Vec::new();
        loop {
            let (found, more) = scanner.step();
            entries.extend(found);
            if !more {
                break;
            }
        }
        assert!(!entries.is_empty());
        for entry in &entries {
            assert!(!super::super::read_file(&entry.path).unwrap().is_empty());
            let stem = entry.path.file_stem().unwrap().to_string_lossy();
            if let Some((artist, title)) = kugou_cache_name(&stem) {
                let info = crate::now_playing::NowPlaying {
                    title: title.into(),
                    artist: artist.into(),
                    source: "酷狗音乐".into(),
                    session_id: "kugou".into(),
                    ..Default::default()
                };
                let found = super::super::load(&entries, &info);
                assert_eq!(found.status, "ready", "{}: {}", title, found.message);
                assert!(found.lines.iter().any(|line| !line.words.is_empty()));
                eprintln!(
                    "Verified KuGou match: {artist} - {title}, {} timed lines",
                    found.lines.len()
                );
            }
        }
        eprintln!(
            "Installed KuGou: discovered and decoded {} local lyrics",
            entries.len()
        );
    }
    #[test]
    fn structured_kugou_names_resolve_missing_tags_and_embedded_annotations() {
        let root =
            std::env::temp_dir().join(format!("soundspectra-kugou-names-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        for (name, tags, artist, title) in [
            (
                "甲、乙 - 微光-0123456789abcdef0123456789abcdef-123-00000000.krc",
                "[ti:]\n[ar:]",
                "甲、乙",
                "微光",
            ),
            (
                "甲 - 微光-0123456789abcdef0123456789abcdef-123-00000000.krc",
                "[ti:微光 (《原创》插曲)]\n[ar:甲]",
                "甲",
                "微光",
            ),
            (
                "甲 - 微光 (Live)-0123456789abcdef0123456789abcdef-123-00000000.krc",
                "[ti:微光]\n[ar:甲]",
                "甲",
                "微光 (Live)",
            ),
            (
                "甲 - 微光-123.krc",
                "[ti:完整歌名]\n[ar:]",
                "甲",
                "完整歌名",
            ),
        ] {
            let path = root.join(name);
            // Decoded KRC is accepted too; parsing and matching use the same
            // path as encrypted files covered by the existing decrypt test.
            fs::write(&path, format!("{tags}\n[1000,1000]<0,1000,0>微光")).unwrap();
            let entry = describe(path).unwrap();
            assert_eq!(entry.title, title);
            assert_eq!(entry.artist, artist);
            assert!(
                entry.recording_id.is_none(),
                "cache hash is not an audio hash"
            );
            let info = crate::now_playing::NowPlaying {
                title: title.into(),
                artist: artist.into(),
                ..Default::default()
            };
            assert_eq!(super::super::load(&[entry.clone()], &info).status, "ready");
            if title.contains("Live") {
                let studio = crate::now_playing::NowPlaying {
                    title: "微光".into(),
                    ..info
                };
                assert_eq!(super::super::load(&[entry], &studio).status, "missing");
            }
        }
        assert!(kugou_cache_name("甲 - 微光-not-a-hash-123-00000000").is_none());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn hashed_kugou_krc_is_decrypted_and_indexed_by_embedded_metadata() {
        use base64::Engine;
        let root =
            std::env::temp_dir().join(format!("soundspectra-kugou-index-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        // Original test text, zlib-compressed and XOR-wrapped as a KRC file.
        let bytes = base64::engine::general_purpose::STANDARD.decode("a3JjMTjb6lmXhg79Puvi+wCKwIGEZcqQDQRdr3oK6BTdFqPYOnECie2fryTolDwgwt4aKQTr7PbQm/XG37fs/rM5Ailsb87CTTKeN0yi").unwrap();
        let path = root.join("7c9f8a0b.krc");
        fs::write(&path, bytes).unwrap();
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
        assert_eq!(entries[0].title, "微光");
        assert_eq!(entries[0].artist, "甲 / 乙");
        let lines = super::super::read_file(&path).unwrap();
        assert_eq!(lines[0].words.len(), 2);
        assert_eq!(lines[0].text, "微光");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn discovers_ttml_metadata_and_structured_artist_album_fields() {
        let root = std::env::temp_dir().join(format!(
            "soundspectra-ttml-discovery-{}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("lyrics")).unwrap();
        fs::write(root.join("lyrics/hash.ttml"), r#"<tt xmlns="http://www.w3.org/ns/ttml" xmlns:amll="http://www.example.com/ns/amll"><head><metadata><amll:meta key="musicName" value="微光"/><amll:meta key="artists" value="甲"/><amll:meta key="artists" value="乙"/><amll:meta key="album" value="星海"/></metadata></head><body><div><p begin="1" end="2">微光</p></div></body></tt>"#).unwrap();
        fs::write(root.join("lyrics/123.json"), r#"{"song":{"id":123,"name":"微光","ar":[{"name":"甲"},{"name":"乙"}],"al":{"name":"星海"},"dt":10000},"lrc":{"lyric":"[00:01]微光"}}"#).unwrap();
        fs::write(root.join("lyrics/generic.json"), r#"{"name":"微光","artist":"甲 / 乙","album":"星海","duration":10,"lrc":"[00:01]微光"}"#).unwrap();
        let mut scanner = Scanner::new(vec![root.clone()]);
        let mut entries = Vec::new();
        loop {
            let (found, more) = scanner.step();
            entries.extend(found);
            if !more {
                break;
            }
        }
        assert_eq!(entries.len(), 3);
        assert!(entries
            .iter()
            .all(|e| e.title == "微光" && e.artist == "甲 / 乙" && e.album == "星海"));
        assert_eq!(
            entries
                .iter()
                .find(|e| e.path.file_name().unwrap() == "123.json")
                .unwrap()
                .duration,
            Some(10.0)
        );
        assert!(entries
            .iter()
            .find(|e| e.path.file_name().unwrap() == "generic.json")
            .unwrap()
            .duration
            .is_none());
        fs::remove_dir_all(root).unwrap();
    }
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
