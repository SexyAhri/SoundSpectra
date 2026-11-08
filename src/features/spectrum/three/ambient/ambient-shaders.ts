import { reactiveSource } from "../reactive-motion";

export const audioUniforms = `${reactiveSource}
uniform float uPhase;
uniform float uVolume;
uniform float uSustain,uOnsetAge,uOnsetStrength;
uniform vec3 uBands;
uniform vec3 uAccents;
uniform float uSpectrum[48];
uniform float uTouch;
uniform vec2 uPointer;
uniform float uSpread;
uniform float uBrightness;
uniform float uDesktop;
uniform vec3 uMid;
uniform vec3 uWarm;
uniform vec3 uHigh;
`;

const flowerPose = `
mat2 flowerTurn(float a){return mat2(cos(a),sin(a),-sin(a),cos(a));}
vec3 flowerPose(vec3 p,float flower){
  float tilt=flower<.5?.48:flower<1.5?.95:.7;
  p.yz=flowerTurn(tilt)*p.yz;
  p.xy=flowerTurn(-.16+flower*.37)*p.xy;
  p.xz=flowerTurn(sin(uPhase*.09+flower*1.7)*.075)*p.xz;
  return p;
}
`;
export const petalVertex = `${audioUniforms}${flowerPose}
attribute vec4 aPetal;
attribute vec4 aOrigin;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vLayer;
varying float vSeed;
varying float vFlower;
void main() {
  float t=uv.y,s=uv.x*2.-1.,ring=aPetal.y,seed=aPetal.z,flower=aPetal.w;
  float trailing=mix(uBodyBands.y,uDragBands.y,clamp(ring*.14+t*.45,0.,1.));
  float bass=mix(uBodyBands.x,uDragBands.x,t);
  float resting=flower<.5?.91:flower<1.5?.38:.24;
  float opening=resting+trailing*.25-bass*.12+uTouch*.06;
  float angle=aPetal.x+t*t*.13*sin(seed*19.)+sin(uPhase*.16+seed*9.)*.025*t;
  float outline=sqrt(max(0.,sin(t*3.14159265)));
  float baseWidth=(1.25-ring*.22)*(flower<.5?1.:.52);
  float width=outline*baseWidth*(1.+s*.09*sin(seed*17.));
  float radius=.15+t*(4.15-ring*.75)*(.91+seed*.16)*opening;
  float cup=ring*.19+t*t*(.3+ring*.36+bass*.7-trailing*.28);
  cup+=pow(t,6.)*(-.44+ring*.32+seed*.2)+s*s*outline*(.25+ring*.045);
  cup+=sin(s*5.+t*9.+seed*17.)*outline*.035;
  cup+=t*t*(flower<.5?0.:1.2);
  vec3 p=vec3(cos(angle)*radius-sin(angle)*width*s,
    sin(angle)*radius+cos(angle)*width*s,cup);
  float response=0.,responseSlope=0.;
  for(int i=0;i<8;i++){
    if(i>=uMusicWaveCount)break;
    vec4 wave=uMusicWaves[i];float age=max(0.,wave.x-ring*.07-seed*.06);
    float front=t-age*1.75,attack=1.-exp(-age*25.);
    float regional=wave.w<.5?1.:wave.w<1.5?.85:.16;
    float amplitude=exp(-front*front*65.)*attack*attack*exp(-age*2.8)*wave.y*regional;
    response+=amplitude;responseSlope+=amplitude*(-130.*front);
  }
  p.z+=response*.65*(.4+.6*seed)+t*t*sin(uPhase*.23+seed*9.)*(.035+trailing*.12);
  // Smooth parametric normals retain curved petals at every mesh quality.
  float outlineSlope=3.14159265*cos(t*3.14159265)/max(.06,2.*outline);
  float angleSlope=2.*t*.13*sin(seed*19.)+sin(uPhase*.16+seed*9.)*.025;
  float widthSlope=outlineSlope*baseWidth*(1.+s*.09*sin(seed*17.));
  float cupSlope=2.*t*(.3+ring*.36+bass*.7-trailing*.28+(flower<.5?0.:1.2));
  cupSlope+=6.*pow(t,5.)*(-.44+ring*.32+seed*.2)+s*s*outlineSlope*(.25+ring*.045);
  cupSlope+=(sin(s*5.+t*9.+seed*17.)*outlineSlope+cos(s*5.+t*9.+seed*17.)*outline*9.)*.035;
  cupSlope+=responseSlope*.65*(.4+.6*seed)+2.*t*sin(uPhase*.23+seed*9.)*(.035+trailing*.12);
  vec3 radial=vec3(cos(angle),sin(angle),0.),side=vec3(-sin(angle),cos(angle),0.);
  vec3 lengthTangent=radial*((4.15-ring*.75)*(.91+seed*.16)*opening-angleSlope*width*s)
    +side*(widthSlope*s+angleSlope*radius)+vec3(0.,0.,cupSlope);
  vec3 widthTangent=side*(width+s*outline*baseWidth*.09*sin(seed*17.))
    +vec3(0.,0.,2.*s*outline*(.25+ring*.045)+cos(s*5.+t*9.+seed*17.)*outline*.175);
  vec3 normal=cross(lengthTangent,widthTangent);normal/=max(length(normal),.00001);
  vNormal=mat3(modelMatrix)*flowerPose(normal,flower);
  p=flowerPose(p*aOrigin.w,flower);
  p.xy+=uPointer*(.06+t*.08);
  p+=aOrigin.xyz*vec3(uSpread,1.,1.);
  vWorld=(modelMatrix*vec4(p,1.)).xyz;vUv=uv;vLayer=ring;vSeed=seed;vFlower=flower;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.);
}`;

export const petalFragment = `${audioUniforms}
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vLayer;
varying float vSeed;
varying float vFlower;
void main() {
  vec3 normal = vNormal;
  normal /= max(length(normal), .00001);
  vec3 view=cameraPosition-vWorld;view/=max(length(view),.00001);
  if(dot(normal,view)<0.)normal=-normal;
  float rim = pow(clamp(1. - abs(dot(normal, view)), 0., 1.), 2.);
  float t=clamp(vUv.y,0.,1.),across=abs(vUv.x*2.-1.);
  float veinPhase=(vUv.x-.5)*(48.-t*17.)+sin(t*8.+vSeed*9.)*.8;
  float vein=pow(max(0.,.5+.5*cos(veinPhase)),16.)*exp(-pow(fwidth(veinPhase),2.)*.5);
  float edge=(1.-smoothstep(.96,1.,across))*smoothstep(0.,.025,t)*(1.-smoothstep(.985,1.,t));
  vec3 ivory=uHigh,blush=mix(uMid,uWarm,.25);
  vec3 color=mix(blush,ivory,smoothstep(.12,.98,t)*.58);
  color=mix(color,uWarm,exp(-t*5.)*.48);
  vec3 light=normalize(vec3(-.55,.8,1.));
  float diffuse=.25+.62*max(0.,dot(normal,light));
  float transmission=pow(max(0.,dot(-normal,light)),1.4)*(.25+t*.28);
  float silk=pow(max(0.,dot(reflect(-light,normal),view)),38.);
  color*=(diffuse+transmission+rim*.22-vein*.055)*(.48+.52*smoothstep(.02,.65,t));
  color+=ivory*(silk*.065+uGesture.z*.07*pow(t,6.)*step(.7,vSeed));
  color*=uBrightness*(vFlower<.5?1.:.76);
  float alpha=edge*(.92-t*.14-rim*.16);
  if(alpha<.01)discard;
  gl_FragColor = vec4(color, alpha);
}`;

export const dustVertex = `${audioUniforms}
uniform vec2 uResolution;
uniform float uMode;
attribute vec3 aSeed;
attribute float aRole;
varying float vAlpha;
varying vec3 vColor;
varying float vSpark;
varying float vTrail;
void main() {
  vec3 p;
  float fade = 1.;
  if (uMode > .5 && uMode < 1.5) {
    float depth = mod(aSeed.z * 72. - uPhase * 4., 72.);
    float angle = aSeed.x * 6.2831853 + sin(uPhase * .1) * .05;
    float radius = (2.3 + pow(aSeed.y, .6) * 24.) * uSpread;
    p = vec3(cos(angle) * radius, sin(angle) * radius, 10. - depth);
    p.xy += uPointer * (depth / 20. + .2);
    fade = smoothstep(0., 7., depth) * (1. - smoothstep(48., 72., depth));
  } else {
    p = vec3((aSeed.x - .5) * 44., (aSeed.y - .5) * 24., -aSeed.z * 30.);
    p.x += sin(uPhase * .2 + aSeed.y * 14.) * (.3 + uBands.y * .6);
    p.y += sin(uPhase * .15 + aSeed.x * 11.) * .45;
    p.xy *= uSpread;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((2. + aSeed.y * 2.5) * 18. / max(1., -mv.z) * uResolution.y / 900., .7, 13.);
  vAlpha = fade * (.2 + aSeed.y * .6) * (uMode > 1.5 ? .35 : 1.);
  vColor = mix(uMid, uHigh, aSeed.x) * uBrightness * (.7 + uBands.z * 1.4 + uTouch * .2);
  vSpark = 0.;
  vTrail = 0.;
  if (uMode > .5 && uMode < 1.5) {
    float distanceToCamera=length(mv.xyz);
    float near=1.-smoothstep(18.,52.,distanceToCamera);
    // Only a stable minority of nearby stars get tails; no per-frame random flicker.
    vTrail=step(.82,fract(aSeed.x*41.+aSeed.y*23.+aSeed.z*59.))*near;
    if(aRole>.5) {
      vec4 tail=projectionMatrix*modelViewMatrix*vec4(p-vec3(0.,0.,.21+uVolume*1.19),1.);
      if(gl_Position.w>.1 && tail.w>.1) {
        vec2 delta=tail.xy/tail.w-gl_Position.xy/gl_Position.w;
        float pixels=length(delta*uResolution*.5);
        // Bound close-camera perspective streaks as well as their world-space length.
        gl_Position.xy+=delta*min(1.,(8.*uResolution.y/900.)/max(pixels,.001))*gl_Position.w;
      }
    }
    vSpark = step(.99, fract(aSeed.x * 73. + aSeed.z * 17.));
    gl_PointSize = min(18., max(gl_PointSize * 1.25, 1.7 * uResolution.y / 900.) * (1. + vSpark * 1.5));
    float local=musicFront(aSeed.z,.55,.07,vec3(.5,.65,1.));
    vColor = mix(mix(uMid, uWarm, aSeed.x), uHigh, step(.78, aSeed.y) * .8)
      * uBrightness * (1. + uBodyBands.z*.6 + local*step(.72,aSeed.y)*.8 + vSpark * .4 + uTouch * .2);
    vAlpha *= mix(.6,.95,1.-smoothstep(15.,85.,distanceToCamera));
  }
}`;

export const dustFragment = `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord - .5;
  float alpha = exp(-dot(p,p) * 22.) * vAlpha;
  if (dot(p,p) > .25 || alpha < .01) discard;
  gl_FragColor = vec4(vColor * alpha, alpha);
}`;

export const trailFragment = `
varying float vAlpha;
varying vec3 vColor;
varying float vTrail;
void main() { float alpha = vAlpha * vTrail * .2; if(alpha<.002)discard; gl_FragColor = vec4(vColor * alpha, alpha); }
`;

export const coreVertex = `${audioUniforms}${flowerPose}
uniform vec2 uResolution;
attribute vec4 aOrigin;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec3 p=flowerPose(position*aOrigin.w,0.);
  p+=aOrigin.xyz*vec3(uSpread,1.,1.);p.xy+=uPointer*.06;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize=clamp(2.4*aOrigin.w*18./max(1.,-mv.z)*uResolution.y/900.,.8,3.);
  vColor=mix(uWarm,uHigh,.6)*uBrightness*(.65+uGesture.z*.3);vAlpha=.55;
}`;

export const pollenVertex = `${audioUniforms}
uniform vec2 uResolution;attribute vec3 aSeed;
varying float vAlpha;varying vec3 vColor;
void main(){
  float rise=fract(aSeed.y+uPhase*.018+uDrift.z*.008);
  float turn=aSeed.x*6.2831853+uPhase*.055+uDrift.z*.02;
  float radius=1.5+aSeed.z*8.;
  vec3 p=vec3(-2.8+cos(turn)*radius,(rise-.5)*11.,-4.+sin(turn)*radius*.4-aSeed.z*7.);
  p.xy*=vec2(uSpread,1.);
  p.x+=sin(rise*7.+aSeed.x*13.)*.3;
  vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
  gl_PointSize=clamp((1.2+aSeed.x)*18./max(1.,-mv.z)*uResolution.y/900.,.65,3.);
  vColor=mix(uWarm,uHigh,.7)*uBrightness*(.7+uDragBands.z*.4);
  vAlpha=smoothstep(0.,.1,rise)*(1.-smoothstep(.8,1.,rise))*(.12+aSeed.z*.28);
}`;
