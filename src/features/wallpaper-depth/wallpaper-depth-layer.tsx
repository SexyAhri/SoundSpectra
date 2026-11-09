import { lazy, Suspense, type RefObject } from "react";
import type { WallpaperDepthSettings } from "../spectrum/model";
const Surface = lazy(() =>
  import("./depth-wallpaper").then((module) => ({
    default: module.DepthWallpaper,
  })),
);
export function DepthWallpaper(props: {
  settings: WallpaperDepthSettings;
  active?: boolean;
  desktop?: boolean;
  host?: RefObject<HTMLElement | null>;
}) {
  return (
    <Suspense fallback={null}>
      <Surface {...props} />
    </Suspense>
  );
}
