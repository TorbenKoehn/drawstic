// Guards docs/impl-progress.md "4-finding: kein Skill↔CLI-Konsistenz-Test": the CLI
// verbs/flags the product skill (skills/drawstic/SKILL.md + reference.md) documents must
// actually exist in src/cli.ts, and — the other direction — every verb src/cli.ts
// dispatches must be documented somewhere in the skill, so adding a subcommand without
// updating the skill also fails. Deliberately loose (source substring / light regex over
// the HELP block and the `main()` switch, not an AST diff or exact-prose match) so a pure
// wording/formatting pass on either side never breaks it — only an actual verb or flag
// disappearing from one side while remaining on the other does.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (path: string): string => readFileSync(resolve(path), 'utf8')

const cliSource = read('src/cli.ts')
const docs = `${read('skills/drawstic/SKILL.md')}\n${read('skills/drawstic/reference.md')}`

// Isolate the two places a verb can legitimately be "wired": the `main()` dispatch switch
// and the `HELP` usage block — matches the task's own "im HELP-Text ODER im
// Dispatch/Arg-Parsing" acceptance criterion instead of requiring both.
const dispatchBlock = cliSource.slice(cliSource.indexOf('export const main'))
const helpBlock = cliSource.match(/const HELP = `([\s\S]*?)`\n/)?.[1] ?? ''

/** The CLI verbs the product skill documents (docs/impl-progress.md "4-finding"'s minimum list). */
const DOCUMENTED_VERBS = [
  'check',
  'fmt',
  'context',
  'render',
  'critique',
  'sheet',
  'build',
] as const

/** The newer flags a skill/CLI drift would most plausibly silently break. */
const DOCUMENTED_FLAGS = [
  '--explain',
  '--silhouette',
  '--as',
  '--strict',
  '--family',
  '--json',
] as const

/** A verb is "wired" if it's an actual `main()` dispatch case or appears in the HELP usage block. */
const isWiredInCli = (verb: string): boolean =>
  new RegExp(`case '${verb}':`).test(dispatchBlock) ||
  new RegExp(`drawstic ${verb}\\b`).test(helpBlock)

/** A verb is "documented" if `drawstic <verb>` appears anywhere in SKILL.md/reference.md. */
const isDocumented = (verb: string): boolean => new RegExp(`drawstic ${verb}\\b`).test(docs)

describe('skill/CLI sync (docs/impl-progress.md 4-finding)', () => {
  for (const verb of DOCUMENTED_VERBS) {
    test(`documented verb "${verb}" is wired in src/cli.ts`, () => {
      expect(isWiredInCli(verb)).toBe(true)
    })
  }

  for (const flag of DOCUMENTED_FLAGS) {
    test(`documented flag "${flag}" is recognized in src/cli.ts`, () => {
      // flags are specific enough tokens (leading `--`) that a plain substring search is
      // safe and covers both wiring spots: `parseArguments`'s `a === '${flag}'` checks and
      // the HELP usage block.
      expect(cliSource.includes(flag)).toBe(true)
    })

    test(`documented flag "${flag}" is still documented in SKILL.md or reference.md`, () => {
      expect(docs.includes(flag)).toBe(true)
    })
  }

  test('every verb src/cli.ts actually dispatches is documented in SKILL.md or reference.md', () => {
    const dispatched = [...dispatchBlock.matchAll(/case '(\w+)':/g)].map((m) => m[1] ?? '')
    // sanity: the extraction itself must find the known verbs, else this test would pass
    // vacuously on a broken regex/refactor of `main()`.
    expect(dispatched.length).toBeGreaterThanOrEqual(DOCUMENTED_VERBS.length)
    for (const verb of dispatched) {
      expect(isDocumented(verb)).toBe(true)
    }
  })
})
