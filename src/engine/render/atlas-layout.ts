import { BLOCKS, AIR } from '../blocks'

/** Pixels per texture and per atlas cell: a quarter-cell margin on each side, as Voxelize pads its atlas. */
export const TILE = 16
export const CELL = 32
export const PAD = (CELL - TILE) / 2

export type Face = 'top' | 'side' | 'bottom'

export interface TileRecipe {
  color: string
  pattern: string
  /** Grass sides draw a strip of the top colour along their top edge. */
  edge?: string
  face: Face
}

export interface AtlasLayout {
  /** Cells per side. */
  size: number
  recipes: TileRecipe[]
  /** tile index per block id: [top, side, bottom] */
  faces: [number, number, number][]
}

/** Patterns that paint the top, side and bottom differently, so the same colour still needs a tile per face. */
export const PER_FACE_PATTERNS: ReadonlySet<string> = new Set(['bed', 'log', 'banded', 'birch', 'sandstone', 'carved', 'pillar', 'hay', 'cactus', 'flowers', 'tuft', 'snowy-leaves', 'pole', 'chain'])

export function atlasLayout(): AtlasLayout {
  const recipes: TileRecipe[] = []
  const keys = new Map<string, number>()
  const tile = (r: TileRecipe) => {
    const key = `${r.color}|${r.pattern}|${r.edge ?? ''}|${PER_FACE_PATTERNS.has(r.pattern) ? r.face : ''}`
    let i = keys.get(key)
    if (i === undefined) {
      i = recipes.length
      recipes.push(r)
      keys.set(key, i)
    }
    return i
  }
  const faces = BLOCKS.map((b): [number, number, number] => {
    if (b.id === AIR) return [0, 0, 0]
    const t = b.texture
    const top = tile({ color: t.top, pattern: t.pattern === 'grass' ? 'grass-top' : t.pattern, face: 'top' })
    const side = tile({ color: t.side, pattern: t.pattern === 'grass' ? 'grass-side' : t.pattern, edge: t.pattern === 'grass' ? t.top : undefined, face: 'side' })
    const bottom = tile({ color: t.bottom ?? t.side, pattern: t.pattern === 'grass' ? 'noise' : t.pattern === 'bed' ? 'planks' : t.pattern, face: 'bottom' })
    return [top, side, bottom]
  })
  let size = 1
  while (size * size < recipes.length) size *= 2
  return { size, recipes, faces }
}

/** UV rectangle of a tile, inside its padded cell. v grows upward (three.js flips canvas textures). */
export function tileUV(layout: AtlasLayout, tile: number): [number, number, number, number] {
  const col = tile % layout.size
  const row = Math.floor(tile / layout.size)
  const n = layout.size
  const pad = PAD / CELL / n
  const u0 = col / n + pad
  const u1 = (col + 1) / n - pad
  const v1 = 1 - row / n - pad
  const v0 = 1 - (row + 1) / n + pad
  return [u0, v0, u1, v1]
}
