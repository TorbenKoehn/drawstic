// Export-path behaviour of `drawstic build`: which file each format line writes, and what happens
// when two of them land on the same path. A collision used to overwrite silently while the artifact
// list still reported both writes — one missing file, no diagnostic.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModule, validateExport } from '../../src/build.js'
import { DrawsticError } from '../../src/diagnostic.js'
import { Engine } from '../../src/eval.js'

/** Writes `src` to a temp recipe, builds it into a temp out dir, returns the artifact paths. */
const build = (src: string): string[] => {
  const dir = mkdtempSync(join(tmpdir(), 'drawstic-build-'))
  try {
    const file = join(dir, 'recipe.drw')
    writeFileSync(file, src, 'utf8')
    const engine = new Engine(dir)
    const mod = engine.loadEntry(file)
    return buildModule(engine, mod, join(dir, 'out')).map((a) => a.path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const DOT = 'draw dot 4x4:\n  bg #223344\n'

describe('build export paths', () => {
  test('scales write @1 bare and @N suffixed', () => {
    const paths = build(`${DOT}\nexport dot dot:\n  png @1 @4\n`)
    expect(paths.map((p) => p.replace(/^.*[\\/]/, ''))).toEqual(['dot.png', 'dot@4x.png'])
  })

  test('two format lines writing the same path is an error, not a silent overwrite', () => {
    // `png 8x8` and `png 16x16` both land on `<base>.png`: the second used to overwrite the first
    // while `artifacts` still listed two writes.
    let caught: unknown
    try {
      build(`${DOT}\nexport dot dot:\n  png 8x8\n  png 16x16\n`)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DrawsticError)
    expect((caught as DrawsticError).code).toBe('E018')
    expect((caught as DrawsticError).message).toContain('both write')
  })

  test('`svg` and `path` in one export collide on <base>.svg and are rejected', () => {
    let caught: unknown
    try {
      build('path glyph:\n  move 0:0\n  line 4:4\n\nexport glyph glyph:\n  svg\n  path\n')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(DrawsticError)
    expect((caught as DrawsticError).code).toBe('E018')
  })
})

describe('validateExport — recipe-relative path grammar (ADR-0096 §6)', () => {
  const check = (basePath: string): void => {
    const engine = new Engine(process.cwd())
    const mod = engine.loadSource(
      `${DOT}\nexport dot ${basePath}:\n  png\n`,
      `${process.cwd()}\\mem-export-path.drw`,
      'mem-export-path.drw',
    )
    validateExport(engine, mod, mod.exports[0] as (typeof mod.exports)[number])
  }

  test('a plain single-segment path passes', () => {
    expect(() => check('gem')).not.toThrow()
  })

  test('a plain multi-segment path passes', () => {
    expect(() => check('icons/finance')).not.toThrow()
  })

  test('a `..` segment escapes the output directory (E018)', () => {
    expect(() => check('../x/y')).toThrow(DrawsticError)
    try {
      check('../x/y')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.code).toBe('E018')
        expect(e.message).toBe("export path '../x/y' escapes the output directory")
      }
    }
  })

  test('a leading `/` escapes the output directory (E018)', () => {
    try {
      check('/gem')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.code).toBe('E018')
        expect(e.message).toBe("export path '/gem' escapes the output directory")
      }
    }
  })

  test('a `.` segment escapes the output directory (E018)', () => {
    try {
      check('./gem')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.code).toBe('E018')
      }
    }
  })

  test('a file extension is rejected — the format line appends it (E018)', () => {
    try {
      check('gem.png')
      expect(false).toBe(true)
    } catch (e) {
      expect(e).toBeInstanceOf(DrawsticError)
      if (e instanceof DrawsticError) {
        expect(e.code).toBe('E018')
        expect(e.message).toBe(
          "export path 'gem.png' must not carry a file extension — the format line appends it",
        )
      }
    }
  })
})
