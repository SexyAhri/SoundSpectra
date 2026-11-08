import { createContext, useContext } from "react";
import { useFrame } from "@react-three/fiber";
import type { Vector2, WebGLRenderTarget } from "three";
import type { SpectrumSettings } from "../../model";
import type { SceneMotion } from "../motion";
import type { SceneBloom } from "../classic/scene-bloom";
import type { SceneFocus } from '../../scene-focus';
import type { CompositionId } from '../compositions/presets';
import type { TransitionFrame } from '../../../performance/transition';
import type { MappingValues } from '../../../performance/mapping';

/** Mutable frame state: audio and animation never cause React reconciliation. */
export interface VisualRuntime {
  transition?: TransitionFrame;
  mapping?: MappingValues;
  composition?: CompositionId;
  settings: SpectrumSettings;
  motion: SceneMotion;
  reduced: boolean;
  presentationPaused?: boolean;
  renderScale?: number;
  dt: number;
  regions: number;
  pointer: Vector2;
  diagnostics: VisualDiagnostics;
  focus?: SceneFocus;
}
export interface VisualDiagnostics {
  capture?: () => void;
  preparations?: Set<() => Promise<unknown>>;
  image?: WebGLRenderTarget;
  heightTarget?: WebGLRenderTarget;
  grid?: number;
  seeds?: Float32Array;
  bloom?: SceneBloom;
}
export const VisualContext = createContext<VisualRuntime | null>(null);
export function useVisualRuntime() {
  const runtime = useContext(VisualContext);
  if (!runtime) throw new Error("Visual layers must be inside VisualScene");
  return runtime;
}
/** Negative priorities prepare geometry before the shared postprocessing pass. */
export function useVisualFrame(
  update: (runtime: VisualRuntime) => void,
  priority = 0,
) {
  const runtime = useVisualRuntime();
  useFrame(() => update(runtime), priority);
}
