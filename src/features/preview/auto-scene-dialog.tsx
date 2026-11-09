import { ModalContent } from "@/components/ui/modal";
import { IconButton } from "@/components/ui/icon-button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Check, RefreshCw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { SpectrumSettings } from "../spectrum/model";
import {
  wallpaperPlacement,
  type DesktopBackground,
  type PreviewImage,
  type ScreenRect,
} from "./background";
import { readWallpaperPixels } from "./wallpaper-palette";
import {
  analyzeWallpaper,
  composeSuggestion,
  rememberedChoice,
  type SceneComposition,
  type WallpaperAnalysis,
} from "./scene-suggestions";

interface Props {
  settings: SpectrumSettings;
  image: PreviewImage | null;
  desktop: DesktopBackground | null;
  screen: ScreenRect;
  available: boolean;
  unavailableReason: string;
  demo: boolean;
  disabled: boolean;
  renderPreview: (settings: SpectrumSettings, demo: boolean) => ReactNode;
  onClose: () => void;
  onReturnFocus?: () => void;
  onApply: (
    scene: SceneComposition,
    choice: { key: string; id: string; strength: number },
  ) => Promise<void>;
}
export function AutoSceneDialog(props: Props) {
  const [attempt, retry] = useState(0),
    [simulate, setSimulate] = useState(props.demo);
  const [result, setResult] = useState<{
    key: string;
    analysis?: WallpaperAnalysis;
    error?: string;
  } | null>(null);
  const [selection, select] = useState({
    key: "",
    id: "starlight",
    strength: 45,
  });
  const [applying, setApplying] = useState(false),
    [applyError, setApplyError] = useState<string | null>(null);
  const applyingRef = useRef(false);
  const placement = props.image
    ? wallpaperPlacement(props.image, props.desktop, props.screen)
    : null;
  const key = JSON.stringify([
    props.image?.url,
    placement,
    props.screen,
    props.desktop?.color,
    props.available,
    attempt,
  ]);
  useEffect(() => {
    if (!props.available) return;
    let cancelled = false;
    setApplyError(null);
    void readWallpaperPixels(
      props.image,
      placement,
      props.screen,
      props.desktop?.color ?? "#25232c",
    )
      .then((pixels) => {
        if (cancelled) return;
        const analysis = analyzeWallpaper(
          pixels.data,
          pixels.width,
          pixels.height,
        );
        const saved = rememberedChoice(analysis.key);
        select({
          key: analysis.key,
          id: saved?.id ?? analysis.suggestions[0].id,
          strength: saved?.strength ?? 45,
        });
        setResult({ key, analysis });
      })
      .catch((error) => {
        if (!cancelled)
          setResult({
            key,
            error:
              error instanceof Error ? error.message : "分析失败，请重试。",
          });
      });
    return () => {
      cancelled = true;
    };
    // Key tracks the displayed crop; unchanged native wallpaper polls do no work.
  }, [key]);
  const current = result?.key === key ? result : null;
  const analysis = props.available ? current?.analysis : undefined;
  const suggestion =
    analysis?.suggestions.find((item) => item.id === selection.id) ??
    analysis?.suggestions[0];
  const scene = suggestion
    ? composeSuggestion(suggestion, selection.strength)
    : null;
  const apply = async () => {
    if (
      !scene ||
      !analysis ||
      !suggestion ||
      props.disabled ||
      applyingRef.current
    )
      return;
    applyingRef.current = true;
    setApplying(true);
    setApplyError(null);
    try {
      await props.onApply(scene, {
        key: analysis.key,
        id: suggestion.id,
        strength: selection.strength,
      });
      props.onClose();
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !applyingRef.current) props.onClose();
      }}
    >
      <ModalContent
        className="auto-scene-dialog"
        onCloseAutoFocus={(event) => {
          if (props.onReturnFocus) {
            event.preventDefault();
            props.onReturnFocus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (applyingRef.current) event.preventDefault();
        }}
      >
        <div className="auto-scene-heading">
          <div>
            <Dialog.Title>
              <Sparkles size={17} />
              自动搭配
            </Dialog.Title>
            <Dialog.Description>先看效果，选喜欢的再应用。</Dialog.Description>
          </div>
          <Dialog.Close asChild>
            <IconButton aria-label="关闭自动搭配" disabled={applying}>
              <X size={18} />
            </IconButton>
          </Dialog.Close>
        </div>
        <div className="auto-scene-body">
          <div className="auto-scene-preview">
            {scene ? (
              props.renderPreview({ ...props.settings, ...scene }, simulate)
            ) : (
              <div
                className="auto-scene-empty"
                role={current?.error ? "alert" : "status"}
              >
                {!props.available
                  ? props.unavailableReason
                  : (current?.error ?? "正在分析壁纸配色与构图…")}
                {current?.error && (
                  <Button
                    variant="outline"
                    onClick={() => retry((value) => value + 1)}
                  >
                    <RefreshCw size={14} />
                    重新分析
                  </Button>
                )}
              </div>
            )}
            <label className="auto-scene-demo">
              模拟音频
              <Switch
                aria-label="搭配模拟音频"
                checked={simulate}
                onCheckedChange={setSimulate}
                disabled={applying}
              />
            </label>
          </div>
          <div className="auto-scene-options">
            <div
              className="auto-scene-choices"
              role="group"
              aria-label="自动搭配方案"
            >
              {analysis?.suggestions.map((item) => (
                <button
                  key={item.id}
                  className="auto-scene-choice"
                  disabled={applying || props.disabled}
                  aria-pressed={suggestion?.id === item.id}
                  onClick={() => {
                    select({ ...selection, id: item.id });
                    setApplyError(null);
                  }}
                >
                  <span className="auto-scene-choice-heading">
                    {item.name}
                    {suggestion?.id === item.id && <Check size={14} />}
                  </span>
                  <span>{item.description}</span>
                  <span className="auto-scene-swatches" aria-hidden="true">
                    {item.layers.map((layer, index) => (
                      <i key={index} style={{ background: layer.color }} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
            {scene && (
              <div className="auto-scene-strength">
                <div>
                  <span>氛围强度</span>
                  <output>{selection.strength}%</output>
                </div>
                <Slider
                  aria-label="搭配氛围强度"
                  min={0}
                  max={100}
                  step={1}
                  value={[selection.strength]}
                  disabled={applying || props.disabled}
                  onValueChange={([strength]) =>
                    select({ ...selection, strength })
                  }
                />
                <div className="auto-scene-strength-ends">
                  <span>轻柔</span>
                  <span>浓烈</span>
                </div>
              </div>
            )}
            <p className="preview-message">
              按配色和画面细节安排位置；尚不识别人物或建筑轮廓。
            </p>
          </div>
        </div>
        <div className="auto-scene-footer">
          <div>
            <p>应用后替换当前动效与区域，保留遮罩和整体性能，可撤销。</p>
            {applyError && <p role="alert">{applyError}</p>}
          </div>
          <Button
            onClick={() => void apply()}
            disabled={!scene || applying || props.disabled}
          >
            {applying ? "正在应用…" : "应用搭配"}
          </Button>
        </div>
      </ModalContent>
    </Dialog.Root>
  );
}
