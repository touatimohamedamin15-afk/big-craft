import { checkBreakable, type BuildRules } from '../../engine/building'
import type { World } from '../../engine/world'
import { BED, blockDef, blockTeam, isBed, type TeamId } from './blocks'

export type BreakRefusal = 'air' | 'map' | 'own-bed' | 'unbreakable'

/** The engine's rule (placed blocks only), plus beds: anyone's but your own team's. */
export function checkBreak(world: World, rules: BuildRules, x: number, y: number, z: number, team: TeamId | null): BreakRefusal | null {
  const id = world.get(x, y, z)
  if (isBed(id)) return team !== null && blockTeam(id) === team ? 'own-bed' : blockDef(id).hardness === Infinity ? 'unbreakable' : null
  return checkBreakable(world, rules, x, y, z)
}

/** The other half of a two-block bed, if present. */
export function bedPartner(world: World, x: number, y: number, z: number): [number, number, number] | null {
  const id = world.get(x, y, z)
  if (!isBed(id)) return null
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (world.get(x + dx, y, z + dz) === id) return [x + dx, y, z + dz]
  return null
}

export function placeBed(world: World, team: TeamId, x: number, y: number, z: number, dx: number, dz: number): void {
  world.set(x, y, z, BED[team])
  world.set(x + dx, y, z + dz, BED[team])
}
