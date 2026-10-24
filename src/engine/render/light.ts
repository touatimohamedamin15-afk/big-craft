import { blockDef, isOpaqueCube } from '../blocks'
import type { World } from '../world'

export const MAX_LIGHT = 15

export type Box = [number, number, number, number, number, number]

/** Sunlight levels of a world of the given size, readable without the world (the renderer keeps a copy of its worker's). */
export class LightLevels {
  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
    readonly levels = new Uint8Array(sx * sy * sz),
  ) {}

  get(x: number, y: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.sx || z >= this.sz || y >= this.sy) return MAX_LIGHT
    if (y < 0) return 0
    return this.levels[(y * this.sz + z) * this.sx + x]
  }

  /** The levels inside an inclusive box, packed x fastest, then z, then y. */
  readBox([x0, y0, z0, x1, y1, z1]: Box): Uint8Array {
    const out = new Uint8Array((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1))
    let i = 0
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const row = (y * this.sz + z) * this.sx
        out.set(this.levels.subarray(row + x0, row + x1 + 1), i)
        i += x1 - x0 + 1
      }
    return out
  }

  /** Writes back what `readBox` packed. */
  writeBox([x0, y0, z0, x1, y1, z1]: Box, data: Uint8Array): void {
    let i = 0
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        this.levels.set(data.subarray(i, i + x1 - x0 + 1), (y * this.sz + z) * this.sx + x0)
        i += x1 - x0 + 1
      }
  }
}

/**
 * Sunlight, 0..15 per cell: full in columns open to the sky, then flooded
 * outward losing a level per step, so bridges and island undersides fall
 * into soft shade. A compact TypeScript take on Voxelize's sunlight pass
 * (column seeding, then a flat ring-buffer BFS), for one fixed-size world.
 * Voxelize is MIT, (c) 2022 Shaoru Ian Huang.
 */
export class SunLight extends LightLevels {
  private pending: [number, number, number, number] | null = null
  /** Light from glowing blocks (lamps, lanterns), 0..15, kept beside sunlight; drawn warm. */
  readonly block: Uint8Array

  constructor(readonly world: World) {
    super(world.sx, world.sy, world.sz)
    this.block = new Uint8Array(world.sx * world.sy * world.sz)
    this.recompute(0, 0, world.sx - 1, world.sz - 1)
  }

  getBlock(x: number, y: number, z: number): number {
    if (x < 0 || z < 0 || y < 0 || x >= this.sx || z >= this.sz || y >= this.sy) return 0
    return this.block[(y * this.sz + z) * this.sx + x]
  }

  /** Whether changes are waiting for `flush`. */
  get queued(): boolean {
    return this.pending !== null
  }

  /** Remember a changed cell; `flush` recomputes once for everything queued. */
  queueChange(x: number, z: number): void {
    const p = this.pending
    this.pending = p ? [Math.min(p[0], x), Math.min(p[1], z), Math.max(p[2], x), Math.max(p[3], z)] : [x, z, x, z]
  }

  /** Recomputes around queued changes; returns the cells whose light changed as [x0,y0,z0,x1,y1,z1], or null. */
  flush(): Box | null {
    if (!this.pending) return null
    const [ax, az, bx, bz] = this.pending
    this.pending = null
    const r = MAX_LIGHT
    const x0 = Math.max(0, ax - r)
    const z0 = Math.max(0, az - r)
    const x1 = Math.min(this.world.sx - 1, bx + r)
    const z1 = Math.min(this.world.sz - 1, bz + r)
    const before = this.snapshot(x0, z0, x1, z1)
    this.recompute(x0, z0, x1, z1)
    return this.diff(before, x0, z0, x1, z1)
  }

  /** Both channels in one byte per cell (sun low nibble, block high), for the before/after diff. */
  private snapshot(x0: number, z0: number, x1: number, z1: number): Uint8Array {
    const w = this.world
    const out = new Uint8Array((x1 - x0 + 1) * w.sy * (z1 - z0 + 1))
    let i = 0
    for (let y = 0; y < w.sy; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const j = (y * w.sz + z) * w.sx + x
          out[i++] = this.levels[j] | (this.block[j] << 4)
        }
    return out
  }

  private diff(before: Uint8Array, x0: number, z0: number, x1: number, z1: number) {
    const w = this.world
    let box: Box | null = null
    let i = 0
    for (let y = 0; y < w.sy; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const j = (y * w.sz + z) * w.sx + x
          if (before[i++] === (this.levels[j] | (this.block[j] << 4))) continue
          if (!box) box = [x, y, z, x, y, z]
          else {
            box[0] = Math.min(box[0], x)
            box[1] = Math.min(box[1], y)
            box[2] = Math.min(box[2], z)
            box[3] = Math.max(box[3], x)
            box[4] = Math.max(box[4], y)
            box[5] = Math.max(box[5], z)
          }
        }
    return box
  }

  /** Full recompute of the columns x0..x1, z0..z1, seeded from the edges of the region as they are. */
  private recompute(x0: number, z0: number, x1: number, z1: number): void {
    const w = this.world
    const L = this.levels
    const sx = w.sx
    const sxz = w.sx * w.sz
    // Direct sun stops at the first block that is opaque or dims light (leaves).
    const stops = (x: number, y: number, z: number) => {
      const def = blockDef(w.get(x, y, z))
      return isOpaqueCube(def) || (def.lightCost ?? 0) > 0
    }
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        let open = true
        for (let y = w.sy - 1; y >= 0; y--) {
          const i = y * sxz + z * sx + x
          if (open && stops(x, y, z)) open = false
          L[i] = open ? MAX_LIGHT : 0
        }
      }
    // Seeds: every lit cell in the region and its outer ring (which keeps its
    // old value), bucketed by level and spread brightest first, so each cell
    // is final the first time it is set.
    const buckets: number[][] = Array.from({ length: MAX_LIGHT + 1 }, () => [])
    for (let y = 0; y < w.sy; y++)
      for (let z = Math.max(0, z0 - 1); z <= Math.min(w.sz - 1, z1 + 1); z++)
        for (let x = Math.max(0, x0 - 1); x <= Math.min(sx - 1, x1 + 1); x++) {
          const i = y * sxz + z * sx + x
          if (L[i] > 1) buckets[L[i]].push(i)
        }
    for (let level = MAX_LIGHT; level > 1; level--) {
      const bucket = buckets[level]
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k]
        if (L[i] !== level) continue
        const y = Math.floor(i / sxz)
        const z = Math.floor((i % sxz) / sx)
        const x = i % sx
        for (let d = 0; d < 6; d++) {
          const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0)
          const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0)
          const nz = z + (d === 4 ? 1 : d === 5 ? -1 : 0)
          if (nx < x0 || nx > x1 || nz < z0 || nz > z1 || ny < 0 || ny >= w.sy) continue
          const def = blockDef(w.get(nx, ny, nz))
          if (isOpaqueCube(def)) continue
          const next = level - 1 - (def.lightCost ?? 0)
          const j = ny * sxz + nz * sx + nx
          if (next > L[j]) {
            L[j] = next
            if (next > 1) buckets[next].push(j)
          }
        }
      }
    }
    this.recomputeBlock(x0, z0, x1, z1)
  }

  /**
   * Block light in the same columns: cleared, then flooded from every glowing
   * block inside and from the ring just outside (which keeps its old value,
   * carrying light from lamps beyond the region in).
   */
  private recomputeBlock(x0: number, z0: number, x1: number, z1: number): void {
    const w = this.world
    const B = this.block
    const sx = w.sx
    const sxz = w.sx * w.sz
    const buckets: number[][] = Array.from({ length: MAX_LIGHT + 1 }, () => [])
    for (let y = 0; y < w.sy; y++)
      for (let z = Math.max(0, z0 - 1); z <= Math.min(w.sz - 1, z1 + 1); z++)
        for (let x = Math.max(0, x0 - 1); x <= Math.min(sx - 1, x1 + 1); x++) {
          const i = y * sxz + z * sx + x
          const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1
          if (inside) B[i] = Math.min(MAX_LIGHT, blockDef(w.get(x, y, z)).lightLevel ?? 0)
          if (B[i] > 1) buckets[B[i]].push(i)
        }
    for (let level = MAX_LIGHT; level > 1; level--) {
      const bucket = buckets[level]
      for (let k = 0; k < bucket.length; k++) {
        const i = bucket[k]
        if (B[i] !== level) continue
        const y = Math.floor(i / sxz)
        const z = Math.floor((i % sxz) / sx)
        const x = i % sx
        for (let d = 0; d < 6; d++) {
          const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0)
          const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0)
          const nz = z + (d === 4 ? 1 : d === 5 ? -1 : 0)
          if (nx < x0 || nx > x1 || nz < z0 || nz > z1 || ny < 0 || ny >= w.sy) continue
          const def = blockDef(w.get(nx, ny, nz))
          if (isOpaqueCube(def) && !def.lightLevel) continue
          const next = level - 1 - (def.lightCost ?? 0)
          const j = ny * sxz + nz * sx + nx
          if (next > B[j]) {
            B[j] = next
            if (next > 1) buckets[next].push(j)
          }
        }
      }
    }
  }
}
