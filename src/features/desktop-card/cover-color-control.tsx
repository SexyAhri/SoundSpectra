import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { SettingsUpdate, SpectrumSettings } from '../spectrum/model'

export function CoverColorControl({ settings, display, message, available, disabled, update }: {
  settings: SpectrumSettings; display: SpectrumSettings; message: string; available: boolean; disabled: boolean; update: SettingsUpdate;
}) {
  return <div className="cover-color-control">
    <label>跟随封面配色<Switch aria-label="跟随封面配色" checked={settings.followCover} disabled={disabled}
      onCheckedChange={followCover => update({ followCover })} /></label>
    <span className="cover-color-status" role="status">{message}</span>
    {settings.followCover && <Button variant="ghost" size="sm" disabled={disabled || !available} onClick={() => update(current => ({
      followCover: false, color: display.color,
      regions: current.regions.map(region => ({ ...region, color: display.regions.find(value => value.id === region.id)?.color ?? region.color })),
    }))}>固定当前配色</Button>}
  </div>
}
