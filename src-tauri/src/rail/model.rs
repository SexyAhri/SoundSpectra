use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(default = "default_crop")]
    pub crop: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub text: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub desktop_managed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub desktop_identity: Option<[u32; 3]>,
}
fn default_crop() -> String {
    "cover".into()
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RailSkin {
    Woodland,
    #[default]
    Floral,
    #[serde(alias = "galaxy")]
    Wisteria,
    #[serde(alias = "vinyl")]
    Autumn,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RailAudioProfile {
    #[default]
    Gentle,
    Bounce,
    String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailAudioConfig {
    pub enabled: bool,
    pub profile: RailAudioProfile,
    pub amount: f64,
}
impl Default for RailAudioConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            profile: RailAudioProfile::Gentle,
            amount: 35.0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailGroup {
    pub id: String,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub collapsed: bool,
    #[serde(default)]
    pub skin: RailSkin,
    #[serde(default)]
    pub audio_sync: RailAudioConfig,
    pub items: Vec<RailItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RailSettings {
    pub version: u8,
    pub enabled: bool,
    pub groups: Vec<RailGroup>,
}
impl Default for RailSettings {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            groups: vec![RailGroup {
                id: "apps".into(),
                name: "我的拾光绳".into(),
                x: 0.01,
                y: 0.18,
                width: 0.98,
                collapsed: false,
                skin: RailSkin::default(),
                audio_sync: RailAudioConfig::default(),
                items: vec![],
            }],
        }
    }
}

impl RailSettings {
    pub fn migrate_default_name(&mut self) -> bool {
        if let Some(group) = self
            .groups
            .iter_mut()
            .find(|g| g.id == "apps" && g.name == "我的晾衣绳")
        {
            group.name = "我的拾光绳".into();
            return true;
        }
        false
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("拾光绳配置版本暂不支持，原文件未被覆盖".into());
        }
        if self.groups.len() > 4 {
            return Err("最多放置四组拾光绳".into());
        }
        let mut ids = HashSet::new();
        for group in &self.groups {
            if !group.audio_sync.amount.is_finite()
                || !(0.0..=100.0).contains(&group.audio_sync.amount)
            {
                return Err("音乐联动幅度需为 0～100".into());
            }
            if !valid_id(&group.id) || !ids.insert(group.id.clone()) {
                return Err("拾光绳编号重复或无效".into());
            }
            if group.name.trim().is_empty() || group.name.chars().count() > 40 {
                return Err("拾光绳名称需为 1～40 个字符".into());
            }
            if !group.x.is_finite()
                || !group.y.is_finite()
                || !group.width.is_finite()
                || !(0.20..=1.0).contains(&group.width)
                || !(0.0..=1.0 - group.width + 0.00001).contains(&group.x)
                || !(0.0..=0.75).contains(&group.y)
            {
                return Err("拾光绳位置超出屏幕范围".into());
            }
            if group.items.len() > 48 {
                return Err("每组最多挂载 48 个项目，常用项目优先展示".into());
            }
            for item in &group.items {
                if !valid_id(&item.id) || !ids.insert(item.id.clone()) {
                    return Err("挂件编号重复或无效".into());
                }
                if item.name.trim().is_empty()
                    || item.name.chars().count() > 120
                    || item.path.len() > 32768
                    || (item.kind != "note" && !Path::new(&item.path).is_absolute())
                    || item.path.contains('\0')
                {
                    return Err("挂件名称或本地路径无效".into());
                }
                if item.kind == "note"
                    && (item.text.trim().is_empty()
                        || item.text.chars().count() > 2000
                        || !item.path.is_empty())
                {
                    return Err("便签需为 1～2000 个字符".into());
                }
                if !["app", "file", "folder", "image", "note"].contains(&item.kind.as_str())
                    || !["cover", "contain"].contains(&item.crop.as_str())
                {
                    return Err("挂件类型或图片裁切无效".into());
                }
            }
        }
        Ok(())
    }
    pub fn group_mut(&mut self, id: &str) -> Result<&mut RailGroup, String> {
        self.groups
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or("找不到这组拾光绳".into())
    }
    pub fn item(&self, id: &str) -> Result<&RailItem, String> {
        self.groups
            .iter()
            .flat_map(|g| &g.items)
            .find(|i| i.id == id)
            .ok_or("找不到这个挂件".into())
    }
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}
pub fn classify(path: &Path) -> &'static str {
    if path.is_dir() {
        return "folder";
    }
    match path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "exe" | "lnk" | "appref-ms" | "app" => "app",
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" => "image",
        _ => "file",
    }
}
pub fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "r{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rail_audio_defaults_migrate_and_invalid_amplitudes_are_rejected() {
        let mut legacy = serde_json::to_value(RailSettings::default()).unwrap();
        legacy["groups"][0]
            .as_object_mut()
            .unwrap()
            .remove("audioSync");
        let mut settings: RailSettings = serde_json::from_value(legacy).unwrap();
        assert_eq!(settings.groups[0].audio_sync, RailAudioConfig::default());
        assert!(!settings.groups[0].audio_sync.enabled);
        for profile in [
            RailAudioProfile::Gentle,
            RailAudioProfile::Bounce,
            RailAudioProfile::String,
        ] {
            settings.groups[0].audio_sync = RailAudioConfig {
                enabled: true,
                profile,
                amount: 100.0,
            };
            settings.validate().unwrap();
            assert_eq!(
                serde_json::from_slice::<RailSettings>(&serde_json::to_vec(&settings).unwrap())
                    .unwrap(),
                settings
            );
        }
        for amount in [-1.0, 100.01, f64::NAN, f64::INFINITY] {
            settings.groups[0].audio_sync.amount = amount;
            assert!(settings.validate().is_err());
        }
        assert!(
            serde_json::from_value::<RailAudioConfig>(serde_json::json!({
                "enabled": true, "profile": "unknown", "amount": 35
            }))
            .is_err()
        );
    }

    #[test]
    fn rail_skins_load_legacy_groups_and_roundtrip_all_materials() {
        let mut legacy = serde_json::to_value(RailSettings::default()).unwrap();
        legacy["groups"][0].as_object_mut().unwrap().remove("skin");
        let settings: RailSettings = serde_json::from_value(legacy).unwrap();
        assert_eq!(settings.groups[0].skin, RailSkin::Floral);
        for (skin, name) in [
            (RailSkin::Woodland, "woodland"),
            (RailSkin::Floral, "floral"),
            (RailSkin::Wisteria, "wisteria"),
            (RailSkin::Autumn, "autumn"),
        ] {
            assert_eq!(serde_json::to_value(skin).unwrap(), name);
            assert_eq!(
                serde_json::from_value::<RailSkin>(serde_json::json!(name)).unwrap(),
                skin
            );
        }
        assert!(serde_json::from_value::<RailSkin>(serde_json::json!("unknown")).is_err());
        assert_eq!(
            serde_json::from_value::<RailSkin>(serde_json::json!("galaxy")).unwrap(),
            RailSkin::Wisteria
        );
        assert_eq!(
            serde_json::from_value::<RailSkin>(serde_json::json!("vinyl")).unwrap(),
            RailSkin::Autumn
        );
    }
    #[test]
    fn only_the_legacy_default_group_name_is_migrated() {
        let mut settings = RailSettings::default();
        settings.groups[0].name = "我的晾衣绳".into();
        assert!(settings.migrate_default_name());
        assert_eq!(settings.groups[0].name, "我的拾光绳");
        assert!(!settings.migrate_default_name());
        settings.groups[0].name = "工作资料".into();
        assert!(!settings.migrate_default_name());
        assert_eq!(settings.groups[0].name, "工作资料");
        settings.groups[0].id = "custom".into();
        settings.groups[0].name = "我的晾衣绳".into();
        assert!(!settings.migrate_default_name());
    }
    #[test]
    fn defaults_and_missing_targets_survive_roundtrip() {
        let mut settings = RailSettings::default();
        let path = std::env::temp_dir().join("soundspectra-missing-rail-file.txt");
        settings.groups[0].items.push(RailItem {
            id: "missing".into(),
            name: "保留的引用".into(),
            path: path.display().to_string(),
            kind: "file".into(),
            crop: "contain".into(),
            text: String::new(),
            desktop_managed: false,
            desktop_identity: None,
        });
        settings.validate().unwrap();
        assert_eq!(
            serde_json::from_str::<RailSettings>(&serde_json::to_string(&settings).unwrap())
                .unwrap(),
            settings
        );
    }
    #[test]
    fn full_width_rail_stays_within_screen() {
        let mut settings = RailSettings::default();
        settings.groups[0].x = 0.0;
        settings.groups[0].width = 1.0;
        assert!(settings.validate().is_ok());
        settings.groups[0].x = 0.01;
        assert!(settings.validate().is_err());
        settings.groups[0].x = 0.0;
        settings.groups[0].width = 1.01;
        assert!(settings.validate().is_err());
    }
    #[test]
    fn duplicate_ids_unknown_versions_and_offscreen_positions_are_rejected() {
        let mut settings = RailSettings::default();
        settings.groups.push(settings.groups[0].clone());
        assert!(settings.validate().is_err());
        let mut settings = RailSettings::default();
        settings.version = 2;
        assert!(settings.validate().is_err());
        let mut settings = RailSettings::default();
        settings.groups[0].x = 0.99;
        assert!(settings.validate().is_err());
    }
}
