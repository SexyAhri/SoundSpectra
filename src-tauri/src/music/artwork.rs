use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};
const LIMIT: u64 = 128 * 1024 * 1024;
const RETENTION: u64 = 7 * 24 * 3600 * 1000;
#[derive(Serialize, Deserialize)]
struct Image {
    url: String,
    accessed: u64,
    data: String,
}
pub struct Artwork {
    root: PathBuf,
    gate: Mutex<()>,
}
impl Artwork {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            gate: Mutex::new(()),
        }
    }
    pub fn load(
        &self,
        url: &str,
        refresh: bool,
        fetch: impl FnOnce() -> Option<String>,
    ) -> Option<String> {
        if url.len() > 2048 {
            return None;
        }
        let _gate = self.gate.lock().unwrap();
        let path = self
            .root
            .join(format!("cover-{}.json", super::cache::scope(url)));
        let cached = Self::read(&path)
            .filter(|i| i.url == url && super::now().saturating_sub(i.accessed) <= RETENTION);
        let data = if refresh {
            fetch().or_else(|| cached.map(|i| i.data))
        } else {
            cached.map(|i| i.data).or_else(fetch)
        }?;
        if data.len() > 768 * 1024 || !data.starts_with("data:image/") {
            return None;
        }
        if std::fs::create_dir_all(&self.root).is_ok() {
            let _ = std::fs::write(
                path,
                serde_json::to_vec(&Image {
                    url: url.into(),
                    accessed: super::now(),
                    data: data.clone(),
                })
                .ok()?,
            );
        }
        self.prune();
        Some(data)
    }
    fn read(path: &Path) -> Option<Image> {
        let meta = std::fs::symlink_metadata(path).ok()?;
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 800 * 1024 {
            return None;
        }
        serde_json::from_slice(&std::fs::read(path).ok()?).ok()
    }
    pub fn prune(&self) {
        let mut files = Vec::new();
        for f in std::fs::read_dir(&self.root)
            .into_iter()
            .flatten()
            .flatten()
        {
            let name = f.file_name();
            let Some(key) = name
                .to_str()
                .and_then(|s| s.strip_prefix("cover-"))
                .and_then(|s| s.strip_suffix(".json"))
            else {
                continue;
            };
            if key.len() != 16
                || !key.bytes().all(|b| b.is_ascii_hexdigit())
                || !f.file_type().is_ok_and(|t| t.is_file())
            {
                continue;
            }
            let accessed = Self::read(&f.path()).map_or(0, |i| i.accessed);
            if super::now().saturating_sub(accessed) > RETENTION {
                let _ = std::fs::remove_file(f.path());
                continue;
            }
            files.push((accessed, f.path(), f.metadata().map_or(0, |m| m.len())));
        }
        files.sort_by_key(|f| f.0);
        let mut size: u64 = files.iter().map(|f| f.2).sum();
        for (_, path, len) in files {
            if size <= LIMIT {
                break;
            }
            if std::fs::remove_file(path).is_ok() {
                size = size.saturating_sub(len);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn covers_reuse_refresh_expire_and_preserve_unrelated_files() {
        let root = std::env::temp_dir().join(format!(
            "music-artwork-{}-{}",
            std::process::id(),
            super::super::now()
        ));
        let cache = Artwork::new(root.clone());
        let url = "https://y.gtimg.cn/fixture.jpg";
        let a = "data:image/jpeg;base64,AAAA";
        assert_eq!(
            cache.load(url, false, || Some(a.into())).as_deref(),
            Some(a)
        );
        assert_eq!(
            cache.load(url, false, || panic!("cache miss")).as_deref(),
            Some(a)
        );
        assert!(cache
            .load(url, true, || Some("data:image/jpeg;base64,BBBB".into()))
            .unwrap()
            .ends_with("BBBB"));
        std::fs::write(root.join("unrelated.txt"), "keep").unwrap();
        let path = root.join(format!("cover-{}.json", super::super::cache::scope(url)));
        let mut saved = Artwork::read(&path).unwrap();
        saved.accessed = 0;
        std::fs::write(&path, serde_json::to_vec(&saved).unwrap()).unwrap();
        cache.prune();
        assert!(!path.exists());
        assert!(root.join("unrelated.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
