import { describe, expect, test } from 'bun:test'
import type { ModuleRecord } from '../../src/eval.js'
import { Engine } from '../../src/eval.js'
import { censusModule, lintModule } from '../../src/lint.js'

let n = 0
const load = (src: string): { engine: Engine; mod: ModuleRecord } => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\lint${n++}.drw`, 'lint.drw')
  return { engine, mod }
}

describe('lintModule', () => {
  test('W002: flags a drawing that is neither exported, stamped, nor fitted', () => {
    const { engine, mod } = load(
      'draw orphan 2x2:\n  palette k=#000000\n  pixels:\n    kk\n    kk\n',
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W002',
      message: "drawing 'orphan' is neither exported, stamped, nor fitted",
      file: 'lint.drw',
      hint: 'export it, stamp it, or fit it from another drawing',
    })
  })

  test('W002 is avoided by exporting a drawing or by stamping it from another', () => {
    const { engine, mod } = load(
      'draw dot 2x2:\n  palette k=#000000\n  pixels:\n    kk\n    kk\n\ndraw scene 4x4:\n  stamp dot 1:1\n\nexport scene icons/scene:\n  png\n',
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('W002 is avoided when the only use of a drawing is a `fit` target (pin/fit-built character)', () => {
    const { engine, mod } = load(
      [
        'draw torso 12x20:',
        '  fill #6a5030 rect(0:0, 11:19)',
        '  pin shoulder 10:3',
        '',
        'draw arm 6x14:',
        '  fill #8a5a3a rect(0:0, 5:13)',
        '  pin shoulder 0:2',
        '',
        'draw fig 30x30:',
        '  stamp torso 4:2',
        '  pin torso.shoulder 14:5',
        '  fit arm.shoulder torso.shoulder',
        '',
        'export fig chars/fig:',
        '  png',
        '',
      ].join('\n'),
    )
    // `arm` is never `stamp`ed or `export`ed — only `fit`-attached — and must not W002.
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('W002 is avoided when the only stamp of a drawing is nested inside a scatter body (the arctic pond case)', () => {
    const { engine, mod } = load(
      [
        'draw snowflake 2x2:',
        '  palette w=#ffffff',
        '  pixels:',
        '    ww',
        '    ww',
        '',
        'draw scene 16x16:',
        '  mask pond = rect(2:6, 13:11)',
        '  scatter fl 6 2 pond:',
        '    stamp snowflake fl',
        '',
        'export scene test/scene:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('W002 is avoided when the only stamp is nested inside mirror and a loop body', () => {
    const { engine, mod } = load(
      [
        'draw wing 2x2:',
        '  palette k=#000000',
        '  pixels:',
        '    kk',
        '    kk',
        '',
        'draw bird 2x2:',
        '  palette b=#3366aa',
        '  pixels:',
        '    bb',
        '    bb',
        '',
        'draw scene 20x20:',
        '  mirror x=10:',
        '    stamp wing 1:1',
        '  for row 0..3:',
        '    stamp bird row:row',
        '',
        'export scene test/scene:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('W002 still fires for a drawing that is never stamped, even when another is stamped inside a nested body', () => {
    const { engine, mod } = load(
      [
        'draw snowflake 2x2:',
        '  palette w=#ffffff',
        '  pixels:',
        '    ww',
        '    ww',
        '',
        'draw unused 2x2:',
        '  palette k=#000000',
        '  pixels:',
        '    kk',
        '    kk',
        '',
        'draw scene 16x16:',
        '  mask pond = rect(2:6, 13:11)',
        '  scatter fl 6 2 pond:',
        '    stamp snowflake fl',
        '',
        'export scene test/scene:',
        '  png',
        '',
      ].join('\n'),
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W002',
      message: "drawing 'unused' is neither exported, stamped, nor fitted",
      hint: 'export it, stamp it, or fit it from another drawing',
    })
  })

  test('W001: flags unused local palette keys declared via both entry and destructured pal forms', () => {
    const { engine, mod } = load(
      'draw swatch 3x1:\n  palette k=#111111  r=#ff0000\n  palette:\n    a, b, c = #cccccc.tones(-12%, 0%, 12%)\n  pixels:\n    kab\n\nexport swatch ui/swatch:\n  png\n',
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(2)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W001',
      message: "unused local palette key 'r'",
      hint: 'remove it or use it in pixels or a paint expression',
    })
    expect(diags[1]).toMatchObject({
      severity: 'warning',
      code: 'W001',
      message: "unused local palette key 'c'",
      hint: 'remove it or use it in pixels or a paint expression',
    })
  })

  test('W004 is retired: a large procedural drawing lints clean', () => {
    // The old "preview this with --fit" nudge fired on every scene-sized canvas (90 emissions in
    // the session history, the most-emitted diagnostic of all) and carried no action. Verifying a
    // big drawing belongs to the render-and-look loop, not to a lint. The code is never reused.
    const { engine, mod } = load(
      'draw bigProcedural 200x100:\n  circle #202020 100:50 40 fill\n\nexport bigProcedural shapes/big:\n  png\n',
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('W003: flags a stamp whose footprint lands completely outside the host canvas', () => {
    const { engine, mod } = load(
      'draw dot 2x2:\n  palette k=#000000\n  pixels:\n    kk\n    kk\n\ndraw offscreen 4x4:\n  stamp dot 10:10\n\nexport offscreen icons/offscreen:\n  png\n',
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W003',
      message: "stamp 'dot' is completely clipped outside 'offscreen'",
    })
    expect(diags[0]?.hint).toBeUndefined()
  })

  test('lintClippedStamps skips non-literal targets/points and swallows render failures without crashing', () => {
    // Exercises every guard in lintClippedStamps in one module:
    // - a parametric drawing (diamond) is skipped outright when it's the one being linted
    // - a stamp target resolved only through a local binding (not a top-level draw) is skipped
    // - a stamp using a non-literal (bound) point is skipped
    // - a stamp target with no resolvable canvas size makes the *host's* render throw,
    //   which is swallowed when ghost itself is linted
    // - the same target, reached only through a statically-walked but never-executed
    //   `if false:` branch, makes the *target's* render throw inside the stamp loop,
    //   which is swallowed there too
    // - a parametric stamp target (diamond(...)) is skipped when checked from another host
    // - a stamp whose first argument is a reserved keyword form (`mask x`, parsed as a
    //   keyword-argument, not a plain name/call expression) is skipped
    // - a stamp target expression that's neither a name nor a call (a parenthesized
    //   expression) statically resolves to no name
    // - a stamp point whose component is a bare name (not a literal number or its
    //   negation) statically resolves to no point
    const { engine, mod } = load(
      [
        'draw box2 2x2:',
        '  palette k=#000000',
        '  pixels:',
        '    kk',
        '    kk',
        '',
        'draw diamond(c) 2x2:',
        '  bg c',
        '',
        'draw ghost:',
        '  bg #ffffff',
        '',
        'draw variant 6x6:',
        '  bg #ffffff',
        '  boxRef = box2',
        '  stamp boxRef 1:1',
        '  pt1 = 1:1',
        '  stamp box2 pt1',
        '  if false:',
        '    stamp ghost 1:1',
        '    stamp mask x 1:1',
        '    stamp (1+1) 1:1',
        '    stamp ghost q:1',
        '  stamp diamond(#ff0000) 3:3',
        '',
        'export variant shapes/variant:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('walks every statement and expression shape while collecting used palette names', () => {
    // Exercises the generic AST walkers (walkStatements/walkStatementExprs/walkArg/walkExpr)
    // across if/else, match, for, maskBlock, compound assignment, and
    // list/range/binary/ifExpression/index/dotIndex/method/keyword-argument expressions —
    // all of it real, renderable code (nothing dead), plus one genuinely out-of-bounds
    // stamp (negative coordinates) to also hit literalNumber's unary-minus branch.
    const { engine, mod } = load(
      [
        'mask localMask = circle(5:5, 3)',
        '',
        'draw dot2 2x2:',
        '  palette k=#000000',
        '  pixels:',
        '    kk',
        '    kk',
        '',
        'draw richDraw 10x10:',
        '  palette k=#222222 m=#333333 n=#444444 o=#555555',
        '  palette p=#666666 q=#777777 s=#888888 t=#999999 u=#aaaaaa',
        '  palette v=#bbbbbb z=#cccccc',
        '  cols = k, m',
        '  idx = cols[0]',
        '  dx = cols.0',
        '  lighter = n.lighten(10%)',
        '  plain = o.desaturate(100%)',
        '  px p 5:0',
        '  bexp = 1 == 2',
        '  iexp = if 1 == 2 then q else s',
        '  x = 0',
        '  x += 1',
        '  if 3 > 2:',
        '    px t 0:0',
        '  else:',
        '    px u 0:0',
        '  match 1:',
        '    0: px v 1:0',
        '    else: px v 1:0',
        '  for row 0..3:',
        '    px z 2:0',
        '  mask localMask:',
        '    bg m',
        '  stamp dot2 1:1 tint k 0.3',
        '  stamp dot2 -5:-5',
        '',
        'export richDraw parts/rich:',
        '  png',
        '',
      ].join('\n'),
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W003',
      message: "stamp 'dot2' is completely clipped outside 'richDraw'",
    })
  })

  test('W006: flags dither called with a fully transparent partner paint', () => {
    const { engine, mod } = load(
      'draw scene 10x10:\n  bg #ffffff\n  dither #ff0000 transparent 0.5\n\nexport scene test/scene:\n  png\n',
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W006',
      message: "dither's raw set produces transparency holes",
      hint: 'give the alpha-0 partner paint a visible alpha',
    })
  })

  test('W006 is avoided when both dither partners are opaque', () => {
    const { engine, mod } = load(
      'draw scene 10x10:\n  bg #ffffff\n  dither #ff0000 #00ff00 0.5\n\nexport scene test/scene:\n  png\n',
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('W007: flags a stamp fully covered by a later opaque stamp (the arctic fox-under-igloo case)', () => {
    const { engine, mod } = load(
      [
        'draw fox 4x4:',
        '  palette k=#000000',
        '  pixels:',
        '    kkkk',
        '    kkkk',
        '    kkkk',
        '    kkkk',
        '',
        'draw igloo 6x6:',
        '  palette b=#ffffff',
        '  pixels:',
        '    bbbbbb',
        '    bbbbbb',
        '    bbbbbb',
        '    bbbbbb',
        '    bbbbbb',
        '    bbbbbb',
        '',
        'draw scene 10x10:',
        '  stamp fox 1:1',
        '  stamp igloo 0:0',
        '',
        'export scene test/scene:',
        '  png',
        '',
      ].join('\n'),
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W007',
      message: "stamp 'fox' is fully covered by a later opaque paint and never visible",
      hint: 'reorder the stamps, or delete the dead one',
    })
  })

  test('W007: flags a stamp fully covered by a later opaque rect …fill', () => {
    const { engine, mod } = load(
      [
        'draw fox 4x4:',
        '  palette k=#000000',
        '  pixels:',
        '    kkkk',
        '    kkkk',
        '    kkkk',
        '    kkkk',
        '',
        'draw scene 10x10:',
        '  stamp fox 1:1',
        '  rect #ffffff 0:0 9:9 fill',
        '',
        'export scene test/scene:',
        '  png',
        '',
      ].join('\n'),
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W007',
    })
  })

  test('W007 does not fire when the stamp is painted after the covering paint', () => {
    const { engine, mod } = load(
      [
        'draw fox 4x4:',
        '  palette k=#000000',
        '  pixels:',
        '    kkkk',
        '    kkkk',
        '    kkkk',
        '    kkkk',
        '',
        'draw scene 10x10:',
        '  rect #ffffff 0:0 9:9 fill',
        '  stamp fox 1:1',
        '',
        'export scene test/scene:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  // W008 tests use a deliberately tiny user font (glyph "A" only) so the assertion
  // is robust against the bundled std faces gaining glyphs over time. Coverage is
  // read from the resolved font at runtime — no hardcoded character list.
  const TINY_FONT = [
    'font tiny 3x3:',
    '  glyph "A":',
    '    pixels:',
    '      kkk',
    '      k.k',
    '      kkk',
    '',
  ]

  test('W008: flags text with a literal character the resolved font cannot render', () => {
    const { engine, mod } = load(
      [
        ...TINY_FONT,
        'draw label 20x8:',
        '  text #ffffff 1:1 "AB" font tiny',
        '',
        'export label ui/label:',
        '  png',
        '',
      ].join('\n'),
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W008',
      message: "text has 1 character(s) with no glyph in font 'tiny': 'B'",
      hint: 'add these glyphs to the font, pick a font that has them, or drop them',
    })
  })

  test('W008 does not fire when every literal character is covered', () => {
    const { engine, mod } = load(
      [
        ...TINY_FONT,
        'draw label 20x8:',
        '  text #ffffff 1:1 "AA" font tiny',
        '',
        'export label ui/label:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('W008 resolves the ambient font from the theme when a text call has no font keyword', () => {
    const { engine, mod } = load(
      [
        ...TINY_FONT,
        'theme t:',
        '  size 20x8',
        '  font tiny',
        '',
        'use t',
        '',
        'draw label:',
        '  text #ffffff 1:1 "AB"',
        '',
        'export label ui/label:',
        '  png',
        '',
      ].join('\n'),
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      code: 'W008',
      message: expect.stringContaining("'tiny': 'B'"),
    })
  })

  test('W008 tracks a top-level `font` directive but skips ambient text when a nested directive makes it flow-dependent', () => {
    // top-level `font tiny` before the text → decidable → fires;
    // a `font` directive buried in an if-block → ambient unknowable → the
    // keyword-less text is skipped (conservative, no false positive).
    const tracked = load(
      [
        ...TINY_FONT,
        'draw a 20x8:',
        '  font tiny',
        '  text #ffffff 1:1 "AB"',
        '',
        'export a ui/a:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(tracked.engine, tracked.mod)).toHaveLength(1)

    const nested = load(
      [
        ...TINY_FONT,
        'draw a 20x8:',
        '  if 1 > 0:',
        '    font tiny',
        '  text #ffffff 1:1 "AB"',
        '',
        'export a ui/a:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(nested.engine, nested.mod)).toEqual([])
  })

  test('W008 skips a non-literal (computed) text string', () => {
    const { engine, mod } = load(
      [
        ...TINY_FONT,
        'draw label 20x8:',
        '  s = "B"',
        '  text #ffffff 1:1 s font tiny',
        '',
        'export label ui/label:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('W009: flags a pixels grid whose last row is fully transparent (the seam-footprint case)', () => {
    const { engine, mod } = load(
      [
        'draw part 4x4:',
        '  palette k=#000000',
        '  pixels:',
        '    kkkk',
        '    kkkk',
        '    kkkk',
        '    ....',
        '',
        'export part parts/part:',
        '  png',
        '',
      ].join('\n'),
    )
    const diags = lintModule(engine, mod)
    expect(diags).toHaveLength(1)
    expect(diags[0]).toMatchObject({
      severity: 'warning',
      code: 'W009',
      message: "pixels grid of 'part' has a fully transparent last row",
      file: 'lint.drw',
      hint: 'a transparent edge row enlarges the stamp footprint; trim it or account for the offset — stamps place by top-left, so a trailing empty row seams a gap below stacked parts',
    })
    // span points at the offending (last) row, not the draw header
    expect(diags[0]?.line).toBe(7)
  })

  test('W009 is silent when the grid has no transparent last row', () => {
    const { engine, mod } = load(
      [
        'draw part 4x3:',
        '  palette k=#000000',
        '  pixels:',
        '    kkkk',
        '    kkkk',
        '    kkkk',
        '',
        'export part parts/part:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(engine, mod)).toEqual([])
  })

  test('W009 is scoped to the LAST ROW only — a transparent first row or a transparent last column never fires', () => {
    // first row transparent, last row solid → not the seam trap → silent
    const firstRow = load(
      [
        'draw part 4x4:',
        '  palette k=#000000',
        '  pixels:',
        '    ....',
        '    kkkk',
        '    kkkk',
        '    kkkk',
        '',
        'export part parts/part:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(firstRow.engine, firstRow.mod)).toEqual([])

    // last column transparent, last row not fully transparent → columns are not
    // checked (side-padding is legitimate) → silent
    const lastCol = load(
      [
        'draw part 4x4:',
        '  palette k=#000000',
        '  pixels:',
        '    kkk.',
        '    kkk.',
        '    kkk.',
        '    kkk.',
        '',
        'export part parts/part:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(lastCol.engine, lastCol.mod)).toEqual([])
  })

  test('W009 skips a wholly transparent grid (an empty sprite, not a seam trap)', () => {
    const { engine, mod } = load(
      [
        'draw blank 2x2:',
        '  pixels:',
        '    ..',
        '    ..',
        '',
        'export blank parts/blank:',
        '  png',
        '',
      ].join('\n'),
    )
    expect(lintModule(engine, mod)).toEqual([])
  })
})

describe('canonical-path lints + construct census (W013–W015, ADR-0094/0097)', () => {
  const codes = (src: string): string[] => {
    const { engine, mod } = load(src)
    return lintModule(engine, mod).map((d) => d.code)
  }

  test('W012 is retired and unfireable — a raw rim beside a model now only reports `retired`', () => {
    // ADR-0097 removed `rim`/`shadeRegion`/`lightRegion`, so the lint that flagged them beside a
    // `model` can never fire again. The code stays reserved; the recipe is caught *earlier*, by the
    // census `retired` flag, which does not need a `model` in the same drawing to notice.
    const withModel = [
      'light sun = dir 1:1 #ffe6b0',
      'material m = #8a95a5 metal',
      'draw part 12x12:',
      '  r = rect(1:1, 10:10)',
      '  model r m light sun',
      '  rim r 1:1 #ffffff 1',
      '',
      'export part p/part:',
      '  png',
      '',
    ].join('\n')
    expect(codes(withModel)).not.toContain('W012')
    const { engine, mod } = load(withModel)
    const rim = censusModule(engine, mod).constructs.find((c) => c.construct === 'rim')
    expect(rim?.retired).toBe(true)
    expect(rim?.specOnly).toBeUndefined()
  })

  test('W013 fires on a litTone .intersect corner patch over a model', () => {
    const src = [
      'light sun = dir 1:1 #ffe6b0',
      'material m = #8a95a5 cloth',
      'draw part 12x12:',
      '  r = rect(1:1, 10:10)',
      '  model r m light sun',
      '  fill litTone(#8a95a5, #ffe6b0, 30%) r.intersect(rect(1:1, 5:5))',
      '',
      'export part p/part:',
      '  png',
      '',
    ].join('\n')
    expect(codes(src)).toContain('W013')
  })

  test('W014 fires on a stamp of a pinned part, exempts a pin-seeded root', () => {
    const parts = ['draw pinned 8x8:', '  fill #888888 rect(0:0, 7:7)', '  pin top 4:0', ''].join(
      '\n',
    )
    const stampNoSeed = `${parts}draw asm 20x20:\n  stamp pinned 2:2\n\nexport asm a/asm:\n  png\n`
    expect(codes(stampNoSeed)).toContain('W014')
    // a pin-seeded root (its canvas pins declared) is the two-phase assembly idiom — no W014.
    const seededRoot = `${parts}draw asm 20x20:\n  stamp pinned 2:2\n  pin pinned.top 6:2\n\nexport asm a/asm:\n  png\n`
    expect(codes(seededRoot)).not.toContain('W014')
  })

  test('W015 fires on a hand contact-shadow ellipse in the foot zone of a fitted figure', () => {
    const src = [
      'draw child 8x40:',
      '  fill #888888 rect(0:0, 7:39)',
      '  pin hip 4:0',
      'draw fig 32x64:',
      '  fill #223344.alpha(45%) ellipse(16:60, 10:3)',
      '  pin a.hip 16:10',
      '  fit child.hip a.hip',
      '',
      'export fig f/fig:',
      '  png',
      '',
    ].join('\n')
    expect(codes(src)).toContain('W015')
  })

  test('census counts constructs and flags the anti-patterns deterministically', () => {
    const src = [
      'draw pinned 8x8:',
      '  fill #888888 rect(0:0, 7:7)',
      '  pin top 4:0',
      'draw part 20x20:',
      '  stamp pinned 2:2',
      '',
      'export part p/part:',
      '  png',
      '',
    ].join('\n')
    const { engine, mod } = load(src)
    const census = censusModule(engine, mod)
    expect(census.antiPatterns).toEqual({ manualSpread: 0, stampWithPins: 1, handShadow: 0 })
    const stamp = census.constructs.find((c) => c.construct === 'stamp')
    expect(stamp?.count).toBe(1)
    expect(stamp?.nonCanonical).toBe(true)
    const pixels = census.constructs.find((c) => c.construct === 'pixels')
    expect(pixels).toBeUndefined()
    // deterministic: two runs give the identical census.
    expect(censusModule(engine, mod)).toEqual(census)
  })

  test('census flags the whole removed hand-light quartet as retired (ADR-0097)', () => {
    // All four still parse and load — they only fail at render — so the census is the *static*
    // diagnosis a stale recipe gets from `check --lint`/`critique` before it is ever rendered.
    for (const [construct, stmt] of [
      ['rim', 'rim r 1:1 #ffffff 1'],
      ['shadeRegion', 'shadeRegion r -4:-4 #000000 0.3'],
      ['lightRegion', 'lightRegion r -4:-4 #ffffff 0.2'],
      ['ao', 'ao r #000000 0.3'],
    ] as const) {
      const { engine, mod } = load(
        `draw part 12x12:\n  r = rect(1:1, 10:10)\n  fill #808080 r\n  ${stmt}\n\nexport part p/part:\n  png\n`,
      )
      const entry = censusModule(engine, mod).constructs.find((c) => c.construct === construct)
      expect(entry?.count).toBe(1)
      expect(entry?.retired).toBe(true)
      expect(entry?.specOnly).toBeUndefined()
    }
  })

  test('census counts the `palette` construct under its current name (was `pal`, ADR-0096 §2)', () => {
    const { engine, mod } = load(
      'draw part 2x2:\n  palette k=#000000\n  pixels:\n    kk\n    kk\n\nexport part p/part:\n  png\n',
    )
    const census = censusModule(engine, mod)
    expect(census.constructs.find((c) => c.construct === 'palette')?.count).toBe(1)
    expect(census.constructs.some((c) => c.construct === 'pal')).toBe(false)
  })

  test('census flags a retired construct so a stale recipe is diagnosed without rendering it (ADR-0096 §1)', () => {
    // `castShadow` has its own statement shape (a call); `grayscale` (call- and UFCS-form) has
    // none of its own — both still load and census fine even though rendering either would now
    // throw the ADR-0096 §1 removal error.
    const src = [
      'draw part 6x4:',
      '  r = rect(1:1, 2:2)',
      '  castShadow r 2:0 #ff0000',
      '  bg #ff0000.grayscale',
      '  fill #00ff00.grayscale.hue(30) r',
      '',
      'export part p/part:',
      '  png',
      '',
    ].join('\n')
    const { engine, mod } = load(src)
    const census = censusModule(engine, mod)
    const castShadow = census.constructs.find((c) => c.construct === 'castShadow')
    expect(castShadow?.count).toBe(1)
    expect(castShadow?.retired).toBe(true)
    const grayscale = census.constructs.find((c) => c.construct === 'grayscale')
    expect(grayscale?.count).toBe(2) // the bare call and the UFCS chain, one statement each
    expect(grayscale?.retired).toBe(true)
  })
})

describe("W016: export path repeats the recipe's own directory (ADR-0096 §6)", () => {
  /** Like `load`, but places the recipe in a directory named `dir` so the W016 check has something
   *  to compare the export path's first segment against. */
  const loadIn = (dir: string, src: string): { engine: Engine; mod: ModuleRecord } => {
    const engine = new Engine(process.cwd())
    const mod = engine.loadSource(src, `${process.cwd()}\\${dir}\\recipe${n++}.drw`, 'recipe.drw')
    return { engine, mod }
  }

  test('flags an export path whose first segment repeats the recipe directory name', () => {
    const { engine, mod } = loadIn(
      'showcase',
      'draw scene 2x2:\n  bg #fff\n\nexport scene showcase/scene:\n  png\n',
    )
    const diags = lintModule(engine, mod)
    expect(diags).toContainEqual({
      severity: 'warning',
      code: 'W016',
      message: "export path 'showcase/scene' repeats the recipe's own directory 'showcase'",
      file: 'recipe.drw',
      line: 4,
      column: 1,
      endLine: 4,
      endColumn: 7,
      hint: "build writes next to the recipe — drop the 'showcase/' prefix",
    })
  })

  test('a bare export path (no repeated prefix) does not fire', () => {
    const { engine, mod } = loadIn(
      'showcase',
      'draw scene 2x2:\n  bg #fff\n\nexport scene scene:\n  png\n',
    )
    expect(lintModule(engine, mod).some((d) => d.code === 'W016')).toBe(false)
  })

  test('a family-style prefix that differs from the recipe directory does not fire', () => {
    // examples/icons/communication.drw exporting 'communication/chat' — the recipe directory is
    // 'icons', not 'communication', so this is the intended family/name convention, not a repeat.
    const { engine, mod } = loadIn(
      'icons',
      'draw chat 2x2:\n  bg #fff\n\nexport chat communication/chat:\n  png\n',
    )
    expect(lintModule(engine, mod).some((d) => d.code === 'W016')).toBe(false)
  })
})
