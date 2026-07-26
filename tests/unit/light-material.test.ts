// Phase 2c: `light`/`material` bindings and the `model`/`cel` command verbs (ADR-0086); the light
// is supplied by the theme default or an explicit `light L` argument (the `lit L:` block was removed
// in ADR-0094). End-to-end where it matters (render → read pixels → assert) plus explain-trace and
// contextual-keyword-discipline checks. The sword recipe from the plan is the shared fixture.

import { describe, expect, test } from 'bun:test'
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

describe('light + material bindings and explicit light args', () => {
  test('one light drives shade + rim + cast coherently through a model', () => {
    // dir 1:0 → light travels right, so the source sits left: the left edge is lit (brighter),
    // the right side recedes into shade, and the cast falls right, onto a wall drawn there first.
    const s = render(
      [
        'light sun = dir 1:0 #ffe6b0 amb #2a3a5e 15%',
        'material steel = #8a95a5 metal',
        'draw blade 22x16:',
        '  fill #6a6a6a rect(15:3, 21:12)',
        '  body = rect(3:3, 14:12)',
        '  model body steel light sun',
      ].join('\n'),
      'blade',
    )
    // lit (left) side is brighter than the shaded (right) side — one light, coherent gradient
    expect(lum(s, 5, 7)).toBeGreaterThan(lum(s, 12, 7))
    // the cast-shadow band lands on the wall just right of the body and darkens it, while the wall
    // beyond the cast's reach stays clean — the cast lands on drawn content, never on empty canvas.
    expect(lum(s, 15, 7)).toBeLessThan(lum(s, 20, 7))
  })

  test('an explicit `light L` argument does not leak to the next statement', () => {
    // Two module lights (ADR-0096 §4 keeps this ambiguous — ADR-0096 §4's sole-module-light
    // fallback only fires for exactly one) so the next `model`, with no light of its own, still
    // hard-E024s instead of silently reusing `sun` — proving the explicit arg is per-statement.
    expect(() =>
      render(
        [
          'light sun = dir 1:1 #ffe6b0',
          'light moon = dir -1:1 #b0c4ff',
          'material steel = #8a95a5 metal',
          'draw x 12x12:',
          '  a = rect(1:1, 5:5)',
          '  b = rect(6:6, 10:10)',
          '  model a steel light sun',
          '  model b steel',
        ].join('\n'),
        'x',
      ),
    ).toThrow(/E024|light/)
  })

  test('a point light (`at`) with gain renders and lights from its position', () => {
    const trace = renderWithExplain(
      [
        'light torch = at 4:4 #ffb060 gain 1.4',
        'material steel = #8a95a5 metal',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  model body steel light torch',
      ].join('\n'),
      'x',
    )
    // a point light's resolved light point is its position verbatim (lightPointFor)
    expect(trace[0]?.light).toEqual({ x: 4, y: 4 })
    // and the form body's toward-light vector points back at that corner source (up-left ⇒ negative)
    const form = trace[0]?.steps.find((o) => o.op === 'form')
    expect(form?.dir?.x).toBeLessThan(0)
    expect(form?.dir?.y).toBeLessThan(0)
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
        `  model body ${mat} light sun`,
      ].join('\n')
    const flat = renderWithExplain(src('#8a95a5'), 'x')[0]
    const metal = renderWithExplain(src('steel'), 'x')[0]
    // ADR-0089: the form body replaces the shade+light distance veils; edges (rim/ao/cast) unchanged.
    expect(flat?.steps.map((o) => o.op)).toEqual(['form', 'ao'])
    expect(metal?.steps.map((o) => o.op)).toEqual(['form', 'rim', 'ao', 'cast'])
  })

  test('an inline `COLOR RESPONSE` material is honoured (metal sequence on a fresh colour)', () => {
    const rec = renderWithExplain(
      [
        'light sun = dir 1:1 #ffe6b0',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  model body #b08040 metal light sun',
      ].join('\n'),
      'x',
    )[0]
    expect(rec?.steps.map((o) => o.op)).toEqual(['form', 'rim', 'ao', 'cast'])
    expect(rec?.steps[0]?.color).toBe('#b08040') // the form body carries the material base colour
  })

  test('cel paints exactly N form-following bands (ADR-0089: the model body, quantized)', () => {
    const s = render(
      [
        'light sun = dir 1:1 #ffe6b0',
        'material cloth = #8a7595 cloth',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  cel body cloth 3 light sun',
      ].join('\n'),
      'x',
    )
    // exactly N=3 crisp band colours, and they wrap the form: the up-light corner is brighter than
    // the down-light corner (bands quantize the same normal-based intensity field `model` shades).
    // cloth has no specular dose, so no glint colour is added on top of the 3 bands (ADR-0091).
    const colors = distinctColors(s, 2, 2, 13, 13)
    expect(colors.size).toBe(3)
    expect(lum(s, 3, 3)).toBeGreaterThan(lum(s, 12, 12))
  })

  test('an explicit `light L` argument drives a model directly', () => {
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

  // ADR-0096 §4: a third resolution tier — explicit `light L` arg → theme default → the module's
  // sole bare `light` binding → E024. Only the third tier is new; a file that declares exactly one
  // light and no theme used to raise E024 from every `model`, the most common first-run trap.
  // `lightPointOf` renders the same body with a given light passed *explicitly*, giving a
  // reference `ExplainRecord.light` value (a derived per-region point, not the raw `dir` vector)
  // to compare a fallback-resolved render against — robust to that derivation's internals.
  const lightPointOf = (dirLine: string): { readonly x: number; readonly y: number } | undefined =>
    renderWithExplain(
      [
        `light ref = ${dirLine}`,
        'material steel = #8a95a5 metal',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  model body steel light ref',
      ].join('\n'),
      'x',
    )[0]?.light

  test("§4: the module's sole light binding resolves automatically (no theme, no explicit arg)", () => {
    const sunPoint = lightPointOf('dir 0:1 #ffe6b0')
    const rec = renderWithExplain(
      [
        'light sun = dir 0:1 #ffe6b0',
        'material steel = #8a95a5 metal',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  model body steel',
      ].join('\n'),
      'x',
    )[0]
    expect(rec?.command).toBe('model')
    expect(rec?.light).toEqual(sunPoint)
  })

  test('§4: two module-scope lights and no theme still E024, naming both candidates in the hint', () => {
    try {
      render(
        [
          'light sun = dir 0:1 #ffe6b0',
          'light moon = dir 1:0 #b0c4ff',
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
        const d = e.toDiagnostic()
        expect(d.code).toBe('E024')
        expect(d.hint).toContain('sun')
        expect(d.hint).toContain('moon')
      }
    }
  })

  test('§4: an explicit `light L` argument still wins over the sole module light', () => {
    const moonPoint = lightPointOf('dir 1:0 #b0c4ff')
    const rec = renderWithExplain(
      [
        'light sun = dir 0:1 #ffe6b0',
        'light moon = dir 1:0 #b0c4ff',
        'material steel = #8a95a5 metal',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  model body steel light moon',
      ].join('\n'),
      'x',
    )[0]
    expect(rec?.light).toEqual(moonPoint)
  })

  test("§4: a theme's default light still wins over the module's sole light binding", () => {
    const moonPoint = lightPointOf('dir 1:0 #b0c4ff')
    const rec = renderWithExplain(
      [
        'light sun = dir 0:1 #ffe6b0',
        'theme t:',
        '  light moon = dir 1:0 #b0c4ff',
        'use t',
        'material steel = #8a95a5 metal',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  model body steel',
      ].join('\n'),
      'x',
    )[0]
    expect(rec?.light).toEqual(moonPoint)
  })

  test('a self-illuminated `glow` material only fills + self-lights (no shade/rim/cast)', () => {
    const rec = renderWithExplain(
      [
        'light sun = dir 1:1 #ffe6b0',
        'draw x 16x16:',
        '  orb = circle(8:8, 5)',
        '  model orb #ffcc40 glow light sun',
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
        '  model blade steel light sun',
        '  model guard #b08040 metal light sun',
        '  model grip  #3a2a1e light sun',
        '  cel   pommel steel 3 light sun',
      ].join('\n'),
      'sword',
    )
    expect(trace.map((r) => `${r.command}:${r.region}`)).toEqual([
      'model:blade',
      'model:guard',
      'model:grip',
      'cel:pommel',
    ])
    // grip is a bare colour → flat: the form body then AO (no rim/cast)
    expect(trace[2]?.steps.map((o) => o.op)).toEqual(['form', 'ao'])
    // cel lowers to a single form body carrying its band count (ADR-0089)
    expect(trace[3]?.steps.map((o) => o.op)).toEqual(['form'])
    expect(trace[3]?.steps[0]?.bands).toBe(3)
  })
})

describe('keyword discipline (new words stay contextual, D7)', () => {
  test('light/material/lit/dir/glow remain ordinary bindable names', () => {
    // Every new keyword used as a plain binding + a command argument; `lit`/`dir`/`glow` as
    // names, `light`/`material` as names — none of these is in the builtin catalogue, so none
    // is reserved. `model`/`cel` are commands (ADR-0096 §5) — see the next test.
    const s = render(
      [
        'draw x 4x4:',
        '  light = #ff0000',
        '  material = #00ff00',
        '  lit = #0000ff',
        '  dir = 1:2',
        '  glow = #ffff00',
        '  fill light rect(0:0, 0:0)',
        '  fill material rect(1:0, 1:0)',
        '  fill lit rect(2:0, 2:0)',
        '  fill glow rect(3:0, 3:0)',
      ].join('\n'),
      'x',
    )
    expect(px(s, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(s, 1, 0)).toEqual([0, 255, 0, 255])
    expect(px(s, 2, 0)).toEqual([0, 0, 255, 255])
    expect(px(s, 3, 0)).toEqual([255, 255, 0, 255])
  })

  test('model/cel are reserved builtin commands, unlike light/material/lit/dir/glow (ADR-0096 §5)', () => {
    expect(() => render('draw x 2x2:\n  model = #ff00ff\n  bg #fff\n', 'x')).toThrow(
      /'model' is a predefined, unshadowable name/,
    )
    expect(() => render('draw x 2x2:\n  cel = #00ffff\n  bg #fff\n', 'x')).toThrow(
      /'cel' is a predefined, unshadowable name/,
    )
  })

  test('reusing a material as a colour (E006) hints at its own base colour', () => {
    // The verified blind-test mistake: a `material` looks like a colour (it carries one), but
    // `alpha`/`mix` etc. need the colour itself — the message alone ("must be a color") doesn't
    // say the argument WAS a material, so the hint has to name it and the way out.
    for (const call of ['m.alpha(30%)', 'm.mix(#ffffff, 30%)']) {
      try {
        render(`material m = #8a5a3c cloth\n\ndraw x 2x2:\n  fill ${call} rect(0:0, 1:1)\n`, 'x')
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          const d = e.toDiagnostic()
          expect(d.code).toBe('E006')
          expect(d.message).toBe(
            `${call.startsWith('m.alpha') ? 'alpha' : 'mix'}: argument 1 must be a color`,
          )
          expect(d.hint).toMatch(/material/)
          expect(d.hint).toContain('#8a5a3c')
        }
      }
    }
  })

  test('an unknown material response is a positioned parse error', () => {
    expect(() => render('material bad = #808080 shiny\ndraw x 2x2:\n  px #fff 0:0', 'x')).toThrow(
      /unexpected 'shiny' in a material binding/,
    )
  })

  test('material dose overrides (ADR-0091) parse and reshape the shade — spread widens the spread', () => {
    const wide = render(
      [
        'light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%',
        'material m = #8a95a5 metal spread 160% spec 0%',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  model body m light sun',
      ].join('\n'),
      'x',
    )
    const narrow = render(
      [
        'light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%',
        'material m = #8a95a5 metal spec 0%',
        'draw x 16x16:',
        '  body = rect(2:2, 13:13)',
        '  model body m light sun',
      ].join('\n'),
      'x',
    )
    // spread 160% scales hi+shade symmetrically → a wider value range (brighter highs, darker lows)
    expect(lum(wide, 3, 3)).toBeGreaterThan(lum(narrow, 3, 3))
    expect(lum(wide, 12, 12)).toBeLessThan(lum(narrow, 12, 12))
  })
})
