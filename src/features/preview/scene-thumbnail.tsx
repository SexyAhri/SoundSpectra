import type { CSSProperties } from "react";
import type { SceneLayout } from "./scene-library";
import { EffectArtwork } from "../settings/effect-artwork";
import { sceneRegions } from "../spectrum/regions";
import { defaults, type SceneBounds } from "../spectrum/model";

const position = (bounds: SceneBounds): CSSProperties => ({
  left: `${bounds.x * 100}%`,
  top: `${bounds.y * 100}%`,
  width: `${bounds.width * 100}%`,
  height: `${bounds.height * 100}%`,
});

/** A lightweight composition map; live rendering stays in the large preview. */
export function SceneThumbnail({ scene }: { scene: SceneLayout }) {
  const settings = { ...defaults, ...scene };
  return (
    <span
      className="scene-thumbnail"
      aria-hidden="true"
      style={{ "--scene-tint": scene.color } as CSSProperties}
    >
      {sceneRegions(settings)
        .filter((region) => region.visible)
        .map((region) => (
          <span
            key={region.id}
            className="scene-thumbnail-effect"
            style={{
              ...position(region.bounds),
              opacity: region.opacity / 100,
            }}
          >
            <EffectArtwork effect={region.effect} />
          </span>
        ))}
      {scene.desktop?.lyrics.enabled && (
        <span
          className="scene-thumbnail-lyrics"
          style={position(scene.desktop.lyrics.bounds)}
        >
          <i />
          <i />
          <i />
        </span>
      )}
      {scene.desktop?.card.enabled && (
        <span
          className={`scene-thumbnail-card scene-thumbnail-card-${scene.desktop.card.variant}`}
          style={position(scene.desktop.card.bounds)}
        >
          <i />
          <span>
            <b />
            <b />
          </span>
        </span>
      )}
    </span>
  );
}
