import { useEffect, useState } from "react";
import { Dialog } from "radix-ui";
import { X, RefreshCw } from "lucide-react";
import { ModalContent } from "@/components/ui/modal";
import { musicClient } from "./client";
import { MusicButton } from "./music-hint";
import { MusicMessage } from "./music-message";
import { trackKey, type Track } from "./types";
import type { LyricDocument } from "../lyrics/model";
import { describeError } from "../spectrum/bridge";
import "./track-lyrics-preview.css";

export function TrackLyricsPreview({
  track,
  onClose,
}: {
  track: Track;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<LyricDocument | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    setDocument(null);
    setError("");
    void musicClient.trackLyrics(trackKey(track), revision > 0).then(
      (value) => {
        if (!disposed) setDocument(value);
      },
      (reason) => {
        if (!disposed) setError(describeError(reason));
      },
    );
    return () => {
      disposed = true;
    };
  }, [track, revision]);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ModalContent className="music-lyric-preview">
        <div className="music-lyric-preview-heading">
          <div>
            <Dialog.Title>{track.title} · 歌词</Dialog.Title>
            <Dialog.Description>{track.artist}</Dialog.Description>
          </div>
          <MusicButton
            variant="ghost"
            size="icon-sm"
            aria-label="刷新歌词"
            disabled={!document && !error}
            onClick={() => setRevision((v) => v + 1)}
          >
            <RefreshCw size={16} />
          </MusicButton>
          <Dialog.Close asChild>
            <MusicButton variant="ghost" size="icon-sm" aria-label="关闭歌词">
              <X size={16} />
            </MusicButton>
          </Dialog.Close>
        </div>
        {(error || document?.issue) && <MusicMessage
          key={JSON.stringify([trackKey(track), revision, error || document?.issue])}
          message={error || document!.issue!}
        />}
        <div className="music-lyric-preview-lines" aria-label="歌曲歌词">
          {error ? (
            <p>暂未加载歌词，可点击刷新重试</p>
          ) : !document ? (
            <p role="status">正在加载歌词…</p>
          ) : document.lines.length ? (
            document.lines.map((line, index) => (
              <p key={index}>{line.text || "\u00a0"}</p>
            ))
          ) : (
            <p role="status">{document.message || "暂无歌词"}</p>
          )}
        </div>
      </ModalContent>
    </Dialog.Root>
  );
}
