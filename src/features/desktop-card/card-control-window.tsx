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
  const lastRegions = useRef("");
  const regionsEnabled = !!settings?.enabled && !!settings.desktopCard.enabled;
  const variant = settings?.desktopCard.variant;
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
    let frame = 0;
    const update = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (disposed) return;
        const regions =
          regionsEnabled
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
        const signature = JSON.stringify(regions);
        if (signature === lastRegions.current) return;
        lastRegions.current = signature;
        void invoke("card_hit_regions", { regions }).catch((error) => {
          if (lastRegions.current === signature) lastRegions.current = "";
          console.error(error);
        });
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(root.current);
    // The native window keeps the same size when font metrics or text layout
    // move the buttons. Observe the content that owns their placement too.
    root.current.querySelectorAll(".mc-copy, .mc-title, .mc-artist, .mc-footer, .mc-control").forEach(node => observer.observe(node));
    const messages = new MutationObserver(update);
    messages.observe(root.current, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    document.fonts.addEventListener("loadingdone", update);
    void document.fonts.ready.then(() => { if (!disposed) update(); });
    update();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      messages.disconnect();
      document.fonts.removeEventListener("loadingdone", update);
    };
  }, [settings !== null, regionsEnabled, variant]);
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
