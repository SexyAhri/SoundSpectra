import type { MusicEffect } from "../../music-engine/catalog";

export type CompositionId = "sculpture" | "expanse" | "passage";
export const compositions: Record<
  CompositionId,
  {
    title: string;
    family: string;
    effect: MusicEffect;
    description: string;
    mapping: string;
  }
> = {
  sculpture: {
    title: "潮汐之结",
    family: "雕塑型",
    effect: "tidal_knot",
    description:
      "两层疏密不同的粒子组成流体雕塑。青绿与暖铜沿曲面交汇，缓慢侧转显露内部层次。",
    mapping:
      "低频推动局部鼓起和回落，起音沿曲面传播，中频扭动粒子流，高频点亮局部细点。",
  },
  expanse: {
    title: "层海",
    family: "铺展型",
    effect: "layered_tides",
    description:
      "宽幅粒子波面铺向远处，较暗的下层透出深度。波峰斜向交错，外缘带有淡紫色的细点。",
    mapping:
      "低频抬升交错波峰，起音激起向外扩散的涌浪，中频推动细波，高频擦亮浪尖。",
  },
  passage: {
    title: "回声廊道",
    family: "穿行型",
    effect: "echo_corridor",
    description:
      "六股有宽窄差异的螺旋带穿过前、中、远景。近端裁出画框，中心留有通路，远端收束。",
    mapping:
      "低频推动各条轨道错位弯曲，起音光带由远及近驶过，中高频点亮刻度和边缘；镜头保持稳定。",
  },
};
export function isComposition(value: string | null): value is CompositionId {
  return value !== null && Object.hasOwn(compositions, value);
}
export function compositionForEffect(
  effect: MusicEffect,
): CompositionId | undefined {
  return effect === "tidal_knot"
    ? "sculpture"
    : effect === "layered_tides"
      ? "expanse"
      : effect === "echo_corridor"
        ? "passage"
        : undefined;
}
