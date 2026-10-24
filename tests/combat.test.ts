import { describe, expect, test } from 'bun:test'
import { STONE } from '../src/games/bedwars/blocks'
import { armorReduction, hitDamage, knockback, reachDistance, shieldBlocks, swingReaches, weaponDamage } from '../src/games/bedwars/combat'
import { ITEMS } from '../src/games/bedwars/items'
import { playerBox, stepMovement, IDLE_INPUT } from '../src/engine/physics'
import { flatWorld, mover, settle } from './helpers'

describe('damage', () => {
  test('swords out-damage fists and tiers go up', () => {
    const tiers = ['wood_sword', 'stone_sword', 'iron_sword', 'diamond_sword'].map((id) => weaponDamage(ITEMS[id], 0))
    expect(weaponDamage(undefined, 0)).toBe(1)
    expect(tiers).toEqual([4, 5, 6, 7])
    expect(weaponDamage(ITEMS.iron_sword, 1)).toBe(7)
    expect(weaponDamage(ITEMS.iron_pickaxe, 1)).toBe(3) // sharpness is for swords
  })

  test('crits multiply, armour reduces', () => {
    const base = { held: ITEMS.iron_sword, sharpness: 0, crit: false, armor: 'leather' as const, protection: 0 }
    const plain = hitDamage(base)
    expect(hitDamage({ ...base, crit: true })).toBeCloseTo(plain * 1.5, 6)
    expect(hitDamage({ ...base, armor: 'diamond' })).toBeLessThan(hitDamage({ ...base, armor: 'iron' }))
    expect(armorReduction('diamond', 0)).toBeCloseTo(0.8, 6)
    expect(armorReduction('diamond', 4)).toBeLessThanOrEqual(0.85)
  })
})

describe('knockback', () => {
  test('pushes the victim away and up, more when sprinting', () => {
    const victim = { x: 0, z: -2, vx: 0, vy: 0, vz: 0 }
    const attacker = { x: 0, z: 0, yaw: 0 }
    const walk = knockback(victim, attacker, false, false)
    const sprint = knockback(victim, attacker, true, false)
    expect(walk.vz).toBeLessThan(0)
    expect(walk.vy).toBeGreaterThan(0.3)
    expect(Math.abs(sprint.vz)).toBeGreaterThan(Math.abs(walk.vz))
    expect(Math.abs(knockback(victim, attacker, false, true).vz)).toBeLessThan(Math.abs(walk.vz))
  })

  test('a knocked-back body flies a few blocks and lands', () => {
    const w = flatWorld()
    const m = mover(16.5, 10, 16.5)
    settle(w, m)
    Object.assign(m, knockback(m, { x: 16.5, z: 18.5, yaw: 0 }, true, false))
    m.onGround = false
    for (let i = 0; i < 40; i++) stepMovement(w, m, IDLE_INPUT)
    expect(16.5 - m.z).toBeGreaterThan(2)
    expect(m.onGround).toBe(true)
  })
})

describe('reach and line of sight', () => {
  test('swing reaches a player in front within 3 blocks, not through a wall', () => {
    const w = flatWorld()
    const eye = [16.5, 11.62, 16.5]
    const victim = playerBox(16.5, 10, 14, false)
    expect(swingReaches(w, eye, [0, 0, -1], victim, 3)).toBe(true)
    expect(swingReaches(w, eye, [0, 0, -1], playerBox(16.5, 10, 12, false), 3)).toBe(false)
    w.set(16, 11, 15, STONE)
    expect(swingReaches(w, eye, [0, 0, -1], victim, 3)).toBe(false)
  })

  test('server reach is measured to the nearest point of the box', () => {
    expect(reachDistance([0, 1.62, 0], 0, 0, -3, false)).toBeCloseTo(2.7, 6)
  })
})

describe('shield', () => {
  test('blocks hits from the front only', () => {
    const victim = { x: 0, z: 0, yaw: 0 } // facing -z
    expect(shieldBlocks(victim, { x: 0, z: -2 })).toBe(true)
    expect(shieldBlocks(victim, { x: 0, z: 2 })).toBe(false)
  })
})
