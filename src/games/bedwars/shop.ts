import type { ArmorTier, Resource } from './items'

export type OfferCategory = 'blocks' | 'melee' | 'armor' | 'tools' | 'ranged' | 'utility' | 'potions'

export type OfferGive =
  | { kind: 'item'; item: string; count: number }
  | { kind: 'sword'; item: string }
  | { kind: 'armor'; tier: ArmorTier }
  | { kind: 'pickaxe' }
  | { kind: 'axe' }
  | { kind: 'shears' }

export interface Offer {
  id: string
  name: string
  category: OfferCategory
  icon: string
  /** Cost for the next purchase; tools cost more per tier. */
  cost: { resource: Resource; amount: number }[]
  give: OfferGive
}

const iron = (amount: number) => [{ resource: 'iron' as const, amount }]
const gold = (amount: number) => [{ resource: 'gold' as const, amount }]
const emerald = (amount: number) => [{ resource: 'emerald' as const, amount }]

export const OFFERS: Offer[] = [
  { id: 'wool', name: 'Wool ×16', category: 'blocks', icon: 'wool', cost: iron(4), give: { kind: 'item', item: 'wool', count: 16 } },
  { id: 'clay', name: 'Hardened clay ×16', category: 'blocks', icon: 'clay', cost: iron(12), give: { kind: 'item', item: 'clay', count: 16 } },
  { id: 'glass', name: 'Glass ×4', category: 'blocks', icon: 'glass', cost: iron(12), give: { kind: 'item', item: 'glass', count: 4 } },
  { id: 'planks', name: 'Planks ×16', category: 'blocks', icon: 'planks', cost: gold(4), give: { kind: 'item', item: 'planks', count: 16 } },
  { id: 'moonstone', name: 'Moonstone ×12', category: 'blocks', icon: 'moonstone', cost: iron(24), give: { kind: 'item', item: 'moonstone', count: 12 } },
  { id: 'obsidian', name: 'Obsidian ×4', category: 'blocks', icon: 'obsidian', cost: emerald(4), give: { kind: 'item', item: 'obsidian', count: 4 } },

  { id: 'stone_sword', name: 'Stone sword', category: 'melee', icon: 'stone_sword', cost: iron(10), give: { kind: 'sword', item: 'stone_sword' } },
  { id: 'iron_sword', name: 'Iron sword', category: 'melee', icon: 'iron_sword', cost: gold(7), give: { kind: 'sword', item: 'iron_sword' } },
  { id: 'diamond_sword', name: 'Diamond sword', category: 'melee', icon: 'diamond_sword', cost: emerald(4), give: { kind: 'sword', item: 'diamond_sword' } },

  { id: 'chain_armor', name: 'Chain armour', category: 'armor', icon: 'chain_armor', cost: iron(24), give: { kind: 'armor', tier: 'chain' } },
  { id: 'iron_armor', name: 'Iron armour', category: 'armor', icon: 'iron_armor', cost: gold(12), give: { kind: 'armor', tier: 'iron' } },
  { id: 'diamond_armor', name: 'Diamond armour', category: 'armor', icon: 'diamond_armor', cost: emerald(6), give: { kind: 'armor', tier: 'diamond' } },

  { id: 'shears', name: 'Shears', category: 'tools', icon: 'shears', cost: iron(20), give: { kind: 'shears' } },
  { id: 'pickaxe', name: 'Pickaxe', category: 'tools', icon: 'wood_pickaxe', cost: iron(10), give: { kind: 'pickaxe' } },
  { id: 'axe', name: 'Axe', category: 'tools', icon: 'wood_axe', cost: iron(10), give: { kind: 'axe' } },

  { id: 'golden_apple', name: 'Golden apple', category: 'utility', icon: 'golden_apple', cost: gold(3), give: { kind: 'item', item: 'golden_apple', count: 1 } },
  { id: 'shield', name: 'Shield', category: 'utility', icon: 'shield', cost: gold(5), give: { kind: 'item', item: 'shield', count: 1 } },
  { id: 'pearl', name: 'Rift pearl', category: 'utility', icon: 'pearl', cost: emerald(4), give: { kind: 'item', item: 'pearl', count: 1 } },
  { id: 'bridge_egg', name: 'Bridge egg', category: 'utility', icon: 'bridge_egg', cost: emerald(1), give: { kind: 'item', item: 'bridge_egg', count: 1 } },

  { id: 'bow', name: 'Bow', category: 'ranged', icon: 'bow', cost: gold(12), give: { kind: 'item', item: 'bow', count: 1 } },
  { id: 'arrows', name: 'Arrows ×8', category: 'ranged', icon: 'arrow', cost: gold(2), give: { kind: 'item', item: 'arrow', count: 8 } },
  { id: 'fireball', name: 'Fireball', category: 'ranged', icon: 'fireball', cost: iron(40), give: { kind: 'item', item: 'fireball', count: 1 } },
  { id: 'tnt', name: 'TNT', category: 'ranged', icon: 'tnt', cost: gold(4), give: { kind: 'item', item: 'tnt', count: 1 } },

  { id: 'speed_potion', name: 'Speed (30 s)', category: 'potions', icon: 'speed_potion', cost: emerald(1), give: { kind: 'item', item: 'speed_potion', count: 1 } },
  { id: 'jump_potion', name: 'Jump (30 s)', category: 'potions', icon: 'jump_potion', cost: emerald(1), give: { kind: 'item', item: 'jump_potion', count: 1 } },
  { id: 'invisibility_potion', name: 'Invisibility (30 s)', category: 'potions', icon: 'invisibility_potion', cost: emerald(2), give: { kind: 'item', item: 'invisibility_potion', count: 1 } },
]

/** Price of the next pickaxe or axe tier: [wood, second, third, diamond]. */
export const TOOL_TIER_COST: { resource: Resource; amount: number }[][] = [iron(10), iron(10), gold(3), gold(6)]

export type UpgradeId = 'sharpness' | 'protection' | 'forge' | 'healPool'

export interface UpgradeDef {
  id: UpgradeId
  name: string
  description: string
  /** Diamond cost per level; the length is the maximum level. */
  levels: number[]
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'sharpness', name: 'Sharpened swords', description: 'Every sword on your team deals one more damage.', levels: [4] },
  { id: 'protection', name: 'Reinforced armour', description: 'Each level removes 4% more damage for your team.', levels: [2, 4, 8, 16] },
  { id: 'forge', name: 'Forge', description: 'Faster iron and gold; emeralds from level 3.', levels: [2, 4, 6, 8] },
  { id: 'healPool', name: 'Heal pool', description: 'Faster regeneration while at your base.', levels: [1] },
]

export type TeamUpgrades = Record<UpgradeId, number>
export const NO_UPGRADES: TeamUpgrades = { sharpness: 0, protection: 0, forge: 0, healPool: 0 }
