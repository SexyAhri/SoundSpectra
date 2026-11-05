export interface MusicMotionViewport {
  aspectRatio: number;
  keyDiameter: number;
}

/** 用真实频段起音产生短促冲刺；总体音量只决定拍间运动，不用固定时钟制造节拍。 */
export function createMusicMotionRhythm() {
  let previousBands: readonly number[] = [];
  let previousRms = 0;
  let fluxAverage = 0;
  let attack = 0;
  let attackPeak = 0.06;
  let impulse = 0;
  let activity = 0;
  let sinceOnset = Infinity;
  const reset = () => {
    previousBands = [];
    previousRms = 0;
    fluxAverage = 0;
    attack = 0;
    attackPeak = 0.06;
    impulse = 0;
    activity = 0;
    sinceOnset = Infinity;
  };

  function update(
    dtMs: number,
    relativeVolume: number,
    rms: number,
    bands: readonly number[],
    sensitivity: number
  ) {
    const dt = Math.max(0, Math.min(100, dtMs));
    const audible = rms > 0.006;
    const gain = Math.max(0.5, Math.min(2, sensitivity));
    // 看单个频段的增量，避免低鼓或镲片被持续响亮的其他频段平均掉。
    const spectralFlux = Math.max(0, ...bands.map((value, i) => value - (previousBands[i] ?? 0)));
    const volumeFlux = (Math.max(0, rms - previousRms) / Math.max(0.02, previousRms)) * 0.25;
    const flux = audible ? Math.max(spectralFlux, volumeFlux) : 0;
    // 累积约两三帧的上升量，避免渐强的鼓点每帧都低于起音门限。
    attack = audible ? attack * Math.exp(-dt / 35) + flux : 0;
    attackPeak = Math.max(0.06, attackPeak * Math.exp(-dt / 4000));
    const threshold = Math.max(0.022 / gain, fluxAverage * 1.7 + 0.006);
    sinceOnset += dt;
    impulse *= Math.exp(-dt / 40);
    activity *= Math.exp(-dt / 600);
    // 65ms 去重仅拦同一个起音的重复检测，允许 125ms 甚至更密集的鼓点。
    const onset = audible && sinceOnset >= 65 && flux > 0.004 / gain && attack > threshold;
    if (onset) {
      // 起音只决定触发时机，不再把弱拍、强拍一律推到满速和最远键。
      // 限制启动瞬间的参考峰值，避免从静音起播的跳变压住后续正常鼓点。
      attackPeak = Math.max(attackPeak, Math.min(0.35, attack));
      const accent = Math.min(1, attack / attackPeak);
      impulse = 0.2 + 0.8 * (accent * 0.65 + relativeVolume * 0.35);
      attack = 0;
      activity = 1;
      sinceOnset = 0;
    }
    fluxAverage += (flux - fluxAverage) * (1 - Math.exp(-dt / 400));
    previousBands = [...bands];
    previousRms = rms;
    // 节奏密集时降低拍间速度，给下一拍留出加速空间；长音逐渐恢复音量驱动。
    const base = Math.max(0, Math.min(1, relativeVolume)) * (1 - activity * 0.65);
    const intensity = audible ? Math.max(base, impulse) : 0;
    return { intensity, onset };
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
