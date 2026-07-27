// Lexer (spec §3, §17.1–17.2, ADR-0032). Line-oriented; emits NL / INDENT /
// DEDENT layout tokens; logical lines continue while a "(" is unclosed;
// pixels: blocks switch to raw pixel-row mode.

import { ERROR_CODE, error } from './diagnostic.js'

/**
 * Token kinds emitted by the lexer. 'pixelrow' is emitted only inside a
 * `pixels:` block (spec §7, ADR-0032 §3); 'indent'/'dedent'/'nl' are the
 * resolved layout tokens the parser relies on instead of raw whitespace.
 */
export type TokKind =
  | 'name'
  | 'int'
  | 'float'
  | 'percent'
  | 'color'
  | 'string'
  | 'size'
  | 'pixelrow'
  | 'op'
  | 'nl'
  | 'indent'
  | 'dedent'
  | 'eof'

export type Token = {
  kind: TokKind
  text: string
  /** Numeric payload: int/float/percent value; size → w (use sizeH for h). */
  num: number
  sizeH: number
  /** String payload (string literals: unquoted content). */
  str: string
  /**
   * String literals only: the exact source between the quotes, **before** escape processing
   * (ADR-0098 §2). The `file` name-template compiler reads this so it can tell an escaped `\{`
   * from a template hole's `{`; every other string consumer reads {@link str}.
   */
  raw: string
  line: number
  col: number
  endLine: number
  endCol: number
  /** Whitespace (or line start) precedes this token — D2 boundary info. */
  spaced: boolean
  /** This ":" is the last token of its logical line — opens a block (D1). */
  blockColon: boolean
}

const isLetter = (c: string): boolean => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
const isDigit = (c: string): boolean => c >= '0' && c <= '9'
const isHex = (c: string): boolean => isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
const isNameChar = (c: string): boolean => isLetter(c) || isDigit(c) || c === '_'

const MULTI_OPS = ['..=', '..', '//', '+=', '-=', '*=', '/=', '==', '!=', '>=', '<=']
const SINGLE_OPS = new Set([
  '=',
  '+',
  '-',
  '*',
  '/',
  ':',
  ',',
  '.',
  '!',
  '&',
  '|',
  '(',
  ')',
  '[',
  ']',
  '>',
  '<',
  '@',
])

/**
 * Tokenize Recipe source into a flat, layout-resolved token stream
 * (spec §17.1–17.2, ADR-0032): indentation, line continuation while a `(`
 * is unclosed, and `pixels:` grid rows are all settled here so the parser
 * (src/parser.ts) never re-derives them. Throws DrawsticError
 * (ERROR_CODE.syntax / .indent) on the first lexical error — there is no
 * error recovery, so callers should catch and report rather than expect a
 * diagnostics array back.
 *
 * @param file - not read; only attributed to positions in thrown errors.
 */
export const lex = (source: string, file: string): Token[] => {
  const tokens: Token[] = []
  // A leading U+FEFF BOM is skipped (error-robustness, ADR-0032): Windows
  // editors and shells routinely prepend it to UTF-8 files.
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  const indentStack: string[] = ['']
  let pixelMode = false // inside a pixels: block
  let pixelIndent = '' // indent prefix a row must exceed to still belong to the block

  const push = (t: Partial<Token> & Pick<Token, 'kind' | 'text' | 'line' | 'col'>): Token => {
    const tok: Token = {
      num: 0,
      sizeH: 0,
      str: '',
      raw: '',
      endLine: t.line,
      endCol: t.col + t.text.length,
      spaced: false,
      blockColon: false,
      ...t,
    }
    tokens.push(tok)
    return tok
  }

  let li = 0
  while (li < lines.length) {
    const raw = lines[li] ?? ''
    // indentation
    let ind = 0
    while (ind < raw.length && (raw[ind] === ' ' || raw[ind] === '\t')) {
      if (raw[ind] === '\t') {
        throw error(ERROR_CODE.indent, 'tab in indentation', file, {
          line: li + 1,
          column: ind + 1,
        })
      }
      ind++
    }
    const indent = raw.slice(0, ind)
    const rest = raw.slice(ind)
    // blank and comment-only lines emit nothing (a "#"+space or word comment;
    // a bare color like "#fff" alone still counts as content is nonsensical —
    // treat any line whose content starts with "#" not followed by a valid
    // color-literal-in-statement as comment; at line start "#" is a comment)
    if (rest === '' || rest.startsWith('#')) {
      li++
      continue
    }

    // INDENT / DEDENT
    const top = indentStack.at(-1) ?? ''
    if (indent.length > top.length) {
      // Indentation is a pure run of spaces (tabs already threw above), so a
      // longer indent always has the shorter `top` as a prefix — the
      // inconsistent-indent case can only arise on a dedent (handled below).
      indentStack.push(indent)
      push({ kind: 'indent', text: indent, line: li + 1, col: 1 })
    } else if (indent.length < top.length) {
      while (indentStack.length > 1 && (indentStack.at(-1) ?? '').length > indent.length) {
        indentStack.pop()
        push({ kind: 'dedent', text: '', line: li + 1, col: 1 })
      }
      if ((indentStack.at(-1) ?? '') !== indent) {
        throw error(ERROR_CODE.indent, 'dedent does not match any outer indentation level', file, {
          line: li + 1,
          column: 1,
        })
      }
    } else if (indent !== top) {
      throw error(ERROR_CODE.indent, 'inconsistent indentation', file, { line: li + 1, column: 1 })
    }

    // tokenize one logical line (may span physical lines while "(" unclosed)
    const lineStart = tokens.length
    let parenDepth = 0
    let spaced = true // line start counts as a boundary
    let cl = li // current physical line index
    let text = raw
    let i = ind
    let prevWasDot = false

    const cur = (): string => text[i] ?? ''
    const at = (k: number): string => text[i + k] ?? ''

    for (;;) {
      if (i >= text.length) {
        if (parenDepth > 0) {
          // logical line continues on the next physical line
          cl++
          if (cl >= lines.length) {
            throw error(ERROR_CODE.syntax, "unclosed '(' at end of file", file, {
              line: li + 1,
              column: ind + 1,
            })
          }
          text = lines[cl] ?? ''
          i = 0
          spaced = true
          continue
        }
        break
      }
      const c = cur()
      if (c === ' ' || c === '\t') {
        spaced = true
        i++
        continue
      }
      if (c === '#') {
        // color literal or comment: color = # + 3/4/6/8 hex digits at a
        // token boundary; anything else is a comment to end of line
        let j = i + 1
        while (j < text.length && isHex(text[j] ?? '')) {
          j++
        }
        const n = j - i - 1
        const after = text[j] ?? ''
        if ((n === 3 || n === 4 || n === 6 || n === 8) && !isNameChar(after)) {
          push({
            kind: 'color',
            text: text.slice(i, j),
            line: cl + 1,
            col: i + 1,
            spaced,
          })
          spaced = false
          i = j
          prevWasDot = false
          continue
        }
        // comment: ends the physical line
        i = text.length
        continue
      }
      if (c === '"') {
        const startCol = i + 1
        if (at(1) === '"' && at(2) === '"') {
          // triple-quoted string, may span lines
          let buf = ''
          let sl = cl
          let j = i + 3
          let t = text
          for (;;) {
            if (j + 2 < t.length + 1 && t.slice(j, j + 3) === '"""') {
              break
            }
            if (j >= t.length) {
              sl++
              if (sl >= lines.length) {
                throw error(ERROR_CODE.syntax, 'unterminated triple-quoted string', file, {
                  line: cl + 1,
                  column: startCol,
                })
              }
              buf += '\n'
              t = lines[sl] ?? ''
              j = 0
              continue
            }
            buf += t[j]
            j++
          }
          push({
            kind: 'string',
            text: `"""${buf}"""`,
            str: buf,
            // A triple-quoted string processes no escapes, so its inner text is already verbatim.
            raw: buf,
            line: cl + 1,
            col: startCol,
            endLine: sl + 1,
            endCol: j + 4,
            spaced,
          })
          cl = sl
          text = t
          i = j + 3
          spaced = false
          prevWasDot = false
          continue
        }
        let j = i + 1
        let buf = ''
        while (j < text.length && text[j] !== '"') {
          if (text[j] === '\\') {
            const next = text[j + 1]
            switch (next) {
              case '"':
              case '\\':
              // `\{`/`\}` (ADR-0098 §2) escape a literal brace in every string, not only in a
              // `file` template — a strict widening of an escape set that rejected them outright,
              // so no existing source changes meaning.
              case '{':
              case '}':
                buf += next
                j += 2
                continue
              case 'n':
                buf += '\n'
                j += 2
                continue
              case 'r':
                buf += '\r'
                j += 2
                continue
              case 't':
                buf += '\t'
                j += 2
                continue
              default:
                throw error(ERROR_CODE.syntax, 'unknown string escape', file, {
                  line: cl + 1,
                  column: j + 1,
                })
            }
          }
          buf += text[j]
          j++
        }
        if (j >= text.length) {
          throw error(ERROR_CODE.syntax, 'unterminated string', file, {
            line: cl + 1,
            column: startCol,
          })
        }
        push({
          kind: 'string',
          text: `"${buf}"`,
          str: buf,
          raw: text.slice(i + 1, j),
          line: cl + 1,
          col: startCol,
          spaced,
        })
        i = j + 1
        spaced = false
        prevWasDot = false
        continue
      }
      if (isDigit(c)) {
        let j = i
        while (j < text.length && isDigit(text[j] ?? '')) {
          j++
        }
        // D8: directly after "." a numeric token is always INT
        if (!prevWasDot) {
          // FLOAT
          if (text[j] === '.' && isDigit(text[j + 1] ?? '')) {
            let k = j + 1
            while (k < text.length && isDigit(text[k] ?? '')) {
              k++
            }
            const t = text.slice(i, k)
            if (text[k] === '%') {
              push({
                kind: 'percent',
                text: `${t}%`,
                num: Number.parseFloat(t) / 100,
                line: cl + 1,
                col: i + 1,
                spaced,
              })
              i = k + 1
            } else {
              push({
                kind: 'float',
                text: t,
                num: Number.parseFloat(t),
                line: cl + 1,
                col: i + 1,
                spaced,
              })
              i = k
            }
            spaced = false
            prevWasDot = false
            continue
          }
          // SIZE: INT x INT, one token, no interior whitespace (§6)
          if (text[j] === 'x' && isDigit(text[j + 1] ?? '')) {
            let k = j + 1
            while (k < text.length && isDigit(text[k] ?? '')) {
              k++
            }
            if (!isNameChar(text[k] ?? '')) {
              const wTxt = text.slice(i, j)
              const hTxt = text.slice(j + 1, k)
              push({
                kind: 'size',
                text: text.slice(i, k),
                num: Number.parseInt(wTxt, 10),
                sizeH: Number.parseInt(hTxt, 10),
                line: cl + 1,
                col: i + 1,
                spaced,
              })
              i = k
              spaced = false
              prevWasDot = false
              continue
            }
          }
        }
        const t = text.slice(i, j)
        if (text[j] === '%' && !prevWasDot) {
          push({
            kind: 'percent',
            text: `${t}%`,
            num: Number.parseInt(t, 10) / 100,
            line: cl + 1,
            col: i + 1,
            spaced,
          })
          i = j + 1
        } else {
          push({
            kind: 'int',
            text: t,
            num: Number.parseInt(t, 10),
            line: cl + 1,
            col: i + 1,
            spaced,
          })
          i = j
        }
        spaced = false
        prevWasDot = false
        continue
      }
      if (isLetter(c) || c === '_') {
        let j = i
        while (j < text.length && isNameChar(text[j] ?? '')) {
          j++
        }
        push({ kind: 'name', text: text.slice(i, j), line: cl + 1, col: i + 1, spaced })
        i = j
        spaced = false
        prevWasDot = false
        continue
      }
      // multi-char operators first
      const multi = MULTI_OPS.find((op) => text.startsWith(op, i))
      if (multi) {
        push({ kind: 'op', text: multi, line: cl + 1, col: i + 1, spaced })
        i += multi.length
        spaced = false
        prevWasDot = false
        continue
      }
      if (SINGLE_OPS.has(c)) {
        if (c === '(') {
          parenDepth++
        }
        if (c === ')') {
          parenDepth = Math.max(0, parenDepth - 1)
        }
        push({ kind: 'op', text: c, line: cl + 1, col: i + 1, spaced })
        i++
        spaced = false
        prevWasDot = c === '.'
        continue
      }
      throw error(ERROR_CODE.syntax, `unexpected character '${c}'`, file, {
        line: cl + 1,
        column: i + 1,
      })
    }

    // mark a line-final ":" as the block colon (D1)
    const last = tokens.at(-1)
    if (last?.kind === 'op' && last.text === ':' && tokens.length > lineStart) {
      last.blockColon = true
    }
    push({ kind: 'nl', text: '', line: cl + 1, col: (text.length ?? 0) + 1 })

    // pixels: block detection — logical line was exactly `pixels` `:`
    const lineToks = tokens
      .slice(lineStart)
      .filter((t) => t.kind !== 'indent' && t.kind !== 'dedent')
    if (
      lineToks.length === 3 &&
      lineToks[0]?.kind === 'name' &&
      lineToks[0].text === 'pixels' &&
      lineToks[1]?.kind === 'op' &&
      lineToks[1].text === ':' &&
      lineToks[2]?.kind === 'nl'
    ) {
      pixelMode = true
      pixelIndent = indent
      // bracket the rows in INDENT/DEDENT so the parser sees a block
      push({ kind: 'indent', text: '', line: cl + 1, col: 1 })
      // find matching dedent later: we emit rows then a dedent when leaving
    }

    li = cl + 1
    // when pixel mode ends we must emit the closing dedent — handled here:
    if (pixelMode) {
      // consume following rows now (so dedent bracketing stays local)
      while (li < lines.length) {
        const r = lines[li] ?? ''
        const rTrim = r.replace(/^[ \t]*/, '')
        const rInd = r.slice(0, r.length - rTrim.length)
        if (rTrim === '' || rTrim.startsWith('#')) {
          li++
          continue
        }
        if (rInd.includes('\t')) {
          throw error(ERROR_CODE.indent, 'tab in indentation', file, { line: li + 1, column: 1 })
        }
        if (rInd.length > pixelIndent.length && rInd.startsWith(pixelIndent)) {
          push({ kind: 'pixelrow', text: rTrim, line: li + 1, col: rInd.length + 1, spaced: true })
          push({ kind: 'nl', text: '', line: li + 1, col: r.length + 1 })
          li++
          continue
        }
        break
      }
      push({ kind: 'dedent', text: '', line: li + 1, col: 1 })
      pixelMode = false
    }
  }

  // close remaining blocks
  while (indentStack.length > 1) {
    indentStack.pop()
    push({ kind: 'dedent', text: '', line: lines.length + 1, col: 1 })
  }
  push({ kind: 'eof', text: '', line: lines.length + 1, col: 1 })
  return tokens
}
