import * as T from 'three'
import { uniformSource } from '../flow/shared'
import { luminousSource, type luminousUniforms } from './luminous-motion'
import { volumeGlow } from './light-kit'

/** Camera-facing instanced light samples. Curves live on the GPU, never CPU sprite objects. */
export function instancedTrail(group: T.Group, uniforms: ReturnType<typeof luminousUniforms>, lanes: number, samples: number, body: string, helpers = '') {
  const plane = new T.PlaneGeometry(1,1)
  const geometry = new T.InstancedBufferGeometry().setIndex(plane.index)
  geometry.setAttribute('position', plane.getAttribute('position')); geometry.setAttribute('uv', plane.getAttribute('uv'))
  geometry.setAttribute('aTrail',new T.InstancedBufferAttribute(Float32Array.from({length:lanes*samples*2},(_,i)=>i%2?((Math.floor(i/2)%samples)+.5)/samples:Math.floor(i/2/samples)),2))
  geometry.instanceCount = lanes * samples; plane.dispose()
  const shader = new T.ShaderMaterial({uniforms,transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false,
    vertexShader:`${uniformSource}${luminousSource}${volumeGlow}attribute vec2 aTrail;varying vec2 vUv;varying float vAlpha,vTint;
    const float PI=3.14159265,TAU=6.2831853;
    ${helpers}
    void main(){float lane=aTrail.x,t=aTrail.y,size=.08;vec3 p=vec3(0.);vAlpha=1.;vTint=0.;vUv=uv;
      ${body}
      vec4 mv=modelViewMatrix*vec4(p,1.);mv.xy+=position.xy*size;gl_Position=projectionMatrix*mv;
    }`,
    fragmentShader:`${uniformSource}${volumeGlow}varying vec2 vUv;varying float vAlpha,vTint;
    void main(){float r=length(vUv-.5)*2.;if(r>1.)discard;
      float a=(exp(-r*r*8.)*.8+exp(-r*r*2.)*.1)*vAlpha;
      gl_FragColor=vec4(mix(mix(uColor,uAccent,vTint),uHighlight,.15)*1.7,a);
    }`})
  const object=new T.Mesh(geometry,shader);object.frustumCulled=false;group.add(object)
  return geometry
}
