import { AIR, blockDef } from '../blocks'
import type { World } from '../../../engine/world'

/** A block, or a rule that picks one per cell (weathered stone, mixed paving). */
export type Mat = number | ((x: number, y: number, z: number) => number)

export function pick(m: Mat, x: number, y: number, z: number): number {
  return typeof m === 'number' ? m : m(x, y, z)
}

/**
 * Writes a generated map into a world, and keeps a mask of cells that must
 * stay clear: the walkways between bases and the walks inside each base,
 * which bots (and people) use and cannot dig through, since map blocks are
 * unbreakable. Structures are laid out around the walkways on purpose;
 * decorations skip reserved cells on their own, and `carve` clears anything
 * left in one as a last guarantee.
 */
export class Builder {
  private readonly keep: Uint8Array

  constructor(readonly world: World) {
    this.keep = new Uint8Array(world.sx * world.sy * world.sz)
  }

  private index(x: number, y: number, z: number): number {
    return (y * this.world.sz + z) * this.world.sx + x
  }

  reserve(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(this.world.sy - 1, Math.max(y0, y1)); y++)
      for (let z = Math.max(0, Math.min(z0, z1)); z <= Math.min(this.world.sz - 1, Math.max(z0, z1)); z++)
        for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(this.world.sx - 1, Math.max(x0, x1)); x++) this.keep[this.index(x, y, z)] = 1
  }

  reserved(x: number, y: number, z: number): boolean {
    return this.world.inBounds(x, y, z) && this.keep[this.index(x, y, z)] === 1
  }

  get(x: number, y: number, z: number): number {
    return this.world.get(x, y, z)
  }

  solid(x: number, y: number, z: number): boolean {
    return blockDef(this.world.get(x, y, z)).solid
  }

  /** Places a block regardless of reservations: structure that was laid out around them. */
  set(x: number, y: number, z: number, m: Mat): void {
    if (this.world.inBounds(x, y, z)) this.world.cells[this.index(x, y, z)] = pick(m, x, y, z)
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: Mat): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, m)
  }

  /** Places a decoration into air, unless the cell is reserved. */
  deco(x: number, y: number, z: number, m: Mat): boolean {
    if (!this.world.inBounds(x, y, z) || this.reserved(x, y, z) || this.world.get(x, y, z) !== AIR) return false
    this.set(x, y, z, m)
    return true
  }

  /**
   * Places a one-block-high obstacle on open ground that anyone can hop
   * over: the two cells above it and the cell above each neighbour stay
   * free, and it keeps off the island's edge. Bots jump such blocks; a
   * taller or roofed-over one would stop them for good.
   */
  bump(x: number, y: number, z: number, m: Mat): boolean {
    if (!this.free(x, y, z, x, y + 2, z) || !this.solid(x, y - 1, z)) return false
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (this.world.get(x + dx, y + 2, z + dz) !== AIR || this.world.get(x + dx, y + 1, z + dz) !== AIR) return false
        if (!this.solid(x + dx, y - 1, z + dz)) return false
      }
    this.set(x, y, z, m)
    return true
  }

  /** Whether every cell of a box is air and unreserved, so a whole decoration fits. */
  free(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) if (!this.world.inBounds(x, y, z) || this.reserved(x, y, z) || this.world.get(x, y, z) !== AIR) return false
    return true
  }

  /** Clears every reserved cell. */
  carve(): void {
    for (let i = 0; i < this.keep.length; i++) if (this.keep[i]) this.world.cells[i] = AIR
  }
}

/**
 * A base's own coordinates: `u` runs from the back (forge) toward the front
 * (bed, then the way out), `v` across, and `h` is height above the floor
 * players stand on (`h = -1` is the floor block).
 */
export class Frame {
  readonly ux: number
  readonly uz: number
  readonly vx: number
  readonly vz: number

  constructor(
    readonly b: Builder,
    readonly cx: number,
    readonly cz: number,
    out: readonly [number, number],
    readonly top: number,
  ) {
    this.ux = -out[0]
    this.uz = -out[1]
    this.vx = -out[1]
    this.vz = out[0]
  }

  x(u: number, v: number): number {
    return this.cx + u * this.ux + v * this.vx
  }

  z(u: number, v: number): number {
    return this.cz + u * this.uz + v * this.vz
  }

  set(u: number, h: number, v: number, m: Mat): void {
    this.b.set(this.x(u, v), this.top + h, this.z(u, v), m)
  }

  fill(u0: number, h0: number, v0: number, u1: number, h1: number, v1: number, m: Mat): void {
    for (let u = Math.min(u0, u1); u <= Math.max(u0, u1); u++)
      for (let v = Math.min(v0, v1); v <= Math.max(v0, v1); v++) for (let h = Math.min(h0, h1); h <= Math.max(h0, h1); h++) this.set(u, h, v, m)
  }

  deco(u: number, h: number, v: number, m: Mat): boolean {
    return this.b.deco(this.x(u, v), this.top + h, this.z(u, v), m)
  }

  reserved(u: number, h: number, v: number): boolean {
    return this.b.reserved(this.x(u, v), this.top + h, this.z(u, v))
  }

  /** A hop-over block on the floor; see `Builder.bump`. */
  bump(u: number, v: number, m: Mat): boolean {
    return this.b.bump(this.x(u, v), this.top, this.z(u, v), m)
  }

  solid(u: number, h: number, v: number): boolean {
    return this.b.solid(this.x(u, v), this.top + h, this.z(u, v))
  }

  reserve(u0: number, h0: number, v0: number, u1: number, h1: number, v1: number): void {
    this.b.reserve(this.x(u0, v0), this.top + h0, this.z(u0, v0), this.x(u1, v1), this.top + h1, this.z(u1, v1))
  }

  /** Reserves the cells within `radius` of a straight walk between two cell centres, `h` 0 to 2. */
  reserveWalk(a: readonly [number, number], c: readonly [number, number], radius = 1): void {
    const [au, av] = a
    const [cu, cv] = c
    const len = Math.hypot(cu - au, cv - av) || 1
    for (let u = Math.floor(Math.min(au, cu) - radius - 1); u <= Math.ceil(Math.max(au, cu) + radius + 1); u++)
      for (let v = Math.floor(Math.min(av, cv) - radius - 1); v <= Math.ceil(Math.max(av, cv) + radius + 1); v++) {
        const t = Math.max(0, Math.min(1, ((u - au) * (cu - au) + (v - av) * (cv - av)) / (len * len)))
        if (Math.hypot(u - (au + (cu - au) * t), v - (av + (cv - av) * t)) <= radius) this.reserve(u, 0, v, u, 2, v)
      }
  }
}
