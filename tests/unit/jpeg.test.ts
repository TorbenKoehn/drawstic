import { describe, expect, test } from 'bun:test'
import { encodeJpeg } from '../../src/jpeg.js'

type Segment = { readonly marker: number; readonly payload: Uint8Array }

/** Walks JPEG marker segments (SOI/APPn/DQT/SOF0/DHT/SOS) up to and including
 *  the SOS header — entropy-coded scan data follows SOS and is byte-stuffed,
 *  so it is not itself marker-structured and parsing stops there. */
const parseMarkers = (bytes: Uint8Array): Segment[] => {
  const out: Segment[] = []
  let pos = 0
  while (pos + 1 < bytes.length) {
    if (bytes[pos] !== 0xff) {
      pos++
      continue
    }
    const marker = bytes[pos + 1] ?? 0
    if (marker === 0xd8 || marker === 0xd9) {
      out.push({ marker, payload: new Uint8Array(0) })
      pos += 2
      continue
    }
    const len = ((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0)
    const payload = bytes.slice(pos + 4, pos + 2 + len)
    out.push({ marker, payload })
    if (marker === 0xda) {
      break
    }
    pos += 2 + len
  }
  return out
}

const solidImage = (
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  a: number,
): Uint8Array => {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = a
  }
  return data
}

describe('encodeJpeg', () => {
  test('starts with SOI and ends with EOI', () => {
    const jpeg = encodeJpeg(solidImage(8, 8, 200, 100, 50, 255), 8, 8)
    expect(jpeg[0]).toBe(0xff)
    expect(jpeg[1]).toBe(0xd8)
    expect(jpeg.at(-2)).toBe(0xff)
    expect(jpeg.at(-1)).toBe(0xd9)
  })

  test('marker structure: SOI, APP0/JFIF, DQT, SOF0, four DHT, SOS', () => {
    const jpeg = encodeJpeg(solidImage(16, 16, 100, 100, 100, 255), 16, 16, 75)
    const segs = parseMarkers(jpeg)
    expect(segs.map((s) => s.marker)).toEqual([
      0xd8, 0xe0, 0xdb, 0xc0, 0xc4, 0xc4, 0xc4, 0xc4, 0xda,
    ])

    const app0 = segs[1]?.payload ?? new Uint8Array(0)
    expect([...app0.slice(0, 5)]).toEqual([0x4a, 0x46, 0x49, 0x46, 0]) // 'JFIF\0'

    const sof0 = segs.find((s) => s.marker === 0xc0)
    expect(sof0?.payload[0]).toBe(8) // 8-bit precision
    const height = ((sof0?.payload[1] ?? 0) << 8) | (sof0?.payload[2] ?? 0)
    const width = ((sof0?.payload[3] ?? 0) << 8) | (sof0?.payload[4] ?? 0)
    expect(height).toBe(16)
    expect(width).toBe(16)
    expect(sof0?.payload[5]).toBe(3) // 3 components (Y, Cb, Cr)

    const dhts = segs.filter((s) => s.marker === 0xc4)
    expect(dhts.map((s) => s.payload[0])).toEqual([0x00, 0x10, 0x01, 0x11])

    const sos = segs.find((s) => s.marker === 0xda)
    expect([...(sos?.payload ?? [])]).toEqual([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0])
  })

  test('quality scales the DQT tables: quality 1 clamps to 255, quality 100 clamps to 1', () => {
    const data = solidImage(8, 8, 128, 128, 128, 255)
    const low = parseMarkers(encodeJpeg(data, 8, 8, 1)).find((s) => s.marker === 0xdb)?.payload
    const high = parseMarkers(encodeJpeg(data, 8, 8, 100)).find((s) => s.marker === 0xdb)?.payload
    expect(low).toBeDefined()
    expect(high).toBeDefined()
    if (!low || !high) {
      return
    }
    expect([...low.slice(1, 65)].every((v) => v === 255)).toBe(true)
    expect([...low.slice(66, 130)].every((v) => v === 255)).toBe(true)
    expect([...high.slice(1, 65)].every((v) => v === 1)).toBe(true)
    expect([...high.slice(66, 130)].every((v) => v === 1)).toBe(true)
  })

  test('quality is clamped to [1, 100]', () => {
    const data = solidImage(8, 8, 90, 90, 90, 255)
    expect(
      Buffer.from(encodeJpeg(data, 8, 8, 0)).equals(Buffer.from(encodeJpeg(data, 8, 8, 1))),
    ).toBe(true)
    expect(
      Buffer.from(encodeJpeg(data, 8, 8, 1000)).equals(Buffer.from(encodeJpeg(data, 8, 8, 100))),
    ).toBe(true)
  })

  test('quality defaults to 80', () => {
    const data = solidImage(8, 8, 90, 90, 90, 255)
    expect(
      Buffer.from(encodeJpeg(data, 8, 8)).equals(Buffer.from(encodeJpeg(data, 8, 8, 80))),
    ).toBe(true)
  })

  test('fully transparent pixels composite to white: byte-identical to an opaque white image', () => {
    const w = 8
    const h = 8
    const transparentRed = solidImage(w, h, 255, 0, 0, 0)
    const opaqueWhite = solidImage(w, h, 255, 255, 255, 255)
    const a = encodeJpeg(transparentRed, w, h, 90)
    const b = encodeJpeg(opaqueWhite, w, h, 90)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  test('partial alpha blends linearly toward white', () => {
    const w = 8
    const h = 8
    // r=g=b=0, alpha=128/255 -> composited = 0*a + 255*(1-a) = 255 - 128 = 127 exactly
    const halfBlack = solidImage(w, h, 0, 0, 0, 128)
    const solidGrey = solidImage(w, h, 127, 127, 127, 255)
    const a = encodeJpeg(halfBlack, w, h, 90)
    const b = encodeJpeg(solidGrey, w, h, 90)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  test('non-multiple-of-8 dimensions still encode, padding by clamping to the edge', () => {
    const w = 10
    const h = 6
    const jpeg = encodeJpeg(solidImage(w, h, 50, 150, 250, 255), w, h, 85)
    const segs = parseMarkers(jpeg)
    const sof0 = segs.find((s) => s.marker === 0xc0)
    const height = ((sof0?.payload[1] ?? 0) << 8) | (sof0?.payload[2] ?? 0)
    const width = ((sof0?.payload[3] ?? 0) << 8) | (sof0?.payload[4] ?? 0)
    expect(height).toBe(h)
    expect(width).toBe(w)
    expect(jpeg[0]).toBe(0xff)
    expect(jpeg[1]).toBe(0xd8)
    expect(jpeg.at(-2)).toBe(0xff)
    expect(jpeg.at(-1)).toBe(0xd9)
  })

  test('multi-block images (DC prediction across blocks) encode without error', () => {
    const w = 24
    const h = 16
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        data[i] = x * 10
        data[i + 1] = y * 15
        data[i + 2] = 128
        data[i + 3] = 255
      }
    }
    const jpeg = encodeJpeg(data, w, h, 60)
    const segs = parseMarkers(jpeg)
    expect(segs.map((s) => s.marker)).toEqual([
      0xd8, 0xe0, 0xdb, 0xc0, 0xc4, 0xc4, 0xc4, 0xc4, 0xda,
    ])
    expect(jpeg.at(-2)).toBe(0xff)
    expect(jpeg.at(-1)).toBe(0xd9)
  })
})
