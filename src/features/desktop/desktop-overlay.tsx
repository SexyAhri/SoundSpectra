import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Move } from "lucide-react";
import { SpectrumCanvas } from "../spectrum/spectrum-canvas";
import { useSpectrum } from "../spectrum/use-spectrum";
import { defaults } from "../spectrum/model";
import { CardLayer } from '../desktop-card/card-layer';
import { useNowPlaying } from '../desktop-card/use-now-playing';
import { useCoverColors } from '../desktop-card/use-cover-colors';
import { DepthWallpaper } from '../wallpaper-depth/wallpaper-depth-layer';
import { useLyrics } from '../lyrics/use-lyrics';
import { LyricLayer } from '../lyrics/lyric-layer';
import { displayBounds, relativeBounds, sceneRegions, settingsForRegion } from '../spectrum/regions';
import { layerIndex } from '../preview/scene-layers';
import { useRail } from '../rail/use-rail';
import { railObstacles } from '../lyrics/avoid-rail';
import {
  describeError,
  getStatus,
  loadSettings,
  native,
  setEditing,
  subscribeSettings,
} from "../spectrum/bridge";

export function DesktopOverlay() {
  const [settings, setSettings] = useState(defaults);
  const [editing, updateEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rail = useRail();
  const [screen, setScreen] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resize = () => setScreen({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const { bands, receivedAt, analysis } = useSpectrum();
  const nowPlaying = useNowPlaying((settings.desktopCard.enabled || settings.lyrics.enabled || settings.followCover) && settings.enabled, true);
  const colors = useCoverColors(settings, nowPlaying, settings.enabled || editing);
  const lyricDocument = useLyrics(settings.lyrics, nowPlaying, settings.enabled);
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    let revision = 0;
    subscribeSettings(value => {
      if (!disposed) { revision++; setSettings(value); }
    })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((reason) => { if (!disposed) setError(describeError(reason)); })
      .finally(() => {
        if (disposed) return;
        // A recreated desktop window must subscribe before its initial read.
        // Changes received during that read take precedence over the older snapshot.
        const startedAt = revision;
        void loadSettings().then(value => {
          if (!disposed && startedAt === revision) setSettings(value);
        }).catch(reason => {
          if (!disposed && startedAt === revision) setError(describeError(reason));
        });
      });
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const status = await getStatus();
        if (!disposed) updateEditing(status.editing);
      } catch (reason) {
        if (!disposed) setError(describeError(reason));
      }
      if (!disposed) timer = setTimeout(poll, 350);
    };
    void poll();
    return () => {
      disposed = true;
      stop?.();
      clearTimeout(timer);
    };
  }, []);
  const finish = async () => {
    try {
      await setEditing(false);
      updateEditing(false);
      setError(null);
    } catch (reason) {
      setError(describeError(reason));
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editing) void finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);
  const drag = async () => {
    if (!native) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (reason) {
      setError(describeError(reason));
    }
  };
  const resize = async () => {
    if (!native) return;
    try {
      await getCurrentWindow().startResizeDragging("SouthEast");
    } catch (reason) {
      setError(describeError(reason));
    }
  };
  return (
    <div className={`desktop-overlay ${editing ? "editing" : ""}`}>
      {settings.wallpaperDepth.enabled&&(settings.enabled||editing)&&<DepthWallpaper settings={settings.wallpaperDepth} desktop active={settings.enabled||editing}/>}
      {sceneRegions(settings).filter(region => region.visible).map(region => {
        const bounds = relativeBounds(region.bounds, displayBounds(settings));
        return <div key={region.id} className="desktop-region" data-region-id={region.id} style={{ position: 'absolute', zIndex: layerIndex(settings, `effect:${region.id}`), left: `${bounds.x * 100}%`, top: `${bounds.y * 100}%`, width: `${bounds.width * 100}%`, height: `${bounds.height * 100}%` }}><SpectrumCanvas
        settings={settingsForRegion(colors.settings, region.id)}
        bands={bands}
        receivedAt={receivedAt}
        analysis={analysis}
        demo={false}
        desktop
        active={settings.enabled || editing}
        regionCount={sceneRegions(settings).filter(region => region.visible).length}
      /></div>})}
      {settings.desktopCard.enabled && <CardLayer zIndex={layerIndex(settings, 'card')} settings={settings.desktopCard} info={nowPlaying} color={colors.settings.color} bands={bands} receivedAt={receivedAt} host={displayBounds(settings)} desktop active={settings.enabled} />}
      {settings.lyrics.enabled && <LyricLayer appearance={settings} obstacles={railObstacles(rail.settings, screen)} zIndex={layerIndex(settings, 'lyrics')} settings={settings.lyrics} document={lyricDocument} info={nowPlaying} host={displayBounds(settings)} desktop active={settings.enabled} />}
      {editing && (
        <>
          <div className="overlay-toolbar">
            <button onPointerDown={drag}>
              <Move size={16} />
              拖动位置
            </button>
            <button onClick={finish}>
              <Check size={16} />
              完成 · Esc
            </button>
          </div>
          <button
            aria-label="拖动调整大小"
            className="resize-handle"
            onPointerDown={resize}
          />
        </>
      )}
      {error && editing && (
        <div className="overlay-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
