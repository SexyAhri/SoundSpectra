import * as T from "three";
import {
  commonUniforms,
  flowDriver,
  material,
  mesh,
  uniformSource,
  type FlowEffect,
} from "../flow/shared";
import {
  reactiveUniforms,
  reactiveSource,
  updateReactiveUniforms,
} from "../../reactive-motion";
import { addDaylight, daylightUniforms, updateDaylight } from './daylight-field';

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
export function createCausticLight(detail: number): FlowEffect {
  const group = new T.Group();
  group.name = "refracted-water-light";
  const u = { ...commonUniforms(), ...reactiveUniforms(), ...daylightUniforms('water') },
    drive = flowDriver(u);
  const floor = material(u, vertex, fragment, true);
  floor.depthWrite = false;
  const segments = Math.round(224 * Math.max(0.65, Math.min(1.2, detail)));
  mesh(
    group,
    new T.PlaneGeometry(64, 80, segments, Math.round(segments * 1.25)),
    floor,
  );
  addDaylight(group,u,Math.round(320*detail));
  return {
    group,
    update(motion, config, reduced) {
      const dt=drive(motion, config, reduced, 0.5 + config.music.speed * 0.2);
      updateReactiveUniforms(u, motion, config.effect, reduced);
      updateDaylight(u,config,motion.volume,dt,u.uDragBands.value.x);
      u.uDepth.value = 0.65 + config.music.fieldHeight * 0.35;
      u.uRange.value = 0.8 + config.music.ambientSpread * 0.2;
    },
  };
}
