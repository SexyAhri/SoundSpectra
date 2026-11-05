import * as T from 'three'
import { randomStream, uniformSource, type FlowUniforms } from '../flow/shared'

export const noiseSource = `
float hash31(vec3 p){ p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z); }
float noise3(vec3 p){
  vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x),mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),
    mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise3(p);p=p*2.03+vec3(7.1,3.8,1.4);a*=.5;}return v; }
`

export const sphereVertex = `
varying vec3 vWorld,vNormal,vLocal;
void main(){
  vLocal=normalize(position);vNormal=normalize(mat3(modelMatrix)*normal);
  vWorld=(modelMatrix*vec4(position,1.)).xyz;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`

export function cosmicMaterial(uniforms: FlowUniforms, vertexShader: string, fragmentShader: string, additive=false) {
  return new T.ShaderMaterial({uniforms,vertexShader,fragmentShader,transparent:additive,depthWrite:!additive,
    blending:additive?T.AdditiveBlending:T.NormalBlending,toneMapped:false})
}

export function addCosmicMesh(group:T.Group,geometry:T.BufferGeometry,material:T.Material) {
  const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;group.add(mesh);return mesh
}

const starsVertex=`${uniformSource}
attribute vec3 aSeed;
varying float vAlpha,vTint,vSharp;
void main(){
  vec3 p=position;p.z*=uDepth;
  p.x+=sin(uPhase*.018+aSeed.x*6.28)*.35;
  vec4 view=modelViewMatrix*vec4(p,1.);
  gl_Position=projectionMatrix*view;
  gl_PointSize=clamp(aSeed.y*145./max(3.,-view.z),1.,11.)*uPixelRatio;
  vTint=aSeed.x;vSharp=aSeed.z;
  vAlpha=(.22+aSeed.z*.65)*(1.+uTreble*.2);
}`
const starsFragment=`${uniformSource}
varying float vAlpha,vTint,vSharp;
void main(){
  vec2 p=gl_PointCoord-.5;float r=length(p)*2.;
  if(r>1.)discard;
  float core=exp(-r*r*18.),halo=exp(-r*r*4.)*.12;
  vec3 color=mix(uColor,uAccent,vTint*.65);
  color=mix(color,vec3(.88,.95,1.),.35+vSharp*.35);
  gl_FragColor=vec4(color,(core+halo)*vAlpha);
}`

/** Real depth-distributed stars: a diagonal distant cloud and a sparse foreground. */
export function cosmicStars(group:T.Group,uniforms:FlowUniforms,detail:number,seed=98231) {
  const random=randomStream(seed),count=Math.round(2600*Math.max(.45,Math.min(1.5,detail)))
  const positions=new Float32Array(count*3),seeds=new Float32Array(count*3)
  for(let i=0;i<count;i++) {
    const band=i%4!==0,along=(random()-.5)*180
    const gaussian=(random()+random()+random()-1.5)
    positions.set(band?[along,along*.27+gaussian*12+10,-65+(random()-.5)*40]
      :[(random()-.5)*150,(random()-.5)*85,-10-random()*135],i*3)
    seeds.set([random(),band?.38+random()*.65:.8+random()*1.8,random()**3],i*3)
  }
  const geometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(positions,3))
    .setAttribute('aSeed',new T.BufferAttribute(seeds,3))
  const stars=new T.Points(geometry,cosmicMaterial(uniforms,starsVertex,starsFragment,true));stars.frustumCulled=false;group.add(stars)
  return {setDensity(value:number){geometry.setDrawRange(0,Math.max(100,Math.min(count,Math.round(count*value))))}}
}

export const atmosphereFragment=`${uniformSource}
varying vec3 vWorld,vNormal,vLocal;
void main(){
  vec3 n=normalize(vNormal),view=normalize(cameraPosition-vWorld);
  float facing=max(0.,dot(n,view));
  float rim=pow(1.-facing,5.5);
  float sun=max(0.,dot(n,normalize(vec3(.6,.7,1.))));
  vec3 tint=mix(uColor,uAccent,.2+sun*.35);
  gl_FragColor=vec4(tint,rim*(.1+sun*.65)*(1.+uBass*.16));
}`
