import { defaults, type SpectrumSettings } from '../spectrum/model'
import { resolveEffectPalette } from '../spectrum/effect-palette'
export interface LyricPalette { sung:string;unsung:string;accent:string;glow:string;shadow:string }
const mix=(a:string,b:string,t:number)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('')
export function lyricPalette(settings:Pick<SpectrumSettings,'effect'|'music'|'color'>=defaults):LyricPalette{
 const p=resolveEffectPalette(settings)
 return {sung:mix(p.main,'#b7c3b4',.32),unsung:mix(p.main,'#667c83',.55),accent:mix(p.accent,p.main,.45),glow:mix(p.main,'#7b9295',.4),shadow:mix(p.low,'#020508',.55)}
}
export const defaultLyricPalette=lyricPalette()
