import type { NowPlaying } from "./use-now-playing";
import { SettingToggle } from "@/components/ui/setting-toggle";
import { Button } from "@/components/ui/button";
import { Parameter } from "@/components/ui/parameter";
import { defaultDesktopCard, type SpectrumSettings } from "../spectrum/model";
import { CardColorControls } from "./card-color-controls";
import { StylePicker } from "@/components/ui/style-picker";
import { CardStylePreview } from "./card-style-preview";

export function CardControls({
  settings,
  info,
  update,
  disabled,
}: {
  settings: SpectrumSettings;
  info?: NowPlaying;
  update: (patch: Partial<SpectrumSettings>) => void;
  disabled: boolean;
}) {
  const card = settings.desktopCard;
  const previewRatio =
    (card.bounds.width *
      (window.screen.width / Math.max(1, window.screen.height))) /
    card.bounds.height;
  const bounds = (key: "x" | "y" | "width", value: number) => {
    const b = { ...card.bounds, [key]: value / 100 };
    if (key === "width")
      b.height = Math.max(
        0.08,
        Math.min(0.24, (card.bounds.height * b.width) / card.bounds.width),
      );
    b.x = Math.min(b.x, 1 - b.width);
    b.y = Math.min(b.y, 1 - b.height);
    update({ desktopCard: { ...card, bounds: b } });
  };
  return (
    <div className="inspector-content card-controls">
      <SettingToggle
        className="module-enable"
        label="显示音乐卡片"
        accessibleLabel="显示桌面音乐卡片"
        disabled={disabled}
        checked={card.enabled}
        onChange={(enabled) => update({ desktopCard: { ...card, enabled } })}
      />
      <StylePicker
        label="卡片样式"
        renderCandidate={(variant) => (
          <CardStylePreview
            variant={variant as typeof card.variant}
            info={info}
            ratio={previewRatio}
          />
        )}
        value={card.variant}
        disabled={disabled}
        onChange={(variant) =>
          update({
            desktopCard: { ...card, variant: variant as typeof card.variant },
          })
        }
        options={(
          [
            ["record", "唱片"],
            ["compact", "简约"],
            ["afternoon", "午后 · 藏书票"],
            ["floating", "浮签"],
          ] as const
        ).map(([value, label]) => ({
          value,
          label,
          preview: <CardStylePreview variant={value} info={info} />,
        }))}
      />
      <section className="module-section" aria-label="卡片配色">
        <h3>配色</h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() =>
            update({
              desktopCard: {
                ...defaultDesktopCard,
                enabled: card.enabled,
                bounds: card.bounds,
              },
            })
          }
        >
          恢复卡片样式
        </Button>
        <CardColorControls
          settings={settings}
          update={update}
          disabled={disabled}
        />
      </section>
      <section className="module-section" aria-label="卡片布局">
        <h3>位置与大小</h3>
        <div className="card-position-options">
          {[
            ["左下", 0.035, 0.81],
            ["右下", 0.965 - card.bounds.width, 0.81],
            ["左上", 0.035, 0.05],
          ].map(([label, x, y]) => (
            <Button
              key={label}
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                update({
                  desktopCard: {
                    ...card,
                    bounds: {
                      ...card.bounds,
                      x: Number(x),
                      y: Math.min(Number(y), 1 - card.bounds.height),
                    },
                  },
                })
              }
            >
              {label}
            </Button>
          ))}
        </div>
        <Parameter
          label="卡片大小"
          value={card.bounds.width * 100}
          min={15}
          max={45}
          disabled={disabled}
          onChange={(value) => bounds("width", value)}
        />
        <details className="inspector-advanced">
          <summary>精确位置</summary>
          <Parameter
            label="卡片距左侧"
            value={card.bounds.x * 100}
            min={0}
            max={Math.floor((1 - card.bounds.width) * 100)}
            disabled={disabled}
            onChange={(value) => bounds("x", value)}
          />
          <Parameter
            label="卡片距顶部"
            value={card.bounds.y * 100}
            min={0}
            max={Math.floor((1 - card.bounds.height) * 100)}
            disabled={disabled}
            onChange={(value) => bounds("y", value)}
          />
          <Button
            variant="ghost"
            className="reset-button"
            disabled={disabled}
            onClick={() =>
              update({
                desktopCard: {
                  ...card,
                  bounds: { ...defaultDesktopCard.bounds },
                },
              })
            }
          >
            恢复卡片位置
          </Button>
        </details>
      </section>
    </div>
  );
}
