import cluster, { type Worker } from 'node:cluster'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, IncomingMessage, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { availableParallelism, networkInterfaces } from 'node:os'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGameHost, GAME_PATH, roomListBody, ROOMS_PATH } from '../engine/net/host'
import type { RoomFactory, RoomListing } from '../engine/net/room'
import { bedwarsRooms } from '../games/bedwars/server'

/** The default rooms, exported so scripts can speak their wire format (scripts/smoke-server.mjs). */
export { bedwarsRooms }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

export interface ServerOptions {
  port?: number
  host?: string
  staticDir?: string
  /** Game processes. 1 runs rooms in this process; more forks workers and pins each room to one. */
  workers?: number
  rooms?: RoomFactory
  /** No startup log (Electron prints nothing to a terminal nobody sees). */
  quiet?: boolean
}

const VERSION = process.env.npm_package_version ?? '1.0.0'

/** Headers every response carries: no sniffing, no framing by other sites, no referrer leaks. */
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
}

/** The public room list and how many are online, gathered from wherever the rooms run. */
type RoomLister = () => Promise<{ rooms: RoomListing[]; online: number }>

function staticHandler(staticDir: string, listRooms: RoomLister) {
  return async (req: IncomingMessage, res: import('node:http').ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD', ...SECURITY_HEADERS }).end()
      return
    }
    let path: string
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      res.writeHead(400, SECURITY_HEADERS).end()
      return
    }
    if (path === ROOMS_PATH) {
      const { rooms, online } = await listRooms()
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS }).end(roomListBody(rooms, online))
      return
    }
    // For uptime checks and process managers.
    if (path === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS }).end(JSON.stringify({ ok: true, version: VERSION }))
      return
    }
    let file = normalize(join(staticDir, path))
    if (!file.startsWith(staticDir + sep) && file !== staticDir) {
      res.writeHead(403, SECURITY_HEADERS).end()
      return
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, 'index.html')
    if (!existsSync(file)) {
      res.writeHead(404).end('Build the client first: bun run build')
      return
    }
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      ...SECURITY_HEADERS,
    })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(file).pipe(res)
  }
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((done, fail) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      fail(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use. Pick another with --port or PORT.`) : error),
    )
    server.listen(port, host, () => {
      const address = server.address()
      done(typeof address === 'object' && address ? address.port : port)
    })
  })
}

/** FNV-1a: a stable worker choice for a room key. */
function hash(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193)
  return h >>> 0
}

/**
 * Serves the built client and the game on one port. With `workers` > 1 the
 * primary process only serves files and routes each WebSocket upgrade to the
 * worker that owns its room (a hash of the room key), passing the socket
 * itself across, so every player in a room lands on the same process and
 * rooms spread over all cores. Used by `bun run start` and Electron.
 */
export async function startServer(options: ServerOptions = {}): Promise<{ server: Server; port: number }> {
  const staticDir = resolve(options.staticDir ?? join(fileURLToPath(new URL('.', import.meta.url)), '../node-client'))
  const rooms = options.rooms ?? bedwarsRooms
  const workers = Math.max(1, options.workers ?? 1)
  let listRooms: RoomLister = async () => ({ rooms: [], online: 0 })
  const handle = staticHandler(staticDir, () => listRooms())
  const server = createServer((req, res) => void handle(req, res))

  if (workers === 1) {
    const game = createGameHost(rooms)
    listRooms = async () => ({ rooms: game.list(), online: game.online() })
    server.on('upgrade', (req, socket, head) => {
      if (!game.handleUpgrade(req, socket, head)) socket.destroy()
    })
    server.on('close', () => game.close())
  } else {
    const pool: Worker[] = []
    const ready = new WeakMap<Worker, Promise<void>>()
    let closing = false
    const fork = (i: number) => {
      const w = cluster.fork({ GAME_WORKER: String(i) })
      const started = new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { reject(new Error('Game worker did not become ready')); w.kill() }, 10_000)
        const onReady = (message: { type?: string }) => {
          if (message?.type !== 'ready') return
          clearTimeout(timeout)
          w.off('message', onReady)
          resolve()
        }
        w.on('message', onReady)
        w.once('exit', () => { clearTimeout(timeout); reject(new Error('Game worker exited')) })
      })
      ready.set(w, started)
      // Replacement workers may fail before anyone is waiting to join one.
      void started.catch(() => {})
      w.on('exit', () => {
        // Rooms on a crashed worker are gone; its players reconnect into fresh ones.
        if (!closing && pool[i] === w) pool[i] = fork(i)
      })
      return w
    }
    for (let i = 0; i < workers; i++) pool.push(fork(i))
    // Ask every worker for its rooms; one that does not answer in time is left out.
    let asked = 0
    listRooms = () =>
      new Promise((done) => {
        const id = ++asked
        const all: RoomListing[] = []
        let online = 0
        let waiting = pool.length
        const finish = () => {
          for (const w of pool) w.off('message', onReply)
          clearTimeout(timer)
          done({ rooms: all.sort((a, b) => b.connections - a.connections), online })
        }
        const onReply = (m: { type?: string; id?: number; rooms?: RoomListing[]; online?: number }) => {
          if (m?.type !== 'rooms' || m.id !== id) return
          all.push(...(m.rooms ?? []))
          online += m.online ?? 0
          if (--waiting === 0) finish()
        }
        const timer = setTimeout(finish, 500)
        for (const w of pool) {
          w.on('message', onReply)
          w.send({ type: 'rooms', id })
        }
      })
    server.on('upgrade', (req, socket: Socket, head) => {
      if (!req.url?.startsWith(GAME_PATH)) return socket.destroy()
      const key = rooms.key(new URL(req.url, 'http://localhost').searchParams)
      const worker = pool[hash(key) % pool.length]
      void ready.get(worker)!.then(() => {
        if (socket.destroyed || !worker.isConnected()) { socket.destroy(); return }
        worker.send({ type: 'upgrade', url: req.url, method: req.method, headers: req.headers, head: head.toString('base64') }, socket)
      }).catch(() => socket.destroy())
    })
    const stopWorkers = () => { closing = true; pool.forEach((w) => w.kill()) }
    server.on('close', stopWorkers)
    try { await Promise.all(pool.map((w) => ready.get(w))) }
    catch (error) { stopWorkers(); throw error }
  }
  const port = await listen(server, options.port ?? 3000, options.host ?? '0.0.0.0')
  return { server, port }
}

/** A forked game worker: completes the WebSocket handshakes the primary hands over. */
function runWorker(rooms: RoomFactory) {
  const game = createGameHost(rooms)
  process.on('message', (msg: { type?: string; id?: number; url: string; method: string; headers: IncomingMessage['headers']; head: string }, socket?: Socket) => {
    if (msg?.type === 'rooms') {
      process.send?.({ type: 'rooms', id: msg.id, rooms: game.list(), online: game.online() })
      return
    }
    if (msg?.type !== 'upgrade' || !socket) return
    const req = new IncomingMessage(socket)
    req.url = msg.url
    req.method = msg.method
    req.headers = msg.headers
    if (!game.handleUpgrade(req, socket, Buffer.from(msg.head, 'base64'))) socket.destroy()
  })
  // Cluster's `online` event precedes ESM evaluation; signal only after the
  // upgrade listener is installed so early IPC socket handoffs cannot be lost.
  process.send?.({ type: 'ready' })
}

/** `--port 3000 --host 0.0.0.0 --workers auto`, with PORT, HOST and WORKERS as fallbacks. */
function cliOptions(argv: string[]) {
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
  }
  if (argv.includes('--help')) {
    console.log('Usage: node dist/server/main.js [--port 3000] [--host 0.0.0.0] [--workers 1|n|auto]')
    process.exit(0)
  }
  const w = arg('workers') ?? process.env.WORKERS
  return {
    port: Number(arg('port') ?? process.env.PORT) || 3000,
    host: arg('host') ?? process.env.HOST ?? '0.0.0.0',
    workers: w === 'auto' ? Math.max(1, availableParallelism() - 1) : Number(w) || 1,
  }
}

/** Addresses others on the network can use to join. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (cluster.isWorker && process.env.GAME_WORKER !== undefined) runWorker(bedwarsRooms)
else if (isEntry) {
  const options = cliOptions(process.argv.slice(2))
  try {
    const { server, port } = await startServer(options)
    console.log(`Buffcraft ${VERSION}: http://localhost:${port} (${options.workers} game ${options.workers === 1 ? 'process' : 'workers'})`)
    if (options.host === '0.0.0.0') for (const ip of lanAddresses()) console.log(`  on your network: http://${ip}:${port}`)
    // Stop taking new connections, let rooms close their sockets, then exit.
    const shutdown = (signal: string) => {
      console.log(`${signal}: shutting down`)
      server.close(() => process.exit(0))
      server.closeAllConnections?.()
      setTimeout(() => process.exit(0), 3000).unref()
    }
    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
