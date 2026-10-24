import { TEAM_COLORS, type TeamId } from '../blocks'
import { item, ITEMS } from '../items'
import { CELL, TILE, tileUV, type AtlasLayout } from '../../../engine/render/atlas-layout'

/**
 * 16×16 pixel art for non-block items, drawn in code: `h` handle, `m` the
 * item's colour, `d` a darker shade, `l` a lighter one, `x` outline.
 */
const ART: Record<string, string[]> = {
  sword: [
    '.............xx.',
    '............xlmx',
    '...........xlmx.',
    '..........xlmx..',
    '.........xlmx...',
    '........xlmx....',
    '.......xlmx.....',
    '..xx..xlmx......',
    '..xdxxlmx.......',
    '...xdmmx........',
    '....xdx.........',
    '...xhxdx........',
    '..xhx.xx........',
    '.xhx............',
    'xhx.............',
    'xx..............',
  ],
  pickaxe: [
    '................',
    '....xxxxxx......',
    '...xlmmmmmxx....',
    '..xmxxxxhxmmx...',
    '..xx...xhx.xmx..',
    '......xhx...xmx.',
    '.....xhx.....xmx',
    '....xhx.......xx',
    '...xhx..........',
    '..xhx...........',
    '.xhx............',
    'xhx.............',
    'xx..............',
    '................',
    '................',
    '................',
  ],
  axe: [
    '................',
    '.......xxx......',
    '......xlmmx.....',
    '.....xlmmmdx....',
    '.....xmmmxhx....',
    '......xdxhx.....',
    '.......xhx......',
    '......xhx.......',
    '.....xhx........',
    '....xhx.........',
    '...xhx..........',
    '..xhx...........',
    '.xhx............',
    'xhx.............',
    'xx..............',
    '................',
  ],
  shears: [
    '................',
    '..........xx....',
    '.........xlmx...',
    '........xlmx....',
    '.......xlmx.....',
    '..xx..xlmx......',
    '.xlmxxlmx.......',
    '..xlmmmx........',
    '...xmmx.........',
    '..xdxxdx........',
    '.xdx..xdx.......',
    'xdx....xdx......',
    'xx......xx......',
    '................',
    '................',
    '................',
  ],
  ingot: [
    '................',
    '................',
    '................',
    '................',
    '.....xxxxxxx....',
    '....xllllllmx...',
    '...xlmmmmmmmdx..',
    '..xlmmmmmmmmdx..',
    '.xmmmmmmmmmdx...',
    '.xdddddddddx....',
    '..xxxxxxxxx.....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  gem: [
    '................',
    '................',
    '......xxxx......',
    '.....xllmmx.....',
    '....xlmmmmdx....',
    '...xlmmmmmmdx...',
    '..xlmmmmmmmmdx..',
    '..xmmmmmmmmmdx..',
    '...xmmmmmmmdx...',
    '....xmmmmmdx....',
    '.....xmmmdx.....',
    '......xmdx......',
    '.......xx.......',
    '................',
    '................',
    '................',
  ],
  bow: [
    '..........xxx...',
    '.........xmmhx..',
    '........xmx.hx..',
    '.......xmx..hx..',
    '......xmx...hx..',
    '.....xmx....hx..',
    '....xmx.....hx..',
    '...xmx......hx..',
    '..xmx......xhx..',
    '..xmx.....xhx...',
    '...xmx...xhx....',
    '....xmx.xhx.....',
    '.....xmmhx......',
    '......xxx.......',
    '................',
    '................',
  ],
  arrow: [
    '...........xxxx.',
    '...........xllx.',
    '..........xllx..',
    '.........xhx....',
    '........xhx.....',
    '.......xhx......',
    '......xhx.......',
    '.....xhx........',
    '....xhx.........',
    '...xhx..........',
    '.xxhx...........',
    'xmmx............',
    'xmx.............',
    'xx..............',
    '................',
    '................',
  ],
  orb: [
    '................',
    '................',
    '.....xxxxxx.....',
    '....xllmmmdx....',
    '...xllmmmmmdx...',
    '..xlmmmmmmmmdx..',
    '..xmmmmmmmmmdx..',
    '..xmmmmmmmmmdx..',
    '..xmmmmmmmmddx..',
    '..xmmmmmmmmddx..',
    '...xmmmmmmddx...',
    '....xdddddddx...',
    '.....xxxxxx.....',
    '................',
    '................',
    '................',
  ],
  egg: [
    '................',
    '......xxxx......',
    '.....xllmmx.....',
    '....xllmmmmx....',
    '....xlmmmmmx....',
    '...xlmmmmmmdx...',
    '...xmmmmmmmdx...',
    '...xmmmmmmmdx...',
    '...xmmmmmmddx...',
    '...xmmmmmmddx...',
    '....xmmmmddx....',
    '.....xxxxxx.....',
    '................',
    '................',
    '................',
    '................',
  ],
  potion: [
    '................',
    '......xxxx......',
    '......xhhx......',
    '.......xx.......',
    '......xllx......',
    '.....xlmmmx.....',
    '....xlmmmmmx....',
    '...xlmmmmmmdx...',
    '...xmmmmmmmdx...',
    '...xmmmmmmmdx...',
    '...xmmmmmmddx...',
    '....xmmmmddx....',
    '.....xxxxxx.....',
    '................',
    '................',
    '................',
  ],
  shield: [
    '................',
    '..xxxxxxxxxxxx..',
    '..xmmmmllmmmmx..',
    '..xmmmmllmmmmx..',
    '..xmmmmllmmmmx..',
    '..xllllllllllx..',
    '..xmmmmllmmmmx..',
    '..xmmmmllmmmmx..',
    '...xmmmllmmmx...',
    '...xmmmllmmmx...',
    '....xmmllmmx....',
    '.....xmllmx.....',
    '......xllx......',
    '.......xx.......',
    '................',
    '................',
  ],
  apple: [
    '................',
    '.......xx.......',
    '........hx......',
    '....xxxxhxxx....',
    '...xllmmmmmmx...',
    '..xlmmmmmmmmdx..',
    '..xlmmmmmmmmdx..',
    '..xmmmmmmmmmdx..',
    '..xmmmmmmmmmdx..',
    '..xmmmmmmmmddx..',
    '...xmmmmmmddx...',
    '....xddxxddx....',
    '.....xx..xx.....',
    '................',
    '................',
    '................',
  ],
  armor: [
    '................',
    '..xxxx....xxxx..',
    '.xmmmmxxxxmmmmx.',
    '.xmlmmmmmmmmlmx.',
    '.xmmmmmmmmmmmmx.',
    '..xxxmmmmmmxxx..',
    '....xmmmmmmx....',
    '....xmllmmmx....',
    '....xmmmmmmx....',
    '....xmmmmmmx....',
    '....xmmmmmmx....',
    '....xddddddx....',
    '....xxxxxxxx....',
    '................',
    '................',
    '................',
  ],
}

function artFor(id: string): string[] | null {
  const def = item(id)
  if (id.endsWith('_armor')) return ART.armor
  if (!def) return null
  if (def.kind === 'sword') return ART.sword
  if (def.tool === 'pickaxe') return ART.pickaxe
  if (def.tool === 'axe') return ART.axe
  if (def.tool === 'shears') return ART.shears
  if (def.kind === 'shield') return ART.shield
  if (def.kind === 'food') return ART.apple
  if (id === 'iron' || id === 'gold') return ART.ingot
  if (id === 'diamond' || id === 'emerald') return ART.gem
  if (def.kind === 'bow') return ART.bow
  if (def.kind === 'ammo') return ART.arrow
  if (def.kind === 'potion') return ART.potion
  if (id === 'bridge_egg') return ART.egg
  if (def.kind === 'throwable') return ART.orb
  return null
}

const ARMOR_ICON_COLORS: Record<string, string> = { chain_armor: '#9a9a9a', iron_armor: '#d8d8d8', diamond_armor: '#5fe0d8' }

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`
}

/** Draws an item's pixel art onto a 16×16 canvas context at (0, 0). */
export function drawItemArt(ctx: CanvasRenderingContext2D, id: string): boolean {
  const art = artFor(id)
  if (!art) return false
  const color = ARMOR_ICON_COLORS[id] ?? item(id)?.color ?? '#ffffff'
  const palette: Record<string, string> = { h: '#7a5232', m: shade(color, 1), d: shade(color, 0.7), l: shade(color, 1.25), x: 'rgba(20,16,12,0.9)' }
  art.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return
      ctx.fillStyle = palette[ch]
      ctx.fillRect(x, y, 1, 1)
    }),
  )
  return true
}

/**
 * Item icons for the hotbar and shop: block items as small isometric cubes cut
 * from the atlas, everything else as pixel art. Cached per item and team.
 */
export class IconPainter {
  private cache = new Map<string, string>()
  constructor(
    private readonly atlas: HTMLCanvasElement,
    private readonly layout: AtlasLayout,
    private readonly blockFor: (id: string, team: TeamId) => number | undefined,
  ) {}

  url(id: string, team: TeamId = 'red'): string {
    const key = `${id}:${team}`
    const hit = this.cache.get(key)
    if (hit) return hit
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 48
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    const block = this.blockFor(id, team)
    if (block !== undefined) this.cube(ctx, block)
    else {
      const art = document.createElement('canvas')
      art.width = art.height = 16
      const actx = art.getContext('2d')!
      if (!drawItemArt(actx, id)) {
        actx.fillStyle = ITEMS[id]?.color ?? TEAM_COLORS[team]
        actx.fillRect(4, 4, 8, 8)
      }
      ctx.drawImage(art, 0, 0, 48, 48)
    }
    const url = canvas.toDataURL()
    this.cache.set(key, url)
    return url
  }

  private tileSource(tile: number): [number, number] {
    const [u0, , , v1] = tileUV(this.layout, tile)
    const size = this.layout.size * CELL
    return [Math.round(u0 * size), Math.round((1 - v1) * size)]
  }

  private cube(ctx: CanvasRenderingContext2D, block: number) {
    const [top, side] = this.layout.faces[block]
    const [tx, ty] = this.tileSource(top)
    const [sx, sy] = this.tileSource(side)
    const k = 1 / TILE
    // Top rhombus, then the left and right faces, each an affine map of the 16×16 tile.
    const faces: [number, number, number, number, number, number, number, number, number][] = [
      [tx, ty, 21 * k, 10.5 * k, -21 * k, 10.5 * k, 24, 2, 0],
      [sx, sy, 21 * k, 10.5 * k, 0, 22 * k, 3, 12.5, 0.22],
      [sx, sy, 21 * k, -10.5 * k, 0, 22 * k, 24, 23, 0.42],
    ]
    for (const [ux, uy, a, b, c, d, e, f, dark] of faces) {
      ctx.save()
      ctx.setTransform(a, b, c, d, e, f)
      ctx.drawImage(this.atlas, ux, uy, TILE, TILE, 0, 0, TILE, TILE)
      if (dark) {
        ctx.fillStyle = `rgba(0,0,0,${dark})`
        ctx.fillRect(0, 0, TILE, TILE)
      }
      ctx.restore()
    }
  }
}
