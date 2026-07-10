// Phase 2c: `light`/`material` bindings, the `lit L:` block, and `model`/`cel` command verbs
// (ADR-0086). End-to-end where it matters (render → read pixels → assert) plus explain-trace
// and contextual-keyword-discipline checks. The sword recipe from the plan is the shared fixture.

import { describe, expect, test } from 'bun:test'
import { ramp, toHexColor } from '../../src/color.js'
import { DrawsticError } from '../../src/diagnostic.js'
import { Engine, type ExplainRecord } from '../../src/eval.js'
import type { Sprite } from '../../src/values.js'

let n = 0
const render = (src: string, drawing: string): Sprite => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\lm${n++}.drw`, 'lm.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  return engine.defToSprite(entry, { line: 1, column: 1 })
}

/** Render while collecting the `model`/`cel` explain trace (ADR-0086 §6). */
const renderWithExplain = (src: string, drawing: string): ExplainRecord[] => {
  const engine = new Engine(process.cwd())
  engine.explain = []
  const mod = engine.loadSource(src, `${process.cwd()}\\lm${n++}.drw`, 'lm.drw')
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
const lum = (s: Sprite, x: number, y: number): number => {
  const [r, g, b] = px(s, x, y)
  return r + g + b
}
/** Distinct opaque colours within an inclusive pixel box. */
const distinctColors = (s: Sprite, x0: number, y0: number, x1: number, y1: number): Set<string> => {
  const seen = new Set<string>()
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const [r, g, b, a] = px(s, x, y)
      if (a > 0) {
        seen.add(`${r},${g},${b}`)
      }
    }
  }
  return seen
}

describe('light + material bindings and the lit block', () => {
  test('one light drives shade + rim + cast coherently across a lit block', () => {
    // dir 1:0 → light travels right, so the source sits left: the left edge is lit (brighter),
    // the right side recedes into shade, and the cast falls to the right of the region.
    const s = render(
      [
        'light sun = dir 1:0 #ffe6b0 amb #2a3a5e 15%',
        'material steel = #8a95a5 metal',
        'draw blade 20x16:',
        '  body = rect(3:3, 14:12)',
        '  lit sun:',
        '    model body steel',
      ].join('\n'),
      'blade',
    )
    // lit (left) side is brighter than the shaded (right) side — one light, coherent gradient
    expect(lum(s, 5, 7)).toBeGreaterThan(lum(s, 12, 7))
    // a cast-shadow band lands just right of the region (down-light of dir 1:0), so a pixel
    // outside the body's right edge is now painted
    expect(px(s, 15, 7)[3]).toBeGreaterThan(0)
  })

  test('a lit block scopes the light to its body only (set/restore)', () => {
    // A `model` after the block closes has no light → hard error, proving the block did not leak.
    expect(() =>
      render(
        [
          'light sun = dir 1:1 #ffe6b0',
          'material steel = #8a95a5 metal',
          'draw x 12x12:',
          '  a = rect(1:1, 5:5)',
          '  b = rect(6:6, 10:10)',
          '  lit sun:',
          '    model a steel',
          '  model b steel',
        ].join('\n'),
        'x',
      ),
    ).toThrow(/needs a light/)
  })

  test('a point light (`at`) with gain renders and lights from its position', () => {
    const trace = renderWithExplain(
      [
        'light torch = at 4:4 #ffb060 gain 1.4',
        'material steel = #8a95a5 metal',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  lit torch:',
        '    model body steel',
      ].join('\n'),
      'x',
    )
    const shade = trace[0]?.steps.find((o) => o.op === 'shade')
    // a point light's shade point is its position verbatim (lightPointFor)
    expect(shade?.point).toEqual({ x: 4, y: 4 })
  })
})

describe('model / cel command verbs', () => {
  test('a bare colour material lowers as flat (no rim, no cast); metal adds both', () => {
    const src = (mat: string): string =>
      [
        'light sun = dir 1:1 #ffe6b0',
        'material steel = #8a95a5 metal',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  lit sun:',
        `    model body ${mat}`,
      ].join('\n')
    const flat = renderWithExplain(src('#8a95a5'), 'x')[0]
    const metal = renderWithExplain(src('steel'), 'x')[0]
    expect(flat?.steps.map((o) => o.op)).toEqual(['fill', 'shade', 'light', 'ao'])
    expect(metal?.steps.map((o) => o.op)).toEqual(['fill', 'shade', 'light', 'rim', 'ao', 'cast'])
  })

  test('an inline `COLOR RESPONSE` material is honoured (metal sequence on a fresh colour)', () => {
    const rec = renderWithExplain(
      [
        'light sun = dir 1:1 #ffe6b0',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  lit sun:',
        '    model body #b08040 metal',
      ].join('\n'),
      'x',
    )[0]
    expect(rec?.steps.map((o) => o.op)).toEqual(['fill', 'shade', 'light', 'rim', 'ao', 'cast'])
    expect(rec?.steps[0]?.color).toBe('#b08040')
  })

  test('cel paints exactly N distinct bands from the material base ramp', () => {
    const s = render(
      [
        'light sun = dir 1:1 #ffe6b0',
        'material steel = #8a95a5 metal',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  lit sun:',
        '    cel body steel 3',
      ].join('\n'),
      'x',
    )
    const colors = distinctColors(s, 2, 2, 13, 13)
    expect(colors.size).toBe(3)
    // the three colours are exactly `ramp(base, 3)`
    const expected = new Set(
      ramp({ type: 'color', r: 138, g: 149, b: 165, a: 255 }, 3).map(toHexColor),
    )
    const got = new Set(
      [...colors].map((c) => {
        const [r, g, b] = c.split(',').map(Number)
        return toHexColor({ type: 'color', r: r ?? 0, g: g ?? 0, b: b ?? 0, a: 255 })
      }),
    )
    expect(got).toEqual(expected)
  })

  test('an explicit `light L` argument works without any lit block', () => {
    const rec = renderWithExplain(
      [
        'light sun = dir 0:1 #ffe6b0',
        'material steel = #8a95a5 metal',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  model body steel light sun',
      ].join('\n'),
      'x',
    )[0]
    expect(rec?.command).toBe('model')
    expect(rec?.steps.map((o) => o.op)).toContain('rim')
  })

  test('no light in scope and no explicit light is a hard E024', () => {
    try {
      render(
        [
          'material steel = #8a95a5 metal',
          'draw x 12x12:',
          '  body = rect(2:2, 9:9)',
          '  model body steel',
        ].join('\n'),
        'x',
      )
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.toDiagnostic().code).toBe('E024')
      }
    }
  })

  test('a self-illuminated `glow` material only fills + self-lights (no shade/rim/cast)', () => {
    const rec = renderWithExplain(
      [
        'light sun = dir 1:1 #ffe6b0',
        'draw x 16x16:',
        '  orb = circle(8:8, 5)',
        '  lit sun:',
        '    model orb #ffcc40 glow',
      ].join('\n'),
      'x',
    )[0]
    expect(rec?.steps.map((o) => o.op)).toEqual(['fill', 'light'])
  })
})

describe('explain trace (render --explain guardrail)', () => {
  test('the sword fixture lowers to the documented per-material sequences', () => {
    const trace = renderWithExplain(
      [
        'light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%',
        'material steel = #8a95a5 metal',
        'draw sword 24x48:',
        '  blade  = rect(11:2, 13:30)',
        '  guard  = rect(7:31, 17:34)',
        '  grip   = rect(11:35, 13:44)',
        '  pommel = circle(12:46, 2)',
        '  lit sun:',
        '    model blade steel',
        '    model guard #b08040 metal',
        '    model grip  #3a2a1e',
        '    cel   pommel steel 3',
      ].join('\n'),
      'sword',
    )
    expect(trace.map((r) => `${r.command}:${r.region}`)).toEqual([
      'model:blade',
      'model:guard',
      'model:grip',
      'cel:pommel',
    ])
    // grip is a bare colour → flat (no rim/cast); the cel records its 3 bands
    expect(trace[2]?.steps.map((o) => o.op)).toEqual(['fill', 'shade', 'light', 'ao'])
    expect(trace[3]?.steps).toHaveLength(3)
    expect(trace[3]?.steps.every((o) => o.op === 'band')).toBe(true)
  })
})

describe('keyword discipline (new words stay contextual, D7)', () => {
  test('light/material/lit/model/cel/dir/glow remain ordinary bindable names', () => {
    // Every new keyword used as a plain binding + a command argument; `lit`/`dir`/`glow` as
    // names, `light`/`material`/`model`/`cel` as names — none may be globally reserved.
    const s = render(
      [
        'draw x 4x4:',
        '  light = #ff0000',
        '  material = #00ff00',
        '  lit = #0000ff',
        '  dir = 1:2',
        '  glow = #ffff00',
        '  model = #ff00ff',
        '  cel = #00ffff',
        '  fill light rect(0:0, 0:0)',
        '  fill material rect(1:0, 1:0)',
        '  fill lit rect(2:0, 2:0)',
        '  fill glow rect(3:0, 3:0)',
        '  fill model rect(0:1, 0:1)',
        '  fill cel rect(1:1, 1:1)',
      ].join('\n'),
      'x',
    )
    expect(px(s, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(s, 1, 0)).toEqual([0, 255, 0, 255])
    expect(px(s, 2, 0)).toEqual([0, 0, 255, 255])
    expect(px(s, 3, 0)).toEqual([255, 255, 0, 255])
    expect(px(s, 0, 1)).toEqual([255, 0, 255, 255])
    expect(px(s, 1, 1)).toEqual([0, 255, 255, 255])
  })

  test('an unknown material response is a positioned parse error', () => {
    expect(() => render('material bad = #808080 shiny\ndraw x 2x2:\n  px #fff 0:0', 'x')).toThrow(
      /unknown material response/,
    )
  })
})
