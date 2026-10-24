/** The item registry: anything that can sit in an inventory slot. Games register their items at startup. */

export interface ItemDef {
  id: string
  name: string
  /** A game-defined category ('block', 'sword', 'tool', ...); the engine reads only 'block' and 'tool'. */
  kind: string
  maxStack: number
  /** The block a block item places. */
  block?: number
  damage?: number
  /** The tool family, matched against BlockDef.tool for break speed. */
  tool?: string
  /** Break-speed multiplier on blocks this tool is for. */
  speed?: number
  /** Rank within a family (0 = lowest). */
  tier?: number
  /** Icon and in-hand colour. */
  color: string
  /** Game-specific data; the engine never reads it. */
  meta?: Record<string, string | number | boolean>
}

const items: Record<string, ItemDef> = {}

export function defineItems(list: ItemDef[]): void {
  for (const i of list) items[i.id] = i
}

export const ITEMS: Readonly<Record<string, ItemDef>> = items

export function item(id: string | undefined): ItemDef | undefined {
  return id ? items[id] : undefined
}
