import { describe, expect, test } from 'bun:test'
import {
  aboutPoint,
  applyMatrix,
  bboxIntersect,
  bboxUnion,
  bresenham,
  circleRegion,
  circleSpans,
  compose,
  ellipseRegion,
  emptyRegion,
  IDENTITY,
  invertMatrix,
  isObj,
  list,
  multiplyMatrix,
  path,
  pathFillRegion,
  pathFromRegion,
  pathStrokeRegion,
  pathTransform,
  perspectiveMatrix,
  point,
  polyRegion,
  type Region,
  rectRegion,
  regionIntersect,
  regionSubtract,
  regionTransform,
  regionUnion,
  regionXor,
  rotationDeg,
  rotationXDeg,
  rotationYDeg,
  rrectRegion,
  scaling,
  skewX,
  spriteRegion,
  translation,
  typeName,
} from '../../src/values.js'

describe('primitives & type helpers', () => {
  test('point/list/path constructors', () => {
    const p = point(3, 4)
    expect(p).toEqual({ type: 'point', x: 3, y: 4, rel: false })
    const rel = point(1, 2, true)
    expect(rel.rel).toBe(true)
    expect(list([1, 2, 3])).toEqual({ type: 'list', items: [1, 2, 3] })
    const bare = path([])
    expect(bare.commands).toEqual([])
    expect(bare.viewBox).toBeUndefined()
    expect(bare.region).toBeUndefined()
    const withAll = path([], [{ kind: 'close' }], { width: 4, height: 4 }, emptyRegion)
    expect(withAll.commands).toEqual([{ kind: 'close' }])
    expect(withAll.viewBox).toEqual({ width: 4, height: 4 })
    expect(withAll.region).toBe(emptyRegion)
  })

  test('isObj distinguishes primitives from object values', () => {
    expect(isObj(5)).toBe(false)
    expect(isObj(true)).toBe(false)
    expect(isObj('s')).toBe(false)
    expect(isObj(point(0, 0))).toBe(true)
    expect(isObj(emptyRegion)).toBe(true)
  })

  test('typeName covers every primitive and object variant', () => {
    expect(typeName(5)).toBe('number')
    expect(typeName(false)).toBe('boolean')
    expect(typeName('x')).toBe('string')
    expect(typeName(point(0, 0))).toBe('point')
    expect(typeName(emptyRegion)).toBe('region')
    expect(typeName(pathFromRegion(emptyRegion))).toBe('path')
    expect(typeName({ type: 'transform', m: IDENTITY })).toBe('transform')
  })
})

describe('transforms', () => {
  test('multiplyMatrix and compose', () => {
    expect(multiplyMatrix(IDENTITY, IDENTITY)).toEqual(IDENTITY)
    const t = translation(2, 3)
    expect(multiplyMatrix(IDENTITY, t)).toEqual(t)
    // compose(first, second) = second . first: translate then scale
    const composed = compose(translation(1, 0), scaling(2, 2))
    const p = applyMatrix(composed, 1, 0)
    expect(p).toEqual({ x: 4, y: 0 }) // (1+1)*2 = 4
  })

  test('applyMatrix perspective-divides and returns null at w=0', () => {
    expect(applyMatrix(IDENTITY, 5, 7)).toEqual({ x: 5, y: 7 })
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1]
    expect(applyMatrix(m, 1, 0)).toBeNull() // w = -1*1 + 1 = 0
    expect(applyMatrix(m, 0, 0)).toEqual({ x: 0, y: 0 }) // w = 1, x/w = 0
  })

  test('translation composes via applyMatrix', () => {
    expect(applyMatrix(translation(4, -2), 1, 1)).toEqual({ x: 5, y: -1 })
  })

  test('rotationDeg is exact at quarter turns', () => {
    expect(applyMatrix(rotationDeg(0), 1, 0)).toEqual({ x: 1, y: 0 })
    expect(applyMatrix(rotationDeg(90), 1, 0)).toEqual({ x: 0, y: 1 })
    expect(applyMatrix(rotationDeg(180), 1, 0)).toEqual({ x: -1, y: 0 })
    expect(applyMatrix(rotationDeg(270), 1, 0)).toEqual({ x: 0, y: -1 })
  })

  test('scaling: uniform and non-uniform', () => {
    expect(applyMatrix(scaling(2, 3), 1, 1)).toEqual({ x: 2, y: 3 })
  })

  test('skewX at 0 and 45 degrees', () => {
    expect(applyMatrix(skewX(0), 3, 5)).toEqual({ x: 3, y: 5 })
    const p = applyMatrix(skewX(45), 0, 4)
    expect(p?.x).toBeCloseTo(4, 9) // tan(45) = 1 -> x' = x + y
    expect(p?.y).toBe(4)
  })

  test('rotationXDeg / rotationYDeg affect only the surviving 2D terms', () => {
    const rx = applyMatrix(rotationXDeg(90), 2, 3)
    expect(rx?.x).toBe(2)
    expect(rx?.y).toBeCloseTo(0, 9) // cos(90) * y
    const ry = applyMatrix(rotationYDeg(90), 2, 3)
    expect(ry?.x).toBeCloseTo(0, 9) // cos(90) * x
    expect(ry?.y).toBe(3)
  })

  test('perspectiveMatrix leaves bare 2D points unaffected (z implicit 0)', () => {
    expect(applyMatrix(perspectiveMatrix(64), 5, 9)).toEqual({ x: 5, y: 9 })
  })

  test('perspective composed with a 3D rotation can null a point at w=0', () => {
    // rotateY(90).perspective(0.5): reading-order application via multiplyMatrix(persp, rotY)
    const m = multiplyMatrix(perspectiveMatrix(0.5), rotationYDeg(90))
    expect(applyMatrix(m, -0.5, 0)).toBeNull() // w = 2*(-0.5) + 1 = 0
    expect(applyMatrix(m, 0, 0)).toEqual({ x: 0, y: 0 })
  })

  test('aboutPoint conjugates a transform to a pivot', () => {
    const t = aboutPoint(scaling(2, 2), 4, 4)
    expect(applyMatrix(t, 4, 4)).toEqual({ x: 4, y: 4 }) // pivot is fixed
    expect(applyMatrix(t, 0, 4)).toEqual({ x: -4, y: 4 })
  })

  test('invertMatrix round-trips invertible matrices', () => {
    for (const m of [IDENTITY, translation(3, -2), rotationDeg(37), scaling(2, 5)]) {
      const inv = invertMatrix(m)
      expect(inv).toBeDefined()
      if (inv) {
        const round = multiplyMatrix(m, inv)
        for (let i = 0; i < 16; i++) {
          expect(round[i]).toBeCloseTo(IDENTITY[i] ?? 0, 9)
        }
      }
    }
  })

  test('invertMatrix pivots across rows when needed', () => {
    const swapXY = [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const inv = invertMatrix(swapXY)
    expect(inv).toBeDefined()
    if (inv) {
      const round = multiplyMatrix(swapXY, inv)
      for (let i = 0; i < 16; i++) {
        expect(round[i]).toBeCloseTo(IDENTITY[i] ?? 0, 9)
      }
    }
  })

  test('invertMatrix returns undefined for a singular matrix', () => {
    expect(invertMatrix(scaling(0, 1))).toBeUndefined()
  })
})

describe('regions: primitives', () => {
  test('emptyRegion never has coverage', () => {
    expect(emptyRegion.bbox).toBeNull()
    expect(emptyRegion.has(0, 0)).toBe(false)
    expect(emptyRegion.test(0, 0)).toBe(false)
  })

  test('circleSpans at r=0 and a larger radius', () => {
    expect(circleSpans(0)).toEqual([0])
    const spans = circleSpans(5)
    expect(spans.length).toBe(6)
    expect(spans[0]).toBe(5)
  })

  test('circleRegion r=0 is a single pixel', () => {
    const r = circleRegion(3, 3, 0)
    expect(r.bbox).toEqual({ x0: 3, y0: 3, x1: 3, y1: 3 })
    expect(r.has(3, 3)).toBe(true)
    expect(r.has(4, 3)).toBe(false)
    expect(r.test(3, 3)).toBe(true)
    expect(r.test(3.4, 3)).toBe(false)
  })

  test('circleRegion r>0 covers an even-diameter footprint', () => {
    const r = circleRegion(8, 8, 4)
    expect(r.bbox).toEqual({ x0: 4, y0: 4, x1: 11, y1: 11 })
    expect(r.has(8, 8)).toBe(true)
    expect(r.has(0, 0)).toBe(false) // outside the bbox entirely
    expect(r.has(3, 8)).toBe(false) // inside bbox range check would fail (left of bbox)
    expect(r.test(8, 8)).toBe(true)
    expect(r.test(8, 3.3)).toBe(false)
  })

  test('ellipseRegion covers an even-diameter footprint per axis (ADR-0087)', () => {
    // Even 2·ri footprint on each axis: cx-rxi..cx+rxi-1 × cy-ryi..cy+ryi-1.
    const e = ellipseRegion(8, 8, 4, 3)
    expect(e.bbox).toEqual({ x0: 4, y0: 5, x1: 11, y1: 10 })
    expect(e.has(8, 8)).toBe(true)
    expect(e.has(4, 8)).toBe(true) // left edge of the x footprint
    expect(e.has(12, 8)).toBe(false) // one past the right edge (even: cx+rxi-1)
    expect(e.has(4, 5)).toBe(false) // clipped corner
    expect(e.test(8, 8)).toBe(true)
  })

  test('ellipseRegion has/test, including the degenerate-axis test() branch', () => {
    const e = ellipseRegion(5, 5, 3, 2)
    expect(e.has(5, 5)).toBe(true)
    expect(e.has(5, 8)).toBe(false)
    expect(e.test(5, 5)).toBe(true)
    const degenerate = ellipseRegion(5, 5, 0, 2)
    // A zero axis collapses to the single integer column cx (1px vertical line).
    expect(degenerate.bbox).toEqual({ x0: 5, y0: 3, x1: 5, y1: 6 })
    expect(degenerate.has(5, 4)).toBe(true)
    expect(degenerate.has(6, 4)).toBe(false)
    expect(degenerate.test(5, 5)).toBe(false)
  })

  test('a circle is exactly the rx===ry ellipse (unified centering, ADR-0087)', () => {
    // The ADR guarantee: ellipse(c, r, r) is pixel-identical to circle(c, r).
    for (const r of [0, 1, 2, 3, 5, 8]) {
      const cx = 12
      const cy = 12
      const circ = circleRegion(cx, cy, r)
      const ell = ellipseRegion(cx, cy, r, r)
      expect(ell.bbox).toEqual(circ.bbox)
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 24; x++) {
          expect(ell.has(x, y)).toBe(circ.has(x, y))
        }
      }
    }
  })

  test('rectRegion accepts corners in either order', () => {
    const a = rectRegion(0, 0, 4, 4)
    const b = rectRegion(4, 4, 0, 0)
    expect(a.bbox).toEqual(b.bbox)
    expect(a.has(2, 2)).toBe(true)
    expect(a.has(5, 2)).toBe(false)
    expect(a.test(-0.4, -0.4)).toBe(true)
    expect(a.test(-0.6, 0)).toBe(false)
  })

  test('rrectRegion clamps radius and chips corners while keeping edges/interior', () => {
    const rr = rrectRegion(0, 0, 9, 9, 3)
    expect(rr.has(0, 0)).toBe(false) // outside the corner disc
    expect(rr.has(1, 1)).toBe(true) // inside the corner disc
    expect(rr.has(5, 5)).toBe(true) // deep interior, both axes in the flat band
    expect(rr.has(0, 4)).toBe(true) // left edge band (cx non-null, cy null)
    expect(rr.test(-0.6, 4)).toBe(false) // outside padded bounds
    expect(rr.test(0.3, 4)).toBe(true)
    expect(rr.test(0.5, 0.5)).toBe(false) // both cx/cy resolve to a corner centre, outside the disc
    const clamped = rrectRegion(0, 0, 4, 4, 999)
    expect(clamped.bbox).toEqual({ x0: 0, y0: 0, x1: 4, y1: 4 })
  })

  test('polyRegion degenerates to emptyRegion below 2 points', () => {
    expect(polyRegion([])).toBe(emptyRegion)
    expect(polyRegion([{ x: 0, y: 0 }])).toBe(emptyRegion)
  })

  test('polyRegion fills a triangle by even-odd + inclusive boundary', () => {
    const tri = polyRegion([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ])
    expect(tri.test(1, 1)).toBe(true)
    expect(tri.test(3, 3)).toBe(false)
    expect(tri.has(1, 1)).toBe(true)
    expect(tri.has(4, 4)).toBe(false)
    expect(tri.has(5, 5)).toBe(false) // outside the bbox entirely, short-circuits before the bitmap
    expect(tri.has(0, 0)).toBe(true) // vertex, via boundary bresenham
    // second has() call exercises the lazily-cached bitmap path
    expect(tri.has(1, 1)).toBe(true)
  })

  test('bresenham covers shallow, steep, and degenerate lines', () => {
    const pts: [number, number][] = []
    bresenham(0, 0, 4, 1, (x, y) => pts.push([x, y])) // shallow (e2 <= dx dominates)
    expect(pts[0]).toEqual([0, 0])
    expect(pts.at(-1)).toEqual([4, 1])
    const steep: [number, number][] = []
    bresenham(0, 0, 1, 4, (x, y) => steep.push([x, y])) // steep (e2 >= dy dominates)
    expect(steep.at(-1)).toEqual([1, 4])
    const single: [number, number][] = []
    bresenham(2, 2, 2, 2, (x, y) => single.push([x, y]))
    expect(single).toEqual([[2, 2]])
    const negDir: [number, number][] = []
    bresenham(4, 4, 0, 0, (x, y) => negDir.push([x, y]))
    expect(negDir[0]).toEqual([4, 4])
    expect(negDir.at(-1)).toEqual([0, 0])
  })
})

describe('regions: bbox helpers & combinators', () => {
  const boxA = { x0: 0, y0: 0, x1: 4, y1: 4 }
  const boxB = { x0: 2, y0: 2, x1: 6, y1: 6 }

  test('bboxUnion handles null operands', () => {
    expect(bboxUnion(null, boxB)).toEqual(boxB)
    expect(bboxUnion(boxA, null)).toEqual(boxA)
    expect(bboxUnion(boxA, boxB)).toEqual({ x0: 0, y0: 0, x1: 6, y1: 6 })
  })

  test('bboxIntersect handles null and disjoint operands', () => {
    expect(bboxIntersect(null, boxB)).toBeNull()
    expect(bboxIntersect(boxA, null)).toBeNull()
    expect(bboxIntersect(boxA, boxB)).toEqual({ x0: 2, y0: 2, x1: 4, y1: 4 })
    const far = { x0: 10, y0: 10, x1: 12, y1: 12 }
    expect(bboxIntersect(boxA, far)).toBeNull()
  })

  test('regionUnion/Intersect/Subtract/Xor combine has()/test() and bboxes', () => {
    const a = rectRegion(0, 0, 4, 4)
    const b = rectRegion(2, 2, 6, 6)
    const u = regionUnion(a, b)
    expect(u.bbox).toEqual({ x0: 0, y0: 0, x1: 6, y1: 6 })
    expect(u.has(1, 1)).toBe(true)
    expect(u.has(5, 5)).toBe(true)
    expect(u.has(9, 9)).toBe(false)
    expect(u.test(1, 1)).toBe(true)

    const i = regionIntersect(a, b)
    expect(i.bbox).toEqual({ x0: 2, y0: 2, x1: 4, y1: 4 })
    expect(i.has(3, 3)).toBe(true)
    expect(i.has(1, 1)).toBe(false)
    expect(i.test(3, 3)).toBe(true)

    const s = regionSubtract(a, b)
    expect(s.bbox).toEqual(a.bbox) // over-approximation, keeps a's bbox
    expect(s.has(1, 1)).toBe(true)
    expect(s.has(3, 3)).toBe(false)
    expect(s.test(1, 1)).toBe(true)

    const x = regionXor(a, b)
    expect(x.bbox).toEqual({ x0: 0, y0: 0, x1: 6, y1: 6 })
    expect(x.has(1, 1)).toBe(true) // only in a
    expect(x.has(5, 5)).toBe(true) // only in b
    expect(x.has(3, 3)).toBe(false) // in both -> excluded
    expect(x.test(1, 1)).toBe(true)
  })

  test('regionTransform maps has()/test() through the inverse and forward-maps the bbox', () => {
    const base = rectRegion(0, 0, 4, 4)
    const moved = regionTransform(base, translation(10, 0), translation(-10, 0))
    expect(moved.bbox).toEqual({ x0: 9, y0: -1, x1: 15, y1: 5 })
    expect(moved.has(11, 2)).toBe(true) // (11-10, 2) = (1, 2), inside base
    expect(moved.has(1, 2)).toBe(false)
    expect(moved.test(11, 2)).toBe(true)
  })

  test('regionTransform bbox is null when a corner forward-maps to w=0', () => {
    const m = multiplyMatrix(perspectiveMatrix(0.5), rotationYDeg(90))
    const region: Region = {
      type: 'region',
      bbox: { x0: -0.5, y0: 0, x1: 5, y1: 5 },
      has: () => true,
      test: () => true,
    }
    const transformed = regionTransform(region, m, IDENTITY)
    expect(transformed.bbox).toBeNull()
  })

  test('regionTransform has()/test() are false when the inverse map hits w=0', () => {
    const m = multiplyMatrix(perspectiveMatrix(0.5), rotationYDeg(90))
    const always: Region = { type: 'region', bbox: null, has: () => true, test: () => true }
    const transformed = regionTransform(always, IDENTITY, m)
    expect(transformed.has(-0.5, 0)).toBe(false)
    expect(transformed.test(-0.5, 0)).toBe(false)
    expect(transformed.has(0, 0)).toBe(true) // valid map (w=1)
  })

  test('spriteRegion reads alpha, honouring bounds and fractional rounding', () => {
    const sprite = {
      type: 'sprite' as const,
      name: 't',
      w: 2,
      h: 2,
      data: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 0]),
      pal: [],
      title: undefined,
      desc: undefined,
      mode: 'pixel' as const,
    }
    const r = spriteRegion(sprite)
    expect(r.bbox).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 })
    expect(r.has(0, 0)).toBe(true)
    expect(r.has(1, 0)).toBe(false)
    expect(r.has(-1, 0)).toBe(false)
    expect(r.has(2, 0)).toBe(false)
    expect(r.test(0.4, 0.4)).toBe(true) // rounds to (0,0)
    expect(r.test(-1, -1)).toBe(false)
  })
})

describe('paths', () => {
  test('pathFillRegion returns a cached region verbatim', () => {
    const cached = rectRegion(0, 0, 2, 2)
    const p = pathFromRegion(cached)
    expect(pathFillRegion(p)).toBe(cached)
  })

  test('pathFillRegion is emptyRegion with no closed contours', () => {
    expect(pathFillRegion(path([]))).toBe(emptyRegion)
    expect(
      pathFillRegion(
        path([
          {
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
            closed: false,
          },
        ]),
      ),
    ).toBe(emptyRegion)
    // a "closed" contour with fewer than 2 points is filtered out too
    expect(pathFillRegion(path([{ points: [{ x: 0, y: 0 }], closed: true }]))).toBe(emptyRegion)
  })

  test('pathFillRegion even-odd fills closed contours, boundary inclusive', () => {
    const square = {
      points: [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ],
      closed: true,
    }
    const region = pathFillRegion(path([square]))
    expect(region.test(3, 3)).toBe(true) // interior
    expect(region.test(1, 3)).toBe(true) // boundary, exact
    expect(region.test(0, 0)).toBe(false) // outside
    expect(region.has(3, 3)).toBe(true)
    expect(region.has(6, 6)).toBe(false)
  })

  test('pathFillRegion treats a nested closed contour as a hole (even-odd)', () => {
    const outer = {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      closed: true,
    }
    const hole = {
      points: [
        { x: 3, y: 3 },
        { x: 7, y: 3 },
        { x: 7, y: 7 },
        { x: 3, y: 7 },
      ],
      closed: true,
    }
    const region = pathFillRegion(path([outer, hole]))
    expect(region.test(1, 1)).toBe(true) // in outer only
    expect(region.test(5, 5)).toBe(false) // in both -> hole
  })

  test('pathStrokeRegion is emptyRegion with no segments', () => {
    expect(pathStrokeRegion(path([]), 2)).toBe(emptyRegion)
  })

  test('pathStrokeRegion strokes open and closed contours at width 1 and >1', () => {
    const open = {
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
      ],
      closed: false,
    }
    const thin = pathStrokeRegion(path([open]), 1)
    expect(thin.has(0, 0)).toBe(true)
    expect(thin.has(4, 0)).toBe(true)
    expect(thin.has(0, 5)).toBe(false) // no closing segment on an open contour
    expect(thin.test(0, 0)).toBe(true)
    expect(thin.test(2, 0)).toBe(true)
    expect(thin.test(0, 5)).toBe(false)

    const closed = {
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      closed: true,
    }
    const thick = pathStrokeRegion(path([closed]), 3)
    expect(thick.has(0, 0)).toBe(true)
    expect(thick.has(2, 0)).toBe(true) // top edge, brushed to width 3
    expect(thick.has(0, 4)).toBe(true) // closing segment (last point -> first point)
    expect(thick.has(2, 2)).toBe(false) // interior, not on the stroke band
    expect(thick.test(0, 0)).toBe(true)
    expect(thick.test(2, 2)).toBe(false)
  })

  test('pathTransform rewrites move/line/quad/bezier/arc endpoints and leaves close alone', () => {
    const commands = [
      { kind: 'move' as const, to: { x: 0, y: 0 } },
      { kind: 'line' as const, to: { x: 1, y: 0 } },
      { kind: 'quad' as const, control: { x: 1, y: 1 }, to: { x: 2, y: 0 } },
      {
        kind: 'bezier' as const,
        control1: { x: 1, y: 1 },
        control2: { x: 2, y: 1 },
        to: { x: 3, y: 0 },
      },
      { kind: 'arc' as const, center: { x: 1, y: 1 }, to: { x: 2, y: 2 }, clockwise: true },
      { kind: 'close' as const },
    ]
    const contours = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
        closed: false,
      },
    ]
    const p = path(contours, commands, undefined, rectRegion(0, 0, 1, 1))
    const t = translation(10, 0)
    const moved = pathTransform(p, t, translation(-10, 0))
    expect(moved.contours[0]?.points[0]).toEqual({ x: 10, y: 0 })
    expect(moved.commands[0]).toEqual({ kind: 'move', to: { x: 10, y: 0 } })
    expect(moved.commands[1]).toEqual({ kind: 'line', to: { x: 11, y: 0 } })
    expect(moved.commands[2]).toEqual({
      kind: 'quad',
      control: { x: 11, y: 1 },
      to: { x: 12, y: 0 },
    })
    expect(moved.commands[3]).toEqual({
      kind: 'bezier',
      control1: { x: 11, y: 1 },
      control2: { x: 12, y: 1 },
      to: { x: 13, y: 0 },
    })
    expect(moved.commands[4]).toEqual({
      kind: 'arc',
      center: { x: 11, y: 1 }, // arc center transformed (was stale before the fix)
      to: { x: 12, y: 2 }, // arc endpoint transformed
      clockwise: true, // translation preserves orientation
    })
    expect(moved.commands[5]).toEqual(commands[5]) // close unchanged
    expect(moved.region).toBeDefined() // cached region threaded through regionTransform
  })

  test('pathTransform maps arc center/to under rotate90 and flips direction on a mirror', () => {
    const commands = [
      { kind: 'move' as const, to: { x: 6, y: 2 } },
      { kind: 'arc' as const, center: { x: 2, y: 4 }, to: { x: 2, y: 8 }, clockwise: true },
    ]
    const p = path([{ points: [{ x: 6, y: 2 }], closed: false }], commands)
    // rotate 90° cw maps (x, y) → (-y, x); orientation preserved so cw stays cw.
    const rotated = pathTransform(p, rotationDeg(90), rotationDeg(-90))
    expect(rotated.commands[1]).toEqual({
      kind: 'arc',
      center: { x: -4, y: 2 },
      to: { x: -8, y: 2 },
      clockwise: true,
    })
    // flipx = scaling(-1, 1) is a mirror (negative determinant): direction flips.
    const flipped = pathTransform(p, scaling(-1, 1), scaling(-1, 1))
    expect(flipped.commands[1]).toEqual({
      kind: 'arc',
      center: { x: -2, y: 4 },
      to: { x: -2, y: 8 },
      clockwise: false,
    })
  })

  test('pathTransform falls back to the original point when the map hits w=0', () => {
    const m = multiplyMatrix(perspectiveMatrix(0.5), rotationYDeg(90))
    const commands = [{ kind: 'move' as const, to: { x: -0.5, y: 0 } }]
    const p = path([], commands)
    const transformed = pathTransform(p, m, IDENTITY)
    expect(transformed.commands[0]).toEqual({ kind: 'move', to: { x: -0.5, y: 0 } })
  })

  test('pathFromRegion wraps a region as a command-less path, with and without a viewBox', () => {
    const region = rectRegion(0, 0, 2, 2)
    const bare = pathFromRegion(region)
    expect(bare.contours).toEqual([])
    expect(bare.commands).toEqual([])
    expect(bare.region).toBe(region)
    expect(bare.viewBox).toBeUndefined()
    const sized = pathFromRegion(region, { width: 3, height: 3 })
    expect(sized.viewBox).toEqual({ width: 3, height: 3 })
  })
})
