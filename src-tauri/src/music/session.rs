//! Platform routing keeps existing QQ credentials and browser storage separate.
use super::{cache::Cache, kugou, model::Provider, netease, qq, vault};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

pub const PROVIDERS: [(&str, &str); 3] = [
    ("qq", "QQ 音乐"),
    ("netease", "网易云音乐"),
    ("kugou", "酷狗音乐"),
];

pub enum Session {
    Qq(qq::Session),
    Netease(netease::Session),
    Kugou(kugou::Session),
}
impl Session {
    pub fn validate(&mut self) -> Result<(), String> {
        if let Self::Kugou(session) = self {
            session.validate()?;
        }
        Ok(())
    }
    pub fn id(&self) -> &'static str {
        match self {
            Self::Qq(_) => "qq",
            Self::Netease(_) => "netease",
            Self::Kugou(_) => "kugou",
        }
    }
    pub fn provider(&self, cache: Arc<Cache>) -> Result<Arc<dyn Provider>, String> {
        Ok(match self {
            Self::Qq(session) => Arc::new(qq::Qq::new(session)?.with_cache(cache)),
            Self::Netease(session) => Arc::new(netease::Netease::new(session)?.with_cache(cache)),
            Self::Kugou(session) => Arc::new(kugou::Kugou::new(session)?.with_cache(cache)),
        })
    }
    pub fn save(&self, directory: &Path) -> Result<(), String> {
        let bytes = match self {
            Self::Qq(s) => serde_json::to_vec(s),
            Self::Netease(s) => serde_json::to_vec(s),
            Self::Kugou(s) => serde_json::to_vec(s),
        }
        .map_err(|_| "无法保存登录会话")?;
        vault::write(&vault_path(directory, self.id())?, &bytes)?;
        // Only a fixed platform ID is stored here, never an account identifier.
        std::fs::create_dir_all(directory).map_err(|_| "无法创建登录目录")?;
        let temporary = directory.join("active-provider.tmp");
        std::fs::write(&temporary, self.id()).map_err(|_| "无法保存平台选择")?;
        std::fs::rename(temporary, directory.join("active-provider"))
            .map_err(|_| "无法保存平台选择".into())
    }
    pub fn restore(directory: &Path) -> Option<Self> {
        let id = active(directory)?;
        let bytes = vault::read(&vault_path(directory, &id).ok()?)?;
        match id.as_str() {
            "qq" => serde_json::from_slice(&bytes).ok().map(Self::Qq),
            "netease" => serde_json::from_slice(&bytes).ok().map(Self::Netease),
            "kugou" => serde_json::from_slice(&bytes).ok().map(Self::Kugou),
            _ => None,
        }
    }
}
pub fn name(id: &str) -> &'static str {
    PROVIDERS
        .iter()
        .find(|(key, _)| *key == id)
        .map_or("音乐平台", |(_, name)| name)
}
pub fn vault_path(directory: &Path, id: &str) -> Result<PathBuf, String> {
    match id {
        "qq" => Ok(directory.join("qq-session.dpapi")),
        "netease" => Ok(directory.join("netease-session.dpapi")),
        "kugou" => Ok(directory.join("kugou-session.dpapi")),
        _ => Err("此音乐平台尚未接入登录".into()),
    }
}
pub fn active(directory: &Path) -> Option<String> {
    match std::fs::read_to_string(directory.join("active-provider")) {
        Ok(id) if PROVIDERS.iter().any(|(key, _)| *key == id) => Some(id),
        // Preserve upgrades from the original single-platform vault.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Some("qq".into()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn storage_routing_cannot_overwrite_another_platform_or_escape_directory() {
        let directory = std::path::Path::new("music");
        assert_ne!(
            super::vault_path(directory, "qq").unwrap(),
            super::vault_path(directory, "netease").unwrap()
        );
        assert_ne!(
            super::vault_path(directory, "kugou").unwrap(),
            super::vault_path(directory, "qq").unwrap()
        );
        for id in ["../qq", "netease/../qq", "", "unknown"] {
            assert!(super::vault_path(directory, id).is_err());
        }
    }
}
