// Multi-target `export` blocks (ADR-0098): the target list, `dir`, the `file` name template and
// its six inflectors, the three-tier path composition, and the diagnostics each rejected spelling
// earns. The old single-target form is the `n = 1`, no-option case of the same grammar and must
// keep parsing byte-identically — that is what the "legacy form" assertions below pin.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModule, validateExport, validateExportPlan } from '../../src/build.js'
import { main } from '../../src/cli.js'
import { DrawsticError } from '../../src/diagnostic.js'
import { Engine, type ModuleRecord } from '../../src/eval.js'
import { format } from '../../src/fmt.js'
import { lintModule } from '../../src/lint.js'

let n = 0

/** Loads `src` as a module in `dir` (default: the repo root), without touching the filesystem. */
const load = (src: string, dir = process.cwd()): { engine: Engine; mod: ModuleRecord } => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, join(dir, `mem-export-${n++}.drw`), 'export.drw')
  return { engine, mod }
}

/** The composed `basePath` of every resolved export target, in declaration order. */
const basePaths = (src: string): string[] => load(src).mod.exports.map((ex) => ex.basePath)

/** Runs `fn`, asserting it threw a {@link DrawsticError}, and returns it. */
const thrown = (fn: () => unknown): DrawsticError => {
  try {
    fn()
  } catch (e) {
    if (e instanceof DrawsticError) {
      return e
    }
    throw e
  }
  throw new Error('expected a DrawsticError, but nothing was thrown')
}

/** Runs the CLI in-process with stdout captured, and parses its `--json` payload. */
const runJson = (...argv: string[]): { readonly exitCode: number; readonly json: unknown } => {
  const chunks: Buffer[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((c: string | Uint8Array) => {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c))
    return true
  }) as typeof process.stdout.write
  try {
    const exitCode = main(argv)
    return { exitCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } finally {
    process.stdout.write = original
  }
}

/** Writes `src` to a fresh temp recipe, runs `fn` against it, and cleans up. */
const withRecipe = <T>(src: string, fn: (file: string, dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), 'drawstic-export-block-'))
  try {
    const file = join(dir, 'recipe.drw')
    writeFileSync(file, src, 'utf8')
    return fn(file, dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const DOT = 'draw dot 4x4:\n  bg #223344\n'

describe('export block — target list (ADR-0098 §1)', () => {
  test('three targets expand to three definitions, in order, each with its own span', () => {
    const { mod } = load(`${DOT}\nexport a, b, c:\n  png\n`)
    expect(mod.exports.map((ex) => ex.name)).toEqual(['a', 'b', 'c'])
    expect(mod.exports.map((ex) => ex.basePath)).toEqual(['a', 'b', 'c'])
    // Each definition points at its OWN target token (line 4: `export a, b, c:`), so a diagnostic
    // names the target that caused it rather than the whole block.
    expect(mod.exports.map((ex) => [ex.span.line, ex.span.column])).toEqual([
      [4, 8],
      [4, 11],
      [4, 14],
    ])
    // The block's format lines and its group are shared, not copied per target.
    expect(mod.exports[0]?.formats).toBe(mod.exports[1]?.formats as never)
    expect(mod.exports[0]?.group).toBe(mod.exports[1]?.group as never)
    expect(mod.exports[0]?.group.span).toEqual({ line: 4, column: 1, endLine: 4, endColumn: 7 })
  })

  test('an omitted path defaults to the target name, identically to the legacy spelling', () => {
    const omitted = load(`${DOT}\nexport island:\n  png @1 @2\n`).mod.exports[0]
    const legacy = load(`${DOT}\nexport island island:\n  png @1 @2\n`).mod.exports[0]
    expect(omitted?.basePath).toBe('island')
    // 111 of the corpus's 145 export paths were this verbatim restatement of the name: the two
    // spellings must resolve to the same definition, down to the span and the format lines.
    expect(legacy?.name).toBe(omitted?.name as string)
    expect(legacy?.basePath).toBe(omitted?.basePath as string)
    expect(legacy?.span).toEqual(omitted?.span as never)
    expect(legacy?.formats).toEqual(omitted?.formats as never)
    // The only recorded difference is which tier supplied the path.
    expect(omitted?.group.explicitPaths).toEqual([undefined])
    expect(legacy?.group.explicitPaths).toEqual(['island'])
  })
})

describe('export block — path composition (ADR-0098 §2)', () => {
  test('`dir` prefixes every target of the block', () => {
    expect(basePaths(`${DOT}\nexport pickaxe, axe:\n  dir assets/items\n  png\n`)).toEqual([
      'assets/items/pickaxe',
      'assets/items/axe',
    ])
  })

  test('precedence is explicit path > file > name, mixed inside one block', () => {
    // The ADR's worked example: four names take the template, `torch` takes its own path, and both
    // tiers land under the same `dir`.
    expect(
      basePaths(
        `${DOT}\nexport pickaxe, axe, key, coinPouch, torch hand/torch:\n  dir assets/items\n  file "{kebab base}"\n  png @1 @4\n  atlasJson\n`,
      ),
    ).toEqual([
      'assets/items/pickaxe',
      'assets/items/axe',
      'assets/items/key',
      'assets/items/coin-pouch',
      'assets/items/hand/torch',
    ])
  })
})

describe('export block — file templates (ADR-0098 §3, §5)', () => {
  test('holes, inflector chains and literal affixes render a filename stem', () => {
    const stem = (template: string): string =>
      basePaths(`${DOT}\nexport coinPouch:\n  file "${template}"\n  png\n`)[0] ?? ''
    expect(stem('{base}')).toBe('coinPouch')
    expect(stem('{kebab base}')).toBe('coin-pouch')
    expect(stem('{snake base}')).toBe('coin_pouch')
    // Prefix juxtaposition, rightmost applied first.
    expect(stem('{upper snake base}')).toBe('COIN_POUCH')
    expect(stem('icon-{kebab base}')).toBe('icon-coin-pouch')
    expect(stem('{kebab base}-icon')).toBe('coin-pouch-icon')
  })

  test('`\\{`/`\\}` escape a literal brace — which then fails the export-path grammar', () => {
    const { engine, mod } = load(`${DOT}\nexport dot:\n  file "\\{{base}\\}"\n  png\n`)
    const ex = mod.exports[0] as (typeof mod.exports)[number]
    expect(ex.basePath).toBe('{dot}')
    // Escaping works at the template level; a brace is still not a legal path segment character
    // (ADR-0096 §6), so the composed path is rejected by the unchanged validator.
    expect(thrown(() => validateExport(engine, mod, ex)).code).toBe('E018')
  })

  test('the six inflectors, incl. the digit rule and the acronym rule', () => {
    const table = (inflector: string): string[] =>
      basePaths(
        `${DOT}\nexport coinPouch, chat16, HTMLIcon, already_snake:\n  file "{${inflector} base}"\n  png\n`,
      )
    expect(table('snake')).toEqual(['coin_pouch', 'chat16', 'html_icon', 'already_snake'])
    expect(table('kebab')).toEqual(['coin-pouch', 'chat16', 'html-icon', 'already-snake'])
    expect(table('camel')).toEqual(['coinPouch', 'chat16', 'htmlIcon', 'alreadySnake'])
    expect(table('pascal')).toEqual(['CoinPouch', 'Chat16', 'HtmlIcon', 'AlreadySnake'])
    expect(table('upper')).toEqual(['COINPOUCH', 'CHAT16', 'HTMLICON', 'ALREADY_SNAKE'])
    expect(table('lower')).toEqual(['coinpouch', 'chat16', 'htmlicon', 'already_snake'])
    // Digits never split, so every case inflector is a no-op on the corpus's `chat16`/`videocall64`
    // rather than a silent rename; an acronym run splits before its final capital.
  })
})

describe('export block — E028, one code per malformed template (ADR-0098 §10)', () => {
  /** Every template below sits at `  file "…"` on line 5, so the string opens at column 8. */
  const fail = (template: string): DrawsticError =>
    thrown(() => load(`${DOT}\nexport dot:\n  file "${template}"\n  png\n`))

  test("'{ext}' names what the format line owns", () => {
    const e = fail('{snake base}.{ext}')
    expect(e.code).toBe('E028')
    expect(e.message).toBe(
      "'{ext}' is not a template variable — the format line owns the extension",
    )
    expect(e.hint).toBe(
      `write 'file "{snake base}"'; a png+svg block would render two different names`,
    )
    // positioned at the offending '{': column 8 (the quote) + 1 + offset 13
    expect([e.span.line, e.span.column]).toEqual([5, 22])
  })

  test("'{full}' dies with '{ext}'", () => {
    expect(fail('{full}').message).toBe(
      "'{full}' is not a template variable — the format line owns the extension",
    )
  })

  test("'{date}' is rejected outright — Drawstic has no clock", () => {
    const e = fail('{date}')
    expect(e.code).toBe('E028')
    expect(e.message).toBe("'date' is not a template variable — Drawstic has no clock")
    expect(e.hint).toContain('pure function of its source')
    expect([e.span.line, e.span.column]).toEqual([5, 9])
  })

  test("'plural' is a burned inflector name, with the deterministic workaround in the hint", () => {
    const e = fail('{plural base}')
    expect(e.code).toBe('E028')
    expect(e.message).toBe(
      "unknown inflector 'plural' — available: snake, camel, pascal, kebab, upper, lower",
    )
    expect(e.hint).toBe(
      "pluralization needs a dictionary and cannot be deterministic — name the target's path explicitly: 'export coin coins:'",
    )
  })

  test("'title' is a burned inflector name and points at 'pascal'", () => {
    const e = fail('{title base}')
    expect(e.message).toBe(
      "unknown inflector 'title' — available: snake, camel, pascal, kebab, upper, lower",
    )
    expect(e.hint).toBe("use 'pascal'")
  })

  test('an unknown variable names the only variable there is', () => {
    expect(fail('{name}').message).toBe(
      "unknown template variable 'name' — the only variable is 'base' (the target's drawing name)",
    )
  })

  test('an empty hole', () => {
    const e = fail('{}')
    expect(e.code).toBe('E028')
    expect(e.message).toBe("empty '{}' in a file template")
    expect(e.hint).toBe("name a variable, e.g. '{base}'")
  })

  test('an unterminated hole', () => {
    const e = fail('{base')
    expect(e.message).toBe("unterminated '{' in a file template")
    expect(e.hint).toBe("close it, or escape a literal brace as '\\{'")
    expect([e.span.line, e.span.column]).toEqual([5, 9])
  })

  test('an escape a filename cannot carry', () => {
    const e = fail('a\\nb')
    expect(e.code).toBe('E028')
    expect(e.message).toBe("'\\n' is not allowed in a file template")
    expect(e.hint).toBe(
      "a filename cannot contain a newline, tab or quote; only '\\{' and '\\}' are escapable here",
    )
    expect([e.span.line, e.span.column]).toEqual([5, 10])
  })
})

describe('export block — E004, the fixed block shape (ADR-0098 §8)', () => {
  const fail = (src: string): DrawsticError => thrown(() => load(`${DOT}\n${src}`))

  test("'dir' after a format line", () => {
    const e = fail('export dot:\n  png\n  dir assets\n')
    expect(e.code).toBe('E004')
    expect(e.message).toBe("'dir' after a format line")
    expect(e.hint).toBe("'dir' and 'file' come before the format lines")
  })

  test("'file' after a format line", () => {
    expect(fail('export dot:\n  png\n  file "{base}"\n').code).toBe('E004')
  })

  test("a second 'dir'", () => {
    const e = fail('export dot:\n  dir a\n  dir b\n  png\n')
    expect(e.code).toBe('E004')
    expect(e.message).toBe("a second 'dir' in one export block")
  })

  test("a second 'file'", () => {
    expect(fail('export dot:\n  file "{base}"\n  file "x"\n  png\n').message).toBe(
      "a second 'file' in one export block",
    )
  })

  test('a trailing comma before the colon', () => {
    const e = fail('export a, b,:\n  png\n')
    expect(e.code).toBe('E004')
    expect(e.message).toBe("trailing ',' in the export target list")
  })
})

describe('export block — E018, composed paths and artifact collisions (ADR-0098 §2, §10)', () => {
  test("a rendered 'file' containing '/' is a directory in the wrong place", () => {
    const e = thrown(() => load(`${DOT}\nexport dot:\n  file "sub/{base}"\n  png\n`))
    expect(e.code).toBe('E018')
    expect(e.message).toBe(
      "a 'file' template renders the filename, not a directory — put directories in 'dir'",
    )
    // positioned on the `file` line, not on a target
    expect([e.span.line, e.span.column]).toEqual([5, 3])
  })

  test("'dir ../x' fails the same check a per-target '..' fails — it composes, never escapes", () => {
    const { engine, mod } = load(`${DOT}\nexport dot:\n  dir ../x\n  png\n`)
    const e = thrown(() => validateExport(engine, mod, mod.exports[0] as never))
    expect(e.code).toBe('E018')
    expect(e.message).toBe("export path '../x/dot' escapes the output directory")
  })

  test('a `dir` carrying a file extension is rejected on the composed path', () => {
    const { engine, mod } = load(`${DOT}\nexport dot:\n  dir assets.v2\n  png\n`)
    expect(thrown(() => validateExport(engine, mod, mod.exports[0] as never)).message).toBe(
      "export path 'assets.v2/dot' must not carry a file extension — the format line appends it",
    )
  })

  test('two targets of one block resolving to the same artifact', () => {
    const { mod } = load(`${DOT}\nexport Chat, chat:\n  file "{lower base}"\n  png\n`)
    const e = thrown(() => validateExportPlan(mod))
    expect(e.code).toBe('E018')
    expect(e.message).toBe("two exports both write 'chat.png' — 'Chat' and 'chat'")
  })

  test('two separate exports resolving to the same artifact — the lifted check', () => {
    // Never caught before: the collision check ran against a per-export artifact list, so this
    // overwrote silently, last-wins.
    const { mod } = load(`${DOT}\nexport dot foo:\n  png\n\nexport dot foo:\n  png z9\n`)
    const e = thrown(() => validateExportPlan(mod))
    expect(e.code).toBe('E018')
    expect(e.message).toBe("two exports both write 'foo.png' — 'dot' and 'dot'")
  })

  test('`check` reports the cross-export collision before `build` writes anything', () => {
    withRecipe(`${DOT}\nexport dot a/one:\n  png\n\nexport dot a/one:\n  png\n`, (file, dir) => {
      const r = runJson('check', file, '--json')
      expect(r.exitCode).toBe(1)
      const diags = r.json as { code: string; message: string }[]
      expect(diags).toContainEqual(
        expect.objectContaining({
          code: 'E018',
          message: "two exports both write 'a/one.png' — 'dot' and 'dot'",
        }),
      )
      // A dry run: `check` never writes, so the collision is reported with nothing on disk.
      expect(existsSync(join(dir, 'a'))).toBe(false)
    })
  })
})

describe('export block — W019 / W016 (ADR-0098 §10)', () => {
  /** Loads `src` from a recipe inside `dir`, so `W016` has a directory name to compare against. */
  const lintIn = (dir: string, src: string): ReturnType<typeof lintModule> => {
    const { engine, mod } = load(src, join(process.cwd(), dir))
    return lintModule(engine, mod)
  }

  test('W019 (a): every target carries an explicit path sharing a directory prefix', () => {
    const diags = lintIn('icons', `${DOT}\nexport dot ui/a, dot2 ui/b:\n  png\n`)
    expect(diags).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        code: 'W019',
        message: "all 2 targets of this export block share the path prefix 'ui/'",
        hint: "hoist the shared 'ui/' prefix into 'dir ui'",
      }),
    )
  })

  test('W019 (a) fires once per block, not once per target', () => {
    const diags = lintIn('icons', `${DOT}\nexport a ui/a, b ui/b, c ui/c, d ui/d:\n  png\n`)
    expect(diags.filter((d) => d.code === 'W019')).toHaveLength(1)
  })

  test("W019 (b): a single target plus a 'dir' says the same thing in one line", () => {
    const diags = lintIn('icons', `${DOT}\nexport dot:\n  dir ui\n  png\n`)
    expect(diags).toContainEqual(
      expect.objectContaining({
        code: 'W019',
        message: "'dir' on a single-target export block",
        hint: "a single target needs no 'dir' — write 'export dot ui/dot:'",
        line: 5,
        column: 3,
      }),
    )
  })

  test("W019 (b) is silent when the block also declares a 'file' template", () => {
    const diags = lintIn(
      'icons',
      `${DOT}\nexport coinPouch:\n  dir ui\n  file "{kebab base}"\n  png\n`,
    )
    expect(diags.some((d) => d.code === 'W019')).toBe(false)
  })

  test('W019 is silent on a multi-target block that uses `dir` correctly', () => {
    const diags = lintIn('icons', `${DOT}\nexport a, b, c:\n  dir ui\n  png\n`)
    expect(diags.some((d) => d.code === 'W019')).toBe(false)
  })

  test('W016 positions on the `dir` line and names `dir` in its hint', () => {
    const diags = lintIn('showcase', `${DOT}\nexport a, b:\n  dir showcase\n  png\n`)
    expect(diags).toContainEqual(
      expect.objectContaining({
        code: 'W016',
        message: "export dir 'showcase' repeats the recipe's own directory 'showcase'",
        hint: "build writes next to the recipe — drop the 'showcase/' prefix from 'dir'",
        line: 5,
        column: 3,
      }),
    )
    // once per block, not once per target
    expect(diags.filter((d) => d.code === 'W016')).toHaveLength(1)
  })
})

describe('export block — fmt canonicalizes the header (ADR-0098 §8)', () => {
  test('any target spacing collapses to ", ", and the result is a fixed point', () => {
    const canonical = 'export a, b, c:\n  png\n'
    expect(format('export a ,b,  c:\n  png\n')).toBe(canonical)
    expect(format('export a,b,c:\n  png\n')).toBe(canonical)
    expect(format(canonical)).toBe(canonical)
    expect(format(format('export a ,b,  c:\n  png\n'))).toBe(format('export a ,b,  c:\n  png\n'))
  })

  test('a trailing comment and a per-target path survive verbatim', () => {
    expect(format('export a ,b hand/b: # family\n  png\n')).toBe(
      'export a, b hand/b: # family\n  png\n',
    )
  })

  test('a line that only looks like an export header is left alone', () => {
    expect(format('export = 1\n')).toBe('export = 1\n')
  })
})

describe('export block — sidecars and the brief', () => {
  test("a `dir` + `file` atlas block: every sidecar's image field is the resolved stem", () => {
    const src = [
      'draw tileA 2x2:',
      '  bg rgb(255, 0, 0)',
      '',
      'draw tileB 2x2:',
      '  bg rgb(0, 255, 0)',
      '',
      'atlas tileSet:',
      '  sprites tileA, tileB',
      '  tile 2x2',
      '',
      'export tileSet:',
      '  dir sheets',
      '  file "{kebab base}"',
      '  png',
      '  tiled',
      '  atlasJson',
      '  aseprite',
      '',
    ].join('\n')
    withRecipe(src, (file, dir) => {
      const engine = new Engine(dir)
      const mod = engine.loadEntry(file)
      const out = join(dir, 'out')
      const paths = buildModule(engine, mod, out).map((a) => a.path.replace(/\\/g, '/'))
      expect(paths.map((p) => p.slice(p.indexOf('/out/') + 5))).toEqual([
        'sheets/tile-set.png',
        'sheets/tile-set.tsj',
        'sheets/tile-set.json',
        'sheets/tile-set.aseprite.json',
      ])
      const sheets = join(out, 'sheets')
      // Each sidecar must point at the png the SAME block wrote — the stem, not the drawing name.
      expect(JSON.parse(readFileSync(join(sheets, 'tile-set.tsj'), 'utf8')).image).toBe(
        'tile-set.png',
      )
      expect(JSON.parse(readFileSync(join(sheets, 'tile-set.json'), 'utf8')).meta.image).toBe(
        'tile-set.png',
      )
      expect(
        JSON.parse(readFileSync(join(sheets, 'tile-set.aseprite.json'), 'utf8')).meta.image,
      ).toBe('tile-set.png')
    })
  })

  test('`context --json` reports one entry per resolved target, with composed base paths', () => {
    const src = [
      'draw chat 2x2:',
      '  bg #fff',
      '',
      'draw videoCall 2x2:',
      '  bg #eee',
      '',
      'draw feed 2x2:',
      '  bg #ddd',
      '',
      'draw share 2x2:',
      '  bg #ccc',
      '',
      'export chat, videoCall, feed, share:',
      '  dir communication',
      '  file "{kebab base}"',
      '  png @1 @2',
      '  svg ids',
      '',
    ].join('\n')
    withRecipe(src, (file) => {
      const r = runJson('context', file, '--json')
      expect(r.exitCode).toBe(0)
      const brief = (
        r.json as {
          context: {
            exports: { source: string; basePath: string; formats: { format: string }[] }[]
          }
        }
      ).context
      // A 4-target block is 4 brief entries, in declaration order, each fully composed.
      expect(brief.exports.map((e) => [e.source, e.basePath])).toEqual([
        ['chat', 'communication/chat'],
        ['videoCall', 'communication/video-call'],
        ['feed', 'communication/feed'],
        ['share', 'communication/share'],
      ])
      // The brief's shape is unchanged: every entry carries the block's own format lines.
      expect(brief.exports[0]?.formats.map((f) => f.format)).toEqual(['png', 'svg'])
    })
  })
})
