import { hash2 } from './random'
import type { World } from './world'

/** Terrain for floating-island worlds: plain box fills and layered, noise-shaped islands. */

export function box(world: World, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
  world.fill(x0, y0, z0, x1, y1, z1, id)
}

/** Smooth value noise in [0, 1): seeded lattice values every `scale` cells, blended with a smoothstep. */
function valueNoise2(x: number, z: number, scale: number, seed = 0): number {
  const fx = x / scale
  const fz = z / scale
  const x0 = Math.floor(fx)
  const z0 = Math.floor(fz)
  const tx = fx - x0
  const tz = fz - z0
  const sx = tx * tx * (3 - 2 * tx)
  const sz = tz * tz * (3 - 2 * tz)
  const a = hash2(x0, z0, seed)
  const b = hash2(x0 + 1, z0, seed)
  const c = hash2(x0, z0 + 1, seed)
  const d = hash2(x0 + 1, z0 + 1, seed)
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz
}

/** A block id, or a rule that picks one per cell (banded rock, mixed soil). */
export type Layer = number | ((x: number, y: number, z: number) => number)

/** Layers of a floating island, top down. */
export interface IslandStrata {
  /** The walking surface, one block at `top - 1`. */
  surface: Layer
  /** Two to three blocks under the surface. */
  soil: Layer
  /** The bulk of the underside. */
  rock: Layer
  /** The last block or two of the hanging tip; defaults to `rock`. */
  tip?: Layer
  /** Occasional cells mixed into the rock (ore, gravel, moss). */
  accents?: readonly number[]
}

export interface IslandShape {
  cx: number
  cz: number
  /** Half-sizes the outline never shrinks below. */
  rx: number
  rz: number
  top: number
  /** Deepest point under the middle. */
  depth: number
  seed: number
  /** Blocks the outline may bulge out past the half-sizes; 0 keeps a clean squircle. */
  rough?: number
  /** Squircle exponent: 2 is an ellipse, 4 (the default) a rounded square. */
  squareness?: number
  /** Lowest y the underside may reach (for islands floating over something). */
  bottom?: number
}

/**
 * A layered floating island: surface, soil and rock strata over a hanging,
 * uneven underside. The outline bulges out by up to `rough` blocks with
 * smooth angular noise, the top layers overhang the ones below them, and
 * stalactites and accent cells break up the rock. Deterministic per seed.
 * Returns the number of columns it filled.
 */
export function layeredIsland(world: World, strata: IslandStrata, shape: IslandShape): number {
  const { cx, cz, rx, rz, top, depth, seed } = shape
  const rough = shape.rough ?? 0
  const p = shape.squareness ?? 4
  // Angular noise for the outline: eight lattice values around the circle, blended.
  const bulge = (angle: number) => {
    const t = ((angle / (Math.PI * 2) + 1) % 1) * 8
    const i = Math.floor(t)
    const f = t - i
    const s = f * f * (3 - 2 * f)
    return hash2(i % 8, 0, seed + 71) * (1 - s) + hash2((i + 1) % 8, 0, seed + 71) * s
  }
  let columns = 0
  const reach = Math.ceil(rough) + 1
  for (let x = Math.floor(cx - rx - reach); x <= Math.ceil(cx + rx + reach); x++)
    for (let z = Math.floor(cz - rz - reach); z <= Math.ceil(cz + rz + reach); z++) {
      const dx = x + 0.5 - cx
      const dz = z + 0.5 - cz
      const angle = Math.atan2(dz, dx)
      const grow = rough * bulge(angle)
      const nx = dx / (rx + 0.5 + grow)
      const nz = dz / (rz + 0.5 + grow)
      const d = Math.pow(Math.pow(Math.abs(nx), p) + Math.pow(Math.abs(nz), p), 1 / p)
      if (d > 1) continue
      columns++
      const lump = valueNoise2(x, z, 4, seed)
      const grain = hash2(x, z, seed)
      let below = Math.max(1, Math.round((1 - d * d) * depth * (0.7 + lump * 0.6) + grain * 1.5))
      // Hanging spikes under the inner part.
      if (d < 0.8 && hash2(x, z, seed + 9) > 0.94) below += 2 + Math.floor(hash2(z, x, seed + 9) * 4)
      // The rim is a thin lip: soil only where the island has some body.
      const soilDepth = d > 0.9 ? 0 : 2 + Math.floor(valueNoise2(x, z, 3, seed + 3) * 2)
      for (let y = Math.max(top - below, shape.bottom ?? -Infinity); y < top; y++) {
        const fromTop = top - 1 - y
        let layer = fromTop === 0 ? strata.surface : fromTop <= soilDepth ? strata.soil : strata.rock
        if (fromTop > soilDepth && strata.tip !== undefined && y - (top - below) < 2 && below > 3) layer = strata.tip
        if (fromTop > soilDepth && strata.accents?.length && hash2(x * 7 + y, z, seed + 13) > 0.95)
          layer = strata.accents[Math.floor(hash2(z, x * 3 + y, seed + 17) * strata.accents.length)]
        world.set(x, y, z, typeof layer === 'number' ? layer : layer(x, y, z))
      }
    }
  return columns
}
