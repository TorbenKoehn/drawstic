// render-derived facts for `render --inspect --json` (§16, P3 drawing aids;
// ADR-0031 refinement): lets an agent introspect a rendered sprite's
// coverage, color makeup, and mask geometry without a multimodal round-trip
// on the image itself.

import { type Color, toHexColor } from './color.js'
import type { Region, Sprite } from './values.js'

/**
 * A render-inspection report: `distinctColorCount` counts distinct RGBA8 values including any RGB
 * carried by fully-transparent pixels. `alphaCoverageBBox` is the tight,
 * inclusive bounding box of non-zero-alpha pixels, `null` if the sprite is
 * fully transparent. `palette` is `sprite.pal` — the drawing's declared
 * palette artifact, not every rendered color; each entry's
 * `opaquePixelShare` is a nearest-color attribution heuristic (see
 * {@link attributePaletteShares}), not an exact-match count. `namedMasks`
 * covers module-scope `mask NAME = expr` bindings only (see
 * {@link inspectNamedMask}) — drawing-local masks aren't visible here.
 */
export type RenderInspection = {
  readonly width: number
  readonly height: number
  readonly distinctColorCount: number
  readonly alphaCoverageBBox: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  } | null
  readonly opaquePixelCount: number
  readonly transparentPixelCount: number
  readonly palette: readonly {
    readonly key: string
    readonly hex: string
    readonly source: string
    readonly opaquePixelShare: number
  }[]
  readonly namedMasks: readonly NamedMaskInspection[]
  readonly occupancy: readonly string[]
}

/**
 * A named mask's bbox and internal density. `bbox` is scanned
 * against the sprite's own canvas (`0..width-1, 0..height-1`), `null` if the
 * region covers no canvas pixel — this is deliberately NOT the region's own
 * analytic `Region.bbox`, which can extend past the canvas or be unbounded.
 * `coverageFraction` is `coveragePixelCount / (bbox.width * bbox.height)` —
 * density *within the mask's own footprint* (a thin ring reads as sparse
 * even though its bbox is a full square), not a fraction of the whole
 * canvas; see reference.md.
 */
export type NamedMaskInspection = {
  readonly name: string
  readonly bbox: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  } | null
  readonly coveragePixelCount: number
  readonly coverageFraction: number
}

/** Rounds a 0..1 fraction to 4 decimal places (matches the existing 2-decimal-of-percent style). */
const round4 = (v: number): number => Math.round(v * 10000) / 10000

/**
 * Scans `region` against the sprite canvas `width x height` and reports its
 * bbox + internal density, per {@link NamedMaskInspection}. `offsetX`/
 * `offsetY` shift every tested coordinate before calling `region.has` (but
 * NOT the reported bbox, which stays canvas-local) — needed because a
 * mask's Region closes over absolute recipe-pixel coordinates while
 * `render --crop` re-indexes the inspected sprite to a local, cropped
 * origin; the caller passes the crop's `(x, y)` so mask geometry lines up
 * with the cropped canvas actually being inspected.
 */
export const inspectNamedMask = (
  name: string,
  region: Region,
  width: number,
  height: number,
  offsetX = 0,
  offsetY = 0,
): NamedMaskInspection => {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!region.has(x + offsetX, y + offsetY)) {
        continue
      }
      count++
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (count === 0) {
    return { name, bbox: null, coveragePixelCount: 0, coverageFraction: 0 }
  }
  const bboxWidth = x1 - x0 + 1
  const bboxHeight = y1 - y0 + 1
  return {
    name,
    bbox: { x: x0, y: y0, width: bboxWidth, height: bboxHeight },
    coveragePixelCount: count,
    coverageFraction: round4(count / (bboxWidth * bboxHeight)),
  }
}

/**
 * Nearest-palette-key color attribution: for each *opaque*
 * (alpha === 255) output pixel, claims it for the `pal` entry whose
 * committed sRGB (r, g, b) is closest by squared Euclidean distance — alpha
 * is ignored on both sides (an opaque output pixel can come from a
 * declared color with a non-opaque alpha, e.g. two overlapping
 * semi-transparent paints), and a tie keeps the first matching entry in
 * `pal`'s declaration order. This is an attribution heuristic, not an exact
 * match: gradients, filters (`shadeRegion`, `mix`, AA text) and compositing
 * rarely land back on the exact declared color, so a pixel is "claimed" by
 * its nearest declared color rather than requiring a byte-exact hit.
 * Returns one share per `pal` entry, in the same order, summing to 1 (within
 * rounding) over all opaque pixels — `0` for every entry when the sprite has
 * no opaque pixels or no declared palette.
 */
export const attributePaletteShares = (
  sprite: Sprite,
  pal: readonly { readonly color: Color }[],
): readonly number[] => {
  const counts = new Array<number>(pal.length).fill(0)
  if (pal.length === 0) {
    return counts
  }
  let opaqueTotal = 0
  for (let i = 0; i < sprite.data.length; i += 4) {
    if ((sprite.data[i + 3] ?? 0) !== 255) {
      continue
    }
    opaqueTotal++
    const r = sprite.data[i] ?? 0
    const g = sprite.data[i + 1] ?? 0
    const b = sprite.data[i + 2] ?? 0
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let k = 0; k < pal.length; k++) {
      const c = pal[k]?.color
      if (!c) {
        continue
      }
      const dr = c.r - r
      const dg = c.g - g
      const db = c.b - b
      const dist = dr * dr + dg * dg + db * db
      if (dist < bestDist) {
        bestDist = dist
        best = k
      }
    }
    counts[best] = (counts[best] ?? 0) + 1
  }
  if (opaqueTotal === 0) {
    return counts.map(() => 0)
  }
  return counts.map((c) => round4(c / opaqueTotal))
}

export const inspectSprite = (
  sprite: Sprite,
  namedMasks: readonly { readonly name: string; readonly region: Region }[] = [],
  /** Canvas-local (0,0)'s absolute recipe-pixel coordinate — non-zero after `render --crop`; see {@link inspectNamedMask}. */
  offsetX = 0,
  offsetY = 0,
): RenderInspection => {
  const colors = new Set<string>()
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  let opaquePixelCount = 0
  let transparentPixelCount = 0
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) {
      const i = (y * sprite.w + x) * 4
      const a = sprite.data[i + 3] ?? 0
      colors.add(
        `${sprite.data[i] ?? 0},${sprite.data[i + 1] ?? 0},${sprite.data[i + 2] ?? 0},${a}`,
      )
      if (a === 0) {
        transparentPixelCount++
        continue
      }
      if (a === 255) {
        opaquePixelCount++
      }
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  const shares = attributePaletteShares(sprite, sprite.pal)
  return {
    width: sprite.w,
    height: sprite.h,
    distinctColorCount: colors.size,
    alphaCoverageBBox:
      x0 === Number.POSITIVE_INFINITY
        ? null
        : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 },
    opaquePixelCount,
    transparentPixelCount,
    palette: sprite.pal.map((p, i) => ({
      key: p.key,
      hex: toHexColor(p.color),
      source: p.source,
      opaquePixelShare: shares[i] ?? 0,
    })),
    namedMasks: namedMasks.map((m) =>
      inspectNamedMask(m.name, m.region, sprite.w, sprite.h, offsetX, offsetY),
    ),
    occupancy: occupancyGrid(sprite),
  }
}

/**
 * Coarse coverage map, downsampled to at most 8x8 cells regardless of
 * sprite size: `.` empty, `:` partially covered (<50% alpha-painted), `#`
 * mostly covered (>=50%). A cheap shape glance without viewing the image.
 */
const occupancyGrid = (sprite: Sprite): string[] => {
  const cols = Math.min(8, Math.max(1, sprite.w))
  const rows = Math.min(8, Math.max(1, sprite.h))
  const out: string[] = []
  for (let gy = 0; gy < rows; gy++) {
    let line = ''
    const y0 = Math.floor((gy * sprite.h) / rows)
    const y1 = Math.floor(((gy + 1) * sprite.h) / rows)
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * sprite.w) / cols)
      const x1 = Math.floor(((gx + 1) * sprite.w) / cols)
      let covered = 0
      let total = 0
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          total++
          if ((sprite.data[(y * sprite.w + x) * 4 + 3] ?? 0) > 0) {
            covered++
          }
        }
      }
      const ratio = total === 0 ? 0 : covered / total
      line += ratio === 0 ? '.' : ratio < 0.5 ? ':' : '#'
    }
    out.push(line)
  }
  return out
}
