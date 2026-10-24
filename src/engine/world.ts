import { AIR, blockDef } from './blocks'

const PLACED = 0x80

/**
 * A fixed-size voxel grid. Each cell is one byte: the block id in the low seven
 * bits and a "placed this round" flag in the top bit, so only player-built
 * blocks can be broken. Outside the grid is air (the void).
 */
export class World {
  readonly cells: Uint8Array
  private listeners = new Set<(x: number, y: number, z: number) => void>()

  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
    cells?: Uint8Array,
  ) {
    this.cells = cells ?? new Uint8Array(sx * sy * sz)
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz
  }

  private index(x: number, y: number, z: number): number {
    return (y * this.sz + z) * this.sx + x
  }

  get(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return AIR
    return this.cells[this.index(x, y, z)] & 0x7f
  }

  /** The raw cell byte: block id plus the placed flag in the top bit. */
  raw(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return 0
    return this.cells[this.index(x, y, z)]
  }

  isPlaced(x: number, y: number, z: number): boolean {
    if (!this.inBounds(x, y, z)) return false
    return (this.cells[this.index(x, y, z)] & PLACED) !== 0
  }

  isSolid(x: number, y: number, z: number): boolean {
    return blockDef(this.get(x, y, z)).solid
  }

  set(x: number, y: number, z: number, id: number, placed = false): boolean {
    if (!this.inBounds(x, y, z)) return false
    const value = id | (placed ? PLACED : 0)
    const i = this.index(x, y, z)
    if (this.cells[i] === value) return false
    this.cells[i] = value
    for (const listener of this.listeners) listener(x, y, z)
    return true
  }

  /** Inclusive box fill, without notifying listeners (used while generating). */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
    for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(this.sy - 1, Math.max(y0, y1)); y++)
      for (let z = Math.max(0, Math.min(z0, z1)); z <= Math.min(this.sz - 1, Math.max(z0, z1)); z++)
        for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(this.sx - 1, Math.max(x0, x1)); x++)
          this.cells[this.index(x, y, z)] = id
  }

  onChange(listener: (x: number, y: number, z: number) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Run-length encoded snapshot: a 6-byte header, then (u16 run, u8 cell) triples. */
  encode(): Uint8Array {
    const out: number[] = [this.sx & 255, this.sx >> 8, this.sy & 255, this.sy >> 8, this.sz & 255, this.sz >> 8]
    const cells = this.cells
    let i = 0
    while (i < cells.length) {
      const value = cells[i]
      let run = 1
      while (i + run < cells.length && cells[i + run] === value && run < 0xffff) run++
      out.push(run & 255, run >> 8, value)
      i += run
    }
    return Uint8Array.from(out)
  }

  static decode(bytes: Uint8Array): World {
    const sx = bytes[0] | (bytes[1] << 8)
    const sy = bytes[2] | (bytes[3] << 8)
    const sz = bytes[4] | (bytes[5] << 8)
    const cells = new Uint8Array(sx * sy * sz)
    let o = 0
    for (let i = 6; i + 2 < bytes.length; i += 3) {
      const run = bytes[i] | (bytes[i + 1] << 8)
      cells.fill(bytes[i + 2], o, o + run)
      o += run
    }
    return new World(sx, sy, sz, cells)
  }

  clone(): World {
    return new World(this.sx, this.sy, this.sz, this.cells.slice())
  }
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
