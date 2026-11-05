import * as T from 'three'
import { flowDriver,randomStream,uniformSource,type FlowEffect } from '../flow/shared'
import { daylightSky,daylightUniforms } from './daylight'

const vertex=`${uniformSource}
attribute vec4 aSeed;varying float vDepth,vAlpha;
void main(){
 float rise=mod(aSeed.y*110.+uPhase*(1.3+aSeed.w),110.);
 vec3 center=vec3((aSeed.x-.5)*170.+sin(uPhase*.18+aSeed.y*15.)*6.+(rise-55.)*uTwist,
   rise-45.,-110.+aSeed.z*125.);
 float a=(aSeed.x-.5)*1.1+sin(uPhase*.3+aSeed.y)*.3;
 vec3 p=position*(1.1+aSeed.w*1.8)*uTrail;
 float flutter=sin(uPhase*.6+aSeed.x*13.);
 p.y+=p.x*flutter*.18;
 p.xy=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xy;
 p+=center;
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 vDepth=clamp(-mv.z/170.,0.,1.);vAlpha=smoothstep(0.,10.,rise)*(1.-smoothstep(95.,110.,rise));
}`
const fragment=`${uniformSource} varying float vDepth,vAlpha;
void main(){vec3 tint=mix(uColor,vec3(.78,.89,.87),vDepth*.55);gl_FragColor=vec4(tint,vAlpha*(.95-vDepth*.25));}`

/** Dandelion-like canopies drift through daylight; audio controls lift and feather opening. */
export function createSunlitSeeds(detail:number):FlowEffect{
 const group=new T.Group(),uniforms=daylightUniforms(),drive=flowDriver(uniforms)
 uniforms.uSkyHigh.value.set('#6bb6d5');uniforms.uSkyLow.value.set('#c6e1e4');daylightSky(group,uniforms)
 const positions:number[]=[]
 const segment=(a:number[],b:number[])=>positions.push(...a,...b)
 // Each seed has a curved umbrella, fine feather branches and a suspended stem.
 for(let spoke=0;spoke<20;spoke++){
   const angle=spoke/20*Math.PI*2
   for(let j=0;j<8;j++){
     const t=j/8,next=(j+1)/8
     const point=(r:number)=>[Math.cos(angle)*r*1.6,Math.sin(r*Math.PI*.7)*.8,Math.sin(angle)*r*1.6]
     segment(point(t),point(next))
     if(j>2){const p=point(t);for(const side of [-1,1])segment(p,[p[0]+Math.cos(angle+side*.65)*.35,p[1]+.22,p[2]+Math.sin(angle+side*.65)*.35])}
   }
 }
 segment([0,0,0],[.12,-1.8,0]);segment([.12,-1.8,0],[.2,-2.2,.08])
 const capacity=Math.round(110*Math.max(.6,Math.min(1.3,detail))),random=randomStream(51231),seeds=new Float32Array(capacity*4)
 for(let i=0;i<seeds.length;i++)seeds[i]=random()
 const geometry=new T.InstancedBufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3)).setAttribute('aSeed',new T.InstancedBufferAttribute(seeds,4))
 geometry.instanceCount=capacity
 const seedHeads=new T.LineSegments(geometry,new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,toneMapped:false}));seedHeads.frustumCulled=false;group.add(seedHeads)
 return {group,update(motion,config,reduced){
   const m=config.music;drive(motion,config,reduced,.5+m.speed*.18)
   uniforms.uTrail.value=(.65+m.meteorTrail*.45)*(1+motion.middle*.16)
   uniforms.uTwist.value=Math.tan(m.meteorAngle*Math.PI/180)*.35
   uniforms.uColor.value.set(m.fieldPalette==='ember'?'#8e4d29':m.fieldPalette==='lake'?'#366b65':'#80623b')
   geometry.instanceCount=Math.min(capacity,Math.round(capacity*m.meteorDensity/96))
 }}
}
