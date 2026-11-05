import * as T from 'three'
import { commonUniforms, flowDriver } from '../flow/shared'
import type { SpectrumSettings } from '../../../model'
import type { SceneMotion } from '../../motion'

export function environmentUniforms() {
  return Object.assign(commonUniforms(), {
    uWaves: { value: Array.from({ length: 4 }, () => new T.Vector4(-1, 0, 0, 0)) },
  })
}

/** Audio-derived wavefronts share the analysis clock, never the draw count. */
export function environmentDriver(uniforms: ReturnType<typeof environmentUniforms>) {
  const drive = flowDriver(uniforms)
  let last = -1, beat = -1, next = 0
  return (motion: SceneMotion, config: SpectrumSettings, reduced: boolean, speed: number) => {
    const frame = motion.frame
    if (!frame || frame.now < last) {
      uniforms.uWaves.value.forEach(wave => { wave.x = -1 })
      beat = -1; next = 0
    }
    const dt = drive(motion, config, reduced, speed)
    if (!reduced) for (const wave of uniforms.uWaves.value) if (wave.x >= 0) {
      wave.x += dt
      if (wave.x > 4) wave.x = -1
    }
    if (!reduced && frame?.audible && frame.onset && frame.beatIndex !== beat) {
      beat = frame.beatIndex
      uniforms.uWaves.value[next++ % 4].set(0, .3 + motion.volume * .3 + frame.beatStrength * .6, 0, 0)
    }
    if (reduced) uniforms.uWaves.value.forEach(wave => { wave.x = -1 })
    last = frame?.now ?? -1
  }
}

export const waveSource = `
uniform vec4 uWaves[4];
float wavefront(float z){
  float energy=0.;
  for(int i=0;i<4;i++){
    vec4 w=uWaves[i];
    float d=z-(-200.+w.x*68.);
    if(w.x>=0.)energy+=exp(-d*d/180.)*w.y*exp(-w.x*.18);
  }
  return min(1.5,energy);
}
`

export const surfaceVaryings = `
varying vec3 vWorld;
varying vec2 vUv;
varying float vLane,vAlpha,vLight;
`
