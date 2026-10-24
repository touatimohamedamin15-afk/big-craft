import { CACTUS, CHAIN, GOLD_BLOCK, ICE, PACKED_ICE, POLE, SNOWY_LEAVES } from '../blocks'
import { pick, type Builder, type Mat } from './builder'

/*
 * Decorations, placed with `Builder.deco` so none of them lands in a walkway
 * or on top of something else. Coordinates are world cells; `y` is the
 * first cell above the ground.
 */

export type Random = () => number

const between = (rnd: Random, lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

/** A broadleaf tree: a trunk and a round, slightly ragged canopy. */
export function broadleaf(b: Builder, x: number, y: number, z: number, rnd: Random, log: Mat, leaves: Mat, height = between(rnd, 4, 6), spread = 2): void {
  if (!b.free(x, y, z, x, y + height - 1, z)) return
  for (let dy = height - 3; dy <= height + 1; dy++) {
    const r = dy >= height ? spread - 1 : spread
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r
        if (corner && (dy === height + 1 || rnd() < 0.6)) continue
        if (dy === height + 1 && Math.abs(dx) + Math.abs(dz) > 1) continue
        b.deco(x + dx, y + dy, z + dz, leaves)
      }
  }
  for (let dy = 0; dy < height; dy++) b.set(x, y + dy, z, log)
}

/** A tall, narrow tree (birch): a long trunk and a tight canopy. */
export function slender(b: Builder, x: number, y: number, z: number, rnd: Random, log: Mat, leaves: Mat): void {
  const height = between(rnd, 5, 7)
  if (!b.free(x, y, z, x, y + height - 1, z)) return
  for (let dy = height - 3; dy <= height; dy++) {
    const r = dy === height ? 0 : dy === height - 3 ? 1 : 1
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (!(Math.abs(dx) + Math.abs(dz) === 2 && rnd() < 0.5)) b.deco(x + dx, y + dy, z + dz, leaves)
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) b.deco(x + dx, y + height - 1, z + dz, leaves)
  b.deco(x, y + height, z, leaves)
  for (let dy = 0; dy < height; dy++) b.set(x, y + dy, z, log)
}

/** A conifer: tiers of leaves narrowing up a tall trunk, snow on top when `snowy`. */
export function conifer(b: Builder, x: number, y: number, z: number, rnd: Random, log: Mat, leaves: Mat, snowy = false, height = between(rnd, 7, 10)): void {
  if (!b.free(x, y, z, x, y + height - 1, z)) return
  const cells: [number, number, number][] = []
  let r = height > 8 ? 3 : 2
  for (let dy = 2; dy <= height; dy++) {
    const tier = dy === height ? 0 : (height - dy) % 2 === 0 ? Math.max(0, r - 1) : r
    for (let dx = -tier; dx <= tier; dx++)
      for (let dz = -tier; dz <= tier; dz++) {
        if (tier > 1 && Math.abs(dx) === tier && Math.abs(dz) === tier) continue
        if (tier > 0 && Math.abs(dx) + Math.abs(dz) > tier + 1) continue
        cells.push([x + dx, y + dy, z + dz])
      }
    if ((height - dy) % 2 === 1 && dy > height / 2) r = Math.max(1, r - 1)
  }
  cells.push([x, y + height + 1, z])
  for (const [cx, cy, cz] of cells) b.deco(cx, cy, cz, leaves)
  for (let dy = 0; dy < height; dy++) b.set(x, y + dy, z, log)
  if (snowy) for (const [cx, cy, cz] of cells) if (b.get(cx, cy, cz) === pick(leaves, cx, cy, cz) && b.get(cx, cy + 1, cz) === 0) b.set(cx, cy, cz, SNOWY_LEAVES)
}

/** A palm: a leaning trunk and a crown of drooping fronds. */
export function palm(b: Builder, x: number, y: number, z: number, rnd: Random, log: Mat, leaves: Mat): void {
  const height = between(rnd, 5, 7)
  const [lx, lz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][between(rnd, 0, 3)]
  const lean = (dy: number) => (dy > height / 2 ? 1 : 0)
  for (let dy = 0; dy < height; dy++) if (!b.free(x + lx * lean(dy), y + dy, z + lz * lean(dy), x + lx * lean(dy), y + dy, z + lz * lean(dy))) return
  for (let dy = 0; dy < height; dy++) b.set(x + lx * lean(dy), y + dy, z + lz * lean(dy), log)
  const tx = x + lx
  const tz = z + lz
  const ty = y + height
  b.deco(tx, ty, tz, leaves)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const long = dx === 0 || dz === 0
    b.deco(tx + dx, ty, tz + dz, leaves)
    b.deco(tx + dx * 2, long ? ty : ty - 1, tz + dz * 2, leaves)
    if (long) b.deco(tx + dx * 3, ty - 1, tz + dz * 3, leaves)
  }
}

/*
 * Trees for ground people walk on: a non-solid pole for a trunk and every
 * leaf at least three blocks up, so nothing stands in anyone's way.
 */

/** A young broadleaf: a thin trunk and a round crown overhead. */
export function sapling(b: Builder, x: number, y: number, z: number, rnd: Random, leaves: Mat, trunk = POLE): void {
  const height = between(rnd, 4, 5)
  if (!b.free(x, y, z, x, y + height, z)) return
  for (let dy = 3; dy <= height + 1; dy++) {
    const r = dy === height + 1 ? 0 : dy === 3 ? 1 : 2
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.abs(dx) + Math.abs(dz) <= r + (r === 2 ? 1 : 0) && !(r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) && rnd() > 0.08) b.deco(x + dx, y + dy, z + dz, leaves)
  }
  for (let dy = 0; dy < height; dy++) b.set(x, y + dy, z, trunk)
}

/** A palm on a thin trunk with a crown of drooping fronds. */
export function slimPalm(b: Builder, x: number, y: number, z: number, rnd: Random, leaves: Mat, trunk = POLE): void {
  const height = between(rnd, 5, 6)
  if (!b.free(x, y, z, x, y + height, z)) return
  for (let dy = 0; dy < height; dy++) b.set(x, y + dy, z, trunk)
  const ty = y + height
  b.deco(x, ty, z, leaves)
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const long = dx === 0 || dz === 0
    b.deco(x + dx, ty, z + dz, leaves)
    b.deco(x + dx * 2, long ? ty : ty - 1, z + dz * 2, leaves)
    if (long) b.deco(x + dx * 3, ty - 1, z + dz * 3, leaves)
  }
}

/** A spruce whose lowest tier starts three up: a thin bare trunk, then snow-topped tiers. */
export function tallSpruce(b: Builder, x: number, y: number, z: number, rnd: Random, leaves: Mat, snowy: boolean, trunk = POLE): void {
  const height = between(rnd, 6, 8)
  if (!b.free(x, y, z, x, y + height, z)) return
  const cells: [number, number, number][] = []
  for (let dy = 3; dy <= height; dy++) {
    const r = dy === height ? 0 : (height - dy) % 2 === 0 ? 1 : dy < height - 2 ? 2 : 1
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (Math.abs(dx) + Math.abs(dz) <= r + (r > 1 ? 0 : 1) && !(r > 0 && Math.abs(dx) === r && Math.abs(dz) === r && r > 1)) cells.push([x + dx, y + dy, z + dz])
  }
  cells.push([x, y + height + 1, z])
  for (const [cx, cy, cz] of cells) b.deco(cx, cy, cz, leaves)
  for (let dy = 0; dy < height; dy++) b.set(x, y + dy, z, trunk)
  if (snowy) for (const [cx, cy, cz] of cells) if (b.get(cx, cy, cz) === pick(leaves, cx, cy, cz) && b.get(cx, cy + 1, cz) === 0) b.set(cx, cy, cz, SNOWY_LEAVES)
}

/** Chains hanging from `y1` (exclusive, the block above) down to `y0`. */
export function chain(b: Builder, x: number, y0: number, y1: number, z: number): void {
  for (let y = y0; y < y1; y++) if (b.get(x, y, z) === 0) b.set(x, y, z, CHAIN)
}

/** A boulder of mixed stone, one to three blocks across. */
export function boulder(b: Builder, x: number, y: number, z: number, rnd: Random, stone: Mat, size = between(rnd, 1, 2)): void {
  for (let dx = -size; dx <= size; dx++)
    for (let dz = -size; dz <= size; dz++)
      for (let dy = 0; dy < size + 1; dy++) {
        const d = Math.hypot(dx, dy * 1.3, dz)
        if (d > size + 0.2 || (d > size - 0.4 && rnd() < 0.4)) continue
        if (dy > 0 && !b.solid(x + dx, y + dy - 1, z + dz)) continue
        b.deco(x + dx, y + dy, z + dz, stone)
      }
}

/** A post with a lamp on top. */
export function lampPost(b: Builder, x: number, y: number, z: number, post: Mat, lamp: number, height = 2): boolean {
  if (!b.free(x, y, z, x, y + height, z) || !b.solid(x, y - 1, z)) return false
  for (let dy = 0; dy < height; dy++) b.set(x, y + dy, z, post)
  b.set(x, y + height, z, lamp)
  return true
}

/** Flowers and grass tufts dotted over the ground around a point, only on `ground`. */
export function meadow(b: Builder, x: number, y: number, z: number, rnd: Random, plants: readonly number[], ground: readonly number[], radius = 2, density = 0.45): void {
  for (let dx = -radius; dx <= radius; dx++)
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz > radius * radius + 1 || rnd() > density) continue
      if (!ground.includes(b.get(x + dx, y - 1, z + dz))) continue
      b.deco(x + dx, y, z + dz, plants[Math.floor(rnd() * plants.length)])
    }
}

/** A cactus column, sometimes with an arm. */
export function cactus(b: Builder, x: number, y: number, z: number, rnd: Random): void {
  const height = between(rnd, 2, 4)
  if (!b.free(x, y, z, x, y + height - 1, z)) return
  for (let dy = 0; dy < height; dy++) b.set(x, y + dy, z, CACTUS)
  if (height >= 3 && rnd() < 0.6) {
    const [dx, dz] = [[1, 0], [-1, 0], [0, 1], [0, -1]][between(rnd, 0, 3)]
    if (b.free(x + dx, y + 1, z + dz, x + dx, y + 2, z + dz)) {
      b.set(x + dx, y + 1, z + dz, CACTUS)
      b.set(x + dx, y + 2, z + dz, CACTUS)
    }
  }
}

/** A stepped pyramid `size` blocks across (odd), capped with gold. */
export function pyramid(b: Builder, x: number, y: number, z: number, size: number, stone: Mat, trim: Mat): boolean {
  const r = (size - 1) / 2
  if (!b.free(x - r, y, z - r, x + r, y + r, z + r)) return false
  for (let dy = 0; dy <= r; dy++) {
    const s = r - dy
    for (let dx = -s; dx <= s; dx++) for (let dz = -s; dz <= s; dz++) b.set(x + dx, y + dy, z + dz, dy === r ? GOLD_BLOCK : Math.max(Math.abs(dx), Math.abs(dz)) === s && dy % 2 === 1 ? trim : stone)
  }
  return true
}

/** An ice spike: a tapering column of packed ice with an ice tip. */
export function iceSpike(b: Builder, x: number, y: number, z: number, rnd: Random): void {
  const height = between(rnd, 3, 6)
  if (!b.free(x, y, z, x, y + height, z)) return
  for (let dy = 0; dy < height; dy++) b.set(x, y + dy, z, dy < height - 1 ? PACKED_ICE : ICE)
  if (height > 4) for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) if (rnd() < 0.6) b.deco(x + dx, y, z + dz, PACKED_ICE)
}

/** A column with a wider capital, optionally broken off short. */
export function column(b: Builder, x: number, y: number, z: number, height: number, shaft: Mat, capital: Mat): void {
  if (!b.free(x, y, z, x, y + height - 1, z)) return
  for (let dy = 0; dy < height - 1; dy++) b.set(x, y + dy, z, shaft)
  b.set(x, y + height - 1, z, capital)
}

/** Picks the cells of an island's natural ground (not paving) where something could stand. */
export function groundCells(b: Builder, x0: number, z0: number, x1: number, z1: number, y: number, ground: readonly number[]): [number, number][] {
  const out: [number, number][] = []
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (ground.includes(b.get(x, y - 1, z)) && b.free(x, y, z, x, y + 1, z)) out.push([x, z])
  return out
}

/** Deterministic shuffle. */
export function shuffle<T>(items: T[], rnd: Random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/** Picks up to `count` spots from `cells`, at least `spacing` apart and from `taken`. */
export function spread(cells: [number, number][], rnd: Random, count: number, spacing: number, taken: [number, number][] = []): [number, number][] {
  const out: [number, number][] = []
  for (const c of shuffle([...cells], rnd)) {
    if (out.length >= count) break
    if ([...taken, ...out].some((o) => Math.hypot(o[0] - c[0], o[1] - c[1]) < spacing)) continue
    out.push(c)
  }
  taken.push(...out)
  return out
}
