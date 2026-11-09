import { useEffect, useMemo, useState } from "react";
import type { LyricLine } from "./model";
import { lyricFont, type LyricFontStyle } from "./lyric-typography";
import "../../assets/fonts/music-fonts.css";

/** Wait for local Unicode shards before measuring or caching Canvas glyph masks. */
export function useLyricFont(
  lines: LyricLine[],
  style: LyricFontStyle = "modern",
) {
  const text = useMemo(
    () =>
      [...new Set(lines.flatMap((line) => [...line.text]))].join("") ||
      "光 Light",
    [lines],
  );
  const key = `${style}:${text}`;
  const [loaded, setLoaded] = useState("");
  useEffect(() => {
    let disposed = false;
    void Promise.all(
      [400, 600].map((weight) =>
        document.fonts.load(lyricFont(96, style, weight), text),
      ),
    )
      .then(() => {
        if (!disposed) setLoaded(key);
      })
      // The existing system fallback remains usable if an installed asset is unavailable.
      .catch(() => {
        if (!disposed) setLoaded(key);
      });
    return () => {
      disposed = true;
    };
  }, [key, style, text]);
  return loaded === key;
}
