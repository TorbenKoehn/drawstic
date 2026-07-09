import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DrawsticError } from '../../src/diagnostic.js'
import { Engine } from '../../src/eval.js'
import { encodePngRgba } from '../../src/png.js'
import type { Sprite } from '../../src/values.js'

let n = 0
const render = (src: string, drawing: string): Sprite => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\mem${n++}.drw`, 'mem.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  return engine.defToSprite(entry, { line: 1, column: 1 })
}

const px = (s: Sprite, x: number, y: number): [number, number, number, number] => {
  const i = (y * s.w + x) * 4
  return [s.data[i] ?? 0, s.data[i + 1] ?? 0, s.data[i + 2] ?? 0, s.data[i + 3] ?? 0]
}

describe('evaluator', () => {
  test('pixels block renders through the palette', () => {
    const s = render(
      'draw heart 5x5:\n  pal k=#1a1a1a  r=#c04040\n  pixels:\n    .r.r.\n    rrkrr\n    rrrrr\n    .rrr.\n    ..r..\n',
      'heart',
    )
    expect(s.w).toBe(5)
    expect(s.h).toBe(5)
    expect(px(s, 0, 0)).toEqual([0, 0, 0, 0]) // transparent
    expect(px(s, 1, 0)).toEqual([192, 64, 64, 255])
    expect(px(s, 2, 1)).toEqual([26, 26, 26, 255])
  })

  test('size inferred from pixels; header mismatch is an error', () => {
    const s = render('draw gem:\n  pal y=#e0b070\n  pixels:\n    .y.\n    yyy\n', 'gem')
    expect(s.w).toBe(3)
    expect(s.h).toBe(2)
    expect(() =>
      render('draw bad 4x4:\n  pal y=#e0b070\n  pixels:\n    .y.\n    yyy\n', 'bad'),
    ).toThrow(/pixels row 1 is 3 wide; expected 4/)
  })

  test('pixels size diagnostics point at offending rows', () => {
    try {
      render('draw bad:\n  pal y=#e0b070\n  pixels:\n    yy\n    y\n', 'bad')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.toDiagnostic()).toMatchObject({
          code: 'E002',
          message: 'pixels row 2 is 1 wide; expected 2',
          line: 5,
          column: 5,
          hint: 'actual width 1; expected width 2',
        })
      }
    }
    try {
      render('draw bad 2x3:\n  pal y=#e0b070\n  pixels:\n    yy\n    yy\n', 'bad')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.toDiagnostic()).toMatchObject({
          code: 'E002',
          message: 'pixels block is 2x2, header says 2x3',
          line: 4,
          column: 5,
          hint: 'actual 2x2; expected 2x3',
        })
      }
    }
  })

  test('size unresolved is E003', () => {
    expect(() => render('draw d:\n  bg #fff\n', 'd')).toThrow(/no size/)
  })

  test('bg, px, circle fill', () => {
    const s = render(
      'draw t 16x16:\n  pal k=#1a1a1a  r=#c04040\n  circle k 8:8 7\n  circle r 8:8 5 fill\n  circle k 8:8 2 fill\n',
      't',
    )
    expect(px(s, 8, 8)).toEqual([26, 26, 26, 255]) // centre: inner disc
    expect(px(s, 8, 4)).toEqual([192, 64, 64, 255]) // red band
    expect(px(s, 8, 1)).toEqual([26, 26, 26, 255]) // outline top
    expect(px(s, 0, 0)).toEqual([0, 0, 0, 0]) // corner transparent
  })

  test('circle radius has balanced icon padding', () => {
    const s = render(
      'draw circleIcon 16x16:\n  pal:\n    k = #1a1a1a\n    r = #c04040\n  bg #fff\n  circle k 8:8 7\n  circle r 8:8 5 fill\n',
      'circleIcon',
    )
    expect(px(s, 8, 0)).toEqual([255, 255, 255, 255])
    expect(px(s, 8, 15)).toEqual([255, 255, 255, 255])
    expect(px(s, 0, 8)).toEqual([255, 255, 255, 255])
    expect(px(s, 15, 8)).toEqual([255, 255, 255, 255])
    expect(px(s, 8, 1)).toEqual([26, 26, 26, 255])
    expect(px(s, 8, 14)).toEqual([26, 26, 26, 255])
    expect(px(s, 1, 8)).toEqual([26, 26, 26, 255])
    expect(px(s, 14, 8)).toEqual([26, 26, 26, 255])
  })

  test('paths: local cursor and rel segments', () => {
    const s = render(
      'path corner 4x4:\n  move 0:0\n  line rel 3:0\n  line rel 0:3\n\ndraw f 4x4:\n  pal k=#000\n  stroke k corner\n',
      'f',
    )
    expect(px(s, 0, 0)[3]).toBe(255)
    expect(px(s, 3, 0)[3]).toBe(255)
    expect(px(s, 3, 3)[3]).toBe(255)
    expect(px(s, 0, 3)[3]).toBe(0)
  })

  test('paths fill, mask, and boolean composition', () => {
    const s = render(
      'path box 6x6:\n  move 1:1\n  line 5:1\n  line 5:5\n  line 1:5\n  close\n\npath cut 6x6:\n  move 3:1\n  line 5:3\n  line 3:5\n  line 1:3\n  close\n\npath frame = box.subtract(cut)\n\ndraw f 6x6:\n  pal k=#000 r=#f00\n  fill k box\n  mask frame.fill():\n    bg r\n',
      'f',
    )
    expect(px(s, 1, 1)).toEqual([255, 0, 0, 255])
    expect(px(s, 3, 3)).toEqual([0, 0, 0, 255])
  })

  test('loops, lists, fn, floored // and mod', () => {
    const s = render(
      'fn band(row) = row // 2 mod 2\n\ndraw stripes 4x4:\n  pal k=#000000  y=#ffffff\n  cols = k, y\n  for row 0..h:\n    poly cols[band(row)] 0:row w:row\n',
      'stripes',
    )
    expect(px(s, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(s, 0, 2)).toEqual([255, 255, 255, 255])
  })

  test('range expressions produce lists and for iterates lists', () => {
    const s = render(
      'nums = 1..=3\n\ndraw d 5x2:\n  pal k=#000\n  for x nums:\n    px k x:0\n  for x 1, 3:\n    px k x:1\n',
      'd',
    )
    expect(px(s, 0, 0)[3]).toBe(0)
    expect(px(s, 1, 0)[3]).toBe(255)
    expect(px(s, 2, 0)[3]).toBe(255)
    expect(px(s, 3, 0)[3]).toBe(255)
    expect(px(s, 1, 1)[3]).toBe(255)
    expect(px(s, 2, 1)[3]).toBe(0)
    expect(px(s, 3, 1)[3]).toBe(255)
  })

  test('negative // and mod are floored (ADR-0037)', () => {
    const s = render(
      'draw d 2x2:\n  pal k=#000\n  x = -7 // 2\n  y = -7 mod 2\n  if x == -4 & y == 1:\n    bg k\n',
      'd',
    )
    expect(px(s, 0, 0)[3]).toBe(255)
  })

  test('fractional index is a positioned error', () => {
    expect(() => render('draw d 2x2:\n  xs = 1, 2, 3\n  v = xs[1/2]\n  bg #fff\n', 'd')).toThrow(
      /integer/,
    )
  })

  test('xs.cycle(i) is sugar for xs[i mod len(xs)] (ADR-0079)', () => {
    const s = render(
      'draw d 2x2:\n  pal k=#000\n  xs = 10, 20, 30\n  if xs.cycle(1) == xs[1]:\n    bg k\n',
      'd',
    )
    expect(px(s, 0, 0)[3]).toBe(255)
  })

  test('cycle wraps an out-of-range index back to the start', () => {
    const s = render(
      'draw d 2x2:\n  pal k=#000\n  xs = 10, 20, 30\n  if xs.cycle(3) == 10 & xs.cycle(4) == 20:\n    bg k\n',
      'd',
    )
    expect(px(s, 0, 0)[3]).toBe(255)
  })

  test('cycle wraps a negative index positively (Euclidean mod)', () => {
    const s = render(
      'draw d 2x2:\n  pal k=#000\n  xs = 10, 20, 30\n  if xs.cycle(-1) == 30 & xs.cycle(-2) == 20:\n    bg k\n',
      'd',
    )
    expect(px(s, 0, 0)[3]).toBe(255)
  })

  test('cycle on an empty list is a clear E015', () => {
    try {
      render('draw d 2x2:\n  xs = 5..5\n  v = xs.cycle(0)\n  bg #fff\n', 'd')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.toDiagnostic()).toMatchObject({
          code: 'E015',
          message: 'cycle needs a non-empty list',
        })
      }
    }
  })

  test('cycle in a for-loop over a color ramp avoids off-by-one (volcano #5)', () => {
    const s = render(
      'draw stripes 1x4:\n  pal a=#111111 b=#222222 c=#333333\n  ramp = a, b, c\n  for row 0..h:\n    px ramp.cycle(row) 0:row\n',
      'stripes',
    )
    expect(px(s, 0, 0)).toEqual([17, 17, 17, 255])
    expect(px(s, 0, 1)).toEqual([34, 34, 34, 255])
    expect(px(s, 0, 2)).toEqual([51, 51, 51, 255])
    expect(px(s, 0, 3)).toEqual([17, 17, 17, 255]) // row 3 wraps back to ramp[0]
  })

  test('regions: union/subtract mask + fill/stroke eliminators', () => {
    const s = render(
      'mask keyhole = circle(8:5, 4).union(rect(6:5, 9:14))\n\ndraw badge 16x16:\n  fill #e0b070 keyhole\n',
      'badge',
    )
    expect(px(s, 8, 5)[3]).toBe(255) // in the circle
    expect(px(s, 7, 12)[3]).toBe(255) // in the rect
    expect(px(s, 1, 12)[3]).toBe(0) // outside
  })

  test('fn-built region + stroke w2', () => {
    const s = render(
      'fn ring(c, r) = circle(c, r).subtract(circle(c, r - 2))\n\ndraw m 16x16:\n  stroke #1a1a1a ring(8:8, 7) w2\n',
      'm',
    )
    expect(px(s, 8, 1)[3]).toBe(255) // outer ring band
    expect(px(s, 8, 8)[3]).toBe(0) // hollow centre
  })

  test('mask block clips drawing', () => {
    const s = render('mask m = circle(4:4, 2)\n\ndraw d 8x8:\n  mask m:\n    bg #ff0000\n', 'd')
    expect(px(s, 4, 4)[3]).toBe(255)
    expect(px(s, 0, 0)[3]).toBe(0)
  })

  test('curve strokes an open spline through every control point (ADR-0074)', () => {
    const s = render('draw d 32x32:\n  bg #000000\n  curve #ff0000 2:16 16:2 30:16\n', 'd')
    // the spline passes through each control point (±1px → exact after grid rounding)
    expect(px(s, 2, 16)).toEqual([255, 0, 0, 255])
    expect(px(s, 16, 2)).toEqual([255, 0, 0, 255])
    expect(px(s, 30, 16)).toEqual([255, 0, 0, 255])
  })

  test('curvePoly fill / stroke share one tessellation and align (ADR-0075)', () => {
    const fill = render(
      'draw d 24x24:\n  bg #000000\n  curvePoly #00ff00 4:12 12:4 20:12 12:20 fill\n',
      'd',
    )
    expect(px(fill, 12, 12)).toEqual([0, 255, 0, 255]) // interior filled
    expect(px(fill, 0, 0)).toEqual([0, 0, 0, 255]) // outside → bg

    const stroke = render('draw d 24x24:\n  curvePoly #0000ff 4:12 12:4 20:12 12:20\n', 'd')
    expect(px(stroke, 12, 12)[3]).toBe(0) // hollow: no fill without the flag
    expect(px(stroke, 12, 4)).toEqual([0, 0, 255, 255]) // boundary on a control point
  })

  test('curvePoly without a paint is a Region (mask/eliminator) (ADR-0075)', () => {
    const s = render(
      'draw d 24x24:\n  mask blob = curvePoly(4:12, 12:3, 20:12, 12:21)\n  fill #ff8800 blob\n',
      'd',
    )
    expect(px(s, 12, 12)[3]).toBe(255) // inside the closed curve
    expect(px(s, 0, 0)[3]).toBe(0) // outside
  })

  test('curve / curvePoly need at least three points (E011)', () => {
    expect(() => render('draw d 10x10:\n  curve #f00 1:1 8:8\n', 'd')).toThrow(
      /curve needs at least three points/,
    )
    expect(() => render('draw d 10x10:\n  curvePoly #f00 1:1 8:8\n', 'd')).toThrow(
      /curvePoly needs at least three points/,
    )
  })

  test('curve / curvePoly render deterministically and tick the write budget', () => {
    const src =
      'draw d 24x24:\n  bg #101020\n  curve #e8c 2:20 12:4 22:14 w2\n  curvePoly #6c9 6:12 18:6 20:18 fill\n'
    const eng = new Engine(process.cwd())
    const mod = eng.loadSource(src, `${process.cwd()}\\memcurve.drw`, 'mem.drw')
    const entry = mod.definitions.get('d')
    if (!entry) {
      throw new Error('no drawing d')
    }
    const a = eng.defToSprite(entry, { line: 1, column: 1 })
    expect(eng.budget.writes).toBeGreaterThan(0) // pixel writes accounted through the framebuffer hook
    const b = render(src, 'd')
    expect(Array.from(a.data)).toEqual(Array.from(b.data)) // two independent runs are byte-identical
  })

  test('profile fills a linear fn as an exact triangle down to the canvas bottom (ADR-0076)', () => {
    // ramp(nx)=round(nx*7): span 0..=7 → column i sampled at nx=i/7, top-edge y=i,
    // filled down to baseline h-1=7. Lower-right triangle, exact.
    const s = render(
      'fn ramp(nx) = round(nx * 7)\ndraw d 8x8:\n  profile #ff0000 0..=7 ramp fill\n',
      'd',
    )
    expect(px(s, 0, 0)).toEqual([255, 0, 0, 255]) // col 0: top y=0, fill 0..7
    expect(px(s, 0, 7)).toEqual([255, 0, 0, 255])
    expect(px(s, 7, 7)).toEqual([255, 0, 0, 255]) // col 7: top y=7, fill 7..7
    expect(px(s, 7, 0)[3]).toBe(0) // col 7 above the ridge: empty
    expect(px(s, 4, 4)).toEqual([255, 0, 0, 255]) // col 4: fill 4..7
    expect(px(s, 4, 3)[3]).toBe(0) // just above the ridge
  })

  test('profile paints exactly one contiguous run per column (ADR-0076)', () => {
    const s = render(
      'fn wavy(nx) = 4 + round(nx * 6)\ndraw d 16x16:\n  profile #ff0000 0..16 wavy fill\n',
      'd',
    )
    for (let x = 0; x < 16; x++) {
      const rows: number[] = []
      for (let y = 0; y < 16; y++) {
        if (px(s, x, y)[3] === 255) {
          rows.push(y)
        }
      }
      expect(rows.length).toBeGreaterThan(0)
      // contiguous: the filled rows are exactly one unbroken span
      const first = rows[0] ?? 0
      const last = rows[rows.length - 1] ?? 0
      expect(rows).toHaveLength(last - first + 1)
      expect(last).toBe(15) // default baseline = canvas bottom
    }
  })

  test('profile span inclusivity follows the range operator (ADR-0076)', () => {
    // half-open 0..4 samples columns 0..3; inclusive 0..=4 also samples column 4
    const half = render('fn f(nx) = 5\ndraw d 8x8:\n  profile #ff0000 0..4 f fill\n', 'd')
    expect(px(half, 3, 7)[3]).toBe(255)
    expect(px(half, 4, 7)[3]).toBe(0) // column 4 not sampled
    const incl = render('fn f(nx) = 5\ndraw d 8x8:\n  profile #ff0000 0..=4 f fill\n', 'd')
    expect(px(incl, 4, 7)[3]).toBe(255) // column 4 sampled
  })

  test('profile baseline fills between the curve and a given y (ADR-0076)', () => {
    // flat top y=5, baseline 3 → fill rows 3..5 in every column
    const s = render('fn f(nx) = 5\ndraw d 8x8:\n  profile #ff0000 0..8 f 3 fill\n', 'd')
    expect(px(s, 4, 2)[3]).toBe(0)
    expect(px(s, 4, 3)).toEqual([255, 0, 0, 255])
    expect(px(s, 4, 5)).toEqual([255, 0, 0, 255])
    expect(px(s, 4, 6)[3]).toBe(0)
  })

  test('profile without a paint is a Region (mask/eliminator) (ADR-0076)', () => {
    const s = render(
      'fn f(nx) = 4\ndraw d 8x8:\n  mask m = profile(0..8, f)\n  fill #00ff00 m\n',
      'd',
    )
    expect(px(s, 4, 4)).toEqual([0, 255, 0, 255]) // inside the profile (top y=4)
    expect(px(s, 4, 7)).toEqual([0, 255, 0, 255]) // down to the bottom
    expect(px(s, 4, 3)[3]).toBe(0) // above the ridge
  })

  test('profile region form honours an explicit baseline argument (ADR-0076)', () => {
    const s = render(
      'fn f(nx) = 5\ndraw d 8x8:\n  mask m = profile(0..8, f, 3)\n  fill #00ff00 m\n',
      'd',
    )
    expect(px(s, 4, 3)[3]).toBe(255)
    expect(px(s, 4, 5)[3]).toBe(255)
    expect(px(s, 4, 6)[3]).toBe(0) // does not reach the canvas bottom
  })

  test('profile diagnostics: missing paint, unknown fn, non-list span (ADR-0076)', () => {
    expect(() => render('fn f(nx) = 5\ndraw d 8x8:\n  profile 0..8 f fill\n', 'd')).toThrow(
      /region value dropped/,
    )
    expect(() => render('draw d 8x8:\n  profile #f00 0..8 nope fill\n', 'd')).toThrow(
      /profile: 'nope' is not a function/,
    )
    expect(() => render('fn f(nx) = 5\ndraw d 8x8:\n  profile #f00 5 f fill\n', 'd')).toThrow(
      /span must be a range or list/,
    )
  })

  test('profile renders deterministically and ticks the write budget (ADR-0076)', () => {
    const src =
      'fn ridgeY(nx) = 16 + round(noise(3, nx * 4, 0) * 10)\ndraw d 64x32:\n  bg #e8d9b0\n  profile #c9a06b 0..64 ridgeY fill\n'
    const eng = new Engine(process.cwd())
    const mod = eng.loadSource(src, `${process.cwd()}\\memprofile.drw`, 'mem.drw')
    const entry = mod.definitions.get('d')
    if (!entry) {
      throw new Error('no drawing d')
    }
    const a = eng.defToSprite(entry, { line: 1, column: 1 })
    expect(eng.budget.writes).toBeGreaterThan(0)
    const b = render(src, 'd')
    expect(Array.from(a.data)).toEqual(Array.from(b.data)) // two independent runs are byte-identical
  })

  test('stamp with flipx mirrors', () => {
    const s = render(
      'draw eye 3x3:\n  pal k=#000\n  pixels:\n    k..\n    k..\n    k..\n\ndraw face 8x8:\n  stamp eye 0:0\n  stamp eye 5:0 flipx\n',
      'face',
    )
    expect(px(s, 0, 0)[3]).toBe(255)
    expect(px(s, 7, 0)[3]).toBe(255) // mirrored column
    expect(px(s, 5, 0)[3]).toBe(0)
  })

  test('stamp scale2 and rot90 are lossless', () => {
    const s = render(
      'draw dot 2x2:\n  pal k=#000\n  pixels:\n    k.\n    ..\n\ndraw d 8x8:\n  stamp dot 0:0 scale2\n  stamp dot 4:0 rot90\n',
      'd',
    )
    expect(px(s, 0, 0)[3]).toBe(255)
    expect(px(s, 1, 1)[3]).toBe(255)
    expect(px(s, 2, 2)[3]).toBe(0)
    // rot90 cw: (0,0) -> (1,0) within the 2x2 footprint at 4:0
    expect(px(s, 5, 0)[3]).toBe(255)
  })

  test('stamp anchors and stamp-local shadows', () => {
    const s = render(
      'draw part 3x3:\n  bg #000000\n\ndraw d 8x8:\n  stamp part 5:5 anchor bottom shadow 1:0 #ff0000\n',
      'd',
    )
    expect(px(s, 4, 3)).toEqual([0, 0, 0, 255])
    expect(px(s, 5, 5)).toEqual([0, 0, 0, 255])
    expect(px(s, 7, 3)).toEqual([255, 0, 0, 255])
  })

  // ADR-0072: v2 named anchors resolve against the *transformed* footprint bbox
  // (visual); drawstic 1 keeps the legacy through-transform mapping.
  const part43 = 'draw part 4x3:\n  bg #000000\n\n'
  const solidBBox = (s: Sprite): { x0: number; y0: number; x1: number; y1: number } => {
    let x0 = s.w
    let y0 = s.h
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if (px(s, x, y)[3] > 0) {
          x0 = Math.min(x0, x)
          y0 = Math.min(y0, y)
          x1 = Math.max(x1, x)
          y1 = Math.max(y1, y)
        }
      }
    }
    return { x0, y0, x1, y1 }
  }

  test('v2 visual anchor: bottomLeft + flipx lands visually bottom-left', () => {
    // pt 8:8, solid 4x3 → the visible bottom-left corner sits AT pt, footprint to the right
    const s = render(`${part43}draw d 16x16:\n  stamp part 8:8 anchor bottomLeft flipx\n`, 'd')
    expect(solidBBox(s)).toEqual({ x0: 8, y0: 6, x1: 11, y1: 8 })
    expect(px(s, 8, 8)[3]).toBe(255) // bottom-left corner at pt
    expect(px(s, 10, 8)[3]).toBe(255) // footprint extends right of pt
    expect(px(s, 5, 8)[3]).toBe(0) // nothing to the left of pt
  })

  test('drawstic 1 legacy anchor: bottomLeft + flipx lands bottom-right (through-transform)', () => {
    const s = render(
      `drawstic 1\n${part43}draw d 16x16:\n  stamp part 8:8 anchor bottomLeft flipx\n`,
      'd',
    )
    // mirrored corner lands at pt → footprint sits to the LEFT (bottom-right at pt)
    expect(solidBBox(s)).toEqual({ x0: 5, y0: 6, x1: 8, y1: 8 })
    expect(px(s, 5, 8)[3]).toBe(255)
    expect(px(s, 10, 8)[3]).toBe(0)
  })

  test('unflipped anchor bottomLeft is identical in v1 and v2', () => {
    const src = `draw d 16x16:\n  stamp part 8:8 anchor bottomLeft\n`
    const v2 = render(`${part43}${src}`, 'd')
    const v1 = render(`drawstic 1\n${part43}${src}`, 'd')
    expect(solidBBox(v2)).toEqual({ x0: 8, y0: 6, x1: 11, y1: 8 })
    expect(solidBBox(v1)).toEqual(solidBBox(v2))
  })

  test('v2 visual anchor: rot90 anchor bottom = visible bottom-centre', () => {
    // solid 4x2 rotated 90° → 2×4 footprint; its bottom edge sits at pt.y, centred on pt.x
    const part42 = 'draw part 4x2:\n  bg #000000\n\n'
    const v2 = render(`${part42}draw d 20x20:\n  stamp part 10:10 anchor bottom rot90\n`, 'd')
    const bb = solidBBox(v2)
    expect(bb.y1).toBe(10) // visible bottom row at pt.y
    expect(bb.x1 - bb.x0).toBe(1) // 2px wide (rotated)
    expect(bb.y1 - bb.y0).toBe(3) // 4px tall (rotated)
    expect(bb.x0).toBe(10) // centred on pt.x=10 (2-wide → [10,11])
    // v1 through-transform maps the source bottom-centre to a side edge → different placement
    const v1 = render(
      `drawstic 1\n${part42}draw d 20x20:\n  stamp part 10:10 anchor bottom rot90\n`,
      'd',
    )
    expect(solidBBox(v1).y1).toBe(12)
  })

  test('numeric/symmetric anchor center + scale2 is identical in v1 and v2', () => {
    const src = `draw d 20x20:\n  stamp part 10:10 anchor center scale2\n`
    const dot = 'draw part 3x3:\n  bg #000000\n\n'
    const v2 = render(`${dot}${src}`, 'd')
    const v1 = render(`drawstic 1\n${dot}${src}`, 'd')
    expect(solidBBox(v2)).toEqual({ x0: 8, y0: 8, x1: 13, y1: 13 })
    expect(solidBBox(v1)).toEqual(solidBBox(v2))
  })

  test('parametric drawings instantiate per args', () => {
    const s = render(
      'draw dot(c) 4x4:\n  circle c 1:1 1 fill\n\ndraw d 8x4:\n  stamp dot(#ff0000) 0:0\n  stamp dot(#00ff00) 4:0\n',
      'd',
    )
    expect(px(s, 1, 1)).toEqual([255, 0, 0, 255])
    expect(px(s, 5, 1)).toEqual([0, 255, 0, 255])
  })

  test('themes fold: later wins, drawing-level use', () => {
    const src = `theme a:
  pal:
    k = #111111
theme b:
  with a
  pal:
    k = #222222

draw d 2x2:
  use b
  bg k
`
    const s = render(src, 'd')
    expect(px(s, 0, 0)).toEqual([34, 34, 34, 255])
  })

  test('palette collisions are one-directional: a value may not shadow a palette (ADR-0073)', () => {
    // value binding capturing a live palette key stays an error
    expect(() => render('draw d 2x2:\n  pal k=#111\n  k = 5\n  bg #fff\n', 'd')).toThrow(/palette/)
    expect(() => render('draw d 2x2:\n  ink = 5\n  pal i=#111\n  bg #fff\n', 'd')).not.toThrow() // different names — fine
    // a pal key MAY now shadow a visible non-palette value binding (reverse direction relaxed)
    expect(() => render('draw d 2x2:\n  i = 5\n  pal i=#111\n  bg i\n', 'd')).not.toThrow()
  })

  test('pal keys may be w/h and shadow the canvas-size bindings (ADR-0073)', () => {
    const s = render(
      'draw d 4x4:\n  pal w=#ffffff h=#111111\n  pixels:\n    wwww\n    whhw\n    whhw\n    wwww\n',
      'd',
    )
    expect(px(s, 0, 0)).toEqual([255, 255, 255, 255]) // 'w' cell → white
    expect(px(s, 1, 1)).toEqual([17, 17, 17, 255]) // 'h' cell → #111
    // a pal w/h even shadows the size binding in expressions within the draw
    const s2 = render('draw d 2x2:\n  pal w=#00ff00\n  bg w\n', 'd')
    expect(px(s2, 0, 0)).toEqual([0, 255, 0, 255])
  })

  test('a pixel cell naming no visible palette entry is E007 with a pal hint', () => {
    try {
      render('draw d 2x2:\n  pal k=#111\n  pixels:\n    kk\n    kz\n', 'd')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.toDiagnostic()).toMatchObject({
          code: 'E007',
          message: "pixel key 'z' names no visible palette entry",
          hint: "declare it in a 'pal' (e.g. 'pal z=<color>')",
        })
      }
    }
  })

  test('a non-palette value binding is never a pixel cell (palette-only namespace, ADR-0073)', () => {
    // module-scope value `z` must NOT satisfy a `z` cell — cells resolve palette-only
    expect(() =>
      render('z = 5\n\ndraw d 2x2:\n  pal k=#111\n  pixels:\n    kk\n    zk\n', 'd'),
    ).toThrow(/names no visible palette entry/)
  })

  test('a `=` accumulator inside a loop/if persists to the enclosing draw scope (ADR-0081)', () => {
    // region accumulator: all four circles render (before the fix only the pre-loop circle did)
    const s = render(
      'draw t 20x12:\n  k = #ff0000\n  g = circle(4:6, 2)\n  for i 0..3:\n    g = g.union(circle((8 + i * 4):6, 2))\n  fill k g\n',
      't',
    )
    expect(px(s, 4, 6)).toEqual([255, 0, 0, 255]) // initial circle
    expect(px(s, 16, 6)).toEqual([255, 0, 0, 255]) // final loop circle (was transparent)
    // a plain-number accumulator reassigned inside an `if` block persists too
    const s2 = render(
      'draw d 6x1:\n  pal k=#000\n  n = 0\n  if true:\n    n = 3\n  px k n:0\n',
      'd',
    )
    expect(px(s2, 3, 0)[3]).toBe(255) // n became 3
    expect(px(s2, 0, 0)[3]).toBe(0) // not the pre-block 0
  })

  test('a block-body `=` never reassigns a module-scope binding (barrier, ADR-0081)', () => {
    // determinism: a draw must not mutate module state; `n = 99` shadow-declares draw-locally
    const s = render(
      'n = 5\n\ndraw d 4x4:\n  pal k=#000\n  for i 0..3:\n    n = 99\n  if n == 5:\n    bg k\n',
      'd',
    )
    expect(px(s, 0, 0)).toEqual([0, 0, 0, 255]) // module `n` stayed 5 → bg filled
  })

  test('a theme pal key w/h shadows the canvas size, as paint and cell (ADR-0081, extends ADR-0073)', () => {
    const pal = 'theme t:\n  pal:\n    w = #ffffff\n    k = #1a1a1a\n\n'
    // as a paint: `w` resolves to the palette white, not the number 8 (was E006/E013)
    const s = render(`${pal}draw a 8x8:\n  use t\n  bg k\n  circle w 4:4 3 fill\n`, 'a')
    expect(px(s, 4, 4)).toEqual([255, 255, 255, 255])
    // as a pixels cell: `w` names the palette entry (was E007)
    const rows =
      'wwwwwwww\n    w......w\n    w......w\n    w......w\n    w......w\n    w......w\n    w......w\n    wwwwwwww'
    const s2 = render(`${pal}draw b 8x8:\n  use t\n  pixels:\n    ${rows}\n`, 'b')
    expect(px(s2, 0, 0)).toEqual([255, 255, 255, 255])
    expect(px(s2, 1, 1)).toEqual([0, 0, 0, 0]) // '.' transparent
  })

  test('a free binding in a theme body is rejected at the declaration site (E004, ADR-0081)', () => {
    try {
      render(
        'theme t:\n  accent = #d8a53a\n  pal:\n    k = #1a1a1a\n\ndraw a 8x8:\n  use t\n  bg k\n',
        'a',
      )
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.toDiagnostic()).toMatchObject({
          code: 'E004',
          line: 2,
          message: "a theme body has no place for the binding 'accent'",
        })
      }
    }
    // grad bindings stay legal in a theme body
    expect(() =>
      render(
        'theme t:\n  grad sky = linear(90, #000, #fff)\n\ndraw d 2x4:\n  use t\n  bg sky\n',
        'd',
      ),
    ).not.toThrow()
  })

  test('alpha compositing is pinned source-over', () => {
    const s = render('draw d 2x2:\n  bg #ffffff\n  rect #00000080 0:0 1:1 fill\n', 'd')
    // 50.2% black over white: 255*(1-128/255) = 127 → 127
    expect(px(s, 0, 0)).toEqual([127, 127, 127, 255])
  })

  test('flood fills 4-connected exact color', () => {
    const s = render('draw d 4x4:\n  pal k=#000  r=#f00\n  line k 0:0 3:0\n  flood r 0:3\n', 'd')
    expect(px(s, 0, 3)).toEqual([255, 0, 0, 255])
    expect(px(s, 0, 0)).toEqual([0, 0, 0, 255]) // line pixel unchanged
  })

  test('text renders bundled small font', () => {
    const s = render('draw d 16x16:\n  text #000000 1:1 "A"\n', 'd')
    // 'A' has its apex at column 2 of the 5x7 cell
    expect(px(s, 3, 1)[3]).toBe(255)
    expect(px(s, 1, 1)[3]).toBe(0)
  })

  test('std fonts are globally registered and optionally importable', () => {
    const global = render('draw d 16x16:\n  text #000000 1:1 "A" font small\n', 'd')
    const imported = render(
      'from std/fonts/small small\n\ndraw d 16x16:\n  text #000000 1:1 "A" font small\n',
      'd',
    )
    expect(px(global, 3, 1)[3]).toBe(255)
    expect(px(imported, 3, 1)[3]).toBe(255)
  })

  test('std micro preserves lowercase upcase fallback', () => {
    const s = render('draw d 8x6:\n  text #000000 1:0 "a" font micro\n', 'd')
    expect(px(s, 2, 0)[3]).toBe(255)
    expect(px(s, 1, 2)[3]).toBe(255)
  })

  test('user font fallback resolves std fonts', () => {
    const s = render(
      'font runic 5x7:\n  with small\n  glyph "X":\n    pixels:\n      k...k\n      .k.k.\n      ..k..\n      .k.k.\n      k...k\n      k...k\n      k...k\n\ndraw d 16x8:\n  text #ff0000 1:0 "AX" font runic\n',
      'd',
    )
    expect(px(s, 3, 0)).toEqual([255, 0, 0, 255])
    expect(px(s, 7, 0)).toEqual([255, 0, 0, 255])
    expect(px(s, 8, 0)).toEqual([0, 0, 0, 0])
  })

  test('std themes load through the std module registry', () => {
    const s = render('use std/themes pixelBase\n\ndraw d 16x16:\n  text #000000 1:1 "A"\n', 'd')
    expect(px(s, 3, 1)[3]).toBe(255)
  })

  test('inline pixel glyphs inherit the font size and use the text paint', () => {
    const s = render(
      'font runic 3x3:\n  glyph "X":\n    pixels:\n      k.k\n      .k.\n      k.k\n\ndraw d 8x4:\n  text #ff0000 1:0 "X" font runic\n',
      'd',
    )
    expect(px(s, 1, 0)).toEqual([255, 0, 0, 255])
    expect(px(s, 2, 0)).toEqual([0, 0, 0, 0])
    expect(px(s, 2, 1)).toEqual([255, 0, 0, 255])
  })

  test('inline command glyphs use the text paint binding', () => {
    const s = render(
      'font marks 5x5:\n  glyph "O":\n    circle k 2:2 1 fill\n\ndraw d 8x6:\n  text #0000ff 1:0 "O" font marks\n',
      'd',
    )
    expect(px(s, 3, 2)).toEqual([0, 0, 255, 255])
  })

  test('gradients paint across the bbox', () => {
    const s = render('grad sky = linear(90, #000000, #ffffff)\n\ndraw d 4x8:\n  bg sky\n', 'd')
    const top = px(s, 1, 0)
    const bottom = px(s, 1, 7)
    expect(top[0]).toBeLessThan(80)
    expect(bottom[0]).toBeGreaterThan(180)
  })

  test('filters: outline, replace, tint, shadow via apply', () => {
    const s = render(
      'filter retro:\n  outline #0000ff\n\ndraw d 6x6:\n  px #ff0000 3:3\n  apply retro\n',
      'd',
    )
    expect(px(s, 3, 2)).toEqual([0, 0, 255, 255])
    expect(px(s, 3, 3)).toEqual([255, 0, 0, 255])
  })

  test('local shadows, texture filters, and lighting helpers', () => {
    const shadowed = render(
      'draw d 6x4:\n  r = rect(1:1, 2:2)\n  castShadow r 2:0 #ff0000\n  fill #000000 r\n',
      'd',
    )
    expect(px(shadowed, 3, 1)).toEqual([255, 0, 0, 255])
    expect(px(shadowed, 1, 1)).toEqual([0, 0, 0, 255])

    const textured = render(
      'draw d 4x4:\n  bg #ffffff\n  grain 1 7 #000000\n  speckle 1 8 #ff0000\n  ripple 1 9 #0000ff\n  dither #000000 #ffffff 1\n',
      'd',
    )
    expect(px(textured, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(textured, 3, 3)).toEqual([0, 0, 0, 255])

    const lit = render(
      'draw d 6x4:\n  r = rect(1:1, 4:2)\n  fill #808080 r\n  shadeRegion r 0:0 #808080 1\n  rim r 1:0 #ffffff 1\n  ambientOcclusion r #000000 0.5\n',
      'd',
    )
    expect(px(lit, 4, 1)[3]).toBe(255)
    expect(px(lit, 1, 1)[3]).toBe(255)
  })

  test('unified frame shadow shape: dx:dy point form and deprecated two-number alias (ADR-0070)', () => {
    // canonical dx:dy point form: whole-frame drop shadow
    const pointForm = render('draw d 4x4:\n  px #000000 1:1\n  shadow 1:1 #0000ff\n', 'd')
    expect(px(pointForm, 1, 1)).toEqual([0, 0, 0, 255]) // original silhouette
    expect(px(pointForm, 2, 2)).toEqual([0, 0, 255, 255]) // shadow at the (1,1) offset

    // deprecated two-number alias stays accepted (error-robustness) and renders identically
    const twoNumber = render('draw d 4x4:\n  px #000000 1:1\n  shadow 1 1 #0000ff\n', 'd')
    expect(px(twoNumber, 1, 1)).toEqual([0, 0, 0, 255])
    expect(px(twoNumber, 2, 2)).toEqual([0, 0, 255, 255])
  })

  test('v2 frame shadow honours an enclosing mask block; drawstic 1 ignores it (ADR-0070)', () => {
    // red at 0:0, a mask over x=3..4; the shadow of the red pixel would land at x=2 (outside the mask)
    const src = (pragma: string): string =>
      `${pragma}draw d 6x1:\n  px #ff0000 0:0\n  mask rect(3:0, 4:0):\n    shadow 2:0 #0000ff\n`

    const v2 = render(src(''), 'd')
    expect(px(v2, 0, 0)).toEqual([255, 0, 0, 255]) // masked-off original preserved
    expect(px(v2, 2, 0)).toEqual([0, 0, 0, 0]) // shadow clipped to the mask — suppressed outside it

    const v1 = render(src('drawstic 1\n'), 'd')
    expect(px(v1, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(v1, 2, 0)).toEqual([0, 0, 255, 255]) // v1 ignores the mask: whole-buffer shadow
  })

  test('region-scoped texture filters confine to the region; whole-frame form unchanged (ADR-0071)', () => {
    // grain confined to the left band leaves the rest of the row untouched
    const grained = render(
      'draw d 6x1:\n  bg #ffffff\n  band = rect(0:0, 2:0)\n  grain band 1 7 #000000\n',
      'd',
    )
    expect(px(grained, 0, 0)).toEqual([0, 0, 0, 255]) // inside band: grained
    expect(px(grained, 5, 0)).toEqual([255, 255, 255, 255]) // outside band: untouched

    // dither raw-sets only inside the band
    const dithered = render(
      'draw d 6x1:\n  bg #ffffff\n  band = rect(0:0, 2:0)\n  dither band #000000 #ffffff 1\n',
      'd',
    )
    expect(px(dithered, 0, 0)).toEqual([0, 0, 0, 255]) // threshold 1 -> paintA inside band
    expect(px(dithered, 5, 0)).toEqual([255, 255, 255, 255]) // outside band: untouched

    // speckle/ripple accept the leading region too
    const speckled = render(
      'draw d 6x1:\n  bg #ffffff\n  band = rect(0:0, 2:0)\n  speckle band 1 11 #ff0000\n  ripple band 1 5 #0000ff\n',
      'd',
    )
    expect(px(speckled, 5, 0)).toEqual([255, 255, 255, 255]) // both filters leave the outside clean

    // regression: the region-less form still hits every opaque pixel
    const whole = render('draw d 4x1:\n  bg #ffffff\n  grain 1 7 #000000\n', 'd')
    expect(px(whole, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(whole, 3, 0)).toEqual([0, 0, 0, 255])
  })

  test('shadeRegion semantics switch on the drawstic version pragma; lightRegion brightens (ADR-0068/0069)', () => {
    // v2 (unpinned): amount is the veil opacity; an opaque base does NOT repaint the near side
    const v2 = render(
      'draw d 8x1:\n  r = rect(0:0, 7:0)\n  fill #ffffff r\n  shadeRegion r 0:0 #ff0000 1\n',
      'd',
    )
    expect(px(v2, 0, 0)).toEqual([255, 255, 255, 255]) // near the light: untouched
    expect(px(v2, 7, 0)).toEqual([255, 0, 0, 255]) // far corner: full red veil

    // v1 (drawstic 1): opaque base repaints the whole region, mixing toward black by distance
    const v1 = render(
      'drawstic 1\ndraw d 8x1:\n  r = rect(0:0, 7:0)\n  fill #ffffff r\n  shadeRegion r 0:0 #ff0000 1\n',
      'd',
    )
    expect(px(v1, 0, 0)).toEqual([255, 0, 0, 255]) // near the light: repainted red (the v1 trap)
    expect(px(v1, 7, 0)).toEqual([0, 0, 0, 255]) // far corner: mixed to black

    // lightRegion: additive brightening, strongest nearest the light point
    const lit = render(
      'draw d 8x1:\n  r = rect(0:0, 7:0)\n  fill #000000 r\n  lightRegion r 0:0 #ffffff 1\n',
      'd',
    )
    expect(px(lit, 0, 0)).toEqual([255, 255, 255, 255]) // nearest the light: brightest
    expect(px(lit, 7, 0)).toEqual([0, 0, 0, 255]) // far corner: untouched
  })

  test('while is governed by the budget (E010)', () => {
    expect(() =>
      render('draw d 2x2:\n  x = 0\n  while true:\n    x += 1\n  bg #fff\n', 'd'),
    ).toThrow(/budget/)
  })

  test('tileset bakes a grid and members are addressable', () => {
    const src = `draw a 2x2:
  pal k=#000
  pixels:
    kk
    kk
draw b 2x2:
  pal r=#f00
  pixels:
    rr
    rr

tileset ts 2x2:
  tiles a, b
  cols 2

draw d 4x2:
  stamp ts.1 0:0
`
    const s = render(src, 'd')
    expect(px(s, 0, 0)).toEqual([255, 0, 0, 255])
  })

  test('tile size mismatch is E016', () => {
    expect(() =>
      render(
        'draw a 2x2:\n  pal k=#000\n  pixels:\n    kk\n    kk\ndraw b 3x2:\n  pal k=#000\n  pixels:\n    kkk\n    kkk\n\ntileset ts 2x2:\n  tiles a, b\n\ndraw d 4x2:\n  stamp ts.0 0:0\n',
        'd',
      ),
    ).toThrow(/requires 2x2/)
  })

  test('drawing silhouette as region', () => {
    const s = render(
      'draw gem 2x2:\n  pal y=#e0b070\n  pixels:\n    y.\n    yy\n\ndraw d 4x4:\n  m = gem.region.shift(1:1)\n  fill #ff0000 m\n',
      'd',
    )
    expect(px(s, 1, 1)[3]).toBe(255)
    expect(px(s, 2, 1)[3]).toBe(0)
    expect(px(s, 2, 2)[3]).toBe(255)
  })

  test('first-class transforms: rotate about + region transform', () => {
    const s = render(
      'draw d 8x8:\n  t = rotate(90).about(3:3)\n  r = rect(1:3, 5:3)\n  fill #f00 r.transform(t)\n',
      'd',
    )
    // a horizontal 5px bar rotated 90 about (3,3) becomes vertical
    expect(px(s, 3, 1)[3]).toBe(255)
    expect(px(s, 3, 5)[3]).toBe(255)
  })

  test('unknown name gets a hint (E001)', () => {
    try {
      render('draw slime 2x2:\n  bg #fff\n\ndraw d 2x2:\n  stamp slmie 0:0\n', 'd')
      expect(false).toBe(true)
    } catch (e) {
      expect(String(e)).toContain('slmie')
    }
  })

  test('w/h referenced outside a draw body gets a scope hint (E001)', () => {
    const hint =
      'w/h are the canvas size and only exist inside a draw body — move this into the draw, or pass the size in explicitly'
    for (const src of [
      'x = w\n\ndraw d 2x2:\n  bg #fff\n',
      'y = h\n\ndraw d 2x2:\n  bg #fff\n',
      'mask m = rect(0:0, w:1)\n\ndraw d 2x2:\n  bg #fff\n',
    ]) {
      try {
        render(src, 'd')
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          expect(e.toDiagnostic()).toMatchObject({ code: 'E001', hint })
        }
      }
    }
  })

  test('an ordinary unknown name outside a draw body does not get the w/h scope hint', () => {
    try {
      render('x = totallyUnknownName\n\ndraw d 2x2:\n  bg #fff\n', 'd')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        const d = e.toDiagnostic()
        expect(d.code).toBe('E001')
        expect(d.hint).toBeUndefined()
      }
    }
  })

  test('match statement selects by value', () => {
    const s = render(
      'draw d 2x2:\n  x = 10\n  match x:\n    0: bg #000000\n    10: bg #ffffff\n    else: bg #ff0000\n',
      'd',
    )
    expect(px(s, 0, 0)).toEqual([255, 255, 255, 255])
  })

  test('if-expression and UFCS color chain', () => {
    const s = render(
      'draw d 2x2:\n  c = if 1 > 0 then #808080.lighten(20%) else #000000\n  bg c\n',
      'd',
    )
    expect(px(s, 0, 0)[0]).toBeGreaterThan(128)
  })

  test('color-list ramps work in UFCS and destructuring', () => {
    const s = render(
      'draw d 3x1:\n  dr, mr, lr = #ffffff.tones(-12%, 0%, 12%)\n  r = #116a96.mixes(#e9fbff, 4)\n  px dr 0:0\n  px r.1 1:0\n  px lr 2:0\n',
      'd',
    )
    expect(px(s, 0, 0)[0]).toBeLessThan(255)
    expect(px(s, 1, 0)[3]).toBe(255)
    expect(px(s, 2, 0)).toEqual([255, 255, 255, 255])
  })

  test('block pal destructures color lists', () => {
    const s = render(
      'draw d 3x1:\n  pal:\n    a, b, c = #777.tones(-10%, 0%, 10%)\n  pixels:\n    abc\n',
      'd',
    )
    expect(s.pal.map((p) => p.key)).toEqual(['a', 'b', 'c'])
    expect(px(s, 0, 0)[0]).toBeLessThan(px(s, 1, 0)[0])
    expect(() => render('draw d 1x1:\n  pal:\n    a, b = #fff.tones(0%)\n  bg a\n', 'd')).toThrow(
      /palette destructuring mismatch/,
    )
    expect(() => render('draw d 1x1:\n  pal:\n    a = 1\n  bg a\n', 'd')).toThrow(/must be a color/)
  })

  test('point x and y builtins work in prefix and UFCS form', () => {
    const s = render(
      'draw d 4x4:\n  p = 1:2\n  rect #000 p (p.x + 1):(p.y + 1)\n  rect #f00 x(p):y(p) x(p):y(p)\n',
      'd',
    )
    expect(px(s, 1, 2)).toEqual([255, 0, 0, 255])
    expect(px(s, 2, 3)).toEqual([0, 0, 0, 255])
  })

  test('point arithmetic is component-wise', () => {
    const s = render(
      'draw d 16x16:\n  a = 4:4 * 2\n  b = 4:4 * 2:3\n  c = 4:4 + 1\n  e = 4:4 + 1:2\n  f = 9:9\n  g = 4:4 + -(1:2)\n  f += 1:2\n  px #000 a\n  px #f00 b\n  px #0f0 c\n  px #00f e\n  px #fff f\n  px #888 g\n',
      'd',
    )
    expect(px(s, 8, 8)).toEqual([0, 0, 0, 255])
    expect(px(s, 8, 12)).toEqual([255, 0, 0, 255])
    expect(px(s, 5, 5)).toEqual([0, 255, 0, 255])
    expect(px(s, 5, 6)).toEqual([0, 0, 255, 255])
    expect(px(s, 10, 11)).toEqual([255, 255, 255, 255])
    expect(px(s, 3, 2)).toEqual([136, 136, 136, 255])
  })

  test('explicit point arithmetic replaces cursor-relative shape points', () => {
    const s = render('draw d 16x16:\n  i = 2\n  c = 8:8\n  rect #000 c-(i:i) c+(i:i)\n', 'd')
    expect(px(s, 6, 6)).toEqual([0, 0, 0, 255])
    expect(px(s, 10, 10)).toEqual([0, 0, 0, 255])
  })
})

describe('evaluator: coverage gap-fill', () => {
  test('atlas packs pinned and auto-packed sprites, shelf-packing around collisions', () => {
    const src = `draw logo 4x4:
  pal k=#000000
  bg k
draw play 3x3:
  pal r=#ff0000
  bg r
draw pause 2x2:
  pal g=#00ff00
  bg g

atlas hud:
  sprites logo, play, pause
  pad 1
  place logo 0:0

draw d 12x12:
  stamp hud 0:0
  stamp hud 0:0
`
    const s = render(src, 'd')
    // logo pinned at 0:0 (4x4 black)
    expect(px(s, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(s, 3, 3)).toEqual([0, 0, 0, 255])
    // padding gap between logo and the shelf-packed neighbours
    expect(px(s, 4, 0)[3]).toBe(0)
    // play shelf-packs around the pinned logo (detour past its right edge)
    expect(px(s, 5, 0)).toEqual([255, 0, 0, 255])
    expect(px(s, 7, 2)).toEqual([255, 0, 0, 255])
    // pause packs onto the next shelf, also detouring around logo
    expect(px(s, 5, 4)).toEqual([0, 255, 0, 255])
    expect(px(s, 6, 5)).toEqual([0, 255, 0, 255])
  })

  test('atlas member not found is E001', () => {
    expect(() =>
      render('atlas bad:\n  sprites missingDraw\n\ndraw d 4x4:\n  stamp bad 0:0\n', 'd'),
    ).toThrow(/sprite 'missingDraw' not found/)
  })

  test('loadEntry resolves real files on disk and caches module records by path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-eval-'))
    try {
      const engine = new Engine(dir)
      writeFileSync(join(dir, 'shape.drw'), 'draw square 2x2:\n  pal k=#000000\n  bg k\n')
      writeFileSync(join(dir, 'main.drw'), 'from shape square\n\ndraw d 2x2:\n  stamp square 0:0\n')
      const mod = engine.loadEntry(join(dir, 'main.drw'))
      const mod2 = engine.loadEntry(join(dir, 'main.drw'))
      expect(mod2).toBe(mod)
      const entry = mod.definitions.get('d')
      if (!entry) {
        throw new Error('no d')
      }
      const s = engine.defToSprite(entry, { line: 1, column: 1 })
      expect(px(s, 0, 0)).toEqual([0, 0, 0, 255])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a self-import is an E008 import cycle (spec §2)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-cyc-'))
    try {
      const engine = new Engine(dir)
      writeFileSync(join(dir, 'self.drw'), 'from self box\n\ndraw box 2x2:\n  bg #000000\n')
      try {
        engine.loadEntry(join(dir, 'self.drw'))
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          expect(e.toDiagnostic()).toMatchObject({
            code: 'E008',
            message: "import cycle involving 'self'",
          })
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a mutual two-file import cycle is an E008 (spec §2)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-cyc-'))
    try {
      const engine = new Engine(dir)
      writeFileSync(join(dir, 'a.drw'), 'from b bee\n\ndraw aaa 2x2:\n  bg #000000\n')
      writeFileSync(join(dir, 'b.drw'), 'from a aaa\n\ndraw bee 2x2:\n  bg #ffffff\n')
      try {
        engine.loadEntry(join(dir, 'a.drw'))
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          expect(e.toDiagnostic()).toMatchObject({
            code: 'E008',
            message: "import cycle involving 'a'",
          })
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a diamond (A→B,C→D) re-importing a fully-loaded module is legal', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-diamond-'))
    try {
      const engine = new Engine(dir)
      writeFileSync(join(dir, 'd.drw'), 'draw dee 2x2:\n  bg #112233\n')
      writeFileSync(join(dir, 'b.drw'), 'from d dee\n\ndraw bee 2x2:\n  bg #445566\n')
      writeFileSync(join(dir, 'c.drw'), 'from d dee\n\ndraw cee 2x2:\n  bg #778899\n')
      writeFileSync(
        join(dir, 'main.drw'),
        'from b bee\nfrom c cee\n\ndraw m 2x2:\n  stamp bee 0:0\n  stamp cee 0:0\n',
      )
      const mod = engine.loadEntry(join(dir, 'main.drw'))
      const entry = mod.definitions.get('m')
      if (!entry) {
        throw new Error('no m')
      }
      const s = engine.defToSprite(entry, { line: 1, column: 1 })
      expect(s.w).toBe(2)
      expect(px(s, 0, 0)).toEqual([119, 136, 153, 255])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('missing imported module is a positioned E008', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-eval-'))
    try {
      const engine = new Engine(dir)
      writeFileSync(join(dir, 'main.drw'), 'from missing thing\n\ndraw d 1x1:\n  bg #fff\n')
      try {
        engine.loadEntry(join(dir, 'main.drw'))
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          expect(e.toDiagnostic()).toMatchObject({
            code: 'E008',
            message: "module not found: 'missing'",
          })
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('theme grad bindings fold; a non-gradient grad binding is a type error', () => {
    const s = render(
      'theme t:\n  grad sky = linear(90, #000000, #ffffff)\n\ndraw d 2x4:\n  use t\n  bg sky\n',
      'd',
    )
    expect(px(s, 0, 0)[0]).toBeLessThan(80)
    expect(px(s, 0, 3)[0]).toBeGreaterThan(180)
    expect(() =>
      render('theme t:\n  grad oops = 5\n\ndraw d 2x2:\n  use t\n  bg #fff\n', 'd'),
    ).toThrow(/'grad' binding must be a gradient/)
  })

  test('sprite cache fingerprints theme gradients (no stale sprite across grad-only themes)', () => {
    const engine = new Engine(process.cwd())
    const src =
      'size 4x4\n' +
      'theme ta:\n  grad g = linear(0, #000000, #ffffff)\n' +
      'theme tb:\n  grad g = linear(0, #ffffff, #000000)\n' +
      'draw d:\n  fill g rect(0:0, 3:3)\n'
    const mod = engine.loadSource(src, `${process.cwd()}\\memgrad${n++}.drw`, 'mem.drw')
    const entry = mod.definitions.get('d')
    if (entry?.kind !== 'draw') {
      throw new Error('no draw d')
    }
    const span = { line: 1, column: 1 }
    // ta and tb differ ONLY in gradient direction (same palette/mode/font/size),
    // so a fingerprint that omits gradients would serve ta's cached sprite for tb.
    mod.fileTheme = engine.resolveUse(mod, undefined, 'ta', span, undefined)
    const s1 = engine.renderDraw(entry, [], span)
    mod.fileTheme = engine.resolveUse(mod, undefined, 'tb', span, undefined)
    const s2 = engine.renderDraw(entry, [], span)
    expect([...s1.data]).not.toEqual([...s2.data])
  })

  test('repeat executes its body a fixed number of times', () => {
    const s = render(
      'draw d 3x1:\n  pal k=#000000\n  x = 0\n  repeat 3:\n    px k x:0\n    x += 1\n',
      'd',
    )
    expect(px(s, 0, 0)[3]).toBe(255)
    expect(px(s, 1, 0)[3]).toBe(255)
    expect(px(s, 2, 0)[3]).toBe(255)
  })

  test('an unrecognized statement callee falls back to filter-sugar, dropped-value, or unknown-name', () => {
    const s = render(
      'filter retro:\n  outline #0000ff\n\ndraw d 6x6:\n  px #ff0000 3:3\n  retro\n',
      'd',
    )
    expect(px(s, 3, 2)).toEqual([0, 0, 255, 255])
    expect(px(s, 3, 3)).toEqual([255, 0, 0, 255])
    expect(() => render('draw d 2x2:\n  bg #fff\n  union\n', 'd')).toThrow(
      /the value of 'union' is dropped/,
    )
    expect(() => render('draw d 2x2:\n  bg #fff\n  foobarbaz\n', 'd')).toThrow(
      /unknown command 'foobarbaz'/,
    )
  })

  test('paint-first: a shape statement without a leading paint is the region-dropped error (E013)', () => {
    // paint is now the FIRST argument (ADR-0066); a bare shape drops its region.
    let caught: DrawsticError | undefined
    try {
      render('draw d 8x8:\n  bg #fff\n  circle 8:8 5\n', 'd')
    } catch (e) {
      caught = e as DrawsticError
    }
    expect(caught).toBeInstanceOf(DrawsticError)
    expect(caught?.code).toBe('E013')
    expect(caught?.message).toMatch(/region value dropped/)
    expect(caught?.hint).toMatch(/the paint is the first argument/)
    // poly is paint-first too: geometry-first drops the region the same way.
    expect(() => render('draw d 8x8:\n  bg #fff\n  poly 2:1 6:4 2:7\n', 'd')).toThrow(
      /region value dropped/,
    )
    // the new order renders without error.
    const s = render('draw d 8x8:\n  bg #fff\n  circle #1a1a1a 4:4 3 fill\n', 'd')
    expect(px(s, 4, 4)).toEqual([26, 26, 26, 255])
  })

  test('font glyph maps to an external drawing, with not-found/parametric errors', () => {
    const s = render(
      'draw runeA 3x3:\n  pal k=#000000\n  pixels:\n    k.k\n    .k.\n    k.k\n\nfont runic 3x3:\n  glyph "A" runeA\n\ndraw d 6x3:\n  text #ff0000 0:0 "A" font runic\n',
      'd',
    )
    expect(px(s, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(s, 1, 0)[3]).toBe(0)
    expect(px(s, 2, 0)).toEqual([0, 0, 0, 255])
    expect(() =>
      render(
        'font runic 3x3:\n  glyph "A" nope\n\ndraw d 6x3:\n  text #ff0000 0:0 "A" font runic\n',
        'd',
      ),
    ).toThrow(/glyph drawing 'nope' not found/)
    expect(() =>
      render(
        'draw runeP(c) 3x3:\n  circle c 1:1 1 fill\n\nfont runic 3x3:\n  glyph "A" runeP\n\ndraw d 6x3:\n  text #ff0000 0:0 "A" font runic\n',
        'd',
      ),
    ).toThrow(/glyph drawings must be non-parametric/)
  })

  test('font glyphs bulk-maps a tileset to characters, with tileset/coverage errors', () => {
    const s = render(
      'draw d0 2x2:\n  pal k=#000000\n  bg k\ndraw d1 2x2:\n  pal r=#ff0000\n  bg r\ndraw d2 2x2:\n  pal g=#00ff00\n  bg g\n\ntileset digits 2x2:\n  tiles d0, d1, d2\n  cols 3\n\nfont digitFont 2x2:\n  glyphs digits "012"\n\ndraw d 8x2:\n  text #000000 0:0 "1" font digitFont\n',
      'd',
    )
    expect(px(s, 0, 0)).toEqual([255, 0, 0, 255])
    expect(() =>
      render(
        'font digitFont 2x2:\n  glyphs nope "01"\n\ndraw d 8x2:\n  text #000000 0:0 "0" font digitFont\n',
        'd',
      ),
    ).toThrow(/glyphs tileset 'nope' not found/)
    expect(() =>
      render(
        'draw d0 2x2:\n  pal k=#000000\n  bg k\ndraw d1 2x2:\n  pal r=#ff0000\n  bg r\n\ntileset digits 2x2:\n  tiles d0, d1\n  cols 2\n\nfont digitFont 2x2:\n  glyphs digits "012"\n\ndraw d 8x2:\n  text #000000 0:0 "2" font digitFont\n',
        'd',
      ),
    ).toThrow(/tileset has no tile 2 for character "2"/)
  })

  test('path arc tessellates clockwise and counterclockwise around a center', () => {
    const cw = render(
      'path arcPath 9x9:\n  move 4:0\n  arc 4:8 around 4:4 cw\n\ndraw d 9x9:\n  stroke #000 arcPath\n',
      'd',
    )
    const ccw = render(
      'path arcPath 9x9:\n  move 4:0\n  arc 4:8 around 4:4 ccw\n\ndraw d 9x9:\n  stroke #000 arcPath\n',
      'd',
    )
    expect(px(cw, 8, 4)[3]).toBe(255)
    expect(px(cw, 0, 4)[3]).toBe(0)
    expect(px(ccw, 8, 4)[3]).toBe(0)
    expect(px(ccw, 0, 4)[3]).toBe(255)
  })

  test('a parametric path definition instantiates per call arguments', () => {
    const s = render(
      'path box(sz) 8x8:\n  move 0:0\n  line sz:0\n  line sz:sz\n  line 0:sz\n  close\n\ndraw d 8x8:\n  fill #ff0000 box(4)\n',
      'd',
    )
    expect(px(s, 0, 0)).toEqual([255, 0, 0, 255])
    expect(px(s, 4, 4)).toEqual([255, 0, 0, 255])
  })

  test('UFCS rotate/shift/scale apply directly to a path value', () => {
    const rotated = render(
      'path bar 8x8:\n  move 1:1\n  line 6:1\n  line 6:2\n  line 1:2\n  close\n\ndraw d 8x8:\n  p = bar.rotate(90).shift(6:0)\n  fill #ff0000 p\n',
      'd',
    )
    expect(px(rotated, 4, 1)).toEqual([255, 0, 0, 255])
    expect(px(rotated, 4, 0)[3]).toBe(0)
    const shiftedScaled = render(
      'path bar 8x8:\n  move 1:1\n  line 6:1\n  line 6:2\n  line 1:2\n  close\n\ndraw d 8x8:\n  p = bar.shift(0:2).scale(1)\n  fill #ff0000 p\n',
      'd',
    )
    expect(px(shiftedScaled, 1, 3)).toEqual([255, 0, 0, 255])
    expect(() =>
      render(
        'path bar 8x8:\n  move 1:1\n  line 6:1\n  line 6:2\n  line 1:2\n  close\n\ndraw d 8x8:\n  p = bar.scale(0)\n  fill #ff0000 p\n',
        'd',
      ),
    ).toThrow(/scale\(0\) is not invertible/)
  })

  test('mix() reads its color-space argument as a string, defaulting when absent/unrecognized', () => {
    const s = render(
      'draw d 3x1:\n  b = mix(#000000, #ffffff, 0.5, "hsl")\n  c = mix(#000000, #ffffff, 0.5, 5)\n  px b 1:0\n  px c 2:0\n',
      'd',
    )
    expect(px(s, 1, 0)).toEqual([128, 128, 128, 255])
    expect(px(s, 2, 0)).toEqual([99, 99, 99, 255])
  })

  test('stroke accepts cap/join keywords as accepted-but-no-op flags', () => {
    const s = render(
      'draw d 8x8:\n  r = rect(1:1, 5:5)\n  stroke #000000 r w2 cap round join bevel\n',
      'd',
    )
    expect(px(s, 1, 1)).toEqual([0, 0, 0, 255])
  })

  test('an unconsumed trailing command argument is a positioned E012', () => {
    try {
      render('draw d 2x2:\n  bg #ffffff bogus\n', 'd')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.toDiagnostic()).toMatchObject({
          code: 'E012',
          message: "unexpected extra argument 'bogus'",
        })
      }
    }
  })

  test('image import: success, sandbox/extension/not-found/sha/decode errors, and caching', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-eval-img-'))
    try {
      const data = new Uint8Array(2 * 2 * 4)
      for (let i = 0; i < 4; i++) {
        data[i * 4] = 255
        data[i * 4 + 3] = 255
      }
      const png = encodePngRgba(data, 2, 2)
      writeFileSync(join(dir, 'pic.png'), png)
      const realSha = createHash('sha256').update(png).digest('hex')

      const engine = new Engine(dir)
      const mod = engine.loadSource(
        `import photo = pic.png sha256 ${realSha}\n\ndraw d 2x2:\n  stamp photo 0:0\n`,
        join(dir, 'main.drw'),
        'main.drw',
      )
      const entry = mod.definitions.get('d')
      if (!entry) {
        throw new Error('no d')
      }
      const s = engine.defToSprite(entry, { line: 1, column: 1 })
      expect(px(s, 0, 0)).toEqual([255, 0, 0, 255])
      // re-resolving the same image entry hits the sprite cache
      const s2 = engine.defToSprite(entry, { line: 1, column: 1 })
      expect(s2).toBe(s)

      const shaEngine = new Engine(dir)
      try {
        const shaMod = shaEngine.loadSource(
          'import photo = pic.png sha256 deadbeef\n\ndraw d 2x2:\n  stamp photo 0:0\n',
          join(dir, 'main2.drw'),
          'main2.drw',
        )
        const shaEntry = shaMod.definitions.get('d')
        if (!shaEntry) {
          throw new Error('no d')
        }
        shaEngine.defToSprite(shaEntry, { line: 1, column: 1 })
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          expect(e.toDiagnostic()).toMatchObject({
            code: 'E020',
            message: "sha256 mismatch for 'pic.png'",
            hint: `actual: ${realSha}`,
          })
        }
      }

      const notFoundEngine = new Engine(dir)
      expect(() => {
        const m = notFoundEngine.loadSource(
          'import photo = missing.png\n\ndraw d 2x2:\n  stamp photo 0:0\n',
          join(dir, 'main3.drw'),
          'main3.drw',
        )
        const e = m.definitions.get('d')
        if (!e) {
          throw new Error('no d')
        }
        notFoundEngine.defToSprite(e, { line: 1, column: 1 })
      }).toThrow(/image not found: 'missing\.png'/)

      const extEngine = new Engine(dir)
      expect(() => {
        const m = extEngine.loadSource(
          'import photo = pic.jpg\n\ndraw d 2x2:\n  stamp photo 0:0\n',
          join(dir, 'main4.drw'),
          'main4.drw',
        )
        const e = m.definitions.get('d')
        if (!e) {
          throw new Error('no d')
        }
        extEngine.defToSprite(e, { line: 1, column: 1 })
      }).toThrow(/only PNG images can be imported/)

      const escapeEngine = new Engine(dir)
      expect(() => {
        const m = escapeEngine.loadSource(
          'import photo = ../outside.png\n\ndraw d 2x2:\n  stamp photo 0:0\n',
          join(dir, 'main5.drw'),
          'main5.drw',
        )
        const e = m.definitions.get('d')
        if (!e) {
          throw new Error('no d')
        }
        escapeEngine.defToSprite(e, { line: 1, column: 1 })
      }).toThrow(/image import escapes the project root/)

      writeFileSync(join(dir, 'bad.png'), Buffer.from('not really a png at all'))
      const decodeEngine = new Engine(dir)
      expect(() => {
        const m = decodeEngine.loadSource(
          'import photo = bad.png\n\ndraw d 2x2:\n  stamp photo 0:0\n',
          join(dir, 'main6.drw'),
          'main6.drw',
        )
        const e = m.definitions.get('d')
        if (!e) {
          throw new Error('no d')
        }
        decodeEngine.defToSprite(e, { line: 1, column: 1 })
      }).toThrow(/failed to decode 'bad\.png'/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('flipx applies to a path, to an existing transform, and bare (mirrors about x=0)', () => {
    const pathFlip = render(
      'path bar 8x8:\n  move 1:1\n  line 6:1\n  line 6:2\n  line 1:2\n  close\n\ndraw d 8x8:\n  p = bar.flipx().shift(7:0)\n  fill #ff0000 p\n',
      'd',
    )
    expect(px(pathFlip, 0, 1)[3]).toBe(0)
    expect(px(pathFlip, 1, 1)[3]).toBe(255)
    expect(px(pathFlip, 6, 1)[3]).toBe(255)
    expect(px(pathFlip, 7, 1)[3]).toBe(0)

    const transformFlip = render(
      'draw d 8x8:\n  t = shift(-8:0).flipx()\n  r = rect(1:1, 3:3)\n  fill #ff0000 r.transform(t)\n',
      'd',
    )
    expect(px(transformFlip, 4, 2)[3]).toBe(0)
    expect(px(transformFlip, 5, 2)[3]).toBe(255)
    expect(px(transformFlip, 7, 2)[3]).toBe(255)

    const bareFlip = render(
      'draw d 8x8:\n  t = flipx().shift(8:0)\n  r = rect(1:1, 3:3)\n  fill #ff0000 r.transform(t)\n',
      'd',
    )
    expect(px(bareFlip, 4, 2)[3]).toBe(0)
    expect(px(bareFlip, 5, 2)[3]).toBe(255)
    expect(px(bareFlip, 7, 2)[3]).toBe(255)
  })

  test('stamp transform:/mask: keyword modifiers are read via keywordExpression', () => {
    const transformed = render(
      'draw part 3x3:\n  bg #000000\n\ndraw d 8x8:\n  t = rotate(0)\n  stamp part 0:0 transform t\n',
      'd',
    )
    expect(px(transformed, 0, 0)).toEqual([0, 0, 0, 255])

    const masked = render(
      'draw part 3x3:\n  bg #000000\n\ndraw d 8x8:\n  m = rect(0:0, 1:1)\n  stamp part 0:0 mask m\n',
      'd',
    )
    expect(px(masked, 0, 0)).toEqual([0, 0, 0, 255])
    expect(px(masked, 2, 2)[3]).toBe(0)
  })

  test('apply with a non-name argument is a positioned arity error', () => {
    expect(() => render('draw d 2x2:\n  bg #fff\n  apply 5\n', 'd')).toThrow(/expected a name/)
  })

  test('== / != use structural equality for colors, points, and lists; regions are never equal', () => {
    const s = render(
      'draw d 2x2:\n  a = 1, 2, 3\n  b = 1, 2, 3\n  c = 1, 2\n  p1 = 1:2\n  p2 = 1:2\n  col1 = #ff0000\n  col2 = #ff0000\n  ok = (a == b) & (p1 == p2) & (col1 == col2) & (a != c)\n  if ok:\n    bg #ffffff\n  else:\n    bg #000000\n',
      'd',
    )
    expect(px(s, 0, 0)).toEqual([255, 255, 255, 255])

    const neverEqual = render(
      'draw d 2x2:\n  r1 = circle(1:1, 1)\n  r2 = circle(1:1, 1)\n  if r1 == r2:\n    bg #ffffff\n  else:\n    bg #000000\n',
      'd',
    )
    expect(px(neverEqual, 0, 0)).toEqual([0, 0, 0, 255])
  })

  test('fn/path (and other module-only definitions) nested in a draw get a move-to-module-scope hint (E004)', () => {
    const hint =
      'move it to module scope, above the draw — mask and grad definitions may stay drawing-local'
    for (const [src, message] of [
      ['draw d 2x2:\n  fn lerp2(a, b) = a + b\n  bg #fff\n', 'fn definitions live at module scope'],
      [
        'draw d 2x2:\n  path p:\n    move 0:0\n  bg #fff\n',
        'path definitions live at module scope',
      ],
      [
        'draw d 2x2:\n  theme t2:\n    pal k=#000000\n  bg #fff\n',
        'theme definitions live at module scope',
      ],
      [
        'draw d 2x2:\n  draw d2 2x2:\n    bg #000000\n  bg #fff\n',
        'draw definitions live at module scope',
      ],
    ] as const) {
      try {
        render(src, 'd')
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          expect(e.toDiagnostic()).toMatchObject({ code: 'E004', message, hint })
        }
      }
    }
  })

  test('mask/grad definitions stay legal inside a draw (no module-scope error)', () => {
    expect(() =>
      render('draw d 2x2:\n  grad g = linear(90, #000000, #ffffff)\n  bg g\n', 'd'),
    ).not.toThrow()
    expect(() =>
      render('draw d 2x2:\n  mask m = rect(0:0, 1:1)\n  fill #ff0000 m\n', 'd'),
    ).not.toThrow()
  })

  test('use <module> <name> with a themes/std-shaped module path gets a grammar hint (E008)', () => {
    for (const src of [
      'use themes dusk\n\ndraw d 2x2:\n  bg #fff\n',
      'use std dusk\n\ndraw d 2x2:\n  bg #fff\n',
    ]) {
      try {
        render(src, 'd')
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          expect(e.toDiagnostic()).toMatchObject({
            code: 'E008',
            hint: 'did you mean `use <name>` (local theme) or `use std/themes <name>` (bundled)?',
          })
        }
      }
    }
  })

  test('use <module> <name> with an unrelated missing module gets no themes/std hint', () => {
    try {
      render('use foo dusk\n\ndraw d 2x2:\n  bg #fff\n', 'd')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.toDiagnostic().hint).toBeUndefined()
      }
    }
  })

  // ── scatter (ADR-0077) ──────────────────────────────────────────────────────
  const opaque = (s: Sprite): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = []
    for (let y = 0; y < s.h; y++) {
      for (let x = 0; x < s.w; x++) {
        if ((s.data[(y * s.w + x) * 4 + 3] ?? 0) > 0) {
          out.push({ x, y })
        }
      }
    }
    return out
  }

  test('scatter places seeded points, all inside the region, deterministic across runs', () => {
    const src = 'draw d 24x24:\n  scatter p 30 7 circle(12:12, 8):\n    px #ffffff p\n'
    const a = render(src, 'd')
    const b = render(src, 'd')
    expect(Array.from(a.data)).toEqual(Array.from(b.data)) // two runs byte-identical
    const pts = opaque(a)
    expect(pts.length).toBeGreaterThan(0)
    expect(pts.length).toBeLessThanOrEqual(30) // ≤ n (sampling is with replacement)
    for (const p of pts) {
      const dx = p.x - 12
      const dy = p.y - 12
      expect(dx * dx + dy * dy).toBeLessThanOrEqual(8 * 8 + 8) // every point inside the circle
    }
  })

  test('scatter with a different seed yields a different arrangement', () => {
    const a = render('draw d 24x16:\n  scatter p 20 1 rect(0:0, 23:15):\n    px #fff p\n', 'd')
    const b = render('draw d 24x16:\n  scatter p 20 2 rect(0:0, 23:15):\n    px #fff p\n', 'd')
    expect(Array.from(a.data)).not.toEqual(Array.from(b.data))
  })

  test('scatter binds the point child-scoped and reads it like any point', () => {
    // one-pixel region → every one of the n points lands there
    const s = render('draw d 4x4:\n  scatter p 5 3 rect(2:1, 2:1):\n    px #ff0000 p\n', 'd')
    expect(px(s, 2, 1)).toEqual([255, 0, 0, 255])
    expect(opaque(s)).toHaveLength(1) // all 5 points coincide on the single region pixel
  })

  test('scatter over an empty region is a no-op (no error, draws nothing)', () => {
    const s = render(
      'draw d 6x4:\n  bg #123456\n  scatter p 10 1 intersect(rect(0:0, 1:1), rect(4:3, 5:3)):\n    px #ffffff p\n',
      'd',
    )
    expect(px(s, 0, 0)).toEqual([18, 52, 86, 255]) // only the background
    for (const p of opaque(s)) {
      expect(px(s, p.x, p.y)).toEqual([18, 52, 86, 255]) // nothing white anywhere
    }
  })

  test('scatter ticks the step budget once per iteration', () => {
    const eng = new Engine(process.cwd())
    const mod = eng.loadSource(
      'draw d 32x32:\n  scatter p 25 9 rect(0:0, 31:31):\n    px #fff p\n',
      `${process.cwd()}\\memscatter.drw`,
      'mem.drw',
    )
    const entry = mod.definitions.get('d')
    if (!entry) {
      throw new Error('no drawing d')
    }
    const before = eng.budget.steps
    eng.defToSprite(entry, { line: 1, column: 1 })
    expect(eng.budget.steps - before).toBeGreaterThanOrEqual(25) // ≥ one step per point
    expect(eng.budget.writes).toBeGreaterThan(0)
  })

  // ── mirror (ADR-0078) ───────────────────────────────────────────────────────
  test('mirror draws the body and its reflection; symmetric pixels are equal', () => {
    const s = render(
      'draw d 16x8:\n  mirror x=8:\n    px #40ff40 3:2\n    rect #ff4040 1:5 2:6 fill\n',
      'd',
    )
    // the single px at 3:2 reflects to 2*8-3 = 13
    expect(px(s, 3, 2)).toEqual([64, 255, 64, 255])
    expect(px(s, 13, 2)).toEqual([64, 255, 64, 255])
    // rect x 1..2 reflects to x 14..15
    expect(px(s, 1, 5)).toEqual([255, 64, 64, 255])
    expect(px(s, 14, 5)).toEqual([255, 64, 64, 255])
    expect(px(s, 15, 6)).toEqual([255, 64, 64, 255])
  })

  test('mirror paints an axis pixel exactly once — 50% alpha does not double-darken', () => {
    // a 50%-black rect straddling the axis at x=4; the on-axis column must blend once (127),
    // never twice (which would be ~64)
    const s = render(
      'draw d 9x3:\n  bg #ffffff\n  mirror x=4:\n    rect #00000080 3:0 4:2 fill\n',
      'd',
    )
    expect(px(s, 4, 1)).toEqual([127, 127, 127, 255]) // ON axis — single blend
    expect(px(s, 3, 1)).toEqual([127, 127, 127, 255]) // off-axis original
    expect(px(s, 5, 1)).toEqual([127, 127, 127, 255]) // mirrored copy — also single blend
    expect(px(s, 0, 1)).toEqual([255, 255, 255, 255]) // untouched
  })

  test('mirror flips stamps (mirror-with-flip)', () => {
    const src =
      'draw arrow 4x3:\n  pal a=#ff0000\n  pixels:\n    a...\n    aaaa\n    a...\ndraw d 12x3:\n  mirror x=6:\n    stamp arrow 1:0\n'
    const s = render(src, 'd')
    // left copy: stem on the left (col 1), top row red only at col 1
    expect(px(s, 1, 0)).toEqual([255, 0, 0, 255])
    expect(px(s, 4, 0)[3]).toBe(0)
    // right copy is the flip: stem on the right (col 11), top row red only at col 11
    expect(px(s, 11, 0)).toEqual([255, 0, 0, 255])
    expect(px(s, 8, 0)[3]).toBe(0)
    expect(px(s, 6, 1)[3]).toBe(0) // axis column between the two bars stays empty
  })

  test('nested mirror composes into four-fold symmetry; centre paints once', () => {
    const s = render(
      'draw d 9x9:\n  bg #ffffff\n  mirror x=4:\n    mirror y=4:\n      rect #00000080 4:4 4:4 fill\n',
      'd',
    )
    // the only painted cell is the shared centre (4,4): all four passes map to it, painted once
    expect(px(s, 4, 4)).toEqual([127, 127, 127, 255]) // single 50% blend, not 4× darkened
    const nonWhite = opaque(s).filter((p) => px(s, p.x, p.y)[0] !== 255)
    expect(nonWhite).toHaveLength(1)
  })

  test('nested mirror mirrors a corner block into all four quadrants', () => {
    const s = render(
      'draw d 9x9:\n  mirror x=4:\n    mirror y=4:\n      rect #2080ff 0:0 1:1 fill\n',
      'd',
    )
    const corners: [number, number][] = [
      [0, 0],
      [8, 0],
      [0, 8],
      [8, 8],
    ]
    for (const [x, y] of corners) {
      expect(px(s, x, y)).toEqual([32, 128, 255, 255])
    }
  })

  test('scatter inside mirror is a symmetric random field', () => {
    // region x 1..9 so every mirror (20 - x = 11..19) stays on-canvas
    const s = render(
      'draw d 20x10:\n  mirror x=10:\n    scatter p 12 5 rect(1:0, 9:9):\n      px #ffffff p\n',
      'd',
    )
    const pts = opaque(s)
    expect(pts.length).toBeGreaterThan(1)
    // every painted pixel has its mirror (across x=10) painted identically
    for (const p of pts) {
      expect(px(s, 20 - p.x, p.y)).toEqual(px(s, p.x, p.y))
    }
  })

  test('mirror ticks the write budget for both passes', () => {
    const eng = new Engine(process.cwd())
    const mod = eng.loadSource(
      'draw d 16x8:\n  mirror x=8:\n    rect #ff0000 1:1 3:6 fill\n',
      `${process.cwd()}\\memmirror.drw`,
      'mem.drw',
    )
    const entry = mod.definitions.get('d')
    if (!entry) {
      throw new Error('no drawing d')
    }
    eng.defToSprite(entry, { line: 1, column: 1 })
    // 3×6 = 18 pixels drawn twice (original + mirror), none on the axis → 36 writes
    expect(eng.budget.writes).toBeGreaterThanOrEqual(36)
  })
})
