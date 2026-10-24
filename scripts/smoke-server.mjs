// Local built Node server: room isolation, ticks, binary movement, HTTP routes.
// bun run build:node && bun run smoke
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import { bedwarsRooms } from '../dist/server/main.js'

const codec = bedwarsRooms.codec
const port = 3000 + Math.floor(Math.random() * 2000)
const server = spawn('node', ['dist/server/main.js'], { env: { ...process.env, PORT: String(port), WORKERS: '2' }, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
server.stdout.on('data', (d) => { output += String(d) })
server.stderr.on('data', (d) => { output += String(d) })
const sockets = []
async function until(check) {
  const deadline = Date.now() + 15_000
  while (!check()) {
    if (server.exitCode !== null || Date.now() >= deadline) throw new Error(`Server smoke timed out or exited. ${output}`)
    await delay(50)
  }
}
function join(room, name) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/game?room=${room}&name=${name}`)
  sockets.push(ws)
  const state = { ws, id: 0, tp: 0, players: new Map(), ticks: 0 }
  ws.on('error', (e) => { output += e.message })
  ws.on('message', (data, binary) => {
    const m = binary ? codec.decodeServer(new Uint8Array(data)) : JSON.parse(String(data))
    if (m.t === 'welcome') [state.id, state.tp] = [m.id, m.tp]
    if (m.t === 'teleport') state.tp = m.tp
    if (m.t === 'tick') {
      state.ticks++
      for (const d of m.players) state.players.set(d.id, { ...state.players.get(d.id), ...d })
      for (const id of m.gone ?? []) state.players.delete(id)
    }
  })
  return state
}
try {
  await until(() => output.includes('http://localhost:'))
  const a = join('alpha', 'Ash'), b = join('alpha', 'Bea'), c = join('beta', 'Cal')
  const names = (s) => [...s.players.values()].map((p) => p.name).sort().join(',')
  await until(() => names(a) === 'Ash,Bea' && names(b) === 'Ash,Bea' && names(c) === 'Cal' && a.ticks > 3 && c.ticks > 3)
  const ash = a.players.get(a.id)
  const step = { t: 'input', x: ash.x + 0.5, y: ash.y, z: ash.z, vx: 0, vy: 0, vz: 0, yaw: ash.yaw, pitch: ash.pitch, sneak: false, sprint: false, shield: false, tp: a.tp }
  a.ws.send(codec.encodeClient(step))
  await until(() => b.players.get(a.id)?.x === Math.round(step.x * 100) / 100)
  const health = await fetch(`http://127.0.0.1:${port}/healthz`).then((r) => r.json())
  const page = await fetch(`http://127.0.0.1:${port}/`)
  assert.equal(health.ok, true)
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  assert.match(await page.text(), /<div id="app">/)
  assert.equal((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status, 405)
  console.log('Node smoke passed: rooms, isolation, binary movement, health, static page and headers.')
} finally {
  for (const ws of sockets) ws.terminate()
  server.kill('SIGTERM')
  await new Promise((done) => { if (server.exitCode !== null) done(); else server.once('exit', done) })
}
