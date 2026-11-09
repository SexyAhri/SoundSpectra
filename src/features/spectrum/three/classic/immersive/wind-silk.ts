import * as T from "three";
import {
  commonUniforms,
  flowDriver,
  surfaceGeometry,
  surfaceVertex,
  uniformSource,
  type FlowEffect,
} from "../flow/shared";
import {
  reactiveUniforms,
  reactiveSource,
  updateReactiveUniforms,
} from "../../reactive-motion";

const path = `${reactiveSource}
vec3 silkCurve(vec3 a,vec3 b,vec3 c,vec3 d,float t){
  float s=1.-t;return a*s*s*s+3.*b*s*s*t+3.*c*s*t*t+d*t*t*t;
}
vec3 silkPath(float t,float lane){
  float tail=smoothstep(.12,.95,t);
  float carried=mix(uBodyBands.y,uDragBands.y,tail);
  float lift=sin(t*5.4-uPhase*.27+lane)*(.25+carried*.9);
  vec3 p=t<.5?
    silkCurve(vec3(-24.,5.,-8.),vec3(-15.,-12.,3.),vec3(21.,-11.,-3.),vec3(13.,5.,-9.),t*2.):
    silkCurve(vec3(13.,5.,-9.),vec3(7.,18.,-14.),vec3(-13.,3.,-1.),vec3(22.,-9.,0.),(t-.5)*2.);
  p.y+=lift;
  p+=vec3(sin(t*7.+1.)*2.,cos(t*8.)*3.-1.,-4.)*lane;
  return p;
}
`;
const vertex = surfaceVertex(
  `
  float s=(uv.y-.5)*2.;
  vec3 center=silkPath(t,lane);
  vec3 tangent=silkPath(t+.001,lane)-silkPath(t-.001,lane);
  tangent/=max(length(tangent),.00001);
  vec3 side=vec3(-tangent.y,tangent.x,0.);side/=max(length(side),.00001);
  vec3 normal=cross(tangent,side);
  float lag=mix(uBodyBands.y,uDragBands.y,clamp(t*.6+abs(s)*.4,0.,1.));
  float twist=-.65+t*4.2+lane*.8+sin(t*7.-uPhase*.18)*(.17+lag*.3);
  vec3 across=side*cos(twist)+normal*sin(twist);
  vec3 face=cross(tangent,across);
  float taper=.03+.97*pow(max(0.,sin(t*PI)),.55);
  float width=mix(3.6,1.25,lane)*uWidth*taper;
  float wave=0.;
  for(int i=0;i<8;i++){
    if(i>=uMusicWaveCount)break;
    vec4 event=uMusicWaves[i];
    float age=max(0.,event.x-abs(s)*.075-lane*.09);
    float front=t-event.z-age*.48;
    float attack=1.-exp(-age*24.);
    float weight=event.w<.5?1.:event.w<1.5?.8:.12;
    wave+=exp(-front*front*140.)*attack*attack*exp(-age*1.8)*event.y*weight;
  }
  float material=t*25.-uPhase*1.25;
  float folds=sin(material+s*2.1)*(.34+lag*.3)*s*s;
  folds+=sin(s*4.4+t*6.-uPhase*.8)*.42*(.4+.6*sin(t*PI));
  folds+=sin(t*13.-uPhase*.75+s*.8)*sin(s*1.57)*.32+s*s*.22;
  folds+=sin(t*69.-uPhase*2.6+s*4.)*.025*s*s;
  float body=mix(uBodyBands.x,uDragBands.x,abs(s));
  p=center+across*(s*width)+face*(folds+sin(s*2.4+material*.5)*body*.4+wave*(.65+s*.32));
  p+=side*sin(t*9.-uPhase*.21+lane)*(lag*.28*s*s);
  vLight=wave;
`,
  path,
);

const fragment = `${uniformSource}
varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
void main(){
  vec3 dx=dFdx(vWorld),dy=dFdy(vWorld);
  vec3 n=cross(dx,dy);n/=max(length(n),.00001);if(!gl_FrontFacing)n=-n;
  vec3 view=cameraPosition-vWorld;view/=max(length(view),.00001);
  vec3 light=normalize(vec3(-.55,.85,1.));
  vec3 halfLight=light+view;halfLight/=max(length(halfLight),.00001);
  vec3 tangent=dx*dFdy(vUv).y-dy*dFdx(vUv).y;tangent/=max(length(tangent),.00001);
  float diffuse=.22+.72*max(0.,dot(n,light));
  float grazing=pow(clamp(1.-abs(dot(n,view)),0.,1.),2.5);
  float anisotropy=pow(clamp(1.-pow(dot(tangent,halfLight),2.),0.,1.),12.);
  float sheen=pow(max(0.,dot(n,halfLight)),12.)*(.25+anisotropy*.75);
  float backlight=pow(max(0.,dot(-n,light)),2.)*.20;
  vec3 dye=mix(uColor,uAccent,clamp(vLane*.55+vUv.y*.16+sin(vUv.x*4.2)*.05,0.,1.));
  float thread=vUv.y*4200.;
  float weave=1.+sin(thread)*.035*exp(-pow(fwidth(thread)*.7,2.));
  vec3 color=dye*(diffuse*weave+backlight+grazing*.1);
  color+=mix(dye,uHighlight,.8)*(sheen*(.50+uTrail*.075)+grazing*.14);
  float hem=exp(-min(vUv.y,1.-vUv.y)*200.);
  color+=mix(dye,uHighlight,.45)*(hem*.08+vLight*.045);
  float ends=smoothstep(0.,.018,vUv.x)*(1.-smoothstep(.982,1.,vUv.x));
  float edge=smoothstep(0.,max(.002,fwidth(vUv.y)),min(vUv.y,1.-vUv.y));
  float alpha=ends*edge*(.94+grazing*.04);
  if(alpha<.005)discard;
  gl_FragColor=vec4(color,alpha);
}`;

/** Two suspended satin lengths: a broad open loop and a finer trailing ribbon. */
export function createWindSilk(detail: number): FlowEffect {
  const group = new T.Group();
  group.name = "suspended-silk";
  const uniforms = { ...commonUniforms(), ...reactiveUniforms() },
    drive = flowDriver(uniforms);
  const geometry = surfaceGeometry(
    Math.round(260 * Math.max(0.65, Math.min(1.5, detail))),
    48,
    2,
  );
  const material = new T.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    side: T.DoubleSide,
    transparent: true,
    depthWrite: true,
    toneMapped: false,
  });
  const sheet = new T.Mesh(geometry, material);
  sheet.name = "satin-loops";
  sheet.frustumCulled = false;
  group.add(sheet);
  return {
    group,
    update(motion, config, reduced) {
      const m = config.music;
      drive(
        motion,
        config,
        reduced,
        m.skinFlowSpeedMultiplier * (0.32 + m.speed * 0.15),
      );
      updateReactiveUniforms(uniforms, motion, "rhythm_skin", reduced);
      uniforms.uWidth.value = m.dragonWidth;
      uniforms.uTrail.value = m.dragonTrail;
    },
  };
}
