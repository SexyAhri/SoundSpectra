import { useState, type CSSProperties } from "react";
import type { SceneLayout } from "./scene-library";
import { EffectArtwork } from "../settings/effect-artwork";
import { sceneRegions } from "../spectrum/regions";
import { defaults, type SceneBounds } from "../spectrum/model";
import { sceneThumbnailCapture } from "./scene-thumbnail-captures";
import { sceneSignature } from "./scene-signature";
import { useSceneSnapshot } from "./use-scene-snapshot";
import "./scene-thumbnail.css";

const position = (bounds: SceneBounds): CSSProperties => ({
  left: `${bounds.x * 100}%`,
  top: `${bounds.y * 100}%`,
  width: `${bounds.width * 100}%`,
  height: `${bounds.height * 100}%`,
});

/** Saved snapshots are tied to the exact saved revision; older scenes retain a layout map. */
export function SceneThumbnail({ scene, savedId, updated }: { scene: SceneLayout; savedId?: string; updated?: number }) {
  const settings = { ...defaults, ...scene };
  const snapshot = useSceneSnapshot(savedId, sceneSignature(scene), updated);
  const capture = snapshot ?? sceneThumbnailCapture(scene);
  const [failed, setFailed] = useState<string>();
  if (capture && capture !== failed) return (
    <span className="scene-thumbnail" data-thumbnail={snapshot ? "snapshot" : "capture"} aria-hidden="true">
      <img className="scene-thumbnail-capture" src={capture} alt="" decoding="async"
        onError={() => setFailed(capture)} />
    </span>
  );
  return (
    <span
      className="scene-thumbnail"
      data-thumbnail="layout"
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
      <span className="scene-thumbnail-caption">布局示意</span>
    </span>
  );
}
