// Rasterization (spec §8–§9, ADR-0028, ADR-0023, ADR-0025, ADR-0043):
// pinned primitives, region eliminators, gradients (ordered-dithered in
// pixel mode), stamps (inverse-mapped NN), filters, text.

import { type Color, mix, TRANSPARENT } from './color.js'
import { dcosDeg, dhypot, dsinDeg, roundHalfUp } from './dmath.js'
import { type BitmapFont, missingGlyph } from './fonts.js'
import type { Framebuffer } from './framebuffer.js'
import {
  applyMatrix,
  type BBox,
  bresenham,
  circleSpans,
  type Grad,
  invertMatrix,
  type Region,
  type Sprite,
} from './values.js'

/**
 * 'pixel': pinned hard-edged raster (ADR-0028). 'smooth': anti-aliased, 1/16-subpixel-quantized (ADR-0040).
 */
export type RenderMode = 'pixel' | 'smooth'
/** A resolved fill/stroke value: a solid color or a gradient. */
export type Paint = Color | Grad

/** Painting context: target buffer + active mask + render mode. */
export type Context = {
  buffer: Framebuffer
  mask: Region | null
  mode: RenderMode
}

/**
 * A 4×4 ordered-dither (Bayer) threshold matrix; drives gradient dithering in pixel mode and the
 * grain/dither filters.
 */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** Mode-scoped coordinate quantization (ADR-0040). */
export const quant = (v: number, mode: RenderMode): number =>
  mode === 'pixel' ? Math.floor(v + 0.5) : Math.floor(v * 16 + 0.5) / 16

/** Integer coercion for inherently integer slots (canvas, px, stamp, layout). */
export const quantInt = (v: number): number => Math.floor(v + 0.5)

// ── gradients ───────────────────────────────────────────────────────────────

type Frgba = { r: number; g: number; b: number; a: number }

/**
 * Normalize a gradient's stops to explicit positions (missing positions spread evenly); does not
 * sort — callers must supply stops in ascending position order.
 */
const resolveStops = (g: Grad): { c: Color; pos: number }[] => {
  const n = g.stops.length
  if (n === 0) {
    return []
  }
  const out: { c: Color; pos: number }[] = []
  // explicit positions kept; missing positions distributed evenly
  for (const [i, s] of g.stops.entries()) {
    out.push({ c: s.c, pos: s.pos ?? (n === 1 ? 0 : i / (n - 1)) })
  }
  return out
}

/**
 * Sample the gradient's color at parametric t in [0,1] (clamped), linearly interpolating between
 * the bracketing stops in the gradient's mix space.
 */
const gradAt = (g: Grad, t: number): Frgba => {
  const stops = resolveStops(g)
  if (stops.length === 0) {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  const tt = Math.max(0, Math.min(1, t))
  const first = stops[0]
  const last = stops.at(-1)
  if (!first || !last) {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  let lo = first
  let hi = last
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (a && b && tt >= a.pos && tt <= b.pos) {
      lo = a
      hi = b
      break
    }
  }
  const span = hi.pos - lo.pos
  const f = span <= 0 ? 0 : (tt - lo.pos) / span
  const c = mix(lo.c, hi.c, f, g.space)
  return { r: c.r, g: c.g, b: c.b, a: c.a }
}

/**
 * Map a pixel (x, y) to the gradient's parameter t in [0,1] within bbox: radial is distance from
 * the bbox center over the corner-to-center radius; linear is projection onto the angle direction,
 * normalized over the bbox's projected extent.
 */
const gradParam = (g: Grad, x: number, y: number, bbox: BBox): number => {
  const w = bbox.x1 - bbox.x0
  const h = bbox.y1 - bbox.y0
  if (g.kind === 'radial') {
    const cx = (bbox.x0 + bbox.x1) / 2
    const cy = (bbox.y0 + bbox.y1) / 2
    const maxR = dhypot(w / 2, h / 2)
    if (maxR === 0) {
      return 0
    }
    const dx = x - cx
    const dy = y - cy
    return dhypot(dx, dy) / maxR
  }
  const dx = dcosDeg(g.angle)
  const dy = dsinDeg(g.angle)
  // project onto the direction, normalized over the bbox extent
  const pMin = Math.min(
    bbox.x0 * dx + bbox.y0 * dy,
    bbox.x1 * dx + bbox.y0 * dy,
    bbox.x0 * dx + bbox.y1 * dy,
    bbox.x1 * dx + bbox.y1 * dy,
  )
  const pMax = Math.max(
    bbox.x0 * dx + bbox.y0 * dy,
    bbox.x1 * dx + bbox.y0 * dy,
    bbox.x0 * dx + bbox.y1 * dy,
    bbox.x1 * dx + bbox.y1 * dy,
  )
  const span = pMax - pMin
  if (span === 0) {
    return 0
  }
  return (x * dx + y * dy - pMin) / span
}

/**
 * Paint color at a pixel; gradients are ordered-dithered to 8-bit in pixel
 * mode (spec §12) and round-half-up committed in smooth mode.
 */
export const paintAt = (
  paint: Paint,
  x: number,
  y: number,
  bbox: BBox,
  mode: RenderMode,
): Color => {
  if (paint.type === 'color') {
    return paint
  }
  const f = gradAt(paint, gradParam(paint, x, y, bbox))
  if (mode === 'smooth') {
    return {
      type: 'color',
      r: roundHalfUp(f.r),
      g: roundHalfUp(f.g),
      b: roundHalfUp(f.b),
      a: roundHalfUp(f.a),
    }
  }
  const th = ((BAYER4[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16
  const dither = (v: number): number => {
    const base = Math.floor(v)
    const frac = v - base
    return Math.max(0, Math.min(255, base + (frac > th ? 1 : 0)))
  }
  return { type: 'color', r: dither(f.r), g: dither(f.g), b: dither(f.b), a: dither(f.a) }
}

// ── pixel emission ──────────────────────────────────────────────────────────

/**
 * Blend one pixel through the context (mask + paint resolution); a no-op pixel (out of bounds,
 * masked, or zero effective alpha) never reaches Framebuffer.onWrite, the pixel-write budget hook.
 */
export const putPixel = (
  ctx: Context,
  x: number,
  y: number,
  paint: Paint,
  bbox: BBox,
  coverage = 1,
): void => {
  if (!ctx.buffer.inBounds(x, y)) {
    return
  }
  if (ctx.mask && !ctx.mask.has(x, y)) {
    return
  }
  const c = paintAt(paint, x, y, bbox, ctx.mode)
  const a = coverage >= 1 ? c.a : roundHalfUp(c.a * coverage)
  ctx.buffer.blend(x, y, c.r, c.g, c.b, a)
}

/**
 * Collect-then-paint: primitives gather pixels so gradients can resolve
 * across the painted bounding box.
 */
export class PixelSink {
  readonly xs: number[] = []
  readonly ys: number[] = []
  readonly #seen = new Set<number>()
  x0 = Number.POSITIVE_INFINITY
  y0 = Number.POSITIVE_INFINITY
  x1 = Number.NEGATIVE_INFINITY
  y1 = Number.NEGATIVE_INFINITY

  /** Register a pixel once (deduped by integer coordinate); extends the running bounding box. */
  add = (x: number, y: number): void => {
    const key = (y + 32768) * 131072 + (x + 32768)
    if (this.#seen.has(key)) {
      return
    }
    this.#seen.add(key)
    this.xs.push(x)
    this.ys.push(y)
    this.x0 = Math.min(this.x0, x)
    this.y0 = Math.min(this.y0, y)
    this.x1 = Math.max(this.x1, x)
    this.y1 = Math.max(this.y1, y)
  }

  /**
   * Commit every collected pixel through putPixel, sharing one bounding box so gradients resolve
   * consistently across the whole primitive.
   */
  paint = (ctx: Context, paint: Paint): void => {
    if (this.xs.length === 0) {
      return
    }
    const bbox: BBox = { x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1 }
    for (let i = 0; i < this.xs.length; i++) {
      const x = this.xs[i]
      const y = this.ys[i]
      if (x !== undefined && y !== undefined) {
        putPixel(ctx, x, y, paint, bbox)
      }
    }
  }
}

// ── brushes & strokes ───────────────────────────────────────────────────────

/** Stamp a disk brush of stroke width N at (x, y): round cap/join (§8). */
const brush = (sink: PixelSink, x: number, y: number, width: number): void => {
  if (width <= 1) {
    sink.add(x, y)
    return
  }
  const r = Math.floor(width / 2)
  const spans = circleSpans(r)
  const even = width % 2 === 0
  for (let dy = -r; dy <= r; dy++) {
    const sp = spans[Math.abs(dy)] ?? -1
    for (let dx = -sp; dx <= sp; dx++) {
      // even widths: drop the extra row/col to keep the footprint N wide
      if (even && (dx === -sp || dy === -r) && sp === r) {
        continue
      }
      sink.add(x + dx, y + dy)
    }
  }
}

/** Stroke a straight segment into sink: Bresenham centerline, brushed to width at every step. */
export const strokeLine = (
  sink: PixelSink,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
): void => {
  bresenham(x0, y0, x1, y1, (x, y) => brush(sink, x, y, width))
}

// ── region eliminators: fill / stroke (ADR-0039) ────────────────────────────

/**
 * Clip a region's bbox to the canvas (floor/ceil to integers); null when the region has no bbox
 * or the clip is empty.
 */
const regionBounds = (ctx: Context, r: Region): BBox | null => {
  const canvas: BBox = { x0: 0, y0: 0, x1: ctx.buffer.width - 1, y1: ctx.buffer.height - 1 }
  if (!r.bbox) {
    return null
  }
  const b = {
    x0: Math.max(Math.floor(r.bbox.x0), canvas.x0),
    y0: Math.max(Math.floor(r.bbox.y0), canvas.y0),
    x1: Math.min(Math.ceil(r.bbox.x1), canvas.x1),
    y1: Math.min(Math.ceil(r.bbox.y1), canvas.y1),
  }
  return b.x0 > b.x1 || b.y0 > b.y1 ? null : b
}

/** Smooth-mode coverage: 4×4 supersamples on the 1/16 grid (ADR-0040). */
const coverageAt = (r: Region, x: number, y: number): number => {
  let hit = 0
  for (let sy = 0; sy < 4; sy++) {
    for (let sx = 0; sx < 4; sx++) {
      const fx = x - 0.5 + (2 * sx + 1) / 8
      const fy = y - 0.5 + (2 * sy + 1) / 8
      if (r.test(fx, fy)) {
        hit++
      }
    }
  }
  return hit / 16
}

/**
 * Pixel mode is binary membership (r.has); smooth mode blends at the supersampled coverage fraction.
 */
const fillPixel = (
  ctx: Context,
  r: Region,
  paint: Paint,
  bbox: BBox,
  x: number,
  y: number,
): void => {
  if (ctx.mode === 'pixel') {
    if (r.has(x, y)) {
      putPixel(ctx, x, y, paint, bbox)
    }
    return
  }
  const cov = coverageAt(r, x, y)
  if (cov > 0) {
    putPixel(ctx, x, y, paint, bbox, cov)
  }
}

/**
 * Fill every pixel/coverage sample of a region with paint (the ADR-0039 fill eliminator); one
 * putPixel — and one budget tick — per touched pixel.
 */
export const fillRegion = (ctx: Context, r: Region, paint: Paint): void => {
  const b = regionBounds(ctx, r)
  if (!b) {
    return
  }
  const bbox: BBox = r.bbox ?? b
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      fillPixel(ctx, r, paint, bbox, x, y)
    }
  }
}

/** Materialize pixel-mode coverage over the (clipped) bounds as a bitmap. */
const materialize = (r: Region, b: BBox): { bits: Uint8Array; bw: number; bh: number } => {
  const bw = b.x1 - b.x0 + 1
  const bh = b.y1 - b.y0 + 1
  const bits = new Uint8Array(bw * bh)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (r.has(b.x0 + x, b.y0 + y)) {
        bits[y * bw + x] = 1
      }
    }
  }
  return { bits, bw, bh }
}

/** Bounds-safe bitmap read (0 outside). */
const cell = (buf: Uint8Array, bw: number, bh: number, x: number, y: number): number =>
  x >= 0 && x < bw && y >= 0 && y < bh ? (buf[y * bw + x] ?? 0) : 0

/** A 4-connected interior test: all orthogonal neighbours are set. */
const isInterior4 = (cur: Uint8Array, bw: number, bh: number, x: number, y: number): boolean =>
  cell(cur, bw, bh, x, y - 1) === 1 &&
  cell(cur, bw, bh, x, y + 1) === 1 &&
  cell(cur, bw, bh, x - 1, y) === 1 &&
  cell(cur, bw, bh, x + 1, y) === 1

/** One 4-connected erosion pass over a materialized bitmap. */
const erode4 = (cur: Uint8Array, bw: number, bh: number): Uint8Array => {
  const next = new Uint8Array(bw * bh)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (cur[y * bw + x] === 1 && isInterior4(cur, bw, bh, x, y)) {
        next[y * bw + x] = 1
      }
    }
  }
  return next
}

/**
 * Stroke = region minus its N-fold 4-erosion: the extensional inner
 * boundary band of width N (ADR-0039).
 */
export const strokeRegion = (ctx: Context, r: Region, paint: Paint, width: number): void => {
  // bounds: use the region bbox (not canvas-clipped) so erosion at the edge
  // of the region is computed correctly, then clip while painting.
  if (!r.bbox) {
    return
  }
  const b: BBox = {
    x0: Math.floor(r.bbox.x0) - 1,
    y0: Math.floor(r.bbox.y0) - 1,
    x1: Math.ceil(r.bbox.x1) + 1,
    y1: Math.ceil(r.bbox.y1) + 1,
  }
  const { bits, bw, bh } = materialize(r, b)
  let cur = bits
  for (let n = 0; n < width; n++) {
    cur = erode4(cur, bw, bh)
  }
  const sink = new PixelSink()
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if (bits[y * bw + x] === 1 && cur[y * bw + x] !== 1) {
        sink.add(b.x0 + x, b.y0 + y)
      }
    }
  }
  sink.paint(ctx, paint)
}

// ── curves (fixed flattening, ADR-0023/0027) ────────────────────────────────

/**
 * Fixed flattening step count for curves: 8 segments per curve unit length,
 * min 8, max 256 — a pinned constant of the numeric domain.
 */
const flattenSteps = (approxLen: number): number =>
  Math.max(8, Math.min(256, Math.ceil(approxLen) * 2))

/**
 * Flatten a quadratic Bezier to a polyline (fixed step count from flattenSteps, ADR-0027); both
 * endpoints included.
 */
export const quadPoints = (
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  p2: { x: number; y: number },
): { x: number; y: number }[] => {
  const approx =
    Math.abs(c1.x - p0.x) + Math.abs(c1.y - p0.y) + Math.abs(p2.x - c1.x) + Math.abs(p2.y - c1.y)
  const n = flattenSteps(approx)
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    pts.push({
      x: u * u * p0.x + 2 * u * t * c1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * c1.y + t * t * p2.y,
    })
  }
  return pts
}

/**
 * Flatten a cubic Bezier to a polyline (fixed step count from flattenSteps, ADR-0027); both
 * endpoints included.
 */
export const bezierPoints = (
  p0: { x: number; y: number },
  c1: { x: number; y: number },
  c2: { x: number; y: number },
  p3: { x: number; y: number },
): { x: number; y: number }[] => {
  const approx =
    Math.abs(c1.x - p0.x) +
    Math.abs(c1.y - p0.y) +
    Math.abs(c2.x - c1.x) +
    Math.abs(c2.y - c1.y) +
    Math.abs(p3.x - c2.x) +
    Math.abs(p3.y - c2.y)
  const n = flattenSteps(approx)
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    })
  }
  return pts
}

/** Arc: degrees, 0° = +x, clockwise (screen coords), bundled trig (§8). */
export const arcPoints = (
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
): { x: number; y: number }[] => {
  let sweep = a1 - a0
  if (sweep === 0) {
    sweep = 0
  }
  const n = Math.max(8, Math.min(512, Math.ceil((Math.abs(sweep) / 360) * Math.max(16, r * 8))))
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n
    pts.push({ x: cx + r * dcosDeg(a), y: cy + r * dsinDeg(a) })
  }
  return pts
}

// ── Catmull-Rom through-point splines (ADR-0074/0075) ────────────────────────

type Pt = { readonly x: number; readonly y: number }

// Centripetal (α = 0.5) parameterization is pinned (ADR-0074): it never cusps or
// self-intersects the way the uniform/chordal variants do, so `curve`/`curvePoly`
// stay predictable through any control polygon. α = ½ makes the knot spacing exactly
// `sqrt(dist)`, so no `pow` (banned, ADR-0027) is needed.

/**
 * Segment count for one span, from its chord length: `clamp(ceil(len), 4, 64)`.
 * Resolution-independent and platform-identical — chord via {@link dhypot} (exact
 * `sqrt`), then `ceil`/`min`/`max` only (ADR-0027). The pinned tessellation rule.
 */
const catmullSegments = (chord: number): number => Math.max(4, Math.min(64, Math.ceil(chord)))

/**
 * Centripetal knot spacing `Δt = dist(a, b)^α` (α = ½ → `sqrt(dist)`). Coincident
 * control points would collapse a knot interval to 0; guarded to 1 so every
 * denominator in {@link catmullSpan} stays strictly positive (no NaN, deterministic).
 */
const knotDelta = (a: Pt, b: Pt): number => {
  // α = ½, so dist^α = sqrt(dist); dist is itself a sqrt, both IEEE-exact (ADR-0027).
  const delta = Math.sqrt(dhypot(b.x - a.x, b.y - a.y))
  return delta === 0 ? 1 : delta
}

/** Point-wise lerp `a + (b − a)·u`. */
const lerpPt = (a: Pt, b: Pt, u: number): Pt => ({
  x: a.x + (b.x - a.x) * u,
  y: a.y + (b.y - a.y) * u,
})

/**
 * Sample one centripetal Catmull-Rom span `p1 → p2` (neighbours `p0`, `p3`) via the
 * Barry-Goldman pyramid, appending `catmullSegments` points to `out`. When
 * `includeStart` the span's first sample (`= p1` exactly) is emitted; otherwise it is
 * skipped so adjacent spans don't duplicate the shared control point.
 */
const catmullSpan = (out: Pt[], p0: Pt, p1: Pt, p2: Pt, p3: Pt, includeStart: boolean): void => {
  const t0 = 0
  const t1 = t0 + knotDelta(p0, p1)
  const t2 = t1 + knotDelta(p1, p2)
  const t3 = t2 + knotDelta(p2, p3)
  const segs = catmullSegments(dhypot(p2.x - p1.x, p2.y - p1.y))
  for (let j = includeStart ? 0 : 1; j <= segs; j++) {
    const t = t1 + ((t2 - t1) * j) / segs
    const a1 = lerpPt(p0, p1, (t - t0) / (t1 - t0))
    const a2 = lerpPt(p1, p2, (t - t1) / (t2 - t1))
    const a3 = lerpPt(p2, p3, (t - t2) / (t3 - t2))
    const b1 = lerpPt(a1, a2, (t - t0) / (t2 - t0))
    const b2 = lerpPt(a2, a3, (t - t1) / (t3 - t1))
    out.push(lerpPt(b1, b2, (t - t1) / (t2 - t1)))
  }
}

/**
 * Flatten an **open** Catmull-Rom spline through `pts` to a polyline (ADR-0074). The
 * end control points are duplicated (the standard phantom-endpoint rule) so the curve
 * passes through the first and last points; every interior control point is hit exactly.
 * Returns the input verbatim for fewer than two points.
 */
export const catmullRomPoints = (pts: readonly Pt[]): Pt[] => {
  const n = pts.length
  if (n < 2) {
    return pts.slice()
  }
  const out: Pt[] = []
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)] as Pt
    const p1 = pts[i] as Pt
    const p2 = pts[i + 1] as Pt
    const p3 = pts[Math.min(n - 1, i + 2)] as Pt
    catmullSpan(out, p0, p1, p2, p3, i === 0)
  }
  return out
}

/**
 * Flatten a **closed** Catmull-Rom loop through `pts` to a polyline whose last point
 * returns to the first (ADR-0075). Neighbours wrap cyclically, so every control point —
 * including the seam — is interpolated smoothly. Returns the input verbatim for fewer
 * than three points.
 */
export const catmullRomLoopPoints = (pts: readonly Pt[]): Pt[] => {
  const n = pts.length
  if (n < 3) {
    return pts.slice()
  }
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n] as Pt
    const p1 = pts[i] as Pt
    const p2 = pts[(i + 1) % n] as Pt
    const p3 = pts[(i + 2) % n] as Pt
    catmullSpan(out, p0, p1, p2, p3, i === 0)
  }
  return out
}

/** Stroke a flattened point chain into a sink (dedup via Bresenham). */
export const strokePath = (
  sink: PixelSink,
  pts: { x: number; y: number }[],
  width: number,
): void => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (!a || !b) {
      continue
    }
    strokeLine(sink, roundHalfUp(a.x), roundHalfUp(a.y), roundHalfUp(b.x), roundHalfUp(b.y), width)
  }
}

// ── flood fill (ADR-0028 §1) ────────────────────────────────────────────────

/**
 * Push the in-bounds 4-connected neighbours of (px, py) onto the flood stack (N/E/S/W only, canvas-clipped).
 */
const pushNeighbors = (
  stack: number[],
  idx: number,
  px: number,
  py: number,
  w: number,
  h: number,
): void => {
  if (px > 0) {
    stack.push(idx - 1)
  }
  if (px < w - 1) {
    stack.push(idx + 1)
  }
  if (py > 0) {
    stack.push(idx - w)
  }
  if (py < h - 1) {
    stack.push(idx + w)
  }
}

// paint replaces the flooded area (set, not blend, so the seed color is
// replaced even when the paint carries alpha over the same color)
const paintFlood = (ctx: Context, sink: PixelSink, paint: Paint): void => {
  if (sink.xs.length === 0) {
    return
  }
  const bbox: BBox = { x0: sink.x0, y0: sink.y0, x1: sink.x1, y1: sink.y1 }
  for (let i = 0; i < sink.xs.length; i++) {
    const fx = sink.xs[i]
    const fy = sink.ys[i]
    if (fx === undefined || fy === undefined) {
      continue
    }
    if (ctx.mask && !ctx.mask.has(fx, fy)) {
      continue
    }
    ctx.buffer.set(fx, fy, paintAt(paint, fx, fy, bbox, ctx.mode))
  }
}

/**
 * A 4-connected flood fill (ADR-0028 §1) from (x, y): spreads to every pixel exactly RGBA-equal to
 * the seed, never diagonally. The `budget()` hook is called once per stack pop — the evaluation-step
 * hook (throws DrawsticError E010 via the evaluator's step counter; independent of the pixel-write
 * budget). No-op when the seed point is off-canvas.
 */
export const flood = (
  ctx: Context,
  x: number,
  y: number,
  paint: Paint,
  budget: () => void,
): void => {
  if (!ctx.buffer.inBounds(x, y)) {
    return
  }
  const seed = ctx.buffer.get(x, y)
  const eq = (c: Color): boolean =>
    c.r === seed.r && c.g === seed.g && c.b === seed.b && c.a === seed.a
  const sink = new PixelSink()
  const visited = new Set<number>()
  const stack: number[] = [y * ctx.buffer.width + x]
  while (stack.length > 0) {
    budget()
    const idx = stack.pop()
    if (idx === undefined || visited.has(idx)) {
      continue
    }
    visited.add(idx)
    const px = idx % ctx.buffer.width
    const py = Math.floor(idx / ctx.buffer.width)
    if (!eq(ctx.buffer.get(px, py))) {
      continue
    }
    sink.add(px, py)
    pushNeighbors(stack, idx, px, py, ctx.buffer.width, ctx.buffer.height)
  }
  paintFlood(ctx, sink, paint)
}

// ── stamp (ADR-0043/0044) ───────────────────────────────────────────────────

/** Optional uniform tint: mix in color at amount, applied to sampled pixels before compositing. */
type Tint = { readonly color: Color; readonly amount: number } | undefined

/** True when (x, y) is excluded by the context mask or an extra per-call mask. */
const stampMasked = (
  ctx: Context,
  extraMask: Region | undefined,
  x: number,
  y: number,
): boolean => {
  if (ctx.mask && !ctx.mask.has(x, y)) {
    return true
  }
  if (extraMask && !extraMask.has(x, y)) {
    return true
  }
  return false
}

/** Mix tint into c, keeping c's original alpha; identity when no tint. */
const applyTint = (c: Color, tint: Tint): Color => {
  if (!tint) {
    return c
  }
  const mixed = mix(c, tint.color, tint.amount)
  return { ...mixed, a: c.a }
}

/** Sample the sprite texel at (sx, sy); null when fully transparent. */
const spriteTexel = (s: Sprite, sx: number, sy: number): Color | null => {
  const a = s.data[(sy * s.w + sx) * 4 + 3] ?? 0
  if (a === 0) {
    return null
  }
  return {
    type: 'color',
    r: s.data[(sy * s.w + sx) * 4] ?? 0,
    g: s.data[(sy * s.w + sx) * 4 + 1] ?? 0,
    b: s.data[(sy * s.w + sx) * 4 + 2] ?? 0,
    a,
  }
}

/**
 * Untransformed stamp fast path: iterate the sprite directly instead of inverse-mapping the destination.
 */
const blitIdentity = (
  ctx: Context,
  s: Sprite,
  px: number,
  py: number,
  tint: Tint,
  extraMask: Region | undefined,
): void => {
  for (let sy = 0; sy < s.h; sy++) {
    for (let sx = 0; sx < s.w; sx++) {
      const c = spriteTexel(s, sx, sy)
      if (!c) {
        continue
      }
      const dx = px + sx
      const dy = py + sy
      if (!ctx.buffer.inBounds(dx, dy) || stampMasked(ctx, extraMask, dx, dy)) {
        continue
      }
      ctx.buffer.blendColor(dx, dy, applyTint(c, tint))
    }
  }
}

/** Dest bbox by forward-mapping the source corners; null on singular map. */
const stampDestBounds = (
  ctx: Context,
  sprite: Sprite,
  px: number,
  py: number,
  matrix: readonly number[],
): BBox | null => {
  let bx0 = Number.POSITIVE_INFINITY
  let by0 = Number.POSITIVE_INFINITY
  let bx1 = Number.NEGATIVE_INFINITY
  let by1 = Number.NEGATIVE_INFINITY
  const corners: [number, number][] = [
    [-0.5, -0.5],
    [sprite.w - 0.5, -0.5],
    [-0.5, sprite.h - 0.5],
    [sprite.w - 0.5, sprite.h - 0.5],
  ]
  for (const [cx, cy] of corners) {
    const p = applyMatrix(matrix, cx, cy)
    if (!p) {
      return null
    }
    bx0 = Math.min(bx0, p.x)
    by0 = Math.min(by0, p.y)
    bx1 = Math.max(bx1, p.x)
    by1 = Math.max(by1, p.y)
  }
  return {
    x0: Math.max(0, Math.floor(px + bx0)),
    y0: Math.max(0, Math.floor(py + by0)),
    x1: Math.min(ctx.buffer.width - 1, Math.ceil(px + bx1)),
    y1: Math.min(ctx.buffer.height - 1, Math.ceil(py + by1)),
  }
}

/** Inverse-map a dest pixel to its sprite texel; null when off-sprite/transparent. */
const stampTexelAt = (
  sprite: Sprite,
  inverse: readonly number[],
  px: number,
  py: number,
  dx: number,
  dy: number,
): Color | null => {
  const p = applyMatrix(inverse, dx - px, dy - py)
  if (!p) {
    return null
  }
  const sx = roundHalfUp(p.x)
  const sy = roundHalfUp(p.y)
  if (sx < 0 || sy < 0 || sx >= sprite.w || sy >= sprite.h) {
    return null
  }
  return spriteTexel(sprite, sx, sy)
}

/**
 * Blit a sprite at (px, py) with an optional source-space transform:
 * dest = (px, py) + M(src). Inverse-mapped nearest-neighbour; alpha
 * honoured; identity blits directly. Each written destination pixel ticks
 * Framebuffer.onWrite (the pixel-write budget hook) via blendColor.
 */
export const stampSprite = (
  ctx: Context,
  sprite: Sprite,
  px: number,
  py: number,
  matrix?: readonly number[],
  tint?: Tint,
  extraMask?: Region,
): boolean => {
  if (!matrix) {
    blitIdentity(ctx, sprite, px, py, tint, extraMask)
    return true
  }
  const inverse = invertMatrix(matrix)
  if (!inverse) {
    return false
  }
  const bounds = stampDestBounds(ctx, sprite, px, py, matrix)
  if (!bounds) {
    return false
  }
  for (let dy = bounds.y0; dy <= bounds.y1; dy++) {
    for (let dx = bounds.x0; dx <= bounds.x1; dx++) {
      if (stampMasked(ctx, extraMask, dx, dy)) {
        continue
      }
      const c = stampTexelAt(sprite, inverse, px, py, dx, dy)
      if (c) {
        ctx.buffer.blendColor(dx, dy, applyTint(c, tint))
      }
    }
  }
  return true
}

/** Integer nearest-neighbour scale (for @N exports and explicit sizes). */
export const scaleBitmap = (
  data: Uint8Array,
  width: number,
  height: number,
  newWidth: number,
  newHeight: number,
): Uint8Array => {
  const out = new Uint8Array(newWidth * newHeight * 4)
  for (let y = 0; y < newHeight; y++) {
    const sy = Math.min(height - 1, Math.floor((y * height) / newHeight))
    for (let x = 0; x < newWidth; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / newWidth))
      const si = (sy * width + sx) * 4
      const di = (y * newWidth + x) * 4
      out[di] = data[si] ?? 0
      out[di + 1] = data[si + 1] ?? 0
      out[di + 2] = data[si + 2] ?? 0
      out[di + 3] = data[si + 3] ?? 0
    }
  }
  return out
}

// ── built-in filters (spec §12) ─────────────────────────────────────────────

/** One 4-connected dilation pass; newly-covered non-opaque pixels feed the sink. */
const dilateStep = (
  current: Uint8Array,
  opaque: Uint8Array,
  sink: PixelSink,
  width: number,
  height: number,
): Uint8Array => {
  const next = new Uint8Array(current)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (current[y * width + x] === 1) {
        continue
      }
      const nb =
        cell(current, width, height, x - 1, y) +
        cell(current, width, height, x + 1, y) +
        cell(current, width, height, x, y - 1) +
        cell(current, width, height, x, y + 1)
      if (nb > 0) {
        next[y * width + x] = 1
        if (opaque[y * width + x] !== 1) {
          sink.add(x, y)
        }
      }
    }
  }
  return next
}

/**
 * N-pixel outline filter: dilate the opaque silhouette width times (4-connected) and paint the
 * newly-covered, still-non-opaque ring.
 */
export const filterOutline = (ctx: Context, paint: Paint, width: number): void => {
  const buffer = ctx.buffer
  const opaque = new Uint8Array(buffer.width * buffer.height)
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      if (buffer.alphaAt(x, y) > 0) {
        opaque[y * buffer.width + x] = 1
      }
    }
  }
  let current: Uint8Array = opaque
  const sink = new PixelSink()
  for (let n = 0; n < width; n++) {
    current = dilateStep(current, opaque, sink, buffer.width, buffer.height)
  }
  sink.paint(ctx, paint)
}

/**
 * Replace every pixel whose committed RGBA exactly equals from with to (raw set, not blended); mask-respecting.
 */
export const filterReplace = (ctx: Context, from: Color, to: Color): void => {
  const buffer = ctx.buffer
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      if (ctx.mask && !ctx.mask.has(x, y)) {
        continue
      }
      const color = buffer.get(x, y)
      if (color.r === from.r && color.g === from.g && color.b === from.b && color.a === from.a) {
        buffer.set(x, y, to)
      }
    }
  }
}

/** Mix paint into every opaque pixel at OkLCh amount, preserving each pixel's original alpha. */
export const filterTint = (ctx: Context, paint: Color, amount: number): void => {
  const buffer = ctx.buffer
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      if (ctx.mask && !ctx.mask.has(x, y)) {
        continue
      }
      const color = buffer.get(x, y)
      if (color.a === 0) {
        continue
      }
      const mixed = mix(color, paint, amount)
      buffer.set(x, y, { ...mixed, a: color.a })
    }
  }
}

/**
 * Offset-silhouette drop shadow: render the alpha silhouette shifted by (dx, dy) in paint
 * underneath, then composite the original content back over it.
 *
 * When `respectMask` is set (language version 2, ADR-0070) an enclosing `mask …:` block confines
 * the effect — only mask-visible pixels are rewritten (the shadow is cast from the whole buffer
 * but lands only inside the mask; masked-off pixels keep their content), consistent with the
 * texture filters and region shadow forms. Under `drawstic 1` (`respectMask` false) it rebuilds
 * the whole buffer, ignoring the mask — the pinned v1 behaviour.
 */
export const filterShadow = (
  ctx: Context,
  dx: number,
  dy: number,
  paint: Color,
  respectMask = false,
): void => {
  const buffer = ctx.buffer
  const mask = respectMask ? ctx.mask : null
  const original = buffer.clone()
  // clear only the pixels we may write (in-mask, or all when unmasked); masked-off pixels retain
  // their content so the shadow stays confined to the mask
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      if (mask && !mask.has(x, y)) {
        continue
      }
      buffer.set(x, y, TRANSPARENT)
    }
  }
  // shadow layer: the opaque silhouette, offset, in the shadow paint — only where writable
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      const a = original.alphaAt(x, y)
      if (a === 0) {
        continue
      }
      const sx = x + dx
      const sy = y + dy
      if (!buffer.inBounds(sx, sy)) {
        continue
      }
      if (mask && !mask.has(sx, sy)) {
        continue
      }
      buffer.blend(sx, sy, paint.r, paint.g, paint.b, roundHalfUp((paint.a * a) / 255))
    }
  }
  // original over the shadow — only where writable (masked-off pixels already hold the original)
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      if (mask && !mask.has(x, y)) {
        continue
      }
      const c = original.get(x, y)
      if (c.a > 0) {
        buffer.blendColor(x, y, c)
      }
    }
  }
}

// ── text (ADR-0022/0042) ────────────────────────────────────────────────────

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/**
 * Deterministic per-pixel hash of (seed, x, y) to [0,1) (integer ops only); drives the
 * grain/speckle/ripple/dither filters below.
 */
const hashUnit = (seed: number, x: number, y: number): number => {
  let h = (seed | 0) ^ Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0xc2b2ae35, 0x27d4eb2f)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 0x100000000
}

/**
 * Visit every mask-visible, non-transparent pixel of the buffer. An optional `region` (ADR-0071)
 * further confines the visit to that region — the effect lands only on the intersection of the
 * region, the active mask, and the opaque pixels.
 */
const forOpaquePixels = (
  ctx: Context,
  visit: (x: number, y: number, source: Color) => void,
  region?: Region | null,
): void => {
  const { buffer } = ctx
  for (let y = 0; y < buffer.height; y++) {
    for (let x = 0; x < buffer.width; x++) {
      if (ctx.mask && !ctx.mask.has(x, y)) {
        continue
      }
      if (region && !region.has(x, y)) {
        continue
      }
      const source = buffer.get(x, y)
      if (source.a > 0) {
        visit(x, y, source)
      }
    }
  }
}

/**
 * Per-pixel alpha noise: pixels with hashUnit <= amount get paint blended in at alpha scaled by amount.
 */
export const filterGrain = (
  ctx: Context,
  amount: number,
  seed: number,
  paint: Paint,
  region?: Region | null,
): void => {
  const strength = clamp01(amount)
  const bbox: BBox = { x0: 0, y0: 0, x1: ctx.buffer.width - 1, y1: ctx.buffer.height - 1 }
  forOpaquePixels(
    ctx,
    (x, y) => {
      if (hashUnit(seed, x, y) <= strength) {
        const c = paintAt(paint, x, y, bbox, ctx.mode)
        ctx.buffer.blend(x, y, c.r, c.g, c.b, roundHalfUp(c.a * strength))
      }
    },
    region,
  )
}

/**
 * Sparse full-alpha speckles: pixels with hashUnit <= density get paint blended in at its own alpha.
 */
export const filterSpeckle = (
  ctx: Context,
  density: number,
  seed: number,
  paint: Paint,
  region?: Region | null,
): void => {
  const chance = clamp01(density)
  const bbox: BBox = { x0: 0, y0: 0, x1: ctx.buffer.width - 1, y1: ctx.buffer.height - 1 }
  forOpaquePixels(
    ctx,
    (x, y) => {
      if (hashUnit(seed, x, y) <= chance) {
        ctx.buffer.blendColor(x, y, paintAt(paint, x, y, bbox, ctx.mode))
      }
    },
    region,
  )
}

/**
 * Banded distortion overlay: coarse hashed 4-row/8-col bands get paint blended in at alpha scaled by strength.
 */
export const filterRipple = (
  ctx: Context,
  strength: number,
  seed: number,
  paint: Paint,
  region?: Region | null,
): void => {
  const amount = clamp01(strength)
  const bbox: BBox = { x0: 0, y0: 0, x1: ctx.buffer.width - 1, y1: ctx.buffer.height - 1 }
  forOpaquePixels(
    ctx,
    (x, y) => {
      const band = ((y + Math.floor(hashUnit(seed, x >> 3, y >> 2) * 4)) & 3) === 0
      if (band) {
        const c = paintAt(paint, x, y, bbox, ctx.mode)
        ctx.buffer.blend(x, y, c.r, c.g, c.b, roundHalfUp(c.a * amount))
      }
    },
    region,
  )
}

/**
 * Ordered (Bayer) dither between paintA and paintB at threshold; every opaque pixel is repainted (raw set).
 */
export const filterDither = (
  ctx: Context,
  paintA: Paint,
  paintB: Paint,
  threshold: number,
  region?: Region | null,
): void => {
  const limit = clamp01(threshold)
  const bbox: BBox = { x0: 0, y0: 0, x1: ctx.buffer.width - 1, y1: ctx.buffer.height - 1 }
  forOpaquePixels(
    ctx,
    (x, y) => {
      const th = ((BAYER4[(y & 3) * 4 + (x & 3)] ?? 0) + 0.5) / 16
      ctx.buffer.set(x, y, paintAt(th < limit ? paintA : paintB, x, y, bbox, ctx.mode))
    },
    region,
  )
}

/**
 * Iterate every in-bounds, in-mask, in-region pixel of `region`, invoking `paint(x, y, t)` with
 * `t` = the pixel's distance from `light` normalized to the region bbox's farthest corner (clamped
 * to [0,1]; 0 at `light`, 1 at the far corner). Shared spine of the distance-scaled lighting helpers
 * (ADR-0063, ADR-0068, ADR-0069) so `shadeRegion`/`lightRegion` stay pixel-consistent.
 */
const forRegionDistance = (
  ctx: Context,
  region: Region,
  light: { readonly x: number; readonly y: number },
  paint: (x: number, y: number, t: number) => void,
): void => {
  const b = regionBounds(ctx, region)
  if (!b) {
    return
  }
  const maxDist = Math.max(
    1,
    dhypot(b.x0 - light.x, b.y0 - light.y),
    dhypot(b.x1 - light.x, b.y0 - light.y),
    dhypot(b.x0 - light.x, b.y1 - light.y),
    dhypot(b.x1 - light.x, b.y1 - light.y),
  )
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      if (ctx.mask && !ctx.mask.has(x, y)) {
        continue
      }
      if (region.has(x, y)) {
        paint(x, y, clamp01(dhypot(x - light.x, y - light.y) / maxDist))
      }
    }
  }
}

/**
 * v2 directional distance shading (ADR-0068): blend `base` as a shadow veil over `region` with
 * opacity `base.a × amount × t`, where `t` is the pixel's normalized distance from `light`. Nearest
 * to `light` is untouched; the far corner reaches `base.a × amount`. Here `amount` is the veil
 * opacity — an opaque `base` no longer repaints the region, it just makes the veil reach full black.
 */
export const shadeRegion = (
  ctx: Context,
  region: Region,
  light: { readonly x: number; readonly y: number },
  base: Color,
  amount: number,
): void => {
  const strength = clamp01(amount)
  forRegionDistance(ctx, region, light, (x, y, t) => {
    ctx.buffer.blend(x, y, base.r, base.g, base.b, roundHalfUp(base.a * strength * t))
  })
}

/**
 * v1 directional distance shading (ADR-0063), retained for `drawstic 1` recipes: mix `base` toward
 * black within `region` at constant `base.a` veil opacity, the black-mix fraction scaled by distance
 * from `light` and `amount`. Superseded by {@link shadeRegion} from language version 2 (ADR-0068),
 * where `base` alpha no longer doubles as veil opacity.
 */
export const shadeRegionLegacy = (
  ctx: Context,
  region: Region,
  light: { readonly x: number; readonly y: number },
  base: Color,
  amount: number,
): void => {
  const dark = { type: 'color' as const, r: 0, g: 0, b: 0, a: base.a }
  forRegionDistance(ctx, region, light, (x, y, t) => {
    ctx.buffer.blendColor(x, y, mix(base, dark, clamp01(t * amount)))
  })
}

/**
 * v2 additive counterpart to {@link shadeRegion} (ADR-0069): blend `paint` as a light veil over
 * `region` with opacity `paint.a × amount × (1 − t)`, where `t` is the pixel's normalized distance
 * from `light`. Nearest to `light` is brightest (up to `paint.a × amount`); the far corner is
 * untouched. Mirror-symmetric to `shadeRegion` — that darkens by `t`, this brightens by `1 − t`.
 */
export const lightRegion = (
  ctx: Context,
  region: Region,
  light: { readonly x: number; readonly y: number },
  paint: Color,
  amount: number,
): void => {
  const strength = clamp01(amount)
  forRegionDistance(ctx, region, light, (x, y, t) => {
    ctx.buffer.blend(x, y, paint.r, paint.g, paint.b, roundHalfUp(paint.a * strength * (1 - t)))
  })
}

/**
 * Width-pixel directional rim light: paints the band of region not covered by region shifted
 * in the opposite direction, one shift-step per pixel of width.
 */
export const rimRegion = (
  ctx: Context,
  region: Region,
  direction: { readonly x: number; readonly y: number },
  paint: Paint,
  width: number,
): void => {
  const dx = Math.sign(direction.x)
  const dy = Math.sign(direction.y)
  if (dx === 0 && dy === 0) {
    return
  }
  for (let i = 0; i < Math.max(1, width); i++) {
    fillRegion(
      ctx,
      {
        type: 'region',
        bbox: region.bbox,
        has: (x, y) => region.has(x, y) && !region.has(x - dx * (i + 1), y - dy * (i + 1)),
        test: (fx, fy) => region.test(fx, fy) && !region.test(fx - dx * (i + 1), fy - dy * (i + 1)),
      },
      paint,
    )
  }
}

/** Convenience filter: a 1px inner-boundary stroke of region at paint alpha scaled by amount. */
export const ambientOcclusion = (
  ctx: Context,
  region: Region,
  paint: Color,
  amount: number,
): void => {
  strokeRegion(ctx, region, { ...paint, a: roundHalfUp(paint.a * clamp01(amount)) }, 1)
}

/**
 * A user-defined font (ADR-0042): character → drawing/inline-glyph map, with layout constants
 * and an optional fallback face.
 */
export type UserFontResolved = {
  readonly kind: 'user'
  readonly name: string
  readonly glyphs: Map<string, Sprite>
  readonly inlineGlyphs: Map<
    string,
    {
      readonly width: number
      readonly height: number
      readonly draw: (ctx: Context, x: number, y: number, paint: Paint) => void
    }
  >
  readonly fallback: FontResolved | null
  readonly tracking: number
  readonly lineHeight: number
  readonly height: number
}

/** A resolved font: the bundled bitmap face, or a user-defined glyph map. */
export type FontResolved = { readonly kind: 'bitmap'; readonly font: BitmapFont } | UserFontResolved

/** Blit a glyph's '#'-marked bitmap rows through putPixel at (x, y). */
const drawBitmapGlyph = (
  ctx: Context,
  rows: string[],
  x: number,
  y: number,
  paint: Paint,
  bbox: BBox,
): void => {
  for (let gy = 0; gy < rows.length; gy++) {
    const row = rows[gy] ?? ''
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx] === '#') {
        putPixel(ctx, x + gx, y + gy, paint, bbox)
      }
    }
  }
}

/** Resolve a bitmap glyph key (direct, then upcased fallback). */
const glyphKey = (font: BitmapFont, char: string): string | null => {
  if (font.glyphs.has(char)) {
    return char
  }
  if (font.upcase && font.glyphs.has(char.toUpperCase())) {
    return char.toUpperCase()
  }
  return null
}

/** Resolve a glyph's pixel rows, falling back to the missing-glyph box when unmapped (ADR-0022). */
const bitmapGlyphRows = (font: BitmapFont, char: string): string[] => {
  const key = glyphKey(font, char)
  if (key === null) {
    return missingGlyph(font.w, font.h)
  }
  return font.glyphs.get(key) ?? missingGlyph(font.w, font.h)
}

/**
 * Lay out bundled bitmap-font text left to right: fixed 1px tracking, newline advances by lineHeight (ADR-0022).
 */
const drawBitmapText = (
  ctx: Context,
  font: BitmapFont,
  x0: number,
  y0: number,
  text: string,
  paint: Paint,
): { x: number; y: number } => {
  let x = x0
  let y = y0
  for (const ch of text) {
    if (ch === '\n') {
      x = x0
      y += font.lineHeight
      continue
    }
    const bbox: BBox = { x0: x, y0: y, x1: x + font.w - 1, y1: y + font.h - 1 }
    drawBitmapGlyph(ctx, bitmapGlyphRows(font, ch), x, y, paint, bbox)
    x += font.w + font.tracking
  }
  return { x, y }
}

/** Draw one user-font glyph at (x, y); returns the horizontal advance. */
const drawUserGlyph = (
  ctx: Context,
  font: UserFontResolved,
  char: string,
  x: number,
  y: number,
  paint: Paint,
): number => {
  const inline = font.inlineGlyphs.get(char)
  if (inline) {
    inline.draw(ctx, x, y, paint)
    return inline.width + font.tracking
  }
  const glyph = font.glyphs.get(char)
  if (glyph) {
    stampSprite(ctx, glyph, x, y)
    return glyph.w + font.tracking
  }
  if (font.fallback) {
    return drawText(ctx, font.fallback, x, y, char, paint).x - x
  }
  const rows = missingGlyph(Math.max(3, font.height - 2), font.height)
  const rw = rows[0]?.length ?? 3
  drawBitmapGlyph(ctx, rows, x, y, paint, { x0: x, y0: y, x1: x + rw - 1, y1: y + font.height - 1 })
  return rw + font.tracking
}

/** Draw text; returns the cursor end position (§8). */
export const drawText = (
  ctx: Context,
  font: FontResolved,
  x0: number,
  y0: number,
  text: string,
  paint: Paint,
): { x: number; y: number } => {
  if (font.kind === 'bitmap') {
    return drawBitmapText(ctx, font.font, x0, y0, text, paint)
  }
  let x = x0
  let y = y0
  // user font: glyphs are drawings, blitted like stamp (paint not applied)
  for (const ch of text) {
    if (ch === '\n') {
      x = x0
      y += font.lineHeight
      continue
    }
    x += drawUserGlyph(ctx, font, ch, x, y, paint)
  }
  return { x, y }
}
