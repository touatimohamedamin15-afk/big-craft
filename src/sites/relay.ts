import type { Connection } from '../engine/net/client'
import { bedwarsCodec, type ClientMessage, type ServerMessage } from '../games/bedwars/protocol'
import { createBedwarsRoom, type RoomParams } from '../games/bedwars/server'
import type { Room } from '../games/bedwars/room'
import { decode, encode, FRAME_BYTES, Inbox, MAX_PLAYERS, Outbox, RECONNECT_MS } from './wire'

export type Member = { connectionId: string; userId: string; data: unknown }
type Identity = { session: string; generation: string; revision: number; name: string; host: boolean }
export type RelayMessage =
  | { type: 'ready'; connectionId: string; userId: string }
  | { type: 'presence'; members: Member[] }
  | { type: 'broadcast'; connectionId: string | null; userId: string | null; event: string; data: unknown }
export type Realtime = { broadcast(event: string, data: unknown): boolean; presence(data: unknown): boolean; close(): void }
type Peer = { member: Member; identity: Identity; id: number; incoming: Inbox; outgoing: Outbox; missing?: number }
type Fragment = [target: string, generation: string, offset: number, data: string]
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9-]{36}$/.test(v)
function identity(member: Member): Identity | null {
  const d = member.data as Partial<Identity> | null
  return d && uuid(d.session) && uuid(d.generation) && Number.isSafeInteger(d.revision) && d.revision! > 0 && typeof d.host === 'boolean' && typeof d.name === 'string' && d.name.length <= 16 ? d as Identity : null
}
const key = (member: Member, data: Identity) => JSON.stringify([member.userId, data.session])

/** One explicit host, four friends, ephemeral matches. All peer messages are untrusted.
 * The trusted relay supplies sender IDs; clients cannot send actions as another player.
 * A host is still trusted with the simulation: this is not competitive anti-cheat.
 */
export class RelayGame implements Connection<ClientMessage, ServerMessage> {
  private session = crypto.randomUUID()
  private generation = ''
  private revision = 0
  private self = ''
  private connected = false
  private stopped = false
  private room?: Room
  private localId?: number
  private peers = new Map<string, Peer>()
  private host?: { key: string; member: Member; generation: string }
  private missingSince?: number
  private lastHostFrame = 0
  private incoming = new Inbox()
  private outgoing = new Outbox()
  private handler: (m: ServerMessage) => void = () => {}
  private closed: (reason: string) => void = () => {}
  private announced = false
  private readyForInput = false

  constructor(
    readonly options: RoomParams & { name: string; hosting: boolean },
    private realtime: Realtime,
    private now: () => number = Date.now,
  ) { this.missingSince = now() }

  onMessage(handler: (m: ServerMessage) => void) { this.handler = handler }
  onClose(handler: (reason: string) => void) { this.closed = handler }
  close() { this.stopped = true; this.connected = false; this.peers.clear(); this.room = undefined; this.realtime.close() }
  fail(reason: string) { if (this.stopped) return; this.close(); this.closed(reason) }
  status(status: string) {
    if (status === 'unauthorized') this.fail('Sign in with Freebuff to play online, then rejoin the room.')
    if (status === 'disconnected' || status === 'connecting') {
      this.connected = false
      this.missingSince ??= this.now()
    }
  }
  receive(message: RelayMessage) {
    if (this.stopped) return
    try { this.accept(message) } catch (error) { this.fail(error instanceof Error ? error.message : 'Invalid game traffic.') }
  }
  private accept(message: RelayMessage) {
    if (message.type === 'ready') {
      this.self = message.connectionId
      this.generation = crypto.randomUUID()
      this.revision++
      this.connected = true
      this.announced = false
      this.readyForInput = false
      this.incoming = new Inbox()
      this.outgoing = new Outbox()
      // A host keeps its room across the relay's five-minute ticket renewal.
      this.host = this.host && { ...this.host, generation: '' }
      this.lastHostFrame = this.now()
      return
    }
    if (!this.connected) return
    if (message.type === 'presence') {
      // A renewed socket may appear before the old TCP connection finishes
      // closing. Count that browser once and fence its older generation.
      const latest = new Map<string, { member: Member; data: Identity }>()
      for (const member of message.members) {
        const data = identity(member)
        if (data && (latest.get(key(member, data))?.data.revision ?? 0) < data.revision)
          latest.set(key(member, data), { member, data })
      }
      const members = [...latest.values()]
      const hosts = members.filter(({ data }) => data.host)
      if (hosts.length > 1) return this.fail('Two players are hosting this room. Create a new room with a different code.')
      if (this.options.hosting) {
        if (!members.some(({ member }) => member.connectionId === this.self)) return
        this.missingSince = undefined
        if (!this.room) {
          this.room = createBedwarsRoom(this.options)
          this.localId = this.room.connect(this.options.name, (m) => {
            if (m.t === 'welcome') this.localId = m.id
            this.handler(m)
          }).id
        }
        const present = new Set<string>()
        for (const { member, data } of members) {
          if (member.connectionId === this.self) continue
          const peerKey = key(member, data)
          present.add(peerKey)
          let peer = this.peers.get(peerKey)
          if (!peer) {
            if (this.peers.size >= MAX_PLAYERS - 1) continue
            peer = { member, identity: data, id: 0, incoming: new Inbox(), outgoing: new Outbox() }
            this.peers.set(peerKey, peer)
            const target = peer
            target.id = this.room.connect(data.name, (m) => target.outgoing.push(encode(bedwarsCodec, 'server', m))).id
          } else if (peer.member.connectionId !== member.connectionId || peer.identity.generation !== data.generation || peer.missing !== undefined) {
            peer.member = member
            peer.identity = data
            peer.incoming = new Inbox()
            peer.outgoing = new Outbox()
            this.room.resync(peer.id)
          }
          peer.missing = undefined
        }
        for (const [peerKey, peer] of this.peers) if (!present.has(peerKey)) peer.missing ??= this.now()
      } else {
        const selected = hosts[0]
        if (!selected) { this.missingSince ??= this.now(); return }
        const hostKey = key(selected.member, selected.data)
        if (this.host && this.host.key !== hostKey) return this.fail('The host left. Start a new match to play again.')
        if (this.host?.member.connectionId !== selected.member.connectionId || this.host.generation !== selected.data.generation) {
          this.incoming = new Inbox()
          this.outgoing = new Outbox()
          this.readyForInput = false
          // Ask for a fresh stream after the host renews, even if our socket survived.
          if (this.host) { this.generation = crypto.randomUUID(); this.revision++; this.announced = false }
        }
        this.host = { key: hostKey, member: selected.member, generation: selected.data.generation }
        this.missingSince = undefined
      }
      return
    }
    if (message.type !== 'broadcast' || message.event !== 'game' || !message.connectionId || !Array.isArray(message.data) || message.data.length > 64) return
    const peer = [...this.peers.values()].find((p) => p.member.connectionId === message.connectionId && p.member.userId === message.userId)
    if (this.options.hosting ? !peer : message.connectionId !== this.host?.member.connectionId || message.userId !== this.host?.member.userId) return
    for (const fragment of message.data) {
      if (!Array.isArray(fragment) || fragment.length !== 4) continue
      const [target, generation, offset, data] = fragment as Fragment
      if (target !== this.self || generation !== this.generation) continue
      const lines = (peer?.incoming ?? this.incoming).read(offset, data)
      for (const line of lines) {
        if (peer) this.room!.receive(peer.id, decode(bedwarsCodec, 'client', line) as ClientMessage)
        else {
          const msg = decode(bedwarsCodec, 'server', line) as ServerMessage
          if (msg.t === 'welcome') this.readyForInput = true
          this.handler(msg)
        }
      }
      if (!peer) this.lastHostFrame = this.now()
    }
  }
  send(message: ClientMessage) {
    if (this.stopped || !this.connected) return
    try {
      if (this.room && this.localId !== undefined) this.room.receive(this.localId, message)
      else if (this.readyForInput) this.outgoing.push(encode(bedwarsCodec, 'client', message))
    } catch (error) { this.fail((error as Error).message) }
  }
  /** Called at 20 Hz; the adapter bounds catch-up after a sleeping/background tab. */
  tick() {
    if (this.stopped) return
    try {
      if ((this.missingSince !== undefined && this.now() - this.missingSince > RECONNECT_MS) ||
          (!this.options.hosting && this.host && this.now() - this.lastHostFrame > RECONNECT_MS))
        return this.fail('The host or realtime connection is unavailable, or the room is full. Rejoin or create a new room. The host must keep the game open and visible.')
      if (!this.connected) return
      for (const [peerKey, peer] of this.peers) {
        if (peer.missing !== undefined && this.now() - peer.missing > RECONNECT_MS) {
          this.room!.disconnect(peer.id)
          this.peers.delete(peerKey)
        }
      }
      this.room?.tick()
    } catch (error) { this.fail((error as Error).message) }
  }
  /** At most one 12 KiB broadcast per 100 ms, with bounded, lossless queues. */
  flush() {
    if (!this.connected || this.stopped) return
    if (!this.announced) {
      this.announced = this.realtime.presence({ session: this.session, generation: this.generation, revision: this.revision, name: this.options.name.slice(0, 16), host: this.options.hosting })
      return
    }
    const targets = this.options.hosting
      ? [...this.peers.values()].filter((p) => p.missing === undefined).map((p) => ({ id: p.member.connectionId, generation: p.identity.generation, out: p.outgoing }))
      : this.host ? [{ id: this.host.member.connectionId, generation: this.host.generation, out: this.outgoing }] : []
    const size = Math.floor((FRAME_BYTES - 1024) / Math.max(1, targets.length))
    const pieces = targets.map((target) => ({ target, part: target.out.peek(size) })).filter(({ part }) => part[1].length)
    if (!pieces.length) return
    const frame: Fragment[] = pieces.map(({ target, part }) => [target.id, target.generation, ...part])
    if (this.realtime.broadcast('game', frame)) for (const { target, part } of pieces) target.out.consume(part[1].length)
  }
}
