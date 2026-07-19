// Coverage + behavior tests for the `drawstic` CLI (src/cli.ts): every
// subcommand's flags, JSON/text output shapes, exit codes, and diagnostic
// paths, driven in-process via `main()` with stdout/stderr captured.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { main } from '../../src/cli.js'
import { decodePng } from '../../src/png.js'

type WriteFn = typeof process.stdout.write

type Captured = {
  readonly exitCode: number
  readonly stdout: Buffer
  readonly stderr: string
}

/** runs `main(argv)` in-process with stdout/stderr monkey-patched to capture
 *  every chunk (binary-safe, so PNG bytes survive intact); always restores
 *  the real streams, even if `main` throws. */
const run = (...argv: string[]): Captured => {
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  const originalStdoutWrite: WriteFn = process.stdout.write.bind(process.stdout)
  const originalStderrWrite: WriteFn = process.stderr.write.bind(process.stderr)
  const capture = (chunks: Buffer[]): WriteFn =>
    ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      return true
    }) as WriteFn
  process.stdout.write = capture(stdoutChunks)
  process.stderr.write = capture(stderrChunks)
  try {
    const exitCode = main(argv)
    return {
      exitCode,
      stdout: Buffer.concat(stdoutChunks),
      stderr: Buffer.concat(stderrChunks).toString('utf8'),
    }
  } finally {
    process.stdout.write = originalStdoutWrite
    process.stderr.write = originalStderrWrite
  }
}

const runJson = (...argv: string[]): { readonly exitCode: number; readonly json: unknown } => {
  const r = run(...argv)
  return { exitCode: r.exitCode, json: JSON.parse(r.stdout.toString('utf8')) }
}

const withTmpDir = <T>(fn: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'drawstic-cli-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('main / help', () => {
  test('no command prints help and exits 0', () => {
    const r = run()
    expect(r.exitCode).toBe(0)
    expect(r.stdout.toString('utf8')).toContain('drawstic — deterministic drawing engine')
    expect(r.stdout.toString('utf8')).toContain('drawstic render <file>#<drawing>')
  })

  test('literal help command prints help and exits 0', () => {
    const r = run('help')
    expect(r.exitCode).toBe(0)
    expect(r.stdout.toString('utf8')).toContain('usage:')
  })

  test('unknown command prints help and exits 1', () => {
    const r = run('frobnicate')
    expect(r.exitCode).toBe(1)
    expect(r.stdout.toString('utf8')).toContain('usage:')
  })
})

describe('check', () => {
  test('clean module reports no diagnostics', () => {
    const r = runJson('check', 'examples/basic-shapes/circles.drw', '--json')
    expect(r.exitCode).toBe(0)
    expect(r.json).toEqual([])
  })

  test('renders tileset and atlas members during deep validation', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'sheet.drw')
      writeFileSync(
        file,
        [
          'draw a 2x2:',
          '  pal k=#000000',
          '  pixels:',
          '    kk',
          '    kk',
          '',
          'draw b 2x2:',
          '  pal r=#ff0000',
          '  pixels:',
          '    rr',
          '    rr',
          '',
          'tileset ts 2x2:',
          '  tiles a, b',
          '  cols 2',
          '',
          'atlas at:',
          '  sprites a, b',
          '',
        ].join('\n'),
      )
      const r = runJson('check', file, '--json')
      expect(r.exitCode).toBe(0)
      expect(r.json).toEqual([])
    })
  })

  test('--lint folds in authoring warnings + a construct census without failing the exit code', () => {
    const r = runJson('check', 'examples/showcase/showcase.drw', '--json', '--lint')
    expect(r.exitCode).toBe(0)
    // --lint --json wraps the diagnostics alongside the ADR-0094 construct census.
    const body = r.json as {
      diagnostics: { severity: string; code: string; message: string }[]
      census: { constructs: { construct: string; count: number }[]; antiPatterns: object }
    }
    expect(body.diagnostics.some((d) => d.code === 'W002' && d.message.includes('face'))).toBe(true)
    expect(body.diagnostics.every((d) => d.severity === 'warning')).toBe(true)
    expect(body.census.constructs.length).toBeGreaterThan(0)
    expect(body.census.antiPatterns).toBeDefined()
  })

  test('--rows reports ragged pixel-row metadata and E002', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'ragged.drw')
      writeFileSync(file, 'draw ragged 3x2:\n  pal k=#000000\n  pixels:\n    kkk\n    kk\n')
      const r = runJson('check', file, '--json', '--rows')
      expect(r.exitCode).toBe(1)
      const body = r.json as {
        diagnostics: { code: string }[]
        rows: {
          draw: string
          expectedWidth: number
          expectedHeight: number
          actualWidths: number[]
          firstRaggedRow: { row: number; width: number; expectedWidth: number } | null
        }[]
      }
      expect(body.diagnostics[0]?.code).toBe('E002')
      expect(body.rows).toEqual([
        {
          draw: 'ragged',
          expectedWidth: 3,
          expectedHeight: 2,
          actualWidths: [3, 2],
          firstRaggedRow: { row: 2, width: 2, expectedWidth: 3 },
        },
      ])
    })
  })

  test('--rows infers size from pixel rows when the header is absent', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'headerless.drw')
      writeFileSync(file, 'draw hl:\n  pal k=#000000\n  pixels:\n    kk\n    kk\n')
      const r = runJson('check', file, '--json', '--rows')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        rows: {
          draw: string
          expectedWidth: number
          expectedHeight: number
          actualWidths: number[]
          firstRaggedRow: unknown
        }[]
      }
      expect(body.rows).toEqual([
        {
          draw: 'hl',
          expectedWidth: 2,
          expectedHeight: 2,
          actualWidths: [2, 2],
          firstRaggedRow: null,
        },
      ])
    })
  })

  test('--rows without --json reports diagnostics to stderr and prints nothing to stdout', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'ragged.drw')
      writeFileSync(file, 'draw ragged 3x2:\n  pal k=#000000\n  pixels:\n    kkk\n    kk\n')
      const r = run('check', file, '--rows')
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toHaveLength(0)
      expect(r.stderr).toContain('E002')
    })
  })

  test('dedupes identical diagnostics collected from multiple exports', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'dedupe.drw')
      writeFileSync(
        file,
        'draw broken 1x1:\n  bg missing\n\nexport broken out/a:\n  png\nexport broken out/b:\n  png\n',
      )
      const r = runJson('check', file, '--json')
      expect(r.exitCode).toBe(1)
      const diags = r.json as { code: string; message: string }[]
      expect(diags).toHaveLength(1)
      expect(diags[0]).toMatchObject({ code: 'E001', message: "unknown name 'missing'" })
    })
  })

  test('missing file reports an import-error diagnostic', () => {
    const r = runJson('check', 'examples/does/not/exist.drw', '--json')
    expect(r.exitCode).toBe(1)
    const diags = r.json as { code: string }[]
    expect(diags[0]?.code).toBe('E008')
  })
})

describe('fmt', () => {
  test('--stdout prints the canonical form and leaves the file untouched', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'unformatted.drw')
      const original = 'draw a 2x2:\n    bg #fff\n'
      writeFileSync(file, original)
      const r = run('fmt', file, '--stdout')
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString('utf8')).toBe('draw a 2x2:\n  bg #fff\n')
      expect(readFileSync(file, 'utf8')).toBe(original)
    })
  })

  test('--check --json --diff reports E021 with format metadata for unformatted input', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'unformatted.drw')
      writeFileSync(file, 'draw a 2x2:\n    bg #fff\n')
      const r = runJson('fmt', file, '--check', '--json', '--diff')
      expect(r.exitCode).toBe(1)
      const body = r.json as {
        diagnostics: { code: string }[]
        format: { firstChangedLine: number; changedLineCount: number; unifiedDiff: string }
      }
      expect(body.diagnostics[0]?.code).toBe('E021')
      expect(body.format).toMatchObject({ firstChangedLine: 2, changedLineCount: 1 })
      expect(body.format.unifiedDiff).toContain('-    bg #fff')
      expect(readFileSync(file, 'utf8')).toBe('draw a 2x2:\n    bg #fff\n')
    })
  })

  test('--check without --json reports the diagnostic on stderr', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'unformatted.drw')
      writeFileSync(file, 'draw a 2x2:\n    bg #fff\n')
      const r = run('fmt', file, '--check')
      expect(r.exitCode).toBe(1)
      expect(r.stderr).toContain('E021')
      expect(r.stderr).toContain('hint: run drawstic fmt without --check')
    })
  })

  test('--check on an already-canonical file reports nothing and exits 0', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'clean.drw')
      writeFileSync(file, 'draw a 2x2:\n  bg #fff\n')
      const r = runJson('fmt', file, '--check', '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as { diagnostics: unknown[]; format: { firstChangedLine: null } }
      expect(body.diagnostics).toEqual([])
      expect(body.format.firstChangedLine).toBeNull()
    })
  })

  test('rewrites an unformatted file in place by default', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'rewrite.drw')
      writeFileSync(file, 'draw a 2x2:\n    bg #fff\n')
      const r = run('fmt', file)
      expect(r.exitCode).toBe(0)
      expect(readFileSync(file, 'utf8')).toBe('draw a 2x2:\n  bg #fff\n')
    })
  })

  test('leaves an already-canonical file untouched by default', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'clean.drw')
      const original = 'draw a 2x2:\n  bg #fff\n'
      writeFileSync(file, original)
      const r = run('fmt', file)
      expect(r.exitCode).toBe(0)
      expect(readFileSync(file, 'utf8')).toBe(original)
    })
  })

  test('default rewrite with --json reports an empty diagnostics array', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'rewrite.drw')
      writeFileSync(file, 'draw a 2x2:\n    bg #fff\n')
      const r = runJson('fmt', file, '--json')
      expect(r.exitCode).toBe(0)
      expect(r.json).toEqual([])
    })
  })

  test('missing file reports a generic error diagnostic', () => {
    const r = runJson('fmt', 'examples/does/not/exist.drw', '--json')
    expect(r.exitCode).toBe(1)
    const diags = r.json as { code: string }[]
    expect(diags[0]?.code).toBe('E000')
  })
})

describe('context', () => {
  test('--json emits a full brief for a themed, multi-drawing module', () => {
    const r = runJson('context', 'examples/showcase/showcase.drw', '--json')
    expect(r.exitCode).toBe(0)
    const body = r.json as {
      context: {
        theme: {
          palette: { key: string; hex: string; source: string }[]
          style: { source: string; text: string }[]
          mode: string | null
          font: string | null
        }
        drawings: {
          name: string
          size: string
          sizeSource: string
          localPaletteKeys: string[]
          params: string[] | null
          preview: string | null
        }[]
        exports: { source: string; basePath: string }[]
        functions: { name: string; signature: string }[]
      }
    }
    expect(body.context.theme.palette).toContainEqual({
      key: 'k',
      hex: '#1a1a1a',
      source: 'warmPal',
    })
    expect(body.context.theme.mode).toBe('pixel')
    expect(body.context.theme.font).toBe('small')
    expect(body.context.theme.style.length).toBeGreaterThan(0)

    const dot = body.context.drawings.find((d) => d.name === 'parametricDot')
    expect(dot).toMatchObject({ size: '8x8', params: ['c'], preview: null })

    const gem = body.context.drawings.find((d) => d.name === 'gem')
    expect(gem).toMatchObject({ sizeSource: 'pixels', localPaletteKeys: ['y', 'r'] })

    expect(body.context.exports.find((e) => e.source === 'badge')).toMatchObject({
      source: 'badge',
      basePath: 'showcase/badge',
    })
    expect(body.context.functions).toContainEqual({ name: 'rowBand', signature: 'rowBand(row)' })
    expect(body.context.functions).toContainEqual({ name: 'ring', signature: 'ring(c, r)' })
  })

  test('--json gives an oversized drawing a largePreviewHint and no inline preview', () => {
    const r = runJson('context', 'examples/scenes/island.drw', '--json')
    expect(r.exitCode).toBe(0)
    const body = r.json as {
      context: {
        drawings: { name: string; largePreviewHint: string | null; preview: string | null }[]
      }
    }
    const island = body.context.drawings.find((d) => d.name === 'island')
    expect(island?.preview).toBeNull()
    expect(island?.largePreviewHint).toBe(
      'drawstic render examples/scenes/island.drw#island --preview --fit 80x40',
    )
  })

  test('text mode renders palette, style, drawings, exports, and functions sections', () => {
    const r = run('context', 'examples/showcase/showcase.drw')
    expect(r.exitCode).toBe(0)
    const text = r.stdout.toString('utf8')
    expect(text).toContain('# design brief — examples/showcase/showcase.drw')
    expect(text).toContain('## palette')
    expect(text).toContain('  k = #1a1a1a  (warmPal)')
    expect(text).toContain('## style guide')
    expect(text).toContain('## drawings')
    expect(text).toContain('  parametricDot 8x8(c)')
    expect(text).toContain('    size: pixels; pal: y, r')
    expect(text).toContain('## exports')
    expect(text).toContain('  scene -> showcase/scene')
    expect(text).toContain('## functions')
    expect(text).toContain('  rowBand(row)')
  })

  test('text mode prints a hint line (no inline preview) for oversized drawings', () => {
    const r = run('context', 'examples/scenes/island.drw')
    expect(r.exitCode).toBe(0)
    const text = r.stdout.toString('utf8')
    expect(text).toContain('  island 160x96')
    expect(text).toContain('    size: header; pal: -')
    expect(text).toContain(
      '    hint: drawstic render examples/scenes/island.drw#island --preview --fit 80x40',
    )
  })

  test('sizeSource falls back through module default, theme default, and unresolved', () => {
    withTmpDir((dir) => {
      const moduleDefaultFile = join(dir, 'moddefault.drw')
      writeFileSync(
        moduleDefaultFile,
        'size 10x10\n\ndraw usesDefault(c):\n  circle c 3:3 3 fill\n',
      )
      const moduleDefault = runJson('context', moduleDefaultFile, '--json').json as {
        context: { drawings: { sizeSource: string }[] }
      }
      expect(moduleDefault.context.drawings[0]?.sizeSource).toBe('module default')

      const themeDefaultFile = join(dir, 'themedefault.drw')
      writeFileSync(
        themeDefaultFile,
        'theme t:\n  size 12x12\n\nuse t\n\ndraw usesTheme(c):\n  circle c 3:3 3 fill\n',
      )
      const themeDefault = runJson('context', themeDefaultFile, '--json').json as {
        context: { drawings: { sizeSource: string }[] }
      }
      expect(themeDefault.context.drawings[0]?.sizeSource).toBe('theme default')

      const unresolvedFile = join(dir, 'unresolved.drw')
      writeFileSync(unresolvedFile, 'draw noSize(c):\n  circle c 3:3 3 fill\n')
      const unresolved = runJson('context', unresolvedFile, '--json').json as {
        context: { drawings: { sizeSource: string }[] }
      }
      expect(unresolved.context.drawings[0]?.sizeSource).toBe('unresolved')
    })
  })

  test('export formats report explicit out-sizes alongside scales', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'outsize.drw')
      writeFileSync(file, 'draw a 4x4:\n  bg #fff\n\nexport a out/a:\n  png 8 8x8\n')
      const r = runJson('context', file, '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as { context: { exports: { formats: { sizes: string[] }[] }[] } }
      expect(body.context.exports[0]?.formats[0]?.sizes).toEqual(['8', '8x8'])
    })
  })

  test('text mode omits every optional section for a theme-less, export-less module', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'sparse.drw')
      writeFileSync(file, 'draw sparse 4x4:\n  bg #ffffff\n')
      const r = run('context', file)
      expect(r.exitCode).toBe(0)
      const text = r.stdout.toString('utf8')
      expect(text).not.toContain('## palette')
      expect(text).not.toContain('## style guide')
      expect(text).not.toContain('## exports')
      expect(text).not.toContain('## functions')
      expect(text).toContain('## drawings')
      expect(text).toContain('  sparse 4x4')
      expect(text).not.toContain('size:')
    })
  })

  test('a drawing that throws during render gets an unresolved-size placeholder', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'ctxbroken.drw')
      writeFileSync(file, 'draw ok 4x4:\n  bg #ffffff\n\ndraw broken 4x4:\n  bg nope\n')
      const r = runJson('context', file, '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        context: { drawings: { name: string; size: string; preview: string | null }[] }
      }
      expect(body.context.drawings.find((d) => d.name === 'ok')?.size).toBe('4x4')
      expect(body.context.drawings.find((d) => d.name === 'broken')).toMatchObject({
        size: '?',
        preview: null,
      })
    })
  })

  test('missing file reports a diagnostic instead of a brief', () => {
    const r = runJson('context', 'examples/does/not/exist.drw', '--json')
    expect(r.exitCode).toBe(1)
    const diags = r.json as { code: string }[]
    expect(diags[0]?.code).toBe('E008')
  })

  test('surfaces a drawing-local theme per-drawing when there is no file-level use (E11)', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'local.drw')
      writeFileSync(
        file,
        [
          'theme fam:',
          '  size 16x16',
          '  pal:',
          '    b = #3366cc',
          '    g = #ffffff',
          '',
          'draw dot 16x16:',
          '  use fam',
          '  circle b 8:8 6 fill',
          '  circle g 8:8 2 fill',
          '',
          'export dot out/dot:',
          '  png',
          '',
        ].join('\n'),
      )
      const r = runJson('context', file, '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        context: {
          theme: { palette: unknown[] }
          drawings: {
            name: string
            themes: string[]
            themePalette: { key: string; hex: string; source: string }[]
          }[]
        }
      }
      // the file-level theme snapshot stays empty (there is no file-level `use`)…
      expect(body.context.theme.palette).toEqual([])
      // …but the drawing-local `use fam` now shows up on the drawing itself
      const dot = body.context.drawings.find((d) => d.name === 'dot')
      expect(dot?.themes).toEqual(['fam'])
      expect(dot?.themePalette).toEqual([
        { key: 'b', hex: '#3366cc', source: 'fam' },
        { key: 'g', hex: '#ffffff', source: 'fam' },
      ])

      const text = run('context', file).stdout.toString('utf8')
      expect(text).toContain('    use: fam')
      expect(text).toContain('    theme pal: b=#3366cc (fam), g=#ffffff (fam)')
    })
  })

  test('a drawing without a drawing-local use reports empty themes', () => {
    const r = runJson('context', 'examples/showcase/showcase.drw', '--json')
    const body = r.json as { context: { drawings: { name: string; themes: string[] }[] } }
    expect(body.context.drawings.every((d) => Array.isArray(d.themes))).toBe(true)
    expect(body.context.drawings.find((d) => d.name === 'gem')?.themes).toEqual([])
  })
})

describe('build', () => {
  test('--json writes every export artifact and reports accurate byte counts', () => {
    withTmpDir((dir) => {
      const r = runJson('build', 'examples/showcase/showcase.drw', '--out', dir, '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        diagnostics: unknown[]
        artifacts: { path: string; bytes: number }[]
      }
      expect(body.diagnostics).toEqual([])
      expect(body.artifacts.length).toBeGreaterThan(0)
      for (const a of body.artifacts) {
        expect(existsSync(a.path)).toBe(true)
        expect(readFileSync(a.path)).toHaveLength(a.bytes)
      }
      const scenePng = body.artifacts.find((a) => a.path.endsWith('scene.png'))
      expect(scenePng).toBeDefined()
      if (scenePng) {
        const decoded = decodePng(new Uint8Array(readFileSync(scenePng.path)))
        expect(decoded.w).toBe(32)
        expect(decoded.h).toBe(24)
      }
    })
  })

  test('without --json prints one wrote-line per artifact', () => {
    withTmpDir((dir) => {
      const r = run('build', 'examples/basic-shapes/circles.drw', '--out', dir)
      expect(r.exitCode).toBe(0)
      const lines = r.stdout
        .toString('utf8')
        .trim()
        .split('\n')
        .filter((l) => l.length > 0)
      expect(lines.length).toBeGreaterThan(0)
      for (const line of lines) {
        expect(line).toMatch(/^wrote .+ \(\d+ bytes\)$/)
      }
    })
  })

  test('defaults --out to the process cwd when omitted', () => {
    const originalCwd = process.cwd()
    withTmpDir((dir) => {
      writeFileSync(join(dir, 'x.drw'), 'draw x 2x2:\n  bg #fff\n\nexport x out/x:\n  png\n')
      process.chdir(dir)
      try {
        const r = runJson('build', 'x.drw', '--json')
        expect(r.exitCode).toBe(0)
        expect(existsSync(join(dir, 'out', 'x.png'))).toBe(true)
      } finally {
        process.chdir(originalCwd)
      }
    })
  })

  test('missing file reports a diagnostic and writes nothing', () => {
    withTmpDir((dir) => {
      const r = runJson('build', 'examples/does/not/exist.drw', '--out', dir, '--json')
      expect(r.exitCode).toBe(1)
      const diags = r.json as { code: string }[]
      expect(diags[0]?.code).toBe('E008')
    })
  })

  // A non-fatal render-time warning (W010 fit gap, ADR-0087) reaches the build diagnostics the
  // same way `render` surfaces it — in JSON and, without --json, in the human output.
  const GAP_EXPORT = [
    'draw torso 12x20:',
    '  fill #6a5030 rect(0:0, 11:19)',
    '  pin shoulder 10:3',
    'draw arm 6x14:',
    '  fill #8a5a3a rect(0:0, 5:13)',
    '  pin shoulder 0:2',
    'draw fig 34x34:',
    '  stamp torso 4:2',
    '  pin far.spot 30:30',
    '  fit arm.shoulder far.spot', // arm lands in empty space → W010
    '',
    'export fig out/fig:',
    '  png',
    '',
  ].join('\n')

  test('--json surfaces a W010 fit gap in build diagnostics (still exit 0)', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'gap.drw')
      writeFileSync(file, GAP_EXPORT)
      const r = runJson('build', file, '--out', dir, '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        diagnostics: { code: string; severity: string }[]
        artifacts: unknown[]
      }
      expect(body.diagnostics.some((d) => d.code === 'W010' && d.severity === 'warning')).toBe(true)
      expect(body.artifacts.length).toBeGreaterThan(0)
    })
  })

  test('without --json prints the W010 fit gap after the wrote-lines', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'gap.drw')
      writeFileSync(file, GAP_EXPORT)
      const r = run('build', file, '--out', dir)
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString('utf8')).toContain('W010')
    })
  })
})

describe('render', () => {
  const bigFixture = (dir: string): string => {
    const file = join(dir, 'big.drw')
    writeFileSync(file, 'draw big 20x10:\n  bg #ffffff\n  rect #000000 2:2 17:7 fill\n')
    return file
  }

  test('--ascii --json with --crop reports the cropped dimensions', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const r = runJson('render', `${file}#big`, '--ascii', '--json', '--crop', '0:0', '10x5')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        render: {
          kind: string
          width: number
          height: number
          crop: { x: number; y: number; width: number; height: number }
        }
      }
      expect(body.render).toMatchObject({ kind: 'ascii', width: 10, height: 5 })
      expect(body.render.crop).toEqual({ x: 0, y: 0, width: 10, height: 5 })
    })
  })

  test('--ascii without --json prints raw glyphs to stdout', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'solid.drw')
      // Solid white (max luminance) maps to the densest glyph.
      writeFileSync(file, 'draw solid 4x2:\n  bg #ffffff\n  rect #ffffff 0:0 3:1 fill\n')
      const r = run('render', `${file}#solid`, '--ascii')
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString('utf8')).toBe('@@@@\n@@@@\n')
    })
  })

  test('--explain --json reports the model/cel primitive expansion (ADR-0086 §6)', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'lit.drw')
      writeFileSync(
        file,
        [
          'light sun = dir 1:1 #ffe6b0',
          'material steel = #8a95a5 metal',
          'draw blade 16x16:',
          '  body = rect(2:2, 13:13)',
          '  model body steel light sun',
          '',
        ].join('\n'),
      )
      const r = runJson('render', `${file}#blade`, '--explain', '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        render: { kind: string; explain: { command: string; steps: { op: string }[] }[] }
      }
      expect(body.render.kind).toBe('explain')
      expect(body.render.explain).toHaveLength(1)
      expect(body.render.explain[0]?.command).toBe('model')
      expect(body.render.explain[0]?.steps.map((s) => s.op)).toEqual(['form', 'rim', 'ao', 'cast'])
    })
  })

  test('--preview --json with --fit reports a shrunk, fitted size', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const r = runJson('render', `${file}#big`, '--preview', '--json', '--fit', '5x5')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        render: {
          kind: string
          width: number
          height: number
          fit: { fitted: boolean; width: number; height: number }
          stats: { unknownColorCount: number; paletteCoveredPercent: number }
        }
      }
      expect(body.render.kind).toBe('preview')
      expect(body.render.width).toBeLessThanOrEqual(5)
      expect(body.render.height).toBeLessThanOrEqual(5)
      expect(body.render.fit.fitted).toBe(true)
    })
  })

  test('--preview without --json prints ANSI half-block escapes', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const r = run('render', `${file}#big`, '--preview')
      expect(r.exitCode).toBe(0)
      const out = r.stdout.toString('utf8')
      expect(out).toContain('\x1b[38;2;')
      expect(out).toContain('▀')
    })
  })

  test('--inspect --json wraps the inspection under render.inspect', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const r = runJson('render', `${file}#big`, '--inspect', '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        render: {
          kind: string
          inspect: { distinctColorCount: number; alphaCoverageBBox: { width: number } }
        }
      }
      expect(body.render.kind).toBe('inspect')
      expect(body.render.inspect.distinctColorCount).toBe(2)
      expect(body.render.inspect.alphaCoverageBBox.width).toBe(20)
    })
  })

  test('--inspect without --json prints the raw inspection object', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const r = runJson('render', `${file}#big`, '--inspect')
      expect(r.exitCode).toBe(0)
      const body = r.json as { distinctColorCount: number; occupancy: string[] }
      expect(body.distinctColorCount).toBe(2)
      expect(body.occupancy.length).toBeGreaterThan(0)
    })
  })

  // task 3.4 (TODO-IMP.md §3.4): form-sanity stats — per-palette-key opaque
  // pixel share and per-named-mask bbox/coverage. `box` covers x/y 2..5
  // (rect is inclusive-corners, 4x4 = 16px) of an 8x8 canvas filled with
  // `k` then re-painted `r` inside `mask box:` — hand-computed: 16 `r`
  // pixels, 48 `k` pixels, out of 64 opaque pixels total.
  const maskFixture = (dir: string): string => {
    const file = join(dir, 'mask.drw')
    writeFileSync(
      file,
      [
        'mask box = rect(2:2, 5:5)',
        '',
        'draw badge 8x8:',
        '  pal k=#000000  r=#ff0000',
        '  bg k',
        '  mask box:',
        '    bg r',
        '',
      ].join('\n'),
    )
    return file
  }

  test('--inspect --json reports per-palette-key opaquePixelShare and module-scope namedMasks', () => {
    withTmpDir((dir) => {
      const file = maskFixture(dir)
      const r = runJson('render', `${file}#badge`, '--inspect', '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        render: {
          inspect: {
            palette: { key: string; hex: string; source: string; opaquePixelShare: number }[]
            namedMasks: {
              name: string
              bbox: { x: number; y: number; width: number; height: number } | null
              coveragePixelCount: number
              coverageFraction: number
            }[]
          }
        }
      }
      expect(body.render.inspect.palette).toEqual([
        { key: 'k', hex: '#000000', source: 'badge', opaquePixelShare: 0.75 },
        { key: 'r', hex: '#ff0000', source: 'badge', opaquePixelShare: 0.25 },
      ])
      expect(body.render.inspect.namedMasks).toEqual([
        {
          name: 'box',
          bbox: { x: 2, y: 2, width: 4, height: 4 },
          coveragePixelCount: 16,
          coverageFraction: 1,
        },
      ])
    })
  })

  test('--inspect --json --crop shifts namedMasks bbox to the cropped, canvas-local origin', () => {
    withTmpDir((dir) => {
      const file = maskFixture(dir)
      const r = runJson('render', `${file}#badge`, '--inspect', '--json', '--crop', '1:1', '6x6')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        render: {
          inspect: {
            namedMasks: {
              name: string
              bbox: { x: number; y: number; width: number; height: number } | null
              coveragePixelCount: number
              coverageFraction: number
            }[]
          }
        }
      }
      // absolute box was x/y 2..5; crop origin 1:1 -> local box x/y 1..4
      expect(body.render.inspect.namedMasks).toEqual([
        {
          name: 'box',
          bbox: { x: 1, y: 1, width: 4, height: 4 },
          coveragePixelCount: 16,
          coverageFraction: 1,
        },
      ])
    })
  })

  test('--inspect --json omits a drawing-local mask (declared inside the draw body)', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'local-mask.drw')
      writeFileSync(
        file,
        [
          'draw badge 8x8:',
          '  pal k=#000000  r=#ff0000',
          '  mask box = rect(2:2, 5:5)',
          '  bg k',
          '  mask box:',
          '    bg r',
          '',
        ].join('\n'),
      )
      const r = runJson('render', `${file}#badge`, '--inspect', '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as { render: { inspect: { namedMasks: unknown[] } } }
      expect(body.render.inspect.namedMasks).toEqual([])
    })
  })

  test('--stdout writes raw PNG bytes with a valid PNG signature', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const r = run('render', `${file}#big`, '--stdout')
      expect(r.exitCode).toBe(0)
      expect([...r.stdout.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
      const decoded = decodePng(new Uint8Array(r.stdout))
      expect(decoded.w).toBe(20)
      expect(decoded.h).toBe(10)
    })
  })

  test('--png@2 scales the PNG and reports the original size', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const out = join(dir, 'big@2x.png')
      const r = runJson('render', `${file}#big`, '--out', out, '--png@2', '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        render: { width: number; height: number; original: { width: number; height: number } }
      }
      expect(body.render).toMatchObject({
        width: 40,
        height: 20,
        original: { width: 20, height: 10 },
      })
      const decoded = decodePng(new Uint8Array(readFileSync(out)))
      expect(decoded.w).toBe(40)
      expect(decoded.h).toBe(20)
    })
  })

  test('writes a PNG to --out by default and prints a wrote-line', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const out = join(dir, 'big.png')
      const r = run('render', `${file}#big`, '--out', out)
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString('utf8').trim()).toBe(`wrote ${resolve(out)} (20x10)`)
      expect(existsSync(out)).toBe(true)
    })
  })

  test('--mode smooth and a generous --budget are accepted', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'circle.drw')
      writeFileSync(file, 'draw d 16x16:\n  circle #000000 8:8 6 fill\n')
      const out = join(dir, 'd.png')
      const r = run('render', `${file}#d`, '--mode', 'smooth', '--budget', '999999', '--out', out)
      expect(r.exitCode).toBe(0)
      expect(existsSync(out)).toBe(true)
      const decoded = decodePng(new Uint8Array(readFileSync(out)))
      let partial = 0
      for (let i = 3; i < decoded.data.length; i += 4) {
        const a = decoded.data[i] ?? 0
        if (a > 0 && a < 255) {
          partial++
        }
      }
      expect(partial).toBeGreaterThan(0)
    })
  })

  test('malformed <file>#<drawing> targets are E022 diagnostics, not thrown errors', () => {
    for (const target of [
      'noHash',
      '#leading',
      'trailing#',
      'a#b#c',
      'file#drawing(',
      'file#(args)',
    ]) {
      const r = runJson('render', target, '--json')
      expect(r.exitCode).toBe(1)
      const diags = r.json as { code: string; message: string; hint: string }[]
      expect(diags[0]).toMatchObject({
        code: 'E022',
        message: 'malformed render target',
        hint: 'use <file>#<drawing>',
      })
    }
  })

  test('unknown drawing name lists the available drawings', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'multi.drw')
      writeFileSync(file, 'draw one 2x2:\n  bg #fff\ndraw two 2x2:\n  bg #000\n')
      const r = runJson('render', `${file}#nope`, '--json')
      expect(r.exitCode).toBe(1)
      const diags = r.json as { code: string; hint: string }[]
      expect(diags[0]?.code).toBe('E022')
      expect(diags[0]?.hint).toBe('available drawings: one, two')
    })
  })

  test('unknown drawing name in a module with no drawings says so', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'nodraws.drw')
      writeFileSync(file, 'x = 1\n')
      const r = runJson('render', `${file}#foo`, '--json')
      expect(r.exitCode).toBe(1)
      const diags = r.json as { hint: string }[]
      expect(diags[0]?.hint).toBe('no drawings are defined')
    })
  })

  test('malformed --fit and --crop values are ignored rather than applied', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const r = runJson('render', `${file}#big`, '--ascii', '--json', '--fit', 'bogus')
      expect(r.exitCode).toBe(0)
      const body = r.json as { render: { width: number; height: number; fit?: unknown } }
      expect(body.render.width).toBe(20)
      expect(body.render.height).toBe(10)
      expect(body.render.fit).toBeUndefined()

      const r2 = runJson('render', `${file}#big`, '--ascii', '--json', '--crop', 'nope', '10x10')
      const body2 = r2.json as { render: { width: number; crop?: unknown } }
      expect(body2.render.width).toBe(20)
      expect(body2.render.crop).toBeUndefined()
    })
  })

  test('negative crop origin clamps to the sprite bounds', () => {
    withTmpDir((dir) => {
      const file = bigFixture(dir)
      const r = runJson('render', `${file}#big`, '--ascii', '--json', '--crop', '-5:-5', '8x8')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        render: { crop: { x: number; y: number; width: number; height: number } }
      }
      expect(body.render.crop).toEqual({ x: 0, y: 0, width: 3, height: 3 })
    })
  })

  test('a draw that throws during render surfaces as a positioned diagnostic', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'renderbroken.drw')
      writeFileSync(file, 'draw broken 2x2:\n  bg nope\n')
      const r = runJson('render', `${file}#broken`, '--json')
      expect(r.exitCode).toBe(1)
      const diags = r.json as { code: string; message: string }[]
      expect(diags[0]).toMatchObject({ code: 'E001', message: "unknown name 'nope'" })
    })
  })

  test('missing module file reports a diagnostic', () => {
    const r = runJson('render', 'examples/does/not/exist.drw#foo', '--json')
    expect(r.exitCode).toBe(1)
    const diags = r.json as { code: string }[]
    expect(diags[0]?.code).toBe('E008')
  })

  describe('--grid N (TODO-IMP 3.2)', () => {
    test('burns labeled gridlines into the PNG only, scaled correctly under --png@K', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const out = join(dir, 'grid.png')
        const r = runJson('render', `${file}#big`, '--png@4', '--grid', '5', '--out', out, '--json')
        expect(r.exitCode).toBe(0)
        const body = r.json as { render: { width: number; height: number; grid: number } }
        expect(body.render).toMatchObject({ width: 80, height: 40, grid: 5 })
        const decoded = decodePng(new Uint8Array(readFileSync(out)))
        // the source x=0 boundary line survives as a fully-inverted output column
        const bg = [255, 255, 255] // `bigFixture` paints a white bg
        for (let y = 20; y < 24; y++) {
          const i = (y * decoded.w + 0) * 4
          expect([decoded.data[i], decoded.data[i + 1], decoded.data[i + 2]]).toEqual(
            bg.map((c) => 255 - c),
          )
        }
        // a column strictly between two gridlines (source x spacing is 5 -> pitch
        // 20 output px) is untouched
        const i = (20 * decoded.w + 10) * 4
        expect([decoded.data[i], decoded.data[i + 1], decoded.data[i + 2]]).toEqual(bg)
      })
    })

    test('never affects build exports (post-pass on the render CLI only)', () => {
      // `--grid` is a render-only flag; `build` has no such flag to parse, so
      // this documents the invariant rather than exercising build directly.
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const r = runJson('render', `${file}#big`, '--ascii', '--json', '--grid', '5')
        // --ascii wins over PNG in the output-kind order, so --grid (PNG-only) is inert
        const body = r.json as { render: { kind: string; grid?: unknown } }
        expect(body.render.kind).toBe('ascii')
        expect(body.render.grid).toBeUndefined()
      })
    })

    test('a non-positive or malformed --grid value is ignored', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const r = runJson('render', `${file}#big`, '--json', '--grid', '0')
        const body = r.json as { render: { grid?: unknown } }
        expect(body.render.grid).toBeUndefined()

        const r2 = runJson('render', `${file}#big`, '--json', '--grid', 'bogus')
        const body2 = r2.json as { render: { grid?: unknown } }
        expect(body2.render.grid).toBeUndefined()
      })
    })
  })

  describe('--diff <png> (TODO-IMP 3.3)', () => {
    test('--json reports changed-pixel count and a bbox pinpointing an unrelated-region regression', () => {
      withTmpDir((dir) => {
        const file = join(dir, 'scene.drw')
        writeFileSync(file, 'draw scene 10x10:\n  bg #ffffff\n  rect #000000 1:1 3:3 fill\n')
        const before = join(dir, 'before.png')
        expect(runJson('render', `${file}#scene`, '--out', before, '--json').exitCode).toBe(0)

        // Edit an UNRELATED region (bottom-right corner) — the regression a
        // machine reader must be able to localize from --json alone.
        writeFileSync(
          file,
          'draw scene 10x10:\n  bg #ffffff\n  rect #000000 1:1 3:3 fill\n  px #ff0000 9:9\n',
        )
        const after = join(dir, 'after.png')
        const r = runJson('render', `${file}#scene`, '--out', after, '--diff', before, '--json')
        expect(r.exitCode).toBe(0)
        const body = r.json as {
          render: {
            diff: {
              identical: boolean
              changedPixelCount: number
              totalPixelCount: number
              changedBBox: { x: number; y: number; width: number; height: number }
            }
          }
        }
        expect(body.render.diff).toEqual({
          identical: false,
          changedPixelCount: 1,
          totalPixelCount: 100,
          changedBBox: { x: 9, y: 9, width: 1, height: 1 },
        })
      })
    })

    test('identical renders report identical: true and a null bbox', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const first = join(dir, 'first.png')
        expect(runJson('render', `${file}#big`, '--out', first, '--json').exitCode).toBe(0)
        const r = runJson('render', `${file}#big`, '--diff', first, '--json')
        expect(r.exitCode).toBe(0)
        const body = r.json as {
          render: {
            diff: {
              identical: boolean
              changedPixelCount: number
              totalPixelCount: number
              changedBBox: null
            }
          }
        }
        expect(body.render.diff).toEqual({
          identical: true,
          changedPixelCount: 0,
          totalPixelCount: 200,
          changedBBox: null,
        })
      })
    })

    test('non-json mode prints a short human summary line after the wrote-line', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const first = join(dir, 'first.png')
        expect(runJson('render', `${file}#big`, '--out', first, '--json').exitCode).toBe(0)
        const r = run('render', `${file}#big`, '--diff', first)
        expect(r.exitCode).toBe(0)
        const lines = r.stdout.toString('utf8').trim().split('\n')
        expect(lines[0]).toMatch(/^wrote .+ \(20x10\)$/)
        expect(lines[1]).toBe('diff: identical (0 px changed)')
      })
    })

    test('--grid is cosmetic and does not participate in the --diff comparison', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const plain = join(dir, 'plain.png')
        expect(runJson('render', `${file}#big`, '--out', plain, '--json').exitCode).toBe(0)
        const gridded = join(dir, 'gridded.png')
        const r = runJson(
          'render',
          `${file}#big`,
          '--out',
          gridded,
          '--grid',
          '5',
          '--diff',
          plain,
          '--json',
        )
        expect(r.exitCode).toBe(0)
        const body = r.json as { render: { diff: { identical: boolean } } }
        expect(body.render.diff.identical).toBe(true)
      })
    })

    test('a dimension mismatch (different --png@N) is a clear E023 diagnostic', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const at1 = join(dir, 'at1.png')
        expect(runJson('render', `${file}#big`, '--out', at1, '--json').exitCode).toBe(0)
        const r = runJson('render', `${file}#big`, '--png@2', '--diff', at1, '--json')
        expect(r.exitCode).toBe(1)
        const diags = r.json as { code: string; message: string; hint: string }[]
        expect(diags[0]).toMatchObject({
          code: 'E023',
          message: 'diff PNG is 20x10, fresh render is 40x20',
        })
        expect(diags[0]?.hint).toContain('--png@N')
      })
    })

    test('an unreadable diff PNG is a clear E019 diagnostic, not a thrown error', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const r = runJson('render', `${file}#big`, '--diff', join(dir, 'nope.png'), '--json')
        expect(r.exitCode).toBe(1)
        const diags = r.json as { code: string; message: string }[]
        expect(diags[0]?.code).toBe('E019')
        expect(diags[0]?.message).toContain('could not read diff PNG')
      })
    })

    test('a diff target that is not a valid PNG is a clear E019 diagnostic', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const notPng = join(dir, 'notapng.png')
        writeFileSync(notPng, 'this is not a png')
        const r = runJson('render', `${file}#big`, '--diff', notPng, '--json')
        expect(r.exitCode).toBe(1)
        const diags = r.json as { code: string; message: string }[]
        expect(diags[0]?.code).toBe('E019')
        expect(diags[0]?.message).toContain('could not decode diff PNG')
      })
    })
  })

  describe('--silhouette (ADR-0083)', () => {
    test('blacks out every painted pixel and preserves transparency (PNG)', () => {
      withTmpDir((dir) => {
        // x=0 painted red, x=1 transparent (never painted), x=2 painted green.
        const file = join(dir, 'sil.drw')
        writeFileSync(file, 'draw sil 3x1:\n  px #ff0000 0:0\n  px #00ff00 2:0\n')
        const r = run('render', `${file}#sil`, '--silhouette', '--stdout')
        expect(r.exitCode).toBe(0)
        const decoded = decodePng(new Uint8Array(r.stdout))
        expect(decoded.w).toBe(3)
        expect(decoded.h).toBe(1)
        const px = (x: number): number[] => [...decoded.data.subarray(x * 4, x * 4 + 4)]
        expect(px(0)).toEqual([0, 0, 0, 255])
        expect(px(1)).toEqual([0, 0, 0, 0])
        expect(px(2)).toEqual([0, 0, 0, 255])
      })
    })

    test('composes with --png@N — the whole opaque sprite becomes opaque black', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const out = join(dir, 'sil@2.png')
        const r = runJson(
          'render',
          `${file}#big`,
          '--silhouette',
          '--png@2',
          '--out',
          out,
          '--json',
        )
        expect(r.exitCode).toBe(0)
        const body = r.json as {
          render: { kind: string; width: number; height: number; silhouette: boolean }
        }
        expect(body.render).toMatchObject({
          kind: 'png',
          width: 40,
          height: 20,
          silhouette: true,
        })
        const decoded = decodePng(new Uint8Array(readFileSync(out)))
        for (let i = 0; i < decoded.data.length; i += 4) {
          expect([
            decoded.data[i],
            decoded.data[i + 1],
            decoded.data[i + 2],
            decoded.data[i + 3],
          ]).toEqual([0, 0, 0, 255])
        }
      })
    })

    test('composes with --inspect --json, collapsing the sprite to a single black colour', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const r = runJson('render', `${file}#big`, '--silhouette', '--inspect', '--json')
        expect(r.exitCode).toBe(0)
        const body = r.json as {
          render: { kind: string; silhouette: boolean; inspect: { distinctColorCount: number } }
        }
        expect(body.render.kind).toBe('inspect')
        expect(body.render.silhouette).toBe(true)
        expect(body.render.inspect.distinctColorCount).toBe(1)
      })
    })

    test('surfaces the silhouette flag under --ascii --json; omits it without the flag', () => {
      withTmpDir((dir) => {
        const file = bigFixture(dir)
        const on = runJson('render', `${file}#big`, '--silhouette', '--ascii', '--json')
        expect(on.exitCode).toBe(0)
        const onBody = on.json as { render: { kind: string; silhouette?: boolean } }
        expect(onBody.render.kind).toBe('ascii')
        expect(onBody.render.silhouette).toBe(true)

        const off = runJson('render', `${file}#big`, '--ascii', '--json')
        const offBody = off.json as { render: { silhouette?: boolean } }
        expect(offBody.render.silhouette).toBeUndefined()
      })
    })
  })

  describe('fragment literal arguments (ADR-0067)', () => {
    const houseFixture = (dir: string): string => {
      const file = join(dir, 'house.drw')
      writeFileSync(
        file,
        [
          'draw house(c, n) 12x12:',
          '  bg #ffffff',
          '  rect c 2:2 9:9 fill',
          '  circle c 6:1 n fill',
          '',
        ].join('\n'),
      )
      return file
    }

    test('renders a parametric draw with literal color and number arguments', () => {
      withTmpDir((dir) => {
        const file = houseFixture(dir)
        const r = runJson('render', `${file}#house(#c04040, 3)`, '--ascii', '--json')
        expect(r.exitCode).toBe(0)
        const body = r.json as { render: { kind: string; width: number; height: number } }
        expect(body.render).toMatchObject({ kind: 'ascii', width: 12, height: 12 })
      })
    })

    test('a point literal argument is accepted', () => {
      withTmpDir((dir) => {
        const file = join(dir, 'dot.drw')
        writeFileSync(file, 'draw dot(c, p) 12x12:\n  bg #ffffff\n  circle c p 2 fill\n')
        const r = runJson('render', `${file}#dot(#ff0000, 6:6)`, '--ascii', '--json')
        expect(r.exitCode).toBe(0)
        const body = r.json as { render: { kind: string } }
        expect(body.render.kind).toBe('ascii')
      })
    })

    test('arity mismatch (no parens, empty parens, wrong count) hints at the new syntax', () => {
      withTmpDir((dir) => {
        const file = houseFixture(dir)
        for (const target of [`${file}#house`, `${file}#house()`, `${file}#house(#fff)`]) {
          const r = runJson('render', target, '--json')
          expect(r.exitCode).toBe(1)
          const diags = r.json as { code: string; message: string; hint: string }[]
          expect(diags[0]?.code).toBe('E011')
          expect(diags[0]?.message).toMatch(/^drawing 'house' takes 2 argument\(s\), got \d+$/)
          expect(diags[0]?.hint).toBe('pass literal arguments: render <file>#house(c, n)')
        }
      })
    })

    test('a name argument is a positioned E004, not a thrown error', () => {
      withTmpDir((dir) => {
        const file = houseFixture(dir)
        const r = runJson('render', `${file}#house(foo, 3)`, '--json')
        expect(r.exitCode).toBe(1)
        const diags = r.json as { code: string; message: string; hint: string }[]
        expect(diags[0]?.code).toBe('E004')
        expect(diags[0]?.message).toContain("got a 'name' expression")
        expect(diags[0]?.hint).toBe('no names, arithmetic, or calls in render arguments')
      })
    })

    test('an arithmetic expression argument is E004', () => {
      withTmpDir((dir) => {
        const file = houseFixture(dir)
        const r = runJson('render', `${file}#house(1 + 2, 3)`, '--json')
        expect(r.exitCode).toBe(1)
        const diags = r.json as { code: string; message: string }[]
        expect(diags[0]?.code).toBe('E004')
        expect(diags[0]?.message).toContain("got a 'binary' expression")
      })
    })

    test('a keyword-style argument is E004', () => {
      withTmpDir((dir) => {
        const file = houseFixture(dir)
        const r = runJson('render', `${file}#house(mask m, 3)`, '--json')
        expect(r.exitCode).toBe(1)
        const diags = r.json as { code: string; message: string }[]
        expect(diags[0]?.code).toBe('E004')
        expect(diags[0]?.message).toContain('keyword argument')
      })
    })

    test('arguments on a non-parametric draw are an arity mismatch', () => {
      withTmpDir((dir) => {
        const file = join(dir, 'plain.drw')
        writeFileSync(file, 'draw plain 4x4:\n  bg #000000\n')
        const r = runJson('render', `${file}#plain(3)`, '--json')
        expect(r.exitCode).toBe(1)
        const diags = r.json as { code: string; message: string; hint: string }[]
        expect(diags[0]).toMatchObject({
          code: 'E011',
          message: "drawing 'plain' takes 0 argument(s), got 1",
        })
      })
    })
  })
})

describe('sheet', () => {
  const family = [
    'theme t:',
    '  size 8x8',
    '',
    'draw tile(c) 8x8:',
    '  circle c 4:4 3 fill',
    '',
    'draw a 8x8:',
    '  use t',
    '  circle #d33 4:4 3 fill',
    '',
    'draw b 8x8:',
    '  use t',
    '  rect #39c 1:1 6:6 fill',
    '',
    'draw part 8x8:',
    '  bg #222222',
    '',
    'export a icons/a:',
    '  png',
    '',
    'export b icons/b:',
    '  png',
    '',
  ].join('\n')

  test('--json composes the exported drawings into a deterministic labeled grid and writes a PNG', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'fam.drw')
      writeFileSync(file, family)
      const out = join(dir, 'fam.sheet.png')
      const r = runJson('sheet', file, '--out', out, '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as {
        sheet: {
          cols: number
          rows: number
          cell: { width: number; height: number }
          width: number
          height: number
          cells: { name: string; w: number; h: number; x: number; y: number }[]
          kind: string
          output: string
        }
      }
      // default selection = exported drawings only (a, b) — not the parametric
      // `tile(c)` and not the unexported `part`.
      expect(body.sheet.cells.map((c) => c.name)).toEqual(['a', 'b'])
      expect(body.sheet.cols).toBe(2)
      expect(body.sheet.rows).toBe(1)
      expect(body.sheet.cell.width).toBeGreaterThanOrEqual(8)
      expect(body.sheet.kind).toBe('png')
      for (const cell of body.sheet.cells) {
        expect(cell).toMatchObject({ w: 8, h: 8 })
        expect(cell.x).toBeGreaterThanOrEqual(0)
        expect(cell.y).toBeGreaterThanOrEqual(0)
      }
      expect(existsSync(out)).toBe(true)
      const png = decodePng(new Uint8Array(readFileSync(out)))
      expect(png.w).toBe(body.sheet.width)
      expect(png.h).toBe(body.sheet.height)
    })
  })

  test('is deterministic — two renders produce byte-identical PNGs', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'fam.drw')
      writeFileSync(file, family)
      const a = run('sheet', file, '--out', join(dir, 'a.png'))
      const b = run('sheet', file, '--out', join(dir, 'b.png'))
      expect(a.exitCode).toBe(0)
      expect(b.exitCode).toBe(0)
      expect(readFileSync(join(dir, 'a.png')).equals(readFileSync(join(dir, 'b.png')))).toBe(true)
    })
  })

  test('--all includes every non-parametric drawing (parametric tiles still excluded)', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'fam.drw')
      writeFileSync(file, family)
      const r = runJson('sheet', file, '--all', '--out', join(dir, 'all.png'), '--json')
      const names = (r.json as { sheet: { cells: { name: string }[] } }).sheet.cells.map(
        (c) => c.name,
      )
      expect(names).toEqual(['a', 'b', 'part'])
      expect(names).not.toContain('tile')
    })
  })

  test('--cols overrides the column count', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'fam.drw')
      writeFileSync(file, family)
      const r = runJson(
        'sheet',
        file,
        '--all',
        '--cols',
        '1',
        '--out',
        join(dir, 'c.png'),
        '--json',
      )
      const sheet = (r.json as { sheet: { cols: number; rows: number } }).sheet
      expect(sheet.cols).toBe(1)
      expect(sheet.rows).toBe(3)
    })
  })

  test('--ascii prints a text rendering without writing a file', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'fam.drw')
      writeFileSync(file, family)
      const r = run('sheet', file, '--ascii')
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString('utf8').length).toBeGreaterThan(0)
      expect(existsSync(join(dir, 'fam.sheet.png'))).toBe(false)
    })
  })

  test('a module with no sheetable drawing is an E022 error', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'empty.drw')
      writeFileSync(file, 'draw only(c) 8x8:\n  circle c 4:4 3 fill\n')
      const r = runJson('sheet', file, '--json')
      expect(r.exitCode).toBe(1)
      const diags = r.json as { code: string; message: string }[]
      expect(diags[0]?.code).toBe('E022')
    })
  })

  // A W010 fit gap raised while rendering a sheeted drawing surfaces in the sheet diagnostics,
  // the same way `build`/`render` surface it (ADR-0087) — non-fatal, exit 0.
  const GAP_SHEET = [
    'draw torso 12x20:',
    '  fill #6a5030 rect(0:0, 11:19)',
    '  pin shoulder 10:3',
    'draw arm 6x14:',
    '  fill #8a5a3a rect(0:0, 5:13)',
    '  pin shoulder 0:2',
    'draw fig 34x34:',
    '  stamp torso 4:2',
    '  pin far.spot 30:30',
    '  fit arm.shoulder far.spot', // arm lands in empty space → W010
    '',
  ].join('\n')

  test('--json surfaces a W010 fit gap from a sheeted drawing (still exit 0)', () => {
    withTmpDir((dir) => {
      const file = join(dir, 'gap.drw')
      writeFileSync(file, GAP_SHEET)
      const r = runJson('sheet', file, '--all', '--out', join(dir, 'gap.sheet.png'), '--json')
      expect(r.exitCode).toBe(0)
      const body = r.json as { diagnostics: { code: string; severity: string }[] }
      expect(body.diagnostics.some((d) => d.code === 'W010' && d.severity === 'warning')).toBe(true)
    })
  })
})
