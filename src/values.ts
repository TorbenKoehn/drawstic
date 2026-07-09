// Runtime values: points, lists, gradients, first-class transforms
// (ADR-0044), regions (ADR-0036/0039), and rendered sprites.

import type { Color } from './color.js'
import { dcosDeg, dsinDeg, roundHalfUp } from './dmath.js'

/**
 * A 2D point. `rel` marks a point built with the `rel` keyword inside a `path` pen block — an
 * offset from the current pen position rather than an absolute canvas coordinate
 * (ADR-0061). Elsewhere points are always absolute.
 */
export type Point = { type: 'point'; x: number; y: number; rel: boolean }
export type PathPoint = { readonly x: number; readonly y: number }
/**
 * One subpath: an ordered polyline approximation of the authored commands, plus
 * whether it was closed (`close`/a closed shape) for fill/stroke purposes.
 */
export type PathContour = {
  readonly points: readonly PathPoint[]
  readonly closed: boolean
}
export type PathCommand =
  | { readonly kind: 'move'; readonly to: PathPoint }
  | { readonly kind: 'line'; readonly to: PathPoint }
  | { readonly kind: 'quad'; readonly control: PathPoint; readonly to: PathPoint }
  | {
      readonly kind: 'bezier'
      readonly control1: PathPoint
      readonly control2: PathPoint
      readonly to: PathPoint
    }
  | {
      readonly kind: 'arc'
      readonly center: PathPoint
      readonly to: PathPoint
      readonly clockwise: boolean
    }
  | { readonly kind: 'close' }
/**
 * A first-class vector value (ADR-0061): pen commands plus their polyline
 * approximation. `region` caches a region-backed path's coverage (e.g. from
 * {@link pathFromRegion}) so {@link pathFillRegion} doesn't need to re-derive it.
 */
export type Path = {
  type: 'path'
  contours: readonly PathContour[]
  commands: readonly PathCommand[]
  viewBox: { readonly width: number; readonly height: number } | undefined
  region: Region | undefined
}
export type List = { type: 'list'; items: Value[] }
/**
 * A gradient value. `angle` is degrees, clockwise, meaningful for `kind: 'linear'` only. `pos` is
 * 0..1 along the gradient axis; `null` stops are spaced evenly between pinned
 * neighbours. `space` selects the interpolation colour space (ADR-0009).
 */
export type Grad = {
  type: 'grad'
  kind: 'linear' | 'radial'
  angle: number
  stops: { c: Color; pos: number | null }[]
  space: 'oklch' | 'rgb' | 'hsl'
}
/**
 * A transform value. `m` is a 16-element row-major 4×4 homogeneous matrix — see the transforms
 * section below (ADR-0044) for layout and composition order.
 */
export type Transform = { type: 'transform'; m: readonly number[] }
/** Integer pixel bounds, inclusive on all four edges (`x0 <= x1`, `y0 <= y1`). */
export type BBox = { x0: number; y0: number; x1: number; y1: number }
export type Region = {
  type: 'region'
  bbox: BBox | null
  /** Pixel-mode coverage at integer pixel (x, y). */
  has: (x: number, y: number) => boolean
  /** Continuous coverage test for smooth mode. */
  test: (fx: number, fy: number) => boolean
}
/** A rendered drawing: straight-alpha RGBA8 bitmap + its palette artifact. */
export type Sprite = {
  type: 'sprite'
  name: string
  w: number
  h: number
  /**
   * The pixel store: `w × h × 4` bytes, row-major top-to-bottom, straight-alpha
   * RGBA8 per pixel (ADR-0025) — the same layout the framebuffer, PNG, JPEG, and
   * SVG encoders consume.
   */
  data: Uint8Array
  /**
   * Deterministic palette artifact (ADR-0002/ADR-0055): `key` is the single-char
   * grid key (or `''` for non-grid entries), `source` is the declaring definition
   * name, used to order/dedupe entries in indexed-PNG export.
   */
  pal: { key: string; color: Color; source: string }[]
  title: string | undefined
  desc: string | undefined
}

export type Value =
  | number
  | boolean
  | string
  | Color
  | Point
  | List
  | Grad
  | Transform
  | Region
  | Path
  | Sprite

export const point = (x: number, y: number, rel = false): Point => ({ type: 'point', x, y, rel })
export const list = (items: Value[]): List => ({ type: 'list', items })
export const path = (
  contours: readonly PathContour[],
  commands: readonly PathCommand[] = [],
  viewBox?: { readonly width: number; readonly height: number },
  region?: Region,
): Path => ({ type: 'path', contours, commands, viewBox, region })

export const isObj = (v: Value): v is Exclude<Value, number | boolean | string> =>
  typeof v === 'object' && v !== null

export const typeName = (v: Value): string => {
  if (typeof v === 'number') {
    return 'number'
  }
  if (typeof v === 'boolean') {
    return 'boolean'
  }
  if (typeof v === 'string') {
    return 'string'
  }
  return v.type
}

// ── transforms: 4×4 homogeneous, row-major (ADR-0044) ───────────────────────

export const IDENTITY: readonly number[] = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
])

/**
 * Row-major 4×4 matrix product `a·b` — applies `b` first, then `a`; callers pick
 * the order (see {@link compose} for the reading-order-as-application-order form).
 */
export const multiplyMatrix = (a: readonly number[], b: readonly number[]): readonly number[] => {
  const r = new Array<number>(16).fill(0)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) {
        s += (a[i * 4 + k] ?? 0) * (b[k * 4 + j] ?? 0)
      }
      r[i * 4 + j] = s
    }
  }
  return r
}

/** Reading-order composition: `first.then(second)` → second ∘ first. */
export const compose = (first: readonly number[], second: readonly number[]): readonly number[] =>
  multiplyMatrix(second, first)

/**
 * Maps `(x, y)` through `m` in homogeneous coordinates (implicit `z = 0`) and
 * perspective-divides by the resulting `w`. Returns `null` when `w = 0` — the point
 * maps to infinity (a non-invertible projection, ADR-0044 §5).
 */
export const applyMatrix = (
  m: readonly number[],
  x: number,
  y: number,
): { x: number; y: number } | null => {
  const resultX = (m[0] ?? 0) * x + (m[1] ?? 0) * y + (m[3] ?? 0)
  const resultY = (m[4] ?? 0) * x + (m[5] ?? 0) * y + (m[7] ?? 0)
  const resultW = (m[12] ?? 0) * x + (m[13] ?? 0) * y + (m[15] ?? 1)
  if (resultW === 0) {
    return null
  }
  return { x: resultX / resultW, y: resultY / resultW }
}

/** Translation by `(dx, dy)` pixels. */
export const translation = (dx: number, dy: number): number[] => [
  1,
  0,
  0,
  dx,
  0,
  1,
  0,
  dy,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
]

/**
 * Rotation by degrees, clockwise on screen (y-down raster coords). Exact at
 * multiples of 90° so quarter-turns stay lossless (ADR-0043).
 */
export const rotationDeg = (deg: number): number[] => {
  const c = dcosDeg(deg)
  const s = dsinDeg(deg)
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** Non-uniform scale about the origin `0:0`. */
export const scaling = (sx: number, sy: number): number[] => [
  sx,
  0,
  0,
  0,
  0,
  sy,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
]

/** Horizontal shear by degrees (x' = x + y·tan(deg)). */
export const skewX = (deg: number): number[] => {
  const t = dsinDeg(deg) / dcosDeg(deg)
  return [1, t, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/**
 * A 3D rotation by degrees about the x-axis, projected back to the plane by a
 * paired {@link perspectiveMatrix} (ADR-0044 §1) — used for card-flip effects.
 */
export const rotationXDeg = (deg: number): number[] => {
  const c = dcosDeg(deg)
  const s = dsinDeg(deg)
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
}

/** A 3D rotation by degrees about the y-axis; see {@link rotationXDeg}. */
export const rotationYDeg = (deg: number): number[] => {
  const c = dcosDeg(deg)
  const s = dsinDeg(deg)
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]
}

/**
 * Perspective projection at distance `d` pixels; applies to subsequent 3D terms
 * in a composed transform (ADR-0044).
 */
export const perspectiveMatrix = (d: number): number[] => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  -1 / d,
  1,
]

/** Conjugate m to the pivot p: T(p) · m · T(−p). */
export const aboutPoint = (m: readonly number[], px: number, py: number): readonly number[] =>
  multiplyMatrix(translation(px, py), multiplyMatrix(m, translation(-px, -py)))

/** The 4×4 matrix inverse via Gauss-Jordan; `undefined` when singular (non-invertible). */
export const invertMatrix = (m: readonly number[]): readonly number[] | undefined => {
  const a = m.slice()
  const inv = IDENTITY.slice()
  for (let col = 0; col < 4; col++) {
    // pivot: largest |value| in this column
    let piv = col
    for (let r = col + 1; r < 4; r++) {
      if (Math.abs(a[r * 4 + col] ?? 0) > Math.abs(a[piv * 4 + col] ?? 0)) {
        piv = r
      }
    }
    const pv = a[piv * 4 + col] ?? 0
    if (Math.abs(pv) < 1e-12) {
      return undefined
    }
    if (piv !== col) {
      for (let k = 0; k < 4; k++) {
        const t1 = a[col * 4 + k] as number
        a[col * 4 + k] = a[piv * 4 + k] as number
        a[piv * 4 + k] = t1
        const t2 = inv[col * 4 + k] as number
        inv[col * 4 + k] = inv[piv * 4 + k] as number
        inv[piv * 4 + k] = t2
      }
    }
    const d = a[col * 4 + col] as number
    for (let k = 0; k < 4; k++) {
      a[col * 4 + k] = (a[col * 4 + k] as number) / d
      inv[col * 4 + k] = (inv[col * 4 + k] as number) / d
    }
    for (let r = 0; r < 4; r++) {
      if (r === col) {
        continue
      }
      const f = a[r * 4 + col] as number
      if (f === 0) {
        continue
      }
      for (let k = 0; k < 4; k++) {
        a[r * 4 + k] = (a[r * 4 + k] as number) - f * (a[col * 4 + k] as number)
        inv[r * 4 + k] = (inv[r * 4 + k] as number) - f * (inv[col * 4 + k] as number)
      }
    }
  }
  return inv
}

// ── regions (extensional coverage, ADR-0039) ────────────────────────────────

export const emptyRegion: Region = {
  type: 'region',
  bbox: null,
  has: () => false,
  test: () => false,
}

/** Midpoint-circle span table: spans[|dy|] = max |dx| on that row (ADR-0028). */
export const circleSpans = (r: number): number[] => {
  const spans = new Array<number>(r + 1).fill(-1)
  let x = r
  let y = 0
  let e = 1 - r
  while (x >= y) {
    if ((spans[y] ?? -1) < x) {
      spans[y] = x
    }
    if ((spans[x] ?? -1) < y) {
      spans[x] = y
    }
    y++
    if (e < 0) {
      e += 2 * y + 1
    } else {
      x--
      e += 2 * (y - x) + 1
    }
  }
  return spans
}

/**
 * Even-diameter circle: footprint spans `cx-ri..cx+ri-1` (`ri = round(r)`) on each
 * axis — `2·ri` pixels wide/tall — with the disc centred at the pixel-corner
 * `(cx-0.5, cy-0.5)` so the declared radius yields a balanced pixel-perfect
 * diameter; `r = 0` is a single pixel (ADR-0056, supersedes the odd-footprint rule
 * of ADR-0028 §3).
 */
export const circleRegion = (cx: number, cy: number, r: number): Region => {
  const ri = Math.max(0, roundHalfUp(r))
  if (ri === 0) {
    return {
      type: 'region',
      bbox: { x0: cx, y0: cy, x1: cx, y1: cy },
      has: (x, y) => x === cx && y === cy,
      test: (fx, fy) => fx === cx && fy === cy,
    }
  }
  const pcx = cx - 0.5
  const pcy = cy - 0.5
  const r2 = ri * ri
  return {
    type: 'region',
    bbox: { x0: cx - ri, y0: cy - ri, x1: cx + ri - 1, y1: cy + ri - 1 },
    has: (x, y) => {
      if (x < cx - ri || x > cx + ri - 1 || y < cy - ri || y > cy + ri - 1) {
        return false
      }
      const dx = x - pcx
      const dy = y - pcy
      return dx * dx + dy * dy <= r2
    },
    test: (fx, fy) => {
      const dx = fx - pcx
      const dy = fy - pcy
      return dx * dx + dy * dy <= r * r
    },
  }
}

/** Midpoint-ellipse span table per |dy| (integer two-region algorithm). */
export const ellipseSpans = (rx: number, ry: number): number[] => {
  const spans = new Array<number>(ry + 1).fill(-1)
  if (rx === 0 || ry === 0) {
    for (let i = 0; i <= ry; i++) {
      spans[i] = rx === 0 ? 0 : rx
    }
    if (ry === 0) {
      spans[0] = rx
    }
    return spans
  }
  const rx2 = rx * rx
  const ry2 = ry * ry
  let x = 0
  let y = ry
  let d1 = ry2 - rx2 * ry + 0.25 * rx2
  let dx = 2 * ry2 * x
  let dy = 2 * rx2 * y
  while (dx < dy) {
    if ((spans[y] ?? -1) < x) {
      spans[y] = x
    }
    if (d1 < 0) {
      x++
      dx += 2 * ry2
      d1 += dx + ry2
    } else {
      x++
      y--
      dx += 2 * ry2
      dy -= 2 * rx2
      d1 += dx - dy + ry2
    }
  }
  let d2 = ry2 * ((x + 0.5) * (x + 0.5)) + rx2 * ((y - 1) * (y - 1)) - rx2 * ry2
  while (y >= 0) {
    if ((spans[y] ?? -1) < x) {
      spans[y] = x
    }
    if (d2 > 0) {
      y--
      dy -= 2 * rx2
      d2 += rx2 - dy
    } else {
      y--
      x++
      dx += 2 * ry2
      dy -= 2 * rx2
      d2 += dx - dy + rx2
    }
  }
  return spans
}

/**
 * Odd `(2·rx+1) × (2·ry+1)` footprint centred on the integer pixel `(cx, cy)` —
 * unlike {@link circleRegion}, `ellipse` keeps the original integer-radius
 * centering rule (ADR-0028 §3).
 */
export const ellipseRegion = (cx: number, cy: number, rx: number, ry: number): Region => {
  const rxi = Math.max(0, roundHalfUp(rx))
  const ryi = Math.max(0, roundHalfUp(ry))
  const spans = ellipseSpans(rxi, ryi)
  return {
    type: 'region',
    bbox: { x0: cx - rxi, y0: cy - ryi, x1: cx + rxi, y1: cy + ryi },
    has: (x, y) => {
      const dy = Math.abs(y - cy)
      if (dy > ryi) {
        return false
      }
      return Math.abs(x - cx) <= (spans[dy] ?? -1)
    },
    test: (fx, fy) => {
      if (rx === 0 || ry === 0) {
        return false
      }
      const dx = (fx - cx) / rx
      const dy = (fy - cy) / ry
      return dx * dx + dy * dy <= 1
    },
  }
}

/** Axis-aligned rect between two opposite corners, either order. */
export const rectRegion = (ax: number, ay: number, bx: number, by: number): Region => {
  const x0 = Math.min(ax, bx)
  const y0 = Math.min(ay, by)
  const x1 = Math.max(ax, bx)
  const y1 = Math.max(ay, by)
  return {
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
    test: (fx, fy) => fx >= x0 - 0.5 && fx <= x1 + 0.5 && fy >= y0 - 0.5 && fy <= y1 + 0.5,
  }
}

/**
 * Rounded rect; the corner radius is clamped to at most half the shorter side so
 * corners never overlap.
 */
export const rrectRegion = (ax: number, ay: number, bx: number, by: number, r: number): Region => {
  const x0 = Math.min(ax, bx)
  const y0 = Math.min(ay, by)
  const x1 = Math.max(ax, bx)
  const y1 = Math.max(ay, by)
  const ri = Math.max(
    0,
    Math.min(roundHalfUp(r), Math.floor((x1 - x0) / 2), Math.floor((y1 - y0) / 2)),
  )
  const spans = circleSpans(ri)
  const cornerHas = (x: number, y: number): boolean => {
    // corner centres, inset by ri
    const cx = x < x0 + ri ? x0 + ri : x > x1 - ri ? x1 - ri : null
    const cy = y < y0 + ri ? y0 + ri : y > y1 - ri ? y1 - ri : null
    if (cx === null || cy === null) {
      return true // edge band, not a corner square
    }
    const dy = Math.abs(y - cy)
    return Math.abs(x - cx) <= (spans[dy] ?? -1)
  }
  return {
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && cornerHas(x, y),
    test: (fx, fy) => {
      if (fx < x0 - 0.5 || fx > x1 + 0.5 || fy < y0 - 0.5 || fy > y1 + 0.5) {
        return false
      }
      const cx = fx < x0 + ri ? x0 + ri : fx > x1 - ri ? x1 - ri : null
      const cy = fy < y0 + ri ? y0 + ri : fy > y1 - ri ? y1 - ri : null
      if (cx === null || cy === null) {
        return true
      }
      const dx = fx - cx
      const dy = fy - cy
      return dx * dx + dy * dy <= r * r
    },
  }
}

/** Polygon region: even-odd scanline fill + inclusive Bresenham boundary. */
export const polyRegion = (pts: { x: number; y: number }[]): Region => {
  if (pts.length < 2) {
    return emptyRegion
  }
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  x0 = Math.floor(x0)
  y0 = Math.floor(y0)
  x1 = Math.ceil(x1)
  y1 = Math.ceil(y1)
  const testFill = (fx: number, fy: number): boolean => {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i] as { x: number; y: number }
      const b = pts[j] as { x: number; y: number }
      if (a.y <= fy !== b.y <= fy) {
        const xInt = a.x + ((fy - a.y) / (b.y - a.y)) * (b.x - a.x)
        if (fx < xInt) {
          inside = !inside
        }
      }
    }
    return inside
  }
  // lazy pixel bitmap: fill + boundary lines (inclusive endpoints, ADR-0028)
  let bitmap: Uint8Array | null = null
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const build = (): Uint8Array => {
    const bm = new Uint8Array(bw * bh)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (testFill(x, y)) {
          bm[(y - y0) * bw + (x - x0)] = 1
        }
      }
    }
    // closed boundary via Bresenham
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as { x: number; y: number }
      const b = pts[(i + 1) % pts.length] as { x: number; y: number }
      bresenham(roundHalfUp(a.x), roundHalfUp(a.y), roundHalfUp(b.x), roundHalfUp(b.y), (x, y) => {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
          bm[(y - y0) * bw + (x - x0)] = 1
        }
      })
    }
    return bm
  }
  return {
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) {
        return false
      }
      bitmap ??= build()
      return bitmap[(y - y0) * bw + (x - x0)] === 1
    },
    test: testFill,
  }
}

/** Bresenham line, endpoints inclusive (ADR-0028 §4). */
export const bresenham = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void,
): void => {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let e = dx + dy
  for (;;) {
    plot(x, y)
    if (x === x1 && y === y1) {
      break
    }
    const e2 = 2 * e
    if (e2 >= dy) {
      e += dy
      x += sx
    }
    if (e2 <= dx) {
      e += dx
      y += sy
    }
  }
}

export const bboxUnion = (a: BBox | null, b: BBox | null): BBox | null => {
  if (!a) {
    return b
  }
  if (!b) {
    return a
  }
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }
}

export const bboxIntersect = (a: BBox | null, b: BBox | null): BBox | null => {
  if (!a || !b) {
    return null
  }
  const r = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  }
  return r.x0 > r.x1 || r.y0 > r.y1 ? null : r
}

export const regionUnion = (a: Region, b: Region): Region => ({
  type: 'region',
  bbox: bboxUnion(a.bbox, b.bbox),
  has: (x, y) => a.has(x, y) || b.has(x, y),
  test: (fx, fy) => a.test(fx, fy) || b.test(fx, fy),
})

export const regionIntersect = (a: Region, b: Region): Region => ({
  type: 'region',
  bbox: bboxIntersect(a.bbox, b.bbox),
  has: (x, y) => a.has(x, y) && b.has(x, y),
  test: (fx, fy) => a.test(fx, fy) && b.test(fx, fy),
})

/**
 * Region difference (`a` minus `b`); the bbox stays `a`'s (an over-approximation — not tightened to
 * the actual remaining coverage).
 */
export const regionSubtract = (a: Region, b: Region): Region => ({
  type: 'region',
  bbox: a.bbox,
  has: (x, y) => a.has(x, y) && !b.has(x, y),
  test: (fx, fy) => a.test(fx, fy) && !b.test(fx, fy),
})

export const regionXor = (a: Region, b: Region): Region => ({
  type: 'region',
  bbox: bboxUnion(a.bbox, b.bbox),
  has: (x, y) => a.has(x, y) !== b.has(x, y),
  test: (fx, fy) => a.test(fx, fy) !== b.test(fx, fy),
})

/** Apply a first-class transform to a region: inverse-map membership. */
export const regionTransform = (
  region: Region,
  matrix: readonly number[],
  inverse: readonly number[],
): Region => {
  let bbox: BBox | null = null
  if (region.bbox) {
    const corners = [
      [region.bbox.x0, region.bbox.y0],
      [region.bbox.x1, region.bbox.y0],
      [region.bbox.x0, region.bbox.y1],
      [region.bbox.x1, region.bbox.y1],
    ]
    let ok = true
    let x0 = Number.POSITIVE_INFINITY
    let y0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let y1 = Number.NEGATIVE_INFINITY
    for (const [cx, cy] of corners) {
      const p = applyMatrix(matrix, cx as number, cy as number)
      if (!p) {
        ok = false
        break
      }
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
    if (ok) {
      bbox = {
        x0: Math.floor(x0) - 1,
        y0: Math.floor(y0) - 1,
        x1: Math.ceil(x1) + 1,
        y1: Math.ceil(y1) + 1,
      }
    }
  }
  return {
    type: 'region',
    bbox,
    has: (x, y) => {
      const p = applyMatrix(inverse, x, y)
      if (!p) {
        return false
      }
      return region.has(roundHalfUp(p.x), roundHalfUp(p.y))
    },
    test: (fx, fy) => {
      const p = applyMatrix(inverse, fx, fy)
      if (!p) {
        return false
      }
      return region.test(p.x, p.y)
    },
  }
}

/** A drawing's silhouette as a region: alpha > 0 (spec §9). */
export const spriteRegion = (s: Sprite): Region => ({
  type: 'region',
  bbox: { x0: 0, y0: 0, x1: s.w - 1, y1: s.h - 1 },
  has: (x, y) => {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) {
      return false
    }
    return (s.data[(y * s.w + x) * 4 + 3] ?? 0) > 0
  },
  test: (fx, fy) => {
    const x = roundHalfUp(fx)
    const y = roundHalfUp(fy)
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) {
      return false
    }
    return (s.data[(y * s.w + x) * 4 + 3] ?? 0) > 0
  },
})

const contourBBox = (contours: readonly PathContour[]): BBox | null => {
  let box: BBox | null = null
  for (const contour of contours) {
    for (const p of contour.points) {
      const cell = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      box = bboxUnion(box, cell)
    }
  }
  return box
}

const pointOnSegment = (p: PathPoint, a: PathPoint, b: PathPoint): boolean => {
  const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y)
  if (Math.abs(cross) > 1e-9) {
    return false
  }
  return (
    p.x >= Math.min(a.x, b.x) - 1e-9 &&
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    p.y >= Math.min(a.y, b.y) - 1e-9 &&
    p.y <= Math.max(a.y, b.y) + 1e-9
  )
}

/**
 * Even-odd fill of a path's closed contours (ADR-0061 §4): boundary points count as
 * inside. Open contours are ignored. Returns the cached {@link Path.region} verbatim
 * when the path already carries one (e.g. from {@link pathFromRegion}).
 */
export const pathFillRegion = (p: Path): Region => {
  if (p.region) {
    return p.region
  }
  const closed = p.contours.filter((c) => c.closed && c.points.length >= 2)
  if (closed.length === 0) {
    return emptyRegion
  }
  // `closed` is non-empty with ≥2 points per contour, so contourBBox never returns null.
  const rawBox = contourBBox(closed) as BBox
  const bbox = {
    x0: Math.floor(rawBox.x0),
    y0: Math.floor(rawBox.y0),
    x1: Math.ceil(rawBox.x1),
    y1: Math.ceil(rawBox.y1),
  }
  const test = (fx: number, fy: number): boolean => {
    const pt = { x: fx, y: fy }
    let inside = false
    for (const contour of closed) {
      for (let i = 0; i < contour.points.length; i++) {
        const a = contour.points[i]
        const b = contour.points[(i + 1) % contour.points.length]
        if (!a || !b) {
          continue
        }
        if (pointOnSegment(pt, a, b)) {
          return true
        }
        if (a.y <= fy !== b.y <= fy) {
          const xInt = a.x + ((fy - a.y) / (b.y - a.y)) * (b.x - a.x)
          if (fx < xInt) {
            inside = !inside
          }
        }
      }
    }
    return inside
  }
  return {
    type: 'region',
    bbox,
    has: (x, y) => x >= bbox.x0 && x <= bbox.x1 && y >= bbox.y0 && y <= bbox.y1 && test(x, y),
    test,
  }
}

/** Wraps a precomputed 1-bit coverage bitmap (row-major over `bbox`) as a Region. */
const bitmapRegion = (bbox: BBox, bits: Uint8Array, width: number): Region => ({
  type: 'region',
  bbox,
  has: (x, y) => {
    if (x < bbox.x0 || x > bbox.x1 || y < bbox.y0 || y > bbox.y1) {
      return false
    }
    return bits[(y - bbox.y0) * width + (x - bbox.x0)] === 1
  },
  test: (fx, fy) => {
    const x = roundHalfUp(fx)
    const y = roundHalfUp(fy)
    if (x < bbox.x0 || x > bbox.x1 || y < bbox.y0 || y > bbox.y1) {
      return false
    }
    return bits[(y - bbox.y0) * width + (x - bbox.x0)] === 1
  },
})

/**
 * Centerline stroke of every (open and closed) contour segment, `width` pixels
 * wide, round joins/caps: Bresenham the segment, stamp a disc of radius
 * `floor((wi-1)/2)` at each traversed pixel (`wi = max(1, round(width))`).
 * Rasterizes into a bitmap sized to the path's bbox plus padding.
 */
export const pathStrokeRegion = (p: Path, width: number): Region => {
  const wi = Math.max(1, roundHalfUp(width))
  let box: BBox | null = null
  const segments: { readonly a: PathPoint; readonly b: PathPoint }[] = []
  for (const contour of p.contours) {
    for (let i = 0; i + 1 < contour.points.length; i++) {
      const a = contour.points[i]
      const b = contour.points[i + 1]
      if (a && b) {
        segments.push({ a, b })
        box = bboxUnion(box, {
          x0: Math.min(a.x, b.x),
          y0: Math.min(a.y, b.y),
          x1: Math.max(a.x, b.x),
          y1: Math.max(a.y, b.y),
        })
      }
    }
    if (contour.closed && contour.points.length > 1) {
      const a = contour.points.at(-1)
      const b = contour.points[0]
      if (a && b) {
        segments.push({ a, b })
        box = bboxUnion(box, {
          x0: Math.min(a.x, b.x),
          y0: Math.min(a.y, b.y),
          x1: Math.max(a.x, b.x),
          y1: Math.max(a.y, b.y),
        })
      }
    }
  }
  if (!box) {
    return emptyRegion
  }
  const pad = wi + 1
  const bbox = {
    x0: Math.floor(box.x0) - pad,
    y0: Math.floor(box.y0) - pad,
    x1: Math.ceil(box.x1) + pad,
    y1: Math.ceil(box.y1) + pad,
  }
  const bw = bbox.x1 - bbox.x0 + 1
  const bh = bbox.y1 - bbox.y0 + 1
  const bits = new Uint8Array(bw * bh)
  const add = (x: number, y: number): void => {
    if (x >= bbox.x0 && x <= bbox.x1 && y >= bbox.y0 && y <= bbox.y1) {
      bits[(y - bbox.y0) * bw + (x - bbox.x0)] = 1
    }
  }
  const radius = Math.floor((wi - 1) / 2)
  const stamp = (x: number, y: number): void => {
    if (wi <= 1) {
      add(x, y)
      return
    }
    for (let yy = -radius; yy <= radius; yy++) {
      for (let xx = -radius; xx <= radius; xx++) {
        if (xx * xx + yy * yy <= radius * radius) {
          add(x + xx, y + yy)
        }
      }
    }
  }
  for (const seg of segments) {
    bresenham(
      roundHalfUp(seg.a.x),
      roundHalfUp(seg.a.y),
      roundHalfUp(seg.b.x),
      roundHalfUp(seg.b.y),
      stamp,
    )
  }
  return bitmapRegion(bbox, bits, bw)
}

/**
 * Applies a first-class transform (ADR-0044) to a path: every contour point (the
 * polyline used for fill/stroke) is mapped through `matrix`, every command's
 * points (`move`/`line`/`quad`/`bezier` endpoints and an `arc`'s `center` and
 * `to`) are rewritten, and `inverse` is threaded to {@link regionTransform} for a
 * cached region. Points falling on the `w = 0` plane ({@link applyMatrix}
 * returning `null`) are left unmapped rather than dropped. A mirroring transform
 * (negative 2D determinant — e.g. `flipx`/`flipy`) reverses orientation, so an
 * `arc`'s `clockwise` sweep flag is flipped to keep its direction consistent with
 * the transformed contour polyline.
 */
export const pathTransform = (
  p: Path,
  matrix: readonly number[],
  inverse: readonly number[],
): Path => {
  const tx = (pt: PathPoint): PathPoint => applyMatrix(matrix, pt.x, pt.y) ?? pt
  const mirrored = (matrix[0] ?? 0) * (matrix[5] ?? 0) - (matrix[1] ?? 0) * (matrix[4] ?? 0) < 0
  const contours = p.contours.map((c) => ({ ...c, points: c.points.map(tx) }))
  const commands = p.commands.map((cmd): PathCommand => {
    switch (cmd.kind) {
      case 'move':
      case 'line':
        return { ...cmd, to: tx(cmd.to) }
      case 'quad':
        return { ...cmd, control: tx(cmd.control), to: tx(cmd.to) }
      case 'bezier':
        return { ...cmd, control1: tx(cmd.control1), control2: tx(cmd.control2), to: tx(cmd.to) }
      case 'arc':
        return {
          ...cmd,
          center: tx(cmd.center),
          to: tx(cmd.to),
          clockwise: mirrored ? !cmd.clockwise : cmd.clockwise,
        }
      default:
        return cmd // `close` carries no points — pass through unchanged
    }
  })
  const region = p.region ? regionTransform(p.region, matrix, inverse) : undefined
  return path(contours, commands, p.viewBox, region)
}

/**
 * Wraps a Region as a command-less Path (no `contours`/`commands`) so
 * region-only shapes (masks, silhouettes) can flow through Path-typed APIs — e.g.
 * `export … path` (ADR-0061 §6). {@link pathFillRegion} returns `region` unchanged.
 */
export const pathFromRegion = (
  region: Region,
  viewBox?: { readonly width: number; readonly height: number },
): Path => path([], [], viewBox, region)
