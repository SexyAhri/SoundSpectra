import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Layers,
  LockKeyhole,
  LockKeyholeOpen,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import type { SettingsUpdate, SpectrumSettings } from "../spectrum/model";
import { sceneRegions } from "../spectrum/regions";
import type { RailController } from "../rail/use-rail";
import { moveLayer, sceneLayers } from "./scene-layers";

export function PreviewObjectList({
  settings,
  update,
  rail,
  selected,
  locks,
  onToggleLock,
  onSelect,
  disabled,
}: {
  settings: SpectrumSettings;
  update: SettingsUpdate;
  rail?: RailController;
  selected: string;
  locks: string[];
  onToggleLock: (key: string) => void;
  onSelect: (key: string) => void;
  disabled: boolean;
}) {
  const regions = sceneRegions(settings);
  const objects = [...sceneLayers(settings)].reverse().map((key) => {
    const region = regions.find((value) => key === `effect:${value.id}`);
    return {
      key,
      name: region?.name ?? (key === "lyrics" ? "歌词" : "音乐卡片"),
      visible: region
        ? region.visible
        : key === "lyrics"
          ? settings.lyrics.enabled
          : settings.desktopCard.enabled,
    };
  });
  const toggle = (key: string) =>
    update((current) =>
      key === "lyrics"
        ? { lyrics: { ...current.lyrics, enabled: !current.lyrics.enabled } }
        : key === "card"
          ? {
              desktopCard: {
                ...current.desktopCard,
                enabled: !current.desktopCard.enabled,
              },
            }
          : key === "effect:primary"
            ? { regionVisible: !current.regionVisible }
            : {
                regions: current.regions.map((region) =>
                  region.id === key.slice(7)
                    ? { ...region, visible: !region.visible }
                    : region,
                ),
              },
    );
  return (
    <details className="preview-object-list">
      <summary>
        <Layers size={14} />
        对象与图层
        <span>{objects.length + (rail?.settings.groups.length ?? 0)}</span>
      </summary>
      <div
        className="preview-object-popover"
        role="group"
        aria-label="桌面对象列表"
      >
        <p>从上到下排列图层。锁定可保护预览位置，属性仍可手动调整。</p>
        {objects.map((object, index) => (
          <div
            key={object.key}
            className="preview-object-row"
            data-selected={selected === object.key || undefined}
          >
            <button
              className="preview-object-select"
              disabled={disabled}
              aria-label={`选择${object.name}`}
              aria-pressed={selected === object.key}
              onClick={() => onSelect(object.key)}
            >
              {object.name}
            </button>
            <IconButton
              aria-label={`${locks.includes(object.key) ? "解锁" : "锁定"}${object.name}位置`}
              aria-pressed={locks.includes(object.key)}
              disabled={disabled}
              onClick={() => onToggleLock(object.key)}
            >
              {locks.includes(object.key) ? (
                <LockKeyhole size={14} />
              ) : (
                <LockKeyholeOpen size={14} />
              )}
            </IconButton>
            <IconButton
              aria-label={`${object.visible ? "隐藏" : "显示"}${object.name}`}
              disabled={disabled}
              onClick={() => toggle(object.key)}
            >
              {object.visible ? <Eye size={14} /> : <EyeOff size={14} />}
            </IconButton>
            <IconButton
              aria-label={`上移${object.name}图层`}
              disabled={disabled || locks.includes(object.key) || index === 0}
              onClick={() =>
                update((current) => moveLayer(current, object.key, "up"))
              }
            >
              <ArrowUp size={14} />
            </IconButton>
            <IconButton
              aria-label={`下移${object.name}图层`}
              disabled={
                disabled ||
                locks.includes(object.key) ||
                index === objects.length - 1
              }
              onClick={() =>
                update((current) => moveLayer(current, object.key, "down"))
              }
            >
              <ArrowDown size={14} />
            </IconButton>
          </div>
        ))}
        {rail?.settings.groups.map((group) => (
          <div
            className="preview-object-row"
            key={group.id}
            data-selected={selected === `rail:${group.id}` || undefined}
          >
            <button
              className="preview-object-select"
              disabled={disabled}
              aria-label={`选择${group.name}`}
              aria-pressed={selected === `rail:${group.id}`}
              onClick={() => onSelect(`rail:${group.id}`)}
            >
              {group.name}
            </button>
            <IconButton
              aria-label={`${locks.includes(`rail:${group.id}`) ? "解锁" : "锁定"}${group.name}位置`}
              aria-pressed={locks.includes(`rail:${group.id}`)}
              disabled={disabled}
              onClick={() => onToggleLock(`rail:${group.id}`)}
            >
              {locks.includes(`rail:${group.id}`) ? (
                <LockKeyhole size={14} />
              ) : (
                <LockKeyholeOpen size={14} />
              )}
            </IconButton>
            <span className="preview-object-meta">
              拾光绳 · {group.items.length} 项
            </span>
          </div>
        ))}
        <div className="preview-object-row">
          <button
            className="preview-object-select"
            aria-label="选择壁纸"
            aria-pressed={selected === "wallpaper"}
            onClick={() => onSelect("wallpaper")}
          >
            壁纸与氛围
          </button>
          <span className="preview-object-meta">固定背景</span>
        </div>
        <p>拾光绳独立显示，其布局在拾光绳属性中调整。</p>
      </div>
    </details>
  );
}
