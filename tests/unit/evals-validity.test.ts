// ADR-0100 §5: `evals/**` (the model-comparison corpus) is gated for VALIDITY, not craft — a weak
// cell there is the measurement, not a bug (unlike examples-critique.test.ts's craft gate on
// `examples/**`, this file asserts no `critique` thresholds whatsoever). It only checks that every
// recipe still parses, is `check`-clean, and renders every export at the exact size its own `draw
// NAME WxH:` line declares — catching corpus rot against a future language change without ever
// pressuring the results themselves. Files are discovered by globbing `evals/**/*.drw` (mirrors
// examples-critique.test.ts's `drwFiles()`), so a future cell is covered automatically. Driven
// in-process via `main()` from src/cli.js (mirrors examples-critique.test.ts's stdout-capturing
// `c009Count`/`critiqueStrict` helpers), plus a direct `Engine.loadEntry` for the declared-size
// oracle, exactly as that same file mixes `main()` and `Engine` for its own assertions.
//
// Recipes under `evals/` are frozen once rendered (ADR-0100 §1, BRIEFS.md). If one of these
// assertions ever fails, that is a real regression to report — never a recipe to edit.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli.js'
import { Engine } from '../../src/eval.js'
import { decodePng } from '../../src/png.js'

const EVALS = join(process.cwd(), 'evals')

const drwFiles = (): string[] =>
  readdirSync(EVALS, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.drw'))
    .map((f) => join(EVALS, f))
    .sort()

/** The path shown in test names, relative to `evals/` for readability. */
const labelOf = (file: string): string => file.replace(/\\/g, '/').split('/evals/')[1] ?? file

/**
 * Runs `main(argv)` with stdout captured (binary-safe) and parsed as JSON; mirrors
 * examples-critique.test.ts's `c009Count` capture helper.
 */
const runJson = (...argv: string[]): { readonly exitCode: number; readonly json: unknown } => {
  const chunks: Buffer[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    const exitCode = main(argv)
    return { exitCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } finally {
    process.stdout.write = original
  }
}

describe('evals corpus validity gate (ADR-0100 §5 — not a craft gate)', () => {
  const files = drwFiles()

  test('the corpus is non-empty (the gate actually runs)', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    const label = labelOf(file)

    test(`${label} parses`, () => {
      expect(() => new Engine(process.cwd()).loadEntry(file)).not.toThrow()
    })

    test(`${label} is check-clean`, () => {
      const { exitCode, json } = runJson('check', file, '--json')
      expect(json).toEqual([])
      expect(exitCode).toBe(0)
    })

    test(`${label} renders every export at its declared size`, () => {
      const engine = new Engine(process.cwd())
      const mod = engine.loadEntry(file)
      expect(mod.exports.length).toBeGreaterThan(0)
      const out = mkdtempSync(join(tmpdir(), 'drawstic-evals-'))
      try {
        for (const ex of mod.exports) {
          const entry = mod.definitions.get(ex.name)
          const size =
            (entry?.kind === 'draw' ? entry.definition.size : undefined) ??
            mod.sizeDefault ??
            mod.fileTheme?.size
          expect(size).toBeDefined()
          if (!size) {
            continue
          }
          const outPath = join(out, `${ex.name}.png`)
          const { exitCode, json } = runJson(
            'render',
            `${file}#${ex.name}`,
            '--out',
            outPath,
            '--json',
          )
          expect(exitCode).toBe(0)
          const render = (json as { readonly render: { width: number; height: number } }).render
          expect(render.width).toBe(size.width)
          expect(render.height).toBe(size.height)
          const decoded = decodePng(new Uint8Array(readFileSync(outPath)))
          expect(decoded.w).toBe(size.width)
          expect(decoded.h).toBe(size.height)
        }
      } finally {
        rmSync(out, { recursive: true, force: true })
      }
    })
  }
})
