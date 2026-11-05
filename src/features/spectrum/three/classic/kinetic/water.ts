import * as T from 'three'
import { AudioClock, Batch, TAU, Tint, type KineticEffect } from './common'

const waveUniforms=`
uniform vec4 uDrops[6];
uniform float uRange;
uniform float uEchoes;
uniform float uPhase;
uniform float uVolume;
uniform float uSpeed;
`
const vertex=`${waveUniforms}
varying vec3 vWorld;
varying vec2 vPosition;
varying float vCrest;
void main() {
  vec3 p=position;
  float height=sin(p.x*.35+uPhase*.35)*cos(p.z*.28-uPhase*.22)*uVolume*.12;
  float crest=0.;
  for(int i=0;i<6;i++) {
    vec4 drop=uDrops[i];
    float age=drop.z-.5;
    if(drop.w<=0. || age<0.)continue;
    float distance=length(p.xz-drop.xy);
    float front=distance-age*(2.+uSpeed*.35)*uRange;
    float width=.6+age*.16;
    float envelope=exp(-abs(front)/(width*(.65+uEchoes*.4)))*exp(-age*.4);
    float wave=cos(front*4.)*envelope*drop.w;
    height+=wave*.42;
    crest+=max(0.,wave);
  }
  p.y+=height;
  vWorld=(modelMatrix*vec4(p,1.)).xyz;vPosition=p.xz;vCrest=crest;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`
const fragment=`
uniform vec3 uCool;
uniform vec3 uWarm;
varying vec3 vWorld;
varying vec2 vPosition;
varying float vCrest;
void main() {
  float radius=length(vPosition/vec2(14.,10.));
  float edge=1.-smoothstep(.82,1.,radius);
  if(edge<.003)discard;
  vec3 normal=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
  if(!gl_FrontFacing)normal=-normal;
  vec3 view=normalize(cameraPosition-vWorld),light=normalize(vec3(-.3,.85,.45));
  float reflection=pow(max(0.,dot(reflect(-light,normal),view)),36.);
  float fresnel=pow(1.-abs(dot(normal,view)),3.);
  vec3 color=uCool*(.035+max(0.,dot(normal,light))*.07+fresnel*.12);
  vec2 cell=abs(fract(vPosition*.55-.5)-.5)/max(fwidth(vPosition*.55),vec2(.001));
  float lattice=1.-min(min(cell.x,cell.y),1.);
  color+=mix(uCool,uWarm,.35)*min(1.,vCrest)*.95;
  color+=uCool*lattice*(.018+min(1.,vCrest)*.09);
  color+=mix(uCool,vec3(.8,.9,1.),.45)*reflection*.55;
  gl_FragColor=vec4(color,edge*.8);
}`

/** Vertex-deformed water, not a painted ripple texture; each drop lands before its wave expands. */
export function waterSurface(detail: number): KineticEffect {
  const group=new T.Group(),clock=new AudioClock(),tint=new Tint()
  const geometry=new T.PlaneGeometry(28,20,Math.max(80,Math.round(130*Math.min(detail,1.5))),Math.max(56,Math.round(90*Math.min(detail,1.5))))
  geometry.rotateX(-Math.PI/2);geometry.translate(0,-4.8,0)
  const uniforms={uDrops:{value:Array.from({length:6},()=>new T.Vector4(0,0,0,0))},uRange:{value:1},uEchoes:{value:3},uPhase:{value:0},uVolume:{value:0},uSpeed:{value:2},uCool:{value:new T.Color()},uWarm:{value:new T.Color()}}
  const material=new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:true,side:T.DoubleSide,toneMapped:false})
  const water=new T.Mesh(geometry,material);water.frustumCulled=false;group.add(water)
  const drops=new Batch(group,new T.SphereGeometry(1,16,12),6)
  const boundary=new Batch(group,new T.TorusGeometry(1,.004,4,160,TAU*.93),1,true)
  const markers=new Batch(group,new T.OctahedronGeometry(1),24,true)
  return {group,update(motion,config,reduced){
    tint.update(config);clock.step(motion,reduced,.3+config.music.speed*.15)
    uniforms.uPhase.value=clock.time;uniforms.uVolume.value=motion.volume
    uniforms.uRange.value=config.music.waterRange;uniforms.uEchoes.value=config.music.waterEchoes;uniforms.uSpeed.value=config.music.speed
    uniforms.uCool.value.copy(tint.cool);uniforms.uWarm.value.copy(tint.warm)
    boundary.place(0,0,-4.78,0,14,10,1,tint.cool,.24,Math.PI/2)
    for(let i=0;i<24;i++) {
      const angle=i/24*TAU,size=i%3===0?.055:.025
      markers.place(i,Math.cos(angle)*14,-4.75,Math.sin(angle)*10,size,size,size,tint.at(i/24),.45)
    }
    boundary.finish();markers.finish()
    const start=Math.max(0,motion.ripples.length-config.music.waterDrops)
    for(let i=0;i<6;i++) {
      const ripple=i<config.music.waterDrops?motion.ripples[start+i]:undefined
      if(!ripple){uniforms.uDrops.value[i].set(0,0,0,0);drops.place(i,0,0,0,1,1,1,tint.cool,0);continue}
      const pointer=ripple.source==='pointer'
      // Music lands in the wider shared field; a pointer hit is already in this
      // water surface's world coordinates and must keep its exact location.
      const x=ripple.x*(pointer?1:.44),z=ripple.z*(pointer?1:.4),age=reduced&&pointer ? .9 : ripple.age
      const strength=ripple.strength*(pointer?1:.7)*Math.exp(-Math.max(0,ripple.lifetime-ripple.age)*.4)
      uniforms.uDrops.value[i].set(x,z,age,strength)
      const falling=age<.5,progress=Math.max(0,1-age/.5),radius=.13+strength*.08
      drops.place(i,x,-4.6+progress*progress*5,z,radius,radius*(1+progress*.7),radius,tint.high,falling&&!reduced?1:0)
    }
    drops.finish(6)
  }}
}
