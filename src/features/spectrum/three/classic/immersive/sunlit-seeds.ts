import * as T from 'three'
import { commonUniforms,flowDriver,randomStream,uniformSource,type FlowEffect } from '../flow/shared'

const vertex=`${uniformSource}
attribute vec4 aSeed;attribute vec3 aTangent;attribute vec2 aFiber;
varying vec2 vFiber;varying float vAlpha,vTint,vNote;
void main(){
 float cycle=fract(aSeed.y+uPhase*(.009+aSeed.w*.008)),height=cycle*64.-32.;
 vec3 center=vec3((aSeed.x-.5)*96.+height*uTwist+sin(uPhase*.13+aSeed.y*13.)*2.,height,-92.+aSeed.z*101.);
 float scale=(.8+aSeed.w*1.2)*uTrail;
 float angle=(aSeed.x-.5)*.9+sin(uPhase*.24+aSeed.y*9.)*.18;
 float lean=sin(uPhase*.37+aSeed.x*16.)*.08;
 float note=uOnsetStrength*(1.-exp(-uOnsetAge*30.))*exp(-uOnsetAge*5.)*step(.65,aSeed.w);
 vec3 p=position;
 p.y+=p.x*p.x*(lean+uAccents.y*.15)+abs(p.x)*note*.20;
 p.xz*=1.+uSustain*.07+uMiddle*.15;
 mat2 turn=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));p.xy=turn*p.xy;
 float tilt=.35+aSeed.w;
 p.yz=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*p.yz;
 vec3 tangent=aTangent;tangent.xy=turn*tangent.xy;tangent.yz=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*tangent.yz;
 vec4 mv=modelViewMatrix*vec4(center+p*scale,1.);
 vec3 direction=mat3(modelViewMatrix)*tangent;
 vec2 side=vec2(-direction.y,direction.x);side/=max(length(side),.00001);
 // Real ribbons keep the small strands antialiased at every pixel ratio.
 mv.xy+=side*aFiber.x*(.018+max(0.,-mv.z)*.00060)*scale;
 gl_Position=projectionMatrix*mv;
 vFiber=aFiber;vTint=aSeed.w;vNote=note;
 vAlpha=smoothstep(0.,.07,cycle)*(1.-smoothstep(.90,1.,cycle))*smoothstep(1.,6.,-mv.z);
}`
const fragment=`${uniformSource}
varying vec2 vFiber;varying float vAlpha,vTint,vNote;
void main(){
 float edge=1.-smoothstep(.35,1.,abs(vFiber.x));
 float alpha=edge*vAlpha*(.27+(1.-smoothstep(.78,1.,vFiber.y))*.28);
 if(alpha<.008)discard;
 vec3 cream=mix(uHighlight,vec3(1.,.96,.83),.28);
 vec3 color=mix(mix(uColor,cream,.36),cream,smoothstep(.05,.68,vFiber.y));
 color*=.82+vNote*.35+uAccents.z*step(.8,vTint)*.28;
 gl_FragColor=vec4(color,alpha);
}`

/** Individual feathery seeds, silk filaments and long stems in a deep daylight field. */
export function createSunlitSeeds(detail:number):FlowEffect{
 const group=new T.Group(),uniforms={...commonUniforms(),uDaylight:{value:1}},drive=flowDriver(uniforms)
 const sky=new T.Mesh(new T.SphereGeometry(310,32,20),new T.ShaderMaterial({uniforms,side:T.BackSide,depthWrite:false,transparent:true,toneMapped:false,
   vertexShader:'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`${uniformSource}uniform float uDaylight;varying vec3 vD;
     void main(){if(uDaylight<.01)discard;vec3 d=normalize(vD);
       float sun=pow(max(0.,dot(d,normalize(vec3(-.5,.4,-1.)))),18.);
       vec3 color=mix(uShade*.65,mix(uAccent,uShade,.5)*.62,smoothstep(-.5,.75,d.y));
       color+=mix(uColor,uHighlight,.6)*sun*.12;gl_FragColor=vec4(color,uDaylight);}`
 }));sky.name='scene-backdrop';sky.renderOrder=-10;group.add(sky)
 const positions:number[]=[],tangents:number[]=[],fibers:number[]=[],indices:number[]=[]
 const segment=(a:number[],b:number[],from:number,to:number)=>{
   const offset=positions.length/3,tangent=b.map((v,i)=>v-a[i])
   for(const [point,t] of [[a,from],[b,to]] as const)for(const side of [-1,1]){positions.push(...point);tangents.push(...tangent);fibers.push(side,t)}
   indices.push(offset,offset+1,offset+2,offset+1,offset+3,offset+2)
 }
 for(let spoke=0;spoke<28;spoke++){
   const angle=spoke/28*Math.PI*2,reach=.68+.14*Math.sin(spoke*2.4)
   const point=(t:number)=>[Math.cos(angle)*Math.sin(t*1.6)*reach,-.1+t*1.85+Math.sin(t*Math.PI)*.27,Math.sin(angle)*Math.sin(t*1.6)*reach]
   for(let j=0;j<7;j++)segment(point(j/7),point((j+1)/7),j/7,(j+1)/7)
   for(const t of [.55,.72,.87])for(const side of [-1,1]){const p=point(t);segment(p,[p[0]+Math.cos(angle+side*.6)*.18,p[1]+.11,p[2]+Math.sin(angle+side*.6)*.18],t,1)}
 }
 segment([0,-.1,0],[.07,-.65,.02],0,.2);segment([.07,-.65,.02],[.18,-1.13,.07],0,.2)
 const capacity=Math.round(94*Math.max(.6,Math.min(1.3,detail))),random=randomStream(51231),seeds=new Float32Array(capacity*4)
 for(let i=0;i<seeds.length;i++)seeds[i]=random()
 const geometry=new T.InstancedBufferGeometry().setIndex(indices).setAttribute('position',new T.Float32BufferAttribute(positions,3))
   .setAttribute('aTangent',new T.Float32BufferAttribute(tangents,3)).setAttribute('aFiber',new T.Float32BufferAttribute(fibers,2)).setAttribute('aSeed',new T.InstancedBufferAttribute(seeds,4))
 geometry.instanceCount=capacity
 const seedHeads=new T.Mesh(geometry,new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,side:T.DoubleSide,toneMapped:false}));seedHeads.name='sunlit-feathers';seedHeads.frustumCulled=false;group.add(seedHeads)
 return {group,update(motion,config,reduced){
   const m=config.music;drive(motion,config,reduced,.72+m.speed*.18)
   uniforms.uTrail.value=.72+m.meteorTrail*.35
   uniforms.uTwist.value=Math.tan(m.meteorAngle*Math.PI/180)*.35
   uniforms.uDaylight.value=config.sceneMode==='immersive'?1:0
   geometry.instanceCount=Math.min(capacity,Math.round(capacity*m.meteorDensity/96))
 }}
}
