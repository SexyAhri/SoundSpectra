import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LoaderCircle, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { native } from "../spectrum/bridge";
import type { NowPlaying } from "./use-now-playing";

type Action = "previous" | "next" | "play" | "pause";
export function CardTransport({
  info,
  disabled = false,
  demo = false,
  supportedOnly = false,
}: {
  info: NowPlaying;
  disabled?: boolean;
  demo?: boolean;
  supportedOnly?: boolean;
}) {
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const identity = `${info.sessionId}:${info.trackId}`;
  const latest = useRef(identity);
  latest.current = identity;
  useEffect(() => {
    setError("");
  }, [identity]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 5000);
    return () => clearTimeout(timer);
  }, [error]);
  const unavailable =
    disabled ||
    demo ||
    !native ||
    !info.sessionId ||
    !info.trackId ||
    !!info.issue ||
    info.playbackAvailable === false ||
    !info.updated ||
    Date.now() - info.updated > 4000;
  const send = async (action: Action) => {
    if (busy.current || unavailable || !info.controls?.[action]) return;
    busy.current = true;
    setPending(action);
    setError("");
    const started = identity;
    try {
      await invoke("control_card_media", {
        action,
        trackId: info.trackId,
        sessionId: info.sessionId,
      });
    } catch (reason) {
      if (latest.current === started)
        setError(typeof reason === "string" ? reason : "操作未完成，请重试");
    } finally {
      busy.current = false;
      setPending(null);
    }
  };
  const toggle = info.playing ? "pause" : "play";
  return (
    <div
      className="mc-transport"
      role="group"
      aria-label="播放控制"
      aria-busy={!!pending}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {(["previous", toggle, "next"] as const).filter((action) => !supportedOnly || info.controls?.[action]).map((action) => {
        const label =
          action === "previous"
            ? "上一首"
            : action === "next"
              ? "下一首"
              : action === "pause"
                ? "暂停"
                : "播放";
        const Icon =
          pending === action
            ? LoaderCircle
            : action === "previous"
              ? SkipBack
              : action === "next"
                ? SkipForward
                : action === "pause"
                  ? Pause
                  : Play;
        const blocked = unavailable || !info.controls?.[action];
        return (
          <button
            key={action === "play" || action === "pause" ? "toggle" : action}
            type="button"
            className={`mc-control ${action === toggle ? "mc-control-primary" : ""}`}
            aria-label={label}
            disabled={blocked || !!pending}
            title={[
              demo
                ? "模拟预览，不控制播放器"
                : blocked
                  ? `${label} · 播放器暂不支持`
                  : label,
              info.title,
              info.artist,
            ]
              .filter(Boolean)
              .join("\n")}
            onClick={() => void send(action)}
          >
            <Icon
              className={pending === action ? "mc-control-loading" : undefined}
              size={15}
              strokeWidth={1.8}
            />
          </button>
        );
      })}
      <span className="mc-control-feedback" role="status" title={error}>
        {error}
      </span>
    </div>
  );
}
