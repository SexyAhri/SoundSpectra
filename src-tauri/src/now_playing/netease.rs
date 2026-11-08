//! Read-only NetEase 3.x playback events. Only a verified native start/seek
//! establishes a position; opening SoundSpectra or requesting a song never does.
use super::NowPlaying;
use crate::audio_source::Target;
use serde_json::Value;
use std::{
    collections::VecDeque,
    fs::File,
    io::{Read, Seek, SeekFrom},
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME},
    System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
};

const TAIL_BYTES: u64 = 4 * 1024 * 1024;
const LINE_BYTES: usize = 128 * 1024;
const FRESH_MS: u64 = 2500;
#[link(name = "kernel32")]
extern "system" {
    fn GetTickCount64() -> u64;
}

#[derive(Clone, Debug)]
struct Track {
    id: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    cover_url: Option<String>,
}
fn id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 24 && value.bytes().all(|b| b.is_ascii_digit())
}
fn string(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_u64().map(|n| n.to_string()))
        .unwrap_or_default()
}
fn metadata(value: &Value) -> Option<Track> {
    let track = value.get("track").unwrap_or(value);
    let song_id = string(&track["id"]);
    let title = super::clean(track["name"].as_str()?.to_owned());
    let artist = track["artists"]
        .as_array()?
        .iter()
        .filter_map(|a| a["name"].as_str())
        .collect::<Vec<_>>()
        .join(" / ");
    let duration = track["duration"].as_f64()? / 1000.0;
    if !id(&song_id)
        || title.is_empty()
        || artist.trim().is_empty()
        || !duration.is_finite()
        || !(0.0..=86400.0).contains(&duration)
        || duration == 0.0
    {
        return None;
    }
    Some(Track {
        id: song_id,
        title,
        artist: super::clean(artist),
        album: super::clean(
            track
                .pointer("/album/name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned(),
        ),
        duration,
        cover_url: track
            .pointer("/album/picUrl")
            .and_then(Value::as_str)
            .and_then(super::netease_cover::image_url),
    })
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
fn artists(a: &str, b: &str) -> bool {
    let names = |s: &str| {
        let mut result = s
            .split(['/', '、', ';', '；', '&'])
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        result.sort();
        result.dedup();
        result
    };
    names(a) == names(b)
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Origin {
    pid: u32,
    created: u64,
    first_tick: u64,
}
fn origin(pid: u32, observed: u64, tick: u64) -> Option<Origin> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let (mut created, mut exited, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        let success =
            GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) != 0;
        CloseHandle(process);
        if !success {
            return None;
        }
        let created =
            ((created.dwHighDateTime as u64) << 32 | created.dwLowDateTime as u64) / 10000;
        let created = created.checked_sub(11_644_473_600_000)?;
        let age = observed.checked_sub(created)?;
        Some(Origin {
            pid,
            created,
            first_tick: tick.checked_sub(age)?.saturating_sub(1000),
        })
    }
}

#[derive(Debug)]
struct Event {
    tick: u64,
    action: String,
    args: Vec<Value>,
}
fn event(line: &str, source: Origin, tick: u64) -> Option<Event> {
    // The monotonic field belongs to the current Windows boot, not wall time.
    let (header, body) = line.strip_prefix('[')?.split_once("] [")?;
    let mut header = header.split(':');
    if header.next()?.parse::<u32>().ok()? != source.pid {
        return None;
    }
    header.next()?; // thread ID
    header.next()?; // MMDD/HHMMSS
    let at = header.next()?.parse::<u64>().ok()?;
    if at < source.first_tick || at > tick {
        return None;
    }
    let body = body.split_once("] ")?.1;
    let marker = body.find("【playing】,")?;
    let args: Vec<Value> =
        serde_json::from_str(&format!("[{}]", &body[marker + "【playing】,".len()..])).ok()?;
    let action = args.first()?.as_str()?;
    if !matches!(
        action,
        "playOneTrackInPlayingList"
            | "checkPlayPrivilege"
            | "nativePlay"
            | "native播放资源load完成，开始播放"
            | "native播放state"
            | "setPlayingPosition"
            | "PlayerBuffering"
            | "PlayerBufferingEnd"
    ) {
        return None;
    }
    Some(Event {
        tick: at,
        action: action.to_owned(),
        args: args.into_iter().skip(1).collect(),
    })
}
fn token(value: &Value) -> Option<&str> {
    let token = value.as_str()?;
    let (song, suffix) = token.split_once('_')?;
    (id(song)
        && !suffix.is_empty()
        && token.len() <= 96
        && suffix.bytes().all(|b| b.is_ascii_alphanumeric()))
    .then_some(token)
}

#[derive(Debug)]
struct Session {
    track: Track,
    selected: bool,
    loaded: bool,
    token: Option<String>,
    anchor: Option<(f64, u64)>,
    playing: bool,
    buffering: bool,
}
impl Session {
    fn new(track: Track, selected: bool) -> Self {
        Self {
            track,
            selected,
            loaded: false,
            token: None,
            anchor: None,
            playing: false,
            buffering: false,
        }
    }
    fn position(&self, tick: u64) -> Option<f64> {
        let (position, at) = self.anchor?;
        let elapsed = tick.checked_sub(at)? as f64 / 1000.0;
        let position = position
            + if self.playing && !self.buffering {
                elapsed
            } else {
                0.0
            };
        (position <= self.track.duration + 2.0).then_some(position.min(self.track.duration))
    }
    fn capture(&mut self, tick: u64) {
        self.anchor = self.position(tick).map(|p| (p, tick));
    }
    fn owns(&self, value: &Value) -> bool {
        token(value).is_some_and(|t| self.token.as_deref() == Some(t))
    }
}

#[derive(Default)]
struct Playback {
    tracks: VecDeque<Track>,
    current: Option<Session>,
    last_event: u64,
}
impl Playback {
    fn consume(&mut self, event: Event) {
        if event.tick < self.last_event {
            if let Some(session) = &mut self.current {
                session.anchor = None
            }
            return;
        }
        self.last_event = event.tick;
        let first = event.args.first().unwrap_or(&Value::Null);
        match event.action.as_str() {
            "playOneTrackInPlayingList" | "checkPlayPrivilege" | "nativePlay" => {
                let Some(track) = metadata(first) else {
                    self.current = None;
                    return;
                };
                if event.action == "playOneTrackInPlayingList" {
                    self.current = Some(Session::new(track.clone(), true));
                }
                // Cold startup restores the track through nativePlay instead
                // of an explicit selection. Remember its metadata, but wait for
                // the matching native load/state and an absolute seek position.
                self.tracks.retain(|t| t.id != track.id);
                self.tracks.push_back(track);
                while self.tracks.len() > 4 {
                    self.tracks.pop_front();
                }
            }
            "native播放资源load完成，开始播放" => {
                let song_id = string(&first["songId"]);
                if !id(&song_id) {
                    self.current = None;
                    return;
                }
                if self.current.as_ref().is_none_or(|s| s.track.id != song_id) {
                    self.current = self
                        .tracks
                        .iter()
                        .find(|t| t.id == song_id)
                        .cloned()
                        .map(|t| Session::new(t, false));
                }
                if let Some(session) = &mut self.current {
                    session.capture(event.tick);
                    // A resource reload (e.g. quality change) is not a restart.
                    if session.selected && !session.loaded && session.anchor.is_none() {
                        session.anchor = Some((0.0, event.tick));
                    }
                    session.loaded = true;
                    session.playing = false;
                    session.buffering = false;
                    session.token = None;
                }
            }
            "native播放state" => {
                let Some(value) = event.args.get(1).and_then(token) else {
                    return;
                };
                let Some(session) = &mut self.current else {
                    return;
                };
                if !session.loaded
                    || value.split_once('_').map(|(id, _)| id) != Some(session.track.id.as_str())
                {
                    return;
                }
                if session.token.as_ref().is_some_and(|t| t != value) {
                    session.anchor = None;
                    return;
                }
                let Some(playing) = first.as_u64().and_then(|state| match state {
                    1 => Some(true),
                    2 => Some(false),
                    _ => None,
                }) else {
                    session.anchor = None;
                    return;
                };
                session.capture(event.tick);
                session.token = Some(value.to_owned());
                session.playing = playing;
            }
            "setPlayingPosition" => {
                let Some(session) = &mut self.current else {
                    return;
                };
                if let Some(position) = first
                    .as_f64()
                    .filter(|p| p.is_finite() && *p >= 0.0 && *p <= session.track.duration)
                {
                    session.anchor = Some((position, event.tick));
                } else {
                    session.anchor = None
                }
            }
            "PlayerBuffering" | "PlayerBufferingEnd" => {
                let Some(session) = &mut self.current else {
                    return;
                };
                if !session.owns(first) {
                    return;
                }
                session.capture(event.tick);
                session.buffering = event.action == "PlayerBuffering";
            }
            _ => (),
        }
    }
    fn apply(&self, info: &mut NowPlaying, observed: u64, tick: u64) {
        let Some(session) = &self.current else { return };
        let Some(position) = session.position(tick) else {
            return;
        };
        if !session.loaded || session.token.is_none() {
            return;
        }
        let track = &session.track;
        let empty = info.title.trim().is_empty();
        if !empty
            && (!same(&info.title, &track.title)
                || !artists(&info.artist, &track.artist)
                || info.duration > 0.0 && (info.duration - track.duration).abs() > 4.0)
        {
            return;
        }
        // SMTC remains the state authority; a disagreement waits for matching
        // native events rather than attaching an obsolete pause/resume anchor.
        if info.playback_available && info.playing != session.playing {
            return;
        }
        if empty {
            info.title = track.title.clone();
            info.artist = track.artist.clone();
            info.album = track.album.clone();
        }
        info.issue = None;
        info.position = position;
        info.duration = track.duration;
        info.playing = session.playing && !session.buffering;
        info.playback_available = true;
        info.timeline_available = true;
        info.timeline_source = Some("netease-events");
        info.timeline_valid_until = Some(observed + FRESH_MS);
        info.updated = observed;
        info.track_id.push_str(&format!(
            ":netease:{}:{}",
            track.id,
            session.token.as_deref().unwrap()
        ));
    }
}

fn decode(byte: u8) -> u8 {
    let high = byte >> 4;
    (((high ^ ((byte & 15) + 8)) & 15) << 4) | ((byte >> 6) << 2) | ((!high) & 3)
}
#[derive(Default)]
struct Tail {
    offset: u64,
    created: u64,
    fingerprint: Vec<u8>,
    pending: Vec<u8>,
    discard: bool,
}
impl Tail {
    fn poll(
        &mut self,
        path: &Path,
        playback: &mut Playback,
        source: Origin,
        read_tick: impl FnOnce() -> u64,
    ) -> std::io::Result<u64> {
        let mut file = File::open(path)?;
        let before = file.metadata()?;
        let mut previous = vec![0; self.fingerprint.len()];
        if self.offset >= previous.len() as u64 {
            file.seek(SeekFrom::Start(self.offset - previous.len() as u64))?;
            let _ = file.read_exact(&mut previous);
        }
        if self.created != before.creation_time()
            || before.len() < self.offset
            || before.len().saturating_sub(self.offset) > TAIL_BYTES
            || previous != self.fingerprint
        {
            *playback = Playback::default();
            *self = Tail {
                offset: before.len().saturating_sub(TAIL_BYTES),
                created: before.creation_time(),
                ..Default::default()
            };
            self.discard = self.offset > 0;
        }
        file.seek(SeekFrom::Start(self.offset))?;
        let mut bytes = Vec::new();
        (&mut file)
            .take(before.len().saturating_sub(self.offset))
            .read_to_end(&mut bytes)?;
        if self.offset + bytes.len() as u64 != before.len()
            || file.metadata()?.creation_time() != before.creation_time()
        {
            return Err(std::io::Error::other("网易云播放日志正在轮换"));
        }
        // Sample after taking the file snapshot: a native event appended while
        // opening the file must not be dropped as a future record forever.
        let tick = read_tick();
        for byte in bytes.into_iter().map(decode) {
            if byte == b'\n' {
                if !self.discard {
                    if let Ok(line) = std::str::from_utf8(&self.pending) {
                        if let Some(event) = event(line.trim_end_matches('\r'), source, tick) {
                            playback.consume(event)
                        }
                    } else {
                        playback.current = None
                    }
                }
                self.pending.clear();
                self.discard = false;
            } else if !self.discard {
                if self.pending.len() < LINE_BYTES {
                    self.pending.push(byte)
                } else {
                    self.pending.clear();
                    self.discard = true;
                    playback.current = None;
                }
            }
        }
        self.offset = before.len();
        self.fingerprint.resize(self.offset.min(64) as usize, 0);
        file.seek(SeekFrom::Start(self.offset - self.fingerprint.len() as u64))?;
        file.read_exact(&mut self.fingerprint)?;
        Ok(tick)
    }
}

#[derive(Default)]
pub(super) struct Clock {
    origin: Option<Origin>,
    tail: Tail,
    playback: Playback,
    last_read: Option<u64>,
}
impl Clock {
    pub(super) fn cover_url(&self, info: &NowPlaying) -> Option<String> {
        let session = self.playback.current.as_ref()?;
        (info.timeline_source == Some("netease-events")
            && info.track_id.ends_with(&format!(
                ":netease:{}:{}",
                session.track.id,
                session.token.as_deref()?
            )))
        .then(|| session.track.cover_url.clone())
        .flatten()
    }

    pub(super) fn control_snapshot(&mut self, target: &Target) -> Option<NowPlaying> {
        let mut value = NowPlaying::default();
        self.update(target, &mut value, super::now());
        // A toggle during buffering cannot be inferred from the displayed
        // playing flag, which deliberately stops the lyric clock.
        if self.playback.current.as_ref()?.buffering || !value.timeline_available {
            return None;
        }
        Some(value)
    }

    pub(super) fn update(&mut self, target: &Target, info: &mut NowPlaying, observed: u64) {
        if target.player_id.as_deref() != Some("netease") {
            *self = Self::default();
            return;
        }
        if info.timeline_available {
            *self = Self::default();
            return;
        }
        let tick = unsafe { GetTickCount64() };
        let Some(source) = origin(target.pid, observed, tick) else {
            return;
        };
        if self
            .origin
            .is_none_or(|previous| previous.pid != source.pid || previous.created != source.created)
        {
            *self = Self {
                origin: Some(source),
                ..Default::default()
            };
        }
        if self
            .last_read
            .is_some_and(|previous| tick.saturating_sub(previous) > 4000)
        {
            if let Some(session) = &mut self.playback.current {
                session.anchor = None
            }
        }
        let Some(base) = std::env::var_os("LOCALAPPDATA") else {
            return;
        };
        let path = PathBuf::from(base).join("NetEase/CloudMusic/cloudmusic.elog");
        let Ok(read_tick) =
            self.tail
                .poll(&path, &mut self.playback, self.origin.unwrap(), || unsafe {
                    GetTickCount64()
                })
        else {
            return;
        };
        self.last_read = Some(read_tick);
        self.playback.apply(
            info,
            observed.saturating_add(read_tick.saturating_sub(tick)),
            read_tick,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{fs, io::Write};

    fn source() -> Origin {
        Origin {
            pid: 42,
            created: 100,
            first_tick: 100,
        }
    }
    fn track(id: &str) -> Value {
        json!({"track":{"id":id,"name":"雨爱","duration":260480,
            "artists":[{"name":"杨丞琳"}],"album":{"name":"Rainie & Love"}}})
    }
    fn line(at: u64, action: &str, args: Vec<Value>) -> String {
        let mut args = args;
        args.insert(0, json!(action));
        let body = serde_json::to_string(&args).unwrap();
        format!(
            "[42:9:1108/191933:{at}:INFO:app.cpp(1231)] [2026-11-08 19:19:33] 【playing】,{}\r\n",
            &body[1..body.len() - 1]
        )
    }
    fn send(playback: &mut Playback, at: u64, action: &str, args: Vec<Value>) {
        playback.consume(event(line(at, action, args).trim(), source(), 1_000_000).unwrap());
    }
    fn start(playback: &mut Playback, at: u64, id: &str, instance: &str) {
        send(playback, at, "playOneTrackInPlayingList", vec![track(id)]);
        send(
            playback,
            at + 100,
            "native播放资源load完成，开始播放",
            vec![json!({"songId":id})],
        );
        send(
            playback,
            at + 200,
            "native播放state",
            vec![json!(1), json!(format!("{id}_{instance}"))],
        );
    }
    fn info() -> NowPlaying {
        NowPlaying {
            title: "雨爱".into(),
            artist: "杨丞琳".into(),
            playing: true,
            playback_available: true,
            track_id: "smtc".into(),
            ..Default::default()
        }
    }
    fn position(playback: &Playback, at: u64) -> Option<f64> {
        playback.current.as_ref().and_then(|s| s.position(at))
    }
    fn encoded(text: &str) -> Vec<u8> {
        let mut table = [0; 256];
        for byte in 0..=255u8 {
            table[decode(byte) as usize] = byte
        }
        text.bytes().map(|byte| table[byte as usize]).collect()
    }
    struct Log(PathBuf);
    impl Log {
        fn new(bytes: &[u8]) -> Self {
            let path = std::env::temp_dir().join(format!(
                "soundspectra-netease-events-{}.elog",
                format!(
                    "{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                )
            ));
            fs::write(&path, bytes).unwrap();
            Self(path)
        }
        fn append(&self, bytes: &[u8]) {
            fs::OpenOptions::new()
                .append(true)
                .open(&self.0)
                .unwrap()
                .write_all(bytes)
                .unwrap();
        }
    }
    impl Drop for Log {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    #[test]
    fn headers_filter_pid_boot_process_start_and_future_records() {
        let text = line(120, "native播放state", vec![json!(1), json!("316100_A")]);
        assert_eq!(event(text.trim(), source(), 130).unwrap().tick, 120);
        assert!(event(&text.replace("[42:", "[43:"), source(), 130).is_none());
        assert!(event(&text, source(), 119).is_none());
        assert!(event(
            &text,
            Origin {
                first_tick: 121,
                ..source()
            },
            130
        )
        .is_none());
        assert!(event(&text.replace("[42:", "broken[42:"), source(), 130).is_none());
        assert!(event(
            &line(120, "unrelated", vec![json!({"id":316100})]),
            source(),
            130
        )
        .is_none());
        assert!(event(&text.replace("\"316100_A\"", "invalid-json"), source(), 130).is_none());
        assert!(token(&json!("316100_/../invalid")).is_none());
    }

    #[test]
    fn selected_song_and_load_are_not_a_playback_start() {
        let mut playback = Playback::default();
        send(
            &mut playback,
            1000,
            "playOneTrackInPlayingList",
            vec![track("316100")],
        );
        assert_eq!(position(&playback, 1500), None);
        send(
            &mut playback,
            2000,
            "native播放资源load完成，开始播放",
            vec![json!({"songId":"316100"})],
        );
        let mut value = info();
        playback.apply(&mut value, 10000, 7000);
        assert!(!value.timeline_available);
        send(
            &mut playback,
            8000,
            "native播放state",
            vec![json!(1), json!("316100_A")],
        );
        assert_eq!(
            position(&playback, 8500),
            Some(0.5),
            "loading time must not count as playback"
        );
        let mut value = info();
        playback.apply(&mut value, 10000, 8500);
        assert_eq!(value.position, 0.5);
        assert_eq!(value.duration, 260.48);
        assert_eq!(value.timeline_source, Some("netease-events"));
        assert_eq!(value.timeline_valid_until, Some(12500));
    }

    #[test]
    fn pause_resume_duplicates_and_absolute_seek_preserve_the_clock() {
        let mut playback = Playback::default();
        start(&mut playback, 1000, "316100", "A");
        send(
            &mut playback,
            6200,
            "native播放state",
            vec![json!(2), json!("316100_A")],
        );
        assert_eq!(position(&playback, 9000), Some(5.0));
        send(
            &mut playback,
            10200,
            "native播放state",
            vec![json!(1), json!("316100_A")],
        );
        send(
            &mut playback,
            11200,
            "native播放state",
            vec![json!(1), json!("316100_A")],
        );
        assert_eq!(position(&playback, 12200), Some(7.0));
        send(
            &mut playback,
            12200,
            "setPlayingPosition",
            vec![json!(3.25)],
        );
        assert_eq!(position(&playback, 12700), Some(3.75));
        send(
            &mut playback,
            12700,
            "native播放state",
            vec![json!(2), json!("316100_A")],
        );
        send(&mut playback, 13000, "setPlayingPosition", vec![json!(32)]);
        assert_eq!(position(&playback, 20000), Some(32.0));
        let mut paused = NowPlaying {
            playing: false,
            ..info()
        };
        playback.apply(&mut paused, 10000, 20000);
        assert!(paused.timeline_available);
        assert!(!paused.playing);
    }

    #[test]
    fn buffering_freezes_only_its_play_instance_and_reload_keeps_position() {
        let mut playback = Playback::default();
        start(&mut playback, 1000, "316100", "A");
        send(
            &mut playback,
            2200,
            "PlayerBuffering",
            vec![json!("316100_Old"), json!(1)],
        );
        assert_eq!(position(&playback, 3200), Some(2.0));
        send(
            &mut playback,
            3200,
            "PlayerBuffering",
            vec![json!("316100_A"), json!(1)],
        );
        assert_eq!(position(&playback, 9200), Some(2.0));
        let mut value = info();
        playback.apply(&mut value, 10000, 9200);
        assert!(!value.playing);
        send(
            &mut playback,
            9200,
            "PlayerBufferingEnd",
            vec![json!("316100_A"), json!(0)],
        );
        send(
            &mut playback,
            10200,
            "native播放资源load完成，开始播放",
            vec![json!({"songId":"316100"})],
        );
        send(
            &mut playback,
            15200,
            "native播放state",
            vec![json!(1), json!("316100_B")],
        );
        assert_eq!(position(&playback, 16200), Some(4.0));
    }

    #[test]
    fn switch_invalidates_immediately_and_repeated_song_gets_a_new_identity() {
        let mut playback = Playback::default();
        start(&mut playback, 1000, "316100", "A");
        let mut before = info();
        playback.apply(&mut before, 10000, 2200);
        send(
            &mut playback,
            3200,
            "playOneTrackInPlayingList",
            vec![track("316100")],
        );
        let mut pending = info();
        playback.apply(&mut pending, 10000, 4200);
        assert!(!pending.timeline_available);
        send(
            &mut playback,
            4300,
            "native播放state",
            vec![json!(1), json!("316100_A")],
        );
        assert!(!playback.current.as_ref().unwrap().loaded);
        send(
            &mut playback,
            4400,
            "native播放资源load完成，开始播放",
            vec![json!({"songId":"316100"})],
        );
        send(
            &mut playback,
            4500,
            "native播放state",
            vec![json!(1), json!("316100_B")],
        );
        let mut after = info();
        playback.apply(&mut after, 10000, 5000);
        assert_eq!(after.position, 0.5);
        assert_ne!(before.track_id, after.track_id);
    }

    #[test]
    fn metadata_preload_does_not_select_a_song_or_invent_a_restore_position() {
        let mut playback = Playback::default();
        send(
            &mut playback,
            1000,
            "checkPlayPrivilege",
            vec![track("316100")],
        );
        send(
            &mut playback,
            1100,
            "native播放资源load完成，开始播放",
            vec![json!({"songId":"316100"})],
        );
        send(
            &mut playback,
            1200,
            "native播放state",
            vec![json!(1), json!("316100_A")],
        );
        assert_eq!(position(&playback, 2200), None);
        send(&mut playback, 2300, "setPlayingPosition", vec![json!(24)]);
        assert_eq!(position(&playback, 2800), Some(24.5));
        send(
            &mut playback,
            2900,
            "checkPlayPrivilege",
            vec![track("888")],
        );
        assert_eq!(playback.current.as_ref().unwrap().track.id, "316100");
    }

    #[test]
    fn cold_restore_uses_native_metadata_and_absolute_position_without_smtc() {
        let mut playback = Playback::default();
        send(&mut playback, 1000, "nativePlay", vec![track("316100")]);
        send(
            &mut playback,
            2000,
            "native播放资源load完成，开始播放",
            vec![json!({"songId":"316100"})],
        );
        let mut value = NowPlaying::default();
        playback.apply(&mut value, 10000, 2100);
        assert!(
            !value.timeline_available,
            "restored metadata is not a clock"
        );
        send(&mut playback, 2200, "setPlayingPosition", vec![json!(103)]);
        playback.apply(&mut value, 10000, 2250);
        assert!(
            !value.timeline_available,
            "the native state is still required"
        );
        send(
            &mut playback,
            2300,
            "native播放state",
            vec![json!(1), json!("316100_Restored")],
        );
        playback.apply(&mut value, 10000, 3300);
        assert_eq!(value.title, "雨爱");
        assert_eq!(value.artist, "杨丞琳");
        assert_eq!(value.position, 104.0);
        assert!(value.playing && value.timeline_available);
        assert_eq!(value.timeline_source, Some("netease-events"));

        let mut missing_seek = Playback::default();
        send(&mut missing_seek, 1000, "nativePlay", vec![track("316100")]);
        send(
            &mut missing_seek,
            2000,
            "native播放资源load完成，开始播放",
            vec![json!({"songId":"316100"})],
        );
        send(
            &mut missing_seek,
            2300,
            "native播放state",
            vec![json!(1), json!("316100_Restored")],
        );
        let mut value = NowPlaying::default();
        missing_seek.apply(&mut value, 10000, 3300);
        assert!(
            !value.timeline_available,
            "never assume a restored song starts at zero"
        );
    }

    #[test]
    #[ignore = "Replays this process's existing cold-start records with no SMTC or playback controls"]
    fn installed_cold_restore_without_smtc_read_only() {
        let pid: u32 = std::env::var("SOUNDSPECTRA_TEST_NETEASE_PID")
            .expect("set the running NetEase main PID")
            .parse()
            .unwrap();
        let observed = super::super::now();
        let tick = unsafe { GetTickCount64() };
        let source = origin(pid, observed, tick).expect("read the current process identity");
        let path = PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap())
            .join("NetEase/CloudMusic/cloudmusic.elog");
        let mut file = File::open(path).unwrap();
        let offset = file.metadata().unwrap().len().saturating_sub(TAIL_BYTES);
        file.seek(SeekFrom::Start(offset)).unwrap();
        let mut bytes = Vec::new();
        file.take(TAIL_BYTES).read_to_end(&mut bytes).unwrap();
        let decoded: Vec<_> = bytes.into_iter().map(decode).collect();
        let text = String::from_utf8_lossy(&decoded);
        let mut playback = Playback::default();
        let mut restored_metadata = false;
        for line in text.lines().skip(usize::from(offset > 0)) {
            let Some(event) = event(line, source, tick) else {
                continue;
            };
            // Only inspect startup before the user selects another track.
            if event.action == "playOneTrackInPlayingList" {
                break;
            }
            restored_metadata |= event.action == "nativePlay";
            let at = event.tick;
            playback.consume(event);
            let mut without_smtc = NowPlaying::default();
            playback.apply(&mut without_smtc, observed, at);
            if restored_metadata && without_smtc.timeline_available {
                assert!(
                    without_smtc.position > 0.0 && without_smtc.duration > without_smtc.position
                );
                assert!(!without_smtc.title.is_empty() && !without_smtc.artist.is_empty());
                assert_eq!(without_smtc.timeline_source, Some("netease-events"));
                eprintln!(
                    "Verified existing cold-start records without SMTC: {} / {}; restored {:.3}s / {:.3}s",
                    without_smtc.title, without_smtc.artist, without_smtc.position, without_smtc.duration
                );
                return;
            }
        }
        panic!("no complete cold-start metadata/load/absolute-position/state sequence in the current process's log tail");
    }

    #[test]
    fn rejects_smtc_conflicts_but_fills_missing_metadata_from_current_process() {
        let mut playback = Playback::default();
        start(&mut playback, 1000, "316100", "A");
        for mut value in [
            NowPlaying {
                title: "雨爱 (Live)".into(),
                ..info()
            },
            NowPlaying {
                artist: "其他歌手".into(),
                ..info()
            },
            NowPlaying {
                duration: 280.0,
                ..info()
            },
            NowPlaying {
                playing: false,
                ..info()
            },
        ] {
            playback.apply(&mut value, 10000, 2200);
            assert!(!value.timeline_available);
        }
        let mut value = NowPlaying {
            issue: Some("SMTC unavailable".into()),
            ..Default::default()
        };
        playback.apply(&mut value, 10000, 2200);
        assert_eq!(value.title, "雨爱");
        assert_eq!(value.artist, "杨丞琳");
        assert!(value.issue.is_none());
        assert!(value.playback_available);
        assert!(artists("乙 / 甲", "甲、乙"));
        assert!(!artists("乙 / 甲", "甲"));
    }

    #[test]
    fn unknown_instance_state_bad_seek_out_of_order_and_overrun_invalidate() {
        for case in 0..5 {
            let mut playback = Playback::default();
            start(&mut playback, 1000, "316100", "A");
            match case {
                0 => send(
                    &mut playback,
                    2200,
                    "native播放state",
                    vec![json!(1), json!("316100_B")],
                ),
                1 => send(
                    &mut playback,
                    2200,
                    "native播放state",
                    vec![json!(3), json!("316100_A")],
                ),
                2 => send(&mut playback, 2200, "setPlayingPosition", vec![json!(-1)]),
                3 => send(
                    &mut playback,
                    1100,
                    "native播放state",
                    vec![json!(1), json!("316100_A")],
                ),
                _ => (),
            }
            assert_eq!(
                position(&playback, if case == 4 { 300000 } else { 3200 }),
                None
            );
        }
    }

    #[test]
    fn tail_replays_mid_song_and_only_applies_complete_utf8_records() {
        let initial = format!(
            "{}{}{}",
            line(1000, "playOneTrackInPlayingList", vec![track("316100")]),
            line(
                1100,
                "native播放资源load完成，开始播放",
                vec![json!({"songId":"316100"})]
            ),
            line(1200, "native播放state", vec![json!(1), json!("316100_A")])
        );
        let log = Log::new(&encoded(&initial));
        let mut tail = Tail::default();
        let mut playback = Playback::default();
        tail.poll(&log.0, &mut playback, source(), || 62200)
            .unwrap();
        assert_eq!(position(&playback, 62200), Some(61.0));
        let pause = encoded(&line(
            62200,
            "native播放state",
            vec![json!(2), json!("316100_A")],
        ));
        let split = pause.len() / 2;
        log.append(&pause[..split]);
        tail.poll(&log.0, &mut playback, source(), || 63200)
            .unwrap();
        assert!(playback.current.as_ref().unwrap().playing);
        log.append(&pause[split..]);
        tail.poll(&log.0, &mut playback, source(), || 64200)
            .unwrap();
        assert_eq!(position(&playback, 64200), Some(61.0));
        assert!(!playback.current.as_ref().unwrap().playing);
        assert_eq!(
            fs::read(&log.0).unwrap(),
            [encoded(&initial), pause].concat()
        );
    }

    #[test]
    fn truncation_rewrite_and_bounded_tail_never_keep_an_old_clock() {
        for rewrite in [false, true] {
            let text = line(1000, "playOneTrackInPlayingList", vec![track("316100")]);
            let log = Log::new(&encoded(&text));
            let mut tail = Tail::default();
            let mut playback = Playback::default();
            tail.poll(&log.0, &mut playback, source(), || 2200).unwrap();
            start(&mut playback, 1000, "316100", "A");
            fs::write(
                &log.0,
                if rewrite {
                    encoded(&text.replace("316100", "999999"))
                } else {
                    vec![]
                },
            )
            .unwrap();
            tail.poll(&log.0, &mut playback, source(), || 3200).unwrap();
            assert_eq!(position(&playback, 3200), None);
        }
        let log = Log::new(&vec![encoded("x")[0]; TAIL_BYTES as usize + 10]);
        log.append(&encoded(&format!(
            "\n{}",
            line(1000, "checkPlayPrivilege", vec![track("316100")])
        )));
        let mut playback = Playback::default();
        let mut tail = Tail::default();
        tail.poll(&log.0, &mut playback, source(), || 2200).unwrap();
        assert!(tail.pending.is_empty());
        assert!(playback.current.is_none());
        assert_eq!(playback.tracks.len(), 1);
    }

    #[test]
    fn corrupt_and_oversize_records_clear_the_session() {
        for bytes in [
            encoded(&format!("{}\n", "x".repeat(LINE_BYTES + 1))),
            vec![encoded("x")[0], encoded("\n")[0]],
        ] {
            let log = Log::new(&[]);
            let mut playback = Playback::default();
            let mut tail = Tail::default();
            tail.poll(&log.0, &mut playback, source(), || 2200).unwrap();
            start(&mut playback, 1000, "316100", "A");
            if bytes.len() == 2 {
                log.append(&[encoded("\u{ff}")[0], encoded("\n")[0]])
            } else {
                log.append(&bytes)
            }
            tail.poll(&log.0, &mut playback, source(), || 3200).unwrap();
            assert!(playback.current.is_none());
        }
    }

    #[test]
    fn origin_uses_process_creation_and_working_timelines_remain_authoritative() {
        let at = super::super::now();
        let tick = unsafe { GetTickCount64() };
        let process = origin(std::process::id(), at, tick).unwrap();
        assert!(process.created <= at);
        assert!(process.first_tick <= tick);
        let mut clock = Clock::default();
        let target = Target {
            pid: std::process::id(),
            player_id: Some("netease".into()),
            executable: "test.exe".into(),
            name: "test".into(),
            audible: false,
        };
        let mut value = NowPlaying {
            timeline_available: true,
            position: 42.0,
            ..info()
        };
        clock.update(&target, &mut value, at);
        assert_eq!(value.position, 42.0);
        assert!(
            clock.origin.is_none(),
            "a working timeline must not read local playback logs"
        );
        clock.origin = Some(process);
        clock.update(
            &Target {
                player_id: Some("qqmusic".into()),
                ..target
            },
            &mut value,
            at,
        );
        assert!(clock.origin.is_none());
    }
}
