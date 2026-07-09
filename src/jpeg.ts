// Baseline JPEG encoder (spec §13): standard quantization tables scaled by
// quality, ITU-T T.81 default Huffman tables, 4:4:4 sampling. Alpha is
// composited over white (JPEG has no alpha channel).

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52,
  45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
]

const STD_LUM_QT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
]

const STD_CHR_QT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
]

// standard Huffman tables (Annex K)
const DC_LUM_CODES = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
const DC_LUM_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const DC_CHR_CODES = [0, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0]
const DC_CHR_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
const AC_LUM_CODES = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d]
const AC_LUM_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
  0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
  0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]
const AC_CHR_CODES = [0, 0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77]
const AC_CHR_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71,
  0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0,
  0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
  0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48,
  0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
  0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5,
  0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3,
  0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
  0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
]

type HuffTable = Map<number, { code: number; len: number }>

/**
 * Builds a canonical Huffman code → symbol table from a JPEG DHT-style spec:
 * `codes[len]` = how many codes of bit-length `len` (1..16), `vals` = the
 * symbols in code order (ITU-T T.81 Annex C).
 */
const buildHuff = (codes: number[], vals: number[]): HuffTable => {
  const table: HuffTable = new Map()
  let code = 0
  let k = 0
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < (codes[len] ?? 0); i++) {
      table.set(vals[k] ?? 0, { code, len })
      code++
      k++
    }
    code <<= 1
  }
  return table
}
/**
 * MSB-first bitstream packer with JPEG byte stuffing (every literal `0xff` byte
 * is followed by a `0x00` so it can't be mistaken for a marker).
 */
class BitWriter {
  readonly #bytes: number[] = []
  #acc = 0
  #bits = 0

  write = (code: number, len: number): void => {
    this.#acc = (this.#acc << len) | (code & ((1 << len) - 1))
    this.#bits += len
    while (this.#bits >= 8) {
      this.#bits -= 8
      const b = (this.#acc >> this.#bits) & 0xff
      this.#bytes.push(b)
      if (b === 0xff) {
        this.#bytes.push(0) // byte stuffing
      }
    }
  }

  flush = (): void => {
    if (this.#bits > 0) {
      const pad = 8 - this.#bits
      this.write((1 << pad) - 1, pad)
    }
  }

  data = (): number[] => this.#bytes
}

const fdct = (block: Float64Array): Float64Array => {
  // separable 1D DCT-II rows then columns (double precision; deterministic
  // given a fixed language version — jpeg output is lossy anyway)
  const out = new Float64Array(64)
  const tmp = new Float64Array(64)
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let x = 0; x < 8; x++) {
        s += (block[y * 8 + x] ?? 0) * (COS[x * 8 + u] ?? 0)
      }
      tmp[y * 8 + u] = s
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0
      for (let y = 0; y < 8; y++) {
        s += (tmp[y * 8 + u] ?? 0) * (COS[y * 8 + v] ?? 0)
      }
      out[v * 8 + u] = s * (ALPHA[u] ?? 1) * (ALPHA[v] ?? 1) * 0.25
    }
  }
  return out
}

// fixed cosine table (evaluated once from doubles — pinned by version)
const COS: number[] = (() => {
  const t: number[] = []
  for (let x = 0; x < 8; x++) {
    for (let u = 0; u < 8; u++) {
      t.push(Math.cos(((2 * x + 1) * u * Math.PI) / 16))
    }
  }
  return t
})()
const ALPHA: number[] = (() => {
  const t: number[] = []
  for (let u = 0; u < 8; u++) {
    t.push(u === 0 ? 1 / Math.SQRT2 : 1)
  }
  return t
})()

/** JPEG "magnitude category": the number of bits needed to represent `|v|`. */
const bitLen = (v: number): number => {
  let n = Math.abs(v)
  let len = 0
  while (n > 0) {
    n >>= 1
    len++
  }
  return len
}

/**
 * Baseline JPEG: single scan, Huffman entropy coding, 8-bit precision, no
 * progressive/arithmetic coding, 4:4:4 sampling (no chroma subsampling — spec
 * §13). `quality` is 1-100 (libjpeg-style scale, clamped) and linearly scales
 * the standard ITU-T T.81 Annex K quantization tables; lower means smaller and
 * lossier. `data` is straight-alpha RGBA8; alpha is composited over white
 * before encoding since JPEG carries no alpha channel, so exporting to JPEG is
 * a one-way, transparency-losing conversion. Deterministic for a fixed engine
 * version (same pixels + quality ⇒ same bytes), but JPEG is never treated as a
 * determinism *boundary*: pixel-identity guarantees don't cross a JPEG
 * round-trip, and `import` accepts PNG only, never JPEG, for exactly that
 * reason (ADR-0007, ADR-0045).
 */
export const encodeJpeg = (data: Uint8Array, w: number, h: number, quality = 80): Uint8Array => {
  const q = Math.max(1, Math.min(100, quality))
  const scale = q < 50 ? Math.floor(5000 / q) : 200 - q * 2
  const scaleQt = (base: number[]): number[] =>
    base.map((v) => Math.max(1, Math.min(255, Math.floor((v * scale + 50) / 100))))
  const qtY = scaleQt(STD_LUM_QT)
  const qtC = scaleQt(STD_CHR_QT)

  const dcY = buildHuff(DC_LUM_CODES, DC_LUM_VALS)
  const acY = buildHuff(AC_LUM_CODES, AC_LUM_VALS)
  const dcC = buildHuff(DC_CHR_CODES, DC_CHR_VALS)
  const acC = buildHuff(AC_CHR_CODES, AC_CHR_VALS)

  const bw = new BitWriter()
  let prevY = 0
  let prevCb = 0
  let prevCr = 0

  const encodeBlock = (
    block: Float64Array,
    qt: number[],
    dc: HuffTable,
    ac: HuffTable,
    prevDC: number,
  ): number => {
    const f = fdct(block)
    const zz = new Int32Array(64)
    for (let i = 0; i < 64; i++) {
      const v = (f[ZIGZAG[i] ?? 0] ?? 0) / (qt[ZIGZAG[i] ?? 0] ?? 1)
      zz[i] = Math.round(v)
    }
    const dcVal = zz[0] ?? 0
    const diff = dcVal - prevDC
    const dl = bitLen(diff)
    const dcode = dc.get(dl)
    if (dcode) {
      bw.write(dcode.code, dcode.len)
    }
    if (dl > 0) {
      bw.write(diff < 0 ? diff + (1 << dl) - 1 : diff, dl)
    }
    let run = 0
    for (let i = 1; i < 64; i++) {
      const v = zz[i] ?? 0
      if (v === 0) {
        run++
        continue
      }
      while (run > 15) {
        const zrl = ac.get(0xf0)
        if (zrl) {
          bw.write(zrl.code, zrl.len)
        }
        run -= 16
      }
      const l = bitLen(v)
      const sym = ac.get((run << 4) | l)
      if (sym) {
        bw.write(sym.code, sym.len)
      }
      bw.write(v < 0 ? v + (1 << l) - 1 : v, l)
      run = 0
    }
    if (run > 0) {
      const eob = ac.get(0x00)
      if (eob) {
        bw.write(eob.code, eob.len)
      }
    }
    return dcVal
  }

  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      const Y = new Float64Array(64)
      const Cb = new Float64Array(64)
      const Cr = new Float64Array(64)
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(w - 1, bx + x)
          const sy = Math.min(h - 1, by + y)
          const i = (sy * w + sx) * 4
          const a = (data[i + 3] ?? 0) / 255
          // composite over white
          const r = (data[i] ?? 0) * a + 255 * (1 - a)
          const g = (data[i + 1] ?? 0) * a + 255 * (1 - a)
          const b = (data[i + 2] ?? 0) * a + 255 * (1 - a)
          Y[y * 8 + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128
          Cb[y * 8 + x] = -0.168736 * r - 0.331264 * g + 0.5 * b
          Cr[y * 8 + x] = 0.5 * r - 0.418688 * g - 0.081312 * b
        }
      }
      prevY = encodeBlock(Y, qtY, dcY, acY, prevY)
      prevCb = encodeBlock(Cb, qtC, dcC, acC, prevCb)
      prevCr = encodeBlock(Cr, qtC, dcC, acC, prevCr)
    }
  }
  bw.flush()

  const out: number[] = []
  const u16 = (v: number): void => {
    out.push((v >> 8) & 0xff, v & 0xff)
  }
  const marker = (m: number): void => {
    out.push(0xff, m)
  }
  marker(0xd8) // SOI
  // APP0 JFIF
  marker(0xe0)
  u16(16)
  out.push(0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0)
  // DQT
  marker(0xdb)
  u16(2 + 65 + 65)
  out.push(0)
  for (let i = 0; i < 64; i++) {
    out.push(qtY[ZIGZAG[i] ?? 0] ?? 1)
  }
  out.push(1)
  for (let i = 0; i < 64; i++) {
    out.push(qtC[ZIGZAG[i] ?? 0] ?? 1)
  }
  // SOF0
  marker(0xc0)
  u16(8 + 3 * 3)
  out.push(8)
  u16(h)
  u16(w)
  out.push(3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1)
  // DHT
  const dht = (cls: number, id: number, codes: number[], vals: number[]): void => {
    marker(0xc4)
    u16(2 + 1 + 16 + vals.length)
    out.push((cls << 4) | id)
    for (let i = 1; i <= 16; i++) {
      out.push(codes[i] ?? 0)
    }
    for (const v of vals) {
      out.push(v)
    }
  }
  dht(0, 0, DC_LUM_CODES, DC_LUM_VALS)
  dht(1, 0, AC_LUM_CODES, AC_LUM_VALS)
  dht(0, 1, DC_CHR_CODES, DC_CHR_VALS)
  dht(1, 1, AC_CHR_CODES, AC_CHR_VALS)
  // SOS
  marker(0xda)
  u16(6 + 2 * 3)
  out.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0, ...bw.data())
  marker(0xd9) // EOI
  return new Uint8Array(out)
}
