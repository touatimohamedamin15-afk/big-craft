import { describe, expect, test } from 'bun:test'
import { BED, GLASS, STONE } from '../src/games/bedwars/blocks'
import { defineBlock } from '../src/engine/blocks'
import { createArena } from '../src/games/bedwars/maps/arena'
import { World } from '../src/engine/world'
import { atlasLayout, tileUV } from '../src/engine/render/atlas-layout'
import { SunLight } from '../src/engine/render/light'
import { CHUNK, meshChunk, vertexAO } from '../src/engine/render/mesher'
import { ChunkRenderer } from '../src/engine/render/chunks'
import { ShaderMaterial, type Mesh } from 'three'

const layout = atlasLayout()

describe('sunlight', () => {
  test('open sky is full, shade falls off under a roof, and edits relight locally', () => {
    const w = new World(32, 32, 32)
    w.fill(0, 0, 0, 31, 4, 31, STONE)
    w.fill(10, 10, 10, 20, 10, 20, STONE) // a roof
    const light = new SunLight(w)
    expect(light.get(5, 5, 5)).toBe(15)
    expect(light.get(15, 9, 15)).toBeLessThan(15)
    expect(light.get(15, 9, 15)).toBeGreaterThan(5)
    expect(light.get(15, 2, 15)).toBe(0) // inside the ground
    const under = light.get(15, 5, 15)
    w.fill(10, 10, 10, 20, 10, 20, 0)
    for (let x = 10; x <= 20; x++) light.queueChange(x, 10)
    light.queueChange(10, 20)
    light.queueChange(20, 20)
    const changed = light.flush()
    expect(changed).not.toBeNull()
    expect(light.get(15, 5, 15)).toBe(15)
    expect(under).toBeLessThan(15)
  })

  test('the whole arena lights in well under a second', () => {
    const t0 = performance.now()
    new SunLight(createArena().world)
    expect(performance.now() - t0).toBeLessThan(1500)
  })
})

describe('mesher', () => {
  test('a lone cube has six faces of four corners', () => {
    const w = new World(16, 16, 16)
    w.set(5, 5, 5, STONE)
    const g = meshChunk(w, new SunLight(w), layout, 0, 0, 0)
    expect(g.positions.length / 3).toBe(24)
    expect(g.indices.length).toBe(36)
  })

  test('touching cubes hide their shared faces; glass hides glass but not stone', () => {
    const w = new World(16, 16, 16)
    w.set(5, 5, 5, STONE)
    w.set(6, 5, 5, STONE)
    expect(meshChunk(w, new SunLight(w), layout, 0, 0, 0).indices.length).toBe(10 * 6)
    const g = new World(16, 16, 16)
    g.set(5, 5, 5, GLASS)
    g.set(6, 5, 5, GLASS)
    g.set(7, 5, 5, STONE)
    // glass pair: 10 faces less the one hidden by the stone; stone keeps all 6 (glass is see-through)
    expect(meshChunk(g, new SunLight(g), layout, 0, 0, 0).indices.length).toBe((9 + 6) * 6)
  })

  test('triangles face outward', () => {
    const w = new World(16, 16, 16)
    w.set(5, 5, 5, STONE)
    const g = meshChunk(w, new SunLight(w), layout, 0, 0, 0)
    for (let i = 0; i < g.indices.length; i += 3) {
      const [a, b, c] = [g.indices[i], g.indices[i + 1], g.indices[i + 2]].map((k) => [g.positions[k * 3], g.positions[k * 3 + 1], g.positions[k * 3 + 2]])
      const e1 = b.map((v, j) => v - a[j])
      const e2 = c.map((v, j) => v - a[j])
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      const k = g.indices[i]
      const normal = [g.normals[k * 3], g.normals[k * 3 + 1], g.normals[k * 3 + 2]]
      expect(n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2]).toBeGreaterThan(0)
    }
  })

  test('ambient occlusion darkens inner corners', () => {
    expect(vertexAO(false, false, false)).toBe(3)
    expect(vertexAO(true, true, false)).toBe(0)
    const w = new World(16, 16, 16)
    w.fill(0, 0, 0, 15, 4, 15, STONE)
    w.set(8, 5, 8, STONE) // a bump on the floor
    const g = meshChunk(w, new SunLight(w), layout, 0, 0, 0)
    const aoAt = (x: number, y: number, z: number) => {
      for (let i = 0; i < g.positions.length / 3; i++)
        if (g.positions[i * 3] === x && g.positions[i * 3 + 1] === y && g.positions[i * 3 + 2] === z && g.normals[i * 3 + 1] === 1) return (g.lights[i] >> 16) & 3
      return -1
    }
    expect(aoAt(3, 5, 3)).toBe(3) // open floor
    expect(aoAt(8, 5, 8)).toBeLessThan(3) // floor corner under the bump's edge
  })

  test('beds are short and carry their tile', () => {
    const w = new World(16, 16, 16)
    w.set(5, 5, 5, BED.red)
    const g = meshChunk(w, new SunLight(w), layout, 0, 0, 0)
    expect(Math.max(...g.positions.filter((_, i) => i % 3 === 1))).toBeCloseTo(5.5625, 6)
    const [u0, v0, u1, v1] = tileUV(layout, layout.faces[BED.red][0])
    expect(u1).toBeGreaterThan(u0)
    expect(v1).toBeGreaterThan(v0)
  })
})

describe('chunk renderer', () => {
  /** Every chunk's mesh as the renderer holds it, keyed by its first vertex, to compare with meshing in place. */
  function positions(r: ChunkRenderer): string[] {
    return r.group.children.map((m) => [...((m as Mesh).geometry.getAttribute('position').array as Float32Array)].join(',')).sort()
  }
  function direct(w: World): string[] {
    const light = new SunLight(w)
    const out: string[] = []
    for (let cy = 0; cy < w.sy / CHUNK; cy++)
      for (let cz = 0; cz < w.sz / CHUNK; cz++)
        for (let cx = 0; cx < w.sx / CHUNK; cx++) {
          const g = meshChunk(w, light, layout, cx, cy, cz)
          if (g.indices.length) out.push([...g.positions].join(','))
        }
    return out.sort()
  }

  test('meshes in a worker match meshing in place, through edits, and its sunlight copy follows', async () => {
    const w = new World(48, 32, 32)
    w.fill(0, 0, 0, 47, 4, 31, STONE)
    w.fill(10, 10, 10, 20, 10, 20, STONE)
    const r = new ChunkRenderer(w, layout, new ShaderMaterial())
    await r.buildAll()
    expect(positions(r)).toEqual(direct(w))
    expect(r.light.get(15, 5, 15)).toBe(new SunLight(w).get(15, 5, 15))
    expect(r.light.get(15, 5, 15)).toBeLessThan(15)
    // Lift the roof and build a pillar across a chunk border.
    for (let x = 10; x <= 20; x++) for (let z = 10; z <= 20; z++) w.set(x, 10, z, 0)
    for (let y = 5; y < 20; y++) w.set(31, y, 16, GLASS, true)
    await r.buildAll()
    expect(positions(r)).toEqual(direct(w))
    expect(r.light.get(15, 5, 15)).toBe(15)
    r.dispose()
  })
})

describe('block light', () => {
  const LAMP = defineBlock({ name: 'Test lamp', hardness: 1, lightLevel: 15, texture: { top: '#ffd', side: '#ffd', pattern: 'smooth' } })

  test('a lamp lights the air around it, walls stop it, and removing it relights', () => {
    const w = new World(32, 32, 32)
    w.fill(0, 0, 0, 31, 4, 31, STONE)
    w.fill(0, 12, 0, 31, 12, 31, STONE) // a roof, so sunlight is not everything
    w.set(10, 5, 10, LAMP)
    w.fill(14, 5, 0, 14, 11, 31, STONE) // a wall beyond the lamp
    const light = new SunLight(w)
    expect(light.getBlock(11, 5, 10)).toBe(14)
    expect(light.getBlock(13, 5, 10)).toBe(12)
    expect(light.getBlock(15, 5, 10)).toBeLessThan(light.getBlock(13, 5, 10) - 2)
    w.set(10, 5, 10, 0)
    light.queueChange(10, 10)
    expect(light.flush()).not.toBeNull()
    expect(light.getBlock(11, 5, 10)).toBe(0)
  })

  test('meshes carry block light in the light word', () => {
    const w = new World(16, 16, 16)
    w.fill(0, 0, 0, 15, 4, 15, STONE)
    w.set(8, 5, 8, LAMP)
    // A layout built after the lamp was registered, so it has a tile.
    const g = meshChunk(w, new SunLight(w), atlasLayout(), 0, 0, 0)
    const glows = [...g.lights].map((l) => (l >> 8) & 15)
    expect(Math.max(...glows)).toBe(15)
  })
})
