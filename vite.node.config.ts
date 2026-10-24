import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { createGameHost, roomListBody, ROOMS_PATH } from './src/engine/net/host'
import { bedwarsRooms } from './src/games/bedwars/server'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

/** Runs the game server inside Vite's dev server, so `bun run dev` is one port for both. */
function gameServer(): Plugin {
  return {
    name: 'game-server',
    configureServer(server) {
      const game = createGameHost(bedwarsRooms)
      server.httpServer?.on('upgrade', (req, socket, head) => game.handleUpgrade(req, socket, head))
      server.middlewares.use(ROOMS_PATH, (_req, res) => {
        res.setHeader('content-type', 'application/json')
        res.end(roomListBody(game.list(), game.online()))
      })
      server.httpServer?.on('close', () => game.close())
    },
  }
}

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [gameServer()],
  define: { __SITES__: false, __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5173, strictPort: false },
  // The chunk mesher runs in a module worker (src/engine/render/mesh-worker.ts).
  worker: { format: 'es' },
  // Node assets stay separate from the Sites manifest, even when both builds run.
  build: isSsrBuild ? { copyPublicDir: false } : { outDir: 'dist/node-client', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
}))
