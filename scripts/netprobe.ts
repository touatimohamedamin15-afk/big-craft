/**
 * Plays against a running server the way the browser client does (same
 * physics, one input per tick, predicted placements) and reports what the
 * server corrected: placements it reverted, teleports, errors, and how long a
 * placed block took to come back confirmed. A second client watches the first
 * to measure how smoothly others see it move.
 *
 *   bun scripts/netprobe.ts                       # against bun run dev on :5173
 *   bun scripts/netprobe.ts https://buffcraft.freebuff.app
 *   LAG=150 JITTER=80 bun scripts/netprobe.ts       # add one-way delay (ms) each way, in order
 */
import WebSocket from 'ws'
import { fromWire, toWire } from '../src/engine/net/codec'
import { IDLE_INPUT, stepMovement, type MoveInput, type Mover } from '../src/engine/physics'
import { AIR } from '../src/engine/blocks'
import { fromBase64, World } from '../src/engine/world'
import { bedwarsCodec, type ClientMessage, type ServerMessage } from '../src/games/bedwars/protocol'
import '../src/games/bedwars/blocks'
import { TOP } from '../src/games/bedwars/maps/sandbox'

const base = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '')
const wsBase = base.replace(/^http/, 'ws')
const room = `probe${Math.floor(Math.random() * 1e6)}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const LAG = Number(process.env.LAG ?? 0)
const JITTER = Number(process.env.JITTER ?? 0)

/** Delays calls by LAG plus up to JITTER ms each, never reordering them (like a slow TCP link). */
function delayed<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
  if (!LAG && !JITTER) return fn
  let last = 0
  return (...args) => {
    const at = Math.max(last, performance.now() + LAG + Math.random() * JITTER)
    last = at
    setTimeout(() => fn(...args), at - performance.now())
  }
}

interface Client {
  ws: WebSocket
  id: number
  tp: number
  world: World | null
  self: Extract<ServerMessage, { t: 'self' }>['self'] | null
  seen: Map<number, { x: number; y: number; z: number; at: number }[]>
  log: { at: number; m: ServerMessage }[]
  send(m: ClientMessage): void
  /** Runs after each (delayed) server message is recorded. */
  on(listener: (data: Buffer, isBinary: boolean) => void): void
}

function join(name: string): Promise<Client> {
  const ws = new WebSocket(`${wsBase}/game?world=sandbox&room=${room}&name=${name}`)
  ws.binaryType = 'nodebuffer'
  const listeners: ((data: Buffer, isBinary: boolean) => void)[] = []
  const c: Client = {
    ws, id: 0, tp: 0, world: null, self: null, seen: new Map(), log: [],
    send: delayed((m: ClientMessage) => ws.send(toWire(bedwarsCodec.encodeClient, m))),
    on: (l) => listeners.push(l),
  }
  ws.on('message', delayed((data: Buffer, isBinary: boolean) => listeners.forEach((l) => l(data, isBinary))))
  c.on((data: Buffer, isBinary: boolean) => {
    const m = fromWire(bedwarsCodec.decodeServer, isBinary ? new Uint8Array(data) : String(data)) as ServerMessage
    const at = performance.now()
    c.log.push({ at, m })
    if (m.t === 'welcome') {
      c.id = m.id
      c.tp = m.tp
      c.world = World.decode(fromBase64(m.world))
    }
    if (m.t === 'teleport') c.tp = m.tp
    if (m.t === 'self') c.self = m.self
    if (m.t === 'blocks') for (const [x, y, z, raw] of m.changes) c.world?.set(x, y, z, raw & 0x7f, (raw & 0x80) !== 0)
    if (m.t === 'tick')
      for (const p of m.players) {
        if (p.x === undefined && p.y === undefined && p.z === undefined) continue
        const track = c.seen.get(p.id) ?? c.seen.set(p.id, []).get(p.id)!
        const last = track.at(-1)
        track.push({ x: p.x ?? last?.x ?? 0, y: p.y ?? last?.y ?? 0, z: p.z ?? last?.z ?? 0, at })
      }
  })
  return new Promise((ok, fail) => {
    ws.on('open', () => setTimeout(() => ok(c), 800))
    ws.on('error', fail)
  })
}

const a = await join('ProbeA')
const b = await join('ProbeB')
a.send({ t: 'chat', text: '/give wool 128' })
// The sandbox's pillar pit: open ground away from the spawn's no-build zone.
a.send({ t: 'chat', text: `/tp 30.5 ${TOP} 50.5` })
await sleep(600)
const woolSlot = a.self!.inventory.findIndex((s) => s?.id.endsWith('wool'))
a.send({ t: 'select', slot: woolSlot })
await sleep(200)

// Mirror the server's idea of where A is from A's own tick stream.
const lastTp = a.log.filter((l) => l.m.t === 'teleport').at(-1)!.m as Extract<ServerMessage, { t: 'teleport' }>
const startPos = { x: lastTp.x, y: lastTp.y, z: lastTp.z }
const me: Mover = { x: startPos.x, y: startPos.y, z: startPos.z, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, sneaking: false, sprinting: false, fallDistance: 0 } as Mover
const placed = new Map<string, number>()
let reverted = 0
let placements = 0
const confirmMs: number[] = []
a.on(() => {
  const last = a.log.at(-1)!
  if (last.m.t === 'teleport') {
    me.x = last.m.x
    me.y = last.m.y
    me.z = last.m.z
    me.vx = me.vy = me.vz = 0
  }
  if (last.m.t !== 'blocks') return
  for (const [x, y, z, raw] of last.m.changes) {
    const k = `${x},${y},${z}`
    const sent = placed.get(k)
    if (sent === undefined) continue
    placed.delete(k)
    if ((raw & 0x7f) === AIR) reverted++
    else confirmMs.push(last.at - sent)
  }
})

function place(hx: number, hy: number, hz: number, face: [number, number, number]) {
  const [x, y, z] = [hx + face[0], hy + face[1], hz + face[2]]
  if (a.world!.get(x, y, z) !== AIR) return
  a.world!.set(x, y, z, a.self!.inventory[woolSlot] ? 1 : 1, true)
  placed.set(`${x},${y},${z}`, performance.now())
  placements++
  a.send({ t: 'place', x: hx, y: hy, z: hz, face, slot: woolSlot })
}

let seq = 0
async function tick(input: Partial<MoveInput>) {
  stepMovement(a.world!, me, { ...IDLE_INPUT, yaw: me.yaw, pitch: me.pitch, ...input })
  a.send({ t: 'input', seq: ++seq, x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, yaw: me.yaw, pitch: me.pitch, sneak: me.sneaking, sprint: me.sprinting, shield: false, tp: a.tp })
  await sleep(50)
}

// Pillar: jump, and place under your feet at the top of each jump.
for (let i = 0; i < 10; i++) {
  const floor = Math.floor(me.y)
  await tick({ jump: true, pitch: -Math.PI / 2 })
  for (let t = 0; t < 12; t++) {
    if (me.y > floor + 1.05 && a.world!.get(Math.floor(me.x), floor, Math.floor(me.z)) === AIR) place(Math.floor(me.x), floor - 1, Math.floor(me.z), [0, 1, 0])
    await tick({ pitch: -Math.PI / 2 })
    if (me.onGround && me.y >= floor + 1) break
  }
}
// Bridge: sneak backwards off the pillar, placing against the side of the block underfoot.
me.yaw = 0 // facing -z, walking back toward +z
for (let i = 0; i < 40; i++) {
  const feet = Math.floor(me.y) - 1
  const bx = Math.floor(me.x)
  const bz = Math.floor(me.z)
  if (a.world!.get(bx, feet, bz + 1) === AIR && me.z - bz > 0.6 && a.world!.get(bx, feet, bz) !== AIR) place(bx, feet, bz, [0, 0, 1])
  await tick({ forward: -1, sneak: true, pitch: -1.3 })
}
await sleep(1500)

// How smoothly B saw A: gaps between position updates.
const track = b.seen.get(a.id) ?? []
const gaps = track.slice(1).map((s, i) => s.at - track[i].at)
const teleports = a.log.filter((l) => l.m.t === 'teleport').length - 1
const errors = a.log.flatMap((l) => (l.m.t === 'event' && l.m.kind === 'error' ? [l.m.text] : []))
const sorted = (v: number[]) => [...v].sort((x, y) => x - y)
const pct = (v: number[], p: number) => sorted(v)[Math.min(v.length - 1, Math.floor(v.length * p))]?.toFixed(0)
console.log({
  server: base,
  placements,
  reverted,
  unconfirmed: placed.size,
  confirmMs: { p50: pct(confirmMs, 0.5), p95: pct(confirmMs, 0.95) },
  teleports,
  errors,
  heightGained: (me.y - startPos.y).toFixed(2),
  bSawA: { updates: track.length, gapP50: pct(gaps, 0.5), gapP95: pct(gaps, 0.95), gapMax: pct(gaps, 1) },
})
a.ws.close()
b.ws.close()
process.exit(0)
