// Keeps README.md's Recipe examples honest (docs/release-1.0/readme-plan.md D6): every fenced
// ```drw code block shown to a human/agent reading the README must actually be a complete,
// `check`-clean recipe — never invented, never abbreviated past parsing. Extracts each block and
// runs it through `check --json` in-process (via `main()`, no subprocess spawn) so a future README
// edit that breaks a recipe fails CI instead of rotting silently.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli.js'

const README_PATH = 'README.md'

/** Every fenced ` ```drw ` block's body, in document order. */
const extractDrwBlocks = (markdown: string): string[] =>
  [...markdown.matchAll(/```drw\n([\s\S]*?)```/g)].map((m) => m[1] ?? '')

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

  // Sanity: the README plan (D6) requires at least a quickstart recipe plus the three
  // syntax<->result blocks (A/B/C) — if this regex ever finds fewer, it broke, not the README.
  test('finds at least 4 fenced drw blocks', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(4)
  })

  test.each(blocks.map((body, i) => [i, body] as const))('block #%i is check-clean', (i, body) => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-readme-'))
    try {
      const file = join(dir, `block-${i}.drw`)
      writeFileSync(file, body, 'utf8')
      expect(checkDiagnostics(file)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
