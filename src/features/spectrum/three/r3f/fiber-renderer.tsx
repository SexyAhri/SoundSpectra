import {
  createRoot,
  extend,
  flushSync,
  type ReconcilerRoot,
  type RootStore,
} from "@react-three/fiber";
import * as T from "three";
import type { SpectrumSettings } from "../../model";
import { SceneMotion } from "../motion";
import { threeDrawingSize } from "../render-budget";
import { isAmbientEffect } from "../../music-engine/catalog";
import { VisualScene, VisualErrorBoundary } from "./visual-scene";
import type { VisualRuntime, VisualDiagnostics } from "./runtime";
import type { SceneFocus } from '../../scene-focus';

extend({
  Mesh: T.Mesh,
  Group: T.Group,
  Points: T.Points,
  LineSegments: T.LineSegments,
});

/** DOM integration owns pacing/visibility; R3F owns the scene, hooks and GPU layer lifetime. */
export class FiberSceneRenderer {
  readonly renderer: T.WebGLRenderer;
  private readonly root: ReconcilerRoot<HTMLCanvasElement>;
  private readonly configured: Promise<unknown>;
  private store: RootStore | undefined;
  private runtime: VisualRuntime | undefined;
  private readonly pointer = new T.Vector2();
  private readonly ray = new T.Raycaster();
  private readonly plane = new T.Plane();
  private readonly point = new T.Vector3();
  private readonly localRay = new T.Ray();
  private readonly inverseLayout = new T.Matrix4();
  private config: SpectrumSettings | undefined;
  private regions = 1;
  private stamp = "";
  private time = 0;
  private stopped = false;
  private ready = false;
  private resizeRevision = 0;
  readonly diagnostics: VisualDiagnostics = {};

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly onError: (error: unknown) => void = (error) => {
      throw error;
    },
  ) {
    this.renderer = new T.WebGLRenderer({
      canvas,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0, 0);
    // The parent owns CSS layout. R3F otherwise writes the first measured size
    // inline, preventing a percentage-sized canvas from following maximization.
    const setSize = this.renderer.setSize.bind(this.renderer);
    const logicalSize = new T.Vector2(), setPixelRatio = this.renderer.setPixelRatio.bind(this.renderer);
    this.renderer.setSize = (width, height) => {
      this.renderer.getSize(logicalSize);
      if (logicalSize.x !== width || logicalSize.y !== height ||
        canvas.width !== Math.floor(width * this.renderer.getPixelRatio()) ||
        canvas.height !== Math.floor(height * this.renderer.getPixelRatio())) setSize(width, height, false);
    };
    this.renderer.setPixelRatio = value => {
      if (value !== this.renderer.getPixelRatio()) setPixelRatio(value);
    };
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.info.autoReset = false;
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      throw new Error(
        [
          gl.getShaderInfoLog(vertex),
          gl.getShaderInfoLog(fragment),
          gl.getProgramInfoLog(program),
        ]
          .filter(Boolean)
          .join("\n") || "三维场景着色器初始化失败。",
      );
    };
    this.root = createRoot(canvas);
    this.configured = this.root
      .configure({
        gl: () => this.renderer,
        frameloop: "never",
        dpr: 1,
        camera: { fov: 46, near: 0.1, far: 500 },
        size: {
          width: canvas.clientWidth || 1,
          height: canvas.clientHeight || 1,
          top: 0,
          left: 0,
        },
      })
      .then(() => {
        if (!this.stopped) {
          this.ready = true;
          this.mount();
        }
      })
      .catch(onError);
    canvas.dataset.renderer = "three";
    canvas.dataset.framework = "r3f";
    canvas.dataset.engine = `R3F 9 / three.js r${T.REVISION}`;
    canvas.dataset.geometry = "spatial";
  }
  private mount() {
    if (!this.ready || !this.runtime || !this.config || this.stopped) return;
    flushSync(() => {
      this.store = this.root.render(
        <VisualErrorBoundary onError={this.onError}>
          <VisualScene
            runtime={this.runtime!}
            config={this.config!}
            regions={this.regions}
          />
        </VisualErrorBoundary>,
      );
    });
  }
  async resize(config: SpectrumSettings, regions: number) {
    const revision = ++this.resizeRevision;
    this.regions = regions;
    const width = Math.max(1, this.canvas.clientWidth),
      height = Math.max(1, this.canvas.clientHeight);
    const size = threeDrawingSize(
      width,
      height,
      devicePixelRatio,
      config.quality,
      regions,
    );
    try {
      await this.configured;
      if (this.stopped || revision !== this.resizeRevision) return;
      this.ready = true;
      this.config = config;
      if (!this.runtime)
        this.runtime = {
          motion: new SceneMotion(),
          settings: config,
          reduced: false,
          dt: 0,
          regions,
          pointer: this.pointer,
          diagnostics: this.diagnostics,
        };
      if (!this.store) this.mount();
      const state = this.store!.getState(), dpr = Math.min(size.width / width, size.height / height);
      if (state.size.width !== width || state.size.height !== height || state.viewport.dpr !== dpr) {
        const logicalSize = { width, height, top: 0, left: 0 };
        // R3F sets DPR and size separately. Allocate the final drawing buffer
        // atomically so its following setters do not clear/reallocate it twice.
        this.renderer.setDrawingBufferSize(width, height, dpr);
        // Publish size and DPR together. Pure resizes retain the existing scene,
        // materials and manual frame loop instead of reconfiguring/remounting.
        this.store!.setState({ size: logicalSize, viewport: { ...state.viewport,
          ...state.viewport.getCurrentViewport(state.camera, undefined, logicalSize), dpr } });
      }
    } catch (error) {
      this.onError(error);
    }
  }
  get scene() {
    return this.store!.getState().scene;
  }
  get camera() {
    return this.store!.getState().camera as T.PerspectiveCamera;
  }
  get image() {
    return this.diagnostics.image;
  }
  get heightTarget() {
    return this.diagnostics.heightTarget;
  }
  get grid() {
    return this.diagnostics.grid;
  }
  get seeds() {
    return this.diagnostics.seeds;
  }
  get bloom() {
    return this.diagnostics.bloom;
  }
  hover(clientX: number, clientY: number) {
    const box = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((clientX - box.left) / Math.max(1, box.width)) * 2 - 1,
      1 - ((clientY - box.top) / Math.max(1, box.height)) * 2,
    );
  }
  hit(clientX: number, clientY: number) {
    const camera = this.store?.getState().camera;
    if (!camera) return null;
    const pointer = new T.Vector2();
    const box = this.canvas.getBoundingClientRect();
    pointer.set(
      ((clientX - box.left) / box.width) * 2 - 1,
      1 - ((clientY - box.top) / box.height) * 2,
    );
    this.ray.setFromCamera(pointer, camera);
    this.localRay.copy(this.ray.ray);
    const composition=this.store!.getState().scene.getObjectByName('scene-composition');
    if(composition){composition.updateMatrixWorld(true);this.localRay.applyMatrix4(this.inverseLayout.copy(composition.matrixWorld).invert())}
    const ambient = this.config && isAmbientEffect(this.config.effect);
    this.plane.set(
      ambient ? new T.Vector3(0, 0, 1) : new T.Vector3(0, 1, 0),
      0,
    );
    if (!this.localRay.intersectPlane(this.plane, this.point)) return null;
    if (
      this.config?.effect === "sound_field" &&
      (Math.abs(this.point.x) > 32 || Math.abs(this.point.z) > 32)
    )
      return null;
    return { x: this.point.x, z: ambient ? this.point.y : this.point.z };
  }
  draw(
    motion: SceneMotion,
    config: SpectrumSettings,
    reduced: boolean,
    dt = 1 / 60,
    focus?: SceneFocus,
  ) {
    if (this.stopped) return;
    this.config = config;
    if (!this.runtime)
      this.runtime = {
        motion,
        settings: config,
        reduced,
        dt,
        regions: this.regions,
        pointer: this.pointer,
        diagnostics: this.diagnostics,
      };
    Object.assign(this.runtime, {
      motion,
      settings: config,
      reduced,
      dt,
      regions: this.regions,
      focus,
    });
    const stamp = `${config.effect}:${config.quality}:${config.music.ambientDensity}:${this.regions}`;
    if (this.stamp !== stamp || !this.store) {
      this.stamp = stamp;
      this.mount();
    }
    this.time += dt;
    if (this.store) {
      this.renderer.info.reset();
      const start = performance.now();
      this.store.getState().advance(this.time, false);
      this.canvas.dataset.frameMs = (performance.now() - start).toFixed(2);
    }
    this.canvas.dataset.scene = config.effect;
  }
  clear() {
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
  }
  dispose() {
    this.stopped = true;
    flushSync(() => this.root.unmount());
  }
}
