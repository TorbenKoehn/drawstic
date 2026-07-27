// Export-path behaviour of `drawstic build`: which file each format line writes, and what happens
// when two of them land on the same path. A collision used to overwrite silently while the artifact
// list still reported both writes — one missing file, no diagnostic.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

describe('buildModule enforces the recipe-relative space before writing anything (ADR-0098 §2)', () => {
  /** Builds `src` into a fresh temp dir; returns the parent dir so a test can inspect what (if
   *  anything) got written outside `out/`, and the caught error, if any. */
  const attemptBuild = (src: string): { root: string; caught: unknown } => {
    const root = mkdtempSync(join(tmpdir(), 'drawstic-build-escape-'))
    const file = join(root, 'recipe.drw')
    writeFileSync(file, src, 'utf8')
    const engine = new Engine(root)
    const mod = engine.loadEntry(file)
    let caught: unknown
    try {
      buildModule(engine, mod, join(root, 'out'))
    } catch (e) {
      caught = e
    }
    return { root, caught }
  }

  test("'dir ../…' fails E018 and writes nothing — not even inside 'out/' (ADR-0098 §2: dir is never an escape)", () => {
    const { root, caught } = attemptBuild(`${DOT}\nexport dot:\n  dir ../pwned\n  png\n`)
    try {
      expect(caught).toBeInstanceOf(DrawsticError)
      expect((caught as DrawsticError).code).toBe('E018')
      expect((caught as DrawsticError).message).toContain('escapes the output directory')
      // Nothing landed next to the recipe (the escape target) …
      expect(existsSync(join(root, '..', 'pwned'))).toBe(false)
      expect(existsSync(join(root, 'pwned'))).toBe(false)
      // … and nothing landed inside 'out/' either: the build wrote zero bytes, not a partial set.
      expect(existsSync(join(root, 'out'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('the legacy `export name ../…/name:` spelling fails the same way, before any write', () => {
    const { root, caught } = attemptBuild(`${DOT}\nexport dot ../pwned3/dot:\n  png\n`)
    try {
      expect(caught).toBeInstanceOf(DrawsticError)
      expect((caught as DrawsticError).code).toBe('E018')
      expect((caught as DrawsticError).message).toContain('escapes the output directory')
      expect(existsSync(join(root, '..', 'pwned3'))).toBe(false)
      expect(existsSync(join(root, 'out'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a well-formed export among a batch still fails atomically when a later export escapes', () => {
    // The path check runs over every export before any of them writes, so an early, otherwise-valid
    // export does not get its files written while a later export in the same module is rejected.
    const { root, caught } = attemptBuild(
      `${DOT}\nexport dot ok/dot:\n  png\n\nexport dot ../pwned/dot:\n  png\n`,
    )
    try {
      expect(caught).toBeInstanceOf(DrawsticError)
      expect((caught as DrawsticError).code).toBe('E018')
      expect(existsSync(join(root, 'out'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('a well-formed build is unaffected: the validation pass adds no extra artifacts or reordering', () => {
    const { root, caught } = attemptBuild(`${DOT}\nexport dot dot:\n  png\n`)
    try {
      expect(caught).toBeUndefined()
      expect(readdirSync(join(root, 'out'))).toEqual(['dot.png'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
