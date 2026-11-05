import { useCallback, useEffect, useRef, useState } from "react";
import {
  addRailPaths,
  loadRail,
  mutateRail,
  pickRailPaths,
  subscribeRail,
} from "./client";
import { railDefaults, type RailChange, type RailSnapshot } from "./model";
export function useRail() {
  const [snapshot, setSnapshot] = useState<RailSnapshot>({
    settings: structuredClone(railDefaults),
    missing: [],
    desktopError: null,
    supported: false,
  });
  const [loaded, setLoaded] = useState(false),
    [pending, setPending] = useState(0),
    [error, setError] = useState<string | null>(null);
  const queue = useRef(Promise.resolve()),
    alive = useRef(true);
  const accept = useCallback((value: RailSnapshot) => {
    if (alive.current) {
      setSnapshot(value);
      setLoaded(true);
    }
  }, []);
  const refresh = useCallback(async () => {
    try {
      const value = await loadRail();
      accept(value);
      if (alive.current) setError(null);
    } catch (error) {
      if (alive.current) setError(String(error));
    }
  }, [accept]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    let disposed = false,
      stop: (() => void) | undefined;
    void subscribeRail(accept)
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      });
    return () => {
      alive.current = false;
      disposed = true;
      stop?.();
    };
  }, [accept, refresh]);
  const run = useCallback(
    (operation: () => Promise<RailSnapshot>) => {
      setPending((value) => value + 1);
      const task = queue.current
        .then(operation)
        .then(
          (value) => {
            accept(value);
            if (alive.current) setError(null);
            return value;
          },
          (reason) => {
            if (alive.current) setError(String(reason));
            throw reason;
          },
        )
        .finally(() => {
          if (alive.current) setPending((value) => value - 1);
        });
      queue.current = task.then(() => {}, () => {});
      return task;
    },
    [accept],
  );
  const change = useCallback(
    (change: RailChange) => run(() => mutateRail(change)),
    [run],
  );
  const add = useCallback(
    (groupId: string, paths: string[], replaceId?: string) =>
      run(() => addRailPaths(groupId, paths, replaceId)),
    [run],
  );
  const pick = useCallback(
    async (groupId: string, folder: boolean, replaceId?: string) => {
      try {
        const paths = await pickRailPaths(folder);
        if (paths.length) await add(groupId, paths, replaceId);
      } catch (reason) {
        if (alive.current) setError(String(reason));
      }
    },
    [add],
  );
  const flush = useCallback(async () => {
    await queue.current;
  }, []);
  return {
    ...snapshot,
    loaded,
    pending,
    error,
    change,
    add,
    pick,
    refresh,
    flush,
  };
}
export type RailController = ReturnType<typeof useRail>;
