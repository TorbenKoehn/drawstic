import { describe, expect, test } from 'bun:test'
import {
  color,
  colorToOklch,
  darken,
  desaturate,
  grayscale,
  hsl,
  lighten,
  mix,
  oklch,
  oklchToColor,
  parseHexColor,
  rgb,
  rotateHue,
  saturate,
  TRANSPARENT,
  toHexColor,
  withAlpha,
} from '../../src/color.js'

describe('color()', () => {
  test('round-half-up and clamps channels to [0, 255]', () => {
    expect(color(1.5, 2.4, 2.6)).toMatchObject({ r: 2, g: 2, b: 3 })
    expect(color(-10, 300, 0)).toMatchObject({ r: 0, g: 255, b: 0 })
  })

  test('alpha defaults opaque', () => {
    expect(color(0, 0, 0).a).toBe(255)
    expect(color(0, 0, 0, 10).a).toBe(10)
  })
})

describe('TRANSPARENT', () => {
  test('is the frozen zero color', () => {
    expect(TRANSPARENT).toEqual({ type: 'color', r: 0, g: 0, b: 0, a: 0 })
    expect(Object.isFrozen(TRANSPARENT)).toBe(true)
  })
})

describe('parseHexColor()', () => {
  test('leading # is optional', () => {
    expect(parseHexColor('abc')).toEqual(parseHexColor('#abc'))
  })

  test('3-digit shorthand', () => {
    expect(parseHexColor('#abc')).toMatchObject({ r: 170, g: 187, b: 204, a: 255 })
  })

  test('4-digit shorthand includes alpha', () => {
    expect(parseHexColor('#f008')).toMatchObject({ r: 255, g: 0, b: 0, a: 136 })
  })

  test('6-digit form', () => {
    expect(parseHexColor('#c04040')).toMatchObject({ r: 192, g: 64, b: 64, a: 255 })
  })

  test('8-digit form includes alpha', () => {
    expect(parseHexColor('#11223344')).toMatchObject({ r: 17, g: 34, b: 51, a: 68 })
  })

  test('invalid hex characters return null', () => {
    expect(parseHexColor('#gggggg')).toBeNull()
    expect(parseHexColor('#12g')).toBeNull()
  })

  test('unsupported lengths return null', () => {
    expect(parseHexColor('#1')).toBeNull()
    expect(parseHexColor('#1234567')).toBeNull()
  })
})

describe('toHexColor()', () => {
  test('opaque colors omit the alpha suffix', () => {
    expect(toHexColor(color(0, 0, 0))).toBe('#000000')
  })

  test('non-opaque colors append 2-digit alpha, zero-padded', () => {
    expect(toHexColor(color(1, 2, 3, 4))).toBe('#01020304')
    expect(toHexColor(color(255, 255, 255, 128))).toBe('#ffffff80')
  })
})

describe('colorToOklch() / oklchToColor()', () => {
  test('hue normalizes into [0, 360) even when atan2 is negative', () => {
    const blue = colorToOklch(color(0, 0, 255))
    expect(blue.h).toBeGreaterThanOrEqual(0)
    expect(blue.h).toBeLessThan(360)
    expect(blue.h).toBeGreaterThan(200)
    expect(blue.h).toBeLessThan(300)
  })

  test('achromatic colors have ~0 chroma', () => {
    expect(colorToOklch(color(128, 128, 128)).c).toBeLessThan(1e-6)
  })

  test('alpha round-trips through the 0..255 byte range', () => {
    expect(colorToOklch(color(0, 0, 0, 128)).alpha).toBeCloseTo(128 / 255, 5)
  })

  test('gamut-maps out-of-range chroma via bisection into valid 8-bit sRGB', () => {
    const c = oklchToColor({ l: 0.9, c: 0.5, h: 140, alpha: 1 })
    for (const v of [c.r, c.g, c.b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
    expect(c).toEqual({ type: 'color', r: 137, g: 255, b: 109, a: 255 })
  })

  test('alpha is clamped to [0, 1] before committing to a byte', () => {
    expect(oklchToColor({ l: 0.5, c: 0, h: 0, alpha: 1.5 }).a).toBe(255)
    expect(oklchToColor({ l: 0.5, c: 0, h: 0, alpha: -0.5 }).a).toBe(0)
  })
})

describe('rgb()', () => {
  test('is an alias of color()', () => {
    expect(rgb(10, 20, 30)).toEqual(color(10, 20, 30))
    expect(rgb(10, 20, 30, 100)).toEqual(color(10, 20, 30, 100))
  })
})

describe('hsl()', () => {
  test('primary hues', () => {
    expect(hsl(0, 1, 0.5)).toMatchObject({ r: 255, g: 0, b: 0 })
    expect(hsl(120, 1, 0.5)).toMatchObject({ r: 0, g: 255, b: 0 })
    expect(hsl(240, 1, 0.5)).toMatchObject({ r: 0, g: 0, b: 255 })
  })

  test('every 60-degree piecewise branch', () => {
    expect(hsl(30, 1, 0.5)).toMatchObject({ r: 255, g: 128, b: 0 })
    expect(hsl(90, 1, 0.5)).toMatchObject({ r: 128, g: 255, b: 0 })
    expect(hsl(150, 1, 0.5)).toMatchObject({ r: 0, g: 255, b: 128 })
    expect(hsl(210, 1, 0.5)).toMatchObject({ r: 0, g: 128, b: 255 })
    expect(hsl(270, 1, 0.5)).toMatchObject({ r: 128, g: 0, b: 255 })
    expect(hsl(330, 1, 0.5)).toMatchObject({ r: 255, g: 0, b: 128 })
  })

  test('hue wraps outside [0, 360)', () => {
    expect(hsl(-30, 1, 0.5)).toEqual(hsl(330, 1, 0.5))
    expect(hsl(360, 1, 0.5)).toEqual(hsl(0, 1, 0.5))
  })

  test('alpha defaults opaque and rounds half-up', () => {
    expect(hsl(0, 1, 0.5).a).toBe(255)
    expect(hsl(0, 1, 0.5, 0.5).a).toBe(128)
  })
})

describe('oklch()', () => {
  test('constructs via oklchToColor', () => {
    expect(oklch(0.5, 0, 0)).toEqual(oklchToColor({ l: 0.5, c: 0, h: 0, alpha: 1 }))
  })

  test('alpha defaults opaque', () => {
    expect(oklch(0.7, 0.1, 200, 0.8).a).toBe(204)
  })
})

describe('lighten() / darken()', () => {
  test('lighten clamps at L=1 (white for a near-neutral color)', () => {
    expect(lighten(color(200, 200, 200), 1)).toEqual({
      type: 'color',
      r: 255,
      g: 255,
      b: 255,
      a: 255,
    })
  })

  test('darken clamps at L=0 (black)', () => {
    expect(darken(color(50, 50, 50), 1)).toEqual({ type: 'color', r: 0, g: 0, b: 0, a: 255 })
  })

  test('small amounts move lightness without clamping', () => {
    const base = color(120, 60, 60)
    const l0 = colorToOklch(base).l
    expect(colorToOklch(lighten(base, 0.1)).l).toBeGreaterThan(l0)
    expect(colorToOklch(darken(base, 0.1)).l).toBeLessThan(l0)
  })
})

describe('saturate() / desaturate()', () => {
  const red = color(200, 60, 60)

  test('saturate scales chroma by (1 + amt); negative amt desaturates fully at -1', () => {
    expect(colorToOklch(saturate(red, -1)).c).toBeLessThan(1e-6)
  })

  test('desaturate scales chroma by max(0, 1 - amt)', () => {
    const c0 = colorToOklch(red).c
    const half = colorToOklch(desaturate(red, 0.5)).c
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThan(c0)
    expect(half).toBeCloseTo(c0 / 2, 1)
  })

  test('desaturate clamps to 0 chroma when amt >= 1', () => {
    expect(colorToOklch(desaturate(red, 2)).c).toBeLessThan(1e-6)
  })
})

describe('grayscale()', () => {
  test('zeros chroma, preserving lightness', () => {
    const red = color(200, 60, 60)
    const gray = grayscale(red)
    expect(gray).toEqual({ type: 'color', r: 117, g: 117, b: 117, a: 255 })
    expect(colorToOklch(gray).c).toBeLessThan(1e-6)
  })
})

describe('rotateHue()', () => {
  const base = oklch(0.6, 0.15, 50)
  const baseHue = colorToOklch(base).h

  test('numeric arg rotates by degrees, wrapping past 360', () => {
    expect(colorToOklch(rotateHue(base, 90)).h).toBeCloseTo(baseHue + 90, 0)
    expect(colorToOklch(rotateHue(base, 350)).h).toBeCloseTo((baseHue + 350) % 360, 0)
  })

  test('numeric arg wraps below 0', () => {
    expect(colorToOklch(rotateHue(base, -100)).h).toBeCloseTo(((baseHue - 100) % 360) + 360, 0)
  })

  test('Color arg sets hue to the other color’s hue, preserving lightness/chroma', () => {
    const other = oklch(0.5, 0.2, 200)
    const otherHue = colorToOklch(other).h
    const rotated = rotateHue(base, other)
    expect(colorToOklch(rotated).h).toBeCloseTo(otherHue, 0)
    expect(colorToOklch(rotated).l).toBeCloseTo(colorToOklch(base).l, 2)
  })
})

describe('withAlpha()', () => {
  test('sets alpha from a unit fraction, rounding half-up', () => {
    expect(withAlpha(color(1, 2, 3), 0.5)).toEqual({ type: 'color', r: 1, g: 2, b: 3, a: 128 })
  })

  test('clamps outside [0, 1]', () => {
    expect(withAlpha(color(1, 2, 3), 1.5).a).toBe(255)
    expect(withAlpha(color(1, 2, 3), -0.5).a).toBe(0)
  })
})

describe('mix()', () => {
  const black = color(0, 0, 0)
  const white = color(255, 255, 255)

  test('t is clamped to [0, 1]', () => {
    expect(mix(black, white, -1)).toEqual(mix(black, white, 0))
    expect(mix(black, white, 2)).toEqual(mix(black, white, 1))
  })

  test('endpoints round-trip (default oklch space)', () => {
    expect(mix(black, white, 0)).toEqual(black)
    expect(mix(black, white, 1)).toEqual(white)
  })

  test('rgb space interpolates channels and alpha linearly', () => {
    const mid = mix(color(0, 0, 0, 0), color(255, 255, 255, 255), 0.5, 'rgb')
    expect(mid).toEqual({ type: 'color', r: 128, g: 128, b: 128, a: 128 })
  })

  test('hsl space produces a valid in-between color', () => {
    const mid = mix(color(255, 0, 0), color(0, 0, 255), 0.5, 'hsl')
    for (const v of [mid.r, mid.g, mid.b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
  })

  test('hsl space handles an achromatic endpoint (max === min channel)', () => {
    const mid = mix(color(128, 128, 128), color(255, 0, 0), 0.5, 'hsl')
    for (const v of [mid.r, mid.g, mid.b]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(255)
    }
  })

  test('oklch space: an achromatic endpoint adopts the other endpoint’s hue (no hue jump)', () => {
    const gray = color(128, 128, 128)
    const red = color(200, 60, 60)
    const redHue = colorToOklch(red).h
    const fromGray = colorToOklch(mix(gray, red, 0.3, 'oklch'))
    const fromRed = colorToOklch(mix(red, gray, 0.7, 'oklch'))
    // if hue adoption were missing, the achromatic endpoint's meaningless hue
    // would pull the interpolated hue far from redHue
    expect(fromGray.h).toBeCloseTo(redHue, 0)
    expect(fromRed.h).toBeCloseTo(redHue, 0)
    expect(mix(gray, red, 0.3, 'oklch')).toEqual(mix(red, gray, 0.7, 'oklch'))
  })
})
