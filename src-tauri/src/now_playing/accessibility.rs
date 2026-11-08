//! Read-only fallbacks for clients which do not publish Windows media sessions.
//! UI Automation runs in its own apartment so an unresponsive client cannot
//! hold up SMTC, audio capture, or the UI. Nothing here invokes player controls.
use super::{clean, now, NowPlaying};
use crate::audio_source::Target;
use std::{
    hash::{DefaultHasher, Hash, Hasher},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use windows::{
    core::Interface,
    Win32::{
        Foundation::HWND,
        System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
        UI::Accessibility::*,
    },
};
use windows_sys::Win32::{
    Foundation::{HWND as RawHwnd, LPARAM},
    UI::WindowsAndMessaging::*,
};

const FRESH_MS: u64 = 2500;

#[derive(Clone, Debug, Default)]
struct Snapshot {
    pid: u32,
    observed: u64,
    title: String,
    artist: String,
    clock: Option<(f64, f64)>,
    playing: Option<bool>,
}

pub(super) struct Reader {
    target: Arc<Mutex<Option<Target>>>,
    latest: Arc<Mutex<Option<Snapshot>>>,
    stop: Arc<AtomicBool>,
    motion: Motion,
}
impl Default for Reader {
    fn default() -> Self {
        let target = Arc::new(Mutex::new(None::<Target>));
        let latest = Arc::new(Mutex::new(None));
        let stop = Arc::new(AtomicBool::new(false));
        let (request, result, stopped) = (target.clone(), latest.clone(), stop.clone());
        thread::spawn(move || {
            let initialized = unsafe { super::RoInitialize(1) } >= 0;
            let automation = if initialized { automation() } else { None };
            while !stopped.load(Ordering::Relaxed) {
                let target = request.lock().unwrap().clone();
                let sample = target.as_ref().and_then(|t| read(t, automation.as_ref()));
                *result.lock().unwrap() = sample;
                for _ in 0..5 {
                    if stopped.load(Ordering::Relaxed) {
                        break;
                    }
                    thread::sleep(Duration::from_millis(100));
                }
            }
            drop(automation);
            if initialized {
                unsafe { super::RoUninitialize() };
            }
        });
        Self {
            target,
            latest,
            stop,
            motion: Motion::default(),
        }
    }
}
impl Drop for Reader {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
impl Reader {
    pub(super) fn update(&mut self, target: Option<&Target>, info: &mut NowPlaying, observed: u64) {
        let target = target.filter(|t| matches!(t.player_id.as_deref(), Some("netease" | "soda")));
        *self.target.lock().unwrap() = target.cloned();
        let Some(target) = target else {
            self.motion = Motion::default();
            return;
        };
        let sample = self
            .latest
            .lock()
            .unwrap()
            .clone()
            .filter(|s| {
                s.pid == target.pid && s.observed <= observed && observed - s.observed <= FRESH_MS
            })
            .or_else(|| {
                (target.player_id.as_deref() == Some("netease"))
                    .then(|| read(target, None))
                    .flatten()
            });
        let Some(sample) = sample else {
            self.motion = Motion::default();
            return;
        };
        apply(&mut self.motion, &sample, info, observed);
    }
}

#[derive(Default)]
struct Motion {
    key: String,
    last: Option<(f64, u64)>,
    advanced: Option<u64>,
    anchor: Option<(f64, u64)>,
}
impl Motion {
    fn playing(&mut self, key: String, position: f64, sampled: u64) -> bool {
        if self.key != key {
            *self = Self {
                key,
                ..Default::default()
            };
        }
        if let Some((previous, at)) = self.last {
            if sampled > at && position != previous {
                // A backward jump is a seek, not evidence of playback.
                self.advanced =
                    (position > previous && position - previous <= 3.0).then_some(sampled);
                self.anchor = Some((position, sampled));
            }
        }
        if self.anchor.is_none() {
            self.anchor = Some((position, sampled));
        }
        self.last = Some((position, sampled));
        self.advanced
            .is_some_and(|at| sampled.saturating_sub(at) <= 1500)
    }
}
fn same(a: &str, b: &str) -> bool {
    let normalize = |s: &str| {
        s.chars()
            .filter(|c| !c.is_whitespace())
            .flat_map(char::to_lowercase)
            .collect::<String>()
    };
    normalize(a) == normalize(b)
}
fn apply(motion: &mut Motion, sample: &Snapshot, info: &mut NowPlaying, observed: u64) {
    if sample.title.is_empty() {
        return;
    }
    // A working, matching media session remains authoritative. Never attach a
    // footer's clock to another SMTC song during a transition.
    let empty = info.title.is_empty();
    if !empty && (!same(&info.title, &sample.title) || !same(&info.artist, &sample.artist)) {
        return;
    }
    if empty {
        info.title = sample.title.clone();
        info.artist = sample.artist.clone();
        info.issue = None;
        let mut identity = DefaultHasher::new();
        (sample.pid, &sample.title, &sample.artist).hash(&mut identity);
        info.track_id = format!("uia:{:016x}", identity.finish());
    }
    if info.timeline_available {
        return;
    }
    if let Some((position, duration)) = sample.clock {
        let inferred = motion.playing(
            format!("{}:{}:{}", sample.pid, sample.title, sample.artist),
            position,
            sample.observed,
        );
        let playing = if info.playback_available {
            info.playing
        } else {
            sample.playing.unwrap_or(inferred)
        };
        info.playing = playing;
        info.playback_available = true;
        if !playing {
            motion.anchor = Some((position, sample.observed));
        }
        let (anchor, at) = if playing {
            motion.anchor.unwrap_or((position, sample.observed))
        } else {
            (position, sample.observed)
        };
        info.position = (anchor
            + if playing {
                observed.saturating_sub(at) as f64 / 1000.0
            } else {
                0.0
            })
        .min(duration);
        info.duration = duration;
        info.timeline_available = true;
        info.timeline_source = Some("player-accessibility");
        info.timeline_valid_until = Some(sample.observed + FRESH_MS);
        info.updated = observed;
    } else if empty {
        info.playing = sample.playing.unwrap_or(false);
        info.playback_available = sample.playing.is_some();
    }
}

fn automation() -> Option<IUIAutomation> {
    unsafe {
        let automation: IUIAutomation =
            CoCreateInstance(&CUIAutomation8, None, CLSCTX_INPROC_SERVER).ok()?;
        if let Ok(timed) = automation.cast::<IUIAutomation2>() {
            let _ = timed.SetConnectionTimeout(500);
            let _ = timed.SetTransactionTimeout(700);
        }
        Some(automation)
    }
}

struct WindowSearch {
    pid: u32,
    windows: Vec<(RawHwnd, String)>,
}
unsafe extern "system" fn visit(hwnd: RawHwnd, data: LPARAM) -> i32 {
    let search = &mut *(data as *mut WindowSearch);
    let mut pid = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == search.pid && IsWindowVisible(hwnd) != 0 {
        let mut text = [0u16; 512];
        let length = GetWindowTextW(hwnd, text.as_mut_ptr(), text.len() as i32);
        if length > 0 {
            search.windows.push((
                hwnd,
                clean(String::from_utf16_lossy(&text[..length as usize])),
            ));
        }
    }
    1
}

#[derive(Debug, Default)]
struct Node {
    name: String,
    id: String,
    kind: i32,
}
unsafe fn nodes(automation: &IUIAutomation, root: &IUIAutomationElement) -> Option<Vec<Node>> {
    let cache = automation.CreateCacheRequest().ok()?;
    for property in [
        UIA_NamePropertyId,
        UIA_AutomationIdPropertyId,
        UIA_ControlTypePropertyId,
    ] {
        cache.AddProperty(property).ok()?;
    }
    let all = root
        .FindAllBuildCache(
            TreeScope_Descendants,
            &automation.CreateTrueCondition().ok()?,
            &cache,
        )
        .ok()?;
    let count = all.Length().ok()?;
    if count > 2000 {
        return None;
    }
    let mut result = Vec::new();
    for i in 0..count {
        let element = all.GetElement(i).ok()?;
        result.push(Node {
            name: clean(element.CachedName().unwrap_or_default().to_string()),
            id: element.CachedAutomationId().unwrap_or_default().to_string(),
            kind: element.CachedControlType().map_or(0, |id| id.0),
        });
    }
    Some(result)
}
fn clock(text: &str) -> Option<(f64, f64)> {
    fn seconds(value: &str) -> Option<u32> {
        let pieces = value
            .trim()
            .split(':')
            .map(str::parse::<u32>)
            .collect::<Result<Vec<_>, _>>()
            .ok()?;
        match pieces.as_slice() {
            [m, s] if *m < 1440 && *s < 60 => Some(m * 60 + s),
            [h, m, s] if *h < 24 && *m < 60 && *s < 60 => Some(h * 3600 + m * 60 + s),
            _ => None,
        }
    }
    let (a, b) = text.split_once('/')?;
    let (position, duration) = (seconds(a)?, seconds(b)?);
    (duration > 0 && position <= duration).then_some((position as f64, duration as f64))
}
fn netease_title(title: &str) -> Option<(String, String)> {
    let (title, artist) = title.split_once(" - ")?;
    let artist = artist.strip_suffix(" - 网易云音乐").unwrap_or(artist);
    if title.trim().is_empty() || artist.trim().is_empty() {
        return None;
    }
    Some((title.trim().into(), artist.trim().into()))
}
fn parse(player: &str, title: &str, nodes: &[Node]) -> Option<Snapshot> {
    if player == "netease" {
        let (title, artist) = netease_title(title)?;
        // Only the bottom playback landmark, never a search result or playlist.
        let footer = nodes
            .iter()
            .rposition(|n| n.id == "btn_pc_minibar_play")
            .map(|i| &nodes[i.saturating_sub(24)..(i + 24).min(nodes.len())])
            .unwrap_or(&[]);
        let matching = footer
            .iter()
            .any(|n| n.kind == 50020 && same(&n.name, &title))
            && footer
                .iter()
                .any(|n| n.kind == 50020 && same(&n.name, &artist));
        let clock = matching
            .then(|| {
                footer
                    .iter()
                    .filter(|n| n.kind == 50020)
                    .find_map(|n| clock(&n.name))
            })
            .flatten();
        let playing = matching
            .then(|| {
                footer
                    .iter()
                    .find(|n| n.id == "btn_pc_minibar_play")
                    .and_then(|n| match n.name.as_str() {
                        "pause" | "暂停" => Some(true),
                        "play" | "播放" => Some(false),
                        _ => None,
                    })
            })
            .flatten();
        Some(Snapshot {
            title,
            artist,
            clock,
            playing,
            ..Default::default()
        })
    } else {
        // Soda's footer group name can be stale; read its leaf time and links.
        let time = nodes
            .iter()
            .rposition(|n| n.kind == 50020 && clock(&n.name).is_some())?;
        let footer_start = nodes[..time].iter().rposition(|n| n.kind == 50026)?;
        let footer = &nodes[footer_start + 1..];
        let links = footer
            .iter()
            .filter(|n| n.kind == 50005 && !n.name.is_empty())
            .collect::<Vec<_>>();
        let title = links.first()?.name.clone();
        let artist = links.get(1)?.name.clone();
        let clock = clock(&nodes[time].name);
        Some(Snapshot {
            title,
            artist,
            clock,
            ..Default::default()
        })
    }
}
fn read(target: &Target, automation: Option<&IUIAutomation>) -> Option<Snapshot> {
    let player = target.player_id.as_deref()?;
    let mut search = WindowSearch {
        pid: target.pid,
        windows: vec![],
    };
    unsafe {
        EnumWindows(Some(visit), &mut search as *mut _ as LPARAM);
    }
    for (hwnd, title) in search.windows {
        if player == "netease" && netease_title(&title).is_none() {
            continue;
        }
        if player == "soda" && title != "汽水音乐" {
            continue;
        }
        let started = now();
        let elements = automation
            .and_then(|a| unsafe {
                a.ElementFromHandle(HWND(hwnd))
                    .ok()
                    .and_then(|root| nodes(a, &root))
            })
            .unwrap_or_default();
        // If the title changed while fetching accessibility data, discard all
        // of it, including the clock. A later sample will read the new song.
        let mut confirm = [0u16; 512];
        let len = unsafe { GetWindowTextW(hwnd, confirm.as_mut_ptr(), confirm.len() as i32) };
        if len <= 0 || clean(String::from_utf16_lossy(&confirm[..len as usize])) != title {
            continue;
        }
        if let Some(mut snapshot) = parse(player, &title, &elements) {
            snapshot.pid = target.pid;
            let finished = now();
            if finished.saturating_sub(started) > FRESH_MS {
                snapshot.clock = None;
                snapshot.playing = None;
            }
            snapshot.observed = if snapshot.clock.is_some() {
                started
            } else {
                finished
            };
            return Some(snapshot);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    fn node(kind: i32, name: &str, id: &str) -> Node {
        Node {
            kind,
            name: name.into(),
            id: id.into(),
        }
    }
    #[test]
    fn footer_clock_is_strict_and_not_a_group_summary() {
        assert_eq!(clock("02:44 / 03:02"), Some((164.0, 182.0)));
        for text in [
            "00:11 / 03:30 歌名",
            "-1:00 / 03:00",
            "00:65 / 03:00",
            "04:00 / 03:00",
            "0 / 0",
        ] {
            assert!(clock(text).is_none());
        }
        let nodes = vec![
            node(50026, "00:11 / 03:30 旧歌曲 旧歌手", ""),
            node(50020, "02:44 / 03:02", ""),
            node(50005, "当前歌曲", ""),
            node(50005, "当前歌手", ""),
        ];
        let sample = parse("soda", "汽水音乐", &nodes).unwrap();
        assert_eq!(sample.title, "当前歌曲");
        assert_eq!(sample.clock, Some((164.0, 182.0)));
    }
    #[test]
    fn stale_netease_footer_does_not_attach_previous_clock_or_state() {
        let nodes = vec![
            node(50025, "", ""),
            node(50020, "旧歌", ""),
            node(50020, "00:30 / 03:00", ""),
            node(50011, "pause", "btn_pc_minibar_play"),
        ];
        let sample = parse("netease", "新歌 - 新歌手", &nodes).unwrap();
        assert_eq!(sample.title, "新歌");
        assert!(sample.clock.is_none());
        assert!(sample.playing.is_none());
        assert!(parse("netease", "网易云音乐", &nodes).is_none());
    }
    #[test]
    fn clock_motion_stops_when_paused_and_reanchors_on_seek_or_track_change() {
        let mut motion = Motion::default();
        assert!(!motion.playing("a".into(), 12.0, 1000));
        assert!(motion.playing("a".into(), 13.0, 2000));
        assert!(!motion.playing("a".into(), 13.0, 4000));
        assert!(!motion.playing("a".into(), 3.0, 4500));
        assert!(!motion.playing("b".into(), 100.0, 5000));
    }
    #[test]
    fn matching_session_is_required_before_adding_a_clock() {
        let sample = Snapshot {
            pid: 1,
            observed: 1000,
            title: "新歌".into(),
            artist: "歌手".into(),
            clock: Some((10.0, 180.0)),
            ..Default::default()
        };
        let mut info = NowPlaying {
            title: "旧歌".into(),
            artist: "歌手".into(),
            ..Default::default()
        };
        apply(&mut Motion::default(), &sample, &mut info, 1100);
        assert!(!info.timeline_available);
        let mut info = NowPlaying::default();
        apply(&mut Motion::default(), &sample, &mut info, 1100);
        assert_eq!(info.title, "新歌");
        assert_eq!(info.position, 10.0);
        assert!(info.timeline_available);
        assert!(!info.controls.play);
    }
    #[test]
    #[ignore = "Reads installed player windows without invoking controls"]
    fn installed_players_read_only() {
        let initialized = unsafe { super::super::RoInitialize(1) } >= 0;
        let automation = automation();
        for (id, exe) in [("netease", "cloudmusic.exe"), ("soda", "SodaMusic.exe")] {
            // The test PID is supplied explicitly to avoid examining unrelated windows.
            if let Ok(pid) = std::env::var(format!("SOUNDSPECTRA_TEST_{}_PID", id.to_uppercase())) {
                let target = Target {
                    pid: pid.parse().unwrap(),
                    executable: exe.into(),
                    name: id.into(),
                    player_id: Some(id.into()),
                    audible: false,
                };
                let mut sample = None;
                for _ in 0..3 {
                    sample = read(&target, automation.as_ref());
                    if sample.is_some() {
                        break;
                    }
                    thread::sleep(Duration::from_millis(500));
                }
                eprintln!("{id}: {sample:?}");
                assert!(sample.is_some(), "{id} did not expose song metadata");
            }
        }
        drop(automation);
        if initialized {
            unsafe { super::super::RoUninitialize() };
        }
    }
}
