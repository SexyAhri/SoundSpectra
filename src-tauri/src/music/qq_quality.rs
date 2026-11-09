//! QQ file variants and entitlement ordering. The server remains authoritative;
//! loyalty levels (e.g. SVIP8) never grant a format on their own.
use super::model::{Audio, AudioQuality, Membership, Track};
use serde_json::Value;
use std::collections::HashMap;

pub const MAX_AUDIO_BYTES: usize = 256 * 1024 * 1024;

#[derive(Clone, Copy, Debug)]
pub struct Variant {
    pub id: &'static str,
    pub label: &'static str,
    pub extension: &'static str,
    field: &'static str,
    new_index: Option<usize>,
}

pub const VARIANTS: [Variant; 8] = [
    Variant {
        id: "AI00",
        label: "臻品母带",
        extension: "flac",
        field: "",
        new_index: Some(0),
    },
    Variant {
        id: "Q000",
        label: "臻品音质",
        extension: "flac",
        field: "",
        new_index: Some(1),
    },
    Variant {
        id: "Q001",
        label: "臻品全景声",
        extension: "flac",
        field: "",
        new_index: Some(2),
    },
    Variant {
        id: "RS01",
        label: "Hi-Res 无损",
        extension: "flac",
        field: "size_hires",
        new_index: None,
    },
    Variant {
        id: "F000",
        label: "SQ 无损",
        extension: "flac",
        field: "size_flac",
        new_index: None,
    },
    Variant {
        id: "M800",
        label: "HQ 高品质",
        extension: "mp3",
        field: "size_320mp3",
        new_index: None,
    },
    Variant {
        id: "M500",
        label: "标准音质",
        extension: "mp3",
        field: "size_128mp3",
        new_index: None,
    },
    Variant {
        id: "C400",
        label: "流畅音质",
        extension: "m4a",
        field: "size_96aac",
        new_index: None,
    },
];

pub fn sizes(file: &Value) -> HashMap<String, u64> {
    VARIANTS
        .iter()
        .filter_map(|v| {
            let size = match v.new_index {
                Some(i) => file["size_new"].get(i),
                None => file.get(v.field),
            }?
            .as_u64()?;
            Some((v.id.into(), size))
        })
        .collect()
}

pub fn candidates(member: Option<&Membership>, track: &Track, below: Option<&str>) -> Vec<Variant> {
    let active = member.is_some_and(|m| {
        m.active
            && m.expires
                .as_deref()
                .is_some_and(|t| t > super::china_timestamp().as_str())
    });
    // Unknown membership still probes authorized formats; a failed profile RPC
    // must not silently cap a paying account at standard quality.
    let first = match member {
        None => 0,
        Some(m) if active && m.name == "SVIP" => 0,
        Some(_) if active => 3,
        Some(_) => 5,
    };
    let first = below
        .and_then(|id| VARIANTS.iter().position(|v| v.id == id))
        .map_or(first, |index| first.max(index + 1));
    VARIANTS
        .iter()
        .skip(first)
        .filter(|v| {
            track
                .audio_sizes
                .get(v.id)
                .is_none_or(|n| *n > 0 && *n <= MAX_AUDIO_BYTES as u64)
        })
        .copied()
        .collect()
}

impl Variant {
    pub fn filename(self, media: &str) -> String {
        format!("{}{media}.{}", self.id, self.extension)
    }

    pub fn matches_filename(self, filename: &str) -> bool {
        filename
            .strip_prefix(self.id)
            .and_then(|name| name.strip_suffix(&format!(".{}", self.extension)))
            .is_some_and(|mid| !mid.is_empty() && mid.bytes().all(|c| c.is_ascii_alphanumeric()))
    }

    pub fn audio(
        self,
        bytes: Vec<u8>,
        duration: f64,
        fallback: Option<String>,
    ) -> Result<Audio, String> {
        let (mime, codec) = if bytes.starts_with(b"fLaC") {
            ("audio/flac", "FLAC")
        } else if bytes.starts_with(b"ID3")
            || (bytes.first() == Some(&0xff) && bytes.get(1).is_some_and(|b| b & 0xe0 == 0xe0))
        {
            ("audio/mpeg", "MP3")
        } else if bytes.get(4..8) == Some(b"ftyp") {
            ("audio/mp4", "AAC")
        } else {
            return Err("资源不是播放器支持的音频格式".into());
        };
        if !matches!(
            (self.extension, codec),
            ("flac", "FLAC") | ("mp3", "MP3") | ("m4a", "AAC")
        ) {
            return Err("音频实际编码与请求音质不一致".into());
        }
        let mut quality = AudioQuality {
            id: self.id.into(),
            label: self.label.into(),
            codec: codec.into(),
            sample_rate: None,
            bit_depth: None,
            channels: None,
            bitrate: (duration.is_finite() && duration > 0.0)
                .then(|| (bytes.len() as f64 * 8.0 / duration).round() as u32),
            fallback,
        };
        if codec == "FLAC" {
            // The first mandatory block is STREAMINFO (34 bytes). Read the real
            // sample rate/precision/channels, never infer them from a tier name.
            if bytes.len() < 42 || bytes[4] & 0x7f != 0 || bytes[5..8] != [0, 0, 34] {
                return Err("FLAC 音频头无效".into());
            }
            let info = u64::from_be_bytes(bytes[18..26].try_into().unwrap());
            let sample_rate = (info >> 44) as u32;
            let bit_depth = ((info >> 36) & 31) as u8 + 1;
            if sample_rate == 0 || !(4..=32).contains(&bit_depth) {
                return Err("FLAC 音频规格无效".into());
            }
            quality.sample_rate = Some(sample_rate);
            quality.bit_depth = Some(bit_depth);
            quality.channels = Some(((info >> 41) & 7) as u8 + 1);
        }
        Ok(Audio {
            bytes,
            mime,
            quality,
            stream: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn member(name: &str, active: bool) -> Membership {
        Membership {
            name: name.into(),
            active,
            level: 8,
            expires: Some("2099-01-01 00:00:00".into()),
        }
    }
    #[test]
    fn entitlement_type_expiry_and_resources_determine_highest_not_loyalty_level() {
        let track = super::super::qq::track(&json!({"mid":"abc","title":"test"})).unwrap();
        assert_eq!(
            candidates(Some(&member("SVIP", true)), &track, None)[0].id,
            "AI00"
        );
        assert_eq!(
            candidates(Some(&member("绿钻", true)), &track, None)[0].id,
            "RS01"
        );
        assert_eq!(
            candidates(Some(&member("SVIP", false)), &track, None)[0].id,
            "M800"
        );
        let mut expired = member("SVIP", true);
        expired.expires = Some("2000-01-01 00:00:00".into());
        assert_eq!(candidates(Some(&expired), &track, None)[0].id, "M800");
        assert_eq!(candidates(None, &track, None)[0].id, "AI00");
        let mut missing = track.clone();
        missing.audio_sizes =
            sizes(&json!({"size_new":[0,1024,0],"size_hires":0,"size_flac":MAX_AUDIO_BYTES + 1}));
        assert_eq!(candidates(None, &missing, None)[0].id, "Q000");
        assert_eq!(candidates(None, &track, Some("F000"))[0].id, "M800");
        assert!(candidates(None, &track, Some("C400")).is_empty());
    }
    #[test]
    fn real_flac_metadata_is_reported_and_wrong_formats_are_rejected() {
        let mut bytes = vec![0; 42];
        bytes[..8].copy_from_slice(b"fLaC\x80\0\0\x22");
        let info = (192000_u64 << 44) | (1 << 41) | (23 << 36) | 192000;
        bytes[18..26].copy_from_slice(&info.to_be_bytes());
        let audio = VARIANTS[0].audio(bytes.clone(), 1.0, None).unwrap();
        assert_eq!(audio.mime, "audio/flac");
        assert_eq!(audio.quality.sample_rate, Some(192000));
        assert_eq!(audio.quality.bit_depth, Some(24));
        assert_eq!(audio.quality.channels, Some(2));
        assert!(VARIANTS[5].audio(bytes, 1.0, None).is_err());
        assert!(VARIANTS[0].audio(b"ID3fake".to_vec(), 1.0, None).is_err());
        assert!(VARIANTS[0].audio(b"fLaC".to_vec(), 1.0, None).is_err());
        assert!(VARIANTS[0]
            .audio(b"{\"error\":404}".to_vec(), 1.0, None)
            .is_err());
    }

    #[test]
    fn authorized_high_quality_files_can_use_variant_specific_media_ids() {
        let master = VARIANTS[0];
        assert!(master.matches_filename("AI00differentMedia42.flac"));
        assert!(!master.matches_filename("F000differentMedia42.flac"));
        assert!(!master.matches_filename("AI00differentMedia42.mp3"));
        assert!(!master.matches_filename("AI00../secret.flac"));
        assert!(!master.matches_filename("AI00.flac"));
    }
}
