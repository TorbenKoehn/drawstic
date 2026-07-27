// `drawstic fmt` (ADR-0031): the canonical formatter. Normalizes indentation
// to 2 spaces per level, strips trailing whitespace, collapses repeated blank
// lines, and guarantees a trailing newline. Idempotent by construction;
// comments and everything else are preserved.

/**
 * Canonical `export` block header (ADR-0098 §8): targets separated by `", "` — comma, exactly one
 * space — with any other spacing (`a ,b`, `a,  b`, `a,b`) collapsed. Target order, a trailing
 * comment, and everything after the `:` are left alone, and a line that doesn't match the header
 * shape (a binding called `export`, a header still being typed) is returned untouched. Idempotent
 * by construction: its own output is already canonical.
 */
const normalizeExportHeader = (content: string): string => {
  if (!content.startsWith('export ')) {
    return content
  }
  // An export path carries neither ':' nor '#', so the first ':' outside a comment ends the list.
  const m = /^export\s+([^:#]*?)\s*:(.*)$/.exec(content)
  if (!m) {
    return content
  }
  const targets = (m[1] ?? '')
    .split(',')
    .map((t) => t.trim().replace(/\s+/g, ' '))
    .join(', ')
  return `export ${targets}:${m[2] ?? ''}`
}

/**
 * Scans one physical line for a triple-quoted string's open/close boundary, starting from
 * `startInside`, and returns whether an unterminated `"""` is still open at end-of-line. Mirrors
 * the lexer (`src/lexer.ts`): a triple-quoted string processes no escapes, so the very next literal
 * `"""` always closes it; single-quoted strings and `#` comments/color literals are skipped with
 * the same lightweight rules {@link normalizeExportHeader}'s caller uses for paren-depth, just
 * enough to not mistake a quote inside one of those for the triple-quote delimiter.
 */
const scansIntoTripleQuote = (line: string, startInside: boolean): boolean => {
  let inside = startInside
  let i = 0
  while (i < line.length) {
    if (inside) {
      const close = line.indexOf('"""', i)
      if (close === -1) {
        return true
      }
      inside = false
      i = close + 3
      continue
    }
    const c = line[i]
    if (c === '#') {
      const m = /^#[0-9a-fA-F]{3,8}/.exec(line.slice(i))
      if (m && [3, 4, 6, 8].includes(m[0].length - 1)) {
        i += m[0].length
        continue
      }
      return false // comment: rest of line is not code
    }
    if (line.startsWith('"""', i)) {
      inside = true
      i += 3
      continue
    }
    if (c === '"') {
      // single-quoted string: skip to its closing quote, honoring backslash escapes
      let j = i + 1
      while (j < line.length && line[j] !== '"') {
        j += line[j] === '\\' ? 2 : 1
      }
      i = j + 1
      continue
    }
    i++
  }
  return inside
}

/**
 * Line-based, not a full reparse: indentation depth is inferred from the
 * original indent strings' structural nesting (not just their width), so
 * mixed indent widths still normalize consistently. A line ending inside
 * unbalanced parens is a wrapped call continuation and is preserved as-is
 * (right-trimmed only), not re-indented. A line inside an open triple-quoted
 * string (ADR-0098 §8 — `fmt` never touches string contents) is preserved the
 * same way: its own indentation is part of the string's value, not structure,
 * so it is never re-indented and never reaches {@link normalizeExportHeader}.
 */
export const format = (source: string): string => {
  const lines = source.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  const out: string[] = []
  // indentation stack of original indents → depth
  const stack: string[] = ['']
  let blank = 0
  let parenDepth = 0
  let inTripleString = false

  const countParens = (line: string): number => {
    let d = 0
    let inStr = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inStr) {
        if (c === '"') {
          inStr = false
        }
        continue
      }
      if (c === '"') {
        inStr = true
        continue
      }
      if (c === '#') {
        // color literal or comment — a comment ends the line
        const m = /^#[0-9a-fA-F]{3,8}/.exec(line.slice(i))
        if (m && [3, 4, 6, 8].includes(m[0].length - 1)) {
          i += m[0].length - 1
          continue
        }
        break
      }
      if (c === '(') {
        d++
      }
      if (c === ')') {
        d--
      }
    }
    return d
  }

  for (const raw of lines) {
    const trimmed = raw.replace(/[ \t]+$/, '')
    if (inTripleString) {
      // Still inside (or closing) a triple-quoted string: never touched, not even re-indented —
      // leading whitespace up to a closing '"""' is part of the string's own value.
      out.push(trimmed)
      inTripleString = scansIntoTripleQuote(raw, true)
      blank = 0
      continue
    }
    const content = trimmed.replace(/^[ \t]*/, '')
    if (content === '') {
      blank++
      if (blank <= 1 && out.length > 0) {
        out.push('')
      }
      continue
    }
    blank = 0
    if (parenDepth > 0) {
      // continuation of a wrapped logical line: keep as-is (right-trimmed)
      out.push(trimmed)
      parenDepth += countParens(content)
      inTripleString = scansIntoTripleQuote(raw, false)
      continue
    }
    const indent = trimmed.slice(0, trimmed.length - content.length).replace(/\t/g, '  ')
    // derive the depth from the original indent structure
    while (stack.length > 1 && indent.length <= (stack.at(-1) as string).length) {
      if (indent === stack.at(-1)) {
        break
      }
      stack.pop()
    }
    if (indent.length > (stack.at(-1) as string).length) {
      stack.push(indent)
    }
    const depth = stack.includes(indent) ? stack.indexOf(indent) : stack.length - 1
    // Only reached with parenDepth === 0 and outside any triple-quoted string, so this never
    // rewrites the inside of a wrapped logical line or a string body.
    const canonical = normalizeExportHeader(content)
    out.push('  '.repeat(depth) + canonical)
    parenDepth = countParens(canonical)
    inTripleString = scansIntoTripleQuote(raw, false)
  }
  // drop trailing blank lines, ensure exactly one trailing newline
  while (out.length > 0 && out.at(-1) === '') {
    out.pop()
  }
  return `${out.join('\n')}\n`
}

/**
 * A format-diff summary: `firstChangedLine` is 1-based and `null` when already canonical;
 * `unifiedDiff` is only present when requested (`--diff`).
 */
export type FormatDiff = {
  readonly firstChangedLine: number | null
  readonly changedLineCount: number
  readonly unifiedDiff?: string
}

/**
 * Compares `source` against its formatted output line-by-line; backs
 * `fmt --check`'s diagnostic position and `--diff`'s report.
 */
export const formatDiff = (
  source: string,
  formatted: string,
  includeUnified = false,
): FormatDiff => {
  const before = source.split('\n')
  const after = formatted.split('\n')
  const max = Math.max(before.length, after.length)
  let firstChangedLine: number | null = null
  let changedLineCount = 0
  for (let i = 0; i < max; i++) {
    if ((before[i] ?? '') !== (after[i] ?? '')) {
      firstChangedLine ??= i + 1
      changedLineCount++
    }
  }
  return {
    firstChangedLine,
    changedLineCount,
    ...(includeUnified ? { unifiedDiff: unifiedDiff(before, after) } : {}),
  }
}

/**
 * Minimal per-line diff (no context lines, no move detection) — enough to
 * show `fmt --diff` what changed, not a general-purpose LCS diff.
 */
const unifiedDiff = (before: readonly string[], after: readonly string[]): string => {
  const lines = ['--- source', '+++ formatted']
  const max = Math.max(before.length, after.length)
  for (let i = 0; i < max; i++) {
    const a = before[i]
    const b = after[i]
    if ((a ?? '') === (b ?? '')) {
      continue
    }
    lines.push(`@@ -${i + 1} +${i + 1} @@`)
    if (a !== undefined) {
      lines.push(`-${a}`)
    }
    if (b !== undefined) {
      lines.push(`+${b}`)
    }
  }
  return `${lines.join('\n')}\n`
}
