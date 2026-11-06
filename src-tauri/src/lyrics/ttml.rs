use super::{Line, Word};
use roxmltree::{Document, Node, ParsingOptions};

const TTML: &str = "http://www.w3.org/ns/ttml";
const METADATA: &str = "http://www.w3.org/ns/ttml#metadata";
const MAX_TIME: u64 = 86_400_000;

fn document(text: &str) -> Result<Document<'_>, String> {
    if text.len() > 2_097_152 {
        return Err("TTML 歌词正文过大".into());
    }
    let doc = Document::parse_with_options(
        text,
        ParsingOptions {
            allow_dtd: false,
            nodes_limit: 100_000,
        },
    )
    .map_err(|_| "TTML 歌词格式无效")?;
    if !doc.root_element().has_tag_name((TTML, "tt")) {
        return Err("TTML 歌词根节点无效".into());
    }
    Ok(doc)
}

pub fn is_ttml(text: &str) -> bool {
    text.trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with('<')
        && text.contains(TTML)
}

fn time(value: &str) -> Option<u64> {
    let value = value.trim();
    let milliseconds = if let Some(ms) = value.strip_suffix("ms") {
        ms.parse::<f64>().ok()?
    } else {
        let fields: Vec<_> = value
            .strip_suffix('s')
            .unwrap_or(value)
            .split(':')
            .collect();
        if fields.is_empty() || fields.len() > 3 {
            return None;
        }
        let mut seconds = 0.0;
        for (index, field) in fields.iter().enumerate() {
            let n: f64 = field.parse().ok()?;
            if !n.is_finite() || n < 0.0 || index > 0 && n >= 60.0 {
                return None;
            }
            seconds = seconds * 60.0 + n;
        }
        seconds * 1000.0
    };
    (milliseconds.is_finite() && milliseconds >= 0.0 && milliseconds <= MAX_TIME as f64)
        .then(|| milliseconds.round() as u64)
}

fn annotation(node: Node<'_, '_>) -> bool {
    node.ancestors().any(|n| {
        matches!(
            n.attribute((METADATA, "role")),
            Some("x-translation" | "x-roman" | "x-bg")
        )
    })
}

/// AMLL supplies absolute millisecond timestamps. Only the lead vocal is mapped
/// to our single-line renderer; translation, romanization and backing vocals
/// must not be concatenated into the main lyric or consume its word timings.
pub fn parse(text: &str) -> Result<Vec<Line>, String> {
    let doc = document(text)?;
    let mut lines = Vec::new();
    for p in doc
        .descendants()
        .filter(|n| n.has_tag_name((TTML, "p")))
        .take(5000)
    {
        let (Some(start), Some(end)) = (
            p.attribute("begin").and_then(time),
            p.attribute("end").and_then(time),
        ) else {
            continue;
        };
        if end <= start || annotation(p) {
            continue;
        }
        let mut content = String::new();
        let mut words: Vec<Word> = Vec::new();
        let mut last_span = None;
        let mut pending = String::new();
        let mut untimed = false;
        for node in p.descendants().filter(|n| n.is_text() && !annotation(*n)) {
            let text = node.text().unwrap_or("").replace(['\r', '\n', '\t'], " ");
            content.push_str(&text);
            let span = node
                .ancestors()
                .take_while(|n| *n != p)
                .find(|n| n.has_tag_name((TTML, "span")) && n.attribute("begin").is_some());
            if let Some(span) = span {
                let timing = span
                    .attribute("begin")
                    .and_then(time)
                    .zip(span.attribute("end").and_then(time));
                if let Some((a, b)) = timing.filter(|(a, b)| *a >= start && b > a && *b <= end) {
                    if last_span == Some(span.id()) {
                        words.last_mut().unwrap().text.push_str(&text);
                    } else {
                        words.push(Word {
                            text: format!("{pending}{text}"),
                            start: a,
                            end: b,
                        });
                        pending.clear();
                    }
                    last_span = Some(span.id());
                    continue;
                }
            }
            if !text.trim().is_empty() {
                untimed = true;
            }
            if let Some(last) = words.last_mut() {
                last.text.push_str(&text);
            } else {
                pending.push_str(&text);
            }
            last_span = None;
        }
        let text = content.trim().to_string();
        if text.is_empty() {
            continue;
        }
        if untimed || words.windows(2).any(|w| w[1].start < w[0].end) {
            words.clear();
        } else {
            if let Some(first) = words.first_mut() {
                first.text = first.text.trim_start().into();
            }
            if let Some(last) = words.last_mut() {
                last.text = last.text.trim_end().into();
            }
        }
        lines.push(Line {
            text,
            start,
            end,
            words,
        });
    }
    lines.sort_by_key(|line| line.start);
    if lines.is_empty() {
        return Err("TTML 中没有可同步的歌词".into());
    }
    Ok(lines)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn wrap(body: &str) -> String {
        format!(
            r#"<tt xmlns="{TTML}" xmlns:ttm="{METADATA}"><body dur="00:10.000"><div>{body}</div></body></tt>"#
        )
    }
    #[test]
    fn preserves_word_timing_spaces_entities_and_excludes_annotations() {
        let xml = wrap(
            r#"<p begin="1.2" end="3.500"><span begin="1.200" end="2">A &amp; B</span> <span begin="2s" end="3500ms">glow</span><span ttm:role="x-translation">翻译</span><span ttm:role="x-roman">注音</span><span ttm:role="x-bg"><span begin="2" end="3">和声</span></span></p>"#,
        );
        let lines = parse(&xml).unwrap();
        assert_eq!(lines[0].text, "A & B glow");
        assert_eq!(lines[0].start, 1200);
        assert_eq!(lines[0].words.len(), 2);
        assert_eq!(lines[0].words[0].text, "A & B ");
        assert_eq!(lines[0].words[1].end, 3500);
    }
    #[test]
    fn line_timing_and_nested_highlights_do_not_duplicate_text() {
        let xml = wrap(
            r#"<p begin="0" end="1">微光</p><p begin="1" end="2"><span begin="1" end="2">星<span>海</span></span></p>"#,
        );
        let lines = parse(&xml).unwrap();
        assert!(lines[0].words.is_empty());
        assert_eq!(lines[1].text, "星海");
        assert_eq!(lines[1].words.len(), 1);
        assert_eq!(lines[1].words[0].text, "星海");
    }
    #[test]
    fn rejects_unsafe_or_invalid_documents_and_times() {
        for invalid in ["NaN", "-1", "1:99", "24:01:00", "inf", "-1ms"] {
            assert!(time(invalid).is_none());
        }
        assert_eq!(time("1:02:03.456"), Some(3_723_456));
        assert!(parse(&wrap(r#"<p begin="NaN" end="2">无效</p>"#)).is_err());
        assert!(parse(&wrap(r#"<p begin="2" end="1">倒序</p>"#)).is_err());
        assert!(
            parse("<!DOCTYPE tt [<!ENTITY x 'x'>]><tt xmlns='http://www.w3.org/ns/ttml'/>")
                .is_err()
        );
        assert!(parse("<tt><p begin='0' end='1'>错误命名空间</p></tt>").is_err());
    }
}
