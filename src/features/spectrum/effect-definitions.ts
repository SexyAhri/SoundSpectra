import { musicEffects, isAmbientEffect, defaultMusicSettings, type MusicEffect, type MusicSettings } from './music-engine/catalog'

export type NumericKey = Exclude<keyof MusicSettings, 'response' | 'rainDirection' | 'fieldPalette' | 'fieldRippleMode'>
export type Control = { key: NumericKey; label: string; min: number; max: number; step?: number; unit?: string }
const controls: Partial<Record<MusicEffect, Control[]>> = {
  sound_field: [
    { key: 'fieldScale', label: '声场铺满', min: .8, max: 2, step: .05, unit: '×' },
    { key: 'fieldHeight', label: '地形高度', min: .3, max: 2, step: .1, unit: '×' },
    { key: 'fieldBrightness', label: '声场亮度', min: 15, max: 90, unit: '%' },
    { key: 'fieldSpread', label: '扩散范围', min: .5, max: 1.8, step: .1, unit: '×' },
    { key: 'fieldDrops', label: '回响密度', min: 1, max: 8 },
  ],
  rhythm_balls: [
    { key: 'driftSpeed', label: '漂游速度', min: .1, max: 5, step: .1, unit: '×' },
    { key: 'jellySize', label: '伞体大小', min: 1.2, max: 4.8, step: .1 },
    { key: 'jellyCount', label: '水母数量', min: 3, max: 7 },
    { key: 'tentacleLength', label: '触须舒展', min: 0, max: 1, step: .05 },
  ],
  rhythm_rain: [
    { key: 'rainSpeedMultiplier', label: '落雨速度', min: .1, max: 5, step: .1, unit: '×' },
    { key: 'rainRadiusMultiplier', label: '雨滴半径', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'rainCount', label: '雨幕密度', min: 5, max: 20 },
  ],
  rhythm_skin: [
    { key: 'skinFlowSpeedMultiplier', label: '织物流速', min: .1, max: 10, step: .1, unit: '×' },
    { key: 'dragonWidth', label: '绸面宽度', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'dragonTrail', label: '织边光泽', min: 0, max: 8 },
  ],
  ripple: [
    { key: 'rippleWidth', label: '雪片大小', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'rippleTwist', label: '飘雪风向', min: -1.5, max: 1.5, step: .1 },
    { key: 'rippleLights', label: '飘雪密度', min: 1, max: 4 },
  ],
  volume_rain: [
    { key: 'meteorDensity', label: '浮游密度', min: 24, max: 96 },
    { key: 'meteorTrail', label: '羽冠舒展', min: .5, max: 2, step: .1, unit: '×' },
    { key: 'meteorAngle', label: '风向倾角', min: -45, max: 45, unit: '°' },
  ],
  dream_stars: [
    { key: 'starDensity', label: '星河密度', min: 1200, max: 6000, step: 100 },
    { key: 'nebulaScale', label: '星云尺度', min: .5, max: 2, step: .1 },
    { key: 'dustOpacity', label: '尘埃浓度', min: 0, max: 1, step: .05 },
    { key: 'spinSpeed', label: '星云流速', min: 0, max: 2, step: .1 },
  ],
  vortex: [
    { key: 'vortexArms', label: '旋臂数量', min: 2, max: 5 },
    { key: 'vortexRange', label: '旋涡范围', min: .5, max: 1.3, step: .1, unit: '×' },
    { key: 'vortexWidth', label: '旋臂粗细', min: .5, max: 2, step: .1, unit: '×' },
  ],
}
const ambientControls: Control[] = [
  { key: 'fieldScale', label: '场景尺度', min: .8, max: 2, step: .05, unit: '×' },
  { key: 'fieldBrightness', label: '光感亮度', min: 15, max: 90, unit: '%' },
  { key: 'ambientDensity', label: '细节密度', min: .5, max: 2, step: .1, unit: '×' },
  { key: 'ambientSpread', label: '空间展开', min: .6, max: 1.8, step: .1, unit: '×' },
]

const profiles: Record<MusicEffect, Partial<MusicSettings>> = {
  rhythm_balls: { speed: 1, sensitivity: 1, jellyCount: 5, jellySize: 2.4, driftSpeed: 1.5, tentacleLength: .5 },
  rhythm_rain: { speed: 1, sensitivity: .8, rainSpeedMultiplier: 1.2, rainRadiusMultiplier: .8, rainCount: 8, response: 'soft' },
  rhythm_skin: { speed: 1, sensitivity: .8, skinFlowSpeedMultiplier: 1.3, dragonTrail: 2, response: 'soft' },
  ripple: { speed: 1, sensitivity: .65, rippleLights: 2, rippleTwist: .3, response: 'soft' },
  volume_rain: { speed: 1, sensitivity: .65, meteorDensity: 48, meteorTrail: .8, response: 'soft' },
  dream_stars: { speed: 1, sensitivity: .8, starDensity: 2400, nebulaScale: 1, dustOpacity: .65, spinSpeed: .55, response: 'soft' },
  vortex: { speed: 1, sensitivity: .85, vortexArms: 3, vortexWidth: .85, response: 'soft' },
  sound_field: { speed: 1, sensitivity: .9, fieldHeight: .8, fieldBrightness: 42 },
  petal_bloom: { speed: 1, sensitivity: .7, ambientDensity: .8, fieldBrightness: 42, response: 'soft' },
  aurora_flow: { speed: 1, sensitivity: .8, fieldBrightness: 48, response: 'soft' },
  star_flight: { speed: 2, sensitivity: .9, fieldBrightness: 55, ambientDensity: .85 },
}

export interface ArtControl { id: string; label: string; hint: string; channels: readonly (readonly [NumericKey, number, number])[] }
export interface EffectDefinition {
  defaults: MusicSettings
  controls: Control[]
  art: ArtControl[]
  /** Normal movement / onset / sustained sound / settling. These are authoring contracts. */
  rules: readonly [string, string, string, string]
  motion: { bassRelease: number; middleAttack: number; highRelease: number; sustainFlow: number; onsetLife: number }
  desktop: { x: number; y: number; scale: number }
  quality: { eco: number; balanced: number; smooth: number; unlimited: number }
}
const art = (id:string,label:string,hint:string,...channels:(readonly [NumericKey,number,number])[]):ArtControl => ({id,label,hint,channels})
const light = (label='光感') => art('light',label,'柔和 → 明亮',['fieldBrightness',20,72])
const participation = () => art('music','音乐参与度','轻轻陪伴 → 清晰回应',['sensitivity',.5,2])
const declarations: Record<MusicEffect, Pick<EffectDefinition,'art'|'rules'|'desktop'> & { response: readonly [number,number,number,number,number]; detail?:number }> = {
  rhythm_balls: {
    art:[art('space','深水空间','近处相遇 → 远近群游',['ambientSpread',.65,1.7],['fieldScale',1.65,1.05]),art('mood','漂游性格','安静 → 舒展',['driftSpeed',.35,2.8],['tentacleLength',.15,.85]),light('生物微光'),participation()],
    rules:['缓慢漂游，细触须错相摆动','低频收缩伞体，局部褶边提亮','中频拉长口腕与触须，高频仅激活局部微光','停止漂游，伞体与触须回收，整体按共享包络隐去'],
    response:[.85,.3,.12,.08,.55],desktop:{x:.25,y:-.02,scale:.78},detail:1.15,
  },
  rhythm_skin: {
    art:[art('space','绸面空间','紧密 → 宽阔',['dragonWidth',.65,1.7],['fieldScale',1.65,1.05]),art('mood','流动性格','缓缓滑行 → 灵动翻卷',['skinFlowSpeedMultiplier',.25,3.2],['dragonTrail',1,6]),light('掠射光感'),participation()],
    rules:['沿褶皱连续流动，织纹保持细微','起音在表面产生局部传播的褶波','稳定长音逐渐增强流动与弯曲，不反复闪烁','收回传播波与弯曲，织物流动停止'],
    response:[.5,.22,.18,.55,.85],desktop:{x:.12,y:-.17,scale:.78},detail:1.15,
  },
  sound_field: {
    art:[art('space','地形纵深','近景 → 辽阔',['fieldScale',1.7,1.05],['fieldSpread',.65,1.65]),art('mood','山势性格','平缓 → 起伏',['fieldHeight',.4,1.4],['fieldDrops',1,6]),light('层叠光感'),participation()],
    rules:['频段塑造局部山脊与峰顶','起音在不同落点形成层叠波纹','长音保持地势，能量积累形成细小回响','地形随真实能量收低，已有波纹自然消退'],
    response:[.5,.2,.12,.1,.6],desktop:{x:.17,y:-.19,scale:.7},
  },
  rhythm_rain: {
    art:[art('space','雨幕空间','稀疏 → 绵密',['rainCount',5,18],['fieldScale',1.6,1.1]),art('mood','落雨性格','轻落 → 疾雨',['rainSpeedMultiplier',.3,2.8],['rainRadiusMultiplier',.6,1.5]),light('湿润光感'),participation()],
    rules:['雨线纵向穿过远近街景','起音加长局部雨线的亮端','持续音维持雨流，湿地反光缓缓展开','雨流停止，亮端与反光按能量消退'],
    response:[.32,.16,.09,.12,.24],desktop:{x:.09,y:-.05,scale:.92},
  },
  ripple: {
    art:[art('space','飘雪空间','零星 → 漫天',['rippleLights',1,4],['fieldScale',1.6,1.05]),art('mood','风的性格','轻柔 → 盘旋',['rippleTwist',-.2,1.2],['rippleWidth',.7,1.4]),light('雪晶光感'),participation()],
    rules:['不同景深的雪晶缓缓飘落','局部雪晶受起音轻轻侧偏','中频长音带来连贯横风','停止飘落与横风，柔和隐去'],
    response:[.65,.5,.2,.04,.35],desktop:{x:0,y:0,scale:1},
  },
  volume_rain: {
    art:[art('space','浮游空间','零星 → 丰盈',['meteorDensity',24,90],['fieldScale',1.6,1.05]),art('mood','风的性格','低垂 → 轻盈',['meteorTrail',.55,1.6],['meteorAngle',-10,35]),light('日光光感'),participation()],
    rules:['细羽絮在远近空间中错相漂游','起音使少量羽丝弯曲并点亮','中频长音舒展羽丝，维持连续气流','羽丝收拢，漂游停止，光线消退'],
    response:[.75,.4,.22,.25,.5],desktop:{x:.18,y:-.06,scale:.88},
  },
  dream_stars: {
    art:[art('space','星河纵深','贴近 → 深远',['nebulaScale',.65,1.65],['fieldScale',1.6,1.05]),art('mood','星云性格','宁静 → 流转',['spinSpeed',.1,1.1],['dustOpacity',.85,.35]),light('星河光感'),participation()],
    rules:['星云旋流与独立星点缓慢游移','亮结沿局部星云带扩散','中频增强星云层，高频仅点亮少数星点','星云停止转动，亮结及星点渐隐'],
    response:[1.1,.55,.18,.1,.7],desktop:{x:.13,y:.13,scale:.92},
  },
  vortex: {
    art:[art('space','旋臂空间','紧密 → 广阔',['vortexRange',.55,1.25],['fieldScale',1.6,1.05]),art('mood','旋流性格','纤细 → 汹涌',['vortexWidth',.6,1.6],['vortexArms',2,5]),light('电离光感'),participation()],
    rules:['云臂以不同半径连续回旋','起音沿局部云臂激活电光','长音舒展云臂，高频在少数分支产生亮点','电光先退，云臂回拢并停转'],
    response:[.38,.2,.08,.2,.25],desktop:{x:.22,y:.05,scale:.82},
  },
  petal_bloom: {
    art:[art('space','花境空间','紧凑 → 繁盛',['ambientSpread',.65,1.65],['fieldScale',1.6,1.05]),art('mood','舒展性格','含蓄 → 绽放',['ambientDensity',.55,1.6]),light('透瓣光感'),participation()],
    rules:['层叠花瓣轻缓舒展，散瓣沿景深漂移','起音在部分花瓣上带出细小褶波','长音舒展花冠，高频点亮花蕊与瓣尖','花瓣停止漂移，透光随音乐消退'],
    response:[.7,.4,.18,.15,.6],desktop:{x:.25,y:-.08,scale:.7},
  },
  aurora_flow: {
    art:[art('space','薄幕空间','密拢 → 辽阔',['ambientSpread',.65,1.7],['fieldScale',1.6,1.05]),art('mood','极光性格','安静 → 丰盈',['ambientDensity',.55,1.6]),light('极光光感'),participation()],
    rules:['薄幕与细丝持续行进','共享瞬态局部点亮幕边','长音维持幕面旅行，频谱影响细丝','幕面停止旅行，薄光随包络收束'],
    response:[.9,.5,.16,.25,.55],desktop:{x:.1,y:.16,scale:.9},
  },
  star_flight: {
    art:[art('space','航道空间','收拢 → 开阔',['ambientSpread',.65,1.65],['fieldScale',1.6,1.05]),art('mood','航行性格','疏朗 → 繁星',['ambientDensity',.55,1.6]),light('航道光感'),participation()],
    rules:['星尘与环带沿同一航道穿行','起音在环带形成局部节点','长音保持行进，细分频谱塑造节点层次','航行停止，节点与尾迹渐隐'],
    response:[.45,.22,.1,.3,.35],desktop:{x:.23,y:.02,scale:.78},
  },
}

export const effectDefinitions = Object.fromEntries(musicEffects.map(({value}) => {
  const spec=declarations[value], [bassRelease,middleAttack,highRelease,sustainFlow,onsetLife]=spec.response
  const effectControls=[
    ...(!['rhythm_balls','dream_stars'].includes(value)?[{key:'sensitivity',label:'音乐灵敏度',min:.5,max:2,step:.1,unit:'×'} satisfies Control]:[]),
    ...(isAmbientEffect(value)?ambientControls:value==='sound_field'?controls.sound_field!:[...ambientControls.slice(0,2),...(controls[value]??[])])]
  return [value, { defaults:{...defaultMusicSettings,...profiles[value]}, controls:effectControls, art:spec.art, rules:spec.rules,
    desktop:spec.desktop, motion:{bassRelease,middleAttack,highRelease,sustainFlow,onsetLife},
    quality:{eco:.65,balanced:1,smooth:spec.detail??1.2,unlimited:spec.detail??1.2} } satisfies EffectDefinition]
})) as Record<MusicEffect,EffectDefinition>

export const artValue = (control:ArtControl,music:MusicSettings) => {
  const [key,min,max]=control.channels[0]
  return Math.round(Math.max(0,Math.min(1,(music[key]-min)/(max-min)))*100)
}
export function applyArt(control:ArtControl,value:number,music:MusicSettings):MusicSettings {
  const amount=Math.max(0,Math.min(1,value/100)), next={...music}
  for(const [key,min,max] of control.channels){
    const result=min+(max-min)*amount
    next[key]=['speed','jellyCount','rainCount','fieldDrops','dragonTrail','rippleLights','meteorDensity','meteorAngle','vortexArms'].includes(key)?Math.round(result):Math.round(result*1000)/1000
  }
  return next
}
