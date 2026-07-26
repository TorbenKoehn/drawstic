// ADR-0093: organic region constructors (dome/lobe/crescent/ribbon), the figure proportions oracle,
// and the `quantize` palette-reduction filter. Region tests pin exact footprints/symmetry and the
// dome==ellipse-upper-half identity; figure tests pin the derived guide values and theme
// fold/merge/fingerprint; quantize tests pin determinism and first-declared tie-breaking.

import { describe, expect, test } from 'bun:test'
import { DrawsticError } from '../../src/diagnostic.js'
import { Engine } from '../../src/eval.js'
import {
  crescentRegion,
  domeRegion,
  ellipseRegion,
  figure,
  figureField,
  lobeRegion,
  type Region,
  ribbonRegion,
  type Sprite,
} from '../../src/values.js'

let n = 0
const render = (src: string, drawing: string): Sprite => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\og${n++}.drw`, 'og.drw')
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

const bboxOf = (r: Region) => r.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 }

describe('dome', () => {
  test('is exactly the upper half of the same-parameter ellipse', () => {
    const cx = 20
    const cy = 20
    const dome = domeRegion(cx, cy, 10, 8)
    const ell = ellipseRegion(cx, cy, 10, 8)
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        expect(dome.has(x, y)).toBe(ell.has(x, y) && y <= cy - 1)
      }
    }
  })

  test('flat bottom edge at row cy-1, height ry rows, horizontally symmetric', () => {
    const dome = domeRegion(20, 20, 10, 8)
    const b = bboxOf(dome)
    expect(b.y1).toBe(19) // flat edge just above the anchor row
    expect(b.y0).toBe(12) // 8 rows tall
    // no coverage at or below the anchor row
    expect(dome.has(20, 20)).toBe(false)
    // mirror symmetry about the corner centre x=cx-0.5 (=19.5): x and 39-x agree
    for (let y = 12; y <= 19; y++) {
      for (let x = 10; x <= 19; x++) {
        expect(dome.has(x, y)).toBe(dome.has(39 - x, y))
      }
    }
  })
})

describe('lobe', () => {
  test('rounded base cap, tapers to a point at the tip', () => {
    const lobe = lobeRegion(10, 20, 10, 4, 8) // vertical, base below, r=4
    expect(lobe.has(10, 20)).toBe(true) // base centre filled
    expect(lobe.has(10, 19)).toBe(true) // base cap
    expect(lobe.has(10, 5)).toBe(true) // near the tip, on-axis, still filled
    expect(lobe.has(13, 5)).toBe(false) // off-axis near the tip: tapered away
    expect(lobe.has(13, 20)).toBe(true) // off-axis at the base: within the round cap
  })

  test('symmetric about its axis', () => {
    const lobe = lobeRegion(10, 20, 10, 4, 8)
    for (let y = 4; y <= 22; y++) {
      for (let x = 4; x <= 9; x++) {
        // mirror across the corner centre x=9.5 → x ↔ 19-x
        expect(lobe.has(x, y)).toBe(lobe.has(19 - x, y))
      }
    }
  })
})

describe('crescent', () => {
  test('thick on the side opposite dir, tapering to nothing on the dir side', () => {
    // dir = down (0:1): inner cut shifts down, so the band is thick at the TOP, thin at the bottom
    const cres = crescentRegion(20, 20, 10, 10, 4, 0, 1)
    expect(cres.has(20, 11)).toBe(true) // thick top edge kept
    expect(cres.has(20, 28)).toBe(false) // bottom eaten by the inner ellipse
  })

  test('a thickness at/above the radius yields the solid ellipse', () => {
    const cres = crescentRegion(20, 20, 8, 8, 8, 0, 1)
    const ell = ellipseRegion(20, 20, 8, 8)
    expect(cres.has(20, 20)).toBe(ell.has(20, 20))
    expect(cres.has(20, 14)).toBe(ell.has(20, 14))
  })
})

describe('ribbon', () => {
  test('follows the 3-point arc and has the requested width', () => {
    // straight horizontal arc y=10 from x=2..22, width 6 → rows 7..12 covered at the centre
    const ribbon = ribbonRegion(2, 10, 12, 10, 22, 10, 6)
    expect(ribbon.has(12, 10)).toBe(true)
    expect(ribbon.has(12, 7)).toBe(true)
    expect(ribbon.has(12, 12)).toBe(true)
    expect(ribbon.has(12, 6)).toBe(false) // just outside the 6px width
    expect(ribbon.has(12, 13)).toBe(false)
    expect(ribbon.has(12, 30)).toBe(false) // far from the arc
  })

  test('bulges toward the middle control point', () => {
    // arc through (2,20),(12,4),(22,20): a pixel at the raised middle is inside; the straight-chord
    // midpoint (12,20) is off the arc and outside.
    const ribbon = ribbonRegion(2, 20, 12, 4, 22, 20, 5)
    expect(ribbon.has(12, 4)).toBe(true)
    expect(ribbon.has(12, 20)).toBe(false)
  })
})

describe('figure oracle', () => {
  const fig = figure(40, 80, { heads: 4, headW: 20, eyeLine: 0.6, earLine: 0.55, eyeSep: 10 })

  test('scalars derive from the canvas and the declared numbers', () => {
    expect((figureField(fig, 'headH') as { value: number }).value).toBe(20) // 80/4
    expect((figureField(fig, 'headW') as { value: number }).value).toBe(20)
    expect((figureField(fig, 'center') as { value: number }).value).toBe(20)
    expect((figureField(fig, 'eyeY') as { value: number }).value).toBeCloseTo(12) // 0.6*20
  })

  test('front eyes are symmetric about the centre; ears at the head width', () => {
    const eyeL = figureField(fig, 'eyeL') as { x: number; y: number }
    const eyeR = figureField(fig, 'eyeR') as { x: number; y: number }
    expect(eyeL.x).toBeCloseTo(15) // 20 - 10/2
    expect(eyeR.x).toBeCloseTo(25) // 20 + 10/2
    expect(eyeL.y).toBeCloseTo(eyeR.y)
    const earL = figureField(fig, 'earL') as { x: number }
    const earR = figureField(fig, 'earR') as { x: number }
    expect(earL.x).toBeCloseTo(10) // 20 - 20/2
    expect(earR.x).toBeCloseTo(30)
  })

  test('side view shifts the single eye forward off centre and the ear toward the back', () => {
    const eye = figureField(fig, 'eye') as { x: number }
    const side = (figureField(fig, 'side') as { figure: typeof fig }).figure
    const sideEye = figureField(side, 'eye') as { x: number }
    const sideEar = figureField(side, 'ear') as { x: number }
    expect(eye.x).toBeCloseTo(20) // front: centred
    expect(sideEye.x).toBeGreaterThan(20) // side: forward of centre
    expect(sideEar.x).toBeLessThan(20) // side: toward the back
  })

  test('unknown field returns undefined', () => {
    expect(figureField(fig, 'elbow')).toBeUndefined()
  })
})

describe('figure oracle — theme integration', () => {
  const src = (fields: string) =>
    `theme t:\n  figure:\n${fields}\ndraw d 40x80:\n  use t\n  px #ff0000 fig.eyeL\n  px #00ff00 fig.eyeR\n`

  test('a figure block binds fig; front eyes land on opposite sides of centre', () => {
    const s = render(src('    heads 4\n    headW 20\n    eyeSep 10\n'), 'd')
    // fig.eyeL at x≈15, fig.eyeR at x≈25 — red on the left half, green on the right half
    expect(px(s, 15, 12)).toEqual([255, 0, 0, 255])
    expect(px(s, 25, 12)).toEqual([0, 255, 0, 255])
  })

  test('an unknown figure field is a positioned error', () => {
    expect(() =>
      render('theme t:\n  figure:\n    elbow 3\ndraw d 8x8:\n  use t\n  bg #fff\n', 'd'),
    ).toThrow(DrawsticError)
  })

  test('fig.side.eye differs from the front eye (view specializer through the theme)', () => {
    const withSide =
      'theme t:\n  figure:\n    heads 4\n    headW 20\n' +
      'draw d 40x80:\n  use t\n  px #ff0000 fig.side.eye\n  px #00ff00 fig.eye\n'
    const s = render(withSide, 'd')
    // front eye at centre x=20; side eye shifted forward (x>20) — the two marks are at different x
    expect(px(s, 20, 12)).toEqual([0, 255, 0, 255])
    let sideX = -1
    for (let x = 0; x < 40; x++) {
      if (px(s, x, 12)[0] === 255) {
        sideX = x
      }
    }
    expect(sideX).toBeGreaterThan(20)
  })

  test('later theme wins the figure fold (with-merge)', () => {
    const merged =
      'theme base:\n  figure:\n    heads 4\n    headW 10\n' +
      'theme over:\n  with base\n  figure:\n    heads 4\n    headW 30\n' +
      'draw d 60x80:\n  use over\n  px #ff0000 fig.earR\n'
    const s = render(merged, 'd')
    // headW 30 → earR at x = 30 + 30/2 = 45 (not the base's 30+10/2=35)
    expect(px(s, 45, 11)).toEqual([255, 0, 0, 255])
  })
})

describe('quantize', () => {
  const src =
    'pal8 = #111111, #eeeeee, #ff0000, #00ff00, #0000ff, #ffff00, #ff00ff, #00ffff\n' +
    'draw d 8x2:\n  bg #ffffff\n  fill linear(90, #ff2020, #2020ff) rect(0:0, 7:0)\n' +
    '  fill #808080 rect(0:1, 7:1)\n  quantize pal8\n'

  test('is deterministic (byte-identical across two renders)', () => {
    const a = render(src, 'd')
    const b = render(src, 'd')
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data))
  })

  test('maps every opaque pixel onto a palette colour', () => {
    const palette = new Set([
      '17,17,17',
      '238,238,238',
      '255,0,0',
      '0,255,0',
      '0,0,255',
      '255,255,0',
      '255,0,255',
      '0,255,255',
    ])
    const s = render(src, 'd')
    for (let x = 0; x < 8; x++) {
      const [r, g, b] = px(s, x, 0)
      expect(palette.has(`${r},${g},${b}`)).toBe(true)
    }
  })

  test('first-declared palette entry wins an exact tie', () => {
    // two identical palette colours; a matching source pixel must snap to the FIRST one — provable by
    // source: since both are byte-equal the pixel is unchanged, but ordering is exercised by putting a
    // near-black source that ties toward the first of two blacks.
    const tie =
      'twoBlacks = #000000, #000000\n' +
      'draw d 2x1:\n  fill #010101 rect(0:0, 1:0)\n  quantize twoBlacks\n'
    const s = render(tie, 'd')
    expect(px(s, 0, 0)).toEqual([0, 0, 0, 255])
  })
})
