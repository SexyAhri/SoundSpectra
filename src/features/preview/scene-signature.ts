import type { SceneLayout } from "./scene-library";

// Key order can change when a saved scene passes through normalization/import.
export function sceneSignature(scene: SceneLayout): string {
  return JSON.stringify(scene, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
        )
      : value,
  );
}
