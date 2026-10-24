import { describe, expect, test } from 'bun:test'
import { AIR, BED, CLAY, PLANKS, WOOL } from '../src/games/bedwars/blocks'
import { MAX_HEALTH, RESPAWN_TICKS, SAFE_FALL, SPAWN_PROTECTION_TICKS, TPS } from '../src/games/bedwars/constants'
import { scaleTimeline, TIMELINE } from '../src/games/bedwars/rules'
import { addItem, countItem } from '../src/engine/inventory'
import { TOP } from '../src/games/bedwars/maps/arena'
import { arena, duel, sandbox, TestClient, ticks } from './room-helpers'

describe('lobby and start', () => {
  test('one player waits; a second starts the countdown and the round', () => {
    const room = arena()
    const a = new TestClient(room, 'Ash')
    ticks(room, 40)
    expect(room.phase).toBe('waiting')
    expect(a.p.y).toBeGreaterThan(60) // in the lobby above the map
    new TestClient(room, 'Bea')
    ticks(room, 2)
    expect(room.phase).toBe('countdown')
    ticks(room, 20)
    expect(room.phase).toBe('playing')
    expect(new Set([...room.players.values()].map((p) => p.team)).size).toBe(2)
    expect(a.p.y).toBe(TOP)
  })

  test('the lobby deck is removed when the round starts', () => {
    const { room } = duel()
    const [x0, y0, z0] = room.map.lobby!.box
    expect(room.world.get(x0, y0, z0)).toBe(AIR)
  })

  test('the host can start alone and bots fill the other teams', () => {
    const room = arena({ bots: true })
    const a = new TestClient(room, 'Ash')
    a.send({ t: 'start' })
    ticks(room, 25)
    expect(room.phase).toBe('playing')
    expect(room.players.size).toBe(4)
    expect([...room.teams.values()].every((t) => t.bed)).toBe(true)
  })

  test('teams with nobody lose their bed and are out from the start', () => {
    const { room } = duel()
    const green = room.teams.get('green')!
    expect(green.bed).toBe(false)
    expect(green.eliminated).toBe(true)
    const bed = room.map.bases.find((b) => b.team === 'green')!.bed
    expect(room.world.get(bed.x, bed.y, bed.z)).toBe(AIR)
    expect(room.teams.get('red')!.bed).toBe(true)
  })

  test('teams are capped at the team size', () => {
    const room = arena()
    const a = new TestClient(room, 'Ash')
    const b = new TestClient(room, 'Bea')
    a.send({ t: 'team', team: 'red' })
    b.send({ t: 'team', team: 'red' })
    expect(b.p.team).toBeNull()
    expect(b.events('error')[0]).toContain('full')
  })

  test('cannot build or fight in the lobby', () => {
    const room = arena()
    const a = new TestClient(room, 'Ash')
    addItem(a.p.inventory, 'wool', 4)
    a.p.team = 'red'
    const [x, y, z] = room.map.lobby!.spawn
    a.send({ t: 'place', x: Math.floor(x), y: y - 1, z: Math.floor(z) + 2, face: [0, 1, 0], slot: 0 })
    ticks(room, 1)
    expect(room.world.get(Math.floor(x), y, Math.floor(z) + 2)).toBe(AIR)
  })
})

describe('building in a round', () => {
  test('placing spends the block; protected zones and reach refuse', () => {
    const { room, a } = duel()
    const [sx, sy, sz] = room.map.bases.find((b) => b.team === 'red')!.spawn
    addItem(a.p.inventory, 'wool', 8)
    const slot = a.p.inventory.findIndex((s) => s?.id === 'wool')
    expect(slot).toBeLessThan(9)
    // Spawn is protected.
    a.send({ t: 'place', x: Math.floor(sx), y: sy - 1, z: Math.floor(sz), face: [0, 1, 0], slot })
    expect(room.world.get(Math.floor(sx), sy, Math.floor(sz))).toBe(AIR)
    expect(a.events('error')).toContain('You cannot build here.')
    // Four blocks in front is fine (the red base faces +z toward the middle).
    a.send({ t: 'place', x: Math.floor(sx), y: sy - 1, z: Math.floor(sz) + 3, face: [0, 1, 0], slot })
    expect(room.world.get(Math.floor(sx), sy, Math.floor(sz) + 3)).toBe(WOOL.red)
    expect(room.world.isPlaced(Math.floor(sx), sy, Math.floor(sz) + 3)).toBe(true)
    expect(countItem(a.p.inventory, 'wool')).toBe(7)
    // Out of reach.
    a.send({ t: 'place', x: Math.floor(sx), y: sy - 1, z: Math.floor(sz) + 9, face: [0, 1, 0], slot })
    expect(room.world.get(Math.floor(sx), sy, Math.floor(sz) + 9)).toBe(AIR)
  })

  test('digging takes the block-and-tool time, then breaks it', () => {
    const { room, a } = duel()
    const [sx, sy, sz] = room.map.bases.find((b) => b.team === 'red')!.spawn
    const [x, y, z] = [Math.floor(sx), sy, Math.floor(sz) + 2]
    room.world.set(x, y, z, CLAY, true)
    a.send({ t: 'dig', target: [x, y, z] })
    ticks(room, 100) // bare hands on clay: 125 ticks
    expect(room.world.get(x, y, z)).toBe(CLAY)
    ticks(room, 30)
    expect(room.world.get(x, y, z)).toBe(AIR)
  })

  test('map blocks cannot be dug', () => {
    const { room, a } = duel()
    const [sx, sy, sz] = room.map.bases.find((b) => b.team === 'red')!.spawn
    a.send({ t: 'dig', target: [Math.floor(sx), sy - 1, Math.floor(sz) + 1] })
    ticks(room, 400)
    expect(room.world.get(Math.floor(sx), sy - 1, Math.floor(sz) + 1)).not.toBe(AIR)
  })
})

describe('beds', () => {
  test('an enemy breaks your bed; you cannot break your own', () => {
    const { room, a, b } = duel()
    const bed = room.map.bases.find((x) => x.team === 'red')!.bed
    a.put(bed.x + 0.5, TOP, bed.z - 1.5)
    a.send({ t: 'dig', target: [bed.x, bed.y, bed.z] })
    ticks(room, 20)
    expect(room.world.get(bed.x, bed.y, bed.z)).toBe(BED.red)
    b.put(bed.x + 0.5, TOP, bed.z - 1.5)
    b.send({ t: 'dig', target: [bed.x, bed.y, bed.z] })
    ticks(room, 20)
    expect(room.world.get(bed.x, bed.y, bed.z)).toBe(AIR)
    expect(room.world.get(bed.x + bed.dx, bed.y, bed.z + bed.dz)).toBe(AIR)
    expect(room.teams.get('red')!.bed).toBe(false)
    expect(a.events('bed')[0]).toContain('Red bed was destroyed by Bea')
    expect(a.events('title')).toContain('Bed destroyed')
    expect(b.p.stats.beds).toBe(1)
  })
})

describe('combat', () => {
  function face(room: ReturnType<typeof duel>) {
    const { a, b } = room
    ticks(room.room, SPAWN_PROTECTION_TICKS + 1)
    // On the red island, clear of blocks: a faces -z toward b.
    a.put(64.5, TOP, 16.5, 0, 0)
    b.put(64.5, TOP, 14.5, Math.PI, 0)
    ticks(room.room, 1)
  }

  test('hits damage, knock back and respect the hurt window', () => {
    const d = duel()
    face(d)
    const { room, a, b } = d
    a.send({ t: 'attack', target: b.p.id })
    expect(b.p.health).toBeLessThan(MAX_HEALTH)
    const after = b.p.health
    expect(b.last('velocity')!.vz).toBeLessThan(0)
    a.send({ t: 'attack', target: b.p.id })
    expect(b.p.health).toBe(after) // still in the hurt window
    ticks(room, 11)
    a.send({ t: 'attack', target: b.p.id })
    expect(b.p.health).toBeLessThan(after)
  })

  test('out of reach misses; teammates are not hurt', () => {
    const d = duel()
    face(d)
    const { a, b } = d
    b.put(64.5, TOP, 10.5)
    a.send({ t: 'attack', target: b.p.id })
    expect(b.p.health).toBe(MAX_HEALTH)
    b.put(64.5, TOP, 14.5)
    b.p.team = 'red'
    a.send({ t: 'attack', target: b.p.id })
    expect(b.p.health).toBe(MAX_HEALTH)
  })

  test('spawn protection blocks damage until it runs out', () => {
    const { a, b } = duel()
    a.put(64.5, TOP, 16.5)
    b.put(64.5, TOP, 14.5)
    a.p.protectedTicks = 0
    a.send({ t: 'attack', target: b.p.id })
    expect(b.p.health).toBe(MAX_HEALTH)
  })

  test('a raised shield blocks a frontal hit', () => {
    const d = duel()
    face(d)
    const { a, b } = d
    addItem(b.p.inventory, 'shield', 1)
    b.p.selected = b.p.inventory.findIndex((s) => s?.id === 'shield')
    b.move(64.5, TOP, 14.5, { yaw: Math.PI, shield: true })
    a.send({ t: 'attack', target: b.p.id })
    expect(b.p.health).toBe(MAX_HEALTH)
  })

  test('swords out-hit fists; sharpness adds damage', () => {
    const hitWith = (sharp: boolean) => {
      const d = duel()
      face(d)
      if (sharp) d.room.teams.get('red')!.upgrades.sharpness = 1
      d.a.p.selected = 0 // wooden sword from the spawn kit
      d.a.send({ t: 'attack', target: d.b.p.id })
      return MAX_HEALTH - d.b.p.health
    }
    expect(hitWith(false)).toBeCloseTo(4 * 0.72, 4)
    expect(hitWith(true)).toBeCloseTo(5 * 0.72, 4)
  })
})

describe('death and respawn', () => {
  test('the void kills, credits the last attacker and hands over resources', () => {
    const d = duel()
    const { room, a, b } = d
    ticks(room, SPAWN_PROTECTION_TICKS + 1)
    addItem(b.p.inventory, 'iron', 20)
    addItem(b.p.inventory, 'gold', 3)
    b.p.lastAttacker = { id: a.p.id, tick: room.tickCount }
    b.move(b.p.x, b.p.y - 0.5, b.p.z)
    b.put(b.p.x, room.map.killY - 1, b.p.z)
    ticks(room, 1)
    expect(b.p.alive).toBe(false)
    expect(a.events('kill').at(-1)).toBe('Bea was knocked into the void by Ash')
    expect(countItem(a.p.inventory, 'iron')).toBe(20)
    expect(countItem(a.p.inventory, 'gold')).toBe(3)
    expect(a.p.stats.kills).toBe(1)
  })

  test('respawns after five seconds with permanent armour and a downgraded pickaxe', () => {
    const { room, b } = duel()
    b.p.armor = 'iron'
    b.p.pickaxeTier = 2
    addItem(b.p.inventory, 'gold_pickaxe', 1)
    room.die(b.p, 'void')
    ticks(room, RESPAWN_TICKS - 1)
    expect(b.p.alive).toBe(false)
    expect(b.p.respawnAt).not.toBeNull()
    ticks(room, 1)
    expect(b.p.alive).toBe(true)
    expect(b.p.armor).toBe('iron')
    expect(countItem(b.p.inventory, 'iron_pickaxe')).toBe(1)
    expect(countItem(b.p.inventory, 'wood_sword')).toBe(1)
    expect(b.p.protectedTicks).toBe(SPAWN_PROTECTION_TICKS)
  })

  test('without a bed a death is final; the last team standing wins and the room resets', () => {
    const { room, a, b } = duel({ endTicks: 40 })
    room.teams.get('blue')!.bed = false
    room.die(b.p, 'melee', a.p)
    expect(b.p.eliminated).toBe(true)
    expect(a.events('kill').at(-1)).toContain('Final kill!')
    expect(room.phase).toBe('ended')
    expect(room.winner).toBe('red')
    expect(a.events('title')).toContain('Red wins!')
    ticks(room, 41)
    expect(['waiting', 'countdown']).toContain(room.phase)
    expect(a.p.team).toBeNull()
    expect(a.last('world')).toBeDefined()
    expect(room.world.get(...(room.map.lobby!.box.slice(0, 3) as [number, number, number]))).toBe(PLANKS)
  })

  test('fall damage is judged by the server from reported positions', () => {
    const { room, a } = duel()
    ticks(room, SPAWN_PROTECTION_TICKS + 1)
    const [x, , z] = [a.p.x, a.p.y, a.p.z]
    a.put(x, TOP + 6, z)
    for (let y = TOP + 6; y > TOP; y -= 0.5) {
      a.move(x, y, z)
      ticks(room, 1)
    }
    a.move(x, TOP, z)
    expect(a.p.health).toBe(MAX_HEALTH - (6 - SAFE_FALL))
  })

  test('teleporting moves are refused', () => {
    const { a } = duel()
    const before = a.p.z
    a.move(a.p.x, a.p.y, a.p.z + 8)
    expect(a.p.z).toBe(before)
    expect(a.last('teleport')!.z).toBe(before)
  })
})

describe('generators and pickup', () => {
  test('the forge makes iron at your base and you pick it up by standing on it', () => {
    const { room, a } = duel()
    const forge = room.map.bases.find((b) => b.team === 'red')!.forge
    ticks(room, 5 * TPS)
    const pile = room.drops.find((d) => d.item === 'iron' && Math.hypot(d.x - forge[0], d.z - forge[2]) < 1)
    expect(pile && pile.count).toBeGreaterThan(2)
    a.put(forge[0], forge[1], forge[2])
    ticks(room, 1)
    expect(countItem(a.p.inventory, 'iron')).toBeGreaterThan(2)
  })

  test('a dropped item flies ahead, waits a second, then another player can pick it up', () => {
    const { room, a, b } = duel()
    const red = room.map.bases.find((base) => base.team === 'red')!
    const [x, y, z] = red.spawn
    a.put(x, y, z, 0, 0)
    b.send({ t: 'team', team: 'red' })
    a.p.inventory[0] = null
    addItem(a.p.inventory, 'iron', 5)
    a.p.selected = a.p.inventory.findIndex((s) => s?.id === 'iron')
    a.send({ t: 'drop' })
    expect(countItem(a.p.inventory, 'iron')).toBe(4)
    const thrown = room.drops.find((d) => d.source === -1)!
    expect(thrown.count).toBe(1)
    ticks(room, 5)
    // Thrown forward (yaw 0 looks toward -z), and still on the ground nearby, not picked straight back up.
    expect(thrown.z).toBeLessThan(z)
    expect(room.drops).toContain(thrown)
    a.send({ t: 'drop', all: true })
    expect(countItem(a.p.inventory, 'iron')).toBe(0)
    expect(room.drops.filter((d) => d.source === -1).map((d) => d.count).sort()).toEqual([1, 4])
    ticks(room, TPS + 20)
    expect(countItem(a.p.inventory, 'iron')).toBe(0)
    // Someone walks over and takes both.
    for (const d of room.drops.filter((d) => d.source === -1)) {
      b.put(d.x, d.y, d.z)
      ticks(room, 1)
    }
    expect(countItem(b.p.inventory, 'iron')).toBe(5)
  })

  test('an empty hand drops nothing', () => {
    const { room, a } = duel()
    a.p.inventory[a.p.selected] = null
    a.send({ t: 'drop', all: true })
    expect(room.drops.filter((d) => d.source === -1)).toHaveLength(0)
  })

  test('piles stop growing at their cap', () => {
    const { room } = duel()
    ticks(room, 4 * 60 * TPS)
    const iron = room.drops.filter((d) => d.item === 'iron')
    expect(Math.max(...iron.map((d) => d.count))).toBe(48)
    const diamonds = room.drops.filter((d) => d.item === 'diamond')
    expect(diamonds.length).toBe(4)
    expect(Math.max(...diamonds.map((d) => d.count))).toBeLessThanOrEqual(4)
  })
})

describe('shop and upgrades', () => {
  function atShop() {
    const d = duel()
    const shop = d.room.map.npcs.find((n) => n.kind === 'shop' && n.team === 'red')!
    d.a.put(shop.x + 1, shop.y, shop.z)
    return { ...d, shop }
  }

  test('buying spends resources and refuses when short or far away', () => {
    const { room, a } = atShop()
    addItem(a.p.inventory, 'iron', 6)
    a.send({ t: 'buy', offer: 'wool' })
    expect(countItem(a.p.inventory, 'wool')).toBe(16)
    expect(countItem(a.p.inventory, 'iron')).toBe(2)
    a.send({ t: 'buy', offer: 'wool' })
    expect(a.events('error').at(-1)).toBe('You need 4 iron.')
    a.put(64.5, TOP, 64.5)
    addItem(a.p.inventory, 'iron', 10)
    a.send({ t: 'buy', offer: 'wool' })
    expect(a.events('error').at(-1)).toContain('shopkeeper')
    void room
  })

  test('a sword replaces the wooden one; armour and tools tier up', () => {
    const { a } = atShop()
    addItem(a.p.inventory, 'iron', 64)
    addItem(a.p.inventory, 'gold', 30)
    a.send({ t: 'buy', offer: 'stone_sword' })
    expect(countItem(a.p.inventory, 'wood_sword')).toBe(0)
    expect(countItem(a.p.inventory, 'stone_sword')).toBe(1)
    a.send({ t: 'buy', offer: 'chain_armor' })
    expect(a.p.armor).toBe('chain')
    a.send({ t: 'buy', offer: 'chain_armor' })
    expect(a.events('error').at(-1)).toContain('already')
    a.send({ t: 'buy', offer: 'pickaxe' })
    a.send({ t: 'buy', offer: 'pickaxe' })
    expect(a.p.pickaxeTier).toBe(1)
    expect(countItem(a.p.inventory, 'iron_pickaxe')).toBe(1)
    expect(countItem(a.p.inventory, 'wood_pickaxe')).toBe(0)
  })

  test('team upgrades cost diamonds at the upgrades keeper', () => {
    const { room, a } = duel()
    const npc = room.map.npcs.find((n) => n.kind === 'upgrades' && n.team === 'red')!
    a.put(npc.x + 1, npc.y, npc.z)
    addItem(a.p.inventory, 'diamond', 6)
    a.send({ t: 'upgrade', id: 'protection' })
    a.send({ t: 'upgrade', id: 'protection' })
    expect(room.teams.get('red')!.upgrades.protection).toBe(2)
    expect(countItem(a.p.inventory, 'diamond')).toBe(0)
    a.send({ t: 'upgrade', id: 'healPool' })
    expect(a.events('error').at(-1)).toBe('You need 1 diamonds.')
  })
})

describe('timeline', () => {
  test('beds go, then the game ends in a draw if teams are tied', () => {
    const { room, a } = duel({ timeline: scaleTimeline(TIMELINE, 600) })
    ticks(room, Math.ceil((25 * 60 * TPS) / 600) + 1)
    expect([...room.teams.values()].some((t) => t.bed)).toBe(false)
    expect(a.events('title')).toContain('All beds destroyed')
    ticks(room, Math.ceil((10 * 60 * TPS) / 600) + 1)
    expect(room.phase).toBe('ended')
    expect(room.winner).toBe('draw')
  })
})

describe('sandbox', () => {
  test('spawns you with a test kit next to two dummies', () => {
    const room = sandbox()
    const a = new TestClient(room, 'Ash')
    expect(a.p.alive).toBe(true)
    expect(a.p.team).toBe('red')
    expect(countItem(a.p.inventory, 'wool')).toBe(64)
    expect([...room.players.values()].filter((p) => p.home).length).toBe(2)
    expect(room.phase).toBe('playing')
  })

  test('commands work and an enemy bed comes back after a while', () => {
    const room = sandbox()
    const a = new TestClient(room, 'Ash')
    a.send({ t: 'chat', text: '/give obsidian 5' })
    expect(countItem(a.p.inventory, 'obsidian')).toBe(5)
    a.put(36.5, 20, 28.5)
    a.send({ t: 'dig', target: [36, 20, 30] })
    ticks(room, 10)
    expect(room.world.get(36, 20, 30)).toBe(AIR)
    ticks(room, 10 * TPS)
    expect(room.world.get(36, 20, 30)).toBe(BED.blue)
  })

  test('dummies take hits and come back', () => {
    const room = sandbox()
    const a = new TestClient(room, 'Ash')
    const dummy = [...room.players.values()].find((p) => p.name === 'Dummy')!
    ticks(room, 61)
    for (let i = 0; i < 12; i++) {
      // Knockback moves the dummy, so step up to it before each hit.
      a.put(dummy.x, dummy.y, dummy.z - 2, Math.PI, 0)
      a.send({ t: 'attack', target: dummy.id })
      ticks(room, 11)
    }
    expect(dummy.stats.deaths).toBeGreaterThan(0)
    ticks(room, TPS + 1)
    expect(dummy.alive).toBe(true)
  })
})

describe('lag compensation', () => {
  function apart() {
    const d = duel()
    ticks(d.room, SPAWN_PROTECTION_TICKS + 1)
    d.a.put(64.5, TOP, 16.5, 0, 0)
    d.b.put(64.5, TOP, 14.5, Math.PI, 0)
    ticks(d.room, 3)
    const seen = d.room.tickCount
    // The target steps away before the attack arrives.
    d.b.put(64.5, TOP, 10.5, Math.PI, 0)
    ticks(d.room, 2)
    return { ...d, seen }
  }

  test('a hit lands on where the target was when the attacker saw it', () => {
    const { a, b, seen } = apart()
    a.send({ t: 'attack', target: b.p.id, seen })
    expect(b.p.health).toBeLessThan(MAX_HEALTH)
  })

  test('without the claim, or with one too old to trust, the current position counts', () => {
    const now = apart()
    now.a.send({ t: 'attack', target: now.b.p.id })
    expect(now.b.p.health).toBe(MAX_HEALTH)
    const old = apart()
    ticks(old.room, 10)
    old.a.send({ t: 'attack', target: old.b.p.id, seen: old.seen })
    expect(old.b.p.health).toBe(MAX_HEALTH)
  })
})

describe('chat and round summary', () => {
  test('in a round chat goes to your team; ! shouts to everyone', () => {
    const { a, b } = duel()
    a.send({ t: 'chat', text: 'rush blue' })
    expect(a.events('chat')).toContain('[Team] Ash: rush blue')
    expect(b.events('chat')).not.toContain('[Team] Ash: rush blue')
    a.send({ t: 'chat', text: '!good luck' })
    expect(b.events('chat')).toContain('Ash: good luck')
  })

  test('the end of a round sends everyone the stats table', () => {
    const { room, a, b } = duel()
    room.teams.get('blue')!.bed = false
    room.die(b.p, 'melee', a.p)
    const summary = a.last('summary')!
    expect(summary.winner).toBe('red')
    expect(summary.players[0]).toMatchObject({ name: 'Ash', kills: 1, finals: 1 })
  })
})

describe('map vote', () => {
  test('the most-voted arena loads when the round starts, and everyone gets the new world', () => {
    const room = arena()
    const a = new TestClient(room, 'Ash')
    const b = new TestClient(room, 'Bea')
    expect(a.last('votes')).toMatchObject({ current: 'skyreach' })
    a.send({ t: 'vote', map: 'lanterns' })
    b.send({ t: 'vote', map: 'lanterns' })
    expect(b.last('votes')!.maps.find((m) => m.id === 'lanterns')!.votes).toBe(2)
    a.send({ t: 'team', team: 'red' })
    b.send({ t: 'team', team: 'blue' })
    ticks(room, 25)
    expect(room.phase).toBe('playing')
    expect(room.mapId).toBe('lanterns')
    expect(room.map.name).toBe('Lanterns')
    expect(a.last('world')!.map.name).toBe('Lanterns')
    const spawn = room.map.bases.find((x) => x.team === 'red')!.spawn
    expect([a.p.x, a.p.y, a.p.z]).toEqual(spawn.slice(0, 3))
    expect(room.world.isSolid(Math.floor(a.p.x), a.p.y - 1, Math.floor(a.p.z))).toBe(true)
  })

  test('unknown maps and votes outside the lobby are ignored', () => {
    const { room, a } = duel()
    a.send({ t: 'vote', map: 'lanterns' })
    a.send({ t: 'vote', map: 'nowhere' })
    expect(room.votesMessage()).toMatchObject({ maps: room.rules.maps.map(() => ({ votes: 0 })) })
  })
})
