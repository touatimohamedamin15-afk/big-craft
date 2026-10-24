import { Group, type Texture } from 'three'
import type { AtlasLayout } from '../../../engine/render/atlas-layout'
import { textSprite } from '../../../engine/render/entities'
import type { TeamId } from '../blocks'
import { decodeLook, type Look } from '../look'
import type { MapMeta } from '../maps/types'
import type { PlayerView } from '../protocol'
import { Avatar } from './avatar'
import { ServerClock } from '../../../engine/net/clock'

interface Sample {
  tick: number
  v: PlayerView
}

interface RemotePlayer {
  model: Avatar
  /** Recent snapshots by server tick, oldest first. */
  samples: Sample[]
  lastPos: [number, number, number]
  trailClock: number
}

/** Snapshots kept per player: a second and a half, far more than the render delay needs. */
const KEEP_SAMPLES = 30

/** Called while someone with a trail moves: (x, y, z) at their feet and the trail index. */
export type TrailEmitter = (x: number, y: number, z: number, trail: number) => void

/** Remote players as skinned avatars, drawn on the server's timeline through a short jitter buffer. */
export class PlayerModels {
  readonly group = new Group()
  readonly clock = new ServerClock()
  private players = new Map<number, RemotePlayer>()

  constructor(
    private readonly layout: AtlasLayout,
    private readonly atlas: Texture,
    private readonly emit: TrailEmitter = () => {},
    /** Blocks between a point and the ground below it, or null when there is none close. */
    private readonly groundBelow: (x: number, y: number, z: number) => number | null = () => null,
  ) {}

  /** Records a snapshot of everyone at server tick `tick`. */
  update(views: PlayerView[], selfId: number, tick: number, now: number, myTeam: TeamId | null = null) {
    this.clock.observe(tick, now)
    const seen = new Set<number>()
    for (const v of views) {
      if (v.id === selfId) continue
      seen.add(v.id)
      let p = this.players.get(v.id)
      if (!p) {
        const model = new Avatar(this.layout, this.atlas)
        p = { model, samples: [], lastPos: [v.x, v.y, v.z], trailClock: 0 }
        this.players.set(v.id, p)
        this.group.add(model.root)
      }
      const last = p.samples.at(-1)
      // A respawn or teleport is a jump, not a glide: start the timeline over.
      if (last && (Math.hypot(v.x - last.v.x, v.y - last.v.y, v.z - last.v.z) > 6 || v.alive !== last.v.alive)) p.samples = []
      if (last && last.tick === tick) last.v = v
      else {
        // The server skips ticks in which nothing changed: whoever it skipped stood still until the tick before.
        if (last && p.samples.length && tick - last.tick > 1) p.samples.push({ tick: tick - 1, v: last.v })
        p.samples.push({ tick, v })
      }
      if (p.samples.length > KEEP_SAMPLES) p.samples.shift()
      const mate = !!myTeam && v.team === myTeam
      p.model.dress(decodeLook(v.look), v.team, v.armor)
      p.model.setTag(v.name, v.team, v.health, v.bot, mate)
      p.model.setHeld(v.held, v.team)
    }
    for (const [id, p] of this.players)
      if (!seen.has(id)) {
        this.group.remove(p.model.root)
        p.model.dispose()
        this.players.delete(id)
      }
  }

  /** The server tick others are drawn at now; attacks report it for lag compensation. */
  renderTick(now: number): number {
    return this.clock.renderTick(now)
  }

  private displayView(p: RemotePlayer, now: number): PlayerView {
    const s = p.samples
    const t = this.clock.renderTick(now)
    let i = s.length - 1
    while (i > 0 && s[i].tick > t) i--
    const a = s[i]
    const b = s[i + 1]
    if (!b) {
      // Past the newest snapshot: hold there (the buffer is sized so this is rare).
      return a.v
    }
    const f = Math.max(0, Math.min(1, (t - a.tick) / (b.tick - a.tick)))
    const lerpAngle = (x: number, y: number) => x + Math.atan2(Math.sin(y - x), Math.cos(y - x)) * f
    return {
      ...b.v,
      x: a.v.x + (b.v.x - a.v.x) * f,
      y: a.v.y + (b.v.y - a.v.y) * f,
      z: a.v.z + (b.v.z - a.v.z) * f,
      yaw: lerpAngle(a.v.yaw, b.v.yaw),
      pitch: a.v.pitch + (b.v.pitch - a.v.pitch) * f,
    }
  }

  /** Where every living remote player is right now, for aiming and placement checks. */
  boxes(now: number): { id: number; x: number; y: number; z: number; sneak: boolean; team: TeamId | null }[] {
    const out = []
    for (const [id, p] of this.players) {
      const v = this.displayView(p, now)
      if (v.alive) out.push({ id, x: v.x, y: v.y, z: v.z, sneak: v.sneak, team: v.team })
    }
    return out
  }

  /** Poses every model for this frame; `tick` is the latest server tick, for swing and hurt timers. */
  frame(now: number, dt: number, tick: number, myTeam: TeamId | null = null): void {
    for (const p of this.players.values()) {
      const v = this.displayView(p, now)
      const enemy = !myTeam || v.team !== myTeam
      // Invisible players are hidden from their enemies; teammates still see them.
      p.model.root.visible = v.alive && !(v.invisible && enemy)
      // A sneaking enemy's name tag is hidden, as in the genre.
      p.model.setTagVisible(!(v.sneak && enemy))
      p.model.root.position.set(v.x, v.y, v.z)
      p.model.root.rotation.y = v.yaw
      p.model.setGround(this.groundBelow(v.x, v.y, v.z))
      const speed = Math.hypot(v.x - p.lastPos[0], v.z - p.lastPos[2]) / Math.max(dt, 1e-3)
      const vy = (v.y - p.lastPos[1]) / Math.max(dt, 1e-3) / 20
      p.lastPos = [v.x, v.y, v.z]
      p.model.animate(dt, { sneak: v.sneak, shield: v.shield, pitch: v.pitch, swing: tick - v.swingAt, hurt: tick - v.hurtAt, speed: Math.min(10, speed), vy })
      const trail = decodeLook(v.look).trail
      if (trail > 0 && v.alive && speed > 1 && !(v.invisible && enemy)) {
        p.trailClock += dt
        if (p.trailClock > 0.07) {
          p.trailClock = 0
          this.emit(v.x, v.y + 0.1, v.z, trail)
        }
      }
    }
  }

  clear() {
    for (const p of this.players.values()) {
      this.group.remove(p.model.root)
      p.model.dispose()
    }
    this.players.clear()
  }
}

/** Shopkeepers wear aprons in shop green or upgrades purple. */
const SHOPKEEPER: Look = { skin: 2, hairStyle: 0, hairColor: 6, eyes: 1, outfit: 2, outfitColor: 4, cape: 0, trail: 0, killEffect: 0 }
const UPGRADER: Look = { skin: 4, hairStyle: 5, hairColor: 0, eyes: 4, outfit: 1, outfitColor: 5, cape: 5, trail: 0, killEffect: 0 }

/** Shopkeepers and floating labels from the map. */
export function createMapDecor(npcs: MapMeta['npcs'], labels: MapMeta['labels'], layout: AtlasLayout, atlas: Texture): Group {
  const group = new Group()
  for (const n of npcs) {
    if (n.kind === 'dummy') continue
    const model = new Avatar(layout, atlas)
    model.dress(n.kind === 'shop' ? SHOPKEEPER : UPGRADER, n.team ?? null, 'leather')
    model.setTag(n.kind === 'shop' ? 'Item shop' : 'Team upgrades', null, null, false, false)
    model.root.position.set(n.x, n.y, n.z)
    model.root.rotation.y = n.yaw
    model.animate(0, { sneak: false, swing: 20, hurt: 20, shield: false, pitch: 0, speed: 0, vy: 0 })
    group.add(model.root)
  }
  for (const l of labels) {
    const s = textSprite(l.text, '#ffffff', 0.34)
    s.position.set(l.x, l.y, l.z)
    group.add(s)
  }
  return group
}
