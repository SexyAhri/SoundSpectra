import type { SpectrumEffect } from '../spectrum/model'
import { isClassicEffect, musicEffects } from '../spectrum/music-engine/catalog'
import { ClassicArtwork } from './classic-artwork'

const sceneThumbnails = import.meta.glob('../../assets/scenes/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>

const visualCatalog = {
  bars: { label: '经典频谱', caption: 'SPECTRUM', color: '#f1bd65' },
  ribbon: { label: '流光波浪', caption: 'WAVEFORM', color: '#80ddca' },
  stars: { label: '星点律动', caption: 'STARDUST', color: '#9ab9ff' },
  ring: { label: '脉冲光环', caption: 'PULSE', color: '#f29e96' },
  orbit: { label: '轨道辉光', caption: 'ORBIT', color: '#e5b5f1' },
  rain: { label: '霓虹雨线', caption: 'RAINFALL', color: '#82c5f4' },
  flock: { label: '振翅流萤', caption: 'FIREFLY', color: '#b8df8b' },
  bloom: { label: '潮汐花簇', caption: 'BLOOM', color: '#f5a6c5' },
  night: { label: '星夜', caption: '远星 · 微光 · 流星', color: '#9baaff' },
  valley: { label: '山谷晚风', caption: '风 · 薄雾 · 流萤', color: '#b1d5a3' },
  balls: { label: '弹球', caption: 'BOUNCE', color: '#f6bc72' },
  fluid: { label: '熔金潮汐', caption: 'FLUID', color: '#b6a6ed' },
  dragon: { label: '风织绸境', caption: 'DRAGON', color: '#8fd9bd' },
  water: { label: '水波纹', caption: 'RIPPLES', color: '#a4ccef' },
  field: { label: '频谱回响', caption: '3D · 频谱地形', color: '#d29b7d' },
  petals: { label: '星瓣花境', caption: '3D · 花瓣舒展', color: '#c5b1ec' },
  aurora: { label: '极光流域', caption: '3D · 光幕流动', color: '#86d8cc' },
  flight: { label: '星尘航道', caption: '3D · 星海穿行', color: '#aac7f4' },
}
type Illustration = keyof typeof visualCatalog
const illustrations: Record<SpectrumEffect, Illustration> = {
  rhythm_balls: 'balls', rhythm_rain: 'rain', rhythm_fluid: 'fluid', rhythm_skin: 'dragon',
  spectrum_bars: 'bars', ripple: 'ribbon', pulse_ring: 'ring', volume_rain: 'rain',
  dream_stars: 'stars', vortex: 'orbit', water_ripple: 'water', rhythm_bars: 'bars',
  sound_field: 'field',
  petal_bloom: 'petals', aurora_flow: 'aurora', star_flight: 'flight',
}
const spatialCaptions: Partial<Record<SpectrumEffect,string>> = {
  rhythm_balls:'流光珠群',rhythm_rain:'霓虹雨幕',rhythm_fluid:'液态金属 · 浪脊',rhythm_skin:'日光 · 织物褶皱',
  spectrum_bars:'声谱天际线',ripple:'雪片 · 轻风 · 景深',pulse_ring:'跃迁光廊',volume_rain:'种子 · 风与日光',
  dream_stars:'旋臂星云',vortex:'星际风暴',water_ripple:'月下涟漪',rhythm_bars:'矿物层理 · 声谱',
}
export const effectCatalog = Object.fromEntries(musicEffects.map(effect => [effect.value, { ...visualCatalog[illustrations[effect.value]], label: effect.label, caption: spatialCaptions[effect.value] ?? visualCatalog[illustrations[effect.value]].caption }])) as Record<SpectrumEffect, { label: string; caption: string; color: string }>

/** Static captures of our scene renderer; the remaining ambient scenes use vector artwork. */
export function EffectArtwork({ effect: id }: { effect: SpectrumEffect }) {
  if (isClassicEffect(id)) {
    const thumbnail = sceneThumbnails[`../../assets/scenes/${id}.webp`]
    return thumbnail ? <img className="effect-art" src={thumbnail} alt="" aria-hidden="true" /> : <ClassicArtwork effect={id} />
  }
  const effect = illustrations[id], color = effectCatalog[id].color
  const wave = (offset: number) => `M-8 ${30 + offset} C15 ${4 + offset},25 ${53 + offset},45 ${28 + offset} S75 ${13 + offset},93 ${29 + offset} S120 ${50 + offset},148 ${17 + offset}`
  return <svg className={`effect-art effect-art-${effect}`} viewBox="0 0 140 64" fill="none" style={{ color }} aria-hidden="true">
    <path d="M0 48.5H140M0 32.5H140M0 16.5H140M35 0V64M70 0V64M105 0V64" stroke="currentColor" opacity=".07" />
    {effect === 'bars' && Array.from({ length: 19 }, (_, i) => <rect key={i} x={7 + i * 7} y={50 - (9 + Math.sin(i * .47) ** 2 * 34)} width="3" height={9 + Math.sin(i * .47) ** 2 * 34} rx="1.5" fill="currentColor" opacity={.4 + i / 32} />)}
    {effect === 'ribbon' && [0, 5, 12].map((offset, i) => <path key={i} d={wave(offset)} stroke="currentColor" strokeWidth={1.8 - i * .3} opacity={1 - i * .25} />)}
    {(effect === 'stars' || effect === 'night') && <>{Array.from({ length: 42 }, (_, i) => <circle key={i} cx={(i * 37.1 + 7) % 140} cy={8 + (i * 11.3 % 48)} r={i % 7 === 0 ? 1.8 : .8} fill="currentColor" opacity={.25 + (i % 5) * .15} />)}{effect === 'night' && <path d="M84 12l22 16m-21-16 17 12" stroke="currentColor" strokeWidth="1.5" />}</>}
    {effect === 'ring' && [0, 1, 2].map(i => <ellipse key={i} cx="70" cy="32" rx={16 + i * 9} ry={16 + i * 9} stroke="currentColor" strokeWidth={i === 0 ? 2 : 1} opacity={1 - i * .28} />)}
    {effect === 'orbit' && [-18, 9, 30].map((angle, i) => <ellipse key={i} cx="70" cy="32" rx="53" ry={12 + i * 2} transform={`rotate(${angle} 70 32)`} stroke="currentColor" strokeWidth="1.1" opacity={.9 - i * .12} />)}
    {effect === 'rain' && <>{Array.from({ length: 16 }, (_, i) => <path key={i} d={`M${8 + i * 8} ${i * 13 % 35}l-2 ${10 + i % 5 * 3}`} stroke="currentColor" strokeWidth={i % 3 ? .9 : 1.5} opacity={.35 + i % 4 * .15} />)}<ellipse cx="42" cy="56" rx="17" ry="3" stroke="currentColor" opacity=".5" /><ellipse cx="106" cy="51" rx="10" ry="2" stroke="currentColor" opacity=".35" /></>}
    {effect === 'flock' && Array.from({ length: 12 }, (_, i) => <g key={i} transform={`translate(${10 + (i * 29.3) % 125} ${13 + (i * 17.7) % 41}) rotate(${i * 13})`} opacity={.35 + i % 4 * .17}><path d="M0 2C-12-14-17 8 0 3C17-5 9-15 0 2ZM0 2C-7 1-9 12 0 4C9 14 10 1 0 2Z" fill="currentColor" transform="scale(.5)" /></g>)}
    {effect === 'bloom' && Array.from({ length: 12 }, (_, i) => <path key={i} d="M70 32C77 22 97 36 102 18" transform={`rotate(${i * 30} 70 32)`} stroke="currentColor" strokeWidth="1.2" opacity={.45 + i % 3 * .2} />)}
    {effect === 'valley' && <><path d="M-8 40C28 6 47 58 76 31S121 27 150 9M-10 52C25 20 53 59 86 39S120 34 150 25" stroke="currentColor" strokeWidth="7" opacity=".11" />{Array.from({ length: 19 }, (_, i) => <circle key={i} cx={(i * 37.1 + 9) % 140} cy={12 + (i * 13.3 % 42)} r={i % 4 === 0 ? 1.8 : .8} fill="currentColor" opacity={.4 + i % 3 * .18} />)}</>}
    {effect === 'balls' && [0,1,2,3,4].map(i => <g key={i}><path d={`M${14 + i * 27} ${19 + i % 3 * 11}l-8 10`} stroke="currentColor" strokeWidth="7" opacity=".13" /><circle cx={17 + i * 26} cy={15 + i % 3 * 12} r={5 + i % 3 * 1.5} fill={['#f3bd72','#c7d99a','#8bd5c9','#91b9e6','#edaaa3'][i]} /></g>)}
    {effect === 'fluid' && [0,1,2,3].map(i => <path key={i} d={`M${20 + i * 24} 55C${-3 + i * 24} 20,${57 + i * 22} 42,${36 + i * 22} 5`} stroke={['#89b8ec','#bd98dd','#e0a0b3','#8fd0cf'][i]} strokeWidth={9 - i} opacity={.35 + i * .1} strokeLinecap="round" />)}
    {effect === 'dragon' && [0,1,2].map(i => <path key={i} d={wave(i * 7 - 5)} stroke={['#84d3b1','#edc477','#88bde7'][i]} strokeWidth={5 - i} opacity={.8 - i * .14} strokeLinecap="round" />)}
    {effect === 'water' && [0,1,2,3].map(i => <ellipse key={i} cx={i < 2 ? 45 : 98} cy={i < 2 ? 29 : 44} rx={i % 2 ? 28 : 15} ry={i % 2 ? 10 : 5} stroke="currentColor" strokeWidth="1.2" opacity={i % 2 ? .35 : .85} />)}
    {effect === 'field' && Array.from({ length: 72 }, (_, i) => {
      const x = i % 12, z = Math.floor(i / 12), h = 3 + Math.sin(Math.hypot(x - 4, z - 2) * 1.7) ** 4 * 16
      return <path key={i} d={`M${12 + x * 9 + z * 3} ${37 + z * 4 - x * 1.2}v${-h}h4v${h}`} stroke="currentColor" strokeWidth="2" opacity={.25 + h / 30} />
    })}
    {effect === 'petals' && Array.from({ length: 16 }, (_, i) => <path key={i} d="M70 39C45 25 62 0 70 7C87 16 95 33 70 39Z" transform={`rotate(${i * 22.5} 70 34)`} fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeWidth=".7" opacity={.3 + i % 4 * .16} />)}
    {effect === 'aurora' && [0,1,2,3,4].map(i => <path key={i} d={wave(i * 5 - 10)} stroke={i < 3 ? 'currentColor' : '#a7b0ed'} strokeWidth={5 - i * .6} strokeLinecap="round" opacity={.5 - i * .06} />)}
    {effect === 'flight' && <>{[0,1,2].map(i => <ellipse key={i} cx="70" cy="32" rx={10 + i * 19} ry={5 + i * 10} stroke="currentColor" opacity={.3 + i * .15} />)}{Array.from({ length: 24 }, (_, i) => { const a = i * 2.4, r = 22 + i % 5 * 8; return <path key={i} d={`M${70 + Math.cos(a) * r} ${32 + Math.sin(a) * r * .48}l${Math.cos(a) * 8} ${Math.sin(a) * 4}`} stroke="currentColor" opacity={.3 + i % 4 * .16} /> })}</>}
  </svg>
}
