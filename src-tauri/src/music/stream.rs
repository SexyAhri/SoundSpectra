//! Native progressive audio. Only an unguessable loopback capability reaches
//! the hidden player; remote URLs and credentials stay in the provider.
use super::playback::byte_range;
use serde::Serialize;
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};

type RangeReader = Box<dyn Fn(usize, usize) -> Result<Vec<u8>, String> + Send + Sync>;
type Commit = Box<dyn FnOnce(Arc<Vec<u8>>) + Send>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transfer {
    pub received: usize,
    pub total: usize,
    pub status: &'static str,
}

struct Buffer {
    bytes: Arc<Vec<u8>>,
    complete: bool,
    failed: bool,
    checksum: u64,
}

pub struct Stream {
    buffer: Mutex<Buffer>,
    changed: Condvar,
    cancelled: Arc<AtomicBool>,
    total: usize,
    mime: &'static str,
    url: String,
    path: String,
    host: String,
    range: RangeReader,
    clients: AtomicUsize,
}

impl Stream {
    pub fn start(
        initial: Vec<u8>,
        total: usize,
        mime: &'static str,
        reader: impl Read + Send + 'static,
        range: RangeReader,
        commit: Commit,
        cancelled: Arc<AtomicBool>,
    ) -> Result<Arc<Self>, String> {
        if total == 0 || initial.len() > total {
            return Err("音频长度无效".into());
        }
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "无法启动本地音频传输")?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "无法启动本地音频传输")?;
        let host = listener
            .local_addr()
            .map_err(|_| "本地音频地址不可用")?
            .to_string();
        let mut secret = [0_u8; 32];
        getrandom::getrandom(&mut secret).map_err(|_| "无法创建本地音频凭证")?;
        let token: String = secret.iter().map(|b| format!("{b:02x}")).collect();
        let path = format!("/audio/{token}");
        let stream = Arc::new(Self {
            buffer: Mutex::new(Buffer {
                checksum: super::cache::hash(&initial),
                bytes: Arc::new(initial),
                complete: false,
                failed: false,
            }),
            changed: Condvar::new(),
            cancelled,
            total,
            mime,
            url: format!("http://{host}{path}"),
            path,
            host,
            range,
            clients: AtomicUsize::new(0),
        });
        let weak = Arc::downgrade(&stream);
        std::thread::spawn(move || loop {
            let Some(stream) = weak.upgrade() else { break };
            if stream.cancelled.load(Ordering::Acquire) {
                break;
            }
            match listener.accept() {
                Ok((socket, _)) => {
                    if stream.clients.fetch_add(1, Ordering::AcqRel) >= 8 {
                        stream.clients.fetch_sub(1, Ordering::AcqRel);
                        continue;
                    }
                    std::thread::spawn(move || {
                        let _ = stream.serve(socket);
                        stream.clients.fetch_sub(1, Ordering::AcqRel);
                    });
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    drop(stream);
                    std::thread::sleep(Duration::from_millis(25));
                }
                Err(_) => break,
            }
        });
        let download = stream.clone();
        std::thread::spawn(move || download.download(reader, commit));
        Ok(stream)
    }

    pub fn url(&self) -> String {
        self.url.clone()
    }
    pub fn fingerprint(&self) -> Option<(u64, u64)> {
        let b = self.buffer.lock().unwrap();
        b.complete.then_some((b.bytes.len() as u64, b.checksum))
    }
    pub fn progress(&self) -> Transfer {
        let b = self.buffer.lock().unwrap();
        Transfer {
            received: b.bytes.len(),
            total: self.total,
            status: if b.failed {
                "failed"
            } else if b.complete {
                "complete"
            } else {
                "downloading"
            },
        }
    }

    fn download(&self, mut reader: impl Read, commit: Commit) {
        let mut chunk = [0_u8; 64 * 1024];
        let mut valid = true;
        loop {
            if self.cancelled.load(Ordering::Acquire) {
                return;
            }
            let remaining = self.total - self.buffer.lock().unwrap().bytes.len();
            // Read one extra byte at the end to detect a lying Content-Length.
            let limit = (remaining + 1).min(chunk.len());
            match reader.read(&mut chunk[..limit]) {
                Ok(0) => break,
                Ok(n) if n <= remaining => {
                    let mut b = self.buffer.lock().unwrap();
                    b.checksum = super::cache::extend_hash(b.checksum, &chunk[..n]);
                    Arc::make_mut(&mut b.bytes).extend_from_slice(&chunk[..n]);
                    drop(b);
                    self.changed.notify_all();
                }
                _ => {
                    valid = false;
                    break;
                }
            }
        }
        let mut b = self.buffer.lock().unwrap();
        if self.cancelled.load(Ordering::Acquire) {
            return;
        }
        b.complete = valid && b.bytes.len() == self.total;
        b.failed = !b.complete;
        let complete = b.complete.then(|| b.bytes.clone());
        drop(b);
        self.changed.notify_all();
        // Background analysis shares the completed buffer without copying or disk writes.
        if let Some(bytes) = complete {
            commit(bytes);
        }
    }

    fn serve(&self, mut socket: TcpStream) -> std::io::Result<()> {
        socket.set_read_timeout(Some(Duration::from_secs(3)))?;
        socket.set_write_timeout(Some(Duration::from_secs(8)))?;
        let mut request = Vec::new();
        let mut chunk = [0_u8; 1024];
        while !request.ends_with(b"\r\n\r\n") {
            let n = socket.read(&mut chunk)?;
            if n == 0 || request.len() + n > 8192 {
                return Ok(());
            }
            request.extend_from_slice(&chunk[..n]);
        }
        let Ok(request) = std::str::from_utf8(&request) else {
            return Ok(());
        };
        let mut lines = request.split("\r\n");
        let first: Vec<_> = lines
            .next()
            .unwrap_or_default()
            .split_whitespace()
            .collect();
        let headers: Vec<_> = lines.filter_map(|l| l.split_once(':')).collect();
        let header = |name: &str| {
            headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.trim())
        };
        let status = if self.cancelled.load(Ordering::Acquire)
            || first.get(1) != Some(&self.path.as_str())
            || header("host") != Some(self.host.as_str())
        {
            404
        } else if !matches!(first.first(), Some(&"GET" | &"HEAD")) {
            405
        } else {
            200
        };
        if status != 200 {
            write!(
                socket,
                "HTTP/1.1 {status} Rejected\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )?;
            return Ok(());
        }
        let Ok((range, partial)) = byte_range(header("range"), self.total) else {
            write!(socket, "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n", self.total)?;
            return Ok(());
        };
        write!(socket, "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nCache-Control: no-store\r\nConnection: close\r\n", if partial { "206 Partial Content" } else { "200 OK" }, self.mime, range.end() - range.start() + 1)?;
        if partial {
            write!(
                socket,
                "Content-Range: bytes {}-{}/{}\r\n",
                range.start(),
                range.end(),
                self.total
            )?;
        }
        write!(socket, "\r\n")?;
        if first[0] == "HEAD" {
            return Ok(());
        }
        let mut offset = *range.start();
        let mut ranged = true;
        while offset <= *range.end() && !self.cancelled.load(Ordering::Acquire) {
            let mut b = self.buffer.lock().unwrap();
            if b.failed {
                return Ok(());
            }
            let end = (*range.end() + 1).min(offset + 256 * 1024);
            let data = if offset < b.bytes.len() {
                let data = b.bytes[offset..end.min(b.bytes.len())].to_vec();
                drop(b);
                data
            } else if ranged && offset > b.bytes.len() + 256 * 1024 {
                // Seek and MP4 tail metadata need not wait for the prefix.
                drop(b);
                match (self.range)(offset, end - 1) {
                    Ok(bytes) if bytes.len() == end - offset => bytes,
                    _ => {
                        ranged = false;
                        continue;
                    }
                }
            } else {
                b = self
                    .changed
                    .wait_timeout(b, Duration::from_millis(250))
                    .unwrap()
                    .0;
                drop(b);
                continue;
            };
            socket.write_all(&data)?;
            offset += data.len();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Cursor, sync::mpsc, time::Instant};

    // The producer is deliberately held open until the client receives data.
    // A regression to whole-file buffering deadlocks this test and times out.
    struct Delayed {
        release: mpsc::Receiver<()>,
        rest: Cursor<Vec<u8>>,
    }
    impl Read for Delayed {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            if self.rest.position() == 0 {
                self.release
                    .recv_timeout(Duration::from_secs(5))
                    .map_err(std::io::Error::other)?;
            }
            self.rest.read(out)
        }
    }

    #[test]
    fn first_bytes_and_seek_arrive_before_download_and_only_complete_files_commit() {
        let (release, wait) = mpsc::channel();
        let committed = Arc::new(AtomicBool::new(false));
        let done = committed.clone();
        let cancel = Arc::new(AtomicBool::new(false));
        let stream = Stream::start(
            vec![7; 1024],
            600_000,
            "audio/mpeg",
            Delayed {
                release: wait,
                rest: Cursor::new(vec![7; 598_976]),
            },
            Box::new(|start, end| Ok(vec![7; end - start + 1])),
            Box::new(move |b| {
                assert_eq!(b.len(), 600_000);
                done.store(true, Ordering::Release);
            }),
            cancel.clone(),
        )
        .unwrap();
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        let mut response = client.get(stream.url()).send().unwrap();
        let mut first = [0; 1024];
        response.read_exact(&mut first).unwrap();
        assert_eq!(first, [7; 1024]);
        assert!(!committed.load(Ordering::Acquire));
        assert_eq!(stream.progress().status, "downloading");
        assert!(stream.fingerprint().is_none());
        let seek = client
            .get(stream.url())
            .header("Range", "bytes=599990-")
            .send()
            .unwrap();
        assert_eq!(seek.status(), 206);
        assert_eq!(seek.bytes().unwrap().len(), 10);
        assert_eq!(
            client.head(stream.url()).send().unwrap().headers()["content-length"],
            "600000"
        );
        assert_eq!(
            client
                .get(stream.url())
                .header("Range", "bytes=600000-")
                .send()
                .unwrap()
                .status(),
            416
        );
        assert_eq!(
            client
                .get(format!("{}wrong", stream.url()))
                .send()
                .unwrap()
                .status(),
            404
        );
        assert_eq!(
            client
                .get(stream.url())
                .header("Host", "untrusted.invalid")
                .send()
                .unwrap()
                .status(),
            404
        );
        release.send(()).unwrap();
        let start = Instant::now();
        while !committed.load(Ordering::Acquire) && start.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(committed.load(Ordering::Acquire));
        assert_eq!(stream.progress().status, "complete");
        assert_eq!(
            stream.fingerprint(),
            Some((600_000, super::super::cache::hash(&vec![7; 600_000])))
        );
        cancel.store(true, Ordering::Release);
    }

    #[test]
    fn truncated_and_cancelled_downloads_never_commit() {
        for cancelled in [false, true] {
            let cancel = Arc::new(AtomicBool::new(cancelled));
            let (commit, committed) = mpsc::channel();
            let stream = Stream::start(
                vec![1],
                100,
                "audio/mpeg",
                Cursor::new(vec![2; 5]),
                Box::new(|_, _| Err("unavailable".into())),
                Box::new(move |_| {
                    let _ = commit.send(());
                }),
                cancel.clone(),
            )
            .unwrap();
            if !cancelled {
                let start = Instant::now();
                while stream.progress().status != "failed"
                    && start.elapsed() < Duration::from_secs(3)
                {
                    std::thread::sleep(Duration::from_millis(10));
                }
                assert_eq!(stream.progress().status, "failed");
            }
            assert_eq!(
                committed.recv_timeout(Duration::from_secs(3)),
                Err(mpsc::RecvTimeoutError::Disconnected)
            );
            cancel.store(true, Ordering::Release);
        }
    }

    #[test]
    fn cancelling_during_a_read_does_not_commit_even_when_final_chunk_arrives() {
        struct CancelOnRead(Arc<AtomicBool>, Cursor<Vec<u8>>);
        impl Read for CancelOnRead {
            fn read(&mut self, bytes: &mut [u8]) -> std::io::Result<usize> {
                self.0.store(true, Ordering::Release);
                self.1.read(bytes)
            }
        }
        let cancel = Arc::new(AtomicBool::new(false));
        let (commit, committed) = mpsc::channel();
        let _stream = Stream::start(
            vec![1],
            100,
            "audio/mpeg",
            CancelOnRead(cancel.clone(), Cursor::new(vec![2; 99])),
            Box::new(|_, _| Err("unused".into())),
            Box::new(move |_| {
                let _ = commit.send(());
            }),
            cancel,
        )
        .unwrap();
        assert_eq!(
            committed.recv_timeout(Duration::from_secs(3)),
            Err(mpsc::RecvTimeoutError::Disconnected)
        );
    }
    #[test]
    fn slow_audio_client_cannot_hold_the_playback_progress_lock() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let size = 16 * 1024 * 1024;
        let stream = Stream::start(
            vec![1; size],
            size,
            "audio/mpeg",
            Cursor::new(Vec::<u8>::new()),
            Box::new(|_, _| Err("unused range".into())),
            Box::new(|_| {}),
            cancelled.clone(),
        )
        .unwrap();
        let mut socket = TcpStream::connect(&stream.host).unwrap();
        write!(
            socket,
            "GET {} HTTP/1.1\r\nHost: {}\r\n\r\n",
            stream.path, stream.host
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(150));
        let (tx, rx) = mpsc::channel();
        let reader = stream.clone();
        std::thread::spawn(move || {
            let _ = tx.send(reader.progress());
        });
        let result = rx.recv_timeout(Duration::from_millis(500));
        cancelled.store(true, Ordering::Release);
        let _ = socket.shutdown(std::net::Shutdown::Both);
        drop(socket);
        assert!(
            result.is_ok(),
            "A paused network reader blocked UI progress snapshots"
        );
    }
}
