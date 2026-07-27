// PNG encoder (RGBA8 + indexed-color) and decoder (for `import`, ADR-0045).
// Byte determinism is not guaranteed — pixel determinism is (ADR-0007).

import { deflateSync, inflateSync } from 'node:zlib'
import type { Color } from './color.js'

const SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE: number[] = (() => {
  const t: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t.push(c >>> 0)
  }
  return t
})()

const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff
  for (const b of buf) {
    c = ((CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8)) >>> 0
  }
  return (c ^ 0xffffffff) >>> 0
}

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.codePointAt(i) ?? 0
  }
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const len = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/**
 * Encodes an 8-bit RGBA PNG: one IDAT, filter byte 0 (none) on every scanline. `data` is
 * `w × h × 4` straight-alpha RGBA8 (the framebuffer/sprite layout) — PNG itself
 * stores *unassociated* (straight) alpha, so no conversion is needed. `zlibLevel`
 * (0-9) trades encode time for output size only; it does not affect decoded
 * pixels — PNG output is pixel- but not byte-deterministic (ADR-0007).
 */
export const encodePngRgba = (
  data: Uint8Array,
  w: number,
  h: number,
  zlibLevel = 6,
): Uint8Array => {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  // scanlines with filter byte 0
  const raw = new Uint8Array(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0
    raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1)
  }
  const idat = new Uint8Array(deflateSync(raw, { level: zlibLevel }))
  return concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))])
}

/**
 * Indexed-color (PLTE + optional tRNS) PNG. `palette` order becomes PNG palette
 * index order (ADR-0055 pins the caller's build order: transparent, then
 * authored/stamped colours, then any remaining rendered colours). The 256-entry
 * PNG limit and "every rendered colour is representable" are the caller's
 * responsibility to enforce — this function does not validate `palette.length`.
 * Duplicate RGBA entries collide in the reverse lookup: the first index for a
 * given colour wins, later duplicates are unreachable by pixel data. A rendered
 * pixel whose RGBA is absent from `palette` silently encodes as index 0 rather
 * than throwing.
 */
export const encodePngIndexed = (
  data: Uint8Array,
  w: number,
  h: number,
  palette: Color[],
  zlibLevel = 6,
): Uint8Array => {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr[8] = 8
  ihdr[9] = 3 // indexed
  const plte = new Uint8Array(palette.length * 3)
  const trns = new Uint8Array(palette.length)
  let hasAlpha = false
  palette.forEach((c, i) => {
    plte[i * 3] = c.r
    plte[i * 3 + 1] = c.g
    plte[i * 3 + 2] = c.b
    trns[i] = c.a
    if (c.a !== 255) {
      hasAlpha = true
    }
  })
  const lookup = new Map<number, number>()
  palette.forEach((c, i) => {
    const key = (((c.r * 256 + c.g) * 256 + c.b) * 256 + c.a) >>> 0
    if (!lookup.has(key)) {
      lookup.set(key, i)
    }
  })
  const raw = new Uint8Array(h * (1 + w))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w)] = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const key =
        ((((data[i] ?? 0) * 256 + (data[i + 1] ?? 0)) * 256 + (data[i + 2] ?? 0)) * 256 +
          (data[i + 3] ?? 0)) >>>
        0
      raw[y * (1 + w) + 1 + x] = lookup.get(key) ?? 0
    }
  }
  const idat = new Uint8Array(deflateSync(raw, { level: zlibLevel }))
  const chunks = [SIG, chunk('IHDR', ihdr), chunk('PLTE', plte)]
  if (hasAlpha) {
    chunks.push(chunk('tRNS', trns))
  }
  chunks.push(chunk('IDAT', idat), chunk('IEND', new Uint8Array(0)))
  return concat(chunks)
}

// ── decoder (critical chunks; no interlace) ─────────────────────────────────

/** A decoded PNG: `data` is `w × h × 4` straight-alpha RGBA8 — the framebuffer/sprite layout. */
export type DecodedPng = { w: number; h: number; data: Uint8Array }

/**
 * PNG filter-type 4 predictor (Paeth): picks whichever of `left`/`up`/`upper-left`
 * is closest to `left + up - upperLeft`.
 */
const paeth = (a: number, b: number, c: number): number => {
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

/**
 * A structured `decodePng` failure: bad signature, an unsupported Adam7-interlaced image, or an
 * unrecognised filter byte. `decodePng` is a leaf byte-decoder with no source-position context (it
 * only ever sees bytes, never a recipe file/span) so it cannot itself raise a positioned
 * `DrawsticError` (ADR-0030) — but a bare `Error` would lose even the stable failure `code`. This
 * carries that code so a caller with real position context (e.g. the `image` import boundary) can
 * rewrap it into a positioned `DrawsticError` (`ERROR_CODE.pngUnsupported`) without parsing the
 * message text.
 */
export class PngDecodeError extends Error {
  readonly code: 'bad-signature' | 'interlaced' | 'bad-filter'
  constructor(code: PngDecodeError['code'], message: string) {
    super(message)
    this.name = 'PngDecodeError'
    this.code = code
  }
}

/**
 * Decodes a PNG's critical chunks (IHDR/PLTE/tRNS/IDAT/IEND) to straight-alpha
 * RGBA8 — the `import` path (ADR-0045). Supports bit depths 1/2/4/8/16 and every
 * standard colour type (0 greyscale, 2 truecolour, 3 indexed, 4 greyscale+alpha,
 * 6 truecolour+alpha); ancillary chunks are ignored. Inflate + defilter is
 * bit-exact, which is why PNG (unlike JPEG) is safe as a determinism boundary
 * (ADR-0045, ADR-0007). Throws a {@link PngDecodeError} — never a bare `Error`
 * — on a bad signature, an interlaced (Adam7) image (decoding it is out of
 * scope; failing honestly is in scope), or an unrecognised filter byte. The
 * `image NAME = FILE-PATH` boundary (`Engine#loadImage`) catches it and rewraps
 * it as a positioned `DrawsticError` (`ERROR_CODE.pngUnsupported`); `render
 * --diff`'s comparison-PNG boundary (`cli.ts`) rewraps any decode failure as
 * `ERROR_CODE.ioError` instead, since there's no recipe span to attach there.
 */
export const decodePng = (bytes: Uint8Array): DecodedPng => {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIG[i]) {
      throw new PngDecodeError('bad-signature', 'not a PNG file')
    }
  }
  let pos = 8
  let w = 0
  let h = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idats: Uint8Array[] = []
  let plte: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos)
    const type = String.fromCodePoint(
      bytes[pos + 4] ?? 0,
      bytes[pos + 5] ?? 0,
      bytes[pos + 6] ?? 0,
      bytes[pos + 7] ?? 0,
    )
    const data = bytes.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = dv.getUint32(pos + 8)
      h = dv.getUint32(pos + 12)
      bitDepth = data[8] ?? 0
      colorType = data[9] ?? 0
      interlace = data[12] ?? 0
    } else if (type === 'PLTE') {
      plte = data
    } else if (type === 'tRNS') {
      trns = data
    } else if (type === 'IDAT') {
      idats.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (interlace !== 0) {
    throw new PngDecodeError(
      'interlaced',
      'Adam7-interlaced PNGs are not supported — re-export the source image as a ' +
        'non-interlaced (baseline) PNG',
    )
  }
  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8))
  const stride = Math.ceil((w * channels * bitDepth) / 8)
  const raw = new Uint8Array(inflateSync(concat(idats)))
  const lines = new Uint8Array(h * stride)
  // unfilter
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)] ?? 0
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const dst = lines.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const rawB = src[x] ?? 0
      const left = x >= bpp ? (dst[x - bpp] ?? 0) : 0
      const up = prev ? (prev[x] ?? 0) : 0
      const ul = prev && x >= bpp ? (prev[x - bpp] ?? 0) : 0
      let v: number
      switch (f) {
        case 0:
          v = rawB
          break
        case 1:
          v = rawB + left
          break
        case 2:
          v = rawB + up
          break
        case 3:
          v = rawB + Math.floor((left + up) / 2)
          break
        case 4:
          v = rawB + paeth(left, up, ul)
          break
        default:
          throw new PngDecodeError('bad-filter', `unknown PNG filter ${f}`)
      }
      dst[x] = v & 0xff
    }
  }
  // expand to RGBA8
  const out = new Uint8Array(w * h * 4)
  const sample = (row: Uint8Array, idx: number): number => {
    if (bitDepth === 8) {
      return row[idx] ?? 0
    }
    if (bitDepth === 16) {
      return row[idx * 2] ?? 0
    }
    const perByte = 8 / bitDepth
    const b = row[Math.floor(idx / perByte)] ?? 0
    const shift = 8 - bitDepth * ((idx % perByte) + 1)
    const max = (1 << bitDepth) - 1
    return ((b >> shift) & max) * (colorType === 3 ? 1 : 255 / max)
  }
  for (let y = 0; y < h; y++) {
    const row = lines.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (colorType === 0) {
        const v = sample(row, x)
        out[o] = v
        out[o + 1] = v
        out[o + 2] = v
        out[o + 3] = 255
      } else if (colorType === 2) {
        out[o] = sample(row, x * 3)
        out[o + 1] = sample(row, x * 3 + 1)
        out[o + 2] = sample(row, x * 3 + 2)
        out[o + 3] = 255
      } else if (colorType === 3) {
        const idx = sample(row, x)
        out[o] = plte?.[idx * 3] ?? 0
        out[o + 1] = plte?.[idx * 3 + 1] ?? 0
        out[o + 2] = plte?.[idx * 3 + 2] ?? 0
        out[o + 3] = trns?.[idx] ?? 255
      } else if (colorType === 4) {
        const v = sample(row, x * 2)
        out[o] = v
        out[o + 1] = v
        out[o + 2] = v
        out[o + 3] = sample(row, x * 2 + 1)
      } else {
        out[o] = sample(row, x * 4)
        out[o + 1] = sample(row, x * 4 + 1)
        out[o + 2] = sample(row, x * 4 + 2)
        out[o + 3] = sample(row, x * 4 + 3)
      }
    }
  }
  return { w, h, data: out }
}
