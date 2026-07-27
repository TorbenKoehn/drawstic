import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { Engine } from '../../src/eval.js'
import { missingGlyph } from '../../src/fonts.js'
import type { Sprite } from '../../src/values.js'

describe('missingGlyph()', () => {
  test('returns h rows of w columns', () => {
    const sizes: [number, number][] = [
      [1, 1],
      [5, 1],
      [1, 5],
      [5, 3],
      [4, 4],
      [6, 3],
    ]
    for (const [w, h] of sizes) {
      const rows = missingGlyph(w, h)
      expect(rows).toHaveLength(h)
      for (const row of rows) {
        expect(row).toHaveLength(w)
      }
    }
  })

  test('single row (h=1) is a solid bar (top/bottom branch coincide)', () => {
    expect(missingGlyph(5, 1)).toEqual(['#####'])
  })

  test('two rows (h=2) are both border rows, no middle', () => {
    expect(missingGlyph(3, 2)).toEqual(['###', '###'])
  })

  test('middle rows are hollow with a 1px border for w > 1', () => {
    expect(missingGlyph(5, 3)).toEqual(['#####', '#...#', '#####'])
    expect(missingGlyph(4, 4)).toEqual(['####', '#..#', '#..#', '####'])
    expect(missingGlyph(6, 3)).toEqual(['######', '#....#', '######'])
  })

  test('middle rows for w=1 have no trailing border pixel', () => {
    expect(missingGlyph(1, 3)).toEqual(['#', '#', '#'])
  })
})

describe('std micro font glyph coverage (E7 regression)', () => {
  // Render one glyph of the named bundled bitmap font at the origin and return
  // its w×h cell as '#'/'.' rows (opaque = '#').
  const glyphCell = (char: string, font: string, w: number, h: number): string[] => {
    const engine = new Engine(process.cwd())
    const src = `draw g 8x8:\n  text #000000 0:0 "${char}" font ${font}\n`
    const mod = engine.loadSource(src, join(process.cwd(), `glyph.drw`), 'glyph.drw')
    const entry = mod.definitions.get('g')
    if (!entry) {
      throw new Error('no drawing g')
    }
    const s: Sprite = engine.defToSprite(entry, { line: 1, column: 1 })
    const rows: string[] = []
    for (let y = 0; y < h; y++) {
      let row = ''
      for (let x = 0; x < w; x++) {
        row += (s.data[(y * s.w + x) * 4 + 3] ?? 0) > 0 ? '#' : '.'
      }
      rows.push(row)
    }
    return rows
  }

  // Every printable ASCII glyph the 5×7 `small` face carries that `micro` lacked
  // before this fix — E7: `text … "$" font micro` silently rendered the box.
  const previouslyMissing = ['$', '&', '@', '^', '`', '{', '|', '}', '~']
  const box = missingGlyph(3, 5)

  test('every glyph that small carries now renders in micro, not the missing-glyph box', () => {
    for (const ch of previouslyMissing) {
      const rows = glyphCell(ch, 'micro', 3, 5)
      expect(rows).not.toEqual(box) // no silent fallback to the box
      expect(rows.some((r) => r.includes('#'))).toBe(true) // actually drew ink
    }
  })

  test('the "$" glyph renders its intended 3×5 bar-through-S bitmap', () => {
    expect(glyphCell('$', 'micro', 3, 5)).toEqual(['.##', '##.', '.##', '##.', '.#.'])
  })
})
