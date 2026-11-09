import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FoldedCurtain, diagnostics } from "./scene";
import {
  ScoreClock,
  duration,
  lineText,
  score,
  sentenceScore,
  type Line,
} from "./score";
import "./preview.css";

const clock = new ScoreClock();
function Preview() {
  const [wordTiming, setWordTiming] = useState(true);
  const [reduced, setReduced] = useState(
    matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [offset, setOffset] = useState(0);
  const [replacement, setReplacement] = useState<Line[] | null>(null);
  const range = useRef<HTMLInputElement>(null),
    stamp = useRef<HTMLOutputElement>(null),
    label = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    let alive = true;
    document.fonts.ready.then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => {
      const time = clock.read(),
        current = score.find(
          (l) => clock.lyricTime() >= l.start && clock.lyricTime() < l.end,
        );
      if (range.current) range.current.value = String(time);
      if (stamp.current)
        stamp.current.textContent = `${(time / 1000).toFixed(1)} / 31.5 s`;
      if (label.current)
        label.current.textContent = current
          ? lineText(current)
          : "留白 · 等待下一句";
      if (time === duration && clock.playing) clock.play(false);
    };
    const sync = () => {
      setPlaying(clock.playing);
      update();
      clearInterval(timer);
      if (clock.playing && !document.hidden) timer = setInterval(update, 100);
    };
    const unsubscribe = clock.subscribe(sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      unsubscribe();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  useEffect(() => {
    window.foldStudy = {
      clock,
      diagnostics,
      setWordTiming,
      setReduced,
      replaceScore: setReplacement,
      reset: () => {
        clock.play(false);
        clock.seek(0);
        setRevision((r) => r + 1);
      },
    };
    return () => {
      delete window.foldStudy;
    };
  }, []);
  return (
    <main>
      <header>
        <div className="identity">
          <span className="sigil">SS / 01</span>
          <span>
            SoundSpectra <em>歌词实验</em>
          </span>
        </div>
        <span className="badge">独立样片 · 未加入正式模式</span>
      </header>
      <section className="theatre" aria-label="折幕字场预览">
        <div className="title">
          <span>FOLDED VERSES</span>
          <h1>折幕字场</h1>
          <p>把文字折成空间，让留白接住下一句。</p>
        </div>
        <div className="scene">
          {ready && (
            <FoldedCurtain
              key={revision}
              clock={clock}
              lines={replacement ?? (wordTiming ? score : sentenceScore)}
              wordTiming={wordTiming}
              reduced={reduced}
            />
          )}
        </div>
        <div className="stage-foot">
          <span>原创时间夹具 · 无音频</span>
          <span>
            {wordTiming ? "逐词时间 · 整词着色" : "仅逐句时间 · 整句强调"}
          </span>
        </div>
      </section>
      <section className="transport" aria-label="样片播放控制">
        <div className="play-row">
          <button
            className="play"
            onClick={() => {
              if (clock.read() === duration) clock.seek(0);
              clock.play(!clock.playing);
            }}
          >
            {playing ? "暂停" : "播放"}
          </button>
          <button
            onClick={() => {
              clock.play(false);
              clock.seek(0);
              setRevision((r) => r + 1);
            }}
          >
            重置样片
          </button>
          <output ref={stamp}>0.0 / 31.5 s</output>
          <p ref={label} className="transcript">
            留白 · 等待下一句
          </p>
        </div>
        <input
          ref={range}
          aria-label="播放时间"
          type="range"
          min="0"
          max={duration}
          step="10"
          defaultValue="0"
          onChange={(e) => clock.seek(+e.target.value)}
        />
        <div className="options">
          <label>
            时间版本{" "}
            <select
              value={wordTiming ? "words" : "lines"}
              onChange={(e) => setWordTiming(e.target.value === "words")}
            >
              <option value="words">原创词级夹具</option>
              <option value="lines">同文句级夹具</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => setReduced(e.target.checked)}
            />{" "}
            减少动态
          </label>
          <label>
            歌词偏移{" "}
            <input
              aria-label="歌词偏移"
              type="number"
              min="-3000"
              max="3000"
              step="100"
              value={offset}
              onChange={(e) => {
                const value = Math.max(-3000, Math.min(3000, +e.target.value));
                setOffset(value);
                clock.setOffset(value);
              }}
            />{" "}
            ms
          </label>
        </div>
      </section>
      <nav aria-label="样片段落">
        {score.map((line, i) => (
          <button key={i} onClick={() => clock.seek(line.start - 650)}>
            <span>0{i + 1}</span>
            {["折入", "承接", "中英混排", "快句", "长句", "留白后归来"][i]}
          </button>
        ))}
      </nav>
      <footer>
        播放、暂停或拖动进度，观察同一时刻的折面姿态。
        <span>当前句稳定阅读 / 雾青与灰蓝</span>
      </footer>
    </main>
  );
}
declare global {
  interface Window {
    foldStudy?: {
      clock: ScoreClock;
      diagnostics: typeof diagnostics;
      setWordTiming: (value: boolean) => void;
      setReduced: (value: boolean) => void;
      replaceScore: (lines: Line[] | null) => void;
      reset: () => void;
    };
  }
}
createRoot(document.getElementById("root")!).render(<Preview />);
