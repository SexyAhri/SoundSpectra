import { useEffect, useState, type CSSProperties } from "react";
import "./startup-screen.css";
import { StartupField } from "./startup-field";

// Keep startup presentation independent of settings/music initialization.
// Timers also release the screen when a native request never settles.
export function useStartupScreen(ready: boolean) {
  const [introFinished, setIntroFinished] = useState(false);
  const [phase, setPhase] = useState<"intro" | "leaving" | "done">("intro");
  const done = phase === "done";

  useEffect(() => {
    if (done) return;
    const intro = window.setTimeout(() => setIntroFinished(true), 4000);
    const deadline = window.setTimeout(() => {
      setPhase((current) => (current === "intro" ? "leaving" : current));
    }, 8000);
    return () => {
      window.clearTimeout(intro);
      window.clearTimeout(deadline);
    };
  }, [done]);

  useEffect(() => {
    if (ready && introFinished)
      setPhase((current) => (current === "intro" ? "leaving" : current));
  }, [ready, introFinished]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => setPhase("done"), 600);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return { phase, skip: () => setPhase("done") };
}

interface Props {
  phase: "intro" | "leaving";
  ready: boolean;
  onSkip: () => void;
}

export function StartupScreen({ phase, ready, onSkip }: Props) {
  return (
    <section
      className="startup-screen"
      data-phase={phase}
      aria-label="SoundSpectra 启动动画"
    >
      <div className="startup-drag-region" data-tauri-drag-region />
      <StartupField />
      <div className="startup-art" aria-hidden="true">
        <div className="startup-halo" />
        <div className="startup-spectrum">
          {[30, 78, 54, 24].map((height, index) => (
            <span
              key={index}
              style={{ height, "--bar-index": index } as CSSProperties}
            />
          ))}
        </div>
        <div className="startup-name">
          Sound<span>Spectra</span>
        </div>
        <p className="startup-tagline">让音乐成为桌面的一部分</p>
      </div>
      <div className="startup-footer">
        <p role="status">{ready ? "即将进入声谱" : "正在准备工作台…"}</p>
        <button type="button" onClick={onSkip}>
          跳过动画 <span aria-hidden="true">↗</span>
        </button>
      </div>
    </section>
  );
}
