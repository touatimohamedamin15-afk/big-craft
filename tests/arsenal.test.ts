import { describe, expect, test } from 'bun:test'
import { AIR, BED, CLAY, GLASS, OBSIDIAN, WOOL } from '../src/games/bedwars/blocks'
import { MAX_HEALTH, SPAWN_PROTECTION_TICKS, TPS } from '../src/games/bedwars/constants'
import { TNT_FUSE } from '../src/games/bedwars/arsenal'
import { addItem, countItem } from '../src/engine/inventory'
import { IDLE_INPUT, stepMovement } from '../src/engine/physics'
import { SPEED_BOOST } from '../src/games/bedwars/items'
import { TOP } from '../src/games/bedwars/maps/arena'
import { duel, ticks } from './room-helpers'

/** Two players on the red island, a facing b down the -z axis, ten blocks apart. */
function range(gap = 10) {
  const d = duel()
  ticks(d.room, SPAWN_PROTECTION_TICKS + 1)
  d.a.put(64.5, TOP, 21.5, 0, 0)
  d.b.put(64.5, TOP, 21.5 - gap, Math.PI, 0)
  ticks(d.room, 1)
  return d
}

function hold(d: ReturnType<typeof duel>, id: string, count = 1) {
  addItem(d.a.p.inventory, id, count)
  d.a.p.selected = d.a.p.inventory.findIndex((s) => s?.id === id)
}

describe('bow', () => {
  test('a full draw fires an arrow that hits for about seven before armour and spends one arrow', () => {
    const d = range(8)
    hold(d, 'bow')
    addItem(d.a.p.inventory, 'arrow', 4)
    d.a.send({ t: 'draw' })
    ticks(d.room, TPS)
    d.a.send({ t: 'release' })
    expect(countItem(d.a.p.inventory, 'arrow')).toBe(3)
    ticks(d.room, 10)
    expect(d.b.p.health).toBeCloseTo(MAX_HEALTH - 7 * 0.72, 4)
    expect(d.room.arsenal.projectiles.length).toBe(0)
  })

  test('a flick does not fire, and you cannot fire without arrows', () => {
    const d = range()
    hold(d, 'bow')
    addItem(d.a.p.inventory, 'arrow', 1)
    d.a.send({ t: 'draw' })
    ticks(d.room, 1)
    d.a.send({ t: 'release' })
    expect(countItem(d.a.p.inventory, 'arrow')).toBe(1)
    d.a.p.inventory = d.a.p.inventory.map((s) => (s?.id === 'arrow' ? null : s))
    d.a.send({ t: 'draw' })
    ticks(d.room, TPS)
    d.a.send({ t: 'release' })
    expect(d.room.arsenal.projectiles.length).toBe(0)
  })
})

describe('explosions', () => {
  test('a fireball breaks placed wool but not glass, obsidian, map blocks or beds, and throws people', () => {
    const d = range(6)
    const { room } = d
    // A wall of mixed blocks between them, three blocks in front of b.
    room.world.set(64, TOP, 18, WOOL.blue, true)
    room.world.set(64, TOP + 1, 18, GLASS, true)
    room.world.set(63, TOP, 18, OBSIDIAN, true)
    hold(d, 'fireball')
    d.a.p.pitch = -0.32
    d.a.send({ t: 'throw' })
    ticks(room, 8)
    expect(room.world.get(64, TOP, 18)).toBe(AIR)
    expect(room.world.get(64, TOP + 1, 18)).toBe(GLASS)
    expect(room.world.get(63, TOP, 18)).toBe(OBSIDIAN)
    expect(room.world.get(64, TOP - 1, 18)).not.toBe(AIR) // the island itself
    const bed = room.map.bases.find((b) => b.team === 'red')!.bed
    expect(room.world.get(bed.x, bed.y, bed.z)).toBe(BED.red)
    expect(d.a.last('explosion')).toBeDefined()
  })

  test('your own fireball hurts you far less than it hurts an enemy, and launches you', () => {
    const d = range(2)
    hold(d, 'fireball')
    d.a.p.pitch = -Math.PI / 2 + 0.05 // straight down: fireball jump
    d.a.send({ t: 'throw' })
    ticks(d.room, 3)
    const selfLoss = MAX_HEALTH - d.a.p.health
    const enemyLoss = MAX_HEALTH - d.b.p.health
    expect(selfLoss).toBeGreaterThan(0)
    expect(enemyLoss).toBeGreaterThan(selfLoss * 2)
    expect(d.a.last('velocity')!.vy).toBeGreaterThan(0.5)
  })

  test('TNT lights on placing, waits for its fuse, and breaks wool but not clay beside it', () => {
    const d = range(12)
    const { room } = d
    hold(d, 'tnt')
    const [x, z] = [64, 18]
    room.world.set(x + 1, TOP, z, WOOL.blue, true)
    room.world.set(x - 1, TOP, z, CLAY, true)
    d.a.send({ t: 'place', x, y: TOP - 1, z, face: [0, 1, 0], slot: d.a.p.selected })
    expect(room.world.get(x, TOP, z)).toBe(AIR) // an entity, not a block
    expect(countItem(d.a.p.inventory, 'tnt')).toBe(0)
    ticks(room, TNT_FUSE - 2)
    expect(room.world.get(x + 1, TOP, z)).toBe(WOOL.blue)
    ticks(room, 3)
    expect(room.world.get(x + 1, TOP, z)).toBe(AIR)
    expect(room.world.get(x - 1, TOP, z)).toBe(CLAY)
  })
})

describe('pearls and eggs', () => {
  test('a pearl takes you where it lands, for two damage', () => {
    const d = range()
    hold(d, 'pearl')
    // A shallow throw down the island (a long one would sail out over the void).
    d.a.p.pitch = -0.2
    d.a.send({ t: 'throw' })
    ticks(d.room, 40)
    expect(d.a.p.z).toBeLessThan(19.5)
    expect(d.a.p.y).toBeGreaterThanOrEqual(TOP - 0.01)
    expect(d.a.p.health).toBe(MAX_HEALTH - 2)
    expect(d.a.last('teleport')).toBeDefined()
  })

  test('a bridge egg thrown off the edge lays a line of team wool over the void', () => {
    const d = duel()
    const { room } = d
    ticks(room, SPAWN_PROTECTION_TICKS + 1)
    // The red island's back edge is at z = 9; face -z (out into the void).
    d.a.put(64.5, TOP, 11.5, 0, 0)
    ticks(room, 1)
    hold(d, 'bridge_egg')
    d.a.send({ t: 'throw' })
    ticks(room, 40)
    let laid = 0
    for (let z = 0; z < 9; z++) if (room.world.get(64, TOP - 1, z) === WOOL.red) laid++
    expect(laid).toBeGreaterThan(5)
  })
})

describe('potions', () => {
  test('speed makes you faster and the server accepts the faster moves', () => {
    const d = range()
    hold(d, 'speed_potion')
    d.a.send({ t: 'use' })
    expect(d.a.p.effects.speed).toBeGreaterThan(d.room.tickCount)
    expect(d.a.last('self')!.self.effects.speed).toBe(d.a.p.effects.speed)
    const before = d.a.p.x
    d.a.move(d.a.p.x + 1.3, d.a.p.y, d.a.p.z)
    expect(d.a.p.x).toBeCloseTo(before + 1.3, 4)
    const m = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, sneaking: false, sprinting: false, fallDistance: 0 }
    const n = { ...m }
    const world = d.room.world
    m.x = n.x = 64.5
    m.y = n.y = TOP
    m.z = n.z = 15.5
    // Walk toward +x, out of the base's side door.
    for (let i = 0; i < 10; i++) {
      stepMovement(world, m, { ...IDLE_INPUT, forward: 1, yaw: -Math.PI / 2 })
      stepMovement(world, n, { ...IDLE_INPUT, forward: 1, yaw: -Math.PI / 2, speedBoost: SPEED_BOOST })
    }
    expect(n.x - 64.5).toBeGreaterThan((m.x - 64.5) * 1.25)
  })

  test('invisibility shows in the player view and ends on death', () => {
    const d = range()
    hold(d, 'invisibility_potion')
    d.a.send({ t: 'use' })
    expect(d.room.playerView(d.a.p).invisible).toBe(true)
    d.room.die(d.a.p, 'void')
    expect(d.room.playerView(d.a.p).invisible).toBe(false)
  })
})
