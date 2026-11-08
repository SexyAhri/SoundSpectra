import * as T from 'three'
import { material, mesh, randomStream, surfaceGeometry, uniformSource, type FlowUniforms } from '../flow/shared'
import type { SpectrumSettings } from '../../../model'

type LightProfile = 'seeds' | 'ginkgo' | 'water'
const profiles = {
  seeds: { origin: [-24, 32, -39], direction: [.43, -1, .19], length: 83, width: 1.8, spacing: 17 },
  ginkgo: { origin: [-13, 21, 5], direction: [.42, -1, -.12], length: 41, width: .68, spacing: 6 },
  water: { origin: [-14, 24, -17], direction: [.28, -1, .15], length: 34, width: .85, spacing: 9 },
} as const

export function daylightUniforms(profile: LightProfile) {
  const p = profiles[profile]
  return {
    uLightOrigin: { value: new T.Vector3(...p.origin) },
    uLightDirection: { value: new T.Vector3(...p.direction).normalize() },
    uLightShape: { value: new T.Vector3(p.length, p.width, p.spacing) },
    uLightEnergy: { value: 0 }, uLightBass: { value: 0 }, uLightImmersive: { value: 0 }, uLightAmount: { value: 1 },
  }
}
type DaylightUniforms = ReturnType<typeof daylightUniforms>

// Objects and shafts sample the same local-space field. This is an analytic
// scattering approximation, without depth occlusion or another fullscreen pass.
export const daylightSource = /* glsl */ `
uniform vec3 uLightOrigin,uLightDirection,uLightShape;
uniform float uLightEnergy,uLightBass,uLightImmersive,uLightAmount;
vec3 shaftOrigin(float lane){
  return uLightOrigin+vec3((lane-1.)*uLightShape.z,0.,sin(lane*2.4)*uLightShape.z*.23);
}
float shaftSample(vec3 p,float lane){
  vec3 delta=p-shaftOrigin(lane);
  float distance=dot(delta,uLightDirection),t=distance/uLightShape.x;
  vec3 radial=delta-uLightDirection*distance;
  float width=uLightShape.y*(.65+max(0.,t)*2.);
  float edge=exp(-dot(radial,radial)/max(.001,width*width));
  float ends=smoothstep(0.,.10,t)*(1.-smoothstep(.65,1.,t));
  return edge*ends*(.72+.22*cos(lane*2.1))*uLightAmount;
}
float daylightAt(vec3 p){
  return min(1.,shaftSample(p,0.)+shaftSample(p,1.)+shaftSample(p,2.));
}
`

export function updateDaylight(u: DaylightUniforms, config: SpectrumSettings, energy: number, dt: number, bass = 0) {
  const tau = energy > u.uLightEnergy.value ? 1.1 : 2.2
  u.uLightEnergy.value += (energy - u.uLightEnergy.value) * (1 - Math.exp(-dt / tau))
  u.uLightBass.value += (bass - u.uLightBass.value) * (1 - Math.exp(-dt / .8))
  u.uLightImmersive.value = config.sceneMode === 'immersive' ? 1 : 0
  u.uLightAmount.value = .55 + config.atmosphere.lights / 100 * .6
}

export function addDaylight(group: T.Group, u: FlowUniforms & DaylightUniforms, dustCount = 0) {
  const rays = mesh(group, surfaceGeometry(1, 1, 3), material(u, `${daylightSource}
    attribute float aLane;varying vec3 vLocal;varying float vLane;varying vec2 vUv;
    void main(){
      vec3 center=shaftOrigin(aLane)+uLightDirection*uv.y*uLightShape.x;
      vec3 eye=(inverse(modelMatrix)*vec4(cameraPosition,1.)).xyz-center;
      vec3 side=cross(uLightDirection,eye);side/=max(.0001,length(side));
      float width=uLightShape.y*(.65+uv.y*2.);
      vLocal=center+side*(uv.x-.5)*width*6.;vLane=aLane;vUv=uv;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(vLocal,1.);
    }`, `${uniformSource}${daylightSource}
    varying vec3 vLocal;varying float vLane;varying vec2 vUv;
    void main(){
      float light=shaftSample(vLocal,vLane);
      float edge=1.-smoothstep(.35,.5,abs(vUv.x-.5));
      float alpha=light*edge*mix(.012,.043,uLightImmersive)*(1.+uLightEnergy*.08+uLightBass*.08);
      if(alpha<.0004)discard;
      gl_FragColor=vec4(mix(uColor,uHighlight,.78),alpha);
    }`, true))
  rays.name = 'daylight-shafts';rays.renderOrder = 2
  if (!dustCount) return
  const random = randomStream(48291), points: number[] = []
  for (let i = 0; i < dustCount; i++) {
    const lane = i % 3, t = random(), origin = u.uLightOrigin.value, direction = u.uLightDirection.value
    points.push(origin.x + (lane - 1) * u.uLightShape.value.z + direction.x * t * u.uLightShape.value.x + (random() - .5) * 12,
      origin.y + direction.y * t * u.uLightShape.value.x,
      origin.z + Math.sin(lane * 2.4) * u.uLightShape.value.z * .23 + direction.z * t * u.uLightShape.value.x + (random() - .5) * 10)
  }
  const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(points, 3))
  const dust = new T.Points(geometry, material(u, `${uniformSource}${daylightSource}
    varying float vLight;
    void main(){
      vec3 p=position;p.x+=sin(uPhase*.16+p.y*.21)*1.3;p.y+=sin(uPhase*.11+p.x*.3)*.5;
      vLight=daylightAt(p);vec4 mv=modelViewMatrix*vec4(p,1.);
      gl_Position=projectionMatrix*mv;
      gl_PointSize=clamp(42./max(1.,-mv.z)*uPixelRatio,.7,2.2*uPixelRatio);
    }`, `${uniformSource}varying float vLight;
    void main(){vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;
      float alpha=exp(-r*4.)*vLight*.30;
      if(alpha<.003)discard;gl_FragColor=vec4(uHighlight,alpha);
    }`, true))
  dust.name = 'daylight-motes';dust.frustumCulled = false;dust.renderOrder = 3;group.add(dust)
}
