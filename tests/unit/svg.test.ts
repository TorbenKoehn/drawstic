import { describe, expect, test } from 'bun:test'
import { color, toHexColor } from '../../src/color.js'
import { Engine } from '../../src/eval.js'
import { encodePathSvg, encodeSvg } from '../../src/svg.js'
import type { Sprite } from '../../src/values.js'
import { path as makePath, type Path, type Region, rectRegion } from '../../src/values.js'

let n = 0

const renderPath = (src: string, name: string): Path => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\mem-svg-path${n++}.drw`, 'mem.drw')
  const entry = mod.definitions.get(name)
  if (entry?.kind !== 'path') {
    throw new Error(`no path ${name}`)
  }
  return engine.evalPath(entry, [], { line: 1, column: 1 })
}

const makeSprite = (
  w: number,
  h: number,
  fill: (x: number, y: number) => readonly [number, number, number, number],
  extra: Partial<Pick<Sprite, 'pal' | 'title' | 'desc'>> = {},
): Sprite => {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y)
      const i = (y * w + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = a
    }
  }
  return {
    type: 'sprite',
    name: 'test',
    w,
    h,
    data,
    pal: extra.pal ?? [],
    title: extra.title,
    desc: extra.desc,
  }
}

const noFlags = { ids: false, classes: false, inlineStyles: false }

const rectCount = (svg: string): number => (svg.match(/<rect /g) ?? []).length

describe('encodeSvg', () => {
  test('wraps in an svg element with matching viewBox/width/height', () => {
    const sprite = makeSprite(7, 4, () => [0, 0, 0, 0])
    const svg = encodeSvg(sprite, noFlags)
    expect(svg).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 4" width="7" height="4" shape-rendering="crispEdges">',
    )
    expect(svg.trim().endsWith('</svg>')).toBe(true)
  })

  test('merges horizontal runs of identical opaque pixels into fewer rects', () => {
    // row0: 3px red, 3px blue; row1: fully transparent (skipped entirely)
    const sprite = makeSprite(6, 2, (x, y) => {
      if (y === 1) {
        return [0, 0, 0, 0]
      }
      return x < 3 ? [255, 0, 0, 255] : [0, 0, 255, 255]
    })
    const svg = encodeSvg(sprite, noFlags)
    expect(rectCount(svg)).toBe(2)
    expect(svg).toContain('<rect x="0" y="0" width="3" height="1" fill="#ff0000"/>')
    expect(svg).toContain('<rect x="3" y="0" width="3" height="1" fill="#0000ff"/>')
  })

  test('fully transparent sprite emits no rects', () => {
    const sprite = makeSprite(4, 4, () => [10, 20, 30, 0])
    const svg = encodeSvg(sprite, noFlags)
    expect(rectCount(svg)).toBe(0)
    expect(svg).toContain('<svg')
  })

  test('default options: fill attribute, opacity only for partial alpha', () => {
    const sprite = makeSprite(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [255, 0, 0, 128]))
    const svg = encodeSvg(sprite, noFlags)
    expect(svg).toContain('<rect x="0" y="0" width="1" height="1" fill="#ff0000"/>')
    expect(svg).toContain(
      '<rect x="1" y="0" width="1" height="1" fill="#ff0000" fill-opacity="0.5020"/>',
    )
  })

  test('ids option numbers every rect px-0, px-1, …', () => {
    const sprite = makeSprite(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 255, 0, 255]))
    const svg = encodeSvg(sprite, { ...noFlags, ids: true })
    expect(svg).toContain('id="px-0"')
    expect(svg).toContain('id="px-1"')
  })

  test('without ids option, no id attributes are emitted', () => {
    const sprite = makeSprite(2, 1, () => [255, 0, 0, 255])
    const svg = encodeSvg(sprite, noFlags)
    expect(svg).not.toContain('id="px-')
  })

  test('inlineStyles option writes fill via style=, with fill-opacity suffix for partial alpha', () => {
    const sprite = makeSprite(2, 1, (x) => (x === 0 ? [0, 128, 255, 255] : [0, 128, 255, 64]))
    const svg = encodeSvg(sprite, { ...noFlags, inlineStyles: true })
    expect(svg).toContain('style="fill:#0080ff"')
    expect(svg).toContain(`style="fill:#0080ff;fill-opacity:${(64 / 255).toFixed(4)}"`)
  })

  test('classes option emits a <style> block and class= for matching opaque palette colors', () => {
    // x0: opaque red, matches pal entry -> class
    // x1: opaque green, not in pal -> falls back to fill=
    // x2: semi-transparent red, same rgb as pal entry but partial alpha -> falls back to fill=
    const sprite = makeSprite(
      3,
      1,
      (x) => {
        if (x === 0) {
          return [255, 0, 0, 255]
        }
        if (x === 1) {
          return [0, 255, 0, 255]
        }
        return [255, 0, 0, 128]
      },
      { pal: [{ key: 'r', color: color(255, 0, 0), source: 'test' }] },
    )
    const svg = encodeSvg(sprite, { ...noFlags, classes: true })
    expect(svg).toContain('<style>.c-r{fill:#ff0000}</style>')
    expect(svg).toContain('<rect x="0" y="0" width="1" height="1" class="c-r"/>')
    expect(svg).toContain('<rect x="1" y="0" width="1" height="1" fill="#00ff00"/>')
    expect(svg).toContain(
      `<rect x="2" y="0" width="1" height="1" fill="#ff0000" fill-opacity="${(128 / 255).toFixed(4)}"/>`,
    )
  })

  test('classes option de-duplicates palette entries sharing the same rgba: first key wins', () => {
    const sprite = makeSprite(1, 1, () => [1, 2, 3, 255], {
      pal: [
        { key: 'a', color: color(1, 2, 3), source: 's' },
        { key: 'b', color: color(1, 2, 3), source: 's' },
      ],
    })
    const svg = encodeSvg(sprite, { ...noFlags, classes: true })
    expect(svg).toContain('.c-a{fill:#010203}')
    expect(svg).not.toContain('.c-b')
    expect(svg).toContain('class="c-a"')
  })

  test('classes option with an empty palette emits no <style> block', () => {
    const sprite = makeSprite(1, 1, () => [9, 9, 9, 255])
    const svg = encodeSvg(sprite, { ...noFlags, classes: true })
    expect(svg).not.toContain('<style>')
    expect(svg).toContain('fill="#090909"')
  })

  test('title and desc are emitted and XML-escaped', () => {
    const sprite = makeSprite(1, 1, () => [0, 0, 0, 0], {
      title: 'A & B <C> "D"',
      desc: 'x&y',
    })
    const svg = encodeSvg(sprite, noFlags)
    expect(svg).toContain('<title>A &amp; B &lt;C&gt; &quot;D&quot;</title>')
    expect(svg).toContain('<desc>x&amp;y</desc>')
  })

  test('sprite without title/desc omits those elements', () => {
    const sprite = makeSprite(1, 1, () => [0, 0, 0, 0])
    const svg = encodeSvg(sprite, noFlags)
    expect(svg).not.toContain('<title>')
    expect(svg).not.toContain('<desc>')
  })

  test('a real rendered sprite encodes to structurally valid SVG', () => {
    const engine = new Engine(process.cwd())
    const mod = engine.loadSource(
      'draw heart 5x5:\n  palette k=#1a1a1a  r=#c04040\n  pixels:\n    .r.r.\n    rrkrr\n    rrrrr\n    .rrr.\n    ..r..\n',
      `${process.cwd()}\\mem-svg-real${n++}.drw`,
      'mem.drw',
    )
    const entry = mod.definitions.get('heart')
    if (!entry) {
      throw new Error('no heart')
    }
    const sprite = engine.defToSprite(entry, { line: 1, column: 1 })
    const svg = encodeSvg(sprite, { ids: true, classes: true, inlineStyles: false })
    expect(svg).toContain('viewBox="0 0 5 5" width="5" height="5"')
    const count = rectCount(svg)
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(25)
    expect(svg).toContain(`fill:${toHexColor(color(192, 64, 64))}`)
  })
})

describe('encodePathSvg', () => {
  test('renders move/line/quad/bezier/arc/close to M/L/Q/C/L/Z path data', () => {
    const p = renderPath(
      'path p 10x10:\n  move 1:1\n  line 8:1\n  quad 8:8 1:8\n  bezier 1:8 1:2 8:2\n  arc 8:8 around 5:5 cw\n  close\n',
      'p',
    )
    const svg = encodePathSvg(p)
    expect(svg).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10">',
    )
    expect(svg).toContain('d="M1 1 L8 1 Q8 8 1 8 C1 8 1 2 8 2 L8 8 Z"')
    expect(svg).toContain('fill="currentColor"')
    expect(svg).toContain('fill-rule="evenodd"')
    expect(svg).not.toContain('<rect')
  })

  test('a path with no commands falls back to pixel-run rects over its region, using explicit viewBox', () => {
    const p: Path = makePath([], [], { width: 10, height: 8 }, rectRegion(1, 1, 4, 3))
    const svg = encodePathSvg(p)
    expect(svg).toContain('viewBox="0 0 10 8" width="10" height="8"')
    expect(svg).not.toContain('<path')
    expect(rectCount(svg)).toBe(3)
    expect(svg).toContain('<rect x="1" y="1" width="4" height="1" fill="currentColor"/>')
    expect(svg).toContain('<rect x="1" y="2" width="4" height="1" fill="currentColor"/>')
    expect(svg).toContain('<rect x="1" y="3" width="4" height="1" fill="currentColor"/>')
  })

  test('a region-only path without a viewBox derives size from the region bbox', () => {
    const p: Path = makePath([], [], undefined, rectRegion(1, 1, 4, 3))
    const svg = encodePathSvg(p)
    // w = ceil(bbox.x1) = 4, h = ceil(bbox.y1) = 3
    expect(svg).toContain('viewBox="0 0 4 3" width="4" height="3"')
  })

  test('a path with neither commands nor a region emits an empty svg shell', () => {
    const p: Path = makePath([], [], { width: 2, height: 2 })
    const svg = encodePathSvg(p)
    expect(svg).toContain('viewBox="0 0 2 2" width="2" height="2"')
    expect(svg).not.toContain('<path')
    expect(svg).not.toContain('<rect')
  })

  test('a region with gaps splits pixel-run rects around uncovered pixels', () => {
    const bbox = { x0: 0, y0: 0, x1: 3, y1: 1 }
    const gapRegion: Region = {
      type: 'region',
      bbox,
      has: (x, _y) => x !== 1,
      test: () => false,
    }
    const p: Path = makePath([], [], undefined, gapRegion)
    const svg = encodePathSvg(p)
    expect(rectCount(svg)).toBe(4) // 2 rows x (x=0 alone, x=2..3 run) around the x=1 gap
    expect(svg).toContain('<rect x="0" y="0" width="1" height="1" fill="currentColor"/>')
    expect(svg).toContain('<rect x="2" y="0" width="2" height="1" fill="currentColor"/>')
    expect(svg).toContain('<rect x="0" y="1" width="1" height="1" fill="currentColor"/>')
    expect(svg).toContain('<rect x="2" y="1" width="2" height="1" fill="currentColor"/>')
  })
})
