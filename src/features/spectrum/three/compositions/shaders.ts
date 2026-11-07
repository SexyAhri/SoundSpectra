import { audioShader } from './audio'

export const surfaceVertex = /* glsl */`
${audioShader}
uniform float uTime,uKind,uLayer,uBass,uMiddle,uTreble,uReduced,uShape;
uniform float uMapBend,uMapUnfold;
varying vec2 vUv;
varying vec3 vWorld;
varying float vWave;
const float PI=3.14159265359;
vec3 shape(vec2 uv){
  float t=uTime, a=uv.x*PI*2., v=(uv.y-.5)*2.;
  if(uKind<.5){
    // Closed folded annulus: an asymmetric silhouette and a readable open core.
    float tube=uv.y*PI*2.;
    float fold=sin(a*3.-t*.48+tube*.7);
    float local=sin(a*5.-t*1.3+tube*2.)*(.08+uBass*.18)*uShape;
    float radius=3.15+.36*cos(a*3.+.4)+(.98+.15*fold)*cos(tube)+local;
    float x=radius*cos(a), y=radius*sin(a)*1.13;
    float z=(1.12+.19*sin(a*2.))*sin(tube)+.75*sin(a*2.+.5)+.13*sin(a*7.-t);
    return vec3(x,y,z);
  }
  if(uKind<1.5){
    float x=(uv.x-.5)*31.;
    float z=(uv.y-.5)*8.-uLayer*6.;
    float wave=sin(x*.28+z*.34-t*.85+uLayer*.8);
    float y=wave*(1.1+(.7+uBass*.7)*uShape)+.85*sin(x*.49-z*.22+t*.55)+.22*sin(x*.95+z*.7-t*1.45)*(1.+uMiddle*.7);
    y+=uLayer*.7-.7+v*.6;
    return vec3(x,y,z);
  }
  // Fixed-depth samples of a structure travelling toward the viewer (+Z).
  float z=9.-uv.x*84., s=z-t*2.4;
  float angle=uLayer*PI/3.+sin(uLayer*3.)*.23+s*(.065+mod(uLayer,3.)*.019);
  float front=onsetWave((1.-uv.x)*66.+mod(uLayer,3.)*2.,32.,3.);
  float bend=(sin(s*.16+uLayer)*(.45+uBass*1.25)+front*1.25)*uShape;
  float radius=4.6+mod(uLayer,3.)*1.15+.55*sin(s*.11+uLayer*1.9)+bend;
  float width=(.55+mod(uLayer,3.)*.28)*v;
  float theta=angle+width*.12+sin(s*.22+uLayer)*(.07*uMiddle);
  return vec3(cos(theta)*(radius+width)+1.4*sin(s*.06),sin(theta)*(radius+width)*.78+.6*cos(s*.08),z+width*sin(s*.13+uLayer));
}
void main(){
  vUv=uv;
  vec3 p=shape(uv);
  if(uKind>1.5){p.x+=sin(p.z*.12+uLayer)*uMapBend*1.8;vec2 direction=normalize(p.xy+vec2(.001));p.xy+=direction*uMapUnfold*1.8*pow(sin(uv.x*PI),2.);}
  vWave=sin(uv.x*35.-uTime*2.+uLayer*1.7);
  vWorld=(modelMatrix*vec4(p,1.)).xyz;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}
`
export const surfaceFragment = /* glsl */`
${audioShader}
uniform float uTime,uKind,uLayer,uBass,uMiddle,uTreble,uDaily;
uniform vec3 uMain,uAccent,uHigh;
varying vec2 vUv;
varying vec3 vWorld;
varying float vWave;
float line(float x,float thickness){
  float q=abs(fract(x-.5)-.5)/max(fwidth(x),.0001);
  return 1.-smoothstep(thickness,thickness+1.,q);
}
void main(){
  vec3 normal=cross(dFdx(vWorld),dFdy(vWorld));
  vec3 n=normal/max(length(normal),.000001);
  vec3 eye=normalize(cameraPosition-vWorld);
  float rim=pow(clamp(1.-abs(dot(n,eye)),0.,1.),2.7);
  float lit=.12+.88*max(0.,dot(n,normalize(vec3(-.4,1.,.8))));
  float stripes=line(vUv.x*(uKind<.5?176.:128.),.28);
  float crossline=line(vUv.y*(uKind<.5?48.:32.),.15);
  float travel=.5+.5*sin(vUv.x*(uKind>1.5?95.:22.)-uTime*1.8+uLayer*2.);
  travel=pow(travel,10.);
  float warm=.5+.5*sin(vUv.x*6.283+uLayer*1.8+vUv.y*2.);
  vec3 base=mix(uMain,uAccent,warm*.7);
  vec3 color=base*(lit*.72+.11)+uHigh*(stripes*(.075+uTreble*.04)+crossline*.025+rim*.32);
  color+=mix(uMain,uHigh,.45)*travel*(.08+uMiddle*.12)*(stripes+.12);
  // MSAA can extrapolate UV at a thin silhouette's pixel center. Bound the
  // power before HDR/Bloom, or subpixel edges become enormous white flares.
  float edge=pow(clamp(abs(vUv.y-.5)*2.,0.,1.),16.);
  float alpha=.94;
  if(uKind<.5){
    color+=uAccent*pow(.5+.5*sin(vUv.y*6.283+vUv.x*18.-uTime*.6),12.)*.24;
  }else if(uKind<1.5){
    alpha=(.68+rim*.22)*smoothstep(0.,.045,vUv.x)*smoothstep(0.,.045,1.-vUv.x);
    color*=1.-uLayer*.16;
    color+=uHigh*edge*.18;
  }else{
    float rung=line(vUv.x*90.+uTime*2.5,.55);
    travel=pow(.5+.5*sin(vUv.x*95.+uTime*3.4+uLayer*2.),10.);
    color=base*(.20+lit*.35)+uHigh*edge*.48+base*rung*.30;
    color+=base*travel*(.10+uMiddle*.14);
    color+=uHigh*travel*edge*(.12+uTreble*.3);
    float front=onsetWave((1.-vUv.x)*66.+mod(uLayer,3.)*2.,32.,3.);
    color+=mix(uAccent,uHigh,.45)*front*(.38+edge*.5+rung*.25);
    color+=base*rung*uAccents.y*.55+uHigh*edge*travel*uAccents.z*.9;
    float distanceFade=1.-smoothstep(16.,80.,length(cameraPosition-vWorld));
    color*=distanceFade;
    alpha=.96*distanceFade*smoothstep(0.,.04,vUv.x)*smoothstep(0.,.08,1.-vUv.x);
  }
  gl_FragColor=vec4(color*(1.-uDaily*.22),alpha);
}
`
