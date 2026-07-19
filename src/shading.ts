// Declarative light + material lowering (ADR-0086, ADR-0089). This module is the *encoding
// unification*: the single `Light` value is converted, per region, into whatever shape each raster
// shading primitive needs — a point (`shadeRegion`/`lightRegion`), a direction (`rim`/form normals),
// or a `dx:dy` offset (cast shadow) — so a body shade, a rim, and a cast shadow driven by one light
// stay coherent *structurally*, not by author discipline. `lowerMaterial` expands a `Material` under
// a `Light` onto the craft-correct sequence: the **form (normal-based) body shade** (ADR-0089, the
// smooth default that follows surface curvature) → rim → ambientOcclusion → cast, reading the baked
// per-response dose profiles distilled from scene-craft §5. `lowerCel` renders the same body as
// crisp N-band cel. The plan each returns is inspectable so eval can print it for `render --explain`.

import { type Color, color, desaturate, litTone, shadowTone, withAlpha } from './color.js'
import { dhypot, roundHalfUp } from './dmath.js'
import {
  ambientOcclusion,
  type Context,
  type FormSpec,
  fillRegion,
  formShade,
  lightRegion,
  rimRegion,
  shadeRegion,
  type Vec3,
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
 * A response's baked shading doses (ADR-0086 §1, ADR-0091). `shade`/`hi` are veil amounts, `rim`
 * scales the rim colour's alpha, `ao` the seat-edge darkening, `cast` the cast-shadow alpha; `spec`
 * is the Blinn specular dose (how much a tight hotspot lifts toward the light colour) and `specPow`
 * its exponent (higher ⇒ tighter, glossier); `puff` is the surface-curvature gain of the Poisson
 * height field (higher ⇒ rounder form); `self` marks a self-illuminated response (`glow`) that
 * brightens only its own region and takes no directional shade, rim, ao, cast, or specular. Amounts
 * are calibrated to scene-craft §5's dosage table + the ADR-0091 golden-probe pass.
 */
type Dose = {
  readonly shade: number
  readonly hi: number
  readonly rim: number
  readonly ao: number
  readonly cast: number
  readonly spec: number
  readonly specPow: number
  readonly puff: number
  readonly self: boolean
}

const DOSE: Record<MaterialResponse, Dose> = {
  flat: {
    shade: 0.35,
    hi: 0.08,
    rim: 0,
    ao: 0.15,
    cast: 0,
    spec: 0,
    specPow: 8,
    puff: 1.5,
    self: false,
  },
  metal: {
    shade: 0.5,
    hi: 0.3,
    rim: 0.6,
    ao: 0.28,
    cast: 0.25,
    spec: 0.5,
    specPow: 16,
    puff: 1.5,
    self: false,
  },
  skin: {
    shade: 0.4,
    hi: 0.16,
    rim: 0.32,
    ao: 0.22,
    cast: 0.2,
    spec: 0.08,
    specPow: 4,
    puff: 1.5,
    self: false,
  },
  cloth: {
    shade: 0.45,
    hi: 0.1,
    rim: 0.18,
    ao: 0.3,
    cast: 0.2,
    spec: 0,
    specPow: 8,
    puff: 1.125,
    self: false,
  },
  glass: {
    shade: 0.22,
    hi: 0.3,
    rim: 0.7,
    ao: 0.1,
    cast: 0.15,
    spec: 0.6,
    specPow: 24,
    puff: 1.5,
    self: false,
  },
  glow: { shade: 0, hi: 0.45, rim: 0, ao: 0, cast: 0, spec: 0, specPow: 8, puff: 1.5, self: true },
}

/** Tone depths for the edges/glow the doses paint (fixed; the dose controls *how much* reaches). */
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

// ── form-shading parameters (ADR-0089) ───────────────────────────────────────
/**
 * The light's out-of-plane elevation `z` for form shading — how much the source sits *in front of*
 * the surface vs. off to the side. Lower ⇒ more grazing ⇒ more of the form falls into shadow; this
 * value keeps a directional light reading as a top/side key with a broad lit face and a soft
 * terminator, not a flat frontal wash.
 */
const LIGHT_ELEVATION = 0.55
/** Shadow floor when a light carries no `amb` — shadows keep this lit fraction, never pure black. */
const DEFAULT_AMBIENT = 0.2

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
  | { readonly kind: 'form'; readonly spec: FormSpec; readonly field?: Region }
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
 * The unit *toward-light* 3D vector form shading dots each surface normal against (ADR-0089): the
 * light's in-plane travel direction *negated* (so it points back at the source, the lit side) plus a
 * fixed out-of-plane {@link LIGHT_ELEVATION} `z`. A point light's in-plane direction is derived
 * per-region (source → centre) exactly as `rim` does, so form, rim, and cast still read one source.
 */
export const lightVec3 = (lt: Light, region: Region): Vec3 => {
  const travel = lightDirOf(lt, region)
  const x = -travel.x
  const y = -travel.y
  const z = LIGHT_ELEVATION
  const len = Math.sqrt(x * x + y * y + z * z)
  return { x: x / len, y: y / len, z: z / len }
}

/**
 * Resolve a {@link FormSpec} for `mat` under `lt` on `region` (ADR-0089): the shared plan for both
 * the smooth `model` body (`bands = null`) and the crisp `cel` body (`bands = N`). `shade`/`hi` are
 * the response's baked doses (material-overridable, ×gain) reused as the max shadow / highlight mix
 * amounts; `warm`/`cool` and the `ambient` floor come from the light — so `cel` is exactly `model`'s
 * body quantized, never a divergent second look.
 */
export const formSpecOf = (
  region: Region,
  mat: Material,
  lt: Light,
  bands: number | null,
): FormSpec => {
  const gain = lt.gain
  const dose = DOSE[mat.response]
  // `spread` scales highlight + shadow symmetrically — the one-knob value-spread control (ADR-0091)
  // that replaces the hand `.intersect(rect)+litTone/shadowTone` value patches.
  const spread = mat.spread ?? 1
  return {
    base: mat.base,
    warm: lt.color,
    cool: lt.amb?.color ?? DEFAULT_COOL,
    light: lightVec3(lt, region),
    shade: clamp01(doseOf(dose.shade, mat.shade, gain) * spread),
    hi: clamp01(doseOf(dose.hi, mat.hi, gain) * spread),
    spec: clamp01(mat.spec ?? dose.spec),
    specPow: Math.max(1, dose.specPow),
    puff: Math.max(0, mat.puff ?? dose.puff),
    ambient: clamp01(lt.amb ? lt.amb.amount : DEFAULT_AMBIENT),
    bands,
    profile: mat.profile ?? 'round',
  }
}

/**
 * Plan the primitive sequence for `mat` under `lt` on `region` — pure and deterministic, no
 * drawing (ADR-0089). The body is a single **form (normal-based) shade** — the smooth, surface-
 * curvature-following default that replaced the old form-ignoring `shade`/`light` distance veils —
 * followed by the unchanged `rim` → `ao` → `cast` edge steps (each skipped at zero dose). Edge tones
 * come from the ADR-0086 colour helpers: `litTone` toward the light colour for the warm rim,
 * `shadowTone` with its capped cool nudge (no magenta drift) for AO/cast. A `glow` (self) response
 * yields only a fill and a self-light centred on the region — it never darkens, rims, or casts, and
 * (because this only ever touches `region`) never lights a neighbour.
 */
export const planMaterial = (
  region: Region,
  mat: Material,
  lt: Light,
  field?: Region,
): ShadeOp[] => {
  const gain = lt.gain
  const warm = lt.color
  const cool = lt.amb?.color ?? DEFAULT_COOL
  const dose = DOSE[mat.response]

  if (dose.self) {
    const ops: ShadeOp[] = [{ kind: 'fill', color: mat.base }]
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

  // the body: form-based smooth shading (bands = null), following the surface normal, not a ramp.
  // `field` (an `over` union) co-shades this part on a larger surface; absent, the field is `region`.
  const ops: ShadeOp[] = [
    { kind: 'form', spec: formSpecOf(field ?? region, mat, lt, null), ...(field ? { field } : {}) },
  ]
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
 * Paint a cast-shadow band: the region's silhouette offset by `offset`, minus the region itself,
 * **clipped to pixels the buffer already covers** (`alpha > 0`). A cast lands on a neighbour region
 * drawn earlier in the same `draw` — a deliberate, deterministic down-light cast (draw
 * ground/back-to-front) — but never on transparent canvas, so a large edge-near region (a cape, a
 * robe) can no longer bake a detached grey blob into its own empty margin (character-DX §5.14). An
 * assembled `fit`/`stamp` part renders in isolation with nothing behind it, so its cast paints
 * nothing at model time; grounding for assembled figures comes from `fit … shadow` instead
 * (ADR-0086/0087; language-spec § Light & material).
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
  const band = regionSubtract(shifted, region)
  const onContent: Region = {
    type: 'region',
    bbox: band.bbox,
    has: (x, y) => band.has(x, y) && ctx.buffer.alphaAt(x, y) > 0,
    test: (fx, fy) => band.test(fx, fy) && ctx.buffer.alphaAt(roundHalfUp(fx), roundHalfUp(fy)) > 0,
  }
  fillRegion(ctx, onContent, paint)
}

/** Execute a single planned op against the raster primitives. */
const executeOp = (ctx: Context, region: Region, op: ShadeOp): void => {
  switch (op.kind) {
    case 'fill':
      fillRegion(ctx, region, op.color)
      return
    case 'form':
      formShade(ctx, region, op.spec, op.field ?? region)
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
  field?: Region,
): ShadeOp[] => {
  const ops = planMaterial(region, mat, lt, field)
  for (const op of ops) {
    executeOp(ctx, region, op)
  }
  return ops
}

/**
 * Lower `mat` under `lt` onto `region` as a crisp **`N`-band cel** (ADR-0089): the very same
 * form-based body as {@link lowerMaterial}, quantized into `N` clean bands that follow the surface
 * normal (`floor(N) ≥ 1`), instead of `model`'s smooth terminator. Cel is therefore the opt-in
 * stylization and smooth is the default — and because both share {@link formSpecOf}, the bands land
 * exactly where the smooth shade would, never a divergent second look. Returns the single-`form`
 * plan for `render --explain`. No rim/AO/cast: cel is the banded body only.
 */
export const lowerCel = (
  ctx: Context,
  region: Region,
  mat: Material,
  lt: Light,
  n: number,
  field?: Region,
): ShadeOp[] => {
  const op: ShadeOp = {
    kind: 'form',
    spec: formSpecOf(field ?? region, mat, lt, Math.max(1, n)),
    ...(field ? { field } : {}),
  }
  executeOp(ctx, region, op)
  return [op]
}
