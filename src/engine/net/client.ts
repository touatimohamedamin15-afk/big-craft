import { TICK_MS } from '../constants'
import { fromWire, jsonCodec, toWire, type MessageCodec } from './codec'
import type { RoomLike } from './room'

export interface Connection<ClientMsg, ServerMsg> {
  send(msg: ClientMsg): void
  onMessage(handler: (msg: ServerMsg) => void): void
  onClose(handler: (reason: string) => void): void
  close(): void
}

/** Talks to the game server over a WebSocket on the page's own origin; `params` choose the room. */
export function connectOnline<C, S>(params: Record<string, string>, codec: MessageCodec<C, S> = jsonCodec, path = '/game'): Connection<C, S> {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(`${proto}//${location.host}${path}?${new URLSearchParams(params)}`)
  socket.binaryType = 'arraybuffer'
  const queue: C[] = []
  let handler: (msg: S) => void = () => {}
  let closed: (reason: string) => void = () => {}
  const send = (m: C) => socket.send(toWire(codec.encodeClient, m))
  socket.onopen = () => {
    for (const m of queue.splice(0)) send(m)
  }
  socket.onmessage = (e: MessageEvent<string | ArrayBuffer>) => handler(fromWire(codec.decodeServer, typeof e.data === 'string' ? e.data : new Uint8Array(e.data)))
  socket.onclose = () => closed('Disconnected from the server.')
  socket.onerror = () => closed('Could not reach the game server.')
  return {
    send(msg) {
      if (socket.readyState === WebSocket.OPEN) send(msg)
      else if (socket.readyState === WebSocket.CONNECTING) queue.push(msg)
    },
    onMessage(h) {
      handler = h
    },
    onClose(h) {
      closed = h
    },
    close() {
      socket.onclose = null
      socket.close()
    },
  }
}

/**
 * Runs an authoritative room inside the page (offline play, practice). Messages
 * are still encoded and decoded as on the wire so the client sees exactly what
 * a network client would.
 */
export function connectLocal<C, S>(room: RoomLike<C, S>, name: string, codec: MessageCodec<C, S> = jsonCodec): Connection<C, S> {
  let handler: (msg: S) => void = () => {}
  const inbox: S[] = []
  const player = room.connect(name, (msg) => inbox.push(fromWire(codec.decodeServer, toWire(codec.encodeServer, msg))))
  let last = performance.now()
  let carry = 0
  const timer = setInterval(() => {
    const now = performance.now()
    carry += now - last
    last = now
    let steps = 0
    while (carry >= TICK_MS && steps++ < 5) {
      room.tick()
      carry -= TICK_MS
    }
    if (carry > TICK_MS * 5) carry = 0
    for (const m of inbox.splice(0)) handler(m)
  }, TICK_MS / 2)
  return {
    send(msg) {
      room.receive(player.id, fromWire(codec.decodeClient, toWire(codec.encodeClient, msg)))
    },
    onMessage(h) {
      handler = h
      for (const m of inbox.splice(0)) handler(m)
    },
    onClose() {},
    close() {
      clearInterval(timer)
    },
  }
}
