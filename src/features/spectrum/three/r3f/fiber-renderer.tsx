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
import { threeDrawingSize, previewDrawingSize } from "../render-budget";
import { isAmbientEffect } from "../../music-engine/catalog";
import { VisualScene, VisualErrorBoundary } from "./visual-scene";
import type { VisualRuntime, VisualDiagnostics } from "./runtime";
import type { SceneFocus } from '../../scene-focus';
import { compositionForEffect, type CompositionId } from '../compositions/presets';
import { compositionDrawingSize } from '../compositions/render-budget';
import { SceneTransition } from '../../../performance/transition';
import { mappingValues } from '../../../performance/mapping';
import type { FrameOptions } from '../../../performance/runtime';
import { originalMapping } from '../../../performance/model';
import { native } from '../../bridge';

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
  private shadersReady = false;
  private compiling = false;
  private preparation: Promise<void> = Promise.resolve();
  private time = 0;
  private stopped = false;
  private ready = false;
  private resizeRevision = 0;
  readonly diagnostics: VisualDiagnostics = {preparations:new Set()};
  private composition: CompositionId | undefined;
  private readonly transition = new SceneTransition();
  private lastGoodConfig?: SpectrumSettings;
  private failedEffect?: SpectrumSettings['effect'];
  private recover = (error:unknown) => {
    const previous=this.lastGoodConfig;
    if(!previous||previous.effect===this.config?.effect){this.onError(error);return}
    this.failedEffect=this.config?.effect;this.config=previous;this.transition.cancel();this.stamp='';this.shadersReady=false;
    if(this.runtime)Object.assign(this.runtime,{settings:previous,composition:this.composition??compositionForEffect(previous.effect),transition:this.transition.frame});
    this.canvas.dataset.transitionError=error instanceof Error?error.message:String(error);
    queueMicrotask(()=>{if(!this.stopped)void this.prepareScene().catch(this.onError)});
  };

  /** Opt-in review composition; never changes persisted effect IDs or settings. */
  setComposition(id?: CompositionId) {
    this.composition = id;
    if (this.runtime) this.runtime.composition = id ?? compositionForEffect(this.runtime.settings.effect);
  }

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
    if (native && /Windows/i.test(navigator.userAgent)) {
      // WebView2/ANGLE can leave KHR completion polling pending indefinitely
      // while this desktop surface holds its last frame. Finish linking during
      // preparation; the old presented image remains until the scene is ready.
      this.renderer.compileAsync = async (scene, camera, targetScene = null) => {
        this.renderer.compile(scene, camera, targetScene);
        const gl = this.renderer.getContext();
        for (const item of this.renderer.info.programs ?? []) {
          if (!gl.getProgramParameter(item.program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(item.program) || '三维场景着色器链接失败。');
          }
        }
        return scene;
      };
    }
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
    canvas.dataset.contextId = String(performance.now());
    canvas.dataset.preparations = '0';
    canvas.dataset.framework = "r3f";
    canvas.dataset.engine = `R3F 9 / three.js r${T.REVISION}`;
    canvas.dataset.geometry = "spatial";
  }
  private mount() {
    if (!this.ready || !this.runtime || !this.config || this.stopped) return;
    flushSync(() => {
      this.store = this.root.render(
        <VisualErrorBoundary key={this.config!.effect} onError={this.recover}>
          <VisualScene
            runtime={this.runtime!}
            config={this.config!}
            regions={this.regions}
          />
        </VisualErrorBoundary>,
      );
    });
  }
  private sceneStamp(config:SpectrumSettings){
    return `${config.effect}:${config.quality}:${config.music.ambientDensity}:${this.regions}:${this.composition??compositionForEffect(config.effect)??''}`;
  }
  private prepareScene() {
    const stamp=this.sceneStamp(this.config!);
    if(this.stamp===stamp)return this.preparation;
    this.stamp=stamp;this.shadersReady=false;
    this.canvas.dataset.preparations = String(Number(this.canvas.dataset.preparations) + 1);
    this.canvas.dataset.preparing='true';
    // A new scene waits for the previous compilation before disposing its
    // materials. Repeated sizes share this promise and never recompile shaders.
    this.preparation=this.preparation.catch(()=>{}).then(async()=>{
      await this.configured;
      if(this.stopped||this.stamp!==stamp)return;
      this.mount();
      // Main layers render into a linear offscreen target. Compiling against
      // the sRGB canvas would prepare another shader variant and still stall
      // when the real offscreen draw begins.
      this.compiling = true;
      try {
        const previous=this.renderer.getRenderTarget();
        let main:Promise<unknown>;
        try{
          this.renderer.setRenderTarget(this.diagnostics.image??null);
          main=this.renderer.compileAsync(this.scene,this.camera);
        }finally{this.renderer.setRenderTarget(previous)}
        const pending = [
          main,
          ...Array.from(this.diagnostics.preparations??[],prepare=>prepare()),
        ];
        // Preparation deliberately holds the last frame instead of rendering.
        // Submit shader work even while a paused/desktop canvas has no presents.
        this.renderer.getContext().flush();
        await Promise.all(pending);
      } finally {
        this.compiling = false;
      }
      if(!this.stopped&&this.stamp===stamp){
        this.shadersReady=true;this.canvas.dataset.preparing='false';
      }
    });
    return this.preparation;
  }
  async resize(config: SpectrumSettings, regions: number, options: {preview?:boolean;deferSceneChange?:boolean} = {}) {
    const resizeStarted = performance.now();
    const revision = ++this.resizeRevision;
    this.regions = regions;
    const width = Math.max(1, this.canvas.clientWidth),
      height = Math.max(1, this.canvas.clientHeight);
    const desired = (this.composition || compositionForEffect(config.effect) ? compositionDrawingSize : threeDrawingSize)(
      width,
      height,
      devicePixelRatio,
      config.quality,
      regions,
    );
    const size=options.preview?previewDrawingSize(desired,regions):desired;
    try {
      await this.configured;
      if (this.stopped || revision !== this.resizeRevision) return;
      this.ready = true;
      if(!this.config||!options.deferSceneChange){this.config=config;this.transition.cancel()}
      if (!this.runtime)
        this.runtime = {
          composition: this.composition ?? compositionForEffect(config.effect),
          motion: new SceneMotion(),
          settings: config,
          reduced: false,
          dt: 0,
          regions,
          pointer: this.pointer,
          diagnostics: this.diagnostics,
        };
      Object.assign(this.runtime,{regions,settings:this.config,composition:this.composition??compositionForEffect(this.config.effect)});
      await this.prepareScene();
      if(this.stopped||revision!==this.resizeRevision)return;
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
      this.canvas.dataset.resizeMs = (performance.now() - resizeStarted).toFixed(2);
    } catch (error) {
      this.recover(error);
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
    presentationPaused = false,
    options: FrameOptions = { transition: {kind:'dissolve',durationMs:1400}, animate:true, mapping:originalMapping },
  ) {
    if (this.stopped) return false;
    if(this.failedEffect===config.effect)config=this.lastGoodConfig??config;
    else if(this.failedEffect){this.failedEffect=undefined;delete this.canvas.dataset.transitionError}
    config = this.transition.step(this.config??config,config,options.transition,options.animate,reduced,presentationPaused?0:dt,this.shadersReady,()=>this.diagnostics.capture?.());
    this.config = config;
    if (!this.runtime)
      this.runtime = {
        composition: this.composition ?? compositionForEffect(config.effect),
        motion,
        settings: config,
        reduced,
        dt,
        regions: this.regions,
        pointer: this.pointer,
        diagnostics: this.diagnostics,
      };
    Object.assign(this.runtime, {
      composition: this.composition ?? compositionForEffect(config.effect),
      motion,
      settings: config,
      reduced,
      dt,
      regions: this.regions,
      focus,
      presentationPaused,
      transition: this.transition.frame,
      mapping: mappingValues(config.effect,options.mapping,motion,reduced),
    });
    if(this.stamp!==this.sceneStamp(config)||!this.store)void this.prepareScene().catch(this.recover);
    if(!this.shadersReady)return false;
    this.time += dt;
    if (this.store) {
      this.renderer.info.reset();
      const start = performance.now();
      try{this.store.getState().advance(this.time, false)}catch(error){this.recover(error);return false}
      this.canvas.dataset.frameMs = (performance.now() - start).toFixed(2);
      this.canvas.dataset.programs = String(this.renderer.info.programs?.length ?? 0);
    }
    this.canvas.dataset.scene = config.effect;
    this.canvas.dataset.transition = this.transition.active?this.transition.frame.kind:'idle';
    this.canvas.dataset.transitionProgress = String(this.transition.frame.blend);
    this.canvas.dataset.mapping = JSON.stringify(this.runtime.mapping);
    if(!this.transition.active)this.lastGoodConfig=config;
    return true;
  }
  clear() {
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    const unmount = () => flushSync(() => this.root.unmount());
    // Three polls each material's program until compilation finishes. Retain
    // those materials until then, including when the canvas closes mid-startup.
    if (this.compiling) void this.preparation.then(unmount, unmount);
    else unmount();
  }
}
