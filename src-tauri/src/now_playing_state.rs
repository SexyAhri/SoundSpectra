//! Shared media snapshot contract for every platform.
use serde::{Deserialize, Serialize};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover: Option<String>,
    pub position: f64,
    pub duration: f64,
    pub timeline_available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(skip_deserializing)]
    pub timeline_source: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeline_valid_until: Option<u64>,
    pub playing: bool,
    pub source: String,
    pub process_id: Option<u32>,
    pub updated: u64,
    pub issue: Option<String>,
    pub track_id: String,
    pub playback_available: bool,
    pub session_id: String,
    pub controls: crate::card_controls::MediaCapabilities,
}

#[cfg(any(target_os = "macos", test))]
impl NowPlaying {
    pub(crate) fn from_macos_metadata(
        json: serde_json::Value,
        bundle: &str,
        pid: u32,
        revision: u64,
    ) -> Result<Self, String> {
        use std::hash::{DefaultHasher, Hash, Hasher};
        let mut value: Self = serde_json::from_value(json).map_err(|e| e.to_string())?;
        for text in [&mut value.title, &mut value.artist, &mut value.album] {
            *text = text.chars().filter(|c| !c.is_control()).take(200).collect();
        }
        value.timeline_available = !value.title.is_empty()
            && value.duration.is_finite()
            && value.duration > 0.0
            && value.position.is_finite()
            && value.position >= 0.0;
        value.playback_available = !value.title.is_empty();
        value.session_id = bundle.into();
        value.source = bundle.into();
        value.process_id = Some(pid);
        if !value.title.is_empty() {
            let mut identity = DefaultHasher::new();
            (bundle, pid, &value.title, &value.artist, &value.album).hash(&mut identity);
            (value.duration * 10.0)
                .round()
                .to_bits()
                .hash(&mut identity);
            value.track_id = format!("{revision}:{:016x}", identity.finish());
        }
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn metadata() -> serde_json::Value {
        // AudioHelper.swift supplies no Windows-specific session/clock fields.
        json!({"title":"微光", "artist":"歌手", "album":"专辑",
            "position":12.5, "duration":180.0, "playing":true})
    }

    #[test]
    fn macos_helper_snapshot_supplies_shared_lyric_identity() {
        let value =
            NowPlaying::from_macos_metadata(metadata(), "com.tencent.QQMusic", 42, 3).unwrap();
        assert_eq!(value.session_id, "com.tencent.QQMusic");
        assert_eq!(value.source, value.session_id);
        assert!(value.track_id.starts_with("3:"));
        assert!(value.timeline_available && value.playback_available);
        assert!(!value.controls.play);
        let wire = serde_json::to_value(value).unwrap();
        assert_eq!(wire["sessionId"], "com.tencent.QQMusic");
        assert_eq!(wire["position"], 12.5);
        assert!(wire["trackId"].as_str().is_some_and(|id| !id.is_empty()));
        assert!(wire.get("timelineSource").is_none());
    }

    #[test]
    fn macos_identity_survives_progress_but_changes_with_song_player_and_source() {
        let base =
            NowPlaying::from_macos_metadata(metadata(), "com.tencent.QQMusic", 42, 3).unwrap();
        let mut paused = metadata();
        paused["position"] = json!(35.0);
        paused["playing"] = json!(false);
        assert_eq!(
            base.track_id,
            NowPlaying::from_macos_metadata(paused, "com.tencent.QQMusic", 42, 3)
                .unwrap()
                .track_id
        );
        let mut other_song = metadata();
        other_song["title"] = json!("另一首");
        for (data, bundle, pid, revision) in [
            (other_song, "com.tencent.QQMusic", 42, 3),
            (metadata(), "com.netease.163music", 42, 3),
            (metadata(), "com.tencent.QQMusic", 43, 3),
            (metadata(), "com.tencent.QQMusic", 42, 4),
        ] {
            assert_ne!(
                base.track_id,
                NowPlaying::from_macos_metadata(data, bundle, pid, revision)
                    .unwrap()
                    .track_id
            );
        }
        let empty =
            NowPlaying::from_macos_metadata(json!({}), "com.tencent.QQMusic", 42, 3).unwrap();
        assert!(empty.track_id.is_empty());
        assert!(!empty.timeline_available && !empty.playback_available);
    }
}
