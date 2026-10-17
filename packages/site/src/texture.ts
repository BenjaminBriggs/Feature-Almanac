import { deflateSync } from 'node:zlib'

/**
 * The page's background texture: a square of `cells` × `cells` pixels, each one grid cell, all mid-grey
 * with a random opacity. Mid-grey lightens the dark theme and darkens the light one, so one image serves both;
 * the page scales it up without smoothing and sets its overall strength per theme.
 * The same seed always gives the same image, so builds are reproducible.
 */
export function pixelGridPng(cells = 64, seed = 0x5eed): Buffer {
  const random = mulberry32(seed)
  const rows: Buffer[] = []
  for (let y = 0; y < cells; y++) {
    const row = Buffer.alloc(1 + cells * 2)
    for (let x = 0; x < cells; x++) {
      // Squared, so most cells sit near the background and a few stand out.
      const alpha = Math.round(random() ** 2 * 255)
      row[1 + x * 2] = 128
      row[2 + x * 2] = alpha
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(cells, 0)
  header.writeUInt32BE(cells, 4)
  header[8] = 8 // bit depth
  header[9] = 4 // greyscale with alpha
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

export function pixelGridDataUri(): string {
  return `data:image/png;base64,${pixelGridPng().toString('base64')}`
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let c = 0xffffffff
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
