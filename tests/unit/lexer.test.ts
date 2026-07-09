import { describe, expect, test } from 'bun:test'
import { lex } from '../../src/lexer.js'

const kinds = (src: string): string[] =>
  lex(src, 't.drw')
    .map((t) => `${t.kind}${t.text ? `:${t.text}` : ''}`)
    .filter((k) => !k.startsWith('eof'))

describe('lexer', () => {
  test('names, ints, sizes, colors', () => {
    const toks = lex('draw gem 4x4: #1a2b3c', 't.drw')
    expect(toks[0]?.kind).toBe('name')
    expect(toks[1]?.text).toBe('gem')
    expect(toks[2]?.kind).toBe('size')
    expect(toks[2]?.num).toBe(4)
    expect(toks[2]?.sizeH).toBe(4)
    expect(toks[4]?.kind).toBe('color')
  })

  test('percent is only a suffix', () => {
    const toks = lex('x = 10%', 't.drw')
    expect(toks[2]?.kind).toBe('percent')
    expect(toks[2]?.num).toBeCloseTo(0.1)
  })

  test('leading UTF-8 BOM is skipped (ADR-0032 robustness)', () => {
    expect(kinds('\uFEFFx = 1')).toEqual(kinds('x = 1'))
    const toks = lex('\uFEFFdraw gem 4x4:', 't.drw')
    expect(toks[0]?.kind).toBe('name')
    expect(toks[0]?.col).toBe(1)
  })

  test('minus needs no whitespace (D5)', () => {
    const toks = lex('y = x-1', 't.drw')
    expect(toks.map((t) => t.text).slice(0, 5)).toEqual(['y', '=', 'x', '-', '1'])
  })

  test('comment vs color literal', () => {
    expect(kinds('# a comment')).toEqual([])
    const toks = lex('px #fff 1:1', 't.drw')
    expect(toks.some((t) => t.kind === 'color' && t.text === '#fff')).toBe(true)
  })

  test('line-final colon is the block colon (D1)', () => {
    const toks = lex('if p == 0:0:', 't.drw')
    const colons = toks.filter((t) => t.text === ':')
    expect(colons.length).toBe(2)
    expect(colons[0]?.blockColon).toBe(false)
    expect(colons[1]?.blockColon).toBe(true)
  })

  test('indent/dedent bracketing', () => {
    const toks = lex('draw a 2x2:\n  bg k\n', 't.drw')
    expect(toks.some((t) => t.kind === 'indent')).toBe(true)
    expect(toks.some((t) => t.kind === 'dedent')).toBe(true)
  })

  test('tab in indentation is an error', () => {
    expect(() => lex('draw a 2x2:\n\tbg k\n', 't.drw')).toThrow(/tab/)
  })

  test('pixels block switches to raw rows', () => {
    const toks = lex('pixels:\n  .r.\n  rrr\n', 't.drw')
    const rows = toks.filter((t) => t.kind === 'pixelrow').map((t) => t.text)
    expect(rows).toEqual(['.r.', 'rrr'])
  })

  test('logical line continues while ( is unclosed', () => {
    const toks = lex('g = linear(90,\n  #fff,\n  #000)\n', 't.drw')
    const nls = toks.filter((t) => t.kind === 'nl')
    expect(nls.length).toBe(1)
  })

  test('dot then digits is an INT index (D8)', () => {
    const toks = lex('xs.0.1', 't.drw')
    const nums = toks.filter((t) => t.kind === 'int').map((t) => t.num)
    expect(nums).toEqual([0, 1])
  })

  test('float literals need a leading digit', () => {
    const toks = lex('x = 0.25', 't.drw')
    expect(toks[2]?.kind).toBe('float')
    expect(toks[2]?.num).toBe(0.25)
  })

  test('triple-quoted strings span lines', () => {
    const toks = lex('style """\nline one\nline two\n"""', 't.drw')
    const s = toks.find((t) => t.kind === 'string')
    expect(s?.str).toContain('line one')
    expect(s?.str).toContain('line two')
  })

  test('strings support quote and backslash escapes', () => {
    const toks = lex('glyph "\\"" x\ntext #000 0:0 "\\\\"\n', 't.drw')
    const strings = toks.filter((t) => t.kind === 'string').map((t) => t.str)
    expect(strings).toEqual(['"', '\\'])
  })

  test('strings support \\n \\r \\t escapes', () => {
    const toks = lex('text #000 0:0 "a\\nb\\rc\\td"\n', 't.drw')
    const s = toks.find((t) => t.kind === 'string')
    expect(s?.str).toBe('a\nb\rc\td')
  })

  test('unknown string escape is an error', () => {
    expect(() => lex('x = "\\q"\n', 't.drw')).toThrow(/unknown string escape/)
  })

  test('unterminated (non-triple) string is an error', () => {
    expect(() => lex('x = "abc\n', 't.drw')).toThrow(/unterminated string/)
  })

  test('unterminated triple-quoted string is an error', () => {
    expect(() => lex('style """\nline one\n', 't.drw')).toThrow(/unterminated triple-quoted string/)
  })

  test("unclosed '(' at end of file is an error", () => {
    expect(() => lex('x = (1,', 't.drw')).toThrow(/unclosed/)
  })

  test('dedent to an indentation level that was never pushed is an error', () => {
    expect(() => lex('draw d 4x4:\n    bg k\n  px k 0:0\n', 't.drw')).toThrow(/dedent/)
  })

  test('unexpected character is a syntax error', () => {
    expect(() => lex('x = $1\n', 't.drw')).toThrow(/unexpected character/)
  })

  test('mid-line "#" is a comment when not a valid color literal', () => {
    const toks = lex('bg k # not a color\n', 't.drw')
    expect(toks.filter((t) => t.kind === 'name').map((t) => t.text)).toEqual(['bg', 'k'])
    expect(toks.some((t) => t.kind === 'color')).toBe(false)
  })

  test('color literals accept 4/8 hex digits too, and reject a trailing name char', () => {
    const rgba = lex('c = #1a2b', 't.drw')
    expect(rgba.find((t) => t.kind === 'color')?.text).toBe('#1a2b')
    const rgba8 = lex('c = #1a2b3c4d', 't.drw')
    expect(rgba8.find((t) => t.kind === 'color')?.text).toBe('#1a2b3c4d')
    // "#fffg" isn't a clean color-token boundary (trailing name char) — falls back to a comment
    const notColor = lex('c = #fffg', 't.drw')
    expect(notColor.some((t) => t.kind === 'color')).toBe(false)
    expect(notColor.filter((t) => t.kind === 'name').map((t) => t.text)).toEqual(['c'])
  })

  test('float literal with a percent suffix', () => {
    const toks = lex('x = 12.5%\n', 't.drw')
    const p = toks.find((t) => t.kind === 'percent')
    expect(p?.text).toBe('12.5%')
    expect(p?.num).toBeCloseTo(0.125)
  })

  test('digit x digit followed by a name char is not a size token', () => {
    const toks = lex('n = 4x4a\n', 't.drw')
    expect(toks.some((t) => t.kind === 'size')).toBe(false)
    expect(toks[2]?.kind).toBe('int')
    expect(toks[2]?.text).toBe('4')
    expect(toks[3]?.kind).toBe('name')
    expect(toks[3]?.text).toBe('x4a')
  })

  test('tab in a pixel row indentation is an error', () => {
    expect(() => lex('pixels:\n  .r.\n\trrr\n', 't.drw')).toThrow(/tab/)
  })

  test('pixels block ends when a line no longer qualifies (not just at EOF)', () => {
    const toks = lex('pixels:\n  .r.\ndraw x 1x1:\n', 't.drw')
    const rows = toks.filter((t) => t.kind === 'pixelrow').map((t) => t.text)
    expect(rows).toEqual(['.r.'])
    expect(toks.some((t) => t.kind === 'name' && t.text === 'draw')).toBe(true)
  })
})
