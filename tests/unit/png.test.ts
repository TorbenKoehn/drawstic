import { describe, expect, test } from 'bun:test'
import { deflateSync, inflateSync } from 'node:zlib'
import { type Color, color } from '../../src/color.js'
import { Engine } from '../../src/eval.js'
import { decodePng, encodePngIndexed, encodePngRgba, PngDecodeError } from '../../src/png.js'

// ── hand-crafted PNG byte assembly (mirrors src/png.ts's own chunk layout,
//    but independent so we can build malformed/edge-case inputs). decodePng
//    never validates CRC, so a zero placeholder is fine everywhere. ──────────

const SIG = [137, 80, 78, 71, 13, 10, 26, 10]

const u32be = (n: number): number[] => [
  (n >>> 24) & 0xff,
  (n >>> 16) & 0xff,
  (n >>> 8) & 0xff,
  n & 0xff,
]

const chunkBytes = (type: string, data: number[]): number[] => [
  ...u32be(data.length),
  ...[...type].map((c) => c.codePointAt(0) ?? 0),
  ...data,
  0,
  0,
  0,
  0,
]

const extractChunks = (bytes: Uint8Array, type: string): Uint8Array[] => {
  const out: Uint8Array[] = []
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos)
    const t = String.fromCodePoint(
      bytes[pos + 4] ?? 0,
      bytes[pos + 5] ?? 0,
      bytes[pos + 6] ?? 0,
      bytes[pos + 7] ?? 0,
    )
    if (t === type) {
      out.push(bytes.slice(pos + 8, pos + 8 + len))
    }
    pos += 12 + len
  }
  return out
}

const buildPng = (opts: {
  w: number
  h: number
  bitDepth: number
  colorType: number
  interlace?: number
  plte?: number[]
  trns?: number[]
  raw: number[]
}): Uint8Array => {
  const ihdr = [
    ...u32be(opts.w),
    ...u32be(opts.h),
    opts.bitDepth,
    opts.colorType,
    0,
    0,
    opts.interlace ?? 0,
  ]
  const idat = [...deflateSync(new Uint8Array(opts.raw))]
  const bytes = [
    ...SIG,
    ...chunkBytes('IHDR', ihdr),
    ...(opts.plte ? chunkBytes('PLTE', opts.plte) : []),
    ...(opts.trns ? chunkBytes('tRNS', opts.trns) : []),
    ...chunkBytes('IDAT', idat),
    ...chunkBytes('IEND', []),
  ]
  return new Uint8Array(bytes)
}

const paethPredictor = (a: number, b: number, c: number): number => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) {
    return a
  }
  if (pb <= pc) {
    return b
  }
  return c
}

/** Forward-filters known unfiltered scanline bytes into raw (pre-deflate) PNG
 *  bytes — the inverse of src/png.ts's `paeth`/unfilter loop — so decode tests
 *  can assert exact pixel values for every PNG filter type (0-4). */
const filterScanlines = (rows: number[][], bpp: number, filters: number[]): number[] => {
  const stride = rows[0]?.length ?? 0
  const out: number[] = []
  for (let y = 0; y < rows.length; y++) {
    const f = filters[y] ?? 0
    out.push(f)
    const cur = rows[y] ?? []
    const prev = y > 0 ? rows[y - 1] : null
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? (cur[x - bpp] ?? 0) : 0
      const up = prev ? (prev[x] ?? 0) : 0
      const ul = prev && x >= bpp ? (prev[x - bpp] ?? 0) : 0
      const v = cur[x] ?? 0
      let filtered = v
      if (f === 1) {
        filtered = v - left
      } else if (f === 2) {
        filtered = v - up
      } else if (f === 3) {
        filtered = v - Math.floor((left + up) / 2)
      } else if (f === 4) {
        filtered = v - paethPredictor(left, up, ul)
      }
      out.push(filtered & 0xff)
    }
  }
  return out
}

const px = (
  d: { data: Uint8Array },
  w: number,
  x: number,
  y: number,
): [number, number, number, number] => {
  const i = (y * w + x) * 4
  return [d.data[i] ?? 0, d.data[i + 1] ?? 0, d.data[i + 2] ?? 0, d.data[i + 3] ?? 0]
}

let n = 0

const renderHeart = (): { w: number; h: number; data: Uint8Array; pal: Color[] } => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(
    'draw heart 5x5:\n  palette k=#1a1a1a  r=#c04040\n  pixels:\n    .r.r.\n    rrkrr\n    rrrrr\n    .rrr.\n    ..r..\n',
    `${process.cwd()}\\mem-png-heart${n++}.drw`,
    'mem.drw',
  )
  const entry = mod.definitions.get('heart')
  if (!entry) {
    throw new Error('no heart')
  }
  const sprite = engine.defToSprite(entry, { line: 1, column: 1 })
  return { w: sprite.w, h: sprite.h, data: sprite.data, pal: sprite.pal.map((p) => p.color) }
}

describe('encodePngRgba', () => {
  test('round-trips arbitrary RGBA8 data byte-for-byte', () => {
    const w = 3
    const h = 2
    const data = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 10, 20, 30, 255, 40, 50, 60, 64, 70, 80, 90,
      255,
    ])
    const png = encodePngRgba(data, w, h)
    const decoded = decodePng(png)
    expect(decoded.w).toBe(w)
    expect(decoded.h).toBe(h)
    expect(Buffer.from(decoded.data).equals(Buffer.from(data))).toBe(true)
  })

  test('zlibLevel is just an encode-time tradeoff; decoded pixels are identical', () => {
    const w = 2
    const h = 2
    const data = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255])
    const low = decodePng(encodePngRgba(data, w, h, 0))
    const high = decodePng(encodePngRgba(data, w, h, 9))
    expect(Buffer.from(low.data).equals(Buffer.from(data))).toBe(true)
    expect(Buffer.from(high.data).equals(Buffer.from(data))).toBe(true)
  })

  test('a real rendered sprite round-trips through RGBA PNG', () => {
    const sprite = renderHeart()
    const decoded = decodePng(encodePngRgba(sprite.data, sprite.w, sprite.h))
    expect(decoded.w).toBe(sprite.w)
    expect(decoded.h).toBe(sprite.h)
    expect(Buffer.from(decoded.data).equals(Buffer.from(sprite.data))).toBe(true)
  })
})

describe('encodePngIndexed', () => {
  test('an opaque-only palette omits the tRNS chunk', () => {
    const palette: Color[] = [color(255, 0, 0), color(0, 255, 0)]
    const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])
    const png = encodePngIndexed(data, 2, 1, palette)
    expect(extractChunks(png, 'tRNS').length).toBe(0)
    const decoded = decodePng(png)
    expect(Buffer.from(decoded.data).equals(Buffer.from(data))).toBe(true)
  })

  test('a palette entry with alpha < 255 emits a tRNS chunk and round-trips alpha', () => {
    const palette: Color[] = [color(10, 20, 30, 255), color(40, 50, 60, 128)]
    const data = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128])
    const png = encodePngIndexed(data, 2, 1, palette)
    expect(extractChunks(png, 'tRNS').length).toBe(1)
    const decoded = decodePng(png)
    expect(Buffer.from(decoded.data).equals(Buffer.from(data))).toBe(true)
  })

  test('duplicate palette colors collide in the reverse lookup: the first index wins', () => {
    const palette: Color[] = [color(1, 2, 3), color(1, 2, 3), color(9, 9, 9)]
    const data = new Uint8Array([1, 2, 3, 255])
    const png = encodePngIndexed(data, 1, 1, palette)
    const idat = Buffer.concat(extractChunks(png, 'IDAT').map((c) => Buffer.from(c)))
    const raw = inflateSync(idat)
    expect(raw[0]).toBe(0) // filter byte
    expect(raw[1]).toBe(0) // pixel index — idx 0, not the later duplicate at idx 1
  })

  test('a pixel color absent from the palette silently encodes as index 0', () => {
    const palette: Color[] = [color(255, 0, 0), color(0, 255, 0)]
    const data = new Uint8Array([9, 9, 9, 255])
    const decoded = decodePng(encodePngIndexed(data, 1, 1, palette))
    expect(px(decoded, 1, 0, 0)).toEqual([255, 0, 0, 255])
  })

  test('zlibLevel is just an encode-time tradeoff; decoded pixels are identical', () => {
    const palette: Color[] = [color(1, 1, 1), color(2, 2, 2)]
    const data = new Uint8Array([1, 1, 1, 255, 2, 2, 2, 255])
    const low = decodePng(encodePngIndexed(data, 2, 1, palette, 0))
    const high = decodePng(encodePngIndexed(data, 2, 1, palette, 9))
    expect(Buffer.from(low.data).equals(Buffer.from(data))).toBe(true)
    expect(Buffer.from(high.data).equals(Buffer.from(data))).toBe(true)
  })

  test('a real rendered sprite round-trips through indexed PNG using its own palette', () => {
    const sprite = renderHeart()
    const palette: Color[] = [color(0, 0, 0, 0), ...sprite.pal]
    const decoded = decodePng(encodePngIndexed(sprite.data, sprite.w, sprite.h, palette))
    expect(Buffer.from(decoded.data).equals(Buffer.from(sprite.data))).toBe(true)
  })
})

describe('decodePng error paths', () => {
  // Every failure mode is a structured PngDecodeError (a stable `code`), never a bare `Error` —
  // callers at the `import`/`--diff` boundary rewrap it into a positioned DrawsticError (E027).
  test('rejects a bad signature', () => {
    expect(() => decodePng(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))).toThrow('not a PNG file')
    let caught: unknown
    try {
      decodePng(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(PngDecodeError)
    expect((caught as PngDecodeError).code).toBe('bad-signature')
  })

  test('rejects interlaced (Adam7) images', () => {
    const raw = filterScanlines([[100]], 1, [0])
    const png = buildPng({ w: 1, h: 1, bitDepth: 8, colorType: 0, interlace: 1, raw })
    expect(() => decodePng(png)).toThrow('Adam7-interlaced PNGs are not supported')
    let caught: unknown
    try {
      decodePng(png)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(PngDecodeError)
    expect((caught as PngDecodeError).code).toBe('interlaced')
  })

  test('rejects an unrecognized filter byte', () => {
    const png = buildPng({ w: 1, h: 1, bitDepth: 8, colorType: 0, raw: [5, 0] })
    expect(() => decodePng(png)).toThrow(/unknown PNG filter 5/)
    let caught: unknown
    try {
      decodePng(png)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(PngDecodeError)
    expect((caught as PngDecodeError).code).toBe('bad-filter')
  })
})

describe('decodePng colour types, bit depths, and filters', () => {
  test('colorType 0 (greyscale) bitDepth 8: None then Sub filter', () => {
    const raw = filterScanlines(
      [
        [10, 20, 30],
        [15, 20, 25],
      ],
      1,
      [0, 1],
    )
    const decoded = decodePng(buildPng({ w: 3, h: 2, bitDepth: 8, colorType: 0, raw }))
    expect(px(decoded, 3, 0, 0)).toEqual([10, 10, 10, 255])
    expect(px(decoded, 3, 1, 0)).toEqual([20, 20, 20, 255])
    expect(px(decoded, 3, 2, 0)).toEqual([30, 30, 30, 255])
    expect(px(decoded, 3, 0, 1)).toEqual([15, 15, 15, 255])
    expect(px(decoded, 3, 1, 1)).toEqual([20, 20, 20, 255])
    expect(px(decoded, 3, 2, 1)).toEqual([25, 25, 25, 255])
  })

  test('colorType 2 (truecolor) bitDepth 8: Paeth filter exercises all three predictor branches', () => {
    // second pixel of row1, per channel, is engineered so the Paeth predictor
    // (left, up, upper-left) picks `a`, then `b`, then `c` respectively.
    const row0 = [50, 0, 50, 50, 10, 100]
    const row1 = [50, 0, 0, 60, 77, 33]
    const raw = filterScanlines([row0, row1], 3, [0, 4])
    const decoded = decodePng(buildPng({ w: 2, h: 2, bitDepth: 8, colorType: 2, raw }))
    expect(px(decoded, 2, 0, 0)).toEqual([50, 0, 50, 255])
    expect(px(decoded, 2, 1, 0)).toEqual([50, 10, 100, 255])
    expect(px(decoded, 2, 0, 1)).toEqual([50, 0, 0, 255])
    expect(px(decoded, 2, 1, 1)).toEqual([60, 77, 33, 255])
  })

  test('colorType 0 (greyscale) bitDepth 1: sub-byte packing with the Up filter', () => {
    const raw = filterScanlines([[89], [240]], 1, [0, 2])
    const decoded = decodePng(buildPng({ w: 8, h: 2, bitDepth: 1, colorType: 0, raw }))
    const row0 = [0, 255, 0, 255, 255, 0, 0, 255]
    const row1 = [255, 255, 255, 255, 0, 0, 0, 0]
    for (let x = 0; x < 8; x++) {
      expect(px(decoded, 8, x, 0)).toEqual([row0[x] ?? 0, row0[x] ?? 0, row0[x] ?? 0, 255])
      expect(px(decoded, 8, x, 1)).toEqual([row1[x] ?? 0, row1[x] ?? 0, row1[x] ?? 0, 255])
    }
  })

  test('colorType 2 (truecolor) bitDepth 8: Average filter', () => {
    const raw = filterScanlines(
      [
        [10, 20, 30, 200, 150, 100],
        [12, 22, 32, 202, 152, 102],
      ],
      3,
      [0, 3],
    )
    const decoded = decodePng(buildPng({ w: 2, h: 2, bitDepth: 8, colorType: 2, raw }))
    expect(px(decoded, 2, 0, 0)).toEqual([10, 20, 30, 255])
    expect(px(decoded, 2, 1, 0)).toEqual([200, 150, 100, 255])
    expect(px(decoded, 2, 0, 1)).toEqual([12, 22, 32, 255])
    expect(px(decoded, 2, 1, 1)).toEqual([202, 152, 102, 255])
  })

  test('colorType 3 (indexed) bitDepth 8: PLTE + partial tRNS with the Up filter', () => {
    const raw = filterScanlines(
      [
        [0, 1, 2],
        [1, 1, 0],
      ],
      1,
      [0, 2],
    )
    const plte = [10, 20, 30, 40, 50, 60, 70, 80, 90]
    const trns = [255, 128] // idx2 has no entry -> falls back to opaque
    const decoded = decodePng(buildPng({ w: 3, h: 2, bitDepth: 8, colorType: 3, plte, trns, raw }))
    expect(px(decoded, 3, 0, 0)).toEqual([10, 20, 30, 255])
    expect(px(decoded, 3, 1, 0)).toEqual([40, 50, 60, 128])
    expect(px(decoded, 3, 2, 0)).toEqual([70, 80, 90, 255])
    expect(px(decoded, 3, 0, 1)).toEqual([40, 50, 60, 128])
    expect(px(decoded, 3, 1, 1)).toEqual([40, 50, 60, 128])
    expect(px(decoded, 3, 2, 1)).toEqual([10, 20, 30, 255])
  })

  test('colorType 3 (indexed) bitDepth 4: two indices packed per byte, no tRNS at all', () => {
    const plte: number[] = []
    for (let i = 0; i < 16; i++) {
      plte.push(i * 10, i * 10, i * 10)
    }
    // indices 0, 5, 10, 15 packed MSB-first two-per-byte: 0x05, 0xAF
    const raw = filterScanlines([[0x05, 0xaf]], 1, [0])
    const decoded = decodePng(buildPng({ w: 4, h: 1, bitDepth: 4, colorType: 3, plte, raw }))
    expect(px(decoded, 4, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(decoded, 4, 1, 0)).toEqual([50, 50, 50, 255])
    expect(px(decoded, 4, 2, 0)).toEqual([100, 100, 100, 255])
    expect(px(decoded, 4, 3, 0)).toEqual([150, 150, 150, 255])
  })

  test('colorType 4 (greyscale+alpha) bitDepth 8', () => {
    const raw = filterScanlines([[100, 200, 50, 10]], 2, [0])
    const decoded = decodePng(buildPng({ w: 2, h: 1, bitDepth: 8, colorType: 4, raw }))
    expect(px(decoded, 2, 0, 0)).toEqual([100, 100, 100, 200])
    expect(px(decoded, 2, 1, 0)).toEqual([50, 50, 50, 10])
  })

  test('colorType 4 (greyscale+alpha) bitDepth 16 samples the high byte', () => {
    const raw = filterScanlines([[200, 0, 77, 0]], 4, [0])
    const decoded = decodePng(buildPng({ w: 1, h: 1, bitDepth: 16, colorType: 4, raw }))
    expect(px(decoded, 1, 0, 0)).toEqual([200, 200, 200, 77])
  })

  test('colorType 6 (truecolor+alpha) bitDepth 16 samples the high byte', () => {
    const raw = filterScanlines([[10, 0, 20, 0, 30, 0, 255, 0]], 8, [0])
    const decoded = decodePng(buildPng({ w: 1, h: 1, bitDepth: 16, colorType: 6, raw }))
    expect(px(decoded, 1, 0, 0)).toEqual([10, 20, 30, 255])
  })

  test('multiple IDAT chunks are concatenated before inflating', () => {
    const raw = filterScanlines([[1, 2, 3, 4, 5, 6]], 1, [0])
    const idat = deflateSync(new Uint8Array(raw))
    const mid = Math.floor(idat.length / 2)
    const bytes = new Uint8Array([
      ...SIG,
      ...chunkBytes('IHDR', [...u32be(6), ...u32be(1), 8, 0, 0, 0, 0]),
      ...chunkBytes('IDAT', [...idat.subarray(0, mid)]),
      ...chunkBytes('IDAT', [...idat.subarray(mid)]),
      ...chunkBytes('IEND', []),
    ])
    const decoded = decodePng(bytes)
    expect(decoded.w).toBe(6)
    expect(decoded.h).toBe(1)
    for (let x = 0; x < 6; x++) {
      const v = x + 1
      expect(px(decoded, 6, x, 0)).toEqual([v, v, v, 255])
    }
  })
})
