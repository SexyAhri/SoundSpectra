import { DropdownMenu } from "radix-ui";
import {
  Play,
  ListStart,
  ListPlus,
  ImagePlus,
  MoreHorizontal,
  AudioLines,
  Pause,
  FileText,
} from "lucide-react";
import { ContextMenu, type ContextAction } from "@/components/ui/context-menu";
import { MusicButton, MusicHint } from "./music-hint";
import { MusicCover } from "./music-cover";
import { musicClient } from "./client";
import { clock, trackKey, type Track } from "./types";

export function LibraryTrackRow({
  track: t,
  index,
  current,
  playing = false,
  selected,
  density,
  onSelect,
  onPlay,
  perform,
  playable = true,
  onLyrics,
}: {
  track: Track;
  index: number;
  current: boolean;
  playing?: boolean;
  selected: boolean;
  density: string;
  onSelect: () => void;
  onPlay: () => void;
  perform: (action: () => Promise<unknown>) => Promise<void>;
  playable?: boolean;
  onLyrics?: () => void;
}) {
  const append = (next: boolean) =>
    void perform(() =>
      musicClient.edit({ action: "append", ids: [trackKey(t)], next }),
    );
  const actions: ContextAction[] = [
    { id: "play", label: "立即播放", icon: <Play size={15} />, run: onPlay },
    {
      id: "next",
      label: "下一首播放",
      icon: <ListStart size={15} />,
      run: () => append(true),
    },
    {
      id: "append",
      label: "加入队列",
      icon: <ListPlus size={15} />,
      run: () => append(false),
    },
    {
      id: "cover",
      label: "重新加载封面",
      icon: <ImagePlus size={15} />,
      separator: true,
      disabled: !t.cover,
      run: () =>
        window.dispatchEvent(
          new CustomEvent("music-cover-retry", { detail: t.cover }),
        ),
    },
  ];
  if (!playable) actions.splice(0, 3, ...(onLyrics ? [{ id: "lyrics", label: "查看歌词", icon: <FileText size={15} />, run: onLyrics }] : []));
  else if (onLyrics) actions.splice(3, 0, { id: "lyrics", label: "查看歌词", icon: <FileText size={15} />, run: onLyrics });
  const heading = (
    <span className="library-context-track">
      <MusicCover src={t.cover} small />
      <span>
        <strong>{t.title}</strong>
        <small>{t.artist}</small>
      </span>
    </span>
  );
  return (
    <ContextMenu
      className="library-context-menu"
      title={heading}
      actions={actions}
    >
      <div
        className={`library-track-row ${current ? "current" : ""} ${selected ? "selected" : ""}`}
        data-density={density}
      >
        <button
          className="library-track"
          aria-current={current ? "true" : undefined}
          aria-pressed={selected}
          onFocus={onSelect}
          onClick={onSelect}
          onDoubleClick={playable ? onPlay : onLyrics}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (playable) onPlay(); else onLyrics?.();
            }
          }}
        >
          <span>
            {current ? (
              playing ? (
                <AudioLines size={15} aria-label="正在播放" />
              ) : (
                <Pause size={15} aria-label="当前歌曲已暂停" />
              )
            ) : (
              index + 1
            )}
          </span>
          <span className="library-track-title">
            <MusicCover src={t.cover} small />
            <span>
              <MusicHint text={t.title}>
                <strong>
                  {t.title}
                  {t.paid && <em>VIP</em>}
                </strong>
              </MusicHint>
              <small>{t.artist}</small>
            </span>
          </span>
          <span className="library-track-album">{t.album}</span>
          <span>{clock(t.duration)}</span>
        </button>
        <div className="library-row-actions">
          <MusicButton
            variant="ghost"
            size="icon-sm"
            aria-label={playable ? `播放 ${t.title}` : `查看 ${t.title} 歌词`}
            disabled={!playable && !onLyrics}
            onClick={playable ? onPlay : onLyrics}
          >
            {playable ? <Play size={15} /> : <FileText size={15} />}
          </MusicButton>
          {playable && <MusicButton
            variant="ghost"
            size="icon-sm"
            aria-label={`下一首播放 ${t.title}`}
            onClick={() => append(true)}
          >
            <ListStart size={15} />
          </MusicButton>}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <MusicButton
                variant="ghost"
                size="icon-sm"
                aria-label={`${t.title} 更多操作`}
              >
                <MoreHorizontal size={16} />
              </MusicButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                className="context-menu library-context-menu"
                collisionPadding={12}
                sideOffset={6}
              >
                <DropdownMenu.Label className="context-menu-label">
                  {heading}
                </DropdownMenu.Label>
                {actions.map((action) => (
                  <DropdownMenu.Item
                    key={action.id}
                    className="context-menu-item"
                    disabled={action.disabled}
                    onSelect={action.run}
                  >
                    {action.icon}
                    {action.label}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </ContextMenu>
  );
}
