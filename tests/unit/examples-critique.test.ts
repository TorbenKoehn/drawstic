// CI regression gate (ADR-0085 §5, phase 1c): every bundled example must pass
// `drawstic critique --strict` (exit 0) under its natural category profile. The
// must-fix subset (C001 empty, C007 character seam, + C003 icon centering) is
// calibrated to the corpus's measured craft floor, so a red here means a real
// structural regression in an example — not threshold noise. Runs in-process
// (no per-file process spawn) so it stays fast enough for the unit run.

import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { main } from '../../src/cli.js'

const EXAMPLES = join(process.cwd(), 'examples')

/** The `--as` category an example belongs to, from its path; `null` = agnostic (no profile). */
const categoryOf = (file: string): string | null => {
  const p = file.replace(/\\/g, '/')
  if (p.includes('/icons/')) {
    return 'icon'
  }
  if (p.includes('/characters/')) {
    return 'character'
  }
  if (p.includes('/items/') || p.includes('/items-v2/')) {
    return 'item'
  }
  if (p.includes('/scenes')) {
    return 'scene'
  }
  return null
}

const drwFiles = (): string[] =>
  readdirSync(EXAMPLES, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.drw'))
    .map((f) => join(EXAMPLES, f))
    .sort()

/** Runs `critique --strict` on one file with stdout muted; returns the process exit code. */
const critiqueStrict = (file: string): number => {
  const cat = categoryOf(file)
  const argv = ['critique', file, ...(cat ? ['--as', cat] : []), '--strict', '--json']
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (() => true) as typeof process.stdout.write
  try {
    return main(argv)
  } finally {
    process.stdout.write = original
  }
}

describe('examples pass `critique --strict` (CI regression gate)', () => {
  const files = drwFiles()

  test('the example corpus is non-empty (the gate actually runs)', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  test('every example exits 0 under its category profile', () => {
    const failures = files.filter((f) => critiqueStrict(f) !== 0)
    expect(failures).toEqual([])
  })
})
