import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { TICK_MS } from '../constants'
import { fromWire, jsonCodec, toWire, type MessageCodec } from './codec'
import type { RoomFactory, RoomLike, RoomListing } from './room'

export const GAME_PATH = '/game'
/** GET here for the public room list as JSON. */
export const ROOMS_PATH = '/api/rooms'
const MAX_MESSAGE_BYTES = 4096
const MAX_MESSAGES_PER_SECOND = 120
/** Stop a room's loop this long after its last person leaves. */
const IDLE_CLOSE_MS = 60_000

interface HostedRoom {
  room: RoomLike
  timer: ReturnType<typeof setInterval>
  sockets: Set<WebSocket>
  idleSince: number | null
}

/**
 * Runs game rooms over WebSockets: one authoritative room per key (the game
 * decides keys from the connection's query), ticking at 20 TPS while anyone is
 * connected. Attach it to any Node HTTP server's `upgrade` event (Vite's dev
 * server, the production server, Electron).
 */
export function createGameHost(factory: RoomFactory) {
  const codec: MessageCodec = factory.codec ?? jsonCodec
  // A broadcast hands the same message object to every player's sink: encode it once.
  const encoded = new WeakMap<object, string | Uint8Array>()
  const encode = (msg: unknown): string | Uint8Array => {
    if (typeof msg !== 'object' || msg === null) return JSON.stringify(msg)
    let wire = encoded.get(msg)
    if (wire === undefined) {
      wire = toWire(codec.encodeServer, msg)
      encoded.set(msg, wire)
    }
    return wire
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES })
  const rooms = new Map<string, HostedRoom>()

  function roomFor(params: URLSearchParams): HostedRoom {
    const key = factory.key(params)
    let hosted = rooms.get(key)
    if (hosted) return hosted
    const room = factory.create(params)
    let last = performance.now()
    let carry = 0
    const timer = setInterval(() => {
      // Catch up on late timers so the game clock stays at 20 TPS on average.
      const now = performance.now()
      carry += now - last
      last = now
      let steps = 0
      while (carry >= TICK_MS && steps++ < 5) {
        room.tick()
        carry -= TICK_MS
      }
      if (carry > TICK_MS * 5) carry = 0
      const entry = rooms.get(key)
      if (entry && entry.sockets.size === 0) {
        entry.idleSince ??= Date.now()
        if (Date.now() - entry.idleSince > IDLE_CLOSE_MS) {
          clearInterval(entry.timer)
          rooms.delete(key)
        }
      }
    }, TICK_MS / 2)
    hosted = { room, timer, sockets: new Set(), idleSince: null }
    rooms.set(key, hosted)
    return hosted
  }

  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const hosted = roomFor(url.searchParams)
    hosted.sockets.add(socket)
    hosted.idleSince = null
    const player = hosted.room.connect(url.searchParams.get('name') ?? '', (msg) => {
      if (socket.readyState === socket.OPEN) socket.send(encode(msg))
    })
    let windowStart = Date.now()
    let count = 0
    socket.on('message', (data, isBinary) => {
      const now = Date.now()
      if (now - windowStart > 1000) {
        windowStart = now
        count = 0
      }
      if (++count > MAX_MESSAGES_PER_SECOND) return
      let msg: unknown
      try {
        // Binary frames are the game's hot messages (its codec); text frames are JSON.
        msg = fromWire(codec.decodeClient, isBinary ? new Uint8Array(data as Buffer) : String(data))
      } catch {
        return
      }
      hosted.room.receive(player.id, msg)
    })
    socket.on('close', () => {
      hosted.sockets.delete(socket)
      hosted.room.disconnect(player.id)
    })
  })

  /** Every room that lists itself and has someone in it, busiest first (an emptied room lingers a minute before closing). */
  function list(): RoomListing[] {
    const out: RoomListing[] = []
    for (const r of rooms.values()) {
      if (r.sockets.size === 0) continue
      const summary = r.room.summary?.()
      if (summary) out.push({ summary, connections: r.sockets.size })
    }
    return out.sort((a, b) => b.connections - a.connections)
  }

  /** People connected to any room, listed or not. */
  function online(): number {
    let n = 0
    for (const r of rooms.values()) n += r.sockets.size
    return n
  }

  return {
    list,
    online,
    /** Hand an HTTP upgrade to the game if it is for the game path; returns whether it was. */
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
      if (!req.url?.startsWith(GAME_PATH)) return false
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
      return true
    },
    close() {
      for (const r of rooms.values()) clearInterval(r.timer)
      rooms.clear()
      wss.close()
    },
  }
}

/** The body of a room-list response: the rooms, and everyone connected to any room (listed or not). */
export function roomListBody(listings: RoomListing[], online: number): string {
  return JSON.stringify({ online, rooms: listings })
}
