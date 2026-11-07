import * as T from 'three'
import { commonUniforms, flowDriver, material, mesh, randomStream, uniformSource, type FlowEffect } from '../flow/shared'
import { reactiveUniforms, reactiveSource, updateReactiveUniforms } from '../../reactive-motion'

// The Hessian of the moving water surface supplies a continuous ray-map
// Jacobian. Evaluating its fold in the fragment avoids a visible photon grid.
const vertex=`varying vec2 vWater;varying float vFade;
void main(){vec3 p=vec3(position.x,-4.,position.y);vWater=position.xy;vFade=(1.-smoothstep(23.,31.,abs(position.x)))*(1.-smoothstep(28.,39.,abs(position.y)));gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}`
const fragment=`${uniformSource}${reactiveSource}
varying vec2 vWater;varying float vFade;
void main(){
  vec2 source=vWater;
  float front=musicFront(length(source)*.022,.32,.065,vec3(1.,.45,.2));
  float xx=0.,xy=0.,yy=0.;
  for(int i=0;i<7;i++){
    float n=float(i),angle=n*2.39996;
    vec2 k=vec2(cos(angle),sin(angle))*(.65+n*.13)/uRange;
    float phase=dot(source,k)-uPhase*(.38+n*.075)+n*1.27;
    float amplitude=(.28-n*.025)*(.8+uBodyBands.x*.28)*uDepth*(1.+front*.12);
    float curve=-sin(phase)*amplitude;
    xx+=curve*k.x*k.x;xy+=curve*k.x*k.y;yy+=curve*k.y*k.y;
  }
  float determinant=(1.+xx*8.)*(1.+yy*8.)-xy*xy*64.;
  float aa=max(.025,fwidth(determinant)*.8);
  float focus=exp(-determinant*determinant/(.012+aa*aa));
  float halo=exp(-abs(determinant)*3.5)*.12;
  float distanceFade=exp(-max(0.,-source.y)*.015);
  vec3 color=mix(uColor,uHighlight,focus*.75);
  float fade=(1.-smoothstep(23.,31.,abs(source.x)))*(1.-smoothstep(28.,39.,abs(source.y)));
  gl_FragColor=vec4(color*(.025+focus*.48+halo)*distanceFade,fade*.76);
}`
const beamVertex=`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`
const beamFragment=`${uniformSource}varying vec2 vUv;
void main(){float edge=exp(-pow((vUv.x-.5)*5.,2.));float fade=pow(max(0.,sin(vUv.y*3.14159)),1.5);gl_FragColor=vec4(mix(uColor,uHighlight,.35),edge*fade*.02);}`
const dustVertex=`${uniformSource}varying float vAlpha;
void main(){vec3 p=position;p.x+=sin(uPhase*.15+p.y*.2)*.16;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(25./max(1.,-mv.z)*uPixelRatio,.6,1.8);vAlpha=.12;}`
const dustFragment=`${uniformSource}varying float vAlpha;
void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(uHighlight,exp(-r*r*5.)*vAlpha);}`
export function createCausticLight(_detail:number):FlowEffect {
  const group=new T.Group();group.name='refracted-water-light'
  const u={...commonUniforms(),...reactiveUniforms()},drive=flowDriver(u)
  const floor=material(u,vertex,fragment,true);floor.depthWrite=false
  mesh(group,new T.PlaneGeometry(64,80),floor)
  for(let i=0;i<3;i++){
    const beam=mesh(group,new T.PlaneGeometry(8+i,34),material(u,beamVertex,beamFragment,true))
    beam.position.set(-10+i*9,8,-16-i*8);beam.rotation.z=-.22
  }
  const random=randomStream(92714),dust=new T.BufferGeometry(),points:number[]=[]
  for(let i=0;i<400;i++)points.push((random()-.5)*45,-2+random()*15,-30+random()*50)
  dust.setAttribute('position',new T.Float32BufferAttribute(points,3));const motes=new T.Points(dust,material(u,dustVertex,dustFragment,true));motes.frustumCulled=false;group.add(motes)
  return {group,update(motion,config,reduced){
    drive(motion,config,reduced,.5+config.music.speed*.2);updateReactiveUniforms(u,motion,config.effect,reduced)
    u.uDepth.value=.65+config.music.fieldHeight*.35;u.uRange.value=.8+config.music.ambientSpread*.2
  }}
}
