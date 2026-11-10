import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  createElement,
  type ReactNode,
} from "react";
import { native, describeError } from "../spectrum/bridge";
import { musicClient, setMusicProvider } from "./client";
import { emptySnapshot } from "./types";

function useMusicSession(enabled = true) {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const latest = useRef(emptySnapshot);
  const accept = (next: typeof emptySnapshot) => {
    if (next.playback.queueUnchanged)
      next = {
        ...next,
        playback: {
          ...next.playback,
          queue: latest.current.playback.queue,
          entryIds: latest.current.playback.entryIds,
        },
      };
    latest.current = next;
    setMusicProvider(next.account?.provider ?? next.providers[0]?.id ?? "");
    setSnapshot(next);
  };
  const readSnapshot = () =>
    musicClient.snapshot(latest.current.playback.queueRevision);
  const epoch = useRef(0);
  useEffect(() => {
    if (!native || !enabled) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await readSnapshot();
        if (!disposed) accept(value);
      } catch (e) {
        if (!disposed) setError(describeError(e));
      }
      if (!disposed) timer = setTimeout(read, 650);
    };
    void read();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [enabled]);
  const perform = async (action: () => Promise<unknown>) => {
    const request = ++epoch.current;
    setBusy(true);
    setError(null);
    try {
      await action();
      const value = await readSnapshot();
      if (request === epoch.current) accept(value);
    } catch (e) {
      if (request === epoch.current) setError(describeError(e));
    } finally {
      if (request === epoch.current) {
        setBusy(false);
      }
    }
  };
  return {
    snapshot,
    error,
    setError,
    busy,
    perform,
    command: (action: string, value?: number) => {
      void perform(() => musicClient.control(action, value));
    },
  };
}

const MusicContext = createContext<ReturnType<typeof useMusicSession> | null>(
  null,
);
export function MusicProvider({ children }: { children: ReactNode }) {
  const music = useMusicSession();
  return createElement(MusicContext.Provider, { value: music }, children);
}
/** Standalone views remain usable in fixtures; the workspace shares one subscription. */
export function useMusic() {
  const shared = useContext(MusicContext);
  const standalone = useMusicSession(!shared);
  return shared ?? standalone;
}
