/** 参考 SoundSpectra 的精确临界阻尼：保存当前值和速度，不缓存历史采样窗口。 */
export function dampedMusicValue(
  value: number,
  velocity: number,
  target: number,
  dt: number,
  omega: number
) {
  const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
  const displacement = value - target;
  const impulse = velocity + omega * displacement;
  const attenuation = Math.exp(-omega * step);
  const next = Math.max(0, Math.min(1, target + (displacement + impulse * step) * attenuation));
  if (target === 0 && next < 0.0001) return { value: 0, velocity: 0 };
  return { value: next, velocity: (velocity - omega * impulse * step) * attenuation };
}

export function createMusicEnvelope() {
  let level = { value: 0, velocity: 0 };
  let presence = { value: 0, velocity: 0 };
  return {
    reset: () => {
      level = { value: 0, velocity: 0 };
      presence = { value: 0, velocity: 0 };
    },
    step: (
      rms: number,
      audible: boolean,
      dt: number,
      response: 'soft' | 'balanced' | 'responsive' = 'balanced'
    ) => {
      const attack = response === 'soft' ? 0.7 : response === 'responsive' ? 1.4 : 1;
      const release = response === 'soft' ? 0.8 : response === 'responsive' ? 1.3 : 1;
      const target = audible && Number.isFinite(rms) ? Math.max(0, Math.min(1, rms)) : 0;
      level = dampedMusicValue(
        level.value,
        level.velocity,
        target,
        dt,
        target > level.value ? 46 * attack : 10 * release
      );
      presence = dampedMusicValue(
        presence.value,
        presence.velocity,
        audible ? 1 : 0,
        dt,
        audible ? 34 * attack : 7.5 * release
      );
      return { intensity: level.value, presence: presence.value };
    },
  };
}
