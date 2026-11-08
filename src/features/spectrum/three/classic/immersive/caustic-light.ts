import * as T from "three";
import {
  commonUniforms,
  flowDriver,
  material,
  mesh,
  randomStream,
  uniformSource,
  type FlowEffect,
} from "../flow/shared";
import {
  reactiveUniforms,
  reactiveSource,
  updateReactiveUniforms,
} from "../../reactive-motion";

// Project a tessellated water surface onto the floor. Overlapping folds add
// light; their projected area controls intensity, rather than drawing contours.
const vertex = `${uniformSource}${reactiveSource}
varying vec2 vWater,vFloor;
varying vec3 vCurvature;
void main(){
  vec2 source=position.xy,gradient=vec2(0.);
  vCurvature=vec3(0.);
  float front=musicFront(length(source)*.022,.32,.065,vec3(1.,.45,.2));
  for(int i=0;i<7;i++){
    float n=float(i),angle=n*2.39996;
    vec2 k=vec2(cos(angle),sin(angle))*(.65+n*.13)/uRange;
    float phase=dot(source,k)-uPhase*(.38+n*.075)+n*1.27;
    float amplitude=(.28-n*.025)*(.8+uBodyBands.x*.28)*uDepth*(1.+front*.12);
    gradient+=cos(phase)*amplitude*k;
    vCurvature-=sin(phase)*amplitude*vec3(k.x*k.x,k.x*k.y,k.y*k.y);
  }
  vWater=source;vFloor=source+gradient*6.2;
  gl_Position=projectionMatrix*modelViewMatrix*vec4(vFloor.x,-4.,vFloor.y,1.);
}`;
const fragment = `${uniformSource}
varying vec2 vWater,vFloor;
varying vec3 vCurvature;
void main(){
  // Interpolated surface curvature stays continuous across triangles. Screen
  // derivatives of the projected mesh would give each triangle a flat intensity.
  float determinant=(1.+6.2*vCurvature.x)*(1.+6.2*vCurvature.z)-38.44*vCurvature.y*vCurvature.y;
  float concentration=min(7.,1./max(.045,abs(determinant)));
  float light=max(0.,concentration-.28);
  light=2.8*(1.-exp(-light*.4));
  float illumination=.65+.35*sin(vWater.x*.17+vWater.y*.23-uPhase*.14);
  float distanceFade=exp(-max(0.,-vFloor.y)*.025);
  float fade=(1.-smoothstep(21.,30.,abs(vWater.x)))*(1.-smoothstep(25.,37.,abs(vWater.y)));
  vec3 color=mix(uColor,uHighlight,smoothstep(.3,2.4,light)*.8);
  // Coverage follows the light itself; unfocused triangles must not paint
  // dark polygons when composited over the user's wallpaper.
  float alpha=fade*clamp(light*.30,0.,.55);
  gl_FragColor=vec4(color*(.3+light*.8)*illumination*distanceFade,alpha);
}`;
const beamVertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const beamFragment = `${uniformSource}varying vec2 vUv;
void main(){float edge=exp(-pow((vUv.x-.5)*5.,2.));float fade=pow(max(0.,sin(vUv.y*3.14159)),1.5);gl_FragColor=vec4(mix(uColor,uHighlight,.35),edge*fade*.02);}`;
const dustVertex = `${uniformSource}varying float vAlpha;
void main(){vec3 p=position;p.x+=sin(uPhase*.15+p.y*.2)*.16;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(25./max(1.,-mv.z)*uPixelRatio,.6,1.8);vAlpha=.12;}`;
const dustFragment = `${uniformSource}varying float vAlpha;
void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.)discard;gl_FragColor=vec4(uHighlight,exp(-r*r*5.)*vAlpha);}`;
export function createCausticLight(detail: number): FlowEffect {
  const group = new T.Group();
  group.name = "refracted-water-light";
  const u = { ...commonUniforms(), ...reactiveUniforms() },
    drive = flowDriver(u);
  const floor = material(u, vertex, fragment, true);
  floor.depthWrite = false;
  const segments = Math.round(224 * Math.max(0.65, Math.min(1.2, detail)));
  mesh(
    group,
    new T.PlaneGeometry(64, 80, segments, Math.round(segments * 1.25)),
    floor,
  );
  for (let i = 0; i < 3; i++) {
    const beam = mesh(
      group,
      new T.PlaneGeometry(8 + i, 34),
      material(u, beamVertex, beamFragment, true),
    );
    beam.position.set(-10 + i * 9, 8, -16 - i * 8);
    beam.rotation.z = -0.22;
  }
  const random = randomStream(92714),
    dust = new T.BufferGeometry(),
    points: number[] = [];
  for (let i = 0; i < 400; i++)
    points.push((random() - 0.5) * 45, -2 + random() * 15, -30 + random() * 50);
  dust.setAttribute("position", new T.Float32BufferAttribute(points, 3));
  const motes = new T.Points(dust, material(u, dustVertex, dustFragment, true));
  motes.frustumCulled = false;
  group.add(motes);
  return {
    group,
    update(motion, config, reduced) {
      drive(motion, config, reduced, 0.5 + config.music.speed * 0.2);
      updateReactiveUniforms(u, motion, config.effect, reduced);
      u.uDepth.value = 0.65 + config.music.fieldHeight * 0.35;
      u.uRange.value = 0.8 + config.music.ambientSpread * 0.2;
    },
  };
}
