// Local-only: one public port, a separate workerd helper, and deterministic teardown.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const name = 'buffcraft-realtime-' + createHash('sha256').update(realpathSync(fileURLToPath(new URL('..', import.meta.url)))).digest('hex').slice(0, 12)
// The app proxies sockets, so the helper can use an available ephemeral port.
const helper = spawn('node', ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '-c', 'freebuff-realtime/wrangler.jsonc', '--name', name, '--port', '0', '--inspector-port', '0'], { stdio: ['ignore', 'pipe', 'pipe'] })
let app
let stopping = false
const stop = () => { if (stopping) return; stopping = true; helper.kill('SIGTERM'); app?.kill('SIGTERM') }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
helper.on('exit', (code) => { if (!stopping) { process.exitCode = code || 1; stop() } })
try {
  await new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error('Local realtime helper did not start.')), 30_000)
    helper.stdout.on('data', (data) => {
      process.stdout.write(data)
      output = (output + String(data)).slice(-4000)
      if (/Ready on https?:\/\//.test(output)) { clearTimeout(timeout); resolve() }
    })
    helper.stderr.on('data', (data) => process.stderr.write(data))
    helper.once('error', (error) => { clearTimeout(timeout); reject(error) })
    helper.once('exit', () => { clearTimeout(timeout); reject(new Error('Realtime helper exited before it became ready.')) })
  })
  app = spawn('node', ['node_modules/vite/bin/vite.js', ...process.argv.slice(2)], { stdio: 'inherit' })
  app.on('exit', (code) => { if (!stopping) { process.exitCode = code || 0; stop() } })
} catch (error) { console.error(error.message); process.exitCode = 1; stop() }
