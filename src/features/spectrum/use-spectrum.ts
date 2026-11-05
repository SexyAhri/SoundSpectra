import { useEffect, useRef, useState } from "react";
import { BAND_COUNT } from "./model";
import { describeError, subscribeBands } from "./bridge";
import { listen } from '@tauri-apps/api/event';
import { native } from './bridge';
import { silentAnalysis, type MusicAnalysis } from './music-analysis';

export function useSpectrum() {
  const bands = useRef(new Float32Array(BAND_COUNT));
  const receivedAt = useRef(0);
  const analysis = useRef({ ...silentAnalysis(), receivedAt: 0 });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    subscribeBands((values) => {
      bands.current.fill(0);
      for (let i = 0; i < Math.min(BAND_COUNT, values.length); i++) {
        bands.current[i] = Number.isFinite(values[i])
          ? Math.max(0, values[i])
          : 0;
      }
      receivedAt.current = performance.now();
    })
      .then((stop) => {
        if (disposed) stop();
        else unsubscribe = stop;
      })
      .catch((reason) => {
        if (!disposed) setError(describeError(reason));
      });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);
  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void listen<MusicAnalysis>('music-analysis', ({ payload }) => {
      if (disposed) return;
      analysis.current = { ...payload, receivedAt: performance.now() };
    }).then(unsubscribe => { if (disposed) unsubscribe(); else stop = unsubscribe; })
      .catch(reason => { if (!disposed) setError(describeError(reason)); });
    return () => { disposed = true; stop?.(); };
  }, []);
  return { bands, receivedAt, analysis, error };
}
