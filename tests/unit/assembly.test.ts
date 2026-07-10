// Phase 3a: anchored assembly — `pin` attach-point declarations and `fit` contact-guaranteed
// placement (ADR-0087). End-to-end where it matters (render → read pixels → assert): pins export
// on the sprite, `fit` lands one part's pin on another's with pixel contact, a mis-pinned `fit`
// warns (W010) instead of failing silently, the ground-placement oracle plants a part exactly on a
// terrain function, the auto contact-shadow appears under the footprint, and the `pin`/`fit`
// keywords stay contextual (still bindable as ordinary names).

import { describe, expect, test } from 'bun:test'
import { critiqueSprite, resolveProfile } from '../../src/critique.js'
import { DrawsticError } from '../../src/diagnostic.js'
import { Engine } from '../../src/eval.js'
import type { Sprite } from '../../src/values.js'

let n = 0
const renderWith = (src: string, drawing: string): { sprite: Sprite; engine: Engine } => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\asm${n++}.drw`, 'asm.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  const sprite = engine.defToSprite(entry, { line: 1, column: 1 })
  return { sprite, engine }
}
const render = (src: string, drawing: string): Sprite => renderWith(src, drawing).sprite

const px = (s: Sprite, x: number, y: number): [number, number, number, number] => {
  const i = (y * s.w + x) * 4
  return [s.data[i] ?? 0, s.data[i + 1] ?? 0, s.data[i + 2] ?? 0, s.data[i + 3] ?? 0]
}
const alpha = (s: Sprite, x: number, y: number): number => px(s, x, y)[3]

// Two shared parts: a torso and an arm, each with named local attach points.
const PARTS = [
  'draw torso 12x20:',
  '  fill #6a5030 rect(0:0, 11:19)',
  '  pin shoulder 10:3',
  'draw arm 6x14:',
  '  fill #8a5a3a rect(0:0, 5:13)',
  '  pin shoulder 0:2',
  '  pin wrist 3:13',
].join('\n')

describe('pin — attach-point declaration', () => {
  test('a part exports its local pins on the rendered sprite', () => {
    const s = render(PARTS, 'torso')
    expect(s.pins).toBeDefined()
    expect(s.pins?.get('shoulder')).toEqual({ x: 10, y: 3 })
  })

  test('a drawing with no pins carries no pins map', () => {
    const s = render('draw plain 4x4:\n  fill #fff rect(0:0, 3:3)', 'plain')
    expect(s.pins).toBeUndefined()
  })

  test('pin needs an absolute point (E006 on a non-point)', () => {
    expect(() => render('draw d 4x4:\n  pin p 3', 'd')).toThrow(DrawsticError)
  })
})

describe('fit — contact-guaranteed placement', () => {
  const FIT_CONTACT = [
    PARTS,
    'draw fig 30x30:',
    '  stamp torso 4:2', // torso canvas x4..15, y2..21
    '  pin torso.shoulder 14:5', // a solid torso pixel
    '  fit arm.shoulder torso.shoulder', // arm.shoulder(0:2) → origin (14,3)
  ].join('\n')

  test('fit lands the pin exactly and makes pixel contact (no gap warning)', () => {
    const { sprite, engine } = renderWith(FIT_CONTACT, 'fig')
    // arm.shoulder local (0:2) mapped to the source pin 14:5 → an arm pixel sits there.
    expect(alpha(sprite, 14, 5)).toBeGreaterThan(0)
    // arm origin (14,3): its right columns overlap the torso (x4..15) → one connected mass.
    expect(alpha(sprite, 18, 10)).toBeGreaterThan(0) // arm body
    expect(engine.warnings).toHaveLength(0)
  })

  test('the assembled 2-part sprite is C007-clean under the character profile', () => {
    const s = render(FIT_CONTACT, 'fig')
    const report = critiqueSprite('fig', s, { profile: resolveProfile('character') })
    expect(report.checks.find((c) => c.code === 'C007')).toBeUndefined()
    expect(report.componentCount).toBe(1)
  })

  test('registers the fitted part pins so later fits chain', () => {
    const chained = [
      PARTS,
      'draw hand 4x4:',
      '  fill #d8a070 rect(0:0, 3:3)',
      '  pin wrist 2:2',
      'draw fig 34x34:',
      '  stamp torso 4:2',
      '  pin torso.shoulder 14:5',
      '  fit arm.shoulder torso.shoulder', // registers arm.wrist in canvas space
      '  fit hand.wrist arm.wrist', // chains off arm's now-placed wrist
    ].join('\n')
    const { engine } = renderWith(chained, 'fig')
    // arm origin (14,3) + wrist local (3:13) → canvas 17:16; hand.wrist(2:2) → hand origin (15,14).
    expect(engine.warnings).toHaveLength(0)
  })

  test('auto-matches a single shared pin name (bare fit)', () => {
    const auto = [
      PARTS,
      'draw fig 30x30:',
      '  stamp torso 4:2',
      '  pin torso.shoulder 14:5',
      '  fit arm torso', // both bare → shared pin name "shoulder"
    ].join('\n')
    const { sprite, engine } = renderWith(auto, 'fig')
    expect(alpha(sprite, 14, 5)).toBeGreaterThan(0)
    expect(engine.warnings).toHaveLength(0)
  })
})

describe('fit — gap reporting (contact guarantee, not silent)', () => {
  test('a mis-pinned fit warns W010 instead of failing silently', () => {
    const gap = [
      PARTS,
      'draw fig 34x34:',
      '  stamp torso 4:2', // torso far from the seed pin
      '  pin far.spot 30:30',
      '  fit arm.shoulder far.spot', // arm lands in empty space
    ].join('\n')
    const { engine } = renderWith(gap, 'fig')
    expect(engine.warnings).toHaveLength(1)
    const w = engine.warnings[0]
    expect(w?.code).toBe('W010')
    expect(w?.severity).toBe('warning')
    expect(w?.message).toContain('fit gap')
  })

  test('a bbox-overlapping gap is caught by critique C007', () => {
    // An L-shaped torso: its bbox spans the whole figure, but the top-right quadrant is empty.
    // A part fit into that quadrant overlaps the bbox yet stays pixels clear → the C007 seam.
    const seam = [
      'draw ell 20x20:',
      '  fill #6a5030 rect(0:0, 3:19)', // vertical bar x0..3
      '  fill #6a5030 rect(0:16, 19:19)', // foot x0..19 → bbox is the full 20x20
      '  pin corner 16:4',
      'draw bit 4x4:',
      '  fill #8a5a3a rect(0:0, 3:3)',
      '  pin p 0:0',
      'draw fig 24x24:',
      '  stamp ell 0:0',
      '  pin ell.corner 16:4', // inside ell bbox, far from ell pixels
      '  fit bit.p ell.corner',
    ].join('\n')
    const s = render(seam, 'fig')
    const report = critiqueSprite('fig', s, { profile: resolveProfile('character') })
    expect(report.componentCount).toBe(2)
    expect(report.checks.find((c) => c.code === 'C007')).toBeDefined()
  })
})

describe('fit — ground-placement oracle (fit onto a terrain function)', () => {
  const ORACLE = [
    'fn groundY(nx) = 20 + round(nx * 4)',
    'draw post 8x12:',
    '  fill #7a5a2a rect(0:0, 7:11)',
    '  pin base 4:11', // bottom-centre
    'draw scene 30x30:',
    '  fill #3a5a2a rect(0:20, 29:29)', // terrain band
    '  fit post.base 15:groundY(15/29)', // plant the base exactly on the terrain line
  ].join('\n')

  test('plants the base pin exactly on the terrain line (no float, no sink)', () => {
    const { sprite, engine } = renderWith(ORACLE, 'scene')
    // groundY(15/29)=20+round(0.517*4)=22 → base at canvas (15,22).
    const [r, , , a] = px(sprite, 15, 22)
    expect(a).toBeGreaterThan(0)
    expect(r).toBe(0x7a) // the post base pixel, not the ground green
    // one row lower is still terrain (the post does not sink past its base row).
    expect(px(sprite, 15, 24)[0]).toBe(0x3a)
    // touches the ground → no gap warning.
    expect(engine.warnings).toHaveLength(0)
  })

  test('fit onto a bare point without a named target pin is a positioned error', () => {
    const bad = [
      'draw post 8x12:',
      '  fill #7a5a2a rect(0:0, 7:11)',
      '  pin base 4:11',
      'draw scene 30x30:',
      '  fit post 15:22', // no target pin, point source → ambiguous
    ].join('\n')
    expect(() => render(bad, 'scene')).toThrow(DrawsticError)
  })
})

describe('fit shadow — auto contact-shadow', () => {
  test('shadow drops a cool pool under the footprint (opt-in)', () => {
    const base = [
      'draw post 12x12:',
      '  fill #7a5a2a rect(0:0, 11:9)', // wide body
      '  fill #7a5a2a rect(5:10, 6:11)', // narrow foot
      '  pin base 5:11',
      'draw scene 30x30:',
      '  fill #3a5a2a rect(0:20, 29:29)',
    ]
    const withShadow = render([...base, '  fit post.base 15:22 shadow'].join('\n'), 'scene')
    const noShadow = render([...base, '  fit post.base 15:22'].join('\n'), 'scene')
    // The foot lands at x15..16; the contact ellipse (rx≈5 about x15) pools out to
    // x10 — a shadow-only pixel beside the narrow foot, over bare ground.
    expect(px(withShadow, 10, 22)).not.toEqual(px(noShadow, 10, 22))
    // and it reads cooler (more blue) than the bare warm-green ground there.
    expect(px(withShadow, 10, 22)[2]).toBeGreaterThan(px(noShadow, 10, 22)[2])
  })
})

describe('pin / fit — contextual keyword discipline', () => {
  test('pin and fit stay bindable as ordinary names', () => {
    const src = [
      'draw d 8x8:',
      '  pin = 2', // `pin` as a binding
      '  fit = 5', // `fit` as a binding
      '  fill #fff rect(pin:pin, fit:fit)',
    ].join('\n')
    const s = render(src, 'd')
    expect(alpha(s, 3, 3)).toBeGreaterThan(0) // painted inside rect(2:2, 5:5)
    expect(alpha(s, 6, 6)).toBe(0)
  })
})
