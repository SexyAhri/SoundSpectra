import * as T from 'three'
import type { MusicEffect } from '../../../music-engine/catalog'
import { commonUniforms, flowDriver, material, mesh, silkFragment, surfaceGeometry, surfaceVertex, tubeFrame, type FlowEffect } from './shared'

const silkCurve = `
vec3 curve(float t,float lane){
  float q=t*6.2831853+lane*1.35+uPhase*.32;
  return vec3((t-.5)*22.,sin(q)*2.6+(lane-(uCount-1.)*.5)*2.3,
    cos(q*.85)*4.2+sin(t*11.-uPhase*.25+lane)*.5);
}`
const silkVertex = surfaceVertex(`
  ${tubeFrame}
  float twist=t*7.+uPhase*.24+lane*.8;
  vec3 across=side*cos(twist)+up*sin(twist), normal=-side*sin(twist)+up*cos(twist);
  float taper=pow(max(0.,sin(t*PI)),.45), swell=.9+uVolume*.25+sin(t*10.-uPhase*.8)*.12;
  p=curve(t,lane)+(across*cos(a)*1.5+normal*sin(a)*.055)*uWidth*taper*swell;
  vAlpha=lane<uCount?(.6+uTrail*.3)*smoothstep(0.,.05,t)*smoothstep(0.,.07,1.-t):0.;
  vLight=pow(.5+.5*cos(t*18.-uPhase*1.6),8.)*.35;
`, silkCurve)

const dragonCurve = `
vec3 curve(float t,float lane){
  float q=t*6.2831853+uPhase*.24;
  return vec3((t-.5)*23.,sin(q)*3.+sin(t*3.14159265)*.8,cos(q*1.2)*4.1);
}`
const dragonSheath = surfaceVertex(`
  ${tubeFrame}
  float radius=uWidth*(.38+uBass*.1)*(.25+.75*pow(t,.55));
  p=curve(t,lane)+(side*cos(a)+up*sin(a))*radius;
  vAlpha=.95*smoothstep(0.,.05,t)*smoothstep(0.,.025,1.-t);
  vLight=pow(max(0.,cos(a*2.)),32.)*.3;
`, dragonCurve)
const dragonWings = surfaceVertex(`
  ${tubeFrame}
  float handed=lane<.5?-1.:1.;
  float taper=pow(max(0.,sin(t*PI)),.7);
  float sweep=t*6.+uPhase*.35;
  vec3 wing=side*cos(sweep)+up*sin(sweep);
  vec3 normal=-side*sin(sweep)+up*cos(sweep);
  float width=(1.+uMiddle*.45)*taper*uWidth;
  p=curve(t,0.)+wing*handed*(.38*uWidth+width*(1.+cos(a)))
    +normal*(sin(a)*.045+handed*width*.3);
  vAlpha=.82*smoothstep(0.,.045,t)*smoothstep(0.,.065,1.-t);
  vLight=pow(.5+.5*cos(t*24.-uPhase*2.),8.)*.3;
`, dragonCurve)
const dragonRail = surfaceVertex(`
  ${tubeFrame}
  float taper=.25+.75*pow(t,.55);
  p=curve(t,lane)+(side*cos(a)+up*sin(a))*.08*uWidth*taper;
  vAlpha=smoothstep(0.,.05,t)*smoothstep(0.,.025,1.-t)*min(.95,.18+uTrail*.11);
  vLight=.65+pow(.5+.5*cos(t*26.-uPhase*2.),max(2.,12.-uTrail))*.5;
`, dragonCurve)
const dragonSpine = surfaceVertex(`
  float along=(lane+.5)/36.;
  vec3 tangent=normalize(curve(min(1.,along+.002),0.)-curve(max(0.,along-.002),0.));
  vec3 side=normalize(cross(tangent,vec3(0,1,0))),up=normalize(cross(side,tangent));
  float radius=uWidth*(.42+uBass*.1)*(.25+.75*pow(along,.55));
  float theta=t*TAU;
  vec3 radial=side*cos(theta)+up*sin(theta);
  p=curve(along,0.)+radial*(radius+cos(a)*.035*uWidth)+tangent*sin(a)*.07;
  vAlpha=.82*smoothstep(0.,.05,along);
  vLight=(mod(lane,4.)<.5?.7:.17)+pow(.5+.5*cos(along*22.-uPhase*2.),9.)*.35;
`, dragonCurve)
const dragonTerminals = surfaceVertex(`
  float along=lane<.5?.97:.045,latitude=t*PI;
  vec3 tangent=normalize(curve(min(1.,along+.002),0.)-curve(max(0.,along-.002),0.));
  vec3 side=normalize(cross(tangent,vec3(0,1,0))),up=normalize(cross(side,tangent));
  p=curve(along,0.)+(side*sin(latitude)*cos(a)+up*sin(latitude)*sin(a)+tangent*cos(latitude))*uWidth*(lane<.5?.48:.17);
  vLight=.22+pow(abs(cos(latitude*6.)),24.)*.7;vAlpha=.96;
`, dragonCurve)

const vortexCurve = `
vec3 curve(float t,float lane){
  float angle=t*5.2+lane*6.2831853/max(2.,uCount)-uPhase*.55;
  float radius=(1.1+pow(t,.8)*7.4)*uRange*(1.+uBass*.07);
  return vec3(cos(angle)*radius,-3.5+pow(t,.7)*7.,sin(angle)*radius);
}`
const vortexBlades = surfaceVertex(`
  ${tubeFrame}
  float width=(.12+t*.7)*uWidth;
  p=curve(t,lane)+side*cos(a)*width+up*sin(a)*.075;
  vAlpha=lane<uCount?.9*smoothstep(0.,.03,t)*smoothstep(0.,.1,1.-t):0.;
  vLight=pow(.5+.5*cos(t*21.-uPhase*2.+lane),7.)*.3;
`, vortexCurve)
const vortexCore = surfaceVertex(`
  float latitude=t*PI, radius=1.15+uBass*.15;
  p=vec3(sin(latitude)*cos(a),cos(latitude),sin(latitude)*sin(a))*radius;
  p.y-=3.5;
  vLight=pow(abs(sin(a*3.)),30.)*.25+pow(abs(cos(latitude*4.)),38.)*.3;
  vAlpha=.98;
`)
const coreHalo = surfaceVertex(`
  float theta=t*TAU, radius=(1.45+lane*.55)*uRange;
  p=vec3(cos(theta)*(radius+cos(a)*.025),-3.5+sin(a)*.025+lane*.12,sin(theta)*(radius+cos(a)*.025));
  vLight=.9;vAlpha=.7;
`)

export function createPathEffect(effect: MusicEffect, detail: number): FlowEffect {
  const group = new T.Group(), uniforms = commonUniforms(), drive = flowDriver(uniforms)
  const segments = Math.max(160, Math.min(320, Math.round(220 * detail)))
  if (effect === 'rhythm_fluid') {
    mesh(group, surfaceGeometry(segments, 24, 3), material(uniforms, silkVertex, silkFragment))
  } else if (effect === 'rhythm_skin') {
    mesh(group, surfaceGeometry(segments, 16), material(uniforms, dragonSheath))
    mesh(group, surfaceGeometry(segments, 10), material(uniforms, dragonRail, undefined, true))
    mesh(group, surfaceGeometry(24, 8, 36), material(uniforms, dragonSpine))
    mesh(group, surfaceGeometry(16, 20, 2), material(uniforms, dragonTerminals))
    mesh(group, surfaceGeometry(segments, 20, 2), material(uniforms, dragonWings, silkFragment))
  } else {
    mesh(group, surfaceGeometry(segments, 20, 5), material(uniforms, vortexBlades, silkFragment))
    mesh(group, surfaceGeometry(24, 32), material(uniforms, vortexCore))
    mesh(group, surfaceGeometry(96, 6, 2), material(uniforms, coreHalo, undefined, true))
  }
  return { group, update(motion, config, reduced) {
    const m = config.music
    const speed = effect === 'rhythm_fluid' ? m.fluidSpeedMultiplier * (.55 + m.speed * .2)
      : effect === 'rhythm_skin' ? m.skinFlowSpeedMultiplier * .45 * (.55 + m.speed * .2) : .5 + m.speed * .3
    drive(motion, config, reduced, speed, effect !== 'vortex')
    if (effect === 'rhythm_fluid') {
      uniforms.uCount.value=m.fluidCount;uniforms.uWidth.value=m.fluidWidth
      uniforms.uTrail.value=1/(1+m.sourceFluidFadeSpeed*.045)
    } else if (effect === 'rhythm_skin') {
      uniforms.uWidth.value=m.dragonWidth;uniforms.uTrail.value=m.dragonTrail
      // The former afterglow now controls the light running through the rail's gaps.
      group.children[1].visible=m.dragonTrail>0
    } else { uniforms.uCount.value=m.vortexArms;uniforms.uWidth.value=m.vortexWidth;uniforms.uRange.value=m.vortexRange }
  } }
}
