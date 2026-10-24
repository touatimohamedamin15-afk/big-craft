import { describe, expect, test } from 'bun:test'
import { RelayGame, type Member, type RelayMessage } from '../src/sites/relay'
import { FRAME_BYTES, Inbox, MAX_BUFFER, Outbox } from '../src/sites/wire'
import type { ServerMessage } from '../src/games/bedwars/protocol'

// In-memory delivery models the managed relay: trusted sender IDs, ordered room
// fanout, JSON serialization, presence snapshots and connection renewal.
function harness() {
  let now = 0
  const clients: { game: RelayGame; member: Member; messages: ServerMessage[]; errors: string[]; connected: boolean }[] = []
  const pending: (() => void)[] = []
  const retiring: Member[] = []
  let frames = 0, maxBytes = 0
  const presence = () => {
    const members = structuredClone([...retiring, ...clients.filter((c) => c.connected).map((c) => c.member)])
    for (const client of clients.filter((c) => c.connected)) pending.push(() => client.game.receive({ type: 'presence', members }))
  }
  const drain = () => { while (pending.length) pending.shift()!() }
  const add = (hosting = false) => {
    const member = { connectionId: crypto.randomUUID(), userId: crypto.randomUUID(), data: null } as Member
    const messages: ServerMessage[] = [], errors: string[] = []
    const client = { member, messages, errors, connected: true, game: null as unknown as RelayGame }
    client.game = new RelayGame({ name: hosting ? 'Host' : 'Guest', hosting, world: 'arena', room: 'test', fast: false }, {
      presence(data) { member.data = data; presence(); return true },
      broadcast(event, data) {
        const encoded = JSON.stringify({ type: 'broadcast', event, data, userId: member.userId, connectionId: member.connectionId })
        maxBytes = Math.max(maxBytes, new TextEncoder().encode(encoded).length)
        frames++
        for (const target of clients.filter((c) => c.connected)) pending.push(() => target.game.receive(JSON.parse(encoded) as RelayMessage))
        return true
      },
      close() { client.connected = false; presence() },
    }, () => now)
    client.game.onMessage((m) => messages.push(m))
    client.game.onClose((m) => errors.push(m))
    clients.push(client)
    client.game.receive({ type: 'ready', ...member })
    presence(); drain()
    return client
  }
  const step = (count = 1) => {
    for (let n = 0; n < count; n++) {
      now += 50
      for (const c of clients) c.game.tick()
      if (now % 100 === 0) for (const c of clients) c.game.flush()
      drain()
    }
  }
  const renew = (client: ReturnType<typeof add>, overlap = false) => {
    if (overlap) retiring.push(structuredClone(client.member))
    client.connected = false
    client.game.status('connecting')
    presence(); drain(); step(4)
    client.connected = true
    client.member.connectionId = crypto.randomUUID()
    client.member.data = null
    client.game.receive({ type: 'ready', ...client.member })
    presence(); drain()
  }
  return { add, step, renew, clients, stats: () => ({ frames, maxBytes }) }
}

describe('Sites game transport', () => {
  test('four players receive complete worlds and ordered gameplay within relay limits', () => {
    const h = harness(), host = h.add(true)
    h.step(4)
    const guests = [h.add(), h.add(), h.add()]
    h.step(140)
    for (const c of [host, ...guests]) {
      expect(c.errors).toEqual([])
      expect(c.messages.some((m) => m.t === 'welcome')).toBe(true)
      expect(c.messages.some((m) => m.t === 'self')).toBe(true)
    }
    guests[0].game.send({ t: 'chat', text: 'hello across realtime' })
    h.step(30)
    expect(host.messages.some((m) => m.t === 'event' && m.text.includes('hello across realtime'))).toBe(true)
    expect(guests[1].messages.some((m) => m.t === 'event' && m.text.includes('hello across realtime'))).toBe(true)
    expect(h.stats().maxBytes).toBeLessThan(FRAME_BYTES)
    expect(h.stats().frames).toBeLessThanOrEqual(4 * 10 * 9)
  })
  test('guest and host ticket renewal resync without changing the player seat', () => {
    const h = harness(), host = h.add(true)
    h.step(4)
    const guest = h.add()
    h.step(60)
    const first = guest.messages.find((m) => m.t === 'welcome')!
    for (const client of [guest, host]) {
      h.renew(client, true); h.step(80)
      expect(host.errors).toEqual([])
      expect(guest.errors).toEqual([])
      const welcomes = guest.messages.filter((m) => m.t === 'welcome')
      expect(welcomes.length).toBeGreaterThan(1)
      expect(welcomes.every((m) => m.id === (first as { id: number }).id)).toBe(true)
      guest.game.send({ t: 'chat', text: `!after renewal ${welcomes.length}` })
      h.step(20)
      expect(host.messages.some((m) => m.t === 'event' && m.text.includes(`after renewal ${welcomes.length}`))).toBe(true)
    }
  })
  test('host departure ends the match explicitly; another guest cannot take over', () => {
    const h = harness(), host = h.add(true)
    h.step(4)
    const guest = h.add(); h.step(60)
    host.game.close(); h.step(320)
    expect(guest.errors.join()).toContain('host')
  })
  test('conflicting hosts refuse a split match', () => {
    const h = harness(), a = h.add(true)
    h.step(4)
    const b = h.add(true); h.step(10)
    expect(a.errors.join() + b.errors.join()).toContain('Two players are hosting')
  })
  test('spoofed state from a guest is ignored', () => {
    const h = harness(), host = h.add(true)
    h.step(4)
    const a = h.add(), b = h.add(); h.step(100)
    const before = a.messages.length
    a.game.receive({ type: 'broadcast', event: 'game', connectionId: b.member.connectionId, userId: b.member.userId, data: [['forged']] })
    expect(a.messages.length).toBe(before)
    expect(host.errors).toEqual([])
  })
  test('stream gaps and unbounded buffers fail explicitly', () => {
    expect(() => new Inbox().read(1, 'packet')).toThrow('interrupted')
    expect(() => new Outbox().push('x'.repeat(MAX_BUFFER + 1))).toThrow('budget')
    const inbox = new Inbox()
    expect(inbox.read(0, 'first\nsec')).toEqual(['first'])
    expect(inbox.read(9, 'ond\n')).toEqual(['second'])
  })
})
