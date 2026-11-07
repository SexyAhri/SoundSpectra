import * as T from 'three'

function randomStream(seed = 41871) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
}

const flowers = [[-2.8, -.5, -3, 1.06], [5.8, 2.2, -10, .78], [-9.7, 7.1, -12, .6]]

export function petalGeometry(density: number) {
  const plane = new T.PlaneGeometry(1, 1, 24, 44), geometry = new T.InstancedBufferGeometry()
  geometry.setIndex(plane.getIndex()); geometry.setAttribute('position', plane.getAttribute('position')); geometry.setAttribute('uv', plane.getAttribute('uv'))
  const petals:number[]=[],origins:number[]=[],random=randomStream()
  // Back to front, with fewer, broader petals and distinct bud openings.
  for(let flower=flowers.length-1;flower>=0;flower--)for(let ring=0;ring<(flower===0?4:3);ring++){
    const count=Math.max(5,Math.round((8-ring*.7)*(.9+Math.min(density,1.5)*.15)))
    for(let i=0;i<count;i++){
      petals.push(i/count*Math.PI*2+ring*.43+(random()-.5)*.18,ring,random(),flower)
      origins.push(...flowers[flower])
    }
  }
  geometry.setAttribute('aPetal', new T.InstancedBufferAttribute(new Float32Array(petals), 4))
  geometry.setAttribute('aOrigin', new T.InstancedBufferAttribute(new Float32Array(origins), 4)); geometry.instanceCount = petals.length/4
  plane.dispose()
  return geometry
}

export function petalCoreGeometry() {
  const positions:number[]=[],origins:number[]=[]
  for(let i=0;i<81;i++){
    const angle=i*2.399963, radius=Math.sqrt(i/80)*.34
    positions.push(Math.cos(angle)*radius,Math.sin(angle)*radius,.72+(1.-i/80)*.16+Math.sin(i*1.7)*.025)
    origins.push(...flowers[0])
  }
  return new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(positions,3)).setAttribute('aOrigin',new T.Float32BufferAttribute(origins,4))
}

export function auroraGeometry(density: number) {
  const segments = Math.max(112, Math.round(160 * density)), rows = 24, layers = 3
  const positions: number[] = [], uv: number[] = [], layer: number[] = [], indices: number[] = []
  for (let k = 0; k < layers; k++) {
    const offset = positions.length / 3
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= segments; x++) {
      positions.push(0, 0, 0); uv.push(x / segments, y / rows); layer.push(k)
      if (x < segments && y < rows) {
        const i = offset + y * (segments + 1) + x
        indices.push(i, i + 1, i + segments + 1, i + 1, i + segments + 2, i + segments + 1)
      }
    }
  }
  return new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3))
    .setAttribute('uv', new T.Float32BufferAttribute(uv, 2)).setAttribute('aLayer', new T.Float32BufferAttribute(layer, 1)).setIndex(indices)
}

export function dustGeometry(count: number, trails = false) {
  const random = randomStream(71537), vertices = count * (trails ? 2 : 1)
  const seeds = new Float32Array(vertices * 3), roles = new Float32Array(vertices)
  for (let i = 0; i < count; i++) {
    const seed = [random(), random(), random()]
    for (let j = 0; j < (trails ? 2 : 1); j++) { const index = i * (trails ? 2 : 1) + j; seeds.set(seed, index * 3); roles[index] = j }
  }
  return new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(new Float32Array(vertices * 3), 3))
    .setAttribute('aSeed', new T.BufferAttribute(seeds, 3)).setAttribute('aRole', new T.BufferAttribute(roles, 1))
}
