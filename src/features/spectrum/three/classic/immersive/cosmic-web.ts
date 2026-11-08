import * as T from 'three'
import { commonUniforms, flowDriver, material, randomStream, uniformSource, type FlowEffect } from '../flow/shared'
import { reactiveUniforms, reactiveSource, updateReactiveUniforms } from '../../reactive-motion'

/** A sparse cosmic web with deliberate empty cells. Branches share junctions;
 * their curved density profiles have no straight triangular wire skeleton. */
function cosmicWebGeometry() {
  const random=randomStream(370129)
  const nodes=[[-23,-8,-16],[-15,-3,-7],[-7,-6,1],[1,-2,3],[10,5,-1],[21,8,-12],[-14,9,-20],[-3,10,-9],[10,14,-22],[-17,-14,-27],[-2,-14,-17],[15,-9,-15],[-3,0,-27],[10,0,-35],[26,-2,-25],[-27,10,-32],[-25,-17,-40],[24,18,-40],[3,22,-38],[-30,-1,-38]].map(p=>new T.Vector3(...p as [number,number,number]))
  const edges=[[0,1],[1,2],[2,3],[3,4],[4,5],[1,6],[6,7],[7,8],[8,5],[2,10],[10,11],[11,4],[0,9],[9,10],[6,15],[15,19],[19,0],[9,16],[7,12],[12,13],[13,14],[14,5],[8,17],[17,18],[18,7],[11,14]]
  const distances=nodes.map(()=>Infinity);distances[3]=0
  for(let i=0;i<nodes.length;i++)for(const [a,b] of edges){const length=nodes[a].distanceTo(nodes[b]);distances[a]=Math.min(distances[a],distances[b]+length);distances[b]=Math.min(distances[b],distances[a]+length)}
  const maximum=Math.max(...distances)+8
  const positions:number[]=[],meta:number[]=[],kinds:number[]=[]
  const add=(p:T.Vector3,t:number,r:number,seed:number,distance:number,kind:number)=>{positions.push(p.x,p.y,p.z);meta.push(t,r,seed,distance);kinds.push(kind)}
  const gaussian=()=>Math.sqrt(-2*Math.log(Math.max(.00001,random())))*Math.cos(random()*Math.PI*2)
  edges.forEach(([a,b],id)=>{
    const start=nodes[a],end=nodes[b],delta=end.clone().sub(start)
    const bend=new T.Vector3(gaussian(),gaussian(),gaussian()).multiplyScalar(1.4)
    const curve=new T.CatmullRomCurve3([start,start.clone().addScaledVector(delta,.33).add(bend),start.clone().addScaledVector(delta,.7).addScaledVector(bend,-.55),end])
    const length=start.distanceTo(end),count=Math.round(800+length*24)
    for(let i=0;i<count;i++){
      const t=random(),p=curve.getPoint(t),tangent=curve.getTangent(t)
      const side=new T.Vector3().crossVectors(tangent,new T.Vector3(0,1,0)).normalize(),up=new T.Vector3().crossVectors(tangent,side)
      const width=.13+Math.sin(t*Math.PI)*.27,dx=gaussian(),dy=gaussian()
      p.addScaledVector(side,dx*width).addScaledVector(up,dy*width*.7)
      const distance=Math.min(distances[a]+t*length,distances[b]+(1-t)*length)/maximum
      add(p,t,Math.hypot(dx,dy)*.4,id*.137,distance,0)
    }
  })
  nodes.forEach((node,id)=>{
    const count=id===3?900:300
    for(let i=0;i<count;i++){
      const radius=Math.pow(random(),2.3)*1.3,p=node.clone().add(new T.Vector3(gaussian(),gaussian(),gaussian()).multiplyScalar(radius))
      add(p,random(),radius,id*.137,distances[id]/maximum,1)
    }
  })
  for(let i=0;i<1100;i++)add(new T.Vector3((random()-.5)*100,(random()-.5)*65,-20-random()*65),random(),random(),random(),random(),2)
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('aMeta',new T.Float32BufferAttribute(meta,4));g.setAttribute('aKind',new T.Float32BufferAttribute(kinds,1));return g
}
const vertex=`${uniformSource}${reactiveSource}
attribute vec4 aMeta;attribute float aKind;
varying float vAlpha,vWarm,vLight,vKind;
void main(){
  float wave=musicFront(aMeta.w,.32,.035);
  vec3 p=position;
  float yaw=sin(uPhase*.065)*.08;
  p.xz=mat2(cos(yaw),-sin(yaw),sin(yaw),cos(yaw))*p.xz;
  p.xy+=vec2(sin(uPhase*.11+aMeta.z),cos(uPhase*.08+aMeta.z))*.12;
  p.xy*=uRange;
  vec4 mv=modelViewMatrix*vec4(p,1.);
  float size=aKind>1.5?.065:aKind>.5?.19:.13;
  gl_PointSize=clamp(size*330./max(1.,-mv.z)*uPixelRatio,.6,5.);
  gl_Position=projectionMatrix*mv;
  vAlpha=(aKind>1.5?.11:.18+.38*exp(-aMeta.y*aMeta.y*2.))*(.85+wave*.45);
  vWarm=aKind>.5&&aKind<1.5?.45+.35*sin(aMeta.z*6.):.08;
  float held=aKind>.5&&aKind<1.5?uBodyBands.x*.35:aKind<.5?uBodyBands.z*.18:0.;
  vLight=(wave+held)*uDepth;vKind=aKind;
}`
const fragment=`${uniformSource}
varying float vAlpha,vWarm,vLight,vKind;
void main(){
  float radius=length(gl_PointCoord-.5)*2.;if(radius>1.)discard;
  float core=exp(-radius*radius*5.5);
  vec3 color=mix(uColor,uAccent,vWarm);
  float junction=step(.5,vKind)*(1.-step(1.5,vKind));
  color=mix(color,uHighlight,.10+junction*.18+vLight*.28)*(.85+junction*.22+vLight*.45);
  gl_FragColor=vec4(color,core*vAlpha);
}`
export function createCosmicWeb(_detail:number):FlowEffect {
  const group=new T.Group();group.name='cosmic-filaments-and-voids'
  const u={...commonUniforms(),...reactiveUniforms()},drive=flowDriver(u)
  const points=new T.Points(cosmicWebGeometry(),material(u,vertex,fragment,true));points.frustumCulled=false;group.add(points)
  return {group,update(motion,config,reduced){
    drive(motion,config,reduced,.4+config.music.speed*.18);updateReactiveUniforms(u,motion,config.effect,reduced)
    u.uRange.value=config.music.ambientSpread;u.uDepth.value=config.music.fieldHeight
  }}
}
