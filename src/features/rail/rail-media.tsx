import { useEffect, useState } from "react";
import { AppWindow, File, Folder, Image, StickyNote } from "lucide-react";
import { railMedia } from "./client";
import type { RailItem } from "./model";
const icons = { app: AppWindow, file: File, folder: Folder, image: Image, note: StickyNote };
export function RailMedia({ item }: { item: RailItem }) {
  const [media, setMedia] = useState<string | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setMedia(null);
    setFailed(false);
    void railMedia(item)
      .then((value) => {
        if (active) setMedia(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [item.id, item.path]);
  const Icon = icons[item.kind];
  return media && !failed ? (
    <img
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
