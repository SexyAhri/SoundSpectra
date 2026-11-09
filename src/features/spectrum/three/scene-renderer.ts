import type { WebGLRenderer } from "three";
import type { SpectrumSettings } from "../model";
import type { SceneMotion } from "./motion";
import { FiberSceneRenderer } from "./r3f/fiber-renderer";
import type { SceneFocus } from "../scene-focus";
import type { FrameOptions } from "../../performance/runtime";

export interface ThreeSceneRenderer {
  readonly renderer: WebGLRenderer;
  resize(
    config: SpectrumSettings,
    regionCount: number,
    options?: {
      preview?: boolean;
      deferSceneChange?: boolean;
      adaptive?: boolean;
    },
  ): Promise<void>;
  hover?(clientX: number, clientY: number): void;
  hit(clientX: number, clientY: number): { x: number; z: number } | null;
  draw(
    motion: SceneMotion,
    config: SpectrumSettings,
    reduced: boolean,
    dt?: number,
    focus?: SceneFocus,
    presentationPaused?: boolean,
    options?: FrameOptions,
  ): boolean;
  clear(): void;
  dispose(): void;
}

export const createThreeSceneRenderer = (
  canvas: HTMLCanvasElement,
  _effect: SpectrumSettings["effect"],
  onError: (error: unknown) => void = () => {},
): ThreeSceneRenderer => new FiberSceneRenderer(canvas, onError);
