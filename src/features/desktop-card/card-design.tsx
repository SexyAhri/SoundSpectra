import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import type { DesktopCardSettings } from "../spectrum/model";
import type { NowPlaying } from "./use-now-playing";
import { cardTrackKey, useCardCover } from "./card-presentation";
import { useCardClock } from "./card-clock";
import { CardMeter } from "./card-meter";
import { CardTransport } from "./card-transport";
import { mixColor } from "./cover-colors";
import { luminance } from "../preview/wallpaper-palette";
import { CardFace } from "./card-face";
import { CardArtwork } from "./card-artwork";

export function MusicCard({
  info,
  settings,
  color,
  bands,
  receivedAt,
  demo = false,
  active = true,
  desktop = false,
  controlsDisabled = false,
  controlsOnly = false,
}: {
  info: NowPlaying;
  settings: DesktopCardSettings;
  color: string;
  bands: RefObject<Float32Array>;
  receivedAt: RefObject<number>;
  demo?: boolean;
  active?: boolean;
  desktop?: boolean;
  controlsDisabled?: boolean;
  controlsOnly?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const cover = useCardCover(controlsOnly ? { ...info, cover: null } : info);
  const key = cardTrackKey(info);
  const previous = useRef(key);
  const [expiredAt, setExpiredAt] = useState(0);
  useEffect(() => {
    if (!info.updated) return;
    const timer = window.setTimeout(
      () => setExpiredAt(info.updated),
      Math.max(0, 4001 - (Date.now() - info.updated)),
    );
    return () => clearTimeout(timer);
  }, [info.updated]);
  useCardClock(
    info,
    root,
    active && !controlsOnly,
    desktop,
    demo,
    settings.variant,
  );
  useLayoutEffect(() => {
    if (previous.current === key) return;
    previous.current = key;
    const nodes =
      !active || controlsOnly
        ? undefined
        : root.current?.querySelectorAll(
            ".mc-title, .mc-artist, .mc-sleeve, .mc-square, .mc-paper-photo, .mc-float-cover",
          );
    nodes?.forEach((node) => {
      node.getAnimations().forEach((animation) => animation.cancel());
      node.animate(
        [
          { opacity: 0.3, filter: "blur(2px)" },
          { opacity: 1, filter: "blur(0)" },
        ],
        { duration: 420, easing: "cubic-bezier(.2,.7,.2,1)" },
      );
    });
  }, [key, active, controlsOnly]);
  const standby =
    !info.title && !info.artist && !info.album && !info.source && !info.issue;
  const title =
    info.title || info.source || (demo ? "音乐信息预览" : "等一首好歌");
  const artist =
    info.artist ||
    (!info.title
      ? info.source
        ? "播放器未提供歌曲信息"
        : "打开播放器，开始聆听"
      : "");
  const stale =
    !info.updated ||
    expiredAt === info.updated ||
    Date.now() - info.updated > 4000;
  const reportedPlaying =
    info.playing && info.playbackAvailable !== false && !stale && !info.issue;
  const status = demo
    ? "模拟预览"
    : info.issue
      ? "连接中"
      : info.source && (info.playbackAvailable === false || stale)
        ? "媒体状态待确认"
        : reportedPlaying
          ? "播放中"
          : info.source
            ? "已暂停"
            : "音乐待机";
  const art = <CardArtwork variant={settings.variant} cover={cover} />;
  const state = standby
    ? "standby"
    : reportedPlaying
      ? "playing"
      : info.issue || stale || info.playbackAvailable === false
        ? "unavailable"
        : "paused";
  const meter = (
    <CardMeter
      {...{ bands, receivedAt, desktop, demo }}
      active={active && !controlsOnly && !standby}
      variant={settings.variant}
    />
  );
  const accent = settings.accentColor || color;
  const buttonFill = mixColor(accent, "#f8f3e9", 0.23);
  const buttonInk =
    luminance(
      [1, 3, 5].map(
        (index) => parseInt(buttonFill.slice(index, index + 2), 16) / 255,
      ) as [number, number, number],
    ) > 0.19
      ? "#14272c"
      : "#fffdf3";
  return (
    <article
      ref={root}
      className={`music-card music-card-${settings.variant} mc mc-${settings.variant}`}
      data-playing={reportedPlaying && !demo && active && !controlsOnly}
      data-active={active}
      data-state={state}
      data-ambient={active && !controlsOnly && !demo}
      data-track={key}
      data-color-mode={settings.accentColor ? "fixed" : "scene"}
      aria-label="桌面音乐信息卡"
      style={
        {
          "--mc-accent": accent,
          "--mc-button-fill": buttonFill,
          "--mc-button-ink": buttonInk,
        } as CSSProperties
      }
    >
      <CardFace
        variant={settings.variant}
        info={info}
        art={art}
        title={title}
        artist={artist}
        status={status}
        standby={standby}
        transport={
          <CardTransport
            info={info}
            disabled={controlsDisabled || !active || stale}
            demo={demo}
          />
        }
        meter={meter}
      />
    </article>
  );
}
