import * as T from "three";
import { FIELD_SIZE } from "../motion";

/** Deterministic instancing shared by the R3F layer and the GPU reference harness. */
export function createTerrainGrid(grid: number) {
  const count = grid * grid,
    step = FIELD_SIZE / grid,
    offsets = new Float32Array(count * 2),
    seeds = new Float32Array(count);
  const uv = new Float32Array(count * 2),
    seedData = new Float32Array(count * 4);
  let random = 9351;
  for (let z = 0; z < grid; z++)
    for (let x = 0; x < grid; x++) {
      const i = z * grid + x;
      offsets[i * 2] = (x + 0.5) * step - FIELD_SIZE / 2;
      offsets[i * 2 + 1] = (z + 0.5) * step - FIELD_SIZE / 2;
      uv[i * 2] = (x + 0.5) / grid;
      uv[i * 2 + 1] = (z + 0.5) / grid;
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      seeds[i] = random / 4294967296;
      seedData[i * 4] = seeds[i];
    }
  const texture = new T.DataTexture(
    seedData,
    grid,
    grid,
    T.RGBAFormat,
    T.FloatType,
  );
  texture.needsUpdate = true;
  // Separate caps and side normals preserve the column silhouette. All columns
  // still share one geometry/draw call and sample the existing GPU height field.
  const column = new T.BoxGeometry(step, 1, step);
  column.translate(0, 0.5, 0);
  const geometry = new T.InstancedBufferGeometry();
  geometry.setIndex(column.index);
  geometry.setAttribute("position", column.getAttribute("position"));
  geometry.setAttribute("normal", column.getAttribute("normal"));
  column.dispose();
  geometry.setAttribute("aOffset", new T.InstancedBufferAttribute(offsets, 2));
  geometry.setAttribute("aSample", new T.InstancedBufferAttribute(uv, 2));
  geometry.setAttribute("aSeed", new T.InstancedBufferAttribute(seeds, 1));
  geometry.instanceCount = count;
  return { geometry, texture, seeds, offsets, step, count };
}
