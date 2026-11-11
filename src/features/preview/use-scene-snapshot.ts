import { useEffect, useState } from "react";
import { readSceneSnapshot } from "./scene-snapshot-store";

export function useSceneSnapshot(
  id: string | undefined,
  signature: string,
  updated: number | undefined,
) {
  const key = JSON.stringify([id, signature, updated]);
  const [snapshot, setSnapshot] = useState<{ key: string; src?: string }>();
  useEffect(() => {
    if (!id || updated === undefined) return;
    let cancelled = false;
    let revision = 0;
    const read = async () => {
      const current = ++revision;
      let src: string | undefined;
      try {
        src = await readSceneSnapshot(id, signature, updated);
      } catch {
        /* Missing/unavailable snapshots retain the layout fallback. */
      }
      if (!cancelled && revision === current) setSnapshot({ key, src });
    };
    const changed = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) void read();
    };
    window.addEventListener("scene-snapshots-changed", changed);
    void read();
    return () => {
      cancelled = true;
      window.removeEventListener("scene-snapshots-changed", changed);
    };
  }, [id, signature, updated, key]);
  return snapshot?.key === key ? snapshot.src : undefined;
}
