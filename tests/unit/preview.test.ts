import { describe, expect, test } from 'bun:test'
import { Engine } from '../../src/eval.js'
import {
  applyGridOverlay,
  cropSprite,
  detectPlateFigure,
  diffRasters,
  fitSprite,
  silhouetteSprite,
  spritePreviewStats,
  spriteToAnsi,
  spriteToAscii,
} from '../../src/preview.js'
import type { Sprite } from '../../src/values.js'

let n = 0
const render = (src: string, drawing: string): Sprite => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\previewmem${n++}.drw`, 'mem.drw')
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

describe('spritePreviewStats()', () => {
  test('100% palette coverage when every painted pixel matches a palette entry', () => {
    const s = render('draw d 2x2:\n  palette k=#000000\n  pixels:\n    kk\n    kk\n', 'd')
    expect(spritePreviewStats(s)).toEqual({
      unknownPixelCount: 0,
      unknownColorCount: 0,
      paletteCoveredPercent: 100,
    })
  })

  test('raw colors painted outside the palette block count as unknown', () => {
    // px 1:0 paints a raw hex that was never declared in `palette`, so it isn't
    // in sprite.pal and must be counted as unknown coverage.
    const s = render(
      'draw d 2x2:\n  palette k=#000000\n  px k 0:0\n  px #ff0000 1:0\n  px k 0:1\n',
      'd',
    )
    expect(spritePreviewStats(s)).toEqual({
      unknownPixelCount: 1,
      unknownColorCount: 1,
      paletteCoveredPercent: 66.67,
    })
  })

  test('fully transparent sprite reports 100% coverage (nothing painted)', () => {
    const s = render('draw d 2x2:\n  palette k=#000000\n', 'd')
    expect(spritePreviewStats(s)).toEqual({
      unknownPixelCount: 0,
      unknownColorCount: 0,
      paletteCoveredPercent: 100,
    })
  })
})

describe('cropSprite()', () => {
  const base = (): Sprite =>
    render(
      'draw d 4x4:\n  palette a=#111111 b=#222222 c=#333333 d=#444444\n  pixels:\n    aabb\n    aabb\n    ccdd\n    ccdd\n',
      'd',
    )

  test('in-bounds crop returns the requested rectangle and matching pixels', () => {
    const { sprite, crop } = cropSprite(base(), { x: 1, y: 1, width: 2, height: 2 })
    expect(crop).toEqual({ x: 1, y: 1, width: 2, height: 2 })
    expect(sprite.w).toBe(2)
    expect(sprite.h).toBe(2)
    expect(px(sprite, 0, 0)).toEqual([17, 17, 17, 255]) // a
    expect(px(sprite, 1, 0)).toEqual([34, 34, 34, 255]) // b
    expect(px(sprite, 0, 1)).toEqual([51, 51, 51, 255]) // c
    expect(px(sprite, 1, 1)).toEqual([68, 68, 68, 255]) // d
  })

  test('crop clipped against the far edge is clamped, not thrown', () => {
    const { sprite, crop } = cropSprite(base(), { x: 3, y: 3, width: 5, height: 5 })
    expect(crop).toEqual({ x: 3, y: 3, width: 1, height: 1 })
    expect(sprite.w).toBe(1)
    expect(sprite.h).toBe(1)
    expect(px(sprite, 0, 0)).toEqual([68, 68, 68, 255]) // d, the bottom-right cell
  })

  test('negative origin is clamped up to 0', () => {
    const { sprite, crop } = cropSprite(base(), { x: -2, y: -2, width: 3, height: 3 })
    expect(crop).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(px(sprite, 0, 0)).toEqual([17, 17, 17, 255]) // a
  })

  test('crop entirely outside the sprite yields a zero-sized result', () => {
    const { sprite, crop } = cropSprite(base(), { x: 10, y: 10, width: 2, height: 2 })
    expect(crop).toEqual({ x: 4, y: 4, width: 0, height: 0 })
    expect(sprite.w).toBe(0)
    expect(sprite.h).toBe(0)
    expect(sprite.data.length).toBe(0)
  })
})

describe('fitSprite()', () => {
  test('downscales preserving aspect ratio when the sprite exceeds the fit box', () => {
    const s = render('draw d 4x4:\n  bg #ff00ff\n', 'd')
    const { sprite, fitted } = fitSprite(s, { width: 2, height: 2 })
    expect(fitted).toBe(true)
    expect(sprite.w).toBe(2)
    expect(sprite.h).toBe(2)
    expect(sprite.data.length).toBe(2 * 2 * 4)
  })

  test('is a no-op when the sprite already fits (same sprite reference)', () => {
    const s = render('draw d 4x4:\n  bg #ff00ff\n', 'd')
    const result = fitSprite(s, { width: 8, height: 8 })
    expect(result.fitted).toBe(false)
    expect(result.sprite).toBe(s)
  })

  test('exact-match dimensions are also a no-op, not an upscale', () => {
    const s = render('draw d 4x4:\n  bg #ff00ff\n', 'd')
    const result = fitSprite(s, { width: 4, height: 4 })
    expect(result.fitted).toBe(false)
    expect(result.sprite).toBe(s)
  })

  test('non-square sprites scale both axes by the same (limiting) factor', () => {
    const s = render('draw d 8x4:\n  bg #ff00ff\n', 'd')
    const { sprite, fitted } = fitSprite(s, { width: 4, height: 4 })
    expect(fitted).toBe(true)
    expect(sprite.w).toBe(4)
    expect(sprite.h).toBe(2)
  })

  test('a degenerate axis is clamped to at least 1px (height)', () => {
    const s = render('draw d 10x1:\n  bg #ff00ff\n', 'd')
    const { sprite, fitted } = fitSprite(s, { width: 2, height: 2 })
    expect(fitted).toBe(true)
    expect(sprite.w).toBe(2)
    expect(sprite.h).toBe(1)
  })

  test('a degenerate axis is clamped to at least 1px (width)', () => {
    const s = render('draw d 1x10:\n  bg #ff00ff\n', 'd')
    const { sprite, fitted } = fitSprite(s, { width: 2, height: 2 })
    expect(fitted).toBe(true)
    expect(sprite.w).toBe(1)
    expect(sprite.h).toBe(2)
  })
})

describe('spriteToAscii()', () => {
  test('transparent and opaque-black pixels both render as the sparsest glyph (space)', () => {
    // No visual difference between "no paint" and "painted pure black" on a
    // dark terminal — both are luminance 0.
    const s = render('draw d 2x1:\n  palette k=#000000\n  pixels:\n    .k\n', 'd')
    expect(spriteToAscii(s)).toBe('  \n')
  })

  test('opaque white maps to the densest glyph', () => {
    const s = render('draw d 2x1:\n  palette p=#ffffff\n  pixels:\n    .p\n', 'd')
    expect(spriteToAscii(s)).toBe(' @\n')
  })

  test('a dark scene reads sparse and a bright motif embedded in it stands out dense', () => {
    // Regression for the ink-density bug (TODO-IMP §3.1): a near-black night
    // sky used to invert to dense glyphs while the bright moon vanished.
    const s = render('draw d 4x1:\n  palette n=#0a0a14 m=#fefef0\n  pixels:\n    nnmn\n', 'd')
    const ascii = spriteToAscii(s)
    const rows = ascii.split('\n')
    const row = rows[0] ?? ''
    // Night-sky pixels are sparse/dark glyphs, strictly sparser than the moon.
    const rampIndex = (ch: string): number => ' .:-=+*#%@'.indexOf(ch)
    expect(rampIndex(row[2] ?? ' ')).toBeGreaterThan(rampIndex(row[0] ?? ' '))
    expect(rampIndex(row[2] ?? ' ')).toBeGreaterThan(rampIndex(row[1] ?? ' '))
    expect(row[2]).toBe('@')
  })

  test('mid-saturation red is not maximally dense (true relative luminance, not raw ink)', () => {
    // Pure red has WCAG relative luminance ~0.21 — nowhere near white's 1.0 —
    // so it must not map to the densest glyph the way naive luma/ink-density did.
    const s = render('draw d 1x1:\n  palette r=#ff0000\n  pixels:\n    r\n', 'd')
    expect(spriteToAscii(s)).not.toBe('@\n')
  })
})

describe('spriteToAnsi()', () => {
  test('a fully-painted row pair uses top+bottom 24-bit color and a half-block', () => {
    const s = render(
      'draw d 2x2:\n  palette a=#112233 b=#445566 c=#778899 d=#aabbcc\n  pixels:\n    ab\n    cd\n',
      'd',
    )
    expect(spriteToAnsi(s)).toBe(
      '\x1b[38;2;17;34;51m\x1b[48;2;119;136;153m▀' +
        '\x1b[38;2;68;85;102m\x1b[48;2;170;187;204m▀\x1b[0m\n',
    )
  })

  test('bottom-only-painted pixel pair uses the lower half-block glyph', () => {
    const s = render('draw d 1x2:\n  palette r=#ff0000\n  pixels:\n    .\n    r\n', 'd')
    expect(spriteToAnsi(s)).toBe('\x1b[0m\x1b[38;2;255;0;0m▄\x1b[0m\n')
  })

  test('top-only-painted pixel pair uses the upper half-block glyph', () => {
    const s = render('draw d 1x2:\n  palette g=#00ff00\n  pixels:\n    g\n    .\n', 'd')
    expect(spriteToAnsi(s)).toBe('\x1b[0m\x1b[38;2;0;255;0m▀\x1b[0m\n')
  })

  test('a fully-transparent pixel pair renders as a plain reset space', () => {
    const s = render('draw d 1x2:\n  palette k=#000000\n', 'd')
    expect(spriteToAnsi(s)).toBe('\x1b[0m \x1b[0m\n')
  })

  test('odd sprite height treats the missing bottom row as transparent', () => {
    const s = render('draw d 1x1:\n  bg #123456\n', 'd')
    expect(spriteToAnsi(s)).toBe('\x1b[0m\x1b[38;2;18;52;86m▀\x1b[0m\n')
  })
})

describe('applyGridOverlay() (render --grid N)', () => {
  const fill = (
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): Uint8Array => {
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
    return data
  }

  const px = (
    data: Uint8Array,
    width: number,
    x: number,
    y: number,
  ): [number, number, number, number] => {
    const i = (y * width + x) * 4
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0]
  }

  test('lines are exactly 1 output-pixel thin at the requested source-pixel spacing', () => {
    const data = fill(20, 20, 10, 20, 30, 255)
    const out = applyGridOverlay(data, 20, 20, 5, 1)
    // y=7 avoids every label's actual glyph columns (labels start at x=1) and
    // isn't itself a gridline row, so only the x=10/x=15 gridline columns flip.
    expect(px(out, 20, 10, 7)).toEqual([245, 235, 225, 255])
    expect(px(out, 20, 15, 7)).toEqual([245, 235, 225, 255])
    expect(px(out, 20, 12, 7)).toEqual([10, 20, 30, 255]) // between lines, untouched
    expect(px(out, 20, 0, 7)).toEqual([245, 235, 225, 255]) // the x=0 boundary line
  })

  test('a full gridline row is inverted across its whole width', () => {
    const data = fill(20, 20, 10, 20, 30, 255)
    const out = applyGridOverlay(data, 20, 20, 5, 1)
    expect(px(out, 20, 12, 10)).toEqual([245, 235, 225, 255]) // y=10 is a horizontal line
  })

  test('scale multiplies the line pitch but keeps the line 1 output-pixel wide', () => {
    const data = fill(40, 40, 0, 0, 0, 255)
    const out = applyGridOverlay(data, 40, 40, 5, 4) // pitch = 5*4 = 20
    expect(px(out, 40, 20, 30)).toEqual([255, 255, 255, 255]) // on the line
    expect(px(out, 40, 19, 30)).toEqual([0, 0, 0, 255]) // 1px before it, untouched
    expect(px(out, 40, 21, 30)).toEqual([0, 0, 0, 255]) // 1px after it, untouched
  })

  test('an overlay pixel forces full opacity even over a transparent background', () => {
    const data = new Uint8Array(12 * 12 * 4) // fully transparent black
    // spacing 10 keeps the only gridline/label cluster near the origin, well
    // clear of (6, 6).
    const out = applyGridOverlay(data, 12, 12, 10, 1)
    expect(px(out, 12, 0, 0)).toEqual([255, 255, 255, 255]) // inverted (0,0,0) forced opaque
    expect(px(out, 12, 6, 6)).toEqual([0, 0, 0, 0]) // off the grid, untouched
  })

  test('edge labels scale their glyph cells with the --png@K scale factor', () => {
    // Isolate the "0" label for the (0,0) origin: spacing 20 keeps every other
    // line/label off a 40x40 canvas, so only the digit glyph at scale 3 is live.
    const data = new Uint8Array(40 * 40 * 4) // fully transparent
    const out = applyGridOverlay(data, 40, 40, 20, 3)
    // digit '0' = ['111','101','101','101','111'] at 3px cells, origin (3,3):
    // row 0 (y 3..5) is fully lit; row 1 (y 6..8) only the outer columns are.
    expect(px(out, 40, 4, 4)).toEqual([255, 255, 255, 255]) // row 0, col 0 — lit
    expect(px(out, 40, 7, 4)).toEqual([255, 255, 255, 255]) // row 0, col 1 — lit ('111')
    expect(px(out, 40, 7, 7)).toEqual([0, 0, 0, 0]) // row 1, col 1 — unlit ('101')
    expect(px(out, 40, 10, 7)).toEqual([255, 255, 255, 255]) // row 1, col 2 — lit
  })

  test('a non-positive spacing is a no-op', () => {
    const data = fill(4, 4, 1, 2, 3, 255)
    expect(applyGridOverlay(data, 4, 4, 0, 1)).toEqual(data)
    expect(applyGridOverlay(data, 4, 4, -3, 1)).toEqual(data)
  })
})

describe('diffRasters() (render --diff <png>)', () => {
  const solid = (
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): Uint8Array => {
    const data = new Uint8Array(width * height * 4)
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
    return data
  }

  const setPx = (
    data: Uint8Array,
    width: number,
    x: number,
    y: number,
    rgba: [number, number, number, number],
  ): void => {
    const i = (y * width + x) * 4
    data[i] = rgba[0]
    data[i + 1] = rgba[1]
    data[i + 2] = rgba[2]
    data[i + 3] = rgba[3]
  }

  test('identical rasters report no changes and a null bbox', () => {
    const a = solid(8, 8, 1, 2, 3, 255)
    const b = solid(8, 8, 1, 2, 3, 255)
    expect(diffRasters(a, b, 8, 8)).toEqual({
      identical: true,
      changedPixelCount: 0,
      totalPixelCount: 64,
      changedBBox: null,
    })
  })

  test('a single changed pixel yields a 1x1 bbox at its exact location', () => {
    const a = solid(8, 8, 0, 0, 0, 255)
    const b = solid(8, 8, 0, 0, 0, 255)
    setPx(b, 8, 5, 2, [255, 0, 0, 255])
    expect(diffRasters(a, b, 8, 8)).toEqual({
      identical: false,
      changedPixelCount: 1,
      totalPixelCount: 64,
      changedBBox: { x: 5, y: 2, width: 1, height: 1 },
    })
  })

  test('the bbox spans two separate changes without inflating the changed count', () => {
    const a = solid(10, 10, 0, 0, 0, 255)
    const b = solid(10, 10, 0, 0, 0, 255)
    setPx(b, 10, 1, 1, [255, 0, 0, 255])
    setPx(b, 10, 8, 7, [0, 255, 0, 255])
    const diff = diffRasters(a, b, 10, 10)
    expect(diff.identical).toBe(false)
    expect(diff.changedPixelCount).toBe(2) // only the two touched pixels, not the bbox area
    expect(diff.changedBBox).toEqual({ x: 1, y: 1, width: 8, height: 7 })
  })

  test('an alpha-only change still counts as changed', () => {
    const a = solid(4, 4, 100, 100, 100, 255)
    const b = solid(4, 4, 100, 100, 100, 255)
    setPx(b, 4, 0, 0, [100, 100, 100, 0])
    const diff = diffRasters(a, b, 4, 4)
    expect(diff.changedPixelCount).toBe(1)
    expect(diff.changedBBox).toEqual({ x: 0, y: 0, width: 1, height: 1 })
  })
})

describe('silhouetteSprite() / detectPlateFigure() (render --silhouette, ADR-0083 amendment)', () => {
  const coverageMask = (s: Sprite): Uint8Array => {
    const covered = new Uint8Array(s.w * s.h)
    for (let p = 0; p < covered.length; p++) {
      if ((s.data[p * 4 + 3] ?? 0) > 0) {
        covered[p] = 1
      }
    }
    return covered
  }

  // icon-craft.md's canonical build order: an opaque rounded-rect plate/tile stamped first, a
  // high-contrast glyph (a ring) painted on top — real pixel evidence of a genuine plate.
  const platedIcon = (): Sprite =>
    render(
      `draw iconA 32x32:
  rrect linear(90, #6fa8f5, #2a5db0) 2:2 29:29 6 fill
  fill #f7faff circle(16:16, 7).subtract(circle(16:16, 3))
`,
      'iconA',
    )

  test('a plated icon is detected: the figure is the glyph alone, not the plate', () => {
    const sprite = platedIcon()
    const plateFigure = detectPlateFigure(sprite, coverageMask(sprite))
    expect(plateFigure).not.toBeNull()
    // The ring glyph is a small fraction of the 32x32 plate — nowhere near its full coverage.
    const figurePx = plateFigure ? plateFigure.mask.reduce((a, b) => a + b, 0) : 0
    expect(figurePx).toBeGreaterThan(0)
    expect(figurePx).toBeLessThan(sprite.w * sprite.h * 0.3)
  })

  test('silhouetteSprite() on a plated icon draws only the glyph, plateDetected: true', () => {
    const sprite = platedIcon()
    const result = silhouetteSprite(sprite)
    expect(result.plateDetected).toBe(true)
    // The plate's own corner (well inside its margin, far from the glyph) is fully subtracted —
    // painted neither black nor anything else — proving the mask is the glyph, not the full plate.
    expect(px(result.sprite, 4, 4)).toEqual([0, 0, 0, 0])
    // The glyph ring itself still silhouettes solid black (e.g. its top point at 16:9).
    expect(px(result.sprite, 16, 9)).toEqual([0, 0, 0, 255])
  })

  test('a small shape on a transparent canvas (never touching all four edges) is never a plate', () => {
    const sprite = render('draw item 20x10:\n  rect #ff00ff 4:3 17:7 fill\n', 'item')
    expect(detectPlateFigure(sprite, coverageMask(sprite))).toBeNull()
    const result = silhouetteSprite(sprite)
    expect(result.plateDetected).toBe(false)
    // Unchanged full-mask silhouette: every covered pixel (the whole 14x5 rect), nothing more.
    let opaqueCount = 0
    for (let i = 3; i < result.sprite.data.length; i += 4) {
      if (result.sprite.data[i] === 255) {
        opaqueCount++
      }
    }
    expect(opaqueCount).toBe(14 * 5)
  })

  // Regression (release 1.0 hardening): reusing `detectPlateFigure` for `--silhouette` first
  // shipped with only the edge-touch + area-dominance + row-span gates, which correctly fixed
  // assembled character views but missed this case entirely — a lone character/item **part**
  // rendered standalone (exactly the debug workflow `character-craft.md` prescribes for
  // `--silhouette`) is itself a large, solid, edge-to-edge mass with only a tiny high-contrast
  // accent escaping the flood, geometrically indistinguishable from a plate-plus-glyph by every
  // other measured signature. `PLATE_MIN_FIGURE_FRACTION` closes it. Measured on the real bundled
  // corpus this fired on `characters-ro2/assassin.drw#cloakFront|cloakBack|legsFront`,
  // `characters-ro2/wizard.drw#robeSide`, and `scenes-v3/market.drw#barrel`; this fixture
  // reproduces the shape (a solid organic body with a small contrasting accent) without depending
  // on the example files.
  test('a solid organic part with a tiny high-contrast accent is never mistaken for a plate', () => {
    const sprite = render(
      `draw part 24x40:
  fill #8a6a4a ellipse(12:20, 11:19)
  rect #3a2a1a 10:2 13:5 fill
`,
      'part',
    )
    const covered = coverageMask(sprite)
    expect(detectPlateFigure(sprite, covered)).toBeNull()
    const result = silhouetteSprite(sprite)
    expect(result.plateDetected).toBe(false)
    let coveredCount = 0
    for (const v of covered) {
      coveredCount += v
    }
    let opaqueCount = 0
    for (let i = 3; i < result.sprite.data.length; i += 4) {
      if (result.sprite.data[i] === 255) {
        opaqueCount++
      }
    }
    // The whole organic silhouette silhouettes solid, unchanged from the naive full-mask transform
    // — the small dark accent rect does not get read as a "glyph" and carved out of it.
    expect(opaqueCount).toBe(coveredCount)
  })

  test('a fully-opaque full-bleed sprite (a scene, no transparent margin at all) is never a plate', () => {
    const sprite = render('draw scene 12x8:\n  bg #446688\n  rect #223344 2:2 9:5 fill\n', 'scene')
    expect(detectPlateFigure(sprite, coverageMask(sprite))).toBeNull()
    expect(silhouetteSprite(sprite).plateDetected).toBe(false)
  })
})
