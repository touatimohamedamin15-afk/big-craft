// Draws the app icon (a pixel-art bed on a sky tile) and writes build/icon.png
// at 512×512, the size electron-builder turns into .icns/.ico. Run: node scripts/make-icon.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const ART = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
  '..WWWW..........',
  '.WwwwwWRRRRRRRR.',
  '.WwwwwRrrrrrrrR.',
  '.WRRRRRRRRRRRRR.',
  '.RRRRRRRRRRRRRR.',
  '.BbbbbbbbbbbbbB.',
  '.BB..........BB.',
  '.BB..........BB.',
  '................',
  '................',
]
const PALETTE = { '.': null, W: [238, 238, 238], w: [255, 255, 255], R: [176, 52, 46], r: [224, 71, 62], B: [120, 86, 50], b: [180, 138, 82] }
const SIZE = 512
const CELL = SIZE / 16
const px = new Uint8Array(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++)
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    // A rounded-square sky tile behind the bed.
    const inset = 24
    const inside = x >= inset && y >= inset && x < SIZE - inset && y < SIZE - inset
    const t = y / SIZE
    const sky = [Math.round(80 + 110 * t), Math.round(140 + 80 * t), 230]
    const cell = ART[Math.floor(y / CELL)][Math.floor(x / CELL)]
    const c = PALETTE[cell]
    const rgb = c ?? (inside ? sky : null)
    if (!rgb) continue
    px[i] = rgb[0]
    px[i + 1] = rgb[1]
    px[i + 2] = rgb[2]
    px[i + 3] = 255
  }

function crc32(buf) {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE)
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
writeFileSync(new URL('../build/icon.png', import.meta.url), png)
console.log(`build/icon.png (${png.length} bytes)`)
