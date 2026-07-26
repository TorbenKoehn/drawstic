import { describe, expect, test } from 'bun:test'
import { color } from '../../src/color.js'
import { Engine } from '../../src/eval.js'
import { attributePaletteShares, inspectNamedMask, inspectSprite } from '../../src/inspect.js'
import type { Region, Sprite } from '../../src/values.js'

let n = 0
const render = (src: string, drawing: string): Sprite => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\inspect${n++}.drw`, 'mem.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  return engine.defToSprite(entry, { line: 1, column: 1 })
}

describe('inspectSprite', () => {
  test('reports size, colors, bbox, opaque/transparent counts, palette, and occupancy', () => {
    const s = render(
      'draw box 4x4:\n  palette k=#1a1a1a  r=#c04040\n  pixels:\n    ....\n    .kr.\n    .rk.\n    ....\n',
      'box',
    )
    const info = inspectSprite(s)
    expect(info.width).toBe(4)
    expect(info.height).toBe(4)
    expect(info.distinctColorCount).toBe(3) // transparent, k, r
    expect(info.alphaCoverageBBox).toEqual({ x: 1, y: 1, width: 2, height: 2 })
    expect(info.opaquePixelCount).toBe(4)
    expect(info.transparentPixelCount).toBe(12)
    expect(info.palette).toEqual([
      { key: 'k', hex: '#1a1a1a', source: 'box', opaquePixelShare: 0.5 },
      { key: 'r', hex: '#c04040', source: 'box', opaquePixelShare: 0.5 },
    ])
    expect(info.occupancy).toEqual(['....', '.##.', '.##.', '....'])
    expect(info.namedMasks).toEqual([])
  })

  test('alphaCoverageBBox is null and occupancy is empty for a fully transparent sprite', () => {
    const s = render('draw empty 3x3:\n  palette k=#000000\n', 'empty')
    const info = inspectSprite(s)
    expect(info.width).toBe(3)
    expect(info.height).toBe(3)
    expect(info.distinctColorCount).toBe(1)
    expect(info.alphaCoverageBBox).toBeNull()
    expect(info.opaquePixelCount).toBe(0)
    expect(info.transparentPixelCount).toBe(9)
    expect(info.palette).toEqual([
      { key: 'k', hex: '#000000', source: 'empty', opaquePixelShare: 0 },
    ])
    expect(info.occupancy).toEqual(['...', '...', '...'])
  })

  test('a partially transparent pixel counts as neither opaque nor transparent', () => {
    const s = render('draw partial 2x2:\n  px #ff000080 0:0\n', 'partial')
    const info = inspectSprite(s)
    expect(info.distinctColorCount).toBe(2) // transparent + the partial-alpha color
    expect(info.alphaCoverageBBox).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(info.opaquePixelCount).toBe(0)
    expect(info.transparentPixelCount).toBe(3)
    expect(info.palette).toEqual([])
    expect(info.occupancy).toEqual(['#.', '..'])
  })

  test('occupancy grid clamps to 8x8 and reports 0%, <50%, and >=50% coverage cells', () => {
    const blankRow = '.'.repeat(24)
    const firstRow = `${'.'.repeat(5)}xxx${'.'.repeat(16)}`
    const rows = [firstRow, blankRow, blankRow, blankRow, blankRow, blankRow, blankRow, blankRow]
    const src = `draw grid 24x8:\n  palette x=#ffffff\n  pixels:\n${rows.map((r) => `    ${r}`).join('\n')}\n`
    const s = render(src, 'grid')
    const info = inspectSprite(s)
    expect(info.width).toBe(24)
    expect(info.height).toBe(8)
    expect(info.occupancy).toHaveLength(8)
    // cell 0 (px 0-2): all transparent -> '.'
    // cell 1 (px 3-5): 1 of 3 opaque -> ':'
    // cell 2 (px 6-8): 2 of 3 opaque -> '#'
    expect(info.occupancy[0]).toBe(`.:#${'.'.repeat(5)}`)
    for (let i = 1; i < 8; i++) {
      expect(info.occupancy[i]).toBe('.'.repeat(8))
    }
    expect(info.opaquePixelCount).toBe(3)
    expect(info.alphaCoverageBBox).toEqual({ x: 5, y: 0, width: 3, height: 1 })
  })
})

describe('attributePaletteShares (task 3.4: per-palette-key opaque pixel share)', () => {
  const sprite = (pixels: readonly (readonly [number, number, number, number])[]): Sprite => ({
    type: 'sprite',
    name: 's',
    w: pixels.length,
    h: 1,
    data: new Uint8Array(pixels.flat()),
    pal: [],
    title: undefined,
    desc: undefined,
  })

  test('attributes each opaque pixel to its nearest declared color by squared sRGB distance', () => {
    const pal = [{ color: color(0, 0, 0) }, { color: color(200, 0, 0) }] // k, r
    // pixel 0: exact k. pixel 1: exact r. pixel 2 (40,0,0): 40 from k, 160 from r -> k.
    const s = sprite([
      [0, 0, 0, 255],
      [200, 0, 0, 255],
      [40, 0, 0, 255],
    ])
    expect(attributePaletteShares(s, pal)).toEqual([0.6667, 0.3333])
  })

  test('a tied distance keeps the first palette entry (declaration order)', () => {
    const pal = [{ color: color(0, 0, 0) }, { color: color(200, 0, 0) }] // k, r
    // (100,0,0) is exactly 100 from both -> tie -> first entry (k) wins.
    const s = sprite([[100, 0, 0, 255]])
    expect(attributePaletteShares(s, pal)).toEqual([1, 0])
  })

  test('ignores non-opaque pixels; all-zero shares when there are no opaque pixels', () => {
    const pal = [{ color: color(0, 0, 0) }]
    const s = sprite([[255, 255, 255, 128]])
    expect(attributePaletteShares(s, pal)).toEqual([0])
  })

  test('returns [] for an empty palette', () => {
    const s = sprite([[0, 0, 0, 255]])
    expect(attributePaletteShares(s, [])).toEqual([])
  })
})

describe('inspectNamedMask (task 3.4: per-named-mask bbox + coverage)', () => {
  const rectRegion = (x0: number, y0: number, x1: number, y1: number): Region => ({
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
    test: () => false,
  })

  test('reports the tight canvas-local bbox and full coverage fraction for a solid rect', () => {
    const info = inspectNamedMask('m', rectRegion(1, 1, 3, 2), 5, 5)
    expect(info).toEqual({
      name: 'm',
      bbox: { x: 1, y: 1, width: 3, height: 2 },
      coveragePixelCount: 6,
      coverageFraction: 1,
    })
  })

  test('coverageFraction is density within the mask bbox, not the whole canvas', () => {
    // two opposite corners of a 4x4 bbox -> bbox area 16, 2 covered -> 0.125
    const corners: Region = {
      type: 'region',
      bbox: null,
      has: (x, y) => (x === 0 && y === 0) || (x === 3 && y === 3),
      test: () => false,
    }
    const info = inspectNamedMask('ring', corners, 10, 10)
    expect(info).toEqual({
      name: 'ring',
      bbox: { x: 0, y: 0, width: 4, height: 4 },
      coveragePixelCount: 2,
      coverageFraction: 0.125,
    })
  })

  test('bbox is null and coverage is 0 when the region touches no canvas pixel', () => {
    const empty: Region = { type: 'region', bbox: null, has: () => false, test: () => false }
    const info = inspectNamedMask('m', empty, 4, 4)
    expect(info).toEqual({ name: 'm', bbox: null, coveragePixelCount: 0, coverageFraction: 0 })
  })

  test('offsetX/offsetY shift the region test but keep the bbox canvas-local (render --crop)', () => {
    // region true only for absolute x in [10,12], y in [0,1] -- as if the
    // mask was defined against the full canvas before `--crop 10:0 3x2`.
    const info = inspectNamedMask('m', rectRegion(10, 0, 12, 1), 3, 2, 10, 0)
    expect(info).toEqual({
      name: 'm',
      bbox: { x: 0, y: 0, width: 3, height: 2 },
      coveragePixelCount: 6,
      coverageFraction: 1,
    })
  })
})

describe('inspectSprite namedMasks wiring', () => {
  test('maps each {name, region} pair through inspectNamedMask, in order', () => {
    const s = render('draw box 4x4:\n  bg #ffffff\n', 'box')
    const topLeft: Region = {
      type: 'region',
      bbox: null,
      has: (x, y) => x < 2 && y < 2,
      test: () => false,
    }
    const nowhere: Region = { type: 'region', bbox: null, has: () => false, test: () => false }
    const info = inspectSprite(s, [
      { name: 'topLeft', region: topLeft },
      { name: 'nowhere', region: nowhere },
    ])
    expect(info.namedMasks).toEqual([
      {
        name: 'topLeft',
        bbox: { x: 0, y: 0, width: 2, height: 2 },
        coveragePixelCount: 4,
        coverageFraction: 1,
      },
      { name: 'nowhere', bbox: null, coveragePixelCount: 0, coverageFraction: 0 },
    ])
  })
})
