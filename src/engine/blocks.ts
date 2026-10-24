/**
 * The block registry. A game registers its blocks once at startup, in the same
 * order on the server and every client, so ids agree everywhere without a
 * handshake. Ids fit in seven bits: the world keeps the top bit of each cell
 * for "placed by a player".
 */

export interface BlockTexture {
  top: string
  side: string
  bottom?: string
  /** A pattern name the atlas painter knows (see render/textures.ts). */
  pattern: string
}

export interface BlockDef {
  id: number
  name: string
  solid: boolean
  /** Neighbours still draw their faces against this block. */
  transparent: boolean
  /** Drawn blended, so its texture's alpha tints what is behind it (stained glass). Implies transparent. */
  translucent?: boolean
  /** Collision and render height, 1 for a full block. */
  height: number
  /** Break-time scale. 0 breaks instantly; Infinity never breaks. */
  hardness: number
  /** The tool family that breaks it fastest. */
  tool?: string
  /** Without the right tool the block takes far longer to break. */
  requiresTool?: boolean
  /** Sunlight lost passing through (leaves); opaque blocks stop it entirely. */
  lightCost?: number
  /** How much explosion power it absorbs; Infinity is blast-proof. Default 1. */
  blastResistance?: number
  /** Light it gives off, 0 to 15 (lanterns, lamps). Spreads like sunlight, in a warm colour. */
  lightLevel?: number
  texture: BlockTexture
  /** Game-specific data (a team, a role); the engine never reads it. */
  meta: Record<string, string | number | boolean>
}

export type BlockInput = Omit<BlockDef, 'id' | 'solid' | 'transparent' | 'height' | 'meta'> & Partial<Pick<BlockDef, 'solid' | 'transparent' | 'height' | 'meta'>>

const defs: BlockDef[] = []

export function defineBlock(input: BlockInput): number {
  const id = defs.length
  if (id > 0x7f) throw new Error('At most 128 block types fit in a cell')
  defs.push({ solid: true, transparent: false, height: 1, meta: {}, ...input, id })
  return id
}

export const AIR = defineBlock({ name: 'Air', solid: false, transparent: true, hardness: 0, texture: { top: '#000', side: '#000', pattern: 'smooth' } })

export const BLOCKS: readonly BlockDef[] = defs

export function blockDef(id: number): BlockDef {
  return defs[id] ?? defs[AIR]
}

/** Full opaque cubes hide neighbouring faces, cast ambient occlusion and stop sunlight. */
export function isOpaqueCube(def: BlockDef): boolean {
  return def.solid && !def.transparent && def.height === 1
}
