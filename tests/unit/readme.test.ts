// Keeps README.md's Recipe examples honest (docs/release-1.0/readme-plan.md D6): nothing shown to a
// human or an agent reading the README may be invented. Two kinds of fenced ```drw block, each with
// its own proof:
//
//   - a plain block is a COMPLETE recipe and must be `check`-clean (run in-process via `main()`);
//   - a block preceded by `<!-- excerpt-of: PATH -->` is an EXCERPT, which cannot stand alone, so
//     instead every one of its lines must appear verbatim in PATH.
//
// The excerpt rule is the stronger claim of the two: it proves the snippet is real, committed code
// rather than merely well-formed. A README edit that drifts from the corpus fails CI instead of
// rotting silently.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli.js'

const README_PATH = 'README.md'

type Block = { readonly body: string; readonly excerptOf: string | null }

/**
 * Every fenced ` ```drw ` block in document order, each tagged with the source file named by an
 * immediately preceding `<!-- excerpt-of: PATH -->` comment (blank lines between are allowed).
 */
const extractDrwBlocks = (markdown: string): Block[] =>
  [...markdown.matchAll(/(?:<!--\s*excerpt-of:\s*(\S+)\s*-->\s*)?```drw\n([\s\S]*?)```/g)].map(
    (m) => ({ body: m[2] ?? '', excerptOf: m[1] ?? null }),
  )

/** Runs `drawstic check <file> --json` in-process and returns the parsed diagnostics array. */
const checkDiagnostics = (file: string): unknown[] => {
  const chunks: Buffer[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    main(['check', file, '--json'])
  } finally {
    process.stdout.write = original
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

describe('README.md recipe examples', () => {
  const blocks = extractDrwBlocks(readFileSync(README_PATH, 'utf8'))
  const complete = blocks.filter((b) => b.excerptOf === null)
  const excerpts = blocks.filter((b) => b.excerptOf !== null)

  // Sanity: the README plan (D6) requires at least a quickstart recipe plus the three
  // syntax<->result blocks (A/B/C) — if this regex ever finds fewer, it broke, not the README.
  test('finds at least 4 fenced drw blocks', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(4)
  })

  test.each(
    complete.map((b, i) => [i, b.body] as const),
  )('complete block #%i is check-clean', (i, body) => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-readme-'))
    try {
      const file = join(dir, `block-${i}.drw`)
      writeFileSync(file, body, 'utf8')
      expect(checkDiagnostics(file)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test.each(
    excerpts.map((b) => [b.excerptOf ?? '', b.body] as const),
  )('excerpt of %s is verbatim', (source, body) => {
    // Indentation is semantic in this DSL, so lines must match including leading whitespace.
    const sourceLines = new Set(
      readFileSync(source, 'utf8')
        .split('\n')
        .map((l) => l.trimEnd()),
    )
    const missing = body
      .split('\n')
      .map((l) => l.trimEnd())
      .filter((l) => l !== '' && !sourceLines.has(l))
    expect(missing).toEqual([])
  })
})
