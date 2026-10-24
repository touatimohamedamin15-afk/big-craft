import { STONE } from '../src/games/bedwars/blocks'
import { IDLE_INPUT, stepMovement, type MoveInput, type Mover } from '../src/engine/physics'
import { World } from '../src/engine/world'

/** A 32×32 stone floor whose top is y = 10, over the void. */
export function flatWorld(): World {
  const w = new World(32, 32, 32)
  w.fill(0, 0, 0, 31, 9, 31, STONE)
  return w
}

export function mover(x: number, y: number, z: number): Mover {
  return { x, y, z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: false, sneaking: false, sprinting: false, fallDistance: 0 }
}

export function run(world: World, m: Mover, ticks: number, input: Partial<MoveInput> = {}) {
  let fallDamage = 0
  let maxY = m.y
  for (let i = 0; i < ticks; i++) {
    const r = stepMovement(world, m, { ...IDLE_INPUT, yaw: m.yaw, ...input })
    fallDamage += r.fallDamage
    maxY = Math.max(maxY, m.y)
  }
  return { fallDamage, maxY }
}

/** Lands the mover on the floor below it. */
export function settle(world: World, m: Mover) {
  run(world, m, 40)
}
