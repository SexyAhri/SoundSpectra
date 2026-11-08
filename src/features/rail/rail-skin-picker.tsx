import { StylePicker } from '@/components/ui/style-picker'
import { RailCord } from './rail-cord'
import { railWheel } from './rail-wheel'
import { railSkin, type RailSkin } from './model'
import { getRailSkinTheme, railSkinCatalog, railSkinStyle } from './skin-theme'
import './rail-skins.css'

export function RailSkinPreview({ skin }: { skin: RailSkin }) {
  const theme = getRailSkinTheme(skin)
  const geometry = railWheel(300, 50, 1, 3, theme.physics.gravitySagFactor), xs = [60, 150, 240]
  return <div className="rail-skin-preview" data-rail-skin={skin} style={railSkinStyle(theme)} aria-hidden="true">
    <svg className="rail-cord" viewBox="0 0 300 160" preserveAspectRatio="xMidYMid meet">
      <g transform="translate(0 18)">
        <RailCord skin={skin} unit={1} geometry={geometry} attachments={xs} />
        {xs.map((x, index) => {
          const { y } = geometry.atX(x)
          return <g key={x} transform={`translate(${x} ${y}) rotate(${index === 0 ? -4 : index === 2 ? 4 : 0})`}>
            <rect className="rail-skin-card" x="-24" y="3" width="48" height="63" rx="6" />
            <rect className="rail-skin-pin" x="-3" y="-7" width="6" height="19" rx="1" />
            <rect className="rail-skin-icon" x="-10" y="21" width="20" height="17" rx="3" />
            <circle className="rail-skin-icon" cx="-4" cy="27" r="2" />
            <path className="rail-skin-icon" d="M-8 35-2 30 2 33 7 28" />
            <rect className="rail-skin-line" x="-13" y="48" width="26" height="2" rx="1" />
            <rect className="rail-skin-line" x="-8" y="54" width="16" height="2" rx="1" />
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
