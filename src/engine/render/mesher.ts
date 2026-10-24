import { AIR, blockDef, isOpaqueCube, type BlockDef } from '../blocks'
import type { World } from '../world'
import { tileUV, type AtlasLayout } from './atlas-layout'

export const CHUNK = 16

export interface ChunkGeometry {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  /** Packed like Voxelize's light word: sunlight in bits 12-15, block light in 8-11, ambient occlusion in 16-17. */
  lights: Float32Array
  indices: Uint32Array
  /** Indices from here on are translucent faces, drawn blended after everything opaque. */
  translucentStart: number
}

interface LightSource {
  get(x: number, y: number, z: number): number
  /** Light from glowing blocks; absent means none. */
  getBlock?(x: number, y: number, z: number): number
}

/**
 * Faces of a cube, each as four corners in a Z order (top-left, bottom-left,
 * top-right, bottom-right as seen from outside) so triangles (0,1,2)/(2,1,3)
 * are counter-clockwise, and so is the flipped split (0,1,3)/(3,2,0).
 */
const FACES: { n: [number, number, number]; corners: [number, number, number][]; face: 0 | 1 | 2 }[] = [
  { n: [1, 0, 0], corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]], face: 1 },
  { n: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]], face: 1 },
  { n: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 0], [1, 1, 1]], face: 0 },
  { n: [0, -1, 0], corners: [[1, 0, 0], [1, 0, 1], [0, 0, 0], [0, 0, 1]], face: 2 },
  { n: [0, 0, 1], corners: [[0, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 1]], face: 1 },
  { n: [0, 0, -1], corners: [[1, 1, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0]], face: 1 },
]
const CORNER_UV: [number, number][] = [[0, 1], [0, 0], [1, 1], [1, 0]]


/** Voxelize's vertex AO (crates/mesher lighting.rs): 0 when both sides are blocked, else 3 minus blockers. */
export function vertexAO(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0
  return 3 - (Number(side1) + Number(side2) + Number(corner))
}

function faceVisible(self: BlockDef, other: BlockDef, normalY: number): boolean {
  if (other.id === AIR) return true
  // A partial block (bed) never hides its neighbours' faces, and its own top is always drawn.
  if (self.height < 1 && normalY > 0) return true
  if (other.height < 1) return true
  if (!other.transparent) return false
  // Glass next to glass: no inner faces.
  return other.id !== self.id
}

/** Meshes one 16³ chunk with per-face culling, per-vertex AO and smooth sunlight. */
export function meshChunk(world: World, light: LightSource, layout: AtlasLayout, cx: number, cy: number, cz: number): ChunkGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const lights: number[] = []
  const indices: number[] = []
  const blended: number[] = []
  const x0 = cx * CHUNK
  const y0 = cy * CHUNK
  const z0 = cz * CHUNK

  for (let y = y0; y < y0 + CHUNK; y++)
    for (let z = z0; z < z0 + CHUNK; z++)
      for (let x = x0; x < x0 + CHUNK; x++) {
        const id = world.get(x, y, z)
        if (id === AIR) continue
        const def = blockDef(id)
        for (const f of FACES) {
          const [nx, ny, nz] = f.n
          const other = blockDef(world.get(x + nx, y + ny, z + nz))
          if (!faceVisible(def, other, ny)) continue
          const [u0, v0, u1, v1] = tileUV(layout, layout.faces[id][f.face])
          const h = def.height
          // Partial blocks shade from their own cell for the top face.
          const fx = x + (h < 1 && ny > 0 ? 0 : nx)
          const fy = y + (h < 1 && ny > 0 ? 0 : ny)
          const fz = z + (h < 1 && ny > 0 ? 0 : nz)
          const aos: number[] = []
          const base = positions.length / 3
          for (let c = 0; c < 4; c++) {
            const corner = f.corners[c]
            // Tangent directions toward this corner, on the two axes the face spans.
            const t = corner.map((v, a) => (f.n[a] !== 0 ? 0 : v === 1 ? 1 : -1))
            const solidAt = (dx: number, dy: number, dz: number) => isOpaqueCube(blockDef(world.get(fx + dx, fy + dy, fz + dz)))
            const axes = [0, 1, 2].filter((a) => f.n[a] === 0)
            const s1v = [0, 0, 0]
            const s2v = [0, 0, 0]
            s1v[axes[0]] = t[axes[0]]
            s2v[axes[1]] = t[axes[1]]
            const side1 = solidAt(s1v[0], s1v[1], s1v[2])
            const side2 = solidAt(s2v[0], s2v[1], s2v[2])
            const diag = solidAt(t[0], t[1], t[2])
            const ao = def.transparent ? 3 : vertexAO(side1, side2, diag)
            aos.push(ao)
            // Smooth light: average the open cells in front of the face around this corner.
            const lamp = (x: number, y: number, z: number) => light.getBlock?.(x, y, z) ?? 0
            let sum = light.get(fx, fy, fz)
            let glow = lamp(fx, fy, fz)
            let n = 1
            if (!side1) {
              sum += light.get(fx + s1v[0], fy + s1v[1], fz + s1v[2])
              glow += lamp(fx + s1v[0], fy + s1v[1], fz + s1v[2])
              n++
            }
            if (!side2) {
              sum += light.get(fx + s2v[0], fy + s2v[1], fz + s2v[2])
              glow += lamp(fx + s2v[0], fy + s2v[1], fz + s2v[2])
              n++
            }
            if (!diag && !(side1 && side2)) {
              sum += light.get(fx + t[0], fy + t[1], fz + t[2])
              glow += lamp(fx + t[0], fy + t[1], fz + t[2])
              n++
            }
            const sun = Math.floor(sum / n)
            // Glowing blocks light their own faces fully.
            const block = def.lightLevel ? 15 : Math.floor(glow / n)
            lights.push((sun << 12) | (block << 8) | (ao << 16))
            const py = corner[1] === 1 ? h : 0
            positions.push(x + corner[0], y + py, z + corner[2])
            normals.push(nx, ny, nz)
            const [cu, cv] = CORNER_UV[c]
            // Side faces of short blocks use the bottom part of the tile.
            const vTop = f.face === 1 && h < 1 ? v0 + (v1 - v0) * h : v1
            uvs.push(cu ? u1 : u0, cv ? vTop : v0)
          }
          // Split along the brighter diagonal (Voxelize's quad flip rule) to avoid dark creases.
          const out = def.translucent ? blended : indices
          if (aos[0] + aos[3] > aos[1] + aos[2]) out.push(base, base + 1, base + 3, base + 3, base + 2, base)
          else out.push(base, base + 1, base + 2, base + 2, base + 1, base + 3)
        }
      }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    lights: new Float32Array(lights),
    indices: new Uint32Array([...indices, ...blended]),
    translucentStart: indices.length,
  }
}
