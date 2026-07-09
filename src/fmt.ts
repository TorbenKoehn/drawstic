// `drawstic fmt` (ADR-0031): the canonical formatter. Normalizes indentation
// to 2 spaces per level, strips trailing whitespace, collapses repeated blank
// lines, and guarantees a trailing newline. Idempotent by construction;
// comments and everything else are preserved.

/**
 * Line-based, not a full reparse: indentation depth is inferred from the
 * original indent strings' structural nesting (not just their width), so
 * mixed indent widths still normalize consistently. A line ending inside
 * unbalanced parens is a wrapped call continuation and is preserved as-is
 * (right-trimmed only), not re-indented.
 */
export const format = (source: string): string => {
  const lines = source.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  const out: string[] = []
  // indentation stack of original indents → depth
  const stack: string[] = ['']
  let blank = 0
  let parenDepth = 0

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
    out.push('  '.repeat(depth) + content)
    parenDepth = countParens(content)
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
