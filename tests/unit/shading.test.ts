import { describe, expect, test } from 'bun:test'
import { color, relativeLuminance } from '../../src/color.js'
import { Framebuffer } from '../../src/framebuffer.js'
import { type Context, celRegion, fillRegion } from '../../src/raster.js'
import {
  formSpecOf,
  lightDirOf,
  lightPointFor,
  lightVec3,
  lowerCel,
  lowerMaterial,
  planMaterial,
  regionCenter,
  type ShadeOp,
  shadowOffsetFor,
} from '../../src/shading.js'
import {
  circleRegion,
  light,
  material,
  type Region,
  rectRegion,
  typeName,
  unitVec,
} from '../../src/values.js'

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
  test('flat: form body + ao, no rim, no cast (ADR-0089 replaces shade+light with form)', () => {
    expect(kinds(planMaterial(square, material(steelBase, 'flat'), sun))).toEqual(['form', 'ao'])
  })

  test('metal: the form body then the craft-correct edge sequence in order', () => {
    expect(kinds(planMaterial(square, material(steelBase, 'metal'), sun))).toEqual([
      'form',
      'rim',
      'ao',
      'cast',
    ])
  })

  test('the form body carries the base colour and a light with a positive z elevation', () => {
    const form = planMaterial(square, material(steelBase, 'metal'), sun).find(
      (o) => o.kind === 'form',
    )
    expect(form?.kind === 'form' && form.spec.base).toEqual(steelBase)
    // toward-light: in-plane points back at the source (up-left ⇒ both negative), z out of plane > 0.
    expect(form?.kind === 'form' && form.spec.light.x).toBeLessThan(0)
    expect(form?.kind === 'form' && form.spec.light.y).toBeLessThan(0)
    expect(form?.kind === 'form' && form.spec.light.z).toBeGreaterThan(0)
    expect(form?.kind === 'form' && form.spec.bands).toBeNull()
  })

  test('glow is self-illuminated: only fill + a self-light, never form/rim/ao/cast', () => {
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

  test('cast shadow lands only on drawn content down-light, never on empty canvas', () => {
    const c = ctx(24, 24)
    // an opaque wall just past the square's down-light (right) edge, drawn BEFORE the material.
    fillRegion(c, rectRegion(20, 4, 23, 19), color(120, 120, 120))
    lowerMaterial(c, square, material(steelBase, 'metal'), sun)
    // the cast reaches the wall and darkens it, but not the clean wall beyond the cast's reach.
    expect(lumAt(c, 20, 18)).toBeLessThan(lumAt(c, 23, 18))
    // the down-light margin over EMPTY canvas stays transparent — no detached grey blob (§5.14).
    expect(c.buffer.get(18, 21).a).toBe(0)
    // nothing sticks out on the light-facing side either.
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

describe('form (normal-based) shading: the ADR-0089 model default', () => {
  const smooth = (w: number, h: number): Context => ({
    buffer: new Framebuffer(w, h),
    mask: null,
    mode: 'smooth',
  })
  /** A disc centred at (16,16) r10 on a 32×32 canvas — a clean dome to read normals from. */
  const disc: Region = circleRegion(16, 16, 10)

  test('lightVec3 points back at the source (negated travel) with a positive z elevation', () => {
    const v = lightVec3(sun, disc) // sun travels down-right ⇒ toward-light is up-left, out of plane
    expect(v.x).toBeLessThan(0)
    expect(v.y).toBeLessThan(0)
    expect(v.z).toBeGreaterThan(0)
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 6)
  })

  test('brightest where the normal faces the light; darkest on the far side (follows the form)', () => {
    const c = smooth(32, 32)
    lowerMaterial(c, disc, material(steelBase, 'skin'), sun)
    const near = lumAt(c, 10, 10) // up-left slope: normal tilts toward the light
    const mid = lumAt(c, 16, 16) // spine: normal faces the viewer
    const far = lumAt(c, 22, 22) // down-right slope: normal tilts away
    // a monotone light→dark run along the light axis — the shading tracks the surface, not a bbox ramp
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(far)
  })

  test('the terminator is a soft gradient — many distinct tones, no single hard step', () => {
    const c = smooth(32, 32)
    lowerMaterial(c, disc, material(steelBase, 'skin'), sun)
    // sample the lit→shadow diagonal through the centre — interior only (|i−16| ≤ 7 stays inside
    // the r10 disc) and smooth mode, so neither the transparent rim nor dither confounds the run.
    const lums: number[] = []
    for (let i = 10; i <= 22; i++) {
      const p = c.buffer.get(i, i)
      expect(p.a).toBeGreaterThan(0)
      lums.push(p.r + p.g + p.b)
    }
    const distinct = new Set(lums)
    expect(distinct.size).toBeGreaterThanOrEqual(6) // a smooth ramp, not a 2-step linear cel
    let maxJump = 0
    for (let i = 1; i < lums.length; i++) {
      maxJump = Math.max(maxJump, Math.abs((lums[i] ?? 0) - (lums[i - 1] ?? 0)))
    }
    expect(maxJump).toBeLessThan(60) // no abrupt terminator cliff
  })

  test('cel quantizes the SAME field into exactly N form-following bands', () => {
    const c = ctx(32, 32)
    lowerCel(c, disc, material(steelBase, 'skin'), sun, 4)
    const seen = new Set<string>()
    for (let y = 6; y <= 25; y++) {
      for (let x = 6; x <= 25; x++) {
        const p = c.buffer.get(x, y)
        if (p.a > 0) {
          seen.add(`${p.r},${p.g},${p.b}`)
        }
      }
    }
    expect(seen.size).toBe(4)
    // the brightest band sits up-light, the darkest down-light — the bands wrap the form.
    expect(lumAt(c, 9, 9)).toBeGreaterThan(lumAt(c, 23, 23))
  })

  test('a dark base shadows to a still-legible tone, never pure #000000', () => {
    const c = ctx(32, 32)
    // a near-black leather base under a strong shade dose: the shadowTone L-floor must hold.
    lowerMaterial(c, disc, material(color(32, 24, 16), 'cloth', { shade: 1 }), sun)
    let min = 1000
    for (let y = 8; y <= 24; y++) {
      for (let x = 8; x <= 24; x++) {
        const p = c.buffer.get(x, y)
        if (p.a > 0) {
          min = Math.min(min, p.r + p.g + p.b)
        }
      }
    }
    expect(min).toBeGreaterThan(0)
  })

  test('formSpecOf carries the light doses and band count (bands=null for model, N for cel)', () => {
    const model = formSpecOf(disc, material(steelBase, 'metal'), sun, null)
    expect(model.bands).toBeNull()
    expect(model.base).toEqual(steelBase)
    expect(model.ambient).toBeCloseTo(0.15, 6) // from the sun's `amb … 15%`
    const cel = formSpecOf(disc, material(steelBase, 'metal'), sun, 5)
    expect(cel.bands).toBe(5)
  })
})
