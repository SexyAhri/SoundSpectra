import { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as T from "three";
import { SceneCamera } from "../camera";
import { isClassicEffect } from "../../music-engine/catalog";
import { useVisualFrame } from "./runtime";

const viewpoints: Record<string, readonly [number, number, number]> = {
  rhythm_balls: [0, 2, 24],
  rhythm_rain: [0, 5, 24],
  rhythm_skin: [0, 4, 24],
  volume_rain: [0, 5, 24],
  ripple: [0, 4, 24],
  dream_stars: [0, 2, 24],
  vortex: [0, 4, 24],
};
export function CameraRig() {
  const camera = useThree((state) => state.camera) as T.PerspectiveCamera;
  const rig = useMemo(
    () => ({
      view: new SceneCamera(),
      base: new T.Vector3(),
      target: new T.Vector3(),
    }),
    [],
  );
  useVisualFrame(({ settings: config, motion, reduced }) => {
    const { base, target, view } = rig,
      classic = isClassicEffect(config.effect);
    let fov = 46;
    if (config.effect === "sound_field") {
      fov = 48;
      target.set(0, 1.6, -5);
      base.set(
        (Math.sin(0.06) * 42) / config.music.fieldScale,
        24 / config.music.fieldScale,
        (Math.cos(0.06) * 42) / config.music.fieldScale - 5,
      );
    } else if (classic) {
      fov =
        config.effect === "rhythm_balls"
          ? Math.min(38, 90 / camera.aspect)
          : 62;
      const lens =
        Math.tan((31 * Math.PI) / 180) / Math.tan((fov * Math.PI) / 360);
      const scale =
        (1.35 / config.music.fieldScale) *
        Math.max(1, 1.15 / camera.aspect) *
        lens;
      base
        .fromArray(viewpoints[config.effect] ?? [0, 9, 30])
        .multiplyScalar(scale);
      target.set(0, 0, 0);
    } else {
      const flight = config.effect === "star_flight";
      const distance = config.effect === "petal_bloom" ? 12 : flight ? 16 : 22;
      base.set(
        0,
        flight ? 0 : 1,
        (distance / (config.music.fieldScale / 1.35)) *
          Math.max(1, 1.2 / camera.aspect),
      );
      target.set(0, 0, -5);
    }
    if(config.sceneMode==='immersive'&&!reduced&&['rhythm_balls','rhythm_skin','sound_field'].includes(config.effect)){
      base.x+=Math.sin(motion.phase*.13)*base.z*.012
      base.y+=Math.sin(motion.phase*.09)*base.z*.004
    }
    // Pan distance depends on the lens, including the very first restored frame.
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    view.apply(camera, base, target, config.view);
    const far = Math.max(350, camera.position.distanceTo(target) + 350);
    if (Math.abs(camera.far - far) > 0.1) {
      camera.far = far;
      camera.updateProjectionMatrix();
    }
  }, -3);
  return null;
}
