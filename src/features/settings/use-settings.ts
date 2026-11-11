import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserStatus,
  defaults,
  type RuntimeStatus,
  type SpectrumSettings,
  type SettingsUpdate,
} from "../spectrum/model";
import {
  describeError,
  getStatus,
  loadSettings,
  resetSettings,
  saveSettings,
  setEditing,
  subscribeGeometry,
} from "../spectrum/bridge";
import { applyDesktopScene } from '../preview/scene-client';
import type { SceneLayout } from '../preview/scene-library';
import { SettingsHistory } from './settings-history';

function sameStatus(previous: RuntimeStatus, next: RuntimeStatus) {
  return previous.state === next.state &&
    previous.message === next.message &&
    previous.processId === next.processId &&
    previous.sourceName === next.sourceName &&
    previous.desktopAttached === next.desktopAttached &&
    previous.editing === next.editing &&
    previous.desktopError === next.desktopError;
}

export function useSettings() {
  const [settings, setSettings] = useState<SpectrumSettings>(
    structuredClone(defaults),
  );
  const [status, setStatus] = useState<RuntimeStatus>(browserStatus);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">(
    "saved",
  );
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(settings);
  const latestStatus = useRef(status);
  latestStatus.current = status;
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);
  const committing = useRef(false);
  const history = useRef(new SettingsHistory());
  const [, refreshHistory] = useState(0);
  const historyChanged = () => refreshHistory(value => value + 1);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    loadSettings()
      .then((value) => {
        if (!disposed) {
          latest.current = value;
          setSettings(value);
          setLoaded(true);
        }
      })
      .catch((reason) => {
        if (!disposed) {
          setError(describeError(reason));
          setSaveState("error");
        }
      });
    subscribeGeometry((value) => {
      if (!disposed && value.bounds) {
        history.current.clear(); historyChanged();
        // Only external geometry changes are broadcast; local pending appearance edits remain intact.
        setSettings((previous) => {
          const next = { ...previous, bounds: value.bounds };
          latest.current = next;
          return next;
        });
      }
    })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else stop = unsubscribe;
      })
      .catch((reason) => {
        if (!disposed) setError(describeError(reason));
      });
    let timer: ReturnType<typeof setTimeout>;
    const publishStatus = (value: RuntimeStatus) => {
      if (!disposed && !sameStatus(latestStatus.current, value)) {
        latestStatus.current = value;
        setStatus(value);
      }
    };
    const poll = async () => {
      try {
        const value = await getStatus();
        publishStatus(value);
      } catch (reason) {
        publishStatus({
          ...browserStatus,
          state: "error",
          message: describeError(reason),
        });
      }
      if (!disposed) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => {
      disposed = true;
      stop?.();
      clearTimeout(timer);
    };
  }, []);

  const persist = useCallback((change: Parameters<SettingsUpdate>[0], remember = true) => {
    if (committing.current) return; // Same lock as the disabled scene controls.
    const patch = typeof change === 'function' ? change(latest.current) : change;
    const next = { ...latest.current, ...patch };
    if (remember) { history.current.record(latest.current, next); historyChanged(); }
    latest.current = next;
    setSettings(next);
    setSaveState("saving");
    const version = ++revision.current;
    queue.current = queue.current.then(async () => {
      // Coalesce slider changes waiting behind a previous write.
      if (version !== revision.current) return;
      try {
        const saved = await saveSettings(next);
        if (version === revision.current) {
          latest.current = saved;
          setSettings(saved);
          setSaveState("saved");
          setError(null);
        }
      } catch (reason) {
        if (version === revision.current) {
          setSaveState("error");
          setError(describeError(reason));
          // Keep appearance edits for retry, but do not claim the desktop operation succeeded.
          if ("enabled" in patch) {
            latest.current = { ...next, enabled: !patch.enabled };
            setSettings(latest.current);
          }
        }
      }
    });
  }, []);
  const update: SettingsUpdate = useCallback(change => persist(change), [persist]);
  const undo = useCallback(() => {
    if (committing.current || !loaded || status.editing) return;
    const patch = history.current.undo(latest.current);
    if (patch) { persist(patch, false); historyChanged(); }
  }, [persist, loaded, status.editing]);
  const redo = useCallback(() => {
    if (committing.current || !loaded || status.editing) return;
    const patch = history.current.redo(latest.current);
    if (patch) { persist(patch, false); historyChanged(); }
  }, [persist, loaded, status.editing]);

  const edit = async () => {
    setBusy(true);
    try {
      await queue.current;
      const saved = await setEditing(!status.editing);
      history.current.clear(); historyChanged();
      latest.current = saved;
      setSettings(saved);
      setStatus(await getStatus());
      setError(null);
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };

  const recover = async () => {
    setBusy(true);
    try {
      const saved = await resetSettings();
      history.current.clear(); historyChanged();
      latest.current = saved;
      setSettings(saved);
      setLoaded(true);
      setSaveState("saved");
      setError(null);
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(false);
    }
  };
  const flush = useCallback(async () => {
    if (!loaded) throw new Error("设置尚未成功读取，请先处理设置错误。");
    const task = queue.current.then(async () => {
      const version = revision.current;
      const saved = await saveSettings(latest.current);
      if (version === revision.current) {
        latest.current = saved;
        setSettings(saved);
        setSaveState("saved");
        setError(null);
      }
    });
    queue.current = task.catch(() => {});
    await task;
  }, [loaded]);
  const commitScene = async (patch: Partial<SceneLayout>) => {
    if (!loaded || committing.current) throw new Error("设置正在处理，请稍后重试。");
    committing.current = true;
    setBusy(true);
    // Scene commits and close/backup flushes share the ordinary save queue.
    // A flush must never write the previous scene while this save is in flight.
    const task = queue.current.then(async () => {
      setSaveState("saving");
      const before = latest.current;
      const saved = await applyDesktopScene(patch, before);
      history.current.record(before, saved, true); historyChanged();
      revision.current++;
      latest.current = saved;
      setSettings(saved);
      setSaveState("saved");
      setError(null);
      return saved;
    });
    queue.current = task.then(() => {}, () => {});
    try {
      return await task;
    } catch (reason) {
      setSaveState("error");
      setError(describeError(reason));
      throw reason;
    } finally {
      committing.current = false;
      setBusy(false);
    }
  };
  return { settings, status, loaded, busy, saveState, error, update, edit, recover, flush, commitScene,
    undo, redo, canUndo: history.current.canUndo, canRedo: history.current.canRedo };
}
