import {
  musicEffects,
  isAmbientEffect,
  defaultMusicSettings,
  type MusicEffect,
  type MusicSettings,
} from "./music-engine/catalog";

export type NumericKey = Exclude<
  keyof MusicSettings,
  "response" | "rainDirection" | "fieldPalette" | "fieldRippleMode"
>;
export type Control = {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step?: number;
  unit?: string;
};
const controls: Partial<Record<MusicEffect, Control[]>> = {
  butterfly_flock: [
    {
      key: "ambientSpread",
      label: "蝶群间距",
      min: 0.6,
      max: 1.8,
      step: 0.1,
      unit: "×",
    },
    {
      key: "fieldHeight",
      label: "拍翼幅度",
      min: 0.3,
      max: 1.6,
      step: 0.1,
      unit: "×",
    },
  ],
  caustic_light: [
    {
      key: "ambientSpread",
      label: "光纹尺度",
      min: 0.6,
      max: 1.8,
      step: 0.1,
      unit: "×",
    },
    {
      key: "fieldHeight",
      label: "水面起伏",
      min: 0.3,
      max: 1.6,
      step: 0.1,
      unit: "×",
    },
  ],
  ginkgo_leaves: [
    {
      key: "ambientSpread",
      label: "树冠舒展",
      min: 0.6,
      max: 1.8,
      step: 0.1,
      unit: "×",
    },
    {
      key: "fieldHeight",
      label: "风动幅度",
      min: 0.3,
      max: 1.6,
      step: 0.1,
      unit: "×",
    },
  ],
  cosmic_web: [
    {
      key: "ambientSpread",
      label: "星脉跨度",
      min: 0.6,
      max: 1.8,
      step: 0.1,
      unit: "×",
    },
    {
      key: "fieldHeight",
      label: "脉冲强度",
      min: 0.3,
      max: 1.6,
      step: 0.1,
      unit: "×",
    },
  ],
  tidal_knot: [
    {
      key: "fieldHeight",
      label: "流体形变",
      min: 0.3,
      max: 2,
      step: 0.1,
      unit: "×",
    },
  ],
  layered_tides: [
    {
      key: "fieldHeight",
      label: "涌浪深度",
      min: 0.3,
      max: 2,
      step: 0.1,
      unit: "×",
    },
  ],
  echo_corridor: [
    {
      key: "fieldHeight",
      label: "轨道弯曲",
      min: 0.3,
      max: 2,
      step: 0.1,
      unit: "×",
    },
  ],
  sound_field: [
    {
      key: "fieldScale",
      label: "声场铺满",
      min: 0.8,
      max: 2,
      step: 0.05,
      unit: "×",
    },
    {
      key: "fieldHeight",
      label: "柱体高度",
      min: 0.3,
      max: 2,
      step: 0.1,
      unit: "×",
    },
    { key: "fieldBrightness", label: "声场亮度", min: 15, max: 90, unit: "%" },
    {
      key: "fieldSpread",
      label: "扩散范围",
      min: 0.5,
      max: 1.8,
      step: 0.1,
      unit: "×",
    },
    { key: "fieldDrops", label: "回响密度", min: 1, max: 8 },
  ],
  rhythm_balls: [
    {
      key: "driftSpeed",
      label: "漂游速度",
      min: 0.1,
      max: 5,
      step: 0.1,
      unit: "×",
    },
    { key: "jellySize", label: "伞体大小", min: 1.2, max: 4.8, step: 0.1 },
    { key: "jellyCount", label: "水母数量", min: 3, max: 7 },
    { key: "tentacleLength", label: "触须舒展", min: 0, max: 1, step: 0.05 },
  ],
  rhythm_rain: [
    {
      key: "rainSpeedMultiplier",
      label: "落雨速度",
      min: 0.1,
      max: 5,
      step: 0.1,
      unit: "×",
    },
    {
      key: "rainRadiusMultiplier",
      label: "雨滴半径",
      min: 0.5,
      max: 2,
      step: 0.1,
      unit: "×",
    },
    { key: "rainCount", label: "雨幕密度", min: 5, max: 20 },
  ],
  rhythm_skin: [
    {
      key: "skinFlowSpeedMultiplier",
      label: "织物流速",
      min: 0.1,
      max: 10,
      step: 0.1,
      unit: "×",
    },
    {
      key: "dragonWidth",
      label: "绸面宽度",
      min: 0.5,
      max: 2,
      step: 0.1,
      unit: "×",
    },
    { key: "dragonTrail", label: "织边光泽", min: 0, max: 8 },
  ],
  ripple: [
    {
      key: "rippleWidth",
      label: "雪片大小",
      min: 0.5,
      max: 2,
      step: 0.1,
      unit: "×",
    },
    { key: "rippleTwist", label: "飘雪风向", min: -1.5, max: 1.5, step: 0.1 },
    { key: "rippleLights", label: "飘雪密度", min: 1, max: 4 },
  ],
  volume_rain: [
    { key: "meteorDensity", label: "浮游密度", min: 24, max: 96 },
    {
      key: "meteorTrail",
      label: "羽冠舒展",
      min: 0.5,
      max: 2,
      step: 0.1,
      unit: "×",
    },
    { key: "meteorAngle", label: "风向倾角", min: -45, max: 45, unit: "°" },
  ],
  dream_stars: [
    { key: "starDensity", label: "星河密度", min: 1200, max: 6000, step: 100 },
    { key: "nebulaScale", label: "星云尺度", min: 0.5, max: 2, step: 0.1 },
    { key: "dustOpacity", label: "尘埃浓度", min: 0, max: 1, step: 0.05 },
    { key: "spinSpeed", label: "星云流速", min: 0, max: 2, step: 0.1 },
  ],
  vortex: [
    { key: "vortexArms", label: "旋臂数量", min: 2, max: 5 },
    {
      key: "vortexRange",
      label: "旋涡范围",
      min: 0.5,
      max: 1.3,
      step: 0.1,
      unit: "×",
    },
    {
      key: "vortexWidth",
      label: "旋臂粗细",
      min: 0.5,
      max: 2,
      step: 0.1,
      unit: "×",
    },
  ],
};
const ambientControls: Control[] = [
  {
    key: "fieldScale",
    label: "场景尺度",
    min: 0.8,
    max: 2,
    step: 0.05,
    unit: "×",
  },
  { key: "fieldBrightness", label: "光感亮度", min: 15, max: 90, unit: "%" },
  {
    key: "ambientDensity",
    label: "细节密度",
    min: 0.5,
    max: 2,
    step: 0.1,
    unit: "×",
  },
  {
    key: "ambientSpread",
    label: "空间展开",
    min: 0.6,
    max: 1.8,
    step: 0.1,
    unit: "×",
  },
];

const profiles: Record<MusicEffect, Partial<MusicSettings>> = {
  butterfly_flock: {
    speed: 1,
    sensitivity: 0.85,
    fieldScale: 1.35,
    fieldHeight: 1,
    fieldBrightness: 48,
    ambientSpread: 1,
    response: "soft",
  },
  caustic_light: {
    speed: 1,
    sensitivity: 0.85,
    fieldScale: 1.35,
    fieldHeight: 1,
    fieldBrightness: 45,
    ambientSpread: 1,
    response: "soft",
  },
  ginkgo_leaves: {
    speed: 1,
    sensitivity: 0.9,
    fieldScale: 1.35,
    fieldHeight: 1,
    fieldBrightness: 48,
    ambientSpread: 1,
    response: "soft",
  },
  cosmic_web: {
    speed: 1,
    sensitivity: 0.85,
    fieldScale: 1.35,
    fieldHeight: 1,
    fieldBrightness: 40,
    ambientSpread: 1,
    response: "soft",
  },
  tidal_knot: {
    speed: 1,
    sensitivity: 0.7,
    fieldScale: 1.35,
    fieldHeight: 1,
    fieldBrightness: 45,
    response: "soft",
  },
  layered_tides: {
    speed: 1,
    sensitivity: 0.8,
    fieldScale: 1.35,
    fieldHeight: 1,
    fieldBrightness: 45,
    response: "soft",
  },
  echo_corridor: {
    speed: 1,
    sensitivity: 0.85,
    fieldScale: 1.35,
    fieldHeight: 1,
    fieldBrightness: 45,
    response: "soft",
  },
  rhythm_balls: {
    speed: 1,
    sensitivity: 1,
    jellyCount: 5,
    jellySize: 2.4,
    driftSpeed: 1.5,
    tentacleLength: 0.5,
  },
  rhythm_rain: {
    speed: 1,
    sensitivity: 0.8,
    rainSpeedMultiplier: 1.2,
    rainRadiusMultiplier: 0.8,
    rainCount: 8,
    response: "soft",
  },
  rhythm_skin: {
    speed: 1,
    sensitivity: 0.8,
    skinFlowSpeedMultiplier: 1.3,
    dragonTrail: 2,
    response: "soft",
  },
  ripple: {
    speed: 1,
    sensitivity: 0.65,
    rippleLights: 2,
    rippleTwist: 0.3,
    response: "soft",
  },
  volume_rain: {
    speed: 1,
    sensitivity: 0.65,
    meteorDensity: 48,
    meteorTrail: 0.8,
    response: "soft",
  },
  dream_stars: {
    speed: 1,
    sensitivity: 0.8,
    starDensity: 2400,
    nebulaScale: 1,
    dustOpacity: 0.65,
    spinSpeed: 0.55,
    response: "soft",
  },
  vortex: {
    speed: 1,
    sensitivity: 0.85,
    vortexArms: 3,
    vortexWidth: 0.85,
    response: "soft",
  },
  sound_field: {
    speed: 1,
    sensitivity: 0.9,
    fieldHeight: 0.8,
    fieldBrightness: 42,
  },
  petal_bloom: {
    speed: 1,
    sensitivity: 0.7,
    ambientDensity: 0.8,
    fieldBrightness: 42,
    response: "soft",
  },
  aurora_flow: {
    speed: 1,
    sensitivity: 0.8,
    fieldBrightness: 48,
    response: "soft",
  },
  star_flight: {
    speed: 2,
    sensitivity: 0.9,
    fieldBrightness: 55,
    ambientDensity: 0.85,
  },
};

export interface ArtControl {
  id: string;
  label: string;
  hint: string;
  channels: readonly (readonly [NumericKey, number, number])[];
}
export interface EffectDefinition {
  defaults: MusicSettings;
  controls: Control[];
  art: ArtControl[];
  /** Normal movement / onset / sustained sound / settling. These are authoring contracts. */
  rules: readonly [string, string, string, string];
  motion: {
    bassRelease: number;
    middleAttack: number;
    highRelease: number;
    sustainFlow: number;
    onsetLife: number;
  };
  desktop: { x: number; y: number; scale: number };
  quality: { eco: number; balanced: number; smooth: number; unlimited: number };
}
const art = (
  id: string,
  label: string,
  hint: string,
  ...channels: (readonly [NumericKey, number, number])[]
): ArtControl => ({ id, label, hint, channels });
const light = (label = "光感") =>
  art("light", label, "柔和 → 明亮", ["fieldBrightness", 20, 72]);
const participation = () =>
  art("music", "音乐参与度", "轻轻陪伴 → 清晰回应", ["sensitivity", 0.5, 2]);
const declarations: Record<
  MusicEffect,
  Pick<EffectDefinition, "art" | "rules" | "desktop"> & {
    response: readonly [number, number, number, number, number];
    detail?: number;
  }
> = {
  butterfly_flock: {
    art: [
      art("space", "蝶群空间", "相聚 → 舒展", ["ambientSpread", 0.65, 1.65]),
      art("mood", "拍翼性格", "轻振 → 翩飞", ["fieldHeight", 0.35, 1.5]),
      light("鳞翅光感"),
      participation(),
    ],
    rules: [
      "近景主蝶与远景蝶群沿共同方向飞行，前后翅错拍",
      "低频带动拍翼和身体升沉，起音依次引导蝶群转向",
      "中频展开飞行队形，翅尖滞后，高频擦亮鳞粉",
      "保留飞行位置，拍翼停止，队形与余光逐渐收束",
    ],
    response: [0.65, 0.25, 0.18, 0.2, 0.7],
    desktop: { x: 0.12, y: 0.02, scale: 0.85 },
  },
  caustic_light: {
    art: [
      art("space", "光纹尺度", "细密 → 舒展", ["ambientSpread", 0.65, 1.65]),
      art("mood", "水面性格", "微漾 → 波动", ["fieldHeight", 0.35, 1.5]),
      light("水光亮度"),
      participation(),
    ],
    rules: [
      "光线穿过缓动水面，在水下聚成明亮焦散，斜光束与浮尘表现纵深",
      "低频改变水面坡度，折光亮纹随之汇聚和分离",
      "长音牵动水面传播，高频为局部焦点添上微光",
      "保留水面相位，坡度变化逐渐平复，折光停止漂移",
    ],
    response: [0.7, 0.3, 0.16, 0.15, 0.8],
    desktop: { x: 0, y: 0, scale: 1 },
  },
  ginkgo_leaves: {
    art: [
      art("space", "树冠舒展", "收拢 → 开阔", ["ambientSpread", 0.65, 1.65]),
      art("mood", "秋风性格", "轻摇 → 阵风", ["fieldHeight", 0.35, 1.5]),
      light("金叶透光"),
      participation(),
    ],
    rules: [
      "完整银杏树的树干、枝杈和金色树冠形成主体，地面留少量落叶",
      "起音加快叶片从树冠脱落，阵风从一侧传过枝叶",
      "低频带动枝杈和树冠摇动，中频长音推动横风，叶片边落边翻转",
      "保留枝叶位置与落叶进度，树冠余势逐渐平复，桌面留出阅读空间",
    ],
    response: [0.55, 0.2, 0.16, 0.2, 0.7],
    desktop: { x: 0.22, y: -0.02, scale: 0.84 },
  },
  cosmic_web: {
    art: [
      art("space", "星脉空间", "近观 → 辽阔", ["ambientSpread", 0.65, 1.65]),
      art("mood", "传波性格", "微光 → 明晰", ["fieldHeight", 0.35, 1.5]),
      light("深空微光"),
      participation(),
    ],
    rules: [
      "细密星尘沿弯曲分支汇入局部星团，枝间保留深空暗洞",
      "起音从中心星团沿连接路径传播，到交汇处继续分流",
      "低频提升局部密集区亮度，中高频擦亮细丝，缓慢视差显出远近",
      "保留星脉方位，已发出的脉冲渐淡，深空保持安定",
    ],
    response: [0.8, 0.3, 0.18, 0.15, 0.9],
    desktop: { x: 0.08, y: 0, scale: 0.88 },
  },
  tidal_knot: {
    art: [
      art("space", "雕塑占屏", "留白 → 饱满", ["fieldScale", 0.9, 1.8]),
      art("mood", "流体性格", "平静 → 起伏", ["fieldHeight", 0.3, 1.8]),
      light("轮廓光感"),
      participation(),
    ],
    rules: [
      "双层粒子流体缓慢侧转，保持内外层次",
      "低频推动局部鼓起与回落，起音沿曲面传播",
      "中频扭动粒子流，高频点亮局部细点",
      "停止传播，按共享包络淡出",
    ],
    response: [0.7, 0.4, 0.18, 0.15, 0.6],
    desktop: { x: 0.2, y: 0, scale: 0.8 },
  },
  layered_tides: {
    art: [
      art("space", "层海占屏", "疏朗 → 铺展", ["fieldScale", 0.9, 1.8]),
      art("mood", "涌浪性格", "轻波 → 翻涌", ["fieldHeight", 0.3, 1.8]),
      light("粒子光感"),
      participation(),
    ],
    rules: [
      "宽幅粒子波面与暗层形成纵深",
      "低频抬升交错波峰，起音激起向外扩散的涌浪",
      "中频推动细波，高频擦亮浪尖",
      "已有曲面收束，传播停止",
    ],
    response: [0.5, 0.22, 0.18, 0.55, 0.85],
    desktop: { x: 0, y: -0.18, scale: 0.85 },
  },
  echo_corridor: {
    art: [
      art("space", "廊道占屏", "远观 → 身临", ["fieldScale", 0.9, 1.8]),
      art("mood", "轨道性格", "平顺 → 曲折", ["fieldHeight", 0.3, 1.8]),
      light("廊道光感"),
      participation(),
    ],
    rules: [
      "六股结构沿纵深前送，近景裁切与远景收束相互衔接",
      "低频推动轨道错位弯曲，起音光带由远及近驶过",
      "中频增强前行光纹，高频点亮刻度与边缘",
      "停止前送，按共享包络淡出",
    ],
    response: [0.38, 0.2, 0.08, 0.2, 0.25],
    desktop: { x: 0.2, y: 0, scale: 1.05 },
  },
  rhythm_balls: {
    art: [
      art(
        "space",
        "深水空间",
        "近处相遇 → 远近群游",
        ["ambientSpread", 0.65, 1.7],
        ["fieldScale", 1.65, 1.05],
      ),
      art(
        "mood",
        "漂游性格",
        "安静 → 舒展",
        ["driftSpeed", 0.35, 2.8],
        ["tentacleLength", 0.15, 0.85],
      ),
      light("生物微光"),
      participation(),
    ],
    rules: [
      "近景主水母与远景群游形成纵深，触须分散拖曳",
      "低频收拢伞缘并抬高伞顶，起音沿伞体传播",
      "口腕和触须滞后追随，高频仅点亮局部细节",
      "推进距离保留，伞体柔和舒展，整体按共享包络隐去",
    ],
    response: [0.85, 0.3, 0.12, 0.08, 0.55],
    desktop: { x: 0.25, y: -0.02, scale: 0.78 },
    detail: 1.15,
  },
  rhythm_skin: {
    art: [
      art(
        "space",
        "绸面空间",
        "紧密 → 宽阔",
        ["dragonWidth", 0.65, 1.7],
        ["fieldScale", 1.65, 1.05],
      ),
      art(
        "mood",
        "流动性格",
        "缓缓滑行 → 灵动翻卷",
        ["skinFlowSpeedMultiplier", 0.25, 3.2],
        ["dragonTrail", 1, 6],
      ),
      light("掠射光感"),
      participation(),
    ],
    rules: [
      "宽幅主绸与细绸形成开放回环，缎面光沿褶皱掠过",
      "真实起音沿绸面传递，织边与末端滞后追随",
      "低频鼓起绸面，中频改变扭转，细织纹保持稳定",
      "传播停止，余势逐渐松弛，保留已有流动距离",
    ],
    response: [0.5, 0.22, 0.18, 0.55, 0.85],
    desktop: { x: 0.12, y: -0.17, scale: 0.78 },
    detail: 1.15,
  },
  sound_field: {
    art: [
      art(
        "space",
        "地形纵深",
        "近景 → 辽阔",
        ["fieldScale", 1.7, 1.05],
        ["fieldSpread", 0.65, 1.65],
      ),
      art(
        "mood",
        "山势性格",
        "平缓 → 起伏",
        ["fieldHeight", 0.4, 1.4],
        ["fieldDrops", 1, 6],
      ),
      light("层叠光感"),
      participation(),
    ],
    rules: [
      "固定镜头下独立柱体组成频谱山势，柱顶明亮、侧面较暗",
      "起音在不同落点激起波纹，沿柱顶向外传递",
      "不同频段带动柱群起伏，低频支撑主体、中高频形成细峰",
      "柱群按连续高度逐渐回落，已有波纹自然消退",
    ],
    response: [0.5, 0.2, 0.12, 0.1, 0.6],
    desktop: { x: 0.17, y: -0.19, scale: 0.7 },
  },
  rhythm_rain: {
    art: [
      art(
        "space",
        "雨幕空间",
        "稀疏 → 绵密",
        ["rainCount", 5, 18],
        ["fieldScale", 1.6, 1.1],
      ),
      art(
        "mood",
        "落雨性格",
        "轻落 → 疾雨",
        ["rainSpeedMultiplier", 0.3, 2.8],
        ["rainRadiusMultiplier", 0.6, 1.5],
      ),
      light("湿润光感"),
      participation(),
    ],
    rules: [
      "细雨分层落入水面，每次落点接出涟漪与微小水花",
      "低频加深局部雨线与落水亮度，鼓点光波依次穿过雨幕",
      "中频气流缓慢带动细雨，远灯在水面留下破碎倒影",
      "静音后雨势渐停，形变和余光平缓收束",
    ],
    response: [0.32, 0.16, 0.09, 0.12, 0.24],
    desktop: { x: 0.09, y: -0.05, scale: 0.92 },
  },
  ripple: {
    art: [
      art(
        "space",
        "飘雪空间",
        "零星 → 漫天",
        ["rippleLights", 1, 4],
        ["fieldScale", 1.6, 1.05],
      ),
      art(
        "mood",
        "风的性格",
        "轻柔 → 盘旋",
        ["rippleTwist", -0.2, 1.2],
        ["rippleWidth", 0.7, 1.4],
      ),
      light("雪晶光感"),
      participation(),
    ],
    rules: [
      "不同景深雪晶缓缓飘落，独立翻面显出晶体",
      "高频推动雪晶继续转动，转角保留",
      "中频长音带来滞后的连贯横风",
      "飘落与旋转停止，已有风势柔和收束",
    ],
    response: [0.65, 0.5, 0.2, 0.04, 0.35],
    desktop: { x: 0, y: 0, scale: 1 },
  },
  volume_rain: {
    art: [
      art(
        "space",
        "浮游空间",
        "零星 → 丰盈",
        ["meteorDensity", 24, 90],
        ["fieldScale", 1.6, 1.05],
      ),
      art(
        "mood",
        "风的性格",
        "低垂 → 轻盈",
        ["meteorTrail", 0.55, 1.6],
        ["meteorAngle", -10, 35],
      ),
      light("日光光感"),
      participation(),
    ],
    rules: [
      "远近羽絮各自倾转，沿连续气流漂游",
      "起音从不同羽冠掠过，使局部细丝弯曲",
      "中频先舒展羽冠根部，羽丝末端随后跟随",
      "气流停止，羽冠按惯性柔和收拢",
    ],
    response: [0.75, 0.4, 0.22, 0.25, 0.5],
    desktop: { x: 0.18, y: -0.06, scale: 0.88 },
  },
  dream_stars: {
    art: [
      art(
        "space",
        "星河纵深",
        "贴近 → 深远",
        ["nebulaScale", 0.65, 1.65],
        ["fieldScale", 1.6, 1.05],
      ),
      art(
        "mood",
        "星云性格",
        "宁静 → 流转",
        ["spinSpeed", 0.1, 1.1],
        ["dustOpacity", 0.85, 0.35],
      ),
      light("星河光感"),
      participation(),
    ],
    rules: [
      "星云气体与暗尘沿一致方向流转，星点保留纵深",
      "连续起音的亮结各自沿星云带扩散",
      "低频缓慢舒展气体，中频托起云层，高频点亮少数星点",
      "星云停止转动，已有亮结自然消退",
    ],
    response: [1.1, 0.55, 0.18, 0.1, 0.7],
    desktop: { x: 0.13, y: 0.13, scale: 0.92 },
  },
  vortex: {
    art: [
      art(
        "space",
        "旋臂空间",
        "紧密 → 广阔",
        ["vortexRange", 0.55, 1.25],
        ["fieldScale", 1.6, 1.05],
      ),
      art(
        "mood",
        "旋流性格",
        "纤细 → 汹涌",
        ["vortexWidth", 0.6, 1.6],
        ["vortexArms", 2, 5],
      ),
      light("电离光感"),
      participation(),
    ],
    rules: [
      "云臂、云纹与粒子沿旋流连续向内卷入",
      "起音从外缘向内传播，选中的电光分支逐段显露",
      "低频牵动内臂，中频滞后舒展云层，高频擦亮细丝",
      "电光先退，云臂柔和收束并停转",
    ],
    response: [0.38, 0.2, 0.08, 0.2, 0.25],
    desktop: { x: 0.22, y: 0.05, scale: 0.82 },
  },
  petal_bloom: {
    art: [
      art(
        "space",
        "花境空间",
        "紧凑 → 繁盛",
        ["ambientSpread", 0.65, 1.65],
        ["fieldScale", 1.6, 1.05],
      ),
      art("mood", "舒展性格", "含蓄 → 绽放", ["ambientDensity", 0.55, 1.6]),
      light("透瓣光感"),
      participation(),
    ],
    rules: [
      "一朵宽瓣花冠与远近花苞悬浮，薄瓣透光并保留柔软曲率",
      "低频轻收花心，真实起音从瓣根向瓣尖逐层传播",
      "中频舒展外瓣，瓣尖滞后，高频带动少量花粉",
      "花冠平缓松弛，花粉停止上浮，透光随余音收束",
    ],
    response: [0.7, 0.4, 0.18, 0.15, 0.6],
    desktop: { x: 0.25, y: -0.08, scale: 0.7 },
  },
  aurora_flow: {
    art: [
      art(
        "space",
        "薄幕空间",
        "密拢 → 辽阔",
        ["ambientSpread", 0.65, 1.7],
        ["fieldScale", 1.6, 1.05],
      ),
      art("mood", "极光性格", "安静 → 丰盈", ["ambientDensity", 0.55, 1.6]),
      light("极光光感"),
      participation(),
    ],
    rules: [
      "薄幕与细丝持续行进，上部帷幔滞后舒展",
      "真实起音沿下缘传播，局部幕边微微抬升",
      "低频托起慢幕，频谱直接点亮细丝，避免重复衰减",
      "幕面停止旅行，上部余势与细光分别收束",
    ],
    response: [0.9, 0.5, 0.16, 0.25, 0.55],
    desktop: { x: 0.1, y: 0.16, scale: 0.9 },
  },
  star_flight: {
    art: [
      art(
        "space",
        "航道空间",
        "收拢 → 开阔",
        ["ambientSpread", 0.65, 1.65],
        ["fieldScale", 1.6, 1.05],
      ),
      art("mood", "航行性格", "疏朗 → 繁星", ["ambientDensity", 0.55, 1.6]),
      light("航道光感"),
      participation(),
    ],
    rules: [
      "近景短尾、星尘流束与远景细点沿开放航道前行",
      "真实起音沿流束前送，少量断弧提示纵深",
      "长音托住航行，低频舒展流束，高频点亮局部星尘",
      "航行停止，已有光纹与短尾迹渐隐",
    ],
    response: [0.45, 0.22, 0.1, 0.3, 0.35],
    desktop: { x: 0.23, y: 0.02, scale: 0.78 },
  },
};

export const effectDefinitions = Object.fromEntries(
  musicEffects.map(({ value }) => {
    const spec = declarations[value],
      [bassRelease, middleAttack, highRelease, sustainFlow, onsetLife] =
        spec.response;
    const effectControls = [
      ...(!["rhythm_balls", "dream_stars"].includes(value)
        ? [
            {
              key: "sensitivity",
              label: "音乐灵敏度",
              min: 0.5,
              max: 2,
              step: 0.1,
              unit: "×",
            } satisfies Control,
          ]
        : []),
      ...(isAmbientEffect(value)
        ? ambientControls
        : value === "sound_field"
          ? controls.sound_field!
          : [...ambientControls.slice(0, 2), ...(controls[value] ?? [])]),
    ];
    return [
      value,
      {
        defaults: { ...defaultMusicSettings, ...profiles[value] },
        controls: effectControls,
        art: spec.art,
        rules: spec.rules,
        desktop: spec.desktop,
        motion: {
          bassRelease,
          middleAttack,
          highRelease,
          sustainFlow,
          onsetLife,
        },
        quality: {
          eco: 0.65,
          balanced: 1,
          smooth: spec.detail ?? 1.2,
          unlimited: spec.detail ?? 1.2,
        },
      } satisfies EffectDefinition,
    ];
  }),
) as Record<MusicEffect, EffectDefinition>;

export const artValue = (control: ArtControl, music: MusicSettings) => {
  const [key, min, max] = control.channels[0];
  return Math.round(
    Math.max(0, Math.min(1, (music[key] - min) / (max - min))) * 100,
  );
};
export function applyArt(
  control: ArtControl,
  value: number,
  music: MusicSettings,
): MusicSettings {
  const amount = Math.max(0, Math.min(1, value / 100)),
    next = { ...music };
  for (const [key, min, max] of control.channels) {
    const result = min + (max - min) * amount;
    next[key] = [
      "speed",
      "jellyCount",
      "rainCount",
      "fieldDrops",
      "dragonTrail",
      "rippleLights",
      "meteorDensity",
      "meteorAngle",
      "vortexArms",
    ].includes(key)
      ? Math.round(result)
      : Math.round(result * 1000) / 1000;
  }
  return next;
}
