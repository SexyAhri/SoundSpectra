use crate::{
    audio_source::{Discovery, Target, PLAYERS},
    macos_helper,
};
use std::time::Duration;

pub fn running() -> Result<serde_json::Value, String> {
    macos_helper::json(&["list"], Duration::from_secs(5))
}
pub fn scan() -> Result<Discovery, String> {
    let apps = running()?;
    let mut targets: Vec<Target> = apps
        .as_array()
        .ok_or("播放器列表格式无效")?
        .iter()
        .filter_map(|app| {
            let player = PLAYERS
                .iter()
                .find(|p| Some(p.id) == app["player"].as_str())?;
            Some(Target {
                pid: app["pid"].as_u64()? as u32,
                executable: player.executables[0].into(),
                name: player.name.into(),
                player_id: Some(player.id.into()),
                audible: false,
            })
        })
        .collect();
    targets.sort_by_key(|target| target.pid);
    Ok(Discovery {
        targets,
        warning: None,
    })
}
