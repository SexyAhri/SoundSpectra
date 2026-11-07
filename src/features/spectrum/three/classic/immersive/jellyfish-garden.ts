import * as T from 'three'
import { material, mesh, randomStream, surfaceGeometry, surfaceVertex, uniformSource, type FlowEffect } from '../flow/shared'
import { luminousDriver, luminousSource, luminousUniforms } from './luminous-motion'
import { volumeGlow } from './light-kit'
import { glowClouds } from './glow-clouds'
import { jellyfishCenter, jellyfishPathSource } from './jellyfish-path'
import { jellyfishMotion, jellyfishMotionSource } from './jellyfish-motion'

// Keep the authored depth haze when the user changes zoom or the region aspect.
// Those camera adjustments must not fade the entire garden out of existence.
const depthSource = `uniform float uViewScale;
float jellyDepth(vec3 point){return exp(-max(0.,length(cameraPosition-point)/uViewScale-38.)*.026);}
`

const anatomy = `
${jellyfishMotionSource}
float bodySize(float id){
  float flatRadius=1.8+mod(id*1.7,1.);
  float deepRadius=(2.05+fract(id*.73)*.65)*(id<.5?1.85:1.);
  return mix(deepRadius,flatRadius,uTwist)*uWidth;
}
${jellyfishPathSource}
float breathe(float id){
  return 1.-bellStroke(id)*.19-uSlowBass*.025;
}
vec3 tentacle(float t,float lane){
  float id=floor(lane/10.),strand=mod(lane,10.),angle=strand/10.*TAU;
  float r=bodySize(id),rootWake=armWake(id),tip=tipWake(id);
  float wake=mix(rootWake,tip,smoothstep(.18,.94,t));
  float spread=r*.86*(1.-t*.23)*mix(breathe(id),1.,smoothstep(0.,.3,t));
  float length=r*(1.65+uTrail*1.25+sin(strand*8.)*.23);
  float flow=t*(4.8+fract(strand*.37)*1.6)-uPhase*(.42+id*.012)+id+strand*.63;
  vec3 sway=vec3(sin(flow)+sin(flow*1.63+strand)*.28,.14*sin(flow*1.3),cos(flow*.83+strand));
  vec3 local=vec3(cos(angle)*spread,-r*.12-t*length,sin(angle)*spread);
  local+=sway*pow(t,1.4)*r*(.19+uSlowMid*.09+wake*.20);
  local.x+=sin(angle+1.2)*wake*r*sin(t*PI)*.24;
  local.z+=(rootWake-tip)*r*smoothstep(.35,1.,t)*sin(angle+.7)*.24;
  return swimPoint(local,id,t*(.65+wake*.22));
}
`

/** Bell anatomy, oral ribbons and continuous tentacle tubes share fixed seed positions. */
export function createJellyfishGarden(detail = 1): FlowEffect {
  const group = new T.Group(), uniforms = { ...luminousUniforms(), uViewScale:{value:1}, uJellyStroke:{value:new Float32Array(7)},uJellyWake:{value:new Float32Array(7)},uJellyTip:{value:new Float32Array(7)},uJellyTravel:{value:new Float32Array(7)} }, drive = luminousDriver(uniforms)
  const glows = glowClouds(group, 7), tint = new T.Color()
  let wide = 0, aspect = 1
  group.name = 'jellyfish-garden'
  const bells = surfaceGeometry(Math.round(32 * Math.max(.65, Math.min(1.2, detail))), 80, 14)
  const bellMaterial = material(uniforms, surfaceVertex(`
    float shell=mod(lane,2.);lane=floor(lane/2.);
    float r=bodySize(lane)*(shell<.5?1.:.84),stroke=bellStroke(lane);vLight=shell;
    float radial=sin(t*PI*.55)*r*mix(1.,breathe(lane),smoothstep(.10,1.,t));
    float hem=sin(a*16.+lane+sin(a*5.)*.3)*pow(t,8.);
    radial*=1.+hem*(.020+stroke*.025);
    float height=cos(t*PI*.55)*r*(.74+stroke*.18)*(1.-shell*.13)-shell*r*.055;
    height+=hem*r*.035;
    p=swimPoint(vec3(cos(a)*radial,height,sin(a)*radial),lane,0.);
  `, luminousSource + volumeGlow + anatomy), `${uniformSource}${luminousSource}${volumeGlow}${depthSource}
  varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
  void main(){
    float radial=clamp(vUv.x,0.,1.),angle=vUv.y*6.2831853;
    float rim=pow(radial,32.);
    vec3 tint=mix(uColor,uAccent,.18+.52*fract(vLane*.381));
    vec3 n=cross(dFdx(vWorld),dFdy(vWorld));
    float fresnel=fresnelShell(n,cameraPosition-vWorld,2.1+vLight*.35);
    float canals=pow(max(0.,cos(angle*16.+sin(radial*4.)*.18)),34.)*smoothstep(.12,.5,radial);
    float organs=pow(max(0.,cos(angle*4.)),3.)*exp(-pow((radial-.34)/.16,2.));
    float tissue=exp(-pow((radial-.58)/.43,2.));
    float age=max(0.,uOnsetAge-(vLane<.5?0.:.035+mod(vLane*.037,.14)));
    float front=exp(-pow((radial-clamp(age*2.8,0.,3.))/.11,2.))*uOnsetStrength;
    float cells=pow(max(0.,sin(angle*53.+radial*27.)),32.)*pow(radial,5.)*uFastHigh;
    vec3 color=tint*(.22+fresnel*.5+tissue*.16+canals*(.18+front*.7))+mix(uAccent,uHighlight,.28)*organs*.48;
    color+=uHighlight*(rim*(vLight<.5?.52:.025)+cells*.30+front*canals*.32);
    float depth=jellyDepth(vWorld);
    float shellAlpha=vLight<.5?.34:.12;
    gl_FragColor=vec4(color*mix(.5,1.,depth),shellAlpha*(.40+fresnel*.62+rim*.32+organs*.55)*depth);
  }`)
  bellMaterial.depthWrite = false; bellMaterial.blending = T.AdditiveBlending
  mesh(group, bells, bellMaterial)
  const threads = surfaceGeometry(Math.round(56 * Math.max(.65, Math.min(1.2,detail))), 4, 70)
  mesh(group, threads, material(uniforms, surfaceVertex(`
    vec3 path=tentacle(t,lane);
    vec3 tangent=normalize(tentacle(min(1.,t+.001),lane)-tentacle(max(0.,t-.001),lane));
    vec3 side=normalize(cross(tangent,vec3(1.,0.,0.))),up=cross(side,tangent);
    float radius=(.016+.005*mod(lane,3.))*(1.-t*.78)*uWidth;
    p=path+(side*cos(a)+up*sin(a))*radius;
    vAlpha=pow(max(0.,1.-t),.55)*(.40+uSlowMid*.32);
  `, luminousSource + anatomy), `${uniformSource}${luminousSource}${depthSource}
  varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
  void main(){
    float t=clamp(vUv.x,0.,1.);
    float cells=pow(max(0.,sin(t*54.-uPhase*.4+vLane*2.)),22.)*smoothstep(.45,1.,t)*uFastHigh;
    float depth=jellyDepth(vWorld);
    vec3 tint=mix(uColor,uAccent,.2+.5*fract(floor(vLane/10.)*.381));
    // MSAA edge invocations can extrapolate varyings beyond the covered tube.
    // Bound opacity before additive blending so HDR cannot receive negative light.
    gl_FragColor=vec4(tint*(.7+cells*.5)+uHighlight*cells*.25,clamp(vAlpha*depth,0.,1.));
  }`, true))
  const oral = surfaceGeometry(Math.round(56 * Math.max(.65, Math.min(1.2,detail))), 10, 28)
  const oralMaterial = material(uniforms, surfaceVertex(`
    float id=floor(lane/4.),arm=mod(lane,4.);float r=bodySize(id),angle=arm*PI*.5+id;
    float wake=mix(armWake(id),tipWake(id),smoothstep(.2,.9,t)),across=(uv.y-.5)*2.;
    float length=r*(1.5+uTrail*.75),width=pow(max(0.,sin(t*PI)),.65)*r*.17*(1.-t*.4);
    float fold=sin(t*28.-uPhase*.48+lane)*.26+sin(t*51.-uPhase*.48+lane)*.10;
    vec3 side=vec3(cos(angle),0.,sin(angle));
    vec3 center=vec3(sin(t*5.+angle-uPhase*.35)*t*r*(.22+wake*.17),-r*.08-t*length,cos(t*4.+angle-uPhase*.3)*t*r*.24);
    center+=side*r*(.12+t*.16);
    p=swimPoint(center+side*(across*width*(1.+fold))+vec3(0.,fold*width*(.25+abs(across)*.9),0.),id,t*.55);
    vAlpha=pow(max(0.,sin(t*PI)),.7)*(.30+uSlowMid*.18);vLight=.25;
  `, luminousSource + anatomy),`${uniformSource}${luminousSource}${volumeGlow}${depthSource}
    varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
    void main(){
      float t=clamp(vUv.x,0.,1.),across=clamp(abs(vUv.y-.5)*2.,0.,1.);
      vec3 normal=cross(dFdx(vWorld),dFdy(vWorld));
      float rim=fresnelShell(normal,cameraPosition-vWorld,2.4);
      float veins=pow(.5+.5*cos(across*22.+t*18.),12.);
      float depth=jellyDepth(vWorld);
      vec3 tint=mix(uColor,uAccent,.38+.25*sin(vLane*2.4+t*4.));
      vec3 color=tint*(.48+rim*.36+veins*.20)+uHighlight*pow(across,8.)*.12;
      gl_FragColor=vec4(color,clamp(vAlpha*depth*(.65+rim*.35),0.,.8));
    }`)
  oralMaterial.depthWrite = false; mesh(group, oral, oralMaterial)
  const random = randomStream(83127), count = Math.round(240 * Math.max(.65, Math.min(1.2, detail)))
  const positions = new Float32Array(count * 3), seeds = new Float32Array(count)
  for (let i = 0; i < count; i++) { positions.set([(random()-.5)*100,(random()-.5)*60,-70+random()*80],i*3); seeds[i]=random() }
  const dust = new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(positions,3)).setAttribute('aSeed',new T.BufferAttribute(seeds,1))
  const motes = new T.Points(dust,new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false,
    vertexShader:`${uniformSource}${depthSource}attribute float aSeed;varying float vAlpha;
      void main(){vec3 p=position;p.x+=sin(uPhase*.13+aSeed*30.)*.3;p.y+=sin(uPhase*.12+aSeed*9.)*.4;
      vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
      gl_PointSize=clamp((.6+aSeed)*65./max(8.,-mv.z),.6,3.)*uPixelRatio;
      vAlpha=(.06+aSeed*.12)*exp(-max(0.,-mv.z/uViewScale-35.)*.025);}`,
    fragmentShader:`${uniformSource}varying float vAlpha;void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(mix(uColor,uHighlight,.35),exp(-r*r*7.)*vAlpha);}` }))
  motes.frustumCulled=false;group.add(motes)
  return { group, layout(nextAspect) {
    aspect=nextAspect
    wide=aspect>3?1:0;uniforms.uTwist.value=wide
    uniforms.uRange.value=wide?Math.min(150,Math.max(17,aspect*20)):Math.max(24,aspect*20)
  }, update(motion, config, reduced) {
    const m=config.music
    uniforms.uViewScale.value=Math.max(1,config.view.distance*1.35/m.fieldScale*Math.max(1,1.15/aspect))
    drive(motion,config,reduced,(.28+m.driftSpeed*.32)*(.6+m.speed*.12))
    const swim=jellyfishMotion(motion,reduced)
    uniforms.uJellyStroke.value.set(swim.stroke);uniforms.uJellyWake.value.set(swim.wake);uniforms.uJellyTip.value.set(swim.tip);uniforms.uJellyTravel.value.set(swim.travel)
    uniforms.uWidth.value=m.jellySize/2.4;uniforms.uCount.value=m.jellyCount;uniforms.uTrail.value=m.tentacleLength;uniforms.uDepth.value=m.ambientSpread
    bells.instanceCount=m.jellyCount*2;threads.instanceCount=m.jellyCount*10;oral.instanceCount=m.jellyCount*4
    const phase=uniforms.uPhase.value
    for(let id=0;id<m.jellyCount;id++){
      const radius=(wide?1.8+(id*1.7)%1:(2.05+(id*.73)%1*.65)*(id===0?1.85:1))*m.jellySize/2.4
      const [x,y,z]=jellyfishCenter(phase+swim.travel[id],id,m.jellyCount,uniforms.uRange.value,wide,m.ambientSpread)
      tint.copy(uniforms.uColor.value).lerp(uniforms.uAccent.value,.18+.52*((id*.381)%1))
      glows.place(id,x,y+radius*.15,z,radius*1.8,radius*1.25,1,tint,.04+uniforms.uSlowMid.value*.05)
    }
    glows.finish(m.jellyCount)
  } }
}
