import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { describeError, native } from "../spectrum/bridge";
import { backupConfiguration } from "./client";

type Phase =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";
export interface UpdateState {
  phase: Phase;
  version?: string;
  notes?: string;
  received: number;
  total?: number;
  error?: string;
  errorSource?: "check" | "download" | "install";
}
export function useUpdater(
  configured: boolean,
  automatic: boolean,
  automaticInstall: boolean,
  beforeInstall: () => Promise<void>,
) {
  const [state, setState] = useState<UpdateState>({
    phase: "idle",
    received: 0,
  });
  const latest = useRef(state);
  latest.current = state;
  const update = useRef<Update | null>(null),
    busy = useRef(false),
    alive = useRef(true);
  const save = useRef(beforeInstall);
  save.current = beforeInstall;
  const installVerified = useCallback(async () => {
    if (!alive.current || !update.current) return;
    setState((s) => ({
      ...s,
      phase: "installing",
      error: undefined,
      errorSource: undefined,
    }));
    await save.current();
    await backupConfiguration();
    if (!alive.current) return;
    await update.current.install({ restartAfterInstall: true });
    // Windows exits inside the installer plugin. macOS must explicitly relaunch.
    await invoke("restart_after_update");
  }, []);
  const download = useCallback(
    async (installAfterDownload = false) => {
      if (!update.current || busy.current) return;
      busy.current = true;
      let verified = false;
      setState((s) => ({
        ...s,
        phase: "downloading",
        received: 0,
        total: undefined,
        error: undefined,
        errorSource: undefined,
      }));
      try {
        await update.current.download(
          (event) => {
            if (!alive.current) return;
            if (event.event === "Started")
              setState((s) => ({ ...s, total: event.data.contentLength }));
            if (event.event === "Progress")
              setState((s) => ({
                ...s,
                received: s.received + event.data.chunkLength,
              }));
          },
          { timeout: 120000 },
        );
        verified = true;
        if (alive.current) {
          setState((s) => ({ ...s, phase: "ready" }));
          if (installAfterDownload) await installVerified();
        }
      } catch (error) {
        if (alive.current)
          setState((s) => ({
            ...s,
            phase: verified ? "ready" : "available",
            error: describeError(error),
            errorSource: verified ? "install" : "download",
          }));
      } finally {
        busy.current = false;
      }
    },
    [installVerified],
  );
  const checkNow = useCallback(
    async (installAutomatically = false, refresh = true) => {
      if (
        !native ||
        !configured ||
        busy.current ||
        (!refresh && update.current)
      )
        return;
      busy.current = true;
      const previous = update.current,
        previousState = latest.current;
      setState((s) => ({
        ...s,
        phase: "checking",
        error: undefined,
        errorSource: undefined,
      }));
      try {
        const next = await check({ timeout: 15000 });
        if (!alive.current) {
          await next?.close();
          return;
        }
        if (
          previous &&
          next?.version === previous.version &&
          previousState.phase === "ready"
        ) {
          // A fresh check must not discard the verified download for this version.
          await next.close().catch(() => {});
          setState({
            ...previousState,
            error: undefined,
            errorSource: undefined,
          });
        } else {
          update.current = next;
          await previous?.close().catch(() => {});
          setState(
            next
              ? {
                  phase: "available",
                  version: next.version,
                  notes: next.body,
                  received: 0,
                }
              : { phase: "current", received: 0 },
          );
        }
      } catch (error) {
        if (alive.current)
          setState(
            previous
              ? {
                  ...previousState,
                  error: describeError(error),
                  errorSource: "check",
                }
              : {
                  phase: "error",
                  received: 0,
                  error: describeError(error),
                  errorSource: "check",
                },
          );
      } finally {
        busy.current = false;
      }
      if (installAutomatically && alive.current && update.current)
        await download(true);
    },
    [configured, download],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void update.current?.close().catch(() => {});
      update.current = null;
    };
  }, []);
  useEffect(() => {
    if (!automatic || !configured) return;
    const start = setTimeout(() => void checkNow(automaticInstall, false), 0);
    const repeat = setInterval(
      () => void checkNow(automaticInstall, false),
      6 * 60 * 60 * 1000,
    );
    return () => {
      clearTimeout(start);
      clearInterval(repeat);
    };
  }, [automatic, automaticInstall, configured, checkNow]);
  const install = async () => {
    if (!update.current || busy.current || state.phase !== "ready") return;
    busy.current = true;
    try {
      await installVerified();
    } catch (error) {
      if (alive.current)
        setState((s) => ({
          ...s,
          phase: "ready",
          error: describeError(error),
          errorSource: "install",
        }));
    } finally {
      busy.current = false;
    }
  };
  return { state, checkNow, download, install };
}
