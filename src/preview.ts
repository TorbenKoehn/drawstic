// ASCII (`--ascii`) and ANSI half-block (`--preview`) renderings of a sprite
// (ADR-0031), the `--grid` coordinate overlay, the `--diff` raster comparison,
// and the plate-aware `--silhouette` mask (ADR-0083 amendment): the agent's
// self-verification signals. Every export here is a debug-only CLI post-pass
// on already-rendered RGBA8 — none of it is reachable from `build`.

import { color, colorToOklch, relativeLuminance } from './color.js'
import { dcosDeg, dsinDeg } from './dmath.js'
import { scaleBitmap } from './raster.js'
import type { Sprite } from './values.js'

/**
 * How much of a painted (non-transparent) sprite is covered by its own declared
 * `sprite.pal` artifact vs. colors that only came from rendering (gradients,
 * filters, AA, imports) — surfaced in `render --json` so an agent can tell a
 * clean pixel-key sprite from one with unaccounted-for color.
 */
export type PreviewStats = {
  readonly unknownPixelCount: number
  readonly unknownColorCount: number
  readonly paletteCoveredPercent: number
}

/** RGBA8 at byte offset `i`, as a dedupable string key. */
const colorKeyAt = (data: Uint8Array, i: number): string =>
  `${data[i] ?? 0},${data[i + 1] ?? 0},${data[i + 2] ?? 0},${data[i + 3] ?? 0}`

export const spritePreviewStats = (sprite: Sprite): PreviewStats => {
  const byColor = new Set(
    sprite.pal.map((p) => `${p.color.r},${p.color.g},${p.color.b},${p.color.a}`),
  )
  const unknown = new Set<string>()
  let painted = 0
  let covered = 0
  for (let i = 0; i < sprite.data.length; i += 4) {
    const a = sprite.data[i + 3] ?? 0
    if (a === 0) {
      continue
    }
    painted++
    const key = colorKeyAt(sprite.data, i)
    if (byColor.has(key)) {
      covered++
    } else {
      unknown.add(key)
    }
  }
  return {
    unknownPixelCount: painted - covered,
    unknownColorCount: unknown.size,
    paletteCoveredPercent: painted === 0 ? 100 : Math.round((covered / painted) * 10000) / 100,
  }
}

/**
 * Crops to `crop`, clamped to the sprite's bounds; the returned `crop` is the
 * clamped rectangle actually applied (may be smaller than requested, never
 * negative or out-of-bounds). Backs `render --crop`.
 */
export const cropSprite = (
  sprite: Sprite,
  crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): {
  readonly sprite: Sprite
  readonly crop: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
} => {
  const x0 = Math.max(0, Math.min(sprite.w, crop.x))
  const y0 = Math.max(0, Math.min(sprite.h, crop.y))
  const x1 = Math.max(x0, Math.min(sprite.w, crop.x + crop.width))
  const y1 = Math.max(y0, Math.min(sprite.h, crop.y + crop.height))
  const width = x1 - x0
  const height = y1 - y0
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const src = ((y0 + y) * sprite.w + x0) * 4
    data.set(sprite.data.subarray(src, src + width * 4), y * width * 4)
  }
  return {
    sprite: { ...sprite, w: width, h: height, data },
    crop: { x: x0, y: y0, width, height },
  }
}

/**
 * Downscales with deterministic nearest-neighbour sampling (ADR-0031) to fit
 * within `fit`, preserving aspect ratio; a no-op (`fitted: false`) if the
 * sprite already fits. Backs `render --ascii`/`--preview --fit WxH` — never
 * applied to PNG output, only to text/terminal previews.
 */
export const fitSprite = (
  sprite: Sprite,
  fit: { readonly width: number; readonly height: number },
): { readonly sprite: Sprite; readonly fitted: boolean } => {
  if (sprite.w <= fit.width && sprite.h <= fit.height) {
    return { sprite, fitted: false }
  }
  const scale = Math.min(fit.width / sprite.w, fit.height / sprite.h)
  const width = Math.max(1, Math.floor(sprite.w * scale))
  const height = Math.max(1, Math.floor(sprite.h * scale))
  return {
    sprite: {
      ...sprite,
      w: width,
      h: height,
      data: scaleBitmap(sprite.data, sprite.w, sprite.h, width, height),
    },
    fitted: true,
  }
}

// ── plate detection (shared by C009 sibling-silhouette and `--silhouette`) ───

/** OkLab Cartesian coordinates, derived from {@link colorToOklch}'s polar `(l, c, h)`. */
type Lab = { readonly l: number; readonly a: number; readonly b: number }

/**
 * sRGB8 → OkLab, via {@link colorToOklch} and the project's own deterministic trig
 * ({@link dcosDeg}/{@link dsinDeg}, ADR-0026/ADR-0027) — never raw `Math.cos`/`Math.sin` — so the
 * plate/glyph distance test below reproduces bit-for-bit across platforms.
 */
const toLab = (r: number, g: number, b: number, a: number): Lab => {
  const ok = colorToOklch(color(r, g, b, a))
  return { l: ok.l, a: ok.c * dcosDeg(ok.h), b: ok.c * dsinDeg(ok.h) }
}

/** Euclidean OkLab distance — the same "perceptually nearest" metric `nearestColor` (color.ts) uses. */
const labDistance = (x: Lab, y: Lab): number => {
  const dl = x.l - y.l
  const da = x.a - y.a
  const db = x.b - y.b
  return Math.sqrt(dl * dl + da * da + db * db)
}

/**
 * OkLab step tolerance for the plate flood fill below. Calibrated against **two** populations —
 * the bundled icon corpus (`examples/icons/*.drw`) *and* the product skill's own runnable starter
 * (`skills/drawstic/starters/icon-family.drw`), the recipe an agent actually copies for icon work:
 *
 * - The starter's `plate(t)` is `icon-craft.md`'s "edge band" contract — a flat `fill t face`
 *   with a separate 2px-wide alpha-blended lit/shaded contour composited only at the face's own
 *   edge (`face.edge(1:1,2)` / `face.edge(-1:-1,2)`), *not* a continuous gradient. The single
 *   adjacent-pixel step from that 2px contour into the plain fill measures 0.085–0.125 across its
 *   five 32×32 glyphs (`folder` 0.085, `chat` 0.105, `mail`/`search` 0.115, `bolt` 0.125 — the
 *   corpus's own vertical/45°-gradient plates never have this discontinuity, since a continuous
 *   gradient's own per-row step stays ≤0.03, so the border-seeded chain never needs to bridge it).
 * - Swept 0.06→0.20 against the full `examples/icons/*.drw` corpus (every family, every size):
 *   results are stable through 0.14, then crack at 0.15 (`system.drw#settings64`'s modelled gear
 *   and `games.drw#dice16`'s pips start bleeding into the plate — a real glyph-swallowing
 *   regression, not noise).
 *
 * 0.13 sits just above the starter's worst-case bridge requirement (0.125), inside the verified
 * `[0.125, 0.15)` safe window, with a full step of margin below the corpus's first crack — checked
 * against every `examples/icons/*.drw` family (no new C009 finding introduced, `docs/impl-
 * progress.md`) and the starter (all five 32×32 glyphs correctly differentiate; see
 * `tests/unit/critique.test.ts`).
 */
const PLATE_STEP_TOLERANCE = 0.13

/**
 * Width of the canvas-edge band a plate's own margin must fall inside (a fraction of
 * `max(w,h)`, floored at {@link PLATE_EDGE_BAND_MIN}px). `icon-craft.md`'s documented margins
 * (1–2px @16/32px, 4px @64px) are exactly 6.25 % of the edge at every size; this band is ~1.6×
 * that, with slack for anti-aliasing.
 */
const PLATE_EDGE_BAND_FRACTION = 0.1
const PLATE_EDGE_BAND_MIN = 2

/**
 * Minimum share of the covered mask a flood-filled edge region must reach before it counts as a
 * plate. Measured on the bundled corpus: every genuine plate (icon families that stamp a shared
 * tile) reaches ≥51 %; every non-plate icon/character/item silhouette (an outline stroke, a
 * `model`-shaded prop with no background tile) tops out at ≤40 % of what a same-tolerance flood
 * fill reaches from the canvas edge. 0.5 sits in the gap between them.
 */
const PLATE_AREA_DOMINANCE_MIN = 0.5

/** Below this many kept (non-plate) px, treat the subtraction as degenerate — a flat plate-only sprite with no distinguishable glyph — and fall back to the untouched covered mask. */
const PLATE_MIN_FIGURE_FLOOR = 4

/**
 * Minimum share of the *covered* mass the subtracted figure must itself keep, on top of the
 * absolute {@link PLATE_MIN_FIGURE_FLOOR}. Reusing `detectPlateFigure` for `render --silhouette`
 * surfaced a second defect {@link PLATE_ROW_SPAN_MIN} alone doesn't close: a lone character/item/
 * scene-prop **part** rendered standalone (`bodyFront`, `cloakFront`, `legsFront` — exactly the
 * debug case `character-craft.md` names for `--silhouette` — down to a small scene decoration like
 * `market.drw#barrel`) is *itself* a large, solid, edge-to-edge mass with only a tiny high-contrast
 * trim/seam/hoop-band escaping the flood — geometrically a plate-plus-tiny-glyph by every other
 * shape metric measured (edge touch, dominance, row span all pass), at a scale no real glyph
 * reaches. Measured with `all: true` over the **entire** bundled corpus — every drawing, parts and
 * scene props included, not just the exported top-level views (229 drawings swept): the worst
 * false positive this closes keeps 13.7 % (`scenes-v3/market.drw#barrel`; every character-part false
 * positive keeps ≤3.7 %, well clear too). The thinnest real icon glyph below this line is
 * `finance.drw#bank` at 13.5 % — 0.15 sits just above both, trading it (and a handful of similarly
 * thin glyphs — `chat16`, `phone`, `contacts`, `feed`, `bank64` — which fall back to the full mask,
 * unchanged from pre-fix `--silhouette`) for closing every measured non-icon false positive; every
 * icon family's `mail`/`clock`-class glyphs (and every icon ≥15 % figure share) are unaffected.
 */
const PLATE_MIN_FIGURE_FRACTION = 0.15

/**
 * Minimum fraction of the flood-filled plate's own rows that must span its **full own width** —
 * reaching within {@link PLATE_ROW_SPAN_TOLERANCE_FRACTION} of both its bbox's left and right
 * edges — before the flood counts as a plate. Added when reusing `detectPlateFigure` for
 * `render --silhouette` (ADR-0083 amendment) surfaced a defect the C009 caller never measured: the
 * edge-touch + area-dominance gates alone (both already required above) do **not** rule out a large
 * organic figure whose hair/feet/cape happen to reach all four edge margins independently — the
 * chained OkLab tolerance then bridges through the figure's own gradual cel-shading and floods most
 * of it, exactly like a real tile. This was silently wrong for the *entire* `characters-ro2` corpus
 * and one `items-v2` sword the whole time (invisible to every existing test, since C009 is
 * advisory-only and every affected view lacks a same-canvas-size sibling or a test asserting its
 * exact signature) — only became load-bearing once `--silhouette` draws the result as pixels.
 *
 * A genuine tile/plate (a `rrect`/full-bleed fill) covers **almost every row edge-to-edge** at every
 * height except a few rounded-corner rows; an organic silhouette's same-tolerance flood is a sparse,
 * thread-like network that reaches an edge only at isolated spots. Measured on the full bundled
 * corpus (`examples/*`, `skills/drawstic/starters/icon-family.drw`): every real plate scores
 * ≥86.7 % (`icon-family.drw#mailSmall`, the thinnest — every other real plate is ≥93 %); every
 * false positive this fixes tops out at 65.3 % (`characters-ro2/wizard.drw#wizardFront`; every other
 * `characters-ro2` view and `items-v2/swords.drw#scimitar` score lower). 0.8 sits in the gap with a
 * full step of margin on both sides. (`icons/weather.drw#weatherDetail`, an already-marginal,
 * untested plate call with no same-size sibling either way, drops to the full-mask fallback under
 * this gate — a known, harmless narrowing, not a regression against any asserted behaviour.)
 */
const PLATE_ROW_SPAN_MIN = 0.8

/** Slack (a fraction of the plate bbox's own width) allowed when checking whether a row reaches the plate bbox's left/right edges — absorbs a tile's rounded-corner inset near its top/bottom rows. */
const PLATE_ROW_SPAN_TOLERANCE_FRACTION = 0.15

/**
 * `true` iff {@link PLATE_ROW_SPAN_MIN} of `mask`'s own rows (within `bbox`) each reach within
 * `tolFraction` of `bbox`'s own left **and** right edges — the "is this shape solid edge-to-edge,
 * not a sparse network" test {@link detectPlateFigure} gates on. A row with no `mask` pixel at all
 * (can happen above/below a tile's rounded corner) is simply skipped, neither counted nor penalized.
 */
const rowSpanFraction = (
  mask: Uint8Array,
  w: number,
  bbox: NonNullable<MaskBBox>,
  tolFraction: number,
): boolean => {
  const x0 = bbox.x
  const x1 = bbox.x + bbox.width - 1
  const tol = Math.max(1, Math.round(bbox.width * tolFraction))
  let rowsWithMask = 0
  let spanningRows = 0
  for (let y = bbox.y; y < bbox.y + bbox.height; y++) {
    let rowMin = w
    let rowMax = -1
    for (let x = x0; x <= x1; x++) {
      if (mask[y * w + x] === 1) {
        rowMin = Math.min(rowMin, x)
        rowMax = Math.max(rowMax, x)
      }
    }
    if (rowMax < 0) {
      continue
    }
    rowsWithMask++
    if (rowMin <= x0 + tol && rowMax >= x1 - tol) {
      spanningRows++
    }
  }
  return rowsWithMask > 0 && spanningRows / rowsWithMask >= PLATE_ROW_SPAN_MIN
}

/** Tight inclusive bbox of an arbitrary 0/1 mask, or `null` when empty ({@link detectPlateFigure}/silhouette support). */
type MaskBBox = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
} | null

/** Tight inclusive bbox of an arbitrary 0/1 mask (not necessarily the sprite's own covered mask); `null` when empty. */
const maskBBox = (mask: Uint8Array, w: number, h: number): MaskBBox => {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] === 1) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}

/** {@link detectPlateFigure}'s result: the subtracted figure mask plus its own tight bbox. */
export type PlateFigure = {
  readonly mask: Uint8Array
  readonly bbox: MaskBBox
}

/**
 * Detects a "plate" (an opaque background tile filling the canvas to its margin, per
 * `icon-craft.md`'s mandatory tile/plate build order) from pixel evidence alone — never assumed
 * from a `--as` profile — and returns the covered-mask subset that is genuinely the *figure* (the
 * glyph stamped onto the plate). Two callers sign/silhouette the returned figure instead of the
 * raw covered mask: `critique.ts`'s C009 sibling-silhouette check (the original
 * C009-Plate-Blindheit fix — an icon's covered mask *is* the plate, so every glyph on it used to
 * collapse to one signature) and `render --silhouette` (ADR-0083 amendment — the same plate
 * dominates the alpha mask, so silhouetting it produced a featureless black rounded square).
 *
 * Seeds a tolerant flood fill from every covered pixel within the {@link PLATE_EDGE_BAND_FRACTION}
 * canvas-edge band — the plate's own thin margin — growing through covered neighbours whose OkLab
 * distance from the just-accepted pixel is within {@link PLATE_STEP_TOLERANCE}. This is a *chained*
 * per-step tolerance (graph reachability over a fixed, symmetric edge predicate — deterministic
 * and order-independent), not a single fixed reference colour: it follows a shaded/gradient
 * plate's own smooth colour drift all the way across the tile while stopping cold at a genuinely
 * different-coloured glyph, so an anti-aliased plate edge or a shaded plate still counts as plate
 * without ever bleeding into the silhouette it carries.
 *
 * A flood region counts as a plate only when **both** hold: (a) the seed band touches *all four*
 * canvas edges — a rectangular tile reaches every margin, where a framed character/item/icon
 * glyph (`icon-craft.md` §4 optical centering) reaches at most two — and (b) the grown region
 * covers ≥{@link PLATE_AREA_DOMINANCE_MIN} of the covered mass, so a thin border-only stroke (an
 * outlined character/item silhouette, which floods just its own outline) never qualifies. Both
 * conditions are load-bearing: several non-plate icons touch 2–3 edges without ever reaching
 * dominance, and a solid single-hue prop can flood to 100 % without ever touching all four edges.
 *
 * Returns `null` when no plate is detected (the common case), when subtracting the detected plate
 * would leave fewer than {@link PLATE_MIN_FIGURE_FLOOR}px or less than {@link
 * PLATE_MIN_FIGURE_FRACTION} of the covered mass (a flat plate-only sprite, or a large solid part
 * with only a tiny escaped fragment — neither a distinguishable glyph), or when the plate's own
 * rows don't {@link PLATE_ROW_SPAN_MIN} span its full width (an organic figure, not a filled tile)
 * — the caller falls back to the full covered mask, exactly as before this fix. Also declines
 * outright for a fully-opaque sprite (a full-bleed `scene`, painted edge to edge with no
 * transparent margin at all): `icon-craft.md`'s plate/tile contract always leaves a transparent
 * canvas margin around it, so a sprite with zero transparent pixels cannot structurally be that
 * kind of plate, no matter how the flood chains.
 */
export const detectPlateFigure = (sprite: Sprite, covered: Uint8Array): PlateFigure | null => {
  const w = sprite.w
  const h = sprite.h
  let coveredCount = 0
  for (let p = 0; p < covered.length; p++) {
    coveredCount += covered[p] ?? 0
  }
  if (coveredCount === 0 || coveredCount === covered.length) {
    return null
  }
  const lab: (Lab | undefined)[] = new Array(covered.length)
  for (let p = 0; p < covered.length; p++) {
    if (covered[p] === 1) {
      const i = p * 4
      lab[p] = toLab(
        sprite.data[i] ?? 0,
        sprite.data[i + 1] ?? 0,
        sprite.data[i + 2] ?? 0,
        sprite.data[i + 3] ?? 0,
      )
    }
  }
  const size = Math.max(w, h)
  const edgeBand = Math.max(PLATE_EDGE_BAND_MIN, Math.round(size * PLATE_EDGE_BAND_FRACTION))
  const plate = new Uint8Array(covered.length)
  const stack: number[] = []
  const seedIfCovered = (x: number, y: number): boolean => {
    const p = y * w + x
    if (covered[p] === 0) {
      return false
    }
    if (plate[p] === 0) {
      plate[p] = 1
      stack.push(p)
    }
    return true
  }
  let top = false
  let bottom = false
  let left = false
  let right = false
  for (let y = 0; y < Math.min(edgeBand, h); y++) {
    for (let x = 0; x < w; x++) {
      top = seedIfCovered(x, y) || top
    }
  }
  for (let y = Math.max(0, h - edgeBand); y < h; y++) {
    for (let x = 0; x < w; x++) {
      bottom = seedIfCovered(x, y) || bottom
    }
  }
  for (let x = 0; x < Math.min(edgeBand, w); x++) {
    for (let y = 0; y < h; y++) {
      left = seedIfCovered(x, y) || left
    }
  }
  for (let x = Math.max(0, w - edgeBand); x < w; x++) {
    for (let y = 0; y < h; y++) {
      right = seedIfCovered(x, y) || right
    }
  }
  if (!(top && bottom && left && right)) {
    return null
  }
  while (stack.length > 0) {
    const p = stack.pop() as number
    const x = p % w
    const y = (p - x) / w
    const pLab = lab[p] as Lab
    const tryNeighbor = (nx: number, ny: number): void => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
        return
      }
      const q = ny * w + nx
      if (covered[q] === 0 || plate[q] === 1) {
        return
      }
      if (labDistance(pLab, lab[q] as Lab) <= PLATE_STEP_TOLERANCE) {
        plate[q] = 1
        stack.push(q)
      }
    }
    tryNeighbor(x - 1, y)
    tryNeighbor(x + 1, y)
    tryNeighbor(x, y - 1)
    tryNeighbor(x, y + 1)
  }
  let plateCount = 0
  for (let p = 0; p < plate.length; p++) {
    plateCount += plate[p] ?? 0
  }
  if (plateCount / coveredCount < PLATE_AREA_DOMINANCE_MIN) {
    return null
  }
  const plateBBox = maskBBox(plate, w, h)
  if (!plateBBox || !rowSpanFraction(plate, w, plateBBox, PLATE_ROW_SPAN_TOLERANCE_FRACTION)) {
    return null
  }
  const figure = new Uint8Array(covered.length)
  let figureCount = 0
  for (let p = 0; p < covered.length; p++) {
    if (covered[p] === 1 && plate[p] === 0) {
      figure[p] = 1
      figureCount++
    }
  }
  if (
    figureCount < PLATE_MIN_FIGURE_FLOOR ||
    figureCount / coveredCount < PLATE_MIN_FIGURE_FRACTION
  ) {
    return null
  }
  const bbox = maskBBox(figure, w, h)
  return bbox ? { mask: figure, bbox } : null
}

/** {@link silhouetteSprite}'s result: the transformed sprite plus whether a plate was detected and subtracted. */
export type SilhouetteResult = {
  readonly sprite: Sprite
  readonly plateDetected: boolean
}

/**
 * Solid black-silhouette test (`render --silhouette`): every masked pixel becomes opaque black
 * (`#000000ff`); everything else stays transparent. A deterministic per-pixel transform on
 * already-rendered RGBA8 — the shape-only readout an agent uses to sanity-check a modular
 * character/sprite's occupancy, proportion, and part alignment without colour distracting the
 * eye. Chosen over an "RGB→0, keep alpha" variant so semi-transparent edge pixels read as solid
 * mass, not a faint fringe: a silhouette test asks "what area does this cover", for which a hard
 * 1-bit coverage mask is the honest answer (see ADR-0083). Applied to the rendered framebuffer
 * before any output kind, so it composes with `--ascii`/`--preview`/`--inspect`/PNG and with
 * `--crop`/`--fit`/`--grid`.
 *
 * **Plate-aware (ADR-0083 amendment, reuses {@link detectPlateFigure}):** an icon built the
 * canonical way (`icon-craft.md`) stamps its glyph onto an opaque plate/tile, so the covered mask
 * *is* the plate — silhouetting it produced a featureless black rounded square, zero shape
 * information. When a plate is detected, the mask is the subtracted *figure* instead of the full
 * covered mask; `plateDetected` tells the caller this happened, so it can say so rather than
 * silently showing a different image than the naive full-mask one would. A non-plate sprite (a
 * character/item silhouette on transparent canvas) is unaffected — `detectPlateFigure` returns
 * `null` and the full covered mask silhouettes exactly as before this fix.
 */
export const silhouetteSprite = (sprite: Sprite): SilhouetteResult => {
  const covered = new Uint8Array(sprite.w * sprite.h)
  for (let p = 0; p < covered.length; p++) {
    if ((sprite.data[p * 4 + 3] ?? 0) > 0) {
      covered[p] = 1
    }
  }
  const plateFigure = detectPlateFigure(sprite, covered)
  const mask = plateFigure ? plateFigure.mask : covered
  const data = new Uint8Array(sprite.data.length)
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] === 1) {
      data[p * 4 + 3] = 255
    }
  }
  return { sprite: { ...sprite, data }, plateDetected: plateFigure !== null }
}

// sparse→dense glyph ramp; darker pixels map to earlier (sparser) glyphs, as
// on a dark terminal background — bright pixels map to later (denser) glyphs.
const ASCII_RAMP = ' .:-=+*#%@'

/**
 * True relative luminance of pixel `i` (0 = black or fully transparent, 1 =
 * white), alpha-composited over an implied black backdrop — the metric
 * `spriteToAscii` maps onto `ASCII_RAMP`. Composited over black (not white)
 * because the preview is read on a dark terminal: a transparent/unpainted
 * pixel must read as background-dark (sparse glyph), not paper-white.
 */
const luminanceAt = (sprite: Sprite, i: number): number =>
  relativeLuminance(
    sprite.data[i] ?? 0,
    sprite.data[i + 1] ?? 0,
    sprite.data[i + 2] ?? 0,
    sprite.data[i + 3] ?? 0,
  )

/** Grayscale ASCII preview derived from rendered RGBA pixels. */
export const spriteToAscii = (sprite: Sprite): string => {
  const lines: string[] = []
  for (let y = 0; y < sprite.h; y++) {
    let line = ''
    for (let x = 0; x < sprite.w; x++) {
      const i = (y * sprite.w + x) * 4
      const luminance = luminanceAt(sprite, i)
      const index = Math.max(
        0,
        Math.min(ASCII_RAMP.length - 1, Math.round(luminance * (ASCII_RAMP.length - 1))),
      )
      line += ASCII_RAMP[index] ?? ' '
    }
    lines.push(line)
  }
  return `${lines.join('\n')}\n`
}

/** A 24-bit ANSI color preview using half blocks (two pixel rows per line). */
export const spriteToAnsi = (sprite: Sprite): string => {
  const lines: string[] = []
  for (let y = 0; y < sprite.h; y += 2) {
    let line = ''
    for (let x = 0; x < sprite.w; x++) {
      const ti = (y * sprite.w + x) * 4
      const bi = ((y + 1) * sprite.w + x) * 4
      const ta = sprite.data[ti + 3] ?? 0
      const ba = y + 1 < sprite.h ? (sprite.data[bi + 3] ?? 0) : 0
      if (ta === 0 && ba === 0) {
        line += '\x1b[0m '
        continue
      }
      if (ta > 0 && ba > 0) {
        line += `\x1b[38;2;${sprite.data[ti]};${sprite.data[ti + 1]};${sprite.data[ti + 2]}m\x1b[48;2;${sprite.data[bi]};${sprite.data[bi + 1]};${sprite.data[bi + 2]}m\u2580`
      } else if (ta > 0) {
        line += `\x1b[0m\x1b[38;2;${sprite.data[ti]};${sprite.data[ti + 1]};${sprite.data[ti + 2]}m\u2580`
      } else {
        line += `\x1b[0m\x1b[38;2;${sprite.data[bi]};${sprite.data[bi + 1]};${sprite.data[bi + 2]}m\u2584`
      }
    }
    lines.push(`${line}\x1b[0m`)
  }
  return `${lines.join('\n')}\n`
}

// ── `render --grid N` coordinate overlay (§16, P3 drawing aids) ────────────

/** A tiny fixed 3×5 digit font for grid coordinate labels — debug-only, never real text. */
const DIGIT_W = 3
const DIGIT_H = 5
const DIGIT_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
}

/** Marks one digit's "on" cells into `mark` at `(px, py)`, each glyph cell drawn `cell` px wide/tall. */
const markDigit = (
  mark: Uint8Array,
  width: number,
  height: number,
  digit: string,
  px: number,
  py: number,
  cell: number,
): void => {
  const glyph = DIGIT_GLYPHS[digit]
  if (!glyph) {
    return
  }
  for (let gy = 0; gy < DIGIT_H; gy++) {
    const row = glyph[gy] ?? ''
    for (let gx = 0; gx < DIGIT_W; gx++) {
      if (row[gx] !== '1') {
        continue
      }
      for (let sy = 0; sy < cell; sy++) {
        const y = py + gy * cell + sy
        if (y < 0 || y >= height) {
          continue
        }
        for (let sx = 0; sx < cell; sx++) {
          const x = px + gx * cell + sx
          if (x < 0 || x >= width) {
            continue
          }
          mark[y * width + x] = 1
        }
      }
    }
  }
}

/** Marks a non-negative integer as a row of digit glyphs starting at `(px, py)`. */
const markNumber = (
  mark: Uint8Array,
  width: number,
  height: number,
  value: number,
  px: number,
  py: number,
  cell: number,
): void => {
  let x = px
  for (const ch of String(value)) {
    markDigit(mark, width, height, ch, x, py, cell)
    x += (DIGIT_W + 1) * cell
  }
}

/**
 * `render --grid N` (§16): burns a coordinate overlay into the OUTPUT raster
 * only — never `build` exports, never the diff comparison in {@link
 * diffRasters} (grid is purely cosmetic there). Runs as the very last
 * post-pass, after `--crop` and the `--png@K` scale, so `data`/`width`/
 * `height` are already the final output pixels; `spacing` (N) is in *source*
 * (recipe) pixels and `scale` is the `--png@K` factor already baked into
 * `data` — the actual line pitch is `spacing * scale` output pixels, which
 * keeps gridlines exactly 1 output-pixel thin and landing on recipe-pixel
 * boundaries at any scale. Edge labels (source-pixel coordinates, top edge
 * for columns, left edge for rows) scale their glyph size with `scale` so
 * they stay legible at typical debug scales (`--png@4`+). High-contrast
 * strategy: every overlay pixel is a full color invert of the pixel
 * underneath (forced opaque), which is visible against any scene — a fixed
 * overlay color could vanish into a same-toned background.
 */
export const applyGridOverlay = (
  data: Uint8Array,
  width: number,
  height: number,
  spacing: number,
  scale: number,
): Uint8Array => {
  if (spacing <= 0 || width <= 0 || height <= 0) {
    return data
  }
  const pitch = Math.max(1, Math.round(spacing * scale))
  const glyphCell = Math.max(1, Math.round(scale))
  const mark = new Uint8Array(width * height)
  for (let x = 0; x < width; x += pitch) {
    for (let y = 0; y < height; y++) {
      mark[y * width + x] = 1
    }
  }
  for (let y = 0; y < height; y += pitch) {
    for (let x = 0; x < width; x++) {
      mark[y * width + x] = 1
    }
  }
  for (let x = 0, k = 0; x < width; x += pitch, k++) {
    markNumber(mark, width, height, k * spacing, x + glyphCell, glyphCell, glyphCell)
  }
  for (let y = 0, k = 0; y < height; y += pitch, k++) {
    markNumber(mark, width, height, k * spacing, glyphCell, y + glyphCell, glyphCell)
  }
  const out = new Uint8Array(data)
  for (let i = 0; i < mark.length; i++) {
    if (mark[i] !== 1) {
      continue
    }
    const o = i * 4
    out[o] = 255 - (data[o] ?? 0)
    out[o + 1] = 255 - (data[o + 1] ?? 0)
    out[o + 2] = 255 - (data[o + 2] ?? 0)
    out[o + 3] = 255
  }
  return out
}

// ── `render --diff <png>` raster comparison (§16, P3 drawing aids) ─────────

/** Result of {@link diffRasters}: what changed between two same-sized RGBA8 rasters. */
export type RasterDiff = {
  readonly identical: boolean
  readonly changedPixelCount: number
  readonly totalPixelCount: number
  readonly changedBBox: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  } | null
}

/**
 * `render --diff <png>` (§16): per-pixel RGBA comparison of two equally-sized
 * rasters — the machine answer to "did my edit touch only the region I
 * meant to?" Compares the fresh render BEFORE `--grid` is burned in (the CLI
 * passes the pristine post-scale, pre-grid buffer); callers must pre-check
 * dimensions match (mismatched sizes are a CLI-level diagnostic, not handled
 * here). `changedBBox` is `null` iff `identical` — there is nothing to bound.
 */
export const diffRasters = (
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
): RasterDiff => {
  let changed = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (
        a[i] !== b[i] ||
        a[i + 1] !== b[i + 1] ||
        a[i + 2] !== b[i + 2] ||
        a[i + 3] !== b[i + 3]
      ) {
        changed++
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return {
    identical: changed === 0,
    changedPixelCount: changed,
    totalPixelCount: width * height,
    changedBBox:
      changed === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}
