import { defineItems, item, ITEMS, type ItemDef } from '../../engine/items'
import { CLAY, GLASS, MOONSTONE, OBSIDIAN, PLANKS, TNT, WHITE_WOOL, WOOL, type TeamId } from './blocks'
import { TPS } from './constants'

export { item, ITEMS, type ItemDef }

/** Item kinds in this game: 'block' | 'sword' | 'tool' | 'shield' | 'food' | 'resource' | 'bow' | 'ammo' | 'throwable' | 'tnt' | 'potion'. */
const list: ItemDef[] = [
  // Wool places in the holder's team colour (see placedBlock).
  { id: 'wool', name: 'Wool', kind: 'block', maxStack: 64, block: WHITE_WOOL, meta: { teamWool: true }, color: '#eeeeee' },
  { id: 'clay', name: 'Hardened clay', kind: 'block', maxStack: 64, block: CLAY, color: '#b0735a' },
  { id: 'glass', name: 'Glass', kind: 'block', maxStack: 64, block: GLASS, color: '#cfeaf2' },
  { id: 'planks', name: 'Planks', kind: 'block', maxStack: 64, block: PLANKS, color: '#b48a52' },
  { id: 'moonstone', name: 'Moonstone', kind: 'block', maxStack: 64, block: MOONSTONE, color: '#e2dfb0' },
  { id: 'obsidian', name: 'Obsidian', kind: 'block', maxStack: 64, block: OBSIDIAN, color: '#3a2a52' },

  { id: 'wood_sword', name: 'Wooden sword', kind: 'sword', maxStack: 1, damage: 4, tier: 0, color: '#b48a52' },
  { id: 'stone_sword', name: 'Stone sword', kind: 'sword', maxStack: 1, damage: 5, tier: 1, color: '#8c8c8c' },
  { id: 'iron_sword', name: 'Iron sword', kind: 'sword', maxStack: 1, damage: 6, tier: 2, color: '#e8e8e8' },
  { id: 'diamond_sword', name: 'Diamond sword', kind: 'sword', maxStack: 1, damage: 7, tier: 3, color: '#5fe0d8' },

  { id: 'wood_pickaxe', name: 'Wooden pickaxe', kind: 'tool', tool: 'pickaxe', maxStack: 1, damage: 2, speed: 2, tier: 0, color: '#b48a52' },
  { id: 'iron_pickaxe', name: 'Iron pickaxe', kind: 'tool', tool: 'pickaxe', maxStack: 1, damage: 3, speed: 6, tier: 1, color: '#e8e8e8' },
  { id: 'gold_pickaxe', name: 'Gold pickaxe', kind: 'tool', tool: 'pickaxe', maxStack: 1, damage: 2, speed: 12, tier: 2, color: '#f2cf4a' },
  { id: 'diamond_pickaxe', name: 'Diamond pickaxe', kind: 'tool', tool: 'pickaxe', maxStack: 1, damage: 4, speed: 8, tier: 3, color: '#5fe0d8' },
  { id: 'wood_axe', name: 'Wooden axe', kind: 'tool', tool: 'axe', maxStack: 1, damage: 3, speed: 2, tier: 0, color: '#b48a52' },
  { id: 'stone_axe', name: 'Stone axe', kind: 'tool', tool: 'axe', maxStack: 1, damage: 4, speed: 4, tier: 1, color: '#8c8c8c' },
  { id: 'iron_axe', name: 'Iron axe', kind: 'tool', tool: 'axe', maxStack: 1, damage: 5, speed: 6, tier: 2, color: '#e8e8e8' },
  { id: 'diamond_axe', name: 'Diamond axe', kind: 'tool', tool: 'axe', maxStack: 1, damage: 6, speed: 8, tier: 3, color: '#5fe0d8' },
  { id: 'shears', name: 'Shears', kind: 'tool', tool: 'shears', maxStack: 1, damage: 1, speed: 5, tier: 0, color: '#d8d8d8' },

  { id: 'shield', name: 'Shield', kind: 'shield', maxStack: 1, color: '#8a6a45' },
  { id: 'golden_apple', name: 'Golden apple', kind: 'food', maxStack: 64, color: '#f2cf4a' },

  { id: 'bow', name: 'Bow', kind: 'bow', maxStack: 1, damage: 1, color: '#8a5a2b' },
  { id: 'arrow', name: 'Arrow', kind: 'ammo', maxStack: 64, color: '#d8d8d8' },
  { id: 'fireball', name: 'Fireball', kind: 'throwable', maxStack: 16, meta: { projectile: 'fireball' }, color: '#f07a1a' },
  { id: 'pearl', name: 'Rift pearl', kind: 'throwable', maxStack: 16, meta: { projectile: 'pearl' }, color: '#1f8f86' },
  { id: 'bridge_egg', name: 'Bridge egg', kind: 'throwable', maxStack: 16, meta: { projectile: 'egg' }, color: '#f2efe4' },
  { id: 'tnt', name: 'TNT', kind: 'tnt', maxStack: 16, block: TNT, color: '#d23a2e' },
  { id: 'speed_potion', name: 'Speed potion', kind: 'potion', maxStack: 4, meta: { effect: 'speed', seconds: 30 }, color: '#5fc9f2' },
  { id: 'jump_potion', name: 'Jump potion', kind: 'potion', maxStack: 4, meta: { effect: 'jump', seconds: 30 }, color: '#7be08a' },
  { id: 'invisibility_potion', name: 'Invisibility potion', kind: 'potion', maxStack: 4, meta: { effect: 'invisible', seconds: 30 }, color: '#b8b8c8' },

  { id: 'iron', name: 'Iron', kind: 'resource', maxStack: 64, color: '#e8e8e8' },
  { id: 'gold', name: 'Gold', kind: 'resource', maxStack: 64, color: '#f2cf4a' },
  { id: 'diamond', name: 'Diamond', kind: 'resource', maxStack: 64, color: '#5fe0d8' },
  { id: 'emerald', name: 'Emerald', kind: 'resource', maxStack: 64, color: '#38d36b' },
]

defineItems(list)
export const RESOURCES = ['iron', 'gold', 'diamond', 'emerald'] as const
export type Resource = (typeof RESOURCES)[number]

export const PICKAXES = ['wood_pickaxe', 'iron_pickaxe', 'gold_pickaxe', 'diamond_pickaxe']
export const AXES = ['wood_axe', 'stone_axe', 'iron_axe', 'diamond_axe']

export function placedBlock(def: ItemDef, team: TeamId): number | undefined {
  if (def.meta?.teamWool) return WOOL[team]
  return def.block
}

/** Armour sets are permanent per life and are not inventory items. */
export type ArmorTier = 'leather' | 'chain' | 'iron' | 'diamond'
export const ARMOR_POINTS: Record<ArmorTier, number> = { leather: 7, chain: 12, iron: 15, diamond: 20 }
export const ARMOR_ORDER: ArmorTier[] = ['leather', 'chain', 'iron', 'diamond']
export const ARMOR_COLORS: Record<ArmorTier, string> = { leather: '', chain: '#9a9a9a', iron: '#d8d8d8', diamond: '#5fe0d8' }

export type Effect = 'speed' | 'jump' | 'invisible'
export const EFFECTS: Effect[] = ['speed', 'jump', 'invisible']
/** Speed potion: walking and air control multiplied. Jump potion: extra jump velocity (about one more block). */
export const SPEED_BOOST = 1.35
export const JUMP_BOOST = 0.12
export const EFFECT_TICKS = (seconds: number) => seconds * TPS
