import {
  createBandNormalizer,
  createMusicMotionSignal,
  readMusicAudio,
  type MusicAudioFeatures,
} from "./musicSignal";
import { createMusicGate } from "./musicGate";
import { createMusicEnvelope, dampedMusicValue } from "./musicEnvelope";
import {
  sampleMusicIntensity,
  getMusicIntensitySpeed,
  type MusicIntensitySample,
} from "./musicIntensity";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** 每帧只生成一次，各效果共享当前音频采样强度，不保留强度历史窗口。 */
export interface MusicDriverFrame {
  now: number;
  dt: number;
  audible: boolean;
  bands: readonly number[];
  levels: readonly number[];
  /** Relative detail only; levels retain absolute strength with a bounded ±15% detail accent. */
  relativeLevels: readonly number[];
  bandRms?: readonly number[];
  spectrumRms?: readonly number[];
  /** Low (<300Hz), middle (300–1800Hz), high (>1800Hz) causal onset envelopes. */
  transients: readonly number[];
  bandOnsets: readonly boolean[];
  spectrum: readonly number[];
  waveform: Uint8Array;
  sensitivity: number;
  intensity: number;
  intensitySample: MusicIntensitySample;
  displayIntensity?: number;
  displayPresence?: number;
  onset: boolean;
  beatIndex: number;
  beatAge: number;
  beatStrength: number;
  pulse: number;
  /** Smoothed interval between detected onsets in ms, not a BPM/phase estimate. */
  period: number;
  sustain: number;
  envelope: number;
  bassEnvelope: number;
  motionEnvelope: number;
  motionSpeed: number;
  motionTime: number;
}

/** 统一音量尺度、频段归一化、起音、长音与衰减；时间本身不会产生新节拍。 */
export function createMusicDriver() {
  const normalizer = createBandNormalizer();
  const gate = createMusicGate();
  const motion = createMusicMotionSignal();
  const displayEnvelope = createMusicEnvelope();
  const levelVelocity = Array<number>(6).fill(0);
  const spectrumVelocity = Array<number>(48).fill(0);
  let levels = Array<number>(6).fill(0);
  let spectrum = Array<number>(48).fill(0);
  let previousBands = Array<number>(6).fill(0);
  let previousRms = 0;
  let lastTime: number | undefined;
  let lastBeat = -Infinity;
  let beatIndex = -1;
  let beatStrength = 0;
  let period = 500;
  let sustainMs = 0;
  let sustain = 0;
  let envelope = 0;
  let bassEnvelope = 0;
  let motionEnvelope = 0;
  let motionTime = 0;
  let motionIntensity = 0;

  function reset() {
    normalizer.reset();
    gate.reset();
    motion.reset();
    displayEnvelope.reset();
    levelVelocity.fill(0);
    spectrumVelocity.fill(0);
    levels.fill(0);
    spectrum.fill(0);
    previousBands.fill(0);
    previousRms = 0;
    lastTime = undefined;
    lastBeat = -Infinity;
    beatIndex = -1;
    beatStrength = 0;
    period = 500;
    sustainMs = 0;
    sustain = 0;
    envelope = 0;
    bassEnvelope = 0;
    motionEnvelope = 0;
    motionTime = 0;
    motionIntensity = 0;
  }

  function update(
    frequency: Float32Array,
    waveform: Uint8Array,
    sampleRate: number,
    now: number,
    sensitivity: number,
    sampledIntensity?: MusicIntensitySample,
    smoothMotion = false,
    response: "soft" | "balanced" | "responsive" = "balanced",
  ): MusicDriverFrame {
    return updateAudio(
      readMusicAudio(frequency, waveform, sampleRate),
      now,
      sensitivity,
      sampledIntensity,
      smoothMotion,
      response,
      waveform,
    );
  }

  // Tauri computes these features from the captured PCM. No reconstruction from bar heights.
  function updateAudio(
    input: MusicAudioFeatures,
    now: number,
    sensitivity: number,
    sampledIntensity?: MusicIntensitySample,
    smoothMotion = false,
    response: "soft" | "balanced" | "responsive" = "balanced",
    waveform: Uint8Array = new Uint8Array(0),
  ): MusicDriverFrame {
    // Standalone callers also discard stale attack and normalization state on resume.
    if (lastTime !== undefined && now - lastTime > 350) reset();
    const dt = Math.max(
      0,
      Math.min(100, lastTime === undefined ? 16.67 : now - lastTime),
    );
    lastTime = now;
    const rms = Number.isFinite(input.rms) ? Math.max(0, input.rms) : 0;
    const audio = {
      ...input,
      rms,
      audible: input.audible ?? gate.update(rms, dt),
    };
    const gain = Math.max(0.5, Math.min(2, sensitivity));
    const {
      intensity: accentIntensity,
      onset,
      transients,
      bandOnsets,
    } = motion.update(audio, now, dt, gain);
    // 直接使用当前 RMS；稳定音乐也能持续运动，不再等待历史极值或在窗口低谷停住。
    const intensitySample =
      sampledIntensity ?? sampleMusicIntensity(audio.rms, now);
    const rawIntensity = audio.audible
      ? clamp(intensitySample.current * (smoothMotion ? gain / 2 : 1))
      : 0;
    // 仅用一个当前值做短时进入/回落，减轻速度突变；没有历史峰谷或滑动窗口。
    const responseScale =
      response === "soft" ? 1.3 : response === "responsive" ? 0.7 : 1;
    const tau = (rawIntensity > motionIntensity ? 35 : 130) * responseScale;
    motionIntensity = audio.audible
      ? motionIntensity +
        (rawIntensity - motionIntensity) * (1 - Math.exp(-dt / tau))
      : 0;
    const intensity = smoothMotion ? motionIntensity : rawIntensity;
    const display = smoothMotion
      ? displayEnvelope.step(rawIntensity, audio.audible, dt / 1000, response)
      : null;
    const absolute = [...audio.bands, ...audio.spectrum].map((value) =>
      audio.audible && Number.isFinite(value) ? clamp(value) : 0,
    );
    const relative = normalizer.update(absolute, now, dt, 1);
    // The previous independent min/max output made constant .2/.4/.8 all .5.
    // Absolute display energy now owns the scale; relative motion has bounded influence.
    const normalized = absolute.map((value, i) =>
      clamp(Math.pow(value, 1 / gain) * (0.85 + 0.3 * relative[i])),
    );
    const ease = (
      value: number,
      target: number,
      attack: number,
      release: number,
    ) =>
      value +
      (target - value) *
        (1 - Math.exp(-dt / (target > value ? attack : release)));
    const bandLevel = (
      value: number,
      target: number,
      velocities: number[],
      index: number,
    ) => {
      if (!smoothMotion) return ease(value, target, 65, 200);
      const result = dampedMusicValue(
        value,
        velocities[index],
        target,
        dt / 1000,
        (target > value ? 50 : 12) / responseScale,
      );
      velocities[index] = result.velocity;
      return result.value;
    };
    levels = levels.map((value, i) =>
      bandLevel(value, normalized[i], levelVelocity, i),
    );
    spectrum = spectrum.map((value, i) =>
      bandLevel(value, normalized[i + 6], spectrumVelocity, i),
    );
    envelope = ease(envelope, Math.max(...normalized.slice(0, 6)), 45, 240);
    bassEnvelope = ease(
      bassEnvelope,
      Math.max(normalized[0], normalized[1]),
      45,
      240,
    );
    motionEnvelope = ease(
      motionEnvelope,
      audio.audible && intensitySample.current > 0 ? 1 : 0,
      45,
      240,
    );

    const spectralChange =
      audio.bands.reduce(
        (sum, value, i) => sum + Math.abs(value - previousBands[i]),
        0,
      ) / audio.bands.length;
    const stableVolume =
      Math.abs(audio.rms - previousRms) / Math.max(0.02, previousRms) < 0.12;
    // 持续稳定 350ms 才拉长拖尾，断音和频段变化及时收回。
    sustainMs =
      audio.audible && stableVolume && spectralChange < 0.018
        ? Math.min(1400, sustainMs + dt)
        : Math.max(0, sustainMs - dt * 4);
    sustain = ease(
      sustain,
      audio.audible ? clamp((sustainMs - 350) / 900) : 0,
      180,
      180,
    );
    previousBands = [...audio.bands];
    previousRms = audio.rms;
    if (onset) {
      const interval = now - lastBeat;
      if (interval >= 65 && interval <= 1500)
        period = period * 0.7 + interval * 0.3;
      lastBeat = now;
      beatIndex++;
      beatStrength = accentIntensity;
    }
    // 装饰性运动也只在有声时推进；估算拍间隔只用于动画，不外推假节拍。
    motionTime += dt * intensity;
    const beatAge = now - lastBeat;
    // 当前音量线性映射到速度，不叠加起音冲刺或最低速度，静音时立即归零。
    const motionSpeed = getMusicIntensitySpeed(intensity);
    return {
      now,
      dt,
      audible: audio.audible,
      bands: audio.bands,
      levels: [...levels],
      relativeLevels: relative.slice(0, 6),
      bandRms: audio.bandRms,
      spectrumRms: audio.spectrumRms,
      transients,
      bandOnsets,
      spectrum: [...spectrum],
      waveform,
      sensitivity: gain,
      intensity,
      intensitySample,
      ...(display
        ? {
            displayIntensity: display.intensity,
            displayPresence: display.presence,
          }
        : {}),
      onset,
      beatIndex,
      beatAge,
      beatStrength,
      period,
      // A cymbal accent remains a fine transient instead of a bass-sized global impact.
      pulse: audio.audible
        ? Math.max(transients[0], transients[1] * 0.65, transients[2] * 0.3)
        : 0,
      sustain,
      envelope,
      bassEnvelope,
      motionEnvelope,
      motionSpeed,
      motionTime,
    };
  }
  return { update, updateAudio, reset };
}

/** 图形频谱使用同一帧的细分频谱，仅插值显示密度，不再另做音频分析。 */
export function sampleMusicLevels(
  frame: MusicDriverFrame,
  count: number,
): number[] {
  return Array.from({ length: count }, (_, i) => {
    const position = (i / Math.max(1, count - 1)) * (frame.spectrum.length - 1);
    const low = Math.floor(position);
    const high = Math.min(frame.spectrum.length - 1, low + 1);
    return (
      frame.spectrum[low] +
      (frame.spectrum[high] - frame.spectrum[low]) * (position - low)
    );
  });
}

/** 情景动画的显示参数也来自同一帧；随机数只能改变造型，不能决定是否起拍。 */
export function getMusicSceneFrame(frame: MusicDriverFrame) {
  const v = sampleMusicLevels(frame, 48);
  const note = v.indexOf(Math.max(...v));
  return {
    b: Math.max(frame.levels[0], frame.levels[1]),
    m: Math.max(frame.levels[2], frame.levels[3]),
    h: Math.max(frame.levels[4], frame.levels[5]),
    beat: frame.onset,
    pulse: frame.pulse,
    str: frame.beatStrength,
    v,
    phase: Math.min(1, frame.beatAge / frame.period),
    idx: frame.beatIndex,
    hold: frame.sustain,
    note,
    noteStr: v[note],
    step: frame.dt / (1000 / 60),
    motionStep: (frame.dt / (1000 / 60)) * frame.intensity,
    intensity: frame.intensity,
  };
}
