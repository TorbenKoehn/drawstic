// Recipe linter: non-fatal authoring warnings (`W0xx` codes, distinct from
// the `E0xx` error codes in diagnostic.ts) surfaced via `drawstic check
// --lint`. Best-effort and conservative by design — checks that can't
// statically resolve a case (dynamic expressions, parametric drawings) skip
// it rather than risk a false positive.

import type {
  Argument,
  DrawDefinition,
  Expression,
  PaletteEntry,
  PixelRow,
  Statement,
} from './ast.js'
import type { Diagnostic, TextSpan } from './diagnostic.js'
import type { Engine, ModuleRecord } from './eval.js'
import type { FontResolved } from './raster.js'

/** Builds a `warning`-severity {@link Diagnostic}. */
const warning = (
  code: string,
  message: string,
  file: string,
  span: {
    readonly line: number
    readonly column: number
    readonly endLine?: number
    readonly endColumn?: number
  },
  hint?: string,
): Diagnostic => ({
  severity: 'warning',
  code,
  message,
  file,
  line: span.line,
  column: span.column,
  ...(span.endLine === undefined ? {} : { endLine: span.endLine }),
  ...(span.endColumn === undefined ? {} : { endColumn: span.endColumn }),
  ...(hint === undefined ? {} : { hint }),
})

/**
 * Runs every lint check against `mod`'s own drawings (not imported ones).
 * Part usage (`stamp`/`fit` targets) is collected across all of `mod` first, so
 * a drawing used only as another drawing's stamp/fit target isn't flagged
 * `W002` even if defined before its user.
 */
export const lintModule = (engine: Engine, mod: ModuleRecord): Diagnostic[] => {
  const diagnostics: Diagnostic[] = []
  const exported = new Set(mod.exports.map((ex) => ex.name))
  const used = new Set<string>()
  const fontCache = new Map<string, FontResolved | null>()
  for (const [, entry] of mod.definitions) {
    if (entry.kind === 'draw' && entry.module === mod) {
      collectUsedAsPart(entry.definition.body, used)
    }
  }
  for (const [name, entry] of mod.definitions) {
    if (entry.kind !== 'draw' || entry.module !== mod) {
      continue
    }
    lintUnusedPaletteKeys(entry.definition, mod, diagnostics)
    lintLargeProcedural(entry.definition, mod, diagnostics)
    lintClippedStamps(engine, mod, entry.definition, diagnostics)
    lintDitherTransparentPartner(engine, mod, entry.definition, diagnostics)
    lintCoveredStamps(engine, mod, entry.definition, diagnostics)
    lintUnknownGlyphs(engine, mod, entry.definition, diagnostics, fontCache)
    lintTransparentLastRow(entry.definition, mod, diagnostics)
    if (!exported.has(name) && !used.has(name)) {
      diagnostics.push(
        warning(
          'W002',
          `drawing '${name}' is neither exported, stamped, nor fitted`,
          mod.displayPath,
          entry.definition.span,
          'export it, stamp it, or fit it from another drawing',
        ),
      )
    }
  }
  return diagnostics
}

/** Flattens a single or grouped palette entry to its declared key(s). */
const paletteKeys = (entry: PaletteEntry): readonly string[] =>
  entry.kind === 'entry' ? [entry.key] : entry.keys

/**
 * Lint `W001`: a locally declared palette key never referenced by a `pixels:`
 * character or a paint expression within the same drawing.
 */
const lintUnusedPaletteKeys = (
  def: DrawDefinition,
  mod: ModuleRecord,
  diagnostics: Diagnostic[],
): void => {
  const used = new Set<string>()
  const local: { readonly key: string; readonly span: PaletteEntry['span'] }[] = []
  walkStatements(def.body, (stmt) => {
    if (stmt.kind === 'palette') {
      for (const entry of stmt.entries) {
        for (const key of paletteKeys(entry)) {
          local.push({ key, span: entry.span })
        }
        walkExpr(entry.expression, used)
      }
      return
    }
    if (stmt.kind === 'pixels') {
      for (const row of stmt.rows) {
        for (const ch of row.text) {
          if (ch !== '.') {
            used.add(ch)
          }
        }
      }
      return
    }
    walkStatementExprs(stmt, used)
  })
  for (const item of local) {
    if (!used.has(item.key)) {
      diagnostics.push(
        warning(
          'W001',
          `unused local palette key '${item.key}'`,
          mod.displayPath,
          item.span,
          'remove it or use it in pixels or a paint expression',
        ),
      )
    }
  }
}

/**
 * The `W004` "large procedural drawing" ceiling, in pixels per axis. Set at 128
 * (not the old scene-calibrated 80×40) so deliberate icon/sprite detail
 * variants — the canonical 48/64/128-px redraws of a family — don't trip the
 * ASCII-preview nudge; only canvases beyond a 128-px detail size (scene
 * backdrops and the like) still do. A square threshold avoids the old 80×40
 * asymmetry that fired on any 64×64 icon whose height merely exceeded 40.
 */
const LARGE_PROCEDURAL_MAX = 128

/**
 * Lint `W004`: a procedural (no `pixels:`) drawing larger than
 * {@link LARGE_PROCEDURAL_MAX} on either axis — too large for a round-trippable
 * ASCII dump to verify by eye; nudges toward `render --preview --fit`
 * (ADR-0031) instead.
 */
const lintLargeProcedural = (
  def: DrawDefinition,
  mod: ModuleRecord,
  diagnostics: Diagnostic[],
): void => {
  if (def.body.some((stmt) => stmt.kind === 'pixels')) {
    return
  }
  const size = def.size ?? mod.sizeDefault ?? mod.fileTheme?.size
  if (size && (size.width > LARGE_PROCEDURAL_MAX || size.height > LARGE_PROCEDURAL_MAX)) {
    diagnostics.push(
      warning(
        'W004',
        `large procedural drawing '${def.name}' should be previewed with --fit`,
        mod.displayPath,
        def.span,
        `use drawstic render <file>#${def.name} --preview --fit 80x40`,
      ),
    )
  }
}

/**
 * Lint `W003`: a `stamp` call whose target, placed at a literal point, would land
 * entirely outside the host drawing's bounds (dead output). Only handles
 * literal (non-parametric) targets and literal numeric points — anything
 * computed is skipped rather than guessed at. Render failures are swallowed
 * here since `check`'s deep-validation pass already reports those.
 */
const lintClippedStamps = (
  engine: Engine,
  mod: ModuleRecord,
  def: DrawDefinition,
  diagnostics: Diagnostic[],
): void => {
  if (def.params && def.params.length > 0) {
    return
  }
  let hostSprite: { readonly w: number; readonly h: number } | null = null
  try {
    // `def` is one of `mod`'s own draw definitions (lintModule pre-filters to
    // `kind === 'draw'`), so it is its own host — no lookup or guard needed.
    hostSprite = engine.renderDraw({ kind: 'draw', definition: def, module: mod }, [], def.span)
  } catch {
    return
  }
  walkStatements(def.body, (stmt) => {
    if (stmt.kind !== 'call' || stmt.callee !== 'stamp') {
      return
    }
    const targetName = stampTargetName(stmt.args[0])
    const point = literalPoint(stmt.args[1])
    if (!targetName || !point) {
      return
    }
    const target = mod.definitions.get(targetName)
    if (target?.kind !== 'draw' || (target.definition.params?.length ?? 0) > 0) {
      return
    }
    try {
      const sprite = engine.renderDraw(target, [], stmt.span)
      if (
        point.x + sprite.w <= 0 ||
        point.y + sprite.h <= 0 ||
        point.x >= (hostSprite?.w ?? 0) ||
        point.y >= (hostSprite?.h ?? 0)
      ) {
        diagnostics.push(
          warning(
            'W003',
            `stamp '${targetName}' is completely clipped outside '${def.name}'`,
            mod.displayPath,
            stmt.span,
          ),
        )
      }
    } catch {
      // Validation reports render errors; lint avoids duplicate cascades.
    }
  })
}

/**
 * Best-effort constant evaluation of `expr` against `mod`'s own module-scope
 * bindings only — never a drawing's local `pal` keys, `stamp`/draw
 * parameters, or loop variables. Used by `W006`/`W007` to prove a
 * paint's colour without re-implementing the interpreter's scoping rules.
 * Returns `undefined` for anything unresolvable this way (a draw-local
 * name, a parametric draw's own parameter, a render error, …); callers
 * treat that as "unknown" and skip rather than guess.
 */
const tryEvalModuleConst = (engine: Engine, mod: ModuleRecord, expr: Expression): unknown => {
  try {
    return engine.evalExpr(expr, mod.env, {
      module: mod,
      budget: engine.budget,
      draw: null,
      functionDepth: 0,
    })
  } catch {
    return undefined
  }
}

/**
 * The alpha byte (0-255) of `expr` when it statically evaluates (module
 * scope only, {@link tryEvalModuleConst}) to a colour; `null` if it
 * evaluates to something else (a gradient, …) or doesn't resolve at all.
 */
const staticPaintAlpha = (engine: Engine, mod: ModuleRecord, expr: Expression): number | null => {
  const value = tryEvalModuleConst(engine, mod, expr)
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly type?: unknown }).type === 'color'
  ) {
    return (value as { readonly a: number }).a
  }
  return null
}

/**
 * Lint `W006`: `dither a b t` (spec §12 Filters) is a raw set, not a blend —
 * every opaque pixel of the target is overwritten with `a` or `b`, so a
 * partner paint at alpha 0 punches a transparency hole instead of a no-op.
 * Fires only when a partner statically resolves (module scope only) to
 * alpha 0.
 */
const lintDitherTransparentPartner = (
  engine: Engine,
  mod: ModuleRecord,
  def: DrawDefinition,
  diagnostics: Diagnostic[],
): void => {
  walkStatements(def.body, (stmt) => {
    if (stmt.kind !== 'call' || stmt.callee !== 'dither') {
      return
    }
    for (const arg of stmt.args.slice(0, 2)) {
      if (arg?.kind === 'expression' && staticPaintAlpha(engine, mod, arg.expression) === 0) {
        diagnostics.push(
          warning(
            'W006',
            "dither's raw set produces transparency holes",
            mod.displayPath,
            stmt.span,
            'give the alpha-0 partner paint a visible alpha',
          ),
        )
        return
      }
    }
  })
}

/** An axis-aligned, half-open pixel rectangle: `[x0, x1) x [y0, y1)`. */
type BBox = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

const bboxContains = (outer: BBox, inner: BBox): boolean =>
  outer.x0 <= inner.x0 && outer.y0 <= inner.y0 && outer.x1 >= inner.x1 && outer.y1 >= inner.y1

/** True iff every pixel of a rendered sprite is fully opaque (alpha 255). */
const isFullyOpaqueSprite = (sprite: { readonly data: Uint8Array }): boolean => {
  for (let i = 3; i < sprite.data.length; i += 4) {
    if (sprite.data[i] !== 255) {
      return false
    }
  }
  return true
}

/** One `stamp`/`rect …fill`/`bg` event tracked by {@link lintCoveredStamps}. */
type CoverageEvent = {
  readonly bbox: BBox
  /** Set only for a `stamp` event — the one kind that can be flagged as covered. */
  readonly stampName?: string
  readonly span: TextSpan
  /** Whether this event, if later, provably paints its whole `bbox` opaque. */
  readonly opaqueSource: boolean
}

/**
 * A bare `stamp <name> <point>` (no flags — anything else changes its
 * footprint or opacity, so it's skipped rather than guessed at) as a
 * {@link CoverageEvent}; `null` if the target/point isn't statically known
 * or the target doesn't render.
 */
const stampCoverageEvent = (
  engine: Engine,
  mod: ModuleRecord,
  stmt: Extract<Statement, { readonly kind: 'call' }>,
): CoverageEvent | null => {
  if (stmt.args.length !== 2) {
    return null
  }
  const targetName = stampTargetName(stmt.args[0])
  const pt = literalPoint(stmt.args[1])
  const target = targetName ? mod.definitions.get(targetName) : undefined
  if (
    !targetName ||
    !pt ||
    target?.kind !== 'draw' ||
    (target.definition.params?.length ?? 0) > 0
  ) {
    return null
  }
  try {
    const sprite = engine.renderDraw(target, [], stmt.span)
    return {
      bbox: { x0: pt.x, y0: pt.y, x1: pt.x + sprite.w, y1: pt.y + sprite.h },
      stampName: targetName,
      span: stmt.span,
      opaqueSource: isFullyOpaqueSprite(sprite),
    }
  } catch {
    // render errors surface via check's deep-validation pass, not here
    return null
  }
}

/**
 * A `rect <paint> <a> <b> fill` with literal corners and a provably opaque
 * paint, as a coverage-source-only {@link CoverageEvent}; `null` otherwise.
 */
const rectFillCoverageEvent = (
  engine: Engine,
  mod: ModuleRecord,
  stmt: Extract<Statement, { readonly kind: 'call' }>,
): CoverageEvent | null => {
  if (stmt.args.length !== 4) {
    return null
  }
  const [paintArg, aArg, bArg, fillFlag] = stmt.args
  const isFillFlag =
    fillFlag?.kind === 'expression' &&
    fillFlag.expression.kind === 'name' &&
    fillFlag.expression.name === 'fill'
  const p1 = literalPoint(aArg)
  const p2 = literalPoint(bArg)
  if (
    !isFillFlag ||
    paintArg?.kind !== 'expression' ||
    !p1 ||
    !p2 ||
    staticPaintAlpha(engine, mod, paintArg.expression) !== 255
  ) {
    return null
  }
  return {
    bbox: {
      x0: Math.min(p1.x, p2.x),
      y0: Math.min(p1.y, p2.y),
      x1: Math.max(p1.x, p2.x) + 1,
      y1: Math.max(p1.y, p2.y) + 1,
    },
    span: stmt.span,
    opaqueSource: true,
  }
}

/**
 * A `bg <paint>` with a provably opaque paint, as a whole-canvas,
 * coverage-source-only {@link CoverageEvent}; `null` otherwise.
 */
const bgCoverageEvent = (
  engine: Engine,
  mod: ModuleRecord,
  stmt: Extract<Statement, { readonly kind: 'call' }>,
  canvasSize: { readonly width: number; readonly height: number } | null | undefined,
): CoverageEvent | null => {
  const paintArg = stmt.args[0]
  if (
    stmt.args.length !== 1 ||
    !canvasSize ||
    paintArg?.kind !== 'expression' ||
    staticPaintAlpha(engine, mod, paintArg.expression) !== 255
  ) {
    return null
  }
  return {
    bbox: { x0: 0, y0: 0, x1: canvasSize.width, y1: canvasSize.height },
    span: stmt.span,
    opaqueSource: true,
  }
}

/**
 * Lint `W007`: a `stamp` whose bounding box ends up entirely underneath a
 * *later*, provably opaque paint in the same drawing — a silent, invisible
 * stamp (the "fox vanished under the igloo" evaluation case). Deliberately
 * narrow to stay conservative: only top-level statements of `def.body` are
 * tracked (nothing inside `if`/`for`/`while`/`match`/`repeat`/`mask …:` —
 * their execution order or visible area isn't statically certain), and only
 * the three event shapes in {@link stampCoverageEvent}/
 * {@link rectFillCoverageEvent}/{@link bgCoverageEvent} are recognised.
 * Ellipse/circle/poly fills, gradients, computed points, and masked or
 * transformed stamps never count as a coverage source or a coveree.
 */
const lintCoveredStamps = (
  engine: Engine,
  mod: ModuleRecord,
  def: DrawDefinition,
  diagnostics: Diagnostic[],
): void => {
  if (def.params && def.params.length > 0) {
    return
  }
  const canvasSize = def.size ?? mod.sizeDefault ?? mod.fileTheme?.size
  const events: CoverageEvent[] = []
  for (const stmt of def.body) {
    if (stmt.kind !== 'call') {
      continue
    }
    const event =
      stmt.callee === 'stamp'
        ? stampCoverageEvent(engine, mod, stmt)
        : stmt.callee === 'rect'
          ? rectFillCoverageEvent(engine, mod, stmt)
          : stmt.callee === 'bg'
            ? bgCoverageEvent(engine, mod, stmt, canvasSize)
            : null
    if (event) {
      events.push(event)
    }
  }
  for (let i = 0; i < events.length; i++) {
    const covered = events[i]
    if (!covered?.stampName) {
      continue
    }
    const isCovered = events
      .slice(i + 1)
      .some((later) => later.opaqueSource && bboxContains(later.bbox, covered.bbox))
    if (isCovered) {
      diagnostics.push(
        warning(
          'W007',
          `stamp '${covered.stampName}' is fully covered by a later opaque paint and never visible`,
          mod.displayPath,
          covered.span,
          'reorder the stamps, or delete the dead one',
        ),
      )
    }
  }
}

/**
 * True iff `font` — or, transitively, its fallback face — can render `ch`.
 * Coverage is read from the resolved font at runtime (a bitmap face's glyph
 * map, incl. its upcase fallback, or a user font's inline/reference glyphs and
 * its `with` fallback), never a hardcoded character list, so it stays correct
 * as the bundled faces gain glyphs.
 */
const fontHasGlyph = (font: FontResolved, ch: string): boolean => {
  if (font.kind === 'bitmap') {
    return font.font.glyphs.has(ch) || (font.font.upcase && font.font.glyphs.has(ch.toUpperCase()))
  }
  if (font.inlineGlyphs.has(ch) || font.glyphs.has(ch)) {
    return true
  }
  return font.fallback ? fontHasGlyph(font.fallback, ch) : false
}

/**
 * The font name in effect when a drawing's body begins: its folded theme's
 * `font` (file theme layered with any drawing-local `use`, exactly as the
 * renderer folds it), then the module `font` default, then the built-in
 * `small` (`text`'s own fallback). An unresolvable `use` (reported elsewhere)
 * degrades to the file/module default.
 */
const enteringFontName = (engine: Engine, mod: ModuleRecord, def: DrawDefinition): string => {
  try {
    let theme = mod.fileTheme
    for (const s of def.body) {
      if (s.kind === 'use') {
        theme = engine.resolveUse(mod, s.module, s.name, s.span, theme)
      }
    }
    return theme?.font ?? mod.fontDefault ?? 'small'
  } catch {
    return mod.fileTheme?.font ?? mod.fontDefault ?? 'small'
  }
}

/** The literal string a `text` call draws, if it's a static string literal; `null` for interpolated/computed strings (skipped). */
const literalTextString = (stmt: Extract<Statement, { readonly kind: 'call' }>): string | null => {
  for (const arg of stmt.args) {
    if (arg.kind === 'expression' && arg.expression.kind === 'string') {
      return arg.expression.value
    }
  }
  return null
}

/**
 * Lint `W008`: a `text` call whose literal string contains characters that have
 * no glyph in the resolved font — they render, silently, as the unknown-glyph
 * box (the "`std font micro "$"`" case, no `check`/`lint` signal today). Only
 * statically decidable cases fire: the string must be a literal (interpolated
 * strings are skipped), and the font must be knowable — a per-call `font <name>`
 * keyword always is, otherwise the ambient {@link enteringFontName} is used,
 * but only when no mid-body `font` directive makes the ambient font
 * flow-dependent. Coverage is read from the live font, so a face that gains a
 * glyph stops warning about it automatically.
 */
/** A `text` call's own `font <name>` keyword override: `{name}` when static, `'dynamic'` when computed, `null` when absent. */
const textFontOverride = (
  stmt: Extract<Statement, { readonly kind: 'call' }>,
): { readonly name: string } | 'dynamic' | null => {
  for (const arg of stmt.args) {
    if (arg.kind === 'keyword' && arg.keyword === 'font') {
      const part = arg.parts[0]
      return part?.kind === 'name' ? { name: part.name } : 'dynamic'
    }
  }
  return null
}

/** True iff any `font` directive lives inside a nested block (depth ≥ 1) of `body`. */
const hasNestedFontDirective = (body: readonly Statement[]): boolean => {
  for (const top of body) {
    if (top.kind === 'fontDirective') {
      continue
    }
    let nested = false
    walkStatements([top], (inner) => {
      if (inner !== top && inner.kind === 'fontDirective') {
        nested = true
      }
    })
    if (nested) {
      return true
    }
  }
  return false
}

const lintUnknownGlyphs = (
  engine: Engine,
  mod: ModuleRecord,
  def: DrawDefinition,
  diagnostics: Diagnostic[],
  fontCache: Map<string, FontResolved | null>,
): void => {
  let anyText = false
  walkStatements(def.body, (stmt) => {
    if (stmt.kind === 'call' && stmt.callee === 'text') {
      anyText = true
    }
  })
  if (!anyText) {
    return
  }
  const resolve = (name: string): FontResolved | null => {
    if (fontCache.has(name)) {
      return fontCache.get(name) ?? null
    }
    let font: FontResolved | null = null
    try {
      font = engine.resolveFont(
        name,
        { module: mod, budget: engine.budget, draw: null, functionDepth: 0 },
        def.span,
      )
    } catch {
      font = null
    }
    fontCache.set(name, font)
    return font
  }
  const check = (stmt: Extract<Statement, { readonly kind: 'call' }>, fontName: string): void => {
    const str = literalTextString(stmt)
    if (str === null) {
      return
    }
    const font = resolve(fontName)
    if (!font) {
      return
    }
    const missing: string[] = []
    const seen = new Set<string>()
    for (const ch of str) {
      if (ch === '\n' || seen.has(ch) || fontHasGlyph(font, ch)) {
        continue
      }
      seen.add(ch)
      missing.push(ch)
    }
    if (missing.length > 0) {
      diagnostics.push(
        warning(
          'W008',
          `text has ${missing.length} character(s) with no glyph in font '${fontName}': ${missing.map((c) => `'${c}'`).join(', ')}`,
          mod.displayPath,
          stmt.span,
          'add these glyphs to the font, pick a font that has them, or drop them',
        ),
      )
    }
  }
  // The ambient font is tracked across TOP-LEVEL statements in source order (a
  // `font` directive rebinds it for everything after). A `font` directive buried
  // in a nested block could rebind it flow-dependently, so when one exists the
  // ambient font is treated as unknowable and only text with its own `font`
  // keyword is decidable. Font never changes within a statement, so a nested
  // text uses whatever ambient held entering its top-level statement.
  const ambientUnknowable = hasNestedFontDirective(def.body)
  let currentFont = enteringFontName(engine, mod, def)
  const visitText = (stmt: Extract<Statement, { readonly kind: 'call' }>): void => {
    const override = textFontOverride(stmt)
    if (override === 'dynamic') {
      return
    }
    if (override) {
      check(stmt, override.name)
    } else if (!ambientUnknowable) {
      check(stmt, currentFont)
    }
  }
  for (const top of def.body) {
    if (top.kind === 'fontDirective') {
      currentFont = top.name
      continue
    }
    walkStatements([top], (inner) => {
      if (inner.kind === 'call' && inner.callee === 'text') {
        visitText(inner)
      }
    })
  }
}

/** True iff `row` is non-empty and every one of its cells is a transparent `.`. */
const isTransparentRow = (row: PixelRow): boolean =>
  row.text.length > 0 && [...row.text].every((ch) => ch === '.')

/**
 * Lint `W009`: a `pixels:` grid whose *last* row is fully transparent (`.`)
 * while some row above it has content. Because stamps place by the sprite's
 * top-left corner (spec §11), that trailing empty row silently enlarges the
 * sprite's footprint by 1px — so a part stamped directly below at
 * `y + spriteHeight` sits one pixel too low, leaving a hairline seam gap
 * between the stacked parts (the "unbemerkt voll-transparente letzte
 * grid row" that was the character-eval's gap-culprit #1). Deliberately
 * narrow — only the *last row* (never the first row, never a column):
 * horizontal side-padding and top-centring are legitimate, pervasive sprite
 * habits, so flagging them would drown the signal (the trailing row is both
 * the sneakiest — content looks correctly top-aligned — and the highest-value
 * catch). Skips a wholly transparent grid (an empty sprite, a different
 * problem) and single-row grids (no content can sit above the trailing row).
 */
const lintTransparentLastRow = (
  def: DrawDefinition,
  mod: ModuleRecord,
  diagnostics: Diagnostic[],
): void => {
  walkStatements(def.body, (stmt) => {
    if (stmt.kind !== 'pixels' || stmt.rows.length < 2) {
      return
    }
    const last = stmt.rows[stmt.rows.length - 1]
    if (!last || !isTransparentRow(last) || stmt.rows.every(isTransparentRow)) {
      return
    }
    diagnostics.push(
      warning(
        'W009',
        `pixels grid of '${def.name}' has a fully transparent last row`,
        mod.displayPath,
        last.span,
        'a transparent edge row enlarges the stamp footprint; trim it or account for the offset — stamps place by top-left, so a trailing empty row seams a gap below stacked parts',
      ),
    )
  })
}

/**
 * Collects every drawing name referenced as a `stamp` or `fit` target in `body`,
 * so `W002` doesn't flag drawings that are used only to assemble another drawing
 * (character-DX 2026-07-10 rerun §5.4: a `fit`-attached part is real usage, exactly
 * like a `stamp` target — omitting it made W002 fire on nearly every part of a
 * `pin`/`fit`-built character). A `fit`'s SOURCE (`stmt.source.head` for a `ref`
 * source) is a canvas-space pin-registry label, not necessarily a drawing name —
 * only the TARGET (`stmt.target.head`, the part being placed) is counted here.
 */
const collectUsedAsPart = (body: readonly Statement[], out: Set<string>): void => {
  walkStatements(body, (stmt) => {
    if (stmt.kind === 'call' && stmt.callee === 'stamp') {
      const name = stampTargetName(stmt.args[0])
      if (name) {
        out.add(name)
      }
      return
    }
    if (stmt.kind === 'fit') {
      out.add(stmt.target.head)
    }
  })
}

/**
 * Extracts a stamp call's target drawing name, whether written as a bare
 * name or a parametric call expression; `null` if it isn't statically a name.
 */
export const stampTargetName = (arg: Argument | undefined): string | null => {
  if (arg?.kind !== 'expression') {
    return null
  }
  if (arg.expression.kind === 'name') {
    return arg.expression.name
  }
  if (arg.expression.kind === 'call' && arg.expression.callee.kind === 'name') {
    return arg.expression.callee.name
  }
  return null
}

/**
 * Resolves a stamp's placement point only when it's a literal (optionally
 * negated) numeric point expression; `null` for anything computed.
 */
const literalPoint = (
  arg: Argument | undefined,
): { readonly x: number; readonly y: number } | null => {
  if (arg?.kind !== 'expression' || arg.expression.kind !== 'point') {
    return null
  }
  const x = literalNumber(arg.expression.x)
  const y = literalNumber(arg.expression.y)
  return x === null || y === null ? null : { x, y }
}

const literalNumber = (expr: Expression): number | null => {
  if (expr.kind === 'number') {
    return expr.value
  }
  if (expr.kind === 'unary' && expr.operator === '-') {
    const inner = literalNumber(expr.operand)
    return inner === null ? null : -inner
  }
  return null
}

// generic AST walkers shared by the checks above: `walkStatements` recurses
// into every nested statement body (`if`/`match`/`repeat`/`for`/`while`/
// `maskBlock`); `walkStatementExprs`/`walkArg`/`walkExpr` recurse into every
// expression subtree, collecting referenced names. `walkStatements` and
// `stampTargetName` are exported — `sheet.ts` reuses them to detect a
// composed-presentation drawing (one that `stamp`s its own critique siblings)
// for the critique family default (character-DX 2026-07-10 rerun §5.1).

export const walkStatements = (
  statements: readonly Statement[],
  visit: (stmt: Statement) => void,
): void => {
  for (const stmt of statements) {
    visit(stmt)
    switch (stmt.kind) {
      case 'if':
        walkStatements(stmt.thenStatement, visit)
        if (stmt.elseStatement) {
          walkStatements(stmt.elseStatement, visit)
        }
        break
      case 'match':
        for (const arm of stmt.arms) {
          walkStatements(arm.body, visit)
        }
        break
      case 'repeat':
      case 'for':
      case 'while':
      case 'scatter':
      case 'mirror':
      case 'maskBlock':
        walkStatements(stmt.body, visit)
        break
      default:
        break
    }
  }
}

const walkStatementExprs = (stmt: Statement, names: Set<string>): void => {
  switch (stmt.kind) {
    case 'binding':
      walkExpr(stmt.expression, names)
      break
    case 'compound':
      walkExpr(stmt.expression, names)
      break
    case 'call':
      for (const arg of stmt.args) {
        walkArg(arg, names)
      }
      break
    case 'if':
      walkExpr(stmt.condition, names)
      break
    case 'match':
      walkExpr(stmt.subject, names)
      for (const arm of stmt.arms) {
        if (arm.label) {
          walkExpr(arm.label, names)
        }
      }
      break
    case 'repeat':
      walkExpr(stmt.count, names)
      break
    case 'for':
      walkExpr(stmt.iterable, names)
      break
    case 'while':
      walkExpr(stmt.condition, names)
      break
    case 'maskBlock':
      walkExpr(stmt.expression, names)
      break
    default:
      break
  }
}

const walkArg = (arg: Argument, names: Set<string>): void => {
  if (arg.kind === 'expression') {
    walkExpr(arg.expression, names)
    return
  }
  for (const part of arg.parts) {
    walkExpr(part, names)
  }
}

const walkExpr = (expr: Expression, names: Set<string>): void => {
  switch (expr.kind) {
    case 'name':
      names.add(expr.name)
      break
    case 'point':
      walkExpr(expr.x, names)
      walkExpr(expr.y, names)
      break
    case 'list':
      for (const item of expr.items) {
        walkExpr(item, names)
      }
      break
    case 'range':
      walkExpr(expr.from, names)
      walkExpr(expr.to, names)
      break
    case 'unary':
      walkExpr(expr.operand, names)
      break
    case 'binary':
      walkExpr(expr.left, names)
      walkExpr(expr.right, names)
      break
    case 'ifExpression':
      walkExpr(expr.condition, names)
      walkExpr(expr.thenExpression, names)
      walkExpr(expr.elseExpression, names)
      break
    case 'call':
      walkExpr(expr.callee, names)
      for (const arg of expr.args) {
        walkArg(arg, names)
      }
      break
    case 'index':
      walkExpr(expr.target, names)
      walkExpr(expr.index, names)
      break
    case 'dotIndex':
      walkExpr(expr.target, names)
      break
    case 'method':
      walkExpr(expr.target, names)
      for (const arg of expr.args ?? []) {
        walkArg(arg, names)
      }
      break
    default:
      break
  }
}
