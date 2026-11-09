import { useEffect } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MusicFade } from "./music-fade";

interface PlayerState {
  generation: number;
  revision: number;
  seekRevision: number;
  ready: boolean;
  playing: boolean;
  position: number;
  volume: number;
  streamUrl?: string | null;
  downloadFailed?: boolean;
  metadata?: MediaMetadataInit | null;
}

/** This window survives the library/settings window being hidden. Native owns
 * the queue, credentials and audio bytes; this renderer owns only HTMLAudio. */
export function MusicPlayer() {
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    let disposed = false,
      polling = false,
      reporting = false;
    let current: PlayerState | null = null,
      source = "",
      seek = -1;
    let failed = false;
    let starting = false;
    let releasing = false;
    let loadedGeneration = -1;
    let playAttempt = 0;
    let volume = 0;
    let metadataGeneration = -1;
    let offlineTarget: { generation: number; revision: number } | null = null;
    const media = async (action: string, value?: number) => {
      try {
        await invoke("music_media_control", { action, value: value ?? null });
      } catch {}
    };
    const fade = new MusicFade((gain) => {
      audio.volume = volume * gain;
    });
    fade.set(0);
    const buffered = () => {
      const ranges: [number, number][] = [];
      if (!audio.buffered) return ranges;
      for (let i = 0; i < Math.min(64, audio.buffered.length); i++) {
        ranges.push([audio.buffered.start(i), audio.buffered.end(i)]);
      }
      return ranges;
    };
    const report = async () => {
      if (
        disposed ||
        !current?.ready ||
        releasing ||
        current.generation !== loadedGeneration ||
        reporting ||
        (!failed && audio.readyState > 0 && seek !== current.seekRevision)
      )
        return;
      reporting = true;
      try {
        await invoke("music_player_feedback", {
          feedback: {
            generation: current.generation,
            revision: current.revision,
            position:
              audio.readyState === 0 ? current.position : audio.currentTime,
            duration: Number.isFinite(audio.duration) ? audio.duration : 0,
            playing:
              current.playing &&
              !audio.paused &&
              !audio.ended &&
              !failed &&
              audio.readyState >= 3 &&
              !audio.seeking,
            buffering:
              current.playing &&
              !failed &&
              (audio.readyState < 3 || audio.seeking),
            ended: audio.ended,
            error: failed,
            errorKind: audio.error?.code === 2 ? "network" : "decode",
            buffered: buffered(),
            seeking: !!audio.seeking,
          },
        });
      } catch {
        // Exhausted fallbacks are shown by the native playback snapshot.
      } finally {
        reporting = false;
      }
    };
    const stopAudio = () => {
      playAttempt++;
      starting = false;
      audio.pause();
    };
    const fadeOut = (done: () => void) => {
      if (audio.paused || audio.ended || audio.readyState < 3 || volume === 0) {
        fade.set(0);
        done();
      } else fade.to(0, 200, done);
    };
    const sync = () => {
      const next = current;
      if (disposed || !next) return;
      volume = Math.max(0, Math.min(1, next.volume));
      audio.volume = volume * fade.value;
      const url = next.ready
        ? (next.streamUrl ??
          `${convertFileSrc("stream", "music")}/${next.generation}`)
        : "";
      if (source && (source !== url || loadedGeneration !== next.generation)) {
        if (!releasing) {
          releasing = true;
          fadeOut(() => {
            stopAudio();
            audio.removeAttribute("src");
            audio.load();
            source = "";
            loadedGeneration = -1;
            failed = false;
            releasing = false;
            // Use the newest command, including any rapid previous/next clicks.
            sync();
          });
        }
        return;
      }
      if (!next.ready) return;
      if (releasing) {
        releasing = false;
        fade.cancel();
      }
      if (!source) {
        fade.set(0);
        audio.src = url;
        source = url;
        loadedGeneration = next.generation;
        seek = -1;
        failed = false;
      }
      if (next.downloadFailed) {
        failed = true;
        stopAudio();
        void report();
        return;
      }
      if (seek !== next.seekRevision && audio.readyState > 0) {
        audio.currentTime = next.position;
        seek = next.seekRevision;
      }
      if (!next.playing || failed) {
        fadeOut(() => {
          stopAudio();
          void report();
        });
        return;
      }
      if (!audio.paused && audio.readyState >= 3) fade.to(1, 250);
      if (audio.paused && !audio.ended && !starting) {
        // Reversing a pause must cancel its pending pause callback immediately,
        // even when play() is still waiting for data.
        fade.cancel();
        starting = true;
        const attempt = ++playAttempt;
        void audio
          .play()
          .then(() => {
            if (!disposed && attempt === playAttempt) sync();
          })
          .catch((error: unknown) => {
            if (
              !disposed &&
              attempt === playAttempt &&
              current?.generation === next.generation &&
              current.playing &&
              !(error instanceof DOMException && error.name === "AbortError")
            ) {
              failed = true;
              void report();
            }
          })
          .finally(() => {
            if (attempt === playAttempt) starting = false;
          });
      }
    };
    const poll = async () => {
      if (disposed || polling) return;
      polling = true;
      try {
        const next = await invoke<PlayerState>("music_player_state");
        if (disposed) return;
        current = next;
        if ("mediaSession" in navigator) {
          navigator.mediaSession.playbackState = next.ready
            ? next.playing
              ? "playing"
              : "paused"
            : "none";
          if (!next.ready) {
            navigator.mediaSession.metadata = null;
            metadataGeneration = -1;
          } else if (metadataGeneration !== next.generation && next.metadata) {
            navigator.mediaSession.metadata = new MediaMetadata(next.metadata);
            metadataGeneration = next.generation;
          }
          if (
            next.ready &&
            Number.isFinite(audio.duration) &&
            audio.duration > 0
          ) {
            try {
              navigator.mediaSession.setPositionState({
                duration: audio.duration,
                playbackRate: 1,
                position: Math.max(
                  0,
                  Math.min(audio.duration, audio.currentTime),
                ),
              });
            } catch {}
          }
        }
        sync();
      } catch {
        fade.set(0);
        releasing = false;
        stopAudio();
      } finally {
        polling = false;
      }
    };
    const onError = () => {
      if (source && !releasing && current?.generation === loadedGeneration) {
        failed = true;
        void report();
      }
    };
    const onPlaying = () => {
      sync();
      void report();
    };
    audio.addEventListener("ended", report);
    audio.addEventListener("loadedmetadata", poll);
    audio.addEventListener("error", onError);
    audio.addEventListener("waiting", report);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("seeked", report);
    audio.addEventListener("progress", report);
    audio.addEventListener("seeking", report);
    const mediaActions: MediaSessionAction[] = [
      "play",
      "pause",
      "stop",
      "previoustrack",
      "nexttrack",
      "seekto",
      "seekbackward",
      "seekforward",
    ];
    if ("mediaSession" in navigator)
      for (const action of mediaActions) {
        try {
          navigator.mediaSession.setActionHandler(action, (details) => {
            if (!current?.ready) return;
            const mapped =
              action === "previoustrack"
                ? "previous"
                : action === "nexttrack"
                  ? "next"
                  : action;
            if (action === "seekto") void media("seek", details.seekTime);
            else if (action === "seekbackward" || action === "seekforward")
              void media(
                "seek",
                Math.max(
                  0,
                  audio.currentTime +
                    (action === "seekforward" ? 1 : -1) *
                      (details.seekOffset ?? 10),
                ),
              );
            else void media(mapped);
          });
        } catch {}
      }
    const offline = () => {
      if (!current?.playing) return;
      offlineTarget = {
        generation: current.generation,
        revision: current.revision + 1,
      };
      void media("pause");
    };
    const online = () => {
      const target = offlineTarget;
      offlineTarget = null;
      if (
        target &&
        current?.generation === target.generation &&
        current.revision === target.revision &&
        !current.playing
      )
        void media("recover");
    };
    let lastTick = Date.now();
    const deviceChange = () => {
      if (current?.ready && current.playing && audio.error)
        void media("recover");
      else void poll();
    };
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    navigator.mediaDevices?.addEventListener?.("devicechange", deviceChange);
    const timer = setInterval(() => {
      const now = Date.now();
      if (now - lastTick > 15_000 && current?.playing && navigator.onLine)
        void media("recover");
      lastTick = now;
      void poll();
      void report().catch(() => {});
    }, 400);
    let stop: (() => void) | undefined;
    void listen("music-player-wake", () => void poll()).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    void poll();
    return () => {
      disposed = true;
      clearInterval(timer);
      fade.cancel();
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      navigator.mediaDevices?.removeEventListener?.(
        "devicechange",
        deviceChange,
      );
      if ("mediaSession" in navigator) {
        for (const action of mediaActions) {
          try {
            navigator.mediaSession.setActionHandler(action, null);
          } catch {}
        }
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = "none";
      }
      stop?.();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audio.removeEventListener("ended", report);
      audio.removeEventListener("loadedmetadata", poll);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("waiting", report);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("seeked", report);
      audio.removeEventListener("progress", report);
      audio.removeEventListener("seeking", report);
    };
  }, []);
  return null;
}
