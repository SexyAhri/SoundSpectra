import * as T from 'three'
import { material, mesh, randomStream, surfaceGeometry, surfaceVertex, uniformSource, type FlowEffect } from '../flow/shared'
import { luminousDriver, luminousSource, luminousUniforms } from './luminous-motion'
import { volumeGlow } from './light-kit'
import { glowClouds } from './glow-clouds'
import { jellyfishCenter, jellyfishPathSource } from './jellyfish-path'

const anatomy = `
float bodySize(float id){
  float flatRadius=1.8+mod(id*1.7,1.);
  float deepRadius=(2.05+fract(id*.73)*.65)*(id<.5?1.65:1.);
  return mix(deepRadius,flatRadius,uTwist)*uWidth;
}
${jellyfishPathSource}
float breathe(float id){
  float stroke=pow(.5+.5*sin(uPhase*(1.1+fract(id*.31)*.22)+id*2.399963),4.);
  float kick=uAccents.x*(.55+.45*fract(id*.381));
  return 1.-stroke*(.035+uSlowBass*.12)-kick*.14;
}
vec3 tentacle(float t,float lane){
  float id=floor(lane/10.),strand=mod(lane,10.),angle=strand/10.*TAU;
  float r=bodySize(id),spread=r*.72*(1.-t*.86)*breathe(id);
  float length=r*(1.9+uTrail*1.35+sin(strand*8.)*.22);
  vec3 sway=vec3(sin(t*5.-uPhase*.6+id+strand*.4),sin(t*4.+strand),cos(t*6.-uPhase*.45+strand*.7));
  return swimPoint(vec3(cos(angle)*spread,-t*length,sin(angle)*spread)
    +sway*pow(t,1.6)*r*(.12+uSlowMid*.08),id,t*.7);
}
`

/** Bell anatomy, oral ribbons and continuous tentacle tubes share fixed seed positions. */
export function createJellyfishGarden(detail = 1): FlowEffect {
  const group = new T.Group(), uniforms = luminousUniforms(), drive = luminousDriver(uniforms)
  const glows = glowClouds(group, 7), tint = new T.Color()
  let wide = 0
  group.name = 'jellyfish-garden'
  const bells = surfaceGeometry(Math.round(40 * Math.max(.65, Math.min(1.2, detail))), 64, 21)
  const bellMaterial = material(uniforms, surfaceVertex(`
    float shell=mod(lane,3.);lane=floor(lane/3.);
    float r=bodySize(lane)*(shell<.5?.86:shell<1.5?.96:1.04);vLight=shell;
    float radial=sin(t*PI*.5)*r*breathe(lane);
    float hem=sin(a*16.+lane)*pow(t,9.);
    radial*=1.+hem*.035;
    p=swimPoint(vec3(cos(a)*radial,cos(t*PI*.5)*r*(.66+uSlowBass*.07)+hem*r*.025,sin(a)*radial),lane,0.);
  `, luminousSource + volumeGlow + anatomy), `${uniformSource}${luminousSource}${volumeGlow}
  varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
  void main(){
    float radial=clamp(vUv.x,0.,1.),angle=vUv.y*6.2831853;
    float rim=pow(radial,26.);
    vec3 tint=mix(uColor,uAccent,.18+.52*fract(vLane*.381));
    vec3 n=cross(dFdx(vWorld),dFdy(vWorld));
    float fresnel=fresnelShell(n,cameraPosition-vWorld,2.1+vLight*.35);
    float canals=pow(max(0.,cos(angle*12.+sin(radial*5.)*.25)),26.)*smoothstep(.12,.5,radial);
    float organs=pow(max(0.,cos(angle*4.)),4.)*exp(-pow((radial-.37)/.18,2.));
    float tissue=exp(-pow((radial-.62)/.36,2.))*(.1+uSlowMid*.22);
    float cells=pow(max(0.,sin(angle*53.+radial*27.)),32.)*pow(radial,5.)*uFastHigh;
    vec3 color=tint*(.16+fresnel*.55+tissue+canals*(.22+uAccents.x*.6)+organs*.13)+uHighlight*(rim*.95+cells*.22);
    float depth=exp(-max(0.,length(cameraPosition-vWorld)-38.)*.026);
    float shellAlpha=vLight<.5?.08:vLight<1.5?.14:.26;
    gl_FragColor=vec4(color*mix(.55,1.,depth),shellAlpha*(.3+fresnel*.7+rim*.65+organs*.4)*depth);
  }`)
  bellMaterial.depthWrite = false; bellMaterial.blending = T.AdditiveBlending
  mesh(group, bells, bellMaterial)
  const threads = surfaceGeometry(Math.round(64 * Math.max(.65, detail)), 4, 70)
  mesh(group, threads, material(uniforms, surfaceVertex(`
    vec3 path=tentacle(t,lane);
    vec3 tangent=normalize(tentacle(min(1.,t+.001),lane)-tentacle(max(0.,t-.001),lane));
    vec3 side=normalize(cross(tangent,vec3(1.,0.,0.))),up=cross(side,tangent);
    float radius=(.013+.004*mod(lane,3.))*(1.-t*.76)*uWidth;
    p=path+(side*cos(a)+up*sin(a))*radius;
    vAlpha=pow(max(0.,1.-t),.55)*(.32+uSlowMid*.4);
  `, luminousSource + anatomy), `${uniformSource}${luminousSource}
  varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
  void main(){
    float t=clamp(vUv.x,0.,1.);
    float cells=pow(max(0.,sin(t*54.-uPhase*.4+vLane*2.)),22.)*smoothstep(.45,1.,t)*uFastHigh;
    float depth=exp(-max(0.,length(cameraPosition-vWorld)-38.)*.026);
    vec3 tint=mix(uColor,uAccent,.2+.5*fract(floor(vLane/10.)*.381));
    // MSAA edge invocations can extrapolate varyings beyond the covered tube.
    // Bound opacity before additive blending so HDR cannot receive negative light.
    gl_FragColor=vec4(tint*(.7+cells*.5)+uHighlight*cells*.25,clamp(vAlpha*depth,0.,1.));
  }`, true))
  const oral = surfaceGeometry(Math.round(60 * Math.max(.65, detail)), 8, 28)
  const oralMaterial = material(uniforms, surfaceVertex(`
    float id=floor(lane/4.),arm=mod(lane,4.);float r=bodySize(id),angle=arm*PI*.5+id;
    float length=r*(1.35+uTrail*.7),width=sin(t*PI)*r*.19;
    float fold=sin(t*32.-uPhase*.5+lane)*.4+sin(t*61.+lane)*.12;
    vec3 side=vec3(cos(angle),0.,sin(angle));
    p=swimPoint(vec3(sin(t*5.+angle-uPhase*.2)*t*r*.18,-t*length,cos(t*4.+angle)*t*r*.18)
      +side*((uv.y-.5)*2.*width*(1.+fold))+vec3(0.,fold*width*.35,0.),id,t*.45);
    vAlpha=sin(t*PI)*(.12+uSlowMid*.17);vLight=.08;
  `, luminousSource + anatomy))
  oralMaterial.depthWrite = false; mesh(group, oral, oralMaterial)
  const random = randomStream(83127), count = Math.round(240 * Math.max(.65, Math.min(1.2, detail)))
  const positions = new Float32Array(count * 3), seeds = new Float32Array(count)
  for (let i = 0; i < count; i++) { positions.set([(random()-.5)*100,(random()-.5)*60,-70+random()*80],i*3); seeds[i]=random() }
  const dust = new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(positions,3)).setAttribute('aSeed',new T.BufferAttribute(seeds,1))
  const motes = new T.Points(dust,new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false,
    vertexShader:`${uniformSource}attribute float aSeed;varying float vAlpha;
      void main(){vec3 p=position;p.x+=sin(uPhase*.13+aSeed*30.)*.3;p.y+=sin(uPhase*.12+aSeed*9.)*.4;
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
      gl_PointSize=clamp((.6+aSeed)*65./max(8.,-mv.z),.6,3.)*uPixelRatio;
      vAlpha=(.06+aSeed*.12)*exp(-max(0.,-mv.z-35.)*.025);}`,
    fragmentShader:`${uniformSource}varying float vAlpha;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(mix(uColor,uHighlight,.35),exp(-r*r*7.)*vAlpha);}` }))
  motes.frustumCulled=false;group.add(motes)
  return { group, layout(aspect) {
    wide=aspect>3?1:0;uniforms.uTwist.value=wide
    uniforms.uRange.value=wide?Math.min(150,Math.max(17,aspect*20)):Math.max(24,aspect*20)
  }, update(motion, config, reduced) {
    const m=config.music
    drive(motion,config,reduced,(.28+m.driftSpeed*.32)*(.6+m.speed*.12))
    uniforms.uWidth.value=m.jellySize/2.4;uniforms.uCount.value=m.jellyCount;uniforms.uTrail.value=m.tentacleLength;uniforms.uDepth.value=m.ambientSpread
    bells.instanceCount=m.jellyCount*3;threads.instanceCount=m.jellyCount*10;oral.instanceCount=m.jellyCount*4
    const phase=uniforms.uPhase.value
    for(let id=0;id<m.jellyCount;id++){
      const radius=(wide?1.8+(id*1.7)%1:(2.05+(id*.73)%1*.65)*(id===0?1.65:1))*m.jellySize/2.4
      const [x,y,z]=jellyfishCenter(phase,id,m.jellyCount,uniforms.uRange.value,wide,m.ambientSpread)
      tint.copy(uniforms.uColor.value).lerp(uniforms.uAccent.value,.18+.52*((id*.381)%1))
      glows.place(id,x,y+radius*.2,z,radius*2.3,radius*1.4,1,tint,.07+uniforms.uSlowMid.value*.09)
    }
    glows.finish(m.jellyCount)
  } }
}
