import { fromWire, toWire, type MessageCodec } from '../engine/net/codec'
import { fromBase64, toBase64 } from '../engine/world'

// ASCII streams keep fragment sizes independent of JSON escaping and Unicode.
// A frame is <=12 KiB including our envelope, below realtime's 16 KiB limit.
export const FRAME_BYTES = 12_000
export const MAX_BUFFER = 512_000
export const FLUSH_MS = 100
export const MAX_PLAYERS = 4
export const RECONNECT_MS = 15_000

export function encode<C, S>(codec: MessageCodec<C, S>, side: 'client' | 'server', message: C | S): string {
  const wire = side === 'client' ? toWire(codec.encodeClient, message as C) : toWire(codec.encodeServer, message as S)
  return (typeof wire === 'string' ? 'j' + toBase64(new TextEncoder().encode(wire)) : 'b' + toBase64(wire)) + '\n'
}

export function decode<C, S>(codec: MessageCodec<C, S>, side: 'client' | 'server', line: string): C | S {
  if (line[0] !== 'j' && line[0] !== 'b') throw new Error('Invalid game packet')
  const bytes = fromBase64(line.slice(1))
  const wire = line[0] === 'j' ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : bytes
  return side === 'client' ? fromWire(codec.decodeClient, wire) : fromWire(codec.decodeServer, wire)
}

export class Outbox {
  private text = ''
  private offset = 0
  push(text: string) {
    if (this.text.length + text.length > MAX_BUFFER) throw new Error('Game traffic exceeded the room budget. Start a new room with fewer players.')
    this.text += text
  }
  peek(size: number): [number, string] { return [this.offset, this.text.slice(0, size)] }
  consume(size: number) { this.text = this.text.slice(size); this.offset += size }
}

export class Inbox {
  private text = ''
  private offset = 0
  read(offset: number, data: string): string[] {
    if (offset !== this.offset || typeof data !== 'string' || data.length > FRAME_BYTES || this.text.length + data.length > MAX_BUFFER)
      throw new Error('Game stream interrupted. Rejoin for a fresh snapshot.')
    this.offset += data.length
    this.text += data
    const lines = this.text.split('\n')
    this.text = lines.pop()!
    return lines
  }
}
