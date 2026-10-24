import { IDLE_INPUT } from '../src/engine/physics'
import { Room, type Player } from '../src/games/bedwars/room'
import { arenaRules, sandboxRules, type GameRules } from '../src/games/bedwars/rules'
import type { ClientMessage, EventKind, ServerMessage } from '../src/games/bedwars/protocol'

export class TestClient {
  msgs: ServerMessage[] = []
  tp = 0
  p: Player
  constructor(
    readonly room: Room,
    name: string,
  ) {
    this.p = room.connect(name, (m) => {
      this.msgs.push(m)
      if (m.t === 'teleport' || m.t === 'welcome') this.tp = m.tp
    })
  }
  send(msg: ClientMessage) {
    this.room.receive(this.p.id, msg)
  }
  /** Reports a position as the client would after moving. */
  move(x: number, y: number, z: number, extra: Partial<Extract<ClientMessage, { t: 'input' }>> = {}) {
    this.send({ t: 'input', x, y, z, vx: 0, vy: 0, vz: 0, yaw: this.p.yaw, pitch: this.p.pitch, sneak: false, sprint: false, shield: false, tp: this.tp, ...extra })
  }
  /** Teleports server-side, as test setup. */
  put(x: number, y: number, z: number, yaw = 0, pitch = 0) {
    this.room.teleport(this.p, x, y, z, yaw, pitch)
  }
  events(kind?: EventKind) {
    return this.msgs.flatMap((m) => (m.t === 'event' && (!kind || m.kind === kind) ? [m.text] : []))
  }
  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i] as Extract<ServerMessage, { t: T }>
    return undefined
  }
}

export function ticks(room: Room, n: number) {
  for (let i = 0; i < n; i++) room.tick()
}

export function idleBots(room: Room) {
  room.createBot = () => ({ think: (_r, p) => ({ ...IDLE_INPUT, yaw: p.yaw }) })
}

export function arena(overrides: Partial<GameRules> = {}) {
  const room = new Room({ rules: arenaRules({ bots: false, countdownTicks: 20, ...overrides }) })
  idleBots(room)
  return room
}

export function sandbox() {
  return new Room({ rules: sandboxRules() })
}

/** Two humans on red and blue in a started arena round. */
export function duel(overrides: Partial<GameRules> = {}) {
  const room = arena(overrides)
  const a = new TestClient(room, 'Ash')
  const b = new TestClient(room, 'Bea')
  a.send({ t: 'team', team: 'red' })
  b.send({ t: 'team', team: 'blue' })
  ticks(room, 25)
  return { room, a, b }
}
