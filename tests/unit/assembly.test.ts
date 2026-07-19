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

  test('back-to-front layering: a part fitted before its covering part is stamped over it does NOT warn (final-composite check)', () => {
    // `arm` fits onto a bare canvas point with nothing painted nearby yet (a real gap at
    // fit-STATEMENT time), then `torso` is stamped AFTERWARD and its footprint reaches past
    // arm's own edge — touching it in the FINAL composite. This is the deliberate back-to-front
    // layering the character-DX 2026-07-10 rerun found (feet fitted before the covering robe is
    // stamped over them): the deferred W010 check reads the buffer once the whole body has
    // painted, so this must NOT warn.
    const layered = [
      PARTS,
      'draw fig 30x30:',
      '  pin free.spot 20:10', // bare canvas point, unconnected to anything drawn so far
      '  fit arm.shoulder free.spot', // arm lands at (20,8); nothing painted nearby yet
      '  stamp torso 15:2', // painted AFTER: torso (x15..26,y2..21) reaches past arm's left edge (x20)
    ].join('\n')
    const { engine } = renderWith(layered, 'fig')
    expect(engine.warnings).toHaveLength(0)
  })

  test('back-to-front layering: a part whose gap is never covered still warns W010', () => {
    // Same shape as above, but `torso` stays far from `arm` — nothing ever touches it, so the
    // gap is real by the end of the body and must still warn.
    const stillGap = [
      PARTS,
      'draw fig 34x34:',
      '  pin free.spot 30:30',
      '  fit arm.shoulder free.spot', // arm lands at (30,28), far corner
      '  stamp torso 4:2', // torso (x4..15,y2..21) never reaches the arm
    ].join('\n')
    const { engine } = renderWith(stillGap, 'fig')
    expect(engine.warnings).toHaveLength(1)
    expect(engine.warnings[0]?.code).toBe('W010')
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
    // The foot lands at x15..16; the pool anchors under the footprint bottom (the feet) and spreads
    // out to ~x12 — a shadow-only pixel beside the narrow foot, over bare ground.
    expect(px(withShadow, 12, 22)).not.toEqual(px(noShadow, 12, 22))
    // and it reads cooler (more blue) than the bare warm-green ground there.
    expect(px(withShadow, 12, 22)[2]).toBeGreaterThan(px(noShadow, 12, 22)[2])
  })

  test('shadow anchors under the feet (footprint bottom), not the fit pin', () => {
    // a leg fitted joint-to-joint: its `hip` pin lands on the torso hip, far above the leg's foot.
    // The contact pool must pool under the FOOT (footprint bottom), not up at the hip pin. The leg
    // has a wide thigh and a narrow shin, so the foot-anchored pool peeks out beside the shin.
    const src = [
      'draw torso 8x12:',
      '  fill #6a5030 rect(0:0, 7:11)',
      '  pin hip 4:11',
      'draw leg 8x16:',
      '  fill #7a5a2a rect(0:0, 7:3)', // wide thigh
      '  fill #7a5a2a rect(3:4, 4:15)', // narrow shin to the foot
      '  pin hip 4:0',
      '  pin foot 4:15',
      'draw scene 24x40:',
      '  fill #3a5a2a rect(0:30, 23:39)', // warm-green ground band, low in the canvas
      '  stamp torso 8:6', // torso canvas y6..17
      '  pin torso.hip 12:17',
      '  fit leg.hip torso.hip shadow', // leg hangs down; foot lands at canvas (12, 32)
    ].join('\n')
    const s = render(src, 'scene')
    // beside the narrow shin at foot level (over ground) the pool reads cooler (bluer) than the
    // bare warm-green ground away from it — the pool is under the FEET, where the OLD hip-anchored
    // behaviour dropped nothing (footB would equal groundB).
    const [, , footB] = px(s, 9, 32)
    const [, , groundB] = px(s, 3, 32)
    expect(footB).toBeGreaterThan(groundB)
  })
})

// A `model`'s cast is clipped to already-drawn content: the band is the region's silhouette offset
// down-light, minus the region, minus every transparent pixel. It falls on a neighbour region drawn
// earlier in the same `draw` (a deliberate down-light cast) but never bakes onto empty canvas — a
// part rendered in isolation therefore casts nothing at model time (no detached grey blob, §5.14).
// Grounding for assembled figures comes from `fit … shadow`, not a baked material cast
// (ADR-0086/0087; language-spec § Light & material).
describe('material cast is clipped to drawn content (ADR-0086/0087)', () => {
  const PART = [
    'light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%',
    'draw blockA 20x20:', // region smaller than the canvas, so the cast band would have margin
    '  model rect(2:2, 11:11) #8a95a5 metal light sun',
    '  pin corner 11:11',
  ].join('\n')

  test("a part's model cast paints nothing on its own transparent margin (no floating blob)", () => {
    const a = render(PART, 'blockA')
    // region interior is opaque metal.
    expect(alpha(a, 6, 6)).toBe(255)
    // the down-light margin just past the region (region max x/y is 11) stays fully transparent:
    // the cast no longer bakes a detached grey blob onto empty canvas (character-DX §5.14).
    expect(alpha(a, 12, 6)).toBe(0)
    expect(alpha(a, 6, 12)).toBe(0)
  })

  test('a model cast DOES fall on an opaque neighbour drawn earlier in the same draw (down-light)', () => {
    const src = [
      'light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%',
      'draw scene 24x24:',
      '  fill #6a6a6a rect(16:2, 21:21)', // a wall down-light of the block, drawn FIRST (opaque)
      '  model rect(2:2, 15:15) #8a95a5 metal light sun',
    ].join('\n')
    const a = render(src, 'scene')
    // the block's cast band (offset down-right) lands on the wall and darkens its near column,
    // while the wall beyond the cast's reach stays at its flat grey — cast on content, not on void.
    expect(px(a, 16, 10)[0]).toBeLessThan(px(a, 21, 10)[0])
  })

  test('two model parts assembled via fit keep independent shading and render deterministically', () => {
    const asm = [
      PART,
      'draw blockB 20x20:',
      '  model rect(2:2, 11:11) #b04040 metal light sun',
      '  pin top 2:2',
      'draw fig 40x40:',
      '  stamp blockA 2:2', // blockA region → canvas 4..13
      '  pin blockA.corner 13:13',
      '  fit blockB.top blockA.corner', // blockB stamped ON TOP → region canvas 13..22
    ].join('\n')
    const a = render(asm, 'fig')
    const b = render(asm, 'fig')
    // deterministic: two renders are byte-identical.
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
    // blockA-only pixel reads cool grey (metal base #8a95a5, b>r); blockB-only pixel reads warm red
    // (base #b04040, r>b) — each part kept its own material through assembly, no cross-region bleed.
    const [ar, , ab] = px(a, 6, 6)
    expect(ab).toBeGreaterThanOrEqual(ar)
    const [br, , bb] = px(a, 20, 20)
    expect(br).toBeGreaterThan(bb)
  })
})

// Render with the `--explain` placement trace enabled (ADR-0087 amendment 2) so a test can read
// exactly where each `fit` landed its pins and how far the target pin sits from the part's ink.
const renderPlacements = (
  src: string,
  drawing: string,
): { sprite: Sprite; engine: Engine; placements: NonNullable<Engine['placements']> } => {
  const engine = new Engine(process.cwd())
  engine.placements = []
  const mod = engine.loadSource(src, `${process.cwd()}\\asm${n++}.drw`, 'asm.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  const sprite = engine.defToSprite(entry, { line: 1, column: 1 })
  return { sprite, engine, placements: engine.placements }
}

describe('pin — HEAD.KEY seeds ALL the part pins (§5.8 fix, ADR-0087 amendment 2)', () => {
  test('a later fit chains off a pin the manual `pin` never named', () => {
    const src = [
      'draw torso 12x20:',
      '  fill #6a5030 rect(0:0, 11:19)',
      '  pin shoulder 10:3',
      '  pin hip 6:18',
      'draw tag 4x4:',
      '  fill #8a5a3a rect(0:0, 3:3)',
      '  pin p 2:3',
      'draw fig 30x30:',
      '  stamp torso 4:2', // origin (4,2)
      '  pin torso.shoulder 14:5', // names only `shoulder`; must ALSO seed torso.hip = (10,20)
      '  fit tag.p torso.hip', // pre-fix: throws (torso.hip unregistered)
    ].join('\n')
    const { engine } = renderWith(src, 'fig')
    // torso.hip seeded → the chained fit resolves and makes contact (no gap warning).
    expect(engine.warnings.filter((w) => w.code === 'W010')).toHaveLength(0)
  })

  test('a bare hand-labelled anchor (unknown head) still registers just the one key', () => {
    // `a` is not a part → single-key registration, so the knight's `pin a.hipL …` idiom keeps working.
    const src = [
      'draw bit 4x4:',
      '  fill #8a5a3a rect(0:0, 3:3)',
      '  pin p 0:0',
      'draw fig 20x20:',
      '  fill #6a5030 rect(2:2, 9:9)',
      '  pin a.spot 3:3',
      '  fit bit.p a.spot',
    ].join('\n')
    const { engine } = renderWith(src, 'fig')
    expect(engine.warnings.filter((w) => w.code === 'W011')).toHaveLength(0)
  })
})

describe('fit — placement correctness through transforms (ADR-0087 amendment 2)', () => {
  const T = [
    'draw torso 12x20:',
    '  fill #6a5030 rect(0:0, 11:19)',
    '  pin socket 6:10',
    'draw arm 6x14:',
    '  fill #8a5a3a rect(0:0, 5:13)',
    '  pin shoulder 0:2', // LEFT edge of the arm
    '  pin wrist 5:13', // RIGHT edge of the arm
  ].join('\n')

  test('a plain fit lands the pin exactly (coincident, on the ink)', () => {
    const src = [
      T,
      'draw fig 30x30:',
      '  stamp torso 4:2',
      '  pin torso.socket 10:12',
      '  fit arm.shoulder torso.socket',
    ].join('\n')
    const { placements } = renderPlacements(src, 'fig')
    const p = placements.find((r) => r.target === 'arm.shoulder')
    expect(p).toBeDefined()
    expect(p?.landed).toEqual({ x: 10, y: 12 })
    expect(p?.coincident).toBe(true)
    expect(p?.pinToInk).toBe(0)
    expect(p?.transformed).toBe(false)
  })

  test('fit … flipx keeps the (now-mirrored) pin exactly coincident — the pin rides the transform', () => {
    const src = [
      T,
      'draw fig 30x30:',
      '  stamp torso 4:2',
      '  pin torso.socket 10:12',
      '  fit arm.shoulder torso.socket flipx',
    ].join('\n')
    const { sprite, placements } = renderPlacements(src, 'fig')
    const p = placements.find((r) => r.target === 'arm.shoulder')
    // arm is 6 wide; flipx maps shoulder(0,2)→(5,2). origin=(10-5,12-2)=(5,10); painted pin=(10,12).
    expect(p?.landed).toEqual({ x: 10, y: 12 })
    expect(p?.coincident).toBe(true)
    expect(p?.transformed).toBe(true)
    // the arm pixel is actually there (the pin is on solid ink, not floating).
    expect(alpha(sprite, 10, 12)).toBeGreaterThan(0)
  })

  test('a fitted part registers its OTHER pins through the SAME transform (left→right after flipx)', () => {
    const src = [
      T,
      'draw cap 3x3:',
      '  fill #d8a070 rect(0:0, 2:2)',
      '  pin p 1:1',
      'draw fig 34x34:',
      '  stamp torso 4:2',
      '  pin torso.socket 12:12',
      '  fit arm.shoulder torso.socket flipx', // arm origin (7,10); wrist(5,13)→flip(0,13)→canvas(7,23)
      '  fit cap.p arm.wrist', // chains off the transformed wrist pin
    ].join('\n')
    const { placements } = renderPlacements(src, 'fig')
    const cap = placements.find((r) => r.target === 'cap.p')
    // wrist rode the flip to canvas (7,23); cap.p(1,1) → origin (6,22); cap.p lands back on (7,23).
    expect(cap?.landed).toEqual({ x: 7, y: 23 })
    expect(cap?.coincident).toBe(true)
  })
})

describe('fit — held-prop orientation is constant across views (HV6, ADR-0087 amendment 2)', () => {
  // A sword authored blade-UP (top rows) / grip-DOWN (bottom rows), gripped by its grip pin.
  const PROP = [
    'draw sword 6x20:',
    '  fill #d0d0d0 rect(2:0, 3:11)', // blade — the TOP half
    '  fill #442200 rect(2:13, 3:18)', // grip — the BOTTOM half
    '  pin grip 3:16',
    'draw hand 6x6:',
    '  fill #e0b080 rect(0:0, 5:5)',
    '  pin grip 3:3',
  ].join('\n')

  // The row of the topmost blade pixel and the bottom grip pixel in column-of-the-sword — used to
  // assert the blade stays ABOVE the grip (orientation up) regardless of the figure's per-view flip.
  const bladeAboveGrip = (s: Sprite): boolean => {
    let bladeTop = Number.POSITIVE_INFINITY
    let gripBottom = -1
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        const [r, g, b, a] = px(s, x, y)
        if (a === 0) {
          continue
        }
        if (r > 190 && g > 190 && b > 190) {
          bladeTop = Math.min(bladeTop, y) // light-grey blade
        }
        if (r > 40 && r < 90 && b < 40) {
          gripBottom = Math.max(gripBottom, y) // dark-brown grip
        }
      }
    }
    return bladeTop < gripBottom
  }

  test('the prop keeps blade-up when fitted by its grip in a plain view', () => {
    const src = [
      PROP,
      'draw view 30x30:',
      '  fill #6a5030 rect(8:6, 21:26)', // body
      '  pin body.hand 20:14',
      '  fit hand.grip body.hand',
      '  fit sword.grip hand.grip',
    ].join('\n')
    const s = render(src, 'view')
    expect(bladeAboveGrip(s)).toBe(true)
  })

  test('a per-view figure flip does NOT invert the prop — blade stays up when the body is flipx', () => {
    // Same fit, but the body/hand are mirrored for a side/back view. Fitting the sword by its grip
    // (no sword flip) must keep the blade up — the HV6 regression was a per-view flip reversing it.
    const src = [
      PROP,
      'draw view 30x30:',
      '  fill #6a5030 rect(8:6, 21:26) ', // body
      '  pin body.hand 10:14', // hand on the other side for the mirrored view
      '  fit hand.grip body.hand flipx', // the HAND mirrors with the figure…
      '  fit sword.grip hand.grip', // …but the sword is gripped as-authored: blade still UP
    ].join('\n')
    const s = render(src, 'view')
    expect(bladeAboveGrip(s)).toBe(true)
  })
})

describe('fit — placement self-check (W011 loose pin, ADR-0087 amendment 2)', () => {
  test('a target pin far from the part ink warns W011 even though the pins coincide', () => {
    const src = [
      'draw torso 12x20:',
      '  fill #6a5030 rect(0:0, 11:19)',
      '  pin neck 6:0',
      'draw badhead 12x18:',
      '  fill #f0c090 rect(1:0, 10:9)', // ink only in the TOP half (y0..9)
      '  pin chin 6:16', // 7px below the ink — a floating join
      'draw fig 34x34:',
      '  stamp torso 10:12',
      '  pin torso.neck 16:12',
      '  fit badhead.chin torso.neck',
    ].join('\n')
    const { engine, placements } = renderPlacements(src, 'fig')
    const w = engine.warnings.find((d) => d.code === 'W011')
    expect(w).toBeDefined()
    expect(w?.severity).toBe('warning')
    expect(w?.message).toContain('loose fit pin')
    // the placement record still reports coincidence (the pins DO meet) but flags the ink gap.
    const p = placements.find((r) => r.target === 'badhead.chin')
    expect(p?.coincident).toBe(true)
    expect(p?.pinToInk).toBeGreaterThan(2)
  })

  test('a pin on the part ink does NOT warn (no false positive)', () => {
    const src = [
      'draw torso 12x20:',
      '  fill #6a5030 rect(0:0, 11:19)',
      '  pin neck 6:0',
      'draw head 12x12:',
      '  fill #f0c090 rect(1:1, 10:11)',
      '  pin chin 6:11', // on the bottom ink row
      'draw fig 34x34:',
      '  stamp torso 10:12',
      '  pin torso.neck 16:12',
      '  fit head.chin torso.neck',
    ].join('\n')
    const { engine } = renderPlacements(src, 'fig')
    expect(engine.warnings.filter((d) => d.code === 'W011')).toHaveLength(0)
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
