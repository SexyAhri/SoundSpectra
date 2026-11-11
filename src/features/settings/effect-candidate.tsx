import { useMemo, useRef } from "react";
import type { SpectrumSettings } from "../spectrum/model";
import { SpectrumCanvas } from "../spectrum/spectrum-canvas";
import { recommendedMusic } from "../spectrum/effect-presets";
import { defaultSceneView } from "../spectrum/three/view";

/** One renderer belongs to the chooser, never one renderer per thumbnail. */
export function EffectCandidate({
  settings,
  effect,
}: {
  settings: SpectrumSettings;
  effect: SpectrumSettings["effect"];
}) {
  const bands = useRef(new Float32Array(64)),
    receivedAt = useRef(0);
  const candidate = useMemo(
    () => ({
      ...settings,
      effect,
      music: recommendedMusic(effect),
      view: { ...defaultSceneView },
      quality: "eco" as const,
      opacity: 100,
      regions: [],
    }),
    [settings, effect],
  );
  return (
    <SpectrumCanvas
      settings={candidate}
      bands={bands}
      receivedAt={receivedAt}
      demo
      active
      interactive={false}
    />
  );
}
