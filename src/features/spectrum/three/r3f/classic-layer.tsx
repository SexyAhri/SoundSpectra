import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as T from "three";
import type { ClassicEffect } from "../../music-engine/catalog";
import { createImmersiveScene } from "../classic/immersive/scenes";
import { disposeVisualTree } from "./resources";
import { useVisualFrame } from "./runtime";

/** Existing authored geometry is a layer, independent of camera, renderer and bloom. */
export function ClassicLayer({
  effect,
  detail,
}: {
  effect: ClassicEffect;
  detail: number;
}) {
  const spatial = useMemo(
    () => createImmersiveScene(effect, detail),
    [effect, detail],
  );
  const { gl, size, camera } = useThree();
  const parentRotation = useMemo(() => new T.Quaternion(), []);
  useEffect(() => () => disposeVisualTree(spatial.group), [spatial]);
  useVisualFrame(({ motion, settings, reduced }) => {
    if (effect === 'window_rain') {
      // Glass is a viewing plane. Orbiting must not expose the edge of its
      // backdrop or collapse every water bead to a line. Pan and zoom remain
      // camera controls, and the same orientation serves preview and desktop.
      camera.getWorldQuaternion(spatial.group.quaternion);
      if (spatial.group.parent) {
        spatial.group.parent.getWorldQuaternion(parentRotation);
        spatial.group.quaternion.premultiply(parentRotation.invert());
      }
      spatial.group.updateMatrixWorld(true);
    }
    spatial.layout?.((camera as T.PerspectiveCamera).aspect);
    spatial.group.traverse((object) => {
      if(object.name==='scene-backdrop')object.visible=settings.sceneMode==='immersive';
      const material = (object as T.Points).material;
      for (const item of Array.isArray(material) ? material : [material]) {
        if (item instanceof T.ShaderMaterial && item.uniforms.uPixelRatio)
          item.uniforms.uPixelRatio.value =
            gl.domElement.height / Math.max(1, size.height);
      }
    });
    spatial.update(motion, settings, reduced);
  });
  return <primitive object={spatial.group} />;
}
