import * as T from 'three'
import { commonUniforms, flowDriver, material, mesh, surfaceGeometry, surfaceVertex, type FlowEffect } from './shared'

const rippleVertex = surfaceVertex(`
  float radius=.3+t*9., angle=a+uPhase*.1;
  float wave=sin(radius*2.1-uPhase*2.+sin(angle*3.)*uTwist);
  // Raised wave discs have real axial relief and separated centers in depth.
  p=vec3(cos(angle)*radius,sin(angle)*radius*.9,
    (lane-1.)*3.3+wave*(.35+uVolume*1.25)+sin(angle*2.+uPhase*.25)*uTwist*.55);
  p.y+=(lane-1.)*.7;
  float ridge=pow(.5+.5*wave, max(2.,10./uWidth));
  vAlpha=(.025+ridge*.55)*smoothstep(0.,.09,t)*smoothstep(0.,.14,1.-t)*(lane==1.?1.:.55);
  vLight=ridge*.5;
`)

const rippleBeadsVertex = surfaceVertex(`
  float angle=lane*TAU/max(1.,uCount)+uPhase*.4;
  vec3 center=vec3(cos(angle)*6.8,sin(angle)*6.1,sin(angle*2.+uPhase*.3)*2.7);
  float latitude=t*PI;
  p=center+vec3(sin(latitude)*cos(a),cos(latitude),sin(latitude)*sin(a))*(.13+uTreble*.11);
  vAlpha=lane<uCount?.9:0.; vLight=.5;
`)

export function createRipple(detail: number): FlowEffect {
  const group = new T.Group(), uniforms = commonUniforms(), drive = flowDriver(uniforms)
  const quality = Math.sqrt(Math.max(.4, Math.min(1.6, detail)))
  mesh(group, surfaceGeometry(Math.round(64 * quality), Math.round(96 * quality), 3), material(uniforms, rippleVertex))
  mesh(group, surfaceGeometry(10, 12, 4), material(uniforms, rippleBeadsVertex))
  return { group, update(motion, config, reduced) {
    drive(motion, config, reduced, .5 + config.music.speed * .32)
    uniforms.uWidth.value = config.music.rippleWidth
    uniforms.uTwist.value = config.music.rippleTwist
    uniforms.uCount.value = config.music.rippleLights
  } }
}

const pulseCoreVertex = surfaceVertex(`
  float theta=t*TAU;
  float radius=(3.6+uBass*.7+uPulse*uTwist*.7+uTouch*.25)*uRange;
  float tube=.24+uMiddle*.12;
  p=vec3((radius+cos(a)*tube)*cos(theta),(radius+cos(a)*tube)*sin(theta),sin(a)*tube);
  vLight=.25+uPulse*.4; vAlpha=.92;
`)
// A segmented housing and an oblique stabilizer keep a spatial silhouette
// between musical attacks, instead of leaving isolated coplanar circles.
const pulseHousingVertex = surfaceVertex(`
  float segment=mod(lane,24.), row=floor(lane/24.);
  float theta=(segment+t*.76)*TAU/24.+uPhase*(row<.5?.055:-.045);
  float radius=(4.5+row*.58)*uRange;
  vec3 radial=vec3(cos(theta),sin(theta),0.);
  p=radial*(radius+cos(a)*.18)+vec3(0.,0.,sin(a)*.32+(row-.5)*.95);
  vAlpha=.96;vLight=pow(max(0.,cos(a)),24.)*(.5+uBass*.4);
`)
const pulseGimbalVertex = surfaceVertex(`
  float theta=t*TAU, radius=5.65*uRange;
  vec3 q=vec3(cos(theta)*(radius+cos(a)*.035),sin(theta)*(radius+cos(a)*.035),sin(a)*.035);
  float tilt=.72;
  p=vec3(q.x,cos(tilt)*q.y-sin(tilt)*q.z,sin(tilt)*q.y+cos(tilt)*q.z);
  vAlpha=.52;vLight=.55;
`)
const pulseSeedVertex = surfaceVertex(`
  float latitude=t*PI, radius=.75+uBass*.2+uPulse*uTwist*.12;
  p=vec3(sin(latitude)*cos(a),cos(latitude),sin(latitude)*sin(a))*radius;
  vAlpha=.98;
  vLight=pow(abs(cos(latitude*3.)),36.)*.35+pow(abs(sin(a*3.+uPhase*.2)),48.)*.25;
`)
const pulseEchoVertex = surfaceVertex(`
  int i=int(lane); vec4 pulse=uEchoes[i];
  float age=pulse.x, theta=t*TAU;
  float radius=(3.6+age*4.)*uRange;
  float tube=(.055+uTwist*.035)*exp(-age*.45);
  p=vec3((radius+cos(a)*tube)*cos(theta),(radius+cos(a)*tube)*sin(theta),sin(a)*tube-age*2.);
  vAlpha=age>=0.?exp(-age*1.8)*pulse.y*.65:0.; vLight=.6;
`, 'uniform vec4 uEchoes[6];')
const pulseNodesVertex = surfaceVertex(`
  float theta=lane*TAU/max(4.,uCount)+uPhase*.5;
  float latitude=t*PI, radius=(4.6+sin(theta*2.)*.25)*uRange;
  vec3 center=vec3(cos(theta)*radius,sin(theta)*radius,sin(theta*2.+uPhase*.25)*1.8);
  p=center+vec3(sin(latitude)*cos(a),cos(latitude),sin(latitude)*sin(a))*(.1+uTreble*.1);
  vAlpha=lane<uCount?.88:0.;vLight=.45;
`)

export function createPulse(): FlowEffect {
  const group = new T.Group(), uniforms = Object.assign(commonUniforms(), { uEchoes: { value: Array.from({ length: 6 }, () => new T.Vector4(-1, 0, 0, 0)) } })
  const drive = flowDriver(uniforms); let beat = -1, next = 0, last = -1
  mesh(group, surfaceGeometry(160, 20), material(uniforms, pulseCoreVertex))
  mesh(group, surfaceGeometry(128, 8, 6), material(uniforms, pulseEchoVertex, undefined, true))
  mesh(group, surfaceGeometry(10, 12, 16), material(uniforms, pulseNodesVertex))
  mesh(group, surfaceGeometry(12, 8, 48), material(uniforms, pulseHousingVertex))
  mesh(group, surfaceGeometry(160, 8), material(uniforms, pulseGimbalVertex, undefined, true))
  mesh(group, surfaceGeometry(32, 48), material(uniforms, pulseSeedVertex))
  return { group, update(motion, config, reduced) {
    const frame = motion.frame
    if (!frame || frame.now < last) {
      for (const echo of uniforms.uEchoes.value) echo.x = -1
      beat = -1; next = 0
    }
    const dt = drive(motion, config, reduced, .5 + config.music.speed * .3)
    if (!reduced) for (const echo of uniforms.uEchoes.value) if (echo.x >= 0) { echo.x += dt; if (echo.x > 3.2) echo.x = -1 }
    if (!reduced && frame?.audible && frame.onset && frame.beatIndex !== beat) {
      beat = frame.beatIndex
      uniforms.uEchoes.value[next++ % 6].set(0, Math.min(1, .4 + motion.volume * .5 + frame.beatStrength * config.music.pulseImpact), 0, 0)
    }
    if (reduced) for (const echo of uniforms.uEchoes.value) echo.x = -1
    uniforms.uRange.value = config.music.pulseRange
    uniforms.uTwist.value = config.music.pulseImpact
    uniforms.uCount.value = config.music.pulseParticles
    last = frame?.now ?? -1
  } }
}
