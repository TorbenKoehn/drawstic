// The Drawstic CLI (spec §16, ADR-0008/0030/0031):
//   drawstic check <file> [--json]
//   drawstic fmt <file> [--check] [--json]
//   drawstic context <file> [--json]
//   drawstic build <file> [--out <dir>] [--json]
//   drawstic render <file>#<drawing>[(args)] [--png@N] [--out <path>] [--stdout]
//                   [--ascii] [--preview] [--silhouette] [--inspect] [--explain]
//                   [--grid N] [--diff <png>] [--mode pixel|smooth] [--json]
// A parametric drawing takes literal arguments in the fragment (ADR-0067):
//   drawstic render parts.drw#house(#c04040, 3)
// `--grid`/`--diff` are debug-only PNG-output aids (P3 drawing aids): `--grid`
// burns a coordinate overlay into the written PNG only; `--diff` compares the
// fresh (UNgridded) render against a previous PNG. Neither ever touches
// `build` exports.
// Every command accepts --json; exit code is non-zero iff an error
// diagnostic was produced.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DrawDefinition, FormatLine, Statement } from './ast.js'
import { buildModule, validateExport } from './build.js'
import { toHexColor } from './color.js'
import {
  buildRubric,
  type CritiqueDrawing,
  critiqueCheckDiagnostic,
  critiqueFamily,
  critiqueSprite,
  type FamilyMetrics,
  type PaletteTarget,
  resolveProfile,
} from './critique.js'
import {
  type Diagnostic,
  DrawsticError,
  ERROR_CODE,
  error,
  formatDiagnostic,
  type TextSpan,
} from './diagnostic.js'
import {
  defaultBudget,
  Engine,
  type ExplainRecord,
  type ModuleRecord,
  type PlacementRecord,
} from './eval.js'
import { format, formatDiff } from './fmt.js'
import { inspectSprite } from './inspect.js'
import { censusModule, lintModule, type ModuleCensus } from './lint.js'
import { type DecodedPng, decodePng, encodePngRgba } from './png.js'
import {
  applyGridOverlay,
  cropSprite,
  diffRasters,
  fitSprite,
  type RasterDiff,
  silhouetteSprite,
  spritePreviewStats,
  spriteToAnsi,
  spriteToAscii,
} from './preview.js'
import { scaleBitmap } from './raster.js'
import { buildSheet, type SheetLayout, selectCritiqueFamily } from './sheet.js'
import type { Light, OcclusionResult, Region, Sprite } from './values.js'

// union of every subcommand's flags; each `run*` handler reads only the
// ones it recognizes and ignores the rest.
type CliArguments = {
  readonly command: string
  readonly target: string | null
  readonly json: boolean
  readonly check: boolean
  readonly stdout: boolean
  readonly ascii: boolean
  readonly preview: boolean
  readonly silhouette: boolean
  readonly inspect: boolean
  readonly lint: boolean
  readonly rows: boolean
  readonly diff: boolean
  readonly diffPath: string | null
  readonly grid: number | null
  readonly out: string | null
  readonly cols: number | null
  readonly all: boolean
  readonly fit: { readonly width: number; readonly height: number } | null
  readonly crop: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  } | null
  readonly pngScale: number
  readonly mode: 'pixel' | 'smooth' | null
  readonly budgetSteps: number | null
  readonly as: string | null
  readonly strict: boolean
  readonly family: readonly string[] | null
  readonly explain: boolean
}

type Writable<T> = { -readonly [P in keyof T]: T[P] }

/**
 * Best-effort argv parser: unrecognized flags and a second bare positional
 * are silently ignored rather than erroring — there is no "unknown flag"
 * diagnostic at this layer.
 */
const parseArguments = (argv: string[]): CliArguments => {
  const cli: Writable<CliArguments> = {
    command: argv[0] ?? 'help',
    target: null,
    json: false,
    check: false,
    stdout: false,
    ascii: false,
    preview: false,
    silhouette: false,
    inspect: false,
    lint: false,
    rows: false,
    diff: false,
    diffPath: null,
    grid: null,
    out: null,
    cols: null,
    all: false,
    fit: null,
    crop: null,
    pngScale: 1,
    mode: null,
    budgetSteps: null,
    as: null,
    strict: false,
    family: null,
    explain: false,
  }

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (a === '--json') {
      cli.json = true
    } else if (a === '--check') {
      cli.check = true
    } else if (a === '--stdout') {
      cli.stdout = true
    } else if (a === '--ascii') {
      cli.ascii = true
    } else if (a === '--preview') {
      cli.preview = true
    } else if (a === '--silhouette') {
      cli.silhouette = true
    } else if (a === '--inspect') {
      cli.inspect = true
    } else if (a === '--lint') {
      cli.lint = true
    } else if (a === '--rows') {
      cli.rows = true
    } else if (a === '--diff') {
      // `fmt --diff` is a boolean toggle; `render --diff <png>` takes a path
      // (the command is already known — `argv[0]` — so no cross-command ambiguity).
      if (cli.command === 'render') {
        cli.diffPath = argv[++i] ?? null
      } else {
        cli.diff = true
      }
    } else if (a === '--grid') {
      const n = Number.parseInt(argv[++i] ?? '', 10)
      cli.grid = Number.isInteger(n) && n > 0 ? n : null
    } else if (a === '--out') {
      cli.out = argv[++i] ?? null
    } else if (a === '--cols') {
      const n = Number.parseInt(argv[++i] ?? '', 10)
      cli.cols = Number.isInteger(n) && n > 0 ? n : null
    } else if (a === '--all') {
      cli.all = true
    } else if (a === '--fit') {
      cli.fit = parseSizeArg(argv[++i] ?? '')
    } else if (a === '--crop') {
      cli.crop = parseCropArg(argv[++i] ?? '', argv[++i] ?? '')
    } else if (a === '--mode') {
      const m = argv[++i]
      if (m === 'pixel' || m === 'smooth') {
        cli.mode = m
      }
    } else if (a === '--budget') {
      cli.budgetSteps = Number.parseInt(argv[++i] ?? '0', 10) || null
    } else if (a === '--as') {
      cli.as = argv[++i] ?? null
    } else if (a === '--strict') {
      cli.strict = true
    } else if (a === '--explain') {
      cli.explain = true
    } else if (a === '--family') {
      const names = (argv[++i] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      cli.family = names.length > 0 ? names : null
    } else if (/^--png@\d+$/.test(a)) {
      cli.pngScale = Number.parseInt(a.slice(6), 10)
    } else if (!a.startsWith('--') && cli.target === null) {
      cli.target = a
    }
  }
  return cli
}

/** Parses a `WxH` size argument (`--fit`, `--crop`'s size part); `null` if malformed. */
const parseSizeArg = (
  value: string,
): { readonly width: number; readonly height: number } | null => {
  const m = /^(\d+)x(\d+)$/.exec(value)
  return m
    ? { width: Number.parseInt(m[1] ?? '0', 10), height: Number.parseInt(m[2] ?? '0', 10) }
    : null
}

/**
 * Parses `--crop <x:y> <WxH>`; origin may be negative (`cropSprite` clamps
 * the result to the sprite's bounds). `null` if either part is malformed.
 */
const parseCropArg = (
  origin: string,
  size: string,
): {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
} | null => {
  const o = /^(-?\d+):(-?\d+)$/.exec(origin)
  const s = parseSizeArg(size)
  return o && s
    ? {
        x: Number.parseInt(o[1] ?? '0', 10),
        y: Number.parseInt(o[2] ?? '0', 10),
        width: s.width,
        height: s.height,
      }
    : null
}

/**
 * Emits diagnostics — JSON `{diagnostics}` (or `{diagnostics, context: extra}`
 * when `extra` is given) to stdout, or human-readable positioned lines to
 * stderr. Returns the process exit code: non-zero iff any diagnostic has
 * `severity: 'error'` — the contract every `run*` handler relies on.
 */
const emit = (diags: Diagnostic[], json: boolean, extra?: unknown): number => {
  if (json) {
    process.stdout.write(
      `${JSON.stringify(extra === undefined ? diags : { diagnostics: diags, context: extra }, null, 1)}\n`,
    )
  } else {
    for (const d of diags) {
      process.stderr.write(`${formatDiagnostic(d)}\n`)
    }
  }
  return diags.some((d) => d.severity === 'error') ? 1 : 0
}

/**
 * Like {@link emit}, but for handlers that add fields alongside
 * `diagnostics` at the top level (`{diagnostics, ...payload}`) rather than
 * nested under `context` — used by `check --rows` and `build`.
 */
const emitObject = (
  diags: Diagnostic[],
  json: boolean,
  payload: Record<string, unknown> = {},
): number => {
  if (json) {
    process.stdout.write(`${JSON.stringify({ diagnostics: diags, ...payload }, null, 1)}\n`)
  } else {
    for (const d of diags) {
      process.stderr.write(`${formatDiagnostic(d)}\n`)
    }
  }
  return diags.some((d) => d.severity === 'error') ? 1 : 0
}

/**
 * Normalizes a caught error to a `Diagnostic`: a {@link DrawsticError}
 * preserves its code/position/hint; anything else (a host exception, a
 * programming error) becomes an unpositioned `E000` at 1:1.
 */
const toDiagnostic = (e: unknown, file: string): Diagnostic => {
  if (e instanceof DrawsticError) {
    return e.toDiagnostic()
  }
  return {
    severity: 'error',
    code: 'E000',
    message: e instanceof Error ? e.message : String(e),
    file,
    line: 1,
    column: 1,
  }
}

/**
 * Builds a fresh {@link Engine} for one CLI invocation, applying `--budget`
 * and `--mode` overrides.
 */
const createEngine = (cli: CliArguments): Engine => {
  const budget = defaultBudget()
  if (cli.budgetSteps) {
    budget.maxSteps = cli.budgetSteps
  }
  const engine = new Engine(process.cwd(), budget)
  if (cli.mode) {
    engine.modeOverride = cli.mode
  }
  return engine
}

// ── check ───────────────────────────────────────────────────────────────────

/**
 * Runs `drawstic check`: parse + deep semantic validation. Renders every
 * non-parametric `draw`/`tileset`/`atlas` and validates every `export`
 * (deduping identical diagnostics), so render-time errors (budget, type,
 * region) surface here, not just at `build`/`render`. `--lint` folds in
 * authoring warnings ({@link lintModule}); `--rows` reports per-drawing
 * pixel-row width facts alongside the diagnostics.
 */
const runCheck = (cli: CliArguments): number => {
  const file = cli.target ?? ''
  const diags: Diagnostic[] = []
  let rows: RowMetadata[] = []
  let census: ModuleCensus | undefined
  try {
    const engine = createEngine(cli)
    const mod = engine.loadEntry(file)
    rows = rowMetadata(mod)
    const seen = new Set<string>()
    const collect = (fn: () => void): void => {
      try {
        fn()
      } catch (e) {
        const d = toDiagnostic(e, file)
        const key = `${d.code}:${d.file}:${d.line}:${d.column}:${d.message}`
        if (!seen.has(key)) {
          seen.add(key)
          diags.push(d)
        }
      }
    }
    // deep validation: render every non-parametric drawing and every export
    for (const [, entry] of mod.definitions) {
      if (
        entry.kind === 'draw' &&
        entry.module === mod &&
        (entry.definition.params?.length ?? 0) === 0
      ) {
        collect(() => engine.renderDraw(entry, [], entry.definition.span))
      }
      if (entry.kind === 'tileset' && entry.module === mod) {
        collect(() => engine.buildTileset(entry, entry.definition.span))
      }
      if (entry.kind === 'atlas' && entry.module === mod) {
        collect(() => engine.buildAtlas(entry, entry.definition.span))
      }
    }
    for (const ex of mod.exports) {
      collect(() => validateExport(engine, mod, ex))
    }
    if (cli.lint) {
      diags.push(...lintModule(engine, mod))
      census = censusModule(engine, mod)
    }
  } catch (e) {
    diags.push(toDiagnostic(e, file))
  }
  const payload = {
    ...(cli.rows ? { rows } : {}),
    ...(census ? { census } : {}),
  }
  return Object.keys(payload).length > 0
    ? emitObject(diags, cli.json, payload)
    : emit(diags, cli.json)
}

/**
 * Per-drawing pixel-row width facts, surfaced via `check --rows` for
 * catching ragged `pixels:` literals before they hit `E002`
 * (pixelsSizeMismatch); `firstRaggedRow` is `null` if every row matches
 * `expectedWidth`.
 */
type RowMetadata = {
  readonly draw: string
  readonly expectedWidth: number
  readonly expectedHeight: number
  readonly actualWidths: readonly number[]
  readonly firstRaggedRow: {
    readonly row: number
    readonly width: number
    readonly expectedWidth: number
  } | null
}

/**
 * Computes {@link RowMetadata} for every `pixels:`-bearing drawing defined
 * directly in `mod` (not imported ones).
 */
const rowMetadata = (mod: ModuleRecord): RowMetadata[] => {
  const out: RowMetadata[] = []
  for (const [, entry] of mod.definitions) {
    if (entry.kind !== 'draw' || entry.module !== mod) {
      continue
    }
    const pixels = entry.definition.body.find(
      (stmt): stmt is Extract<Statement, { readonly kind: 'pixels' }> => stmt.kind === 'pixels',
    )
    if (!pixels) {
      continue
    }
    const actualWidths = pixels.rows.map((row) => row.text.length)
    const expectedWidth = entry.definition.size?.width ?? actualWidths[0] ?? 0
    const expectedHeight = entry.definition.size?.height ?? pixels.rows.length
    const first = actualWidths.findIndex((width) => width !== expectedWidth)
    out.push({
      draw: entry.definition.name,
      expectedWidth,
      expectedHeight,
      actualWidths,
      firstRaggedRow:
        first < 0 ? null : { row: first + 1, width: actualWidths[first] ?? 0, expectedWidth },
    })
  }
  return out
}

// ── fmt ─────────────────────────────────────────────────────────────────────

/**
 * Runs `drawstic fmt`: `--check` reports (never writes) and fails with `E021`
 * (`format`) on unformatted input — with `--json` the report includes the
 * {@link FormatDiff}; `--stdout` prints the canonical form without touching
 * the file; otherwise the file is rewritten in place only if it changed.
 */
const runFormat = (cli: CliArguments): number => {
  const file = cli.target ?? ''
  const diags: Diagnostic[] = []
  let diff: ReturnType<typeof formatDiff> | undefined
  try {
    const source = readFileSync(resolve(file), 'utf8')
    const formatted = format(source)
    diff = formatDiff(source, formatted, cli.diff)
    if (cli.check) {
      if (formatted !== source) {
        diags.push({
          severity: 'error',
          code: ERROR_CODE.format,
          message: 'file is not canonically formatted',
          file,
          line: diff.firstChangedLine ?? 1,
          column: 1,
          hint: 'run drawstic fmt without --check',
        })
      }
    } else if (cli.stdout) {
      process.stdout.write(formatted)
      return 0
    } else if (formatted !== source) {
      writeFileSync(resolve(file), formatted, 'utf8')
    }
  } catch (e) {
    diags.push(toDiagnostic(e, file))
  }
  if (cli.json && cli.check) {
    return emitObject(diags, true, { format: diff })
  }
  return emit(diags, cli.json)
}

// ── context (ADR-0008) ──────────────────────────────────────────────────────

/**
 * The design brief emitted by `drawstic context` (ADR-0008): a single
 * resolved snapshot of a file's active theme, imported drawings/functions,
 * and export plans, so an agent needn't read every imported file.
 */
type Brief = {
  readonly file: string
  readonly theme: {
    readonly palette: { readonly key: string; readonly hex: string; readonly source: string }[]
    readonly style: { readonly source: string; readonly text: string }[]
    readonly size: string | null
    readonly mode: string | null
    readonly font: string | null
    readonly light: string | null
    readonly figure: string | null
  }
  readonly drawings: readonly {
    readonly name: string
    readonly size: string
    readonly sizeSource: string
    readonly localPaletteKeys: readonly string[]
    /**
     * Names of themes applied by a drawing-local `use` (E11): empty when the
     * drawing applies none. `themePalette` is the palette those local `use`s
     * contribute (folded over the file theme) — the palette this drawing
     * actually sees — surfaced per-drawing because it never reaches the
     * file-level `theme` snapshot above (that only reflects file-level `use`).
     */
    readonly themes: readonly string[]
    readonly themePalette: readonly {
      readonly key: string
      readonly hex: string
      readonly source: string
    }[]
    readonly largePreviewHint: string | null
    readonly params: readonly string[] | null
    readonly preview: string | null
  }[]
  readonly exports: readonly {
    readonly source: string
    readonly basePath: string
    readonly formats: readonly {
      readonly format: FormatLine['format']
      readonly scales: readonly number[]
      readonly sizes: readonly string[]
      readonly flags: readonly string[]
    }[]
  }[]
  readonly functions: readonly { readonly name: string; readonly signature: string }[]
}

/**
 * Render a theme's default light (ADR-0086) back into its authoring form for the `context`
 * brief — `dir DX:DY` (unit direction, 2-dp) or `at X:Y`, the colour hex, and `amb`/`gain`
 * only when they carry non-default information — so the shared light is inspectable.
 */
const formatThemeLight = (l: Light): string => {
  const r2 = (n: number): string => String(Math.round(n * 100) / 100)
  const head = l.pos ? `at ${l.pos.x}:${l.pos.y}` : `dir ${r2(l.dir.x)}:${r2(l.dir.y)}`
  const amb = l.amb ? ` amb ${toHexColor(l.amb.color)} ${Math.round(l.amb.amount * 100)}%` : ''
  const gain = l.gain === 1 ? '' : ` gain ${l.gain}`
  return `${head} ${toHexColor(l.color)}${amb}${gain}`
}

/**
 * Assembles the {@link Brief}. Parametric drawings can't be rendered without
 * arguments, so they get no size/preview; non-parametric ones are rendered
 * once — a `<=32x32` render also gets an inline ASCII preview, and anything
 * over `80x40` gets a `largePreviewHint` pointing at `render --preview --fit`
 * instead (an unreadably large inline ASCII dump).
 */
const buildBrief = (engine: Engine, mod: ModuleRecord): Brief => {
  const theme = mod.fileTheme
  const drawings: Writable<Brief['drawings']> = []
  const exports: Writable<Brief['exports']> = []
  const functions: Writable<Brief['functions']> = []
  for (const [name, entry] of mod.definitions) {
    if (entry.kind === 'draw') {
      const params = entry.definition.params
      const facts = drawFacts(entry.definition, mod)
      const local = drawLocalTheme(engine, mod, entry.definition)
      if (params && params.length > 0) {
        drawings.push({
          name,
          size: entry.definition.size
            ? `${entry.definition.size.width}x${entry.definition.size.height}`
            : '?',
          sizeSource: facts.sizeSource,
          localPaletteKeys: facts.localPaletteKeys,
          themes: local.names,
          themePalette: local.palette,
          largePreviewHint: null,
          params,
          preview: null,
        })
        continue
      }
      try {
        const sp = engine.renderDraw(entry, [], entry.definition.span)
        drawings.push({
          name,
          size: `${sp.w}x${sp.h}`,
          sizeSource: facts.sizeSource,
          localPaletteKeys: facts.localPaletteKeys,
          themes: local.names,
          themePalette: local.palette,
          largePreviewHint:
            sp.w > 80 || sp.h > 40
              ? `drawstic render ${mod.displayPath}#${name} --preview --fit 80x40`
              : null,
          params: null,
          preview: sp.w <= 32 && sp.h <= 32 ? spriteToAscii(sp).trimEnd() : null,
        })
      } catch {
        drawings.push({
          name,
          size: '?',
          sizeSource: facts.sizeSource,
          localPaletteKeys: facts.localPaletteKeys,
          themes: local.names,
          themePalette: local.palette,
          largePreviewHint: null,
          params: null,
          preview: null,
        })
      }
    }
    if (entry.kind === 'function') {
      functions.push({ name, signature: `${name}(${entry.params.join(', ')})` })
    }
  }
  for (const ex of mod.exports) {
    exports.push({
      source: ex.name,
      basePath: ex.basePath,
      formats: ex.formats.map((line) => ({
        format: line.format,
        scales: line.scales,
        sizes: line.sizes.map((size) =>
          size.height === undefined ? `${size.width}` : `${size.width}x${size.height}`,
        ),
        flags: formatFlags(line),
      })),
    })
  }
  return {
    file: mod.displayPath,
    theme: {
      palette: (theme?.palette ?? []).map((p) => ({
        key: p.key,
        hex: toHexColor(p.color),
        source: p.source,
      })),
      style: theme?.style ?? [],
      size: theme?.size ? `${theme.size.width}x${theme.size.height}` : null,
      mode: theme?.mode ?? null,
      font: theme?.font ?? null,
      light: theme?.light ? formatThemeLight(theme.light) : null,
      figure: theme?.figure
        ? Object.entries(theme.figure)
            .map(([k, v]) => `${k} ${v}`)
            .join(' · ')
        : null,
    },
    drawings,
    exports,
    functions,
  }
}

/**
 * Cheap per-drawing authoring facts for the brief: where the drawing's size
 * will resolve from (own header, inferred from `pixels:`, module default,
 * theme default, or unresolved) and which palette keys it declares locally.
 */
const drawFacts = (
  def: DrawDefinition,
  mod: ModuleRecord,
): { readonly sizeSource: string; readonly localPaletteKeys: readonly string[] } => {
  const hasPixels = def.body.some((stmt) => stmt.kind === 'pixels')
  const localPaletteKeys = def.body.flatMap((stmt) =>
    stmt.kind === 'palette'
      ? stmt.entries.flatMap((entry) => (entry.kind === 'entry' ? [entry.key] : entry.keys))
      : [],
  )
  return {
    sizeSource: def.size
      ? 'header'
      : hasPixels
        ? 'pixels'
        : mod.sizeDefault
          ? 'module default'
          : mod.fileTheme?.size
            ? 'theme default'
            : 'unresolved',
    localPaletteKeys,
  }
}

/**
 * The themes a drawing applies via a drawing-local `use` and the palette they
 * contribute (E11). Folds the file theme with each local `use` exactly as the
 * renderer does, then reports the effective palette — surfacing family colours
 * that only a drawing-local `use` brings in, which never reach the file-level
 * `theme` snapshot. Returns empty when the drawing has no local `use`; a `use`
 * that fails to resolve is skipped (its render error is reported elsewhere).
 */
const drawLocalTheme = (
  engine: Engine,
  mod: ModuleRecord,
  def: DrawDefinition,
): {
  readonly names: readonly string[]
  readonly palette: readonly {
    readonly key: string
    readonly hex: string
    readonly source: string
  }[]
} => {
  const uses = def.body.filter(
    (stmt): stmt is Extract<Statement, { readonly kind: 'use' }> => stmt.kind === 'use',
  )
  if (uses.length === 0) {
    return { names: [], palette: [] }
  }
  let theme = mod.fileTheme
  try {
    for (const u of uses) {
      theme = engine.resolveUse(mod, u.module, u.name, u.span, theme)
    }
  } catch {
    return { names: uses.map((u) => u.name), palette: [] }
  }
  return {
    names: uses.map((u) => u.name),
    palette: (theme?.palette ?? []).map((p) => ({
      key: p.key,
      hex: toHexColor(p.color),
      source: p.source,
    })),
  }
}

/**
 * Renders one export format line's options as short human-readable tags for
 * the brief's text-mode `## exports` section.
 */
const formatFlags = (line: FormatLine): string[] => [
  ...(line.indexed ? ['indexed'] : []),
  ...(line.zlib === undefined ? [] : [`z${line.zlib}`]),
  ...(line.quality === undefined ? [] : [`q${line.quality}`]),
  ...(line.mode === undefined ? [] : [`mode ${line.mode}`]),
  ...(line.tiledXml ? ['xml'] : []),
  ...line.svgFlags,
]

/**
 * Runs `drawstic context`: `--json` emits the full {@link Brief}; the default
 * output is a Markdown-ish plain-text rendering of the same data for direct
 * human/agent reading.
 */
const runContext = (cli: CliArguments): number => {
  const file = cli.target ?? ''
  const diags: Diagnostic[] = []
  try {
    const engine = createEngine(cli)
    const mod = engine.loadEntry(file)
    const brief = buildBrief(engine, mod)
    if (cli.json) {
      return emit(diags, true, brief)
    }
    const lines: string[] = [`# design brief — ${brief.file}`, '']
    if (brief.theme.palette.length > 0) {
      lines.push('## palette')
      for (const p of brief.theme.palette) {
        lines.push(`  ${p.key} = ${p.hex}  (${p.source})`)
      }
      lines.push('')
    }
    if (brief.theme.style.length > 0) {
      lines.push('## style guide')
      for (const s of brief.theme.style) {
        lines.push(`  [${s.source}] ${s.text.trim()}`)
      }
      lines.push('')
    }
    if (brief.theme.light) {
      lines.push(
        '## lighting',
        `  light ${brief.theme.light}  (theme default, shared by all views)`,
        '',
      )
    }
    if (brief.theme.figure) {
      lines.push(
        '## figure',
        `  ${brief.theme.figure}  (read guide points via fig.crown/eyeL/earR/… — see reference)`,
        '',
      )
    }
    if (brief.drawings.length > 0) {
      lines.push('## drawings')
      for (const d of brief.drawings) {
        const params = d.params ? `(${d.params.join(', ')})` : ''
        lines.push(`  ${d.name} ${d.size}${params}`)
        if (d.localPaletteKeys.length > 0 || d.largePreviewHint) {
          lines.push(`    size: ${d.sizeSource}; pal: ${d.localPaletteKeys.join(', ') || '-'}`)
        }
        if (d.themes.length > 0) {
          lines.push(`    use: ${d.themes.join(', ')}`)
          if (d.themePalette.length > 0) {
            lines.push(
              `    theme pal: ${d.themePalette.map((p) => `${p.key}=${p.hex} (${p.source})`).join(', ')}`,
            )
          }
        }
        if (d.largePreviewHint) {
          lines.push(`    hint: ${d.largePreviewHint}`)
        }
        if (d.preview) {
          for (const row of d.preview.split('\n')) {
            lines.push(`    ${row}`)
          }
        }
      }
      lines.push('')
    }
    if (brief.exports.length > 0) {
      lines.push('## exports')
      for (const ex of brief.exports) {
        lines.push(`  ${ex.source} -> ${ex.basePath}`)
        for (const fmt of ex.formats) {
          const scales = fmt.scales.length > 0 ? ` @${fmt.scales.join(' @')}` : ''
          const sizes = fmt.sizes.length > 0 ? ` ${fmt.sizes.join(' ')}` : ''
          const flags = fmt.flags.length > 0 ? ` ${fmt.flags.join(' ')}` : ''
          lines.push(`    ${fmt.format}${scales}${sizes}${flags}`)
        }
      }
      lines.push('')
    }
    if (brief.functions.length > 0) {
      lines.push('## functions')
      for (const f of brief.functions) {
        lines.push(`  ${f.signature}`)
      }
    }
    process.stdout.write(`${lines.join('\n')}\n`)
    return 0
  } catch (e) {
    diags.push(toDiagnostic(e, file))
  }
  return emit(diags, cli.json)
}

// ── build ───────────────────────────────────────────────────────────────────

/**
 * Runs `drawstic build`: executes every export in the file via {@link buildModule},
 * writing to `--out` (default cwd). `--json` reports the full
 * {@link BuiltArtifact} list; otherwise one `wrote <path> (<n> bytes)` line
 * per artifact.
 */
const runBuild = (cli: CliArguments): number => {
  const file = cli.target ?? ''
  const diags: Diagnostic[] = []
  try {
    const engine = createEngine(cli)
    const mod = engine.loadEntry(file)
    const outDir = cli.out ?? process.cwd()
    const artifacts = buildModule(engine, mod, outDir)
    // Non-fatal render-time warnings (e.g. a `fit` gap, W010 — ADR-0087) collected during the
    // export renders surface here exactly as `render` surfaces them, in JSON and human output.
    if (cli.json) {
      process.stdout.write(
        `${JSON.stringify({ diagnostics: engine.warnings, artifacts }, null, 1)}\n`,
      )
      return 0
    }
    for (const a of artifacts) {
      process.stdout.write(`wrote ${a.path} (${a.bytes} bytes)\n`)
    }
    for (const w of engine.warnings) {
      process.stdout.write(`${formatDiagnostic(w)}\n`)
    }
    return 0
  } catch (e) {
    diags.push(toDiagnostic(e, file))
  }
  return emit(diags, cli.json)
}

// ── render ──────────────────────────────────────────────────────────────────

/**
 * Module-scope named masks (`mask NAME = <region-expr>` at file top level —
 * the reusable form spec §9 shows: `mask keyhole = …` defined once, then
 * used by a `draw`) visible to `render --inspect` (§16, P3 drawing aids):
 * scans `mod.ast.statements` for `binding` statements with `bindKind ===
 * 'mask'` and resolves each name's already-evaluated Region from `mod.env`
 * (populated once when `loadEntry` ran the module's top level, before this
 * runs). A mask declared *inside* a draw body is drawing-local and never
 * escapes the render call, so it isn't visible here — see reference.md.
 */
const namedMasksOf = (mod: ModuleRecord): { readonly name: string; readonly region: Region }[] => {
  const out: { readonly name: string; readonly region: Region }[] = []
  for (const s of mod.ast.statements) {
    if (s.kind !== 'binding' || s.bindKind !== 'mask') {
      continue
    }
    const name = s.names[0]
    const value = name ? mod.env.lookup(name)?.value : undefined
    if (name && typeof value === 'object' && value?.type === 'region') {
      out.push({ name, region: value })
    }
  }
  return out
}

/**
 * Runs `drawstic render <file>#<drawing>[(args)]`: renders one drawing ad-hoc, in
 * exactly one output kind per invocation (`--ascii` > `--preview` > `--inspect` >
 * `--explain` > PNG, checked in that order). `--explain` (ADR-0086 §6) prints each
 * `model`/`cel` command's lowered primitive expansion instead of an image. `--crop`
 * applies to every image kind; `--fit`
 * applies only to `--ascii`/`--preview` (never to PNG — use `--png@N` for
 * that). A missing `<file>#<drawing>` target or unknown drawing name is an
 * `E022` (`renderTarget`) diagnostic, not a thrown error. A parametric
 * drawing's own literal `(args)` (ADR-0067) are parsed and evaluated by
 * {@link Engine.renderFragment}. `--grid`/`--diff` (P3 drawing aids) only
 * affect the PNG output kind — both are silently inert under `--ascii`/
 * `--preview`/`--inspect`, same as every other PNG-only flag. `--silhouette`
 * (ADR-0083) is a pure per-pixel transform of the rendered framebuffer applied
 * before every output kind, so it composes with all of them and with
 * `--crop`/`--fit`/`--grid`.
 */
const runRender = (cli: CliArguments): number => {
  const target = cli.target ?? ''
  const targetRef = parseRenderTarget(target)
  const file = targetRef?.file ?? target
  const diags: Diagnostic[] = []
  try {
    if (!targetRef) {
      diags.push(renderTargetDiagnostic(target, 'malformed render target', 'use <file>#<drawing>'))
      return emit(diags, cli.json)
    }
    const engine = createEngine(cli)
    // `--explain` collects each model/cel command's lowered primitive sequence (ADR-0086 §6) and
    // each `fit`'s placement (ADR-0087 amendment 2) during the render — a predictability guardrail,
    // not a render output.
    if (cli.explain) {
      engine.explain = []
      engine.placements = []
      engine.paintOrders = []
    }
    const mod = engine.loadEntry(file)
    const entry = mod.definitions.get(targetRef.drawing)
    if (!entry) {
      const available = [...mod.definitions.entries()]
        .filter(([, e]) => e.kind === 'draw')
        .map(([name]) => name)
      diags.push(
        renderTargetDiagnostic(
          target,
          `drawing '${targetRef.drawing}' not found in ${file}`,
          available.length > 0
            ? `available drawings: ${available.join(', ')}`
            : 'no drawings are defined',
          targetRef.hashColumn + 1,
          targetRef.drawing.length,
          file,
        ),
      )
      return emit(diags, cli.json)
    }
    let sprite: Sprite = engine.renderFragment(entry, targetRef.drawing, targetRef.argsText, {
      line: 1,
      column: 1,
    })
    // Silhouette is a pure per-pixel transform of the rendered framebuffer,
    // applied before any output kind — so it composes with `--ascii`/`--preview`/
    // `--inspect`/PNG and downstream `--crop`/`--fit`/`--grid` (ADR-0083).
    if (cli.silhouette) {
      sprite = silhouetteSprite(sprite)
    }
    let crop: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    } | null = null
    if (cli.crop) {
      const cropped = cropSprite(sprite, cli.crop)
      sprite = cropped.sprite
      crop = cropped.crop
    }
    const originalSize = { width: sprite.w, height: sprite.h }
    let fitted = false
    if (cli.fit && (cli.preview || cli.ascii)) {
      const fit = fitSprite(sprite, cli.fit)
      sprite = fit.sprite
      fitted = fit.fitted
    }
    if (cli.ascii) {
      const output = spriteToAscii(sprite)
      if (cli.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              diagnostics: engine.warnings,
              render: {
                drawing: targetRef.drawing,
                width: sprite.w,
                height: sprite.h,
                kind: 'ascii',
                output,
                stats: spritePreviewStats(sprite),
                ...(crop ? { crop } : {}),
                ...(cli.fit
                  ? { fit: { ...cli.fit, fitted, width: sprite.w, height: sprite.h } }
                  : {}),
                ...(cli.silhouette ? { silhouette: true } : {}),
              },
            },
            null,
            1,
          )}\n`,
        )
      } else {
        process.stdout.write(output)
      }
      return 0
    }
    if (cli.preview) {
      const output = spriteToAnsi(sprite)
      if (cli.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              diagnostics: engine.warnings,
              render: {
                drawing: targetRef.drawing,
                width: sprite.w,
                height: sprite.h,
                kind: 'preview',
                output,
                stats: spritePreviewStats(sprite),
                ...(crop ? { crop } : {}),
                ...(cli.fit
                  ? { fit: { ...cli.fit, fitted, width: sprite.w, height: sprite.h } }
                  : {}),
                ...(cli.silhouette ? { silhouette: true } : {}),
              },
            },
            null,
            1,
          )}\n`,
        )
      } else {
        process.stdout.write(output)
      }
      return 0
    }
    if (cli.inspect) {
      const inspection = inspectSprite(sprite, namedMasksOf(mod), crop?.x ?? 0, crop?.y ?? 0)
      if (cli.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              diagnostics: engine.warnings,
              render: {
                drawing: targetRef.drawing,
                width: sprite.w,
                height: sprite.h,
                kind: 'inspect',
                output: null,
                stats: spritePreviewStats(sprite),
                inspect: inspection,
                ...(crop ? { crop } : {}),
                ...(cli.silhouette ? { silhouette: true } : {}),
              },
            },
            null,
            1,
          )}\n`,
        )
      } else {
        process.stdout.write(`${JSON.stringify(inspection, null, 1)}\n`)
      }
      return 0
    }
    if (cli.explain) {
      const explain = engine.explain ?? []
      const placements = engine.placements ?? []
      const paintOrder = (engine.paintOrders ?? []).find((p) => p.drawing === targetRef.drawing)
      if (cli.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              diagnostics: engine.warnings,
              render: {
                drawing: targetRef.drawing,
                width: sprite.w,
                height: sprite.h,
                kind: 'explain',
                output: null,
                explain,
                placements,
                ...(paintOrder ? { paintOrder: paintOrder.order } : {}),
                ...(sprite.occlusions ? { occlusions: sprite.occlusions } : {}),
              },
            },
            null,
            1,
          )}\n`,
        )
      } else {
        process.stdout.write(
          formatExplain(
            targetRef.drawing,
            explain,
            placements,
            paintOrder?.order,
            sprite.occlusions,
          ),
        )
      }
      return 0
    }
    const s = cli.pngScale
    const width = sprite.w * s
    const height = sprite.h * s
    const data = s === 1 ? sprite.data : scaleBitmap(sprite.data, sprite.w, sprite.h, width, height)
    // `--diff` compares the pristine (UNgridded) buffer — `--grid` is purely
    // cosmetic on the PNG bytes written below (spec §16, P3 drawing aids).
    const diff = cli.diffPath ? diffAgainstPrevious(cli.diffPath, data, width, height) : null
    const outputData = cli.grid ? applyGridOverlay(data, width, height, cli.grid, s) : data
    const png = encodePngRgba(outputData, width, height)
    if (cli.stdout) {
      process.stdout.write(png)
      return 0
    }
    const resolution = s > 1 ? `@${s}x` : ''
    const out = cli.out ?? `${targetRef.drawing}${resolution}.png`
    writeFileSync(resolve(out), png)
    if (cli.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            diagnostics: engine.warnings,
            render: {
              drawing: targetRef.drawing,
              width,
              height,
              kind: 'png',
              output: resolve(out),
              stats: spritePreviewStats(sprite),
              ...(crop ? { crop } : {}),
              original: originalSize,
              ...(cli.grid ? { grid: cli.grid } : {}),
              ...(cli.silhouette ? { silhouette: true } : {}),
              ...(diff ? { diff } : {}),
            },
          },
          null,
          1,
        )}\n`,
      )
    } else {
      process.stdout.write(`wrote ${resolve(out)} (${width}x${height})\n`)
      for (const w of engine.warnings) {
        process.stdout.write(`${formatDiagnostic(w)}\n`)
      }
      if (diff) {
        process.stdout.write(`${formatDiffSummary(diff)}\n`)
      }
    }
    return 0
  } catch (e) {
    diags.push(toDiagnostic(e, file))
  }
  return emit(diags, cli.json)
}

/**
 * `render --diff <png>` (§16, P3 drawing aids): reads and decodes the
 * comparison PNG and diffs it against `data` (the fresh, UNgridded,
 * post-crop/post-scale render). Throws `E019` (`ioError`) for an unreadable
 * or undecodable file, `E023` (`diffMismatch`) when its dimensions don't
 * match the fresh render — both propagate to {@link runRender}'s catch and
 * surface as ordinary positioned diagnostics, same as every other render error.
 */
const diffAgainstPrevious = (
  diffPath: string,
  data: Uint8Array,
  width: number,
  height: number,
): RasterDiff => {
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(resolve(diffPath)))
  } catch (e) {
    throw error(
      ERROR_CODE.ioError,
      `could not read diff PNG '${diffPath}': ${e instanceof Error ? e.message : String(e)}`,
      diffPath,
      { line: 1, column: 1 },
      'check the path passed to --diff',
    )
  }
  let previous: DecodedPng
  try {
    previous = decodePng(bytes)
  } catch (e) {
    throw error(
      ERROR_CODE.ioError,
      `could not decode diff PNG '${diffPath}': ${e instanceof Error ? e.message : String(e)}`,
      diffPath,
      { line: 1, column: 1 },
      'pass a PNG produced by a previous drawstic render',
    )
  }
  if (previous.w !== width || previous.h !== height) {
    throw error(
      ERROR_CODE.diffMismatch,
      `diff PNG is ${previous.w}x${previous.h}, fresh render is ${width}x${height}`,
      diffPath,
      { line: 1, column: 1 },
      'render at the same --png@N scale and --crop as the diff PNG, or omit --diff',
    )
  }
  return diffRasters(previous.data, data, width, height)
}

/** Short human-readable line for `render --diff` without `--json` (§16, P3 drawing aids). */
const formatDiffSummary = (diff: RasterDiff): string => {
  if (diff.identical) {
    return 'diff: identical (0 px changed)'
  }
  const b = diff.changedBBox
  return `diff: ${diff.changedPixelCount}/${diff.totalPixelCount} px changed, bbox ${b?.x}:${b?.y} ${b?.width}x${b?.height}`
}

/**
 * Human-readable `render --explain` output (ADR-0086 §6): each `model`/`cel` command with the
 * exact primitive sequence it lowered to — one line per step, colours/amounts already resolved.
 */
const formatExplain = (
  drawing: string,
  records: readonly ExplainRecord[],
  placements: readonly PlacementRecord[] = [],
  paintOrder: readonly { readonly name: string; readonly reason: string }[] | undefined = undefined,
  occlusions: readonly OcclusionResult[] | undefined = undefined,
): string => {
  if (
    records.length === 0 &&
    placements.length === 0 &&
    !paintOrder &&
    (!occlusions || occlusions.length === 0)
  ) {
    return `${drawing}: no model/cel commands or fits to explain\n`
  }
  const lines: string[] = []
  // Placement report (ADR-0087 amendment 2): where every `fit` landed its pins, whether they
  // coincide, and how far the target pin sits from the part's own ink (the float signal); plus the
  // solved `aim` angle (ADR-0092).
  for (const p of placements) {
    const flip = p.transformed ? ' transformed' : ''
    const coincide = p.coincident ? 'coincident' : 'NOT COINCIDENT'
    const ink =
      p.pinToInk < 0
        ? ''
        : ` pin-to-ink ${p.pinToInk}px${p.pinToInk > 2 ? ' (LOOSE — join floats)' : ''}`
    const aim = p.aimDeg === undefined ? '' : ` aim ${p.aimDeg}°`
    lines.push(
      `fit ${p.target} ← ${p.source}: lands ${p.landed.x}:${p.landed.y} (source ${p.at.x}:${p.at.y}) ${coincide}${ink}${aim}${flip}`,
    )
  }
  // Resolved paint order (ADR-0092): bottom-to-top, with each layer's behind/front reason.
  if (paintOrder && paintOrder.length > 0) {
    lines.push('paint order (bottom → top):')
    paintOrder.forEach((o, i) => {
      lines.push(`  ${i + 1}. ${o.name}${o.reason === 'sequence' ? '' : ` [${o.reason}]`}`)
    })
  }
  // Occlusion parity (ADR-0092, C013 source): each declared relation's measured overlap/violation.
  if (occlusions && occlusions.length > 0) {
    for (const o of occlusions) {
      const verdict = o.overlap === 0 ? 'no overlap' : o.violating > 0 ? 'VIOLATED' : 'ok'
      lines.push(
        `occlusion ${o.behind} ${o.clause} ${o.front}: overlap ${o.overlap}px, violating ${o.violating}px — ${verdict}`,
      )
    }
  }
  for (const r of records) {
    const target = r.region ? ` ${r.region}` : ''
    const at = r.light ? ` (light ${r.light.x}:${r.light.y})` : ''
    lines.push(`${r.command}${target}${at}`)
    for (const s of r.steps) {
      const parts: string[] = []
      if (s.color !== undefined) {
        parts.push(s.color)
      }
      if (s.amount !== undefined) {
        parts.push(`amount ${s.amount}`)
      }
      if (s.point) {
        parts.push(`at ${s.point.x}:${s.point.y}`)
      }
      if (s.dir) {
        parts.push(`dir ${s.dir.x}:${s.dir.y}`)
      }
      if (s.width !== undefined) {
        parts.push(`w${s.width}`)
      }
      if (s.offset) {
        parts.push(`offset ${s.offset.dx}:${s.offset.dy}`)
      }
      // form-body fields (ADR-0089): the tint targets, light elevation, doses, and cel band count.
      if (s.warm !== undefined) {
        parts.push(`warm ${s.warm}`)
      }
      if (s.cool !== undefined) {
        parts.push(`cool ${s.cool}`)
      }
      if (s.elevation !== undefined) {
        parts.push(`z${s.elevation}`)
      }
      if (s.shade !== undefined) {
        parts.push(`shade ${s.shade}`)
      }
      if (s.hi !== undefined) {
        parts.push(`hi ${s.hi}`)
      }
      if (s.spec !== undefined) {
        parts.push(`spec ${s.spec}`)
      }
      if (s.specPow !== undefined) {
        parts.push(`specPow ${s.specPow}`)
      }
      if (s.puff !== undefined) {
        parts.push(`puff ${s.puff}`)
      }
      if (s.ambient !== undefined) {
        parts.push(`amb ${s.ambient}`)
      }
      if (s.bands !== undefined) {
        parts.push(`bands ${s.bands}`)
      }
      lines.push(`  ${s.op}${parts.length > 0 ? ` ${parts.join(' ')}` : ''}`)
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * Splits `<file>#<drawing>` or `<file>#<drawing>(args)` (ADR-0067) at the
 * first `#` — `null` for anything malformed: no `#`, a leading `#`, a
 * trailing `#`, an unclosed `(`, a `(` with no drawing name before it, or a
 * stray `#` in the drawing-name part itself (a drawing name is a plain
 * identifier, so it can never legitimately contain one — this is what
 * catches `a#b#c`). A `#` *inside* `(args)` is fine and expected: a color
 * literal argument (`#c04040`) contains one. `argsText` is `null` when the
 * fragment has no parens at all (the ordinary zero-arg render); otherwise
 * it's the exact `(...)` substring, parens included, left for {@link
 * Engine.renderFragment} to parse and evaluate.
 */
const parseRenderTarget = (
  target: string,
): {
  readonly file: string
  readonly drawing: string
  readonly hashColumn: number
  readonly argsText: string | null
} | null => {
  const hash = target.indexOf('#')
  if (hash <= 0 || hash === target.length - 1) {
    return null
  }
  const file = target.slice(0, hash)
  const rest = target.slice(hash + 1)
  const openIdx = rest.indexOf('(')
  if (openIdx < 0) {
    return rest.includes('#') ? null : { file, drawing: rest, hashColumn: hash + 1, argsText: null }
  }
  const drawing = rest.slice(0, openIdx)
  if (openIdx === 0 || drawing.includes('#') || !rest.endsWith(')')) {
    return null
  }
  return { file, drawing, hashColumn: hash + 1, argsText: rest.slice(openIdx) }
}

/**
 * Builds an `E022` (`renderTarget`) diagnostic for a malformed or unresolved
 * render target.
 */
const renderTargetDiagnostic = (
  target: string,
  message: string,
  hint: string,
  column = 1,
  length = Math.max(1, target.length),
  file = target,
): Diagnostic => ({
  severity: 'error',
  code: ERROR_CODE.renderTarget,
  message,
  file,
  line: 1,
  column,
  endColumn: column + length,
  hint,
})

// ── sheet (ADR-0082) ─────────────────────────────────────────────────────────

/**
 * Runs `drawstic sheet <file>`: composes every selected drawing (exported ones
 * by default, or `--all`) into ONE labeled, size-normalized comparison grid
 * (spec §16, family-QA aid). Output kind is `--ascii` > `--preview` > PNG,
 * checked in that order — same precedence as `render`. `--cols N` sets the
 * column count (default a square-ish `ceil(sqrt(n))`); `--png@N` scales the PNG.
 * `--json` reports the deterministic layout (`cols`, `rows`, `cell`, and one
 * `cells` entry per tile: `{name, w, h, x, y}` in unscaled sheet coordinates).
 */
const runSheet = (cli: CliArguments): number => {
  const file = cli.target ?? ''
  const diags: Diagnostic[] = []
  try {
    const engine = createEngine(cli)
    const mod = engine.loadEntry(file)
    const layout = buildSheet(engine, mod, { cols: cli.cols, all: cli.all })
    if (!layout) {
      diags.push(
        renderTargetDiagnostic(
          file,
          `no drawings to sheet in ${file}`,
          cli.all
            ? 'define a non-parametric drawing'
            : 'export a drawing, or pass --all to sheet every drawing',
          1,
          Math.max(1, file.length),
          file,
        ),
      )
      return emit(diags, cli.json)
    }
    const { sprite } = layout
    if (cli.ascii || cli.preview) {
      const output = cli.ascii ? spriteToAscii(sprite) : spriteToAnsi(sprite)
      if (cli.json) {
        process.stdout.write(
          `${JSON.stringify(sheetJson(layout, { kind: cli.ascii ? 'ascii' : 'preview', output }, engine.warnings), null, 1)}\n`,
        )
      } else {
        process.stdout.write(output)
        for (const w of engine.warnings) {
          process.stdout.write(`${formatDiagnostic(w)}\n`)
        }
      }
      return 0
    }
    const s = cli.pngScale
    const width = sprite.w * s
    const height = sprite.h * s
    const data = s === 1 ? sprite.data : scaleBitmap(sprite.data, sprite.w, sprite.h, width, height)
    const png = encodePngRgba(data, width, height)
    if (cli.stdout) {
      process.stdout.write(png)
      return 0
    }
    const base =
      mod.displayPath
        .replace(/\.drw$/i, '')
        .split(/[\\/]/)
        .pop() ?? 'sheet'
    const out = cli.out ?? `${base}.sheet.png`
    writeFileSync(resolve(out), png)
    if (cli.json) {
      process.stdout.write(
        `${JSON.stringify(sheetJson(layout, { kind: 'png', output: resolve(out), width, height }, engine.warnings), null, 1)}\n`,
      )
    } else {
      process.stdout.write(
        `wrote ${resolve(out)} (${width}x${height}, ${layout.cells.length} tiles)\n`,
      )
      for (const w of engine.warnings) {
        process.stdout.write(`${formatDiagnostic(w)}\n`)
      }
    }
    return 0
  } catch (e) {
    diags.push(toDiagnostic(e, file))
  }
  return emit(diags, cli.json)
}

/** The `sheet --json` payload: diagnostics + the deterministic layout facts. */
const sheetJson = (
  layout: SheetLayout,
  render: Record<string, unknown>,
  diags: readonly Diagnostic[],
): Record<string, unknown> => ({
  diagnostics: diags,
  sheet: {
    cols: layout.cols,
    rows: layout.rows,
    cell: layout.cell,
    width: layout.sprite.w,
    height: layout.sprite.h,
    cells: layout.cells,
    ...render,
  },
})

// ── critique (ADR-0085) ──────────────────────────────────────────────────────

/**
 * Runs `drawstic critique <file> [--as icon|scene|character|item] [--family
 * a,b,c] [--strict]`: renders every non-parametric `draw`, runs the per-sprite
 * pixel-based, vision-free `C0xx` catalog, and — across a sibling *family* — the
 * family checks C009 (sibling-silhouette collapse) and C011 (weight parity). The
 * agnostic checks (C001/C003/C004/C006/C008/C012) always run; `--as` opts a
 * resolved {@link resolveProfile} profile into the profile-gated checks C002
 * (edge-clip), C005 (stroke width) and C007 (floating part) plus its category
 * thresholds — without it, an info advisory nudges the agent to set one. The
 * family defaults to {@link selectCritiqueFamily} (exported draws, or every draw with
 * `--all`, minus any drawing that is itself a composed presentation of ≥2 other
 * candidates — a hand-built `sheet`-style panel never belongs in its own family, character-DX
 * 2026-07-10 rerun §5.1); `--family` overrides it. Family checks run
 * only with ≥2 members. Findings default to `warning` (exit 0 — never blocking);
 * `--strict` promotes the must-fix subset to `error` (exit 1), the CI regression
 * gate. The `--json` payload adds `critique: {pass, profile, strict, failedCodes,
 * drawings, familyMetrics?, rubric}` — each drawing exposing the full metric
 * bundle (a superset of `render --inspect`), plus the vision rubric the agent
 * must still answer by looking. A render failure surfaces as its ordinary `E0xx`
 * diagnostic, exactly as in `check`.
 */
/**
 * The C006 {@link PaletteTarget} for one drawing (ADR-0085 export-target-aware palette budget):
 * `'budgeted'` when the module declares an indexed-PNG (`png … indexed`) or `svg` export for
 * `name` — colour count is a real indexed-palette / SVG-`<rect>` budget there — else
 * `'unbudgeted'` (a straight-alpha RGBA-PNG/JPEG target, or no export at all, has no palette
 * budget, so smooth `model` shading is not a defect). Conservatively defaults to `'unbudgeted'`
 * when no export targets the drawing.
 */
const paletteTargetFor = (mod: ModuleRecord, name: string): PaletteTarget => {
  for (const exp of mod.exports) {
    if (exp.name !== name) {
      continue
    }
    for (const fmt of exp.formats) {
      if (fmt.format === 'svg' || (fmt.format === 'png' && fmt.indexed)) {
        return 'budgeted'
      }
    }
  }
  return 'unbudgeted'
}

const runCritique = (cli: CliArguments): number => {
  const file = cli.target ?? ''
  const diags: Diagnostic[] = []
  const drawings: CritiqueDrawing[] = []
  const profile = resolveProfile(cli.as)
  const rendered: { readonly name: string; readonly span: TextSpan; readonly sprite: Sprite }[] = []
  let familyMetrics: FamilyMetrics | undefined
  let census: ModuleCensus | undefined
  let displayPath = file
  try {
    const engine = createEngine(cli)
    const mod = engine.loadEntry(file)
    displayPath = mod.displayPath
    census = censusModule(engine, mod)
    for (const [, entry] of mod.definitions) {
      if (
        entry.kind !== 'draw' ||
        entry.module !== mod ||
        (entry.definition.params?.length ?? 0) > 0
      ) {
        continue
      }
      try {
        const sprite = engine.renderDraw(entry, [], entry.definition.span)
        const report = critiqueSprite(entry.definition.name, sprite, {
          profile,
          strict: cli.strict,
          paletteTarget: paletteTargetFor(mod, entry.definition.name),
        })
        drawings.push(report)
        rendered.push({ name: entry.definition.name, span: entry.definition.span, sprite })
        for (const check of report.checks) {
          diags.push(critiqueCheckDiagnostic(check, mod.displayPath, entry.definition.span))
        }
      } catch (e) {
        diags.push(toDiagnostic(e, file))
      }
    }
    // Family checks (C009/C011): compare the selected siblings. `--family`
    // overrides the default sheet selection; family checks need ≥2 members.
    const byName = new Map(rendered.map((r) => [r.name, r]))
    const familyNames = cli.family
      ? cli.family
      : selectCritiqueFamily(mod, cli.all).map((e) => e.definition.name)
    const members = familyNames
      .map((name) => byName.get(name))
      .filter((r): r is (typeof rendered)[number] => r !== undefined)
      .map((r) => ({ name: r.name, sprite: r.sprite }))
    const family = critiqueFamily(members, { profile, strict: cli.strict })
    if (family) {
      familyMetrics = family.metrics
      for (const check of family.checks) {
        const span = byName.get(check.target)?.span
        if (span) {
          diags.push(critiqueCheckDiagnostic(check, mod.displayPath, span))
        }
      }
    }
    // Surface the render-time assembly warnings (W010 gap, W011 loose pin — ADR-0087) the renders
    // collected, so the done-gate REPORTS a floating head/loose join it structurally can't see via
    // the pixel checks (they are `warning`s, so the `--strict` error-only exit is unaffected).
    diags.push(...engine.warnings)
  } catch (e) {
    diags.push(toDiagnostic(e, file))
    return emit(diags, cli.json)
  }
  if (!profile) {
    diags.push({
      severity: 'info',
      code: 'C000',
      message:
        'no --as profile: ran the category-agnostic checks only (C002 edge-clip, C005 stroke width and C007 floating-part need a profile)',
      file,
      line: 1,
      column: 1,
      hint: 'pass --as icon|scene|character|item to enable the category checks and thresholds',
    })
  }
  const failedCodes = [
    ...new Set(diags.filter((d) => d.severity !== 'info').map((d) => d.code)),
  ].sort()
  const pass = !diags.some((d) => d.severity === 'warning' || d.severity === 'error')
  const sample = familyMetrics?.members[0]?.name ?? rendered[0]?.name ?? null
  const rubric = buildRubric(profile, displayPath, sample, familyMetrics !== undefined)
  const report = {
    pass,
    profile: profile?.name ?? null,
    strict: cli.strict,
    failedCodes,
    drawings,
    ...(familyMetrics === undefined ? {} : { familyMetrics }),
    rubric,
  }
  return emitObject(diags, cli.json, { critique: report, ...(census ? { census } : {}) })
}

// ── entry ───────────────────────────────────────────────────────────────────

const HELP = `drawstic — deterministic drawing engine

usage:
  drawstic check <file> [--json]
  drawstic fmt <file> [--check] [--json]
  drawstic context <file> [--json]
  drawstic build <file> [--out <dir>] [--json]
  drawstic render <file>#<drawing>[(args)] [--png@N] [--out <path>] [--stdout]
                  [--ascii] [--preview] [--silhouette] [--inspect] [--explain]
                  [--grid N] [--diff <png>] [--mode pixel|smooth] [--json]
  drawstic sheet <file> [--all] [--cols N] [--png@N] [--out <path>]
                  [--stdout] [--ascii] [--preview] [--json]
  drawstic critique <file> [--as icon|scene|character|item] [--family a,b,c]
                  [--strict] [--json]
options:
  --json     stable diagnostic records
  --budget N evaluation-step budget
`

/**
 * CLI entry point: dispatches `argv` to a subcommand handler and returns the
 * process exit code. An unrecognized command prints {@link HELP} and exits
 * `0` only for the literal `help` command (or no command at all); any other
 * unknown command exits `1`.
 */
export const main = (argv: string[]): number => {
  const cli = parseArguments(argv)
  switch (cli.command) {
    case 'check':
      return runCheck(cli)
    case 'fmt':
      return runFormat(cli)
    case 'context':
      return runContext(cli)
    case 'build':
      return runBuild(cli)
    case 'render':
      return runRender(cli)
    case 'sheet':
      return runSheet(cli)
    case 'critique':
      return runCritique(cli)
    default:
      process.stdout.write(HELP)
      return cli.command === 'help' ? 0 : 1
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2))
}
