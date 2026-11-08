import { audioUniforms } from "./ambient-shaders";

// The transport phase advances only while music is audible and motion is allowed.
// It is separate from the older raw-RMS phase used by other scene families.
const flowUniforms = `${audioUniforms}
uniform float uAuroraPhase;
uniform float uImpulse;
`;

export const auroraVertex = `${flowUniforms}
attribute float aLayer;
varying vec2 vUv;
varying float vLayer;
varying float vEnergy;
void main() {
  float t=uv.x, layer=aLayer, flow=uAuroraPhase;
  float bin=t*47.; int k=int(floor(bin));
  float energy=mix(uSpectrum[k],uSpectrum[min(k+1,47)],fract(bin));
  float bend=t*6.2831853+layer*.8-flow*.28;
  float x=((t-.5)*(46.-layer*4.)+sin(bend)*7.)*uSpread;
  // Broad folds travel across the entire curtain, with a smaller wave following them.
  float sweep=sin(t*6.1+layer*1.55-flow*.55)*3.2
    +sin(t*13.+layer*2.-flow*1.1)*(.45+uBands.y*.35);
  float travellingLift=sin(t*9.-flow*.9+layer*1.7)*(.4+uBands.x*.35);
  float trailing=mix(uBodyBands.x,uDragBands.x,uv.y);
  float height=(8.5+trailing*3.4+uDragBands.y*1.6+uTouch*.5)
    *(.85+.15*sin(t*5.+layer-flow*.32));
  vec3 p=vec3(x,-2.3+layer*.5+sweep+uv.y*(height+travellingLift),
    -18.+layer*8.+cos(bend)*7.);
  p.x+=pow(uv.y,1.7)*sin(t*4.-flow*.4+layer)*1.8;
  p.z+=sin(t*12.-flow*.75+layer)*uv.y*(.8+uDragBands.y*.8);
  p.y+=musicFront(t,.48,.055,vec3(1.,.8,.35))*.38*(1.-uv.y)*(1.-uv.y);
  p.xy+=uPointer*(.1+layer*.06)*(.3+uv.y*.7);
  vUv=uv; vLayer=layer; vEnergy=energy;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;

export const auroraFragment = `${flowUniforms}
varying vec2 vUv;
varying float vLayer;
varying float vEnergy;
float auroraHash(float p) { return fract(sin(p*127.1)*43758.5453); }
float auroraNoise(float p) {
  float i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(auroraHash(i),auroraHash(i+1.),f);
}
void main() {
  // MSAA helper samples can extrapolate beyond a thin curtain triangle. Bound
  // its material coordinates before the exponential falloff (Inf * 0 is NaN).
  float x=clamp(vUv.x,0.,1.), y=clamp(vUv.y,0.,1.), flow=uAuroraPhase;
  // Fine light travels along the surface as well as moving with the geometry.
  // Each layer has a different, steady drift, so changes stay local instead of flashing.
  float movingX=x-flow*(.018+vLayer*.003);
  float warp=sin(x*16.-flow*.6+vLayer)*3.
    +auroraNoise(x*8.+vLayer*13.-flow*.22)*5.;
  float fine=auroraNoise(movingX*130.+warp+vLayer*37.);
  float micro=auroraNoise(movingX*350.+warp*1.7+vLayer*61.);
  float detail=mix(micro,.5,smoothstep(.4,1.5,fwidth(x)*350.));
  float rays=.35+.65*(fine*.75+detail*.25);
  float bundles=.55+.45*auroraNoise(movingX*9.+vLayer*17.);
  float veil=exp(-y*(2.2+fine*.7))*smoothstep(0.,.075,y)*(1.-smoothstep(.6,1.,y));
  // GLSL pow has an undefined result for negative bases, even with exponent 2.
  // Explicit squares keep the lower-rim samples finite before HDR bloom.
  float hemDistance=(y-.075)/.065;
  float hem=exp(-hemDistance*hemDistance)*smoothstep(0.,.035,y);
  // A fine luminous lower rim carries the local spectrum. The broad veil keeps
  // its slow transport while captured transients briefly illuminate individual folds.
  float filamentDistance=(y-.042)/.018;
  float filament=exp(-filamentDistance*filamentDistance)*smoothstep(0.,.018,y);
  float local=musicFront(x,.48,.055,vec3(1.,.8,.35));
  float spectralLight=clamp(vEnergy*.8+local*.9*bundles+uGesture.z*.18*fine,0.,1.2);
  float ends=smoothstep(0.,.16,x)*smoothstep(0.,.16,1.-x);
  float layerWeight=vLayer<.5?.3:vLayer<1.5?1.15:.48;
  float alpha=ends*bundles*(veil*rays*.4+hem*(.11+local*.055)+filament*(.045+spectralLight*.28))*layerWeight*(.9+uBodyBands.y*.35);
  vec3 color=mix(uWarm,uMid,smoothstep(.04,.65,y));
  color=mix(color,uHigh,smoothstep(.35,.95,y)*.35);
  color=mix(color,uHigh,filament*(.16+spectralLight*.32));
  // Keep a darker body between the luminous folds on pale wallpapers.
  color*=mix(1.,.55+.55*fine,uDesktop);
  alpha*=1.+uDesktop*(hem*.7+filament*.6);
  gl_FragColor=vec4(color*alpha*uBrightness,alpha);
}`;
