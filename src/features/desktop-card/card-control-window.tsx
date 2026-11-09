import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadSettings, subscribeSettings } from "../spectrum/bridge";
import type { SpectrumSettings } from "../spectrum/model";
import { useNowPlaying } from "./use-now-playing";
import { useCoverColors } from "./use-cover-colors";
import { defaults } from "../spectrum/model";
import { MusicCard } from "./music-card";

export function CardControlWindow() {
  const [settings, setSettings] = useState<SpectrumSettings | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const bands = useRef(new Float32Array(96));
  const receivedAt = useRef(0);
  const info = useNowPlaying(
    !!settings?.enabled && !!settings.desktopCard.enabled,
    true,
  );
  const colors = useCoverColors(
    settings ?? defaults,
    info,
    !!settings?.enabled,
  );
  useEffect(() => {
    let disposed = false,
      revision = 0;
    let stop: (() => void) | undefined;
    void subscribeSettings((value) => {
      revision++;
      if (!disposed) setSettings(value);
    })
      .then(async (unsubscribe) => {
        if (disposed) {
          unsubscribe();
          return;
        }
        stop = unsubscribe;
        const started = revision;
        const value = await loadSettings();
        if (!disposed && started === revision) setSettings(value);
      })
      .catch(console.error);
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  useLayoutEffect(() => {
    if (!settings || !root.current) return;
    let disposed = false;
    let queued = false;
    const update = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (disposed) return;
        const regions =
          settings.enabled && settings.desktopCard.enabled
            ? Array.from(
                root.current!.querySelectorAll(
                  ".mc-control, .mc-control-feedback:not(:empty)",
                ),
              )
                .map((node) => {
                  const rect = node.getBoundingClientRect();
                  return {
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                  };
                })
                .filter((rect) => rect.width > 0 && rect.height > 0)
            : [];
        void invoke("card_hit_regions", { regions }).catch(console.error);
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(root.current);
    const messages = new MutationObserver(update);
    messages.observe(root.current.querySelector(".mc-control-feedback")!, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    update();
    return () => {
      disposed = true;
      observer.disconnect();
      messages.disconnect();
    };
  }, [settings, info.title, info.artist]);
  if (!settings) return null;
  return (
    <div
      ref={root}
      className="mc-native-controls"
      style={{ position: "fixed", inset: 0 }}
    >
      <MusicCard
        settings={settings.desktopCard}
        info={info}
        color={colors.cardColor}
        bands={bands}
        receivedAt={receivedAt}
        desktop
        active={settings.enabled}
        controlsOnly
      />
    </div>
  );
}
