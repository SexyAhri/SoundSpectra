import { useEffect, useRef, useState } from "react";
import { Disc3 } from "lucide-react";
import { native } from "../spectrum/bridge";
import { musicClient } from "./client";
import { MusicHint } from "./music-hint";
const flights = new Map<string, Promise<string | null>>();
export function MusicCover({
  src,
  small = false,
  onImage,
}: {
  src?: string | null;
  small?: boolean;
  onImage?: (src: string | null) => void;
}) {
  const [broken, setBroken] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    setBroken(false);
    setImage(null);
    if (!src) return;
    if (!native || src.startsWith("data:")) {
      setImage(src);
      return;
    }
    let disposed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        let flight = flights.get(src);
        if (!flight) {
          flight = musicClient
            .artwork(src, revision > 0)
            .finally(() => flights.delete(src));
          flights.set(src, flight);
        }
        void flight
          .then((value) => {
            if (!disposed) {
              setImage(value);
              setBroken(!value);
            }
          })
          .catch(() => {
            if (!disposed) setBroken(true);
          });
      },
      { rootMargin: "120px" },
    );
    if (root.current) observer.observe(root.current);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [src, revision]);
  useEffect(() => {
    onImage?.(broken ? null : image);
  }, [image, broken, onImage]);
  useEffect(() => {
    const retry = (event: Event) => {
      if ((event as CustomEvent).detail === src) setRevision((v) => v + 1);
    };
    window.addEventListener("music-cover-retry", retry);
    return () => window.removeEventListener("music-cover-retry", retry);
  }, [src]);
  return (
    <MusicHint
      text={broken ? "封面加载失败，可在歌曲右键菜单中重试" : undefined}
    >
      <span ref={root} className={`library-cover ${small ? "small" : ""}`}>
        {image && !broken ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        ) : (
          <Disc3 size={small ? 21 : 36} />
        )}
      </span>
    </MusicHint>
  );
}
