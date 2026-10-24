import { describe, expect, test } from 'bun:test'
import { AIR, CLAY, WOOL } from '../src/games/bedwars/blocks'
import { addItem, canFit, countItem, emptyInventory, removeItem, replaceItem } from '../src/engine/inventory'
import { ITEMS, placedBlock } from '../src/games/bedwars/items'
import { createArena } from '../src/games/bedwars/maps/arena'
import { fromBase64, toBase64, World } from '../src/engine/world'

describe('inventory', () => {
  test('stacks to 64, fills the hotbar first, reports what did not fit', () => {
    const inv = emptyInventory()
    expect(addItem(inv, 'wool', 100)).toBe(0)
    expect(inv[0]).toEqual({ id: 'wool', count: 64 })
    expect(inv[1]).toEqual({ id: 'wool', count: 36 })
    expect(addItem(inv, 'wood_sword', 2)).toBe(0)
    expect(inv[2]?.count).toBe(1) // swords do not stack
    for (let i = 0; i < 40; i++) addItem(inv, 'diamond_sword', 1)
    expect(canFit(inv, 'shield', 1)).toBe(false)
    expect(addItem(inv, 'wool', 30)).toBe(2) // only the second stack had room
  })

  test('removing takes all or nothing', () => {
    const inv = emptyInventory()
    addItem(inv, 'iron', 10)
    expect(removeItem(inv, 'iron', 11)).toBe(false)
    expect(countItem(inv, 'iron')).toBe(10)
    expect(removeItem(inv, 'iron', 10)).toBe(true)
    expect(inv[0]).toBeNull()
  })

  test('replacing a tool keeps its slot', () => {
    const inv = emptyInventory()
    addItem(inv, 'wool', 1)
    addItem(inv, 'wood_pickaxe', 1)
    replaceItem(inv, (id) => id.endsWith('_pickaxe'), 'iron_pickaxe')
    expect(inv[1]?.id).toBe('iron_pickaxe')
  })

  test('wool places your team colour', () => {
    expect(placedBlock(ITEMS.wool, 'blue')).toBe(WOOL.blue)
    expect(placedBlock(ITEMS.clay, 'blue')).toBe(CLAY)
  })
})

describe('world snapshot', () => {
  test('round-trips blocks and the placed flag, and the arena packs small', () => {
    const w = new World(8, 8, 8)
    w.set(1, 2, 3, CLAY, true)
    w.set(4, 4, 4, WOOL.red)
    const back = World.decode(fromBase64(toBase64(w.encode())))
    expect(back.get(1, 2, 3)).toBe(CLAY)
    expect(back.isPlaced(1, 2, 3)).toBe(true)
    expect(back.isPlaced(4, 4, 4)).toBe(false)
    expect(back.get(0, 0, 0)).toBe(AIR)
    const arena = createArena().world.encode()
    expect(arena.length).toBeLessThan(200_000)
  })

  test('outside the grid is air', () => {
    const w = new World(4, 4, 4)
    expect(w.get(-1, 0, 0)).toBe(AIR)
    expect(w.set(10, 0, 0, CLAY)).toBe(false)
  })
})
