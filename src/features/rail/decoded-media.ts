import { railMedia } from "./client";
import type { RailItem } from "./model";

// A surface and its picker can ask for the same asset in one update. Share the
// native read and decode while pending; do not retain stale file contents.
const pending = new Map<string, Promise<string | null>>();

export function decodedRailMedia(item: RailItem, revision: number) {
  const key = JSON.stringify([item.id, item.path, item.kind, revision]);
  const existing = pending.get(key);
  if (existing) return existing;
  const load = (async () => {
    const value = await railMedia(item);
    if (value) {
      const image = new window.Image();
      image.src = value;
      await image.decode();
    }
    return value;
  })().finally(() => {
    if (pending.get(key) === load) pending.delete(key);
  });
  pending.set(key, load);
  return load;
}
