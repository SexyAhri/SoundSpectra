import { CircleHelp, Move, Palette, SlidersHorizontal, Sparkles, Disc3, Type, Image } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SpectrumSettings, SettingsUpdate } from '../spectrum/model'
import { RegionPanel } from './region-panel'
import { EffectPanel } from './effect-panel'
import { AppearancePanel } from './appearance-panel'
import { PositionPanel } from './position-panel'
import { CardControls } from '../desktop-card/card-controls'
import { LyricControls } from '../lyrics/lyric-controls'
import type { LyricDocument } from '../lyrics/model'
import { WallpaperDepthControls } from '../wallpaper-depth/wallpaper-depth-controls'
import type { WorkspacePanel } from './workspace-navigation'

interface Props {
  lyricDocument: LyricDocument;
  sceneSettings: SpectrumSettings; settings: SpectrumSettings; selected: string;
  onSelect: (id: string) => void; disabled: boolean; editing: boolean;
  updateScene: SettingsUpdate;
  update: (patch: Partial<SpectrumSettings>) => void;
  tab: string; onTabChange: (value: string) => void;
  panel: WorkspacePanel;
}

export function SceneInspector({ sceneSettings, settings, lyricDocument, selected, onSelect, disabled, editing, updateScene, update, tab, onTabChange, panel }: Props) {
  const heading = { scene: '区域灯效', lyrics: '歌词动效', card: '音乐卡片', wallpaper: '壁纸与景深' }[panel]
  const Icon = { scene: SlidersHorizontal, lyrics: Type, card: Disc3, wallpaper: Image }[panel]
  return <aside className="inspector" aria-label="频谱设置">
    <div className="inspector-heading">
      <Icon size={16} /><h2>{heading}</h2>
      <Tooltip><TooltipTrigger asChild><button aria-label="设置说明" className="help-button"><CircleHelp size={15} /></button></TooltipTrigger><TooltipContent>{panel === 'scene' ? '只调整当前选中的灯效区域' : '独立的桌面图层，实时生效并自动保存'}</TooltipContent></Tooltip>
    </div>
    {panel === 'scene' ? <><RegionPanel settings={sceneSettings} selected={selected} onSelect={onSelect} disabled={disabled || editing} update={updateScene} />
    <Tabs value={tab} onValueChange={onTabChange} className="inspector-tabs">
      <TabsList className="inspector-tab-list" aria-label="区域设置分类">
        <TabsTrigger value="effect"><Sparkles size={14} />动效</TabsTrigger>
        <TabsTrigger value="appearance"><Palette size={14} />外观</TabsTrigger>
        <TabsTrigger value="position"><Move size={14} />位置</TabsTrigger>
      </TabsList>
      <div className="inspector-scroll" key={tab}>
        <TabsContent value="effect"><EffectPanel settings={settings} update={update} disabled={disabled} positionDisabled={editing} /></TabsContent>
        <TabsContent value="appearance"><AppearancePanel settings={settings} update={update} disabled={disabled} /></TabsContent>
        <TabsContent value="position"><PositionPanel settings={settings} update={update} disabled={disabled || editing} /></TabsContent>
      </div>
    </Tabs></> : <div className="inspector-scroll global-inspector-scroll" key={panel}>
      {panel === 'lyrics' && <LyricControls settings={sceneSettings} document={lyricDocument} update={updateScene} disabled={disabled || editing} />}
      {panel === 'card' && <CardControls settings={sceneSettings} update={updateScene} disabled={disabled || editing} />}
      {panel === 'wallpaper' && <div className="inspector-content"><WallpaperDepthControls settings={sceneSettings.wallpaperDepth} disabled={disabled || editing} onChange={wallpaperDepth => updateScene({ wallpaperDepth })} /></div>}
    </div>}
  </aside>
}
