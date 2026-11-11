import { createContext, useContext, useEffect, useState } from "react";
import { AppWindow, File, Folder, Image, Play, StickyNote } from "lucide-react";
import { decodedRailMedia } from "./decoded-media";
import { native } from "../spectrum/bridge";
import { isRailPhoto, isRailVideo, type RailItem } from "./model";
const icons = {
  app: AppWindow,
  file: File,
  folder: Folder,
  image: Image,
  note: StickyNote,
};
export const RailMediaSources = createContext<Readonly<Record<string, string>> | null>(null);
export function RailMedia({
  item,
  unavailable = false,
  revision = 0,
}: {
  item: RailItem;
  unavailable?: boolean;
  revision?: number;
}) {
  const preview = useContext(RailMediaSources)?.[item.id];
  const [media, setMedia] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    setMedia(null);
    setFailed(false);
    if (preview !== undefined || unavailable || !native || item.kind === "note") return;
    const load = async () => {
      try {
        const value = await decodedRailMedia(item, revision);
        if (!active) return;
        if (value) {
          setMedia(value);
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
  }, [item.id, item.path, item.kind, unavailable, revision, preview]);
  const video = isRailVideo(item);
  const Icon = video ? Play : icons[item.kind];
  const source = preview ?? media;
  return source && !failed ? (
    <img
      key={revision}
      src={source}
      alt={isRailPhoto(item) ? item.name : ""}
      draggable={false}
      style={{ objectFit: video ? "cover" : item.kind === "image" ? item.crop : "contain" }}
      onError={() => setFailed(true)}
    />
  ) : isRailPhoto(item) ? (
    <span className="rail-photo-placeholder" aria-hidden="true">
      <Icon />
      <span>{video ? "视频暂无预览" : "暂无预览"}</span>
    </span>
  ) : (
    <Icon aria-hidden="true" />
  );
}
