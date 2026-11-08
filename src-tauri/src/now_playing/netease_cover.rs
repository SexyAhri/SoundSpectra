//! Artwork from the verified native song, without an SMTC thumbnail. Downloads
//! and bounded caching stay off the media clock thread; late results are scoped
//! to the exact player process and playback instance.
use super::{image_mime, NowPlaying};
use crate::audio_source::Target;
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{blocking::Client, redirect::Policy, Url};
use std::{
    collections::VecDeque,
    fs,
    hash::{DefaultHasher, Hash, Hasher},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

const MAX_BYTES: u64 = 512 * 1024;
const MAX_COVERS: usize = 32;

pub(super) fn image_url(value: &str) -> Option<String> {
    if value.len() > 2048 {
        return None;
    }
    let mut url = Url::parse(value).ok()?;
    let host = url.host_str()?;
    // NetEase's public image CDN only, with no credentials, custom port,
    // fragments or client-provided query data. Request a card-sized image.
    if !["http", "https"].contains(&url.scheme())
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !host
            .strip_prefix('p')
            .and_then(|h| h.strip_suffix(".music.126.net"))
            .is_some_and(|n| !n.is_empty() && n.len() <= 2 && n.bytes().all(|b| b.is_ascii_digit()))
        || url.path().len() < 2
    {
        return None;
    }
    url.set_scheme("https").ok()?;
    url.set_query(Some("param=300y300"));
    url.set_fragment(None);
    Some(url.into())
}
fn data_url(bytes: &[u8]) -> Option<String> {
    if bytes.len() as u64 > MAX_BYTES {
        return None;
    }
    Some(format!(
        "data:{};base64,{}",
        image_mime(bytes)?,
        STANDARD.encode(bytes)
    ))
}
fn cache_path(directory: &Path, url: &str) -> PathBuf {
    let mut hash = DefaultHasher::new();
    url.hash(&mut hash);
    directory.join(format!("netease-{:016x}.img", hash.finish()))
}
fn cached(directory: &Path, url: &str) -> Option<String> {
    let path = cache_path(directory, url);
    if fs::metadata(&path).ok()?.len() > MAX_BYTES {
        return None;
    }
    data_url(&fs::read(path).ok()?)
}
fn save(directory: &Path, url: &str, bytes: &[u8]) {
    if fs::create_dir_all(directory).is_err() {
        return;
    }
    let path = cache_path(directory, url);
    if fs::write(path, bytes).is_err() {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut covers = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_owned();
            let hash = name.strip_prefix("netease-")?.strip_suffix(".img")?;
            if hash.len() != 16 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return None;
            }
            Some((entry.metadata().ok()?.modified().ok()?, entry.path()))
        })
        .collect::<Vec<_>>();
    covers.sort_by_key(|(time, _)| *time);
    let excess = covers.len().saturating_sub(MAX_COVERS);
    for (_, path) in covers.into_iter().take(excess) {
        let _ = fs::remove_file(path);
    }
}
fn fetch(client: &Client, url: &str) -> Option<(String, Vec<u8>)> {
    let response = client.get(url).send().ok()?.error_for_status().ok()?;
    if response.content_length().is_some_and(|n| n > MAX_BYTES) {
        return None;
    }
    let mut bytes = Vec::new();
    response.take(MAX_BYTES + 1).read_to_end(&mut bytes).ok()?;
    Some((data_url(&bytes)?, bytes))
}

#[derive(Clone, PartialEq, Eq)]
struct Request {
    pid: u32,
    track: String,
    url: String,
}
#[derive(Clone)]
struct Response {
    request: Request,
    data: String,
}
fn apply(request: &Request, response: &Response, info: &mut NowPlaying) {
    if request == &response.request
        && info.cover.is_none()
        && info.process_id == Some(request.pid)
        && info.track_id == request.track
    {
        info.cover = Some(response.data.clone());
    }
}
pub(super) struct Reader {
    request: Arc<Mutex<Option<Request>>>,
    latest: Arc<Mutex<Option<Response>>>,
    stop: Arc<AtomicBool>,
}
impl Reader {
    pub(super) fn new(directory: PathBuf) -> Self {
        let request = Arc::new(Mutex::new(None::<Request>));
        let latest = Arc::new(Mutex::new(None));
        let stop = Arc::new(AtomicBool::new(false));
        let (pending, result, stopped) = (request.clone(), latest.clone(), stop.clone());
        thread::spawn(move || {
            let client = Client::builder()
                .timeout(Duration::from_secs(5))
                .redirect(Policy::none())
                .build()
                .ok();
            let mut memory = VecDeque::<(String, String)>::new();
            let mut attempted: Option<(Request, Instant)> = None;
            while !stopped.load(Ordering::Relaxed) {
                let current = pending.lock().unwrap().clone();
                if let Some(current) = current {
                    let retry = attempted.as_ref().is_none_or(|(previous, at)| {
                        previous != &current || at.elapsed() > Duration::from_secs(30)
                    });
                    if retry {
                        attempted = Some((current.clone(), Instant::now()));
                        let data = memory
                            .iter()
                            .find(|(url, _)| url == &current.url)
                            .map(|(_, data)| data.clone())
                            .or_else(|| cached(&directory, &current.url))
                            .or_else(|| {
                                let (data, bytes) = fetch(client.as_ref()?, &current.url)?;
                                save(&directory, &current.url, &bytes);
                                Some(data)
                            });
                        if let Some(data) = data {
                            memory.retain(|(url, _)| url != &current.url);
                            memory.push_back((current.url.clone(), data.clone()));
                            while memory.len() > MAX_COVERS {
                                memory.pop_front();
                            }
                            // A switch while downloading must discard this result.
                            if pending.lock().unwrap().as_ref() == Some(&current) {
                                *result.lock().unwrap() = Some(Response {
                                    request: current,
                                    data,
                                });
                            }
                        }
                    }
                } else {
                    attempted = None;
                }
                thread::sleep(Duration::from_millis(100));
            }
        });
        Self {
            request,
            latest,
            stop,
        }
    }
    pub(super) fn clear(&mut self) {
        *self.request.lock().unwrap() = None;
        *self.latest.lock().unwrap() = None;
    }
    pub(super) fn update(&mut self, target: &Target, url: Option<String>, info: &mut NowPlaying) {
        let request = url
            .filter(|_| {
                target.player_id.as_deref() == Some("netease")
                    && info.cover.is_none()
                    && !info.track_id.is_empty()
                    && info.timeline_source == Some("netease-events")
            })
            .map(|url| Request {
                pid: target.pid,
                track: info.track_id.clone(),
                url,
            });
        *self.request.lock().unwrap() = request.clone();
        if let Some(request) = request {
            if let Some(response) = self.latest.lock().unwrap().as_ref() {
                apply(&request, response, info);
            }
        } else {
            *self.latest.lock().unwrap() = None;
        }
    }
}
impl Drop for Reader {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Reads the current native song and downloads its public artwork; no playback controls"]
    fn installed_native_cover_without_smtc_read_only() {
        let pid = std::env::var("SOUNDSPECTRA_TEST_NETEASE_PID")
            .unwrap()
            .parse()
            .unwrap();
        let target = Target {
            pid,
            executable: "cloudmusic.exe".into(),
            name: "网易云音乐".into(),
            player_id: Some("netease".into()),
            audible: true,
        };
        let mut clock = super::super::netease::Clock::default();
        let info = clock
            .control_snapshot(&target)
            .expect("current native playback instance");
        let url = clock.cover_url(&info).expect("verified native artwork URL");
        let client = Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(Policy::none())
            .build()
            .unwrap();
        let (data, bytes) = fetch(&client, &url).expect("public artwork image");
        assert!(data.starts_with("data:image/"));
        assert!(bytes.len() as u64 <= MAX_BYTES);
        eprintln!(
            "Verified current NetEase artwork without SMTC: {} bytes; no player files modified",
            bytes.len()
        );
    }
    #[test]
    fn artwork_uses_only_the_public_cdn_with_a_bounded_image_request() {
        assert_eq!(
            image_url("http://p1.music.126.net/cover.jpg?client=value#fragment").unwrap(),
            "https://p1.music.126.net/cover.jpg?param=300y300"
        );
        for value in [
            "https://p1.music.126.net.evil.test/a",
            "https://p1.music.126.net@evil.test/a",
            "https://user@p1.music.126.net/a",
            "https://p1.music.126.net:8443/a",
            "https://127.0.0.1/a",
            "file:///cover.jpg",
            "https://music.163.com/a",
        ] {
            assert!(image_url(value).is_none(), "{value}");
        }
        assert!(data_url(b"not an image").is_none());
        assert!(data_url(&vec![0; MAX_BYTES as usize + 1]).is_none());
    }
    #[test]
    fn late_artwork_cannot_attach_to_another_song_process_or_existing_smtc_cover() {
        let request = Request {
            pid: 42,
            track: "native:123:token".into(),
            url: "cover-a".into(),
        };
        let response = Response {
            request: request.clone(),
            data: "data:image/png;base64,abc".into(),
        };
        let current = NowPlaying {
            process_id: Some(42),
            track_id: request.track.clone(),
            ..Default::default()
        };
        let mut value = current.clone();
        apply(&request, &response, &mut value);
        assert_eq!(value.cover.as_deref(), Some(response.data.as_str()));
        for mut value in [
            NowPlaying {
                process_id: Some(43),
                ..current.clone()
            },
            NowPlaying {
                track_id: "native:456:token".into(),
                ..current.clone()
            },
        ] {
            apply(&request, &response, &mut value);
            assert!(value.cover.is_none());
        }
        let mut newer = request.clone();
        newer.url = "cover-b".into();
        let mut value = current.clone();
        apply(&newer, &response, &mut value);
        assert!(value.cover.is_none());
        value.cover = Some("smtc-cover".into());
        apply(&request, &response, &mut value);
        assert_eq!(value.cover.as_deref(), Some("smtc-cover"));
    }
}
