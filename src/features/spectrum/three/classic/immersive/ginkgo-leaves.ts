import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  commonUniforms,
  flowDriver,
  material,
  mesh,
  randomStream,
  surfaceGeometry,
  uniformSource,
  type FlowEffect,
} from "../flow/shared";
import {
  reactiveUniforms,
  reactiveSource,
  updateReactiveUniforms,
} from "../../reactive-motion";
import {
  addDaylight,
  daylightSource,
  daylightUniforms,
  updateDaylight,
} from "./daylight-field";

interface Crown {
  center: T.Vector3;
  radius: T.Vector3;
  weight: number;
}

/** Broad, low boughs support an uneven crown; foliage grows along the wood. */
function treeGeometry() {
  const random = randomStream(68129),
    parts: T.BufferGeometry[] = [],
    crowns: Crown[] = [];
  const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  const branch = (
    points: T.Vector3[],
    radius: number,
    endRadius: number,
    segments = 12,
    sides = 6,
  ) => {
    const path = new T.CatmullRomCurve3(points),
      g = new T.TubeGeometry(path, segments, 1, sides, false);
    const p = g.getAttribute("position"),
      uv = g.getAttribute("uv"),
      offset = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      const t = uv.getX(i),
        center = path.getPoint(t),
        width = endRadius + (radius - endRadius) * Math.pow(1 - t, 1.3);
      offset
        .fromBufferAttribute(p, i)
        .sub(center)
        .multiplyScalar(width)
        .add(center);
      p.setXYZ(i, offset.x, offset.y, offset.z);
    }
    g.computeVertexNormals();
    parts.push(g);
    return path;
  };
  const trunk = branch(
    [
      v(0, -11, 0),
      v(-0.5, -8, 0.1),
      v(-0.65, -5, 0.2),
      v(0.15, -1, -0.2),
      v(0.9, 3, -0.3),
      v(0.2, 8, -0.5),
    ],
    1.2,
    0.12,
    30,
    12,
  );
  const leftBough = branch(
    [
      v(-0.6, -5.7, 0.1),
      v(-2, -3.3, 0.2),
      v(-4, -1, 0.1),
      v(-6, 2.2, -0.1),
      v(-7.4, 6, -0.2),
    ],
    0.66,
    0.07,
    20,
    9,
  );
  const rightBough = branch(
    [
      v(-0.5, -5, 0.1),
      v(1.7, -3, 0.3),
      v(4, -1, 0.6),
      v(6.2, 2.3, 0.6),
      v(8.8, 5.8, 0.2),
    ],
    0.63,
    0.07,
    20,
    9,
  );
  // The lower limbs sweep out before turning upward. Avoid a bouquet of
  // straight, equally thin branches meeting at one point.
  const limbs = [
    [-10.2, 1.6, 1.1],
    [-11, 5, -0.8],
    [-7.6, 8.1, 0.3],
    [-4.4, 10.5, -0.8],
    [-1.5, 12.2, 0],
    [4.2, 9.4, -1.2],
    [8.5, 7.7, 0.6],
    [11.8, 3.8, -0.6],
    [9.5, 1.4, 1.2],
    [-5.6, 4, -3.2],
    [2.5, 6, -3.9],
    [5.5, 2.8, 3.3],
    [-4, 3.1, 3.4],
    [-3.2, 6.4, 1.8],
    [1.5, 7.6, 2.4],
    [4.8, 5.4, 1.8],
    [0, 3.2, 2.8],
  ];
  limbs.forEach(([x, y, z], i) => {
    const support = x < -3 ? leftBough : x > 3 ? rightBough : trunk;
    const root = support.getPoint(0.34 + (i % 4) * 0.13),
      end = v(x, y, z);
    const bend = root.clone().lerp(end, 0.53);
    bend.y -= 1.1;
    bend.z += 0.45;
    const main = branch([root, bend, end], 0.18 + (i % 3) * 0.04, 0.035, 16, 7);
    for (let j = 0; j < 3; j++) {
      const start = main.getPoint(0.56 + j * 0.18);
      const tip = end
        .clone()
        .add(
          v(
            (j - 1) * 1.8 + (random() - 0.5) * 0.8,
            (j === 1 ? 1.5 : -0.15) + random() * 0.7,
            (j - 1) * 1.2,
          ),
        );
      const mid = start.clone().lerp(tip, 0.5);
      mid.y += 0.3;
      branch([start, mid, tip], 0.1, 0.012, 7, 4);
      const mass = 0.64 + random() * 0.68;
      crowns.push({
        center: tip,
        radius: v(
          (1.65 + random() * 1.1) * mass,
          1.15 + random() * 1.35,
          (1.3 + random() * 0.9) * mass,
        ),
        weight: mass * mass,
      });
      for (let k = 0; k < 2; k++) {
        const r = 0.55 + k * 0.25,
          twig = mid.clone().lerp(tip, r),
          finish = twig
            .clone()
            .add(
              v(
                (random() - 0.5) * 1.5,
                0.65 + random() * 0.6,
                (random() - 0.5) * 1.4,
              ),
            );
        branch([twig, finish], 0.025, 0.004, 3, 3);
      }
    }
  });
  // A spreading root flare anchors the trunk without a visible stage or disc.
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7;
    branch(
      [
        v(0, -9.8, 0),
        v(Math.cos(a) * 0.9, -10.7, Math.sin(a) * 0.7),
        v(Math.cos(a) * 2.4, -11.05, Math.sin(a) * 1.7),
      ],
      0.32,
      0.015,
      7,
      5,
    );
  }
  const geometry = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return { geometry, crowns };
}

const treeWind = `${reactiveSource}
vec3 bendTree(vec3 p){
  float height=clamp((p.y+12.)/26.,0.,1.);
  float gust=musicFront(clamp((p.x+15.)/30.,0.,1.),.45,.13);
  float force=(.08+uDragBands.y*.38+uBodyBands.x*.28+gust*.24)*uDepth;
  p.x+=sin(uPhase*.6+p.y*.12)*height*height*force;
  p.z+=cos(uPhase*.38+p.x*.08)*height*height*force*.5;
  p.x*=uRange;return p;
}
`;
const flight = `${treeWind}
attribute vec4 aAnchor,aSeed;attribute float aGround,aCanopyLight;
vec3 autumnWind(vec3 p,float id){
  float cycle=fract(aSeed.z+uPhase*(.013+aSeed.y*.01)+uDrift.x*.035);
  float fallingLeaf=1.-step(.12,aSeed.w);
  float fall=max(0.,(cycle-.78)/.22)*(1.-aGround)*fallingLeaf;
  float gust=musicFront(aSeed.x,.45,.13);
  float flutter=sin(uPhase*1.4+aSeed.y*6.283)*(.06+uDragBands.y*.2+gust*.18)*uDepth;
  float settle=max(aGround,1.-smoothstep(-11.02,-10.4,aAnchor.y-fall*fall*32.));
  float tumble=(aSeed.x-.5)*2.3+flutter+fall*(4.+aSeed.x*5.);
  float turn=3.14159+(aSeed.y-.5)*2.8+flutter*.7+sin(fall*5.)*fall;
  tumble=mix(tumble,1.5707963,settle);
  p.y+=3.35;
  p.yz=mat2(cos(tumble),-sin(tumble),sin(tumble),cos(tumble))*p.yz;
  if(settle>.5)p.xz=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p.xz;
  else p.xy=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p.xy;
  float growth=aGround>.5||fallingLeaf<.5?1.:smoothstep(0.,.025,cycle)*(1.-smoothstep(.97,1.,cycle));
  p*=aAnchor.w*growth;
  vec3 center=aAnchor.xyz;
  center.y=max(-11.02,center.y-fall*fall*32.);
  center.x+=sin(fall*6.+aSeed.x*6.)*fall*(2.+uDragBands.y*3.);
  center.z+=fall*fall*7.+sin(fall*5.+aSeed.y)*fall*2.;
  return bendTree(center+p);
}
vec3 bladePoint(float radius,float angle,float id){
  float outline=3.8*(.92+.08*cos(angle*2.));
  outline-=.67*exp(-angle*angle/.012);
  outline+=sin(angle*37.)*.036+sin(angle*73.+1.2)*.018;
  vec3 p=vec3(sin(angle)*outline*radius,cos(angle)*outline*radius-1.25,0.);
  p.z=sin(angle*1.7)*radius*radius*.38+pow(radius,3.)*.25;
  p.z+=sin(angle*3.+uPhase*2.+id)*pow(radius,3.)*(.06+uBodyBands.z*.12)*uDepth;
  return autumnWind(p,id);
}
`;
const vertex = `${uniformSource}${flight}${daylightSource}
attribute float aLane;varying vec3 vWorld;varying vec2 vLeaf;varying float vId,vDepthLight,vSunlight;
void main(){
  float angle=(uv.y-.5)*2.58,radius=uv.x;
  vec3 p=bladePoint(radius,angle,aLane);
  vWorld=(modelMatrix*vec4(p,1.)).xyz;vLeaf=vec2(radius,angle);vId=aLane;
  vDepthLight=aCanopyLight;
  vSunlight=daylightAt(p);
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`;
const fragment = `${uniformSource}
varying vec3 vWorld;varying vec2 vLeaf;varying float vId,vDepthLight,vSunlight;
void main(){
  float r=vLeaf.x,a=vLeaf.y;
  vec3 n=cross(dFdx(vWorld),dFdy(vWorld));n/=max(length(n),.000001);
  vec3 eye=normalize(cameraPosition-vWorld),light=normalize(vec3(-.5,.7,1.));
  float facing=abs(dot(n,eye));
  float ray=abs(sin(a*34.+sin(r*3.+a*2.)*.15))*max(.01,r)*3.5/34.;
  float vein=(1.-smoothstep(.006,.012+fwidth(ray),ray))*smoothstep(.02,.18,r);
  float branchRay=abs(sin(a*68.+r*.45))*r*3.5/68.;
  float branches=(1.-smoothstep(.003,.007+fwidth(branchRay),branchRay))*smoothstep(.45,.85,r)*.38;
  float mottled=sin(a*14.+r*11.)*sin(a*31.-r*19.)*.025;
  float age=clamp(r*.65+sin(a*4.+vId)*.12,0.,1.);
  vec3 base=mix(uColor,uAccent,clamp(age*.42+.16*sin(vId*2.4),0.,.62));
  base=mix(base,uHighlight,vein*.13+branches*.1);
  base*=1.-vein*.12-branches*.08;
  float margin=smoothstep(.97,.998,r);
  base=mix(base,uAccent*.66,margin*.55);
  // A shared upper light distinguishes leaf planes; shade retains the crown
  // masses while the scattered sunlight picks out their thin outer margins.
  float diffuse=.55+.45*abs(dot(n,light));
  float translucency=pow(clamp(1.-facing,0.,1.),2.)*.17;
  vec3 color=(base*(diffuse+mottled)+uHighlight*translucency*(.5+vSunlight*2.))*vDepthLight*(.88+vSunlight*.46);
  color+=uHighlight*vSunlight*.055*(1.-vein*.4);
  gl_FragColor=vec4(color,1.);
}`;
const barkVertex = `${uniformSource}${treeWind}
varying vec3 vWorld,vNormal;varying vec2 vBark;
void main(){vec3 p=bendTree(position);vWorld=(modelMatrix*vec4(p,1.)).xyz;vNormal=mat3(modelMatrix)*normal;vBark=uv;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`;
const barkFragment = `${uniformSource}
varying vec3 vWorld,vNormal;varying vec2 vBark;
void main(){
  vec3 n=normalize(vNormal),light=normalize(vec3(-.5,.7,1.)),eye=normalize(cameraPosition-vWorld);
  float grain=sin(vBark.y*113.+sin(vBark.x*42.))*sin(vBark.y*51.-vBark.x*7.);
  float diffuse=.38+.62*max(0.,dot(n,light));
  float rim=pow(clamp(1.-abs(dot(n,eye)),0.,1.),3.);
  vec3 base=mix(uShade*.65,uAccent*.32,.5+grain*.12);
  gl_FragColor=vec4(base*diffuse+uAccent*rim*.07,1.);
}`;
export function createGinkgoLeaves(detail: number): FlowEffect {
  const group = new T.Group();
  group.name = "musical-autumn-ginkgo-tree";
  const u = {
      ...commonUniforms(),
      ...reactiveUniforms(),
      ...daylightUniforms("ginkgo"),
    },
    drive = flowDriver(u);
  const tree = treeGeometry(),
    bark = material(u, barkVertex, barkFragment);
  bark.transparent = false;
  mesh(group, tree.geometry, bark).name = "ginkgo-trunk-and-branches";
  const random = randomStream(71381),
    eco = detail < 0.8,
    canopy = eco ? 5000 : 7800,
    ground = 170,
    count = canopy + ground;
  const anchors: number[] = [],
    seeds: number[] = [],
    modes: number[] = [],
    lights: number[] = [];
  const crownWeights: number[] = [];
  let totalWeight = 0;
  for (const crown of tree.crowns) {
    totalWeight += crown.weight;
    crownWeights.push(totalWeight);
  }
  for (let i = 0; i < count; i++) {
    const onGround = i >= canopy,
      pick = random() * totalWeight;
    const crownIndex = crownWeights.findIndex((weight) => pick < weight),
      crown = tree.crowns[crownIndex];
    const azimuth = random() * Math.PI * 2,
      vertical = random() * 2 - 1;
    // Distribute leaves through each lobe, with an irregular outer silhouette.
    const r = Math.pow(random(), 0.48),
      ring = Math.sqrt(1 - vertical * vertical);
    const nx = Math.cos(azimuth) * ring,
      ny = vertical,
      nz = Math.sin(azimuth) * ring;
    // Lobed growth follows each twig. Stable, differently sized masses leave
    // branch windows rather than forming identical spherical clumps.
    const edge =
      0.84 +
      0.13 * Math.sin(azimuth * 3 + crownIndex * 1.7) +
      0.09 * Math.cos(vertical * 5 + azimuth * 2);
    const x = crown.center.x + nx * r * crown.radius.x * edge,
      y = crown.center.y + ny * r * crown.radius.y * edge,
      z = crown.center.z + nz * r * crown.radius.z;
    const ga = random() * Math.PI * 2,
      gr = Math.pow(random(), 0.65) * 10.5;
    anchors.push(
      onGround ? Math.cos(ga) * gr : x,
      onGround ? -11.03 : y,
      onGround ? Math.sin(ga) * gr * 0.42 + 1 : z,
      onGround ? 0.07 + random() * 0.065 : 0.067 + random() * 0.065,
    );
    seeds.push(random(), random(), random(), random());
    modes.push(onGround ? 1 : 0);
    const sun = Math.max(0, -nx * 0.45 + ny * 0.65 + nz * 0.5);
    // Local volume shadow and a shared upper-left light retain large crown
    // masses at thumbnail size, rather than evenly lit golden confetti.
    lights.push(
      onGround
        ? 0.45 + random() * 0.22
        : 0.19 +
            sun * 0.58 +
            Math.max(0, ny) * 0.13 +
            (z + 5) * 0.014 +
            r * 0.14 +
            random() * 0.06,
    );
  }
  const decorate = (g: T.InstancedBufferGeometry) => {
    g.setAttribute(
      "aAnchor",
      new T.InstancedBufferAttribute(new Float32Array(anchors), 4),
    );
    g.setAttribute(
      "aSeed",
      new T.InstancedBufferAttribute(new Float32Array(seeds), 4),
    );
    g.setAttribute(
      "aGround",
      new T.InstancedBufferAttribute(new Float32Array(modes), 1),
    );
    g.setAttribute(
      "aCanopyLight",
      new T.InstancedBufferAttribute(new Float32Array(lights), 1),
    );
    return g;
  };
  const blade = material(u, vertex, fragment);
  blade.transparent = false;
  mesh(group, decorate(surfaceGeometry(1, eco ? 8 : 12, count)), blade).name =
    "ginkgo-canopy-and-falling-leaves";
  addDaylight(group, u, Math.round(150 * detail));
  return {
    group,
    update(motion, config, reduced) {
      const dt = drive(
        motion,
        config,
        reduced,
        0.6 + config.music.speed * 0.22,
      );
      updateReactiveUniforms(u, motion, config.effect, reduced);
      updateDaylight(u, config, motion.volume, dt, u.uDragBands.value.x);
      u.uDepth.value = config.music.fieldHeight;
      u.uRange.value = 0.8 + config.music.ambientSpread * 0.2;
    },
  };
}
