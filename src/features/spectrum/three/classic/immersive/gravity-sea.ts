import * as T from 'three'
import { commonUniforms, flowDriver, surfaceGeometry, surfaceVertex, material, mesh, uniformSource, type FlowEffect } from '../flow/shared'
import { Batch, spectral } from '../kinetic/common'
import { cosmicStars } from './cosmic-common'

// Heads and tapered wakes follow the same spatial trajectory.
const orbit = `
uniform float uBands[7];
vec3 orbit(float t,float lane){
 float a=t+lane*1.19;
 return vec3(sin(a*.73)*32.,sin(a*1.13+lane)*12.+cos(a*.41)*4.+uBands[int(lane)]*4.,-23.+cos(a*.73)*24.);
}`
const trailVertex=surfaceVertex(`
 float head=uPhase*.65+lane*.8;
 vec3 center=orbit(head-(1.-t)*uTrail*7.,lane);
 vec3 next=orbit(head-(1.-t)*uTrail*7.+.01,lane);
 vec3 tangent=normalize(next-center),side=normalize(cross(tangent,vec3(0.,1.,0.)));
 vec3 up=normalize(cross(side,tangent));
 p=center+(side*cos(a)+up*sin(a))*(.025+t*t*.26)*uRange;
 vAlpha=pow(t,1.8)*step(lane+.5,uCount)*min(1.,uTrail*5.);
`,orbit)
const trailFragment=`${uniformSource}
varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
void main(){
 vec3 tint=mix(uColor,uAccent,.5+.5*sin(vLane*1.7));
 float light=.4+.6*pow(.5+.5*cos(vUv.y*6.283),3.);
 gl_FragColor=vec4(tint*(.6+uMiddle*.65),vAlpha*light*.65);
}`

/** Luminous pearls cross the volume; each responds to its own captured frequency band. */
export function createGravitySea(detail:number):FlowEffect {
 const group=new T.Group(),uniforms={...commonUniforms(),uBands:{value:new Float32Array(7)}},drive=flowDriver(uniforms)
 const beads=new Batch(group,new T.SphereGeometry(1,32,24),7)
 const pearlMaterial=beads.mesh.material as T.ShaderMaterial
 pearlMaterial.uniforms.uPhase=uniforms.uPhase
 pearlMaterial.fragmentShader=`uniform float uPhase;varying vec3 vTint,vNormal,vView;varying float vOpacity;
 void main(){vec3 n=normalize(vNormal),v=normalize(vView);float rim=pow(1.-max(0.,dot(n,v)),2.5);
 float ribbon=pow(.5+.5*sin(n.y*11.+n.x*5.+uPhase*.5),10.);
 float highlight=pow(max(0.,dot(reflect(-normalize(vec3(-.4,.8,1.)),n),v)),65.);
 vec3 c=vTint*(.07+rim*.9+ribbon*.25)+mix(vTint,vec3(1.),.75)*highlight*.9;
 gl_FragColor=vec4(c,vOpacity);}`
 const satellites=new Batch(group,new T.SphereGeometry(1,12,8),7*18)
 const tint=new T.Color(),pale=new T.Color('#e7fcff')
 cosmicStars(group,uniforms,detail*.45,7319).setDensity(.6)
 mesh(group,surfaceGeometry(150,8,7),material(uniforms,trailVertex,trailFragment,true))
 const haze=new T.Mesh(new T.SphereGeometry(155,24,16),new T.ShaderMaterial({
   uniforms,side:T.BackSide,depthWrite:false,toneMapped:false,
   vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
   fragmentShader:`${uniformSource} varying vec3 vP;void main(){float mist=exp(-pow((vP.y+12.)/45.,2.));gl_FragColor=vec4(mix(uColor,uAccent,.5+.5*sin(vP.x*.015))*(.006+mist*.028),1.);}`,
 }));group.add(haze)
 return {group,update(motion,config,reduced){
   const m=config.music
   drive(motion,config,reduced,(.75+m.ballSpeedMultiplier*.65)*(.6+m.speed*.16))
   uniforms.uCount.value=m.ballCount;uniforms.uTrail.value=m.ballTrail;uniforms.uRange.value=m.ballRadiusMultiplier
   const phase=uniforms.uPhase.value
   for(let i=0;i<m.ballCount;i++){
     const band=spectral(motion,i/6),a=phase*.65+i*.8+i*1.19
     uniforms.uBands.value[i]=band
     const x=Math.sin(a*.73)*32,y=Math.sin(a*1.13+i)*12+Math.cos(a*.41)*4+band*4,z=-23+Math.cos(a*.73)*24
     const radius=(1.15+(i%3)*.48)*m.ballRadiusMultiplier*(1+band*.32)
     tint.copy(uniforms.uColor.value).lerp(uniforms.uAccent.value,.5+.5*Math.sin(i*1.7)).lerp(pale,.06+band*.12)
     beads.place(i,x,y,z,radius,radius,radius,tint,1)
     for(let j=0;j<18;j++){
       const t=phase*.65+i*.8-(j+1)*.34*m.ballTrail,angle=t+i*1.19
       const r=(.06+.18*(1-j/18))*m.ballRadiusMultiplier*(.7+motion.treble*.7)
       satellites.place(i*18+j,Math.sin(angle*.73)*32+Math.sin(j*2.4+i)*.8,
         Math.sin(angle*1.13+i)*12+Math.cos(angle*.41)*4+band*4+Math.cos(j*2.4+i)*.8,
         -23+Math.cos(angle*.73)*24,r,r,r,tint,1)
     }
   }
   beads.finish(m.ballCount);satellites.finish(m.ballTrail>0?m.ballCount*18:0)
 }}
}
