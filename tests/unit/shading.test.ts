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

  test('the terminator is a soft, form-following gradient — not a hard cel step (ADR-0091)', () => {
    const c = smooth(32, 32)
    lowerMaterial(c, disc, material(steelBase, 'skin'), sun)
    // Sample the lit→shadow diagonal at a CONSTANT Bayer phase (step 4, the 4×4 period) so the
    // now-always-on smooth dither (ADR-0091) does not confound the underlying form gradient.
    const phase: number[] = []
    for (let i = 10; i <= 22; i += 4) {
      const p = c.buffer.get(i, i)
      expect(p.a).toBeGreaterThan(0)
      phase.push(p.r + p.g + p.b)
    }
    // strictly decreasing near→far: the shade follows the surface normal (Poisson dome), brightest
    // where it faces the light — and a genuine multi-step gradient, never a 2-band plateau+cliff.
    for (let i = 1; i < phase.length; i++) {
      expect(phase[i]).toBeLessThan(phase[i - 1] ?? 0)
    }
    expect(new Set(phase).size).toBeGreaterThanOrEqual(3)
    // the full-resolution run still carries many tones — a smooth ramp, not the old 2-step cel
    const lums: number[] = []
    for (let i = 10; i <= 22; i++) {
      lums.push(c.buffer.get(i, i).r + c.buffer.get(i, i).g + c.buffer.get(i, i).b)
    }
    expect(new Set(lums).size).toBeGreaterThanOrEqual(6)
  })

  test('cel quantizes the SAME field into exactly N form-following bands', () => {
    const c = ctx(32, 32)
    // cloth has spec 0, so no glint colour is added — exactly N band tones (ADR-0091).
    lowerCel(c, disc, material(steelBase, 'cloth'), sun, 4)
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

  test('cel adds a hard specular glint for a glossy response (ADR-0091)', () => {
    const c = ctx(32, 32)
    // metal has spec > 0: a hard glint in the spec colour appears above the s>0.5 threshold, so the
    // palette is the 4 band tones PLUS one distinct glint colour = 5 (no soft mix, a crisp glint).
    lowerCel(c, disc, material(steelBase, 'metal'), sun, 4)
    const seen = new Set<string>()
    for (let y = 6; y <= 25; y++) {
      for (let x = 6; x <= 25; x++) {
        const p = c.buffer.get(x, y)
        if (p.a > 0) {
          seen.add(`${p.r},${p.g},${p.b}`)
        }
      }
    }
    expect(seen.size).toBe(5)
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

describe('shading v2 (ADR-0091): Poisson height field, specular, dither, spread', () => {
  const smooth = (w: number, h: number): Context => ({
    buffer: new Framebuffer(w, h),
    mask: null,
    mode: 'smooth',
  })
  const disc: Region = circleRegion(16, 16, 10)
  const sum = (c: Context, x: number, y: number): number => {
    const p = c.buffer.get(x, y)
    return p.r + p.g + p.b
  }

  test('an elongated stripe has NO medial-axis ridge — a smooth half-cylinder across its width', () => {
    // horizontal stripe, light straight down ⇒ lit top edge, dark bottom. A Poisson half-cylinder
    // gives a smooth cross-section gradient; the old EDT "tent" gave two flat faces + a hard crease.
    const dn = light({ dir: { x: 0, y: 1 }, color: warm, amb: { color: cool, amount: 0.15 } })
    const stripe: Region = rectRegion(4, 20, 43, 29) // 40×10 bar in a 48-wide canvas
    const c = smooth(48, 48)
    lowerMaterial(c, stripe, material(steelBase, 'skin'), dn)
    const cross: number[] = []
    for (let y = 20; y <= 29; y++) {
      cross.push(sum(c, 24, y))
    }
    // many distinct levels across the 10px width — a gradient, never a 2-value tent (ridge signature)
    expect(new Set(cross).size).toBeGreaterThanOrEqual(6)
    // and the lit half is itself a gradient (adjacent rows differ), so there is no flat roof face
    expect(cross[2]).not.toBe(cross[4])
  })

  test('the specular hotspot sits on the light-facing bulge (up-light), not the shadow side', () => {
    const c = ctx(32, 32)
    lowerMaterial(c, disc, material(steelBase, 'metal'), sun)
    let best = -1
    let bx = 0
    let by = 0
    for (let y = 6; y <= 25; y++) {
      for (let x = 6; x <= 25; x++) {
        const l = lumAt(c, x, y)
        if (l > best) {
          best = l
          bx = x
          by = y
        }
      }
    }
    // the sun travels down-right, so its hotspot lands up-left of the disc centre (16, 16)
    expect(bx).toBeLessThan(16)
    expect(by).toBeLessThan(16)
  })

  test('specular lifts a glossy metal but is exactly zero for cloth', () => {
    expect(formSpecOf(disc, material(steelBase, 'cloth'), sun, null).spec).toBe(0)
    expect(formSpecOf(disc, material(steelBase, 'metal'), sun, null).spec).toBeGreaterThan(0)
    // a metal with its spec forced off renders differently from the default glossy metal
    const glossy = ctx(32, 32)
    const matte = ctx(32, 32)
    lowerMaterial(glossy, disc, material(steelBase, 'metal'), sun)
    lowerMaterial(matte, disc, material(steelBase, 'metal', { spec: 0 }), sun)
    let diff = 0
    for (let y = 6; y <= 25; y++) {
      for (let x = 6; x <= 25; x++) {
        const a = glossy.buffer.get(x, y)
        const b = matte.buffer.get(x, y)
        if (a.r !== b.r || a.g !== b.g || a.b !== b.b) {
          diff++
        }
      }
    }
    expect(diff).toBeGreaterThan(20)
  })

  test('smooth shading is Bayer-dithered always (not only pixel mode) — a flat patch stipples', () => {
    // a broad flat region in SMOOTH mode: without ADR-0091 dither its interior would be one tone;
    // with the always-on Bayer dither a small interior patch carries several stipple tones.
    const c = smooth(24, 24)
    lowerMaterial(c, rectRegion(4, 4, 19, 19), material(steelBase, 'flat'), sun)
    const patch = new Set<string>()
    for (let y = 9; y <= 12; y++) {
      for (let x = 9; x <= 12; x++) {
        const p = c.buffer.get(x, y)
        patch.add(`${p.r},${p.g},${p.b}`)
      }
    }
    expect(patch.size).toBeGreaterThan(1)
  })

  test('cel band boundaries are Bayer-dithered — both adjacent band tones interleave at the seam', () => {
    const c = ctx(32, 32)
    lowerCel(c, disc, material(steelBase, 'cloth'), sun, 2)
    // a scanline through the terminator: a hard cel edge flips tone once; a dithered edge flips
    // back and forth several times across the ±0.5-band zone (both tones present in the seam).
    let transitions = 0
    let prev = ''
    for (let x = 7; x <= 25; x++) {
      const p = c.buffer.get(x, 16)
      if (p.a === 0) {
        continue
      }
      const key = `${p.r},${p.g},${p.b}`
      if (prev !== '' && key !== prev) {
        transitions++
      }
      prev = key
    }
    expect(transitions).toBeGreaterThan(1)
  })

  test('`spread` scales highlight and shadow symmetrically (the one-knob value-spread control)', () => {
    const base = formSpecOf(disc, material(steelBase, 'skin'), sun, null)
    const wide = formSpecOf(disc, material(steelBase, 'skin', { spread: 1.5 }), sun, null)
    expect(wide.shade).toBeCloseTo(base.shade * 1.5, 6)
    expect(wide.hi).toBeCloseTo(base.hi * 1.5, 6)
  })

  test('`puff` override replaces the response curvature gain', () => {
    expect(formSpecOf(disc, material(steelBase, 'cloth'), sun, null).puff).toBeCloseTo(1.125, 6)
    expect(formSpecOf(disc, material(steelBase, 'metal'), sun, null).puff).toBeCloseTo(1.5, 6)
    expect(formSpecOf(disc, material(steelBase, 'metal', { puff: 2.4 }), sun, null).puff).toBe(2.4)
  })

  test('form shading is deterministic — rendering twice is byte-identical', () => {
    const a = ctx(32, 32)
    const b = ctx(32, 32)
    lowerMaterial(a, disc, material(steelBase, 'metal'), sun)
    lowerMaterial(b, disc, material(steelBase, 'metal'), sun)
    expect(a.buffer.data).toEqual(b.buffer.data)
  })
})

describe('shading v2 (ADR-0091 W2-1b): drape profile + over-union co-shading', () => {
  const smooth = (w: number, h: number): Context => ({
    buffer: new Framebuffer(w, h),
    mask: null,
    mode: 'smooth',
  })
  const clothBase = color(74, 63, 86) // #4a3f56
  /** Mean luminance across the full width of a bar at row `y` (averages out the Bayer dither). */
  const rowMean = (c: Context, x0: number, x1: number, y: number): number => {
    let s = 0
    let n = 0
    for (let x = x0; x <= x1; x++) {
      const p = c.buffer.get(x, y)
      if (p.a > 0) {
        s += relativeLuminance(p.r, p.g, p.b, p.a)
        n++
      }
    }
    return n > 0 ? s / n : 0
  }

  test('formSpecOf carries the profile (round by default, drape when the material sets it)', () => {
    expect(formSpecOf(square, material(clothBase, 'cloth'), sun, null).profile).toBe('round')
    expect(
      formSpecOf(square, material(clothBase, 'cloth', { profile: 'drape' }), sun, null).profile,
    ).toBe('drape')
  })

  test('drape has NO down-length intensity gradient (no turtle-shell); round darkens toward the far end', () => {
    // A tall constant-width bar under a straight-DOWN light. The round 2D field pins its top and
    // bottom to zero, so the far (bottom) end falls into shadow — the "turtle-shell". The drape
    // per-row field never pins the length, so top and bottom read the same tone.
    const dn = light({ dir: { x: 0, y: 1 }, color: warm, amb: { color: cool, amount: 0.15 } })
    const bar: Region = rectRegion(20, 4, 27, 43) // 8 wide, 40 tall
    const roundC = smooth(48, 48)
    const drapeC = smooth(48, 48)
    lowerMaterial(roundC, bar, material(clothBase, 'cloth'), dn)
    lowerMaterial(drapeC, bar, material(clothBase, 'cloth', { profile: 'drape' }), dn)
    // compare the top edge (y5) with the bottom edge (y42) — where the length-wise field difference
    // shows: the round field pins both ends, dropping the shadow-side (bottom) toward black.
    const roundGap = rowMean(roundC, 20, 27, 5) - rowMean(roundC, 20, 27, 42)
    const drapeGap = rowMean(drapeC, 20, 27, 5) - rowMean(drapeC, 20, 27, 42)
    // round: the top edge is clearly brighter than the bottom edge (a vertical gradient / turtle-shell)
    expect(roundGap).toBeGreaterThan(0.03)
    // drape: top and bottom edges read essentially the same — the length does not darken
    expect(Math.abs(drapeGap)).toBeLessThan(0.015)
    expect(roundGap).toBeGreaterThan(Math.abs(drapeGap) + 0.02)
  })

  test('drape still curves ACROSS its width — a side light lights one edge, shades the other', () => {
    // straight-RIGHT light (source left) on the same bar: the drape half-tube must read a
    // left-to-right value falloff (curvature across the row), proving it is not simply flat.
    const rt = light({ dir: { x: 1, y: 0 }, color: warm, amb: { color: cool, amount: 0.15 } })
    const bar: Region = rectRegion(20, 4, 27, 43)
    const c = smooth(48, 48)
    lowerMaterial(c, bar, material(clothBase, 'cloth', { profile: 'drape' }), rt)
    // left column mean (over the length) brighter than the right column mean
    const leftMean = [12, 20, 28, 36].reduce((s, y) => s + lumAt(c, 21, y), 0) / 4
    const rightMean = [12, 20, 28, 36].reduce((s, y) => s + lumAt(c, 26, y), 0) / 4
    expect(leftMean).toBeGreaterThan(rightMean + 0.03)
  })

  test('`over` union co-shades across a part seam — one continuous field, no restart terminator', () => {
    // upper + lower halves of one tall bar, straight-DOWN light. Shading the lower half ALONE lets
    // its own top edge (the seam) read as a lit boundary — a false terminator. Shading it `over` the
    // union makes the seam row continue the interior field, so it matches the interior tone.
    const dn = light({ dir: { x: 0, y: 1 }, color: warm, amb: { color: cool, amount: 0.15 } })
    const seam = 24
    const lower: Region = rectRegion(20, seam, 27, 43)
    const union: Region = rectRegion(20, 4, 27, 43)
    const alone = smooth(48, 48)
    const over = smooth(48, 48)
    lowerMaterial(alone, lower, material(clothBase, 'cloth'), dn)
    lowerMaterial(over, lower, material(clothBase, 'cloth'), dn, union)
    const interiorRow = 38
    // alone: the lower part's own top edge (the seam) faces the up-light — a false lit terminator,
    // brighter than the part interior.
    const aloneSeamLift = rowMean(alone, 20, 27, seam) - rowMean(alone, 20, 27, interiorRow)
    // over: the seam is deep interior of the union field — it continues the interior tone, no lift.
    const overSeamLift = rowMean(over, 20, 27, seam) - rowMean(over, 20, 27, interiorRow)
    expect(aloneSeamLift).toBeGreaterThan(0.008)
    expect(Math.abs(overSeamLift)).toBeLessThan(aloneSeamLift)
    // the seam row itself is brighter shaded alone than co-shaded (the visible seam the fix removes)
    expect(rowMean(alone, 20, 27, seam)).toBeGreaterThan(rowMean(over, 20, 27, seam) + 0.008)
    // `over` paints ONLY the lower region — the upper half stays untouched (transparent)
    expect(over.buffer.get(23, 10).a).toBe(0)
  })

  test('planMaterial attaches the `over` field only when a field region is passed', () => {
    const union: Region = rectRegion(20, 4, 27, 43)
    const plain = planMaterial(square, material(clothBase, 'cloth'), sun)
    const co = planMaterial(square, material(clothBase, 'cloth'), sun, union)
    const plainForm = plain.find((o) => o.kind === 'form')
    const coForm = co.find((o) => o.kind === 'form')
    expect(plainForm?.kind === 'form' && plainForm.field).toBeUndefined()
    expect(coForm?.kind === 'form' && coForm.field).toBe(union)
  })

  test('drape shading is deterministic — rendering twice is byte-identical', () => {
    const bar: Region = rectRegion(20, 4, 27, 43)
    const a = smooth(48, 48)
    const b = smooth(48, 48)
    lowerMaterial(a, bar, material(clothBase, 'cloth', { profile: 'drape' }), sun)
    lowerMaterial(b, bar, material(clothBase, 'cloth', { profile: 'drape' }), sun)
    expect(a.buffer.data).toEqual(b.buffer.data)
  })
})
