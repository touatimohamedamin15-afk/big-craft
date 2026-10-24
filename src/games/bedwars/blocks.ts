import { AIR, BLOCKS, blockDef, defineBlock as block, type BlockInput } from '../../engine/blocks'

export { AIR, BLOCKS, blockDef }

export type Tool = 'pickaxe' | 'axe' | 'shears'
export type TeamId = 'red' | 'blue' | 'green' | 'yellow'
export const TEAMS: TeamId[] = ['red', 'blue', 'green', 'yellow']
export const TEAM_COLORS: Record<TeamId, string> = { red: '#e0473e', blue: '#3e6fe0', green: '#45b04a', yellow: '#e6c43a' }
export const TEAM_NAMES: Record<TeamId, string> = { red: 'Red', blue: 'Blue', green: 'Green', yellow: 'Yellow' }

export const GRASS = block({ name: 'Grass', hardness: 0.6, tool: 'axe', texture: { top: '#6aa84f', side: '#8a6a45', bottom: '#7a5a3a', pattern: 'grass' } })
export const DIRT = block({ name: 'Dirt', hardness: 0.5, texture: { top: '#7a5a3a', side: '#7a5a3a', pattern: 'noise' } })
export const STONE = block({ name: 'Stone', hardness: 1.5, tool: 'pickaxe', requiresTool: true, texture: { top: '#8c8c8c', side: '#8c8c8c', pattern: 'noise' } })
export const BEDROCK = block({ name: 'Bedrock', hardness: Infinity, texture: { top: '#3a3a3a', side: '#3a3a3a', pattern: 'bedrock' } })
export const PLANKS = block({ name: 'Planks', hardness: 2, tool: 'axe', blastResistance: 1.5, texture: { top: '#b48a52', side: '#b48a52', pattern: 'planks' } })
export const GLASS = block({ name: 'Glass', transparent: true, translucent: true, hardness: 0.3, blastResistance: Infinity, texture: { top: '#cfeaf2', side: '#cfeaf2', pattern: 'glass' } })
export const CLAY = block({ name: 'Hardened clay', hardness: 1.25, tool: 'pickaxe', requiresTool: true, blastResistance: 2.5, texture: { top: '#b0735a', side: '#b0735a', pattern: 'smooth' } })
export const MOONSTONE = block({ name: 'Moonstone', hardness: 3, tool: 'pickaxe', requiresTool: true, blastResistance: 3.5, texture: { top: '#e2dfb0', side: '#e2dfb0', pattern: 'speckle' } })
export const OBSIDIAN = block({ name: 'Obsidian', hardness: 50, tool: 'pickaxe', requiresTool: true, blastResistance: Infinity, texture: { top: '#241a33', side: '#241a33', pattern: 'speckle' } })
export const LOG = block({ name: 'Log', hardness: 2, tool: 'axe', texture: { top: '#a07b4c', side: '#6b4f2e', pattern: 'log' } })
export const LEAVES = block({ name: 'Leaves', transparent: true, hardness: 0.2, tool: 'shears', lightCost: 2, texture: { top: '#3f7f34', side: '#3f7f34', pattern: 'leaves' } })
export const BRICK = block({ name: 'Brick', hardness: 2, tool: 'pickaxe', requiresTool: true, texture: { top: '#9a4a3a', side: '#9a4a3a', pattern: 'brick' } })
export const WHITE_WOOL = block({ name: 'White wool', hardness: 0.8, tool: 'shears', blastResistance: 0.5, texture: { top: '#eeeeee', side: '#eeeeee', pattern: 'wool' } })

/** Never placed: lit TNT is an entity. The block gives it an icon and a model. */
export const TNT = block({ name: 'TNT', hardness: 0, texture: { top: '#d23a2e', side: '#d23a2e', bottom: '#b0302a', pattern: 'banded' } })

const shade = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`
}

export const WOOL: Record<TeamId, number> = {} as Record<TeamId, number>
export const BED: Record<TeamId, number> = {} as Record<TeamId, number>
for (const team of TEAMS) {
  const color = TEAM_COLORS[team]
  WOOL[team] = block({ name: `${team} wool`, hardness: 0.8, tool: 'shears', blastResistance: 0.5, meta: { team }, texture: { top: color, side: color, pattern: 'wool' } })
}
for (const team of TEAMS) {
  const color = TEAM_COLORS[team]
  BED[team] = block({ name: `${team} bed`, hardness: 0.2, height: 0.5625, blastResistance: Infinity, meta: { team, bed: true }, texture: { top: shade(color, 1.1), side: shade(color, 0.7), bottom: '#b48a52', pattern: 'bed' } })
}

/*
 * Map blocks for the themed arenas. Players never get these (the shop sells
 * only the buildable blocks above) and cannot break them, so hardness and
 * blast resistance only matter if a sandbox or another game hands them out.
 * Appended after the beds so earlier ids never move.
 */
const map = (name: string, top: string, side: string, pattern: string, extra: Partial<Omit<BlockInput, 'name' | 'texture'>> & { bottom?: string } = {}) => {
  const { bottom, ...rest } = extra
  return block({ name, hardness: 1.5, tool: 'pickaxe', blastResistance: 3, ...rest, texture: { top, side, bottom, pattern } })
}
const wood = { hardness: 2, tool: 'axe', blastResistance: 1.5 } as const
const soft = { hardness: 0.5, tool: undefined, blastResistance: 0.5 } as const
const plant = { solid: false, transparent: true, hardness: 0, tool: undefined, blastResistance: 0 } as const

export const SAND = map('Sand', '#dccb92', '#dccb92', 'sand', soft)
export const SANDSTONE = map('Sandstone', '#e3d3a0', '#d8c58c', 'sandstone', { bottom: '#cdb97f', blastResistance: 2 })
export const CUT_SANDSTONE = map('Carved sandstone', '#e3d3a0', '#d6c189', 'carved', { blastResistance: 2 })
export const SNOW = map('Snow', '#f4f8fb', '#f4f8fb', 'snow', { ...soft, hardness: 0.2, blastResistance: 0.2 })
export const SNOWY_GRASS = map('Snowy dirt', '#f1f6fa', '#7a5a3a', 'grass', { ...soft, bottom: '#7a5a3a' })
export const ICE = map('Ice', '#a9d3f2', '#a9d3f2', 'ice', { hardness: 0.5, blastResistance: 0.5 })
export const PACKED_ICE = map('Packed ice', '#7fb0dd', '#7fb0dd', 'ice', { hardness: 0.5, blastResistance: 0.5 })
export const COBBLESTONE = map('Cobblestone', '#7d7d7d', '#7d7d7d', 'cobble', { hardness: 2 })
export const MOSSY_COBBLESTONE = map('Mossy cobblestone', '#7b8070', '#7b8070', 'mossy-cobble', { hardness: 2 })
export const STONE_BRICKS = map('Stone bricks', '#8a8a86', '#8a8a86', 'stonebrick')
export const MOSSY_STONE_BRICKS = map('Mossy stone bricks', '#868a7c', '#868a7c', 'mossy-stonebrick')
export const CRACKED_STONE_BRICKS = map('Cracked stone bricks', '#85857f', '#85857f', 'cracked-stonebrick')
export const DARK_PLANKS = map('Dark planks', '#5c4128', '#5c4128', 'planks', wood)
export const SPRUCE_LOG = map('Spruce log', '#7a5c3a', '#4a3520', 'log', wood)
export const BIRCH_LOG = map('Birch log', '#c9b98e', '#e4e0d6', 'birch', wood)
export const SPRUCE_LEAVES = map('Spruce leaves', '#2f5a3a', '#2f5a3a', 'leaves', { transparent: true, hardness: 0.2, tool: 'shears', lightCost: 2, blastResistance: 0.2 })
export const SNOWY_LEAVES = map('Snowy spruce leaves', '#f2f6f8', '#2f5a3a', 'snowy-leaves', { transparent: true, hardness: 0.2, tool: 'shears', lightCost: 2, blastResistance: 0.2, bottom: '#2f5a3a' })
export const BIRCH_LEAVES = map('Birch leaves', '#78a84a', '#78a84a', 'leaves', { transparent: true, hardness: 0.2, tool: 'shears', lightCost: 2, blastResistance: 0.2 })
export const QUARTZ = map('Quartz', '#ece7df', '#ece7df', 'quartz', { blastResistance: 2 })
export const QUARTZ_PILLAR = map('Quartz pillar', '#ece7df', '#e6e0d6', 'pillar', { blastResistance: 2 })
export const TERRACOTTA = {
  orange: map('Orange terracotta', '#b8653a', '#b8653a', 'terracotta', { blastResistance: 2 }),
  red: map('Red terracotta', '#8f3b2e', '#8f3b2e', 'terracotta', { blastResistance: 2 }),
  yellow: map('Yellow terracotta', '#c99a3e', '#c99a3e', 'terracotta', { blastResistance: 2 }),
  cyan: map('Cyan terracotta', '#4f7f82', '#4f7f82', 'terracotta', { blastResistance: 2 }),
  white: map('White terracotta', '#d9c7b4', '#d9c7b4', 'terracotta', { blastResistance: 2 }),
}
export const ROOF_TILES = map('Roof tiles', '#8e3f2f', '#8e3f2f', 'tiles', { blastResistance: 2 })
/** Lamps give off light (`lightLevel`); the renderer spreads it like sunlight in a warm colour. */
export const LANTERN = map('Lantern', '#ffcf6e', '#ffcf6e', 'lamp', { hardness: 0.3, blastResistance: 0.5, lightLevel: 15 })
export const FROST_LAMP = map('Frost lamp', '#cfefff', '#cfefff', 'lamp', { hardness: 0.3, blastResistance: 0.5, lightLevel: 15 })
export const HAY = map('Hay bale', '#d8b545', '#cfa83c', 'hay', { ...soft, tool: 'axe' })
export const WATER = map('Still water', '#3f76c4', '#3f76c4', 'water', { hardness: Infinity, blastResistance: Infinity })
export const GRAVEL = map('Gravel', '#8b8580', '#8b8580', 'gravel', { ...soft, hardness: 0.6 })
export const CACTUS = map('Cactus', '#6f9a3c', '#4f8a34', 'cactus', { ...soft, hardness: 0.4 })
export const GOLD_BLOCK = map('Gold block', '#f2c84b', '#f2c84b', 'metal', { hardness: 3, blastResistance: 6 })
/** Ankle-high plants you walk through: drawn as a cut-out short block, never collided with. */
export const FLOWERS = {
  red: map('Poppies', '#d8433a', '#d8433a', 'flowers', { ...plant, height: 0.375 }),
  yellow: map('Dandelions', '#f0cf3a', '#f0cf3a', 'flowers', { ...plant, height: 0.375 }),
  blue: map('Cornflowers', '#5a7fe0', '#5a7fe0', 'flowers', { ...plant, height: 0.375 }),
}
export const GRASS_TUFT = map('Tall grass', '#5f9a44', '#5f9a44', 'tuft', { ...plant, height: 0.5 })
/**
 * Thin posts and chains: drawn as a narrow cut-out, and like plants never
 * collided with, so tents, awnings and lamp posts never wall anyone in
 * (bots cannot dig map blocks and would be stuck behind a solid post).
 */
export const POLE = map('Wooden pole', '#6b4a2c', '#6b4a2c', 'pole', { ...plant, hardness: 2, tool: 'axe' })
export const CHAIN = map('Chain', '#4a4d55', '#4a4d55', 'chain', { ...plant, hardness: 2 })

/** Team-stained glass for base windows. */
export const STAINED_GLASS: Record<TeamId, number> = {} as Record<TeamId, number>
for (const team of TEAMS) {
  const color = TEAM_COLORS[team]
  STAINED_GLASS[team] = block({ name: `${team} stained glass`, transparent: true, translucent: true, hardness: 0.3, blastResistance: Infinity, meta: { team }, texture: { top: color, side: color, pattern: 'stained' } })
}

export function isBed(id: number): boolean {
  return blockDef(id).meta.bed === true
}

/** The team a bed or wool block belongs to, if any. */
export function blockTeam(id: number): TeamId | undefined {
  return blockDef(id).meta.team as TeamId | undefined
}
