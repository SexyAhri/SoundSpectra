//! KuGou 20 can publish metadata but an entirely empty SMTC timeline. Its
//! periodically saved playback checkpoint is a bounded, lower precision fallback.
//! Never use process start time or the time SoundSpectra happened to open.
use super::NowPlaying;
use crate::audio_source::Target;
use std::{fs, io::Read, path::Path, time::UNIX_EPOCH};

const MAX_AGE: u64 = 35_000;

#[derive(Clone, Debug, PartialEq)]
struct Sample {
    hash: String,
    title: String,
    position: u64,
    modified: u64,
}
fn parse(text: &str, modified: u64) -> Option<Sample> {
    let mut hash = None;
    let mut title = None;
    let mut position = None;
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "LastPlayingSongHash" => hash = Some(value.to_ascii_lowercase()),
            "LastPlayingTitleName" => title = Some(value.to_owned()),
            "LastPlayingSongPos" => position = value.parse::<u64>().ok(),
            _ => (),
        }
    }
    let hash = hash?;
    let position = position?;
    if hash.len() != 32 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) || position > 86_400_000 {
        return None;
    }
    Some(Sample {
        hash,
        title: title?,
        position,
        modified,
    })
}
fn sample(path: &Path) -> Option<Sample> {
    let before = fs::metadata(path).ok()?;
    if before.len() > 131_072 {
        return None;
    }
    let modified = before
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(131_073)
        .read_to_end(&mut bytes)
        .ok()?;
    let after = fs::metadata(path).ok()?;
    if bytes.len() as u64 != before.len()
        || before.len() != after.len()
        || before.modified().ok()? != after.modified().ok()?
    {
        return None;
    }
    parse(&crate::lyrics::decode(&bytes).ok()?, modified)
}
fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
fn matches(sample: &Sample, info: &NowPlaying) -> bool {
    if info.title.trim().is_empty() || info.artist.trim().is_empty() {
        return false;
    }
    normalize(&sample.title) == normalize(&format!("{} - {}", info.artist, info.title))
}

#[derive(Default)]
pub(super) struct Clock {
    key: String,
    playing: bool,
    not_before: u64,
    last: Option<Sample>,
    anchor: Option<Sample>,
}
impl Clock {
    pub(super) fn update(&mut self, target: &Target, info: &mut NowPlaying, observed: u64) {
        if target.player_id.as_deref() != Some("kugou")
            || info.timeline_available
            || !info.playback_available
        {
            *self = Self::default();
            return;
        }
        let Some(base) = std::env::var_os("APPDATA") else {
            return;
        };
        let next = sample(&std::path::PathBuf::from(base).join("KuGou8/KuGou.ini"));
        self.observe(target.pid, info, next, observed);
    }
    fn observe(&mut self, pid: u32, info: &mut NowPlaying, next: Option<Sample>, observed: u64) {
        let key = format!(
            "{pid}:{}:{}:{}:{}",
            info.track_id, info.title, info.artist, info.album
        );
        if self.key != key || self.playing != info.playing {
            *self = Self {
                key,
                playing: info.playing,
                not_before: observed,
                ..Default::default()
            };
        }
        let Some(next) = next.filter(|s| matches(s, info)) else {
            self.anchor = None;
            self.last = None;
            return;
        };
        // A config's file mtime is not itself a player timestamp: unrelated
        // settings can rewrite it. Require a real position change after we
        // began observing this track/state, and never renew an unchanged anchor.
        if let Some(previous) = &self.last {
            if previous.hash != next.hash {
                self.anchor = None;
            } else if next.position != previous.position
                && next.modified > previous.modified
                && next.modified >= self.not_before
                && next.modified <= observed
                && observed - next.modified <= MAX_AGE
            {
                self.anchor = Some(next.clone());
            }
        }
        self.last = Some(next);
        let Some(anchor) = &self.anchor else {
            return;
        };
        if anchor.modified > observed || observed - anchor.modified > MAX_AGE {
            return;
        }
        let position = anchor.position.saturating_add(if info.playing {
            observed - anchor.modified
        } else {
            0
        });
        if position > 86_400_000
            || info.duration > 0.0 && position as f64 > (info.duration + 4.0) * 1000.0
        {
            return;
        }
        info.position = position as f64 / 1000.0;
        info.timeline_available = true;
        info.timeline_source = Some("kugou-checkpoint");
        info.timeline_valid_until = Some(anchor.modified + MAX_AGE);
        info.track_id.push_str(&format!(":kugou:{}", anchor.hash));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn info() -> NowPlaying {
        NowPlaying {
            title: "微光".into(),
            artist: "歌手".into(),
            playing: true,
            playback_available: true,
            track_id: "recording".into(),
            ..Default::default()
        }
    }
    fn checkpoint(position: u64, modified: u64) -> Sample {
        Sample {
            hash: "0123456789abcdef0123456789abcdef".into(),
            title: "歌手 - 微光".into(),
            position,
            modified,
        }
    }
    #[test]
    fn requires_an_observed_position_write_and_never_rebases_an_unchanged_checkpoint() {
        let mut clock = Clock::default();
        let mut value = info();
        clock.observe(1, &mut value, Some(checkpoint(10000, 1000)), 2000);
        assert!(!value.timeline_available);
        clock.observe(1, &mut value, Some(checkpoint(10000, 3000)), 3000);
        assert!(!value.timeline_available);
        clock.observe(1, &mut value, Some(checkpoint(12000, 4000)), 4500);
        assert!(value.timeline_available);
        assert_eq!(value.position, 12.5);
        let mut value = info();
        clock.observe(1, &mut value, Some(checkpoint(12000, 38000)), 40000);
        assert!(
            !value.timeline_available,
            "unrelated config writes must not extend freshness"
        );
    }
    #[test]
    fn seek_reanchors_but_track_pid_pause_and_resume_require_new_checkpoints() {
        let mut clock = Clock::default();
        clock.observe(1, &mut info(), Some(checkpoint(10000, 1000)), 2000);
        clock.observe(1, &mut info(), Some(checkpoint(12000, 4000)), 4000);
        let mut value = info();
        clock.observe(1, &mut value, Some(checkpoint(5000, 5000)), 5500);
        assert_eq!(value.position, 5.5);
        for change in 0..4 {
            let mut value = info();
            let mut next = checkpoint(15000, 6000);
            match change {
                0 => value.playing = false,
                1 => value.track_id = "other".into(),
                2 => next.title = "其他歌手 - 微光".into(),
                _ => (),
            }
            clock.observe(
                if change == 3 { 2 } else { 1 },
                &mut value,
                Some(next),
                6000,
            );
            assert!(!value.timeline_available);
        }
    }
    #[test]
    fn parses_only_the_three_playback_fields_and_rejects_malformed_records() {
        let text="[Play]\nLastPlayingSongHash=0123456789ABCDEF0123456789ABCDEF\nLastPlayingTitleName=歌手 - 微光\nLastPlayingSongPos=1200\nOtherField=ignored";
        assert_eq!(parse(text, 1000).unwrap().position, 1200);
        assert!(parse(&text.replace("1200", "-1"), 1000).is_none());
        assert!(parse(
            &text.replace("0123456789ABCDEF0123456789ABCDEF", "../bad"),
            1000
        )
        .is_none());
        assert!(parse(&text.replace("1200", "86400001"), 1000).is_none());
    }
}
