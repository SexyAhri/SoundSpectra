use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedLocations {
    version: u8,
    pub initial_scan_complete: bool,
    pub directories: Vec<PathBuf>,
}
impl Default for SavedLocations {
    fn default() -> Self {
        Self {
            version: 1,
            initial_scan_complete: false,
            directories: Vec::new(),
        }
    }
}
pub fn path(settings_path: &Path) -> PathBuf {
    settings_path.with_file_name("lyric-locations.json")
}
fn directory_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

impl SavedLocations {
    pub fn read(path: &Path) -> Result<Self, String> {
        if !path.exists() {
            return Ok(Self::default());
        }
        if fs::metadata(path).map_err(|e| e.to_string())?.len() > 1_048_576 {
            return Err("歌词目录记录过大".into());
        }
        let mut value: Self = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|_| "歌词目录记录读取失败")?;
        if value.version != 1
            || value.directories.len() > 1024
            || value.directories.iter().any(|p| !p.is_absolute())
        {
            return Err("歌词目录记录无效".into());
        }
        let mut seen = HashSet::new();
        value.directories.retain(|p| seen.insert(directory_key(p)));
        Ok(value)
    }
    pub fn remember(&mut self, directories: impl IntoIterator<Item = PathBuf>) -> bool {
        let mut changed = false;
        for directory in directories {
            if self.directories.len() >= 1024 {
                break;
            }
            if !directory.is_absolute() {
                continue;
            }
            if self
                .directories
                .iter()
                .any(|old| directory_key(old) == directory_key(&directory))
            {
                continue;
            }
            self.directories.push(directory);
            changed = true;
        }
        changed
    }
    pub fn valid_directories(&self) -> Vec<PathBuf> {
        self.directories
            .iter()
            .filter(|p| p.is_dir())
            .cloned()
            .collect()
    }
    pub fn has_discovered(&self) -> bool {
        self.initial_scan_complete || !self.directories.is_empty()
    }
    pub fn write(&self, path: &Path) -> Result<(), String> {
        let parent = path.parent().ok_or("歌词目录记录位置无效")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
        let bytes = serde_json::to_vec_pretty(self).map_err(|e| e.to_string())?;
        if bytes.len() > 1_048_576 {
            return Err("歌词目录记录过大".into());
        }
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temporary, path).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directories_survive_restart_even_if_initial_scan_was_interrupted() {
        let root =
            std::env::temp_dir().join(format!("soundspectra-locations-{}", std::process::id()));
        fs::create_dir_all(root.join("cache")).unwrap();
        let file = root.join("lyric-locations.json");
        let mut value = SavedLocations::default();
        assert!(!value.has_discovered());
        assert!(value.remember([root.join("cache")]));
        value.write(&file).unwrap();
        let mut restored = SavedLocations::read(&file).unwrap();
        assert!(restored.has_discovered());
        assert!(!restored.initial_scan_complete);
        assert_eq!(restored.valid_directories(), vec![root.join("cache")]);
        restored.initial_scan_complete = true;
        restored.write(&file).unwrap();
        assert!(SavedLocations::read(&file).unwrap().initial_scan_complete);
        fs::remove_dir_all(root.join("cache")).unwrap();
        let missing = SavedLocations::read(&file).unwrap();
        assert!(missing.has_discovered());
        assert!(missing.valid_directories().is_empty());
        assert_eq!(missing.directories.len(), 1); // Keep unplugged/moved locations; never fall back to global scan.
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn an_empty_completed_scan_is_not_repeated_and_malformed_records_are_preserved() {
        let root = std::env::temp_dir().join(format!(
            "soundspectra-empty-locations-{}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("lyric-locations.json");
        let value = SavedLocations {
            initial_scan_complete: true,
            ..Default::default()
        };
        value.write(&file).unwrap();
        assert!(SavedLocations::read(&file).unwrap().has_discovered());
        fs::write(&file, "broken").unwrap();
        assert!(SavedLocations::read(&file).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "broken");
        fs::remove_dir_all(root).unwrap();
    }
}
