import { StylePicker } from '@/components/ui/style-picker'
import { RailCord } from './rail-cord'
import { RailWoodPin } from './rail-wood-pin'
import { useId } from 'react'
import { railWheel } from './rail-wheel'
import { railSkin, type RailSkin } from './model'
import { getRailSkinTheme, railSkinCatalog, railSkinStyle } from './skin-theme'
import './rail-skins.css'

export function RailSkinPreview({ skin }: { skin: RailSkin }) {
  const material = useId()
  const theme = getRailSkinTheme(skin)
  const geometry = railWheel(300, 50, 1, 3, theme.physics.gravitySagFactor), xs = [60, 150, 240]
  return <div className="rail-skin-preview" data-rail-skin={skin} style={railSkinStyle(theme)} aria-hidden="true">
    <svg className="rail-cord" viewBox="0 0 300 160" preserveAspectRatio="xMidYMid meet">
      <defs><linearGradient id={material} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff8e3"/><stop offset=".7" stopColor="var(--rail-keepsake-paper, #f1e4c5)"/><stop offset="1" stopColor="#d1bc91"/></linearGradient></defs>
      <g transform="translate(0 18)">
        <RailCord skin={skin} unit={1} geometry={geometry} attachments={xs} />
        {xs.map((x, index) => {
          const { y } = geometry.atX(x)
          return <g key={x} transform={`translate(${x} ${y}) rotate(${index === 0 ? -4 : index === 2 ? 4 : 0})`}>
            <path className="rail-skin-tether" d="M-1 4V22Q0 26 1 22V4" />
            {index === 0 ? <path className="rail-skin-card" style={{fill:`url(#${material})`}} d="M-16 19H16L22 26V97H-22V26Z" /> :
              <rect className="rail-skin-card" style={{fill: index === 1 ? `url(#${material})` : '#d9bd90'}} x={index === 1 ? -31 : -25} y="20" width={index === 1 ? 62 : 50} height={index === 1 ? 56 : 66} rx="2" />}
            <g className="rail-skin-pin-wrap" transform="translate(-3 -7) scale(.5 .56)"><RailWoodPin /></g>
            {index === 1 ? <g>
              <rect className="rail-skin-photo" x="-26" y="25" width="52" height="36" rx="1" />
              <circle className="rail-skin-photo-sun" cx="13" cy="35" r="6" />
              <path className="rail-skin-photo-hill" d="M-26 55Q-12 37 0 52T26 44V61H-26Z" />
            </g> : <g>
              <path className="rail-skin-pressed-flower" d="M12 76Q4 53 12 29M9 51Q-5 34-7 44Q-3 54 9 51ZM9 56Q25 39 23 50Q20 59 9 56ZM11 66Q-4 52-4 60Q0 68 11 66Z" />
              <rect className="rail-skin-icon" x="-12" y="39" width="21" height="20" rx="3" />
            </g>}
            <rect className="rail-skin-line" x="-15" y={index === 1 ? 66 : 76} width="30" height="2" rx="1" />
          </g>
        })}
      </g>
    </svg>
  </div>
}

export function RailSkinPicker({ value, disabled, onChange }: { value?: RailSkin; disabled?: boolean; onChange: (skin: RailSkin) => void }) {
  return <div className="rail-skin-entry"><StylePicker label="拾光绳皮肤" value={railSkin(value)} disabled={disabled}
    onChange={skin => onChange(railSkin(skin))} options={railSkinCatalog.map(theme => ({ value: theme.id, label: theme.name, detail: theme.detail, preview: <RailSkinPreview skin={theme.id} /> }))} />
  </div>
}
