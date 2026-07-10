// First-class colors & the pinned color pipeline (spec §12, ADR-0009,
// ADR-0027): exact oklch↔sRGB matrices, fixed gamut mapping (16-step chroma
// bisection), shorter-arc hue interpolation, 8-bit round-half-up commit.
// All transcendentals come from the bundled math (dmath.ts).

import { datan2, dcbrt, dcosDeg, dhypot, dpow, dsinDeg, PI, roundHalfUp } from './dmath.js'

/** A committed color: 8-bit straight-alpha sRGB. */
export type Color = {
  readonly type: 'color'
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/**
 * The 8-bit sRGB constructor: channels round-half-up and clamp to [0, 255]; alpha defaults to
 * opaque.
 */
export const color = (r: number, g: number, b: number, a = 255): Color => ({
  type: 'color',
  r: clamp8(r),
  g: clamp8(g),
  b: clamp8(b),
  a: clamp8(a),
})

/** The zero color: fully transparent black. */
export const TRANSPARENT: Color = Object.freeze({ type: 'color', r: 0, g: 0, b: 0, a: 0 })

const clamp8 = (v: number): number => Math.max(0, Math.min(255, roundHalfUp(v)))
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/**
 * Parse '#rgb' / '#rgba' / '#rrggbb' / '#rrggbbaa' (leading '#' optional); null on any other length or non-hex input.
 */
export const parseHexColor = (hex: string): Color | null => {
  const h = hex.startsWith('#') ? hex.slice(1) : hex
  const d = (c: string): number => Number.parseInt(c, 16)
  if (!/^[0-9a-fA-F]+$/.test(h)) {
    return null
  }
  if (h.length === 3) {
    return color(d(h[0] ?? '') * 17, d(h[1] ?? '') * 17, d(h[2] ?? '') * 17)
  }
  if (h.length === 4) {
    return color(d(h[0] ?? '') * 17, d(h[1] ?? '') * 17, d(h[2] ?? '') * 17, d(h[3] ?? '') * 17)
  }
  if (h.length === 6) {
    return color(
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    )
  }
  if (h.length === 8) {
    return color(
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
      Number.parseInt(h.slice(6, 8), 16),
    )
  }
  return null
}

/** Inverse of parseHexColor: '#rrggbb', or '#rrggbbaa' when alpha is not fully opaque. */
export const toHexColor = (c: Color): string => {
  const p = (v: number): string => v.toString(16).padStart(2, '0')
  return c.a === 255 ? `#${p(c.r)}${p(c.g)}${p(c.b)}` : `#${p(c.r)}${p(c.g)}${p(c.b)}${p(c.a)}`
}

// ── sRGB transfer function (pinned constants, bundled pow) ─────────────────

/** The sRGB EOTF: gamma-encoded channel [0,1] → linear-light [0,1] (pinned constants, ADR-0027). */
const srgbToLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : dpow((v + 0.055) / 1.055, 2.4)
/** Inverse sRGB EOTF: linear-light [0,1] → gamma-encoded [0,1]. */
const linearToSrgb = (v: number): number =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * dpow(v, 1 / 2.4) - 0.055

/**
 * WCAG-style relative luminance (`0.2126 R + 0.7152 G + 0.0722 B` on
 * gamma-decoded, linear-light channels) of a committed straight-alpha color —
 * 0 for black or fully transparent, 1 for opaque white. Alpha-composited over
 * an implied black backdrop (the dark terminal a luminance-mapped preview
 * reads against), not over white/paper. `r`/`g`/`b`/`a` are the committed
 * 0..255 range. Backs `preview.ts`'s `--ascii` ramp so glyph density tracks
 * how bright a pixel actually reads, not merely whether it has ink.
 */
export const relativeLuminance = (r: number, g: number, b: number, a: number): number => {
  const alpha = a / 255
  if (alpha === 0) {
    return 0
  }
  const lr = srgbToLinear((r / 255) * alpha)
  const lg = srgbToLinear((g / 255) * alpha)
  const lb = srgbToLinear((b / 255) * alpha)
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

// ── OkLab / OkLCh (fixed matrices) ──────────────────────────────────────────

/**
 * OkLCh color: l (lightness) roughly [0,1], c (chroma) >= 0 and unbounded (~0..0.4 for
 * in-gamut sRGB), h (hue) in degrees [0,360), alpha in [0,1] — unlike Color.a, which is 0..255.
 */
export type Oklch = {
  readonly l: number
  readonly c: number
  readonly h: number
  readonly alpha: number
}

/**
 * Gamma-encoded sRGB [0,1] → OkLab, via linearization and the fixed LMS↔OkLab matrices (ADR-0027).
 */
const rgbToOklab = (
  r: number,
  g: number,
  b: number,
): { readonly l: number; readonly a: number; readonly b: number } => {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const l = dcbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = dcbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = dcbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/**
 * OkLab → linear-light sRGB (0..1, not gamma-encoded); may fall outside [0,1] when out of gamut.
 */
const oklabToLinear = (
  lightness: number,
  a: number,
  b: number,
): { readonly r: number; readonly g: number; readonly b: number } => {
  const l_ = lightness + 0.3963377774 * a + 0.2158037573 * b
  const m_ = lightness - 0.1055613458 * a - 0.0638541728 * b
  const s_ = lightness - 0.0894841775 * a - 1.291485548 * b
  const l = l_ * l_ * l_
  const m = m_ * m_ * m_
  const s = s_ * s_ * s_
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  }
}

/** Committed sRGB → OkLCh; hue normalized to [0,360). */
export const colorToOklch = (c: Color): Oklch => {
  const { l, a, b } = rgbToOklab(c.r / 255, c.g / 255, c.b / 255)
  const chroma = dhypot(a, b)
  let hue = (datan2(b, a) * 180) / PI
  if (hue < 0) {
    hue += 360
  }
  return { l, c: chroma, h: hue, alpha: c.a / 255 }
}

/** True when the OkLCh point's linear-sRGB image lies in [0,1]^3 (within a small epsilon). */
const inGamut = (lightness: number, chroma: number, hue: number): boolean => {
  const a = chroma * dcosDeg(hue)
  const b = chroma * dsinDeg(hue)
  const lin = oklabToLinear(lightness, a, b)
  const eps = 1e-6
  return (
    lin.r >= -eps &&
    lin.r <= 1 + eps &&
    lin.g >= -eps &&
    lin.g <= 1 + eps &&
    lin.b >= -eps &&
    lin.b <= 1 + eps
  )
}

/**
 * OkLCh → committed sRGB. Gamut mapping: reduce chroma toward the achromatic
 * axis by a fixed 16-iteration bisection (ADR-0027 §2).
 */
export const oklchToColor = (o: Oklch): Color => {
  const lightness = clamp01(o.l)
  let chroma = Math.max(0, o.c)
  const hue = ((o.h % 360) + 360) % 360
  if (!inGamut(lightness, chroma, hue)) {
    let lo = 0
    let hi = chroma
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2
      if (inGamut(lightness, mid, hue)) {
        lo = mid
      } else {
        hi = mid
      }
    }
    chroma = lo
  }
  const a = chroma * dcosDeg(hue)
  const b = chroma * dsinDeg(hue)
  const lin = oklabToLinear(lightness, a, b)
  return color(
    linearToSrgb(clamp01(lin.r)) * 255,
    linearToSrgb(clamp01(lin.g)) * 255,
    linearToSrgb(clamp01(lin.b)) * 255,
    clamp01(o.alpha) * 255,
  )
}

// ── constructors ────────────────────────────────────────────────────────────

/** An sRGB constructor; channels 0..255, alpha defaults to opaque. Alias of `color()`. */
export const rgb = (r: number, g: number, b: number, a = 255): Color => color(r, g, b, a)

/**
 * Standard piecewise HSL→RGB (no transcendentals); h in degrees, s/l/alpha in [0,1] (alpha default opaque).
 */
export const hsl = (h: number, s: number, l: number, alpha = 1): Color => {
  // s, l in [0,1]; h in degrees. Standard piecewise HSL→RGB (no transcendentals).
  const hh = (((h % 360) + 360) % 360) / 60
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hh < 1) {
    ;[r, g, b] = [c, x, 0]
  } else if (hh < 2) {
    ;[r, g, b] = [x, c, 0]
  } else if (hh < 3) {
    ;[r, g, b] = [0, c, x]
  } else if (hh < 4) {
    ;[r, g, b] = [0, x, c]
  } else if (hh < 5) {
    ;[r, g, b] = [x, 0, c]
  } else {
    ;[r, g, b] = [c, 0, x]
  }
  return color((r + m) * 255, (g + m) * 255, (b + m) * 255, alpha * 255)
}

/**
 * OkLCh constructor: l/alpha in [0,1] (alpha default opaque), h in degrees, c chroma >= 0; gamut-mapped via oklchToColor.
 */
export const oklch = (l: number, c: number, h: number, alpha = 1): Color =>
  oklchToColor({ l, c, h, alpha })

// ── color operations (color → color, spec §12) ───────────────────────────

/** Raise OkLCh lightness by amt (L units, roughly [0,1]), clamped to [0,1]. */
export const lighten = (c: Color, amt: number): Color => {
  const o = colorToOklch(c)
  return oklchToColor({ ...o, l: clamp01(o.l + amt) })
}

/** Lower OkLCh lightness by amt (L units), clamped to [0,1]. */
export const darken = (c: Color, amt: number): Color => {
  const o = colorToOklch(c)
  return oklchToColor({ ...o, l: clamp01(o.l - amt) })
}

/**
 * Scale OkLCh chroma by (1 + amt); amt is a fraction and not clamped (negative amt reduces chroma).
 */
export const saturate = (c: Color, amt: number): Color => {
  const o = colorToOklch(c)
  return oklchToColor({ ...o, c: o.c * (1 + amt) })
}

/** Scale OkLCh chroma by max(0, 1 - amt); amt is a fraction. */
export const desaturate = (c: Color, amt: number): Color => {
  const o = colorToOklch(c)
  return oklchToColor({ ...o, c: o.c * Math.max(0, 1 - amt) })
}

/** Zero the OkLCh chroma, preserving lightness and hue. */
export const grayscale = (c: Color): Color => {
  const o = colorToOklch(c)
  return oklchToColor({ ...o, c: 0 })
}

/** Hue rotation by degrees, or set the hue to another color's hue. */
export const rotateHue = (c: Color, arg: number | Color): Color => {
  const o = colorToOklch(c)
  const hue = typeof arg === 'number' ? o.h + arg : colorToOklch(arg).h
  return oklchToColor({ ...o, h: ((hue % 360) + 360) % 360 })
}

/** Set alpha from a unit fraction [0,1] (not the 0..255 byte range of Color.a). */
export const withAlpha = (c: Color, a: number): Color => ({ ...c, a: clamp8(clamp01(a) * 255) })

/** Signed shorter-arc hue difference h0→h1, in degrees, in (−180, 180]. */
const hueDelta = (h0: number, h1: number): number => ((((h1 - h0) % 360) + 540) % 360) - 180

/** Shorter-arc hue interpolation (ADR-0027 §2). */
const mixHue = (h0: number, h1: number, t: number): number =>
  (((h0 + hueDelta(h0, h1) * t) % 360) + 360) % 360

/** Color space used by mix(); default 'oklch'. */
export type MixSpace = 'oklch' | 'rgb' | 'hsl'

/**
 * Interpolate two colors at t in [0,1] (clamped), in the given space (default OkLCh, shorter-arc
 * hue). Achromatic endpoints inherit the other endpoint's hue in oklch/hsl space to avoid hue jumps.
 */
export const mix = (a: Color, b: Color, t: number, space: MixSpace = 'oklch'): Color => {
  const tt = clamp01(t)
  if (space === 'rgb') {
    return color(
      a.r + (b.r - a.r) * tt,
      a.g + (b.g - a.g) * tt,
      a.b + (b.b - a.b) * tt,
      a.a + (b.a - a.a) * tt,
    )
  }
  if (space === 'hsl') {
    // interpolate via OkLCh-free HSL round-trip (piecewise, deterministic)
    const ha = rgbToHslTuple(a)
    const hb = rgbToHslTuple(b)
    return hsl(
      mixHue(ha.h, hb.h, tt),
      ha.s + (hb.s - ha.s) * tt,
      ha.l + (hb.l - ha.l) * tt,
      a.a / 255 + (b.a / 255 - a.a / 255) * tt,
    )
  }
  const oa = colorToOklch(a)
  const ob = colorToOklch(b)
  // achromatic endpoints adopt the other endpoint's hue (avoids hue jumps)
  const hueA = oa.c < 1e-7 ? ob.h : oa.h
  const hueB = ob.c < 1e-7 ? oa.h : ob.h
  return oklchToColor({
    l: oa.l + (ob.l - oa.l) * tt,
    c: oa.c + (ob.c - oa.c) * tt,
    h: mixHue(hueA, hueB, tt),
    alpha: oa.alpha + (ob.alpha - oa.alpha) * tt,
  })
}

/**
 * Decompose committed sRGB into HSL (h in degrees [0,360), s/l in [0,1]); used only by mix's 'hsl' space.
 */
const rgbToHslTuple = (
  c: Color,
): { readonly h: number; readonly s: number; readonly l: number } => {
  const r = c.r / 255
  const g = c.g / 255
  const b = c.b / 255
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const l = (mx + mn) / 2
  const d = mx - mn
  if (d === 0) {
    return { h: 0, s: 0, l }
  }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (mx === r) {
    h = 60 * (((g - b) / d) % 6)
  } else if (mx === g) {
    h = 60 * ((b - r) / d + 2)
  } else {
    h = 60 * ((r - g) / d + 4)
  }
  return { h: ((h % 360) + 360) % 360, s, l }
}

// ── declarative shading tones (ADR-0086 §5) ─────────────────────────────────

/** Clamp a signed value to [−m, m]. */
const clampMag = (v: number, m: number): number => Math.max(-m, Math.min(m, v))

/**
 * Warm highlight toward the light's colour: `mix(base, light, amt)` in OkLCh
 * (ADR-0086 §5). This is the correct highlight move — reflexively reaching for
 * `lighten()` (a pure L bump) reads chalky and cold, while mixing toward the
 * actual light colour keeps highlights warm. A thin, named wrapper over `mix`
 * so recipes read intent (`base.litTone(sun, 25%)`) rather than mechanism.
 */
export const litTone = (base: Color, light: Color, amt: number): Color => mix(base, light, amt)

/** Max degrees a `shadowTone` hue is nudged toward `cool` — never a full cross-hue swing. */
const SHADOW_HUE_CAP = 20
/** Fraction of `amt` that also desaturates the shadow (shadows read slightly greyer). */
const SHADOW_DESAT = 0.3

/**
 * Craft-correct shadow tone (ADR-0086 §5): lower OkLCh lightness by `darken`
 * (defaults to `amt`), nudge the hue toward `cool` by at most `SHADOW_HUE_CAP`
 * degrees along the shorter arc, and desaturate slightly. The hue **cap** is
 * the whole point — it keeps the shadow inside `base`'s hue family, so a warm
 * base darkens to a cooler brown instead of drifting through magenta, the
 * failure a bare `mix(base, cool, amt)` produces on warm materials. An
 * achromatic `cool` (chroma ~0) carries no hue direction, so only darken +
 * desaturate apply. Deterministic and pure.
 */
export const shadowTone = (base: Color, cool: Color, amt: number, darken = amt): Color => {
  const o = colorToOklch(base)
  const oc = colorToOklch(cool)
  const nudge = oc.c < 1e-7 ? 0 : clampMag(hueDelta(o.h, oc.h) * amt, SHADOW_HUE_CAP)
  return oklchToColor({
    l: clamp01(o.l - darken),
    c: o.c * Math.max(0, 1 - amt * SHADOW_DESAT),
    h: (((o.h + nudge) % 360) + 360) % 360,
    alpha: o.alpha,
  })
}

/** Endpoint colours for `ramp`'s default spread — ADR-0086's canonical sun warm + cool amb. */
const RAMP_LIGHT: Color = color(255, 230, 176) // #ffe6b0
const RAMP_COOL: Color = color(42, 58, 94) // #2a3a5e
const RAMP_LIT_MAX = 0.3
const RAMP_SHADOW_MAX = 0.35

/**
 * An `n`-step light→dark tone list for cel banding and `pixels:` ramps
 * (ADR-0086 §5): index 0 is the warmest highlight, index n−1 the coolest
 * shadow, `base` at the centre. Unlike `tones()` (explicit, arbitrary amounts),
 * `ramp` is the even, material-consistent spread — highlights via `litTone`
 * toward a warm light, shadows via `shadowTone` with the capped cool nudge, so
 * the whole ramp stays in `base`'s hue family (no magenta drift). Endpoints are
 * ADR-0086's canonical warm/cool. `n < 1` → empty; `n === 1` → `[base]`.
 */
export const ramp = (base: Color, n: number): Color[] => {
  if (n < 1) {
    return []
  }
  if (n === 1) {
    return [base]
  }
  return Array.from({ length: n }, (_, i) => {
    const p = 1 - (2 * i) / (n - 1) // +1 lightest … 0 base … −1 darkest
    if (p > 0) {
      return litTone(base, RAMP_LIGHT, p * RAMP_LIT_MAX)
    }
    if (p < 0) {
      return shadowTone(base, RAMP_COOL, -p * RAMP_SHADOW_MAX)
    }
    return base
  })
}
