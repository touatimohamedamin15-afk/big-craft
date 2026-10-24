import { describe, expect, test } from 'bun:test'
import { STONE } from '../src/games/bedwars/blocks'
import { JUMP_VELOCITY, SAFE_FALL, SNEAK_HEIGHT, SPRINT_MULTIPLIER, TPS, WALK_SPEED } from '../src/games/bedwars/constants'
import { playerBox, stepMovement, IDLE_INPUT } from '../src/engine/physics'
import { World } from '../src/engine/world'
import { flatWorld, mover, run, settle } from './helpers'

describe('gravity and landing', () => {
  test('falls and rests exactly on the floor', () => {
    const w = flatWorld()
    const m = mover(16.5, 15, 16.5)
    settle(w, m)
    expect(m.y).toBeCloseTo(10, 6)
    expect(m.onGround).toBe(true)
    expect(m.vy).toBeLessThan(0) // gravity keeps pressing down so ground contact is re-detected
  })

  test('velocity approaches a terminal speed', () => {
    const w = new World(8, 400, 8)
    const m = mover(4, 390, 4)
    run(w, m, 200)
    expect(-m.vy).toBeGreaterThan(3.5)
    expect(-m.vy).toBeLessThan(3.93)
  })
})

describe('jumping', () => {
  test('jump peaks about 1.6 blocks: over one block with room, never two', () => {
    const w = flatWorld()
    const m = mover(16.5, 10, 16.5)
    settle(w, m)
    const { maxY } = run(w, m, 1, { jump: true })
    const after = run(w, m, 20)
    const peak = Math.max(maxY, after.maxY) - 10
    expect(peak).toBeGreaterThan(1.5)
    expect(peak).toBeLessThan(1.75)
    expect(m.y).toBeCloseTo(10, 6)
  })

  test('cannot jump in mid-air', () => {
    const w = flatWorld()
    const m = mover(16.5, 20, 16.5)
    stepMovement(w, m, { ...IDLE_INPUT, jump: true })
    expect(m.vy).toBeLessThan(JUMP_VELOCITY - 0.1)
  })

  test('can jump onto a one-block step but not a two-block wall', () => {
    const w = flatWorld()
    w.fill(16, 10, 10, 31, 10, 14, STONE) // one-high step from x = 16
    w.fill(16, 10, 20, 16, 11, 24, STONE) // two-high wall
    const a = mover(14.5, 10, 12.5)
    a.yaw = -Math.PI / 2 // face +x
    settle(w, a)
    run(w, a, 20, { forward: 1, jump: true })
    settle(w, a)
    expect(a.x).toBeGreaterThan(16)
    expect(a.y).toBeCloseTo(11, 6)

    const b = mover(14.5, 10, 22.5)
    b.yaw = -Math.PI / 2
    settle(w, b)
    run(w, b, 40, { forward: 1, jump: true })
    expect(b.x).toBeLessThan(15.71)
  })
})

describe('walking', () => {
  test('walk, sprint and sneak reach their speeds', () => {
    const speed = (input: object) => {
      const w = flatWorld()
      const m = mover(2.5, 10, 30)
      settle(w, m)
      run(w, m, 20, { forward: 1, ...input })
      const z0 = m.z
      run(w, m, TPS, { forward: 1, ...input })
      return (z0 - m.z) // blocks per second toward -z
    }
    const walk = speed({})
    const sprint = speed({ sprint: true })
    const sneak = speed({ sneak: true })
    expect(walk).toBeCloseTo(WALK_SPEED * TPS, 1)
    expect(sprint / walk).toBeCloseTo(SPRINT_MULTIPLIER, 1)
    expect(sneak / walk).toBeCloseTo(0.3, 1)
  })

  test('sprinting stops when walking backwards or sneaking', () => {
    const w = flatWorld()
    const m = mover(16.5, 10, 16.5)
    settle(w, m)
    run(w, m, 2, { forward: 1, sprint: true })
    expect(m.sprinting).toBe(true)
    run(w, m, 1, { forward: -1, sprint: true })
    expect(m.sprinting).toBe(false)
    run(w, m, 1, { forward: 1, sprint: true, sneak: true })
    expect(m.sprinting).toBe(false)
  })

  test('walls stop horizontal movement', () => {
    const w = flatWorld()
    w.fill(0, 10, 10, 31, 12, 10, STONE) // wall at z = 10..11
    const m = mover(16.5, 10, 14.5)
    settle(w, m)
    run(w, m, 60, { forward: 1, sprint: true })
    expect(m.z).toBeCloseTo(11.3, 4)
    expect(m.sprinting).toBe(false)
  })

  test('ceilings stop a jump', () => {
    const w = flatWorld()
    w.fill(15, 12, 15, 17, 12, 17, STONE) // ceiling two blocks up
    const m = mover(16.5, 10, 16.5)
    settle(w, m)
    const { maxY } = run(w, m, 20, { jump: true })
    expect(maxY + 1.8).toBeLessThanOrEqual(12 + 1e-6)
  })
})

describe('sneaking', () => {
  test('shrinks the hitbox', () => {
    const box = playerBox(0, 0, 0, true)
    expect(box[4] - box[1]).toBe(SNEAK_HEIGHT)
  })

  test('cannot walk off an edge while sneaking, and can lean over it', () => {
    const w = new World(16, 16, 16)
    w.fill(0, 0, 0, 7, 4, 15, STONE) // floor ends at x = 8, void beyond
    const m = mover(6.5, 5, 8.5)
    m.yaw = -Math.PI / 2 // face +x
    settle(w, m)
    run(w, m, 60, { forward: 1, sneak: true })
    expect(m.onGround).toBe(true)
    expect(m.y).toBeCloseTo(5, 6)
    expect(m.x).toBeGreaterThan(8) // leaning past the edge, as bridging needs
    expect(m.x).toBeLessThan(8.3)
  })

  test('walks straight off without sneaking', () => {
    const w = new World(16, 16, 16)
    w.fill(0, 0, 0, 7, 4, 15, STONE)
    const m = mover(6.5, 5, 8.5)
    m.yaw = -Math.PI / 2
    settle(w, m)
    run(w, m, 30, { forward: 1 })
    expect(m.y).toBeLessThan(4)
  })
})

describe('falling', () => {
  test('no damage up to the safe fall height, damage beyond', () => {
    const drop = (h: number) => {
      const w = flatWorld()
      const m = mover(16.5, 10 + h, 16.5)
      return run(w, m, 80).fallDamage
    }
    expect(drop(SAFE_FALL)).toBe(0)
    expect(drop(SAFE_FALL + 1)).toBe(1)
    expect(drop(10)).toBe(10 - SAFE_FALL)
  })

  test('jumping on flat ground never hurts', () => {
    const w = flatWorld()
    const m = mover(16.5, 10, 16.5)
    settle(w, m)
    expect(run(w, m, 200, { jump: true, forward: 1, sprint: true }).fallDamage).toBe(0)
  })
})

describe('stacking blocks', () => {
  test('pillaring: jump, place under feet, land on the new block', () => {
    const w = flatWorld()
    const m = mover(16.5, 10, 16.5)
    settle(w, m)
    for (let level = 0; level < 5; level++) {
      run(w, m, 1, { jump: true })
      // Wait until the feet clear the next block, then place it.
      let guard = 0
      while (m.y < 10 + level + 1 && guard++ < 20) run(w, m, 1)
      w.set(16, 10 + level, 16, STONE, true)
      run(w, m, 20)
      expect(m.y).toBeCloseTo(11 + level, 6)
      expect(m.onGround).toBe(true)
    }
  })

  test('walks along a placed bridge', () => {
    const w = new World(40, 16, 8)
    w.fill(0, 0, 0, 4, 4, 7, STONE)
    for (let x = 5; x < 30; x++) w.set(x, 4, 3, STONE, true)
    const m = mover(2.5, 5, 3.5)
    m.yaw = -Math.PI / 2
    settle(w, m)
    run(w, m, 100, { forward: 1 })
    expect(m.x).toBeGreaterThan(20)
    expect(m.y).toBeCloseTo(5, 6)
  })
})

describe('friendly movement', () => {
  test('coyote time: you can still jump just after walking off an edge', () => {
    const w = new World(16, 16, 16)
    w.fill(0, 0, 0, 7, 4, 15, STONE)
    const m = mover(7.2, 5, 8.5)
    m.yaw = -Math.PI / 2
    run(w, m, 30)
    // Walk off; the first ticks in the air still accept a jump.
    let airborne = 0
    while (m.onGround && airborne++ < 40) run(w, m, 1, { forward: 1 })
    run(w, m, 1, { forward: 1, jump: true })
    expect(m.vy).toBeGreaterThan(0.3)
  })

  test('air control lets you steer a jump sideways', () => {
    const w = flatWorld()
    const m = mover(16.5, 10, 16.5)
    settle(w, m)
    run(w, m, 1, { jump: true })
    run(w, m, 10, { strafe: 1 })
    expect(m.x - 16.5).toBeGreaterThan(1.2)
  })
})
