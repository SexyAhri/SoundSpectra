import { SettingToggle } from '@/components/ui/setting-toggle'
import { Button } from '@/components/ui/button'
import { Parameter } from '@/components/ui/parameter'
import { defaultDesktopCard, type SpectrumSettings } from '../spectrum/model'
import { MusicCard } from './music-card'
import { emptyNowPlaying } from './use-now-playing'
import { useRef } from 'react'

export function CardControls({ settings, update, disabled }: { settings: SpectrumSettings; update: (patch: Partial<SpectrumSettings>) => void; disabled: boolean }) {
  const bands = useRef(new Float32Array(96)), received = useRef(0)
  const card = settings.desktopCard
  const bounds = (key: 'x' | 'y' | 'width', value: number) => {
    const b = { ...card.bounds, [key]: value / 100 }
    if (key === 'width') b.height = Math.max(.08, Math.min(.24, card.bounds.height * b.width / card.bounds.width))
    b.x = Math.min(b.x, 1 - b.width); b.y = Math.min(b.y, 1 - b.height)
    update({ desktopCard: { ...card, bounds: b } })
  }
  return <div className="inspector-content card-controls">
    <SettingToggle className="card-enable" label="桌面音乐卡片" description="歌曲信息 · 封面 · 实时律动" accessibleLabel="显示桌面音乐卡片" disabled={disabled} checked={card.enabled} onChange={enabled => update({ desktopCard: { ...card, enabled } })} />
    <div className="card-style-preview"><MusicCard info={emptyNowPlaying} settings={card} color={settings.color} bands={bands} receivedAt={received} demo active={false} /></div>
    <div className="scene-mode-options" role="group" aria-label="音乐卡片样式">{[['record', '唱片'], ['compact', '简约'], ['afternoon', '午后 · 紧凑']].map(([variant, label]) => <Button key={variant} variant="ghost" aria-pressed={card.variant === variant} disabled={disabled} onClick={() => update({ desktopCard: { ...card, variant: variant as typeof card.variant } })}>{label}</Button>)}</div>
    <div className="card-accent-control"><span>卡片点缀色</span><div>{[['琥珀', '#efb273'], ['薄荷', '#8dd8bf'], ['冰蓝', '#91bdeb'], ['蔷薇', '#e8a4bc']].map(([name, value]) => <button key={value} type="button" aria-label={`${name}色卡片`} aria-pressed={settings.color === value} disabled={disabled} onClick={() => update({ color: value })} style={{ background: value }} />)}<input type="color" aria-label="卡片自定义点缀色" disabled={disabled} value={settings.color} onChange={event => update({ color: event.target.value })} /></div></div>
    <div className="section-label card-position-label">放在哪里</div>
    <div className="card-position-options">{[['左下', .035, .81], ['右下', .965 - card.bounds.width, .81], ['左上', .035, .05]].map(([label, x, y]) => <Button key={label} variant="outline" size="sm" disabled={disabled} onClick={() => update({ desktopCard: { ...card, bounds: { ...card.bounds, x: Number(x), y: Math.min(Number(y), 1 - card.bounds.height) } } })}>{label}</Button>)}</div>
    <Parameter label="卡片大小" value={card.bounds.width * 100} min={15} max={45} disabled={disabled} onChange={value => bounds('width', value)} />
    <Parameter label="卡片距左侧" value={card.bounds.x * 100} min={0} max={Math.floor((1 - card.bounds.width) * 100)} disabled={disabled} onChange={value => bounds('x', value)} />
    <Parameter label="卡片距顶部" value={card.bounds.y * 100} min={0} max={Math.floor((1 - card.bounds.height) * 100)} disabled={disabled} onChange={value => bounds('y', value)} />
    <Button variant="ghost" className="reset-button" disabled={disabled} onClick={() => update({ desktopCard: { ...card, bounds: { ...defaultDesktopCard.bounds } } })}>恢复卡片位置</Button>
    <p className="card-provider-note">歌曲信息来自当前播放器的 Windows 媒体会话。未提供信息时显示播放器名称。平时鼠标穿透，位置可在预览「布置」中拖动。</p>
  </div>
}
