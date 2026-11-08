import * as T from 'three'
import { commonUniforms,flowDriver,randomStream,uniformSource,type FlowEffect } from '../flow/shared'
import { reactiveUniforms, reactiveSource, updateReactiveUniforms } from '../../reactive-motion'

const vertex=`${uniformSource}${reactiveSource}
uniform float uDaylight;
attribute vec4 aSeed;attribute vec3 aTangent;attribute vec2 aFiber;attribute float aHero,aKind;
varying vec2 vFiber;varying float vAlpha,vTint,vNote,vKind;
void main(){
 float cycle=fract(aSeed.y+uPhase*(.009+aSeed.w*.008)),height=cycle*64.-32.;
 vec3 center=vec3((aSeed.x-.5)*96.+height*uTwist+sin(uPhase*.13+aSeed.y*13.)*(2.+uDragBands.y*2.5),height,-92.+aSeed.z*101.);
 if(aHero>.5&&aHero<2.5){
   center=aHero<1.5?vec3(-7.,-2.,2.):vec3(10.,5.,-17.);
   center.xy+=vec2(sin(uPhase*.11+aHero)*1.5,cos(uPhase*.09+aHero)*1.2);
   center.x+=uTwist*3.;
 }
 // A small persistent middle-distance stream connects the two foreground
 // heads to the distant field; no extra instances or cycle resets in view.
 if(aHero>2.5){
   float lane=aHero-3.,q=uPhase*.10+lane*1.7;
   center=vec3(-22.+lane*8.2,-7.+lane*3.2,-39.-aSeed.z*15.);
   center+=vec3(sin(q)*2.8,cos(q*.73)*1.8,sin(q*.59)*2.);
   center.x+=uTwist*(center.y+12.);
 }
 float scale=(aHero>2.5?1.25+aSeed.w*.65:aHero>.5?(aHero<1.5?3.25:2.5):(.55+aSeed.w*1.05))*uTrail;
 float angle=(aSeed.x-.5)*.9+sin(uPhase*.24+aSeed.y*9.+uDrift.y*.35)*(.18+uDragBands.y*.14);
 float lean=sin(uPhase*.37+aSeed.x*16.)*.08;
 float note=musicFront(aSeed.y,.7,.09,vec3(.65,1.,.4))*step(.5,aSeed.w);
 vec3 p=position;
 float trailing=mix(uBodyBands.y,uDragBands.y,clamp(aFiber.y,0.,1.));
 float tip=clamp(aFiber.y,0.,1.);
 p.x+=tip*tip*(sin(uPhase*.29+aSeed.x*16.-tip*.8)*(.08+trailing*.28)+note*.3);
 p.y+=p.x*p.x*(lean+trailing*.12)+abs(p.x)*note*.12;
 p.xz*=1.+uSustain*.07+trailing*.22;
 mat2 turn=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));p.xy=turn*p.xy;
 float tilt=.35+aSeed.w+sin(uPhase*.15+aSeed.x*11.)*.12+uDragBands.x*.12;
 p.yz=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*p.yz;
 vec3 tangent=aTangent;tangent.xy=turn*tangent.xy;tangent.yz=mat2(cos(tilt),sin(tilt),-sin(tilt),cos(tilt))*tangent.yz;
 vec4 mv=modelViewMatrix*vec4(center+p*scale,1.);
 vec3 direction=mat3(modelViewMatrix)*tangent;
 vec2 side=vec2(-direction.y,direction.x);side/=max(length(side),.00001);
 // Real ribbons keep the small strands antialiased at every pixel ratio.
 float width=aKind>.5?.055*sin(clamp(aFiber.y,.01,.99)*3.14159265):(.006+max(0.,-mv.z)*.00018);
 mv.xy+=side*aFiber.x*width*scale*(1.+(1.-uDaylight)*.3);
 gl_Position=projectionMatrix*mv;
 vFiber=aFiber;vTint=aSeed.w;vNote=note;vKind=aKind;
 vAlpha=(aHero>.5?1.:smoothstep(0.,.07,cycle)*(1.-smoothstep(.90,1.,cycle)))*smoothstep(1.,6.,-mv.z);
}`
const fragment=`${uniformSource}
varying vec2 vFiber;varying float vAlpha,vTint,vNote,vKind;
void main(){
 float edge=1.-smoothstep(.35,1.,abs(vFiber.x));
 float alpha=edge*vAlpha*(vKind>.5?.96:(.40+(1.-smoothstep(.85,1.,vFiber.y))*.28));
 if(alpha<.008)discard;
 vec3 cream=mix(uHighlight,vec3(1.,.96,.83),.28);
 vec3 color=mix(mix(uColor,cream,.36),cream,smoothstep(.05,.68,vFiber.y));
 color*=.82+vNote*.35+uAccents.z*step(.8,vTint)*.28;
 if(vKind>.5)color=mix(vec3(.23,.12,.045),vec3(.64,.42,.18),vFiber.y);
 gl_FragColor=vec4(color,alpha);
}`

/** Individual feathery seeds, silk filaments and long stems in a deep daylight field. */
export function createSunlitSeeds(detail:number):FlowEffect{
 const group=new T.Group(),uniforms={...commonUniforms(),...reactiveUniforms(),uDaylight:{value:1}},drive=flowDriver(uniforms)
 const sky=new T.Mesh(new T.SphereGeometry(310,32,20),new T.ShaderMaterial({uniforms,side:T.BackSide,depthWrite:false,transparent:true,toneMapped:false,
   vertexShader:'varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`${uniformSource}uniform float uDaylight;varying vec3 vD;
     void main(){if(uDaylight<.01)discard;vec3 d=normalize(vD);
       float sun=pow(max(0.,dot(d,normalize(vec3(-.5,.4,-1.)))),18.);
       vec3 color=mix(uShade*.65,mix(uAccent,uShade,.5)*.62,smoothstep(-.5,.75,d.y));
       color+=mix(uColor,uHighlight,.6)*sun*.12;gl_FragColor=vec4(color,uDaylight);}`
 }));sky.name='scene-backdrop';sky.renderOrder=-10;group.add(sky)
 const positions:number[]=[],tangents:number[]=[],fibers:number[]=[],kinds:number[]=[],indices:number[]=[]
 const segment=(a:number[],b:number[],from:number,to:number,kind=0)=>{
   const offset=positions.length/3,tangent=b.map((v,i)=>v-a[i])
   for(const [point,t] of [[a,from],[b,to]] as const)for(const side of [-1,1]){positions.push(...point);tangents.push(...tangent);fibers.push(side,t);kinds.push(kind)}
   indices.push(offset,offset+1,offset+2,offset+1,offset+3,offset+2)
 }
 // A rounded pappus opens out from a readable warm seed, with irregular curved tips.
 for(let spoke=0;spoke<72;spoke++){
   const angle=spoke/72*Math.PI*2,reach=1.2+.17*Math.sin(spoke*2.4)
   const point=(t:number)=>{
     const turn=angle+Math.sin(t*2.7+spoke*1.3)*t*.10,r=reach*t
     return [Math.cos(turn)*r,.05+.82*(1-Math.exp(-t*3.8))-.28*t*t,Math.sin(turn)*r]
   }
   for(let j=0;j<10;j++)segment(point(j/10),point((j+1)/10),j/10,(j+1)/10)
   for(const t of (spoke%3===0?[.85]:[]))for(const side of [-1,1]){
     const p=point(t);segment(p,[p[0]+Math.cos(angle+side*.8)*.055,p[1]+.025,p[2]+Math.sin(angle+side*.8)*.055],t,1)
   }
 }
 segment([0,.05,0],[.015,-.44,.01],0,.3)
 // The fusiform seed is built from short view-facing sections, sharing the same wind.
 for(let i=0;i<8;i++){
   const t=i/8,next=(i+1)/8
   segment([.015+t*.06,-.44-t*.55,.01],[.015+next*.06,-.44-next*.55,.01],t,next,1)
 }
 const capacity=Math.round(66*Math.max(.6,Math.min(1.3,detail))),random=randomStream(51231),seeds=new Float32Array(capacity*4)
 for(let i=0;i<seeds.length;i++)seeds[i]=random()
 const heroes=Float32Array.from({length:capacity},(_,i)=>i<7?i+1:0)
 const geometry=new T.InstancedBufferGeometry().setIndex(indices).setAttribute('position',new T.Float32BufferAttribute(positions,3))
   .setAttribute('aHero',new T.InstancedBufferAttribute(heroes,1)).setAttribute('aKind',new T.Float32BufferAttribute(kinds,1))
   .setAttribute('aTangent',new T.Float32BufferAttribute(tangents,3)).setAttribute('aFiber',new T.Float32BufferAttribute(fibers,2)).setAttribute('aSeed',new T.InstancedBufferAttribute(seeds,4))
 geometry.instanceCount=capacity
 const seedHeads=new T.Mesh(geometry,new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,transparent:true,depthWrite:false,side:T.DoubleSide,toneMapped:false}));seedHeads.name='sunlit-feathers';seedHeads.frustumCulled=false;group.add(seedHeads)
 return {group,update(motion,config,reduced){
   const m=config.music;drive(motion,config,reduced,.72+m.speed*.18)
   updateReactiveUniforms(uniforms,motion,'volume_rain',reduced)
   uniforms.uTrail.value=.72+m.meteorTrail*.35
   uniforms.uTwist.value=Math.tan(m.meteorAngle*Math.PI/180)*.35
   uniforms.uDaylight.value=config.sceneMode==='immersive'?1:0
   geometry.instanceCount=Math.min(capacity,Math.round(capacity*m.meteorDensity/96))
 }}
}
