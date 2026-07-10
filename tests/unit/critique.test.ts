import { describe, expect, test } from 'bun:test'
import { CRITIQUE_CODE, critiqueCheckDiagnostic, critiqueSprite } from '../../src/critique.js'
import { Engine } from '../../src/eval.js'
import type { Sprite } from '../../src/values.js'

let n = 0
const render = (src: string, drawing: string): Sprite => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\critique${n++}.drw`, 'mem.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  return engine.defToSprite(entry, { line: 1, column: 1 })
}

const critique = (src: string, drawing: string) => critiqueSprite(drawing, render(src, drawing))
const byCode = <T extends { readonly code: string }>(
  checks: readonly T[],
  code: string,
): T | undefined => checks.find((c) => c.code === code)

describe('C001 empty / near-empty', () => {
  test('a fully transparent sprite fires C001 with measured 0 and null metrics', () => {
    const d = critique('draw empty 3x3:\n  pal k=#000000\n', 'empty')
    expect(d.bbox).toBeNull()
    expect(d.coveredPixelCount).toBe(0)
    expect(d.luminance).toBeNull()
    const c = byCode(d.checks, CRITIQUE_CODE.empty)
    expect(c).toMatchObject({ code: 'C001', severity: 'warning', measured: 0, threshold: 1 })
    expect(c?.message).toContain('fully transparent')
  })

  test('a tiny subject on a large canvas fires C001 near-empty with the bbox area measured', () => {
    // one pixel at 5:5 on a 10x10 canvas -> bbox area 1, floor = max(4, 2%*100) = 4
    const d = critique('draw tiny 10x10:\n  pal k=#c04040\n  px k 5:5\n', 'tiny')
    expect(d.bbox).toEqual({ x: 5, y: 5, width: 1, height: 1 })
    expect(d.coveredPixelCount).toBe(1)
    const c = byCode(d.checks, CRITIQUE_CODE.empty)
    expect(c).toMatchObject({ code: 'C001', measured: 1, threshold: 4 })
    expect(c?.message).toContain('near-empty')
  })
})

describe('C003 optical centering', () => {
  test('an off-center subject fires C003 with the exact x0/x1/sum/target/offset', () => {
    // block in columns 1..3 of an 8-wide canvas: x0+x1 = 4, target = 7, offset = -3
    const row = '.wkw....'
    const src = `draw off 8x8:\n  pal w=#ffffff  k=#000000\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'off')
    expect(d.bbox).toEqual({ x: 1, y: 0, width: 3, height: 8 })
    const c = byCode(d.checks, CRITIQUE_CODE.centering)
    expect(c).toMatchObject({ code: 'C003', measured: -3, threshold: 2 })
    expect(c?.detail).toEqual({ x0: 1, x1: 3, sum: 4, target: 7, offsetY: 0 })
  })

  test('a centered subject does not fire C003', () => {
    const row = '...ww...'
    const src = `draw mid 8x8:\n  pal w=#ffffff\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'mid')
    expect(byCode(d.checks, CRITIQUE_CODE.centering)).toBeUndefined()
  })
})

describe('C004 value / contrast spread', () => {
  test('a flat single-tone fill fires C004 with spread 0', () => {
    const d = critique('draw flat 8x8:\n  bg #808080\n', 'flat')
    expect(d.coveredPixelCount).toBe(64)
    expect(d.luminance?.spread).toBe(0)
    const c = byCode(d.checks, CRITIQUE_CODE.valueSpread)
    expect(c).toMatchObject({ code: 'C004', measured: 0, threshold: 0.15 })
  })

  test('a two-tone fill with real contrast does not fire C004', () => {
    const row = 'kwkwkwkw'
    const src = `draw duo 8x8:\n  pal k=#202020  w=#e0e0e0\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'duo')
    expect(byCode(d.checks, CRITIQUE_CODE.valueSpread)).toBeUndefined()
    expect((d.luminance?.spread ?? 0) >= 0.15).toBe(true)
  })
})

describe('C008 interior pinholes', () => {
  test('a 1px transparent gap enclosed by paint fires C008 with measured 1', () => {
    const src = [
      'draw hole 5x5:',
      '  pal k=#101010  w=#f0f0f0',
      '  pixels:',
      '    kwkwk',
      '    wkwkw',
      '    kw.wk',
      '    wkwkw',
      '    kwkwk',
      '',
    ].join('\n')
    const d = critique(src, 'hole')
    const c = byCode(d.checks, CRITIQUE_CODE.pinhole)
    expect(c).toMatchObject({ code: 'C008', measured: 1, threshold: 0 })
    expect(c?.detail).toEqual({ largestInteriorHole: 1 })
    // the two-tone body keeps value contrast up, so C008 is isolated here
    expect(byCode(d.checks, CRITIQUE_CODE.valueSpread)).toBeUndefined()
  })

  test('a transparent gap open to the border is not a pinhole', () => {
    const src = [
      'draw notch 5x5:',
      '  pal k=#101010  w=#f0f0f0',
      '  pixels:',
      '    kwkwk',
      '    wkwkw',
      '    kw...',
      '    wkwkw',
      '    kwkwk',
      '',
    ].join('\n')
    const d = critique(src, 'notch')
    expect(byCode(d.checks, CRITIQUE_CODE.pinhole)).toBeUndefined()
  })
})

describe('C012 dynamic transparent trailing edge row', () => {
  test('a fully transparent bottom row with content above fires C012', () => {
    const src = [
      'draw pad 4x4:',
      '  pal k=#202020  w=#e0e0e0',
      '  pixels:',
      '    kwkw',
      '    wkwk',
      '    kwkw',
      '    ....',
      '',
    ].join('\n')
    const d = critique(src, 'pad')
    expect(d.bbox).toEqual({ x: 0, y: 0, width: 4, height: 3 })
    const c = byCode(d.checks, CRITIQUE_CODE.trailingEdgeRow)
    expect(c).toMatchObject({ code: 'C012', measured: 1, threshold: 0 })
  })
})

describe('C006 palette / complexity budget', () => {
  test('a two-tone sprite stays under the generous default ceiling', () => {
    const row = 'kwkwkwkw'
    const src = `draw duo 8x8:\n  pal k=#202020  w=#e0e0e0\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'duo')
    expect(d.distinctColorCount).toBe(2)
    expect(byCode(d.checks, CRITIQUE_CODE.paletteBudget)).toBeUndefined()
  })
})

describe('clean sprite and metric exposure', () => {
  test('a centered, value-varied, edge-to-edge sprite fires no checks but still exposes metrics', () => {
    const rows = Array.from({ length: 8 }, (_, y) => (y % 2 === 0 ? 'abababab' : 'babababa'))
    const src = `draw ok 8x8:\n  pal a=#303030  b=#d0d0d0\n  pixels:\n${rows.map((r) => `    ${r}`).join('\n')}\n`
    const d = critique(src, 'ok')
    expect(d.checks).toEqual([])
    expect(d.bbox).toEqual({ x: 0, y: 0, width: 8, height: 8 })
    expect(d.coveredPixelCount).toBe(64)
    expect(d.opaquePixelCount).toBe(64)
    expect(d.transparentPixelCount).toBe(0)
    expect(d.distinctColorCount).toBe(2)
    expect(d.luminance).not.toBeNull()
  })
})

describe('critiqueCheckDiagnostic', () => {
  test('anchors a check to the draw span, preserving code, warning severity, and the fix as hint', () => {
    const check = {
      code: CRITIQUE_CODE.centering,
      severity: 'warning' as const,
      message: 'off-center',
      measured: -3,
      threshold: 2,
      fix: 'move the subject +1px on x',
    }
    const diag = critiqueCheckDiagnostic(check, 'file.drw', { line: 4, column: 1 })
    expect(diag).toEqual({
      severity: 'warning',
      code: 'C003',
      message: 'off-center',
      file: 'file.drw',
      line: 4,
      column: 1,
      hint: 'move the subject +1px on x',
    })
  })
})
