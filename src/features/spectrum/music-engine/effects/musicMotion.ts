import { createMusicTransientDetector } from './musicTransient';
import { MUSIC_GATE_OPEN_RMS } from './musicGate';

export interface MusicMotionViewport {
  aspectRatio: number;
  keyDiameter: number;
}

/** 用真实频段起音产生短促冲刺；总体音量只决定拍间运动，不用固定时钟制造节拍。 */
export function createMusicMotionRhythm() {
  const detector = createMusicTransientDetector();
  let impulse = 0;
  let activity = 0;
  const reset = () => {
    detector.reset();
    impulse = 0;
    activity = 0;
  };

  function update(
    dtMs: number,
    relativeVolume: number,
    rms: number,
    bands: readonly number[],
    sensitivity: number,
    spectrum: readonly number[] = bands,
    audible = rms >= MUSIC_GATE_OPEN_RMS,
    spectrumRms?: readonly number[]
  ) {
    const dt = Math.max(0, Math.min(100, dtMs));
    const detected = detector.update(dt, rms, audible, spectrum, sensitivity, spectrumRms);
    impulse *= Math.exp(-dt / 40);
    activity *= Math.exp(-dt / 600);
    // 65ms 去重仅拦同一个起音的重复检测，允许 125ms 甚至更密集的鼓点。
    const { onset } = detected;
    if (onset) {
      impulse = Math.min(1, Math.max(...detected.transients) * .8 + relativeVolume * .2);
      activity = 1;
    }
    // 节奏密集时降低拍间速度，给下一拍留出加速空间；长音逐渐恢复音量驱动。
    const base = Math.max(0, Math.min(1, relativeVolume)) * (1 - activity * 0.65);
    const intensity = audible ? Math.max(base, impulse) : 0;
    return { intensity, ...detected };
  }

  return { update, reset };
}

/** 把弱音压到慢档、强拍推到快档，避免音乐的中间强度挤在相近速度。 */
function getMusicMotionSpeed(intensity: number) {
  if (intensity <= 0) return 0;
  const contrast = Math.max(0, Math.min(1, (intensity - 0.2) / 0.8));
  return 0.06 + (3.6 - 0.06) * contrast ** 1.8;
}

/** 雨滴和弹球共用速度范围与平滑响应，单位均为键盘高度/秒。 */
export function createMusicMotion() {
  let speed = 0;
  let kick = 0;
  let kickDecayMs = 65;
  return {
    reset() {
      speed = 0;
      kick = 0;
      kickDecayMs = 65;
    },
    update(
      dtMs: number,
      intensity: number,
      beat?: { onset: boolean; strength: number; period: number }
    ) {
      const dt = Math.max(0, Math.min(100, dtMs));
      if (beat?.onset) {
        kick = Math.max(0, Math.min(1, beat.strength));
        // 慢拍留出可见路程，密集鼓点缩短冲刺，下一拍前仍能回落。
        kickDecayMs = Math.max(22, Math.min(65, beat.period * 0.18));
      } else kick *= Math.exp(-dt / kickDecayMs);
      if (intensity <= 0) kick = 0;
      const target = Math.max(getMusicMotionSpeed(intensity), 5.4 * kick ** 1.2);
      // 短加速、短回落，密集鼓点之间仍有明显的速度低谷。
      const response = beat ? (target > speed ? 10 : 28) : target > speed ? 18 : 50;
      speed += (target - speed) * (1 - Math.exp(-dt / response));
      return speed;
    },
  };
}
