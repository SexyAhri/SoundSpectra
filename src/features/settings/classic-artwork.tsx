import type { ClassicEffect } from '../spectrum/music-engine/catalog'

/** Lightweight silhouettes of the spatial scenes; the inspector owns no WebGL contexts. */
export function ClassicArtwork({ effect }: { effect: ClassicEffect }) {
  const warm = '#9d8ade', cool = '#64cfe4'
  const spectrum = effect === 'spectrum_bars' || effect === 'rhythm_bars'
  const rain = effect === 'rhythm_rain' || effect === 'volume_rain'
  return <svg className="effect-art" viewBox="0 0 140 64" fill="none" aria-hidden="true">
    {(spectrum || rain || effect === 'rhythm_balls') && <ellipse cx="70" cy="51" rx="56" ry="9" stroke={cool} opacity=".2" />}
    {spectrum && Array.from({ length: effect === 'rhythm_bars' ? 25 : 36 }, (_, i) => {
      const ring = effect === 'rhythm_bars', a = i / 25 * Math.PI * 2
      const x = ring ? 70 + Math.cos(a) * 43 : 17 + i % 12 * 8 + Math.floor(i / 12) * 5
      const y = ring ? 42 + Math.sin(a) * 12 : 51 - Math.floor(i / 12) * 7
      const h = 6 + Math.sin(i * .65) ** 2 * 23
      return <g key={i} opacity={.5 + h / 60}><path d={`M${x} ${y}v${-h}l4 -2v${h}Z`} fill={cool} fillOpacity=".08" stroke={cool} strokeWidth=".6" /><path d={`M${x} ${y-h}l4 -2`} stroke={warm} strokeWidth="1.5" /></g>
    })}
    {effect === 'rhythm_balls' && [0,1,2].map(i => <g key={i} transform={`translate(${33+i*38} ${i===1?25:35})`}>
      <circle r={i===1?13:8} fill={cool} fillOpacity=".1" stroke={cool} strokeWidth=".8" />
      <ellipse rx={i===1?19:12} ry="4" transform={`rotate(${i*55-40})`} stroke={i===1?cool:warm} />
      <circle r="2" fill={cool} />
    </g>)}
    {rain && Array.from({ length: 22 }, (_, i) => {
      const x = 15 + (i * 37) % 112, y = 8 + i * 13 % 41
      return <path key={i} d={`M${x} ${y}l${effect==='volume_rain'?3:-2} ${5+i%3*3}`} stroke={i%3?cool:warm} strokeWidth={i%4?1:1.7} opacity={.25+i%4*.2} />
    })}
    {effect === 'rhythm_fluid' && Array.from({ length: 9 }, (_, i) => <path key={i} d={`M8 ${20+i}C40 ${i*2},60 ${61-i*2},88 ${35-i*.6}S119 ${17+i},134 ${25+i*.6}`} stroke={i%3?cool:warm} strokeWidth=".7" opacity={.3+i*.07} />)}
    {effect === 'rhythm_skin' && <><path d="M8 40C30 5 41 57 72 27S111 5 131 30" stroke={cool} strokeWidth="5" opacity=".15" /><path d="M8 40C30 5 41 57 72 27S111 5 131 30" stroke={cool} strokeWidth="1.4" />{Array.from({length:18},(_,i)=><path key={i} d={`M${12+i*6.6} ${33+Math.sin(i*.48)*12}l4 -5`} stroke={warm} opacity=".65" />)}</>}
    {(effect === 'pulse_ring' || effect === 'ripple') && [0,1,2,3].map(i => <ellipse key={i} cx={70+i*2} cy="32" rx={13+i*8} ry={20+i*3} transform={`rotate(${effect==='ripple'?i*16-24:-22} 70 32)`} stroke={i%2?warm:cool} strokeWidth={i===1?2:1} strokeDasharray={effect==='pulse_ring'&&i===1?'6 3':undefined} opacity={1-i*.16} />)}
    {effect === 'dream_stars' && <><circle cx="70" cy="32" r="12" fill={cool} fillOpacity=".12" stroke={cool} /><ellipse cx="70" cy="32" rx="44" ry="11" transform="rotate(-24 70 32)" stroke={warm} />{Array.from({length:20},(_,i)=><circle key={i} cx={10+i*31%120} cy={7+i*17%50} r={i%4? .7:1.4} fill={cool} opacity={.3+i%3*.3} />)}</>}
    {effect === 'vortex' && [0,1,2,3,4].map(i=><ellipse key={i} cx={70-i*2} cy={14+i*8} rx={48-i*8} ry={6-i*.5} stroke={i%2?warm:cool} strokeWidth="1.2" opacity={.5+i*.1} />)}
    {effect === 'water_ripple' && <>{[0,1,2,3].map(i=><ellipse key={i} cx={i<2?48:98} cy={i<2?35:46} rx={i%2?26:14} ry={i%2?8:4} stroke={cool} opacity={i%2?.3:.85} />)}<path d="M48 17v15m50-9v19" stroke={warm} strokeDasharray="2 3" /></>}
  </svg>
}
