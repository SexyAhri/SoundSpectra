import * as T from "three";
import {
  commonUniforms,
  flowDriver,
  randomStream,
  uniformSource,
  surfaceGeometry,
  type FlowEffect,
} from "../flow/shared";
import {
  reactiveUniforms,
  reactiveSource,
  updateReactiveUniforms,
} from "../../reactive-motion";

const vertex = `${uniformSource}${reactiveSource}
attribute vec4 aSeed;varying float vAlpha,vTurn,vDetail,vAspect,vSize;
void main(){
 float fall=mod(aSeed.y*110.+uPhase*(2.+aSeed.z*2.),110.);
 vec3 p=vec3((aSeed.x-.5)*155.+sin(uPhase*.35+aSeed.y*14.)*(1.+uWidth*2.+uDragBands.y*2.)+fall*uTwist*.08,
   50.-fall,-115.+aSeed.z*130.);
 // A broad crosswind carries flakes; accents turn crystals without pulling
 // their centers away from, then back onto, the falling path.
 p.x+=sin(uPhase*.13+aSeed.z*2.)*1.1;
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 float hero=step(.83,aSeed.w);
 gl_PointSize=clamp((.6+aSeed.w*1.4+hero*3.8)*uRange*230./max(8.,-mv.z),1.2,68.)*uPixelRatio*(1.+hero*uAccents.z*.18);
 vSize=gl_PointSize/max(.5,uPixelRatio);
 vAlpha=(.34+aSeed.w*.56)*smoothstep(0.,6.,fall)*(1.-smoothstep(100.,110.,fall));
 vTurn=aSeed.x*6.283+uPhase*(.1+aSeed.z*.1)+uDrift.z*(.3+aSeed.w*.7);vDetail=hero;
 vAspect=.72+.28*cos(uPhase*(.22+aSeed.x*.13)+aSeed.y*19.+uDrift.y*.4);
}`;
const fragment = `${uniformSource}
varying float vAlpha,vTurn,vDetail,vAspect,vSize;
void main(){
 vec2 p=(gl_PointCoord-.5)*2.;float c=cos(vTurn),s=sin(vTurn);p=mat2(c,-s,s,c)*p;
 p.x/=max(.4,vAspect);
 float radius=length(p);if(radius>1.)discard;
 // Fold into one of six arms, then measure actual stem and paired branch
 // segments. Screen derivatives keep the fine ice needles stable at distance.
 float angle=mod(atan(p.y,p.x)+.523599,1.047198)-.523599;
 vec2 arm=vec2(cos(angle),abs(sin(angle)))*radius;
 float distanceToIce=length(vec2(max(0.,arm.x-.86),arm.y));
 for(int i=0;i<3;i++){
   vec2 q=arm-vec2(.25+float(i)*.19,0.);
   vec2 direction=vec2(.66,.75);
   float branchLength=.23-float(i)*.035;
   distanceToIce=min(distanceToIce,length(q-direction*clamp(dot(q,direction),0.,branchLength)));
 }
 float aa=max(.009,fwidth(distanceToIce));
 float crystal=(1.-smoothstep(.012,.012+aa,distanceToIce))*(1.-smoothstep(.86,.99,radius));
 float soft=exp(-radius*radius*7.);
 // Subpixel crystals should read as distant snow, not flickering asterisks.
 float detail=vDetail*smoothstep(8.,19.,vSize);
 float alpha=mix(soft*.7,crystal*.92+soft*.08,detail)*vAlpha;
 vec3 tint=mix(uColor,uHighlight,vDetail);
 // A cool edge preserves the crystal on pale wallpaper without an opaque box.
 tint=mix(tint,uAccent*.42,smoothstep(.2,.9,radius)*.65);
 gl_FragColor=vec4(tint,alpha);
}`;

// Thin volumetric ribbons occupy different depths, so orbiting the scene
// reveals parallax instead of a flat waveform pasted over the snowfall.
const windVertex = `${uniformSource}${reactiveSource}
attribute float aLane;
varying vec2 vUv;
void main(){
 float x=(uv.x-.5)*165.,lane=aLane;
 float wave=sin(uv.x*9.+lane*.83-uPhase*.28);
 float envelope=sin(uv.x*3.141593);
 float y=-27.+lane*.75+wave*(2.5+uBodyBands.x*4.)
   +sin(uv.x*18.+lane-uPhase*.43)*1.4;
 y+=(uv.y-.5)*(.26+mod(lane,3.)*.13+uBodyBands.y*.2);
 vec3 p=vec3(x,y,-18.-lane*5.+cos(uv.x*7.+lane)*7.*envelope);
 vUv=uv;
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
const windFragment = `${uniformSource}
varying vec2 vUv;
void main(){
 float edge=pow(max(0.,1.-abs(vUv.y-.5)*2.),1.4);
 float ends=pow(max(0.,sin(vUv.x*3.141593)),.7);
 vec3 tint=mix(uColor,uHighlight,.65);
 gl_FragColor=vec4(tint*(1.1+uBass*.4),edge*ends*(.42+uMiddle*.2));
}`;
const mistVertex = `${uniformSource}
varying vec2 vUv;
void main(){
 vUv=uv;
 vec3 p=vec3((uv.x-.5)*175.,-41.+uv.y*26.,-34.);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
const mistFragment = `${uniformSource}
varying vec2 vUv;
float noise(vec2 p){return sin(p.x*1.7+sin(p.y*2.3))*sin(p.y*1.3+cos(p.x*2.1));}
void main(){
 vec2 p=vec2(vUv.x*15.-uPhase*.12,vUv.y*5.);
 float fog=.55+.22*noise(p)+.13*noise(p*2.3);
 float height=exp(-vUv.y*3.2)*smoothstep(0.,.13,vUv.y)*(1.-smoothstep(.65,1.,vUv.y));
 float sides=smoothstep(0.,.14,vUv.x)*(1.-smoothstep(.86,1.,vUv.x));
 float alpha=fog*height*sides*(.65+uBass*.18);
 gl_FragColor=vec4(mix(uColor,uHighlight,.5)*.8,alpha);
}`;

/** Depth-separated snow falls softly; no opaque sky covers the user's wallpaper. */
export function createDriftingSnow(detail: number): FlowEffect {
  const group = new T.Group(),
    uniforms = { ...commonUniforms(), ...reactiveUniforms() },
    drive = flowDriver(uniforms),
    random = randomStream(44123);
  const capacity = Math.round(2200 * Math.max(0.5, Math.min(1.3, detail))),
    seeds = new Float32Array(capacity * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  const geometry = new T.BufferGeometry()
    .setAttribute(
      "position",
      new T.Float32BufferAttribute(new Float32Array(capacity * 3), 3),
    )
    .setAttribute("aSeed", new T.BufferAttribute(seeds, 4));
  const snow = new T.Points(
    geometry,
    new T.ShaderMaterial({
      uniforms,
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  snow.frustumCulled = false;
  group.add(snow);
  const mist = new T.Mesh(
    new T.PlaneGeometry(1, 1),
    new T.ShaderMaterial({
      uniforms,
      vertexShader: mistVertex,
      fragmentShader: mistFragment,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      toneMapped: false,
    }),
  );
  mist.frustumCulled = false;
  group.add(mist);
  const wind = new T.Mesh(
    surfaceGeometry(160, 1, 9),
    new T.ShaderMaterial({
      uniforms,
      vertexShader: windVertex,
      fragmentShader: windFragment,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      toneMapped: false,
    }),
  );
  wind.frustumCulled = false;
  group.add(wind);
  return {
    group,
    update(motion, config, reduced) {
      const m = config.music;
      drive(motion, config, reduced, 0.55 + m.speed * 0.12);
      updateReactiveUniforms(uniforms, motion, "ripple", reduced);
      uniforms.uWidth.value = m.rippleWidth;
      uniforms.uRange.value = 0.6 + m.rippleWidth * 0.5;
      uniforms.uTwist.value = m.rippleTwist;
      geometry.setDrawRange(
        0,
        Math.round(capacity * (0.25 + m.rippleLights * 0.18)),
      );
    },
  };
}
