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
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);
  const committing = useRef(false);

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
    const poll = async () => {
      try {
        const value = await getStatus();
        if (!disposed) setStatus(value);
      } catch (reason) {
        if (!disposed)
          setStatus({
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

  const update: SettingsUpdate = useCallback((change: Parameters<SettingsUpdate>[0]) => {
    if (committing.current) return; // Same lock as the disabled scene controls.
    const patch = typeof change === 'function' ? change(latest.current) : change;
    const next = { ...latest.current, ...patch };
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

  const edit = async () => {
    setBusy(true);
    try {
      await queue.current;
      const saved = await setEditing(!status.editing);
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
  const flush = async () => {
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
  };
  const commitScene = async (patch: Partial<SceneLayout>) => {
    if (!loaded || committing.current) throw new Error("设置正在处理，请稍后重试。");
    committing.current = true;
    setBusy(true);
    // Scene commits and close/backup flushes share the ordinary save queue.
    // A flush must never write the previous scene while this save is in flight.
    const task = queue.current.then(async () => {
      setSaveState("saving");
      const saved = await applyDesktopScene(patch, latest.current);
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
  return { settings, status, loaded, busy, saveState, error, update, edit, recover, flush, commitScene };
}
