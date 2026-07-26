import { describe, expect, test } from 'bun:test'
import type { Expression, Statement } from '../../src/ast.js'
import { DrawsticError } from '../../src/diagnostic.js'
import { parse } from '../../src/parser.js'

const one = (src: string): Statement => {
  const m = parse(src, 't.drw')
  expect(m.statements.length).toBeGreaterThanOrEqual(1)
  return m.statements[0] as Statement
}

const bindingExpr = (src: string): Expression => {
  const stmt = one(src)
  expect(stmt.kind).toBe('binding')
  if (stmt.kind !== 'binding') {
    throw new Error('expected binding')
  }
  return stmt.expression
}

describe('parser', () => {
  test('the drawstic N version pragma was removed (ADR-0096) — inert since ADR-0088', () => {
    expect(() => parse('drawstic 1\nx = 1\n', 't.drw')).toThrow(
      /'drawstic N' version pragma was removed/,
    )
  })

  test('a plain `drawstic` binding elsewhere in the file is unaffected (contextual, not reserved)', () => {
    const s = one('drawstic = 1\n')
    expect(s.kind).toBe('binding')
  })

  test('binding and destructuring', () => {
    const s = one('r, g, b = 1, 2, 3\n')
    expect(s.kind).toBe('binding')
    if (s.kind === 'binding') {
      expect(s.names).toEqual(['r', 'g', 'b'])
      expect(s.expression.kind).toBe('list')
    }
  })

  test('compound assignment', () => {
    const s = one('x += 10\n')
    expect(s.kind).toBe('compound')
  })

  test('fn definition', () => {
    const s = one('fn lerp2(a, b, t) = a + (b - a) * t\n')
    expect(s.kind).toBe('functionDefinition')
    if (s.kind === 'functionDefinition') {
      expect(s.params).toEqual(['a', 'b', 't'])
    }
  })

  test('point literals bind before arithmetic operators', () => {
    const scale = bindingExpr('p = 4:4 * 2\n')
    expect(scale.kind).toBe('binary')
    if (scale.kind === 'binary') {
      expect(scale.operator).toBe('*')
      expect(scale.left.kind).toBe('point')
    }

    const pairScale = bindingExpr('p = 4:4 * 2:3\n')
    expect(pairScale.kind).toBe('binary')
    if (pairScale.kind === 'binary') {
      expect(pairScale.operator).toBe('*')
      expect(pairScale.left.kind).toBe('point')
      expect(pairScale.right.kind).toBe('point')
    }

    const add = bindingExpr('p = 4:4 + 1\n')
    expect(add.kind).toBe('binary')
    if (add.kind === 'binary') {
      expect(add.operator).toBe('+')
      expect(add.left.kind).toBe('point')
    }

    const pairAdd = bindingExpr('p = 4:4 + 1:2\n')
    expect(pairAdd.kind).toBe('binary')
    if (pairAdd.kind === 'binary') {
      expect(pairAdd.operator).toBe('+')
      expect(pairAdd.left.kind).toBe('point')
      expect(pairAdd.right.kind).toBe('point')
    }
  })

  test('point expressions support explicit centered geometry', () => {
    const s = one('draw d 16x16:\n  rect k c-(i:i) c+(i:i)\n')
    expect(s.kind).toBe('drawDefinition')
    if (s.kind === 'drawDefinition') {
      const call = s.def.body[0]
      expect(call?.kind).toBe('call')
      if (call?.kind === 'call') {
        expect(call.args.length).toBe(3)
        // paint-first (ADR-0066): args[0] is the paint; the centered-geometry
        // binary points follow.
        const paint = call.args[0]
        expect(paint?.kind).toBe('expression')
        if (paint?.kind === 'expression') {
          expect(paint.expression.kind).toBe('name')
        }
        const geom = call.args[1]
        expect(geom?.kind).toBe('expression')
        if (geom?.kind === 'expression') {
          expect(geom.expression.kind).toBe('binary')
        }
      }
    }
  })

  test('command-form and paren-form are equivalent', () => {
    const a = one('draw d 4x4:\n  circle k 2:2 1\n')
    const b = one('draw d 4x4:\n  circle(k, 2:2, 1)\n')
    expect(a.kind).toBe('drawDefinition')
    expect(b.kind).toBe('drawDefinition')
    const stripSpans = (v: unknown): string =>
      JSON.stringify(v, (key, val) => (key === 'span' ? undefined : val))
    if (a.kind === 'drawDefinition' && b.kind === 'drawDefinition') {
      expect(stripSpans(a.def.body)).toBe(stripSpans(b.def.body))
    }
  })

  test('D2: bracket depth keeps one argument together', () => {
    const s = one('draw d 4x4:\n  poly cols[row // 8 mod 3] 0:row w:row\n')
    if (s.kind === 'drawDefinition') {
      const call = s.def.body[0]
      expect(call?.kind).toBe('call')
      if (call?.kind === 'call') {
        expect(call.args.length).toBe(3)
      }
    }
  })

  test('curve / curvePoly parse as variadic call statements with trailing flags (ADR-0074/0075)', () => {
    const s = one(
      'draw d 40x24:\n  curve #e8c 2:20 12:4 20:16 28:6 w2\n  curvePoly #6c9 6:12 20:6 32:14 22:20 fill\n',
    )
    expect(s.kind).toBe('drawDefinition')
    if (s.kind !== 'drawDefinition') {
      return
    }
    const curve = s.def.body[0]
    const curvePoly = s.def.body[1]
    expect(curve?.kind).toBe('call')
    expect(curvePoly?.kind).toBe('call')
    if (curve?.kind === 'call') {
      expect(curve.callee).toBe('curve')
      // paint + 4 points + w2 flag = 6 args, all expression-kind
      expect(curve.args.length).toBe(6)
      const w = curve.args.at(-1)
      expect(w?.kind === 'expression' && w.expression.kind === 'name' && w.expression.name).toBe(
        'w2',
      )
    }
    if (curvePoly?.kind === 'call') {
      expect(curvePoly.callee).toBe('curvePoly')
      // paint + 4 points + fill flag = 6 args
      expect(curvePoly.args.length).toBe(6)
      const fill = curvePoly.args.at(-1)
      expect(
        fill?.kind === 'expression' && fill.expression.kind === 'name' && fill.expression.name,
      ).toBe('fill')
    }
  })

  test('curvePoly parses as a region-yielding call in expression position (ADR-0075)', () => {
    const s = one('draw d 24x24:\n  mask blob = curvePoly(4:12, 12:3, 20:12, 12:21)\n')
    expect(s.kind).toBe('drawDefinition')
    if (s.kind === 'drawDefinition') {
      const bind = s.def.body[0]
      expect(bind?.kind).toBe('binding')
      if (bind?.kind === 'binding') {
        expect(bind.expression.kind).toBe('call')
      }
    }
  })

  test('keyword-prefixed sequences form one argument (D2)', () => {
    const s = one('draw d 4x4:\n  stamp gem 1:1 tint k 0.3 transform t\n')
    if (s.kind === 'drawDefinition') {
      const call = s.def.body[0]
      if (call?.kind === 'call') {
        const kws = call.args
          .filter((a) => a.kind === 'keyword')
          .map((a) => (a.kind === 'keyword' ? a.keyword : ''))
        expect(kws).toEqual(['tint', 'transform'])
      }
    }
  })

  test('draw with params and size', () => {
    const s = one('draw key(r, c) 8x8:\n  circle c 4:4 r fill\n')
    if (s.kind === 'drawDefinition') {
      expect(s.def.params).toEqual(['r', 'c'])
      expect(s.def.size).toEqual({ width: 8, height: 8 })
    }
  })

  test('pixels block', () => {
    const s = one('draw h 3x2:\n  pixels:\n    .r.\n    rrr\n')
    if (s.kind === 'drawDefinition') {
      const px = s.def.body.find((b) => b.kind === 'pixels')
      expect(px?.kind).toBe('pixels')
      if (px?.kind === 'pixels') {
        expect(px.rows.map((r) => r.text)).toEqual(['.r.', 'rrr'])
      }
    }
  })

  test('palette inline and block forms', () => {
    const a = one('draw d 2x2:\n  palette k=#111  r=#c04040\n')
    const b = one('draw d 2x2:\n  palette:\n    k = #111\n    r = #c04040\n')
    if (a.kind === 'drawDefinition' && b.kind === 'drawDefinition') {
      const pa = a.def.body[0]
      const pb = b.def.body[0]
      if (pa?.kind === 'palette' && pb?.kind === 'palette') {
        const keys = (entries: typeof pa.entries): string[] =>
          entries.flatMap((e) => (e.kind === 'entry' ? [e.key] : e.keys))
        expect(keys(pa.entries)).toEqual(['k', 'r'])
        expect(keys(pb.entries)).toEqual(['k', 'r'])
      }
    }
  })

  test('block palette supports explicit destructuring', () => {
    const s = one('draw d 2x2:\n  palette:\n    a, b, c = #777.tones(-10%, 0%, 10%)\n')
    if (s.kind === 'drawDefinition') {
      const paletteStmt = s.def.body[0]
      expect(paletteStmt?.kind).toBe('palette')
      if (paletteStmt?.kind === 'palette') {
        expect(paletteStmt.entries[0]?.kind).toBe('destructure')
        if (paletteStmt.entries[0]?.kind === 'destructure') {
          expect(paletteStmt.entries[0].keys).toEqual(['a', 'b', 'c'])
        }
      }
    }
  })

  test('multi-letter palette key is a positioned error', () => {
    expect(() => parse('draw d 2x2:\n  palette ink=#111\n', 't.drw')).toThrow(/one ASCII letter/)
  })

  test('old pal spelling errors, naming palette (ADR-0096 §2)', () => {
    expect(() => parse('draw d 2x2:\n  pal k=#111\n', 't.drw')).toThrow(/renamed to 'palette'/)
  })

  test('old grad spelling errors, naming gradient (ADR-0096 §2)', () => {
    expect(() => parse('gradient sky = linear(90, #000, #fff)\n', 't.drw')).not.toThrow()
    expect(() => parse('grad sky = linear(90, #000, #fff)\n', 't.drw')).toThrow(
      /renamed to 'gradient'/,
    )
  })

  test('if / else statement and match', () => {
    const src =
      'draw d 4x4:\n  if x > 15:\n    bg k\n  else:\n    bg r\n  match x:\n    0: bg k\n    else: bg r\n'
    const s = one(src)
    if (s.kind === 'drawDefinition') {
      expect(s.def.body[0]?.kind).toBe('if')
      expect(s.def.body[1]?.kind).toBe('match')
    }
  })

  test('if-expression requires both branches', () => {
    const s = one('c = if x > 15 then y else r\n')
    expect(s.kind).toBe('binding')
    if (s.kind === 'binding') {
      expect(s.expression.kind).toBe('ifExpression')
    }
    expect(() => parse('c = if x then y\n', 't.drw')).toThrow(/else/)
  })

  test('for with half-open and inclusive ranges', () => {
    const a = one('draw d 4x4:\n  for i 0..h:\n    px k i:0\n')
    if (a.kind === 'drawDefinition') {
      const f = a.def.body[0]
      if (f?.kind === 'for') {
        expect(f.iterable.kind).toBe('range')
        if (f.iterable.kind === 'range') {
          expect(f.iterable.inclusive).toBe(false)
        }
      }
    }
    const b = one('draw d 4x4:\n  for i 0..=3:\n    px k i:0\n')
    if (b.kind === 'drawDefinition') {
      const f = b.def.body[0]
      if (f?.kind === 'for') {
        expect(f.iterable.kind).toBe('range')
        if (f.iterable.kind === 'range') {
          expect(f.iterable.inclusive).toBe(true)
        }
      }
    }
  })

  test('range is an expression and for accepts a list expression', () => {
    const r = one('nums = 1..=8\n')
    expect(r.kind).toBe('binding')
    if (r.kind === 'binding') {
      expect(r.expression.kind).toBe('range')
    }
    const f = one('draw d 4x4:\n  for i nums:\n    px k i:0\n')
    if (f.kind === 'drawDefinition') {
      const stmt = f.def.body[0]
      expect(stmt?.kind).toBe('for')
      if (stmt?.kind === 'for') {
        expect(stmt.iterable.kind).toBe('name')
      }
    }
  })

  test('theme with composition and style', () => {
    const s = one(
      'theme dusk:\n  with pixelBase, warmPal\n  palette:\n    g = #3a8a3a\n  style "Organic."\n',
    )
    expect(s.kind).toBe('themeDefinition')
    if (s.kind === 'themeDefinition') {
      expect(s.def.items[0]?.kind).toBe('with')
      expect(s.def.items[2]?.kind).toBe('style')
    }
  })

  test('export with format flags', () => {
    const s = one(
      'export gem icons/gem:\n  png @1 @2 @3 z9\n  svg ids classes\n  jpeg 512x512 q80 mode smooth\n  path\n',
    )
    expect(s.kind).toBe('exportDefinition')
    if (s.kind === 'exportDefinition') {
      expect(s.def.basePath).toBe('icons/gem')
      const png = s.def.formats[0]
      expect(png?.scales).toEqual([1, 2, 3])
      expect(png?.zlib).toBe(9)
      const jpeg = s.def.formats[2]
      expect(jpeg?.quality).toBe(80)
      expect(jpeg?.mode).toBe('smooth')
      expect(jpeg?.sizes).toEqual([{ width: 512, height: 512 }])
      expect(s.def.formats[3]?.format).toBe('path')
    }
  })

  test('path definitions parse block commands and expression aliases', () => {
    const s = one(
      'path shield 16x16:\n  move 8:1\n  line rel 4:4\n  quad rel 2:2 8:14\n  bezier 6:14 4:12 2:6\n  arc 8:1 around 8:8 ccw\n  close\n',
    )
    expect(s.kind).toBe('pathDefinition')
    if (s.kind === 'pathDefinition' && s.def.body.kind === 'commands') {
      expect(s.def.size).toEqual({ width: 16, height: 16 })
      expect(s.def.body.commands.at(-1)?.kind).toBe('close')
    }
    const alias = one('path badge = shield.subtract(notch)\n')
    expect(alias.kind).toBe('pathDefinition')
    if (alias.kind === 'pathDefinition') {
      expect(alias.def.body.kind).toBe('expression')
    }
  })

  test('from with alias and hyphenated path segment (D5)', () => {
    const s = one('from ui-parts eye as uiEye\n')
    expect(s.kind).toBe('import')
    if (s.kind === 'import') {
      expect(s.module).toBe('ui-parts')
      expect(s.items[0]).toEqual({ name: 'eye', alias: 'uiEye' })
    }
  })

  test('image definition with sha pin', () => {
    const s = one('image logo = ../brand/logo.png sha256 abcdef12\n')
    expect(s.kind).toBe('image')
    if (s.kind === 'image') {
      expect(s.path).toBe('../brand/logo.png')
      expect(s.sha256).toBe('abcdef12')
    }
  })

  test('old import spelling for a loaded image errors, naming image (ADR-0096 §2)', () => {
    expect(() => one('import logo = ../brand/logo.png\n')).toThrow(/renamed to 'image'/)
  })

  test('mask def vs mask block (D7)', () => {
    const a = one('mask m = circle(8:8, 4)\n')
    expect(a.kind).toBe('binding')
    if (a.kind === 'binding') {
      expect(a.bindKind).toBe('mask')
    }
    const b = one('draw d 4x4:\n  mask m:\n    bg k\n')
    if (b.kind === 'drawDefinition') {
      expect(b.def.body[0]?.kind).toBe('maskBlock')
    }
    const c = one('draw d 4x4:\n  mask badge.fill():\n    bg k\n')
    if (c.kind === 'drawDefinition') {
      expect(c.def.body[0]?.kind).toBe('maskBlock')
    }
  })

  test('font directive vs font definition (D7)', () => {
    const dir = one('font small\n')
    expect(dir.kind).toBe('fontDirective')
    const def = one(
      'font runic 5x7:\n  with small\n  glyph "A" runeA\n  glyph "B":\n    pixels:\n      k\n',
    )
    expect(def.kind).toBe('fontDefinition')
    if (def.kind === 'fontDefinition') {
      const inline = def.def.items.find((item) => item.kind === 'inlineGlyph')
      expect(inline?.kind).toBe('inlineGlyph')
      if (inline?.kind === 'inlineGlyph') {
        expect(inline.char).toBe('B')
        expect(inline.body[0]?.kind).toBe('pixels')
      }
    }
  })

  test('tileset and atlas', () => {
    const t = one('tileset terrain 16x16:\n  tiles grass, dirt\n  cols 4\n')
    expect(t.kind).toBe('tilesetDefinition')
    if (t.kind === 'tilesetDefinition') {
      expect(t.def.columns).toBe(4)
    }
    const a = one('atlas hud:\n  sprites play, stop\n  pad 1\n  place logo 0:0\n')
    expect(a.kind).toBe('atlasDefinition')
    if (a.kind === 'atlasDefinition') {
      expect(a.def.padding).toBe(1)
    }
  })

  test('UFCS chain and dot-index', () => {
    const s = one('c = #235.desaturate(30%).hue(30).lighten(10%)\n')
    if (s.kind === 'binding') {
      expect(s.expression.kind).toBe('method')
    }
    const i = one('v = xs.3\n')
    if (i.kind === 'binding') {
      expect(i.expression.kind).toBe('dotIndex')
    }
  })

  test('drawing-level use must lead', () => {
    expect(() => parse('draw d 4x4:\n  bg k\n  use themes dusk\n', 't.drw')).toThrow(/precede/)
  })

  test('every reserved word used as a binding name gets a dedicated E004', () => {
    const reserved = ['rel', 'if', 'then', 'else', 'true', 'false', 'transparent', 'mod', 'as']
    for (const word of reserved) {
      try {
        parse(`${word} = 3\n`, 't.drw')
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          expect(e.toDiagnostic()).toMatchObject({
            code: 'E004',
            message: `'${word}' is a reserved word — pick another name`,
            column: 1,
          })
        }
      }
    }
  })

  test('a reserved word inside a destructuring list is anchored on itself, not the first name', () => {
    try {
      parse('x, mod = 1, 2\n', 't.drw')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.toDiagnostic()).toMatchObject({
          code: 'E004',
          message: "'mod' is a reserved word — pick another name",
          column: 4,
        })
      }
    }
  })

  test('reserved words are still usable outside binding position', () => {
    expect(() => parse('if true:\n  x = 1\nelse:\n  x = 2\n', 't.drw')).not.toThrow()
    expect(() => parse('x = 1 mod 2\n', 't.drw')).not.toThrow()
  })

  test('by is no longer reserved — it binds like any name (ADR-0073)', () => {
    expect(() => parse('by = 3\n', 't.drw')).not.toThrow()
    const s = one('by = 3\n')
    expect(s.kind).toBe('binding')
    if (s.kind === 'binding') {
      expect(s.names).toEqual(['by'])
    }
  })

  test('filter definition parses call-only bodies and rejects other statement kinds (E004)', () => {
    const s = one('filter retro:\n  outline k\n  tint r 0.3\n')
    expect(s.kind).toBe('filterDefinition')
    if (s.kind === 'filterDefinition') {
      expect(s.name).toBe('retro')
      expect(s.body.map((b) => b.kind)).toEqual(['call', 'call'])
    }
    expect(() => parse('filter bad:\n  if x > 0:\n    outline k\n', 't.drw')).toThrow(
      /filter commands only/,
    )
  })

  test('scatter block parses NAME count seed region + body (ADR-0077)', () => {
    const d = one('draw d 8x8:\n  scatter p 30 7 rect(0:0, 7:7):\n    px #fff p\n')
    expect(d.kind).toBe('drawDefinition')
    if (d.kind === 'drawDefinition') {
      const s = d.def.body[0]
      expect(s?.kind).toBe('scatter')
      if (s?.kind === 'scatter') {
        expect(s.target).toBe('p')
        expect(s.count.kind).toBe('number')
        expect(s.seed.kind).toBe('number')
        expect(s.region.kind).toBe('call')
        expect(s.body.map((b) => b.kind)).toEqual(['call'])
      }
    }
  })

  test('mirror block parses axis + at + body (ADR-0078)', () => {
    const dx = one('draw d 8x8:\n  mirror x=4:\n    px #fff 1:1\n')
    if (dx.kind === 'drawDefinition') {
      const s = dx.def.body[0]
      expect(s?.kind).toBe('mirror')
      if (s?.kind === 'mirror') {
        expect(s.axis).toBe('x')
        expect(s.at.kind).toBe('number')
        expect(s.body).toHaveLength(1)
      }
    }
    const dy = one('draw d 8x8:\n  mirror y=3:\n    px #fff 1:1\n')
    if (dy.kind === 'drawDefinition') {
      const s = dy.def.body[0]
      if (s?.kind === 'mirror') {
        expect(s.axis).toBe('y')
      }
    }
    // `at` may be an expression
    const de = one('draw d 8x8:\n  mirror x=w/2:\n    px #fff 1:1\n')
    if (de.kind === 'drawDefinition') {
      const s = de.def.body[0]
      if (s?.kind === 'mirror') {
        expect(s.at.kind).toBe('binary')
      }
    }
  })

  test('scatter/mirror nest inside each other', () => {
    const d = one(
      'draw d 8x8:\n  mirror x=4:\n    scatter p 5 1 rect(0:0, 3:7):\n      mirror y=4:\n        px #fff p\n',
    )
    if (d.kind === 'drawDefinition') {
      const outer = d.def.body[0]
      expect(outer?.kind).toBe('mirror')
      if (outer?.kind === 'mirror') {
        const sc = outer.body[0]
        expect(sc?.kind).toBe('scatter')
        if (sc?.kind === 'scatter') {
          expect(sc.body[0]?.kind).toBe('mirror')
        }
      }
    }
  })

  test('scatter/mirror are contextual — still bindable outside header position', () => {
    expect(() => parse('scatter = 3\nmirror = 4\n', 't.drw')).not.toThrow()
    const s = one('scatter = 3\n')
    expect(s.kind).toBe('binding')
    if (s.kind === 'binding') {
      expect(s.names).toEqual(['scatter'])
    }
    const m = one('mirror = 4\n')
    expect(m.kind).toBe('binding')
  })

  test('malformed headers fail with E004', () => {
    // scatter needs a `:` after its operands
    expect(() =>
      parse('draw d 8x8:\n  scatter p 3 1 rect(0:0, 7:7)\n    px #fff p\n', 't.drw'),
    ).toThrow(DrawsticError)
    // mirror needs axis `=` value
    expect(() => parse('draw d 8x8:\n  mirror z=4:\n    px #fff 1:1\n', 't.drw')).toThrow(
      DrawsticError,
    )
  })

  test('a point literal in the draw-header size slot names the mistake, not a generic E004', () => {
    const src = 'draw arm 9:20:\n  px #fff 0:0\n'
    try {
      parse(src, 't.drw')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        const d = e.toDiagnostic()
        const start = src.indexOf('9:20')
        expect(d).toMatchObject({
          code: 'E004',
          message: "drawing size is WxH with integer literals (e.g. 9x20) — '9:20' is a point",
          hint: "use 'x' between width and height, e.g. 9x20",
          line: 1,
          column: start + 1,
          endLine: 1,
          endColumn: start + 1 + '9:20'.length,
        })
      }
    }
  })

  test('same point-literal-as-size diagnostic fires for a parametric draw header', () => {
    const src = 'draw arm(c) 9:20:\n  px #fff 0:0\n'
    try {
      parse(src, 't.drw')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        const d = e.toDiagnostic()
        const start = src.indexOf('9:20')
        expect(d).toMatchObject({
          code: 'E004',
          message: "drawing size is WxH with integer literals (e.g. 9x20) — '9:20' is a point",
          hint: "use 'x' between width and height, e.g. 9x20",
          line: 1,
          column: start + 1,
          endLine: 1,
          endColumn: start + 1 + '9:20'.length,
        })
      }
    }
  })

  test('regression: a valid WxH draw header still parses (9x20 is one SIZE token, not a point)', () => {
    const d = one('draw arm 9x20:\n  px #fff 0:0\n')
    expect(d.kind).toBe('drawDefinition')
    if (d.kind === 'drawDefinition') {
      expect(d.def.size).toEqual({ width: 9, height: 20 })
    }
  })

  test('regression: a sizeless draw header still parses', () => {
    const d = one('draw arm:\n  px #fff 0:0\n')
    expect(d.kind).toBe('drawDefinition')
    if (d.kind === 'drawDefinition') {
      expect(d.def.size).toBeUndefined()
    }
  })
})
