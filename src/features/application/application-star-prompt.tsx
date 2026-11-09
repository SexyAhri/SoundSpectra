import { useState } from "react";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import githubMark from "../../assets/github-mark.svg";

const dismissedKey = "soundspectra.about.star-dismissed.v1";

export function ApplicationStarPrompt({
  pending,
  onRepository,
}: {
  pending: boolean;
  onRepository: () => void;
}) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissedKey) === "true";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  return (
    <section className="application-star-prompt" aria-label="支持 SoundSpectra">
      <Star
        className="application-star-icon"
        size={20}
        fill="currentColor"
        aria-hidden="true"
      />
      <p>喜欢 SoundSpectra？在 GitHub 点一颗 Star，支持项目继续成长。</p>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={onRepository}
      >
        <span
          aria-hidden="true"
          className="github-mark"
          style={{
            maskImage: `url("${githubMark}")`,
            WebkitMaskImage: `url("${githubMark}")`,
          }}
        />
        去点 Star
      </Button>
      <IconButton
        className="application-star-dismiss"
        aria-label="关闭 Star 提示"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(dismissedKey, "true");
          } catch {
            /* Dismiss for this session if storage is unavailable. */
          }
        }}
      >
        <X size={14} />
      </IconButton>
    </section>
  );
}
