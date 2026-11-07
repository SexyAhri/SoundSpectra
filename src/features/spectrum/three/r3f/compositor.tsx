import { useEffect, useMemo } from "react";
import { createPortal, useFrame, useThree } from "@react-three/fiber";
import * as T from "three";
import { SceneBloom, bloomProfile } from "../classic/scene-bloom";
import { passVertex, compositeFragment } from "../composite";
import { resolveEffectPalette } from "../../effect-palette";
import { isClassicEffect } from "../../music-engine/catalog";
import { fullscreenGeometry } from "./resources";
import { useVisualRuntime } from "./runtime";
import { visualQuality } from "./quality";

// One color conversion and premultiplied-alpha output, shared by every visual layer.
const fragment = `uniform sampler2D uBloom0,uBloom1,uBloom2;
uniform float uBloomStrength,uSceneBrightness,uTransparentScene;
uniform vec4 uFocusBounds;
uniform float uFocusActive,uFocusCue;
${compositeFragment}`
  .replace(
    "vec4 terrain = texture2D(uImage, uv);",
    `vec2 focusPoint=uRegion.xy+vec2(uv.x,1.-uv.y)*uRegion.zw;
vec2 focusOutside=max(uFocusBounds.xy-focusPoint,focusPoint-uFocusBounds.xy-uFocusBounds.zw);
float focusDistance=max(focusOutside.x,focusOutside.y);
float focusMask=(1.-smoothstep(-.005,.035,focusDistance))*uFocusActive;
vec4 terrain = texture2D(uImage, uv);
if(focusMask>.001){
  vec2 pixel=vec2(3.)/uResolution;
  vec4 soft=(terrain*2.+texture2D(uImage,uv+pixel)+texture2D(uImage,uv-pixel)
    +texture2D(uImage,uv+vec2(pixel.x,-pixel.y))+texture2D(uImage,uv+vec2(-pixel.x,pixel.y)))/6.;
  terrain=mix(terrain,soft,focusMask*.7);
  terrain.rgb*=1.-focusMask*.46;
  // Line changes only brush the existing surface around the readable text.
  terrain.rgb+=uWarm*uFocusCue*focusMask*.025*terrain.a;
}
vec3 glow=(texture2D(uBloom0,uv).rgb*.5+texture2D(uBloom1,uv).rgb*.3+texture2D(uBloom2,uv).rgb*.2)*uBloomStrength;
glow*=1.-focusMask*.85;
terrain.rgb=(terrain.rgb+glow)*uSceneBrightness;
terrain.a=max(terrain.a,clamp(max(max(glow.r,glow.g),glow.b)*.6,0.,.45));`,
  )
  .replace(
    "float backdropAlpha = .985 * uImmersive;",
    "float backdropAlpha = .985 * uImmersive * (1. - uTransparentScene);",
  )
  .replace('alpha *= uOpacity * mix(border, 1., uImmersive);',`alpha *= uOpacity * mix(border, 1., uImmersive);
  vec2 clearCenter=(uv-vec2(.43,.55))/vec2(.3,.38);
  float desktopQuiet=exp(-dot(clearCenter,clearCenter)*2.)*.62;
  alpha*=1.-desktopQuiet*(1.-uImmersive)*(1.-step(3.,uResolution.x/uResolution.y));`);

export function SceneCompositor() {
  const runtime = useVisualRuntime(),
    { gl, scene, camera } = useThree();
  const pass = useMemo(() => {
    const hdr = gl.extensions.has("EXT_color_buffer_float");
    const image = new T.WebGLRenderTarget(1, 1, {
      type: hdr ? T.HalfFloatType : T.UnsignedByteType,
    });
    const bloom = new SceneBloom(),
      postScene = new T.Scene(),
      postCamera = new T.Camera(),
      geometry = fullscreenGeometry();
    const uniforms = {
      uImage: { value: image.texture },
      uLow: { value: new T.Color() },
      uWarm: { value: new T.Color() },
      uOpacity: { value: 0 },
      uImmersive: { value: 0 },
      uResolution: { value: new T.Vector2() },
      uRegion: { value: new T.Vector4() },
      uMasks: { value: Array.from({ length: 8 }, () => new T.Vector4()) },
      uFeather: { value: new Float32Array(8) },
      uMaskCount: { value: 0 },
      uBloom0: { value: bloom.texture(0) },
      uBloom1: { value: bloom.texture(1) },
      uBloom2: { value: bloom.texture(2) },
      uBloomStrength: { value: 0 },
      uSceneBrightness: { value: 1 },
      uTransparentScene: { value: 0 },
      uFocusBounds: {value:new T.Vector4()},
      uFocusActive: {value:0},
      uFocusCue: {value:0},
    };
    const material = new T.ShaderMaterial({
      uniforms,
      vertexShader: passVertex,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
      blending: T.NoBlending,
      premultipliedAlpha: true,
    });
    return {
      image,
      bloom,
      postScene,
      postCamera,
      geometry,
      material,
      uniforms,
      hdr,
      stamp: "",
      frames: 0,
      focusKey: null as string|null,
      cueAge: 10,
      focusTime: NaN,
    };
  }, [gl]);
  useEffect(
    () => () => {
      pass.image.dispose();
      pass.bloom.dispose();
      pass.geometry.dispose();
      pass.material.dispose();
    },
    [pass],
  );
  useEffect(() => {
    runtime.diagnostics.image = pass.image;
    runtime.diagnostics.bloom = pass.bloom;
    return () => {
      delete runtime.diagnostics.image;
      delete runtime.diagnostics.bloom;
    };
  }, [runtime, pass]);
  useFrame(() => {
    const { settings: config, motion, regions } = runtime,
      u = pass.uniforms,
      palette = resolveEffectPalette(config);
    const width = gl.domElement.width,
      height = gl.domElement.height;
    const focus=runtime.focus, key=focus?.lineKey??null;
    if(key!==pass.focusKey){
      pass.cueAge=pass.focusKey&&key&&motion.frame?.audible&&motion.transporting&&!runtime.reduced?0:10;
      pass.focusKey=key;
    }
    const focusTime=motion.frame?.now??0;
    if(pass.focusTime!==focusTime)pass.cueAge+=Math.max(0,Math.min(.1,runtime.dt));
    pass.focusTime=focusTime;
    const focusBounds=focus?.bounds;
    u.uFocusActive.value=focusBounds?1:0;
    if(focusBounds)u.uFocusBounds.value.set(focusBounds.x,focusBounds.y,focusBounds.width,focusBounds.height);
    u.uFocusCue.value=!runtime.reduced&&motion.frame?.audible&&motion.transporting?Math.exp(-pass.cueAge*5):0;
    gl.domElement.dataset.focus=focusBounds?JSON.stringify(focusBounds):'';
    gl.domElement.dataset.focusCue=u.uFocusCue.value.toFixed(4);
    // Keep HDR where emitted light needs it. Opaque terrain and nonemissive petals
    // retain their smaller byte targets, especially important for large desktop regions.
    const imageType =
      pass.hdr &&
      (isClassicEffect(config.effect) || config.effect === "aurora_flow")
        ? T.HalfFloatType
        : T.UnsignedByteType;
    const stamp = `${width}:${height}:${config.quality}:${regions}:${imageType}`;
    if (pass.stamp !== stamp) {
      const samples = Math.min(
        visualQuality(config.quality, regions).samples,
        gl.capabilities.maxSamples,
      );
      if (
        pass.image.samples !== samples ||
        pass.image.texture.type !== imageType
      ) {
        pass.image.samples = samples;
        pass.image.texture.type = imageType;
        pass.image.dispose();
      }
      pass.image.setSize(width, height);
      pass.bloom.resize(width, height, config.quality, regions, pass.hdr);
      pass.stamp = stamp;
    }
    const classic = isClassicEffect(config.effect),
      snow = config.effect === "ripple",
      aurora = config.effect === "aurora_flow";
    u.uLow.value.set(palette.low);
    u.uWarm.value.set(palette.accent);
    if (snow) {
      u.uLow.value.multiplyScalar(0);
      u.uWarm.value.multiplyScalar(0);
    }
    u.uSceneBrightness.value = classic
      ? config.effect === "rhythm_skin"
        ? Math.min(0.95, 0.68 * Math.sqrt(config.music.fieldBrightness / 45))
        : config.music.fieldBrightness / 45
      : 1;
    u.uTransparentScene.value = snow ? 1 : 0;
    u.uOpacity.value = (config.opacity / 100) * motion.presence;
    u.uImmersive.value = config.sceneMode === "immersive" ? 1 : 0;
    u.uResolution.value.set(width, height);
    const b = config.bounds;
    u.uRegion.value.set(b.x, b.y, b.width, b.height);
    u.uMaskCount.value = config.masks.length;
    config.masks.forEach((mask, i) => {
      const b = mask.bounds;
      u.uMasks.value[i].set(b.x, b.y, b.width, b.height);
      u.uFeather.value[i] = mask.feather;
    });
    gl.setRenderTarget(pass.image);
    gl.clear();
    gl.render(scene, camera);
    const [threshold, strength] = bloomProfile(config.effect),
      bloom = (classic && !snow) || aurora;
    if (bloom)
      pass.bloom.draw(gl, pass.image.texture, aurora ? 0.22 : threshold);
    u.uBloom0.value = pass.bloom.texture(0);
    u.uBloom1.value = pass.bloom.texture(1);
    u.uBloom2.value = pass.bloom.texture(2);
    u.uBloomStrength.value = bloom ? (aurora ? 0.2 : strength) : 0;
    gl.setRenderTarget(null);
    gl.clear();
    gl.render(pass.postScene, pass.postCamera);
    const canvas = gl.domElement;
    canvas.dataset.frames = String(++pass.frames);
    canvas.dataset.drawCalls = String(gl.info.render.calls);
    canvas.dataset.geometries = String(gl.info.memory.geometries);
    canvas.dataset.textures = String(gl.info.memory.textures);
    canvas.dataset.bloomLevels = bloom ? String(pass.bloom.count) : "0";
  }, 1);
  return createPortal(
    <mesh
      geometry={pass.geometry}
      material={pass.material}
      frustumCulled={false}
      dispose={null}
    />,
    pass.postScene,
  );
}
