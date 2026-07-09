// Bundled deterministic math (ADR-0027). Every transcendental that can touch
// a pixel lives here — never host Math.* (only IEEE-exact ops are used:
// + - * /, Math.sqrt, Math.floor/abs/min/max, Math.imul, bit ops).

export const PI = Math.PI
export const TAU = 6.283185307179586
const PIO2_HI = 1.570796326794896558
const PIO2_LO = 6.123233995736766036e-17
const INV_PIO2 = 0.6366197723675814
const LN2_HI = 6.9314718036912381649e-1
const LN2_LO = 1.90821492927058770002e-10
const LN2 = Math.LN2
const DEG = PI / 180

/** Round-half-up on the number line: floor(v + 0.5). The pinned rounding rule. */
export const roundHalfUp = (v: number): number => Math.floor(v + 0.5)

// fdlibm sin/cos kernel coefficients (fixed; part of the language version).
const S1 = -1.66666666666666324348e-1
const S2 = 8.33333333332248946124e-3
const S3 = -1.98412698298579493134e-4
const S4 = 2.75573137070700676789e-6
const S5 = -2.50507602534068634195e-8
const S6 = 1.58969099521155010221e-10
const C1 = 4.16666666666666019037e-2
const C2 = -1.38888888888741095749e-3
const C3 = 2.48015872894767294178e-5
const C4 = -2.75573143513906633035e-7
// fdlibm coefficient; intentionally rounded manually after sonar warning
const C5 = 2.087572321298175e-9
const C6 = -1.13596475577881948265e-11

/** The fdlibm minimax polynomial for sin(r) on the reduced range |r| <= pi/4. */
const sinKernel = (r: number): number => {
  const z = r * r
  return r + r * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))))
}

/** The fdlibm minimax polynomial for cos(r) on the reduced range |r| <= pi/4. */
const cosKernel = (r: number): number => {
  const z = r * r
  return 1 - z * 0.5 + z * z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
}

/** Range-reduce x to n*(pi/2) + r using extended-precision pi/2 (n mod 4, |r| <= pi/4). */
const reduce = (x: number): { readonly n: number; readonly r: number } => {
  const n = Math.floor(x * INV_PIO2 + 0.5)
  const r = x - n * PIO2_HI - n * PIO2_LO
  return { n: ((n % 4) + 4) % 4, r }
}

/** Deterministic sin (fdlibm-derived, ADR-0027); NaN for non-finite input. */
export const dsin = (x: number): number => {
  if (!Number.isFinite(x)) {
    return Number.NaN
  }
  const { n, r } = reduce(x)
  switch (n) {
    case 0:
      return sinKernel(r)
    case 1:
      return cosKernel(r)
    case 2:
      return -sinKernel(r)
    default:
      return -cosKernel(r)
  }
}

/** Deterministic cos (fdlibm-derived, ADR-0027); NaN for non-finite input. */
export const dcos = (x: number): number => {
  if (!Number.isFinite(x)) {
    return Number.NaN
  }
  const { n, r } = reduce(x)
  switch (n) {
    case 0:
      return cosKernel(r)
    case 1:
      return -sinKernel(r)
    case 2:
      return -cosKernel(r)
    default:
      return sinKernel(r)
  }
}

/** Computed as `dsin(x) / dcos(x)`; inherits their NaN behavior (no dedicated tan kernel). */
export const dtan = (x: number): number => dsin(x) / dcos(x)

/** Atan on [-inf, inf] via four angle-halvings + odd Taylor polynomial. */
const datan = (x: number): number => {
  if (x === 0) {
    return x
  }
  const neg = x < 0
  let t = neg ? -x : x
  // halve the angle four times: |t| < tan(pi/32) ~ 0.0985
  t = t / (1 + Math.sqrt(1 + t * t))
  t = t / (1 + Math.sqrt(1 + t * t))
  t = t / (1 + Math.sqrt(1 + t * t))
  t = t / (1 + Math.sqrt(1 + t * t))
  const z = t * t
  let acc = 0
  // t - t^3/3 + t^5/5 - ... up to t^21
  for (let k = 21; k >= 3; k -= 2) {
    acc = z * (1 / k - acc)
  }
  const a = 16 * (t - t * acc)
  return neg ? -a : a
}

/**
 * Deterministic atan2; standard quadrant handling, exact axis cases (x = 0 or y = 0), (0,0) → 0.
 */
export const datan2 = (y: number, x: number): number => {
  if (x > 0) {
    return datan(y / x)
  }
  if (x < 0) {
    return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI
  }
  if (y > 0) {
    return PIO2_HI
  }
  if (y < 0) {
    return -PIO2_HI
  }
  return 0
}

// small exact power-of-two table for |e| <= 30
const POW2: number[] = (() => {
  const t: number[] = []
  for (let i = -30; i <= 30; i++) {
    let v = 1
    if (i >= 0) {
      for (let k = 0; k < i; k++) {
        v *= 2
      }
    } else {
      for (let k = 0; k < -i; k++) {
        v /= 2
      }
    }
    t.push(v)
  }
  return t
})()

/** Exact v * 2^n for integer n via binary scaling (no Math.pow). */
const scalb = (v: number, n: number): number => {
  let r = v
  let e = n
  while (e > 30) {
    r *= 1073741824
    e -= 30
  }
  while (e < -30) {
    r /= 1073741824
    e += 30
  }
  const p = POW2[e + 30]
  return p === undefined ? r : r * p
}

/**
 * Deterministic exp; saturates to +Infinity above ~709.78 and to 0 below ~-745 (IEEE-754 double
 * overflow/underflow bounds); Taylor series after ln2 range reduction.
 */
export const dexp = (x: number): number => {
  if (!Number.isFinite(x)) {
    const nan = x < 0 ? 0 : Number.NaN
    return x > 0 ? Number.POSITIVE_INFINITY : nan
  }
  if (x > 709.78) {
    return Number.POSITIVE_INFINITY
  }
  if (x < -745) {
    return 0
  }
  const n = Math.floor(x / LN2 + 0.5)
  const r = x - n * LN2_HI - n * LN2_LO
  // Taylor: converges to < 1e-17 for |r| <= ln2/2
  let acc = 1
  for (let k = 14; k >= 1; k--) {
    acc = 1 + (r / k) * acc
  }
  return scalb(acc, n)
}

const F64 = new DataView(new ArrayBuffer(8))
const TWO_POW_54 = 2 ** 54

/**
 * Deterministic natural log; NaN for negative/NaN input, -Infinity at 0, +Infinity for non-finite
 * input; frexp (via raw IEEE-754 bits) + atanh-series on the normalized mantissa.
 */
export const dlog = (x: number): number => {
  if (x < 0 || Number.isNaN(x)) {
    return Number.NaN
  }
  if (x === 0) {
    return Number.NEGATIVE_INFINITY
  }
  if (!Number.isFinite(x)) {
    return Number.POSITIVE_INFINITY
  }
  // normalize subnormals so the exponent field is usable
  let v = x
  let eBias = 0
  if (v < 2.2250738585072014e-308) {
    v *= TWO_POW_54
    eBias = -54
  }
  // frexp via raw bits: v = m * 2^e, m in [1, 2)
  F64.setFloat64(0, v)
  let e = ((F64.getUint32(0) >>> 20) & 0x7ff) - 1023 + eBias
  F64.setUint32(0, (F64.getUint32(0) & 0x800fffff) | 0x3ff00000)
  let m = F64.getFloat64(0)
  // pull m into [sqrt(1/2), sqrt(2))
  if (m > Math.SQRT2) {
    m /= 2
    e += 1
  }
  // atanh series: ln(m) = 2*(s + s^3/3 + s^5/5 + ...), s = (m-1)/(m+1), |s| <= 0.1716
  const s = (m - 1) / (m + 1)
  const z = s * s
  let acc = 0
  for (let k = 15; k >= 3; k -= 2) {
    acc = z * (1 / k + acc)
  }
  return e * LN2_HI + e * LN2_LO + 2 * (s + s * acc)
}

/**
 * Deterministic pow; exact repeated-squaring fast path for integer exponents |b| <= 64, else
 * exp(b*log(a)); 0^b and a negative-base non-integer exponent follow Math.pow's sign/NaN conventions.
 */
export const dpow = (a: number, b: number): number => {
  if (b === 0) {
    return 1
  }
  if (a === 1) {
    return 1
  }
  // exact fast path: small integer exponents by repeated multiplication
  if (Number.isInteger(b) && Math.abs(b) <= 64) {
    let n = Math.abs(b)
    let base = a
    let r = 1
    while (n > 0) {
      if (n & 1) {
        r *= base
      }
      base *= base
      n >>= 1
    }
    return b < 0 ? 1 / r : r
  }
  if (a === 0) {
    return b > 0 ? 0 : Number.POSITIVE_INFINITY
  }
  if (a < 0) {
    return Number.NaN // non-integer power of a negative
  }
  return dexp(b * dlog(a))
}

/** Deterministic cube root: exp(log(|x|)/3) refined by two fixed Newton steps, sign restored. */
export const dcbrt = (x: number): number => {
  if (x === 0) {
    return 0
  }
  const neg = x < 0
  const ax = neg ? -x : x
  let y = dexp(dlog(ax) / 3)
  // two Newton polish steps (fixed count — deterministic)
  y = y - (y * y * y - ax) / (3 * y * y)
  y = y - (y * y * y - ax) / (3 * y * y)
  return neg ? -y : y
}

/**
 * Euclidean distance as the IEEE-exact `sqrt(x*x + y*y)` (ADR-0027). Host
 * `Math.hypot` is *not* correctly rounded and can differ across JS engines, so
 * it is banned from the pixel path; this form uses only the exact primitives
 * (`* + sqrt`) and is therefore bit-identical everywhere. Domain assumption:
 * every call site passes pixel/colour-space magnitudes, far below the
 * `sqrt(MAX_DOUBLE)` overflow and subnormal-underflow edges the naive formula
 * would otherwise mishandle.
 */
export const dhypot = (x: number, y: number): number => Math.sqrt(x * x + y * y)

export const dsinDeg = (deg: number): number => {
  const d = ((deg % 360) + 360) % 360
  if (d === 0 || d === 180) {
    return 0
  }
  if (d === 90) {
    return 1
  }
  if (d === 270) {
    return -1
  }
  return dsin(d * DEG)
}

export const dcosDeg = (deg: number): number => {
  const d = ((deg % 360) + 360) % 360
  if (d === 90 || d === 270) {
    return 0
  }
  if (d === 0) {
    return 1
  }
  if (d === 180) {
    return -1
  }
  return dcos(d * DEG)
}

// ── Seeded randomness & value noise (ADR-0026) ──────────────────────────────

/** A splitmix32-style u32 mixer — the frozen base hash. */
export const hash32 = (v: number): number => {
  let x = (v + 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97) >>> 0
  return (x ^ (x >>> 15)) >>> 0
}

/**
 * Floor to an integer and reduce into the u32 range [0, 2^32), handling negative inputs via double modulo.
 */
const toU32 = (v: number): number => {
  const i = Math.floor(v)
  return (((i % 4294967296) + 4294967296) % 4294967296) >>> 0
}

/**
 * Seeded random draw: `rand(seed)` is `hash32(seed)/2^32`; `rand(seed, i)` draws the i-th value of
 * that seed's stream — both pure functions of their arguments, range [0,1) (ADR-0026).
 */
export const rand = (seed: number, i?: number): number => {
  const s = toU32(seed)
  if (i === undefined) {
    return hash32(s) / 4294967296
  }
  return hash32((s ^ hash32(toU32(i))) >>> 0) / 4294967296
}

/** Lattice corner hash for noise(): combines the seed with integer coords (ix, iy). */
const cornerHash = (seed: number, ix: number, iy: number): number =>
  hash32((seed ^ hash32((toU32(ix) ^ hash32(toU32(iy))) >>> 0)) >>> 0)

/** Fixed-point smoothstep t^2(3-2t): T = floor(t*2^16); exact in doubles. */
const smoothFP = (t: number): number => {
  const T = Math.floor(t * 65536)
  return (T * T * (3 * 65536 - 2 * T)) / 281474976710656 // / 2^48
}

/** Deterministic 2D value noise in [0,1), smooth in x/y (ADR-0026). */
export const noise = (seed: number, x: number, y: number): number => {
  const s = toU32(seed)
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const c00 = cornerHash(s, ix, iy) / 4294967296
  const c10 = cornerHash(s, ix + 1, iy) / 4294967296
  const c01 = cornerHash(s, ix, iy + 1) / 4294967296
  const c11 = cornerHash(s, ix + 1, iy + 1) / 4294967296
  const sx = smoothFP(fx)
  const sy = smoothFP(fy)
  const top = c00 + (c10 - c00) * sx
  const bot = c01 + (c11 - c01) * sx
  return top + (bot - top) * sy
}
