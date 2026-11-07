import { Component, type ReactNode } from "react";
import type { SpectrumSettings } from "../../model";
import { isClassicEffect, isAmbientEffect } from "../../music-engine/catalog";
import { VisualContext, type VisualRuntime } from "./runtime";
import { CameraRig } from "./camera-rig";
import { SceneCompositor } from "./compositor";
import { ClassicLayer } from "./classic-layer";
import { AmbientLayers } from "./ambient-layers";
import { TerrainLayer } from "./terrain-layer";
import { visualQuality } from "./quality";
import { CompositionLayout } from './composition-layout';

export class VisualErrorBoundary extends Component<
  { onError: (error: unknown) => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
export function VisualScene({
  runtime,
  config,
  regions,
}: {
  runtime: VisualRuntime;
  config: SpectrumSettings;
  regions: number;
}) {
  const { detail, terrainGrid } = visualQuality(
    config.quality,
    regions,
    config.music.ambientDensity,
    config.effect,
  );
  return (
    <VisualContext.Provider value={runtime}>
      <CameraRig />
      <CompositionLayout>
      {isClassicEffect(config.effect) && (
        <ClassicLayer effect={config.effect} detail={detail} />
      )}
      {isAmbientEffect(config.effect) && (
        <AmbientLayers effect={config.effect} detail={detail} />
      )}
      {config.effect === "sound_field" && <TerrainLayer grid={terrainGrid} />}
      </CompositionLayout>
      <SceneCompositor />
    </VisualContext.Provider>
  );
}
