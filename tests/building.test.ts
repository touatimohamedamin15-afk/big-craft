import { describe, expect, test } from 'bun:test'
import { AIR, BED, BEDROCK, CLAY, GLASS, OBSIDIAN, STONE, WOOL } from '../src/games/bedwars/blocks'
import { breakTicks, checkPlace, type BuildRules } from '../src/engine/building'
import { bedPartner, checkBreak, placeBed } from '../src/games/bedwars/beds'
import { EYE_HEIGHT, SNEAK_EYE_HEIGHT } from '../src/games/bedwars/constants'
import { ITEMS } from '../src/games/bedwars/items'
import { lookDirection, playerBox } from '../src/engine/physics'
import { raycastBlock } from '../src/engine/raycast'
import { World } from '../src/engine/world'
import { flatWorld, mover, run, settle } from './helpers'

const rules: BuildRules = { minY: 0, maxY: 20, protectedZones: [[0, 10, 0, 3, 20, 3]] }

describe('ray casting', () => {
  test('hits the floor below with the top face', () => {
    const w = flatWorld()
    const hit = raycastBlock(w, [16.5, 11.62, 16.5], [0, -1, 0], 5)
    expect(hit).toMatchObject({ x: 16, y: 9, z: 16, face: [0, 1, 0] })
    expect(hit!.distance).toBeCloseTo(1.62, 6)
  })

  test('respects reach', () => {
    const w = flatWorld()
    expect(raycastBlock(w, [16.5, 16, 16.5], [0, -1, 0], 4.5)).toBeNull()
  })

  test('finds the side face of a wall', () => {
    const w = flatWorld()
    w.set(20, 11, 16, STONE)
    const hit = raycastBlock(w, [16.5, 11.5, 16.5], [1, 0, 0], 10)
    expect(hit).toMatchObject({ x: 20, y: 11, z: 16, face: [-1, 0, 0] })
  })

  test('a bed is only a little over half a block tall', () => {
    const w = flatWorld()
    placeBed(w, 'red', 16, 10, 16, 1, 0)
    expect(raycastBlock(w, [16.5, 10.7, 14], [0, 0, 1], 5)).toBeNull()
    expect(raycastBlock(w, [16.5, 10.3, 14], [0, 0, 1], 5)).toMatchObject({ x: 16, y: 10, z: 16 })
  })
})

describe('break times', () => {
  test('tools speed up the blocks they are for', () => {
    expect(breakTicks(WOOL.red, ITEMS.shears)).toBeLessThan(breakTicks(WOOL.red, undefined))
    expect(breakTicks(CLAY, ITEMS.iron_pickaxe)).toBeLessThan(breakTicks(CLAY, ITEMS.wood_pickaxe))
    expect(breakTicks(CLAY, ITEMS.wood_sword)).toBe(breakTicks(CLAY, undefined))
  })

  test('obsidian is slow even with a diamond pickaxe and hopeless without', () => {
    expect(breakTicks(OBSIDIAN, ITEMS.diamond_pickaxe)).toBeGreaterThan(150)
    expect(breakTicks(OBSIDIAN, undefined)).toBeGreaterThan(4000)
  })

  test('glass and beds are quick; bedrock never breaks', () => {
    expect(breakTicks(GLASS, undefined)).toBeLessThan(10)
    expect(breakTicks(BED.blue, undefined)).toBeLessThan(10)
    expect(breakTicks(BEDROCK, ITEMS.diamond_pickaxe)).toBe(Infinity)
  })
})

describe('placing', () => {
  test('against a face, not floating, not inside a player', () => {
    const w = flatWorld()
    expect(checkPlace(w, rules, 16, 10, 16, [])).toBeNull()
    expect(checkPlace(w, rules, 16, 12, 16, [])).toBe('floating')
    expect(checkPlace(w, rules, 16, 9, 16, [])).toBe('occupied')
    expect(checkPlace(w, rules, 16, 10, 16, [playerBox(16.5, 10, 16.5, false)])).toBe('player')
    expect(checkPlace(w, rules, 16, 12, 16, [playerBox(16.5, 10, 16.5, false)])).toBe('floating')
  })

  test('not in protected zones, above the build limit or outside the world', () => {
    const w = flatWorld()
    expect(checkPlace(w, rules, 2, 10, 2, [])).toBe('protected')
    w.fill(10, 10, 10, 10, 20, 10, STONE)
    expect(checkPlace(w, rules, 10, 21, 10, [])).toBe('height')
    expect(checkPlace(w, rules, -1, 10, 10, [])).toBe('bounds')
  })

  test('a block placed under your feet while jumping (pillaring) is allowed once you clear it', () => {
    const w = flatWorld()
    const m = mover(16.5, 10, 16.5)
    settle(w, m)
    run(w, m, 1, { jump: true })
    run(w, m, 3)
    expect(m.y).toBeGreaterThan(11)
    expect(checkPlace(w, rules, 16, 10, 16, [playerBox(m.x, m.y, m.z, false)])).toBeNull()
  })

  test('bridging: sneak to the edge, look back and down, place against the side of your block', () => {
    const w = new World(32, 16, 8)
    w.fill(0, 0, 0, 9, 4, 7, STONE)
    const m = mover(8.5, 5, 3.5)
    m.yaw = Math.PI / 2 // face -x, backing toward +x
    settle(w, m)
    for (let i = 0; i < 6; i++) {
      run(w, m, 30, { forward: -1, sneak: true })
      expect(m.onGround).toBe(true)
      expect(m.y).toBeCloseTo(5, 6)
      // Your eye is past the edge: look forward and steeply down at the side of the
      // block you stand on (its +x face), so the new block goes beyond the edge.
      const eye = [m.x, m.y + SNEAK_EYE_HEIGHT, m.z]
      const hit = raycastBlock(w, eye, lookDirection(m.yaw, -1.39), 4.5)
      expect(hit).not.toBeNull()
      expect(hit!.face).toEqual([1, 0, 0])
      const [x, y, z] = [hit!.x + hit!.face[0], hit!.y + hit!.face[1], hit!.z + hit!.face[2]]
      expect(checkPlace(w, rules, x, y, z, [playerBox(m.x, m.y, m.z, true)])).toBeNull()
      w.set(x, y, z, WOOL.red, true)
    }
    expect(m.x).toBeGreaterThan(14)
    expect(EYE_HEIGHT).toBeGreaterThan(SNEAK_EYE_HEIGHT)
  })
})

describe('breaking', () => {
  test('only blocks placed this round', () => {
    const w = flatWorld()
    w.set(5, 10, 5, CLAY, true)
    expect(checkBreak(w, rules, 5, 10, 5, 'red')).toBeNull()
    expect(checkBreak(w, rules, 5, 9, 5, 'red')).toBe('map')
    expect(checkBreak(w, { ...rules, allowMapBreaking: true }, 5, 9, 5, 'red')).toBeNull()
    expect(checkBreak(w, rules, 5, 15, 5, 'red')).toBe('air')
  })

  test('beds break for other teams only, and both halves go together', () => {
    const w = flatWorld()
    placeBed(w, 'red', 16, 10, 16, 0, 1)
    expect(checkBreak(w, rules, 16, 10, 16, 'red')).toBe('own-bed')
    expect(checkBreak(w, rules, 16, 10, 17, 'blue')).toBeNull()
    expect(bedPartner(w, 16, 10, 17)).toEqual([16, 10, 16])
    expect(w.get(16, 10, 18)).toBe(AIR)
  })
})
