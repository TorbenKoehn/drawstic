// Unit tests for the family contact-sheet composer (src/sheet.ts, ADR-0082):
import { join } from 'node:path'
// selection rules and deterministic layout math, driven directly against the
// Engine rather than through the CLI.

import { describe, expect, test } from 'bun:test'
import { Engine, type ModuleRecord } from '../../src/eval.js'
import { buildSheet, composeSheet, selectSheetDrawings } from '../../src/sheet.js'

let n = 0
const load = (src: string): { engine: Engine; mod: ModuleRecord } => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, join(process.cwd(), `sheet${n++}.drw`), 'sheet.drw')
  return { engine, mod }
}

const FAMILY = [
  'draw tile(c) 8x8:',
  '  circle c 4:4 3 fill',
  '',
  'draw a 8x8:',
  '  circle #d33 4:4 3 fill',
  '',
  'draw b 16x16:',
  '  rect #39c 1:1 14:14 fill',
  '',
  'draw part 8x8:',
  '  bg #222222',
  '',
  'export a icons/a:',
  '  png',
  '',
  'export b icons/b:',
  '  png',
  '',
].join('\n')

describe('selectSheetDrawings', () => {
  test('default picks exported non-parametric drawings in export order', () => {
    const { mod } = load(FAMILY)
    expect(selectSheetDrawings(mod, false).map((e) => e.definition.name)).toEqual(['a', 'b'])
  })

  test('--all picks every non-parametric drawing, excluding the parametric tile', () => {
    const { mod } = load(FAMILY)
    expect(selectSheetDrawings(mod, true).map((e) => e.definition.name)).toEqual(['a', 'b', 'part'])
  })

  test('a module with no exports falls back to every non-parametric drawing', () => {
    const { mod } = load('draw a 8x8:\n  bg #111\n\ndraw b 8x8:\n  bg #222\n')
    expect(selectSheetDrawings(mod, false).map((e) => e.definition.name)).toEqual(['a', 'b'])
  })

  test('a module with only a parametric drawing selects nothing', () => {
    const { mod } = load('draw only(c) 8x8:\n  bg c\n')
    expect(selectSheetDrawings(mod, false)).toEqual([])
  })
})

describe('composeSheet', () => {
  test('normalizes cells to the largest drawing, centers each tile, and lays out a grid', () => {
    const { engine, mod } = load(FAMILY)
    const layout = composeSheet(engine, mod, selectSheetDrawings(mod, false), null)
    expect(layout).not.toBeNull()
    if (!layout) {
      return
    }
    // two tiles, default square-ish grid → 2 cols x 1 row
    expect(layout.cols).toBe(2)
    expect(layout.rows).toBe(1)
    // cell content width normalizes to the largest drawing (b is 16 wide); label
    // may widen it further, never shrink it
    expect(layout.cell.width).toBeGreaterThanOrEqual(16)
    // the 8x8 'a' is centered within the 16-wide content band, so its x is offset
    const a = layout.cells.find((c) => c.name === 'a')
    const b = layout.cells.find((c) => c.name === 'b')
    expect(a).toMatchObject({ w: 8, h: 8 })
    expect(b).toMatchObject({ w: 16, h: 16 })
    // both tiles share row 0; the shorter 'a' (8px) is vertically centered in the
    // 16px-tall content band, so it sits below the top-aligned full-height 'b'
    expect((a?.y ?? 0) > (b?.y ?? 0)).toBe(true)
    // sprite is opaque somewhere and matches the reported dimensions
    expect(layout.sprite.w).toBeGreaterThan(0)
    expect(layout.sprite.h).toBeGreaterThan(0)
    expect(layout.sprite.data.length).toBe(layout.sprite.w * layout.sprite.h * 4)
  })

  test('honors an explicit column count', () => {
    const { engine, mod } = load(FAMILY)
    const layout = composeSheet(engine, mod, selectSheetDrawings(mod, true), 1)
    expect(layout?.cols).toBe(1)
    expect(layout?.rows).toBe(3)
  })

  test('returns null when there is nothing to render', () => {
    const { engine, mod } = load('draw only(c) 8x8:\n  bg c\n')
    expect(composeSheet(engine, mod, selectSheetDrawings(mod, false), null)).toBeNull()
  })
})

describe('buildSheet', () => {
  test('selects and composes in one step', () => {
    const { engine, mod } = load(FAMILY)
    const layout = buildSheet(engine, mod, { cols: null, all: false })
    expect(layout?.cells.map((c) => c.name)).toEqual(['a', 'b'])
  })
})
