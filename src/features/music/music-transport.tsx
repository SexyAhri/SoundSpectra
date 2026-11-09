import { useState } from "react";
import {
  ListMusic,
  ListOrdered,
  LoaderCircle,
  MicVocal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MusicCover } from "./music-cover";
import { type Playback } from "./types";
import { MusicProgress } from "./music-progress";

const modes = {
  sequence: { label: "顺序播放", icon: ListOrdered },
  loop: { label: "列表循环", icon: Repeat },
  single: { label: "单曲循环", icon: Repeat1 },
  shuffle: { label: "随机播放", icon: Shuffle },
};

export function MusicTransport({
  playback: p,
  command,
  panel,
  onPanel,
}: {
  playback: Playback;
  busy: boolean;
  command: (action: string, value?: number) => void;
  panel: "queue" | "lyrics" | null;
  onPanel: (panel: "queue" | "lyrics") => void;
}) {
  const current = p.queue[p.index];
  const quality = p.quality;
  const details = quality
    ? [
        quality.codec,
        quality.bitDepth && `${quality.bitDepth}bit`,
        quality.sampleRate && `${quality.sampleRate / 1000}kHz`,
        quality.channels && `${quality.channels} 声道`,
        !quality.bitDepth &&
          quality.bitrate &&
          `约 ${Math.round(quality.bitrate / 1000)}kbps`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const mode = modes[p.mode] ?? modes.sequence;
  const ModeIcon = mode.icon;
  const [volume, setVolume] = useState<number | null>(null);
  const silent = p.muted || p.volume === 0;
  const commitVolume = (value: number) => {
    command("volume", value);
    setVolume(null);
  };
  return (
    <footer className="library-player" aria-label="音乐播放栏">
      <div className="library-playing-track">
        <MusicCover src={current?.cover} small />
        <div className="library-track-info">
          <strong title={current?.title}>
            {current?.title ?? "选择一首歌曲开始播放"}
          </strong>
          <span
            title={
              p.suspended
                ? "点击播放即可从保留的进度恢复内置音源"
                : current?.artist
            }
          >
            {p.suspended
              ? "外部音源中 · 点击播放恢复内置音源"
              : (current?.artist ?? "音频与歌词自动缓存 · 7 天未播清理")}
          </span>
          {quality ? (
            <small
              className="library-quality"
              aria-label="当前播放音质"
              title={["自动选择最高可用音质", details, quality.fallback]
                .filter(Boolean)
                .join("\n")}
            >
              <b>{quality.label}</b>
              <span>{details}</span>
              {quality.fallback && <em>已自动降级</em>}
            </small>
          ) : null}
        </div>
      </div>
      <div className="library-transport">
        <div className="library-transport-buttons">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`播放模式：${mode.label}`}
            title={`${mode.label} · 点击切换`}
            onClick={() => command("mode")}
          >
            <ModeIcon size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="上一首"
            title="上一首"
            disabled={!p.canPrevious}
            onClick={() => command("previous")}
          >
            <SkipBack size={19} />
          </Button>
          <Button
            className="library-main-play"
            size="icon-lg"
            aria-label={p.playing ? "暂停" : "播放"}
            title={p.suspended ? "恢复内置播放" : p.playing ? "暂停" : "播放"}
            disabled={!current}
            onClick={() =>
              command(
                p.playing ? "pause" : p.phase === "error" ? "retry" : "play",
              )
            }
          >
            {p.phase === "loading" ? (
              <LoaderCircle className="spinning" size={20} />
            ) : p.playing ? (
              <Pause size={20} />
            ) : (
              <Play size={20} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="下一首"
            title="下一首"
            disabled={!p.canNext}
            onClick={() => command("next")}
          >
            <SkipForward size={19} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="切回外部音源"
            title="切回外部音源，保留歌曲和播放进度"
            disabled={!current || p.suspended}
            onClick={() => command("stop")}
          >
            <Square size={14} />
          </Button>
        </div>
        <MusicProgress playback={p} command={command} />
      </div>
      <div className="library-player-tools">
        <Button
          variant="ghost"
          size="icon-sm"
          data-music-panel-toggle
          aria-label="歌曲歌词"
          title="查看歌词 · 点击歌词跳转进度"
          aria-pressed={panel === "lyrics"}
          onClick={() => onPanel("lyrics")}
        >
          <MicVocal size={18} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          data-music-panel-toggle
          className="library-queue-toggle"
          aria-label="播放队列"
          aria-pressed={panel === "queue"}
          title={`播放队列 · ${p.queue.length} 首`}
          onClick={() => onPanel("queue")}
        >
          <ListMusic size={19} />
          <small>{p.queue.length}</small>
        </Button>
        <div className="library-volume">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={silent ? "取消静音" : "静音"}
            title={silent ? "取消静音" : "静音"}
            aria-pressed={silent}
            onClick={() => command("mute")}
          >
            {silent ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </Button>
          <input
            aria-label="播放音量"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={volume ?? p.volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            onPointerUp={(e) => commitVolume(Number(e.currentTarget.value))}
            onKeyUp={(e) => commitVolume(Number(e.currentTarget.value))}
            onPointerCancel={() => setVolume(null)}
          />
        </div>
      </div>
    </footer>
  );
}
