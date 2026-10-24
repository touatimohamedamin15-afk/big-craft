import { AIR, blockDef } from './blocks'
import type { Box } from './physics'
import type { World } from './world'

export interface BlockHit {
  x: number
  y: number
  z: number
  /** Normal of the face the ray entered through. */
  face: [number, number, number]
  distance: number
}

/** Ray against a box; returns entry distance and face normal, or null. */
export function rayBox(
  origin: readonly number[],
  dir: readonly number[],
  box: Box,
  maxDist: number,
): { distance: number; face: [number, number, number] } | null {
  let tmin = 0
  let tmax = maxDist
  let axis = -1
  let sign = 0
  for (let a = 0; a < 3; a++) {
    const o = origin[a]
    const d = dir[a]
    const lo = box[a]
    const hi = box[a + 3]
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null
      continue
    }
    let t1 = (lo - o) / d
    let t2 = (hi - o) / d
    let s = -1
    if (t1 > t2) {
      ;[t1, t2] = [t2, t1]
      s = 1
    }
    if (t1 > tmin) {
      tmin = t1
      axis = a
      sign = s
    }
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }
  const face: [number, number, number] = [0, 0, 0]
  if (axis >= 0) face[axis] = sign
  return { distance: tmin, face }
}

/**
 * Steps through cells along the ray (Amanatides and Woo) and returns the first non-air block hit.
 * With `solidOnly`, non-solid blocks (flowers, poles, chains) are seen through: for line of sight
 * to players and shopkeepers, and for what blocks a swing or an arrow.
 */
export function raycastBlock(world: World, origin: readonly number[], dir: readonly number[], maxDist: number, solidOnly = false): BlockHit | null {
  let x = Math.floor(origin[0])
  let y = Math.floor(origin[1])
  let z = Math.floor(origin[2])
  const step = dir.map((d) => (d > 0 ? 1 : d < 0 ? -1 : 0))
  const tDelta = dir.map((d) => (d === 0 ? Infinity : Math.abs(1 / d)))
  const cell = [x, y, z]
  const tMax = dir.map((d, a) => {
    if (d === 0) return Infinity
    const boundary = d > 0 ? cell[a] + 1 : cell[a]
    return (boundary - origin[a]) / d
  })
  let t = 0
  for (let guard = 0; guard < 256 && t <= maxDist; guard++) {
    const id = world.get(x, y, z)
    const def = id === AIR ? null : blockDef(id)
    if (def && (def.solid || !solidOnly)) {
      const hit = rayBox(origin, dir, [x, y, z, x + 1, y + def.height, z + 1], maxDist)
      if (hit) return { x, y, z, face: hit.face, distance: hit.distance }
    }
    if (tMax[0] < tMax[1] && tMax[0] < tMax[2]) {
      x += step[0]
      t = tMax[0]
      tMax[0] += tDelta[0]
    } else if (tMax[1] < tMax[2]) {
      y += step[1]
      t = tMax[1]
      tMax[1] += tDelta[1]
    } else {
      z += step[2]
      t = tMax[2]
      tMax[2] += tDelta[2]
    }
  }
  return null
}
