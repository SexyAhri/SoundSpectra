//! NetEase quality IDs are independent of QQ filenames. Returned authorization
//! and actual file headers determine the displayed quality.
use super::model::{Audio, AudioQuality, Track};
use serde_json::Value;
use std::collections::HashMap;

// This is the automatic selection preference, not a comparison of measured
// fidelity between stereo masters and spatial formats. The actual grant and
// decoder support still determine which resource can play.
pub const LEVELS: [(&str, &str, Option<&str>); 10] = [
    ("vivid", "臻音全景声", None),
    ("dolby", "杜比全景声", None),
    ("jymaster", "超清母带", None),
    ("sky", "沉浸环绕", None),
    ("jyeffect", "高清臻音", None),
    ("hires", "Hi-Res", Some("hr")),
    ("lossless", "无损", Some("sq")),
    ("exhigh", "极高", Some("h")),
    ("higher", "较高", Some("m")),
    ("standard", "标准", Some("l")),
];
pub fn rank(level: &str) -> Option<usize> {
    LEVELS.iter().position(|v| v.0 == level)
}
pub fn label(level: &str) -> Option<&'static str> {
    rank(level).map(|i| LEVELS[i].1)
}
pub fn encode_type(level: &str) -> &'static str {
    if level == "vivid" {
        "mp3"
    } else {
        "flac"
    }
}
pub fn sizes(song: &Value) -> HashMap<String, u64> {
    LEVELS
        .iter()
        .filter_map(|(id, _, key)| {
            song[(*key)?]["size"]
                .as_u64()
                .map(|size| ((*id).into(), size))
        })
        .collect()
}
pub fn candidates(track: &Track, below: Option<&str>) -> Vec<&'static str> {
    let start = match below {
        Some(id) => match rank(id) {
            Some(i) => i + 1,
            None => return vec![],
        },
        None => 0,
    };
    LEVELS
        .iter()
        .skip(start)
        .filter(|(id, _, _)| {
            track
                .audio_sizes
                .get(*id)
                .is_none_or(|n| *n > 0 && *n <= super::qq_quality::MAX_AUDIO_BYTES as u64)
        })
        .map(|v| v.0)
        .collect()
}
pub fn audio(
    bytes: Vec<u8>,
    level: &str,
    format: &str,
    bitrate: Option<u32>,
    fallback: Option<String>,
) -> Result<Audio, String> {
    let index = rank(level).ok_or("[decode] 网易云返回了不支持的音质")?;
    let (mime, codec) = if bytes.starts_with(b"fLaC") && format == "flac" {
        ("audio/flac", "FLAC")
    } else if format == "mp3"
        && (bytes.starts_with(b"ID3")
            || bytes.first() == Some(&0xff) && bytes.get(1).is_some_and(|b| b & 0xe0 == 0xe0))
    {
        ("audio/mpeg", "MP3")
    } else {
        return Err("[decode] 网易云音频实际格式不可用".into());
    };
    let mut quality = AudioQuality {
        id: level.into(),
        label: LEVELS[index].1.into(),
        codec: codec.into(),
        sample_rate: None,
        bit_depth: None,
        channels: None,
        bitrate,
        fallback,
    };
    if codec == "FLAC" {
        if bytes.len() < 42 || bytes[4] & 0x7f != 0 || bytes[5..8] != [0, 0, 34] {
            return Err("[decode] FLAC 音频头无效".into());
        }
        let info = u64::from_be_bytes(bytes[18..26].try_into().unwrap());
        let rate = (info >> 44) as u32;
        let depth = ((info >> 36) & 31) as u8 + 1;
        if rate == 0 || !(4..=32).contains(&depth) {
            return Err("[decode] FLAC 音频规格无效".into());
        }
        quality.sample_rate = Some(rate);
        quality.bit_depth = Some(depth);
        quality.channels = Some(((info >> 41) & 7) as u8 + 1);
    }
    Ok(Audio {
        bytes,
        mime,
        quality,
        stream: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fallback_terminates_and_unknown_ids_cannot_restart_at_highest() {
        let track =
            super::super::netease::track(&serde_json::json!({"id":1,"name":"测试"})).unwrap();
        assert_eq!(
            candidates(&track, Some("exhigh")),
            vec!["higher", "standard"]
        );
        assert!(candidates(&track, Some("standard")).is_empty());
        assert!(candidates(&track, Some("M800")).is_empty());
    }
    #[test]
    fn full_platform_levels_are_preserved_without_inventing_resource_sizes() {
        let track = super::super::netease::track(&serde_json::json!({
            "id": 1, "name": "测试", "hr": {"size": 0}, "sq": {"size": 12345},
            "h": {"size": 2345}, "m": {"size": 1234}, "l": {"size": 123}
        }))
        .unwrap();
        assert_eq!(
            candidates(&track, None),
            vec![
                "vivid", "dolby", "jymaster", "sky", "jyeffect", "lossless", "exhigh", "higher",
                "standard"
            ]
        );
        assert_eq!(
            candidates(&track, Some("jymaster")),
            vec!["sky", "jyeffect", "lossless", "exhigh", "higher", "standard"]
        );
        assert!(!track.audio_sizes.contains_key("jymaster"));
        assert_eq!(track.audio_sizes["higher"], 1234);
        assert_eq!(encode_type("vivid"), "mp3");
        assert_eq!(encode_type("jymaster"), "flac");
    }
    #[test]
    fn headers_must_match_authorized_format_and_flac_uses_streaminfo() {
        assert!(audio(b"<html>".to_vec(), "standard", "mp3", None, None).is_err());
        assert!(audio(b"ID3fixture".to_vec(), "lossless", "flac", None, None).is_err());
        let mut flac = vec![0u8; 42];
        flac[..4].copy_from_slice(b"fLaC");
        flac[7] = 34;
        let info = (96000u64 << 44) | (1u64 << 41) | (23u64 << 36);
        flac[18..26].copy_from_slice(&info.to_be_bytes());
        let a = audio(flac, "hires", "flac", None, None).unwrap();
        assert_eq!(
            (
                a.quality.sample_rate,
                a.quality.bit_depth,
                a.quality.channels
            ),
            (Some(96000), Some(24), Some(2))
        );
    }
}
