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

const SNAPSHOT_TIMEOUT_MS = 5000;

function useMusicSession(enabled = true) {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [initialized, setInitialized] = useState(!native || !enabled);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const latest = useRef(emptySnapshot);
  const requestedSnapshot = useRef(0);
  const acceptedSnapshot = useRef(0);
  const pollingError = useRef<string | null>(null);
  const accept = ({ value: next, sequence }: { value: typeof emptySnapshot; sequence: number }) => {
    if (sequence < acceptedSnapshot.current) return;
    acceptedSnapshot.current = sequence;
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
    setInitialized(true);
    setMusicProvider(next.account?.provider ?? next.login.provider ?? next.providers[0]?.id ?? "");
    setSnapshot(next);
  };
  const readSnapshot = async () => {
    const sequence = ++requestedSnapshot.current;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        musicClient.snapshot(latest.current.playback.queueRevision),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("音乐状态更新超时，正在重新获取…")), SNAPSHOT_TIMEOUT_MS);
        }),
      ]);
      return { value, sequence };
    } finally {
      clearTimeout(timeout);
    }
  };
  const epoch = useRef(0);
  useEffect(() => {
    if (!native || !enabled) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const value = await readSnapshot();
        if (!disposed) {
          accept(value);
          const previousError = pollingError.current;
          pollingError.current = null;
          if (previousError) setError((current) => current === previousError ? null : current);
        }
      } catch (e) {
        if (!disposed) {
          pollingError.current = describeError(e);
          setError(pollingError.current);
        }
      } finally {
        if (!disposed) setInitialized(true);
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
    initialized,
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
const MusicReadyContext = createContext(!native);
export function useMusicInitialized() {
  return useContext(MusicReadyContext);
}
export function MusicProvider({ children }: { children: ReactNode }) {
  const music = useMusicSession();
  return createElement(MusicContext.Provider, { value: music },
    createElement(MusicReadyContext.Provider, { value: music.initialized }, children),
  );
}
/** Standalone views remain usable in fixtures; the workspace shares one subscription. */
export function useMusic() {
  const shared = useContext(MusicContext);
  const standalone = useMusicSession(!shared);
  return shared ?? standalone;
}
