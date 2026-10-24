import { readFileSync, realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
const localHelper = 'buffcraft-realtime-' + createHash('sha256').update(realpathSync(fileURLToPath(new URL('.', import.meta.url)))).digest('hex').slice(0, 12)
export default defineConfig({
  // Match dev-sites.mjs without colliding with another project's local helper.
  plugins: [cloudflare({ config: { durable_objects: { bindings: [{ name: 'REALTIME', class_name: 'FreebuffRealtime', script_name: localHelper }] } } })],
  define: { __SITES__: true, __APP_VERSION__: JSON.stringify(pkg.version) },
  // Served from a domain root (Vercel, Sites, the Node server): assets live at /assets.
  base: '/',
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 1200 },
})
