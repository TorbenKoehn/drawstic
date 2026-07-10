// `critique` metric engine + `C0xx` check catalog (ADR-0085): pixel-based,
// vision-free quality assertions over a rendered sprite. Every finding pairs a
// standard `Diagnostic` (anchored at the `draw` span) with a `{measured,
// threshold, fix}` payload — auditable and teachable, never a bare pass/fail.
//
// Phase 1a scope: the cheap, vision-free checks that need only a single metric
// bundle computed once from the framebuffer — C001 (empty/near-empty), C003
// (optical centering), C004 (value/contrast spread), C006 (palette/complexity
// budget), C008 (pinholes), C012 (dynamic transparent trailing edge row). The
// component/silhouette checks (C002/C005/C007/C009/C011) and `--as` profiles
// arrive in 1b/1c. Metric computation reuses `inspectSprite` (src/inspect.ts),
// `spritePreviewStats` (src/preview.ts) and `relativeLuminance` (src/color.ts):
// no metric is computed twice.

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
  paletteBudget: 'C006',
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

/** Rounds a fraction to 4 decimal places (matches inspect.ts' round4 convention). */
const round4 = (v: number): number => Math.round(v * 10000) / 10000

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

/** One drawing's critique report: its metric bundle plus the checks that fired. */
export type CritiqueDrawing = CritiqueMetrics & {
  readonly name: string
  readonly checks: readonly CritiqueCheck[]
}

/** The whole-file critique report carried in the CLI payload. */
export type CritiqueReport = {
  readonly pass: boolean
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

/** C006: palette/complexity budget — flags distinct colours over the generous default ceiling. */
const checkPaletteBudget = (metrics: CritiqueMetrics): CritiqueCheck | null => {
  if (metrics.distinctColorCount <= DEFAULT_COLOR_CEILING) {
    return null
  }
  return {
    code: CRITIQUE_CODE.paletteBudget,
    severity: 'warning',
    message: `palette budget: ${metrics.distinctColorCount} distinct colors exceeds ${DEFAULT_COLOR_CEILING}`,
    measured: metrics.distinctColorCount,
    threshold: DEFAULT_COLOR_CEILING,
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

/**
 * Runs the phase-1a check catalog against one rendered sprite and returns its
 * {@link CritiqueDrawing} report (metric bundle + fired checks). Pure and
 * vision-free — the same sprite always yields the same report.
 */
export const critiqueSprite = (name: string, sprite: Sprite): CritiqueDrawing => {
  const { luminances } = scanCoverage(sprite)
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
  push(checkPaletteBudget(metrics))
  push(checkPinholes(sprite))
  push(checkTrailingEdgeRow(metrics))
  return { name, ...metrics, checks }
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
