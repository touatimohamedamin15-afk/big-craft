/**
 * How a game's messages go on the wire. A game encodes its hot messages (the
 * per-tick snapshot, the per-tick input) as binary frames and returns null for
 * everything else, which goes as JSON text. Text and binary frames are told
 * apart by the WebSocket itself, so no message needs a marker for which it is.
 */
export interface MessageCodec<ClientMsg = unknown, ServerMsg = unknown> {
  encodeServer(msg: ServerMsg): Bytes | null
  decodeServer(bytes: Uint8Array): ServerMsg
  encodeClient(msg: ClientMsg): Bytes | null
  /** Throws on malformed bytes; the host drops the message. */
  decodeClient(bytes: Uint8Array): ClientMsg
}

/** An encoded message (backed by a plain ArrayBuffer, so the DOM's WebSocket takes it). */
export type Bytes = Uint8Array<ArrayBuffer>

/** Everything as JSON text. */
export const jsonCodec: MessageCodec<never, never> = {
  encodeServer: () => null,
  decodeServer: () => {
    throw new Error('Unexpected binary message')
  },
  encodeClient: () => null,
  decodeClient: () => {
    throw new Error('Unexpected binary message')
  },
}

/** A message as it goes on the wire: the codec's bytes, or JSON text. */
export function toWire<M>(encode: (msg: M) => Bytes | null, msg: M): string | Bytes {
  return encode(msg) ?? JSON.stringify(msg)
}

export function fromWire<M>(decode: (bytes: Uint8Array) => M, data: string | Uint8Array): M {
  return typeof data === 'string' ? JSON.parse(data) : decode(data)
}

const utf8 = new TextEncoder()
const utf8Decoder = new TextDecoder()

/** Appends little-endian numbers, LEB128 varints and length-prefixed UTF-8 to a growing buffer. */
export class ByteWriter {
  private bytes = new Uint8Array(256)
  private view = new DataView(this.bytes.buffer)
  private length = 0

  private reserve(n: number) {
    if (this.length + n <= this.bytes.length) return
    const next = new Uint8Array(Math.max(this.bytes.length * 2, this.length + n))
    next.set(this.bytes.subarray(0, this.length))
    this.bytes = next
    this.view = new DataView(next.buffer)
  }

  u8(v: number): this {
    this.reserve(1)
    this.bytes[this.length++] = v
    return this
  }

  /** A non-negative integer up to 2^53, seven bits a byte. */
  uint(v: number): this {
    while (v >= 0x80) {
      this.u8((v % 0x80) | 0x80)
      v = Math.floor(v / 0x80)
    }
    return this.u8(v)
  }

  /** A signed integer, zigzagged so small magnitudes stay short. */
  int(v: number): this {
    return this.uint(v >= 0 ? v * 2 : -v * 2 - 1)
  }

  bool(v: boolean): this {
    return this.u8(v ? 1 : 0)
  }

  f32(v: number): this {
    this.reserve(4)
    this.view.setFloat32(this.length, v, true)
    this.length += 4
    return this
  }

  f64(v: number): this {
    this.reserve(8)
    this.view.setFloat64(this.length, v, true)
    this.length += 8
    return this
  }

  string(v: string): this {
    const b = utf8.encode(v)
    this.uint(b.length)
    this.reserve(b.length)
    this.bytes.set(b, this.length)
    this.length += b.length
    return this
  }

  /** A string or null in one length prefix (0 is null). */
  stringOrNull(v: string | null): this {
    if (v === null) return this.u8(0)
    const b = utf8.encode(v)
    this.uint(b.length + 1)
    this.reserve(b.length)
    this.bytes.set(b, this.length)
    this.length += b.length
    return this
  }

  finish(): Bytes {
    return this.bytes.slice(0, this.length)
  }
}

/** Reads what ByteWriter wrote; throws a RangeError past the end. */
export class ByteReader {
  private view: DataView
  private at = 0

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  get done(): boolean {
    return this.at === this.bytes.length
  }

  private take(n: number): number {
    const at = this.at
    if (at + n > this.bytes.length) throw new RangeError('Message ends early')
    this.at += n
    return at
  }

  u8(): number {
    return this.bytes[this.take(1)]
  }

  uint(): number {
    let v = 0
    let scale = 1
    for (;;) {
      const b = this.u8()
      v += (b & 0x7f) * scale
      if (b < 0x80) return v
      scale *= 0x80
      if (scale > 2 ** 53) throw new RangeError('Varint too long')
    }
  }

  int(): number {
    const v = this.uint()
    return v % 2 === 0 ? v / 2 : -(v + 1) / 2
  }

  bool(): boolean {
    return this.u8() !== 0
  }

  f32(): number {
    return this.view.getFloat32(this.take(4), true)
  }

  f64(): number {
    return this.view.getFloat64(this.take(8), true)
  }

  string(): string {
    const n = this.uint()
    const at = this.take(n)
    return utf8Decoder.decode(this.bytes.subarray(at, at + n))
  }

  stringOrNull(): string | null {
    const n = this.uint()
    if (n === 0) return null
    const at = this.take(n - 1)
    return utf8Decoder.decode(this.bytes.subarray(at, at + n - 1))
  }
}
