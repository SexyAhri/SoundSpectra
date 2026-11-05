use super::{folded, parse, Line};
use crate::now_playing::NowPlaying;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{Client, Response};
use serde_json::{json, Value};
use std::time::Duration;

struct Song {
    id: String,
    mid: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
}
fn score(song: &Song, info: &NowPlaying) -> Option<i32> {
    if folded(&song.title) != folded(&info.title)
        || folded(&song.artist) != folded(&info.artist)
        || info.artist.is_empty()
    {
        return None;
    }
    if info.duration > 0.0 && song.duration > 0.0 && (song.duration - info.duration).abs() > 4.0 {
        return None;
    }
    Some(
        100 + if !info.album.is_empty() && folded(&song.album) == folded(&info.album) {
            10
        } else {
            0
        },
    )
}
fn choose(songs: Vec<Song>, info: &NowPlaying) -> Option<Song> {
    let mut candidates: Vec<_> = songs
        .into_iter()
        .filter_map(|s| score(&s, info).map(|score| (score, s)))
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    if candidates.len() > 1 && candidates[0].0 == candidates[1].0 {
        return None;
    }
    candidates.into_iter().next().map(|(_, song)| song)
}
async fn json_response(response: Response) -> Result<Value, String> {
    let mut response = response
        .error_for_status()
        .map_err(|_| "歌词服务暂时不可用")?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "歌词响应读取失败")? {
        if bytes.len() + chunk.len() > 2_097_152 {
            return Err("歌词响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "歌词服务返回格式异常".into())
}
fn artists(value: &Value) -> String {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.get("name")?.as_str())
                .collect::<Vec<_>>()
                .join("/")
        })
        .unwrap_or_default()
}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}
fn endpoint(base: &str, pairs: &[(&str, &str)]) -> reqwest::Url {
    let mut url = reqwest::Url::parse(base).expect("constant provider URL");
    url.query_pairs_mut().extend_pairs(pairs.iter().copied());
    url
}

async fn netease(client: &Client, info: &NowPlaying) -> Result<Option<Vec<Line>>, String> {
    let query = format!("{} {}", info.title, info.artist);
    let search = json_response(
        client
            .get(endpoint(
                "https://music.163.com/api/search/get",
                &[("s", query.as_str()), ("type", "1"), ("limit", "20")],
            ))
            .header("Referer", "https://music.163.com/")
            .send()
            .await
            .map_err(|error| format!("联网查找歌词失败：{}", error.without_url()))?,
    )
    .await?;
    let songs = search
        .pointer("/result/songs")
        .and_then(Value::as_array)
        .map(|songs| {
            songs
                .iter()
                .map(|s| Song {
                    id: s["id"].to_string(),
                    mid: String::new(),
                    title: text(s, "name").into(),
                    artist: artists(&s["artists"]),
                    album: text(&s["album"], "name").into(),
                    duration: s["duration"].as_f64().unwrap_or(0.0) / 1000.0,
                })
                .collect()
        })
        .unwrap_or_default();
    let Some(song) = choose(songs, info) else {
        return Ok(None);
    };
    let response = json_response(
        client
            .get(endpoint(
                "https://music.163.com/api/song/lyric",
                &[
                    ("id", song.id.as_str()),
                    ("lv", "-1"),
                    ("kv", "-1"),
                    ("tv", "-1"),
                ],
            ))
            .header("Referer", "https://music.163.com/")
            .send()
            .await
            .map_err(|_| "联网读取歌词失败")?,
    )
    .await?;
    let Some(lyric) = response.pointer("/lrc/lyric").and_then(Value::as_str) else {
        return Ok(None);
    };
    Ok(parse(lyric).ok())
}

async fn qq(client: &Client, info: &NowPlaying) -> Result<Option<Vec<Line>>, String> {
    let search=json_response(client.post("https://u.y.qq.com/cgi-bin/musicu.fcg").header("Referer","https://y.qq.com/").json(&json!({
        "comm":{"ct":24,"cv":0},"req":{"module":"music.search.SearchCgiService","method":"DoSearchForQQMusicDesktop",
        "param":{"query":format!("{} {}",info.title,info.artist),"num_per_page":20,"page_num":1,"search_type":0}}
    })).send().await.map_err(|error|format!("QQ 歌词服务连接失败：{}",error.without_url()))?).await?;
    let songs = search
        .pointer("/req/data/body/song/list")
        .and_then(Value::as_array)
        .map(|songs| {
            songs
                .iter()
                .map(|s| Song {
                    id: s["id"].to_string(),
                    mid: text(s, "mid").into(),
                    title: text(s, "title").into(),
                    artist: artists(&s["singer"]),
                    album: text(&s["album"], "name").into(),
                    duration: s["interval"].as_f64().unwrap_or(0.0),
                })
                .collect()
        })
        .unwrap_or_default();
    let Some(song) = choose(songs, info) else {
        return Ok(None);
    };
    let response=json_response(client.post("https://u.y.qq.com/cgi-bin/musicu.fcg").header("Referer","https://y.qq.com/").json(&json!({
        "comm":{"ct":24,"cv":0},"lyric":{"module":"music.musichallSong.PlayLyricInfo","method":"GetPlayLyricInfo",
        "param":{"songMID":song.mid,"songID":song.id.parse::<u64>().unwrap_or(0)}}
    })).send().await.map_err(|_|"QQ 歌词读取失败")?).await?;
    for field in ["qrc", "lyric"] {
        if let Some(value) = response
            .pointer(&format!("/lyric/data/{field}"))
            .and_then(Value::as_str)
        {
            let decoded = STANDARD
                .decode(value)
                .ok()
                .and_then(|v| String::from_utf8(v).ok())
                .unwrap_or_else(|| value.into());
            if let Ok(lines) = parse(&decoded) {
                return Ok(Some(lines));
            }
            if let Some(decoded) =
                lyrics_crypto::decrypter::qrc::decrypter::decrypt_lyrics(&decoded)
            {
                if let Ok(lines) = parse(&decoded) {
                    return Ok(Some(lines));
                }
            }
        }
    }
    Ok(None)
}

pub async fn fetch(info: &NowPlaying) -> Result<Option<(String, Vec<Line>)>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::limited(2))
        .user_agent("Mozilla/5.0 SoundSpectra/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let mut failure = None;
    // Cross-catalog fallback works for all captured players; exact artist/title
    // and recording duration are required before borrowing another catalog's lyric.
    match netease(&client, info).await {
        Ok(Some(lines)) => return Ok(Some(("网易云音乐".into(), lines))),
        Err(e) => failure = Some(e),
        _ => {}
    }
    match qq(&client, info).await {
        Ok(Some(lines)) => return Ok(Some(("QQ 音乐".into(), lines))),
        Err(e) => failure = Some(e),
        _ => {}
    }
    if let Some(error) = failure {
        Err(error)
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn song(title: &str, artist: &str, duration: f64) -> Song {
        Song {
            id: "1".into(),
            mid: String::new(),
            title: title.into(),
            artist: artist.into(),
            duration,
            album: String::new(),
        }
    }
    #[test]
    fn never_borrows_a_cover_or_different_recording() {
        let info = NowPlaying {
            title: "测试歌曲".into(),
            artist: "测试歌手".into(),
            duration: 200.0,
            ..Default::default()
        };
        assert!(choose(vec![song("测试歌曲", "另一个歌手", 200.0)], &info).is_none());
        assert!(choose(vec![song("测试歌曲 (Live)", "测试歌手", 200.0)], &info).is_none());
        assert!(choose(vec![song("测试歌曲", "测试歌手", 220.0)], &info).is_none());
        assert!(choose(vec![song("测试歌曲", "测试歌手", 200.0)], &info).is_some());
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
    #[ignore = "External provider availability; no user data"]
    fn public_lyric_service() {
        let info = NowPlaying {
            title: "起风了".into(),
            artist: "冯沁苑(买辣椒也用券)".into(),
            album: "起风了".into(),
            duration: 325.868,
            ..Default::default()
        };
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let found = runtime
            .block_on(fetch(&info))
            .unwrap()
            .expect("Known public track should resolve");
        assert!(found.1.len() > 5);
    }
}
