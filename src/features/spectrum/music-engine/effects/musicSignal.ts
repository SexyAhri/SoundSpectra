import { createMusicMotionRhythm } from './musicMotion';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const edges = [40, 120, 300, 750, 1800, 4500, 12000];

/** 统一时域音量、六个语义频段与细分频谱，所有画面使用相同的音频尺度。 */
export function readMusicAudio(frequency: Float32Array, waveform: Uint8Array, sampleRate: number) {
  let rms = 0;
  for (const value of waveform) rms += ((value - 128) / 128) ** 2;
  rms = Math.sqrt(rms / Math.max(1, waveform.length));
  const audible = rms > 0.006;
  const readRange = (start: number, end: number) => {
    let sum = 0;
    for (let bin = start; bin < end; bin++) {
      // 浮点 dB 保留响亮片段的差别，不经过 byte 频谱的 -30dB 上限截断。
      const db = frequency[bin];
      if (Number.isFinite(db)) sum += Math.max(0, (db + 70) / 70);
    }
    return audible ? sum / Math.max(1, end - start) : 0;
  };
  const bands = edges.slice(0, -1).map((low, i) => {
    const start = Math.max(1, Math.floor((low * frequency.length * 2) / sampleRate));
    const end = Math.min(
      frequency.length,
      Math.max(start + 1, Math.ceil((edges[i + 1] * frequency.length * 2) / sampleRate))
    );
    return readRange(start, end);
  });
  // 保留图形频谱的细节，统一驱动不等于把几十根频谱柱压成六根的插值。
  const spectrum = Array.from({ length: 48 }, (_, i) => {
    const start = Math.floor((i / 48) ** 1.9 * frequency.length * 0.75);
    const end = Math.min(
      frequency.length,
      Math.max(start + 1, Math.floor(((i + 1) / 48) ** 1.9 * frequency.length * 0.75))
    );
    return readRange(start, end);
  });
  return { rms, audible, bands, spectrum };
}

export function createBandNormalizer(minimumSpan = 0.08) {
  const history: { time: number; min: number[]; max: number[] }[] = [];
  let lower: number[] = [];
  let upper: number[] = [];
  const reset = () => {
    history.length = 0;
    lower = [];
    upper = [];
  };

  function update(values: number[], now: number, dt: number, gain: number) {
    // 每 100ms 合并极值，保留最近 4 秒；静音不参与范围，避免将低谷锁在零。
    while (history.length && history[0].time <= now - 4000) history.shift();
    let bucket = history.at(-1);
    if (!bucket || now - bucket.time >= 100) {
      bucket = { time: now, min: values.map(() => Infinity), max: values.map(() => 0) };
      history.push(bucket);
    }
    return values.map((value, i) => {
      if (value <= 0) return 0;
      bucket.min[i] = Math.min(bucket.min[i], value);
      bucket.max[i] = Math.max(bucket.max[i], value);
      const min = Math.min(...history.map((item) => item.min[i]));
      const max = Math.max(...history.map((item) => item.max[i]));
      // 新极值立即容纳，旧极值过期后缓慢收缩，防止窗口滚动引起跳变。
      lower[i] = Math.min(
        value,
        (lower[i] ?? min) + (min - (lower[i] ?? min)) * (1 - Math.exp(-dt / 600))
      );
      upper[i] = Math.max(
        value,
        (upper[i] ?? max) + (max - (upper[i] ?? max)) * (1 - Math.exp(-dt / 600))
      );
      const span = Math.max(minimumSpan, upper[i] - lower[i]);
      const center = (upper[i] + lower[i]) / 2;
      // 保留最小跨度：恒定声音保持中档，不把微小噪声放大成满幅跳动。
      const relative = clamp(0.5 + (value - center) / span);
      return Math.pow(relative, 1 / gain) * clamp(value / 0.15);
    });
  }
  return { update, reset };
}

/** 统一驱动的运动信号：归一化音量、起音检测及拍间回落。 */
export function createMusicMotionSignal() {
  const normalizer = createBandNormalizer(0.03);
  const rhythm = createMusicMotionRhythm();
  return {
    reset() {
      normalizer.reset();
      rhythm.reset();
    },
    update(audio: ReturnType<typeof readMusicAudio>, now: number, dt: number, sensitivity: number) {
      const gain = Math.max(0.5, Math.min(2, sensitivity));
      const relativeVolume = normalizer.update(
        [audio.audible ? Math.max(0, (20 * Math.log10(audio.rms) + 70) / 70) : 0],
        now,
        dt,
        gain
      )[0];
      return rhythm.update(dt, relativeVolume, audio.rms, audio.bands, gain);
    },
  };
}
