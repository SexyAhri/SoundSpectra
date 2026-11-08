import { RailFloralCord } from './rail-floral-cord'
import { RailBotanicalCord } from './rail-botanical-cord'
import type { railWheel } from './rail-wheel'
import type { RailSkin } from './model'
import { getRailSkinTheme } from './skin-theme'

export function RailCord(props: { skin: RailSkin; unit: number; geometry: ReturnType<typeof railWheel>; attachments: number[] }) {
  const theme = getRailSkinTheme(props.skin)
  if (theme.ropeStyle.type === 'braided_vine') return <RailFloralCord {...props} theme={theme} />
  if (theme.ropeStyle.type === 'branch') return <RailBotanicalCord {...props} />
  return <g aria-hidden="true">
    <path className="rail-themed-shadow" data-rail-rope-path={props.geometry.path} d={props.geometry.path} transform={`translate(0 ${props.unit})`} />
    <path className="rail-themed-thread" data-rail-rope-path={props.geometry.path} d={props.geometry.path} />
    <path className="rail-thread-fiber" data-rail-rope-path={props.geometry.path} d={props.geometry.path} />
  </g>
}
