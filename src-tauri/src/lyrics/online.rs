use super::{folded, ttml, Line};
use crate::now_playing::NowPlaying;
use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use std::{path::Path, time::Duration};

const API: &str = "https://api.amll.dev";

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Song {
    pub id: u64,
    pub filename: String,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub music_names: Vec<String>,
    #[serde(default)]
    pub artist_names: Vec<String>,
    #[serde(default)]
    pub album_names: Vec<String>,
    #[serde(default)]
    pub ncm_music_ids: Vec<String>,
    #[serde(default)]
    pub qq_music_ids: Vec<String>,
    #[serde(default)]
    pub apple_music_ids: Vec<String>,
    #[serde(default)]
    pub spotify_ids: Vec<String>,
    #[serde(default)]
    pub isrcs: Vec<String>,
    #[serde(default)]
    pub author_usernames: Vec<String>,
    #[serde(default)]
    pub lyrics: Option<String>,
}

fn artist_parts(value: &str) -> Vec<String> {
    value
        .split(['/', '、', ',', '，', ';', '；', '&', '＆'])
        .map(folded)
        .filter(|v| !v.is_empty())
        .collect()
}
fn score(song: &Song, info: &NowPlaying) -> Option<u16> {
    if folded(&info.title).is_empty()
        || folded(&info.artist).is_empty()
        || !song
            .music_names
            .iter()
            .any(|n| folded(n) == folded(&info.title))
    {
        return None;
    }
    let mut expected = artist_parts(&info.artist);
    let mut actual: Vec<_> = song
        .artist_names
        .iter()
        .flat_map(|n| artist_parts(n))
        .collect();
    expected.sort();
    expected.dedup();
    actual.sort();
    actual.dedup();
    if expected != actual {
        return None;
    }
    let album = !info.album.is_empty()
        && song
            .album_names
            .iter()
            .any(|n| folded(n) == folded(&info.album));
    Some(if album { 110 } else { 100 })
}
fn same_recording(a: &Song, b: &Song) -> bool {
    a.id == b.id
        || [
            (&a.ncm_music_ids, &b.ncm_music_ids),
            (&a.qq_music_ids, &b.qq_music_ids),
            (&a.apple_music_ids, &b.apple_music_ids),
            (&a.spotify_ids, &b.spotify_ids),
            (&a.isrcs, &b.isrcs),
        ]
        .iter()
        .any(|(left, right)| left.iter().any(|id| !id.is_empty() && right.contains(id)))
}
fn choose(songs: Vec<Song>, info: &NowPlaying) -> Option<Song> {
    let mut candidates: Vec<_> = songs
        .into_iter()
        .filter_map(|s| score(&s, info).map(|score| (score, s)))
        .collect();
    candidates.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then(b.1.created_at.cmp(&a.1.created_at))
            .then(a.1.id.cmp(&b.1.id))
    });
    let (best, first) = candidates.first()?;
    // Different lyric revisions may share a recording. Never resolve equally
    // ranked different recordings just by choosing the first search result.
    if candidates
        .iter()
        .skip(1)
        .take_while(|(s, _)| s == best)
        .any(|(_, s)| !same_recording(first, s))
    {
        return None;
    }
    candidates.into_iter().next().map(|(_, song)| song)
}
pub(super) fn lines(song: &Song, info: &NowPlaying) -> Option<Vec<Line>> {
    score(song, info)?;
    let text = song.lyrics.as_deref()?;
    let lines = ttml::parse(text).ok()?;
    // AMLL's body dur is the final lyric end, not necessarily the audio length.
    // An instrumental outro is valid; only reject lyrics exceeding the track.
    if info.duration > 0.0
        && lines
            .iter()
            .any(|l| l.end as f64 > (info.duration + 4.0) * 1000.0)
    {
        return None;
    }
    Some(lines)
}
async fn json_response(response: Response) -> Result<serde_json::Value, String> {
    if response.status().as_u16() == 429 {
        return Err("AMLL 请求较多，请稍后重试".into());
    }
    let mut response = response
        .error_for_status()
        .map_err(|_| "AMLL 歌词服务暂时不可用")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "AMLL 歌词响应读取失败")?
    {
        if bytes.len() + chunk.len() > 2_097_152 {
            return Err("AMLL 歌词响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "AMLL 返回格式异常")?;
    if value["status"].as_u64() != Some(200) {
        return Err("AMLL 歌词服务返回异常".into());
    }
    Ok(value)
}
fn endpoint(base: &str, path: &str, pairs: &[(&str, &str)]) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(base)
        .and_then(|u| u.join(path))
        .map_err(|_| "歌词服务地址无效")?;
    url.query_pairs_mut().extend_pairs(pairs.iter().copied());
    Ok(url)
}
async fn request(client: &Client, url: reqwest::Url) -> Result<serde_json::Value, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "AMLL 歌词服务连接失败")?;
    json_response(response).await
}
async fn fetch_from(
    client: &Client,
    base: &str,
    info: &NowPlaying,
) -> Result<Option<Song>, String> {
    if folded(&info.title).is_empty() || folded(&info.artist).is_empty() {
        return Ok(None);
    }
    // Structured metadata search avoids matches in the lyric body. One artist
    // filter supports sessions that join several artists with separators.
    let artist = info
        .artist
        .split(['/', '、', ',', '，', ';', '；', '&', '＆'])
        .next()
        .unwrap_or("")
        .trim();
    let mut songs = Vec::new();
    for page_number in 1..=3 {
        let page = page_number.to_string();
        let response = request(
            client,
            endpoint(
                base,
                "/v1/lyrics/search",
                &[
                    ("musicName", &info.title),
                    ("artistName", artist),
                    ("pageSize", "100"),
                    ("page", &page),
                ],
            )?,
        )
        .await?;
        let items: Vec<Song> = serde_json::from_value(response["data"]["items"].clone())
            .map_err(|_| "AMLL 歌曲列表格式异常")?;
        songs.extend(items);
        match response["data"]["pagination"]["hasMore"].as_bool() {
            Some(false) => break,
            Some(true) if page_number < 3 => {}
            Some(true) => return Ok(None), // Do not choose from a truncated set.
            None => return Err("AMLL 分页信息缺失".into()),
        }
    }
    let Some(song) = choose(songs, info) else {
        return Ok(None);
    };
    let response = request(
        client,
        endpoint(base, "/v1/lyrics/get", &[("id", &song.id.to_string())])?,
    )
    .await?;
    let fetched: Song =
        serde_json::from_value(response["data"].clone()).map_err(|_| "AMLL 歌词格式异常")?;
    if fetched.id != song.id || lines(&fetched, info).is_none() {
        return Ok(None);
    }
    Ok(Some(fetched))
}

pub async fn fetch(
    info: &NowPlaying,
    directory: &Path,
) -> Result<Option<(String, Vec<Line>)>, String> {
    let dir = directory.to_owned();
    let track = info.clone();
    let cached = tauri::async_runtime::spawn_blocking(move || super::storage::read(&dir, &track))
        .await
        .ok()
        .flatten();
    if let Some((song, true)) = &cached {
        if let Some(lines) = lines(song, info) {
            return Ok(Some(("AMLL · 本地缓存".into(), lines)));
        }
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(8))
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::limited(2))
        .user_agent(concat!("SoundSpectra/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| "AMLL 歌词服务初始化失败")?;
    let result = tokio::time::timeout(Duration::from_secs(20), fetch_from(&client, API, info))
        .await
        .unwrap_or_else(|_| Err("AMLL 歌词查询超时".into()));
    match result {
        Ok(Some(song)) => {
            let result = lines(&song, info).map(|lines| ("AMLL".into(), lines));
            let dir = directory.to_owned();
            let track = info.clone();
            // A failed cache write never discards otherwise usable lyrics.
            let _ = tauri::async_runtime::spawn_blocking(move || {
                super::storage::write(&dir, &track, song)
            })
            .await;
            Ok(result)
        }
        Err(error) => {
            if let Some((song, _)) = cached {
                if let Some(lines) = lines(&song, info) {
                    return Ok(Some(("AMLL · 离线缓存".into(), lines)));
                }
            }
            Err(error)
        }
        Ok(None) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn track() -> NowPlaying {
        NowPlaying {
            title: "微光".into(),
            artist: "甲 / 乙".into(),
            album: "星海".into(),
            duration: 10.0,
            ..Default::default()
        }
    }
    pub(super) fn song(id: u64) -> Song {
        Song { id, filename: format!("{id}.ttml"), music_names: vec!["微光".into()], artist_names: vec!["乙".into(), "甲".into()], album_names: vec!["星海".into()], ncm_music_ids: vec!["100".into()], lyrics: Some(r#"<tt xmlns="http://www.w3.org/ns/ttml"><body dur="10"><div><p begin="1" end="2">原创测试</p></div></body></tt>"#.into()), ..Default::default() }
    }
    #[test]
    fn matches_artists_as_a_set_and_never_borrows_a_cover_or_live_version() {
        assert!(choose(vec![song(1)], &track()).is_some());
        let mut cover = song(1);
        cover.artist_names = vec!["丙".into()];
        assert!(choose(vec![cover], &track()).is_none());
        let mut live = song(1);
        live.music_names = vec!["微光 (Live)".into()];
        assert!(choose(vec![live], &track()).is_none());
        let mut wrong = track();
        wrong.duration = 1.0;
        let mut longer = song(1);
        longer.lyrics = longer.lyrics.map(|s| s.replace("end=\"2\"", "end=\"9\""));
        assert!(lines(&longer, &wrong).is_none());
        wrong.duration = 20.0; // Instrumental outro must not cause a miss.
        assert!(lines(&song(1), &wrong).is_some());
    }
    #[test]
    fn uses_newest_revision_only_with_shared_recording_ids_and_prefers_album() {
        let first = song(1);
        let mut newest = song(2);
        newest.created_at = 2;
        assert_eq!(
            choose(vec![first.clone(), newest.clone()], &track())
                .unwrap()
                .id,
            2
        );
        newest.ncm_music_ids = vec!["200".into()];
        assert!(choose(vec![first.clone(), newest.clone()], &track()).is_none());
        newest.album_names = vec!["另一个专辑".into()];
        assert_eq!(choose(vec![first, newest], &track()).unwrap().id, 1);
    }
    #[test]
    fn missing_identity_and_untimed_lyrics_are_never_accepted() {
        let mut unknown = track();
        unknown.artist.clear();
        assert!(choose(vec![song(1)], &unknown).is_none());
        let mut invalid = song(1);
        invalid.lyrics = Some("没有时间标签".into());
        assert!(lines(&invalid, &track()).is_none());
    }
    #[test]
    fn amll_http_contract_decodes_ttml() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            thread,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            for step in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                while !bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                    let n = stream.read(&mut buffer).unwrap();
                    assert!(n > 0);
                    bytes.extend_from_slice(&buffer[..n]);
                }
                let request = String::from_utf8(bytes).unwrap();
                let body = if step == 0 {
                    assert!(request.starts_with("GET /v1/lyrics/search?"));
                    assert!(request.contains("musicName=") && request.contains("artistName="));
                    serde_json::json!({"status":200,"data":{"items":[song(1)],"pagination":{"hasMore":false}}})
                } else {
                    assert!(request.starts_with("GET /v1/lyrics/get?id=1 "));
                    serde_json::json!({"status":200,"data":song(1)})
                }.to_string();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let client = Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap();
            let found = fetch_from(&client, &base, &track()).await.unwrap().unwrap();
            assert_eq!(lines(&found, &track()).unwrap()[0].start, 1000);
        });
        server.join().unwrap();
    }
    #[test]
    fn local_winner_closes_an_unfinished_http_body_instead_of_only_ignoring_it() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
            sync::{
                atomic::{AtomicBool, Ordering},
                mpsc, Arc,
            },
            thread,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let started = Arc::new(AtomicBool::new(false));
        let ready = started.clone();
        let (sender, receiver) = mpsc::channel();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 1024];
            while !request.windows(4).any(|v| v == b"\r\n\r\n") {
                let n = stream.read(&mut buffer).unwrap();
                if n == 0 {
                    return;
                }
                request.extend_from_slice(&buffer[..n]);
            }
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n{\"pending\":").unwrap();
            ready.store(true, Ordering::Release);
            let closed = match stream.read(&mut buffer) {
                Ok(0) => true,
                Err(e) => matches!(
                    e.kind(),
                    std::io::ErrorKind::ConnectionReset
                        | std::io::ErrorKind::ConnectionAborted
                        | std::io::ErrorKind::BrokenPipe
                ),
                _ => false,
            };
            let _ = sender.send(closed);
        });
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let client = Client::builder()
                .no_proxy()
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap();
            let remote = async {
                let response = client
                    .get(format!("http://{address}"))
                    .send()
                    .await
                    .unwrap();
                let _ = json_response(response).await;
                None
            };
            let local = async {
                while !started.load(Ordering::Acquire) {
                    tokio::time::sleep(Duration::from_millis(2)).await;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
                Some(super::super::LyricDocument {
                    status: "ready".into(),
                    lines: vec![super::super::Line {
                        text: "测试".into(),
                        start: 0,
                        end: 1000,
                        words: Vec::new(),
                    }],
                    ..Default::default()
                })
            };
            let found = tokio::time::timeout(
                Duration::from_secs(2),
                super::super::lookup::first_valid(local, remote, Arc::default()),
            )
            .await
            .unwrap();
            assert!(found.is_some());
            assert!(tokio::task::spawn_blocking(move || receiver
                .recv_timeout(Duration::from_secs(3))
                .unwrap())
            .await
            .unwrap());
        });
        server.join().unwrap();
    }
    #[test]
    #[ignore = "External AMLL availability; uses public metadata only"]
    fn public_lyric_service() {
        let info = NowPlaying {
            title: "ME!".into(),
            artist: "Taylor Swift / Brendon Urie".into(),
            album: "Lover".into(),
            duration: 185.8,
            ..Default::default()
        };
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let client = Client::builder()
                .timeout(Duration::from_secs(8))
                .build()
                .unwrap();
            let found = fetch_from(&client, API, &info)
                .await
                .unwrap()
                .expect("Public AMLL sample should resolve");
            let lines = lines(&found, &info).unwrap();
            assert!(lines.len() > 5);
            assert!(lines.iter().any(|line| !line.words.is_empty()));
            eprintln!(
                "AMLL live response: {} lines; metadata and word timing validated",
                lines.len()
            );
        });
    }
}
