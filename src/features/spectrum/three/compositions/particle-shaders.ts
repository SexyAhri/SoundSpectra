import { audioShader } from "./audio";

export const particleVertex = /* glsl */ `
${audioShader}
uniform float uTime,uKind,uLayer,uBass,uMiddle,uShape,uPixelHeight,uDaily;
uniform float uMapBend,uMapUnfold,uScatter;
uniform float uSeaFill;
uniform mat4 uSeaProjection;
uniform vec3 uSeaEye;
attribute float aSeed;
varying vec2 vUv;
varying float vSeed,vLight,vFade,vMusic;
const float PI=3.14159265359;
void main(){
  float t=uTime,seed=aSeed;
  vUv=uv;vSeed=seed;
  vec3 p;
  if(uKind<.5){
    // Advect particles through one persistent surface coordinate. Independent
    // time signs in the old folds made neighbouring streams visibly reverse.
    float longitude=uv.x*2.*PI;
    float latitude=uv.y+sin(longitude*3.+uv.y*8.)*sin(uv.y*PI)*.018;
    float a=longitude+t*.12,b=acos(clamp(latitude*2.-1.,-1.,1.));
    float fold=sin(a*3.+b*2.2);
    float r=3.3+.40*fold+.18*sin(b*5.-a*2.);
    float lobe=fold;
    float front=onsetWave(b+uLayer*.35,1.9,.27);
    r+=(lobe*uBass*.85+sin(a*7.+b*3.)*(.06+uMiddle*.28)+front*.85)*uShape;
    r*=mix(1.,.73,uLayer);
    float twist=a+(.28+uMiddle*.16)*sin(b*2.);
    p=vec3(r*sin(b)*cos(twist),r*cos(b)*1.12,r*sin(b)*sin(twist));
    p.x+=.32*sin(b*3.);p.z+=.2*cos(a*2.+b);
    vec3 normal=normalize(normalMatrix*normalize(p));
    vec3 eye=normalize(-(modelViewMatrix*vec4(p,1.)).xyz);
    float facing=dot(normal,eye);
    vLight=.24+.76*pow(max(0.,facing),.65);
    float gathering=.5+.5*sin(a*5.+b*3.+sin(b*7.)*.7);
    vFade=(.50+.67*pow(gathering,1.6))*(1.-uLayer*.38);
    // Keep the far surface subordinate, rather than stacking equally bright
    // particles through the entire volume into an indistinct cloud.
    vFade*=.20+.80*smoothstep(-.25,.65,facing);
    vMusic=front*.8+uAccents.x*max(0.,lobe)*.35;
  }else{
    // Project a fixed particle grid onto the sea, keeping useful sampling in
    // the foreground as the surface opens beyond all four viewport edges.
    vec4 projected=uSeaProjection*vec4((uv.x-.5)*2.7,(.5-uv.y)*2.7,.5,1.);
    vec3 ray=normalize(projected.xyz/projected.w-uSeaEye);
    float travel=clamp(-uSeaEye.y/min(-.08,ray.y),0.,180.);
    vec3 covered=uSeaEye+ray*travel;
    float x=mix((uv.x-.5)*32.,covered.x,uSeaFill);
    float z=mix((uv.y-.5)*25.,covered.z+3.,uSeaFill);
    x+=sin(z*.43+x*.16)*.16;
    z+=sin(x*.38-z*.21)*.13;
    float flow=z-t*1.8;
    float radius=length(vec2(x*.74,z));
    float front=onsetWave(length(vec2(x*.65,z+6.))+uLayer,9.,1.1);
    float y=sin(x*.22+flow*.25)*(1.15+uBass*2.1)*uShape;
    y+=cos(flow*.28-x*.12)*1.0;
    y+=sin(x*.38+flow*.54)*exp(-radius*.065)*(.65+uMiddle*.9);
    y+=front*2.2*uShape;
    y+=pow(min(abs(x)/16.,1.3),3.)*1.7*sin(flow*.19);
    y-=uLayer*1.65;
    p=vec3(x,y,z-3.);
    vLight=.28+.72*pow(.5+.5*sin(x*.22+flow*.25),2.);
    vFade=smoothstep(0.,.045,uv.x)*smoothstep(0.,.045,1.-uv.x)*smoothstep(0.,.06,uv.y)*smoothstep(0.,.06,1.-uv.y);
    float crest=.5+.5*sin(x*.22+flow*.25);
    float gathering=.5+.5*sin(x*.57+flow*.16+sin(z*.31));
    vFade*=(1.-uLayer*.72)*(.46+.78*crest)*(.78+.30*gathering);
    vMusic=front*.75+uAccents.y*max(0.,sin(x*.32-z*.41))*.35;
  }
  if(uKind<.5){
    float theta=uMapBend*.7*sin(uv.y*PI*2.);p.xz=mat2(cos(theta),-sin(theta),sin(theta),cos(theta))*p.xz;
    p+=normalize(p)*uMapUnfold*1.6*(uLayer<.5?1.:-.45);
  }else{p.x+=sin(p.z*.19)*uMapBend*1.8;p.y+=uMapUnfold*2.4*(uLayer<.5?1.:-.65)*sin(uv.x*PI);}
  // Move the actual surface particles along persistent per-particle directions.
  vec3 scatter=normalize(vec3(sin(seed*781.),cos(seed*343.),sin(seed*127.+2.)));
  p+=scatter*uScatter*(3.+seed*5.);vFade*=1.-uScatter*.72;
  vec4 view=modelViewMatrix*vec4(p,1.);
  gl_Position=projectionMatrix*view;
  gl_PointSize=clamp(uPixelHeight*.043/max(1.,-view.z)*(.62+seed*.65),.7,3.8);
  gl_PointSize*=1.+uDaily*(.08+.20*smoothstep(.62,.94,seed))*(1.-uLayer*.5);
}
`;
export const particleFragment = /* glsl */ `
${audioShader}
uniform float uTime,uKind,uLayer,uTreble,uDaily;
uniform vec3 uMain,uAccent,uHigh;
varying vec2 vUv;
varying float vSeed,vLight,vFade,vMusic;
void main(){
  float distance=length(gl_PointCoord-.5)*2.;
  float dotAlpha=1.-smoothstep(.42,1.,distance);
  float warm=uKind<.5?1.-smoothstep(.10,.78,vUv.y):smoothstep(.1,.94,abs(vUv.x-.5)*2.);
  vec3 color=mix(uMain,uAccent,warm);
  float stream=pow(.5+.5*sin(vUv.x*36.+vUv.y*15.-uTime*.85),14.);
  float sparkle=(uTreble*.5+uAccents.z*1.4)*step(.82,vSeed)*stream;
  color=mix(color,uHigh,clamp(stream*.42+vLight*.18+vMusic*.5+sparkle*.5,0.,.9));
  float light=(.45+vLight*.55)*(1.+vMusic*.85+sparkle);
  float alpha=dotAlpha*vFade*(.55+vSeed*.35);
  if(alpha<.015)discard;
  gl_FragColor=vec4(color*light,alpha);
}
`;
