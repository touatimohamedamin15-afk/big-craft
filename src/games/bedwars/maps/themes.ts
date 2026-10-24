import {
  BIRCH_LEAVES, BIRCH_LOG, BRICK, CACTUS, COBBLESTONE, CRACKED_STONE_BRICKS, CUT_SANDSTONE, DARK_PLANKS, DIRT, FLOWERS, FROST_LAMP, GLASS,
  GOLD_BLOCK, GRASS, GRASS_TUFT, GRAVEL, HAY, ICE, LANTERN, LEAVES, LOG, MOSSY_COBBLESTONE, MOSSY_STONE_BRICKS, PACKED_ICE, PLANKS, POLE,
  QUARTZ, QUARTZ_PILLAR, ROOF_TILES, SAND, SANDSTONE, SNOW, SNOWY_GRASS, SPRUCE_LEAVES, SPRUCE_LOG, STONE, STONE_BRICKS, TERRACOTTA, WATER,
  type TeamId,
} from '../blocks'
import { hash2 } from '../../../engine/random'
import { layeredIsland, type IslandStrata } from '../../../engine/terrain'
import type { BaseStyle } from './base'
import type { Builder, Frame, Mat } from './builder'
import {
  boulder, broadleaf, cactus, chain, column, conifer, groundCells, iceSpike, lampPost, meadow, palm, pyramid, sapling, slender, slimPalm, spread,
  tallSpruce, type Random,
} from './parts'
import type { ThemeId } from './plan'

/** An island's footprint, for scattering decorations over its natural ground. */
export interface Area {
  kind: 'base' | 'diamond' | 'middle'
  x0: number
  z0: number
  x1: number
  z1: number
  /**
   * Bots may walk here (it lies in line with a base or a lane): only
   * floor-level detail, one-high clutter, and things on non-solid poles or
   * at least three blocks up.
   */
  safe: boolean
  /** Cells to leave alone (a base's yard, a diamond's pad). */
  skip?: (x: number, z: number) => boolean
}

export interface Theme {
  strata: IslandStrata
  /** How far island outlines bulge past their half-sizes. */
  rough: number
  style: BaseStyle
  /** Theme touches on a base after the shared builder (floor level and overhead only). */
  dressBase(f: Frame, team: TeamId, rnd: Random): void
  /** Paves and lights a diamond island around its generator at (x, top, z). */
  diamond(b: Builder, x: number, z: number, top: number, safe: boolean, rnd: Random): void
  /**
   * Builds the landmark on the middle island and returns the two emerald
   * cells. When `safe`, bots cross the middle (bases sit on its axes), so
   * the landmark keeps to the ground and the air: nothing solid at body
   * height.
   */
  middle(b: Builder, mid: number, top: number, radius: number, safe: boolean, rnd: Random): [number, number][]
  /** Trees, rocks and plants over an island's free ground. */
  scatter(b: Builder, area: Area, top: number, rnd: Random): void
  /** Dresses a small floating islet out of everyone's way; `y` is the first cell above its ground. */
  islet(b: Builder, x: number, y: number, z: number, rnd: Random): void
}

/** Picks one of several blocks per cell, by weight, from stable noise. */
export function blend(seed: number, ...parts: [number, number][]): Mat {
  const total = parts.reduce((s, [, w]) => s + w, 0)
  return (x, y, z) => {
    let n = hash2(x * 13 + y * 7, z * 3 + y, seed) * total
    for (const [id, w] of parts) if ((n -= w) < 0) return id
    return parts[parts.length - 1][0]
  }
}

/** Horizontal bands by height, wobbling a little: canyon rock. */
function bands(seed: number, ids: number[]): Mat {
  return (x, y, z) => ids[(((y + Math.floor(hash2(x >> 2, z >> 2, seed) * 2)) % ids.length) + ids.length) % ids.length]
}

const weathered = blend(5, [STONE_BRICKS, 5], [MOSSY_STONE_BRICKS, 3], [CRACKED_STONE_BRICKS, 2])
const plants = [FLOWERS.red, FLOWERS.yellow, FLOWERS.blue, GRASS_TUFT, GRASS_TUFT]
const flowerOf = (rnd: Random) => [FLOWERS.red, FLOWERS.yellow, FLOWERS.blue][Math.floor(rnd() * 3)]

/** The four corners of a square of half-size `r` around (x, z). */
const corners = (x: number, z: number, r: number): [number, number][] => [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]]

/** A lamp on a non-solid pole, the lamp three up, over people's heads. */
function poleLamp(b: Builder, x: number, y: number, z: number, lamp: number): boolean {
  if (!b.free(x, y, z, x, y + 3, z) || !b.solid(x, y - 1, z)) return false
  for (let h = 0; h < 3; h++) b.set(x, y + h, z, POLE)
  b.set(x, y + 3, z, lamp)
  return true
}

/**
 * A diamond island's pad: paving and a lamp under the generator, and four
 * lamps round it, on solid posts where nobody walks or on poles where bots
 * may.
 */
function pad(b: Builder, x: number, z: number, top: number, floor: Mat, trim: Mat, post: Mat, lamp: number, safe: boolean): void {
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (b.solid(x + dx, top - 1, z + dz)) b.set(x + dx, top - 1, z + dz, Math.max(Math.abs(dx), Math.abs(dz)) === 2 ? trim : floor)
  b.set(x, top - 1, z, lamp)
  for (const [px, pz] of corners(x, z, 2)) (safe ? poleLamp(b, px, top, pz, lamp) : lampPost(b, px, top, pz, post, lamp, 1))
}

/** Ground cells of an area that decorations may use. */
function natural(b: Builder, area: Area, top: number, ground: number[]): [number, number][] {
  return groundCells(b, area.x0, area.z0, area.x1, area.z1, top, ground).filter(([x, z]) => !area.skip?.(x, z))
}

/** Walkable-ground scenery: thin-trunked trees, one-high rocks, lamps on poles and plants. */
function safeScatter(b: Builder, cells: [number, number][], top: number, rnd: Random, opts: { tree: (x: number, z: number) => void; trees: number; rock: Mat; lamp: number; ground: number[]; blooms: readonly number[] }): void {
  const taken: [number, number][] = []
  for (const [x, z] of spread(cells, rnd, opts.trees, 4, taken)) opts.tree(x, z)
  for (const [x, z] of spread(cells, rnd, 3, 4, taken)) b.bump(x, top, z, opts.rock)
  for (const [x, z] of spread(cells, rnd, 2, 5, taken)) poleLamp(b, x, top, z, opts.lamp)
  for (const [x, z] of spread(cells, rnd, 6, 3, taken)) meadow(b, x, top, z, rnd, opts.blooms, opts.ground)
}

/**
 * A rock floating over the middle, its underside kept at least four blocks
 * above the ground so everyone walks under it, tied down by chains to lamp
 * poles at the corners of the crossing. Returns the y of its top surface.
 */
function floatingRock(b: Builder, strata: IslandStrata, mid: number, top: number, r: number, lift: number, seed: number, lamp: number): number {
  const y = top + lift
  layeredIsland(b.world, strata, { cx: mid + 0.5, cz: mid + 0.5, rx: r, rz: r, top: y, depth: lift - 4, seed, rough: 1, squareness: 2.5, bottom: top + 4 })
  for (const [x, z] of corners(mid, mid, 3)) {
    poleLamp(b, x, top, z, lamp)
    let under = top + 4
    while (under < y && !b.solid(x, under, z)) under++
    chain(b, x, top + 4, under, z)
  }
  return y
}

/** Plants and hop-over stones scattered over the ground of a middle island. */
function groundDetail(b: Builder, mid: number, top: number, radius: number, rnd: Random, ground: number[], blooms: readonly number[], rock: Mat): void {
  const cells = groundCells(b, mid - radius - 2, mid - radius - 2, mid + radius + 2, mid + radius + 2, top, ground)
  const taken: [number, number][] = []
  for (const [x, z] of spread(cells, rnd, 4, 4, taken)) b.bump(x, top, z, rock)
  for (const [x, z] of spread(cells, rnd, 8, 3, taken)) meadow(b, x, top, z, rnd, blooms, ground)
}

const forest: Theme = {
  strata: { surface: GRASS, soil: DIRT, rock: STONE, tip: COBBLESTONE, accents: [GRAVEL, COBBLESTONE, MOSSY_COBBLESTONE, DIRT] },
  rough: 1.5,
  style: {
    floor: blend(11, [GRASS, 6], [GRAVEL, 1], [MOSSY_COBBLESTONE, 1]),
    trim: MOSSY_COBBLESTONE,
    path: blend(12, [COBBLESTONE, 3], [GRAVEL, 1], [MOSSY_COBBLESTONE, 1]),
    foundation: COBBLESTONE,
    wall: PLANKS,
    pillar: LOG,
    beam: LOG,
    roof: DARK_PLANKS,
    ridge: LOG,
    roofKind: 'gable',
    lamp: LANTERN,
    forgePad: STONE_BRICKS,
    forgeCore: LANTERN,
    spawnPad: MOSSY_STONE_BRICKS,
    clutter: [LOG, MOSSY_COBBLESTONE, LEAVES],
  },
  dressBase(f, _team, rnd) {
    // Flower beds along the house front.
    for (const v of [-9, -8, -7, -6, -5, -4, 4, 5, 6, 7, 8, 9]) if (rnd() < 0.6) f.deco(-7, 0, v, flowerOf(rnd))
  },
  diamond(b, x, z, top, safe, rnd) {
    pad(b, x, z, top, MOSSY_STONE_BRICKS, MOSSY_COBBLESTONE, LOG, LANTERN, safe)
    meadow(b, x, top, z, rnd, plants, [GRASS], 4, 0.5)
  },
  middle(b, mid, top, radius, safe, rnd) {
    // The hanging grove: a mossy ring of flagstones under a floating island with a great oak, tethered by chains.
    const flags = blend(14, [STONE_BRICKS, 3], [MOSSY_STONE_BRICKS, 3], [MOSSY_COBBLESTONE, 1])
    for (let dx = -radius - 2; dx <= radius + 2; dx++)
      for (let dz = -radius - 2; dz <= radius + 2; dz++) {
        const [x, z] = [mid + dx, mid + dz]
        if (!b.solid(x, top - 1, z)) continue
        const r = Math.hypot(dx, dz)
        if (r <= 5.4) b.set(x, top - 1, z, r < 1.5 ? MOSSY_STONE_BRICKS : r > 4.5 ? MOSSY_COBBLESTONE : flags)
        else if (Math.min(Math.abs(dx), Math.abs(dz)) <= 1) b.set(x, top - 1, z, blend(15, [COBBLESTONE, 2], [GRAVEL, 1], [MOSSY_COBBLESTONE, 1]))
      }
    for (const [dx, dz] of [[5, 0], [-5, 0], [0, 5], [0, -5], [4, 3], [-4, 3], [4, -3], [-4, -3], [3, 4], [-3, 4], [3, -4], [-3, -4]]) b.set(mid + dx, top - 1, mid + dz, LANTERN)
    const y = floatingRock(b, this.strata, mid, top, 6, 11, 151, LANTERN)
    broadleaf(b, mid, y, mid, rnd, LOG, LEAVES, 8, 3)
    for (const [x, z] of corners(mid, mid, 4)) slender(b, x, y, z, rnd, BIRCH_LOG, BIRCH_LEAVES)
    meadow(b, mid, y, mid, rnd, plants, [GRASS], 6, 0.5)
    // Leafy fringes hanging off the rock's rim.
    for (let dx = -7; dx <= 7; dx++)
      for (let dz = -7; dz <= 7; dz++) {
        const [x, z] = [mid + dx, mid + dz]
        if (!b.solid(x, y - 1, z) || b.solid(x + 1, y - 1, z) && b.solid(x - 1, y - 1, z) && b.solid(x, y - 1, z + 1) && b.solid(x, y - 1, z - 1)) continue
        if (hash2(x, z, 152) < 0.45) continue
        const hang = 1 + Math.floor(hash2(z, x, 153) * 3)
        let h = y - 2
        while (h > top + 3 && b.solid(x, h, z)) h--
        for (let k = 0; k < hang && h - k > top + 3; k++) b.deco(x, h - k, z, LEAVES)
      }
    if (!safe) for (const [x, z] of corners(mid, mid, 8)) broadleaf(b, x, top, z, rnd, LOG, LEAVES, 5, 2)
    groundDetail(b, mid, top, radius, rnd, [GRASS], plants, blend(16, [MOSSY_COBBLESTONE, 2], [STONE, 1]))
    return [[mid - 1, mid], [mid + 1, mid]]
  },
  scatter(b, area, top, rnd) {
    const cells = natural(b, area, top, [GRASS])
    if (area.safe)
      return safeScatter(b, cells, top, rnd, { tree: (x, z) => sapling(b, x, top, z, rnd, rnd() < 0.4 ? BIRCH_LEAVES : LEAVES), trees: 3, rock: blend(17, [STONE, 2], [MOSSY_COBBLESTONE, 2]), lamp: LANTERN, ground: [GRASS], blooms: plants })
    const taken: [number, number][] = []
    for (const [x, z] of spread(cells, rnd, 2, 4, taken)) (rnd() < 0.35 ? slender(b, x, top, z, rnd, BIRCH_LOG, BIRCH_LEAVES) : broadleaf(b, x, top, z, rnd, LOG, LEAVES))
    for (const [x, z] of spread(cells, rnd, 2, 3, taken)) boulder(b, x, top, z, rnd, blend(18, [STONE, 3], [COBBLESTONE, 2], [MOSSY_COBBLESTONE, 2]))
    for (const [x, z] of spread(cells, rnd, 6, 3, taken)) meadow(b, x, top, z, rnd, plants, [GRASS])
  },
  islet(b, x, y, z, rnd) {
    if (rnd() < 0.5) broadleaf(b, x, y, z, rnd, LOG, LEAVES, 4, 2)
    else slender(b, x, y, z, rnd, BIRCH_LOG, BIRCH_LEAVES)
    meadow(b, x, y, z, rnd, plants, [GRASS], 2, 0.6)
  },
}

const village: Theme = {
  strata: { surface: GRASS, soil: DIRT, rock: STONE, tip: GRAVEL, accents: [GRAVEL, COBBLESTONE] },
  rough: 1,
  style: {
    floor: blend(21, [COBBLESTONE, 3], [GRAVEL, 2], [STONE, 1]),
    trim: STONE_BRICKS,
    path: blend(22, [STONE_BRICKS, 2], [COBBLESTONE, 1]),
    foundation: COBBLESTONE,
    wall: TERRACOTTA.white,
    pillar: DARK_PLANKS,
    beam: DARK_PLANKS,
    roof: ROOF_TILES,
    ridge: DARK_PLANKS,
    roofKind: 'gable',
    lamp: LANTERN,
    forgePad: STONE_BRICKS,
    forgeCore: LANTERN,
    spawnPad: STONE_BRICKS,
    clutter: [HAY, HAY, DARK_PLANKS],
  },
  dressBase(f, _team, rnd) {
    // Lamp posts down the path out of the front, and window boxes along the house.
    for (const side of [-1, 1]) poleLamp(f.b, f.x(9, 3 * side), f.top, f.z(9, 3 * side), LANTERN)
    for (const v of [-8, -4, 4, 8]) if (rnd() < 0.7) f.deco(-7, 0, v, flowerOf(rnd))
  },
  diamond(b, x, z, top, safe, rnd) {
    pad(b, x, z, top, STONE_BRICKS, COBBLESTONE, DARK_PLANKS, LANTERN, safe)
    for (const [hx, hz] of corners(x, z, 3)) if (rnd() < 0.5) b.bump(hx, top, hz, HAY)
    meadow(b, x, top, z, rnd, plants, [GRASS], 4, 0.4)
  },
  middle(b, mid, top, radius, safe, rnd) {
    if (safe) throw new Error('The village square is built for a corner arena, off every lane')
    // A brick-paved square with a fountain in the middle, lantern posts, cobbled paths to the corners and four cottages.
    const lane = blend(23, [COBBLESTONE, 2], [GRAVEL, 1])
    for (let dx = -radius - 2; dx <= radius + 2; dx++)
      for (let dz = -radius - 2; dz <= radius + 2; dz++) {
        if (!b.solid(mid + dx, top - 1, mid + dz)) continue
        const m = Math.max(Math.abs(dx), Math.abs(dz))
        const diagonal = Math.abs(Math.abs(dx) - Math.abs(dz)) <= 1 && m > 6
        if (m <= 6) b.set(mid + dx, top - 1, mid + dz, m === 6 ? STONE_BRICKS : (dx + dz) % 2 === 0 ? BRICK : STONE_BRICKS)
        else if (diagonal) b.set(mid + dx, top - 1, mid + dz, lane)
      }
    // Fountain: a rim, still water, a spout with a lamp and water spilling from its top.
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++) {
        const m = Math.max(Math.abs(dx), Math.abs(dz))
        if (m === 3) b.set(mid + dx, top, mid + dz, (dx + dz) % 2 ? STONE_BRICKS : MOSSY_STONE_BRICKS)
        b.set(mid + dx, top - 1, mid + dz, m === 3 ? STONE_BRICKS : WATER)
      }
    b.fill(mid, top, mid, mid, top + 2, mid, STONE_BRICKS)
    b.set(mid, top + 3, mid, LANTERN)
    for (const [dx, dz] of [[0, 1], [0, -1]]) b.set(mid + dx, top + 2, mid + dz, WATER)
    for (const [x, z] of corners(mid, mid, 6)) lampPost(b, x, top, z, DARK_PLANKS, LANTERN, 3)
    for (const [x, z] of corners(mid, mid, 4)) b.bump(x, top, z, HAY)
    // Cottages on the four sides of the square, doors facing it.
    for (const [ax, az] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) cottage(b, mid + ax * 9, mid + az * 9, top, -ax, -az, rnd)
    return [[mid - 1, mid], [mid + 1, mid]]
  },
  scatter(b, area, top, rnd) {
    const cells = natural(b, area, top, [GRASS])
    if (area.safe) return safeScatter(b, cells, top, rnd, { tree: (x, z) => sapling(b, x, top, z, rnd, LEAVES), trees: 2, rock: HAY, lamp: LANTERN, ground: [GRASS], blooms: plants })
    const taken: [number, number][] = []
    for (const [x, z] of spread(cells, rnd, 2, 4, taken)) broadleaf(b, x, top, z, rnd, LOG, LEAVES, 4, 2)
    for (const [x, z] of spread(cells, rnd, 2, 4, taken)) lampPost(b, x, top, z, DARK_PLANKS, LANTERN, 2)
    for (const [x, z] of spread(cells, rnd, 3, 3, taken)) b.deco(x, top, z, HAY)
    for (const [x, z] of spread(cells, rnd, 6, 3, taken)) meadow(b, x, top, z, rnd, plants, [GRASS])
  },
  islet(b, x, y, z, rnd) {
    if (rnd() < 0.6) broadleaf(b, x, y, z, rnd, LOG, LEAVES, 4, 2)
    else lampPost(b, x, y, z, DARK_PLANKS, LANTERN, 2)
    meadow(b, x, y, z, rnd, plants, [GRASS], 2, 0.5)
  },
}

/** A small plastered cottage with a tiled roof, its open door facing (dx, dz). */
function cottage(b: Builder, x: number, z: number, top: number, dx: number, dz: number, rnd: Random): void {
  for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) if (!b.solid(x + a, top - 1, z + c)) return
  for (let a = -2; a <= 2; a++)
    for (let c = -2; c <= 2; c++) {
      const [cx, cz] = [x + a, z + c]
      const edge = Math.abs(a) === 2 || Math.abs(c) === 2
      const corner = Math.abs(a) === 2 && Math.abs(c) === 2
      b.set(cx, top - 1, cz, PLANKS)
      if (!edge) continue
      for (let h = 0; h < 3; h++) b.set(cx, top + h, cz, corner ? DARK_PLANKS : h === 0 ? COBBLESTONE : TERRACOTTA.white)
      // Windows in the middle of each side, some lit from inside.
      if ((a === 0 || c === 0) && !corner) b.set(cx, top + 1, cz, rnd() < 0.5 ? LANTERN : GLASS)
    }
  // The door: two blocks high in the side facing the square.
  const [ex, ez] = [x + dx * 2, z + dz * 2]
  b.set(ex, top, ez, 0)
  b.set(ex, top + 1, ez, 0)
  // A tiled pyramid roof.
  for (let k = 0; k <= 3; k++) {
    const r = 3 - k
    for (let a = -r; a <= r; a++) for (let c = -r; c <= r; c++) if (Math.max(Math.abs(a), Math.abs(c)) === r || k === 3) b.set(x + a, top + 3 + k, z + c, k === 3 ? DARK_PLANKS : ROOF_TILES)
  }
  b.fill(x - 1, top + 3, z - 1, x + 1, top + 3, z + 1, PLANKS)
}

const sandRock = bands(31, [SANDSTONE, SANDSTONE, TERRACOTTA.orange, SANDSTONE, TERRACOTTA.yellow, SANDSTONE, TERRACOTTA.white])

const desert: Theme = {
  strata: { surface: SAND, soil: SAND, rock: sandRock, tip: TERRACOTTA.orange, accents: [TERRACOTTA.red, CUT_SANDSTONE] },
  rough: 2,
  style: {
    floor: blend(32, [SANDSTONE, 3], [SAND, 2]),
    trim: TERRACOTTA.orange,
    path: (x, _y, z) => ((x + z) % 2 === 0 ? TERRACOTTA.cyan : TERRACOTTA.white),
    foundation: CUT_SANDSTONE,
    wall: SANDSTONE,
    pillar: CUT_SANDSTONE,
    beam: TERRACOTTA.orange,
    roof: SANDSTONE,
    ridge: TERRACOTTA.cyan,
    roofKind: 'flat',
    lamp: LANTERN,
    forgePad: CUT_SANDSTONE,
    forgeCore: LANTERN,
    spawnPad: GOLD_BLOCK,
    clutter: [TERRACOTTA.red, TERRACOTTA.orange, CACTUS],
  },
  dressBase(f, _team, rnd) {
    // Clay pots along the house front.
    for (const v of [-8, -5, 5, 8]) if (rnd() < 0.8) f.bump(-7, v, TERRACOTTA.red)
  },
  diamond(b, x, z, top, safe, rnd) {
    pad(b, x, z, top, CUT_SANDSTONE, TERRACOTTA.orange, SANDSTONE, LANTERN, safe)
    const cells = groundCells(b, x - 4, z - 4, x + 4, z + 4, top, [SAND]).filter(([cx, cz]) => Math.max(Math.abs(cx - x), Math.abs(cz - z)) > 2)
    if (safe) for (const [cx, cz] of spread(cells, rnd, 2, 3)) b.bump(cx, top, cz, CACTUS)
    else for (const [cx, cz] of spread(cells, rnd, 2, 3)) cactus(b, cx, top, cz, rnd)
  },
  middle(b, mid, top, radius, safe, rnd) {
    // The oasis: sandstone paths along the cross, four sunken pools ringed with grass and palms, a gilded centre,
    // and over it all a floating rock bearing a gold-capped pyramid.
    for (let dx = -radius - 2; dx <= radius + 2; dx++)
      for (let dz = -radius - 2; dz <= radius + 2; dz++) {
        const [x, z] = [mid + dx, mid + dz]
        if (!b.solid(x, top - 1, z)) continue
        const [ax, az] = [Math.abs(dx), Math.abs(dz)]
        if (Math.min(ax, az) <= 1) b.set(x, top - 1, z, ax <= 2 && az <= 2 ? CUT_SANDSTONE : SANDSTONE)
        else if (ax >= 4 && ax <= 7 && az >= 4 && az <= 7) {
          // Sunk one block, so the pools read as water in a garden bed; the step down and up is a hop.
          b.set(x, top - 1, z, 0)
          b.set(x, top - 2, z, WATER)
        } else if (ax >= 3 && ax <= 8 && az >= 3 && az <= 8) b.set(x, top - 1, z, GRASS)
      }
    b.set(mid, top - 1, mid, GOLD_BLOCK)
    for (const [x, z] of [...corners(mid, mid, 8), ...corners(mid, mid, 5)]) slimPalm(b, x, top, z, rnd, BIRCH_LEAVES)
    const y = floatingRock(b, this.strata, mid, top, 5, 9, 351, LANTERN)
    pyramid(b, mid, y, mid, 7, SANDSTONE, CUT_SANDSTONE)
    for (const [x, z] of corners(mid, mid, 4)) b.deco(x, y, z, LANTERN)
    if (!safe) for (const [x, z] of corners(mid, mid, 10)) palm(b, x, top, z, rnd, LOG, BIRCH_LEAVES)
    groundDetail(b, mid, top, radius, rnd, [GRASS, SAND], [GRASS_TUFT, FLOWERS.yellow, FLOWERS.red], blend(33, [CACTUS, 1], [TERRACOTTA.orange, 1]))
    return [[mid - 1, mid], [mid + 1, mid]]
  },
  scatter(b, area, top, rnd) {
    const cells = natural(b, area, top, [SAND])
    if (area.safe)
      return safeScatter(b, cells, top, rnd, { tree: (x, z) => slimPalm(b, x, top, z, rnd, BIRCH_LEAVES), trees: 2, rock: blend(34, [CACTUS, 1], [SANDSTONE, 1], [TERRACOTTA.orange, 1]), lamp: LANTERN, ground: [SAND], blooms: [GRASS_TUFT] })
    const taken: [number, number][] = []
    for (const [x, z] of spread(cells, rnd, 1, 6, taken)) pyramid(b, x, top, z, 5, SANDSTONE, CUT_SANDSTONE)
    for (const [x, z] of spread(cells, rnd, 3, 3, taken)) cactus(b, x, top, z, rnd)
    for (const [x, z] of spread(cells, rnd, 1, 5, taken)) palm(b, x, top, z, rnd, LOG, BIRCH_LEAVES)
    for (const [x, z] of spread(cells, rnd, 3, 3, taken)) meadow(b, x, top, z, rnd, [GRASS_TUFT], [SAND], 1, 0.3)
  },
  islet(b, x, y, z, rnd) {
    if (!pyramid(b, x, y, z, rnd() < 0.5 ? 5 : 3, SANDSTONE, CUT_SANDSTONE)) cactus(b, x, y, z, rnd)
    for (const [cx, cz] of corners(x, z, 3)) if (rnd() < 0.4) cactus(b, cx, y, cz, rnd)
  },
}

const frost: Theme = {
  strata: { surface: SNOWY_GRASS, soil: DIRT, rock: STONE, tip: PACKED_ICE, accents: [ICE, PACKED_ICE, GRAVEL] },
  rough: 1.5,
  style: {
    floor: blend(41, [SNOW, 5], [SNOWY_GRASS, 2], [GRAVEL, 1]),
    trim: PACKED_ICE,
    path: blend(42, [STONE_BRICKS, 3], [COBBLESTONE, 1]),
    foundation: STONE_BRICKS,
    wall: DARK_PLANKS,
    pillar: SPRUCE_LOG,
    beam: SPRUCE_LOG,
    roof: DARK_PLANKS,
    ridge: SPRUCE_LOG,
    roofKind: 'snowy',
    lamp: FROST_LAMP,
    forgePad: STONE_BRICKS,
    forgeCore: FROST_LAMP,
    spawnPad: QUARTZ,
    clutter: [SNOW, PACKED_ICE, SPRUCE_LOG],
  },
  dressBase(f, _team, rnd) {
    // Snow drifts along the house front.
    for (const v of [-9, -8, -6, 6, 8, 9]) if (rnd() < 0.6) f.bump(-7, v, SNOW)
  },
  diamond(b, x, z, top, safe, rnd) {
    pad(b, x, z, top, PACKED_ICE, STONE_BRICKS, SPRUCE_LOG, FROST_LAMP, safe)
    const cells = groundCells(b, x - 4, z - 4, x + 4, z + 4, top, [SNOWY_GRASS]).filter(([cx, cz]) => Math.max(Math.abs(cx - x), Math.abs(cz - z)) > 2)
    for (const [cx, cz] of spread(cells, rnd, 2, 3)) (safe ? b.bump(cx, top, cz, SNOW) : iceSpike(b, cx, top, cz, rnd))
  },
  middle(b, mid, top, _radius, safe, rnd) {
    if (safe) throw new Error('The frozen tower is built for a corner arena, off every lane')
    frozenTower(b, mid, top)
    for (const [x, z] of corners(mid, mid, 8)) conifer(b, x, top, z, rnd, SPRUCE_LOG, SPRUCE_LEAVES, true, 9)
    return [[mid - 1, mid], [mid + 1, mid]]
  },
  scatter(b, area, top, rnd) {
    const ground = [SNOWY_GRASS, SNOW]
    const cells = natural(b, area, top, ground)
    // Frozen puddles in the ground itself, anywhere.
    for (const [x, z] of spread(cells, rnd, 2, 4)) for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0]]) if (ground.includes(b.get(x + dx, top - 1, z + dz))) b.set(x + dx, top - 1, z + dz, ICE)
    if (area.safe) return safeScatter(b, cells, top, rnd, { tree: (x, z) => tallSpruce(b, x, top, z, rnd, SPRUCE_LEAVES, true), trees: 3, rock: SNOW, lamp: FROST_LAMP, ground, blooms: [GRASS_TUFT] })
    const taken: [number, number][] = []
    for (const [x, z] of spread(cells, rnd, area.kind === 'middle' ? 4 : 2, 4, taken)) conifer(b, x, top, z, rnd, SPRUCE_LOG, SPRUCE_LEAVES, true)
    for (const [x, z] of spread(cells, rnd, 2, 4, taken)) iceSpike(b, x, top, z, rnd)
    for (const [x, z] of spread(cells, rnd, 3, 3, taken)) boulder(b, x, top, z, rnd, SNOW, 1)
  },
  islet(b, x, y, z, rnd) {
    conifer(b, x, y, z, rnd, SPRUCE_LOG, SPRUCE_LEAVES, true, 6 + Math.floor(rnd() * 3))
    for (const [cx, cz] of corners(x, z, 2)) if (rnd() < 0.4) iceSpike(b, cx, y, cz, rnd)
  },
}

/**
 * A frozen tower over the middle: an ice-walled hall with an arched gate on
 * every side, the emeralds inside, a tower of packed ice and stone with ice
 * windows above, frost lamps on its corner buttresses and a quartz spire.
 */
function frozenTower(b: Builder, mid: number, top: number): void {
  const wall = blend(43, [PACKED_ICE, 3], [STONE_BRICKS, 1])
  for (let dx = -4; dx <= 4; dx++)
    for (let dz = -4; dz <= 4; dz++) {
      const [x, z] = [mid + dx, mid + dz]
      const m = Math.max(Math.abs(dx), Math.abs(dz))
      b.set(x, top - 1, z, m === 4 ? STONE_BRICKS : m <= 1 ? QUARTZ : PACKED_ICE)
      if (m === 4) {
        const gate = Math.min(Math.abs(dx), Math.abs(dz)) <= 1
        for (let h = gate ? 3 : 0; h <= 5; h++) b.set(x, top + h, z, h === 5 ? STONE_BRICKS : wall)
      }
    }
  b.fill(mid - 3, top + 5, mid - 3, mid + 3, top + 5, mid + 3, STONE_BRICKS)
  b.set(mid, top + 4, mid, FROST_LAMP)
  for (let h = 6; h <= 15; h++) {
    const r = h <= 12 ? 3 : 2
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const window = (h % 4 === 1 || h % 4 === 2) && Math.min(Math.abs(dx), Math.abs(dz)) === 0
        b.set(mid + dx, top + h, mid + dz, window ? ICE : h % 5 === 0 ? STONE_BRICKS : PACKED_ICE)
      }
  }
  b.fill(mid - 3, top + 13, mid - 3, mid + 3, top + 13, mid + 3, STONE_BRICKS)
  for (const [x, z] of corners(mid, mid, 3)) b.set(x, top + 14, z, FROST_LAMP)
  b.fill(mid - 2, top + 16, mid - 2, mid + 2, top + 16, mid + 2, QUARTZ)
  for (const [x, z] of corners(mid, mid, 2)) b.set(x, top + 17, z, FROST_LAMP)
  b.fill(mid, top + 17, mid, mid, top + 20, mid, QUARTZ_PILLAR)
  b.set(mid, top + 21, mid, FROST_LAMP)
  // Buttresses at the outer corners, each with a lamp.
  for (const [x, z] of corners(mid, mid, 4)) {
    b.fill(x, top, z, x, top + 7, z, STONE_BRICKS)
    b.set(x, top + 8, z, FROST_LAMP)
  }
}

const ruinRock = blend(51, [STONE, 6], [COBBLESTONE, 2], [MOSSY_COBBLESTONE, 1])

const ruins: Theme = {
  strata: { surface: GRASS, soil: DIRT, rock: ruinRock, tip: MOSSY_COBBLESTONE, accents: [GRAVEL, MOSSY_STONE_BRICKS] },
  rough: 1.5,
  style: {
    floor: blend(52, [GRASS, 4], [MOSSY_COBBLESTONE, 2], [GRAVEL, 1], [STONE_BRICKS, 1]),
    trim: MOSSY_COBBLESTONE,
    path: weathered,
    foundation: MOSSY_COBBLESTONE,
    wall: weathered,
    pillar: STONE_BRICKS,
    beam: weathered,
    roof: weathered,
    ridge: MOSSY_STONE_BRICKS,
    roofKind: 'ruined',
    lamp: LANTERN,
    forgePad: STONE_BRICKS,
    forgeCore: LANTERN,
    spawnPad: CRACKED_STONE_BRICKS,
    clutter: [MOSSY_COBBLESTONE, CRACKED_STONE_BRICKS, MOSSY_STONE_BRICKS],
  },
  dressBase(f, _team, rnd) {
    // Ivy down the house front and flowers at its foot.
    for (const v of [-8, -6, -4, 4, 6, 8]) {
      if (rnd() < 0.6) f.deco(-7, 3, v, LEAVES)
      if (rnd() < 0.4) f.deco(-7, 0, v, flowerOf(rnd))
    }
  },
  diamond(b, x, z, top, safe, rnd) {
    pad(b, x, z, top, weathered, MOSSY_COBBLESTONE, MOSSY_COBBLESTONE, LANTERN, safe)
    const cells = groundCells(b, x - 4, z - 4, x + 4, z + 4, top, [GRASS]).filter(([cx, cz]) => Math.max(Math.abs(cx - x), Math.abs(cz - z)) > 2)
    for (const [cx, cz] of spread(cells, rnd, 2, 3)) (safe ? b.bump(cx, top, cz, CRACKED_STONE_BRICKS) : column(b, cx, top, cz, 2 + Math.floor(rnd() * 3), QUARTZ_PILLAR, MOSSY_STONE_BRICKS))
    meadow(b, x, top, z, rnd, plants, [GRASS], 4, 0.3)
  },
  middle(b, mid, top, radius, safe, rnd) {
    // The old keep's floor on the ground, broken to knee height, and the keep itself floating above it.
    for (let dx = -radius - 2; dx <= radius + 2; dx++)
      for (let dz = -radius - 2; dz <= radius + 2; dz++) {
        const [x, z] = [mid + dx, mid + dz]
        if (!b.solid(x, top - 1, z)) continue
        const m = Math.max(Math.abs(dx), Math.abs(dz))
        if (m <= 7) b.set(x, top - 1, z, m === 7 ? MOSSY_COBBLESTONE : hash2(x, z, 58) < 0.15 ? GRASS : weathered)
      }
    // Knee-high footings of the old walls, broken through on every side.
    for (let i = -7; i <= 7; i++)
      for (const [x, z] of [[mid + i, mid - 7], [mid + i, mid + 7], [mid - 7, mid + i], [mid + 7, mid + i]])
        if (Math.abs(i) > 2 && hash2(x, z, 59) < 0.7) b.bump(x, top, z, weathered)
    for (const [x, z] of corners(mid, mid, 5)) b.bump(x, top, z, QUARTZ_PILLAR)
    b.set(mid, top - 1, mid, LANTERN)
    const y = floatingRock(b, this.strata, mid, top, 7, 10, 551, LANTERN)
    floatingKeep(b, mid, y, rnd)
    if (!safe) for (const [x, z] of corners(mid, mid, 9)) column(b, x, top, z, 4, QUARTZ_PILLAR, MOSSY_STONE_BRICKS)
    groundDetail(b, mid, top, radius, rnd, [GRASS], plants, blend(53, [MOSSY_COBBLESTONE, 2], [CRACKED_STONE_BRICKS, 1]))
    return [[mid - 1, mid], [mid + 1, mid]]
  },
  scatter(b, area, top, rnd) {
    const cells = natural(b, area, top, [GRASS])
    if (area.safe)
      return safeScatter(b, cells, top, rnd, { tree: (x, z) => sapling(b, x, top, z, rnd, LEAVES), trees: 2, rock: blend(54, [MOSSY_COBBLESTONE, 2], [CRACKED_STONE_BRICKS, 1], [QUARTZ_PILLAR, 1]), lamp: LANTERN, ground: [GRASS], blooms: plants })
    const taken: [number, number][] = []
    for (const [x, z] of spread(cells, rnd, 1, 4, taken)) broadleaf(b, x, top, z, rnd, LOG, LEAVES, 5, 2)
    for (const [x, z] of spread(cells, rnd, 3, 3, taken)) column(b, x, top, z, 1 + Math.floor(rnd() * 4), QUARTZ_PILLAR, rnd() < 0.5 ? MOSSY_STONE_BRICKS : CRACKED_STONE_BRICKS)
    for (const [x, z] of spread(cells, rnd, 2, 3, taken)) boulder(b, x, top, z, rnd, blend(55, [MOSSY_COBBLESTONE, 2], [COBBLESTONE, 1], [CRACKED_STONE_BRICKS, 1]), 1)
    for (const [x, z] of spread(cells, rnd, 5, 3, taken)) meadow(b, x, top, z, rnd, plants, [GRASS])
  },
  islet(b, x, y, z, rnd) {
    column(b, x, y, z, 2 + Math.floor(rnd() * 4), QUARTZ_PILLAR, MOSSY_STONE_BRICKS)
    for (const [cx, cz] of corners(x, z, 2)) if (rnd() < 0.5) b.deco(cx, y, cz, rnd() < 0.5 ? MOSSY_COBBLESTONE : CRACKED_STONE_BRICKS)
    meadow(b, x, y, z, rnd, plants, [GRASS], 2, 0.5)
  },
}

/**
 * The keep, on its floating rock: a square of broken curtain walls with
 * crenels and a gate each way, a tower at every corner, a central hall on
 * quartz pillars with a half-fallen roof, lamps, and ivy hanging over the
 * rock's edge.
 */
function floatingKeep(b: Builder, mid: number, y: number, rnd: Random): void {
  for (let dx = -5; dx <= 5; dx++)
    for (let dz = -5; dz <= 5; dz++) {
      const [x, z] = [mid + dx, mid + dz]
      const m = Math.max(Math.abs(dx), Math.abs(dz))
      if (m <= 5 && b.solid(x, y - 1, z)) b.set(x, y - 1, z, m <= 2 ? weathered : hash2(x, z, 61) < 0.4 ? GRASS : MOSSY_COBBLESTONE)
      if (m !== 5) continue
      if (Math.min(Math.abs(dx), Math.abs(dz)) <= 1) {
        b.fill(x, y + 3, z, x, y + 4, z, weathered)
        continue
      }
      const high = 2 + Math.floor(hash2(x, z, 62) * 4)
      for (let h = 0; h <= high; h++) b.set(x, y + h, z, weathered)
      if (high >= 4 && (dx + dz) % 2 === 0) b.set(x, y + high + 1, z, weathered)
    }
  for (const [cx, cz] of corners(mid, mid, 5)) {
    for (let h = 0; h <= 8; h++) for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (h < 8 || (dx + dz) % 2 === 0) b.set(cx + dx, y + h, cz + dz, h === 8 ? MOSSY_STONE_BRICKS : weathered)
    b.set(cx, y + 9, cz, LANTERN)
  }
  for (const [x, z] of corners(mid, mid, 2)) b.fill(x, y, z, x, y + 4, z, QUARTZ_PILLAR)
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (rnd() < 0.7 || Math.max(Math.abs(dx), Math.abs(dz)) === 2) b.set(mid + dx, y + 5, mid + dz, weathered)
  b.set(mid, y + 4, mid, LANTERN)
  // Ivy over the rock's rim.
  for (let dx = -8; dx <= 8; dx++)
    for (let dz = -8; dz <= 8; dz++) {
      const [x, z] = [mid + dx, mid + dz]
      if (!b.solid(x, y - 1, z) || hash2(x, z, 63) < 0.6) continue
      if (b.solid(x + 1, y - 1, z) && b.solid(x - 1, y - 1, z) && b.solid(x, y - 1, z + 1) && b.solid(x, y - 1, z - 1)) continue
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!b.solid(x + ox, y - 1, z + oz)) for (let k = 1; k <= 1 + Math.floor(hash2(z, x, 64) * 3); k++) b.deco(x + ox, y - k, z + oz, LEAVES)
    }
}

export const THEMES: Record<ThemeId, Theme> = { forest, village, desert, frost, ruins }
