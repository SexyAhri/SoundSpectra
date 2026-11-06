import { useCallback, useEffect, useRef, useState } from "react";
import {
  addRailPaths,
  detachRailItem,
  loadRail,
  mutateRail,
  pasteRailImage,
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
    alive = useRef(true),
    revision = useRef(0),
    eventRevision = useRef(0),
    refreshRequest = useRef(0);
  const accept = useCallback((value: RailSnapshot) => {
    if (alive.current) {
      revision.current++;
      setSnapshot(value);
      setLoaded(true);
    }
  }, []);
  const refresh = useCallback(async () => {
    const request = ++refreshRequest.current;
    const startedAt = revision.current;
    const current = () => alive.current && request === refreshRequest.current
      && startedAt === revision.current;
    try {
      const value = await loadRail();
      if (!current()) return;
      accept(value);
      if (alive.current) setError(null);
    } catch (error) {
      if (current()) setError(String(error));
    }
  }, [accept]);
  useEffect(() => {
    alive.current = true;
    let disposed = false,
      stop: (() => void) | undefined;
    // Subscribe before reading so a change between startup and the first
    // snapshot cannot be missed or replaced by an older request.
    void subscribeRail(value => {
      if (!disposed) { eventRevision.current++; accept(value); }
    })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((error) => {
        if (!disposed) setError(String(error));
      })
      .finally(() => { if (!disposed) void refresh() });
    return () => {
      alive.current = false;
      revision.current++;
      refreshRequest.current++;
      disposed = true;
      stop?.();
    };
  }, [accept, refresh]);
  const run = useCallback(
    (operation: () => Promise<RailSnapshot>) => {
      revision.current++;
      setPending((value) => value + 1);
      const task = queue.current
        .then(async () => {
          const startedAt = eventRevision.current;
          const value = await operation();
          // Another window or recovery broadcast can arrive before this IPC reply.
          // Keep that newer snapshot instead of rolling layout and missing targets back.
          if (startedAt === eventRevision.current) {
            accept(value);
          }
          if (alive.current) setError(null);
          return value;
        })
        .catch((reason) => {
          if (alive.current) setError(String(reason));
          throw reason;
        })
        .finally(() => {
          if (alive.current) setPending((value) => value - 1);
        });
      queue.current = task.then(
        () => {},
        () => {},
      );
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
  const pasteImage = useCallback(
    (groupId: string) => run(() => pasteRailImage(groupId)),
    [run],
  );
  const detach = useCallback((id: string) => run(() => detachRailItem(id)), [run]);
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
    pasteImage,
    detach,
    pick,
    refresh,
    flush,
  };
}
export type RailController = ReturnType<typeof useRail>;
