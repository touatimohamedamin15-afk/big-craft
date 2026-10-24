import { AIR, blockDef } from './blocks'
import type { World } from './world'

/**
 * Which blocks an explosion of `power` at (x, y, z) breaks: a block goes when
 * the power left after distance exceeds its blast resistance. `mayBreak` lets
 * the game protect blocks (map blocks, beds). Returns the cells to clear; the
 * caller clears them, so the world's change events and rules run as usual.
 */
export function explosionCells(world: World, x: number, y: number, z: number, power: number, mayBreak: (bx: number, by: number, bz: number) => boolean): [number, number, number][] {
  const out: [number, number, number][] = []
  const r = Math.ceil(power)
  for (let by = Math.floor(y) - r; by <= Math.floor(y) + r; by++)
    for (let bz = Math.floor(z) - r; bz <= Math.floor(z) + r; bz++)
      for (let bx = Math.floor(x) - r; bx <= Math.floor(x) + r; bx++) {
        const id = world.get(bx, by, bz)
        if (id === AIR) continue
        const d = Math.hypot(bx + 0.5 - x, by + 0.5 - y, bz + 0.5 - z)
        if (power - d <= (blockDef(id).blastResistance ?? 1)) continue
        if (mayBreak(bx, by, bz)) out.push([bx, by, bz])
      }
  return out
}

/** How hard an explosion pushes and hurts something at `distance`, 0..1. */
export function explosionImpact(distance: number, power: number): number {
  return Math.max(0, 1 - distance / (power * 2))
}
