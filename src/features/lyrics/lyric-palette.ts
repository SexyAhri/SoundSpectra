import { defaults, type SpectrumSettings } from '../spectrum/model'
import { resolveEffectPalette } from '../spectrum/effect-palette'
export interface LyricPalette { sung:string;unsung:string;accent:string;glow:string;shadow:string }
const mix=(a:string,b:string,t:number)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('')
export function lyricPalette(settings:Pick<SpectrumSettings,'effect'|'music'|'color'>=defaults):LyricPalette{
 const p=resolveEffectPalette(settings)
 return {sung:mix(p.high,'#ffffff',.18),unsung:mix(p.high,p.low,.42),accent:mix(p.main,p.high,.55),glow:p.main,shadow:mix(p.low,'#020508',.55)}
}
export const defaultLyricPalette=lyricPalette()
