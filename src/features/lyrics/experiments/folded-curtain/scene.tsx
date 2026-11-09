import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from "three";
import { defaultLyricPalette } from "../../lyric-palette";
import {
  createChoreography,
  duration,
  type Line,
  type Phrase,
  type ScoreClock,
} from "./score";

const font = "500 96px Microsoft YaHei, Segoe UI, sans-serif";
function makePhrase(phrase: Phrase) {
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d")!;
  ctx.font = font;
  const widths = phrase.words.map((w) => ctx.measureText(w.text).width);
  canvas.width = Math.ceil(widths.reduce((a, b) => a + b, 0)) + 24;
  canvas.height = 144;
  ctx.font = font;
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "middle";
  let x = 12;
  const spans = widths.map((width, i) => {
    ctx.fillText(phrase.words[i].text, x, 72);
    const span = new Vector3(x / canvas.width, (x + width) / canvas.width, 0);
    x += width;
    return span;
  });
  while (spans.length < 16) spans.push(new Vector3(2, 2, 0));
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: {
      mask: { value: texture },
      spans: { value: spans },
      opacity: { value: 1 },
      sung: { value: new Color(defaultLyricPalette.sung) },
      unsung: { value: new Color(defaultLyricPalette.unsung) },
    },
    vertexShader:
      "varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
    fragmentShader: `
    uniform sampler2D mask; uniform vec3 spans[16]; uniform vec3 sung; uniform vec3 unsung; uniform float opacity; varying vec2 vUv;
    void main(){float alpha=texture2D(mask,vUv).a; if(alpha<.01)discard; float lit=0.;
      for(int i=0;i<16;i++){vec3 s=spans[i]; float edge=mix(s.x,s.y,s.z);
        if(vUv.x>=s.x && vUv.x<=s.y && s.z>0.)lit=max(lit,1.-smoothstep(edge-.002,edge+.002,vUv.x));}
      gl_FragColor=vec4(mix(unsung,sung,lit),alpha*opacity);
      #include <colorspace_fragment>
    }`,
  });
  const width = canvas.width / 144;
  const geometry = new PlaneGeometry(width, 1);
  geometry.translate(width / 2, 0, 0);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    width,
    spans,
    material,
    dispose() {
      texture.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
export interface FoldDiagnostics {
  frames: number;
  time: number;
  visible: number[];
  poses: number[][];
  resources: number;
  panels: number[][];
  highlighted: number[][];
}
export const diagnostics: FoldDiagnostics = {
  frames: 0,
  time: 0,
  visible: [],
  poses: [],
  resources: 0,
  panels: [],
  highlighted: [],
};
function FoldScene({
  clock,
  lines,
  wordTiming,
  reduced,
}: {
  clock: ScoreClock;
  lines: Line[];
  wordTiming: boolean;
  reduced: boolean;
}) {
  const { invalidate, viewport } = useThree();
  const hidden = useRef(document.hidden);
  const objects = useMemo(
    () =>
      lines.map((line, index) => {
        const group = new Group(),
          phrases = line.phrases.flatMap((p) =>
            p.words.map((word) => makePhrase({ words: [word] })),
          );
        phrases.forEach((p) => group.add(p.mesh));
        return {
          group,
          phrases,
          choreography: createChoreography(line, lines[index + 1]?.start),
          line,
        };
      }),
    [lines],
  );
  useEffect(() => {
    diagnostics.resources = objects.reduce((n, o) => n + o.phrases.length, 0);
    return () => {
      objects.forEach((o) => {
        o.choreography.dispose();
        o.phrases.forEach((p) => p.dispose());
      });
      diagnostics.resources = 0;
    };
  }, [objects]);
  useEffect(() => {
    const unsub = clock.subscribe(invalidate);
    const visibility = () => {
      hidden.current = document.hidden;
      if (!hidden.current) invalidate();
    };
    document.addEventListener("visibilitychange", visibility);
    invalidate();
    return () => {
      unsub();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clock, invalidate]);
  useFrame(() => {
    if (hidden.current) return;
    const time = clock.lyricTime();
    diagnostics.frames++;
    diagnostics.time = time;
    diagnostics.visible = [];
    diagnostics.poses = [];
    diagnostics.panels = [];
    diagnostics.highlighted = [];
    const narrow = viewport.width < 8;
    objects.forEach(({ group, phrases, choreography, line }, index) => {
      const { enter, exit } = choreography.evaluate(time);
      const visible =
        time >= line.start - choreography.lead &&
        time < line.end + choreography.tail;
      group.visible = visible;
      if (!visible) return;
      diagnostics.visible.push(index);
      diagnostics.poses.push([enter, exit]);
      let offset = 0;
      const rows = line.phrases.map((p) => {
        const row = phrases.slice(offset, offset + p.words.length);
        offset += p.words.length;
        return row;
      });
      const rowWidths = rows.map(
        (row) => row.reduce((n, p) => n + p.width, 0) + 0.3 * (row.length - 1),
      );
      const scale = Math.min(
        narrow ? 0.82 : 1.2,
        (viewport.width * 0.78) / (Math.max(...rowWidths) + 0.6),
        (viewport.height * 0.48) / (rows.length * 1.3),
      );
      group.scale.setScalar(scale);
      const previousEnd =
        lines[index - 1]?.end ?? line.start - choreography.lead;
      const settleStart = Math.max(
        line.start - choreography.lead,
        Math.min(previousEnd, line.start - 180),
      );
      const settle = Math.max(
        0,
        Math.min(1, (time - settleStart) / (line.start - settleStart)),
      );
      const smoothSettle = settle * settle * (3 - 2 * settle);
      const fold = reduced
        ? 0
        : Math.max(1 - enter, 0.65 * (1 - smoothSettle)) + exit;
      group.position.set(
        0,
        reduced ? 0 : (1 - smoothSettle) * -2.7 + exit * 2.7,
        reduced ? 0 : -1.8 * (1 - enter) - exit * 3,
      );
      group.rotation.set(
        0,
        reduced ? 0 : exit * 0.5,
        reduced ? 0 : exit * -0.07,
      );
      const highlighted: number[] = [];
      let phraseIndex = 0;
      rows.forEach((row, r) => {
        let x = -Math.max(...rowWidths) / 2 + (r % 2 ? 0.6 : 0),
          z = 0;
        row.forEach((p) => {
          const angle = fold * (phraseIndex % 2 ? -1 : 1) * 1.15;
          p.mesh.position.set(x, (rows.length - 1) * 0.65 - r * 1.3, z);
          p.mesh.rotation.y = angle;
          x += Math.cos(angle) * p.width + 0.13;
          z -= Math.sin(angle) * p.width;
          p.material.uniforms.opacity.value = reduced
            ? time >= line.start && time < line.end
              ? 1
              : 0
            : Math.min(1, enter * 1.5) *
              (0.22 + 0.78 * smoothSettle) *
              Math.pow(1 - exit, 2);
          const word = line.phrases.flatMap((p) => p.words)[phraseIndex];
          p.spans[0].z =
            time >=
            (wordTiming && word.start !== undefined && word.end !== undefined
              ? word.start
              : line.start)
              ? 1
              : 0;
          highlighted.push(p.spans[0].z);
          diagnostics.panels.push([
            index,
            ...p.mesh.position.toArray(),
            angle,
            p.material.uniforms.opacity.value,
            ...group.position.toArray(),
            scale,
          ]);
          phraseIndex++;
        });
      });
      diagnostics.highlighted.push(highlighted);
    });
    if (clock.playing && clock.read() < duration) invalidate();
  });
  return (
    <>
      {objects.map((o, i) => (
        <primitive key={i} object={o.group} />
      ))}
    </>
  );
}
export function FoldedCurtain(props: {
  clock: ScoreClock;
  lines: Line[];
  wordTiming: boolean;
  reduced: boolean;
}) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [0, 0, 12], fov: 38 }}
      gl={{ alpha: true, antialias: true }}
    >
      <FoldScene {...props} />
    </Canvas>
  );
}
