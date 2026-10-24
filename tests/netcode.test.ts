import { describe, expect, test } from 'bun:test'
import { AIR, FLOWERS, POLE, STONE, WOOL } from '../src/games/bedwars/blocks'
import { breakTicks } from '../src/engine/building'
import { addItem, countItem } from '../src/engine/inventory'
import { ServerClock } from '../src/engine/net/clock'
import { raycastBlock } from '../src/engine/raycast'
import { World } from '../src/engine/world'
import { item } from '../src/games/bedwars/items'
import { duel, ticks, type TestClient } from './room-helpers'

/** Sends an input as the browser does, with its tick number. */
function input(c: TestClient, seq: number, x: number, y: number, z: number) {
  c.move(x, y, z, { seq })
}

describe('movement over a laggy link', () => {
  test('an input after a skipped one covers both ticks instead of tripping the fly check', () => {
    const { room, a } = duel()
    const { x, y, z } = a.p
    const tp = a.tp
    input(a, 1, x, y, z)
    // A jump's first two ticks rise 0.48 then 0.4; the first input never arrived.
    input(a, 3, x, y + 0.88, z)
    expect(a.tp).toBe(tp)
    expect(a.p.y).toBeCloseTo(y + 0.88, 6)
    // Without tick numbers the same step is still too far for one tick.
    a.move(x, y + 1.76, z)
    expect(a.tp).toBe(tp + 1)
    void room
  })

  test('claimed gaps cost budget, so the sustained speed limit holds', () => {
    const { room, a } = duel()
    let { x } = a.p
    const { y, z } = a.p
    let seq = 1
    input(a, seq, x, y, z)
    const start = a.p.x
    // A cheat claiming ten-tick gaps every tick moves at most what the budget refills.
    for (let i = 0; i < 40; i++) {
      seq += 10
      x += 10
      input(a, seq, x, y, z)
      room.tick()
    }
    expect(a.p.x - start).toBeLessThan(1.1 * (40 + 20) + 1)
  })
})

describe('placing over a laggy link', () => {
  test('a block under your feet is not refused because the server still has you standing there', () => {
    const { room, a } = duel()
    const red = room.map.bases.find((b) => b.team === 'red')!
    // Somewhere open in the void beside the base: a placed floor block to build on.
    const [bx, by, bz] = [Math.floor(red.center[0]) + 2, red.center[1] + 6, Math.floor(red.center[2]) + 2]
    room.world.set(bx, by - 1, bz, WOOL.red, true)
    a.put(bx + 0.5, by, bz + 0.5)
    a.p.inventory[0] = null
    addItem(a.p.inventory, 'wool', 4)
    a.p.selected = a.p.inventory.findIndex((s) => s?.id === 'wool')
    // The client has already jumped clear; the server's copy of the player still stands in the cell.
    a.send({ t: 'place', x: bx, y: by - 1, z: bz, face: [0, 1, 0], slot: a.p.selected })
    expect(room.world.get(bx, by, bz)).not.toBe(AIR)
    expect(countItem(a.p.inventory, 'wool')).toBe(3)
  })
})

describe('breaking over a laggy link', () => {
  function digging() {
    const d = duel()
    const { room, a } = d
    const red = room.map.bases.find((b) => b.team === 'red')!
    const [x, y, z] = [Math.floor(red.spawn[0]), red.spawn[1], Math.floor(red.spawn[2]) - 2]
    room.world.set(x, y, z, WOOL.blue, true)
    a.put(x + 0.5, y, z + 2.5)
    const ticksNeeded = breakTicks(room.world.get(x, y, z), item(a.p.inventory[a.p.selected]?.id))
    return { ...d, x, y, z, ticksNeeded }
  }

  test('the client says it finished a little before the server: the block breaks at once', () => {
    const { room, a, x, y, z, ticksNeeded } = digging()
    a.send({ t: 'dig', target: [x, y, z] })
    ticks(room, Math.max(0, ticksNeeded - 6))
    a.send({ t: 'dig', target: [x, y, z], done: true })
    expect(room.world.get(x, y, z)).toBe(AIR)
  })

  test('a claim far ahead of the server is refused and the block is sent back', () => {
    const { room, a, x, y, z, ticksNeeded } = digging()
    expect(ticksNeeded).toBeGreaterThan(12)
    a.send({ t: 'dig', target: [x, y, z] })
    a.send({ t: 'dig', target: [x, y, z], done: true })
    expect(room.world.get(x, y, z)).toBe(WOOL.blue)
    const back = a.msgs.filter((m) => m.t === 'blocks').at(-1)
    expect(back && back.t === 'blocks' && back.changes).toContainEqual([x, y, z, room.world.raw(x, y, z)])
  })
})

describe('around the base', () => {
  test("any team's shopkeeper sells to you", () => {
    const { room, a } = duel()
    const blueShop = room.map.npcs.find((n) => n.kind === 'shop' && n.team === 'blue')!
    a.put(blueShop.x + 1.5, blueShop.y, blueShop.z)
    addItem(a.p.inventory, 'iron', 4)
    a.send({ t: 'buy', offer: 'wool' })
    expect(countItem(a.p.inventory, 'wool')).toBe(16)
  })

  test('everyone sees a title when a bed is broken, not just its team', () => {
    const { room, a, b } = duel()
    const blue = room.map.bases.find((base) => base.team === 'blue')!
    room.breakBlock(a.p, blue.bed.x, blue.bed.y, blue.bed.z)
    const titles = (c: TestClient) => c.msgs.flatMap((m) => (m.t === 'event' && m.kind === 'title' ? [m.text] : []))
    expect(titles(b)).toContain('Bed destroyed')
    expect(titles(a)).toContain('Blue bed destroyed')
  })

  test('flowers and poles do not block line of sight; solid blocks do', () => {
    const w = new World(16, 8, 16)
    w.set(5, 1, 1, FLOWERS.red)
    w.set(7, 1, 1, POLE)
    w.set(9, 1, 1, STONE)
    const hitAll = raycastBlock(w, [1.5, 1.2, 1.5], [1, 0, 0], 12)
    const hitSolid = raycastBlock(w, [1.5, 1.2, 1.5], [1, 0, 0], 12, true)
    expect(hitAll?.x).toBe(5)
    expect(hitSolid?.x).toBe(9)
  })
})

describe('drawing others on the server timeline', () => {
  test('jittery arrivals still map to a steady, slightly delayed render tick', () => {
    const clock = new ServerClock()
    // Ticks every 50 ms, each arriving 40 to 140 ms late.
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let t = 0; t < 200; t++) clock.observe(t, t * 50 + 40 + rand() * 100)
    const now = 199 * 50 + 140
    const r = clock.renderTick(now)
    // Behind the newest tick, by at least the base two ticks and no more than six plus the base latency.
    expect(r).toBeLessThan(199)
    expect(r).toBeGreaterThan(199 - 2 - 6 - 3)
    // Advancing time advances the render tick at the server's rate.
    expect(clock.renderTick(now + 500) - r).toBeCloseTo(10, 5)
  })

  test('ticks that arrive in bursts (a server catching up) never pull the render tick past the newest', () => {
    const clock = new ServerClock()
    let newest = 0
    let worstLead = -Infinity
    for (let t = 0; t < 300; t++) {
      // Every tenth tick the server stalls, then sends three at once.
      const at = t % 10 < 3 ? Math.floor(t / 10) * 500 + 150 : t * 50
      clock.observe(t, at)
      newest = t
      worstLead = Math.max(worstLead, clock.renderTick(at) - newest)
    }
    expect(worstLead).toBeLessThan(0)
  })
})
