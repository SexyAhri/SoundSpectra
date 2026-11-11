import { useCallback, useEffect, useRef, useState } from "react";
import { native, describeError } from "../spectrum/bridge";
import {
  decodePreview,
  loadDesktopBackground,
  readReference,
  referenceImage,
  type DesktopBackground,
  type PreviewImage,
} from "./background";

type Mode = "desktop" | "plain" | "custom";
const key = "soundspectra.preview.background";
// Keep the last decoded wallpaper across module navigation. Revalidate its
// revision on return without resetting screen geometry or decoding it again.
let recentDesktop: {
  desktop: DesktopBackground;
  wallpaper: PreviewImage | null;
} | null = null;

function sameDesktop(previous: DesktopBackground | null, next: DesktopBackground) {
  const sameRect = (a: DesktopBackground["screen"], b: DesktopBackground["screen"]) =>
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  return previous !== null &&
    sameRect(previous.screen, next.screen) &&
    sameRect(previous.virtualScreen, next.virtualScreen) &&
    previous.position === next.position && previous.color === next.color &&
    previous.revision === next.revision && previous.issue === next.issue &&
    previous.anchor?.x === next.anchor?.x && previous.anchor?.y === next.anchor?.y;
}

export function useBackground(enabled = true) {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const value = localStorage.getItem(key);
      return value === "plain" || value === "custom" ? value : "desktop";
    } catch {
      return "desktop";
    }
  });
  const [desktop, setDesktop] = useState<DesktopBackground | null>(recentDesktop?.desktop ?? null);
  const [wallpaper, setWallpaper] = useState<PreviewImage | null>(recentDesktop?.wallpaper ?? null);
  const lastWallpaper = useRef(wallpaper);
  const [custom, setCustom] = useState<PreviewImage | null>(null);
  const [loading, setLoading] = useState(native && !recentDesktop);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // Filter before calling a setter: even a no-op setter can schedule a render
  // immediately after the previous published change.
  const published = useRef({ desktop, loading, error });
  const publishLoading = useCallback((value: boolean) => {
    if (published.current.loading === value) return;
    published.current.loading = value;
    setLoading(value);
  }, []);
  const publishError = useCallback((value: string | null) => {
    if (published.current.error === value) return;
    published.current.error = value;
    setError(value);
  }, []);
  const revision = useRef(recentDesktop?.desktop.revision ?? ""),
    sequence = useRef(0),
    lastRead = useRef(0),
    mounted = useRef(false),
    importingRef = useRef(false);
  const reading = useRef(false);
  const modeRevision = useRef(0),
    imageRevision = useRef(0);
  const refresh = useCallback(async (quiet = false) => {
    if (!native || reading.current) return;
    reading.current = true;
    const request = ++sequence.current;
    lastRead.current = Date.now();
    if (!quiet) publishLoading(true);
    try {
      const next = await loadDesktopBackground(revision.current);
      if (!mounted.current || request !== sequence.current) return;
      // Image revisions do not cover monitor geometry or wallpaper placement.
      if (!sameDesktop(published.current.desktop, next)) {
        const snapshot = { ...next, image: null };
        published.current.desktop = snapshot;
        setDesktop(snapshot);
      }
      const changed = next.revision !== revision.current;
      const image =
        changed && next.image ? await decodePreview(next.image) : null;
      if (!mounted.current || request !== sequence.current) return;
      publishError(next.issue);
      if ((next.issue || changed) && image !== lastWallpaper.current) {
        setWallpaper(image);
        lastWallpaper.current = image;
      }
      recentDesktop = next.issue ? null : {
        desktop: published.current.desktop!,
        wallpaper: lastWallpaper.current,
      };
      revision.current = next.issue ? "" : next.revision;
      lastRead.current = Date.now();
    } catch (reason) {
      if (!mounted.current || request !== sequence.current) return;
      publishError(describeError(reason));
      if (lastWallpaper.current !== null) setWallpaper(null);
      lastWallpaper.current = null;
      recentDesktop = null;
      revision.current = "";
    } finally {
      if (mounted.current && request === sequence.current) {
        reading.current = false;
        publishLoading(false);
      }
    }
  }, [publishLoading, publishError]);
  useEffect(() => {
    if (!enabled) {
      publishLoading(false);
      return;
    }
    mounted.current = true;
    let disposed = false;
    const initialImageRevision = imageRevision.current;
    void refresh(Boolean(recentDesktop));
    void referenceImage()
      .then((image) => {
        if (
          !disposed &&
          image &&
          imageRevision.current === initialImageRevision
        )
          setCustom(image);
      })
      .catch((reason) => {
        if (!disposed)
          setFileError(`参考图片读取失败：${describeError(reason)}`);
      });
    const focus = () => {
      if (!document.hidden) void refresh(true);
    };
    // Returning to the window can follow a real wallpaper change immediately
    // after a poll. The periodic throttle must not suppress that explicit read.
    const timer = window.setInterval(() => {
      if (Date.now() - lastRead.current > 1000) focus();
    }, 5000);
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      disposed = true;
      mounted.current = false;
      sequence.current++;
      reading.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh, enabled, publishLoading]);
  const choose = (value: Mode) => {
    modeRevision.current++;
    setMode(value);
    setFileError(null);
    try {
      localStorage.setItem(key, value);
    } catch {
      setFileError("预览背景选择未能保存，下次打开将使用默认背景。");
    }
  };
  const importFile = async (file: File) => {
    if (importingRef.current) return;
    const selectedAtStart = modeRevision.current;
    imageRevision.current++;
    importingRef.current = true;
    setImporting(true);
    setFileError(null);
    try {
      const image = await readReference(file);
      if (!mounted.current) return;
      await referenceImage(image);
      if (!mounted.current) return;
      setCustom(image);
      if (selectedAtStart === modeRevision.current) choose("custom");
    } catch (reason) {
      if (mounted.current) setFileError(describeError(reason));
    } finally {
      importingRef.current = false;
      if (mounted.current) setImporting(false);
    }
  };
  return {
    mode,
    choose,
    desktop,
    systemImage: wallpaper,
    image: mode === "desktop" ? wallpaper : mode === "custom" ? custom : null,
    custom,
    loading,
    importing,
    error,
    fileError,
    refresh,
    importFile,
  };
}
