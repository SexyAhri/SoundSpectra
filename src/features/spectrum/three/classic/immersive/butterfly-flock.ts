import * as T from "three";
import {
  commonUniforms,
  flowDriver,
  material,
  mesh,
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

/** Clip the contour triangles against a regular lattice. Long, thin fans from
 * ear clipping otherwise interpolate the dark wing edge across the hinge. */
function clipWingCell(
  input: T.Vector3[],
  axis: "x" | "y",
  bound: number,
  keepAbove: boolean,
) {
  const out: T.Vector3[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i],
      b = input[(i + 1) % input.length];
    const insideA = keepAbove ? a[axis] >= bound : a[axis] <= bound,
      insideB = keepAbove ? b[axis] >= bound : b[axis] <= bound;
    if (insideA) out.push(a);
    if (insideA !== insideB)
      out.push(a.clone().lerp(b, (bound - a[axis]) / (b[axis] - a[axis])));
  }
  return out;
}

/** Authored fore/hind contours meet at a short thoracic hinge. */
export function butterflyWingGeometry() {
  const fore = new T.Shape();
  fore.moveTo(0.09, 0.35);
  fore.bezierCurveTo(0.55, 1, 2.85, 4.15, 4.25, 3.8);
  fore.bezierCurveTo(5.1, 3.35, 4.8, 1.4, 3.9, 0.45);
  fore.bezierCurveTo(3.3, -0.12, 2, -0.35, 1.25, -0.05);
  fore.bezierCurveTo(0.72, -0.15, 0.22, 0.02, 0.09, 0.35);
  const hind = new T.Shape();
  hind.moveTo(0.12, 0.35);
  hind.bezierCurveTo(0.8, 0.48, 2.2, 0.7, 2.94, 0.15);
  hind.bezierCurveTo(3.35, -0.2, 3.1, -0.82, 2.68, -1.02);
  hind.bezierCurveTo(2.9, -1.55, 2.42, -1.85, 2.02, -1.75);
  hind.bezierCurveTo(1.95, -2.3, 1.42, -2.55, 1.1, -2.16);
  hind.bezierCurveTo(0.6, -2.32, 0.12, -1.25, 0.12, 0.35);
  const positions: number[] = [],
    uvs: number[] = [],
    lanes: number[] = [],
    edges: number[] = [];
  for (let part = 0; part < 4; part++) {
    const shape = part % 2 ? hind : fore,
      outline = shape.getPoints(16);
    const base = new T.ShapeGeometry(shape, 16),
      plain = base.toNonIndexed(),
      p = plain.getAttribute("position");
    const edgeDistance = (x: number, y: number) => {
      let distance = Infinity;
      for (let i = 0; i < outline.length - 1; i++) {
        const a = outline[i],
          b = outline[i + 1],
          dx = b.x - a.x,
          dy = b.y - a.y;
        const t = T.MathUtils.clamp(
          ((x - a.x) * dx + (y - a.y) * dy) / Math.max(1e-8, dx * dx + dy * dy),
          0,
          1,
        );
        distance = Math.min(
          distance,
          Math.hypot(x - a.x - dx * t, y - a.y - dy * t),
        );
      }
      return distance;
    };
    for (let triangle = 0; triangle < p.count; triangle += 3) {
      const a = new T.Vector3().fromBufferAttribute(p, triangle),
        b = new T.Vector3().fromBufferAttribute(p, triangle + 1),
        c = new T.Vector3().fromBufferAttribute(p, triangle + 2);
      const add = (v: T.Vector3) => {
        positions.push(v.x, v.y, v.z);
        uvs.push(v.x / 4.9, (v.y + 2.55) / 6.7);
        lanes.push(part);
        edges.push(edgeDistance(v.x, v.y));
      };
      const spacing = 0.36;
      const minX = Math.floor(Math.min(a.x, b.x, c.x) / spacing),
        maxX = Math.floor(Math.max(a.x, b.x, c.x) / spacing);
      const minY = Math.floor(Math.min(a.y, b.y, c.y) / spacing),
        maxY = Math.floor(Math.max(a.y, b.y, c.y) / spacing);
      for (let x = minX; x <= maxX; x++)
        for (let y = minY; y <= maxY; y++) {
          let polygon = [a, b, c];
          for (const [axis, bound, above] of [
            ["x", x * spacing, true],
            ["x", (x + 1) * spacing, false],
            ["y", y * spacing, true],
            ["y", (y + 1) * spacing, false],
          ] as const)
            polygon = clipWingCell(polygon, axis, bound, above);
          for (let i = 1; i < polygon.length - 1; i++) {
            const area = new T.Vector3()
              .subVectors(polygon[i], polygon[0])
              .cross(new T.Vector3().subVectors(polygon[i + 1], polygon[0]))
              .lengthSq();
            if (area > 1e-14) {
              add(polygon[0]);
              add(polygon[i]);
              add(polygon[i + 1]);
            }
          }
        }
    }
    plain.dispose();
    base.dispose();
  }
  const g = new T.InstancedBufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  g.setAttribute("aPart", new T.Float32BufferAttribute(lanes, 1));
  g.setAttribute("aEdge", new T.Float32BufferAttribute(edges, 1));
  g.setAttribute(
    "aInsect",
    new T.InstancedBufferAttribute(
      Float32Array.from({ length: 7 }, (_, i) => i),
      1,
    ),
  );
  g.instanceCount = 7;
  return g;
}
const flight = `${reactiveSource}
vec3 butterflyFlight(vec3 p,float id){
  float q=uPhase*.27-id*.62;
  float local=musicFront(fract(id*.173),.45,.12);
  float heading=atan(cos(q*1.7)*4.25,cos(q)*6.);
  float yaw=sin(q*.9+id*.35)*.38+local*.22;
  float bank=heading-1.5707963+sin(q*.7+id)*.12;
  p.xz=mat2(cos(yaw),-sin(yaw),sin(yaw),cos(yaw))*p.xz;
  p.xy=mat2(cos(bank),sin(bank),-sin(bank),cos(bank))*p.xy;
  float size=id<.5?1.55:id<2.5?.72:.33+fract(id*.37)*.16;
  vec3 center=vec3(-2.+sin(q)*6.,sin(q*1.7)*2.5,2.+cos(q*.8)*1.8-id*3.3);
  if(id>.5)center.xy+=vec2(sin(id*2.4)*4.,cos(id*1.7)*3.);
  center.xy*=uRange*(1.+uBodyBands.y*.1);
  center.y+=sin(uPhase*4.4+id)*.1*uBodyBands.x+local*.55;
  return center+p*size;
}
`;
const wingVertex = `${uniformSource}${flight}
attribute float aPart,aEdge,aInsect;
varying vec3 vWorld,vWing,vNormal;varying float vEdge,vHind;
vec3 flapPoint(vec3 source,float side,float hind){
  float beat=uPhase*4.4+uDrift.x*.8+aInsect*1.2-hind*.1;
  float glide=smoothstep(.55,.9,sin(uPhase*.65+aInsect*.9));
  float flap=.16+sin(beat)*(.42+uBodyBands.x*.26)*(1.-glide*.78)*uDepth;
  float lag=sin(beat-.4)*pow(source.x/4.9,2.)*.18;
  vec3 p=source;
  p.z=source.x*source.x*.025+sin(source.y*1.6)*source.x*.025+(hind<.5?.14:-.14);
  p.x=source.x*cos(flap+lag)*side;
  p.z+=source.x*sin(flap+lag);
  return butterflyFlight(p,aInsect);
}
void main(){
  float side=aPart<2.?-1.:1.,hind=mod(aPart,2.);
  vec3 p=flapPoint(position,side,hind);
  vec3 dx=flapPoint(position+vec3(.01,0.,0.),side,hind)-p;
  vec3 dy=flapPoint(position+vec3(0.,.01,0.),side,hind)-p;
  vNormal=mat3(modelMatrix)*normalize(cross(dx,dy));
  vWorld=(modelMatrix*vec4(p,1.)).xyz;vWing=position;vEdge=aEdge;vHind=hind;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`;
const wingFragment = `${uniformSource}
varying vec3 vWorld,vWing,vNormal;varying float vEdge,vHind;
void main(){
  vec3 n=vNormal/max(length(vNormal),.00001);
  vec3 view=normalize(cameraPosition-vWorld);
  float facing=abs(dot(n,view));
  vec2 root=vWing.xy-vec2(.1,.35);float r=length(root),angle=atan(root.y,root.x);
  float line=abs(sin(angle*10.5+r*.16))*r/10.5,aa=max(.002,fwidth(line));
  float veins=(1.-smoothstep(.006,.012+aa,line))*smoothstep(.4,.85,r);
  float branches=(1.-smoothstep(.02,.06+fwidth(r)*3.,abs(sin(r*5.7+angle*.7))))*.1;
  float border=(1.-smoothstep(.055,.2,vEdge))*smoothstep(.55,1.35,r);
  float fleckDistance=(vEdge-.17)/.055;
  float flecks=pow(max(0.,cos(angle*58.+r*1.3)),12.)*exp(-fleckDistance*fleckDistance);
  float scalePhase=vWing.x*165.+vWing.y*47.;
  float scales=sin(scalePhase)*sin(vWing.y*128.)*.055;
  scales*=exp(-pow(max(fwidth(scalePhase),fwidth(vWing.y*128.))*.5,2.));
  vec3 light=normalize(vec3(-.55,.65,1.));
  vec3 halfLight=normalize(view+light);
  float sheen=pow(abs(dot(n,halfLight)),12.);
  float cells=.5+.5*sin(angle*10.5+r*.16);
  float velvet=.64+.36*smoothstep(.12,.88,cells);
  float outer=smoothstep(.35,3.6,r);
  vec3 blue=mix(uColor*.42,uColor*1.05,outer);
  // Structural color follows the actual wing normal through the stroke.
  float iridescence=pow(.5+.5*cos(facing*7.2+r*.12),2.);
  blue=mix(blue,uAccent,(.10+iridescence*.28)*(1.-facing*.65)*outer);
  blue=mix(blue,uHighlight,sheen*(.12+outer*.18)*velvet);
  vec3 color=blue*(.53+abs(dot(n,light))*.37+scales)*velvet*(1.-veins*.63)*(1.-branches);
  color*=1.-vHind*.14;
  color=mix(color,uShade*.22,border*.98);
  color+=uHighlight*flecks*(.30+uAccents.z*.15)+uColor*sheen*.16*(1.-border);
  gl_FragColor=vec4(color,1.);
}`;
const bodyVertex = surfaceVertex(
  `
  float id=floor(lane/5.),kind=mod(lane,5.);
  float r=kind<.5?.17:kind<1.5?.24:kind<2.5?.14:.095;
  float center=kind<.5?1.12:kind<1.5?.47:kind<2.5?-.85:1.15;
  float extent=kind<.5?.38:kind<1.5?.85:kind<2.5?2.05:.18;
  p=vec3(cos(a)*sin(t*PI)*r,center+(t-.5)*extent,sin(a)*sin(t*PI)*r+.19);
  if(kind>2.5)p+=vec3(kind<3.5?-.14:.14,0.,.07);
  p=butterflyFlight(p,id);
`,
  flight,
);
const antennaVertex = surfaceVertex(
  `
  float id=floor(lane/2.),side=mod(lane,2.)*2.-1.;
  vec3 center=vec3(side*(.07+t*.43),1.24+t*.95,.18+sin(t*PI)*.12);
  float r=.013+pow(t,18.)*.03;
  p=center+vec3(cos(a)*r,0.,sin(a)*r);
  p=butterflyFlight(p,id);
`,
  flight,
);
const bodyFragment = `${uniformSource}
varying vec3 vWorld;varying vec2 vUv;varying float vLane,vAlpha,vLight;
void main(){
  vec3 n=cross(dFdx(vWorld),dFdy(vWorld));n/=max(length(n),.00001);
  vec3 view=normalize(cameraPosition-vWorld),light=normalize(vec3(-.5,.8,1.));
  float shine=pow(max(0.,dot(n,normalize(view+light))),28.);
  vec3 color=mix(uShade*.25,uColor*.12,.4)+uHighlight*shine*.16;
  gl_FragColor=vec4(color,1.);
}`;
export function createButterflyFlock(_detail: number): FlowEffect {
  const group = new T.Group();
  group.name = "anatomical-morpho-flock";
  const u = { ...commonUniforms(), ...reactiveUniforms() },
    drive = flowDriver(u);
  const wings = material(u, wingVertex, wingFragment);
  wings.transparent = false;
  mesh(group, butterflyWingGeometry(), wings);
  mesh(
    group,
    surfaceGeometry(20, 8, 7 * 5),
    material(u, bodyVertex, bodyFragment),
  ).name = "butterfly-body";
  mesh(
    group,
    surfaceGeometry(18, 5, 7 * 2),
    material(u, antennaVertex, bodyFragment),
  );
  return {
    group,
    update(motion, config, reduced) {
      drive(motion, config, reduced, 0.65 + config.music.speed * 0.25);
      updateReactiveUniforms(u, motion, "butterfly_flock", reduced);
      u.uRange.value = config.music.ambientSpread;
      u.uDepth.value = config.music.fieldHeight;
    },
  };
}
