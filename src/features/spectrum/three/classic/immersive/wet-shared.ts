import * as T from 'three'
import { commonUniforms, randomStream, applyFlowPalette, type FlowUniforms } from '../flow/shared'
import type { SpectrumSettings } from '../../../model'

export const wetUniforms = () => ({...commonUniforms(),uWind:{value:0},uReduced:{value:0},
  uDrops:{value:Array.from({length:6},()=>new T.Vector4(0,0,-1,0))}})
export type WetUniforms=ReturnType<typeof wetUniforms>
export const wetField=`
uniform float uPhase,uVolume,uBass,uMiddle,uTreble,uWidth,uCount,uRange,uTrail,uWind,uReduced,uPixelRatio;
uniform vec3 uColor,uAccent;
float hash(float x){return fract(sin(x*127.1+311.7)*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);float n=i.x+i.y*127.;
  return mix(mix(hash(n),hash(n+1.),f.x),mix(hash(n+127.),hash(n+128.),f.x),f.y);}
float depthFade(vec3 p){return (1.-smoothstep(175.,220.,-p.z))*(1.-smoothstep(85.,108.,abs(p.x)));}
vec3 depthTint(vec3 p){return mix(uColor,uAccent,smoothstep(8.,195.,-p.z)*.75);}
`
export function wetPalette(uniforms: FlowUniforms,config:SpectrumSettings){
  applyFlowPalette(uniforms,config)
}
export function seededGeometry(count:number,seed:number,instanced=false,segments=1){
  const random=randomStream(seed),seeds=new Float32Array(count*4)
  for(let i=0;i<seeds.length;i++)seeds[i]=random()
  if(instanced){
    const plane=new T.PlaneGeometry(1,1,1,segments),g=new T.InstancedBufferGeometry()
    g.setIndex(plane.getIndex());g.setAttribute('position',plane.getAttribute('position'));g.setAttribute('uv',plane.getAttribute('uv'))
    g.setAttribute('aSeed',new T.InstancedBufferAttribute(seeds,4));g.instanceCount=count;plane.dispose();return g
  }
  return new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float32Array(count*3),3))
    .setAttribute('aSeed',new T.BufferAttribute(seeds,4))
}
export function wetMaterial(uniforms:WetUniforms,vertexShader:string,fragmentShader:string,additive=true){
  return new T.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:true,depthWrite:false,
    depthTest:true,side:T.DoubleSide,blending:additive?T.AdditiveBlending:T.NormalBlending,premultipliedAlpha:additive,toneMapped:false})
}
export function wetMesh(group:T.Group,geometry:T.BufferGeometry,material:T.ShaderMaterial){
  const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;group.add(mesh);return mesh
}
export const plainVertex=`varying vec3 vP;varying vec2 vUv;
void main(){vP=position;vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`
export const pointFragment=`varying vec3 vColor;varying float vAlpha;
void main(){float r=length(gl_PointCoord-.5)*2.;float alpha=exp(-r*r*4.5)*vAlpha;
if(alpha<.009)discard;gl_FragColor=vec4(vColor*alpha,alpha);}`
export function wetSky(group:T.Group,uniforms:WetUniforms){
  const fragment=`${wetField}
  varying vec3 vP;varying vec2 vUv;
  void main(){float horizon=exp(-pow((vUv.y-.32)*9.,2.));
    float cloud=exp(-pow((vUv.x-.5)*2.5,2.));
    float mist=noise(vP.xy*.018+vec2(uPhase*.009,0.));
    float alpha=(.018+horizon*.075)*(cloud*.7+.3)*(.7+mist*.3);
    vec3 color=mix(uAccent,uColor,cloud*.27);
    float grain=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;
    gl_FragColor=vec4(max(color*alpha+vec3(grain),vec3(0.)),alpha);
  }`
  const mesh=wetMesh(group,new T.PlaneGeometry(800,300),wetMaterial(uniforms,plainVertex,fragment))
  mesh.position.set(0,50,-215);mesh.renderOrder=-3;return mesh
}
export function wetGround(width=220,depth=270,segments=1){
  const geometry=new T.PlaneGeometry(width,depth,segments,segments)
  geometry.rotateX(-Math.PI/2);geometry.translate(0,-5,-90);return geometry
}
