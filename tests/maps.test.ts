import { describe, expect, test } from 'bun:test'
import { AIR, BED, BLOCKS, blockDef, FROST_LAMP, GLASS, isBed, LANTERN, PLANKS, STAINED_GLASS, TEAMS, type TeamId } from '../src/games/bedwars/blocks'
import { ARENA_HEIGHT, ARENA_SIZE, ARENAS, createArena, TOP } from '../src/games/bedwars/maps/arena'
import type { MapDef, TeamBase } from '../src/games/bedwars/maps/types'
import { arenaRules } from '../src/games/bedwars/rules'
import { atlasLayout } from '../src/engine/render/atlas-layout'
import { drawTile, PATTERNS } from '../src/engine/render/textures'
import { isOpaqueCube } from '../src/engine/blocks'

const built = new Map<string, { map: MapDef; ms: number }>()
for (const layout of ARENAS) {
  const t0 = performance.now()
  const map = createArena(TEAMS, layout)
  built.set(layout.id, { map, ms: performance.now() - t0 })
}

const solid = (map: MapDef, x: number, y: number, z: number) => map.world.isSolid(x, y, z)
/** Two clear cells of headroom over solid ground. */
function standable(map: MapDef, x: number, y: number, z: number): boolean {
  return solid(map, x, y - 1, z) && map.world.get(x, y, z) === AIR && map.world.get(x, y + 1, z) === AIR
}
const cell = (p: readonly number[]) => [Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])] as const
const covered = (map: MapDef, [x, y, z]: readonly [number, number, number]) =>
  map.build.protectedZones.some((b) => x >= b[0] && x <= b[3] && y >= b[1] && y <= b[4] && z >= b[2] && z <= b[5])
/** A block at body height that stops anyone walking into the cell (a one-high block you can hop is fine). */
const wall = (map: MapDef, x: number, z: number) => solid(map, x, TOP + 1, z) || (solid(map, x, TOP, z) && solid(map, x, TOP + 2, z))

/** The front of a base, as the bed's head direction, and the side axis. */
function axes(base: TeamBase) {
  const u: [number, number] = [base.bed.dx, base.bed.dz]
  return { u, v: [-u[1], u[0]] as [number, number] }
}

/**
 * The cells a bot crosses from where it covers its bed to each enemy bed and
 * spawn: out along its own base axis when the base sits on the middle's
 * cross, else along x first, then one turn. Mirrors `Bot.leave()`, three
 * cells wide.
 */
function botRoutes(map: MapDef): Set<string> {
  const cells = new Set<string>()
  const mid = map.world.sx / 2
  const leg = (ax: number, az: number, bx: number, bz: number) => {
    const [x0, x1] = [Math.floor(Math.min(ax, bx)), Math.floor(Math.max(ax, bx))]
    const [z0, z1] = [Math.floor(Math.min(az, bz)), Math.floor(Math.max(az, bz))]
    for (let x = x0 - (ax === bx ? 1 : 0); x <= x1 + (ax === bx ? 1 : 0); x++) for (let z = z0 - (ax === bx ? 0 : 1); z <= z1 + (ax === bx ? 0 : 1); z++) cells.add(`${x},${z}`)
  }
  for (const own of map.bases) {
    const stand = [own.bed.x + 0.5 - own.bed.dx * 2.5, own.bed.z + 0.5 - own.bed.dz * 2.5]
    const alongZ = Math.abs(own.center[0] - mid) < 1
    for (const sx of [stand[0] - 0.49, stand[0] + 0.49])
      for (const sz of [stand[1] - 0.49, stand[1] + 0.49]) {
        const [hx, hz] = [Math.floor(sx) + 0.5, Math.floor(sz) + 0.5]
        for (const t of map.bases) {
          if (t === own) continue
          for (const [gx, gz] of [[t.bed.x + 0.5 - t.bed.dx * 2, t.bed.z + 0.5 - t.bed.dz * 2], [t.spawn[0], t.spawn[2]]]) {
            const [cx, cz] = alongZ ? [hx, gz] : [gx, hz]
            leg(hx, hz, cx, cz)
            leg(cx, cz, gx, gz)
          }
        }
      }
  }
  return cells
}

describe('blocks', () => {
  test('the block ids stay well under the 128 a cell can hold, and every texture has a painter', () => {
    expect(BLOCKS.length).toBeLessThanOrEqual(80)
    for (const b of BLOCKS) expect(PATTERNS.has(b.texture.pattern)).toBe(true)
    for (const team of TEAMS) expect(blockDef(STAINED_GLASS[team]).meta.team).toBe(team)
    for (const lamp of [LANTERN, FROST_LAMP]) expect(blockDef(lamp).lightLevel).toBe(15)
  })

  test('every atlas tile paints: opaque blocks fully, cut-outs with holes', () => {
    // A stand-in for the DOM's ImageData, so the painters run headless.
    const g = globalThis as { ImageData?: unknown }
    const had = g.ImageData
    g.ImageData ??= class {
      data: Uint8ClampedArray
      constructor(
        readonly width: number,
        readonly height: number,
      ) {
        this.data = new Uint8ClampedArray(width * height * 4)
      }
    }
    try {
      const layout = atlasLayout()
      const tiles = layout.recipes.map((r, i) => drawTile(r, i + 1).data)
      for (const b of BLOCKS) {
        if (b.id === AIR) continue
        for (const t of layout.faces[b.id]) {
          const alpha = [...tiles[t].filter((_, i) => i % 4 === 3)]
          if (isOpaqueCube(b)) expect(Math.min(...alpha)).toBe(255)
          else expect(Math.max(...alpha)).toBe(255)
        }
      }
    } finally {
      if (had === undefined) delete g.ImageData
    }
  })
})

describe('arenas', () => {
  test('the lobby vote offers every arena, Skyreach first', () => {
    expect(arenaRules().maps).toEqual(ARENAS.map((a) => a.id))
    expect(new Set(ARENAS.map((a) => a.id)).size).toBe(ARENAS.length)
  })

  for (const layout of ARENAS) {
    describe(layout.name, () => {
      const { map, ms } = built.get(layout.id)!
      const w = map.world

      test('builds quickly, deterministically and small enough to send', () => {
        expect(ms).toBeLessThan(500)
        expect(w.sx).toBe(ARENA_SIZE)
        expect(w.sy).toBe(ARENA_HEIGHT)
        expect(w.sz).toBe(ARENA_SIZE)
        const bytes = w.encode()
        expect(bytes.length).toBeLessThan(200_000)
        expect(createArena(TEAMS, layout).world.encode()).toEqual(bytes)
      })

      test('every team has both halves of its bed where its base says', () => {
        expect(map.bases.map((b) => b.team).sort()).toEqual([...TEAMS].sort())
        for (const { team, bed } of map.bases) {
          expect(w.get(bed.x, bed.y, bed.z)).toBe(BED[team as TeamId])
          expect(w.get(bed.x + bed.dx, bed.y, bed.z + bed.dz)).toBe(BED[team as TeamId])
        }
      })

      test('spawns, forges and shopkeepers stand on solid ground with headroom; generators on solid ground', () => {
        for (const base of map.bases) {
          expect(standable(map, ...cell(base.spawn))).toBe(true)
          expect(standable(map, ...cell(base.forge))).toBe(true)
        }
        for (const npc of map.npcs) expect(standable(map, ...cell([npc.x, npc.y, npc.z]))).toBe(true)
        for (const g of map.generators) {
          const [x, y, z] = cell(g.pos)
          expect(solid(map, x, y - 1, z)).toBe(true)
          expect(solid(map, x, y, z)).toBe(false)
        }
        expect(map.generators.filter((g) => g.kind === 'diamond').length).toBe(4)
        expect(map.generators.filter((g) => g.kind === 'emerald').length).toBe(2)
      })

      test('protected zones cover spawns, forges, generators and shopkeepers', () => {
        for (const base of map.bases) {
          expect(covered(map, cell(base.spawn))).toBe(true)
          expect(covered(map, cell(base.forge))).toBe(true)
        }
        for (const g of map.generators) expect(covered(map, cell(g.pos))).toBe(true)
        for (const npc of map.npcs) expect(covered(map, cell([npc.x, npc.y, npc.z]))).toBe(true)
      })

      test('a clear lane, three wide and three tall, runs out from the front of each bed along its base axis', () => {
        const mid = w.sx / 2
        const onCross = map.bases.every((b) => Math.abs(b.center[0] - 0.5 - mid) < 1 || Math.abs(b.center[2] - 0.5 - mid) < 1)
        for (const base of map.bases) {
          const { u, v } = axes(base)
          // From the cell in front of the bed's head out past the island edge, and on cross arenas all the way to the middle.
          const far = onCross ? Math.abs(base.center[0] - 0.5 - mid) + Math.abs(base.center[2] - 0.5 - mid) - 3 : 20
          let crossedVoid = false
          for (let k = 2; k <= far; k++)
            for (let s = -1; s <= 1; s++) {
              const x = base.bed.x + u[0] * k + v[0] * s
              const z = base.bed.z + u[1] * k + v[1] * s
              for (let y = TOP; y <= TOP + 2; y++) expect([x, y, z, w.get(x, y, z)]).toEqual([x, y, z, AIR])
              if (!solid(map, x, TOP - 1, z)) crossedVoid = true
            }
          expect(crossedVoid).toBe(true)
        }
      })

      test('every route a bot bridges between bases is free of map blocks', () => {
        const routes = botRoutes(map)
        expect(routes.size).toBeGreaterThan(300)
        for (const key of routes) {
          const [x, z] = key.split(',').map(Number)
          for (let y = TOP; y <= TOP + 2; y++) {
            const id = w.get(x, y, z)
            if (id !== AIR && !isBed(id)) expect(`${blockDef(id).name} at ${x},${y},${z}`).toBe('air')
          }
        }
      })

      test('nothing in a base walls in a bot heading for another base', () => {
        // Bots cannot dig map blocks and leave in straight legs toward the other bases, so from any
        // open cell of a base, the next cell that way must not stop them (a hop-over block is fine).
        for (const base of map.bases) {
          const others = map.bases.filter((b) => b !== base)
          const dirs: [number, number][] = []
          for (const o of others) {
            const dx = Math.sign(o.center[0] - base.center[0])
            const dz = Math.sign(o.center[2] - base.center[2])
            for (const d of [[dx, 0], [0, dz]] as [number, number][]) if ((d[0] || d[1]) && !dirs.some((e) => e[0] === d[0] && e[1] === d[1])) dirs.push(d)
          }
          // Every cell you can walk to from the spawn (hopping one-high blocks), within the base.
          const [cx, cz] = [Math.floor(base.center[0]), Math.floor(base.center[2])]
          const open = (x: number, z: number) => Math.abs(x - cx) <= 12 && Math.abs(z - cz) <= 12 && solid(map, x, TOP - 1, z) && !wall(map, x, z)
          const [sx, , sz] = cell(base.spawn)
          const seen = new Set([`${sx},${sz}`])
          const queue: [number, number][] = [[sx, sz]]
          while (queue.length) {
            const [x, z] = queue.pop()!
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const key = `${x + dx},${z + dz}`
              if (!seen.has(key) && open(x + dx, z + dz)) {
                seen.add(key)
                queue.push([x + dx, z + dz])
              }
            }
          }
          expect(seen.size).toBeGreaterThan(150)
          for (const key of seen) {
            const [x, z] = key.split(',').map(Number)
            for (const [dx, dz] of dirs) if (wall(map, x + dx, z + dz)) expect(`wall at ${x + dx},${z + dz} from ${x},${z}`).toBe('open')
          }
        }
      })

      test('the lobby deck floats clear above everything and is all that its box holds', () => {
        const [x0, y0, z0, x1, y1, z1] = map.lobby!.box
        let highest = 0
        for (let y = 0; y < w.sy; y++)
          for (let z = 0; z < w.sz; z++)
            for (let x = 0; x < w.sx; x++) {
              const id = w.get(x, y, z)
              if (id === AIR) continue
              const inBox = x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1
              if (inBox) expect([PLANKS, GLASS]).toContain(id)
              else highest = Math.max(highest, y)
            }
        expect(highest).toBeLessThan(y0 - 2)
        expect(standable(map, ...cell(map.lobby!.spawn))).toBe(true)
      })
    })
  }
})
