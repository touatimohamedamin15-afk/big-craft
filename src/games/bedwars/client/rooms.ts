import type { Phase } from '../protocol'

/** One public room, as `/api/rooms` lists it (the room's summary plus who is connected). */
export interface RoomInfo {
  room: string
  world: 'arena' | 'sandbox'
  fast: boolean
  phase: Phase
  map: string
  /** People in the room, and bots holding seats. */
  players: number
  bots: number
  capacity: number
  connections: number
}

export interface RoomList {
  /** Everyone connected to the server, in any room. */
  online: number
  rooms: RoomInfo[]
}

/** The server's room list, or null when there is no server to ask (offline, or it is down). */
export async function fetchRooms(): Promise<RoomList | null> {
  try {
    const r = await fetch('/api/rooms', { cache: 'no-store' })
    if (!r.ok) return null
    const body = (await r.json()) as { online: number; rooms: { summary: Omit<RoomInfo, 'connections'>; connections: number }[] }
    return { online: body.online, rooms: body.rooms.map((l) => ({ ...l.summary, connections: l.connections })) }
  } catch {
    return null
  }
}

/** Seats someone joining now would get: free places before a round, bots to replace during one. */
export function openSeats(r: RoomInfo): number {
  if (r.world === 'sandbox') return Math.max(0, r.capacity - r.players)
  return r.phase === 'playing' ? r.bots : Math.max(0, r.capacity - r.players)
}

/** Where Quick play goes: the fullest arena lobby with room, else a round with a bot seat, else none. */
export function bestRoom(rooms: RoomInfo[]): RoomInfo | null {
  const arenas = rooms.filter((r) => r.world === 'arena' && openSeats(r) > 0)
  const lobby = arenas.filter((r) => r.phase === 'waiting' || r.phase === 'countdown').sort((a, b) => b.players - a.players)[0]
  return lobby ?? arenas.filter((r) => r.phase === 'playing').sort((a, b) => b.players - a.players)[0] ?? null
}

export function statusLabel(r: RoomInfo): string {
  if (r.world === 'sandbox') return 'Sandbox'
  if (r.phase === 'waiting') return 'Waiting for players'
  if (r.phase === 'countdown') return 'Starting'
  if (r.phase === 'playing') return r.bots > 0 ? `In game, ${r.bots} bot ${r.bots === 1 ? 'seat' : 'seats'} to take` : 'In game, full'
  return 'Round over'
}

/** A link that opens the menu ready to join this room. */
export function inviteLink(room: string, options: { private?: boolean; fast?: boolean } = {}): string {
  const q = new URLSearchParams({ room })
  if (options.private) q.set('private', '1')
  if (options.fast) q.set('fast', '1')
  return `${location.origin}${location.pathname}?${q}`
}

const WORDS_A = ['oak', 'iron', 'gold', 'ember', 'frost', 'moss', 'sky', 'dune', 'stone', 'lava']
const WORDS_B = ['fox', 'wolf', 'hawk', 'bear', 'owl', 'lynx', 'crab', 'bee', 'toad', 'yak']

/** A short name for a new room, easy to read out to a friend. */
export function randomRoomName(random: () => number = Math.random): string {
  const pick = (list: string[]) => list[Math.floor(random() * list.length)]
  return `${pick(WORDS_A)}-${pick(WORDS_B)}-${10 + Math.floor(random() * 90)}`
}

/** Room names as the server keeps them (it drops anything else). */
export function cleanRoomName(name: string): string {
  return name.replace(/[^a-z0-9-]/gi, '').slice(0, 32)
}
