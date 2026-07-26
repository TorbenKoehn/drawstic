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
// subset from `warning` to `error`.
//
// Phase 1c adds C002 (edge-clip — opaque content touching a canvas edge, a
// margin bug for transparent-framed icon/item/character sprites; never for a
// full-bleed scene) and the family checks that compare a group of siblings:
// C009 (sibling-silhouette collapse — scale-/position-invariant 32x32
// fractional-coverage signatures, normalized L1 distance under the collapse
// threshold) and C011 (family weight parity — a sibling whose covered mass
// deviates from the family median by more than the parity factor). 1c also
// re-baselines the must-fix subset against the bundled corpus (`STRICT_MUST_FIX`)
// and tightens per-category thresholds to their measured craft floor. Metric
// computation reuses `inspectSprite` (src/inspect.ts), `spritePreviewStats`
// (src/preview.ts) and `relativeLuminance` (src/color.ts): no metric is computed
// twice.

import { color, colorToOklch, relativeLuminance } from './color.js'
import type { Diagnostic, Severity, TextSpan } from './diagnostic.js'
import { dcosDeg, dsinDeg } from './dmath.js'
import { inspectSprite } from './inspect.js'
import { spritePreviewStats } from './preview.js'
import type { OcclusionResult, Sprite } from './values.js'

/** Stable `C0xx` diagnostic codes. Public API — never renumber. */
export const CRITIQUE_CODE = {
  empty: 'C001',
  edgeClip: 'C002',
  centering: 'C003',
  valueSpread: 'C004',
  strokeWidth: 'C005',
  paletteBudget: 'C006',
  floatingPart: 'C007',
  pinhole: 'C008',
  siblingCollapse: 'C009',
  familyParity: 'C011',
  trailingEdgeRow: 'C012',
  occlusionParity: 'C013',
  viewLandmarkParity: 'C014',
} as const

/**
 * The **budgeted-target** C006 ceiling on distinct RGBA8 values, applied only when the
 * drawing declares an indexed-PNG or SVG export ({@link PaletteTarget} `'budgeted'`), where
 * colour count is a real constraint (indexed palette cap / one SVG `<rect>` run per colour
 * band). Deliberately generous — cel-shaded pixel art rarely exceeds ~24 colours, so 256
 * only trips on runaway gradient/AA sprawl. Category `--as` profiles set their own budgeted
 * ceiling from the measured corpus maximum (see {@link PROFILES}); the ceilings sit above
 * every clean bundled example rather than at an aspirational floor.
 */
const DEFAULT_COLOR_CEILING = 256

/**
 * The **unbudgeted-target** C006 ceiling ({@link PaletteTarget} `'unbudgeted'`): a
 * straight-alpha RGBA-PNG / JPEG target — or no export at all — has *no* palette budget, so
 * smooth normal-`model` shading (ADR-0089) legitimately spends 400–600 colours on a clean
 * 64×128 character. C006 is therefore demoted to an advisory `info` (never blocks `pass`,
 * never in `failedCodes`) under this generous backstop, which only surfaces genuinely
 * pathological sprawl. Combined with the profile ceiling via `max(…)`, so a full-bleed
 * `scene`'s already-high budget is preserved.
 */
const RGBA_COLOR_CEILING = 4096

/** Minimum linear-luminance p90−p10 spread before a covered region reads as flat-shaded (C004). */
const MIN_VALUE_SPREAD = 0.15

/** Skip C004 below this many covered pixels — too small for a meaningful histogram. */
const MIN_SPREAD_SAMPLE = 8

/**
 * Median linear luminance below which C004 is demoted to a non-blocking advisory: linear luminance
 * compresses hard toward black, so a legitimately dark subject cannot reach {@link MIN_VALUE_SPREAD}
 * at any sane dose. See {@link checkValueSpread}.
 */
const DARK_SUBJECT_L50 = 0.06

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
 * sprite as `round(2·size/32)`. `checkStroke`/`checkFloatingPart`/`checkEdgeClip`
 * gate the pixel-geometry checks to the categories where they are craft floors:
 * C007 (floating part) only for `character`, because a bbox-overlapping detached
 * component is a compositional feature for icons/scenes (a weather icon's sun +
 * cloud) and a pair for items (two boots), but a seam bug for an assembled
 * character; C005 (stroke width) everywhere a subject has real strokes; C002
 * (edge-clip) for the transparent-framed categories (`icon`/`item`/`character`)
 * that must keep a margin, never for a full-bleed `scene` whose sky/ground is
 * meant to touch every edge. `colorCeiling` is set per category from the
 * measured corpus maximum (icons carry gradient plates, scenes thousands of
 * gradient tones), so C006 only trips on runaway sprawl, never on a clean
 * bundled example. `strictCentering` promotes C003 to the must-fix subset only
 * for `icon` — items include diagonal weapons (a dagger, a staff) whose bbox
 * parity is legitimately off, so item centering stays an advisory warning.
 */
export type CritiqueProfile = {
  readonly name: CritiqueCategory
  /** C006 distinct-colour ceiling, set above this category's measured clean maximum (advisory sprawl backstop). */
  readonly colorCeiling: number
  /** C005 applies (stroke discipline is a craft floor for this category). */
  readonly checkStroke: boolean
  /** C007 applies (a bbox-overlapping detached component signals a seam, not composition). */
  readonly checkFloatingPart: boolean
  /** C002 applies (this category keeps a transparent margin; a full-bleed scene does not). */
  readonly checkEdgeClip: boolean
  /** Under `strict`, C003 (optical centering) joins the must-fix subset for this category. */
  readonly strictCentering: boolean
}

const PROFILES: Record<CritiqueCategory, CritiqueProfile> = {
  icon: {
    name: 'icon',
    colorCeiling: 320,
    checkStroke: true,
    checkFloatingPart: false,
    checkEdgeClip: true,
    strictCentering: true,
  },
  item: {
    name: 'item',
    colorCeiling: 192,
    checkStroke: true,
    checkFloatingPart: false,
    checkEdgeClip: true,
    strictCentering: false,
  },
  character: {
    name: 'character',
    colorCeiling: 96,
    checkStroke: true,
    checkFloatingPart: true,
    // A full-height figure legitimately reaches the top (hair) and bottom (feet)
    // canvas rows, so edge contact is not a clip for characters.
    checkEdgeClip: false,
    strictCentering: false,
  },
  scene: {
    name: 'scene',
    colorCeiling: 12000,
    checkStroke: false,
    checkFloatingPart: false,
    checkEdgeClip: false,
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

/** Fully-transparent rows above (`leading`) and below (`trailing`) the content (C012 support); both `0` for an empty sprite. */
const verticalMargins = (
  metrics: CritiqueMetrics,
): { readonly leading: number; readonly trailing: number } => {
  if (!metrics.bbox) {
    return { leading: 0, trailing: 0 }
  }
  const contentBottom = metrics.bbox.y + metrics.bbox.height - 1
  return { leading: metrics.bbox.y, trailing: metrics.height - 1 - contentBottom }
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

/** Which canvas edges carry an opaque (alpha===255) pixel, and how many opaque edge pixels in total (C002 support). */
const edgeClipScan = (
  sprite: Sprite,
): { readonly edges: readonly ('top' | 'bottom' | 'left' | 'right')[]; readonly count: number } => {
  const w = sprite.w
  const h = sprite.h
  const isOpaque = (x: number, y: number): boolean =>
    (sprite.data[(y * w + x) * 4 + 3] ?? 0) === 255
  let top = 0
  let bottom = 0
  let left = 0
  let right = 0
  for (let x = 0; x < w; x++) {
    if (isOpaque(x, 0)) {
      top++
    }
    if (h > 1 && isOpaque(x, h - 1)) {
      bottom++
    }
  }
  for (let y = 0; y < h; y++) {
    if (isOpaque(0, y)) {
      left++
    }
    if (w > 1 && isOpaque(w - 1, y)) {
      right++
    }
  }
  const edges: ('top' | 'bottom' | 'left' | 'right')[] = []
  if (top > 0) {
    edges.push('top')
  }
  if (bottom > 0) {
    edges.push('bottom')
  }
  if (left > 0) {
    edges.push('left')
  }
  if (right > 0) {
    edges.push('right')
  }
  return { edges, count: top + bottom + left + right }
}

/**
 * C002: edge-clip — opaque content touching a canvas edge on a transparent-framed
 * sprite (icon/item/character), which means the subject has no margin and is
 * likely truncated. Profile-gated (`checkEdgeClip`) — never runs for a full-bleed
 * `scene` whose sky/ground is meant to bleed to every edge, nor category-agnostic.
 */
const checkEdgeClip = (sprite: Sprite): CritiqueCheck | null => {
  const { edges, count } = edgeClipScan(sprite)
  if (edges.length === 0) {
    return null
  }
  return {
    code: CRITIQUE_CODE.edgeClip,
    severity: 'warning',
    message: `edge-clip: opaque content touches the ${edges.join(', ')} canvas edge(s) — no transparent margin`,
    measured: count,
    threshold: 0,
    fix: 'inset the subject so a transparent margin surrounds it (2–4px breathing room), or enlarge the canvas',
    detail: {
      top: edges.includes('top') ? 1 : 0,
      bottom: edges.includes('bottom') ? 1 : 0,
      left: edges.includes('left') ? 1 : 0,
      right: edges.includes('right') ? 1 : 0,
    },
  }
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

/**
 * C004: value/contrast spread — flags a covered region whose luminance p90−p10 reads flat.
 *
 * The `fix` names the **canonical** lever (the material's own `spread` dose) and carries a concrete
 * multiplier, because a bare "raise the contrast" turned this into the most-gamed metric in the
 * corpus: 13.7 % of all recipe edits in the session history were blind dose nudges chasing this one
 * number (`45%` → `26%` → `48%` → `30%` → `44%` on a single binding). A number plus the one right
 * knob is actionable; a number alone invites a random walk.
 */
const checkValueSpread = (metrics: CritiqueMetrics): CritiqueCheck | null => {
  if (!metrics.luminance || metrics.coveredPixelCount < MIN_SPREAD_SAMPLE) {
    return null
  }
  const spread = metrics.luminance.spread
  if (spread >= MIN_VALUE_SPREAD) {
    return null
  }
  // On a near-black subject the *linear* p90−p10 spread is compressed by the transfer curve itself,
  // so the fixed threshold is unreachable without wrecking the art (ADR-0091 known limit: the
  // assassin's dark cloth needed `spread ~800 %`). Keep measuring it, stop blocking `pass` on it.
  const dark = metrics.luminance.p50 < DARK_SUBJECT_L50
  const factor = Math.min(6, Math.max(1.5, MIN_VALUE_SPREAD / Math.max(spread, 0.005)))
  const suggested = Math.round(factor * 20) * 5
  return {
    code: CRITIQUE_CODE.valueSpread,
    severity: dark ? 'info' : 'warning',
    message: dark
      ? `flat value (advisory — near-black subject, linear spread is compressed): luminance p90−p10 spread is ${spread}, want ≥ ${MIN_VALUE_SPREAD}`
      : `flat value: luminance p90−p10 spread is ${spread}, want ≥ ${MIN_VALUE_SPREAD}`,
    measured: spread,
    threshold: MIN_VALUE_SPREAD,
    fix: `raise the material's own value spread — \`material NAME = COLOR RESPONSE spread ${suggested}%\` (≈${round4(factor)}× the current dose) — or switch that mass to \`cel N\` for a flat top band; never patch tones onto the region by hand (W013)`,
    detail: { p10: metrics.luminance.p10, p50: metrics.luminance.p50, p90: metrics.luminance.p90 },
  }
}

/**
 * Whether the drawing's declared export target makes its distinct-RGBA8-colour count a real
 * budget (ADR-0085 known-limitation fix). `'budgeted'` — the module declares an indexed-PNG
 * (`png … indexed`) or `svg` export for this drawing, where colour count caps the indexed
 * palette / multiplies SVG `<rect>` runs: C006 applies the tight profile ceiling as a
 * `pass`-blocking `warning`. `'unbudgeted'` — a straight-alpha RGBA-PNG/JPEG target, or no
 * export at all, where smooth normal-`model` shading (ADR-0089) legitimately spends hundreds
 * of colours: C006 is a non-blocking advisory `info` under {@link RGBA_COLOR_CEILING}. The
 * conservative default when the target cannot be determined is `'unbudgeted'` (generous).
 */
export type PaletteTarget = 'budgeted' | 'unbudgeted'

/**
 * C006: palette/complexity budget — export-target-aware (ADR-0085). A `'budgeted'` target
 * (indexed-PNG / SVG export declared) enforces the tight `budgetedCeiling` (agnostic default,
 * or the profile's) as a `pass`-blocking `warning`; an `'unbudgeted'` target (RGBA-PNG/JPEG or
 * no export) enforces only the generous {@link RGBA_COLOR_CEILING} as an advisory `info` that
 * never blocks `pass` — a straight-alpha RGBA sprite has no palette budget, so smooth `model`
 * shading is not a defect there.
 */
const checkPaletteBudget = (
  metrics: CritiqueMetrics,
  target: PaletteTarget,
  budgetedCeiling: number = DEFAULT_COLOR_CEILING,
): CritiqueCheck | null => {
  const budgeted = target === 'budgeted'
  const ceiling = budgeted ? budgetedCeiling : Math.max(budgetedCeiling, RGBA_COLOR_CEILING)
  if (metrics.distinctColorCount <= ceiling) {
    return null
  }
  return {
    code: CRITIQUE_CODE.paletteBudget,
    severity: budgeted ? 'warning' : 'info',
    message: budgeted
      ? `palette budget: ${metrics.distinctColorCount} distinct colors exceeds the ${ceiling}-colour indexed/SVG budget`
      : `palette note: ${metrics.distinctColorCount} distinct colors (advisory — the RGBA/JPEG target has no palette budget; ${metrics.unknownColorCount} are outside the declared pal)`,
    measured: metrics.distinctColorCount,
    threshold: ceiling,
    fix: budgeted
      ? `quantize the palette or drop gradient/AA sprawl for the indexed/SVG export (${metrics.unknownColorCount} colors are outside the declared pal)`
      : 'no action needed for the RGBA/JPEG target; quantize only if you add an indexed-PNG or SVG export',
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
  const { leading, trailing } = verticalMargins(metrics)
  // Only an *asymmetric* bottom gap is a defect: content pushed up with more
  // padding below than above (a mis-placed footprint that seams a gap below
  // stacked parts). Symmetric breathing room (trailing ≈ leading) is deliberate
  // centering, never flagged. Tolerance scales with canvas height.
  const tol = Math.max(1, Math.round(metrics.height * 0.06))
  const excess = trailing - leading
  if (excess <= tol) {
    return null
  }
  return {
    code: CRITIQUE_CODE.trailingEdgeRow,
    severity: 'warning',
    message: `bottom-heavy padding: ${trailing} transparent row(s) below the content vs ${leading} above (excess ${excess} > ${tol})`,
    measured: excess,
    threshold: tol,
    fix: 'center the content vertically or trim the trailing transparent row(s); a bottom-padded footprint seams a gap below stacked parts',
    detail: { leading, trailing },
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

/**
 * C013: occlusion parity (ADR-0092) — a declared `behind`/`front` relation whose behind-part is still
 * the visible top of the overlap zone in the final composite. High-confidence and declarative (it only
 * ever measures relations the author asked for), so it carries no false-positive risk and joins the
 * `--strict` must-fix subset. Fires when any relation has visible violating pixels; a zero-overlap
 * relation (the target parts don't actually overlap) is silent — a likely-wrong target, but not a
 * broken composite.
 */
const checkOcclusionParity = (sprite: Sprite): CritiqueCheck | null => {
  const occ = sprite.occlusions ?? []
  const bad = occ.filter((o) => o.overlap > 0 && o.violating > 0)
  if (bad.length === 0) {
    return null
  }
  let worst = bad[0] as OcclusionResult
  for (const o of bad) {
    if (o.violating > worst.violating) {
      worst = o
    }
  }
  const detail = bad
    .map((o) => `'${o.behind}' shows ${o.violating}/${o.overlap}px over '${o.front}'`)
    .join('; ')
  return {
    code: CRITIQUE_CODE.occlusionParity,
    severity: 'warning',
    message: `occlusion parity: ${detail} — a declared behind/front relation isn't honored in the composite`,
    measured: worst.violating,
    threshold: 0,
    fix: `the behind-part is still visible above its occluder in the overlap zone — declare the relation within one paint run (no intervening fill/px), or reorder so the occluder paints after '${worst.behind}'`,
    detail: { relations: bad.length, violating: worst.violating, overlap: worst.overlap },
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

/**
 * The must-fix `C0xx` subset `--strict` promotes to `error` (exit 1) — the CI
 * regression gate. Calibrated in phase 1c against the bundled corpus to the
 * *unambiguous structural defects only*: C001 (empty) and C007 (character
 * floating-part/seam). C003 (optical centering) joins per-profile
 * (`strictCentering`, icon only). Every other `C0xx` is deliberately advisory
 * (`warning`, exit 0) after measuring its false-positive rate on correct art:
 * C002 (icons/items legitimately fill to an edge), C008 (open bow/crossbow
 * frames, arrow bundles, glyph counters, organic overlaps all enclose legit
 * 1–3px gaps), C009 (silhouette-sharing is a first-class pattern — faction
 * recolors, size variants, and shared bottle/shield/plate scaffolds all collapse
 * to one silhouette *by design*, and a colour-blind silhouette check cannot tell
 * an intentional variant from a duplicate), C011 (item sets legitimately mix a
 * ring and a greatsword), C012 (symmetric bottom breathing room), C005/C006
 * (thin-detail and gradient sprawl are style choices). This narrows ADR-0085
 * §5's original list (C001/C002/C007/C008/C009) to what the corpus proves is
 * unambiguous — recorded there and in docs/impl-progress.md.
 */
const STRICT_MUST_FIX: readonly string[] = [
  CRITIQUE_CODE.empty,
  CRITIQUE_CODE.floatingPart,
  CRITIQUE_CODE.occlusionParity,
]

/** Under `strict`, promotes {@link STRICT_MUST_FIX} (plus C003 for a `strictCentering` profile) from `warning` to `error`. */
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

/** Options for {@link critiqueSprite}: the resolved category profile, the strict gate, and the C006 export target (all optional; agnostic subset, `'unbudgeted'` palette target by default). */
export type CritiqueOptions = {
  readonly profile?: CritiqueProfile | null
  readonly strict?: boolean
  /** C006 export target: `'budgeted'` (indexed-PNG/SVG declared) enforces the tight ceiling; `'unbudgeted'` (RGBA/JPEG or none, the default) is advisory-only. */
  readonly paletteTarget?: PaletteTarget
}

/**
 * Runs the per-sprite critique catalog against one rendered sprite and returns
 * its {@link CritiqueDrawing} report (metric bundle + fired checks). Pure and
 * vision-free — the same sprite + options always yield the same report. The
 * agnostic checks (C001/C003/C004/C006/C008/C012) always run; the profile-gated
 * checks run only when opted in — C002 (edge-clip) via `checkEdgeClip`, C007
 * (floating part) via `checkFloatingPart`, C005 (stroke width) via `checkStroke`.
 * `strict` promotes the must-fix subset to `error`. The family checks
 * (C009/C011) compare *siblings* and live in {@link critiqueFamily}.
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
  if (profile?.checkEdgeClip) {
    push(checkEdgeClip(sprite))
  }
  push(checkCentering(metrics))
  push(checkValueSpread(metrics))
  push(checkPaletteBudget(metrics, options.paletteTarget ?? 'unbudgeted', profile?.colorCeiling))
  push(checkPinholes(sprite))
  push(checkTrailingEdgeRow(metrics))
  push(checkOcclusionParity(sprite))

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

// ── family checks (phase 1c: C009 sibling collapse, C011 weight parity) ───────

/** Side of the fixed silhouette-signature grid (32×32 = 1024 cells). Public shape — never change. */
const SIGNATURE_GRID = 32

/** Normalized-L1 silhouette distance under which two siblings read as the same shape (C009, >88 % identical). */
const COLLAPSE_DISTANCE = 0.12

/**
 * The character-craft three-view naming suffixes (SKILL.md/character-craft.md's mandated
 * front/side/back workflow), longest first so `…Front`/`…Side`/`…Back` never partially
 * shadow a shorter false match.
 */
const VIEW_SUFFIXES = ['Front', 'Side', 'Back'] as const

/**
 * The naming stem `name` shares with its own front/side/back siblings (character-DX 2026-07-10
 * rerun §5.2/§9.6): strips one trailing view suffix, so `knightFront`/`knightSide`/`knightBack`
 * all derive the subject `knight`. Returns `name` unchanged when no known suffix matches, so an
 * unsuffixed drawing is never accidentally grouped with anything but an exact-name match.
 */
const viewSubjectStem = (name: string): string => {
  for (const suffix of VIEW_SUFFIXES) {
    if (name.length > suffix.length && name.endsWith(suffix)) {
      return name.slice(0, -suffix.length)
    }
  }
  return name
}

/**
 * **C009-Plate-Blindheit, fixed** (was: docs/impl-progress.md "1c-followup C009-Plate-Blindheit").
 * {@link silhouetteSignature} signs a sprite's *full* covered mask — for an icon built on an
 * opaque plate/background tile (`icon-craft.md`'s mandatory build order), the covered mask
 * *is* the plate, so every glyph stamped onto it used to collapse to one signature regardless
 * of the glyph inside (`chat` vs `phone` both read as "plate", silhouette distance 0). {@link
 * detectPlateFigure} (below `signatureDistance`) detects the plate from pixel evidence alone —
 * never assumed from a `--as` profile — and, when found, signs only the *figure* subtracted
 * from it instead. A non-plate sprite (a character/item silhouette on transparent canvas) is
 * detected as such and signs its full covered mask exactly as before this fix.
 */

/**
 * How far a sibling's covered mass may deviate from the family median before
 * C011 flags it (a member ≥ this factor heavier *or* lighter than the median).
 * Set above the widest clean bundled set's spread — item sets legitimately mix a
 * ring and a greatsword — so parity stays an advisory nudge, not a false alarm.
 */
const PARITY_FACTOR = 6

/**
 * C014 landmark tolerance: a view's horizontal landmark may sit this far from the family median
 * before it reads as a misplaced part. `max(2, 3 % of the figure's height)` — measured against the
 * bundled RO chibis (skeleton/pose-built, so their views agree by construction): their worst
 * landmark spread is 4 px at 124 px tall, which the 3 % band (≈4 px) keeps silent, while the
 * defect class this exists for — a head/hat/prop that drifted between views, the wizard's 4–5 px
 * floating chin from the 2026-07-10 human review — clears it.
 */
const LANDMARK_TOLERANCE_FRACTION = 0.03
const LANDMARK_TOLERANCE_MIN = 2

/**
 * **Known limitation (docs/impl-progress.md "1c-followup C011-Margin"), advisory by design,
 * not fixed here.** C011 gates only *weight* (covered-pixel-count ratio vs. the family
 * median, below) — it does not separately gate *margin* parity (uniform breathing room
 * across siblings), which the original plan also named. Margin is not blind, though: each
 * member's `bbox` is already surfaced in `FamilyMetrics.members[].bbox`, so an agent (or a
 * future check) can derive a margin-consistency signal from the payload without a render. If
 * item sets need margin inconsistency actively flagged, add a dedicated advisory margin-ratio
 * check alongside this one — never fold it into the weight check, which measures mass, not
 * framing.
 */

/** The tight covered-content bounding box (or `null` for a fully transparent sprite). */
type CoverageBBox = CritiqueMetrics['bbox']

/**
 * Area-weighted box downsample of the covered mask over the `bx,by,bw,bh`
 * sub-rect into a `tw×th` fractional-coverage grid (each cell ∈ [0,1] = the
 * covered-area share of its source region). Handles both down- and up-scaling by
 * distributing every source pixel across the target cells it overlaps, weighted
 * by overlap area — the honest "fractional coverage" a nearest-neighbour
 * ({@link scaleBitmap}) resample cannot give.
 */
const resampleCoverage = (
  covered: Uint8Array,
  w: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  tw: number,
  th: number,
): Float64Array => {
  const acc = new Float64Array(tw * th)
  const wsum = new Float64Array(tw * th)
  const sx = tw / bw
  const sy = th / bh
  for (let py = 0; py < bh; py++) {
    const ty0 = py * sy
    const ty1 = ty0 + sy
    const gy0 = Math.floor(ty0)
    const gy1 = Math.min(th - 1, Math.ceil(ty1) - 1)
    for (let px = 0; px < bw; px++) {
      const v = covered[(by + py) * w + (bx + px)] ?? 0
      const tx0 = px * sx
      const tx1 = tx0 + sx
      const gx0 = Math.floor(tx0)
      const gx1 = Math.min(tw - 1, Math.ceil(tx1) - 1)
      for (let gy = gy0; gy <= gy1; gy++) {
        const oy = Math.min(ty1, gy + 1) - Math.max(ty0, gy)
        if (oy <= 0) {
          continue
        }
        for (let gx = gx0; gx <= gx1; gx++) {
          const ox = Math.min(tx1, gx + 1) - Math.max(tx0, gx)
          if (ox <= 0) {
            continue
          }
          const a = ox * oy
          const idx = gy * tw + gx
          acc[idx] = (acc[idx] ?? 0) + v * a
          wsum[idx] = (wsum[idx] ?? 0) + a
        }
      }
    }
  }
  const out = new Float64Array(tw * th)
  for (let i = 0; i < out.length; i++) {
    const ws = wsum[i] ?? 0
    out[i] = ws > 0 ? (acc[i] ?? 0) / ws : 0
  }
  return out
}

/**
 * The horizontal landmarks of a figure, read off its row-coverage profile (C014). All four are
 * **row indices**, never widths: a side view is legitimately narrower than a front view, but the
 * same figure's head, neck, shoulders and feet must sit at the same *heights* in every view.
 */
export type ViewLandmarks = {
  /** First covered row — the top of the head (or hat/helmet). */
  readonly top: number
  /** Last covered row — the ground contact. */
  readonly bottom: number
  /** Narrowest row in the upper 15–50 % band: the neck, below the head mass and above the shoulders. */
  readonly neck: number
  /** Steepest widening below the neck: the shoulder line. */
  readonly shoulder: number
}

/** Covered-pixel count per row — the profile every {@link viewLandmarks} reads from. */
const rowCoverage = (covered: Uint8Array, w: number, h: number): number[] => {
  const rows: number[] = new Array<number>(h).fill(0)
  for (let y = 0; y < h; y++) {
    let n = 0
    const base = y * w
    for (let x = 0; x < w; x++) {
      n += covered[base + x] ?? 0
    }
    rows[y] = n
  }
  return rows
}

/**
 * Derives a figure's {@link ViewLandmarks} from its coverage profile, or `null` when the sprite is
 * empty or too short for the bands to mean anything. Pure integer scanning — no thresholds beyond
 * "covered at all", so it does not care about colour, shading or style.
 */
export const viewLandmarks = (covered: Uint8Array, w: number, h: number): ViewLandmarks | null => {
  const rows = rowCoverage(covered, w, h)
  const top = rows.findIndex((n) => n > 0)
  if (top < 0) {
    return null
  }
  let bottom = h - 1
  while (bottom > top && (rows[bottom] ?? 0) === 0) {
    bottom--
  }
  const height = bottom - top
  if (height < 8) {
    return null // too short for a head/neck/shoulder band to be distinguishable
  }
  const lo = top + Math.round(height * 0.15)
  const hi = top + Math.round(height * 0.5)
  let neck = lo
  let neckWidth = Number.POSITIVE_INFINITY
  for (let y = lo; y <= hi; y++) {
    const n = rows[y] ?? 0
    if (n > 0 && n < neckWidth) {
      neckWidth = n
      neck = y
    }
  }
  let shoulder = neck
  let widest = 0
  const shoulderLimit = Math.min(bottom, neck + Math.round(height * 0.3))
  for (let y = neck; y < shoulderLimit; y++) {
    const delta = (rows[y + 1] ?? 0) - (rows[y] ?? 0)
    if (delta > widest) {
      widest = delta
      shoulder = y + 1
    }
  }
  return { top, bottom, neck, shoulder }
}

/** A scale-/position-invariant silhouette signature: 1024 fractional-coverage cells in [0,1]. */
export type SilhouetteSignature = Float64Array

/**
 * Scale- and position-invariant silhouette signature (ADR-0085 §3, C009 support):
 * crop the covered mask to its content bbox, box-resample it uniformly (aspect
 * preserved — a tall dagger and a wide sword stay distinct) to fit within the
 * fixed {@link SIGNATURE_GRID}×`SIGNATURE_GRID` grid, and center it. `null` for a
 * fully transparent sprite. Two renders of the same shape at different sizes or
 * canvas positions yield near-identical signatures; different shapes diverge.
 */
export const silhouetteSignature = (
  covered: Uint8Array,
  w: number,
  bbox: CoverageBBox,
): SilhouetteSignature | null => {
  if (!bbox) {
    return null
  }
  const g = SIGNATURE_GRID
  const scale = Math.min(g / bbox.width, g / bbox.height)
  const tw = Math.max(1, Math.min(g, Math.round(bbox.width * scale)))
  const th = Math.max(1, Math.min(g, Math.round(bbox.height * scale)))
  const cells = resampleCoverage(covered, w, bbox.x, bbox.y, bbox.width, bbox.height, tw, th)
  const sig = new Float64Array(g * g)
  const offX = Math.floor((g - tw) / 2)
  const offY = Math.floor((g - th) / 2)
  for (let cy = 0; cy < th; cy++) {
    for (let cx = 0; cx < tw; cx++) {
      sig[(offY + cy) * g + (offX + cx)] = cells[cy * tw + cx] ?? 0
    }
  }
  return sig
}

/**
 * Mass-normalized L1 distance ∈ [0,1] between two silhouette signatures — the
 * Sørensen form `Σ|a−b| / (Σa + Σb)`, so `0` = identical coverage and `1` =
 * disjoint. Normalizing by the coverage *mass* (not the 1024 cell count) keeps
 * the shared empty background from diluting the shape difference: a pair whose
 * masses overlap ≥88 % scores ≤0.12. `1` when either signature is absent (an
 * empty sprite) or both are empty.
 */
export const signatureDistance = (
  a: SilhouetteSignature | null,
  b: SilhouetteSignature | null,
): number => {
  if (!a || !b) {
    return 1
  }
  let diff = 0
  let mass = 0
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    diff += Math.abs(av - bv)
    mass += av + bv
  }
  return mass > 0 ? round4(diff / mass) : 1
}

// ── plate detection (C009-Plate-Blindheit fix) ────────────────────────────────

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

/** Euclidean OkLab distance — the same "perceptually nearest" metric {@link nearestColor} (color.ts) uses. */
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

/** Tight inclusive bbox of an arbitrary 0/1 mask (not necessarily the sprite's own covered mask); `null` when empty. */
const maskBBox = (mask: Uint8Array, w: number, h: number): CoverageBBox => {
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

/**
 * Detects a "plate" (an opaque background tile filling the canvas to its margin, per
 * `icon-craft.md`'s mandatory tile/plate build order) from pixel evidence alone — never assumed
 * from a `--as` profile — and returns the covered-mask subset that is genuinely the *figure* (the
 * glyph stamped onto the plate), for {@link silhouetteSignature} to sign instead of the raw
 * covered mask (the C009-Plate-Blindheit fix, see the doc comment above `viewSubjectStem`).
 *
 * Seeds a tolerant flood fill from every covered pixel within the {@link PLATE_EDGE_BAND_FRACTION}
 * canvas-edge band — the plate's own thin margin — growing through covered neighbours whose OkLab
 * distance from the just-accepted pixel is within {@link PLATE_STEP_TOLERANCE}. This is a *chained*
 * per-step tolerance (graph reachability over a fixed, symmetric edge predicate — deterministic
 * and order-independent, like {@link labelComponents}'s flood fill), not a single fixed reference
 * colour: it follows a shaded/gradient plate's own smooth colour drift all the way across the tile
 * while stopping cold at a genuinely different-coloured glyph, so an anti-aliased plate edge or a
 * shaded plate still counts as plate without ever bleeding into the silhouette it carries.
 *
 * A flood region counts as a plate only when **both** hold: (a) the seed band touches *all four*
 * canvas edges — a rectangular tile reaches every margin, where a framed character/item/icon
 * glyph (`icon-craft.md` §4 optical centering) reaches at most two — and (b) the grown region
 * covers ≥{@link PLATE_AREA_DOMINANCE_MIN} of the covered mass, so a thin border-only stroke (an
 * outlined character/item silhouette, which floods just its own outline) never qualifies. Both
 * conditions are load-bearing: several non-plate icons touch 2–3 edges without ever reaching
 * dominance, and a solid single-hue prop can flood to 100 % without ever touching all four edges.
 *
 * Returns `null` when no plate is detected (the common case) or when subtracting the detected
 * plate would leave fewer than {@link PLATE_MIN_FIGURE_FLOOR}px (a flat plate-only sprite with no
 * distinguishable glyph) — the caller falls back to the full covered mask, exactly as before this
 * fix.
 */
const detectPlateFigure = (
  sprite: Sprite,
  covered: Uint8Array,
): { readonly mask: Uint8Array; readonly bbox: CoverageBBox } | null => {
  const w = sprite.w
  const h = sprite.h
  let coveredCount = 0
  for (let p = 0; p < covered.length; p++) {
    coveredCount += covered[p] ?? 0
  }
  if (coveredCount === 0) {
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
  const figure = new Uint8Array(covered.length)
  let figureCount = 0
  for (let p = 0; p < covered.length; p++) {
    if (covered[p] === 1 && plate[p] === 0) {
      figure[p] = 1
      figureCount++
    }
  }
  if (figureCount < PLATE_MIN_FIGURE_FLOOR) {
    return null
  }
  const bbox = maskBBox(figure, w, h)
  return bbox ? { mask: figure, bbox } : null
}

/** One sibling's family facts: covered mass, content bbox, and nearest-silhouette neighbour. */
export type FamilyMember = {
  readonly name: string
  readonly coveredPixelCount: number
  readonly bbox: CoverageBBox
  readonly nearest: { readonly name: string; readonly distance: number } | null
}

/** The family-wide metric bundle carried in the CLI payload as `familyMetrics`. */
export type FamilyMetrics = {
  readonly members: readonly FamilyMember[]
  /** Full pairwise normalized-L1 silhouette-signature distance matrix; row/col order matches `members`. */
  readonly distanceMatrix: readonly (readonly number[])[]
  readonly medianCoveredPixelCount: number
}

/** A family finding (C009/C011): a standard {@link CritiqueCheck} plus the sibling `draw` it anchors to. */
export type FamilyCheck = CritiqueCheck & { readonly target: string }

/** {@link critiqueFamily}'s result: the family metric bundle plus the C009/C011 findings. */
export type FamilyReport = {
  readonly metrics: FamilyMetrics
  readonly checks: readonly FamilyCheck[]
}

/** Median of a numeric list (average of the two middles for an even count); `0` for empty. */
const medianOf = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}

/** The landmark rows C014 compares, with the wording each uses in its finding. */
const LANDMARK_LABELS: readonly { readonly key: keyof ViewLandmarks; readonly label: string }[] = [
  { key: 'top', label: 'head top' },
  { key: 'neck', label: 'neck' },
  { key: 'shoulder', label: 'shoulder line' },
  { key: 'bottom', label: 'ground contact' },
]

/**
 * **C014 — view landmark parity.** The same figure drawn front/side/back must place its head, neck,
 * shoulders and feet at the same *rows*; only its widths may change. A view whose landmark sits more
 * than {@link LANDMARK_TOLERANCE_FRACTION} of the figure height off the family median has a part
 * placed at the wrong height — the defect class human review kept finding and every pixel check kept
 * missing ("head floats above the neck", "hat sits too high", "shoulders pass through the cape").
 *
 * Compares only members that share a view-suffix-stripped stem (`knightFront`/`knightSide`/
 * `knightBack`), so two *different* characters in one family are never compared, and needs ≥2 views
 * of that stem. Advisory (`warning`) — a deliberate crouch or a hat worn only in one view is a
 * legitimate reason to differ, so this reports and explains rather than blocks.
 */
const viewLandmarkChecks = (
  facts: readonly {
    readonly name: string
    readonly landmarks: ViewLandmarks | null
    readonly height: number
  }[],
): FamilyCheck[] => {
  const groups = new Map<string, typeof facts>()
  for (const f of facts) {
    if (!f.landmarks) {
      continue
    }
    const stem = viewSubjectStem(f.name)
    if (stem === f.name) {
      continue // not a named view — nothing to compare it against
    }
    groups.set(stem, [...(groups.get(stem) ?? []), f])
  }
  const checks: FamilyCheck[] = []
  for (const [stem, views] of groups) {
    if (views.length < 2) {
      continue
    }
    const height = medianOf(views.map((v) => v.height))
    const tolerance = Math.max(
      LANDMARK_TOLERANCE_MIN,
      Math.round(height * LANDMARK_TOLERANCE_FRACTION),
    )
    for (const { key, label } of LANDMARK_LABELS) {
      const median = medianOf(views.map((v) => v.landmarks?.[key] ?? 0))
      for (const v of views) {
        const row = v.landmarks?.[key] ?? 0
        const offset = row - median
        if (Math.abs(offset) <= tolerance) {
          continue
        }
        checks.push({
          target: v.name,
          code: CRITIQUE_CODE.viewLandmarkParity,
          severity: 'warning',
          message: `view landmark parity: '${v.name}' puts its ${label} at row ${row}, ${Math.abs(offset)}px ${offset < 0 ? 'above' : 'below'} the '${stem}' views' median ${median} (tolerance ${tolerance})`,
          measured: Math.abs(offset),
          threshold: tolerance,
          fix: `move the part that sets '${v.name}'s ${label} by ${offset < 0 ? '+' : '-'}${Math.abs(offset)}px on y — or, better, build all views from one skeleton and a pose per view so the heights cannot drift`,
          detail: { row, median, tolerance },
        })
      }
    }
  }
  return checks
}

/**
 * Compares a group of sibling drawings (≥2) and returns the family findings:
 * C009 (sibling-silhouette collapse — a member whose nearest neighbour's
 * scale-/position-invariant 32×32 silhouette signature sits within
 * {@link COLLAPSE_DISTANCE}) and C011 (family weight parity — a member whose
 * covered mass deviates from the family median by more than
 * {@link PARITY_FACTOR}×). Returns `null` for fewer than two members (nothing to
 * compare). `strict` promotes C009 (a must-fix code) to `error`; C011 stays an
 * advisory `warning`. Each member's signature is signed off {@link detectPlateFigure}'s
 * figure mask when a plate is detected on that sprite, else off its full covered mask
 * (C009-Plate-Blindheit fix) — a non-plate character/item sprite is unaffected.
 */
export const critiqueFamily = (
  members: readonly { readonly name: string; readonly sprite: Sprite }[],
  options: CritiqueOptions = {},
): FamilyReport | null => {
  if (members.length < 2) {
    return null
  }
  const facts = members.map((m) => {
    const { covered, luminances } = scanCoverage(m.sprite)
    const metrics = computeCritiqueMetrics(m.sprite, luminances)
    const plateFigure = detectPlateFigure(m.sprite, covered)
    const signature = plateFigure
      ? silhouetteSignature(plateFigure.mask, m.sprite.w, plateFigure.bbox)
      : silhouetteSignature(covered, m.sprite.w, metrics.bbox)
    return {
      name: m.name,
      coveredPixelCount: metrics.coveredPixelCount,
      bbox: metrics.bbox,
      signature,
      landmarks: viewLandmarks(covered, m.sprite.w, m.sprite.h),
      height: metrics.bbox ? metrics.bbox.height : 0,
    }
  })
  const n = facts.length
  const flat = new Float64Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = signatureDistance(facts[i]?.signature ?? null, facts[j]?.signature ?? null)
      flat[i * n + j] = d
      flat[j * n + i] = d
    }
  }
  const distanceMatrix: number[][] = []
  const familyMembers: FamilyMember[] = []
  for (let i = 0; i < n; i++) {
    const fi = facts[i]
    const row: number[] = []
    let nearest: { name: string; distance: number } | null = null
    for (let j = 0; j < n; j++) {
      const d = flat[i * n + j] ?? 0
      row.push(d)
      const fj = facts[j]
      if (j !== i && fj && (nearest === null || d < nearest.distance)) {
        nearest = { name: fj.name, distance: d }
      }
    }
    distanceMatrix.push(row)
    if (fi) {
      familyMembers.push({
        name: fi.name,
        coveredPixelCount: fi.coveredPixelCount,
        bbox: fi.bbox,
        nearest,
      })
    }
  }
  const median = medianOf(facts.map((f) => f.coveredPixelCount))
  const checks: FamilyCheck[] = []
  // A `character` family's own front/side/back views are SUPPOSED to read as one silhouette
  // (character-DX 2026-07-10 rerun §5.2/§9.6/named contradiction) — C009 stays live for real
  // near-neighbour siblings (different characters/items in the same family) but never fires
  // between two views that share a view-suffix-stripped subject stem.
  const sameCharacterViews = options.profile?.name === 'character'
  for (const m of familyMembers) {
    const collapsesOwnView =
      sameCharacterViews &&
      m.nearest !== null &&
      viewSubjectStem(m.name) === viewSubjectStem(m.nearest.name)
    if (m.nearest && m.nearest.distance < COLLAPSE_DISTANCE && !collapsesOwnView) {
      checks.push({
        target: m.name,
        code: CRITIQUE_CODE.siblingCollapse,
        severity: 'warning',
        message: `silhouette collapse: '${m.name}' reads like sibling '${m.nearest.name}' (silhouette distance ${m.nearest.distance} < ${COLLAPSE_DISTANCE})`,
        measured: m.nearest.distance,
        threshold: COLLAPSE_DISTANCE,
        fix: `differentiate '${m.name}' vs '${m.nearest.name}' in silhouette (size, proportion, or profile), then re-check with sheet --png@4`,
        detail: {},
      })
    }
    if (median > 0 && m.coveredPixelCount > 0) {
      const ratio =
        m.coveredPixelCount >= median ? m.coveredPixelCount / median : median / m.coveredPixelCount
      if (ratio > PARITY_FACTOR) {
        checks.push({
          target: m.name,
          code: CRITIQUE_CODE.familyParity,
          severity: 'warning',
          message: `weight parity: '${m.name}' covers ${m.coveredPixelCount}px vs the family median ${median}px (${round4(ratio)}× off)`,
          measured: round4(ratio),
          threshold: PARITY_FACTOR,
          fix: `rescale '${m.name}' toward the family's visual mass, or split it into its own set — a lone giant/tiny sibling breaks set coherence`,
          detail: { coveredPixelCount: m.coveredPixelCount, medianCoveredPixelCount: median },
        })
      }
    }
  }
  if (sameCharacterViews) {
    checks.push(...viewLandmarkChecks(facts))
  }
  const finalChecks =
    (options.strict ?? false)
      ? checks.map((c) =>
          STRICT_MUST_FIX.includes(c.code) ? { ...c, severity: 'error' as const } : c,
        )
      : checks
  return {
    metrics: { members: familyMembers, distanceMatrix, medianCoveredPixelCount: median },
    checks: finalChecks,
  }
}

// ── vision rubric (phase 1c, ADR-0085 §6) ─────────────────────────────────────

/** One rubric prompt the agent must answer by *looking* — `pass:true` is necessary, not sufficient. */
export type RubricItem = {
  readonly id: string
  readonly when: string
  readonly ask: string
}

/** The vision rubric block: ordered silhouette-first render commands + category prompts. */
export type VisionRubric = {
  readonly renders: readonly string[]
  readonly items: readonly RubricItem[]
  readonly note: string
}

const RUBRIC_ITEMS: Record<CritiqueCategory, readonly RubricItem[]> = {
  icon: [
    {
      id: 'misread',
      when: 'at native @1',
      ask: 'With colour stripped (silhouette), does each glyph read as its intended concept? Run the mis-reading test — cover the name and identify it.',
    },
    {
      id: 'merge-trap',
      when: 'glyph meets plate or a neighbour',
      ask: 'Do any strokes merge into the plate or an adjacent glyph at @1? Add a 1px gap where they touch.',
    },
  ],
  character: [
    {
      id: 'seam-contact',
      when: 'assembled from parts',
      ask: 'On the silhouette, do all limbs read as one connected mass with contact — no visible seam or gap at the joints?',
    },
  ],
  item: [
    {
      id: 'pair-confusion',
      when: '≥2 siblings',
      ask: 'On the sheet, are the two most similar siblings distinct at a glance, or do their silhouettes read the same?',
    },
  ],
  scene: [
    {
      id: 'hero-contrast',
      when: 'has a focal subject',
      ask: 'Does the hero silhouette cross a contrast edge, or is it lost against a same-value background?',
    },
    {
      id: 'no-floating',
      when: 'objects rest on ground',
      ask: 'Is every object contact-grounded (shadow/AO), with nothing floating?',
    },
    {
      id: 'one-light',
      when: 'always',
      ask: 'Does exactly one light direction drive every shadow and highlight?',
    },
  ],
}

const AGNOSTIC_RUBRIC_ITEMS: readonly RubricItem[] = [
  {
    id: 'silhouette',
    when: 'always',
    ask: 'Does the silhouette read as the intended subject with colour stripped?',
  },
  {
    id: 'centering',
    when: 'framed (transparent-margin) sprite',
    ask: 'Is the subject optically centered (bbox parity) with even margins?',
  },
]

/**
 * Builds the vision rubric (ADR-0085 §6): an ordered, silhouette-first list of
 * render commands over `sample` (a representative drawing) plus the family
 * `sheet`, and the category-specific prompts the agent must answer by looking.
 * Automatic `pass:true` is necessary, not sufficient — the rubric is the part
 * that still needs eyes.
 */
export const buildRubric = (
  profile: CritiqueProfile | null,
  file: string,
  sample: string | null,
  hasFamily: boolean,
): VisionRubric => {
  const renders: string[] = []
  if (sample) {
    renders.push(
      `render ${file}#${sample} --silhouette --png@6`,
      `render ${file}#${sample} --ascii --fit 64x64`,
      `render ${file}#${sample} --png@4`,
    )
  }
  if (hasFamily) {
    renders.push(`sheet ${file} --png@4`)
  }
  return {
    renders,
    items: profile ? RUBRIC_ITEMS[profile.name] : AGNOSTIC_RUBRIC_ITEMS,
    note: 'critique pass:true is necessary, not sufficient — answer every rubric item by looking at the renders above before calling it done.',
  }
}
