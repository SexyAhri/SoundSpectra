import * as T from 'three'
import { AudioClock, random, spectral, type KineticEffect } from '../kinetic/common'
import { createSpectralValley } from './spectral-valley'

const vertex=`
attribute float aSeed,aHeight;
varying vec3 vWorld,vNormal;varying vec2 vUv;varying float vSeed,vHeight;
void main(){
 vec4 p=instanceMatrix*vec4(position,1.);vWorld=(modelMatrix*p).xyz;
 vNormal=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
 vUv=uv;vSeed=aSeed;vHeight=aHeight;
 gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`
const fragment=`
uniform vec3 uColor,uAccent;uniform float uVolume,uTime,uNotes;
varying vec3 vWorld,vNormal;varying vec2 vUv;varying float vSeed,vHeight;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec3 n=normalize(vNormal),tint=mix(uColor,uAccent,vSeed);
 float lighting=.25+.75*max(0.,dot(n,normalize(vec3(-.5,.8,1.))));
 vec3 color=tint*(.035+lighting*.08);
 vec2 grid=vec2(vUv.x*3.,vUv.y*vHeight*1.1),cell=fract(grid);
 float windows=step(.16,cell.x)*(1.-step(.72,cell.x))*step(.22,cell.y)*(1.-step(.58,cell.y));
 windows*=step(.26,hash(floor(grid)+vSeed*73.));
 float edge=1.-smoothstep(.012,.035,min(vUv.x,1.-vUv.x));
 float crown=smoothstep(.93,.995,vUv.y);
 float scan=exp(-pow((vUv.y-fract(uTime*.08+vSeed))*22.,2.));
 color+=tint*(windows*(.2+uVolume*.6)+edge*.36+crown*.9+scan*.4*uNotes);
 color+=vec3(1.,.64,.25)*windows*step(.78,vSeed)*.35;
 float fog=exp(-max(0.,-vWorld.z-30.)*.006);
 gl_FragColor=vec4(mix(uAccent*.018,color,fog),1.);
}`
const plainVertex='varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}'
const waterFragment=`
uniform vec3 uColor,uAccent;uniform float uTime,uVolume,uNotes;uniform float uBands[40];uniform float uCount;
varying vec3 vP;
void main(){
 float cell=(vP.x+110.)/220.*uCount;
 float col=floor(clamp(cell,0.,uCount-1.));
 float level=uBands[int(col)];
 float streak=pow(.5+.5*cos(cell*6.283+sin(vP.z*.6+uTime)*.35),12.);
 float broken=.25+.75*pow(.5+.5*sin(vP.z*2.2+sin(vP.x*.8)+uTime*1.5),4.);
 float distance=exp(-pow((vP.z+24.)/68.,2.));
 vec3 tint=mix(uColor,uAccent,fract(col*.173));
 vec3 color=tint*(.014+streak*broken*distance*(.06+level*.38));
 float bank=exp(-pow((vP.z+28.)*1.5,2.));
 color+=mix(uColor,uAccent,.3)*bank*.45;
 gl_FragColor=vec4(color,1.);
}`

/** A layered skyline across a reflective waterfront; bins drive individual towers. */
export function createSpectrumWorld(canyon=false):KineticEffect {
 if(canyon)return createSpectralValley()
 const group=new T.Group(),clock=new AudioClock(),values=new Float32Array(40),transform=new T.Object3D()
 const uniforms={uColor:{value:new T.Color()},uAccent:{value:new T.Color()},uVolume:{value:0},uTime:{value:0},uNotes:{value:1},uBands:{value:values},uCount:{value:28}}
 const capacity=40*4,geometry=new T.BoxGeometry(1,1,1)
 const seeds=new T.InstancedBufferAttribute(new Float32Array(capacity),1),heights=new T.InstancedBufferAttribute(new Float32Array(capacity),1)
 geometry.setAttribute('aSeed',seeds);geometry.setAttribute('aHeight',heights)
 const material=new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,toneMapped:false})
 const towers=new T.InstancedMesh(geometry,material,capacity);towers.frustumCulled=false;towers.instanceMatrix.setUsage(T.DynamicDrawUsage);group.add(towers)
 const waterGeometry=new T.PlaneGeometry(340,300);waterGeometry.rotateX(-Math.PI/2);waterGeometry.translate(0,-7,-65)
 group.add(new T.Mesh(waterGeometry,new T.ShaderMaterial({uniforms,vertexShader:plainVertex,fragmentShader:waterFragment,side:T.DoubleSide,toneMapped:false})))
 const sky=new T.Mesh(new T.SphereGeometry(280,32,24),new T.ShaderMaterial({uniforms,side:T.BackSide,depthWrite:false,toneMapped:false,vertexShader:plainVertex,
 fragmentShader:`uniform vec3 uColor,uAccent;varying vec3 vP;void main(){float horizon=exp(-pow((vP.y-5.)/45.,2.));float light=exp(-pow((vP.x-35.)/100.,2.));vec3 c=mix(uAccent,uColor,light)*(.008+horizon*.065);gl_FragColor=vec4(c,1.);}`}))
 group.add(sky)
 return {group,update(motion,config,reduced){
   const m=config.music;clock.step(motion,reduced,.4+m.speed*.15)
   if(clock.reset)values.fill(0)
   uniforms.uTime.value=clock.time;uniforms.uVolume.value=motion.volume;uniforms.uNotes.value=m.spectrumNoteDensity;uniforms.uCount.value=m.spectrumTracks
   uniforms.uColor.value.set(config.color);uniforms.uAccent.value.set(m.fieldPalette==='ember'?'#f278aa':m.fieldPalette==='lake'?'#6b98ff':'#bb81ef')
   const count=m.spectrumTracks
   for(let i=0;i<count;i++){
     const target=spectral(motion,i/(count-1))
     values[i]+=(target-values[i])*(1-Math.exp(-clock.dt*(target>values[i]?18:5)))
   }
   let index=0
   for(let row=0;row<4;row++)for(let i=0;i<count;i++){
     const seed=random(i*17+row*71),bin=(i+row*5)%count
     const height=(5+Math.pow(seed,1.6)*24+values[bin]*28)*m.spectrumAmplitude
     const width=(220/count)*(.42+seed*.26)
     transform.position.set(-110+(i+.5)*220/count+row*2,-7+height/2,-34-row*26-seed*7)
     transform.scale.set(width,height,4+seed*5);transform.rotation.set(0,0,0);transform.updateMatrix()
     towers.setMatrixAt(index,transform.matrix);seeds.setX(index,(i/count*.7+row*.15)%1);heights.setX(index,height);index++
   }
   towers.count=index;towers.instanceMatrix.needsUpdate=true;seeds.needsUpdate=true;heights.needsUpdate=true
 }}
}
