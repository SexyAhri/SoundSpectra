import { Button } from '@/components/ui/button'
import { resolveEffectPalette } from '../spectrum/effect-palette'
import type { SpectrumSettings } from '../spectrum/model'

export function CardColorControls({ settings, update, disabled }: { settings: SpectrumSettings; update: (patch: Partial<SpectrumSettings>) => void; disabled: boolean }) {
  const card = settings.desktopCard
  const inheritedColor = resolveEffectPalette(settings).main
  return <>
    <div className="card-color-mode" role="group" aria-label="卡片配色方式">
      <Button variant="ghost" size="sm" aria-pressed={!card.accentColor} disabled={disabled} onClick={() => { const { accentColor: _accent, ...inherited } = card; update({ desktopCard: inherited }) }}>继承场景</Button>
      <Button variant="ghost" size="sm" aria-pressed={!!card.accentColor} disabled={disabled} onClick={() => update({ desktopCard: { ...card, accentColor: card.accentColor || inheritedColor } })}>独立固定色</Button>
    </div>
    <p className="card-color-description">{card.accentColor ? '固定卡片配色，独立于灯效与封面变化。' : '跟随主场景色板；开启封面跟色时，随歌曲封面变化。'}</p>
    <div className="card-accent-control"><span>卡片点缀色</span><div>{[['琥珀', '#efb273'], ['薄荷', '#8dd8bf'], ['冰蓝', '#91bdeb'], ['蔷薇', '#e8a4bc']].map(([name, value]) => <button key={value} type="button" aria-label={`${name}色卡片`} aria-pressed={card.accentColor === value} disabled={disabled} onClick={() => update({ desktopCard: { ...card, accentColor: value } })} style={{ background: value }} />)}<input type="color" aria-label="卡片自定义点缀色" disabled={disabled} value={card.accentColor || inheritedColor} onChange={event => update({ desktopCard: { ...card, accentColor: event.target.value } })} /></div></div>
  </>
}
