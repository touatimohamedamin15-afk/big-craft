import type { MessageCodec } from './codec'

/**
 * What the engine's transports need from a game's room: connect a player with
 * a message sink, deliver their messages, and advance one fixed tick. Any
 * game that implements this runs on the same host, offline transport, Electron
 * shell and load test.
 */
export interface RoomLike<ClientMsg = unknown, ServerMsg = unknown> {
  connect(name: string, sink: (msg: ServerMsg) => void): { id: number }
  receive(id: number, msg: ClientMsg): void
  disconnect(id: number): void
  tick(): void
  /** What a public room list shows about this room; null (or no method) keeps it off the list. */
  summary?(): RoomSummary | null
}

/** A listed room: the game decides the fields; the host adds who is connected. */
export type RoomSummary = Record<string, string | number | boolean | null>

export interface RoomListing {
  summary: RoomSummary
  /** Open connections (people, not bots). */
  connections: number
}

/** Turns connection parameters (the WebSocket URL's query) into a room key and creates rooms on demand. */
export interface RoomFactory {
  key(params: URLSearchParams): string
  create(params: URLSearchParams): RoomLike
  /** How the game's messages go on the wire; JSON when absent. */
  codec?: MessageCodec
}
