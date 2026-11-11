import type { SceneLayout } from "./scene-library";
import manifest from "../../assets/desktop-scenes/manifest.json";
import { sceneSignature } from "./scene-signature";

export { sceneSignature as sceneThumbnailSignature } from "./scene-signature";

const images = import.meta.glob("../../assets/desktop-scenes/*.webp", {
  eager: true,
  query: "?url&no-inline",
  import: "default",
}) as Record<string, string>;

/** Never show a fixed capture for a scene whose visual parameters have changed. */
export function sceneThumbnailCapture(scene: SceneLayout): string | undefined {
  const signature = sceneSignature(scene);
  const capture = (manifest as { id: string; signature: string }[]).find(
    (entry) => entry.signature === signature,
  );
  return capture
    ? images[`../../assets/desktop-scenes/${capture.id}.webp`]
    : undefined;
}
