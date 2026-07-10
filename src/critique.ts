// `critique` metric engine + `C0xx` check catalog (ADR-0085): pixel-based,
// vision-free quality assertions over a rendered sprite. Every finding pairs a
// standard `Diagnostic` (anchored at the `draw` span) with a `{measured,
// threshold, fix}` payload — auditable and teachable, never a bare pass/fail.
//
// Phase 1a scope: the cheap, vision-free checks that need only a single metric
// bundle computed once from the framebuffer — C001 (empty/near-empty), C003
// (optical centering), C004 (value/contrast spread), C006 (palette/complexity
// budget), C008 (pinholes), C012 (dynamic transparent trailing edge row).
//
// Phase 1b adds the pixel-geometry checks that need one component/distance-
// transform scan (also computed once, only when a `--as` profile asks for it):
// C007 (floating-part/seam — 8-connected components, chamfer distance from the
// body) and C005 (stroke width — chamfer distance to the nearest uncovered
// pixel). A `CritiqueProfile` (`--as icon|scene|character|item`) selects which
// of these apply plus the category thresholds; `strict` promotes the must-fix
// subset from `warning` to `error`. The silhouette-signature checks
// (C002/C009/C011) arrive in 1c. Metric computation reuses `inspectSprite`
// (src/inspect.ts), `spritePreviewStats` (src/preview.ts) and `relativeLuminance`
// (src/color.ts): no metric is computed twice.

import { relativeLuminance } from './color.js'
import type { Diagnostic, Severity, TextSpan } from './diagnostic.js'
import { inspectSprite } from './inspect.js'
import { spritePreviewStats } from './preview.js'
import type { Sprite } from './values.js'

/** Stable `C0xx` diagnostic codes for the checks shipped in phase 1a. Public API — never renumber. */
export const CRITIQUE_CODE = {
  empty: 'C001',
  centering: 'C003',
  valueSpread: 'C004',
  strokeWidth: 'C005',
  paletteBudget: 'C006',
  floatingPart: 'C007',
  pinhole: 'C008',
  trailingEdgeRow: 'C012',
} as const

/**
 * Category-agnostic default ceiling on distinct RGBA8 values (C006). Deliberately
 * generous — cel-shaded pixel art rarely exceeds ~24 colours, so 64 only trips
 * on gradient/AA sprawl. Category `--as` profiles tighten this in phase 1b.
 */
const DEFAULT_COLOR_CEILING = 64

/** Minimum linear-luminance p90−p10 spread before a covered region reads as flat-shaded (C004). */
const MIN_VALUE_SPREAD = 0.15

/** Skip C004 below this many covered pixels — too small for a meaningful histogram. */
const MIN_SPREAD_SAMPLE = 8

/** Canvas size (`max(w,h)`) below which C005 is skipped — hairline strokes read fine on tiny sprites. */
const STROKE_MIN_SIZE = 32

/**
 * Fraction of the medial-axis skeleton that must fall under the stroke floor
 * before C005 fires. Deliberately high: a single thin detail (a bow limb, a
 * staff, a rain streak) is legitimate; only a sprite whose *load-bearing*
 * strokes are overwhelmingly hairline reads as "drawn as outlines, not filled".
 * Calibrated above the thinnest check-clean example (`bow` at 0.75) so the
 * bundled icon/item/character draws never false-fire (test-asserted).
 */
const STROKE_DOMINATION = 0.85

/** A flagged floating part (C007) must be at least this fraction of the body (min {@link MIN_PART_FLOOR}px) — filters AA specks. */
const MIN_PART_FRACTION = 0.01
const MIN_PART_FLOOR = 4

/** Rounds a fraction to 4 decimal places (matches inspect.ts' round4 convention). */
const round4 = (v: number): number => Math.round(v * 10000) / 10000

/** The four Drawstic asset categories a critique profile can target (ADR-0085 §4). */
export type CritiqueCategory = 'icon' | 'scene' | 'character' | 'item'

/**
 * A category threshold table (ADR-0085 §4) — never inferred, only chosen via
 * `--as`. Every field is a per-category *applicability/threshold* switch, not a
 * scale constant: the one absolute figure (min stroke width) is derived per
 * sprite as `round(2·size/32)`. `checkStroke`/`checkFloatingPart` gate the two
 * pixel-geometry checks to the categories where they are craft floors — C007
 * (floating part) only for `character`, because a bbox-overlapping detached
 * component is a compositional feature for icons/scenes (a weather icon's sun +
 * cloud) and a pair for items (two boots), but a seam bug for an assembled
 * character; C005 (stroke width) everywhere a subject has real strokes.
 */
export type CritiqueProfile = {
  readonly name: CritiqueCategory
  /** C006 distinct-colour ceiling; today the agnostic default for every category (1c re-baselines and tightens it). */
  readonly colorCeiling: number
  /** C005 applies (stroke discipline is a craft floor for this category). */
  readonly checkStroke: boolean
  /** C007 applies (a bbox-overlapping detached component signals a seam, not composition). */
  readonly checkFloatingPart: boolean
  /** Under `strict`, C003 (optical centering) joins the must-fix subset for this category. */
  readonly strictCentering: boolean
}

const PROFILES: Record<CritiqueCategory, CritiqueProfile> = {
  icon: {
    name: 'icon',
    colorCeiling: DEFAULT_COLOR_CEILING,
    checkStroke: true,
    checkFloatingPart: false,
    strictCentering: true,
  },
  item: {
    name: 'item',
    colorCeiling: DEFAULT_COLOR_CEILING,
    checkStroke: true,
    checkFloatingPart: false,
    strictCentering: true,
  },
  character: {
    name: 'character',
    colorCeiling: DEFAULT_COLOR_CEILING,
    checkStroke: true,
    checkFloatingPart: true,
    strictCentering: false,
  },
  scene: {
    name: 'scene',
    colorCeiling: DEFAULT_COLOR_CEILING,
    checkStroke: false,
    checkFloatingPart: false,
    strictCentering: false,
  },
}

/** Resolves a `--as` category name to its {@link CritiqueProfile}; `null` for an absent/unknown name (no inference). */
export const resolveProfile = (name: string | null | undefined): CritiqueProfile | null =>
  name != null && name in PROFILES ? PROFILES[name as CritiqueCategory] : null

/**
 * A single critique finding: the standard diagnostic fields plus the auditable
 * `{measured, threshold, fix}` triple (ADR-0085 §2). `detail` carries any extra
 * scalars a check reports (e.g. C003's `x0/x1/sum/target`).
 */
export type CritiqueCheck = {
  readonly code: string
  readonly severity: Severity
  readonly message: string
  readonly measured: number
  readonly threshold: number
  readonly fix: string
  readonly detail?: Readonly<Record<string, number>>
}

/**
 * The metric bundle computed once per rendered sprite — a superset of
 * `render --inspect` facts, so an agent reads real numbers even at zero
 * findings. `bbox` is the tight inclusive bounding box of covered (alpha>0)
 * pixels, `null` for a fully transparent sprite. `luminance` percentiles are
 * over covered pixels only, `null` when nothing is covered.
 */
export type CritiqueMetrics = {
  readonly width: number
  readonly height: number
  readonly bbox: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  } | null
  readonly coveredPixelCount: number
  readonly opaquePixelCount: number
  readonly transparentPixelCount: number
  readonly distinctColorCount: number
  readonly unknownColorCount: number
  readonly luminance: {
    readonly p10: number
    readonly p50: number
    readonly p90: number
    readonly spread: number
  } | null
}

/**
 * One drawing's critique report: its metric bundle plus the checks that fired.
 * `componentCount`/`minStrokeWidth` are the phase-1b geometry facts — present
 * only when a `--as` profile requested the component/stroke scan (`undefined`
 * otherwise, `minStrokeWidth` `null` when the sprite has no measurable stroke).
 */
export type CritiqueDrawing = CritiqueMetrics & {
  readonly name: string
  readonly checks: readonly CritiqueCheck[]
  readonly componentCount?: number
  readonly minStrokeWidth?: number | null
}

/** The whole-file critique report carried in the CLI payload. */
export type CritiqueReport = {
  readonly pass: boolean
  /** The active `--as` category, or `null` when none was given (agnostic subset only). */
  readonly profile: CritiqueCategory | null
  /** Whether `--strict` promoted the must-fix subset to `error`. */
  readonly strict: boolean
  readonly failedCodes: readonly string[]
  readonly drawings: readonly CritiqueDrawing[]
}

/**
 * A covered-pixel mask (`1` where alpha>0) plus the sorted linear-luminance
 * list of covered pixels — the one raw scan the pixel-geometry checks share.
 */
const scanCoverage = (
  sprite: Sprite,
): { readonly covered: Uint8Array; readonly luminances: number[] } => {
  const covered = new Uint8Array(sprite.w * sprite.h)
  const luminances: number[] = []
  for (let p = 0; p < covered.length; p++) {
    const i = p * 4
    const a = sprite.data[i + 3] ?? 0
    if (a === 0) {
      continue
    }
    covered[p] = 1
    luminances.push(
      relativeLuminance(sprite.data[i] ?? 0, sprite.data[i + 1] ?? 0, sprite.data[i + 2] ?? 0, a),
    )
  }
  luminances.sort((x, y) => x - y)
  return { covered, luminances }
}

/** Nearest-rank percentile of a pre-sorted array (`q` in [0,1]); `0` for an empty array. */
const percentile = (sorted: readonly number[], q: number): number => {
  if (sorted.length === 0) {
    return 0
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))
  return sorted[idx] ?? 0
}

/**
 * Border flood-fill over transparent (alpha===0) pixels (4-connected), then
 * connected-component sizes of the *interior* transparent pixels — the ones a
 * paint boundary fully encloses. `pinholeCount` counts holes of 1–3px (almost
 * always an unpainted-pixel bug, C008); `largestInteriorHole` is the biggest
 * enclosed gap (informative only — a deliberate window/handle can be large).
 */
const interiorHoles = (
  sprite: Sprite,
): { readonly pinholeCount: number; readonly largestInteriorHole: number } => {
  const w = sprite.w
  const h = sprite.h
  const n = w * h
  const isTransparent = (p: number): boolean => (sprite.data[p * 4 + 3] ?? 0) === 0
  const outside = new Uint8Array(n)
  const stack: number[] = []
  const pushIfOpenBorder = (p: number): void => {
    if (isTransparent(p) && outside[p] === 0) {
      outside[p] = 1
      stack.push(p)
    }
  }
  for (let x = 0; x < w; x++) {
    pushIfOpenBorder(x)
    pushIfOpenBorder((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    pushIfOpenBorder(y * w)
    pushIfOpenBorder(y * w + (w - 1))
  }
  while (stack.length > 0) {
    const p = stack.pop() as number
    const x = p % w
    const y = (p - x) / w
    if (x > 0) {
      pushIfOpenBorder(p - 1)
    }
    if (x < w - 1) {
      pushIfOpenBorder(p + 1)
    }
    if (y > 0) {
      pushIfOpenBorder(p - w)
    }
    if (y < h - 1) {
      pushIfOpenBorder(p + w)
    }
  }
  // Label interior transparent components (4-connected) and tally their sizes.
  const seen = new Uint8Array(n)
  let pinholeCount = 0
  let largestInteriorHole = 0
  const comp: number[] = []
  for (let start = 0; start < n; start++) {
    if (seen[start] === 1 || outside[start] === 1 || !isTransparent(start)) {
      continue
    }
    comp.length = 0
    comp.push(start)
    seen[start] = 1
    let size = 0
    while (comp.length > 0) {
      const p = comp.pop() as number
      size++
      const x = p % w
      const y = (p - x) / w
      const neighbour = (q: number): void => {
        if (seen[q] === 0 && outside[q] === 0 && isTransparent(q)) {
          seen[q] = 1
          comp.push(q)
        }
      }
      if (x > 0) {
        neighbour(p - 1)
      }
      if (x < w - 1) {
        neighbour(p + 1)
      }
      if (y > 0) {
        neighbour(p - w)
      }
      if (y < h - 1) {
        neighbour(p + w)
      }
    }
    largestInteriorHole = Math.max(largestInteriorHole, size)
    if (size >= 1 && size <= 3) {
      pinholeCount++
    }
  }
  return { pinholeCount, largestInteriorHole }
}

/** Count of fully-transparent rows below the content (C012); `0` if content reaches the bottom edge. */
const trailingTransparentRows = (metrics: CritiqueMetrics): number => {
  if (!metrics.bbox) {
    return 0
  }
  const contentBottom = metrics.bbox.y + metrics.bbox.height - 1
  return metrics.height - 1 - contentBottom
}

/**
 * Computes the once-per-sprite metric bundle, reusing `inspectSprite` for the
 * colour/bbox/coverage facts and `spritePreviewStats` for the unknown-colour
 * count, plus one shared coverage scan for the luminance histogram.
 */
export const computeCritiqueMetrics = (
  sprite: Sprite,
  luminances: readonly number[],
): CritiqueMetrics => {
  const info = inspectSprite(sprite)
  const stats = spritePreviewStats(sprite)
  const coveredPixelCount = sprite.w * sprite.h - info.transparentPixelCount
  const luminance =
    luminances.length === 0
      ? null
      : {
          p10: round4(percentile(luminances, 0.1)),
          p50: round4(percentile(luminances, 0.5)),
          p90: round4(percentile(luminances, 0.9)),
          spread: round4(percentile(luminances, 0.9) - percentile(luminances, 0.1)),
        }
  return {
    width: info.width,
    height: info.height,
    bbox: info.alphaCoverageBBox,
    coveredPixelCount,
    opaquePixelCount: info.opaquePixelCount,
    transparentPixelCount: info.transparentPixelCount,
    distinctColorCount: info.distinctColorCount,
    unknownColorCount: stats.unknownColorCount,
    luminance,
  }
}

/** C001: fully-transparent, or a content bbox under the near-empty floor (2% of canvas). */
const checkEmpty = (metrics: CritiqueMetrics): CritiqueCheck | null => {
  if (!metrics.bbox || metrics.coveredPixelCount === 0) {
    return {
      code: CRITIQUE_CODE.empty,
      severity: 'warning',
      message: 'sprite is fully transparent (nothing was painted)',
      measured: 0,
      threshold: 1,
      fix: 'add a bg/fill or a paint (e.g. `bg #…`, `rect …fill`, `circle …fill`)',
    }
  }
  const floor = Math.max(4, Math.round(metrics.width * metrics.height * 0.02))
  const area = metrics.bbox.width * metrics.bbox.height
  if (area < floor) {
    return {
      code: CRITIQUE_CODE.empty,
      severity: 'warning',
      message: `near-empty: content bbox covers only ${area}px of the ${metrics.width}x${metrics.height} canvas`,
      measured: area,
      threshold: floor,
      fix: 'enlarge the subject to fill the canvas, or shrink the canvas to the subject',
      detail: { coveredPixelCount: metrics.coveredPixelCount },
    }
  }
  return null
}

/** C003: optical centering — flags a horizontal bbox parity break `|(x0+x1)−(W−1)| > tol`. */
const checkCentering = (metrics: CritiqueMetrics): CritiqueCheck | null => {
  if (!metrics.bbox) {
    return null
  }
  const x0 = metrics.bbox.x
  const x1 = metrics.bbox.x + metrics.bbox.width - 1
  const sum = x0 + x1
  const target = metrics.width - 1
  const offset = sum - target
  const y0 = metrics.bbox.y
  const y1 = metrics.bbox.y + metrics.bbox.height - 1
  const offsetY = y0 + y1 - (metrics.height - 1)
  const tolPixels = Math.max(1, Math.round(metrics.width * 0.08))
  const threshold = tolPixels * 2
  if (Math.abs(offset) <= threshold) {
    return null
  }
  const shift = -Math.round(offset / 2)
  return {
    code: CRITIQUE_CODE.centering,
    severity: 'warning',
    message: `off-center: bbox x-span ${x0}..${x1} gives x0+x1=${sum}, want ${target} (offset ${offset})`,
    measured: offset,
    threshold,
    fix: `move the subject ${shift >= 0 ? '+' : ''}${shift}px on x to center it (want x0+x1==${target})`,
    detail: { x0, x1, sum, target, offsetY },
  }
}

/** C004: value/contrast spread — flags a covered region whose luminance p90−p10 reads flat. */
const checkValueSpread = (metrics: CritiqueMetrics): CritiqueCheck | null => {
  if (!metrics.luminance || metrics.coveredPixelCount < MIN_SPREAD_SAMPLE) {
    return null
  }
  const spread = metrics.luminance.spread
  if (spread >= MIN_VALUE_SPREAD) {
    return null
  }
  return {
    code: CRITIQUE_CODE.valueSpread,
    severity: 'warning',
    message: `flat value: luminance p90−p10 spread is ${spread}, want ≥ ${MIN_VALUE_SPREAD}`,
    measured: spread,
    threshold: MIN_VALUE_SPREAD,
    fix: 'add a darker shade + lighter highlight (shadeRegion/lightRegion) to raise value contrast',
    detail: { p10: metrics.luminance.p10, p90: metrics.luminance.p90 },
  }
}

/** C006: palette/complexity budget — flags distinct colours over the ceiling (agnostic default, or the profile's). */
const checkPaletteBudget = (
  metrics: CritiqueMetrics,
  ceiling: number = DEFAULT_COLOR_CEILING,
): CritiqueCheck | null => {
  if (metrics.distinctColorCount <= ceiling) {
    return null
  }
  return {
    code: CRITIQUE_CODE.paletteBudget,
    severity: 'warning',
    message: `palette budget: ${metrics.distinctColorCount} distinct colors exceeds ${ceiling}`,
    measured: metrics.distinctColorCount,
    threshold: ceiling,
    fix: `quantize the palette or drop gradient/AA sprawl (${metrics.unknownColorCount} colors are outside the declared pal)`,
    detail: { unknownColorCount: metrics.unknownColorCount },
  }
}

/** C008: interior pinholes — flags 1–3px transparent gaps enclosed by paint (near-certain bugs). */
const checkPinholes = (sprite: Sprite): CritiqueCheck | null => {
  const { pinholeCount, largestInteriorHole } = interiorHoles(sprite)
  if (pinholeCount === 0) {
    return null
  }
  return {
    code: CRITIQUE_CODE.pinhole,
    severity: 'warning',
    message: `${pinholeCount} interior pinhole(s): 1–3px transparent gap(s) enclosed by paint`,
    measured: pinholeCount,
    threshold: 0,
    fix: 'fill the enclosed pinhole(s) — usually an unpainted pixel inside a solid region',
    detail: { largestInteriorHole },
  }
}

/** C012: dynamic transparent trailing edge row — the rendered form of W009, for procedural draws. */
const checkTrailingEdgeRow = (metrics: CritiqueMetrics): CritiqueCheck | null => {
  const trailing = trailingTransparentRows(metrics)
  if (trailing <= 0) {
    return null
  }
  return {
    code: CRITIQUE_CODE.trailingEdgeRow,
    severity: 'warning',
    message: `${trailing} fully-transparent row(s) below the content at the bottom edge`,
    measured: trailing,
    threshold: 0,
    fix: 'trim the trailing transparent row(s) or shrink canvas height; a bottom-padded footprint seams a gap below stacked parts',
  }
}

// ── pixel geometry (phase 1b: C005 stroke width, C007 floating part) ──────────

/** A sentinel "unreachable" distance for the chamfer transforms (well above any real canvas distance). */
const INF_DIST = 1 << 29

/** Inclusive integer bbox of a labelled component. */
type CompBBox = {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/** 8-connected component labels of the covered mask, with per-component pixel count and bbox. */
type Components = {
  readonly label: Int32Array
  readonly sizes: readonly number[]
  readonly bboxes: readonly CompBBox[]
}

/** Iterative 8-connected flood fill over the covered mask; `label[p]` is the component index (`-1` uncovered). O(w·h). */
const labelComponents = (covered: Uint8Array, w: number, h: number): Components => {
  const n = w * h
  const label = new Int32Array(n).fill(-1)
  const sizes: number[] = []
  const bboxes: CompBBox[] = []
  const stack: number[] = []
  let comp = 0
  for (let s = 0; s < n; s++) {
    if (covered[s] === 0 || label[s] !== -1) {
      continue
    }
    stack.length = 0
    stack.push(s)
    label[s] = comp
    let size = 0
    let x0 = w
    let y0 = h
    let x1 = -1
    let y1 = -1
    while (stack.length > 0) {
      const p = stack.pop() as number
      const x = p % w
      const y = (p - x) / w
      size++
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) {
            continue
          }
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            continue
          }
          const q = ny * w + nx
          if (covered[q] === 1 && label[q] === -1) {
            label[q] = comp
            stack.push(q)
          }
        }
      }
    }
    sizes.push(size)
    bboxes.push({ x0, y0, x1, y1 })
    comp++
  }
  return { label, sizes, bboxes }
}

/**
 * Two-pass Chebyshev (chamfer 1,1) distance transform: `dt[p]=0` where
 * `seed[p]===1`, else the Chebyshev distance to the nearest seed. Out-of-canvas
 * is not a seed (a subject running off the edge is treated as continuing, not
 * bounded). O(w·h) forward + backward. `dt[p]` stays {@link INF_DIST} where no
 * seed is reachable (a fully covered region has no uncovered seed).
 */
const chamferDistance = (seed: Uint8Array, w: number, h: number): Int32Array => {
  const dt = new Int32Array(w * h)
  for (let p = 0; p < dt.length; p++) {
    dt[p] = seed[p] === 1 ? 0 : INF_DIST
  }
  const relax = (p: number, q: number): void => {
    const v = (dt[q] ?? INF_DIST) + 1
    if (v < (dt[p] ?? INF_DIST)) {
      dt[p] = v
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (dt[p] === 0) {
        continue
      }
      if (x > 0) {
        relax(p, p - 1)
      }
      if (y > 0) {
        relax(p, p - w)
      }
      if (x > 0 && y > 0) {
        relax(p, p - w - 1)
      }
      if (x < w - 1 && y > 0) {
        relax(p, p - w + 1)
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x
      if (dt[p] === 0) {
        continue
      }
      if (x < w - 1) {
        relax(p, p + 1)
      }
      if (y < h - 1) {
        relax(p, p + w)
      }
      if (x < w - 1 && y < h - 1) {
        relax(p, p + w + 1)
      }
      if (x > 0 && y < h - 1) {
        relax(p, p + w - 1)
      }
    }
  }
  return dt
}

/** A non-body component that overlaps the body bbox yet sits a pixel gap clear of it — the C007 signature. */
type FloatingPart = {
  readonly size: number
  readonly gapPx: number
  readonly bbox: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

/**
 * C007 support: 8-connected components, body = the largest, chamfer distance
 * from the body mask. Returns the components whose bbox overlaps (or sits ≤1px
 * from) the body bbox *and* that stay ≥1px clear of it — the "meant-to-touch
 * but doesn't" seam signature. Legitimately orbiting parts (bbox far from the
 * body) and sub-{@link MIN_PART_FLOOR} specks are excluded.
 */
const scanFloatingParts = (
  covered: Uint8Array,
  w: number,
  h: number,
): { readonly componentCount: number; readonly floatingParts: readonly FloatingPart[] } => {
  const { label, sizes, bboxes } = labelComponents(covered, w, h)
  const componentCount = sizes.length
  if (componentCount <= 1) {
    return { componentCount, floatingParts: [] }
  }
  let body = 0
  for (let i = 1; i < sizes.length; i++) {
    if ((sizes[i] ?? 0) > (sizes[body] ?? 0)) {
      body = i
    }
  }
  const bodyMask = new Uint8Array(w * h)
  for (let p = 0; p < bodyMask.length; p++) {
    if (label[p] === body) {
      bodyMask[p] = 1
    }
  }
  const dt = chamferDistance(bodyMask, w, h)
  const gaps = new Array<number>(componentCount).fill(INF_DIST)
  for (let p = 0; p < label.length; p++) {
    const c = label[p] ?? -1
    if (c < 0 || c === body) {
      continue
    }
    const d = dt[p] ?? INF_DIST
    if (d < (gaps[c] ?? INF_DIST)) {
      gaps[c] = d
    }
  }
  const bb = bboxes[body] as CompBBox
  const minPart = Math.max(MIN_PART_FLOOR, Math.round((sizes[body] ?? 0) * MIN_PART_FRACTION))
  const floatingParts: FloatingPart[] = []
  for (let c = 0; c < componentCount; c++) {
    if (c === body || (sizes[c] ?? 0) < minPart) {
      continue
    }
    const box = bboxes[c] as CompBBox
    const overlaps =
      box.x0 - 1 <= bb.x1 && box.x1 + 1 >= bb.x0 && box.y0 - 1 <= bb.y1 && box.y1 + 1 >= bb.y0
    const gapPx = (gaps[c] ?? INF_DIST) - 1
    if (!overlaps || gapPx < 1) {
      continue
    }
    floatingParts.push({
      size: sizes[c] ?? 0,
      gapPx,
      bbox: { x: box.x0, y: box.y0, width: box.x1 - box.x0 + 1, height: box.y1 - box.y0 + 1 },
    })
  }
  return { componentCount, floatingParts }
}

/** The stroke-width facts for C005: min load-bearing stroke, how thin-dominated the skeleton is, and the scale floor. */
type StrokeScan = {
  readonly minStrokeWidth: number | null
  readonly thinStrokeFraction: number
  readonly ridgeCount: number
  readonly strokeFloor: number
}

/**
 * C005 support: chamfer distance from every covered pixel to the nearest
 * uncovered pixel (its local half-width), then the medial-axis ridge (local
 * maxima). Local stroke width ≈ `2·ridgeDistance`; `thinStrokeFraction` is the
 * share of the ridge under the scale floor `round(2·size/32)`. A solid fill
 * (no uncovered pixel reachable) yields no ridge and never reads as thin.
 */
const scanStroke = (covered: Uint8Array, w: number, h: number): StrokeScan => {
  const size = Math.max(w, h)
  const strokeFloor = Math.round((2 * size) / 32)
  const seed = new Uint8Array(w * h)
  for (let p = 0; p < seed.length; p++) {
    if (covered[p] === 0) {
      seed[p] = 1
    }
  }
  const dt = chamferDistance(seed, w, h)
  let minWidth = INF_DIST
  let thin = 0
  let ridge = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      const d = dt[p] ?? 0
      if (d <= 0 || d >= INF_DIST) {
        continue
      }
      let isRidge = true
      for (let dy = -1; dy <= 1 && isRidge; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) {
            continue
          }
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
            continue
          }
          if ((dt[ny * w + nx] ?? 0) > d) {
            isRidge = false
            break
          }
        }
      }
      if (!isRidge) {
        continue
      }
      ridge++
      const width = 2 * d
      minWidth = Math.min(minWidth, width)
      if (width < strokeFloor) {
        thin++
      }
    }
  }
  return {
    minStrokeWidth: ridge > 0 ? minWidth : null,
    thinStrokeFraction: ridge > 0 ? round4(thin / ridge) : 0,
    ridgeCount: ridge,
    strokeFloor,
  }
}

/** C007: floating part / seam — the largest body-overlapping detached component with a pixel gap (ADR-0085 §3). */
const checkFloatingPart = (name: string, parts: readonly FloatingPart[]): CritiqueCheck | null => {
  if (parts.length === 0) {
    return null
  }
  let worst = parts[0] as FloatingPart
  for (const p of parts) {
    if (p.size > worst.size) {
      worst = p
    }
  }
  const pad = Math.max(2, worst.gapPx + 1)
  const cx = Math.max(0, worst.bbox.x - pad)
  const cy = Math.max(0, worst.bbox.y - pad)
  const cw = worst.bbox.width + pad * 2
  const ch = worst.bbox.height + pad * 2
  return {
    code: CRITIQUE_CODE.floatingPart,
    severity: 'warning',
    message: `floating part: a ${worst.size}px component overlaps the body bbox but sits ${worst.gapPx}px clear of it (seam / detached limb)`,
    measured: worst.gapPx,
    threshold: 0,
    fix: `close the seam: render #${name} --crop ${cx}:${cy} ${cw}x${ch} --silhouette to see the gap, then fit/move the part onto the body`,
    detail: {
      partCount: parts.length,
      partSize: worst.size,
      partX: worst.bbox.x,
      partY: worst.bbox.y,
    },
  }
}

/** C005: stroke width — fires when load-bearing strokes are overwhelmingly under the scale floor at ≥32px (ADR-0085 §3). */
const checkStrokeWidth = (metrics: CritiqueMetrics, stroke: StrokeScan): CritiqueCheck | null => {
  const size = Math.max(metrics.width, metrics.height)
  if (
    size < STROKE_MIN_SIZE ||
    stroke.minStrokeWidth === null ||
    stroke.ridgeCount === 0 ||
    stroke.thinStrokeFraction < STROKE_DOMINATION
  ) {
    return null
  }
  return {
    code: CRITIQUE_CODE.strokeWidth,
    severity: 'warning',
    message: `thin strokes dominate: ${Math.round(stroke.thinStrokeFraction * 100)}% of load-bearing strokes are under ${stroke.strokeFloor}px (min ${stroke.minStrokeWidth}px)`,
    measured: stroke.minStrokeWidth,
    threshold: stroke.strokeFloor,
    fix: `thicken the dominant strokes to ≥ ${stroke.strokeFloor}px; this ${size}px sprite reads as a wall of hairlines, not filled forms`,
    detail: { thinStrokeFraction: stroke.thinStrokeFraction, ridgeCount: stroke.ridgeCount },
  }
}

/** The must-fix `C0xx` subset `--strict` promotes to `error` regardless of profile (ADR-0085 §5 + phase-1b task). */
const STRICT_MUST_FIX: readonly string[] = [
  CRITIQUE_CODE.empty,
  CRITIQUE_CODE.floatingPart,
  CRITIQUE_CODE.pinhole,
  CRITIQUE_CODE.trailingEdgeRow,
]

/** Under `strict`, promotes {@link STRICT_MUST_FIX} (plus C003 for icon/item) from `warning` to `error`. */
const promoteStrict = (
  checks: readonly CritiqueCheck[],
  profile: CritiqueProfile | null,
  strict: boolean,
): CritiqueCheck[] => {
  const list = checks.slice()
  if (!strict) {
    return list
  }
  const mustFix = new Set<string>(STRICT_MUST_FIX)
  if (profile?.strictCentering) {
    mustFix.add(CRITIQUE_CODE.centering)
  }
  return list.map((c) => (mustFix.has(c.code) ? { ...c, severity: 'error' as const } : c))
}

/** Options for {@link critiqueSprite}: the resolved category profile and the strict gate (both optional; agnostic subset by default). */
export type CritiqueOptions = {
  readonly profile?: CritiqueProfile | null
  readonly strict?: boolean
}

/**
 * Runs the critique catalog against one rendered sprite and returns its
 * {@link CritiqueDrawing} report (metric bundle + fired checks). Pure and
 * vision-free — the same sprite + options always yield the same report. The
 * agnostic checks (C001/C003/C004/C006/C008/C012) always run; the pixel-geometry
 * checks C007 (floating part) and C005 (stroke width) run only when the
 * `profile` opts them in via `checkFloatingPart`/`checkStroke`. `strict`
 * promotes the must-fix subset to `error`.
 */
export const critiqueSprite = (
  name: string,
  sprite: Sprite,
  options: CritiqueOptions = {},
): CritiqueDrawing => {
  const profile = options.profile ?? null
  const { covered, luminances } = scanCoverage(sprite)
  const metrics = computeCritiqueMetrics(sprite, luminances)
  const checks: CritiqueCheck[] = []
  const push = (c: CritiqueCheck | null): void => {
    if (c) {
      checks.push(c)
    }
  }
  push(checkEmpty(metrics))
  push(checkCentering(metrics))
  push(checkValueSpread(metrics))
  push(checkPaletteBudget(metrics, profile?.colorCeiling))
  push(checkPinholes(sprite))
  push(checkTrailingEdgeRow(metrics))

  let componentCount: number | undefined
  let minStrokeWidth: number | null | undefined
  if (profile?.checkFloatingPart) {
    const scan = scanFloatingParts(covered, sprite.w, sprite.h)
    componentCount = scan.componentCount
    push(checkFloatingPart(name, scan.floatingParts))
  }
  if (profile?.checkStroke) {
    const stroke = scanStroke(covered, sprite.w, sprite.h)
    minStrokeWidth = stroke.minStrokeWidth
    push(checkStrokeWidth(metrics, stroke))
  }

  const finalChecks = promoteStrict(checks, profile, options.strict ?? false)
  return {
    name,
    ...metrics,
    checks: finalChecks,
    ...(componentCount === undefined ? {} : { componentCount }),
    ...(minStrokeWidth === undefined ? {} : { minStrokeWidth }),
  }
}

/** Anchors a {@link CritiqueCheck} to a `draw` span as a standard {@link Diagnostic}. */
export const critiqueCheckDiagnostic = (
  check: CritiqueCheck,
  file: string,
  span: TextSpan,
): Diagnostic => ({
  severity: check.severity,
  code: check.code,
  message: check.message,
  file,
  line: span.line,
  column: span.column,
  ...(span.endLine === undefined ? {} : { endLine: span.endLine }),
  ...(span.endColumn === undefined ? {} : { endColumn: span.endColumn }),
  hint: check.fix,
})
