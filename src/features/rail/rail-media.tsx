import { useEffect, useState } from "react";
import { AppWindow, File, Folder, Image, StickyNote } from "lucide-react";
import { railMedia } from "./client";
import { native } from "../spectrum/bridge";
import type { RailItem } from "./model";
const icons = {
  app: AppWindow,
  file: File,
  folder: Folder,
  image: Image,
  note: StickyNote,
};
export function RailMedia({
  item,
  unavailable = false,
  revision = 0,
}: {
  item: RailItem;
  unavailable?: boolean;
  revision?: number;
}) {
  const [media, setMedia] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    setMedia(null);
    setFailed(false);
    if (unavailable || !native || item.kind === "note") return;
    const load = async () => {
      try {
        const value = await railMedia(item);
        if (!active) return;
        if (value) {
          // Decode before replacing the fallback. Shell/image startup failures
          // should recover in the workspace preview as well as desktop windows.
          const image = new window.Image();
          image.src = value;
          await image.decode();
          if (active) setMedia(value);
          return;
        }
      } catch {
        // A cold Shell may not have its icon ready on the first request.
      }
      const delay = [250, 1000, 3000][retries++];
      if (active && delay !== undefined)
        timer = setTimeout(() => void load(), delay);
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [item.id, item.path, item.kind, unavailable, revision]);
  const Icon = icons[item.kind];
  return media && !failed ? (
    <img
      key={revision}
      src={media}
      alt={item.kind === "image" ? item.name : ""}
      draggable={false}
      style={{ objectFit: item.kind === "image" ? item.crop : "contain" }}
      onError={() => setFailed(true)}
    />
  ) : (
    <Icon aria-hidden="true" />
  );
}
