use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SpectrumEffect {
    #[serde(
        rename = "ripple",
        alias = "ribbon",
        alias = "water_ripple",
        alias = "bloom",
        alias = "valley"
    )]
    Ripple,
    #[serde(rename = "volume_rain", alias = "rain")]
    VolumeRain,
    #[serde(rename = "dream_stars", alias = "stars", alias = "night")]
    DreamStars,
    #[serde(
        rename = "vortex",
        alias = "orbit",
        alias = "pulse_ring",
        alias = "ring"
    )]
    Vortex,
    #[serde(rename = "rhythm_balls", alias = "flock")]
    #[default]
    RhythmBalls,
    #[serde(rename = "rhythm_rain")]
    RhythmRain,
    #[serde(rename = "rhythm_skin", alias = "rhythm_fluid")]
    RhythmSkin,
    #[serde(
        rename = "sound_field",
        alias = "spectrum_bars",
        alias = "rhythm_bars",
        alias = "bars"
    )]
    SoundField,
    #[serde(rename = "petal_bloom")]
    PetalBloom,
    #[serde(rename = "aurora_flow")]
    AuroraFlow,
    #[serde(rename = "star_flight")]
    StarFlight,
    #[serde(rename = "tidal_knot")]
    TidalKnot,
    #[serde(rename = "layered_tides")]
    LayeredTides,
    #[serde(rename = "echo_corridor")]
    EchoCorridor,
    #[serde(rename = "butterfly_flock")]
    ButterflyFlock,
    #[serde(
        rename = "caustic_light",
        alias = "ember_flow",
        alias = "prism_cluster",
        alias = "ink_marbling",
        alias = "ferrofluid"
    )]
    CausticLight,
    #[serde(
        rename = "ginkgo_leaves",
        alias = "kinetic_mobile",
        alias = "harmonic_strings",
        alias = "koi_dance"
    )]
    GinkgoLeaves,
    #[serde(rename = "cosmic_web", alias = "solar_corona")]
    CosmicWeb,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SceneMode {
    #[default]
    Daily,
    Immersive,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SceneView {
    pub yaw: f64,
    pub pitch: f64,
    pub roll: f64,
    pub x: f64,
    pub y: f64,
    pub distance: f64,
}
impl Default for SceneView {
    fn default() -> Self {
        Self {
            yaw: 0.0,
            pitch: 0.0,
            roll: 0.0,
            x: 0.0,
            y: 0.0,
            distance: 1.0,
        }
    }
}
impl SceneView {
    fn validate(&self) -> Result<(), String> {
        for (value, min, max) in [
            (self.yaw, -180.0, 180.0),
            (self.pitch, -180.0, 180.0),
            (self.roll, -180.0, 180.0),
            (self.x, -100.0, 100.0),
            (self.y, -100.0, 100.0),
            (self.distance, 0.25, 4.0),
        ] {
            if !value.is_finite() || !(min..=max).contains(&value) {
                return Err("三维视角参数超出允许范围".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RenderQuality {
    Eco,
    #[default]
    Balanced,
    Smooth,
    Unlimited,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Atmosphere {
    pub direction: f32,
    pub wind: f32,
    pub fog: f32,
    pub lights: f32,
    pub choreography: bool,
}
impl Default for Atmosphere {
    fn default() -> Self {
        Self {
            direction: 15.0,
            wind: 40.0,
            fog: 45.0,
            lights: 60.0,
            choreography: true,
        }
    }
}
impl Atmosphere {
    fn validate(&self) -> Result<(), String> {
        if !self.direction.is_finite()
            || !(-180.0..=180.0).contains(&self.direction)
            || [self.wind, self.fog, self.lights]
                .iter()
                .any(|v| !v.is_finite() || !(0.0..=100.0).contains(v))
        {
            return Err("氛围参数超出允许范围".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesktopCard {
    pub enabled: bool,
    pub variant: String,
    pub bounds: Bounds,
    #[serde(
        skip_serializing_if = "Option::is_none",
        deserialize_with = "card_accent"
    )]
    pub accent_color: Option<String>,
}
fn card_accent<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value
        .as_str()
        .filter(|color| {
            color.len() == 7
                && color.starts_with('#')
                && color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        .map(String::from))
}
impl Default for DesktopCard {
    fn default() -> Self {
        Self {
            enabled: false,
            variant: "record".into(),
            accent_color: None,
            bounds: Bounds {
                x: 0.035,
                y: 0.81,
                width: 0.23,
                height: 0.13,
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MusicSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jelly_count: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub jelly_size: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tentacle_length: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drift_speed: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub star_density: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nebula_scale: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dust_opacity: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spin_speed: Option<f32>,
    pub ambient_density: f32,
    pub ambient_spread: f32,
    pub field_scale: f32,
    pub field_height: f32,
    pub field_brightness: f32,
    pub field_spread: f32,
    pub field_drops: f32,
    pub field_palette: String,
    pub field_ripple_mode: String,
    pub ball_speed_multiplier: f32,
    pub rain_speed_multiplier: f32,
    pub skin_flow_speed_multiplier: f32,
    pub sensitivity: f32,
    pub response: String,
    pub ball_radius_multiplier: f32,
    pub ball_count: f32,
    pub ball_trail: f32,
    pub rain_radius_multiplier: f32,
    pub rain_count: f32,
    pub rain_direction: String,
    pub dragon_width: f32,
    pub dragon_trail: f32,
    pub dragon_burst: f32,
    pub ripple_width: f32,
    pub ripple_twist: f32,
    pub ripple_lights: f32,
    pub meteor_density: f32,
    pub meteor_trail: f32,
    pub meteor_angle: f32,
    pub star_count: f32,
    pub star_depth: f32,
    pub star_trail: f32,
    pub vortex_arms: f32,
    pub vortex_range: f32,
    pub vortex_width: f32,
    pub speed: f32,
}
impl Default for MusicSettings {
    fn default() -> Self {
        Self {
            jelly_count: None,
            jelly_size: None,
            tentacle_length: None,
            drift_speed: None,
            star_density: None,
            nebula_scale: None,
            dust_opacity: None,
            spin_speed: None,
            ambient_density: 1.0,
            ambient_spread: 1.0,
            field_scale: 1.35,
            field_height: 1.0,
            field_brightness: 45.0,
            field_spread: 1.0,
            field_drops: 4.0,
            field_palette: "iris".into(),
            field_ripple_mode: "rain".into(),
            ball_speed_multiplier: 1.50,
            rain_speed_multiplier: 1.20,
            skin_flow_speed_multiplier: 1.30,
            sensitivity: 1.00,
            response: "balanced".into(),
            ball_radius_multiplier: 1.00,
            ball_count: 5.00,
            ball_trail: 0.15,
            rain_radius_multiplier: 1.00,
            rain_count: 10.00,
            rain_direction: "left".into(),
            dragon_width: 1.00,
            dragon_trail: 4.00,
            dragon_burst: 1.00,
            ripple_width: 1.00,
            ripple_twist: 1.00,
            ripple_lights: 2.00,
            meteor_density: 72.00,
            meteor_trail: 1.00,
            meteor_angle: 25.00,
            star_count: 128.00,
            star_depth: 1.00,
            star_trail: 1.00,
            vortex_arms: 4.00,
            vortex_range: 1.00,
            vortex_width: 1.00,
            speed: 2.00,
        }
    }
}
impl MusicSettings {
    fn validate(&self) -> Result<(), String> {
        for (value, min, max) in [
            (self.jelly_count, 3.00, 7.00),
            (self.jelly_size, 1.20, 4.80),
            (self.tentacle_length, 0.00, 1.00),
            (self.drift_speed, 0.10, 5.00),
            (self.star_density, 1200.00, 6000.00),
            (self.nebula_scale, 0.50, 2.00),
            (self.dust_opacity, 0.00, 1.00),
            (self.spin_speed, 0.00, 2.00),
        ] {
            if value.is_some_and(|v| !v.is_finite() || !(min..=max).contains(&v)) {
                return Err("灯效独立参数超出允许范围".into());
            }
        }
        for (value, min, max) in [
            (self.ambient_density, 0.5, 2.0),
            (self.ambient_spread, 0.6, 1.8),
            (self.field_scale, 0.8, 2.0),
            (self.field_height, 0.3, 2.0),
            (self.field_brightness, 15.0, 90.0),
            (self.field_spread, 0.5, 1.8),
            (self.field_drops, 1.0, 8.0),
        ] {
            if !value.is_finite() || !(min..=max).contains(&value) {
                return Err("三维声场参数超出允许范围".into());
            }
        }
        if !["iris", "ember", "lake"].contains(&self.field_palette.as_str())
            || !["rain", "center"].contains(&self.field_ripple_mode.as_str())
        {
            return Err("三维声场配色或涟漪模式无效".into());
        }
        if !self.ball_speed_multiplier.is_finite()
            || !(0.10..=5.00).contains(&self.ball_speed_multiplier)
        {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.rain_speed_multiplier.is_finite()
            || !(0.10..=5.00).contains(&self.rain_speed_multiplier)
        {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.skin_flow_speed_multiplier.is_finite()
            || !(0.10..=10.00).contains(&self.skin_flow_speed_multiplier)
        {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.sensitivity.is_finite() || !(0.50..=2.00).contains(&self.sensitivity) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.ball_radius_multiplier.is_finite()
            || !(0.50..=2.00).contains(&self.ball_radius_multiplier)
        {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.ball_count.is_finite() || !(3.00..=7.00).contains(&self.ball_count) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.ball_trail.is_finite() || !(0.00..=1.00).contains(&self.ball_trail) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.rain_radius_multiplier.is_finite()
            || !(0.50..=2.00).contains(&self.rain_radius_multiplier)
        {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.rain_count.is_finite() || !(5.00..=20.00).contains(&self.rain_count) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.dragon_width.is_finite() || !(0.50..=2.00).contains(&self.dragon_width) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.dragon_trail.is_finite() || !(0.00..=8.00).contains(&self.dragon_trail) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.dragon_burst.is_finite() || !(0.00..=2.00).contains(&self.dragon_burst) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.ripple_width.is_finite() || !(0.50..=2.00).contains(&self.ripple_width) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.ripple_twist.is_finite() || !(-1.50..=1.50).contains(&self.ripple_twist) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.ripple_lights.is_finite() || !(1.00..=4.00).contains(&self.ripple_lights) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.meteor_density.is_finite() || !(24.00..=96.00).contains(&self.meteor_density) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.meteor_trail.is_finite() || !(0.50..=2.00).contains(&self.meteor_trail) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.star_count.is_finite() || !(64.00..=192.00).contains(&self.star_count) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.star_depth.is_finite() || !(0.50..=2.00).contains(&self.star_depth) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.star_trail.is_finite() || !(0.00..=2.00).contains(&self.star_trail) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.vortex_arms.is_finite() || !(2.00..=5.00).contains(&self.vortex_arms) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.vortex_range.is_finite() || !(0.50..=1.30).contains(&self.vortex_range) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.vortex_width.is_finite() || !(0.50..=2.00).contains(&self.vortex_width) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !self.speed.is_finite() || !(0.00..=4.00).contains(&self.speed) {
            return Err("音乐灯效参数超出允许范围".into());
        }
        if !["soft", "balanced", "responsive"].contains(&self.response.as_str())
            || !["left", "down", "right"].contains(&self.rain_direction.as_str())
        {
            return Err("音乐灯效参数无效".into());
        }
        Ok(())
    }
}

fn visible_default() -> bool {
    true
}
fn region_name_default() -> String {
    "主区域".into()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Region {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub effect: SpectrumEffect,
    #[serde(default)]
    pub music: MusicSettings,
    pub scene_mode: SceneMode,
    #[serde(default)]
    pub view: SceneView,
    pub color: String,
    pub opacity: f32,
    pub sensitivity: f32,
    pub decay: f32,
    pub reflection: f32,
    pub glow: f32,
    pub bounds: Bounds,
    #[serde(default)]
    pub atmosphere: Atmosphere,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneMask {
    pub id: String,
    pub bounds: Bounds,
    pub feather: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WallpaperDepth {
    pub enabled: bool,
    pub amount: f64,
    pub profile: String,
    pub revision: String,
    pub source: String,
    pub fit: String,
    pub focus_x: f64,
    pub focus_y: f64,
    pub brightness: f64,
    pub saturation: f64,
    pub ambient_enabled: bool,
    pub ambient_amount: f64,
    pub ambient_color: String,
    pub ambient_bounds: Bounds,
}
impl Default for WallpaperDepth {
    fn default() -> Self {
        Self {
            enabled: false,
            amount: 25.0,
            profile: "landscape".into(),
            revision: String::new(),
            // Old configurations selected an image only when parallax was on.
            source: "legacy".into(),
            fit: "cover".into(),
            focus_x: 50.0,
            focus_y: 50.0,
            brightness: 100.0,
            saturation: 100.0,
            ambient_enabled: false,
            ambient_amount: 30.0,
            ambient_color: "#c5dfdf".into(),
            ambient_bounds: Bounds {
                x: 0.08,
                y: 0.08,
                width: 0.84,
                height: 0.44,
            },
        }
    }
}
impl WallpaperDepth {
    pub fn needs_surface(&self) -> bool {
        self.source == "custom"
            || self.enabled
            || self.ambient_enabled
            || self.brightness != 100.0
            || self.saturation != 100.0
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Lyrics {
    pub font_style: String,
    pub readability: String,
    pub enabled: bool,
    pub folder: String,
    pub font_size: f64,
    pub background_opacity: f64,
    pub offset_ms: f64,
    pub motion: String,
    pub bounds: Bounds,
}
impl Default for Lyrics {
    fn default() -> Self {
        Self {
            font_style: "modern".into(),
            readability: "soft".into(),
            enabled: false,
            folder: String::new(),
            font_size: 64.0,
            background_opacity: 30.0,
            offset_ms: 0.0,
            motion: "depth".into(),
            bounds: Bounds {
                x: 0.06,
                y: 0.20,
                width: 0.88,
                height: 0.56,
            },
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub version: u8,
    pub enabled: bool,
    #[serde(default)]
    pub effect: SpectrumEffect,
    #[serde(default)]
    pub music: MusicSettings,
    #[serde(default)]
    pub quality: RenderQuality,
    #[serde(default)]
    pub scene_mode: SceneMode,
    #[serde(default)]
    pub view: SceneView,
    pub color: String,
    #[serde(default)]
    pub follow_cover: bool,
    #[serde(default)]
    pub layer_order: Vec<String>,
    pub opacity: f32,
    pub sensitivity: f32,
    pub decay: f32,
    pub reflection: f32,
    pub glow: f32,
    pub bounds: Bounds,
    #[serde(default = "region_name_default")]
    pub region_name: String,
    #[serde(default = "visible_default")]
    pub region_visible: bool,
    #[serde(default)]
    pub regions: Vec<Region>,
    #[serde(default)]
    pub masks: Vec<SceneMask>,
    #[serde(default)]
    pub atmosphere: Atmosphere,
    #[serde(default)]
    pub desktop_card: DesktopCard,
    #[serde(default)]
    pub wallpaper_depth: WallpaperDepth,
    #[serde(default)]
    pub lyrics: Lyrics,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            enabled: false,
            effect: SpectrumEffect::RhythmBalls,
            music: MusicSettings::default(),
            quality: RenderQuality::Balanced,
            scene_mode: SceneMode::Daily,
            view: SceneView::default(),
            color: "#d4c3ff".into(),
            follow_cover: false,
            layer_order: vec![],
            opacity: 85.0,
            sensitivity: 100.0,
            decay: 65.0,
            reflection: 32.0,
            glow: 35.0,
            bounds: Bounds {
                x: 0.12,
                y: 0.7,
                width: 0.76,
                height: 0.22,
            },
            region_name: region_name_default(),
            region_visible: true,
            regions: vec![],
            masks: vec![],
            atmosphere: Atmosphere::default(),
            desktop_card: DesktopCard::default(),
            wallpaper_depth: WallpaperDepth::default(),
            lyrics: Lyrics::default(),
        }
    }
}

impl Settings {
    pub fn display_bounds(&self) -> Option<Bounds> {
        // Avoid independently placed rails without resizing the native host
        // every time a rail moves. The overlay remains click-through.
        if self.wallpaper_depth.needs_surface() || self.lyrics.enabled {
            return Some(Bounds {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            });
        }
        let mut bounds: Vec<&Bounds> = self
            .regions
            .iter()
            .filter(|r| r.visible)
            .map(|r| &r.bounds)
            .collect();
        if self.region_visible {
            bounds.push(&self.bounds);
        }
        if self.desktop_card.enabled {
            bounds.push(&self.desktop_card.bounds);
        }
        if self.lyrics.enabled {
            bounds.push(&self.lyrics.bounds);
        }
        let first = bounds.first()?;
        let mut result = (**first).clone();
        for b in bounds.iter().skip(1) {
            let right = (result.x + result.width).max(b.x + b.width);
            let bottom = (result.y + result.height).max(b.y + b.height);
            result.x = result.x.min(b.x);
            result.y = result.y.min(b.y);
            result.width = right - result.x;
            result.height = bottom - result.y;
        }
        Some(result)
    }

    pub fn validate(&self) -> Result<(), String> {
        let lyrics = &self.lyrics;
        validate_bounds(&lyrics.bounds, 0.25, 0.1, 0.75)?;
        if !lyrics.font_size.is_finite()
            || !["modern", "poetry"].contains(&lyrics.font_style.as_str())
            || !["soft", "contrast"].contains(&lyrics.readability.as_str())
            || !(18.0..=72.0).contains(&lyrics.font_size)
            || !lyrics.background_opacity.is_finite()
            || !(0.0..=100.0).contains(&lyrics.background_opacity)
            || !lyrics.offset_ms.is_finite()
            || !(-10000.0..=10000.0).contains(&lyrics.offset_ms)
            || !["depth", "stardust", "stage", "folded", "float", "glow"]
                .contains(&lyrics.motion.as_str())
            || lyrics.folder.chars().count() > 1024
            || lyrics.folder.contains('\0')
        {
            return Err("歌词设置无效".into());
        }
        let depth = &self.wallpaper_depth;
        validate_bounds(&depth.ambient_bounds, 0.2, 0.08, 1.0)?;
        if !depth.amount.is_finite()
            || !(0.0..=100.0).contains(&depth.amount)
            || !["landscape", "left-foreground"].contains(&depth.profile.as_str())
            || depth.revision.len() > 32
            || !depth.revision.bytes().all(|b| b.is_ascii_hexdigit())
            || !["system", "custom", "legacy"].contains(&depth.source.as_str())
            || !["cover", "contain"].contains(&depth.fit.as_str())
            || [
                (depth.focus_x, 0.0, 100.0),
                (depth.focus_y, 0.0, 100.0),
                (depth.brightness, 30.0, 130.0),
                (depth.saturation, 0.0, 150.0),
                (depth.ambient_amount, 0.0, 100.0),
            ]
            .iter()
            .any(|(v, min, max)| !v.is_finite() || !(*min..=*max).contains(v))
            || depth.ambient_color.len() != 7
            || !depth.ambient_color.starts_with('#')
            || !depth.ambient_color[1..]
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err("立体壁纸参数超出允许范围".into());
        }
        self.view.validate()?;
        self.atmosphere.validate()?;
        self.music.validate()?;
        validate_bounds(&self.desktop_card.bounds, 0.15, 0.08, 0.24)?;
        if self.desktop_card.bounds.width > 0.45
            || !["record", "compact", "afternoon", "floating"]
                .contains(&self.desktop_card.variant.as_str())
            || self
                .desktop_card
                .accent_color
                .as_ref()
                .is_some_and(|color| {
                    color.len() != 7
                        || !color.starts_with('#')
                        || !color[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
                })
        {
            return Err("桌面音乐卡片参数超出允许范围".into());
        }
        if self.version != 1 {
            return Err("不支持此版本的配置文件".into());
        }
        validate_appearance(
            &self.color,
            [
                self.opacity,
                self.sensitivity,
                self.decay,
                self.reflection,
                self.glow,
            ],
            &self.bounds,
        )?;
        if self.region_name.trim().is_empty()
            || self.region_name.chars().count() > 24
            || self.regions.len() > 3
            || self.masks.len() > 8
        {
            return Err("区域或遮罩数量／名称超出允许范围".into());
        }
        let mut ids = std::collections::HashSet::new();
        if self.layer_order.len() > 6
            || self.layer_order.iter().any(|id| {
                !ids.insert(id)
                    || !(id == "lyrics"
                        || id == "card"
                        || id
                            .strip_prefix("effect:")
                            .is_some_and(|region| region == "primary" || valid_id(region)))
            })
        {
            return Err("桌面图层顺序无效".into());
        }
        ids.clear();
        for region in &self.regions {
            region.view.validate()?;
            region.atmosphere.validate()?;
            region.music.validate()?;
            if !valid_id(&region.id)
                || !ids.insert(&region.id)
                || region.name.trim().is_empty()
                || region.name.chars().count() > 24
            {
                return Err("装饰区域标识或名称无效".into());
            }
            validate_appearance(
                &region.color,
                [
                    region.opacity,
                    region.sensitivity,
                    region.decay,
                    region.reflection,
                    region.glow,
                ],
                &region.bounds,
            )?;
        }
        ids.clear();
        for mask in &self.masks {
            if !valid_id(&mask.id)
                || !ids.insert(&mask.id)
                || !mask.feather.is_finite()
                || !(0.0..=0.08).contains(&mask.feather)
            {
                return Err("遮罩标识或柔边无效".into());
            }
            validate_bounds(&mask.bounds, 0.02, 0.02, 1.0)?;
        }
        Ok(())
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value != "primary"
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn validate_appearance(color: &str, values: [f32; 5], bounds: &Bounds) -> Result<(), String> {
    if color.len() != 7
        || !color.starts_with('#')
        || !color[1..].bytes().all(|c| c.is_ascii_hexdigit())
    {
        return Err("颜色必须为六位十六进制色值".into());
    }
    for (value, (min, max)) in values.into_iter().zip([
        (10.0, 100.0),
        (25.0, 200.0),
        (0.0, 100.0),
        (0.0, 70.0),
        (0.0, 100.0),
    ]) {
        if !value.is_finite() || value < min || value > max {
            return Err("效果参数超出允许范围".into());
        }
    }
    validate_bounds(bounds, 0.2, 0.08, 1.0)
}

fn validate_bounds(
    b: &Bounds,
    min_width: f64,
    min_height: f64,
    max_height: f64,
) -> Result<(), String> {
    if [b.x, b.y, b.width, b.height].iter().any(|v| !v.is_finite())
        || !(min_width..=1.0).contains(&b.width)
        || !(min_height..=max_height).contains(&b.height)
        || b.x < 0.0
        || b.y < 0.0
        || b.x + b.width > 1.00001
        || b.y + b.height > 1.00001
    {
        return Err("频谱位置或尺寸超出主屏幕范围".into());
    }
    Ok(())
}

pub fn read(path: &Path) -> Result<Settings, String> {
    if !path.exists() {
        return Ok(Settings::default());
    }
    let text = std::fs::read_to_string(path).map_err(|e| format!("无法读取设置：{e}"))?;
    let settings: Settings =
        serde_json::from_str(&text).map_err(|e| format!("配置文件损坏：{e}"))?;
    settings.validate()?;
    Ok(settings)
}

pub fn write(path: &Path, settings: &Settings) -> Result<(), String> {
    settings.validate()?;
    let parent = path.parent().ok_or("找不到配置目录")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("tmp");
    let json = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&temporary, json).map_err(|e| format!("保存设置失败：{e}"))?;
    std::fs::rename(temporary, path).map_err(|e| format!("替换配置文件失败：{e}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn lyric_background_loads_legacy_settings_and_validates_opacity() {
        let mut value = serde_json::to_value(super::Settings::default()).unwrap();
        value["lyrics"]
            .as_object_mut()
            .unwrap()
            .remove("backgroundOpacity");
        let mut settings: super::Settings = serde_json::from_value(value).unwrap();
        assert_eq!(settings.lyrics.background_opacity, 30.0);
        for opacity in [0.0, 100.0] {
            settings.lyrics.background_opacity = opacity;
            settings.validate().unwrap();
        }
        for opacity in [-1.0, 101.0, f64::NAN] {
            settings.lyrics.background_opacity = opacity;
            assert!(settings.validate().is_err());
        }
    }
    #[test]
    fn scene_view_is_saved_per_region_and_old_configs_receive_defaults() {
        let mut value = serde_json::to_value(super::Settings::default()).unwrap();
        value["view"] = serde_json::json!({"yaw":150.0,"pitch":-120.0,"roll":90.0,"x":12.0,"y":-8.0,"distance":0.5});
        value["regions"] = serde_json::json!([extra_region()]);
        let loaded: super::Settings = serde_json::from_value(value.clone()).unwrap();
        loaded.validate().unwrap();
        assert_eq!(serde_json::to_value(loaded).unwrap(), value);
        for (field, invalid) in [
            ("yaw", 181.0),
            ("pitch", -181.0),
            ("roll", 999.0),
            ("x", 101.0),
            ("y", -101.0),
            ("distance", 0.0),
        ] {
            for region in [false, true] {
                let mut bad = value.clone();
                if region {
                    bad["regions"][0]["view"][field] = serde_json::json!(invalid);
                } else {
                    bad["view"][field] = serde_json::json!(invalid);
                }
                assert!(serde_json::from_value::<super::Settings>(bad)
                    .unwrap()
                    .validate()
                    .is_err());
            }
        }
        value.as_object_mut().unwrap().remove("view");
        value["regions"][0].as_object_mut().unwrap().remove("view");
        let legacy: super::Settings = serde_json::from_value(value).unwrap();
        assert_eq!(legacy.view, super::SceneView::default());
        assert_eq!(legacy.regions[0].view, super::SceneView::default());
    }
    #[test]
    fn desktop_effects_accept_fullscreen_regions_and_keep_cards_separate() {
        let mut settings = super::Settings::default();
        settings.bounds = super::Bounds {
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
        };
        settings.validate().unwrap();
        assert_eq!(settings.display_bounds(), Some(settings.bounds.clone()));
        settings.bounds.height = 1.01;
        assert!(settings.validate().is_err());
        settings.bounds.height = 1.0;
        settings.desktop_card.bounds.height = 0.5;
        assert!(settings.validate().is_err());
    }
    #[test]
    fn desktop_card_accent_is_optional_isolated_and_round_trips() {
        let mut settings = super::Settings::default();
        let original_color = settings.color.clone();
        for invalid in [
            serde_json::json!(null),
            serde_json::json!(42),
            serde_json::json!("not-a-color"),
        ] {
            let mut value = serde_json::to_value(&settings).unwrap();
            value["desktopCard"]["accentColor"] = invalid;
            let loaded: super::Settings = serde_json::from_value(value).unwrap();
            loaded.validate().unwrap();
            assert_eq!(loaded.desktop_card.accent_color, None);
        }
        settings.desktop_card.accent_color = Some("#efb273".into());
        let loaded: super::Settings =
            serde_json::from_value(serde_json::to_value(&settings).unwrap()).unwrap();
        loaded.validate().unwrap();
        assert_eq!(loaded.desktop_card.accent_color.as_deref(), Some("#efb273"));
        assert_eq!(loaded.color, original_color);
        settings.desktop_card.variant = "floating".into();
        let floating: super::Settings =
            serde_json::from_value(serde_json::to_value(&settings).unwrap()).unwrap();
        floating.validate().unwrap();
        assert_eq!(floating.desktop_card.variant, "floating");
        assert!(!serde_json::to_value(super::DesktopCard::default())
            .unwrap()
            .as_object()
            .unwrap()
            .contains_key("accentColor"));
    }
    #[test]
    fn desktop_card_extends_host_bounds_and_legacy_settings_default_to_hidden() {
        let mut settings = super::Settings::default();
        settings.region_visible = false;
        assert!(settings.display_bounds().is_none());
        settings.desktop_card.enabled = true;
        assert_eq!(
            settings.display_bounds(),
            Some(settings.desktop_card.bounds.clone())
        );
        settings.region_visible = true;
        let host = settings.display_bounds().unwrap();
        let card = &settings.desktop_card.bounds;
        assert!(host.x <= card.x && host.y + host.height >= card.y + card.height);
        let mut json = serde_json::to_value(&settings).unwrap();
        json.as_object_mut().unwrap().remove("desktopCard");
        assert!(
            !serde_json::from_value::<super::Settings>(json)
                .unwrap()
                .desktop_card
                .enabled
        );
        settings.desktop_card.variant = "unknown".into();
        assert!(settings.validate().is_err());
    }
    use super::*;

    #[test]
    fn existing_settings_keep_their_appearance_and_receive_render_defaults() {
        let mut saved = serde_json::to_value(Settings::default()).unwrap();
        saved.as_object_mut().unwrap().remove("effect");
        saved.as_object_mut().unwrap().remove("quality");
        saved.as_object_mut().unwrap().remove("sceneMode");
        saved["color"] = serde_json::json!("#205aee");
        let loaded: Settings = serde_json::from_value(saved).unwrap();
        loaded.validate().unwrap();
        assert!(matches!(loaded.effect, SpectrumEffect::RhythmBalls));
        assert!(matches!(loaded.quality, RenderQuality::Balanced));
        assert!(matches!(loaded.scene_mode, SceneMode::Daily));
        assert_eq!(loaded.color, "#205aee");
    }

    #[test]
    fn sound_field_parameters_round_trip_and_reject_invalid_values() {
        let mut saved = serde_json::to_value(Settings::default()).unwrap();
        saved["effect"] = serde_json::json!("sound_field");
        saved["music"]["fieldPalette"] = serde_json::json!("ember");
        saved["music"]["fieldBrightness"] = serde_json::json!(31.0);
        saved["music"]["fieldScale"] = serde_json::json!(1.65_f32);
        let loaded: Settings = serde_json::from_value(saved.clone()).unwrap();
        loaded.validate().unwrap();
        assert_eq!(serde_json::to_value(loaded).unwrap(), saved);
        for (field, invalid) in [
            ("fieldScale", serde_json::json!(10.0)),
            ("fieldHeight", serde_json::json!(0.0)),
            ("fieldBrightness", serde_json::json!(1000.0)),
            ("fieldSpread", serde_json::json!(-1.0)),
            ("fieldDrops", serde_json::json!(99.0)),
            ("fieldPalette", serde_json::json!("unknown")),
            ("fieldRippleMode", serde_json::json!("unknown")),
        ] {
            let mut invalid_saved = saved.clone();
            invalid_saved["music"][field] = invalid;
            assert!(serde_json::from_value::<Settings>(invalid_saved)
                .unwrap()
                .validate()
                .is_err());
        }
        for field in [
            "fieldScale",
            "fieldHeight",
            "fieldBrightness",
            "fieldSpread",
            "fieldDrops",
            "fieldPalette",
            "fieldRippleMode",
        ] {
            saved["music"].as_object_mut().unwrap().remove(field);
        }
        let legacy: Settings = serde_json::from_value(saved).unwrap();
        legacy.validate().unwrap();
        assert_eq!(legacy.music.field_brightness, 45.0);
        assert_eq!(legacy.music.field_ripple_mode, "rain");
    }

    #[test]
    fn procedural_effects_survive_settings_round_trip() {
        for effect in [
            "ripple",
            "volume_rain",
            "dream_stars",
            "vortex",
            "rhythm_balls",
            "rhythm_rain",
            "rhythm_skin",
            "sound_field",
            "petal_bloom",
            "aurora_flow",
            "star_flight",
            "tidal_knot",
            "layered_tides",
            "echo_corridor",
            "butterfly_flock",
            "caustic_light",
            "ginkgo_leaves",
            "cosmic_web",
        ] {
            let mut saved = serde_json::to_value(Settings::default()).unwrap();
            saved["effect"] = serde_json::json!(effect);
            let loaded: Settings = serde_json::from_value(saved).unwrap();
            loaded.validate().unwrap();
            assert_eq!(serde_json::to_value(loaded).unwrap()["effect"], effect);
        }
    }

    #[test]
    fn unknown_effects_are_rejected_instead_of_silently_overwriting_them() {
        let mut saved = serde_json::to_value(Settings::default()).unwrap();
        saved["effect"] = serde_json::json!("unknown");
        assert!(serde_json::from_value::<Settings>(saved).is_err());
    }

    #[test]
    fn retired_effects_migrate_in_primary_and_additional_regions() {
        for (retired, replacement) in [
            ("ember_flow", "caustic_light"),
            ("prism_cluster", "caustic_light"),
            ("ink_marbling", "caustic_light"),
            ("kinetic_mobile", "ginkgo_leaves"),
            ("harmonic_strings", "ginkgo_leaves"),
            ("solar_corona", "cosmic_web"),
            ("koi_dance", "ginkgo_leaves"),
            ("ferrofluid", "caustic_light"),
            ("spectrum_bars", "sound_field"),
            ("rhythm_bars", "sound_field"),
            ("pulse_ring", "vortex"),
            ("rhythm_fluid", "rhythm_skin"),
            ("water_ripple", "ripple"),
            ("bars", "sound_field"),
            ("ring", "vortex"),
            ("valley", "ripple"),
        ] {
            let mut value = serde_json::to_value(Settings::default()).unwrap();
            value["effect"] = serde_json::json!(retired);
            value["regions"] = serde_json::json!([extra_region()]);
            value["regions"][0]["effect"] = serde_json::json!(retired);
            value["music"]["clusterCount"] = serde_json::json!(32);
            let loaded: Settings = serde_json::from_value(value).unwrap();
            loaded.validate().unwrap();
            let saved = serde_json::to_value(loaded).unwrap();
            assert_eq!(saved["effect"], replacement);
            assert_eq!(saved["regions"][0]["effect"], replacement);
            assert!(saved["music"].get("clusterCount").is_none());
        }
    }

    #[test]
    fn luminous_parameters_and_lyric_readability_survive_native_save() {
        let mut settings = Settings::default();
        settings.music.jelly_count = Some(7.0);
        settings.music.jelly_size = Some(3.2);
        settings.music.dust_opacity = Some(0.4);
        settings.music.star_density = Some(4200.0);
        settings.lyrics.readability = "contrast".into();
        settings.lyrics.font_style = "poetry".into();
        settings.lyrics.motion = "folded".into();
        settings.validate().unwrap();
        let saved = serde_json::to_value(&settings).unwrap();
        let loaded: Settings = serde_json::from_value(saved).unwrap();
        assert_eq!(
            serde_json::to_value(loaded).unwrap(),
            serde_json::to_value(&settings).unwrap()
        );
        settings.music.jelly_count = Some(f32::NAN);
        assert!(settings.validate().is_err());
    }

    #[test]
    fn lyric_font_styles_migrate_and_reject_unknown_faces() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value["lyrics"].as_object_mut().unwrap().remove("fontStyle");
        let mut loaded: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(loaded.lyrics.font_style, "modern");
        for style in ["modern", "poetry"] {
            loaded.lyrics.font_style = style.into();
            loaded.validate().unwrap();
        }
        loaded.lyrics.font_style = "unknown".into();
        assert!(loaded.validate().is_err());
    }

    #[test]
    fn ambient_scenes_round_trip_new_controls_and_keep_old_settings_compatible() {
        for effect in ["petal_bloom", "aurora_flow", "star_flight"] {
            let mut value = serde_json::to_value(Settings::default()).unwrap();
            value["effect"] = serde_json::json!(effect);
            value["music"]["ambientDensity"] = serde_json::json!(1.5);
            value["music"]["ambientSpread"] = serde_json::json!(1.4_f32);
            let loaded: Settings = serde_json::from_value(value.clone()).unwrap();
            loaded.validate().unwrap();
            assert_eq!(serde_json::to_value(loaded).unwrap(), value);
            for (field, invalid) in [("ambientDensity", 9.0), ("ambientSpread", -1.0)] {
                let mut invalid_value = value.clone();
                invalid_value["music"][field] = serde_json::json!(invalid);
                assert!(serde_json::from_value::<Settings>(invalid_value)
                    .unwrap()
                    .validate()
                    .is_err());
            }
            value["music"]
                .as_object_mut()
                .unwrap()
                .remove("ambientDensity");
            value["music"]
                .as_object_mut()
                .unwrap()
                .remove("ambientSpread");
            let legacy: Settings = serde_json::from_value(value).unwrap();
            legacy.validate().unwrap();
            assert_eq!(legacy.music.ambient_density, 1.0);
            assert_eq!(legacy.music.ambient_spread, 1.0);
        }
    }

    #[test]
    fn copied_effect_parameters_round_trip_and_validate_in_each_region() {
        let mut settings = Settings::default();
        settings.regions.push(extra_region());
        settings.music.ball_speed_multiplier = 3.2;
        settings.music.drift_speed = Some(2.0);
        settings.music.ripple_twist = -1.5;
        settings.regions[0].music.jelly_size = Some(3.0);
        settings.validate().unwrap();
        let saved = serde_json::to_value(&settings).unwrap();
        let loaded: Settings = serde_json::from_value(saved.clone()).unwrap();
        assert_eq!(serde_json::to_value(loaded).unwrap(), saved);
        settings.regions[0].music.jelly_count = Some(99.0);
        assert!(settings.validate().is_err());
        settings.regions[0].music.jelly_count = Some(5.0);
        settings.music.ball_speed_multiplier = f32::NAN;
        assert!(settings.validate().is_err());
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("music");
        legacy["effect"] = serde_json::json!("ribbon");
        let loaded: Settings = serde_json::from_value(legacy).unwrap();
        assert_eq!(loaded.music, MusicSettings::default());
        assert_eq!(serde_json::to_value(loaded).unwrap()["effect"], "ripple");
    }

    #[test]
    fn scene_mode_round_trip_keeps_layout_and_color() {
        let mut saved = serde_json::to_value(Settings::default()).unwrap();
        saved["effect"] = serde_json::json!("dream_stars");
        saved["sceneMode"] = serde_json::json!("immersive");
        saved["color"] = serde_json::json!("#205aee");
        let loaded: Settings = serde_json::from_value(saved.clone()).unwrap();
        loaded.validate().unwrap();
        assert_eq!(serde_json::to_value(loaded).unwrap(), saved);
        saved["sceneMode"] = serde_json::json!("unknown");
        assert!(serde_json::from_value::<Settings>(saved).is_err());
    }

    fn extra_region() -> Region {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value["id"] = serde_json::json!("extra");
        value["name"] = serde_json::json!("天空");
        value["visible"] = serde_json::json!(true);
        value["bounds"] = serde_json::json!({ "x": 0.0, "y": 0.0, "width": 1.0, "height": 0.3 });
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn old_regions_receive_atmosphere_defaults_and_new_modes_round_trip() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value["regions"] = serde_json::json!([extra_region()]);
        value.as_object_mut().unwrap().remove("atmosphere");
        value["regions"][0]
            .as_object_mut()
            .unwrap()
            .remove("atmosphere");
        let mut settings: Settings = serde_json::from_value(value).unwrap();
        assert_eq!(settings.atmosphere, Atmosphere::default());
        assert_eq!(settings.regions[0].atmosphere, Atmosphere::default());
        settings.effect = SpectrumEffect::Ripple;
        settings.quality = RenderQuality::Unlimited;
        settings.atmosphere.direction = -150.0;
        settings.atmosphere.choreography = false;
        settings.regions[0].atmosphere.fog = 90.0;
        settings.validate().unwrap();
        let saved = serde_json::to_value(settings).unwrap();
        let loaded: Settings = serde_json::from_value(saved.clone()).unwrap();
        loaded.validate().unwrap();
        assert_eq!(serde_json::to_value(loaded).unwrap(), saved);
    }

    #[test]
    fn atmosphere_rejects_invalid_values_in_primary_and_extra_regions() {
        for field in ["direction", "wind", "fog", "lights"] {
            let mut value = serde_json::to_value(Settings::default()).unwrap();
            value["atmosphere"][field] = serde_json::json!(999.0);
            assert!(serde_json::from_value::<Settings>(value)
                .unwrap()
                .validate()
                .is_err());
            let mut value = serde_json::to_value(Settings::default()).unwrap();
            value["regions"] = serde_json::json!([extra_region()]);
            value["regions"][0]["atmosphere"][field] = serde_json::json!(-999.0);
            assert!(serde_json::from_value::<Settings>(value)
                .unwrap()
                .validate()
                .is_err());
        }
        let mut settings = Settings::default();
        settings.atmosphere.wind = f32::NAN;
        assert!(settings.validate().is_err());
    }

    #[test]
    fn legacy_scene_defaults_and_visible_region_union() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        for key in ["regionName", "regionVisible", "regions", "masks"] {
            value.as_object_mut().unwrap().remove(key);
        }
        let mut settings: Settings = serde_json::from_value(value).unwrap();
        settings.validate().unwrap();
        assert!(
            settings.region_visible && settings.regions.is_empty() && settings.masks.is_empty()
        );
        assert_eq!(settings.display_bounds(), Some(settings.bounds.clone()));
        settings.regions.push(extra_region());
        let bounds = settings.display_bounds().unwrap();
        assert_eq!((bounds.x, bounds.y, bounds.width), (0.0, 0.0, 1.0));
        assert!((bounds.height - 0.92).abs() < 0.00001);
        settings.regions[0].visible = false;
        assert_eq!(settings.display_bounds(), Some(settings.bounds.clone()));
        settings.region_visible = false;
        assert_eq!(settings.display_bounds(), None);
    }

    #[test]
    fn wallpaper_legacy_and_static_modes_keep_full_desktop_bounds() {
        let mut value = serde_json::to_value(Settings::default()).unwrap();
        value["wallpaperDepth"] = serde_json::json!({"enabled":true,"amount":25.0,"profile":"landscape","revision":"abc"});
        let old: Settings = serde_json::from_value(value).unwrap();
        old.validate().unwrap();
        assert_eq!(old.wallpaper_depth.source, "legacy");
        assert!(old.wallpaper_depth.needs_surface());
        assert_eq!(old.display_bounds().unwrap().width, 1.0);

        let mut settings = Settings::default();
        settings.wallpaper_depth.source = "custom".into();
        settings.wallpaper_depth.revision = "abc".into();
        assert!(!settings.wallpaper_depth.enabled);
        assert_eq!(settings.display_bounds().unwrap().height, 1.0);
        settings.wallpaper_depth.source = "system".into();
        settings.wallpaper_depth.ambient_enabled = true;
        assert_eq!(settings.display_bounds().unwrap().height, 1.0);
        settings.validate().unwrap();
        let saved = serde_json::to_value(&settings).unwrap();
        let loaded: Settings = serde_json::from_value(saved.clone()).unwrap();
        assert_eq!(serde_json::to_value(loaded).unwrap(), saved);

        for field in [
            "brightness",
            "saturation",
            "focusX",
            "focusY",
            "ambientAmount",
        ] {
            let mut invalid = saved.clone();
            invalid["wallpaperDepth"][field] = serde_json::json!(-1.0);
            assert!(serde_json::from_value::<Settings>(invalid)
                .unwrap()
                .validate()
                .is_err());
        }
        settings.wallpaper_depth.ambient_color = "red".into();
        assert!(settings.validate().is_err());
        settings.wallpaper_depth.ambient_color = "#c5dfdf".into();
        settings.wallpaper_depth.ambient_bounds.x = 0.9;
        assert!(settings.validate().is_err());
    }

    #[test]
    fn scene_limits_ids_and_mask_bounds_are_validated() {
        let mut settings = Settings::default();
        settings.regions = vec![extra_region()];
        settings.masks.push(SceneMask {
            id: "mask".into(),
            bounds: Bounds {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            feather: 0.08,
        });
        settings.validate().unwrap();
        settings.regions.push(extra_region());
        assert!(settings.validate().is_err());
        settings.regions = (0..4)
            .map(|i| {
                let mut r = extra_region();
                r.id = format!("region{i}");
                r
            })
            .collect();
        assert!(settings.validate().is_err());
        settings.regions.clear();
        settings.masks[0].feather = f64::NAN;
        assert!(settings.validate().is_err());
        settings.masks[0].feather = 0.0;
        settings.masks[0].bounds.x = 0.1;
        assert!(settings.validate().is_err());
        settings.masks[0].bounds.x = 0.0;
        let mask = settings.masks[0].clone();
        settings.masks.push(mask.clone());
        assert!(settings.validate().is_err());
        settings.masks = (0..9)
            .map(|i| {
                let mut m = mask.clone();
                m.id = format!("mask{i}");
                m
            })
            .collect();
        assert!(settings.validate().is_err());
    }
}
