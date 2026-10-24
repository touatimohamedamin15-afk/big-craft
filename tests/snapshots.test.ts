import { describe, expect, test } from 'bun:test'
import { installBots } from '../src/games/bedwars/bots'
import { Room } from '../src/games/bedwars/room'
import { arenaRules } from '../src/games/bedwars/rules'
import { bedwarsCodec, type ClientMessage, type DropView, type GameView, type PlayerView, type ServerMessage } from '../src/games/bedwars/protocol'
import { ByteReader, ByteWriter, fromWire, toWire } from '../src/engine/net/codec'

/** A client that rebuilds state from the delta stream the way the browser does, through the wire encoding. */
function mirror(room: Room, name: string) {
  const views = new Map<number, PlayerView>()
  let drops: DropView[] = []
  let game: GameView | null = null
  let bytes = 0
  const p = room.connect(name, (sent: ServerMessage) => {
    const wire = toWire(bedwarsCodec.encodeServer, sent)
    bytes += wire.length
    const m = fromWire(bedwarsCodec.decodeServer, wire)
    // Exactly what JSON delivered before (which also turns -0 into 0).
    expect(m).toEqual(JSON.parse(JSON.stringify(sent)))
    if (m.t !== 'tick') return
    for (const d of m.players) views.set(d.id, { ...views.get(d.id), ...d } as PlayerView)
    for (const id of m.gone ?? []) views.delete(id)
    if (m.drops) drops = m.drops
    if (m.game) game = m.game
  })
  return { p, views, drops: () => drops, game: () => game, bytes: () => bytes }
}

describe('delta snapshots', () => {
  test('a client rebuilt from deltas matches the room every tick, including one that joins late', () => {
    const room = new Room({ rules: arenaRules({ countdownTicks: 1 }), seed: 5 })
    installBots(room)
    const a = mirror(room, 'Ash')
    room.receive(a.p.id, { t: 'start' })
    let late: ReturnType<typeof mirror> | null = null
    for (let t = 0; t < 1200; t++) {
      if (t === 400) late = mirror(room, 'Late')
      room.tick()
      for (const m of late ? [a, late] : [a]) {
        const truth = [...room.players.values()].map((p) => room.playerView(p))
        expect([...m.views.values()].sort((x, y) => x.id - y.id)).toEqual(truth.sort((x, y) => x.id - y.id))
        expect(m.drops().length).toBe(room.drops.length)
      }
    }
    expect(late!.game()?.phase).toBe('playing')
  })

  test('ticks are binary and several times smaller than their JSON', () => {
    const room = new Room({ rules: arenaRules({ countdownTicks: 1 }), seed: 3 })
    installBots(room)
    let json = 0
    let binary = 0
    const p = room.connect('Ash', (m: ServerMessage) => {
      if (m.t !== 'tick') return
      const wire = toWire(bedwarsCodec.encodeServer, m)
      expect(wire).toBeInstanceOf(Uint8Array)
      binary += wire.length
      json += JSON.stringify(m).length
    })
    room.receive(p.id, { t: 'start' })
    for (let t = 0; t < 600; t++) room.tick()
    expect(binary * 3).toBeLessThan(json)
  })

  test('an idle room sends next to nothing', () => {
    const room = new Room({ rules: arenaRules({ bots: false }), seed: 1 })
    const a = mirror(room, 'Ash')
    for (let t = 0; t < 100; t++) room.tick()
    const before = a.bytes()
    for (let t = 0; t < 200; t++) room.tick()
    // Ten seconds of a quiet lobby: an empty delta per tick and a game view once a second.
    expect((a.bytes() - before) / 10).toBeLessThan(1000)
  })
})

describe('wire encoding', () => {
  const input: ClientMessage = { t: 'input', x: 12.345678901, y: -3.25, z: 0.1 + 0.2, vx: 0.5, vy: -0.08, vz: 0, yaw: 3.5, pitch: -1.25, sneak: true, sprint: false, shield: true, tp: 300, seq: 70000 }

  test('input is binary, keeps positions exact, and round-trips', () => {
    const wire = toWire(bedwarsCodec.encodeClient, input)
    expect(wire).toBeInstanceOf(Uint8Array)
    expect(wire.length).toBeLessThan(JSON.stringify(input).length / 3)
    // Positions are float64 (the server collides exactly the box the client predicted); velocity and look are float32.
    const f = Math.fround
    expect(bedwarsCodec.decodeClient(wire as Uint8Array)).toEqual({ ...input, vx: f(0.5), vy: f(-0.08), vz: 0, yaw: f(3.5), pitch: f(-1.25) } as ClientMessage)
  })

  test('rare messages stay JSON', () => {
    expect(toWire(bedwarsCodec.encodeClient, { t: 'chat', text: 'hi' })).toBe('{"t":"chat","text":"hi"}')
    expect(typeof toWire(bedwarsCodec.encodeServer, { t: 'event', kind: 'chat', text: 'hi' })).toBe('string')
  })

  test('malformed bytes throw instead of decoding to garbage', () => {
    const wire = toWire(bedwarsCodec.encodeClient, input) as Uint8Array
    expect(() => bedwarsCodec.decodeClient(wire.subarray(0, wire.length - 1))).toThrow()
    expect(() => bedwarsCodec.decodeClient(new Uint8Array([...wire, 0]))).toThrow()
    expect(() => bedwarsCodec.decodeClient(new Uint8Array([9]))).toThrow()
    expect(() => bedwarsCodec.decodeClient(new Uint8Array(0))).toThrow()
  })

  test('varints and strings round-trip at their edges', () => {
    const ints = [0, 1, -1, 63, -64, 64, 127, 128, 2 ** 31, -(2 ** 31), 2 ** 52 - 1, -(2 ** 52)]
    const w = new ByteWriter()
    for (const v of ints) w.int(v)
    w.uint(2 ** 53 - 1).string('héllo ✓').stringOrNull(null).stringOrNull('')
    const r = new ByteReader(w.finish())
    expect(ints.map(() => r.int())).toEqual(ints)
    expect([r.uint(), r.string(), r.stringOrNull(), r.stringOrNull()]).toEqual([2 ** 53 - 1, 'héllo ✓', null, ''])
    expect(r.done).toBe(true)
  })
})
