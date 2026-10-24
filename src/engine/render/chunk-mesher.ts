import { BLOCKS, defineBlock, type BlockDef } from '../blocks'
import { World } from '../world'
import type { AtlasLayout } from './atlas-layout'
import { SunLight, type Box } from './light'
import { CHUNK, meshChunk, type ChunkGeometry } from './mesher'

/** Messages from the renderer to its mesher. `seq` lets the renderer tell when the mesher has caught up. */
export type MesherRequest =
  | { t: 'init'; seq: number; sx: number; sy: number; sz: number; cells: Uint8Array; blocks: BlockDef[]; layout: AtlasLayout }
  /** Changed cells as (x, y, z, raw cell) quads. */
  | { t: 'edits'; seq: number; edits: Int32Array }
  | { t: 'focus'; seq: number; x: number; y: number; z: number }
  | { t: 'sync'; seq: number }

export interface MeshedChunk {
  cx: number
  cy: number
  cz: number
  geometry: ChunkGeometry
}

export interface MesherResult {
  chunks: MeshedChunk[]
  /** Sunlight that changed (the whole world after init), for the renderer's copy. */
  light: { box: Box; levels: Uint8Array } | null
  /** The last request handled; with `idle`, everything up to it is meshed. */
  seq: number
  idle: boolean
}

/** The buffers in a result, to transfer rather than copy. */
function resultTransfer(r: MesherResult): Transferable[] {
  const arrays: ArrayBufferView[] = r.chunks.flatMap(({ geometry: g }) => [g.positions, g.normals, g.uvs, g.lights, g.indices])
  if (r.light) arrays.push(r.light.levels)
  return arrays.map((a) => a.buffer as ArrayBuffer)
}

/**
 * The mesher's side of the chunk renderer: its own copy of the world and its
 * sunlight, kept in step by the renderer's edits, and a set of dirty chunks
 * meshed nearest the focus first. Runs in a Web Worker (mesh-worker.ts), or
 * inline where workers are unavailable.
 */
export class ChunkMesher {
  readonly world: World
  readonly light: SunLight
  private readonly layout: AtlasLayout
  private readonly cx: number
  private readonly cy: number
  private readonly cz: number
  private dirty = new Set<number>()
  private focus: [number, number, number] = [0, 0, 0]
  private lightChanged: Box | null
  seq: number

  constructor(init: Extract<MesherRequest, { t: 'init' }>) {
    // A worker starts with only the engine's own blocks; register the game's in the same order.
    for (const def of init.blocks.slice(BLOCKS.length)) defineBlock(def)
    this.world = new World(init.sx, init.sy, init.sz, init.cells)
    this.light = new SunLight(this.world)
    this.layout = init.layout
    this.seq = init.seq
    this.cx = Math.ceil(init.sx / CHUNK)
    this.cy = Math.ceil(init.sy / CHUNK)
    this.cz = Math.ceil(init.sz / CHUNK)
    for (let i = 0; i < this.cx * this.cy * this.cz; i++) this.dirty.add(i)
    this.lightChanged = [0, 0, 0, init.sx - 1, init.sy - 1, init.sz - 1]
  }

  handle(m: Exclude<MesherRequest, { t: 'init' }>): void {
    this.seq = m.seq
    if (m.t === 'focus') this.focus = [m.x, m.y, m.z]
    else if (m.t === 'edits') {
      const e = m.edits
      for (let i = 0; i < e.length; i += 4) {
        const [x, y, z, raw] = [e[i], e[i + 1], e[i + 2], e[i + 3]]
        this.world.set(x, y, z, raw & 0x7f, (raw & 0x80) !== 0)
        this.light.queueChange(x, z)
        this.markAround(x, y, z, x, y, z)
      }
    }
  }

  get busy(): boolean {
    return this.dirty.size > 0 || this.light.queued
  }

  /** Relights, then meshes up to `max` dirty chunks, nearest the focus first. */
  step(max: number): MesherResult {
    const lit = this.light.flush()
    if (lit) {
      this.markAround(...lit)
      this.lightChanged = this.lightChanged ? union(this.lightChanged, lit) : lit
    }
    const [px, py, pz] = this.focus
    const order = [...this.dirty]
      .map((i) => {
        const x = i % this.cx
        const z = Math.floor(i / this.cx) % this.cz
        const y = Math.floor(i / (this.cx * this.cz))
        return { i, x, y, z, d: Math.hypot((x + 0.5) * CHUNK - px, (y + 0.5) * CHUNK - py, (z + 0.5) * CHUNK - pz) }
      })
      .sort((a, b) => a.d - b.d)
      .slice(0, max)
    const chunks: MeshedChunk[] = []
    for (const c of order) {
      this.dirty.delete(c.i)
      chunks.push({ cx: c.x, cy: c.y, cz: c.z, geometry: meshChunk(this.world, this.light, this.layout, c.x, c.y, c.z) })
    }
    const light = this.lightChanged && { box: this.lightChanged, levels: this.light.readBox(this.lightChanged) }
    this.lightChanged = null
    return { chunks, light, seq: this.seq, idle: !this.busy }
  }

  private markAround(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    // One block of margin: faces and AO of neighbouring chunks depend on these cells.
    const c = (v: number, max: number) => Math.max(0, Math.min(max - 1, Math.floor(v / CHUNK)))
    for (let y = c(y0 - 1, this.cy); y <= c(y1 + 1, this.cy); y++)
      for (let z = c(z0 - 1, this.cz); z <= c(z1 + 1, this.cz); z++)
        for (let x = c(x0 - 1, this.cx); x <= c(x1 + 1, this.cx); x++) this.dirty.add((y * this.cz + z) * this.cx + x)
  }
}

/** Chunks meshed between looks at the inbox, so edits jump ahead of a long initial build. */
const SLICE = 8

/**
 * Drives a mesher from a stream of requests: meshes in slices between
 * messages and posts every result with something in it, plus one whenever a
 * new request has been handled (so a `sync` is always answered).
 */
export function serveMesher(post: (result: MesherResult, transfer: Transferable[]) => void): (m: MesherRequest) => void {
  let mesher: ChunkMesher | null = null
  let reported = -1
  let scheduled = false
  const run = () => {
    scheduled = false
    if (!mesher) return
    const result = mesher.step(SLICE)
    if (result.chunks.length || result.light || result.seq !== reported) {
      reported = result.seq
      post(result, resultTransfer(result))
    }
    if (mesher.busy) schedule()
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    setTimeout(run, 0)
  }
  return (m) => {
    if (m.t === 'init') mesher = new ChunkMesher(m)
    else mesher?.handle(m)
    schedule()
  }
}

function union(a: Box, b: Box): Box {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])]
}
