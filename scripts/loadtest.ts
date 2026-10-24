/**
 * Capacity check: runs many bed-wars rooms headless in one process with bots
 * in every seat, and `watchers` connected sinks per room standing in for
 * people. Messages are encoded once per broadcast with the game's wire codec,
 * as the WebSocket host does, and counted per watcher. `--json` encodes
 * everything as JSON instead, for comparison.
 *
 *   bun scripts/loadtest.ts [rooms=20] [seconds=30] [teamSize=1] [watchers=1] [--json]
 */
import { TICK_MS, TPS } from '../src/engine/constants'
import { jsonCodec, toWire } from '../src/engine/net/codec'
import { installBots } from '../src/games/bedwars/bots'
import { bedwarsCodec, type ServerMessage } from '../src/games/bedwars/protocol'
import { Room } from '../src/games/bedwars/room'
import { arenaRules } from '../src/games/bedwars/rules'

const json = process.argv.includes('--json')
const codec = json ? jsonCodec : bedwarsCodec
const [rooms = 20, seconds = 30, teamSize = 1, watchers = 1] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith('--'))
  .map(Number)
let bytes = 0
let tickBytes = 0
let messages = 0
let encodeMs = 0
const cache = new WeakMap<object, string | Uint8Array>()
const all: Room[] = []
for (let i = 0; i < rooms; i++) {
  const room = new Room({ rules: arenaRules({ countdownTicks: 1, teamSize, endTicks: 100 }), seed: i + 1 })
  installBots(room)
  for (let w = 0; w < watchers; w++) {
    const sink = room.connect(`watch${i}-${w}`, (msg: ServerMessage) => {
      let wire = cache.get(msg)
      if (!wire) {
        const start = performance.now()
        cache.set(msg, (wire = toWire(codec.encodeServer, msg)))
        encodeMs += performance.now() - start
      }
      bytes += wire.length
      if (msg.t === 'tick') tickBytes += wire.length
      messages++
    })
    if (w === 0) room.receive(sink.id, { t: 'start' })
  }
  all.push(room)
}
for (let t = 0; t < 5; t++) for (const room of all) room.tick()
const players = all.reduce((n, r) => n + r.players.size, 0)
const ticks = seconds * TPS
const times: number[] = []
bytes = 0
tickBytes = 0
messages = 0
encodeMs = 0
for (let t = 0; t < ticks; t++) {
  const start = performance.now()
  for (const room of all) room.tick()
  times.push(performance.now() - start)
}
times.sort((a, b) => a - b)
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(times.length * p))]
const mean = times.reduce((a, b) => a + b, 0) / times.length
const perRoom = mean / rooms
const perWatcher = bytes / (rooms * watchers) / seconds
console.log(`${rooms} rooms of ${players / rooms} players (${watchers} watching each), ${seconds}s of game time, ${json ? 'all JSON' : 'binary ticks'}`)
console.log(`tick: mean ${mean.toFixed(2)} ms, p99 ${pct(0.99).toFixed(2)} ms for all rooms (budget ${TICK_MS} ms)`)
console.log(`per room: ${perRoom.toFixed(3)} ms/tick, so one core simulates about ${Math.floor(TICK_MS / perRoom)} such rooms`)
console.log(`downstream: ${(perWatcher / 1024).toFixed(2)} KB/s (ticks ${(tickBytes / (rooms * watchers) / seconds / 1024).toFixed(2)} KB/s) and ${(messages / (rooms * watchers) / seconds).toFixed(0)} msgs/s per watcher`)
console.log(`encoding: ${((encodeMs / ticks / rooms) * 1000).toFixed(1)} µs per room per tick`)
