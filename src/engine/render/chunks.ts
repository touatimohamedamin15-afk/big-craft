import { BufferAttribute, BufferGeometry, Group, Mesh, type ShaderMaterial } from 'three'
import { BLOCKS } from '../blocks'
import type { World } from '../world'
import type { AtlasLayout } from './atlas-layout'
import { serveMesher, type MeshedChunk, type MesherRequest, type MesherResult } from './chunk-mesher'
import { LightLevels } from './light'

/** How far the camera moves before the mesher hears about it (it only orders chunks by distance). */
const FOCUS_STEP = 4

/**
 * One mesh per 16³ chunk. Sunlight and meshing run in a Web Worker that keeps
 * its own copy of the world: block edits are mirrored to it, it remeshes the
 * chunks they touch (and neighbours touched by AO or light) nearest the
 * camera first, and posts the geometry back as transferred typed arrays.
 * Finished meshes are swapped in a few per frame, so a burst of edits never
 * stalls rendering.
 */
export class ChunkRenderer {
  readonly group = new Group()
  /** The worker's sunlight, copied back as it changes (for debug readouts). */
  readonly light: LightLevels
  private meshes = new Map<string, Mesh>()
  private ready = new Map<string, MeshedChunk>()
  private unsubscribe: () => void
  private port: { post(m: MesherRequest, transfer?: Transferable[]): void; close(): void }
  private seq = 0
  private edits: number[] = []
  private focus = [Infinity, Infinity, Infinity]
  private waiting: { seq: number; done: () => void }[] = []
  private unbudgeted = false

  constructor(
    readonly world: World,
    layout: AtlasLayout,
    private readonly material: ShaderMaterial,
    /** For translucent faces; without it they draw with `material`. */
    private readonly translucent: ShaderMaterial = material,
  ) {
    this.light = new LightLevels(world.sx, world.sy, world.sz)
    this.port = openMesher((r) => this.receive(r))
    const cells = world.cells.slice()
    this.port.post({ t: 'init', seq: this.seq, sx: world.sx, sy: world.sy, sz: world.sz, cells, blocks: [...BLOCKS], layout }, [cells.buffer])
    this.unsubscribe = world.onChange((x, y, z) => {
      if (this.edits.length === 0) queueMicrotask(() => this.sendEdits())
      this.edits.push(x, y, z, world.raw(x, y, z))
    })
  }

  private sendEdits() {
    if (this.edits.length === 0) return
    const edits = Int32Array.from(this.edits)
    this.edits = []
    this.port.post({ t: 'edits', seq: ++this.seq, edits }, [edits.buffer])
  }

  private receive(r: MesherResult) {
    if (r.light) this.light.writeBox(r.light.box, r.light.levels)
    for (const c of r.chunks) {
      const k = `${c.cx},${c.cy},${c.cz}`
      // A newer mesh of the same chunk replaces one still waiting.
      this.ready.delete(k)
      this.ready.set(k, c)
    }
    if (this.unbudgeted) this.apply(Infinity)
    if (!r.idle) return
    const caughtUp = this.waiting.filter((w) => r.seq >= w.seq)
    if (caughtUp.length === 0) return
    this.waiting = this.waiting.filter((w) => r.seq < w.seq)
    if (this.waiting.length === 0) this.unbudgeted = false
    for (const w of caughtUp) w.done()
  }

  /** Swaps in up to `budget` finished chunks and tells the mesher where the camera is (it meshes nearest first). */
  update(px: number, py: number, pz: number, budget = 6): void {
    if (Math.hypot(px - this.focus[0], py - this.focus[1], pz - this.focus[2]) > FOCUS_STEP) {
      this.focus = [px, py, pz]
      this.port.post({ t: 'focus', seq: ++this.seq, x: px, y: py, z: pz })
    }
    this.apply(budget)
  }

  /** Swaps in every chunk as soon as it is meshed until the mesher has caught up with all edits so far; resolves then. */
  buildAll(): Promise<void> {
    this.sendEdits()
    this.unbudgeted = true
    const seq = ++this.seq
    this.port.post({ t: 'sync', seq })
    return new Promise((done) => this.waiting.push({ seq, done }))
  }

  private apply(budget: number) {
    for (const [k, c] of this.ready) {
      if (budget-- <= 0) return
      this.ready.delete(k)
      this.build(k, c)
    }
  }

  private build(k: string, { geometry: g }: MeshedChunk) {
    const old = this.meshes.get(k)
    if (g.indices.length === 0) {
      if (old) {
        this.group.remove(old)
        old.geometry.dispose()
        this.meshes.delete(k)
      }
      return
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(g.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(g.normals, 3))
    geometry.setAttribute('uv', new BufferAttribute(g.uvs, 2))
    geometry.setAttribute('light', new BufferAttribute(g.lights, 1))
    geometry.setIndex(new BufferAttribute(g.indices, 1))
    // Opaque faces first, then translucent ones with the blended material (three.js sorts those back to front per chunk).
    geometry.addGroup(0, g.translucentStart, 0)
    if (g.indices.length > g.translucentStart) geometry.addGroup(g.translucentStart, g.indices.length - g.translucentStart, 1)
    geometry.computeBoundingSphere()
    if (old) {
      old.geometry.dispose()
      old.geometry = geometry
    } else {
      const mesh = new Mesh(geometry, [this.material, this.translucent])
      mesh.matrixAutoUpdate = false
      this.meshes.set(k, mesh)
      this.group.add(mesh)
    }
  }

  dispose(): void {
    this.unsubscribe()
    this.port.close()
    for (const m of this.meshes.values()) m.geometry.dispose()
    this.meshes.clear()
    this.ready.clear()
    this.group.clear()
  }
}

/** A Web Worker running the mesher, or the same mesher on this thread where workers cannot start. */
function openMesher(receive: (r: MesherResult) => void): { post(m: MesherRequest, transfer?: Transferable[]): void; close(): void } {
  try {
    const worker = new Worker(new URL('./mesh-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<MesherResult>) => receive(e.data)
    return { post: (m, transfer = []) => worker.postMessage(m, transfer), close: () => worker.terminate() }
  } catch {
    let open = true
    const send = serveMesher((r) => open && receive(r))
    return {
      post: (m) => send(m),
      close: () => {
        open = false
      },
    }
  }
}
