import { GLASS, PLANKS, TEAMS, type TeamId } from '../blocks'
import { placeBed } from '../beds'
import type { Box } from '../../../engine/physics'
import { rng } from '../../../engine/random'
import { layeredIsland } from '../../../engine/terrain'
import { World } from '../../../engine/world'
import { buildBase, reserveBase } from './base'
import { Builder, Frame } from './builder'
import { ARENA_HEIGHT, ARENA_SIZE, BASE, basePlan, MID, onCross, TOP, walkways, type ArenaLayout, type Rect } from './plan'
import { THEMES, type Area } from './themes'
import type { GeneratorSpot, MapDef, Npc, TeamBase } from './types'

export { ARENA_HEIGHT, ARENA_SIZE, TOP, type ArenaLayout }
const LOBBY_Y = 68

/** Forest: a cross of bases with stone-and-wood houses, oaks on the diamond islands, a floating grove over a mossy ring. */
export const SKYREACH: ArenaLayout = {
  id: 'skyreach',
  name: 'Skyreach',
  theme: 'forest',
  bases: { red: { at: [0, -48], out: [0, -1] }, blue: { at: [48, 0], out: [1, 0] }, green: { at: [0, 48], out: [0, 1] }, yellow: { at: [-48, 0], out: [-1, 0] } },
  diamonds: [[30, 30], [30, -30], [-30, 30], [-30, -30]],
  middle: 10,
  seed: 101,
  sky: '#8ec5ff',
}

/** A village at dusk: corner bases with plastered, tile-roofed houses, a brick square with a fountain and cottages. */
export const LANTERNS: ArenaLayout = {
  id: 'lanterns',
  name: 'Lanterns',
  theme: 'village',
  bases: { red: { at: [-38, -38], out: [0, -1] }, blue: { at: [38, -38], out: [1, 0] }, green: { at: [38, 38], out: [0, 1] }, yellow: { at: [-38, 38], out: [-1, 0] } },
  diamonds: [[0, -40], [40, 0], [0, 40], [-40, 0]],
  middle: 12,
  seed: 202,
  sky: '#e9a77c',
}

/** Desert: sandstone houses on a cross, pyramids and cacti on banded sand islands, an oasis under a floating pyramid. */
export const DUNES: ArenaLayout = {
  id: 'dunes',
  name: 'Dunes',
  theme: 'desert',
  bases: { red: { at: [0, -46], out: [0, -1] }, blue: { at: [46, 0], out: [1, 0] }, green: { at: [0, 46], out: [0, 1] }, yellow: { at: [-46, 0], out: [-1, 0] } },
  diamonds: [[34, 34], [34, -34], [-34, 34], [-34, -34]],
  middle: 11,
  seed: 303,
  sky: '#f1d6a0',
}

/** Snow and ice: corner bases under snowy roofs, diamonds out on the rim, a frozen tower in the middle. */
export const FROSTPEAK: ArenaLayout = {
  id: 'frostpeak',
  name: 'Frostpeak',
  theme: 'frost',
  bases: { red: { at: [-36, -36], out: [0, -1] }, blue: { at: [36, -36], out: [1, 0] }, green: { at: [36, 36], out: [0, 1] }, yellow: { at: [-36, 36], out: [-1, 0] } },
  diamonds: [[0, -48], [48, 0], [0, 48], [-48, 0]],
  middle: 12,
  seed: 404,
  sky: '#d4e5f2',
}

/** Mossy castle ruins: a cross of broken houses, diamonds in a pinwheel, the old keep floating over its footings. */
export const RUINS: ArenaLayout = {
  id: 'ruins',
  name: 'Ruins',
  theme: 'ruins',
  bases: { red: { at: [0, -50], out: [0, -1] }, blue: { at: [50, 0], out: [1, 0] }, green: { at: [0, 50], out: [0, 1] }, yellow: { at: [-50, 0], out: [-1, 0] } },
  diamonds: [[34, 16], [-16, 34], [-34, -16], [16, -34]],
  middle: 12,
  seed: 505,
  sky: '#a9c0d0',
}

export const ARENAS: ArenaLayout[] = [SKYREACH, LANTERNS, DUNES, FROSTPEAK, RUINS]

export function arenaLayout(id: string | undefined): ArenaLayout {
  return ARENAS.find((a) => a.id === id) ?? SKYREACH
}

export function yawToward(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz)
}

/**
 * Four team bases around a middle landmark and four diamond islands, all
 * floating over the void, placed by an `ArenaLayout` and dressed by its
 * theme. Generated, so a new arena is a new layout. The walkways between
 * bases are reserved first and stay clear of every structure and decoration.
 */
export function createArena(teams: readonly TeamId[] = TEAMS, layout: ArenaLayout = SKYREACH): MapDef {
  const world = new World(ARENA_SIZE, ARENA_HEIGHT, ARENA_SIZE)
  const b = new Builder(world)
  const theme = THEMES[layout.theme]
  const rnd = rng(layout.seed)
  const bases: TeamBase[] = []
  const generators: GeneratorSpot[] = []
  const npcs: Npc[] = []
  const labels: MapDef['labels'] = []
  const zones: Box[] = []
  const areas: Area[] = []
  const protect = (x: number, y: number, z: number, r: number, h = 3) => zones.push([x - r, y, z - r, x + r, y + h, z + r])

  const lanes = walkways(layout)
  for (const [x0, z0, x1, z1] of lanes) b.reserve(x0, TOP, z0, x1, TOP + 2, z1)
  const cross = onCross(layout)
  const frames = TEAMS.map((team) => {
    const plan = basePlan(layout, team)
    const f = new Frame(b, plan.cx, plan.cz, plan.out, TOP)
    reserveBase(f, !cross)
    return { team, plan, f }
  })
  /*
   * Where bots can go: every base and every lane, and whatever lies in line
   * with them, since a bot leaving an island along a row or column bridges
   * straight on. On a base a bot may head off along either axis; on a lane,
   * along the lane. Islands in line get only bot-safe scenery.
   */
  /** A footprint, and whether bots leave it along rows (x), columns (z) or both. */
  const walked: { r: Rect; rows: boolean; cols: boolean }[] = frames.map(({ f }) => {
    const [ax, az] = [f.x(-12, -12), f.z(-12, -12)]
    const [bx, bz] = [f.x(10, 12), f.z(10, 12)]
    return { r: [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)], rows: true, cols: true }
  })
  for (const r of lanes) walked.push({ r, rows: r[2] - r[0] >= r[3] - r[1], cols: r[2] - r[0] <= r[3] - r[1] })
  const inLine = ([x0, z0, x1, z1]: Rect, m = 1) =>
    walked.some(({ r: [a0, c0, a1, c1], rows, cols }) => (cols && x0 <= a1 + m && x1 >= a0 - m) || (rows && z0 <= c1 + m && z1 >= c0 - m))
  const nearLane = (x: number, z: number, r: number) => lanes.some(([x0, z0, x1, z1]) => x >= x0 - r && x <= x1 + r && z >= z0 - r && z <= z1 + r)

  // Islands: each base's sits a block forward of its centre (room for the yard), the diamonds' are small.
  for (const [i, { plan, f }] of frames.entries()) {
    const [cx, cz] = plan.at(1, 0)
    const alongZ = plan.out[0] === 0
    layeredIsland(world, theme.strata, { cx: cx + 0.5, cz: cz + 0.5, rx: alongZ ? 9 : 8, rz: alongZ ? 8 : 9, top: TOP, depth: 10, seed: layout.seed + 11 + i, rough: theme.rough })
    const inYard = (x: number, z: number) => {
      // Back in frame coordinates: the house and yard are u -13..7, v -7..7 (and the side wing on a corner arena).
      const du = (x - f.cx) * f.ux + (z - f.cz) * f.uz
      const dv = (x - f.cx) * f.vx + (z - f.cz) * f.vz
      return (du >= -13 && du <= 7 && Math.abs(dv) <= 7) || du <= -7 || dv <= -10
    }
    areas.push({ kind: 'base', x0: cx - 11, z0: cz - 11, x1: cx + 11, z1: cz + 11, safe: true, skip: inYard })
  }
  const R = layout.middle
  const reach = Math.ceil(R + theme.rough + 1)
  const middleRect: Rect = [MID - reach, MID - reach, MID + reach, MID + reach]
  const middleSafe = inLine(middleRect)
  if (middleSafe) walked.push({ r: middleRect, rows: true, cols: true })
  layeredIsland(world, theme.strata, { cx: MID + 0.5, cz: MID + 0.5, rx: R, rz: R, top: TOP, depth: 14, seed: layout.seed + 51, rough: theme.rough })
  areas.push({ kind: 'middle', x0: MID - R - 3, z0: MID - R - 3, x1: MID + R + 3, z1: MID + R + 3, safe: middleSafe })
  const diamondSafe: boolean[] = []
  for (const [i, [dx, dz]] of layout.diamonds.entries()) {
    const [x, z] = [MID + dx, MID + dz]
    layeredIsland(world, theme.strata, { cx: x + 0.5, cz: z + 0.5, rx: 4, rz: 4, top: TOP, depth: 6, seed: layout.seed + 31 + i, rough: theme.rough * 0.7, squareness: 3 })
    const safe = inLine([x - 6, z - 6, x + 6, z + 6]) || nearLane(x, z, 6)
    diamondSafe.push(safe)
    areas.push({ kind: 'diamond', x0: x - 6, z0: z - 6, x1: x + 6, z1: z + 6, safe, skip: (cx, cz) => Math.max(Math.abs(cx - x), Math.abs(cz - z)) <= 2 })
  }

  // Structures, then decorations around them.
  for (const [i, { team, f }] of frames.entries()) {
    buildBase(f, team, theme.style, theme.strata, !cross, layout.seed + 61 + i * 3, rnd)
    theme.dressBase(f, team, rnd)
  }
  for (const [i, [dx, dz]] of layout.diamonds.entries()) theme.diamond(b, MID + dx, MID + dz, TOP, diamondSafe[i], rnd)
  const emeralds = theme.middle(b, MID, TOP, R, middleSafe, rnd)
  for (const area of areas) theme.scatter(b, area, TOP, rnd)
  islets(b, layout, (x, z) => inLine([x - 5, z - 5, x + 5, z + 5], 2) || nearLane(x, z, 8), rnd)
  b.carve()

  for (const { team, plan } of frames) {
    const [ox, oz] = plan.out
    const [sx, sz] = plan.at(BASE.spawn, 0)
    const [fx, fz] = plan.at(BASE.forge, 0)
    const [bx, bz] = plan.at(BASE.bed, 0)
    if (teams.includes(team)) placeBed(world, team, bx, TOP, bz, -ox, -oz)
    const [px, pz] = [-oz, ox]
    for (const [kind, [u, v]] of [['shop', BASE.shop], ['upgrades', BASE.upgrades]] as const) {
      const [x, z] = plan.at(u, v)
      npcs.push({ kind, team, x: x + 0.5, y: TOP, z: z + 0.5, yaw: kind === 'shop' ? yawToward(-px, -pz) : yawToward(px, pz) })
      protect(x, TOP, z, 0, 2)
    }
    protect(sx, TOP, sz, 1)
    protect(fx, TOP, fz, 1)
    generators.push({ kind: 'iron', team, pos: [fx + 0.5, TOP, fz + 0.5] }, { kind: 'gold', team, pos: [fx + 0.5, TOP, fz + 0.5] })
    bases.push({
      team,
      spawn: [sx + 0.5, TOP, sz + 0.5, yawToward(-ox, -oz)],
      bed: { x: bx, y: TOP, z: bz, dx: -ox, dz: -oz },
      forge: [fx + 0.5, TOP, fz + 0.5],
      center: [plan.cx + 0.5, TOP, plan.cz + 0.5],
    })
  }

  for (const [dx, dz] of layout.diamonds) {
    const [x, z] = [MID + dx, MID + dz]
    generators.push({ kind: 'diamond', pos: [x + 0.5, TOP, z + 0.5] })
    labels.push({ text: 'Diamond', x: x + 0.5, y: TOP + 2.6, z: z + 0.5 })
    protect(x, TOP, z, 1)
  }
  for (const [x, z] of emeralds) {
    generators.push({ kind: 'emerald', pos: [x + 0.5, TOP, z + 0.5] })
    protect(x, TOP, z, 0)
  }
  labels.push({ text: 'Emerald', x: MID + 0.5, y: TOP + 2.6, z: MID + 0.5 })

  // Lobby: a glass-walled deck above the centre, cleared when the round starts.
  const L = 6
  world.fill(MID - L, LOBBY_Y - 1, MID - L, MID + L, LOBBY_Y - 1, MID + L, PLANKS)
  for (let y = LOBBY_Y; y < LOBBY_Y + 3; y++)
    for (let i = -L; i <= L; i++)
      for (const [x, z] of [[MID + i, MID - L], [MID + i, MID + L], [MID - L, MID + i], [MID + L, MID + i]]) world.set(x, y, z, GLASS)

  return {
    name: layout.name,
    world,
    bases,
    generators,
    npcs,
    labels,
    lobby: { spawn: [MID + 0.5, LOBBY_Y, MID + 0.5, 0], box: [MID - L, LOBBY_Y - 1, MID - L, MID + L, LOBBY_Y + 2, MID + L] },
    spectator: [MID + 0.5, TOP + 26, MID + 40, 0, -0.55],
    killY: TOP - 30,
    build: { minY: TOP - 14, maxY: TOP + 24, protectedZones: zones },
    sky: layout.sky,
  }
}

/**
 * Small floating islets dressed by the theme, out of line with every base
 * and lane: scenery to look at, which no bot will ever bridge into.
 */
function islets(b: Builder, layout: ArenaLayout, inWay: (x: number, z: number) => boolean, rnd: () => number): void {
  const theme = THEMES[layout.theme]
  const centres: [number, number, number][] = [
    ...TEAMS.map((t) => [MID + layout.bases[t].at[0], MID + layout.bases[t].at[1], 15] as [number, number, number]),
    ...layout.diamonds.map(([dx, dz]) => [MID + dx, MID + dz, 8] as [number, number, number]),
    [MID, MID, layout.middle + 6],
  ]
  let placed = 0
  for (let tries = 0; tries < 400 && placed < 8; tries++) {
    const x = 10 + Math.floor(rnd() * (ARENA_SIZE - 20))
    const z = 10 + Math.floor(rnd() * (ARENA_SIZE - 20))
    if (inWay(x, z) || centres.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + 4)) continue
    const top = TOP - 6 + Math.floor(rnd() * 10)
    const r = 2 + Math.floor(rnd() * 2)
    layeredIsland(b.world, theme.strata, { cx: x + 0.5, cz: z + 0.5, rx: r, rz: r, top, depth: 4 + r, seed: layout.seed + 71 + tries, rough: 1, squareness: 2.5 })
    theme.islet(b, x, top, z, rnd)
    centres.push([x, z, r + 6])
    placed++
  }
}
