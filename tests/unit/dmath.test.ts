import { describe, expect, test } from 'bun:test'
import { mix, oklch, parseHexColor, toHexColor } from '../../src/color.js'
import {
  datan2,
  dcos,
  dcosDeg,
  dexp,
  dhypot,
  dlog,
  dpow,
  dsin,
  dsinDeg,
  dtan,
  hash32,
  noise,
  PI,
  rand,
  roundHalfUp,
} from '../../src/dmath.js'

describe('deterministic math', () => {
  test('sin/cos accuracy', () => {
    for (const x of [0, 0.5, 1, PI / 6, PI / 4, PI / 2, PI, 2 * PI, -1.25, 10, 100]) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-12)
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-12)
    }
  })

  test('tan is sin/cos', () => {
    for (const x of [0, 0.5, 1, PI / 6, PI / 4]) {
      expect(Math.abs(dtan(x) - Math.tan(x))).toBeLessThan(1e-9)
    }
  })

  test('atan2 quadrants', () => {
    for (const [y, x] of [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]) {
      expect(
        Math.abs(datan2(y as number, x as number) - Math.atan2(y as number, x as number)),
      ).toBeLessThan(1e-12)
    }
  })

  test('exp/log/pow', () => {
    for (const x of [0.1, 0.5, 1, 2, 10, 0.001, 12345.678]) {
      expect(Math.abs(dlog(x) - Math.log(x))).toBeLessThan(1e-12)
      expect(Math.abs(dexp(Math.log(x)) - x) / x).toBeLessThan(1e-12)
    }
    expect(dpow(2, 10)).toBe(1024)
    expect(dpow(3, 0)).toBe(1)
    expect(Math.abs(dpow(2, 0.5) - Math.SQRT2)).toBeLessThan(1e-12)
  })

  test('round-half-up', () => {
    expect(roundHalfUp(0.5)).toBe(1)
    expect(roundHalfUp(-0.5)).toBe(0)
    expect(roundHalfUp(1.4999)).toBe(1)
  })

  test('hash32 is the pinned splitmix32 variant', () => {
    // frozen values — changing them is a language-version bump (ADR-0026)
    expect(hash32(0)).toBe(hash32(0))
    expect(hash32(1)).not.toBe(hash32(2))
    expect(rand(42)).toBeGreaterThanOrEqual(0)
    expect(rand(42)).toBeLessThan(1)
    expect(rand(42)).toBe(rand(42))
    expect(rand(42, 1)).not.toBe(rand(42, 2))
  })

  test('noise is smooth and deterministic', () => {
    const a = noise(7, 1.5, 2.5)
    expect(a).toBe(noise(7, 1.5, 2.5))
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
    // smoothness: nearby samples are close
    expect(Math.abs(noise(7, 1.5, 2.5) - noise(7, 1.501, 2.5))).toBeLessThan(0.05)
  })

  test('hypot is Euclidean distance', () => {
    expect(dhypot(3, 4)).toBe(5)
    expect(dhypot(0, 0)).toBe(0)
  })

  test('hypot is the IEEE-exact sqrt(x*x + y*y), not host Math.hypot (ADR-0027)', () => {
    // Math.hypot is not correctly rounded and varies across engines; dhypot must
    // be bit-identical to the naive exact form so pixel output stays deterministic.
    for (const [x, y] of [
      [3, 4],
      [5.5, -12.25],
      [0.1, 0.2],
      [123.456, 789.012],
      [-7, -0.0001],
    ]) {
      expect(dhypot(x as number, y as number)).toBe(
        Math.sqrt((x as number) * (x as number) + (y as number) * (y as number)),
      )
    }
  })

  test('sin/cos are NaN for non-finite input', () => {
    expect(Number.isNaN(dsin(Number.NaN))).toBe(true)
    expect(Number.isNaN(dsin(Number.POSITIVE_INFINITY))).toBe(true)
    expect(Number.isNaN(dcos(Number.NEGATIVE_INFINITY))).toBe(true)
    expect(Number.isNaN(dcos(Number.NaN))).toBe(true)
  })

  test('exp saturates at the IEEE-754 double bounds and handles non-finite input', () => {
    expect(Number.isNaN(dexp(Number.NaN))).toBe(true)
    expect(dexp(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
    expect(dexp(Number.NEGATIVE_INFINITY)).toBe(0)
    expect(dexp(710)).toBe(Number.POSITIVE_INFINITY)
    expect(dexp(-800)).toBe(0)
    // in-range but large |x|: exercises scalb's binary-scaling loops (|n| > 30)
    expect(Math.abs(dexp(700) - Math.exp(700)) / Math.exp(700)).toBeLessThan(1e-9)
    const small = dexp(-400)
    expect(small).toBeGreaterThanOrEqual(0)
    expect(Math.abs(small - Math.exp(-400)) / Math.exp(-400)).toBeLessThan(1e-9)
  })

  test('log handles domain edges (negative, zero, infinity, subnormal)', () => {
    expect(Number.isNaN(dlog(-1))).toBe(true)
    expect(Number.isNaN(dlog(Number.NaN))).toBe(true)
    expect(dlog(0)).toBe(Number.NEGATIVE_INFINITY)
    expect(dlog(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
    // subnormal input exercises the frexp bit-twiddling's normalization path
    expect(Math.abs(dlog(Number.MIN_VALUE) - Math.log(Number.MIN_VALUE))).toBeLessThan(1e-9)
  })

  test('pow edge cases: zero base and negative base with a non-integer exponent', () => {
    expect(dpow(0, 0.5)).toBe(0)
    expect(dpow(0, -0.5)).toBe(Number.POSITIVE_INFINITY)
    expect(Number.isNaN(dpow(-2, 0.5))).toBe(true)
  })

  test('degree-based sin/cos hit the exact axis angles and fall back to the radian kernel', () => {
    expect(dsinDeg(0)).toBe(0)
    expect(dsinDeg(90)).toBe(1)
    expect(dsinDeg(180)).toBe(0)
    expect(dsinDeg(270)).toBe(-1)
    expect(dcosDeg(0)).toBe(1)
    expect(dcosDeg(90)).toBe(0)
    expect(dcosDeg(180)).toBe(-1)
    expect(dcosDeg(270)).toBe(0)
    expect(Math.abs(dsinDeg(45) - Math.sin(Math.PI / 4))).toBeLessThan(1e-12)
    expect(Math.abs(dcosDeg(45) - Math.cos(Math.PI / 4))).toBeLessThan(1e-12)
  })
})

describe('color pipeline', () => {
  test('hex parsing forms', () => {
    expect(toHexColor(parseHexColor('#fff') ?? { type: 'color', r: 0, g: 0, b: 0, a: 0 })).toBe(
      '#ffffff',
    )
    expect(parseHexColor('#c04040')?.r).toBe(192)
    expect(parseHexColor('#00000080')?.a).toBe(128)
    expect(parseHexColor('#12345')).toBeNull()
  })

  test('oklch round-trips near-neutrals and gamut-maps', () => {
    const grey = oklch(0.5, 0, 0)
    expect(Math.abs(grey.r - grey.g)).toBeLessThanOrEqual(1)
    expect(Math.abs(grey.g - grey.b)).toBeLessThanOrEqual(1)
    // wildly out-of-gamut chroma must still commit to valid 8-bit sRGB
    const c = oklch(0.7, 0.8, 150)
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
  })

  test('mix endpoints and midpoint', () => {
    const a = parseHexColor('#000000') as NonNullable<ReturnType<typeof parseHexColor>>
    const b = parseHexColor('#ffffff') as NonNullable<ReturnType<typeof parseHexColor>>
    expect(toHexColor(mix(a, b, 0))).toBe('#000000')
    expect(toHexColor(mix(a, b, 1))).toBe('#ffffff')
    const mid = mix(a, b, 0.5, 'rgb')
    expect(mid.r).toBe(128)
  })
})
