// CLI front-door ergonomics: the two things a first-time user types (`--help`, `--version`) and the
// one thing a typo produces (an unrecognized flag). All three used to fail silently or wrongly:
// `--help` exited 1, there was no `--version`, and an unknown flag was swallowed so a typo read as
// "the flag had no effect".

import { describe, expect, test } from 'bun:test'
import { main } from '../../src/cli.js'

/** Runs `main(argv)` with stdout/stderr captured; returns the exit code and both streams. */
const run = (argv: string[]): { code: number; out: string; err: string } => {
  let out = ''
  let err = ''
  const originalOut = process.stdout.write.bind(process.stdout)
  const originalErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = ((chunk: string) => {
    out += chunk
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: string) => {
    err += chunk
    return true
  }) as typeof process.stderr.write
  try {
    return { code: main(argv), out, err }
  } finally {
    process.stdout.write = originalOut
    process.stderr.write = originalErr
  }
}

describe('help and version', () => {
  for (const argv of [[], ['help'], ['--help'], ['-h']]) {
    test(`\`drawstic ${argv.join(' ') || '(no args)'}\` prints usage and exits 0`, () => {
      const { code, out } = run(argv)
      expect(code).toBe(0)
      expect(out).toContain('drawstic — deterministic drawing engine')
      expect(out).toContain('usage:')
    })
  }

  test('`--help` after a subcommand asks for help, not for a render of a file named --help', () => {
    const { code, out } = run(['render', '--help'])
    expect(code).toBe(0)
    expect(out).toContain('usage:')
  })

  for (const argv of [['version'], ['--version'], ['-v']]) {
    test(`\`drawstic ${argv.join(' ')}\` prints the package version and exits 0`, () => {
      const { code, out } = run(argv)
      expect(code).toBe(0)
      expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/)
    })
  }
})

describe('unknown flags (E026)', () => {
  test('a mistyped flag is an error, not a silent no-op', () => {
    const { code, err } = run(['check', 'examples/icons/games.drw', '--pgn@4'])
    expect(code).toBe(1)
    expect(err).toContain('E026')
    expect(err).toContain("unknown flag '--pgn@4'")
  })

  test('every unknown flag is reported, in --json too', () => {
    const { code, out } = run([
      'check',
      'examples/icons/games.drw',
      '--strickt',
      '--famly',
      '--json',
    ])
    expect(code).toBe(1)
    const diags = JSON.parse(out) as { code: string; message: string }[]
    expect(diags.map((d) => d.code)).toEqual(['E026', 'E026'])
    expect(diags.map((d) => d.message)).toEqual([
      "unknown flag '--strickt'",
      "unknown flag '--famly'",
    ])
  })

  test('a recognized flag set still runs the command', () => {
    const { code } = run(['check', 'examples/icons/games.drw', '--lint', '--json'])
    expect(code).toBe(0)
  })
})
