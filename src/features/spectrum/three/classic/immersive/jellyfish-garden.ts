import * as T from 'three'
import { material, mesh, surfaceGeometry, surfaceVertex, uniformSource, type FlowEffect } from '../flow/shared'
import { luminousDriver, luminousSource, luminousUniforms } from './luminous-motion'
import { volumeGlow } from './light-kit'
import { instancedTrail } from './instanced-trail'
import { glowClouds } from './glow-clouds'

const anatomy = `
float size(float id){return (1.8+mod(id*1.7,1.))*uWidth;}
float breathe(float id){return 1.+sin(uPhase*.55+id*1.7)*.025+(uSlowBass-.4)*.16-uBeatGlow*.12;}
vec3 center(float id){
  float x=(id/max(1.,uCount-1.)-.5)*uRange;
  return vec3(x+sin(uPhase*.24+id*2.)*1.4,2.+sin(id*2.4)*3.+sin(uPhase*.3+id)*1.5+uSlowBass*.6,-1.+sin(id*5.)*3.);
}
vec3 tentacle(float t,float lane){
  float id=floor(lane/10.),strand=mod(lane,10.),angle=strand/10.*TAU;
  float r=size(id),spread=r*.65*(1.-t*.7)*breathe(id);
  float length=r*(1.8+uTrail*1.5+sin(strand*8.)*.3);
  return center(id)+vec3(cos(angle)*spread,-t*length,sin(angle)*spread)
    +curlNoise3D(vec3(t*3.+id,strand*.3,uPhase*.16))*t*r*.25;
}
`

/** Bell surfaces and continuous tapered tentacles share the same audio-driven anatomy. */
export function createJellyfishGarden(): FlowEffect {
  const group = new T.Group(), uniforms = luminousUniforms(), drive = luminousDriver(uniforms)
  const glows = glowClouds(group, 7), tint = new T.Color()
  const bells = surfaceGeometry(32, 64, 21)
  const bellMaterial = material(uniforms, surfaceVertex(`
    float shell=mod(lane,3.);lane=floor(lane/3.);vLane=lane;
    float r=size(lane)*(shell<.5?.90:shell<1.5?1.:1.14),az=a;vLight=shell;
    float radial=sin(t*PI*.5)*r*breathe(lane)*(1.+pow(t,6.)*sin(az*12.)*.025);
    p=center(lane)+vec3(cos(az)*radial,cos(t*PI*.5)*r*.68+sin(az*12.)*pow(t,8.)*.07,sin(az)*radial);
  `, luminousSource + volumeGlow + anatomy), `${uniformSource}${luminousSource}${volumeGlow}
  varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
  void main(){
    // MSAA samples at a grazing rim can extrapolate UV outside the triangle.
    // Bound it before the high-power edge term to keep HDR emission finite.
    float radial=clamp(vUv.x,0.,1.);
    float rim=pow(radial,22.);
    vec3 tint=mix(uColor,uAccent,.22+.55*fract(vLane*.381));
    vec3 n=cross(dFdx(vWorld),dFdy(vWorld));
    float fresnel=fresnelShell(n,cameraPosition-vWorld,2.5+vLight*.6);
    float inner=exp(-pow((radial-.45)/.2,2.))*(.1+uSlowMid*.2);
    vec3 color=tint*(.18+fresnel*.65+inner)+uHighlight*rim*1.9;
    float shellAlpha=vLight<.5?.06:vLight<1.5?.12:.28;
    gl_FragColor=vec4(color,shellAlpha*(.2+fresnel*.8+rim));
  }`)
  bellMaterial.depthWrite = false
  bellMaterial.blending=T.AdditiveBlending
  mesh(group, bells, bellMaterial)
  const threads = instancedTrail(group, uniforms, 70, 40, `
    float id=floor(lane/10.);t=fract(t-uPhase*.045);
    p=tentacle(t,lane);
    float travel=.45+.55*pow(.5+.5*sin(t*18.-uPhase*2.+lane),3.);
    float tip=smoothstep(.7,1.,t)*uFastHigh;
    size=sizeOf(id)*(.1+tip*.06)*(1.-t*.65);
    vAlpha=pow(1.-t,.65)*(.38+uSlowMid*.5)*travel+tip*.16;
    vTint=.22+.55*fract(id*.381);
  `, anatomy.replaceAll('size(', 'sizeOf('))
  return { group, layout(aspect) { uniforms.uRange.value = Math.min(150, Math.max(17, aspect * 20)) }, update(motion, config, reduced) {
    const m = config.music
    drive(motion, config, reduced, (.28 + m.driftSpeed * .32) * (.6 + m.speed * .12))
    uniforms.uWidth.value = m.jellySize / 2.4; uniforms.uCount.value = m.jellyCount; uniforms.uTrail.value = m.tentacleLength
    bells.instanceCount = m.jellyCount*3; threads.instanceCount = m.jellyCount * 10 * 40
    const phase = uniforms.uPhase.value
    for (let id=0;id<m.jellyCount;id++) {
      const radius=(1.8+(id*1.7)%1)*m.jellySize / 2.4
      const x=(id/Math.max(1,m.jellyCount-1)-.5)*uniforms.uRange.value+Math.sin(phase*.24+id*2)*1.4
      const y=2+Math.sin(id*2.4)*3+Math.sin(phase*.3+id)*1.5+uniforms.uSlowBass.value*.6
      tint.copy(uniforms.uColor.value).lerp(uniforms.uAccent.value,.22+.55*((id*.381)%1))
      glows.place(id,x,y+radius*.25,-1+Math.sin(id*5)*3,radius*2.8,radius*1.6,1,tint,.13+uniforms.uSlowMid.value*.17)
    }
    glows.finish(m.jellyCount)
  } }
}
