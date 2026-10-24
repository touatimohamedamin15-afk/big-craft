import { checkPlace } from '../../engine/building'
import { explosionCells, explosionImpact } from '../../engine/explosion'
import { removeFromSlot, countItem, removeItem } from '../../engine/inventory'
import { lookDirection, playerBox } from '../../engine/physics'
import { stepProjectile, type Projectile } from '../../engine/projectile'
import { AIR, isBed, WOOL } from './blocks'
import { armorReduction, shieldBlocks } from './combat'
import { BLOCK_REACH, REACH_SLACK, TPS } from './constants'
import { EFFECT_TICKS, type Effect } from './items'
import type { ProjectileView } from './protocol'
import type { Player, Room } from './room'
import { NO_UPGRADES } from './shop'

/** Tuning for every ranged and explosive item, in blocks and ticks. */
export const ARROW = { speed: 3, gravity: 0.05, drag: 0.99, maxAge: 100, damage: 7, minCharge: 0.15 }
export const FIREBALL = { speed: 1, power: 2.4, maxAge: 100, cooldown: 10 }
export const PEARL = { speed: 1.5, gravity: 0.03, drag: 0.99, maxAge: 120, landingDamage: 2 }
export const EGG = { speed: 1, gravity: 0.004, maxAge: 30 }
export const TNT_FUSE = 3 * TPS
export const TNT_POWER = 3.2
/** Explosion damage per unit of power at the centre, before armour. */
const EXPLOSION_DAMAGE = 2.5
/** Your own fireballs and TNT hurt you this much less (fireball jumping is a technique). */
const SELF_DAMAGE = 0.3

interface Shot extends Projectile {
  /** Bow draw from 0 to 1, for arrow damage. */
  charge: number
  team: string | null
}

/** Bows, throwables, lit TNT and potions: the ranged and utility side of a room. */
export class Arsenal {
  projectiles: Shot[] = []
  private nextId = 1
  /** Whether last tick's broadcast had projectiles, so one empty list clears clients. */
  private sentAny = false

  constructor(private readonly room: Room) {}

  reset() {
    this.projectiles = []
  }

  // Bow ---------------------------------------------------------------------

  draw(p: Player) {
    if (!this.room.canAct(p) || this.room.held(p)?.kind !== 'bow' || countItem(p.inventory, 'arrow') === 0) return
    p.drawStart = this.room.tickCount
  }

  /** The server times the draw itself, so a client cannot claim a full charge. */
  release(p: Player) {
    const start = p.drawStart
    p.drawStart = null
    if (start === null || !this.room.canAct(p) || this.room.held(p)?.kind !== 'bow') return
    const charge = Math.min(1, (this.room.tickCount - start) / TPS)
    if (charge < ARROW.minCharge || !removeItem(p.inventory, 'arrow', 1)) return
    p.lastSwing = this.room.tickCount
    this.launch(p, 'arrow', ARROW.speed * charge, ARROW.gravity, ARROW.drag, ARROW.maxAge, charge)
  }

  // Throwables ----------------------------------------------------------------

  throw(p: Player) {
    if (!this.room.canAct(p)) return
    const def = this.room.held(p)
    if (def?.kind !== 'throwable' || this.room.tickCount - p.lastThrowTick < FIREBALL.cooldown) return
    p.lastThrowTick = this.room.tickCount
    removeFromSlot(p.inventory, p.selected)
    p.lastSwing = this.room.tickCount
    switch (def.meta?.projectile) {
      case 'fireball':
        return this.launch(p, 'fireball', FIREBALL.speed, 0, 1, FIREBALL.maxAge)
      case 'pearl':
        return this.launch(p, 'pearl', PEARL.speed, PEARL.gravity, PEARL.drag, PEARL.maxAge)
      case 'egg':
        return this.launch(p, 'egg', EGG.speed, EGG.gravity, 1, EGG.maxAge)
    }
  }

  private launch(p: Player, kind: string, speed: number, gravity: number, drag: number, maxAge: number, charge = 1) {
    const [dx, dy, dz] = lookDirection(p.yaw, p.pitch)
    const [ex, ey, ez] = this.room.eye(p)
    this.projectiles.push({ id: this.nextId++, kind, owner: p.id, team: p.team, x: ex, y: ey - 0.1, z: ez, vx: dx * speed, vy: dy * speed, vz: dz * speed, gravity, drag, age: 0, maxAge, charge })
  }

  // TNT ---------------------------------------------------------------------

  /** Placing TNT lights it: an entity on a fuse, not a block. Returns whether it was placed. */
  placeTnt(p: Player, x: number, y: number, z: number, slot: number): boolean {
    const e = this.room.eye(p)
    if (Math.hypot(x + 0.5 - e[0], y + 0.5 - e[1], z + 0.5 - e[2]) > BLOCK_REACH + REACH_SLACK + 0.9) return false
    const bodies = [...this.room.players.values()].filter((q) => q.alive).map((q) => playerBox(q.x, q.y, q.z, q.sneaking))
    if (checkPlace(this.room.world, this.room.map.build, x, y, z, bodies)) return false
    if (!removeFromSlot(p.inventory, slot)) return false
    this.projectiles.push({ id: this.nextId++, kind: 'tnt', owner: p.id, team: p.team, x: x + 0.5, y, z: z + 0.5, vx: 0, vy: 0, vz: 0, gravity: 0.04, drag: 0.98, age: 0, maxAge: TNT_FUSE, charge: 1 })
    return true
  }

  // Potions -----------------------------------------------------------------

  drink(p: Player): boolean {
    const def = this.room.held(p)
    if (def?.kind !== 'potion') return false
    const effect = def.meta?.effect as Effect
    removeFromSlot(p.inventory, p.selected)
    p.effects[effect] = this.room.tickCount + EFFECT_TICKS(Number(def.meta?.seconds ?? 30))
    return true
  }

  // Each tick ---------------------------------------------------------------

  step() {
    const room = this.room
    const bodies = [...room.players.values()].filter((q) => q.alive).map((q) => ({ id: q.id, box: playerBox(q.x, q.y, q.z, q.sneaking) }))
    this.projectiles = this.projectiles.filter((s) => {
      if (s.kind === 'tnt') {
        // TNT only falls and waits for its fuse.
        stepProjectile(room.world, s, [])
        if (s.age < s.maxAge) return true
        this.explode(s.x, s.y + 0.5, s.z, TNT_POWER, s.owner)
        return false
      }
      const hit = stepProjectile(room.world, s, bodies)
      if (s.kind === 'egg') this.layEgg(s)
      if (!hit) {
        if (s.age >= s.maxAge || s.y < room.map.killY) {
          if (s.kind === 'fireball') this.explode(s.x, s.y, s.z, FIREBALL.power, s.owner)
          return false
        }
        return true
      }
      switch (s.kind) {
        case 'arrow':
          if (hit.kind === 'body') this.arrowHit(s, hit.id)
          return false
        case 'fireball':
          this.explode(hit.x, hit.y, hit.z, FIREBALL.power, s.owner)
          return false
        case 'pearl':
          this.pearlLand(s, hit)
          return false
        case 'egg':
          return hit.kind === 'body'
      }
      return false
    })
  }

  private arrowHit(s: Shot, targetId: number) {
    const room = this.room
    const v = room.players.get(targetId)
    const shooter = room.players.get(s.owner)
    if (!v || !v.alive || (s.team && v.team === s.team) || v.protectedTicks > 0) return
    const speed = Math.hypot(s.vx, s.vy, s.vz) || 1
    if (v.shield && shieldBlocks(v, { x: v.x - s.vx, z: v.z - s.vz })) return
    const protection = (v.team && room.teams.get(v.team)?.upgrades.protection) || NO_UPGRADES.protection
    const damage = Math.max(1, ARROW.damage * s.charge) * (1 - armorReduction(v.armor, protection))
    if (shooter) v.lastAttacker = { id: shooter.id, tick: room.tickCount }
    room.applyKnockback(v, { vx: v.vx / 2 + (s.vx / speed) * 0.3, vy: 0.25, vz: v.vz / 2 + (s.vz / speed) * 0.3 })
    room.hurt(v, damage, 'arrow', shooter)
  }

  private pearlLand(s: Shot, hit: { x: number; y: number; z: number; kind: string; block?: { face: [number, number, number] } }) {
    const room = this.room
    const p = room.players.get(s.owner)
    if (!p || !p.alive) return
    // Step back a little from the surface; land on top when the pearl hit a top face.
    const speed = Math.hypot(s.vx, s.vy, s.vz) || 1
    let x = hit.x - (s.vx / speed) * 0.4
    let y = hit.y - (s.vy / speed) * 0.4
    let z = hit.z - (s.vz / speed) * 0.4
    if (hit.kind === 'block' && hit.block && hit.block.face[1] === 1) y = Math.floor(hit.y + 0.01)
    if (hit.kind === 'block' && hit.block && hit.block.face[1] === -1) y -= 1.8
    x = Math.max(0.3, x)
    z = Math.max(0.3, z)
    room.teleport(p, x, y, z, p.yaw, p.pitch)
    p.kbGrace = 10
    room.hurt(p, PEARL.landingDamage, 'fall')
  }

  /** A bridge egg lays team wool a little under its path, never inside players or protected spots. */
  private layEgg(s: Shot) {
    const room = this.room
    const team = s.team ?? 'red'
    const x = Math.floor(s.x)
    // Thrown from eye height: the cell just under the thrower's feet level.
    const y = Math.floor(s.y - 1.6)
    const z = Math.floor(s.z)
    if (room.world.get(x, y, z) !== AIR) return
    const bodies = [...room.players.values()].filter((q) => q.alive).map((q) => playerBox(q.x, q.y, q.z, q.sneaking))
    const why = checkPlace(room.world, room.map.build, x, y, z, bodies)
    if (why && why !== 'floating') return
    room.world.set(x, y, z, WOOL[team as keyof typeof WOOL], true)
  }

  /** Breaks placed blocks (never map blocks or beds), hurts and throws everyone near. */
  explode(x: number, y: number, z: number, power: number, ownerId: number) {
    const room = this.room
    const owner = room.players.get(ownerId)
    for (const [bx, by, bz] of explosionCells(room.world, x, y, z, power, (cx, cy, cz) => room.world.isPlaced(cx, cy, cz) && !isBed(room.world.get(cx, cy, cz)))) room.world.set(bx, by, bz, AIR)
    for (const v of room.players.values()) {
      if (!v.alive) continue
      const cx = v.x - x
      const cy = v.y + 0.9 - y
      const cz = v.z - z
      const d = Math.hypot(cx, cy, cz)
      const impact = explosionImpact(d, power)
      if (impact <= 0) continue
      const len = Math.hypot(cx, cz) || 1
      room.applyKnockback(v, { vx: v.vx * 0.5 + (cx / len) * impact * 1.3, vy: Math.min(1.1, 0.35 + impact * 0.7), vz: v.vz * 0.5 + (cz / len) * impact * 1.3 })
      const self = v.id === ownerId
      const ally = !self && owner?.team && v.team === owner.team
      if (ally || v.protectedTicks > 0) continue
      const protection = (v.team && room.teams.get(v.team)?.upgrades.protection) || 0
      const damage = impact * power * EXPLOSION_DAMAGE * (self ? SELF_DAMAGE : 1) * (1 - armorReduction(v.armor, protection))
      if (owner && !self) v.lastAttacker = { id: owner.id, tick: room.tickCount }
      room.hurt(v, damage, 'explosion', self ? undefined : owner)
    }
    room.broadcast({ t: 'explosion', x, y, z, power })
  }

  /** Projectiles for clients: sent every tick while any fly, then one empty list. */
  views(): ProjectileView[] | null {
    if (this.projectiles.length === 0 && !this.sentAny) return null
    this.sentAny = this.projectiles.length > 0
    return this.projectiles.map((s) => ({
      id: s.id,
      kind: s.kind,
      x: Math.round(s.x * 100) / 100,
      y: Math.round(s.y * 100) / 100,
      z: Math.round(s.z * 100) / 100,
      vx: Math.round(s.vx * 100) / 100,
      vy: Math.round(s.vy * 100) / 100,
      vz: Math.round(s.vz * 100) / 100,
      fuse: s.kind === 'tnt' ? s.maxAge - s.age : undefined,
    }))
  }
}

