import { useEffect, useMemo, useRef, useState } from "react";
import type { SpectrumSettings } from "../spectrum/model";
import { SpectrumCanvas } from "../spectrum/spectrum-canvas";
import { recommendedMusic } from "../spectrum/effect-presets";
import { defaultSceneView } from "../spectrum/three/view";
import { EffectArtwork } from "./effect-artwork";

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
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
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
  return reduced ? (
    <EffectArtwork effect={effect} />
  ) : (
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
