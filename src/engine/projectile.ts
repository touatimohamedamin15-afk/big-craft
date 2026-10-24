import type { Box } from './physics'
import { raycastBlock, rayBox, type BlockHit } from './raycast'
import type { World } from './world'

export interface Projectile {
  id: number
  kind: string
  /** Who fired it (a player id); never hits its owner in its first few ticks. */
  owner: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  gravity: number
  /** Velocity kept per tick (air drag). */
  drag: number
  age: number
  maxAge: number
}

export type ProjectileHit = { kind: 'block'; block: BlockHit; x: number; y: number; z: number } | { kind: 'body'; id: number; x: number; y: number; z: number } | null

/** Ticks after launch during which a projectile ignores its owner (it starts inside them). */
export const OWNER_GRACE = 4

/**
 * Moves a projectile one tick along a straight sweep, stopping at the first
 * block or body it meets, then applies gravity and drag. Shared by every
 * thrown or fired thing: arrows, fireballs, pearls, eggs.
 */
export function stepProjectile(world: World, p: Projectile, bodies: { id: number; box: Box }[]): ProjectileHit {
  p.age++
  const speed = Math.hypot(p.vx, p.vy, p.vz)
  let hit: ProjectileHit = null
  if (speed > 1e-6) {
    const dir = [p.vx / speed, p.vy / speed, p.vz / speed]
    const origin = [p.x, p.y, p.z]
    let nearest = speed
    const block = raycastBlock(world, origin, dir, speed, true)
    if (block) {
      nearest = block.distance
      hit = { kind: 'block', block, x: p.x + dir[0] * block.distance, y: p.y + dir[1] * block.distance, z: p.z + dir[2] * block.distance }
    }
    for (const b of bodies) {
      if (b.id === p.owner && p.age <= OWNER_GRACE) continue
      const h = rayBox(origin, dir, b.box, nearest)
      if (h && h.distance <= nearest) {
        nearest = h.distance
        hit = { kind: 'body', id: b.id, x: p.x + dir[0] * h.distance, y: p.y + dir[1] * h.distance, z: p.z + dir[2] * h.distance }
      }
    }
    const travel = hit ? nearest : speed
    p.x += dir[0] * travel
    p.y += dir[1] * travel
    p.z += dir[2] * travel
  }
  p.vy -= p.gravity
  p.vx *= p.drag
  p.vy *= p.drag
  p.vz *= p.drag
  return hit
}
