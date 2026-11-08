//! Read only a stable snapshot of Soda's local media cache.
use super::{lookup, LyricDocument};
use crate::now_playing::NowPlaying;
use serde_json::{Map, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
};

// msgpackr stores object field definitions in extension 0x72, followed by
// record values; later occurrences use the record ID. Decode only bounded,
// self-contained records, never execute the client's JavaScript or native DLL.
struct Decoder<'a> {
    input: &'a [u8],
    records: HashMap<u8, Vec<String>>,
    remaining: usize,
}
impl<'a> Decoder<'a> {
    fn new(input: &'a [u8]) -> Self {
        Self {
            input,
            records: HashMap::new(),
            remaining: 100_000,
        }
    }
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let bytes = self.input.get(..n)?;
        self.input = &self.input[n..];
        Some(bytes)
    }
    fn length(&mut self, n: usize) -> Option<usize> {
        Some(
            self.take(n)?
                .iter()
                .fold(0usize, |a, b| (a << 8) | *b as usize),
        )
    }
    fn object(&mut self, keys: Vec<String>, depth: usize) -> Option<Value> {
        let mut result = Map::new();
        for key in keys {
            result.insert(key, self.read(depth + 1)?);
        }
        Some(Value::Object(result))
    }
    fn read(&mut self, depth: usize) -> Option<Value> {
        if depth > 64 || self.remaining == 0 {
            return None;
        }
        self.remaining -= 1;
        let tag = *self.input.first()?;
        if tag == 0xd4 && self.input.get(1) == Some(&0x72) {
            self.take(2)?;
            let id = self.take(1)?[0] & 0x3f;
            let keys = self
                .read(depth + 1)?
                .as_array()?
                .iter()
                .map(|v| v.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()?;
            self.records.insert(id, keys.clone());
            return self.object(keys, depth);
        }
        if (0x40..0x80).contains(&tag) {
            if let Some(keys) = self.records.get(&(tag & 0x3f)).cloned() {
                self.take(1)?;
                return self.object(keys, depth);
            }
        }
        let array = match tag {
            0x90..=0x9f => Some((tag - 0x90) as usize),
            0xdc | 0xdd => {
                self.take(1)?;
                Some(self.length(if tag == 0xdc { 2 } else { 4 })?)
            }
            _ => None,
        };
        if let Some(len) = array {
            if tag < 0xa0 {
                self.take(1)?;
            }
            if len > self.remaining || len > self.input.len() {
                return None;
            }
            let mut values = Vec::with_capacity(len);
            for _ in 0..len {
                values.push(self.read(depth + 1)?);
            }
            return Some(Value::Array(values));
        }
        let map = match tag {
            0x80..=0x8f => Some((tag - 0x80) as usize),
            0xde | 0xdf => {
                self.take(1)?;
                Some(self.length(if tag == 0xde { 2 } else { 4 })?)
            }
            _ => None,
        };
        if let Some(len) = map {
            if tag < 0x90 {
                self.take(1)?;
            }
            if len > self.remaining / 2 || len > self.input.len() / 2 {
                return None;
            }
            let mut result = Map::new();
            for _ in 0..len {
                let key = self.read(depth + 1)?.as_str()?.to_owned();
                result.insert(key, self.read(depth + 1)?);
            }
            return Some(Value::Object(result));
        }
        // Check announced buffer/string sizes before the general decoder can
        // allocate memory from an untrusted length field.
        let width = match tag {
            0xc4 | 0xc7 | 0xd9 => 1,
            0xc5 | 0xc8 | 0xda => 2,
            0xc6 | 0xc9 | 0xdb => 4,
            _ => 0,
        };
        if width > 0 {
            let length = self
                .input
                .get(1..1 + width)?
                .iter()
                .fold(0usize, |a, b| (a << 8) | *b as usize);
            if length > self.input.len().saturating_sub(1 + width) {
                return None;
            }
        }
        let value = rmpv::decode::read_value(&mut self.input).ok()?;
        Some(match value {
            rmpv::Value::Nil | rmpv::Value::Ext(_, _) | rmpv::Value::Binary(_) => Value::Null,
            rmpv::Value::Boolean(v) => Value::Bool(v),
            rmpv::Value::Integer(v) => {
                if let Some(v) = v.as_u64() {
                    Value::from(v)
                } else {
                    Value::from(v.as_i64()?)
                }
            }
            rmpv::Value::F32(v) => Value::from(v),
            rmpv::Value::F64(v) => Value::from(v),
            rmpv::Value::String(v) => Value::String(v.as_str()?.to_owned()),
            _ => return None,
        })
    }
}

// lmdb-js format 2 has a transaction ID in each 24-byte page header.
// Read bounded committed pages from memory; never open the client's lock file.
fn integer(bytes: &[u8], at: usize, width: usize) -> Option<u64> {
    Some(
        bytes
            .get(at..at.checked_add(width)?)?
            .iter()
            .enumerate()
            .fold(0, |v, (i, b)| v | ((*b as u64) << (i * 8))),
    )
}
fn page_values<'a>(bytes: &'a [u8], stop: Option<&lookup::LocalStop>) -> Option<Vec<&'a [u8]>> {
    let page_size = usize::try_from(integer(bytes, 48, 4)?).ok()?;
    if !(1024..=65536).contains(&page_size) || !page_size.is_power_of_two() {
        return None;
    }
    let meta = [0, page_size]
        .into_iter()
        .filter(|p| {
            integer(bytes, p + 24, 4) == Some(0xbeefc0de)
                && integer(bytes, p + 28, 4) == Some(2)
                && integer(bytes, p + 48, 4) == Some(page_size as u64)
                && integer(bytes, p + 18, 2) == Some(8)
        })
        .max_by_key(|p| integer(bytes, p + 152, 8))?;
    let last = usize::try_from(integer(bytes, meta + 144, 8)?).ok()?;
    if last.checked_add(1)?.checked_mul(page_size)? > bytes.len() {
        return None;
    }
    let root = usize::try_from(integer(bytes, meta + 136, 8)?).ok()?;
    if root == usize::MAX {
        return Some(Vec::new());
    }
    let mut pending = vec![root];
    let mut seen = HashSet::new();
    let mut values = Vec::new();
    while let Some(pg) = pending.pop() {
        if stop.is_some_and(|s| s.is_stopped()) {
            return Some(Vec::new());
        }
        if pg < 2 || pg > last || !seen.insert(pg) || seen.len() > 16384 {
            return None;
        }
        let offset = pg.checked_mul(page_size)?;
        let page = bytes.get(offset..offset.checked_add(page_size)?)?;
        let flags = integer(page, 18, 2)?;
        if flags != 1 && flags != 2 {
            return None;
        }
        let lower = integer(page, 20, 2)? as usize;
        let upper = integer(page, 22, 2)? as usize;
        if lower % 2 != 0 || lower > upper || upper > page_size - 24 {
            return None;
        }
        for i in 0..lower / 2 {
            let pointer = integer(page, 24 + i * 2, 2)? as usize;
            if pointer < upper {
                return None;
            }
            let node = page.get(24 + pointer..)?;
            let size = integer(node, 0, 4)? as usize;
            let node_flags = integer(node, 4, 2)? as usize;
            let key_size = integer(node, 6, 2)? as usize;
            let payload = node.get(8usize.checked_add(key_size)?..)?;
            if flags == 1 {
                pending.push(size.checked_add(node_flags.checked_shl(32)?)?);
                if pending.len() > 16384 {
                    return None;
                }
                continue;
            }
            if node_flags & 6 != 0 {
                continue;
            }
            if node_flags & !7 != 0 || size > 2_097_152 {
                return None;
            }
            let value = if node_flags & 1 != 0 {
                let overflow = usize::try_from(integer(payload, 0, 8)?).ok()?;
                if overflow < 2 || overflow > last {
                    return None;
                }
                let start = overflow.checked_mul(page_size)?;
                if integer(bytes, start + 18, 2)? != 4 {
                    return None;
                }
                let pages = usize::try_from(integer(bytes, start + 20, 4)?).ok()?;
                if pages == 0
                    || overflow.checked_add(pages)? > last + 1
                    || size > pages.checked_mul(page_size)?.checked_sub(24)?
                {
                    return None;
                }
                bytes.get(start.checked_add(24)?..start.checked_add(24)?.checked_add(size)?)?
            } else {
                payload.get(..size)?
            };
            values.push(value);
            if values.len() > 10_000 {
                return None;
            }
        }
    }
    Some(values)
}
fn entries(path: &Path, stop: Option<&lookup::LocalStop>) -> Result<Vec<Value>, String> {
    let before = fs::metadata(path).map_err(|_| "汽水媒体缓存暂时无法读取")?;
    if before.len() > 64 * 1024 * 1024 {
        return Err("汽水媒体缓存过大，暂不读取".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|file| file.take(64 * 1024 * 1024 + 1).read_to_end(&mut bytes))
        .map_err(|_| "汽水媒体缓存暂时无法读取")?;
    let after = fs::metadata(path).map_err(|_| "汽水媒体缓存正在更新")?;
    if bytes.len() as u64 != before.len()
        || before.len() != after.len()
        || before.modified().ok() != after.modified().ok()
    {
        return Err("汽水媒体缓存正在更新，请稍后重试".into());
    }
    let raw = page_values(&bytes, stop).ok_or("汽水媒体缓存格式暂不支持")?;
    let had_records = !raw.is_empty();
    let mut result = Vec::new();
    for data in raw {
        if stop.is_some_and(|s| s.is_stopped()) {
            break;
        }
        if let Some(value) = Decoder::new(data).read(0) {
            result.push(value);
        }
    }
    if had_records && result.is_empty() && !stop.is_some_and(|s| s.is_stopped()) {
        return Err("汽水媒体缓存编码暂不支持".into());
    }
    Ok(result)
}

fn roots() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for variable in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(variable) {
            for name in ["SodaMusic", "soda_music"] {
                let path = PathBuf::from(&base)
                    .join(name)
                    .join("LunaCacheV2/entries.db");
                if path.is_file() {
                    paths.push(path);
                }
            }
        }
    }
    paths.sort();
    paths.dedup();
    paths
}
fn media(value: &Value) -> Option<(super::netease::Track, &str)> {
    let info = value.get("info")?;
    if info.get("isPreview").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let detail = info.get("mediaDetail")?;
    let track = detail
        .pointer("/response/track")
        .or_else(|| detail.pointer("/playable/track"))
        .or_else(|| detail.get("playable"))?;
    let track = super::netease::metadata(track)?;
    if track.id.is_empty()
        || info
            .get("trackId")
            .and_then(Value::as_str)
            .is_some_and(|id| id != track.id)
    {
        return None;
    }
    let lyrics = detail
        .get("lyrics")
        .or_else(|| detail.pointer("/response/lyric"))?;
    if lyrics.get("hide_request_lyrics").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let content = lyrics.get("content")?.as_str()?;
    if content.is_empty() || content.len() > 2_097_152 {
        return None;
    }
    Some((track, content))
}
fn select(
    values: &[Value],
    info: &NowPlaying,
    stop: Option<&lookup::LocalStop>,
) -> Option<LyricDocument> {
    let mut best = None;
    let mut selected: Option<(String, String, Vec<super::Line>)> = None;
    let mut ambiguous = false;
    for value in values {
        if stop.is_some_and(|s| s.is_stopped()) {
            return None;
        }
        let Some((track, content)) = media(value) else {
            continue;
        };
        let Some(score) = super::netease::score(&track, info) else {
            continue;
        };
        if best.is_some_and(|b| score < b) {
            continue;
        }
        let Some(lines) = super::netease::valid_lines(content, info) else {
            continue;
        };
        let signature = serde_json::to_string(&lines).ok()?;
        if best != Some(score) {
            selected = None;
            ambiguous = false;
            best = Some(score);
        }
        if let Some((id, body, _)) = &selected {
            if *id != track.id || *body != signature {
                ambiguous = true;
            }
        } else {
            selected = Some((track.id, signature, lines));
        }
    }
    let (_, _, lines) = selected?;
    Some(LyricDocument {
        key: super::track_key(info),
        status: if ambiguous { "ambiguous" } else { "ready" }.into(),
        message: if ambiguous {
            "汽水缓存中存在多个同名版本，无法确定准确歌词".into()
        } else {
            format!("本地歌词已匹配 · 汽水缓存 · {} 行", lines.len())
        },
        lines: if ambiguous { vec![] } else { lines },
        ..Default::default()
    })
}
pub(super) fn load(info: &NowPlaying, stop: Option<&lookup::LocalStop>) -> Option<LyricDocument> {
    if info.title.is_empty() || info.artist.is_empty() {
        return None;
    }
    let mut values = Vec::new();
    let mut error = None;
    for path in roots() {
        if stop.is_some_and(|s| s.is_stopped()) {
            return None;
        }
        match entries(&path, stop) {
            Ok(found) => values.extend(found),
            Err(e) => error = Some(e),
        }
    }
    select(&values, info, stop).or_else(|| {
        error.map(|message| LyricDocument {
            key: super::track_key(info),
            status: "error".into(),
            message,
            ..Default::default()
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_record_decoding_supports_definitions_and_references() {
        let bytes = [0x92, 0xd4, 0x72, 0x40, 0x91, 0xa1, b'x', 0x01, 0x40, 0x02];
        assert_eq!(
            Decoder::new(&bytes).read(0).unwrap(),
            serde_json::json!([{"x":1},{"x":2}])
        );
        assert!(Decoder::new(&[0xdb, 0xff, 0xff, 0xff, 0xff])
            .read(0)
            .is_none());
        assert!(Decoder::new(&[0xdc, 0xff, 0xff]).read(0).is_none());
    }
    fn record(id: &str, album: &str, body: &str) -> Value {
        serde_json::json!({"info":{"trackId":id,"isPreview":false,"mediaDetail":{
            "playable":{"track":{"id":id,"name":"微光","artists":[{"name":"甲"},{"name":"乙"}],
                "album":{"name":album},"duration":10000}},
            "lyrics":{"type":"krc","content":body}
        }}})
    }
    fn playing() -> NowPlaying {
        NowPlaying {
            title: "微光".into(),
            artist: "乙 / 甲".into(),
            album: "星海".into(),
            duration: 10.0,
            ..Default::default()
        }
    }
    #[test]
    fn exact_record_identity_rejects_wrong_duration_preview_and_hidden_lyrics() {
        let value = record("1", "星海", "[1000,1000]<0,500,0>微<500,500,0>光");
        let found = select(&[value.clone()], &playing(), None).unwrap();
        assert_eq!(found.status, "ready");
        assert_eq!(found.lines[0].words.len(), 2);
        let mut wrong = playing();
        wrong.artist = "丙".into();
        assert!(select(&[value.clone()], &wrong, None).is_none());
        wrong = playing();
        wrong.duration = 30.0;
        assert!(select(&[value.clone()], &wrong, None).is_none());
        for pointer in [
            "/info/isPreview",
            "/info/mediaDetail/lyrics/hide_request_lyrics",
        ] {
            let mut wrong = value.clone();
            if pointer.ends_with("hide_request_lyrics") {
                wrong["info"]["mediaDetail"]["lyrics"]["hide_request_lyrics"] = Value::Bool(true);
            } else {
                *wrong.pointer_mut(pointer).unwrap() = Value::Bool(true);
            }
            assert!(select(&[wrong], &playing(), None).is_none());
        }
        let mut wrong = value;
        wrong["info"]["trackId"] = Value::from("2");
        assert!(select(&[wrong], &playing(), None).is_none());
    }
    #[test]
    fn corrupt_records_do_not_hide_valid_lyrics_but_conflicting_versions_are_ambiguous() {
        let valid = record("1", "星海", "[00:01.00]微光");
        let corrupt = record("2", "星海", "broken");
        assert_eq!(
            select(&[corrupt, valid.clone()], &playing(), None)
                .unwrap()
                .status,
            "ready"
        );
        assert_eq!(
            select(&[valid.clone(), valid.clone()], &playing(), None)
                .unwrap()
                .status,
            "ready"
        );
        let other = record("2", "别的专辑", "[00:01.00]星海");
        assert_eq!(
            select(&[other.clone(), valid.clone()], &playing(), None)
                .unwrap()
                .status,
            "ready"
        );
        let mut unknown = playing();
        unknown.album.clear();
        assert_eq!(
            select(&[other, valid.clone()], &unknown, None)
                .unwrap()
                .status,
            "ambiguous"
        );
        let changed = record("1", "星海", "[00:01.00]不同正文");
        assert_eq!(
            select(&[valid, changed], &playing(), None).unwrap().status,
            "ambiguous"
        );
    }
    fn put(bytes: &mut [u8], at: usize, value: u64, width: usize) {
        bytes[at..at + width].copy_from_slice(&value.to_le_bytes()[..width]);
    }
    fn database(overflow: bool) -> Vec<u8> {
        let mut bytes = vec![0; 4096 * if overflow { 4 } else { 3 }];
        put(&mut bytes, 18, 8, 2);
        put(&mut bytes, 24, 0xbeefc0de, 4);
        put(&mut bytes, 28, 2, 4);
        put(&mut bytes, 48, 4096, 4);
        put(&mut bytes, 136, 2, 8);
        put(&mut bytes, 144, if overflow { 3 } else { 2 }, 8);
        put(&mut bytes, 152, 1, 8);
        let page = 8192;
        put(&mut bytes, page + 18, 2, 2);
        put(&mut bytes, page + 20, 2, 2);
        let node = 4096 - 32;
        put(&mut bytes, page + 22, (node - 24) as u64, 2);
        put(&mut bytes, page + 24, (node - 24) as u64, 2);
        put(&mut bytes, page + node, 3, 4);
        put(&mut bytes, page + node + 6, 1, 2);
        bytes[page + node + 8] = b'k';
        if overflow {
            put(&mut bytes, page + node + 4, 1, 2);
            put(&mut bytes, page + node + 9, 3, 8);
            put(&mut bytes, 12288 + 18, 4, 2);
            put(&mut bytes, 12288 + 20, 1, 4);
            bytes[12288 + 24..12288 + 27].copy_from_slice(b"abc");
        } else {
            bytes[page + node + 9..page + node + 12].copy_from_slice(b"abc");
        }
        bytes
    }
    #[test]
    fn committed_pages_support_inline_and_overflow_values_and_reject_corruption() {
        for overflow in [false, true] {
            let bytes = database(overflow);
            assert_eq!(page_values(&bytes, None).unwrap(), vec![b"abc".as_slice()]);
            assert!(page_values(&bytes[..bytes.len() - 1], None).is_none());
            let mut oversized = bytes.clone();
            put(&mut oversized, 8192 + 4096 - 32, 0xffffffff, 4);
            assert!(page_values(&oversized, None).is_none());
        }
        let mut cycle = database(false);
        put(&mut cycle, 8192 + 18, 1, 2);
        put(&mut cycle, 8192 + 4096 - 32, 2, 4);
        assert!(page_values(&cycle, None).is_none());
        let mut pointer = database(false);
        put(&mut pointer, 8192 + 24, 4095, 2);
        assert!(page_values(&pointer, None).is_none());
        let mut version = database(false);
        put(&mut version, 28, 1, 4);
        assert!(page_values(&version, None).is_none());
    }
    #[test]
    #[ignore = "Read installed Soda lyrics without changing playback or player files"]
    fn installed_cache_resolves_word_timed_lyrics_without_modifying_player_files() {
        let paths = roots();
        assert!(!paths.is_empty());
        let mut checked = 0;
        for path in paths {
            let before = fs::read(&path).unwrap();
            let values = entries(&path, None).unwrap();
            for value in &values {
                let Some((track, _)) = media(value) else {
                    continue;
                };
                let info = NowPlaying {
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    duration: track.duration.unwrap_or(0.0),
                    ..Default::default()
                };
                let found = load(&info, None).expect("cache track must resolve");
                assert_eq!(found.status, "ready");
                assert!(found.lines.iter().any(|l| !l.words.is_empty()));
                checked += 1;
            }
            assert_eq!(
                before,
                fs::read(path).unwrap(),
                "player cache must remain unchanged"
            );
        }
        assert!(checked > 0);
        eprintln!("Verified Soda cached tracks: {checked}");
    }
}
