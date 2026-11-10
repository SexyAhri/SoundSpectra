use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub provider: String,
    pub nickname: String,
    pub avatar: Option<String>,
    pub membership: Option<Membership>,
    pub membership_issue: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Membership {
    pub active: bool,
    pub name: String,
    pub level: u64,
    pub expires: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub cover: Option<String>,
    pub count: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: String,
    pub provider: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover: Option<String>,
    pub duration: f64,
    pub paid: bool,
    #[serde(skip)]
    pub numeric_id: u64,
    #[serde(skip)]
    pub media_id: String,
    #[serde(skip)]
    pub audio_sizes: std::collections::HashMap<String, u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T: Serialize> {
    pub items: Vec<T>,
    pub total: usize,
    pub next_offset: Option<usize>,
    pub filtered: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioQuality {
    pub id: String,
    pub label: String,
    pub codec: String,
    pub sample_rate: Option<u32>,
    pub bit_depth: Option<u8>,
    pub channels: Option<u8>,
    pub bitrate: Option<u32>,
    pub fallback: Option<String>,
}

pub struct Audio {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub quality: AudioQuality,
    pub stream: Option<std::sync::Arc<super::stream::Stream>>,
}

pub struct AudioRequest {
    pub prefetch: bool,
    pub cancelled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub buffering: Box<dyn Fn() + Send + Sync>,
}
impl AudioRequest {
    pub fn check(&self) -> Result<(), String> {
        if self.cancelled.load(std::sync::atomic::Ordering::Acquire) {
            Err("播放请求已取消".into())
        } else {
            Ok(())
        }
    }
}

/// A platform owns authentication and remote data; the queue, renderer and UI
/// consume only these shared contracts. No platform cookies cross IPC.
pub trait Provider: Send + Sync {
    fn id(&self) -> &'static str;
    fn scope(&self) -> String;
    fn name(&self) -> &'static str;
    fn supports(&self, capability: &str) -> bool {
        self.capabilities().contains(&capability)
    }
    fn search(&self, _query: &str, _offset: usize, _limit: usize) -> Result<Page<Track>, String> {
        Err("该平台未提供搜索能力".into())
    }
    fn capabilities(&self) -> &'static [&'static str] {
        &["account", "playlists", "playback", "lyrics"]
    }
    fn account(&self) -> Result<Account, String>;
    fn playlists(
        &self,
        collection: &str,
        offset: usize,
        limit: usize,
    ) -> Result<Page<Playlist>, String>;
    fn tracks(&self, playlist: &str, offset: usize, limit: usize) -> Result<Page<Track>, String>;
    fn audio(
        &self,
        track: &Track,
        below: Option<&str>,
        request: AudioRequest,
    ) -> Result<Audio, String>;
    fn lyrics(&self, track: &Track) -> Result<String, String>;
    fn artwork(&self, _url: &str) -> Option<String> {
        None
    }
    fn discard_prefetch(&self) {}
    /// A provider that rotates credentials may return a native-only update.
    /// Callers persist it only while holding the account replacement gate.
    fn refreshed_session(&self) -> Result<Option<Vec<u8>>, String> {
        Ok(None)
    }
}
