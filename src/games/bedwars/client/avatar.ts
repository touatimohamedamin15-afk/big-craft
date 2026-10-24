import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  MeshBasicMaterial,
  DoubleSide,
  Group,
  Mesh,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three'
import type { AtlasLayout } from '../../../engine/render/atlas-layout'
import { blockCube } from '../../../engine/render/entities'
import { TEAM_COLORS, TEAM_NAMES, type TeamId } from '../blocks'
import { item, placedBlock, type ArmorTier } from '../items'
import { EYE_COLORS, HAIR_COLORS, OUTFIT_COLORS, SKIN_TONES, type Look } from '../look'
import { drawItemArt } from './icons'

/**
 * Players drawn as 32-pixel-tall blocky figures with painted skins: a base
 * layer (face, hair, outfit) and an outer layer (team leather armour and the
 * bought tier), a cape that sways with movement, a name tag and the held item.
 * Every pixel is generated here from a `Look`; nothing is loaded from files.
 */

/** One skin pixel in blocks: 32 px tall = 1.8 blocks. */
export const PX = 1.8 / 32
const SIZE = 64

type Part = 'head' | 'body' | 'armR' | 'armL' | 'legR' | 'legL'
type Face = 'top' | 'bottom' | 'right' | 'front' | 'left' | 'back'
const PARTS: Record<Part, { base: [number, number]; over: [number, number]; size: [number, number, number] }> = {
  head: { base: [0, 0], over: [32, 0], size: [8, 8, 8] },
  body: { base: [16, 16], over: [16, 32], size: [8, 12, 4] },
  armR: { base: [40, 16], over: [40, 32], size: [4, 12, 4] },
  armL: { base: [32, 48], over: [48, 48], size: [4, 12, 4] },
  legR: { base: [0, 16], over: [0, 32], size: [4, 12, 4] },
  legL: { base: [16, 48], over: [0, 48], size: [4, 12, 4] },
}

/** Where each face of a w×h×d box sits in its net at (u, v): the usual cube unwrap. */
function faceRect(u: number, v: number, w: number, h: number, d: number, face: Face): [number, number, number, number] {
  switch (face) {
    case 'top':
      return [u + d, v, w, d]
    case 'bottom':
      return [u + d + w, v, w, d]
    case 'right':
      return [u, v + d, d, h]
    case 'front':
      return [u + d, v + d, w, h]
    case 'left':
      return [u + d + w, v + d, d, h]
    case 'back':
      return [u + 2 * d + w, v + d, w, h]
  }
}

/** Points a BoxGeometry's UVs at a box net in a texture of `texW`×`texH` pixels. */
export function setBoxUV(g: BoxGeometry, u: number, v: number, w: number, h: number, d: number, texW = SIZE, texH = SIZE): void {
  const uv = g.getAttribute('uv')
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z. The figure faces -z, so -z is its front and +x its right.
  const order: Face[] = ['right', 'left', 'top', 'bottom', 'back', 'front']
  order.forEach((face, f) => {
    const [x, y, rw, rh] = faceRect(u, v, w, h, d, face)
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k
      const U = uv.getX(i)
      const V = uv.getY(i)
      uv.setXY(i, (x + U * rw) / texW, 1 - (y + (1 - V) * rh) / texH)
    }
  })
  uv.needsUpdate = true
}

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`
}

const ARMOR_TIER_COLOR: Record<Exclude<ArmorTier, 'leather'>, string> = { chain: '#8f8f8f', iron: '#d4d4d4', diamond: '#4fd8cf' }

/** Paints a 64×64 skin for a look, a team and an armour tier. */
export function paintSkin(look: Look, team: TeamId | null, armor: ArmorTier): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = SIZE
  const g = c.getContext('2d')!
  const px = (x: number, y: number, color: string) => {
    g.fillStyle = color
    g.fillRect(x, y, 1, 1)
  }
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color
    g.fillRect(x, y, w, h)
  }
  // Fill a face of a part's layer, with a little per-pixel variation for texture.
  const fillFace = (part: Part, layer: 'base' | 'over', face: Face, color: string, rows: [number, number] = [0, 99], noise = 0.06) => {
    const [u, v] = PARTS[part][layer]
    const [w, h, d] = PARTS[part].size
    const [x, y, rw, rh] = faceRect(u, v, w, h, d, face)
    for (let j = Math.max(0, rows[0]); j < Math.min(rh, rows[1]); j++)
      for (let i = 0; i < rw; i++) px(x + i, y + j, shade(color, 1 - noise + ((i * 7 + j * 13) % 5) * (noise / 2)))
  }
  const sides: Face[] = ['front', 'back', 'left', 'right']
  const all: Face[] = ['top', 'bottom', ...sides]
  const skin = SKIN_TONES[look.skin]
  const hair = HAIR_COLORS[look.hairColor]
  const cloth = OUTFIT_COLORS[look.outfitColor]
  const teamColor = team ? TEAM_COLORS[team] : '#9a9a9a'
  const pants = look.outfit === 2 ? shade(cloth, 0.55) : '#34405a'

  // Head: skin, then the face, then hair.
  for (const f of all) fillFace('head', 'base', f, skin, [0, 99], 0.04)
  const [fx, fy] = faceRect(0, 0, 8, 8, 8, 'front')
  const eye = EYE_COLORS[look.eyes]
  rect(fx + 1, fy + 4, 2, 1, '#ffffff')
  rect(fx + 5, fy + 4, 2, 1, '#ffffff')
  px(fx + 2, fy + 4, eye)
  px(fx + 5, fy + 4, eye)
  rect(fx + 1, fy + 3, 2, 1, shade(hair, 0.8))
  rect(fx + 5, fy + 3, 2, 1, shade(hair, 0.8))
  rect(fx + 3, fy + 5, 2, 1, shade(skin, 0.88))
  rect(fx + 3, fy + 6, 2, 1, shade(skin, 0.7))
  const hairRows: Record<number, Partial<Record<Face, number>>> = {
    0: { top: 8, front: 2, back: 4, left: 3, right: 3 },
    1: { top: 8, front: 2, back: 8, left: 6, right: 6 },
    2: { top: 8, front: 1, back: 2, left: 1, right: 1 },
    3: { top: 8, front: 3, back: 5, left: 4, right: 4 },
    4: { top: 8, front: 2, back: 7, left: 3, right: 3 },
    5: {},
  }
  for (const [face, rows] of Object.entries(hairRows[look.hairStyle] ?? {}) as [Face, number][]) {
    if (face === 'top') fillFace('head', 'base', 'top', hair, [0, 99], 0.12)
    else fillFace('head', 'base', face, hair, [0, rows], 0.12)
  }
  if (look.hairStyle === 0 || look.hairStyle === 3) {
    // A fringe that leaves the eyes clear.
    const [x, y] = faceRect(0, 0, 8, 8, 8, 'front')
    for (let i = 0; i < 8; i++) if ((i + look.hairStyle) % 3 !== 0) px(x + i, y + 2, shade(hair, 0.9))
  }
  if (look.hairStyle === 3)
    for (const f of sides) {
      const [x, y, rw] = faceRect(0, 0, 8, 8, 8, f)
      for (let i = 0; i < rw; i += 2) px(x + i, y + 4, shade(hair, 0.7))
    }
  if (look.hairStyle === 4) {
    // A ponytail down the back of the head.
    const [x, y] = faceRect(0, 0, 8, 8, 8, 'back')
    rect(x + 3, y + 4, 2, 4, shade(hair, 0.85))
  }

  // Body and arms: the outfit; hands in skin; a team band on each sleeve.
  for (const f of all) fillFace('body', 'base', f, cloth)
  for (const arm of ['armR', 'armL'] as Part[]) {
    for (const f of all) fillFace(arm, 'base', f, skin, [0, 99], 0.04)
    const sleeve = look.outfit === 4 ? 0 : look.outfit === 2 ? 6 : 9
    for (const f of [...sides, 'top' as Face]) fillFace(arm, 'base', f, cloth, [0, sleeve])
    if (sleeve > 0) for (const f of sides) fillFace(arm, 'base', f, teamColor, [2, 3], 0)
  }
  const [bx, by] = faceRect(16, 16, 8, 12, 4, 'front')
  const [kx, ky] = faceRect(16, 16, 8, 12, 4, 'back')
  switch (look.outfit) {
    case 0: // hoodie: pocket, strings, hood on the back
      rect(bx + 2, by + 7, 4, 2, shade(cloth, 0.8))
      px(bx + 3, by + 1, '#eeeeee')
      px(bx + 4, by + 1, '#eeeeee')
      px(bx + 3, by + 2, '#eeeeee')
      px(bx + 4, by + 3, '#eeeeee')
      rect(kx + 1, ky, 6, 3, shade(cloth, 0.85))
      break
    case 1: // jacket: open front over a white shirt, collar
      rect(bx + 3, by, 2, 12, '#e8e8e8')
      rect(bx + 2, by, 1, 3, shade(cloth, 1.2))
      rect(bx + 5, by, 1, 3, shade(cloth, 1.2))
      break
    case 2: // tunic: belt and buckle
      rect(bx, by + 8, 8, 1, '#5a3a1e')
      rect(kx, ky + 8, 8, 1, '#5a3a1e')
      px(bx + 3, by + 8, '#e8c84a')
      px(bx + 4, by + 8, '#e8c84a')
      break
    case 3: // striped
      for (const f of [...sides]) {
        const [x, y, rw, rh] = faceRect(16, 16, 8, 12, 4, f)
        for (let j = 0; j < rh; j += 3) rect(x, y + j, rw, 1, shade(cloth, 1.35))
      }
      break
    case 4: // vest over bare arms, buttons
      for (let j = 2; j < 11; j += 3) px(bx + 4, by + j, '#e8e8e8')
      break
  }
  // A team emblem on the chest, so teams read at a glance even without armour.
  rect(bx + 1, by + 2, 1, 2, teamColor)

  // Legs: trousers and shoes.
  for (const leg of ['legR', 'legL'] as Part[]) {
    for (const f of all) fillFace(leg, 'base', f, pants)
    for (const f of [...sides, 'bottom' as Face]) fillFace(leg, 'base', f, '#2a2420', [9, 12])
  }

  // Outer layer, only in a team: team leather that leaves the outfit visible (a
  // headband, shoulder pads, the edges of a vest, boots), and bought armour as
  // leggings and boots in its tier's colour.
  if (team) {
    const leather = teamColor
    const plate = (part: Part, f: Face, color: string, rows: [number, number] = [0, 99], cols?: [number, number]) => {
      const [u, v] = PARTS[part].over
      const [w, h, d] = PARTS[part].size
      const [x, y, rw, rh] = faceRect(u, v, w, h, d, f)
      for (let j = Math.max(0, rows[0]); j < Math.min(rh, rows[1]); j++)
        for (let i = cols ? cols[0] : 0; i < (cols ? Math.min(rw, cols[1]) : rw); i++) px(x + i, y + j, shade(color, 0.92 + ((i * 7 + j * 13) % 5) * 0.04))
    }
    for (const f of sides) plate('head', f, leather, [1, 2])
    for (const arm of ['armR', 'armL'] as Part[]) for (const f of [...sides, 'top' as Face]) plate(arm, f, leather, [0, 3])
    for (const f of ['front', 'back'] as Face[]) {
      plate('body', f, leather, [0, 12], [0, 1])
      plate('body', f, leather, [0, 12], [7, 8])
    }
    for (const f of ['left', 'right'] as Face[]) plate('body', f, leather)
    plate('body', 'top', leather)
    const lower = armor === 'leather' ? leather : ARMOR_TIER_COLOR[armor]
    for (const leg of ['legR', 'legL'] as Part[]) {
      if (armor !== 'leather') for (const f of sides) plate(leg, f, lower, [0, 9])
      for (const f of [...sides, 'bottom' as Face]) plate(leg, f, lower, [9, 12])
    }
    // Chain is a mesh: punch every other pixel out of its leggings.
    if (armor === 'chain')
      for (const leg of ['legR', 'legL'] as Part[])
        for (const f of sides) {
          const [x, y, rw] = faceRect(...PARTS[leg].over, ...PARTS[leg].size, f)
          for (let j = 0; j < 9; j++) for (let i = j % 2; i < rw; i += 2) g.clearRect(x + i, y + j, 1, 1)
        }
  }
  return c
}

const CAPE_W = 10
const CAPE_H = 16

/** Paints a cape design (look.cape, 1..) into a 32×32 texture, as the net of a 10×16×1 box. */
export function paintCape(design: number, team: TeamId | null): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  const team1 = team ? TEAM_COLORS[team] : '#888888'
  const [x, y] = faceRect(0, 0, CAPE_W, CAPE_H, 1, 'back')
  const [fx, fy] = faceRect(0, 0, CAPE_W, CAPE_H, 1, 'front')
  const at = (i: number, j: number, color: string) => {
    g.fillStyle = color
    g.fillRect(x + i, y + j, 1, 1)
  }
  for (let j = 0; j < CAPE_H; j++)
    for (let i = 0; i < CAPE_W; i++) {
      let color = team1
      const edge = i === 0 || i === CAPE_W - 1 || j === CAPE_H - 1
      switch (design) {
        case 1: // team: team colour with a white trim and a bed emblem
          color = edge ? '#f0f0f0' : j >= 5 && j <= 7 && i >= 3 && i <= 6 ? '#f0f0f0' : shade(team1, 0.95 + ((i + j) % 3) * 0.03)
          break
        case 2: {
          // flame: rising tongues of fire
          const t = j / CAPE_H
          const wave = Math.sin(i * 1.7 + j * 0.6) * 0.15
          color = t + wave > 0.75 ? '#7a1a0a' : t + wave > 0.5 ? '#d8401a' : t + wave > 0.25 ? '#f08a1a' : '#f8d24a'
          break
        }
        case 3: // galaxy: deep purple with stars
          color = (i * 13 + j * 7) % 17 === 0 ? '#ffffff' : (i * 5 + j * 11) % 23 === 0 ? '#c9b0ff' : shade('#2a1a5a', 0.8 + ((i + 2 * j) % 4) * 0.08)
          break
        case 4: // checker
          color = (Math.floor(i / 2) + Math.floor(j / 2)) % 2 ? '#f0f0f0' : '#1e1e1e'
          break
        case 5: // royal: crimson, gold trim, a crown
          color = edge ? '#e8c84a' : (j === 4 && i >= 3 && i <= 6) || (j === 3 && (i === 3 || i === 5 || i === 6)) ? '#e8c84a' : shade('#8a1a2a', 0.9 + (j % 3) * 0.05)
          break
        case 6: // leaf: green with veins
          color = i === 5 || (j % 4 === 0 && Math.abs(i - 5) === (j % 8) / 4 + 1) ? '#2e6a1e' : shade('#4a9a2e', 0.9 + ((i * j) % 3) * 0.06)
          break
        case 7: {
          // sunset bands
          const bands = ['#f8c24a', '#f08a3a', '#e8506a', '#a83a8a', '#5a2a7a']
          color = bands[Math.min(4, Math.floor((j / CAPE_H) * 5))]
          break
        }
        case 8: // frost
          color = (i + j * 3) % 7 === 0 ? '#ffffff' : shade('#8ad0f0', 0.9 + ((i + j) % 4) * 0.04)
          break
      }
      at(i, j, color)
    }
  // The inside (front, against the back) is a plain darker lining.
  g.fillStyle = shade(design === 1 ? team1 : '#3a3a3a', 0.55)
  g.fillRect(fx, fy, CAPE_W, CAPE_H)
  return c
}

function texture(canvas: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(canvas)
  t.magFilter = NearestFilter
  t.minFilter = NearestFilter
  t.colorSpace = SRGBColorSpace
  return t
}

/** A name tag: "[R] Name" in team colours over a health line, drawn crisp at any size. */
export function nameTag(name: string, team: TeamId | null, health: number | null, bot: boolean): Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = '600 40px "Pixelify Sans", ui-monospace, monospace'
  const prefix = team ? `[${TEAM_NAMES[team][0]}] ` : ''
  const suffix = bot ? ' bot' : ''
  ctx.font = font
  const w = Math.ceil(ctx.measureText(prefix + name + suffix).width) + 24
  canvas.width = Math.max(w, 120)
  canvas.height = health === null ? 56 : 96
  ctx.font = font
  ctx.fillStyle = 'rgba(0,0,0,0.42)'
  ctx.fillRect(0, 0, canvas.width, 56)
  ctx.textBaseline = 'middle'
  let x = (canvas.width - (w - 24)) / 2
  const draw = (text: string, color: string) => {
    ctx.fillStyle = '#000000'
    ctx.fillText(text, x + 3, 32)
    ctx.fillStyle = color
    ctx.fillText(text, x, 29)
    x += ctx.measureText(text).width
  }
  draw(prefix, team ? TEAM_COLORS[team] : '#cccccc')
  draw(name, '#ffffff')
  if (suffix) draw(suffix, '#a0a0a0')
  if (health !== null) {
    // Ten hearts' worth as a bar: red for health, dark for what is missing.
    const bw = 140
    const bx = (canvas.width - bw) / 2
    ctx.fillStyle = '#000000'
    ctx.fillRect(bx - 3, 64, bw + 6, 18)
    ctx.fillStyle = '#3a0c0c'
    ctx.fillRect(bx, 67, bw, 12)
    ctx.fillStyle = health > 6 ? '#e3262a' : '#ff8a2a'
    ctx.fillRect(bx, 67, (bw * Math.max(0, Math.min(20, health))) / 20, 12)
  }
  const sprite = new Sprite(new SpriteMaterial({ map: texture(canvas), transparent: true, depthWrite: false }))
  const height = health === null ? 0.3 : 0.52
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1)
  return sprite
}

function part(w: number, h: number, d: number, uv: [number, number], pivotTop: boolean, inflate = 0): Mesh {
  const g = new BoxGeometry((w + inflate) * PX, (h + inflate) * PX, (d + inflate) * PX)
  setBoxUV(g, uv[0], uv[1], w, h, d)
  if (pivotTop) g.translate(0, (-h * PX) / 2, 0)
  return new Mesh(g)
}

export interface AvatarPose {
  sneak: boolean
  /** Ticks since the last swing, and since last hurt. */
  swing: number
  hurt: number
  shield: boolean
  pitch: number
  /** Horizontal speed in blocks per second, and vertical velocity, for the cape. */
  speed: number
  vy: number
}

/**
 * A skinned figure: head, body, arms and legs as two-layer boxes on pivots, a
 * cape, the held item and a name tag. Rebuilds its textures only when the
 * look, team or armour changes.
 */
export class Avatar {
  readonly root = new Group()
  private body = new Group()
  private parts: Record<Part, Group> = {} as Record<Part, Group>
  private skinMat = new MeshLambertMaterial({ transparent: false })
  private overMat = new MeshLambertMaterial({ transparent: true, alphaTest: 0.5, side: DoubleSide })
  private capeMesh: Mesh
  private capeMat = new MeshLambertMaterial({ side: DoubleSide })
  private capeAngle = 0.1
  private held: Mesh | null = null
  private heldKey = ''
  private shieldMesh: Mesh
  private tag: Sprite | null = null
  private tagKey = ''
  private skinKey = ''
  private walk = 0
  private skinTexture: CanvasTexture | null = null
  private shadow: Mesh
  private capeTexture: CanvasTexture | null = null

  constructor(
    private readonly layout: AtlasLayout | null = null,
    private readonly atlas: Texture | null = null,
  ) {
    const mk = (name: Part, x: number, y: number) => {
      const p = PARTS[name]
      const pivot = new Group()
      pivot.position.set(x, y, 0)
      const top = name !== 'head'
      const base = part(...p.size, p.base, top)
      const over = part(...p.size, p.over, top, name === 'head' ? 1 : 0.5)
      base.material = this.skinMat
      over.material = this.overMat
      if (name === 'head') {
        base.position.y = over.position.y = (4 * PX)
      }
      pivot.add(base, over)
      this.parts[name] = pivot
      this.body.add(pivot)
    }
    mk('legR', 2 * PX, 12 * PX)
    mk('legL', -2 * PX, 12 * PX)
    mk('body', 0, 24 * PX)
    mk('armR', 6 * PX, 24 * PX)
    mk('armL', -6 * PX, 24 * PX)
    mk('head', 0, 24 * PX)
    const capeGeo = new BoxGeometry(CAPE_W * PX, CAPE_H * PX, PX)
    setBoxUV(capeGeo, 0, 0, CAPE_W, CAPE_H, 1, 32, 32)
    capeGeo.translate(0, (-CAPE_H * PX) / 2, 0)
    this.capeMesh = new Mesh(capeGeo, this.capeMat)
    this.capeMesh.position.set(0, 24 * PX, 2.6 * PX)
    this.capeMesh.visible = false
    this.body.add(this.capeMesh)
    this.shieldMesh = new Mesh(new BoxGeometry(0.06, 0.55, 0.45), new MeshLambertMaterial({ color: '#8a6a45' }))
    this.shieldMesh.position.set(-0.42, 1.05, -0.25)
    this.shieldMesh.visible = false
    this.body.add(this.shieldMesh)
    this.root.add(this.body)
    // A soft round shadow on the ground under the figure.
    const shadow = new Mesh(new CircleGeometry(0.42, 20), new MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }))
    shadow.rotation.x = -Math.PI / 2
    shadow.renderOrder = 1
    this.shadow = shadow
    this.root.add(shadow)
  }

  /** Puts the shadow on the ground `height` blocks below the feet (null: nothing below, hide it). */
  setGround(height: number | null) {
    this.shadow.visible = height !== null && height < 6
    if (height === null) return
    this.shadow.position.y = -height + 0.02
    const fade = Math.max(0, 1 - height / 6)
    ;(this.shadow.material as MeshBasicMaterial).opacity = 0.35 * fade
    this.shadow.scale.setScalar(1 - height * 0.06)
  }

  /** The current skin texture (shared with the first-person arm). */
  get skin(): CanvasTexture | null {
    return this.skinTexture
  }

  /** Repaints the skin and cape when the look, team or armour changes. */
  dress(look: Look, team: TeamId | null, armor: ArmorTier) {
    const key = `${JSON.stringify(look)}:${team}:${armor}`
    if (key === this.skinKey) return
    this.skinKey = key
    this.skinTexture?.dispose()
    this.skinTexture = texture(paintSkin(look, team, armor))
    this.skinMat.map = this.skinTexture
    this.overMat.map = this.skinTexture
    this.skinMat.needsUpdate = this.overMat.needsUpdate = true
    this.capeMesh.visible = look.cape > 0
    if (look.cape > 0) {
      this.capeTexture?.dispose()
      this.capeTexture = texture(paintCape(look.cape, team))
      this.capeMat.map = this.capeTexture
      this.capeMat.needsUpdate = true
    }
  }

  setTag(name: string, team: TeamId | null, health: number | null, bot: boolean, throughWalls: boolean) {
    const key = `${name}:${team}:${health}:${bot}:${throughWalls}`
    if (key === this.tagKey) return
    this.tagKey = key
    if (this.tag) {
      this.root.remove(this.tag)
      this.tag.material.map?.dispose()
      this.tag.material.dispose()
    }
    this.tag = nameTag(name, team, health, bot)
    this.tag.position.set(0, health === null ? 2.15 : 2.25, 0)
    // Teammates' tags show through walls, so you can find your team.
    this.tag.material.depthTest = !throughWalls
    this.tag.renderOrder = throughWalls ? 5 : 0
    this.root.add(this.tag)
  }

  setTagVisible(visible: boolean) {
    if (this.tag) this.tag.visible = visible
  }

  /** The item in the right hand: a real block for blocks, pixel art for everything else. */
  setHeld(id: string | null, team: TeamId | null) {
    const key = `${id}:${team}`
    if (key === this.heldKey) return
    this.heldKey = key
    if (this.held) this.parts.armR.remove(this.held)
    this.held = null
    const def = item(id ?? undefined)
    if (!def || def.kind === 'shield') return
    const block = def.kind === 'block' ? placedBlock(def, team ?? 'red') : def.kind === 'tnt' ? def.block : undefined
    if (block !== undefined && this.layout && this.atlas) {
      const m = new Mesh(blockCube(this.layout, block), new MeshLambertMaterial({ map: this.atlas, alphaTest: 0.5 }))
      m.scale.setScalar(0.25)
      m.position.set(0, -12 * PX, -0.12)
      this.held = m
    } else {
      const c = document.createElement('canvas')
      c.width = c.height = 16
      drawItemArt(c.getContext('2d')!, def.id)
      const m = new Mesh(new PlaneGeometry(0.55, 0.55), new MeshLambertMaterial({ map: texture(c), alphaTest: 0.5, side: DoubleSide }))
      m.position.set(0, -12 * PX - 0.08, -0.2)
      m.rotation.set(0, Math.PI / 2, Math.PI / 4)
      this.held = m
    }
    this.parts.armR.add(this.held)
  }

  /** Per frame: walk cycle, swing, sneak, head pitch, hurt flash, cape sway. */
  animate(dt: number, pose: AvatarPose) {
    const moving = Math.min(1, pose.speed / 5)
    this.walk += dt * pose.speed * 2.2
    const swingLegs = Math.sin(this.walk) * moving * 0.8
    this.parts.legR.rotation.x = swingLegs
    this.parts.legL.rotation.x = -swingLegs
    this.parts.armL.rotation.x = -swingLegs * 0.7
    const swing = pose.swing < 6 ? Math.sin((pose.swing / 6) * Math.PI) : 0
    this.parts.armR.rotation.x = swingLegs * 0.7 - swing * 1.5 - (this.heldKey.startsWith('null') ? 0 : 0.3)
    this.parts.armR.rotation.z = swing * 0.3
    this.parts.head.rotation.x = Math.max(-1.2, Math.min(1.2, pose.pitch))
    this.body.position.y = pose.sneak ? -0.12 : 0
    this.parts.body.rotation.x = pose.sneak ? 0.4 : 0
    this.shieldMesh.visible = pose.shield
    const flash = pose.hurt < 6
    for (const m of [this.skinMat, this.overMat]) m.emissive.setRGB(flash ? 0.55 : 0, 0, 0)
    // The cape lifts with speed and when falling, and settles back when still.
    const want = 0.08 + moving * 0.7 + Math.max(0, -pose.vy) * 0.6 + (pose.sneak ? 0.3 : 0)
    this.capeAngle += (Math.min(1.3, want) - this.capeAngle) * Math.min(1, dt * 6)
    // Negative: the cape swings out behind (+z), away from the body.
    this.capeMesh.rotation.x = -(this.capeAngle + Math.sin(this.walk * 0.5) * 0.04 * moving)
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof Mesh) o.geometry.dispose()
    })
    this.skinTexture?.dispose()
    this.capeTexture?.dispose()
    this.tag?.material.map?.dispose()
  }
}
