/** 雨滴和弹球的满速，单位为键盘高度/秒。 */
export const MUSIC_INTENSITY_MAX_SPEED = 5.4;

export interface MusicIntensitySample {
  sampledAt: number;
  current: number;
}

/** 从当前浮点时域波形读取 RMS，避免 byte 波形的量化误差。 */
export function readMusicIntensity(waveform: Float32Array) {
  let sum = 0;
  for (const value of waveform) sum += value * value;
  return Math.sqrt(sum / Math.max(1, waveform.length));
}

export const getMusicIntensitySpeed = (normalized: number) =>
  Math.max(0, Math.min(1, normalized)) * MUSIC_INTENSITY_MAX_SPEED;

/** 无状态采样：相同音量始终得到相同强度，不受之前的音乐、时间或峰谷影响。 */
export function sampleMusicIntensity(
  value: number,
  now: number,
): MusicIntensitySample {
  return {
    sampledAt: now,
    current: Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0,
  };
}
