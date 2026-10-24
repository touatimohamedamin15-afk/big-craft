import {
  BoxGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three'
import { item } from '../items'
import { tileUV, type AtlasLayout } from './atlas-layout'

/** What a humanoid needs to pose itself each frame. */
export interface Pose {
  sneak: boolean
  /** Ticks since the last swing (capped); under 6 plays the swing. */
  swing: number
  /** Ticks since last hurt (capped); under 6 flashes red. */
  hurt: number
  shield: boolean
  pitch: number
}

export interface DropLike {
  id: number
  item: string
  count: number
  x: number
  y: number
  z: number
}

const SKIN = '#d9a066'

/** A text sprite (name tags, station labels). Height is in blocks. */
export function textSprite(text: string, color = '#ffffff', height = 0.32, background = 'rgba(0,0,0,0.38)'): Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = '600 44px ui-sans-serif, system-ui, sans-serif'
  ctx.font = font
  const w = Math.ceil(ctx.measureText(text).width) + 28
  canvas.width = w
  canvas.height = 64
  ctx.font = font
  ctx.fillStyle = background
  ctx.beginPath()
  ctx.roundRect(0, 0, w, 64, 16)
  ctx.fill()
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 14, 34)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthWrite: false, transparent: true }))
  sprite.scale.set((height * w) / 64, height, 1)
  return sprite
}

function box(w: number, h: number, d: number, color: string, pivotTop = true): Mesh {
  const g = new BoxGeometry(w, h, d)
  if (pivotTop) g.translate(0, -h / 2, 0)
  return new Mesh(g, new MeshLambertMaterial({ color }))
}

export function darker(hex: string, f: number): string {
  return `#${new Color(hex).multiplyScalar(f).getHexString()}`
}

/** A blocky humanoid: legs 0.7, body 0.65, head 0.45 = 1.8 blocks, eyes at about 1.6. */
export class Humanoid {
  readonly root = new Group()
  private body = new Group()
  private head: Mesh
  private torso: Mesh
  private armL: Mesh
  private armR: Mesh
  private legL: Mesh
  private legR: Mesh
  private helmet: Mesh
  private heldMesh: Mesh | null = null
  private heldId: string | null = null
  private shieldMesh: Mesh
  private tag: Sprite | null = null
  private tagText = ''
  private walk = 0
  private materials: MeshLambertMaterial[] = []

  constructor(shirt: string, pants: string) {
    this.legL = box(0.24, 0.7, 0.24, pants)
    this.legR = box(0.24, 0.7, 0.24, pants)
    this.legL.position.set(-0.13, 0.7, 0)
    this.legR.position.set(0.13, 0.7, 0)
    this.torso = box(0.5, 0.65, 0.26, shirt)
    this.torso.position.set(0, 1.35, 0)
    this.armL = box(0.2, 0.65, 0.2, shirt)
    this.armR = box(0.2, 0.65, 0.2, shirt)
    this.armL.position.set(-0.36, 1.33, 0)
    this.armR.position.set(0.36, 1.33, 0)
    this.head = box(0.45, 0.45, 0.45, SKIN, false)
    this.head.position.set(0, 1.575, 0)
    // Eyes, so you can tell which way someone faces.
    for (const x of [-0.1, 0.1]) {
      const eye = box(0.07, 0.07, 0.02, '#2a2a2a', false)
      eye.position.set(x, 0.03, -0.226)
      this.head.add(eye)
    }
    this.helmet = box(0.5, 0.2, 0.5, '#888888', false)
    this.helmet.position.set(0, 0.17, 0)
    this.helmet.visible = false
    this.head.add(this.helmet)
    this.shieldMesh = box(0.08, 0.6, 0.5, '#8a6a45', false)
    this.shieldMesh.position.set(-0.45, 1.05, -0.25)
    this.shieldMesh.visible = false
    this.body.add(this.legL, this.legR, this.torso, this.armL, this.armR, this.head, this.shieldMesh)
    this.root.add(this.body)
    this.root.traverse((o) => {
      if (o instanceof Mesh && o.material instanceof MeshLambertMaterial) this.materials.push(o.material)
    })
  }

  setTag(text: string, color: string) {
    if (text === this.tagText) return
    this.tagText = text
    if (this.tag) {
      this.root.remove(this.tag)
      this.tag.material.map?.dispose()
      this.tag.material.dispose()
    }
    this.tag = textSprite(text, color, 0.3)
    this.tag.position.set(0, 2.15, 0)
    this.root.add(this.tag)
  }

  /** Leg colour, and a helmet colour (or null for no helmet). */
  setOutfit(legs: string, helmet: string | null) {
    ;(this.legL.material as MeshLambertMaterial).color.set(legs)
    ;(this.legR.material as MeshLambertMaterial).color.set(legs)
    this.helmet.visible = helmet !== null
    if (helmet) (this.helmet.material as MeshLambertMaterial).color.set(helmet)
  }

  setHeld(id: string | null) {
    if (id === this.heldId) return
    this.heldId = id
    if (this.heldMesh) this.armR.remove(this.heldMesh)
    this.heldMesh = null
    const def = item(id ?? undefined)
    if (!def || def.kind === 'shield') return
    const long = def.kind === 'sword' || def.kind === 'tool'
    const m = box(long ? 0.06 : 0.22, long ? 0.6 : 0.22, long ? 0.06 : 0.22, def.color, false)
    m.position.set(0, -0.62, long ? -0.25 : -0.12)
    if (long) m.rotation.x = Math.PI / 2.6
    this.armR.add(m)
    this.heldMesh = m
  }

  /** Per frame: pose from movement speed, sneaking, swing and hurt flash. */
  animate(speed: number, dt: number, view: Pose) {
    this.walk += speed * dt * 9
    const swingLegs = Math.sin(this.walk) * Math.min(1, speed * 1.5) * 0.7
    this.legL.rotation.x = swingLegs
    this.legR.rotation.x = -swingLegs
    this.armL.rotation.x = -swingLegs * 0.8
    const swing = view.swing < 6 ? Math.sin((view.swing / 6) * Math.PI) : 0
    this.armR.rotation.x = swingLegs * 0.8 - swing * 1.6 - (this.heldId ? 0.3 : 0)
    this.head.rotation.x = Math.max(-1.2, Math.min(1.2, view.pitch))
    this.body.position.y = view.sneak ? -0.2 : 0
    this.torso.rotation.x = view.sneak ? 0.35 : 0
    this.shieldMesh.visible = view.shield
    const flash = view.hurt < 6
    for (const m of this.materials) m.emissive.setRGB(flash ? 0.6 : 0, 0, 0)
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof Mesh) {
        o.geometry.dispose()
        ;(o.material as MeshLambertMaterial).dispose()
      }
    })
    this.tag?.material.map?.dispose()
  }
}

/** Generator piles and other dropped items: small spinning cubes. */
export class DropModels {
  readonly group = new Group()
  private drops = new Map<number, { obj: Group; view: DropLike }>()
  private geometry = new BoxGeometry(0.25, 0.25, 0.25)

  update(views: DropLike[]) {
    const seen = new Set<number>()
    for (const v of views) {
      seen.add(v.id)
      let d = this.drops.get(v.id)
      if (!d) {
        const obj = new Group()
        const color = item(v.item)?.color ?? '#ffffff'
        for (let i = 0; i < 3; i++) {
          const m = new Mesh(this.geometry, new MeshLambertMaterial({ color, emissive: new Color(color).multiplyScalar(0.25) }))
          m.position.set((i - 1) * 0.12, i * 0.08, (i % 2) * 0.1)
          obj.add(m)
        }
        d = { obj, view: v }
        this.drops.set(v.id, d)
        this.group.add(obj)
      }
      d.view = v
      d.obj.children.forEach((c, i) => (c.visible = i < Math.min(3, Math.ceil(v.count / 4))))
    }
    for (const [id, d] of this.drops)
      if (!seen.has(id)) {
        this.group.remove(d.obj)
        this.drops.delete(id)
      }
  }

  frame(seconds: number) {
    for (const d of this.drops.values()) {
      d.obj.position.set(d.view.x, d.view.y + 0.25 + Math.sin(seconds * 2 + d.view.id) * 0.08, d.view.z)
      d.obj.rotation.y = seconds * 1.5 + d.view.id
    }
  }

  clear() {
    for (const d of this.drops.values()) this.group.remove(d.obj)
    this.drops.clear()
  }
}

/** Outline of the targeted block and the crack overlay while digging. */
export class BlockCursor {
  readonly group = new Group()
  private outline: LineSegments
  private crack: Mesh

  constructor(private readonly cracks: Texture[]) {
    this.outline = new LineSegments(new EdgesGeometry(new BoxGeometry(1.004, 1.004, 1.004)), new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }))
    this.crack = new Mesh(
      new BoxGeometry(1.006, 1.006, 1.006),
      new MeshBasicMaterial({ map: cracks[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    )
    this.group.add(this.outline, this.crack)
  }

  set(target: [number, number, number] | null, height: number, progress: number) {
    this.outline.visible = !!target
    this.crack.visible = !!target && progress > 0
    if (!target) return
    const [x, y, z] = target
    this.outline.position.set(x + 0.5, y + height / 2, z + 0.5)
    this.outline.scale.set(1, height, 1)
    this.crack.position.copy(this.outline.position)
    this.crack.scale.set(1, height, 1)
    ;(this.crack.material as MeshBasicMaterial).map = this.cracks[Math.min(9, Math.floor(progress * 10))]
  }
}

const cubes = new Map<string, BoxGeometry>()

/** A unit cube whose faces use a block's atlas tiles (top, side, bottom), for held blocks and block-shaped entities. */
export function blockCube(layout: AtlasLayout, block: number): BoxGeometry {
  const key = `${layout.size}:${block}`
  let g = cubes.get(key)
  if (g) return g
  g = new BoxGeometry(1, 1, 1)
  const uv = g.getAttribute('uv')
  const faces = layout.faces[block]
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; four vertices each.
  const which = [1, 1, 0, 2, 1, 1]
  const out: number[] = []
  for (let f = 0; f < 6; f++) {
    const [u0, v0, u1, v1] = tileUV(layout, faces[which[f]])
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      out.push(u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0))
    }
  }
  g.setAttribute('uv', new Float32BufferAttribute(out, 2))
  cubes.set(key, g)
  return g
}
