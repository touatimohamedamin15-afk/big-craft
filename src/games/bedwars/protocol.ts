import type { TeamId } from './blocks'
import type { BotLevel, GameRules } from './rules'
import type { TeamUpgrades, UpgradeId } from './shop'
import type { Slot } from '../../engine/inventory'
import type { ArmorTier, Effect } from './items'
import type { MapMeta } from './maps/types'
import { ByteReader, ByteWriter, type Bytes, type MessageCodec } from '../../engine/net/codec'

export type ClientMessage =
  | { t: 'hello'; name: string }
  | {
      t: 'input'
      x: number
      y: number
      z: number
      vx: number
      vy: number
      vz: number
      yaw: number
      pitch: number
      sneak: boolean
      sprint: boolean
      shield: boolean
      /** The last teleport the client applied; older inputs are dropped. */
      tp: number
      /** The client's tick count. A gap means inputs the server never applied, so this one covers that many ticks of movement. */
      seq?: number
    }
  | { t: 'select'; slot: number }
  /** Throws one of the held item, or the whole stack with `all`. */
  | { t: 'drop'; all?: boolean }
  /** Start digging `target` (null stops). `done` says the client's own timer finished and it shows the block broken. */
  | { t: 'dig'; target: [number, number, number] | null; done?: boolean }
  | { t: 'place'; x: number; y: number; z: number; face: [number, number, number]; slot: number }
  /** `seen` is the server tick the attacker was looking at; the server rewinds the target to it (clamped). */
  | { t: 'attack'; target: number; seen?: number }
  | { t: 'use' }
  | { t: 'buy'; offer: string }
  | { t: 'upgrade'; id: UpgradeId }
  | { t: 'swap'; a: number; b: number }
  | { t: 'team'; team: TeamId }
  | { t: 'start' }
  /** Host only, before a round: bots on or off, and optionally their level. */
  | { t: 'settings'; bots: boolean; botLevel?: BotLevel }
  | { t: 'chat'; text: string }
  | { t: 'vote'; map: string }
  /** Start drawing the held bow; `release` fires (the server times the draw). */
  | { t: 'draw' }
  | { t: 'release' }
  /** Throw the held fireball, pearl or bridge egg. */
  | { t: 'throw' }
  /** Your cosmetics, as a look code (look.ts); the server validates it. */
  | { t: 'look'; look: string }

export interface PlayerView {
  id: number
  name: string
  team: TeamId | null
  bot: boolean
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  sneak: boolean
  health: number
  armor: ArmorTier
  held: string | null
  alive: boolean
  shield: boolean
  /** Tick of the last hit taken (for the red flash). */
  hurtAt: number
  /** Tick of the last swing. */
  swingAt: number
  dig: [number, number, number, number] | null
  /** Under an invisibility potion: enemies do not draw this player. */
  invisible: boolean
  /** Skin, cape, trail and kill effect, as a look code (look.ts). */
  look: string
}

export type PlayerDelta = Partial<PlayerView> & { id: number }

export interface DropView {
  id: number
  item: string
  count: number
  x: number
  y: number
  z: number
}

export type Phase = 'waiting' | 'countdown' | 'playing' | 'ended'

export interface TeamView {
  team: TeamId
  bed: boolean
  players: number
  alive: number
  eliminated: boolean
}

export interface GameView {
  phase: Phase
  mode: GameRules['mode']
  /** Ticks since the round started, or until the countdown ends, as of `clockTick`; clients extrapolate. */
  clock: number
  clockTick: number
  next: { label: string; in: number } | null
  teams: TeamView[]
  host: number | null
  bots: boolean
  winner: TeamId | 'draw' | null
}

export interface SelfView {
  inventory: (Slot | null)[]
  selected: number
  health: number
  armor: ArmorTier
  team: TeamId | null
  alive: boolean
  /**
   * Ticks until respawn, or null when not waiting to respawn. This and
   * `protectedTicks` are rounded up to whole seconds, so counting down resends
   * the self view once a second rather than every tick.
   */
  respawnIn: number | null
  eliminated: boolean
  protectedTicks: number
  upgrades: TeamUpgrades
  pickaxeTier: number
  axeTier: number
  stats: { kills: number; finals: number; beds: number; deaths: number }
  /** The tick each potion effect ends on (0 when none), so the view does not change every tick. */
  effects: Record<Effect, number>
}

export interface ProjectileView {
  id: number
  kind: string
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** Ticks left on a lit TNT's fuse. */
  fuse?: number
}

export interface RoundStats {
  id: number
  name: string
  team: TeamId
  bot: boolean
  kills: number
  finals: number
  beds: number
  deaths: number
}

export type EventKind = 'chat' | 'kill' | 'bed' | 'system' | 'title' | 'error'

export type ServerMessage =
  | { t: 'welcome'; id: number; world: string; map: MapMeta; tp: number }
  | { t: 'world'; world: string; map: MapMeta }
  /**
   * Sent every tick as a delta against the previous one: only players with
   * changed fields (plus `id`), ids that left, and drops or game state only
   * when they changed. A joining client first gets the last state in full.
   */
  | { t: 'tick'; tick: number; players: PlayerDelta[]; gone?: number[]; drops?: DropView[]; game?: GameView }
  | { t: 'self'; self: SelfView }
  /** Each change is [x, y, z, raw cell]: block id, plus 0x80 when a player placed it. */
  | { t: 'blocks'; changes: [number, number, number, number][] }
  | { t: 'velocity'; vx: number; vy: number; vz: number }
  | { t: 'teleport'; x: number; y: number; z: number; yaw: number; pitch: number; tp: number }
  | { t: 'event'; kind: EventKind; text: string; sub?: string; team?: TeamId }
  /** Everything in flight (arrows, fireballs, pearls, eggs, lit TNT); sent while any exist. */
  | { t: 'projectiles'; list: ProjectileView[] }
  | { t: 'explosion'; x: number; y: number; z: number; power: number }
  /** Diamond and emerald generators, once a second: [index in map.generators, ticks to next drop, tier 1..3]. */
  | { t: 'gens'; list: [number, number, number][] }
  /** A cosmetic kill effect where someone fell. */
  | { t: 'effect'; effect: number; x: number; y: number; z: number }
  /** Lobby map vote: every layout with its votes, and the one loaded now. */
  | { t: 'votes'; maps: { id: string; name: string; votes: number }[]; current: string }
  /** End of a round: the winner and everyone's stats, for the end screen. */
  | { t: 'summary'; winner: TeamId | 'draw'; players: RoundStats[]; lobbyIn: number }
  /** Lobby settings beyond the game view: the bot level. Sent on connect and when it changes. */
  | { t: 'lobby'; botLevel: BotLevel }

// Wire format ------------------------------------------------------------
//
// `tick` (20 a second to every player) and `input` (20 a second from every
// player) are binary; everything else is JSON. Numbers the room already rounds
// (positions to 0.01, drops to 0.001, dig progress to 0.05) travel as scaled
// zigzag varints and decode to exactly the value the room sent.

const TICK = 1
const INPUT = 1
const PHASES: Phase[] = ['waiting', 'countdown', 'playing', 'ended']

type Field = [keyof PlayerView, (w: ByteWriter, v: unknown) => void, (r: ByteReader) => unknown]

function field<K extends Exclude<keyof PlayerView, 'id'>>(key: K, write: (w: ByteWriter, v: PlayerView[K]) => void, read: (r: ByteReader) => PlayerView[K]): Field {
  return [key, write as Field[1], read]
}

const hundredths: [(w: ByteWriter, v: number) => void, (r: ByteReader) => number] = [(w, v) => w.int(Math.round(v * 100)), (r) => r.int() / 100]
const int: [(w: ByteWriter, v: number) => void, (r: ByteReader) => number] = [(w, v) => w.int(v), (r) => r.int()]
const bool: [(w: ByteWriter, v: boolean) => void, (r: ByteReader) => boolean] = [(w, v) => w.bool(v), (r) => r.bool()]

/** Player fields in delta-mask bit order, most often changed first so a moving player's mask is one byte. */
const PLAYER_FIELDS: Field[] = [
  field('x', ...hundredths),
  field('y', ...hundredths),
  field('z', ...hundredths),
  field('yaw', ...hundredths),
  field('pitch', ...hundredths),
  field('sneak', ...bool),
  field(
    'dig',
    (w, v) => {
      if (!v) return void w.uint(0)
      w.uint(Math.round(v[3] * 20) + 1).int(v[0]).int(v[1]).int(v[2])
    },
    (r) => {
      const progress = r.uint()
      return progress === 0 ? null : [r.int(), r.int(), r.int(), (progress - 1) / 20]
    },
  ),
  field('swingAt', ...int),
  field('hurtAt', ...int),
  field('health', ...int),
  field('held', (w, v) => w.stringOrNull(v), (r) => r.stringOrNull()),
  field('alive', ...bool),
  field('shield', ...bool),
  field('armor', (w, v) => w.string(v), (r) => r.string() as ArmorTier),
  field('team', (w, v) => w.stringOrNull(v), (r) => r.stringOrNull() as TeamId | null),
  field('name', (w, v) => w.string(v), (r) => r.string()),
  field('bot', ...bool),
  field('invisible', ...bool),
  field('look', (w, v) => w.string(v), (r) => r.string()),
]

function writeGame(w: ByteWriter, g: GameView) {
  w.u8(PHASES.indexOf(g.phase)).string(g.mode).int(g.clock).uint(g.clockTick)
  w.stringOrNull(g.next?.label ?? null)
  if (g.next) w.int(g.next.in)
  w.uint(g.teams.length)
  for (const t of g.teams) w.string(t.team).bool(t.bed).uint(t.players).uint(t.alive).bool(t.eliminated)
  w.uint(g.host === null ? 0 : g.host + 1)
  w.bool(g.bots).stringOrNull(g.winner)
}

function readGame(r: ByteReader): GameView {
  const phase = PHASES[r.u8()]
  const mode = r.string() as GameView['mode']
  const clock = r.int()
  const clockTick = r.uint()
  const label = r.stringOrNull()
  const next = label === null ? null : { label, in: r.int() }
  const teams: TeamView[] = Array.from({ length: r.uint() }, () => ({ team: r.string() as TeamId, bed: r.bool(), players: r.uint(), alive: r.uint(), eliminated: r.bool() }))
  const host = r.uint()
  return { phase, mode, clock, clockTick, next, teams, host: host === 0 ? null : host - 1, bots: r.bool(), winner: r.stringOrNull() as GameView['winner'] }
}

function encodeTick(m: Extract<ServerMessage, { t: 'tick' }>): Bytes {
  const w = new ByteWriter().u8(TICK).uint(m.tick).uint(m.players.length)
  for (const p of m.players) {
    let mask = 0
    PLAYER_FIELDS.forEach(([k], bit) => {
      if (p[k] !== undefined) mask += 2 ** bit
    })
    w.uint(p.id).uint(mask)
    for (const [k, write] of PLAYER_FIELDS) if (p[k] !== undefined) write(w, p[k])
  }
  w.uint(m.gone?.length ?? 0)
  for (const id of m.gone ?? []) w.uint(id)
  w.u8((m.drops ? 1 : 0) | (m.game ? 2 : 0))
  if (m.drops) {
    w.uint(m.drops.length)
    for (const d of m.drops) w.uint(d.id).string(d.item).uint(d.count).int(Math.round(d.x * 1000)).int(Math.round(d.y * 1000)).int(Math.round(d.z * 1000))
  }
  if (m.game) writeGame(w, m.game)
  return w.finish()
}

function decodeTick(r: ByteReader): Extract<ServerMessage, { t: 'tick' }> {
  const tick = r.uint()
  const players = Array.from({ length: r.uint() }, () => {
    const p: Record<string, unknown> = { id: r.uint() }
    const mask = r.uint()
    PLAYER_FIELDS.forEach(([k, , read], bit) => {
      if (Math.floor(mask / 2 ** bit) % 2) p[k] = read(r)
    })
    return p as PlayerDelta
  })
  const msg: Extract<ServerMessage, { t: 'tick' }> = { t: 'tick', tick, players }
  const gone = Array.from({ length: r.uint() }, () => r.uint())
  if (gone.length) msg.gone = gone
  const flags = r.u8()
  if (flags & 1) msg.drops = Array.from({ length: r.uint() }, () => ({ id: r.uint(), item: r.string(), count: r.uint(), x: r.int() / 1000, y: r.int() / 1000, z: r.int() / 1000 }))
  if (flags & 2) msg.game = readGame(r)
  return msg
}

type InputMessage = Extract<ClientMessage, { t: 'input' }>

function encodeInput(m: InputMessage): Bytes {
  // Positions stay full precision: the server collides the box the client predicted.
  return new ByteWriter()
    .u8(INPUT)
    .f64(m.x)
    .f64(m.y)
    .f64(m.z)
    .f32(m.vx)
    .f32(m.vy)
    .f32(m.vz)
    .f32(m.yaw)
    .f32(m.pitch)
    .u8((m.sneak ? 1 : 0) | (m.sprint ? 2 : 0) | (m.shield ? 4 : 0))
    .uint(m.tp)
    .uint(m.seq ?? 0)
    .finish()
}

function decodeInput(r: ByteReader): InputMessage {
  const [x, y, z] = [r.f64(), r.f64(), r.f64()]
  const [vx, vy, vz, yaw, pitch] = [r.f32(), r.f32(), r.f32(), r.f32(), r.f32()]
  const bits = r.u8()
  return { t: 'input', x, y, z, vx, vy, vz, yaw, pitch, sneak: (bits & 1) !== 0, sprint: (bits & 2) !== 0, shield: (bits & 4) !== 0, tp: r.uint(), seq: r.uint() }
}

function finished<T>(r: ByteReader, msg: T): T {
  if (!r.done) throw new RangeError('Trailing bytes')
  return msg
}

export const bedwarsCodec: MessageCodec<ClientMessage, ServerMessage> = {
  encodeServer: (m) => (m.t === 'tick' ? encodeTick(m) : null),
  decodeServer(bytes) {
    const r = new ByteReader(bytes)
    const tag = r.u8()
    if (tag !== TICK) throw new RangeError(`Unknown message ${tag}`)
    return finished(r, decodeTick(r))
  },
  encodeClient: (m) => (m.t === 'input' ? encodeInput(m) : null),
  decodeClient(bytes) {
    const r = new ByteReader(bytes)
    const tag = r.u8()
    if (tag !== INPUT) throw new RangeError(`Unknown message ${tag}`)
    return finished(r, decodeInput(r))
  },
}
