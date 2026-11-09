import { useMemo, useRef, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import * as T from "three";
import { effectDefinitions } from "../../effect-definitions";
import { useVisualFrame } from "./runtime";

/** Screen-relative placement leaves useful desktop space, while retaining saved user views.
 * Very wide strips already express a deliberate layout and keep their horizontal spread.
 */
export function CompositionLayout({ children }: { children: ReactNode }) {
  const group = useRef<T.Group>(null),
    camera = useThree((s) => s.camera) as T.PerspectiveCamera;
  const vectors = useMemo(
    () => ({ right: new T.Vector3(), up: new T.Vector3() }),
    [],
  );
  useVisualFrame(({ settings }) => {
    if (!group.current) return;
    const layout = effectDefinitions[settings.effect].desktop,
      daily = settings.sceneMode === "daily";
    const weight = daily
      ? Math.max(0, Math.min(1, (3 - camera.aspect) / 0.8))
      : 0;
    const height =
      2 *
      camera.position.length() *
      Math.tan(T.MathUtils.degToRad(camera.fov) / 2);
    vectors.right.setFromMatrixColumn(camera.matrixWorld, 0);
    vectors.up.setFromMatrixColumn(camera.matrixWorld, 1);
    group.current.position
      .copy(vectors.right)
      .multiplyScalar(height * camera.aspect * layout.x * weight)
      .addScaledVector(vectors.up, height * layout.y * weight);
    group.current.scale.setScalar(1 + (layout.scale - 1) * weight);
    group.current.updateMatrixWorld(true);
  }, -2);
  return (
    <group ref={group} name="scene-composition">
      {children}
    </group>
  );
}
