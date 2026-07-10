import { describe, expect, test } from 'bun:test'
import { color, relativeLuminance } from '../../src/color.js'
import { Framebuffer } from '../../src/framebuffer.js'
import { type Context, celRegion } from '../../src/raster.js'
import {
  lightDirOf,
  lightPointFor,
  lowerMaterial,
  planMaterial,
  regionCenter,
  type ShadeOp,
  shadowOffsetFor,
} from '../../src/shading.js'
import { light, material, type Region, rectRegion, typeName, unitVec } from '../../src/values.js'

const ctx = (w: number, h: number): Context => ({
  buffer: new Framebuffer(w, h),
  mask: null,
  mode: 'pixel',
})

const warm = color(255, 230, 176) // #ffe6b0
const cool = color(42, 58, 94) // #2a3a5e
const steelBase = color(138, 149, 165) // #8a95a5

/** A directional sun, light travelling down-right (source up-left). */
const sun = light({ dir: { x: 1, y: 1 }, color: warm, amb: { color: cool, amount: 0.15 } })
/** A 16×16 region inset in a 24×24 canvas; centre (11.5, 11.5). */
const square: Region = rectRegion(4, 4, 19, 19)

const kinds = (ops: ShadeOp[]): string[] => ops.map((o) => o.kind)
const lumAt = (c: Context, x: number, y: number): number => {
  const p = c.buffer.get(x, y)
  return relativeLuminance(p.r, p.g, p.b, p.a)
}

describe('value factories: light / material', () => {
  test('light normalizes dir to a unit vector and defaults gain/pos/amb', () => {
    expect(sun.dir.x).toBeCloseTo(Math.SQRT1_2, 6)
    expect(sun.dir.y).toBeCloseTo(Math.SQRT1_2, 6)
    expect(Math.hypot(sun.dir.x, sun.dir.y)).toBeCloseTo(1, 6)
    const bare = light({ dir: { x: 3, y: 0 }, color: warm })
    expect(bare.dir).toEqual({ x: 1, y: 0 })
    expect(bare.gain).toBe(1)
    expect(bare.pos).toBeNull()
    expect(bare.amb).toBeNull()
  })

  test('point light keeps pos verbatim and a nominal down dir', () => {
    const torch = light({ pos: { x: 12, y: 8 }, color: warm, gain: 1.4 })
    expect(torch.pos).toEqual({ x: 12, y: 8 })
    expect(torch.gain).toBe(1.4)
    expect(torch.dir).toEqual({ x: 0, y: 1 })
  })

  test('unitVec falls back to straight-down for a zero vector', () => {
    expect(unitVec(0, 0)).toEqual({ x: 0, y: 1 })
  })

  test('material defaults to flat and attaches only defined overrides', () => {
    const bare = material(steelBase)
    expect(bare.response).toBe('flat')
    expect(bare.shade).toBeUndefined()
    const skin = material(steelBase, 'skin', { shade: 0.6 })
    expect(skin.response).toBe('skin')
    expect(skin.shade).toBe(0.6)
    expect('hi' in skin).toBe(false)
  })

  test('typeName reports the new value tags', () => {
    expect(typeName(sun)).toBe('light')
    expect(typeName(material(steelBase, 'metal'))).toBe('material')
  })
})

describe('encoding unification: one light drives all three encodings coherently', () => {
  test('directional light: shade point up-light, rim dir down-right, cast offset down-right', () => {
    const c = regionCenter(square)
    // shadeRegion/lightRegion point: a synthetic source up-light of the region (opposite travel).
    const point = lightPointFor(square, sun)
    expect(point.x).toBeLessThan(c.x)
    expect(point.y).toBeLessThan(c.y)
    // rim direction: the travel direction verbatim — both components positive (down-right).
    const dir = lightDirOf(sun, square)
    expect(dir.x).toBeGreaterThan(0)
    expect(dir.y).toBeGreaterThan(0)
    // cast offset: same travel direction → positive diagonal, the same side shade darkens.
    const off = shadowOffsetFor(square, sun, 10)
    expect(off.dx).toBeGreaterThan(0)
    expect(off.dy).toBeGreaterThan(0)
    // all three read the SAME source: rim dir and the (normalized) cast offset agree in sign.
    expect(Math.sign(off.dx)).toBe(Math.sign(dir.x))
    expect(Math.sign(off.dy)).toBe(Math.sign(dir.y))
  })

  test('point light: pos verbatim as the shade point, dir derived source→region', () => {
    const torch = light({ pos: { x: 0, y: 0 }, color: warm }) // corner, up-left of the square
    expect(lightPointFor(square, torch)).toEqual({ x: 0, y: 0 })
    const dir = lightDirOf(torch, square) // centre − pos, normalized → down-right
    expect(dir.x).toBeGreaterThan(0)
    expect(dir.y).toBeGreaterThan(0)
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 6)
    const off = shadowOffsetFor(square, torch, 8)
    expect(off.dx).toBeGreaterThan(0)
    expect(off.dy).toBeGreaterThan(0)
  })
})

describe('lowerMaterial: per-response primitive sequence', () => {
  test('flat: fill + shade + light + ao, no rim, no cast', () => {
    expect(kinds(planMaterial(square, material(steelBase, 'flat'), sun))).toEqual([
      'fill',
      'shade',
      'light',
      'ao',
    ])
  })

  test('metal: the full craft-correct sequence in order', () => {
    expect(kinds(planMaterial(square, material(steelBase, 'metal'), sun))).toEqual([
      'fill',
      'shade',
      'light',
      'rim',
      'ao',
      'cast',
    ])
  })

  test('glow is self-illuminated: only fill + a self-light, never shade/rim/ao/cast', () => {
    const ops = planMaterial(square, material(color(80, 40, 20), 'glow'), sun)
    expect(kinds(ops)).toEqual(['fill', 'light'])
    // the self-light is centred on the region itself, not the external light source.
    const lit = ops.find((o) => o.kind === 'light')
    expect(lit?.kind === 'light' && lit.point).toEqual(regionCenter(square))
  })

  test('material overrides replace the response default dose', () => {
    const shadeOp = planMaterial(square, material(steelBase, 'flat', { rim: 0.5 }), sun).find(
      (o) => o.kind === 'rim',
    )
    expect(shadeOp).toBeDefined() // flat has rim 0 by default; the override turns it on
  })
})

describe('lowerMaterial: rendered tone structure', () => {
  test('metal renders lit-and-warm toward the light, shaded-and-cool away from it', () => {
    const c = ctx(24, 24)
    lowerMaterial(c, square, material(steelBase, 'metal'), sun)
    // interior pixels, clear of the rim/ao boundary band: (7,7) faces the light, (16,16) is far.
    expect(lumAt(c, 7, 7)).toBeGreaterThan(lumAt(c, 16, 16))
    const near = c.buffer.get(7, 7)
    const far = c.buffer.get(16, 16)
    expect(near.r).toBeGreaterThan(far.r) // warm highlight adds red; cool shadow removes it
  })

  test('glow brightens its own centre and never paints a neighbour pixel', () => {
    const c = ctx(24, 24)
    lowerMaterial(c, square, material(color(120, 60, 30), 'glow'), sun)
    expect(lumAt(c, 11, 11)).toBeGreaterThan(lumAt(c, 5, 5)) // core brighter than the rim
    expect(c.buffer.get(0, 0).a).toBe(0) // outside the region: untouched
    expect(c.buffer.get(23, 23).a).toBe(0)
  })

  test('cast shadow lands down-light, outside the region silhouette', () => {
    const c = ctx(24, 24)
    lowerMaterial(c, square, material(steelBase, 'metal'), sun)
    // the region is 4..19; the cast band sticks out past the far (down-right) edge.
    expect(c.buffer.get(21, 21).a).toBeGreaterThan(0)
    // nothing sticks out on the light-facing side.
    expect(c.buffer.get(2, 2).a).toBe(0)
  })
})

describe('celRegion: crisp N-band distance fill', () => {
  const bands = [color(255, 0, 0), color(0, 255, 0), color(0, 0, 255)]

  test('produces exactly N distinct hard-edged bands (no alpha stacking)', () => {
    const c = ctx(24, 24)
    celRegion(c, square, lightPointFor(square, sun), bands)
    const seen = new Set<string>()
    for (let y = 4; y <= 19; y++) {
      for (let x = 4; x <= 19; x++) {
        const p = c.buffer.get(x, y)
        if (p.a > 0) {
          seen.add(`${p.r},${p.g},${p.b},${p.a}`)
        }
      }
    }
    // every filled pixel is exactly one of the three opaque band colours — crisp, no intermediates.
    expect(seen).toEqual(new Set(['255,0,0,255', '0,255,0,255', '0,0,255,255']))
  })

  test('band 0 sits nearest the light, the last band farthest', () => {
    const c = ctx(24, 24)
    celRegion(c, square, lightPointFor(square, sun), bands)
    const near = c.buffer.get(5, 5) // up-light corner
    const far = c.buffer.get(18, 18) // down-light corner
    expect([near.r, near.g, near.b]).toEqual([255, 0, 0])
    expect([far.r, far.g, far.b]).toEqual([0, 0, 255])
  })

  test('an empty colour list is a no-op', () => {
    const c = ctx(24, 24)
    celRegion(c, square, lightPointFor(square, sun), [])
    expect(c.buffer.get(11, 11).a).toBe(0)
  })
})
