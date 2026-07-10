// Declarative light + material lowering (ADR-0086). Internal machinery only — no parser/eval
// bindings yet (that is phase 2c). This module is the *encoding unification*: the single `Light`
// value is converted, per region, into whatever shape each raster shading primitive needs — a
// point (`shadeRegion`/`lightRegion`), a direction (`rim`), or a `dx:dy` offset (cast shadow) —
// so a shade veil, a rim, and a cast shadow driven by one light stay coherent *structurally*,
// not by author discipline. `lowerMaterial` expands a `Material` under a `Light` onto the fixed,
// craft-correct primitive sequence (fill → shadeRegion → lightRegion → rim → ambientOcclusion →
// cast), reading the baked per-response dose profiles distilled from scene-craft §5. The plan it
// returns is inspectable so phase 2c can print it for `render --explain`.

import { type Color, color, desaturate, litTone, shadowTone, withAlpha } from './color.js'
import { dhypot, roundHalfUp } from './dmath.js'
import {
  ambientOcclusion,
  type Context,
  fillRegion,
  lightRegion,
  rimRegion,
  shadeRegion,
} from './raster.js'
import {
  invertMatrix,
  type Light,
  type Material,
  type MaterialResponse,
  type Region,
  regionSubtract,
  regionTransform,
  translation,
  unitVec,
} from './values.js'

/** A 2D vector — the common currency of every encoding this module produces. */
export type Vec2 = { readonly x: number; readonly y: number }

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** ADR-0086's canonical cool ambient (`#2a3a5e`); the fallback shadow hue when a light has no `amb`. */
const DEFAULT_COOL: Color = color(42, 58, 94)

/** The auto contact-shadow alpha (ADR-0087) — a soft 30 % cool pool under a fitted part's footprint. */
const CONTACT_SHADOW_ALPHA = 0.3

/**
 * The colour of the auto contact-shadow ellipse a `fit … shadow` drops under a part's footprint
 * (ADR-0087). Cool and semi-transparent — the light's ambient/`amb` colour when present, else the
 * canonical {@link DEFAULT_COOL} — so a fitted part reads as *grounded*, never floating, with a
 * hue that stays coherent with the same light that shades it. Deterministic; independent of the
 * light's direction (a contact pool sits under the object, not off to one side).
 */
export const contactShadowColor = (lt: Light | null): Color =>
  withAlpha(lt?.amb?.color ?? DEFAULT_COOL, CONTACT_SHADOW_ALPHA)

// ── geometry helpers ────────────────────────────────────────────────────────

/** The region bbox centre (canvas coords); `(0, 0)` for a bbox-less region. */
export const regionCenter = (region: Region): Vec2 => {
  const b = region.bbox
  if (!b) {
    return { x: 0, y: 0 }
  }
  return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 }
}

/** The region bbox diagonal length in pixels (`≥1`); the scale for a synthetic light distance. */
export const regionDiagonal = (region: Region): number => {
  const b = region.bbox
  if (!b) {
    return 1
  }
  return Math.max(1, dhypot(b.x1 - b.x0, b.y1 - b.y0))
}

// ── encoding unification: one Light → point / direction / offset ─────────────

/**
 * The point `shadeRegion`/`lightRegion` need. For a point light (`pos` set) it *is* `pos`. For a
 * directional light it is a synthetic up-source placed opposite the travel direction — the region
 * centre pulled back by twice the region diagonal along `−dir` — so the near (lit) side reads low
 * distance and the far side reads high distance, exactly matching the light's direction.
 */
export const lightPointFor = (region: Region, l: Light): Vec2 => {
  if (l.pos) {
    return l.pos
  }
  const c = regionCenter(region)
  const d = 2 * regionDiagonal(region)
  return { x: c.x - l.dir.x * d, y: c.y - l.dir.y * d }
}

/**
 * The direction `rim` needs — the light's travel direction *at* this region. Verbatim `dir` for a
 * directional light; for a point light it is derived from the source toward the region centre
 * (`normalize(centre − pos)`), which is what makes a point light's rim face it correctly.
 */
export const lightDirOf = (l: Light, region?: Region): Vec2 => {
  if (l.pos && region) {
    const c = regionCenter(region)
    return unitVec(c.x - l.pos.x, c.y - l.pos.y)
  }
  return l.dir
}

/**
 * The integer `dx:dy` offset a cast shadow needs: the travel direction (per region) scaled by
 * `len` and rounded. `dir 1:1` therefore casts down-right — the same side `shadeRegion` darkens,
 * so shade and cast never disagree.
 */
export const shadowOffsetFor = (
  region: Region,
  l: Light,
  len: number,
): { readonly dx: number; readonly dy: number } => {
  const d = lightDirOf(l, region)
  return { dx: roundHalfUp(d.x * len), dy: roundHalfUp(d.y * len) }
}

// ── baked dose profiles (scene-craft §5 → material defaults) ─────────────────

/**
 * A response's baked shading doses (ADR-0086 §1). `shade`/`hi` are veil amounts, `rim` scales
 * the rim colour's alpha, `ao` the seat-edge darkening, `cast` the cast-shadow alpha; `self`
 * marks a self-illuminated response (`glow`) that brightens only its own region and takes no
 * directional shade, rim, ao, or cast. Amounts are calibrated to scene-craft §5's dosage table.
 */
type Dose = {
  readonly shade: number
  readonly hi: number
  readonly rim: number
  readonly ao: number
  readonly cast: number
  readonly self: boolean
}

const DOSE: Record<MaterialResponse, Dose> = {
  flat: { shade: 0.35, hi: 0.08, rim: 0, ao: 0.15, cast: 0, self: false },
  metal: { shade: 0.5, hi: 0.22, rim: 0.6, ao: 0.28, cast: 0.25, self: false },
  skin: { shade: 0.4, hi: 0.16, rim: 0.32, ao: 0.22, cast: 0.2, self: false },
  cloth: { shade: 0.45, hi: 0.1, rim: 0.18, ao: 0.3, cast: 0.2, self: false },
  glass: { shade: 0.22, hi: 0.3, rim: 0.7, ao: 0.1, cast: 0.15, self: false },
  glow: { shade: 0, hi: 0.45, rim: 0, ao: 0, cast: 0, self: true },
}

/** Tone depths for the veils/edges the doses paint (fixed; the dose controls *how much* reaches). */
const SHADE_TONE_DEPTH = 0.55
const HI_TONE_LIFT = 0.6
const RIM_TONE_LIFT = 0.7
const RIM_DESAT = 0.25
const AO_TONE_DEPTH = 0.5
const CAST_TONE_DEPTH = 0.6
/** Rim width scales with region width (scene-craft §5: "1px per w", ≥~1% to register). */
const RIM_WIDTH_FRAC = 0.03
const RIM_WIDTH_MAX = 4
/** Cast reach as a fraction of the region's shorter side. */
const CAST_LEN_FRAC = 0.2

/** Effective dose for a field: material override when present, else the response default; ×gain. */
const doseOf = (base: number, override: number | undefined, gain: number): number =>
  clamp01((override ?? base) * gain)

/** Rim pixel width from the region's bbox width (clamped ≥1, ≤{@link RIM_WIDTH_MAX}). */
const rimWidthFor = (region: Region): number => {
  const b = region.bbox
  const w = b ? b.x1 - b.x0 : 0
  return Math.max(1, Math.min(RIM_WIDTH_MAX, roundHalfUp(w * RIM_WIDTH_FRAC)))
}

/** Cast reach in pixels from the region's shorter bbox side. */
const castLenFor = (region: Region): number => {
  const b = region.bbox
  if (!b) {
    return 1
  }
  return Math.max(1, roundHalfUp(Math.min(b.x1 - b.x0, b.y1 - b.y0) * CAST_LEN_FRAC))
}

// ── the lowering: Material × Light → primitive sequence ──────────────────────

/**
 * One step of a lowered material — the inspectable expansion `render --explain` (phase 2c) will
 * print. Each carries the exact primitive it drives and every already-resolved argument, so the
 * trace fully determines the render.
 */
export type ShadeOp =
  | { readonly kind: 'fill'; readonly color: Color }
  | { readonly kind: 'shade'; readonly point: Vec2; readonly color: Color; readonly amount: number }
  | { readonly kind: 'light'; readonly point: Vec2; readonly color: Color; readonly amount: number }
  | { readonly kind: 'rim'; readonly dir: Vec2; readonly color: Color; readonly width: number }
  | { readonly kind: 'ao'; readonly color: Color; readonly amount: number }
  | {
      readonly kind: 'cast'
      readonly offset: { readonly dx: number; readonly dy: number }
      readonly color: Color
    }

/**
 * Plan the primitive sequence for `mat` under `lt` on `region` — pure and deterministic, no
 * drawing. Steps whose effective dose is zero are omitted. Tones come from the ADR-0086 colour
 * helpers: highlights via `litTone` toward the light colour (warm, never chalky `lighten`),
 * shadows/AO via `shadowTone` with its capped cool nudge (no magenta drift). A `glow` (self)
 * response yields only a fill and a self-light centred on the region — it never darkens, rims, or
 * casts, and (because this only ever touches `region`) never lights a neighbour.
 */
export const planMaterial = (region: Region, mat: Material, lt: Light): ShadeOp[] => {
  const gain = lt.gain
  const warm = lt.color
  const cool = lt.amb?.color ?? DEFAULT_COOL
  const dose = DOSE[mat.response]
  const ops: ShadeOp[] = [{ kind: 'fill', color: mat.base }]

  if (dose.self) {
    const hi = doseOf(dose.hi, mat.hi, gain)
    if (hi > 0) {
      // self-illuminated: brightest at the region's own centre, dimming outward (a glowing core).
      ops.push({
        kind: 'light',
        point: regionCenter(region),
        color: litTone(mat.base, warm, HI_TONE_LIFT),
        amount: hi,
      })
    }
    return ops
  }

  const point = lightPointFor(region, lt)
  // ambient fill lifts shadows (never pure black), so it shallows the shade veil a touch.
  const ambLift = lt.amb ? 1 - clamp01(lt.amb.amount) * 0.4 : 1
  const shade = clamp01(doseOf(dose.shade, mat.shade, gain) * ambLift)
  if (shade > 0) {
    ops.push({
      kind: 'shade',
      point,
      color: shadowTone(mat.base, cool, SHADE_TONE_DEPTH),
      amount: shade,
    })
  }
  const hi = doseOf(dose.hi, mat.hi, gain)
  if (hi > 0) {
    ops.push({ kind: 'light', point, color: litTone(mat.base, warm, HI_TONE_LIFT), amount: hi })
  }
  const rim = doseOf(dose.rim, mat.rim, gain)
  if (rim > 0) {
    ops.push({
      kind: 'rim',
      dir: lightDirOf(lt, region),
      color: withAlpha(desaturate(litTone(mat.base, warm, RIM_TONE_LIFT), RIM_DESAT), rim),
      width: rimWidthFor(region),
    })
  }
  const ao = doseOf(dose.ao, mat.ao, gain)
  if (ao > 0) {
    ops.push({ kind: 'ao', color: shadowTone(mat.base, cool, AO_TONE_DEPTH), amount: ao })
  }
  const cast = clamp01(dose.cast * gain)
  if (cast > 0) {
    const offset = shadowOffsetFor(region, lt, castLenFor(region))
    if (offset.dx !== 0 || offset.dy !== 0) {
      ops.push({
        kind: 'cast',
        offset,
        color: withAlpha(shadowTone(mat.base, cool, CAST_TONE_DEPTH), cast),
      })
    }
  }
  return ops
}

/**
 * Paint a cast-shadow band: the region's silhouette offset by `offset`, minus the region itself, so
 * it lands only in the surrounding margin and never over its own region. The band *can* fall on a
 * neighbour region drawn earlier in the same `draw` — a deliberate, deterministic down-light cast
 * (draw ground/back-to-front). Assembled `fit`/`stamp` figures avoid this entirely: each part is a
 * separate draw rendered in isolation, so a part's cast is baked into its own margin and only ever
 * meets a neighbour via ordinary source-over at assembly (ADR-0086/0087; language-spec § Light &
 * material).
 */
const castBand = (
  ctx: Context,
  region: Region,
  offset: { readonly dx: number; readonly dy: number },
  paint: Color,
): void => {
  const m = translation(offset.dx, offset.dy)
  const inv = invertMatrix(m)
  if (!inv) {
    return
  }
  const shifted = regionTransform(region, m, inv)
  fillRegion(ctx, regionSubtract(shifted, region), paint)
}

/** Execute a single planned op against the raster primitives. */
const executeOp = (ctx: Context, region: Region, op: ShadeOp): void => {
  switch (op.kind) {
    case 'fill':
      fillRegion(ctx, region, op.color)
      return
    case 'shade':
      shadeRegion(ctx, region, op.point, op.color, op.amount)
      return
    case 'light':
      lightRegion(ctx, region, op.point, op.color, op.amount)
      return
    case 'rim':
      rimRegion(ctx, region, op.dir, op.color, op.width)
      return
    case 'ao':
      ambientOcclusion(ctx, region, op.color, op.amount)
      return
    case 'cast':
      castBand(ctx, region, op.offset, op.color)
      return
  }
}

/**
 * Lower `mat` under `lt` onto `region`: plan the primitive sequence and execute it in order,
 * returning the plan (for inspection / `render --explain`). All coordinate/direction/offset
 * encodings are derived from the one `Light`, so the shade, rim, and cast can never drift apart.
 */
export const lowerMaterial = (
  ctx: Context,
  region: Region,
  mat: Material,
  lt: Light,
): ShadeOp[] => {
  const ops = planMaterial(region, mat, lt)
  for (const op of ops) {
    executeOp(ctx, region, op)
  }
  return ops
}
