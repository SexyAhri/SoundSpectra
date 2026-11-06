use crate::settings::Settings;
use serde_json::Value;

/// Merge against authoritative settings while the caller holds the operation
/// lock. A scene can change appearance, never global or personal source state.
pub fn merge(current: &Settings, scene: Value) -> Result<Settings, String> {
    let source = scene.as_object().ok_or("场景参数无效")?;
    let mut value = serde_json::to_value(current).map_err(|e| e.to_string())?;
    let target = value.as_object_mut().ok_or("设置格式无效")?;
    for (key, field) in source {
        if key == "desktop" {
            let desktop = field.as_object().ok_or("桌面方案格式无效")?;
            if desktop.len() != 4 + usize::from(desktop.contains_key("layerOrder"))
                || desktop.get("version").and_then(Value::as_u64) != Some(1)
                || !desktop.get("followCover").is_some_and(Value::is_boolean)
                || !desktop.contains_key("card")
            {
                return Err("桌面方案版本或字段无效".into());
            }
            let lyrics = desktop
                .get("lyrics")
                .and_then(Value::as_object)
                .ok_or("歌词样式无效")?;
            let keys = [
                "enabled",
                "fontSize",
                "backgroundOpacity",
                "motion",
                "bounds",
            ];
            if lyrics.len() != keys.len() || !keys.iter().all(|key| lyrics.contains_key(*key)) {
                return Err("桌面方案只能修改歌词展示样式".into());
            }
            target.insert("desktopCard".into(), desktop["card"].clone());
            target.insert("followCover".into(), desktop["followCover"].clone());
            if let Some(order) = desktop.get("layerOrder") {
                target.insert("layerOrder".into(), order.clone());
            }
            let personal = target
                .get_mut("lyrics")
                .and_then(Value::as_object_mut)
                .ok_or("歌词配置无效")?;
            personal.extend(lyrics.clone());
        } else if [
            "effect",
            "music",
            "sceneMode",
            "view",
            "color",
            "opacity",
            "sensitivity",
            "decay",
            "reflection",
            "glow",
            "bounds",
            "regionName",
            "regionVisible",
            "regions",
            "masks",
            "atmosphere",
        ]
        .contains(&key.as_str())
        {
            target.insert(key.clone(), field.clone());
        } else {
            return Err(format!("场景不能修改此设置：{key}"));
        }
    }
    let next: Settings = serde_json::from_value(value).map_err(|e| format!("场景参数无效：{e}"))?;
    next.validate()?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn desktop_scenes_preserve_personal_settings_and_old_scenes_preserve_modules() {
        let mut current = Settings::default();
        current.enabled = true;
        current.lyrics.folder = "C:/private/lyrics".into();
        current.lyrics.offset_ms = 250.0;
        let legacy = merge(&current, json!({"color":"#abcdee"})).unwrap();
        assert_eq!(
            serde_json::to_value(&legacy.lyrics).unwrap(),
            serde_json::to_value(&current.lyrics).unwrap()
        );
        let mut style = serde_json::to_value(&current.lyrics).unwrap();
        style.as_object_mut().unwrap().remove("folder");
        style.as_object_mut().unwrap().remove("offsetMs");
        style["enabled"] = json!(true);
        let next = merge(&current, json!({"desktop": {"version":1, "card": current.desktop_card, "lyrics":style, "followCover":true}})).unwrap();
        assert!(next.enabled && next.lyrics.enabled && next.follow_cover);
        assert_eq!(next.lyrics.folder, current.lyrics.folder);
        assert_eq!(next.lyrics.offset_ms, current.lyrics.offset_ms);
        assert_eq!(next.wallpaper_depth, current.wallpaper_depth);
        assert!(merge(&current, json!({"enabled":false})).is_err());
        assert!(merge(&current, json!({"lyrics":{"folder":"changed"}})).is_err());
        assert!(merge(&current, json!({"color":"invalid"})).is_err());
    }
    #[test]
    fn desktop_layer_order_is_persisted_and_invalid_orders_are_rejected() {
        let current = Settings::default();
        let mut lyrics = serde_json::to_value(&current.lyrics).unwrap();
        lyrics.as_object_mut().unwrap().remove("folder");
        lyrics.as_object_mut().unwrap().remove("offsetMs");
        let mut desktop = json!({"version":1, "card":current.desktop_card, "lyrics":lyrics,
            "followCover":false, "layerOrder":["card","effect:primary","lyrics"]});
        let next = merge(&current, json!({"desktop":desktop})).unwrap();
        assert_eq!(next.layer_order, vec!["card", "effect:primary", "lyrics"]);
        desktop["layerOrder"] = json!(["card", "card"]);
        assert!(merge(&current, json!({"desktop":desktop})).is_err());
        desktop["layerOrder"] = json!(["system-window"]);
        assert!(merge(&current, json!({"desktop":desktop})).is_err());
    }
    #[test]
    fn older_settings_disable_cover_following_by_default() {
        let mut old = serde_json::to_value(Settings::default()).unwrap();
        old.as_object_mut().unwrap().remove("followCover");
        assert!(
            !serde_json::from_value::<Settings>(old)
                .unwrap()
                .follow_cover
        );
    }
}
