import * as T from 'three'

function randomStream(seed = 41871) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
}

export function petalGeometry(density: number) {
  const plane = new T.PlaneGeometry(1, 1, 14, 28), geometry = new T.InstancedBufferGeometry()
  geometry.setIndex(plane.getIndex()); geometry.setAttribute('position', plane.getAttribute('position')); geometry.setAttribute('uv', plane.getAttribute('uv'))
  const flowers = [[-3.6, .2, -3, 1.45], [5.6, -1.6, -7, .95], [6.7, 4.5, -15, .5]]
  const perRing = Math.round(9 + density * 3), count = flowers.length * perRing * 3
  const petals = new Float32Array(count * 4), origins = new Float32Array(count * 4), random = randomStream()
  for (let i = 0; i < count; i++) {
    const flower = Math.floor(i / (perRing * 3)), ring = Math.floor(i / perRing) % 3
    petals.set([(i % perRing) / perRing * Math.PI * 2 + ring * .19, ring, random(), flower], i * 4)
    origins.set(flowers[flower], i * 4)
  }
  geometry.setAttribute('aPetal', new T.InstancedBufferAttribute(petals, 4))
  geometry.setAttribute('aOrigin', new T.InstancedBufferAttribute(origins, 4)); geometry.instanceCount = count
  plane.dispose()
  return geometry
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
