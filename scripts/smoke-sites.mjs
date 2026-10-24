// Runs only local workerd and Chromium. No account, cloud provisioning or deploy.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { chromium } from 'playwright'

const manifest = JSON.parse(await readFile('deploy.json', 'utf8'))
assert.equal(manifest.realtime, true)
const helper = await readFile('freebuff-realtime/worker.js', 'utf8')
assert.ok(helper.includes('SESSION_MS = 300000;'))
const mf = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1', port: 0,
  workers: [
    { name: 'buffcraft', modules: true, scriptPath: resolve(manifest.modules[0].path), compatibilityDate: manifest.compatibilityDate,
      durableObjects: { REALTIME: { className: 'FreebuffRealtime', scriptName: 'realtime', useSQLite: true } },
      assets: { directory: resolve(manifest.assetsDirectory), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true }, assetConfig: { not_found_handling: 'single-page-application' } } },
    // Shorten only the test fixture's authorization lifetime to exercise real
    // browser ticket renewal without a five-minute test. Shipped source is untouched.
    { name: 'realtime', modules: true, script: helper.replace('SESSION_MS = 300000;', 'SESSION_MS = 20000;'), compatibilityDate: manifest.compatibilityDate,
      durableObjects: { REALTIME: { className: 'FreebuffRealtime', useSQLite: true } } },
  ],
}))
let browser
try {
  const url = (await mf.ready).origin
  const health = await fetch(url + '/healthz')
  assert.equal(health.status, 200, await health.text())
  const html = await (await fetch(url)).text()
  assert.match(html, /type="module"/)
  const forbidden = await fetch(url + '/api/realtime/ticket', { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ room: 'bedwars:arena:smoke:normal' }) })
  assert.equal(forbidden.status, 403)
  browser = await chromium.launch({ executablePath: process.argv.find((s) => s.startsWith('--chromium='))?.slice(11), args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const host = await context.newPage(), guest = await context.newPage()
  const errors = []
  let hostSockets = 0, guestSockets = 0
  host.on('websocket', () => { hostSockets++ })
  guest.on('websocket', () => { guestSockets++ })
  for (const page of [host, guest]) page.on('pageerror', (e) => errors.push(e.message))
  await host.goto(url)
  await host.getByRole('button', { name: 'Play online', exact: true }).click()
  await host.locator('#name').fill('Host')
  await host.locator('#room').fill('smoke')
  await host.getByRole('button', { name: 'Host a room', exact: true }).click()
  await host.waitForFunction(() => window.game?.self && window.game?.world, undefined, { timeout: 30_000 })
  await guest.goto(url + '/?room=smoke')
  await guest.locator('#name').fill('Guest')
  await guest.getByRole('button', { name: 'Join room', exact: true }).click()
  await guest.waitForFunction(() => window.game?.self && window.game?.world, undefined, { timeout: 30_000 })
  await host.waitForFunction(() => window.game.views.some((p) => p.name === 'Guest'))
  await guest.waitForFunction(() => window.game.views.some((p) => p.name === 'Host'))
  const id = await guest.evaluate(() => window.game.myId)
  assert.notEqual(id, await host.evaluate(() => window.game.myId))
  // Exercises the real 16 KiB helper using the large map snapshot, then a map
  // reset and start command through the unchanged game rules.
  await host.evaluate(() => window.game.send({ t: 'start' }))
  await guest.waitForFunction(() => window.game.gameView?.phase === 'playing', undefined, { timeout: 30_000 })
  await guest.waitForFunction(() => !document.querySelector('.lobby').classList.contains('show'))
  // Existing game automation seam drives real movement without pointer lock,
  // which headless Chromium does not grant consistently.
  await guest.evaluate(() => { window.game.automation = true })
  await guest.waitForFunction(() => document.querySelector('.help').classList.contains('hidden'))
  const before = await guest.evaluate(() => ({ x: window.game.me.x, z: window.game.me.z }))
  await guest.keyboard.down('w')
  await guest.waitForFunction((p) => Math.hypot(window.game.me.x - p.x, window.game.me.z - p.z) > 0.5, before)
  await guest.keyboard.up('w')
  await host.waitForFunction(({ id, before }) => { const p = window.game.views.find(p => p.id === id); return p && Math.hypot(p.x - before.x, p.z - before.z) > 0.5 }, { id, before })
  const renewalDeadline = Date.now() + 30_000
  while (hostSockets < 2 || guestSockets < 2) {
    assert.ok(Date.now() < renewalDeadline, 'Both browsers must renew their tickets')
    await new Promise((done) => setTimeout(done, 100))
  }
  await guest.waitForFunction((id) => window.game.myId === id && window.game.connection.readyForInput && !document.querySelector('.error-screen').classList.contains('show'), id)
  await guest.evaluate(() => window.game.send({ t: 'chat', text: '!after ticket renewal' }))
  await host.getByText('Guest: after ticket renewal', { exact: true }).waitFor()
  await mkdir('dist/review', { recursive: true })
  await guest.screenshot({ path: 'dist/review/sites-multiplayer.png' })
  await host.close()
  await guest.getByText(/host or realtime connection is unavailable/).waitFor({ timeout: 25_000 })
  assert.deepEqual(errors, [])
  console.log('Sites smoke passed: built Worker/assets, CSRF, two browser players, map snapshot, match start, movement, ticket renewal, host departure. Screenshot: dist/review/sites-multiplayer.png')
} finally { await browser?.close(); await mf.dispose() }
