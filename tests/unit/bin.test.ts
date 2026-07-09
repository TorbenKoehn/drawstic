// src/bin.ts is the published CLI entry: it always runs `main()` against the
// real process.argv on import (no `import.meta.main` guard), so it can't be
// imported in-process safely — exercised via a subprocess instead, the same
// pattern tests/unit/e2e.test.ts uses for its `cli()` helper.

import { describe, expect, test } from 'bun:test'

describe('bin', () => {
  test('runs as a CLI entry point and prints help', () => {
    const proc = Bun.spawnSync({
      cmd: ['bun', 'run', 'src/bin.ts', 'help'],
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(proc.exitCode).toBe(0)
    const stdout = new TextDecoder().decode(proc.stdout)
    expect(stdout).toContain('drawstic — deterministic drawing engine')
  })
})
