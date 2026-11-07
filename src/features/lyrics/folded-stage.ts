import { AdditiveBlending, Color, InstancedBufferAttribute, InstancedMesh, Object3D, PlaneGeometry, ShaderMaterial } from 'three'
import type { LyricPalette } from './lyric-palette'

/** A fixed pool of prismatic sails and angular slivers, driven by the lyric transport. */
export function createFoldedStage(palette: LyricPalette) {
  const count = 36, geometry = new PlaneGeometry(1, 1)
  const fades = new Float32Array(count)
  geometry.setAttribute('fade', new InstancedBufferAttribute(fades, 1))
  const material = new ShaderMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending,
    vertexShader: `attribute float fade; varying vec2 vUv; varying vec3 vColor; varying float vFade;
      void main(){vUv=uv;vColor=instanceColor;vFade=fade;
        gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec2 vUv;varying vec3 vColor;varying float vFade;
      void main(){vec2 p=vUv;float cut=smoothstep(.0,.025,p.x-p.y*.28)*(1.-smoothstep(.975,1.,p.x-p.y*.28+.28));
        float tip=pow(max(0.,1.-abs(p.x*2.-1.)),.45);float edge=pow(max(0.,1.-abs(p.y*2.-1.)),2.);
        float crease=exp(-abs(p.y-.48)*55.)*.8;float a=(edge*.38+crease)*tip*cut*vFade;
        gl_FragColor=vec4(vColor,a);
        #include <colorspace_fragment>
      }` })
  const mesh = new InstancedMesh(geometry, material, count)
  mesh.frustumCulled = false; mesh.renderOrder = -2
  const color = new Color()
  const setPalette = (palette: LyricPalette) => {
    for (let i = 0; i < count; i++) mesh.setColorAt(i, color.set(palette.prism[i % 3]))
    mesh.instanceColor!.needsUpdate = true
  }
  setPalette(palette)
  const pose = new Object3D()
  return { mesh, setPalette, update(time: number, width: number, height: number, energy: number, visible: boolean, reduced: boolean, variant: number) {
    mesh.visible = visible && !reduced
    if (!mesh.visible) return
    const t = time / 1000, short = height < width * .2
    for (let i = 0; i < count; i++) {
      const seed = (i * .61803398875) % 1, sail = i < 8
      const cycle = (t * (.14 + seed * .08) + seed) % 1
      const spread = (cycle - .5) * 2
      const side = i % 2 ? 1 : -1
      if (sail) {
        pose.position.set(side * width * (.12 + seed * .3) + Math.sin(t * .6 + i) * width * .018,
          Math.sin(i * 2.4 + t * .42) * height * (short ? .22 : .35), -100 - i * 12)
        pose.scale.set(width * (.22 + seed * .18), height * (.08 + seed * .10), 1)
        pose.rotation.set(Math.sin(t * .35 + i) * .3, side * (.35 + Math.sin(t * .3 + i) * .18), side * (.24 + seed * .34) * (short ? .24 : 1) + variant * .04)
        fades[i] = (.32 + energy * .65) * (.6 + .4 * Math.sin(t + i) ** 2)
      } else {
        pose.position.set(spread * width * .49, Math.sin(i * 7.1) * height * .42 + side * energy * height * .12, -25 - seed * 70)
        pose.scale.set((3 + seed * 25) * (1 + energy * .8), 1 + seed * 2.8, 1)
        pose.rotation.set(0, 0, side * (.4 + seed * 1.1) + t * .22)
        fades[i] = Math.sin(cycle * Math.PI) ** 2 * (.18 + energy * .75)
      }
      pose.updateMatrix(); mesh.setMatrixAt(i, pose.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    geometry.attributes.fade.needsUpdate = true
  }, dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); mesh.dispose() } }
}
