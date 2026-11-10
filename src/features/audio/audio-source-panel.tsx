import { Hint } from "@/components/ui/hint";
import { useEffect, useRef, useState } from "react";
import { Headphones, RefreshCw } from "lucide-react";
import { ChoiceSelect } from "@/components/ui/choice-select";
import { Button } from "@/components/ui/button";
import { native } from "../spectrum/bridge";
import { musicClient } from "../music/client";
import type { RuntimeStatus } from "../spectrum/model";
import {
  getAudioSources,
  setAudioSource,
  sourceOptions,
  sourceKey,
  sourceFromKey,
  type AudioSource,
  type AudioSources,
} from "./audio-sources";
import "./audio-source.css";

export function AudioSourcePanel({
  status,
  active,
}: {
  status: RuntimeStatus;
  active: boolean;
}) {
  const [snapshot, setSnapshot] = useState<AudioSources | null>(null);
  const [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  const pending = useRef(false),
    revision = useRef(0),
    mounted = useRef(false);
  const lastAttempt = useRef<AudioSource | null>(null);
  useEffect(() => {
    mounted.current = true;
    const changed = () => setRetry((value) => value + 1);
    window.addEventListener("music-source-change", changed);
    return () => {
      mounted.current = false;
      window.removeEventListener("music-source-change", changed);
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      const epoch = revision.current;
      if (!pending.current && !document.hidden) {
        try {
          const next = await getAudioSources();
          if (!cancelled && epoch === revision.current && !pending.current) {
            setSnapshot(next);
            if (!lastAttempt.current) setError(null);
          }
        } catch (reason) {
          if (!cancelled && epoch === revision.current)
            setError(String(reason));
        }
      }
      if (!cancelled) timer = setTimeout(read, 2000);
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, retry]);
  const save = async (selection: AudioSource) => {
    if (pending.current) return;
    pending.current = true;
    revision.current++;
    lastAttempt.current = selection;
    setSaving(true);
    setError(null);
    try {
      const saved = await setAudioSource(selection);
      if (mounted.current) {
        setSnapshot((current) =>
          current
            ? {
                ...current,
                selection: saved,
                error: null,
                builtin: current.builtin && {
                  ...current.builtin,
                  active: false,
                },
              }
            : current,
        );
        lastAttempt.current = null;
        setError(null);
        setRetry((value) => value + 1);
      }
    } catch (reason) {
      if (mounted.current) setError(`音源保存失败：${String(reason)}`);
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const running = status.state === "listening";
  const resumeBuiltin = async () => {
    if (pending.current) return;
    location.hash = "music";
    if (!snapshot?.builtin?.resumable) return;
    pending.current = true;
    revision.current++;
    setSaving(true);
    try {
      await musicClient.control("play");
      setSnapshot(await getAudioSources());
      setError(null);
    } catch (reason) {
      setError(`恢复内置播放失败：${String(reason)}`);
    } finally {
      pending.current = false;
      setSaving(false);
      setRetry((value) => value + 1);
    }
  };
  const message = !native
    ? "仅预览设置"
    : saving
      ? "正在切换"
      : status.state === "error"
        ? "连接异常"
        : status.state === "connecting"
          ? "连接中"
          : running
            ? "正在播放"
            : status.state === "silent"
              ? "已连接 · 静音"
              : "等待启动";
  const problem =
    error ??
    snapshot?.error ??
    (native && status.state === "error" ? status.message : null);
  const kugou =
    snapshot?.selection.mode === "player"
      ? snapshot.selection.id === "kugou"
      : snapshot?.selection.mode === "auto" &&
        (status.sourceName === "酷狗音乐" ||
          snapshot.discovery.targets.some(
            (target) =>
              target.pid === status.processId && target.playerId === "kugou",
          ));
  const sync = kugou && native ? snapshot?.kugouSync : undefined;
  const syncMessage =
    sync?.phase === "ready"
      ? "增强同步"
      : sync?.phase === "restarting"
        ? "正在重启以启用同步"
        : sync?.phase === "starting"
          ? "正在启动酷狗"
          : sync?.phase === "connecting"
            ? "正在连接同步"
            : sync?.phase === "unavailable"
              ? "兼容同步"
              : message;
  const statusText = `${native && (status.sourceName || kugou) ? `${status.sourceName || "酷狗音乐"} · ` : ""}${syncMessage}`;
  const sourceDetail = [statusText, sync?.message || status.message]
    .filter(Boolean)
    .join("\n");
  const indicator = problem
    ? "error"
    : saving || status.state === "connecting"
      ? "connecting"
      : native && (running || status.state === "silent")
        ? "connected"
        : "idle";
  return (
    <section
      className="source-section audio-source-panel"
      aria-label="音频来源"
    >
      <Hint text={sourceDetail}>
        <div className="audio-source-choice">
          <span
            className="audio-source-indicator"
            data-state={indicator}
            aria-hidden="true"
          >
            <Headphones size={16} />
            <i />
          </span>
          {snapshot ? (
            <ChoiceSelect
              label="音乐来源"
              value={
                snapshot.builtin?.active
                  ? "builtin"
                  : sourceKey(snapshot.selection)
              }
              options={sourceOptions(snapshot)}
              disabled={saving}
              onChange={(value) =>
                value === "builtin"
                  ? void resumeBuiltin()
                  : void save(sourceFromKey(value))
              }
            />
          ) : (
            <span className="source-placeholder">正在读取…</span>
          )}
        </div>
      </Hint>
      <span className="source-status" role="status">
        {statusText}
      </span>
      {problem && (
        <div className="audio-source-message">
          <p role="alert">{problem}</p>
          {snapshot?.error ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => void save({ mode: "auto" })}
            >
              备份并使用自动识别
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() =>
                lastAttempt.current
                  ? void save(lastAttempt.current)
                  : setRetry((value) => value + 1)
              }
            >
              <RefreshCw size={12} />
              重试音源
            </Button>
          )}
        </div>
      )}
      {snapshot?.discovery.warning && (
        <p className="audio-source-message">{snapshot.discovery.warning}</p>
      )}
      {snapshot?.selection.mode === "process" && (
        <p className="audio-source-message">
          采集所选应用及子进程；若选择浏览器，会包含该进程树内其他标签页的声音。
        </p>
      )}
    </section>
  );
}
