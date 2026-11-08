import type { CSSProperties } from "react";
import "./wordmark.css";

const particles = [
  [3, 60, 2, -1.2, 4.8], [12, 24, 2.5, -3.1, 5.7],
  [23, 83, 1.5, -2.4, 4.3], [32, 14, 2, -.8, 5.2],
  [42, 75, 2.5, -4.3, 6.1], [52, 19, 1.5, -2.2, 4.9],
  [61, 88, 2, -3.7, 5.6], [70, 15, 3, -1.5, 6.3],
  [80, 79, 1.5, -4.8, 5.4], [89, 26, 2, -2.9, 4.7],
  [95, 64, 2.5, -.4, 5.9], [99, 37, 1.5, -3.6, 4.4],
];

export function Wordmark() {
  return (
    <span className="sound-wordmark" aria-hidden="true">
      <span className="sound-wordmark-particles">
        {particles.map(([x, y, size, delay, duration], index) => (
          <i key={index} style={{
            left: `${x}%`, top: `${y}%`, width: size, height: size,
            "--particle-delay": `${delay}s`,
            "--particle-duration": `${duration}s`,
            "--particle-drift": `${index % 2 ? 5 : -5}px`,
          } as CSSProperties} />
        ))}
      </span>
      <span className="sound-wordmark-text">Sound<span>Spectra</span></span>
      <svg className="sound-wordmark-wave" viewBox="0 0 184 12" fill="none" focusable="false">
        <path d="M19 8C55 12 124 8 174 2" />
      </svg>
    </span>
  );
}
