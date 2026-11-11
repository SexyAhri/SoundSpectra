import { useEffect, useMemo, useState } from "react";
import type { SpectrumSettings } from "../spectrum/model";
import { libraryKey, readLibrary, type SavedScene } from "./scene-library";
import { sceneName } from "./scene-presentation";

const recentKey = "soundspectra.scene-last-used.v1";
function readSources() {
  let items: SavedScene[] = [],
    recentId: string | null = null;
  try {
    items = readLibrary();
  } catch {
    /* The collection dialog owns recovery. */
  }
  try {
    const recent: unknown = JSON.parse(
      localStorage.getItem(recentKey) ?? "null",
    );
    if (
      recent &&
      typeof recent === "object" &&
      "id" in recent &&
      typeof recent.id === "string"
    )
      recentId = recent.id;
  } catch {
    /* Recent use is an optional identity hint. */
  }
  return { items, recentId };
}

export function useSceneName(settings: SpectrumSettings) {
  const [sources, setSources] = useState(readSources);
  useEffect(() => {
    const sync = () => setSources(readSources());
    const storage = (event: StorageEvent) => {
      if (
        event.key === null ||
        event.key === libraryKey ||
        event.key === recentKey
      )
        sync();
    };
    window.addEventListener("scene-library-changed", sync);
    window.addEventListener("scene-last-used-changed", sync);
    window.addEventListener("storage", storage);
    sync();
    return () => {
      window.removeEventListener("scene-library-changed", sync);
      window.removeEventListener("scene-last-used-changed", sync);
      window.removeEventListener("storage", storage);
    };
  }, []);
  return useMemo(
    () => sceneName(settings, sources.items, sources.recentId),
    [settings, sources],
  );
}
