import { CanvasTexture, LinearMipmapLinearFilter, NearestFilter, SRGBColorSpace } from 'three'
import { hash2 } from '../random'
import { CELL, PAD, TILE, type AtlasLayout, type TileRecipe } from './atlas-layout'

type RGB = [number, number, number]

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Every pattern `drawTile` paints; anything else falls back to plain noise. */
export const PATTERNS: ReadonlySet<string> = new Set([
  'grass', 'noise', 'planks', 'log', 'leaves', 'wool', 'glass', 'brick', 'speckle', 'bedrock', 'bed', 'banded', 'smooth',
  'cobble', 'mossy-cobble', 'stonebrick', 'mossy-stonebrick', 'cracked-stonebrick', 'sand', 'sandstone', 'carved', 'snow', 'ice',
  'lamp', 'quartz', 'pillar', 'terracotta', 'tiles', 'stained', 'hay', 'water', 'gravel', 'cactus', 'metal', 'flowers', 'tuft',
  'birch', 'snowy-leaves', 'pole', 'chain',
])

const MOSS: RGB = [84, 118, 58]
const LEAF: RGB = [66, 124, 50]

/**
 * Rounded stones for cobble: a wrapped Voronoi diagram of a few jittered
 * points, so the tile repeats without a seam. Each pixel gets its stone's
 * index and whether it sits on the mortar between two stones.
 */
function stones(seed: number): { stone: Uint8Array; mortar: Uint8Array } {
  const pts: [number, number][] = []
  for (let gy = 0; gy < 3; gy++)
    for (let gx = 0; gx < 3; gx++) pts.push([(gx + 0.15 + hash2(gx, gy, seed) * 0.7) * (TILE / 3), (gy + 0.15 + hash2(gy, gx, seed + 5) * 0.7) * (TILE / 3)])
  const stone = new Uint8Array(TILE * TILE)
  const mortar = new Uint8Array(TILE * TILE)
  const wrap = (d: number) => Math.min(Math.abs(d), TILE - Math.abs(d))
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      let d1 = Infinity
      let d2 = Infinity
      let best = 0
      pts.forEach(([px, py], i) => {
        const d = Math.hypot(wrap(x + 0.5 - px), wrap(y + 0.5 - py))
        if (d < d1) {
          d2 = d1
          d1 = d
          best = i
        } else if (d < d2) d2 = d
      })
      stone[y * TILE + x] = best
      mortar[y * TILE + x] = d2 - d1 < 1.15 ? 1 : 0
    }
  return { stone, mortar }
}

/** A few random-walk cracks, as a pixel mask. */
function cracks(seed: number, count: number, length: number): Uint8Array {
  const mask = new Uint8Array(TILE * TILE)
  for (let k = 0; k < count; k++) {
    let x = Math.floor(hash2(k, 1, seed) * TILE)
    let y = Math.floor(hash2(k, 2, seed) * TILE)
    for (let s = 0; s < length; s++) {
      mask[y * TILE + x] = 1
      const r = hash2(k * 7 + s, 3, seed)
      x = (x + (r < 0.4 ? 1 : r < 0.6 ? -1 : 0) + TILE) % TILE
      y = (y + (r > 0.7 ? 1 : r > 0.55 ? -1 : 0) + TILE) % TILE
    }
  }
  return mask
}

/** Draws one original 16×16 texture from its recipe; nothing is loaded from disk. */
export function drawTile(recipe: TileRecipe, seed: number): ImageData {
  const img = new ImageData(TILE, TILE)
  const base = rgb(recipe.color)
  const edge = recipe.edge ? rgb(recipe.edge) : base
  const put = (x: number, y: number, c: RGB, f = 1, a = 255) => {
    const i = (y * TILE + x) * 4
    img.data[i] = Math.max(0, Math.min(255, c[0] * f))
    img.data[i + 1] = Math.max(0, Math.min(255, c[1] * f))
    img.data[i + 2] = Math.max(0, Math.min(255, c[2] * f))
    img.data[i + 3] = a
  }
  const h = (x: number, y: number, k = 0) => hash2(x + k * 31, y + seed * 17, seed + k)
  const pattern = recipe.pattern
  const cobble = pattern === 'cobble' || pattern === 'mossy-cobble' ? stones(seed) : null
  const crackMask = pattern === 'cracked-stonebrick' ? cracks(seed, 3, 14) : pattern === 'ice' ? cracks(seed, 2, 9) : null
  const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  const top = recipe.face !== 'side'
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const n = h(x, y)
      const r = Math.hypot(x - 7.5, y - 7.5)
      const rim = x === 0 || y === 0 || x === 15 || y === 15
      switch (pattern) {
        case 'cobble':
        case 'mossy-cobble': {
          const i = y * TILE + x
          const above = ((y + TILE - 1) % TILE) * TILE + x
          const below = ((y + 1) % TILE) * TILE + x
          const stoneShade = 0.8 + hash2(cobble!.stone[i], 0, seed + 3) * 0.32
          let f = cobble!.mortar[i] ? 0.56 + n * 0.08 : stoneShade + n * 0.08
          if (!cobble!.mortar[i] && cobble!.mortar[above]) f += 0.12
          if (!cobble!.mortar[i] && cobble!.mortar[below]) f -= 0.1
          const moss = pattern === 'mossy-cobble' && h(x >> 2, y >> 2, 9) + (cobble!.mortar[i] ? 0.25 : 0) + (y < 6 ? 0.1 : 0) > 0.82
          put(x, y, moss ? MOSS : base, moss ? 0.8 + n * 0.35 : f)
          break
        }
        case 'stonebrick':
        case 'mossy-stonebrick':
        case 'cracked-stonebrick': {
          const course = y >> 3
          const off = course % 2 ? 4 : 0
          const mortar = y % 8 === 7 || (x + off) % 8 === 7
          const brick = hash2(((x + off) >> 3) + course * 5, course, seed + 2)
          let f = mortar ? 0.6 : 0.9 + brick * 0.12 + n * 0.08
          if (!mortar && y % 8 === 0) f += 0.1
          if (!mortar && (x + off) % 8 === 0) f += 0.05
          if (!mortar && y % 8 === 6) f -= 0.08
          if (crackMask?.[y * TILE + x] && !mortar) f = 0.52
          const moss = pattern === 'mossy-stonebrick' && h(x >> 2, y >> 1, 9) + (mortar ? 0.3 : 0) + (y % 8 < 3 ? 0.08 : 0) > 0.86
          put(x, y, moss ? MOSS : base, moss ? 0.8 + n * 0.35 : f)
          break
        }
        case 'sand': {
          const s = h(x, y, 7)
          put(x, y, base, s > 0.93 ? 0.82 : s < 0.05 ? 1.12 : 0.93 + n * 0.1)
          break
        }
        case 'sandstone':
          if (top) put(x, y, base, rim ? 0.9 : 0.95 + n * 0.06)
          else if (y <= 2) put(x, y, base, 1.04 + n * 0.05)
          else if (y === 3 || y === 12) put(x, y, base, 0.84)
          else if (y > 12) put(x, y, base, 0.9 + n * 0.05)
          else put(x, y, base, (y === 8 && h(x >> 1, 0, 3) > 0.35 ? 0.88 : 0.95 + Math.sin(y * 1.7 + seed) * 0.03) + n * 0.06)
          break
        case 'carved':
          if (top) put(x, y, base, rim ? 0.9 : 0.95 + n * 0.06)
          else {
            const ring = Math.abs(x - 7.5) + Math.abs(y - 7.5)
            const frame = x <= 1 || x >= 14 || y <= 1 || y >= 14
            put(x, y, base, frame ? (x === 1 || x === 14 || y === 1 || y === 14 ? 0.8 : 0.95) : ring >= 4 && ring < 5 ? 0.76 : ring < 1.5 ? 0.82 : 0.98 + n * 0.05)
          }
          break
        case 'snow': {
          const s = h(x, y, 8)
          put(x, y, base, s > 0.97 ? 1.06 : 0.94 + n * 0.05 - (h(x >> 1, y >> 1, 4) > 0.8 ? 0.04 : 0))
          break
        }
        case 'ice': {
          const streak = (x + y * 2 + seed) % 11 === 0 || (x + y * 2 + seed) % 11 === 1
          const bubble = h(x, y, 6) > 0.95
          put(x, y, base, crackMask![y * TILE + x] ? 1.18 : streak ? 1.1 : bubble ? 0.84 : 0.92 + n * 0.08)
          break
        }
        case 'lamp': {
          const frame = x < 2 || x > 13 || y < 2 || y > 13
          const bar = x === 5 || x === 10 || y === 5 || y === 10
          if (frame) put(x, y, [62, 50, 40], (x + y) % 13 === 0 ? 1.3 : 0.85 + n * 0.25)
          else if (bar) put(x, y, [78, 62, 46], 0.9 + n * 0.15)
          else put(x, y, mix(base, [255, 252, 236], Math.max(0, 0.6 - r * 0.1)), 1.08 - r * 0.03 + n * 0.04)
          break
        }
        case 'quartz':
          put(x, y, base, x === 0 || y === 0 ? 1.03 : x === 15 || y === 15 ? 0.9 : 0.97 + n * 0.04)
          break
        case 'pillar':
          if (top) put(x, y, base, r > 6.8 ? 0.9 : Math.floor(r) === 4 ? 0.88 : 0.98 + n * 0.03)
          else put(x, y, base, (y === 0 || y === 15 ? 0.88 : x % 5 === 0 ? 0.87 : x % 5 === 1 ? 1.03 : 0.97) + n * 0.04)
          break
        case 'terracotta':
          put(x, y, base, 0.93 + n * 0.07 + (h(x >> 2, y >> 2, 5) - 0.5) * 0.08)
          break
        case 'tiles': {
          const off = (y >> 2) % 2 ? 2 : 0
          const tx = (x + off) % 4
          put(x, y, base, y % 4 === 3 ? 0.62 : tx === 0 ? 0.8 : y % 4 === 0 ? 1.08 + n * 0.05 : 0.9 + n * 0.12)
          break
        }
        case 'stained': {
          // A tinted pane: a solid frame, the glass itself half see-through, two glint streaks.
          const frame = x === 0 || y === 0 || x === 15 || y === 15
          const glint = (x - y === 3 && x > 4 && x < 9) || (x - y === 5 && x > 9 && x < 12)
          if (frame) put(x, y, base, 0.78 + n * 0.08)
          else if (glint) put(x, y, [255, 255, 255], 1, 200)
          else put(x, y, base, 0.95 + n * 0.06, 120)
          break
        }
        case 'hay':
          if (top) put(x, y, base, rim ? 0.78 : 0.86 + ((Math.floor(r * 1.4) + (n > 0.6 ? 1 : 0)) % 2) * 0.12 + n * 0.05)
          else if (y === 3 || y === 4 || y === 11 || y === 12) put(x, y, [140, 96, 40], 0.85 + n * 0.12)
          else put(x, y, base, 0.82 + h(x, y >> 2, 3) * 0.26)
          break
        case 'water': {
          const w = Math.sin((x + Math.sin(y * 0.9 + seed) * 2) * 0.8 + y * 1.6)
          put(x, y, base, 0.86 + n * 0.06 + (w > 0.86 ? 0.24 : w < -0.9 ? -0.08 : 0))
          break
        }
        case 'gravel': {
          const g = h(x >> 1, y >> 1, 2)
          const tone = g < 0.25 ? 0.72 : g < 0.6 ? 0.9 : g < 0.9 ? 1.05 : 1.22
          put(x, y, g > 0.96 ? [142, 118, 96] : base, (tone + n * 0.08) * (x % 2 && y % 2 ? 0.92 : 1))
          break
        }
        case 'cactus':
          if (top) put(x, y, base, r > 6.5 ? 0.82 : r < 1.5 ? 0.8 : Math.floor(r) % 3 === 0 ? 0.9 : 1.04 + n * 0.05)
          else if (h(x, y, 5) > 0.93 && x % 4 !== 0) put(x, y, [232, 226, 182], 1)
          else put(x, y, base, (x % 4 === 0 ? 0.78 : x % 4 === 2 ? 1.08 : 0.94) + n * 0.06)
          break
        case 'metal':
          put(x, y, base, x === 0 || y === 0 ? 1.16 : x === 15 || y === 15 ? 0.74 : x === 1 || y === 1 ? 1.06 : 0.94 + n * 0.05 + ((x + y) % 9 === 0 && x > 2 && x < 13 ? 0.18 : 0))
          break
        case 'flowers': {
          // Cut out: petals and leaves over transparent gaps, short stems on the sides.
          if (top) {
            const cx = x % 8
            const cy = y % 8
            const fx = 2 + Math.floor(hash2(x >> 3, y >> 3, seed) * 4)
            const fy = 2 + Math.floor(hash2(y >> 3, x >> 3, seed + 1) * 4)
            const d = Math.abs(cx - fx) + Math.abs(cy - fy)
            if (d === 0) put(x, y, base[0] > 200 && base[1] > 180 ? [214, 128, 40] : [244, 214, 70])
            else if (d === 1) put(x, y, base, 0.9 + n * 0.2)
            else if (h(x, y, 4) < 0.5) put(x, y, LEAF, 0.75 + n * 0.35)
            else put(x, y, LEAF, 1, 0)
          } else if (y >= 10) {
            const stem = (x + Math.floor(h(x, 0, 3) * 3)) % 3 === 0
            const bloom = y <= 11 && h(x, 0, 6) > 0.62
            if (bloom) put(x, y, base, 0.9 + n * 0.2)
            else if (stem) put(x, y, LEAF, 0.7 + n * 0.3)
            else put(x, y, LEAF, 1, 0)
          } else put(x, y, LEAF, 1, 0)
          break
        }
        case 'tuft': {
          if (top) {
            if (h(x, y, 4) > 0.82) put(x, y, base, 0.9 + n * 0.3)
            else put(x, y, base, 1, 34)
            break
          }
          const blade = 3 + Math.floor(h(x, 0, 2) * 6)
          const height = 15 - y
          if (height < blade && h(x, 0, 9) > 0.3) put(x, y, base, 0.7 + (height / 8) * 0.4 + n * 0.1)
          else put(x, y, base, 1, 0)
          break
        }
        case 'birch':
          if (recipe.face === 'side') {
            const mark = h(Math.floor(x / 3), y, 5) > 0.84 || (y % 5 === 0 && h(x >> 1, y, 6) > 0.6)
            put(x, y, mark ? [52, 48, 44] : base, mark ? 0.9 + n * 0.2 : 0.94 + n * 0.07)
          } else put(x, y, rim ? [222, 216, 204] : base, Math.floor(r) % 3 === 0 ? 0.82 : 0.95 + n * 0.08)
          break
        case 'pole': {
          // A post four pixels wide, cut out of an empty tile.
          const inPost = x >= 6 && x <= 9 && (recipe.face === 'side' || (y >= 6 && y <= 9))
          if (!inPost) put(x, y, base, 1, 0)
          else if (recipe.face === 'side') put(x, y, base, (x === 6 ? 1.12 : x === 9 ? 0.78 : 0.95) + h(x, y >> 2, 3) * 0.1)
          else put(x, y, base, x === 6 || y === 6 ? 0.9 : 1.05)
          break
        }
        case 'chain': {
          // Links alternating face-on and edge-on down the middle.
          const link = (y >> 2) % 2 === 0
          const on = recipe.face === 'side' ? (link ? (x === 6 || x === 9) && y % 4 !== 3 : x >= 7 && x <= 8) || (link && (y % 4 === 0 || y % 4 === 2) && x >= 6 && x <= 9) : x >= 7 && x <= 8 && y >= 7 && y <= 8
          if (on) put(x, y, base, 0.85 + n * 0.3 + (x === 6 ? 0.2 : 0))
          else put(x, y, base, 1, 0)
          break
        }
        case 'snowy-leaves':
          if (recipe.face === 'top') put(x, y, n > 0.88 ? [47, 90, 58] : base, 0.92 + n * 0.08)
          else if (recipe.face === 'side' && y < 3 + Math.floor(h(x, 0, 2) * 3)) put(x, y, [242, 246, 248], 0.92 + n * 0.08)
          else if (h(x, y, 4) < 0.18) put(x, y, base, 1, 0)
          else put(x, y, base, 0.7 + n * 0.45)
          break
        case 'grass-top':
          put(x, y, base, 0.82 + n * 0.3 - (h(x, y, 1) > 0.9 ? 0.12 : 0))
          break
        case 'grass-side': {
          const depth = 3 + Math.floor(h(x, 0, 2) * 2.5)
          if (y < depth) put(x, y, edge, 0.82 + n * 0.25)
          else put(x, y, base, 0.8 + n * 0.3)
          break
        }
        case 'planks': {
          const row = Math.floor(y / 4)
          const seam = (x + row * 7) % 16 === 0
          const line = y % 4 === 3
          const grain = h(Math.floor(x / 3), y, 3) > 0.7 ? 0.92 : 1
          put(x, y, base, (line || seam ? 0.66 : 0.92 + n * 0.12) * grain)
          break
        }
        case 'log':
          if (recipe.face === 'side') put(x, y, base, (x % 4 === 0 ? 0.72 : 0.9) + n * 0.15)
          else {
            const r = Math.hypot(x - 7.5, y - 7.5)
            put(x, y, x === 0 || y === 0 || x === 15 || y === 15 ? rgb('#6b4f2e') : base, Math.floor(r) % 3 === 0 ? 0.8 : 0.95 + n * 0.08)
          }
          break
        case 'leaves':
          if (h(x, y, 4) < 0.18) put(x, y, base, 1, 0)
          else put(x, y, base, 0.7 + n * 0.45)
          break
        case 'wool':
          put(x, y, base, ((x + y) % 4 === 0 ? 0.88 : 0.97) + (n - 0.5) * 0.1)
          break
        case 'glass': {
          const border = x === 0 || y === 0 || x === 15 || y === 15
          const glint = (x - y === 3 && x > 4 && x < 9) || (x - y === 5 && x > 9 && x < 12)
          if (border) put(x, y, base, 0.9)
          else if (glint) put(x, y, [255, 255, 255], 1)
          else put(x, y, base, 1, 0)
          break
        }
        case 'brick': {
          const row = Math.floor(y / 4)
          const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7
          put(x, y, mortar ? [200, 190, 180] : base, mortar ? 0.9 : 0.85 + n * 0.25)
          break
        }
        case 'speckle': {
          const s = h(x, y, 5)
          put(x, y, base, s > 0.9 ? 0.7 : s < 0.06 ? 1.2 : 0.9 + n * 0.14)
          break
        }
        case 'bedrock':
          put(x, y, base, h(Math.floor(x / 2), Math.floor(y / 2), 6) > 0.5 ? 0.6 + n * 0.3 : 1.2 + n * 0.4)
          break
        case 'bed':
          if (recipe.face === 'top') {
            const border = x === 0 || x === 15 || y === 0 || y === 15
            put(x, y, border ? [240, 240, 240] : base, border ? 0.95 : (y === 5 ? 0.85 : 0.95) + n * 0.08)
          } else if (recipe.face === 'side') put(x, y, y > 12 ? rgb('#b48a52') : base, y === 7 ? 1.1 : 0.9 + n * 0.08)
          else put(x, y, base, 0.9 + n * 0.1)
          break
        case 'banded':
          // A light band round the middle of the sides, darker caps: crates, barrels, TNT.
          if (recipe.face === 'side' && y >= 6 && y <= 9) put(x, y, [235, 230, 220], 0.9 + n * 0.1)
          else put(x, y, base, (recipe.face === 'side' ? 0.95 : 0.8) + n * 0.12)
          break
        case 'smooth':
          put(x, y, base, (x === 0 || y === 0 ? 0.92 : 1) * (0.96 + n * 0.08))
          break
        default:
          put(x, y, base, 0.86 + n * 0.24)
      }
    }
  return img
}

/**
 * The block atlas: every tile in a padded cell. The margin holds the tile
 * stretched to the cell (Voxelize's anti-bleed trick), so mipmaps and
 * filtering at a distance pull in the tile's own edge colours, never a
 * neighbour's.
 */
export function createAtlasTexture(layout: AtlasLayout): { texture: CanvasTexture; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = layout.size * CELL
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  const tile = document.createElement('canvas')
  tile.width = tile.height = TILE
  const tctx = tile.getContext('2d')!
  layout.recipes.forEach((recipe, i) => {
    tctx.putImageData(drawTile(recipe, i + 1), 0, 0)
    const x = (i % layout.size) * CELL
    const y = Math.floor(i / layout.size) * CELL
    ctx.drawImage(tile, x, y, CELL, CELL)
    ctx.clearRect(x + PAD, y + PAD, TILE, TILE)
    ctx.drawImage(tile, x + PAD, y + PAD)
  })
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.magFilter = NearestFilter
  texture.minFilter = LinearMipmapLinearFilter
  texture.anisotropy = 4
  texture.generateMipmaps = true
  return { texture, canvas }
}

/** Ten crack stages for the block being dug. */
export function crackTextures(): CanvasTexture[] {
  return Array.from({ length: 10 }, (_, stage) => {
    const c = document.createElement('canvas')
    c.width = c.height = TILE
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    // Grow a few random-walk cracks from the centre, longer each stage.
    for (let k = 0; k < 4; k++) {
      let x = 8
      let y = 8
      for (let s = 0; s < (stage + 1) * 2.2; s++) {
        ctx.fillRect(x, y, 1, 1)
        const r = hash2(k * 13 + s, stage > 0 ? s : 0, 7)
        x = Math.max(0, Math.min(15, x + (r < 0.25 ? -1 : r < 0.5 ? 1 : 0) + (k % 2 ? 1 : -1) * (s % 3 === 0 ? 1 : 0)))
        y = Math.max(0, Math.min(15, y + (r > 0.75 ? -1 : r > 0.5 ? 1 : 0) + (k < 2 ? 1 : -1) * (s % 4 === 0 ? 1 : 0)))
      }
    }
    const t = new CanvasTexture(c)
    t.magFilter = NearestFilter
    t.minFilter = NearestFilter
    t.colorSpace = SRGBColorSpace
    return t
  })
}
