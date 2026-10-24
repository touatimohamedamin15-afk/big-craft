import type { ItemDef } from '../../engine/items'
import { ARMOR_POINTS, type ArmorTier } from './items'

export { knockback, reachDistance, shieldBlocks, swingReaches } from '../../engine/melee'

export const FIST_DAMAGE = 1
export const CRIT_MULTIPLIER = 1.5
/** Armour points to fraction of damage removed; full diamond removes 80%. */
export const ARMOR_FACTOR = 1 / 25
export const PROTECTION_PER_LEVEL = 0.04

export function weaponDamage(held: ItemDef | undefined, sharpness: number): number {
  const base = held?.damage ?? FIST_DAMAGE
  return held?.kind === 'sword' ? base + sharpness : base
}

export function armorReduction(armor: ArmorTier, protection: number): number {
  return Math.min(0.85, ARMOR_POINTS[armor] * ARMOR_FACTOR + protection * PROTECTION_PER_LEVEL)
}

export interface HitInput {
  held: ItemDef | undefined
  sharpness: number
  /** Attacker is falling and not on the ground. */
  crit: boolean
  armor: ArmorTier
  protection: number
}

export function hitDamage(h: HitInput): number {
  let dmg = weaponDamage(h.held, h.sharpness)
  if (h.crit) dmg *= CRIT_MULTIPLIER
  return dmg * (1 - armorReduction(h.armor, h.protection))
}

export function canBeHurt(victim: { hurtTicks: number; protectedTicks: number }): boolean {
  return victim.hurtTicks <= 0 && victim.protectedTicks <= 0
}
