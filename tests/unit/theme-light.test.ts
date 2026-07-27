// Phase 2d: theme-level default light (ADR-0086 tier 3). A theme may carry a `light NAME = …`
import { join } from 'node:path'
// default; a `use`-applied theme establishes the drawing's outermost light, so every view/variant
// shares ONE source — structurally closing the "light mirrored per view" character bug. These
// tests prove that coherence numerically (render → read pixels → assert), plus the resolution
// order (explicit `light L` > `lit L:` block > theme default), determinism, and fold/fingerprint.

import { describe, expect, test } from 'bun:test'
import { DrawsticError } from '../../src/diagnostic.js'
import { Engine, type ExplainRecord } from '../../src/eval.js'
import type { Sprite } from '../../src/values.js'

let n = 0
const render = (src: string, drawing: string): Sprite => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, join(process.cwd(), `tl${n++}.drw`), 'tl.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  return engine.defToSprite(entry, { line: 1, column: 1 })
}

const renderWithExplain = (src: string, drawing: string): ExplainRecord[] => {
  const engine = new Engine(process.cwd())
  engine.explain = []
  const mod = engine.loadSource(src, join(process.cwd(), `tl${n++}.drw`), 'tl.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  engine.defToSprite(entry, { line: 1, column: 1 })
  return engine.explain ?? []
}

const px = (s: Sprite, x: number, y: number): [number, number, number, number] => {
  const i = (y * s.w + x) * 4
  return [s.data[i] ?? 0, s.data[i + 1] ?? 0, s.data[i + 2] ?? 0, s.data[i + 3] ?? 0]
}

/**
 * Mean luminance of the opaque left third vs right third of a sprite's covered bbox. A positive
 * `left − right` means the lit edge sits on the WORLD-LEFT — the invariant that must hold in every
 * view sharing one directional light, and that flips sign the moment the light is mirrored per view.
 */
const litSide = (s: Sprite): { left: number; right: number } => {
  let x0 = s.w
  let x1 = -1
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if ((px(s, x, y)[3] ?? 0) > 0) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
      }
    }
  }
  const span = x1 - x0 + 1
  const third = Math.max(1, Math.floor(span / 3))
  const meanLum = (from: number, to: number): number => {
    let sum = 0
    let count = 0
    for (let y = 0; y < s.h; y++) {
      for (let x = from; x <= to; x++) {
        const [r, g, b, a] = px(s, x, y)
        if (a > 0) {
          sum += r + g + b
          count++
        }
      }
    }
    return count === 0 ? 0 : sum / count
  }
  return { left: meanLum(x0, x0 + third - 1), right: meanLum(x1 - third + 1, x1) }
}

// A theme whose default light travels right (`dir 1:0`) — source is left, so the WORLD-LEFT edge
// is lit. Two genuinely different view poses (front is wider, side is a narrower forward-shifted
// mass — not a mirror) both stamp a `model … metal` part that reads this ONE theme light.
const TWO_VIEW = [
  'theme figTheme:',
  '  light sun = dir 1:0 #ffe6b0 amb #2a3a5e 15%',
  '',
  'use figTheme',
  '',
  'draw torsoFront(c) 14x18:',
  '  body = rect(3:2, 10:15)',
  '  model body c metal', // no lit block, no explicit light → inherits the theme default
  '',
  'draw torsoSide(c) 14x18:',
  '  body = rect(4:2, 9:15)', // a different (side) pose mass, deliberately NOT a flip of the front
  '  model body c metal',
  '',
  'draw front 18x22:',
  '  stamp torsoFront(#8a95a5) 2:2',
  '',
  'draw side 18x22:',
  '  stamp torsoSide(#8a95a5) 2:2',
].join('\n')

describe('theme-level default light drives shading (ADR-0086 tier 3)', () => {
  test('front and side share ONE light — lit edge is world-left in BOTH (not mirrored per view)', () => {
    const front = litSide(render(TWO_VIEW, 'front'))
    const side = litSide(render(TWO_VIEW, 'side'))
    // The whole point: no `lit` block anywhere, yet both views shade — the theme default reached
    // both `model` calls (through the stamp boundary, since the theme is file-scoped).
    expect(front.left).toBeGreaterThan(front.right)
    expect(side.left).toBeGreaterThan(side.right)
    // And the lit side agrees in sign across the two views: the light was NOT re-mirrored for the
    // side pose. If it had been (`dir -1:0` for side), `side.left < side.right` and this would fail.
    expect(Math.sign(front.left - front.right)).toBe(Math.sign(side.left - side.right))
  })

  test('a stamped part with no light in scope still errors when the theme carries none', () => {
    // Absent theme light is not a silent default — the hard E024 contract survives (ADR-0086 §2).
    expect(() =>
      render(
        [
          'theme bare:',
          '  size 14x18',
          'use bare',
          'draw torso(c) 14x18:',
          '  body = rect(3:2, 10:15)',
          '  model body c metal',
          'draw front 18x22:',
          '  stamp torso(#8a95a5) 2:2',
        ].join('\n'),
        'front',
      ),
    ).toThrow(/needs a light/)
  })
})

describe('theme carries `light` but not `material` (ADR-0086: materials live in module/draw scope)', () => {
  test('a `material NAME = …` in a theme body is a positioned E004, not a silent drop', () => {
    // The theme folds a `light` default (tier 3) but has no place for a material — it used to fall
    // into the fold's default branch and vanish (a latent footgun). Reject it at the declaration.
    let err: DrawsticError | undefined
    try {
      render(
        [
          'theme t:',
          '  size 10x10',
          '  material steel = #8a95a5 metal', // no place in a theme body
          'use t', // folding `t` (at load time) hits the material and throws
        ].join('\n'),
        'x',
      )
    } catch (e) {
      err = e as DrawsticError
    }
    expect(err).toBeInstanceOf(DrawsticError)
    expect(err?.code).toBe('E004')
    expect(err?.message).toContain("no place for the material 'steel'")
    // actionable hint points at module/draw scope, where `model`/`cel` reads a material.
    expect(err?.hint).toContain('module scope')
  })

  test('the same material at module scope, above the theme, is accepted', () => {
    // The fix rejects only the theme-body placement — module-scope materials keep working.
    expect(() =>
      render(
        [
          'material steel = #8a95a5 metal',
          'light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%',
          'theme t:',
          '  size 12x12',
          'use t',
          'draw x 12x12:',
          '  model rect(1:1, 10:10) steel light sun',
        ].join('\n'),
        'x',
      ),
    ).not.toThrow()
  })
})

describe('light resolution order: explicit `light L` > theme default', () => {
  const src = (inner: string): string =>
    [
      'theme t:',
      '  light themeSun = dir 1:0 #ffe6b0', // source-left ⇒ shade point x < region
      'light moon = dir -1:0 #a0c0ff', // source-right ⇒ shade point x > region
      'use t',
      'draw a 16x12:',
      '  body = rect(2:2, 13:9)',
      `  ${inner}`,
    ].join('\n')

  const shadePointX = (inner: string): number =>
    renderWithExplain(src(inner), 'a')[0]?.light?.x ?? Number.NaN

  test('theme default applies when there is no explicit light', () => {
    // sun travels right → synthetic source sits to the LEFT of the region → shade point x < 0.
    expect(shadePointX('model body #8a95a5 metal')).toBeLessThan(0)
  })

  test('an explicit `light L` argument overrides the theme default', () => {
    // moon travels left → source to the RIGHT → shade point x beyond the 16px canvas.
    expect(shadePointX('model body #8a95a5 metal light moon')).toBeGreaterThan(16)
  })
})

describe('determinism, folding, and fingerprint', () => {
  test('same recipe → identical pixels (theme light is fully deterministic)', () => {
    const a = render(TWO_VIEW, 'front')
    const b = render(TWO_VIEW, 'front')
    expect(Array.from(a.data)).toEqual(Array.from(b.data))
  })

  test('changing only the theme light colour changes the pixels (fingerprint has no stale cache)', () => {
    const warm = render(TWO_VIEW, 'front')
    const cold = render(TWO_VIEW.replace('#ffe6b0 amb', '#40c0ff amb'), 'front')
    expect(Array.from(warm.data)).not.toEqual(Array.from(cold.data))
  })

  test('a `with` fold takes the later theme part’s light (later wins, like size/mode/font)', () => {
    // leftLight then rightLight → combined resolves to rightLight (source-right → shade point > 16).
    const trace = renderWithExplain(
      [
        'theme leftLight:',
        '  light a = dir 1:0 #ffe6b0',
        'theme rightLight:',
        '  light b = dir -1:0 #ffe6b0',
        'theme combined:',
        '  with leftLight, rightLight',
        'use combined',
        'draw a 16x12:',
        '  body = rect(2:2, 13:9)',
        '  model body #8a95a5 metal',
      ].join('\n'),
      'a',
    )
    expect(trace[0]?.light?.x ?? Number.NaN).toBeGreaterThan(16)
  })
})
