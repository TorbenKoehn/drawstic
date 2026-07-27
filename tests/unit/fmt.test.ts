import { describe, expect, test } from 'bun:test'
import { DrawsticError, ERROR_CODE, error, formatDiagnostic } from '../../src/diagnostic.js'
import { format, formatDiff } from '../../src/fmt.js'

describe('fmt', () => {
  test('is idempotent', () => {
    const src = 'draw a 2x2:\n  bg #fff\n'
    expect(format(format(src))).toBe(format(src))
  })

  test('normalizes CRLF, trailing whitespace, blank runs', () => {
    const src = 'x = 1  \r\n\r\n\r\n\r\ny = 2\r\n'
    expect(format(src)).toBe('x = 1\n\ny = 2\n')
  })

  test('re-indents to 2 spaces per level', () => {
    const src = 'draw a 2x2:\n    bg #fff\n    if x > 0:\n            px #000 0:0\n'
    expect(format(src)).toBe('draw a 2x2:\n  bg #fff\n  if x > 0:\n    px #000 0:0\n')
  })

  test('keeps wrapped logical lines untouched', () => {
    const src = 'g = linear(90,\n      #fff,\n      #000)\n'
    expect(format(src)).toBe(src)
  })

  test('guarantees one trailing newline', () => {
    expect(format('x = 1')).toBe('x = 1\n')
    expect(format('x = 1\n\n\n')).toBe('x = 1\n')
  })

  test('reports formatter diff metadata', () => {
    const source = 'draw a 2x2:\n    bg #fff\n'
    const formatted = format(source)
    expect(formatDiff(source, formatted)).toEqual({
      firstChangedLine: 2,
      changedLineCount: 1,
    })
    expect(formatDiff(source, formatted, true).unifiedDiff).toContain('-    bg #fff')
  })

  test('parens inside string literals are not counted toward wrap depth', () => {
    const src = 'x = "("\n    bg 1\n'
    expect(format(src)).toBe('x = "("\n  bg 1\n')
  })

  test('a "#" comment (not a color literal) ends paren scanning for that line', () => {
    const src = 'x = 1 # (note\n    bg 1\n'
    expect(format(src)).toBe('x = 1 # (note\n  bg 1\n')
  })

  test('dedent to an indentation width with no exact prior match still normalizes', () => {
    const src = 'draw a 2x2:\n      bg #fff\n  px #000 0:0\n'
    expect(format(src)).toBe('draw a 2x2:\n  bg #fff\n  px #000 0:0\n')
  })

  test('round-trips curve / curvePoly statements (ADR-0074/0075)', () => {
    // canonical form: re-indent the body, leave the command lines byte-identical
    const src =
      'draw d 32x24:\n    curve #e8c 2:20 12:4 20:16 28:6 w2\n    curvePoly #6c9 6:12 20:6 32:14 22:20 fill\n'
    const want =
      'draw d 32x24:\n  curve #e8c 2:20 12:4 20:16 28:6 w2\n  curvePoly #6c9 6:12 20:6 32:14 22:20 fill\n'
    expect(format(src)).toBe(want)
    expect(format(want)).toBe(want) // idempotent
    expect(format(format(src))).toBe(format(src))
  })

  test('round-trips profile statements incl. baseline (ADR-0076)', () => {
    const src =
      'fn ridgeY(nx) = 16 + round(noise(3, nx * 4, 0) * 10)\ndraw d 64x32:\n    profile #c9a06b 0..64 ridgeY fill\n    profile #66ccaa 0..=40 ridgeY 12 fill\n'
    const want =
      'fn ridgeY(nx) = 16 + round(noise(3, nx * 4, 0) * 10)\ndraw d 64x32:\n  profile #c9a06b 0..64 ridgeY fill\n  profile #66ccaa 0..=40 ridgeY 12 fill\n'
    expect(format(src)).toBe(want)
    expect(format(want)).toBe(want) // idempotent
    expect(format(format(src))).toBe(format(src))
  })

  test('round-trips + re-indents scatter / mirror blocks (ADR-0077/0078)', () => {
    const src =
      'draw d 32x24:\n  bg #05060e\n  scatter p 30 7 rect(0:0, w-1:h-1):\n        px #ffffff p\n  mirror x=16:\n      circle #b0407a 8:9 3 fill\n'
    const want =
      'draw d 32x24:\n  bg #05060e\n  scatter p 30 7 rect(0:0, w-1:h-1):\n    px #ffffff p\n  mirror x=16:\n    circle #b0407a 8:9 3 fill\n'
    expect(format(src)).toBe(want)
    expect(format(want)).toBe(want) // canonical form is a fixed point
    expect(format(format(src))).toBe(format(src)) // idempotent
  })

  test('round-trips nested mirror/scatter bodies', () => {
    const want =
      'draw d 16x16:\n  mirror x=8:\n    mirror y=8:\n      scatter p 4 3 rect(0:0, 7:7):\n        px #fff p\n'
    expect(format(want)).toBe(want)
    expect(format(format(want))).toBe(format(want))
  })

  test('an export-header-shaped line inside a triple-quoted string is left alone (ADR-0098 §8)', () => {
    // Regression: normalizeExportHeader used to run on every depth-0 line, so a style-guide body
    // that happened to contain "export a ,b:" verbatim got rewritten to "export a, b:" — a line the
    // author never wrote as code. `depth === 0` alone can't fix this: the offending line genuinely
    // is at depth 0, it just isn't code.
    const src = 'desc = """\nexport a ,b:\n"""\n'
    expect(format(src)).toBe(src)
    expect(format(format(src))).toBe(format(src)) // idempotent
  })

  test('a real export header inside a normally-indented block still normalizes around a string body', () => {
    const src = 'theme t:\n  style """\n  export a ,b:\n  """\n\nexport chat ,phone:\n  png\n'
    const want = 'theme t:\n  style """\n  export a ,b:\n  """\n\nexport chat, phone:\n  png\n'
    expect(format(src)).toBe(want)
    expect(format(want)).toBe(want)
  })
})

describe('diagnostics contract (ADR-0030)', () => {
  test('record shape and human rendering derive from one record', () => {
    const e = error(
      ERROR_CODE.unknownName,
      "unknown name 'slmie'",
      'a.drw',
      { line: 12, column: 3 },
      "did you mean 'slime'?",
    )
    expect(e).toBeInstanceOf(DrawsticError)
    const d = e.toDiagnostic()
    expect(d).toMatchObject({
      severity: 'error',
      code: 'E001',
      message: "unknown name 'slmie'",
      file: 'a.drw',
      line: 12,
      column: 3,
      hint: "did you mean 'slime'?",
    })
    const human = formatDiagnostic(d)
    expect(human).toContain('a.drw:12:3')
    expect(human).toContain('E001')
    expect(human).toContain('did you mean')
  })
})
