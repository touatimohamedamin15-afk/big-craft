import { describe, expect, test } from 'bun:test'
import { createBedwarsRoom, roomParams, bedwarsRooms } from '../src/games/bedwars/server'
import { bestRoom, cleanRoomName, openSeats, randomRoomName, type RoomInfo } from '../src/games/bedwars/client/rooms'
import { createServer } from 'node:http'
import WebSocket from 'ws'
import { createGameHost } from '../src/engine/net/host'
import { TestClient, ticks } from './room-helpers'

const params = (q: string) => new URLSearchParams(q)

describe('the room list', () => {
  test('a public room describes itself; an invite-only one stays off the list', () => {
    const open = createBedwarsRoom(roomParams(params('room=oak-fox-12')))
    new TestClient(open, 'Ash')
    expect(open.summary()).toMatchObject({ room: 'oak-fox-12', world: 'arena', phase: 'waiting', players: 1, bots: 0, capacity: 4 })
    const hidden = createBedwarsRoom(roomParams(params('room=secret&private=1')))
    expect(hidden.summary()).toBeNull()
  })

  test('sandbox training dummies are not counted as bots', () => {
    const sandbox = createBedwarsRoom(roomParams(params('room=practice&world=sandbox')))
    new TestClient(sandbox, 'Ash')
    expect([...sandbox.players.values()].some((p) => p.brain)).toBe(true)
    expect(sandbox.summary()).toMatchObject({ world: 'sandbox', players: 1, bots: 0 })
  })

  test('an invite-only room never shares a key with the public room of the same name', () => {
    expect(bedwarsRooms.key(params('room=x&private=1'))).not.toBe(bedwarsRooms.key(params('room=x')))
  })

  test('Quick play picks the fullest lobby with room, then a round with a bot seat', () => {
    const room = (r: Partial<RoomInfo>): RoomInfo => ({ room: 'r', world: 'arena', fast: false, phase: 'waiting', map: 'Skyreach', players: 0, bots: 0, capacity: 4, connections: 0, ...r })
    const full = room({ room: 'full', players: 4 })
    const busy = room({ room: 'busy', players: 2 })
    const quiet = room({ room: 'quiet', players: 1 })
    const midRound = room({ room: 'mid', phase: 'playing', players: 3, bots: 1 })
    expect(bestRoom([full, quiet, busy, midRound])?.room).toBe('busy')
    expect(bestRoom([full, midRound])?.room).toBe('mid')
    expect(bestRoom([full, room({ phase: 'playing', players: 4 })])).toBeNull()
    expect(openSeats(midRound)).toBe(1)
  })

  test('room names are short, readable and what the server would keep', () => {
    const name = randomRoomName(() => 0.5)
    expect(name).toMatch(/^[a-z]+-[a-z]+-\d\d$/)
    expect(cleanRoomName(name)).toBe(name)
    expect(cleanRoomName('My Room!')).toBe('MyRoom')
  })
})

describe('the host', () => {
  test('lists a room while someone is in it, and drops it as soon as they leave', async () => {
    const host = createGameHost(bedwarsRooms)
    const server = createServer()
    server.on('upgrade', (req, socket, head) => host.handleUpgrade(req, socket, head))
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
    const port = (server.address() as { port: number }).port
    const ws = new WebSocket(`ws://127.0.0.1:${port}/game?room=listed&name=Ash`)
    await new Promise((ok) => ws.once('message', ok))
    expect(host.list().map((l) => l.summary.room)).toEqual(['listed'])
    expect(host.online()).toBe(1)
    ws.close()
    await new Promise((ok) => setTimeout(ok, 100))
    expect(host.list()).toEqual([])
    expect(host.online()).toBe(0)
    host.close()
    server.close()
  })
})

describe('joining a round in progress', () => {
  test("a late joiner takes a bot's seat: its team, place and items", () => {
    const room = createBedwarsRoom(roomParams(params('room=late')))
    const a = new TestClient(room, 'Ash')
    a.send({ t: 'start' })
    ticks(room, 30 * 20)
    expect(room.phase).toBe('playing')
    const bots = [...room.players.values()].filter((p) => p.brain)
    expect(bots.length).toBe(3)
    const b = new TestClient(room, 'Bea')
    expect(b.p.team).not.toBeNull()
    expect(b.p.eliminated).toBe(false)
    expect([...room.players.values()].filter((p) => p.brain).length).toBe(2)
    expect(b.events('system').some((t) => t.includes("took") && t.includes('place'))).toBe(true)
    expect(room.summary()).toMatchObject({ players: 2, bots: 2 })
  })

  test('with no bot left to replace, a late joiner watches', () => {
    const room = createBedwarsRoom(roomParams(params('room=full')))
    room.botsEnabled = false
    const a = new TestClient(room, 'Ash')
    const b = new TestClient(room, 'Bea')
    a.send({ t: 'start' })
    ticks(room, 30 * 20)
    expect(room.phase).toBe('playing')
    const c = new TestClient(room, 'Cal')
    expect(c.p.eliminated).toBe(true)
    void b
  })
})
