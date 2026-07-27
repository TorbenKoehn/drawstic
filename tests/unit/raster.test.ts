import { describe, expect, test } from 'bun:test'
import { color } from '../../src/color.js'
import { type BitmapFont, missingGlyph } from '../../src/fonts.js'
import { Framebuffer } from '../../src/framebuffer.js'
import {
  ambientOcclusion,
  arcPoints,
  bezierPoints,
  type Context,
  catmullRomLoopPoints,
  catmullRomPoints,
  drawText,
  type FontResolved,
  fillRegion,
  filterDither,
  filterGrain,
  filterOutline,
  filterRipple,
  filterShadow,
  filterSpeckle,
  filterTint,
  lightRegion,
  type Paint,
  PixelSink,
  paintAt,
  putPixel,
  quadPoints,
  quant,
  quantInt,
  rimRegion,
  scaleBitmap,
  stampSprite,
  strokeLine,
  strokePath,
  strokeRegion,
  type UserFontResolved,
} from '../../src/raster.js'
import {
  aboutPoint,
  circleRegion,
  compose,
  type Grad,
  IDENTITY,
  multiplyMatrix,
  perspectiveMatrix,
  type Region,
  rectRegion,
  rotationDeg,
  rotationYDeg,
  type Sprite,
  scaling,
  translation,
} from '../../src/values.js'

const ctx = (w: number, h: number, mode: 'pixel' | 'smooth' = 'pixel'): Context => ({
  buffer: new Framebuffer(w, h),
  mask: null,
  mode,
})

const px = (c: Context, x: number, y: number): [number, number, number, number] => {
  const p = c.buffer.get(x, y)
  return [p.r, p.g, p.b, p.a]
}

const black = color(0, 0, 0, 255)
const red = color(255, 0, 0, 255)
const blue = color(0, 0, 255, 255)
const white = color(255, 255, 255, 255)

describe('quant / quantInt', () => {
  test('quant rounds half-up in pixel mode and quantizes to 1/16 in smooth mode', () => {
    expect(quant(1.5, 'pixel')).toBe(2)
    expect(quant(1.4, 'pixel')).toBe(1)
    expect(quant(1.06, 'smooth')).toBeCloseTo(1.0625, 9) // floor(1.06*16+0.5)/16 = 17/16
  })

  test('quantInt rounds half-up', () => {
    expect(quantInt(2.5)).toBe(3)
    expect(quantInt(-2.5)).toBe(-2)
  })
})

describe('paintAt / gradients', () => {
  const bbox = { x0: 0, y0: 0, x1: 9, y1: 9 }

  test('a solid color passes through unchanged', () => {
    expect(paintAt(red, 3, 3, bbox, 'pixel')).toEqual(red)
  })

  test('empty-stop gradient resolves to transparent black', () => {
    const g: Grad = { type: 'grad', kind: 'linear', angle: 0, stops: [], space: 'rgb' }
    expect(paintAt(g, 0, 0, bbox, 'pixel')).toEqual({ type: 'color', r: 0, g: 0, b: 0, a: 0 })
  })

  test('single-stop gradient is constant everywhere (span<=0 branch)', () => {
    const g: Grad = {
      type: 'grad',
      kind: 'linear',
      angle: 0,
      stops: [{ c: red, pos: null }],
      space: 'rgb',
    }
    expect(paintAt(g, 0, 0, bbox, 'smooth')).toEqual(red)
    expect(paintAt(g, 9, 9, bbox, 'smooth')).toEqual(red)
  })

  test('linear gradient interpolates across the bbox, smooth mode rounds', () => {
    const g: Grad = {
      type: 'grad',
      kind: 'linear',
      angle: 90,
      stops: [
        { c: black, pos: 0 },
        { c: white, pos: 1 },
      ],
      space: 'rgb',
    }
    const top = paintAt(g, 5, 0, bbox, 'smooth')
    const bottom = paintAt(g, 5, 9, bbox, 'smooth')
    expect(top.r).toBeLessThan(bottom.r)
  })

  test('linear gradient with explicit stop positions and pixel-mode dithering picks both sides', () => {
    const g: Grad = {
      type: 'grad',
      kind: 'linear',
      angle: 0,
      stops: [
        { c: black, pos: 0 },
        { c: white, pos: 0.5 },
        { c: white, pos: 1 },
      ],
      space: 'rgb',
    }
    // pixel-mode ordered dithering: BAYER4[(y&3)*4+(x&3)] gives different thresholds
    const a = paintAt(g, 0, 0, bbox, 'pixel')
    const b = paintAt(g, 3, 0, bbox, 'pixel')
    expect(a).toBeDefined()
    expect(b).toBeDefined()
  })

  test('radial gradient distance-from-center, and maxR=0 / span=0 degenerate bbox', () => {
    const g: Grad = {
      type: 'grad',
      kind: 'radial',
      angle: 0,
      stops: [
        { c: white, pos: 0 },
        { c: black, pos: 1 },
      ],
      space: 'rgb',
    }
    const center = paintAt(g, 5, 5, bbox, 'smooth')
    const corner = paintAt(g, 0, 0, bbox, 'smooth')
    expect(center.r).toBeGreaterThan(corner.r)
    const point = { x0: 5, y0: 5, x1: 5, y1: 5 }
    expect(paintAt(g, 5, 5, point, 'smooth')).toEqual(white) // maxR===0 -> t=0
    const linearPoint: Grad = { ...g, kind: 'linear' }
    expect(paintAt(linearPoint, 5, 5, point, 'smooth')).toEqual(white) // span===0 -> t=0
  })
})

describe('putPixel / PixelSink', () => {
  test('putPixel is a no-op out of bounds, masked, and honours coverage', () => {
    const c = ctx(4, 4)
    putPixel(c, -1, 0, red, { x0: 0, y0: 0, x1: 3, y1: 3 })
    putPixel(c, 10, 0, red, { x0: 0, y0: 0, x1: 3, y1: 3 })
    expect(px(c, 0, 0)).toEqual([0, 0, 0, 0])

    const masked = ctx(4, 4)
    masked.mask = rectRegion(2, 2, 3, 3)
    putPixel(masked, 0, 0, red, { x0: 0, y0: 0, x1: 3, y1: 3 })
    expect(px(masked, 0, 0)).toEqual([0, 0, 0, 0])
    putPixel(masked, 2, 2, red, { x0: 0, y0: 0, x1: 3, y1: 3 })
    expect(px(masked, 2, 2)).toEqual([255, 0, 0, 255])

    const partial = ctx(4, 4)
    putPixel(partial, 1, 1, black, { x0: 0, y0: 0, x1: 3, y1: 3 }, 0.5)
    expect(px(partial, 1, 1)[3]).toBe(128) // roundHalfUp(255*0.5)
  })

  test('PixelSink dedupes, tracks bbox, and no-ops paint() when empty', () => {
    const sink = new PixelSink()
    sink.add(2, 3)
    sink.add(2, 3)
    expect(sink.xs.length).toBe(1)
    sink.add(5, -1)
    expect(sink.x0).toBe(2)
    expect(sink.y0).toBe(-1)
    expect(sink.x1).toBe(5)
    expect(sink.y1).toBe(3)

    const empty = new PixelSink()
    const c = ctx(2, 2)
    empty.paint(c, red) // no-op, xs.length === 0
    expect(px(c, 0, 0)).toEqual([0, 0, 0, 0])

    const c2 = ctx(4, 4)
    const sink2 = new PixelSink()
    sink2.add(1, 1)
    sink2.add(2, 2)
    sink2.paint(c2, blue)
    expect(px(c2, 1, 1)).toEqual([0, 0, 255, 255])
    expect(px(c2, 2, 2)).toEqual([0, 0, 255, 255])
  })
})

describe('strokeLine / brush', () => {
  test('width<=1 stamps single pixels; width>1 brushes a disc (odd and even)', () => {
    const thin = new PixelSink()
    strokeLine(thin, 0, 0, 3, 0, 1)
    expect(thin.xs.length).toBe(4)

    const oddBrush = new PixelSink()
    strokeLine(oddBrush, 5, 5, 5, 5, 3)
    expect(oddBrush.xs.length).toBeGreaterThan(1)

    const evenBrush = new PixelSink()
    strokeLine(evenBrush, 5, 5, 5, 5, 4)
    expect(evenBrush.xs.length).toBeGreaterThan(1)
  })
})

describe('curve flattening', () => {
  test('quadPoints/bezierPoints include both endpoints and clamp step count', () => {
    const q = quadPoints({ x: 0, y: 0 }, { x: 5, y: 10 }, { x: 10, y: 0 })
    expect(q[0]).toEqual({ x: 0, y: 0 })
    expect(q.at(-1)).toEqual({ x: 10, y: 0 })
    expect(q.length).toBeGreaterThanOrEqual(9) // >= flattenSteps min (8) + 1

    const zeroLen = quadPoints({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 1 })
    expect(zeroLen.length).toBe(9) // flattenSteps floors to the min of 8

    const huge = quadPoints({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 })
    expect(huge.length).toBe(257) // flattenSteps clamps to the max of 256

    const b = bezierPoints({ x: 0, y: 0 }, { x: 3, y: 3 }, { x: 7, y: -3 }, { x: 10, y: 0 })
    expect(b[0]).toEqual({ x: 0, y: 0 })
    expect(b.at(-1)).toEqual({ x: 10, y: 0 })
  })

  test('arcPoints handles zero sweep, negative sweep, and clamps the segment count', () => {
    const zero = arcPoints(0, 0, 5, 45, 45)
    expect(zero.length).toBe(9) // n = max(8, ...) + 1 endpoint

    const neg = arcPoints(0, 0, 5, 90, 0)
    expect(neg[0]).toEqual({ x: 0, y: 5 })

    const big = arcPoints(0, 0, 100, 0, 360)
    expect(big.length).toBe(513) // clamps to n=512 segments
  })
})

describe('catmullRom through-point splines (ADR-0074/0075)', () => {
  type P = { x: number; y: number }
  const near = (a: P | undefined, b: P | undefined, eps = 1e-6): boolean =>
    a !== undefined && b !== undefined && Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps

  test('open curve starts, ends, and passes through every control point', () => {
    const pts: P[] = [
      { x: 0, y: 20 },
      { x: 10, y: 4 },
      { x: 22, y: 16 },
      { x: 34, y: 6 },
    ]
    const out = catmullRomPoints(pts)
    expect(near(out[0], pts[0])).toBe(true) // starts at first
    expect(near(out.at(-1), pts[3])).toBe(true) // ends at last
    // every control point appears (nearly) exactly on the flattened polyline
    for (const cp of pts) {
      expect(out.some((p) => near(p, cp, 1e-4))).toBe(true)
    }
  })

  test('closed loop returns to the first point (closes)', () => {
    const pts: P[] = [
      { x: 4, y: 12 },
      { x: 12, y: 3 },
      { x: 20, y: 12 },
      { x: 12, y: 21 },
    ]
    const loop = catmullRomLoopPoints(pts)
    expect(near(loop[0], pts[0])).toBe(true)
    expect(near(loop.at(-1), pts[0])).toBe(true) // last == first
    for (const cp of pts) {
      expect(loop.some((p) => near(p, cp, 1e-4))).toBe(true)
    }
  })

  test('tessellation is deterministic: two runs are byte-identical', () => {
    const pts = [
      { x: 1, y: 2 },
      { x: 40, y: 5 },
      { x: 12, y: 30 },
      { x: 55, y: 22 },
      { x: 3, y: 18 },
    ]
    expect(catmullRomPoints(pts)).toEqual(catmullRomPoints(pts))
    expect(catmullRomLoopPoints(pts)).toEqual(catmullRomLoopPoints(pts))
  })

  test('segment count per span clamps to [4, 64]; coincident points do not NaN', () => {
    // a long span (>64px chord) is clamped to 64 segments
    const longSpan = catmullRomPoints([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 400, y: 0 },
    ])
    expect(longSpan.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    // coincident control points: knot guard keeps every coordinate finite (no 0/0)
    const dup = catmullRomPoints([
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ])
    expect(dup.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)

    // fewer than the minimum points is returned verbatim
    expect(catmullRomPoints([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }])
    expect(
      catmullRomLoopPoints([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ])
  })
})

describe('strokePath', () => {
  test('connects consecutive points and no-ops on a single-point chain', () => {
    const sink = new PixelSink()
    strokePath(sink, [{ x: 0, y: 0 }], 1)
    expect(sink.xs.length).toBe(0)

    const sink2 = new PixelSink()
    strokePath(
      sink2,
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
      ],
      1,
    )
    expect(sink2.xs.length).toBeGreaterThan(0)
  })

  test('skips over sparse/hole entries in the point array', () => {
    const sink = new PixelSink()
    const pts: { x: number; y: number }[] = []
    pts[0] = { x: 0, y: 0 }
    pts[2] = { x: 5, y: 5 } // index 1 is a hole -> both iterations hit `!a || !b`
    strokePath(sink, pts, 1)
    expect(sink.xs.length).toBe(0)
  })
})

describe('stampSprite', () => {
  const sprite: Sprite = {
    type: 'sprite',
    name: 't',
    w: 2,
    h: 2,
    data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]),
    pal: [],
    title: undefined,
    desc: undefined,
  }

  test('identity blit (no matrix) copies opaque texels and skips transparent/out-of-bounds', () => {
    const c = ctx(4, 4)
    const ok = stampSprite(c, sprite, 1, 1)
    expect(ok).toBe(true)
    expect(px(c, 1, 1)).toEqual([255, 0, 0, 255])
    expect(px(c, 2, 1)).toEqual([0, 255, 0, 255])
    expect(px(c, 2, 2)).toEqual([0, 0, 0, 0]) // sprite's transparent texel, never written
  })

  test('identity blit respects the context mask and an extra per-call mask', () => {
    const c = ctx(4, 4)
    c.mask = rectRegion(0, 0, 0, 3)
    stampSprite(c, sprite, 0, 0, undefined, undefined, rectRegion(0, 0, 3, 0))
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255]) // passes both masks
    expect(px(c, 0, 1)).toEqual([0, 0, 0, 0]) // outside the extra mask (rows 1+ excluded)
  })

  test('tinted blit mixes the tint color while preserving source alpha', () => {
    const c = ctx(4, 4)
    stampSprite(c, sprite, 0, 0, undefined, { color: blue, amount: 1 })
    const p = px(c, 0, 0)
    expect(p[3]).toBe(255)
    expect(p[0]).toBe(0) // fully tinted toward blue: red channel gone
    expect(p[2]).toBe(255)
  })

  test('matrix blit inverse-maps texels (rotation) and honours masks', () => {
    const c = ctx(6, 6)
    const ok = stampSprite(c, sprite, 2, 2, rotationYDeg(0)) // identity-equivalent 3D rotation
    expect(ok).toBe(true)
    expect(px(c, 2, 2)).toEqual([255, 0, 0, 255])
  })

  test('a non-invertible transform returns false without drawing', () => {
    const c = ctx(4, 4)
    const ok = stampSprite(c, sprite, 0, 0, scaling(0, 1))
    expect(ok).toBe(false)
    expect(px(c, 0, 0)).toEqual([0, 0, 0, 0])
  })

  test('an invertible transform that forward-maps a corner to w=0 returns false', () => {
    const c = ctx(10, 10)
    const m = multiplyMatrix(perspectiveMatrix(0.5), rotationYDeg(90))
    const ok = stampSprite(c, sprite, 4, 4, m)
    expect(ok).toBe(false)
  })

  test('a strong perspective still blits within its projected bounds', () => {
    const c = ctx(16, 16)
    const m = multiplyMatrix(perspectiveMatrix(20), rotationYDeg(60))
    const ok = stampSprite(c, sprite, 8, 8, m)
    expect(ok).toBe(true)
  })
})

describe('stampSprite aa (ADR-0099 opt-in filtered resampling)', () => {
  test('half-pixel shift spreads one texel across two at alpha 128', () => {
    const onePx: Sprite = {
      type: 'sprite',
      name: 't',
      w: 1,
      h: 1,
      data: new Uint8Array([255, 0, 0, 255]),
      pal: [],
      title: undefined,
      desc: undefined,
    }
    const m = translation(0.5, 0)
    const aa = ctx(4, 2)
    stampSprite(aa, onePx, 0, 0, m, undefined, undefined, true)
    expect(px(aa, 0, 0)).toEqual([255, 0, 0, 128])
    expect(px(aa, 1, 0)).toEqual([255, 0, 0, 128])
    expect(px(aa, 2, 0)).toEqual([0, 0, 0, 0])
    expect(px(aa, 3, 0)).toEqual([0, 0, 0, 0])
    expect(px(aa, 0, 1)).toEqual([0, 0, 0, 0])
    expect(px(aa, 1, 1)).toEqual([0, 0, 0, 0])
    expect(px(aa, 2, 1)).toEqual([0, 0, 0, 0])
    expect(px(aa, 3, 1)).toEqual([0, 0, 0, 0])

    // without aa: single nearest-neighbour texel at (0, 0)
    const nn = ctx(4, 2)
    stampSprite(nn, onePx, 0, 0, m)
    expect(px(nn, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(nn, 1, 0)).toEqual([0, 0, 0, 0])
  })

  test('interior texel boundary blends 50/50 in gamma sRGB', () => {
    // discriminates the blend space: linear-light averaging gives ~188 per channel,
    // an OkLCh mix nothing close to (128, 0, 128) — only premultiplied gamma sRGB lands here.
    const twoPx: Sprite = {
      type: 'sprite',
      name: 't',
      w: 2,
      h: 1,
      data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]),
      pal: [],
      title: undefined,
      desc: undefined,
    }
    const c = ctx(3, 1)
    stampSprite(c, twoPx, 0, 0, translation(0.5, 0), undefined, undefined, true)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 128])
    expect(px(c, 1, 0)).toEqual([128, 0, 128, 255])
    expect(px(c, 2, 0)).toEqual([0, 0, 255, 128])
  })

  // An asymmetric sprite (every texel a distinct colour) with one transparent hole, so an
  // alpha-0 texel round-trips too.
  const asymSprite = (w: number, h: number): Sprite => {
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        data[i] = (x * 70 + 10) % 256
        data[i + 1] = (y * 45 + 20) % 256
        data[i + 2] = ((x + y) * 30 + 5) % 256
        data[i + 3] = x === w - 1 && y === h - 1 ? 0 : 255
      }
    }
    return { type: 'sprite', name: 't', w, h, data, pal: [], title: undefined, desc: undefined }
  }

  /** The flag matrix exactly as eval.ts's `#buildStampMatrix` builds it: flip → scale → rotate. */
  const flagMatrix = (
    w: number,
    h: number,
    f: { flipx?: boolean; flipy?: boolean; scale?: number; rot?: number },
  ): readonly number[] => {
    const cx = (w - 1) / 2
    const cy = (h - 1) / 2
    let m = IDENTITY
    if (f.flipx) {
      m = compose(m, aboutPoint(scaling(-1, 1), cx, cy))
    }
    if (f.flipy) {
      m = compose(m, aboutPoint(scaling(1, -1), cx, cy))
    }
    if (f.scale) {
      m = compose(m, aboutPoint(scaling(f.scale, f.scale), -0.5, -0.5))
    }
    if (f.rot) {
      m = compose(m, aboutPoint(rotationDeg(f.rot), cx, cy))
    }
    return m
  }

  /** Renders the same placement twice (aa off, aa on) and returns both buffers. */
  const nnVsAa = (s: Sprite, m: readonly number[]): [Uint8Array, Uint8Array] => {
    const nn = ctx(40, 40)
    const aa = ctx(40, 40)
    expect(stampSprite(nn, s, 15, 15, m)).toBe(true)
    expect(stampSprite(aa, s, 15, 15, m, undefined, undefined, true)).toBe(true)
    return [nn.buffer.data, aa.buffer.data]
  }

  // odd/odd, even/even, and both mixed-parity orders — the parity split is the whole point.
  const SIZES: readonly (readonly [number, number])[] = [
    [3, 5],
    [4, 4],
    [4, 5],
    [3, 4],
    [6, 4],
  ]

  test('mirrors, rot180, integer scale and integer shift are byte-identical with and without aa — at every sprite size', () => {
    const cases: Record<string, (w: number, h: number) => readonly number[]> = {
      flipx: (w, h) => flagMatrix(w, h, { flipx: true }),
      flipy: (w, h) => flagMatrix(w, h, { flipy: true }),
      rot180: (w, h) => flagMatrix(w, h, { rot: 180 }),
      scale2: (w, h) => flagMatrix(w, h, { scale: 2 }),
      scale3: (w, h) => flagMatrix(w, h, { scale: 3 }),
      'flipx flipy scale2 rot180': (w, h) =>
        flagMatrix(w, h, { flipx: true, flipy: true, scale: 2, rot: 180 }),
      'integer shift(3,-2)': () => translation(3, -2),
    }
    for (const [w, h] of SIZES) {
      for (const [label, build] of Object.entries(cases)) {
        const [nn, aa] = nnVsAa(asymSprite(w, h), build(w, h))
        expect(aa, `${label} on ${w}x${h}: aa vs nn buffer`).toEqual(nn)
      }
    }
  })

  test('a quarter-turn is byte-identical to nearest-neighbour only at equal parity (ADR-0099 §3, amended 2026-07-27)', () => {
    // rot90/rot270 pivot about ((w−1)/2, (h−1)/2), so the inverse map carries the offsets cx∓cy.
    // Integral iff w and h share a parity — then every tap rounds to the point sample's texel.
    for (const [w, h] of SIZES.filter(([sw, sh]) => (sw - sh) % 2 === 0)) {
      for (const rot of [90, 270]) {
        const [nn, aa] = nnVsAa(asymSprite(w, h), flagMatrix(w, h, { rot }))
        expect(aa, `rot${rot} on ${w}x${h}: aa vs nn buffer`).toEqual(nn)
        // and it stays exact when the quarter-turn is composed with the size-free flags
        const [nn2, aa2] = nnVsAa(
          asymSprite(w, h),
          flagMatrix(w, h, { flipx: true, scale: 2, rot }),
        )
        expect(aa2, `flipx scale2 rot${rot} on ${w}x${h}`).toEqual(nn2)
      }
    }
    // At mixed parity every tap lands exactly on the roundHalfUp boundary, the taps split 8/8 per
    // axis, and `aa` genuinely resamples. Anyone reinstating the old "quarter-turns are always
    // byte-identical" claim in code fails here.
    for (const [w, h] of [
      [4, 5],
      [3, 4],
      [2, 3],
      [5, 6],
    ] as const) {
      for (const rot of [90, 270]) {
        const [nn, aa] = nnVsAa(asymSprite(w, h), flagMatrix(w, h, { rot }))
        expect(aa, `rot${rot} on ${w}x${h}: aa must differ from nn`).not.toEqual(nn)
      }
    }
  })

  test('a mixed-parity quarter-turn averages a 2x2 texel block (the 16 taps split 4/4/4/4)', () => {
    // 2x3, six distinct opaque texels; rot90 about cx=0.5, cy=1.
    const s: Sprite = {
      type: 'sprite',
      name: 't',
      w: 2,
      h: 3,
      // (0,0) red   (1,0) green
      // (0,1) blue  (1,1) yellow
      // (0,2) cyan  (1,2) magenta
      data: new Uint8Array([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255, 0, 255, 255, 255, 255, 0,
        255, 255,
      ]),
      pal: [],
      title: undefined,
      desc: undefined,
    }
    const m = flagMatrix(2, 3, { rot: 90 })
    const nn = ctx(12, 12)
    const aa = ctx(12, 12)
    stampSprite(nn, s, 4, 4, m)
    stampSprite(aa, s, 4, 4, m, undefined, undefined, true)

    // nearest-neighbour: the exact 3x2 turned sprite, every texel opaque and unblended
    expect(px(nn, 4, 4)).toEqual([0, 255, 255, 255]) // cyan
    expect(px(nn, 5, 5)).toEqual([255, 255, 0, 255]) // yellow
    expect(px(nn, 3, 5)).toEqual([0, 0, 0, 0]) // nothing left of the footprint

    // aa: (4,5) is fully covered by four taps each of cyan, blue, magenta and yellow —
    // r = (0+0+255+255)/4 = 127.5 → 128, g = (255+0+0+255)/4 → 128, b = (255+255+255+0)/4 = 191.25 → 191
    expect(px(aa, 4, 5)).toEqual([128, 128, 191, 255])
    // (5,5): the neighbouring 2x2 block — blue, red, yellow, green ⇒ b = 255/4 = 63.75 → 64
    expect(px(aa, 5, 5)).toEqual([128, 128, 64, 255])
    // and the fringe reaches one pixel further left than nearest-neighbour ever writes:
    // 8 of 16 taps land on the sprite, cyan + magenta ⇒ (128, 128, 255) at alpha 8·255/16 → 128
    expect(px(aa, 3, 5)).toEqual([128, 128, 255, 128])
  })

  test('identity blit ignores aa', () => {
    const s: Sprite = {
      type: 'sprite',
      name: 't',
      w: 2,
      h: 2,
      data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]),
      pal: [],
      title: undefined,
      desc: undefined,
    }
    const withAa = ctx(6, 6)
    const withoutAa = ctx(6, 6)
    stampSprite(withAa, s, 2, 3, undefined, undefined, undefined, true)
    stampSprite(withoutAa, s, 2, 3, undefined, undefined, undefined, false)
    expect(withAa.buffer.data).toEqual(withoutAa.buffer.data)
  })

  test('aa never ticks the budget for an empty pixel', () => {
    const solid = new Uint8Array(6 * 6 * 4)
    for (let i = 0; i < solid.length; i += 4) {
      solid[i] = 200
      solid[i + 1] = 60
      solid[i + 2] = 30
      solid[i + 3] = 255
    }
    const solidSprite: Sprite = {
      type: 'sprite',
      name: 't',
      w: 6,
      h: 6,
      data: solid,
      pal: [],
      title: undefined,
      desc: undefined,
    }
    const c = ctx(20, 20)
    let writes = 0
    c.buffer.onWrite = () => {
      writes++
    }
    const m = aboutPoint(rotationDeg(37), 2.5, 2.5) // non-lattice: a fringe ring is expected
    const ok = stampSprite(c, solidSprite, 7, 7, m, undefined, undefined, true)
    expect(ok).toBe(true)
    let opaque = 0
    for (let i = 3; i < c.buffer.data.length; i += 4) {
      if ((c.buffer.data[i] ?? 0) > 0) {
        opaque++
      }
    }
    expect(opaque).toBeGreaterThan(0)
    expect(writes).toBe(opaque)
  })
})

describe('scaleBitmap', () => {
  test('nearest-neighbour upscale and downscale', () => {
    const src = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255])
    const up = scaleBitmap(src, 2, 2, 4, 4)
    expect(up.length).toBe(4 * 4 * 4)
    expect([up[0], up[1], up[2], up[3]]).toEqual([255, 0, 0, 255])
    expect([up[12], up[13], up[14], up[15]]).toEqual([0, 255, 0, 255])

    const down = scaleBitmap(src, 2, 2, 1, 1)
    expect(down.length).toBe(4)
    expect([down[0], down[1], down[2], down[3]]).toEqual([255, 0, 0, 255])
  })
})

describe('filters', () => {
  test('filterOutline dilates the silhouette N times; width=0 is a no-op', () => {
    const c = ctx(9, 9)
    c.buffer.set(4, 4, black)
    filterOutline(c, red, 2)
    expect(px(c, 4, 4)).toEqual([0, 0, 0, 255]) // original pixel untouched (already opaque)
    expect(px(c, 3, 4)).toEqual([255, 0, 0, 255]) // 1px ring
    expect(px(c, 2, 4)).toEqual([255, 0, 0, 255]) // 2px ring

    const none = ctx(4, 4)
    none.buffer.set(1, 1, black)
    filterOutline(none, red, 0)
    expect(px(none, 0, 1)).toEqual([0, 0, 0, 0])
  })

  test('filterOutline silhouette floors at 50% coverage: a soft (<128 alpha) pixel is not ringed', () => {
    const soft = ctx(5, 5)
    soft.buffer.set(2, 2, color(0, 0, 0, 97)) // a 38%-alpha contact-shadow-like pixel
    filterOutline(soft, red, 1)
    expect(px(soft, 1, 2)).toEqual([0, 0, 0, 0]) // not treated as silhouette → no ring
    expect(px(soft, 2, 2)).toEqual([0, 0, 0, 97]) // soft pixel itself untouched

    const solid = ctx(5, 5)
    solid.buffer.set(2, 2, color(0, 0, 0, 200)) // ≥128 → silhouette
    filterOutline(solid, red, 1)
    expect(px(solid, 1, 2)).toEqual([255, 0, 0, 255]) // ringed
  })

  test('filterOutline never eats a thin feature: a 1px line keeps its core, gains only an outer ring', () => {
    const c = ctx(5, 7)
    for (let y = 1; y <= 5; y++) {
      c.buffer.set(2, y, blue) // a 1px-wide vertical bar
    }
    filterOutline(c, black, 1)
    expect(px(c, 2, 3)).toEqual([0, 0, 255, 255]) // core survives
    expect(px(c, 1, 3)).toEqual([0, 0, 0, 255]) // left ring
    expect(px(c, 3, 3)).toEqual([0, 0, 0, 255]) // right ring
  })

  test('filterOutline with null paint derives a near-black ink from the silhouette', () => {
    const c = ctx(5, 5)
    c.buffer.set(2, 2, color(80, 200, 120, 255)) // a green figure pixel
    filterOutline(c, null, 1)
    const ring = px(c, 1, 2)
    expect(ring[3]).toBe(255) // opaque ring
    // near-black (L≈0.15): every channel well below the source's brightest
    expect(Math.max(ring[0], ring[1], ring[2])).toBeLessThan(90)
    expect(px(c, 2, 2)).toEqual([80, 200, 120, 255]) // figure pixel untouched
  })

  test('filterTint mixes into opaque pixels, skips transparent, and respects the mask', () => {
    const c = ctx(3, 1)
    c.buffer.set(0, 0, white)
    c.mask = rectRegion(0, 0, 0, 0)
    filterTint(c, red, 1)
    expect(px(c, 0, 0)[3]).toBe(255)
    const c2 = ctx(2, 1)
    c2.buffer.set(0, 0, white)
    filterTint(c2, red, 1)
    expect(px(c2, 1, 0)).toEqual([0, 0, 0, 0]) // transparent pixel skipped
  })

  test('filterShadow offsets the silhouette, clips off-canvas, and composites the original back over', () => {
    const c = ctx(4, 4)
    c.buffer.set(0, 0, black) // near the edge so the shadow offset clips off-canvas
    c.buffer.set(2, 2, red)
    filterShadow(c, 2, 2, blue)
    expect(px(c, 2, 2)).toEqual([255, 0, 0, 255]) // original wins over the shadow layer
    expect(px(c, 0, 0)).toEqual([0, 0, 0, 255]) // original restored even where shadow clipped
  })

  test('filterShadow always confines to an enclosing mask (ADR-0070/0088 — single semantics)', () => {
    // a 6x1 buffer: opaque red at x=1; a mask covering only x=3..4. The shadow is cast from the
    // whole buffer but lands only inside the mask, and masked-off pixels keep their content.
    const c = ctx(6, 1)
    c.buffer.set(1, 0, red)
    c.mask = rectRegion(3, 0, 4, 0)
    filterShadow(c, 2, 0, blue)
    expect(px(c, 1, 0)).toEqual([255, 0, 0, 255]) // masked-off original untouched
    expect(px(c, 3, 0)).toEqual([0, 0, 255, 255]) // shadow at x=1+2 lands inside the mask
  })

  test('filterShadow leaves masked-off content when the shadow would land outside', () => {
    const c = ctx(6, 1)
    c.buffer.set(0, 0, red) // shadow would land at x=2, outside the mask
    c.mask = rectRegion(4, 0, 5, 0)
    filterShadow(c, 2, 0, blue)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255]) // masked-off original preserved
    expect(px(c, 2, 0)).toEqual([0, 0, 0, 0]) // shadow suppressed — destination outside the mask
  })

  test('filterGrain/filterSpeckle add texture to opaque pixels at amount=1', () => {
    const c = ctx(4, 4, 'pixel')
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        c.buffer.set(x, y, white)
      }
    }
    filterGrain(c, 1, 7, black)
    expect(px(c, 0, 0)).toEqual([0, 0, 0, 255])

    const c2 = ctx(4, 4, 'pixel')
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        c2.buffer.set(x, y, white)
      }
    }
    filterSpeckle(c2, 1, 11, red)
    expect(px(c2, 0, 0)).toEqual([255, 0, 0, 255])
  })

  test('filterRipple bands a fraction of opaque pixels', () => {
    const c = ctx(12, 12, 'pixel')
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        c.buffer.set(x, y, white)
      }
    }
    filterRipple(c, 1, 5, black)
    let changed = false
    for (let y = 0; y < 12 && !changed; y++) {
      for (let x = 0; x < 12 && !changed; x++) {
        if (px(c, x, y)[0] !== 255) {
          changed = true
        }
      }
    }
    expect(changed).toBe(true)
  })

  test('filterDither picks paintA/paintB by the Bayer threshold', () => {
    const c = ctx(4, 1, 'pixel')
    c.buffer.set(0, 0, white)
    c.buffer.set(3, 0, white)
    filterDither(c, red, blue, 0.5)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255]) // th ~= 0.03 < 0.5 -> paintA
    expect(px(c, 3, 0)).toEqual([0, 0, 255, 255]) // th ~= 0.66 >= 0.5 -> paintB
  })

  test('region-scoped texture filters confine the effect and leave outside pixels untouched (ADR-0071)', () => {
    const fillWhite = (c: Context): void => {
      for (let x = 0; x < 4; x++) {
        c.buffer.set(x, 0, white)
      }
    }
    const half = rectRegion(0, 0, 1, 0) // the left half only

    const g = ctx(4, 1, 'pixel')
    fillWhite(g)
    filterGrain(g, 1, 7, black, half)
    expect(px(g, 0, 0)).toEqual([0, 0, 0, 255]) // in region: grained
    expect(px(g, 3, 0)).toEqual([255, 255, 255, 255]) // outside region: untouched

    const s = ctx(4, 1, 'pixel')
    fillWhite(s)
    filterSpeckle(s, 1, 11, red, half)
    expect(px(s, 0, 0)).toEqual([255, 0, 0, 255]) // density=1 speckles everything in region
    expect(px(s, 3, 0)).toEqual([255, 255, 255, 255]) // outside region: untouched

    const d = ctx(4, 1, 'pixel')
    fillWhite(d)
    filterDither(d, red, blue, 1, half) // threshold 1 -> always paintA
    expect(px(d, 0, 0)).toEqual([255, 0, 0, 255]) // in region: raw-set to paintA
    expect(px(d, 3, 0)).toEqual([255, 255, 255, 255]) // outside region: untouched
  })

  test('region-scope intersects with the active mask (ADR-0071)', () => {
    const c = ctx(4, 1, 'pixel')
    for (let x = 0; x < 4; x++) {
      c.buffer.set(x, 0, white)
    }
    c.mask = rectRegion(1, 0, 2, 0) // mask covers x=1..2
    filterGrain(c, 1, 7, black, rectRegion(0, 0, 1, 0)) // region covers x=0..1
    expect(px(c, 0, 0)).toEqual([255, 255, 255, 255]) // in region but masked out -> untouched
    expect(px(c, 1, 0)).toEqual([0, 0, 0, 255]) // in both region and mask -> grained
    expect(px(c, 2, 0)).toEqual([255, 255, 255, 255]) // in mask but outside region -> untouched
  })
})

// The raw `shadeRegion`/`lightRegion`/`rim`/`ao` commands were removed by ADR-0097; these three
// helpers survive as the *internals* of the declarative pipeline (`lightRegion` = the `glow` response's
// self-light, `rimRegion`/`ambientOcclusion` = the material `rim`/`ao` doses), so their pixel
// contracts still need locking down.
describe('lightRegion / rimRegion / ambientOcclusion (internal material-dose primitives)', () => {
  test('lightRegion brightens by proximity to the light', () => {
    const strip = rectRegion(0, 0, 7, 0)
    const c = ctx(8, 1)
    fillRegion(c, strip, black)
    lightRegion(c, strip, { x: 0, y: 0 }, white, 1)
    expect(px(c, 0, 0)).toEqual([255, 255, 255, 255]) // nearest the light: strongest (a = paint.a * amount)
    expect(px(c, 3, 0)).toEqual([146, 146, 146, 255]) // a graded brightening
    expect(px(c, 7, 0)).toEqual([0, 0, 0, 255]) // far corner: untouched
  })

  test('lightRegion no-ops with no bbox and honours bounds/mask/region gating', () => {
    const c = ctx(4, 4)
    lightRegion(
      c,
      { type: 'region', bbox: null, has: () => true, test: () => true },
      { x: 0, y: 0 },
      white,
      1,
    )
    expect(px(c, 0, 0)).toEqual([0, 0, 0, 0]) // no bbox -> no writes

    const c3 = ctx(8, 8)
    c3.mask = rectRegion(0, 0, 3, 7)
    const disc = circleRegion(4, 4, 3)
    lightRegion(c3, disc, { x: 4, y: 4 }, white, 1)
    expect(px(c3, 5, 4)).toEqual([0, 0, 0, 0]) // masked out
    expect(px(c3, 1, 1)).toEqual([0, 0, 0, 0]) // outside the region (bbox corner, not in disc)
  })

  test('rimRegion no-ops on a zero direction, paints a band otherwise, and clamps width', () => {
    const c = ctx(6, 6)
    const disc = circleRegion(3, 3, 3)
    rimRegion(c, disc, { x: 0, y: 0 }, red, 1)
    expect(px(c, 3, 3)).toEqual([0, 0, 0, 0]) // no-op: direction (0,0)

    const c2 = ctx(6, 6)
    rimRegion(c2, disc, { x: 1, y: 0 }, red, 3)
    expect(px(c2, 0, 3)).toEqual([255, 0, 0, 255]) // leading edge lit

    const c3 = ctx(6, 6)
    rimRegion(c3, disc, { x: 1, y: 0 }, red, -5) // clamps to Math.max(1, width) = 1
    expect(px(c3, 0, 3)).toEqual([255, 0, 0, 255])

    // smooth mode drives fillRegion's coverageAt(), which calls the rim region's test()
    const c4 = ctx(6, 6, 'smooth')
    rimRegion(c4, disc, { x: 1, y: 0 }, red, 3)
    expect(px(c4, 0, 3)[3]).toBeGreaterThan(0)
  })

  test('ambientOcclusion strokes a 1px inner band scaled by amount', () => {
    const c = ctx(6, 6)
    const disc = circleRegion(3, 3, 3)
    ambientOcclusion(c, disc, black, 0.5)
    expect(px(c, 0, 3)[3]).toBe(128) // roundHalfUp(255 * clamp01(0.5))
  })
})

describe('drawText: bundled bitmap fonts', () => {
  const font: BitmapFont = {
    name: 'test',
    w: 3,
    h: 3,
    tracking: 1,
    lineHeight: 4,
    glyphs: new Map([
      ['A', ['#.#', '###', '#.#']],
      ['b', ['.#.', '.#.', '.#.']],
    ]),
    upcase: true,
  }
  const resolved: FontResolved = { kind: 'bitmap', font }

  test('draws a mapped glyph directly, advances by w+tracking, and newline resets/advances', () => {
    const c = ctx(16, 16)
    const end = drawText(c, resolved, 0, 0, 'A\nb', red)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(c, 1, 0)).toEqual([0, 0, 0, 0]) // '.' cell untouched
    expect(px(c, 1, 4)).toEqual([255, 0, 0, 255]) // 'b' on the second line
    expect(end).toEqual({ x: 4, y: 4 })
  })

  test('falls back to an uppercase glyph and then to the missing-glyph box', () => {
    const c = ctx(16, 16)
    drawText(c, resolved, 0, 0, 'a', red) // lowercase 'a' -> upcased to 'A'
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255])

    const c2 = ctx(16, 16)
    drawText(c2, resolved, 0, 0, 'Z', red) // unmapped, no upcase match -> missing-glyph box
    expect(px(c2, 0, 0)).toEqual([255, 0, 0, 255]) // missingGlyph's border is solid
    expect(missingGlyph(font.w, font.h)[0]).toBe('###')
  })

  test('a face with upcase disabled renders the missing-glyph box for an unmapped char', () => {
    const noUpcase: FontResolved = { kind: 'bitmap', font: { ...font, upcase: false } }
    const c = ctx(16, 16)
    drawText(c, noUpcase, 0, 0, 'a', red)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255])
  })
})

describe('drawText: user fonts', () => {
  const glyphSprite: Sprite = {
    type: 'sprite',
    name: 'g',
    w: 2,
    h: 2,
    data: new Uint8Array([0, 255, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    pal: [],
    title: undefined,
    desc: undefined,
  }
  const fallback: FontResolved = {
    kind: 'bitmap',
    font: {
      name: 'fb',
      w: 2,
      h: 2,
      tracking: 0,
      lineHeight: 3,
      glyphs: new Map([['Q', ['##', '##']]]),
      upcase: false,
    },
  }

  test('draws an inline glyph via its draw callback and advances by width+tracking', () => {
    const drawnAt: { at: { x: number; y: number } | null } = { at: null }
    const font: UserFontResolved = {
      kind: 'user',
      name: 'inline',
      glyphs: new Map(),
      inlineGlyphs: new Map([
        [
          'O',
          {
            width: 3,
            height: 3,
            draw: (c, x, y, paint) => {
              drawnAt.at = { x, y }
              putPixel(c, x, y, paint as Paint, { x0: x, y0: y, x1: x + 2, y1: y + 2 })
            },
          },
        ],
      ]),
      fallback: null,
      tracking: 2,
      lineHeight: 4,
      height: 3,
    }
    const c = ctx(16, 16)
    const end = drawText(c, font, 1, 1, 'O', blue)
    expect(drawnAt.at).toEqual({ x: 1, y: 1 })
    expect(px(c, 1, 1)).toEqual([0, 0, 255, 255])
    expect(end).toEqual({ x: 1 + 3 + 2, y: 1 })
  })

  test('draws a sprite glyph via stampSprite and advances by w+tracking', () => {
    const font: UserFontResolved = {
      kind: 'user',
      name: 'sprite',
      glyphs: new Map([['G', glyphSprite]]),
      inlineGlyphs: new Map(),
      fallback: null,
      tracking: 1,
      lineHeight: 4,
      height: 2,
    }
    const c = ctx(16, 16)
    const end = drawText(c, font, 0, 0, 'G', red)
    expect(px(c, 0, 0)).toEqual([0, 255, 0, 255])
    expect(end).toEqual({ x: 2 + 1, y: 0 })
  })

  test('falls back to another resolved font when the glyph is unmapped', () => {
    const font: UserFontResolved = {
      kind: 'user',
      name: 'withFallback',
      glyphs: new Map(),
      inlineGlyphs: new Map(),
      fallback,
      tracking: 1,
      lineHeight: 4,
      height: 2,
    }
    const c = ctx(16, 16)
    const end = drawText(c, font, 0, 0, 'Q', red)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255])
    expect(end.x).toBe(2) // fallback glyph width, no extra tracking added twice
  })

  test('draws the built-in missing-glyph box when unmapped and no fallback exists', () => {
    const font: UserFontResolved = {
      kind: 'user',
      name: 'bare',
      glyphs: new Map(),
      inlineGlyphs: new Map(),
      fallback: null,
      tracking: 1,
      lineHeight: 6,
      height: 5,
    }
    const c = ctx(16, 16)
    drawText(c, font, 0, 0, 'Q', red)
    expect(px(c, 0, 0)).toEqual([255, 0, 0, 255]) // missing-glyph box border
  })

  test('newline resets x and advances y by lineHeight for user fonts', () => {
    const font: UserFontResolved = {
      kind: 'user',
      name: 'nl',
      glyphs: new Map([['G', glyphSprite]]),
      inlineGlyphs: new Map(),
      fallback: null,
      tracking: 0,
      lineHeight: 5,
      height: 2,
    }
    const c = ctx(16, 16)
    const end = drawText(c, font, 2, 0, 'G\nG', red)
    expect(px(c, 2, 5)).toEqual([0, 255, 0, 255])
    expect(end).toEqual({ x: 2 + 2, y: 5 })
  })
})

describe('fillRegion', () => {
  test('no-ops with a null-bbox region and with a region entirely outside the canvas', () => {
    const c = ctx(4, 4)
    const noBbox: Region = { type: 'region', bbox: null, has: () => true, test: () => true }
    fillRegion(c, noBbox, red)
    expect(px(c, 0, 0)).toEqual([0, 0, 0, 0])

    const outside = rectRegion(100, 100, 110, 110)
    fillRegion(c, outside, red)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(px(c, x, y)).toEqual([0, 0, 0, 0])
      }
    }
  })

  test('pixel mode: paints has()=true pixels, skips has()=false pixels within the bbox', () => {
    const c = ctx(6, 6)
    const disc = circleRegion(3, 3, 3)
    fillRegion(c, disc, red)
    expect(px(c, 3, 3)).toEqual([255, 0, 0, 255]) // centre, has() true
    expect(px(c, 0, 0)).toEqual([0, 0, 0, 0]) // bbox corner, has() false
  })

  test('smooth mode: blends by supersampled coverage (full, partial, and zero)', () => {
    const c = ctx(12, 12, 'smooth')
    const disc = circleRegion(6, 6, 4)
    fillRegion(c, disc, red)
    expect(px(c, 6, 6)).toEqual([255, 0, 0, 255]) // deep interior, cov=1
    const partial = px(c, 8, 8)[3]
    expect(partial).toBeGreaterThan(0) // boundary pixel, 0 < cov < 1
    expect(partial).toBeLessThan(255)
    expect(px(c, 2, 2)).toEqual([0, 0, 0, 0]) // bbox corner, cov=0
  })

  test('a gradient paint is resolved across the region bbox', () => {
    const c = ctx(4, 4)
    const g: Grad = {
      type: 'grad',
      kind: 'linear',
      angle: 90,
      stops: [
        { c: black, pos: 0 },
        { c: white, pos: 1 },
      ],
      space: 'rgb',
    }
    fillRegion(c, rectRegion(0, 0, 3, 3), g)
    expect(px(c, 0, 0)[0]).toBeLessThan(px(c, 0, 3)[0])
  })
})

describe('strokeRegion', () => {
  test('no-ops with a null-bbox region', () => {
    const c = ctx(4, 4)
    const noBbox: Region = { type: 'region', bbox: null, has: () => true, test: () => true }
    strokeRegion(c, noBbox, red, 1)
    expect(px(c, 0, 0)).toEqual([0, 0, 0, 0])
  })

  test('width=0 erodes nothing, producing an empty stroke (PixelSink.paint no-op)', () => {
    const c = ctx(8, 8)
    const disc = circleRegion(4, 4, 3)
    strokeRegion(c, disc, red, 0)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(px(c, x, y)).toEqual([0, 0, 0, 0])
      }
    }
  })

  test('paints the inner boundary band, leaving the interior untouched', () => {
    const c = ctx(8, 8)
    const disc = circleRegion(4, 4, 3)
    strokeRegion(c, disc, red, 1)
    expect(px(c, 4, 4)).toEqual([0, 0, 0, 0]) // interior, eroded away
    expect(px(c, 4, 1)).toEqual([255, 0, 0, 255]) // outer band
  })
})

describe('E1 regression: a region stroke never leaks state into a following primitive', () => {
  // Icon-DX evaluation §6 E1 reported a "filled blob" arc after the shape
  // `rrect fill → stroke <region> wN → arc`. Every stroke/arc path uses a fresh
  // PixelSink and pure point generators, so the arc must be byte-identical whether
  // or not a region stroke preceded it, and it must stay a thin band, not a disc.
  const arc = (): PixelSink => {
    const s = new PixelSink()
    strokePath(s, arcPoints(12, 14, 4, 0, 180), 2)
    return s
  }
  const keys = (s: PixelSink): Set<string> => new Set(s.xs.map((x, i) => `${x},${s.ys[i]}`))

  test('an arc after strokeRegion collects exactly the same pixels as in isolation', () => {
    const solo = arc()
    const c = ctx(24, 24)
    strokeRegion(c, circleRegion(12, 12, 8), red, 2) // the preceding region stroke
    const after = arc()
    expect(keys(after)).toEqual(keys(solo))
  })

  test('the arc stays a thin band, not a filled disc', () => {
    // a filled r=4 disc is ~49 px and the whole r=8 mask ~200 px; a w2 arc is ~39.
    expect(arc().xs.length).toBeLessThan(45)
  })
})
