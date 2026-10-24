import { forwardOf, playerBox, type Box } from './physics'
import { raycastBlock, rayBox } from './raycast'
import type { World } from './world'

export const KNOCKBACK_H = 0.4
export const KNOCKBACK_SPRINT_H = 0.45
export const KNOCKBACK_V = 0.36
export const SHIELD_KNOCKBACK = 0.3

/** New victim velocity after a hit from an attacker at (ax, az). */
export function knockback(
  victim: { x: number; z: number; vx: number; vy: number; vz: number },
  attacker: { x: number; z: number; yaw: number },
  sprinting: boolean,
  shielded: boolean,
): { vx: number; vy: number; vz: number } {
  let dx = victim.x - attacker.x
  let dz = victim.z - attacker.z
  let len = Math.hypot(dx, dz)
  if (len < 1e-4) {
    ;[dx, dz] = forwardOf(attacker.yaw)
    len = 1
  }
  dx /= len
  dz /= len
  const scale = shielded ? SHIELD_KNOCKBACK : 1
  const h = (sprinting ? KNOCKBACK_SPRINT_H + KNOCKBACK_H : KNOCKBACK_H) * scale
  return {
    vx: victim.vx / 2 + dx * h,
    vy: Math.min(KNOCKBACK_V, victim.vy / 2 + KNOCKBACK_V * scale),
    vz: victim.vz / 2 + dz * h,
  }
}

/** A raised shield stops hits from in front of the holder (within 90° of where they face). */
export function shieldBlocks(victim: { x: number; z: number; yaw: number }, attacker: { x: number; z: number }): boolean {
  const [fx, fz] = forwardOf(victim.yaw)
  const dx = attacker.x - victim.x
  const dz = attacker.z - victim.z
  return fx * dx + fz * dz > 0
}

/**
 * Whether a melee swing from `eye` along `dir` reaches the victim's box before
 * any block does.
 */
export function swingReaches(world: World, eye: readonly number[], dir: readonly number[], victim: Box, reach: number): boolean {
  const hit = rayBox(eye, dir, inflate(victim, 0.1), reach)
  if (!hit) return false
  const block = raycastBlock(world, eye, dir, hit.distance, true)
  return !block || block.distance > hit.distance
}

/** Nearest-point distance from the eye to a player box; the server's reach check. */
export function reachDistance(eye: readonly number[], x: number, y: number, z: number, sneaking: boolean): number {
  const b = playerBox(x, y, z, sneaking)
  let d = 0
  for (let a = 0; a < 3; a++) {
    const v = eye[a] < b[a] ? b[a] - eye[a] : eye[a] > b[a + 3] ? eye[a] - b[a + 3] : 0
    d += v * v
  }
  return Math.sqrt(d)
}

function inflate(b: Box, r: number): Box {
  return [b[0] - r, b[1] - r, b[2] - r, b[3] + r, b[4] + r, b[5] + r]
}
