// Recipe linter: non-fatal authoring warnings (`W0xx` codes, distinct from
// the `E0xx` error codes in diagnostic.ts) surfaced via `drawstic check
// --lint`. Best-effort and conservative by design — checks that can't
// statically resolve a case (dynamic expressions, parametric drawings) skip
// it rather than risk a false positive.

import { basename, dirname } from 'node:path'
import type {
  Argument,
  DrawDefinition,
  ExportGroup,
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
  lintExportPathRepeatsDir(mod, diagnostics)
  lintExportBlockDirShape(mod, diagnostics)
  lintMirroredViewPin(mod, diagnostics)
  lintModuleNameKindCollision(mod, diagnostics)
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
    lintClippedStamps(engine, mod, entry.definition, diagnostics)
    lintNoOpAa(engine, mod, entry.definition, diagnostics)
    lintDitherTransparentPartner(engine, mod, entry.definition, diagnostics)
    lintCoveredStamps(engine, mod, entry.definition, diagnostics)
    lintUnknownGlyphs(engine, mod, entry.definition, diagnostics, fontCache)
    lintTransparentLastRow(entry.definition, mod, diagnostics)
    lintDrawNameKindCollision(entry.definition, mod, diagnostics)
    diagnostics.push(...canonicalPathChecks(engine, mod, entry.definition))
    // A module with no `export` block is a *library* module: every drawing in it exists to be
    // pulled in elsewhere via `from <module> a, b`, and `check` sees one file at a time, so it can
    // never observe the importer. `examples/showcase/parts.drw` is exactly this — `showcase.drw`
    // stamps its `gem` and `eye` — and flagging it made a shipped example fail the skill's own
    // gate for doing the correct thing. In a module that *does* export, an unused drawing is still
    // a real leftover and still flagged.
    if (mod.exports.length > 0 && !exported.has(name) && !used.has(name)) {
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

// `W004` (large procedural drawing → preview with --fit) is **retired**, code never reused: it
// fired on every scene-sized canvas — 90 emissions across the session history, the single
// most-emitted diagnostic, and universally ignored — while carrying no action a recipe could take.
// Verifying a big drawing is the job of the render-and-look loop the `critique` rubric prescribes
// with exact commands, not of a lint that repeats "this drawing is large".

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
 * A bare `stamp`/`fit` flag whose 16 `aa` taps provably round to the point sample's texel for
 * **every** sprite size (ADR-0099 §3, amended 2026-07-27): the mirrors, the half-turn and integer
 * upscales keep the inverse-mapped tap coordinates at least `1/(2N)` from the `roundHalfUp`
 * boundary, while a tap displaces the source coordinate by at most `3/(8N)`.
 */
const isSizeFreeLatticeFlag = (flag: string): boolean =>
  flag === 'flipx' || flag === 'flipy' || /^scale\d+$/.test(flag) || /^rot(0|180)$/.test(flag)

/**
 * `rot90`/`rot270` — a quarter-turn pivots about `((w−1)/2, (h−1)/2)`, so the inverse map carries
 * the offsets `cx∓cy`. Those are integral **iff `w` and `h` share a parity**; at mixed parity every
 * tap lands exactly on the `roundHalfUp` boundary and the 16 taps split 4/4/4/4 across a 2×2 texel
 * block — a real blend, not a no-op. So a quarter-turn only joins the identity set once the sprite's
 * size is known (ADR-0099 §3, amended 2026-07-27).
 */
const isQuarterTurnFlag = (flag: string): boolean => flag === 'rot90' || flag === 'rot270'

/**
 * The pixel size of the sprite a `stamp`/`fit` places, when the linter can know it statically: the
 * named target must be one of `mod`'s own zero-parameter drawings, which is rendered exactly as
 * `W003` already renders one. `undefined` for anything computed (a parametric target, an `image`, a
 * local binding, an atlas member) — callers then stay silent rather than guess a parity.
 */
const staticSpriteSize = (
  engine: Engine,
  mod: ModuleRecord,
  name: string,
  span: TextSpan,
): { readonly w: number; readonly h: number } | undefined => {
  const target = mod.definitions.get(name)
  if (target?.kind !== 'draw' || (target.definition.params?.length ?? 0) > 0) {
    return undefined
  }
  try {
    const sprite = engine.renderDraw(target, [], span)
    return { w: sprite.w, h: sprite.h }
  } catch {
    return undefined
  }
}

/**
 * Lint `W018`: `aa` (ADR-0099) on a `stamp`/`fit` whose placement the corrected lattice-identity
 * lemma proves byte-identical to the point sample — the flag cannot change a pixel. Scoped to
 * exactly what the lemma covers: the size-free flags decide themselves, a quarter-turn additionally
 * needs the sprite's width/height parity, and everything the linter cannot resolve statically (a
 * `transform EXPR` flag, a `fit … aim`/`bone` rotation solved at runtime, a target whose size does
 * not resolve) stays silent instead of claiming an unprovable no-op.
 */
const lintNoOpAa = (
  engine: Engine,
  mod: ModuleRecord,
  def: DrawDefinition,
  diagnostics: Diagnostic[],
): void => {
  const check = (
    flagArgs: readonly Argument[],
    span: TextSpan,
    targetName: string | null,
  ): void => {
    const bareFlags: string[] = []
    let hasTransform = false
    for (const arg of flagArgs) {
      if (arg.kind === 'expression' && arg.expression.kind === 'name') {
        bareFlags.push(arg.expression.name)
      } else if (arg.kind === 'keyword' && arg.keyword === 'transform') {
        hasTransform = true
      }
    }
    if (hasTransform || !bareFlags.includes('aa')) {
      return
    }
    const others = bareFlags.filter((flag) => flag !== 'aa')
    if (!others.every((flag) => isSizeFreeLatticeFlag(flag) || isQuarterTurnFlag(flag))) {
      return
    }
    let reason =
      others.length === 0
        ? 'the placement has no transform'
        : 'a mirror/half-turn/integer-scale transform reads one texel per pixel'
    if (others.some(isQuarterTurnFlag)) {
      const size = targetName === null ? undefined : staticSpriteSize(engine, mod, targetName, span)
      if (!size || (size.w - size.h) % 2 !== 0) {
        return
      }
      reason = `a quarter-turn of a ${size.w}x${size.h} sprite (equal-parity sides) reads one texel per pixel`
    }
    diagnostics.push(
      warning(
        'W018',
        `'aa' cannot change a pixel here: ${reason}`,
        mod.displayPath,
        span,
        "'aa' only changes pixels under a non-lattice transform (rot45, non-integer scale, skew, perspective) — drop it",
      ),
    )
  }
  walkStatements(def.body, (stmt) => {
    if (stmt.kind === 'call' && stmt.callee === 'stamp') {
      check(stmt.args.slice(2), stmt.span, stampTargetName(stmt.args[0]))
      return
    }
    if (stmt.kind === 'fit') {
      // An `aim PIN PT` clause (ADR-0092) and a `bone JOINT` source (ADR-0095) each compose an
      // extra rotation onto the fit's matrix from an angle solved at runtime, and neither lives in
      // the flag list — so the transform is not statically known and the fit is skipped, exactly as
      // a `transform EXPR` flag is. Without this, `fit blade.hilt hand.grip aim tip 60:8 aa` — the
      // ADR's own worked example — warns that a real rotation "cannot change a pixel".
      if (stmt.aim !== undefined || stmt.source.kind === 'bone') {
        return
      }
      // `fit A.pin B.pin` places `A` — the fit's *target* head is the sprite whose size decides a
      // quarter-turn's parity, and whose footprint centre the flags pivot about (`#execFit`).
      check(stmt.flags, stmt.span, stmt.target.head)
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
 * tracked (nothing inside `if`/`for`/`match`/`mask …:` —
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
  // The whole premise is that the grid *determines* the footprint. With an explicit `WxH` on the
  // draw header the canvas is fixed by the header, so a trailing empty row cannot move anything —
  // it is deliberate padding (`games.drw#heart16` centres an 8-row heart in 16 rows). Verified:
  // a grid with no declared size makes a 4x2 heart 4x3; with `4x2` declared it stays 4x2.
  if (def.size !== undefined) {
    return
  }
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
 * Lint `W016`: an export path's first segment repeats the recipe file's own directory name (e.g.
 * `export scene showcase/scene:` inside `examples/showcase/showcase.drw`). `build` defaults `--out`
 * to the recipe's own directory (ADR-0096 §6) and every export path is relative to that, so a
 * leading `<dirname>/` segment just duplicates what `build` already provides — the historical cause
 * of the corpus's five different export-path conventions and the duplicated-junk-directory bug the
 * ADR fixes. Runs once per module (not per drawing), against every declared export.
 *
 * A block's `dir` (ADR-0098) is the same mistake in a new spelling, so it reads the **composed**
 * path: when the repetition comes from `dir`, the finding positions on the `dir` line, its hint
 * names `dir`, and it reports once per block rather than once per target.
 */
const lintExportPathRepeatsDir = (mod: ModuleRecord, diagnostics: Diagnostic[]): void => {
  const recipeDir = basename(dirname(mod.file))
  const reportedGroups = new Set<ExportGroup>()
  for (const ex of mod.exports) {
    const dir = ex.group.dir
    if (dir !== undefined) {
      // A `dir` is always a directory, so the "no `/` → skip" guard below does not apply to it:
      // `dir loot` inside `items-v2/loot/` writes `loot/loot/<name>.png`, the junk directory itself.
      if (dir.split('/')[0] === recipeDir && !reportedGroups.has(ex.group)) {
        reportedGroups.add(ex.group)
        diagnostics.push(
          warning(
            'W016',
            `export dir '${dir}' repeats the recipe's own directory '${recipeDir}'`,
            mod.displayPath,
            ex.group.dirSpan ?? ex.span,
            `build writes next to the recipe — drop the '${recipeDir}/' prefix from 'dir'`,
          ),
        )
      }
      continue
    }
    // Only a *leading directory segment* duplicates anything. A bare basename that happens to equal
    // the folder name (`export loot loot:` inside `items-v2/loot/`) writes `loot/loot.png` — the set
    // named after its own folder, which is the normal convention, not the junk-directory bug. Four
    // bundled recipes tripped this before the `/` guard, so the corpus failed the skill's own gate.
    if (!ex.basePath.includes('/')) {
      continue
    }
    const first = ex.basePath.split('/')[0]
    if (first === recipeDir) {
      diagnostics.push(
        warning(
          'W016',
          `export path '${ex.basePath}' repeats the recipe's own directory '${recipeDir}'`,
          mod.displayPath,
          ex.span,
          `build writes next to the recipe — drop the '${recipeDir}/' prefix`,
        ),
      )
    }
  }
}

/** The leading directory segments `paths` all share (`a/b/x`, `a/b/y` → `['a','b']`); `[]` if none. */
const sharedDirPrefix = (paths: readonly string[]): string[] => {
  const first = paths[0]?.split('/').slice(0, -1) ?? []
  let shared = first.length
  for (const path of paths.slice(1)) {
    const segments = path.split('/').slice(0, -1)
    let i = 0
    while (i < shared && i < segments.length && segments[i] === first[i]) {
      i++
    }
    shared = i
  }
  return first.slice(0, shared)
}

/**
 * Lint `W019` (ADR-0098 §10), two arms of one concern — *the directory is declared in the wrong
 * place for this block's shape*:
 *
 * - (a) ≥2 targets that all carry an explicit path sharing a directory prefix: that prefix is what
 *   `dir` is for, and hoisting it removes the second place each name's folder is spelled.
 * - (b) a single target plus a `dir` and no `file`: the composition has nothing to amortize, so the
 *   plain `export <n> <dir>/<tail>:` form says the same thing in one line instead of two.
 *
 * Runs once per block (dedupe on the shared `group` identity), and arm (a) stays silent when the
 * block already declares a `dir` — "hoist it into `dir`" is not actionable advice when a `dir`
 * exists, and the two would have to be merged rather than moved.
 */
const lintExportBlockDirShape = (mod: ModuleRecord, diagnostics: Diagnostic[]): void => {
  const seen = new Set<ExportGroup>()
  for (const ex of mod.exports) {
    const group = ex.group
    if (seen.has(group)) {
      continue
    }
    seen.add(group)
    const paths = group.explicitPaths
    if (paths.length >= 2 && group.dir === undefined) {
      const explicit = paths.filter((p): p is string => p !== undefined)
      const prefix = explicit.length === paths.length ? sharedDirPrefix(explicit).join('/') : ''
      if (prefix !== '') {
        diagnostics.push(
          warning(
            'W019',
            `all ${paths.length} targets of this export block share the path prefix '${prefix}/'`,
            mod.displayPath,
            group.span,
            `hoist the shared '${prefix}/' prefix into 'dir ${prefix}'`,
          ),
        )
      }
      continue
    }
    if (paths.length === 1 && group.dir !== undefined && !group.hasFile) {
      const tail = paths[0] ?? ex.name
      diagnostics.push(
        warning(
          'W019',
          "'dir' on a single-target export block",
          mod.displayPath,
          group.dirSpan ?? group.span,
          `a single target needs no 'dir' — write 'export ${ex.name} ${group.dir}/${tail}:'`,
        ),
      )
    }
  }
}

/** A `pin NAME PT` fact resolved to a literal `x`; `y` is irrelevant here (a Front/Back mirror never changes it). */
type PinXFact = { readonly x: number; readonly span: TextSpan }

/**
 * The literal, own (non-dotted) `pin` declarations at the top level of `def`'s body — the same
 * scope `lintStampWithPins`'s `hasPins` reads, i.e. the part's OWN attach points, never a
 * canvas-space pin seed (`pin part.name PT`) or one buried in a conditional. Keyed by name; a pin
 * whose point isn't a literal number pair (a computed anchor) can't be checked and is skipped.
 */
const ownPinFacts = (def: DrawDefinition): Map<string, PinXFact> => {
  const out = new Map<string, PinXFact>()
  for (const stmt of def.body) {
    if (stmt.kind !== 'pinDeclaration' || stmt.name.includes('.')) {
      continue
    }
    const point = pointFromExpr(stmt.point)
    if (point) {
      out.set(stmt.name, { x: point.x, span: stmt.span })
    }
  }
  return out
}

/**
 * True iff `name` ends in a handed `L`/`R` suffix AND `pins` also declares the opposite-handed
 * sibling (`templeL` <-> `templeR`) — the pin SET is then already mirror-symmetric by construction:
 * a `fit` mirrors the view by fitting the prop to the OTHER pin, never by moving either coordinate.
 */
const hasHandedSibling = (name: string, pins: ReadonlyMap<string, PinXFact>): boolean => {
  const last = name.slice(-1)
  if (name.length < 2 || (last !== 'L' && last !== 'R')) {
    return false
  }
  return pins.has(`${name.slice(0, -1)}${last === 'L' ? 'R' : 'L'}`)
}

/**
 * Lint `W017`: a `Front`/`Back` view pair of the same part (two draws in one module whose names
 * share a stem and differ only by that suffix) repeats an off-centre attach pin's `x` verbatim. The
 * `Back` view is the SAME figure turned 180 degrees, so a pin that doesn't sit on the vertical
 * centreline must mirror between the two (`w - 1 - x` — the engine mirrors about `cx = (w-1)/2`,
 * `#buildStampMatrix` in `src/eval.ts`, the same axis `flipx` uses). Copying the front pin verbatim
 * leaves the prop on the same side of the canvas in both views and the character silently swaps
 * hands — this shipped in three places at once this release (the character starter and both
 * flagship knight/wizard recipes, fixed in `615be5a`/`761347d`/`dd3d063`) and passed every
 * automated gate; only a human looking at a contact sheet caught it.
 *
 * Every condition below is measured against the corpus, not assumed:
 * - both draws must share a canvas width — an unequal width has no shared mirror axis to check
 * - only an OFF-CENTRE pin (`|x - (w-1)/2| >= 4`) is flagged; a near-centreline pin is legitimately
 *   close to symmetric and repeating it is not a bug
 * - a pin that is part of an L/R pair ({@link hasHandedSibling}) is exempt — without this exclusion
 *   the check is unusable: on the pre-fix corpus it fired 8 times on the wizard and twice on the
 *   assassin, every single one a correct `templeL`/`templeR`, `brimL`/`brimR`, `shoulderL`/
 *   `shoulderR`, `gripL`/`gripR` pair. WITH it: two real findings (knight, starter), zero false
 *   positives, and no findings at all on the fixed corpus (knight, wizard, archer, assassin).
 *
 * Honest limit, deliberately not addressed here: this only catches a wrong PIN COORDINATE. It does
 * NOT catch an assembly-site error — fitting a prop to the wrong pin of an already-correct L/R pair
 * (the wizard's actual pre-fix defect: `robeBack.gripL` instead of `gripR`) is a different mistake
 * and would need its own measurement, not a bolt-on rule here.
 *
 * The stem/suffix split here is deliberately its own thing, not a reuse of `critique.ts`'s
 * `viewSubjectStem`: that helper groups a name under ANY shared view stem (front/side/back alike)
 * for silhouette/landmark comparison across a whole family; this check needs a directed Front<->Back
 * pair specifically, and reusing it would mean exporting a symbol from a file this change otherwise
 * never touches (and that, at the time of writing, is under concurrent edit).
 */
const lintMirroredViewPin = (mod: ModuleRecord, diagnostics: Diagnostic[]): void => {
  const draws = new Map<string, DrawDefinition>()
  for (const [name, entry] of mod.definitions) {
    if (entry.kind === 'draw' && entry.module === mod) {
      draws.set(name, entry.definition)
    }
  }
  for (const [backName, backDef] of draws) {
    if (!backName.endsWith('Back') || backName.length <= 'Back'.length) {
      continue
    }
    const frontName = `${backName.slice(0, -'Back'.length)}Front`
    const frontDef = draws.get(frontName)
    if (!frontDef) {
      continue
    }
    const backWidth = (backDef.size ?? mod.sizeDefault ?? mod.fileTheme?.size)?.width
    const frontWidth = (frontDef.size ?? mod.sizeDefault ?? mod.fileTheme?.size)?.width
    if (backWidth === undefined || backWidth !== frontWidth) {
      continue
    }
    const w = backWidth
    const backPins = ownPinFacts(backDef)
    const frontPins = ownPinFacts(frontDef)
    for (const [name, backPin] of backPins) {
      const frontPin = frontPins.get(name)
      if (
        !frontPin ||
        frontPin.x !== backPin.x ||
        Math.abs(backPin.x - (w - 1) / 2) < 4 ||
        hasHandedSibling(name, frontPins) ||
        hasHandedSibling(name, backPins)
      ) {
        continue
      }
      const expected = w - 1 - backPin.x
      diagnostics.push(
        warning(
          'W017',
          `pin '${name}' has the same x (${backPin.x}) in '${frontName}' and '${backName}' — a Front/Back pair is the same figure turned 180°`,
          mod.displayPath,
          backPin.span,
          `mirror it: x=${expected} here (w - 1 - x on canvas width ${w} — the axis 'flipx' mirrors about)`,
        ),
      )
    }
  }
}

// ── W020: cross-kind name collision ─────────────────────────────────────────
//
// `draw`/`path`/`theme`/`fn`/`atlas`/`skeleton`/`pose` share one namespace with everything else
// (ADR-0046) and are pre-collected up front (`#collectDefs` in `src/eval.ts`), so a repeat throws
// `E007 duplicate definition` loudly, at the second declaration. `mask`/`gradient`/plain bindings
// (`Statement.kind === 'binding'`), plus `materialBinding` and `lightBinding`, are NOT
// collision-checked against each other: each funnels its name through `Environment.assignLocal`/
// `declare` (`#execBinding`/`#execLightBinding`/`#execMaterialBinding`), which only asks "is this
// name const/palette-reserved" (`#checkBindable`) — never "does this name already hold a different
// KIND of thing" — so a second bind of the same name to a different kind just overwrites the first,
// silently. A twelve-cell model evaluation found this as the single most common first failure; three
// eval cells hit it directly: a region `liquid` clobbered by a later `material liquid`, and a `mask
// tower` clobbered by a later `material tower` — in both cases nothing is reported at the overwrite,
// only a confusing error (or nothing at all) at the next *use* of the clobbered name.

/** The five binding shapes W020 tracks — everything that reaches `assignLocal`/`declare` without a
 *  kind check (see the section comment above). A plain `binding` (no `gradient`/`mask` keyword) is
 *  labelled `value` since it carries no keyword of its own. */
type BindKind = 'mask' | 'material' | 'gradient' | 'light' | 'value'

/**
 * `stmt`'s W020 binding-kind and the name(s) it binds; `null` for every other statement (a
 * `draw`/`path`/`theme`/`fn`/`atlas`/`skeleton`/`pose` repeat already throws `E007` at declaration
 * and needs no lint here — see the section comment above).
 */
const bindKindOf = (
  stmt: Statement,
): { readonly names: readonly string[]; readonly kind: BindKind } | null => {
  if (stmt.kind === 'binding') {
    return { names: stmt.names, kind: stmt.bindKind === 'plain' ? 'value' : stmt.bindKind }
  }
  if (stmt.kind === 'materialBinding') {
    return { names: [stmt.name], kind: 'material' }
  }
  if (stmt.kind === 'lightBinding') {
    return { names: [stmt.name], kind: 'light' }
  }
  return null
}

/**
 * One lexical scope's own name → kind facts for {@link lintNameKindCollision}, chained to a parent
 * scope exactly like the runtime `Environment`/`assignLocal` (`src/eval.ts`): a lookup walks
 * outward through parents, and rebinding a name already owned by an ancestor updates the fact THERE
 * — not in the current scope — mirroring `assignLocal`'s "reassign the nearest reachable mutable
 * binding, else declare fresh locally" rule. A fresh root scope has no parent, matching the draw
 * `barrier` `assignLocal` never crosses outward (ADR-0081) — see the scope note on
 * {@link lintNameKindCollision}.
 */
class KindScope {
  readonly #own = new Map<string, { readonly kind: BindKind; readonly line: number }>()
  constructor(private readonly parent: KindScope | null) {}

  #owner(name: string): KindScope | null {
    if (this.#own.has(name)) {
      return this
    }
    return this.parent ? this.parent.#owner(name) : null
  }

  /** Records `name` as `kind`; returns the fact it replaced (own or an ancestor's), `null` when
   *  nothing reachable already owns `name` (a fresh declaration, local to this scope). */
  record(
    name: string,
    kind: BindKind,
    line: number,
  ): { readonly kind: BindKind; readonly line: number } | null {
    const owner = this.#owner(name) ?? this
    const prev = owner.#own.get(name) ?? null
    owner.#own.set(name, { kind, line })
    return prev
  }
}

/**
 * Lint `W020`: a name bound ({@link bindKindOf}) to a DIFFERENT kind than an earlier, still
 * reachable binding of the same name — the exact footgun the section comment above describes.
 * Fires once per rebind that changes kind: the recorded kind is updated to the new one every time
 * ({@link KindScope.record}), so a rebind back to the ORIGINAL kind still fires (it changed again),
 * while a run of SAME-kind rebinds — the ADR-0081 loop/accumulator idiom, `g = circle(…)` then
 * `g = g.union(…)` inside a `for` body, both `value` — never does, since the recorded kind never
 * actually changes. That is the deliberate design point: rebinding to the same kind is legal and
 * common (loop accumulators, a `mask`/`material` re-declared per branch with the same shape) and
 * must stay silent, or the lint becomes noise and gets ignored.
 *
 * Scope mirrors `Environment` exactly ({@link KindScope}): a nested block (`if`/`match`/`for`/
 * `scatter`/`mirror`/`mask { }`) gets its own child scope, so a binding inside one CAN collide with
 * a name from an enclosing scope (the same outward walk `assignLocal` performs) — but a name FIRST
 * introduced inside a branch is scoped to that branch alone. An `if`/`else` pair (or two `match`
 * arms) independently introducing the same NEW name as two different kinds is therefore silent: at
 * runtime at most one branch ever executes, each in its own environment, and neither is visible to
 * the other or to anything after the statement — not a confusable collision.
 *
 * Deliberately OUT of scope: a drawing-local name shadowing a module-level one. `assignLocal` never
 * crosses the draw's own `barrier` (ADR-0081) — a draw cannot reach or mutate module state — so a
 * draw-local re-declaration is a fresh, intentional local binding, not a silent overwrite of
 * anything: every reference inside that draw already means the local one, and nothing outside the
 * draw can observe the shadowed module binding at all. That is the same shadowing ADR-0073/ADR-0081
 * already bless for the canvas `w`/`h` and outer module consts, so flagging it here would just be
 * noise on a legal, idiomatic pattern. Consequently each draw gets its own root {@link KindScope}
 * with no parent ({@link lintDrawNameKindCollision}), and the module-level pass
 * ({@link lintModuleNameKindCollision}) is entirely separate — the two never share a scope.
 */
const lintNameKindCollision = (
  statements: readonly Statement[],
  scope: KindScope,
  mod: ModuleRecord,
  diagnostics: Diagnostic[],
): void => {
  for (const stmt of statements) {
    const bound = bindKindOf(stmt)
    if (bound) {
      for (const name of bound.names) {
        const prev = scope.record(name, bound.kind, stmt.span.line)
        if (prev && prev.kind !== bound.kind) {
          diagnostics.push(
            warning(
              'W020',
              `'${name}' rebinds a ${prev.kind} (line ${prev.line}) as a ${bound.kind} — different kinds sharing a name silently overwrite each other`,
              mod.displayPath,
              stmt.span,
              "give one of them its own name — only 'draw'/'path'/'theme'/'fn'/'atlas'/'skeleton'/'pose' collide loudly (E007); every other kind of binding silently overwrites",
            ),
          )
        }
      }
      continue
    }
    switch (stmt.kind) {
      case 'if':
        lintNameKindCollision(stmt.thenStatement, new KindScope(scope), mod, diagnostics)
        if (stmt.elseStatement) {
          lintNameKindCollision(stmt.elseStatement, new KindScope(scope), mod, diagnostics)
        }
        break
      case 'match':
        for (const arm of stmt.arms) {
          lintNameKindCollision(arm.body, new KindScope(scope), mod, diagnostics)
        }
        break
      case 'for':
      case 'scatter':
      case 'mirror':
      case 'maskBlock':
        lintNameKindCollision(stmt.body, new KindScope(scope), mod, diagnostics)
        break
      default:
        break
    }
  }
}

/** Runs {@link lintNameKindCollision} over one drawing's body, in its own root scope (no parent —
 *  see the "deliberately out of scope" note there). */
const lintDrawNameKindCollision = (
  def: DrawDefinition,
  mod: ModuleRecord,
  diagnostics: Diagnostic[],
): void => {
  lintNameKindCollision(def.body, new KindScope(null), mod, diagnostics)
}

/**
 * Runs {@link lintNameKindCollision} over a module's own top-level statements — flat (module scope
 * has no `if`/`for`/`match`/etc.), and entirely disjoint from every draw's own pass above: a
 * `drawDefinition` statement here is opaque to {@link bindKindOf} and isn't one of the recursed
 * kinds, so this never descends into a draw body.
 */
const lintModuleNameKindCollision = (mod: ModuleRecord, diagnostics: Diagnostic[]): void => {
  lintNameKindCollision(mod.ast.statements, new KindScope(null), mod, diagnostics)
}

// ── W013–W015: the one-canonical-way lints (ADR-0094) ───────────────────────
//
// Each pushes toward the single canonical path the declarative pipeline established, and each is
// conservative (fires only on a statically certain misuse) like every other `W0xx`. They are the
// machine-checkable half of the construct census: W013 = manual value-spread patch, W014 = stamp of
// a pinned part, W015 = hand contact-shadow ellipse.
//
// **`W012` is retired** (ADR-0097). It flagged a raw `rim`/`shadeRegion`/`lightRegion` beside a
// `model`/`cel`; all three commands are now removed, so it can never fire again. The code is
// reserved and must never be reused — a diagnostic code is part of the public surface, and a
// recycled one would make an old recipe's saved report mean something new. Removing four constructs
// removed a lint instead of adding one; the three names now surface as `retired` in the census
// (see {@link RETIRED_CONSTRUCTS}), which is strictly earlier and stronger than the old warning.

/** Colour helpers whose presence in a clipped `fill` marks the retired corner-patch idiom (W013). */
const VALUE_SPREAD_FNS = new Set(['litTone', 'shadowTone'])
/** Floor constructs the canonical task path no longer surfaces (flagged `spec-only` in the census). */
const SPEC_ONLY_CONSTRUCTS = new Set(['scatter', 'mirror', 'pixels'])

/**
 * Removed builtin/command names (ADR-0096 §1, ADR-0097 §1) that still keep a positioned removal
 * error at eval time rather than a parse-time one — so a stale recipe using them loads fine and only
 * fails when the drawing that uses them is rendered. Flagged `retired` in the census so
 * `check --lint`/`critique` can diagnose the recipe statically, before that render happens.
 * `castShadow` and the removed hand-light quartet are call statements (picked up by
 * {@link constructLabel} like any other command); `grayscale` has no statement shape of its own —
 * it's only ever reached as a call/UFCS expression, so the census walks expressions for it
 * separately (see {@link callsRetiredExpr}). The parse-time removals (`cap`/`join`, `seed N`, the
 * `drawstic N` pragma, a bare-int export size, `anchor` on `fit`, a bare filter name as a statement)
 * never reach the census at all — the module fails to load before `censusModule` runs.
 */
const RETIRED_CONSTRUCTS = new Set([
  'castShadow',
  'grayscale',
  'rim',
  'shadeRegion',
  'lightRegion',
  'ao',
])

/**
 * The subset of {@link RETIRED_CONSTRUCTS} the census may only discover in *expression* position.
 * `grayscale(c)` is a colour function; every other retired name is a command statement, already
 * counted by {@link constructLabel}. Keeping the expression walk narrow is what stops a retired
 * command from being counted twice.
 */
const RETIRED_EXPR_ONLY = new Set(['grayscale'])

/** True iff `def` shades any region through the declarative `model`/`cel` pipeline. */
const usesModelOrCel = (def: DrawDefinition): boolean => {
  let found = false
  walkStatements(def.body, (s) => {
    if (s.kind === 'call' && (s.callee === 'model' || s.callee === 'cel')) {
      found = true
    }
  })
  return found
}

/** True iff any node of `expr` satisfies `pred` (recurses the whole subtree, args included). */
const exprAny = (expr: Expression, pred: (e: Expression) => boolean): boolean => {
  if (pred(expr)) {
    return true
  }
  switch (expr.kind) {
    case 'point':
      return exprAny(expr.x, pred) || exprAny(expr.y, pred)
    case 'list':
      return expr.items.some((i) => exprAny(i, pred))
    case 'range':
      return exprAny(expr.from, pred) || exprAny(expr.to, pred)
    case 'unary':
      return exprAny(expr.operand, pred)
    case 'binary':
      return exprAny(expr.left, pred) || exprAny(expr.right, pred)
    case 'ifExpression':
      return (
        exprAny(expr.condition, pred) ||
        exprAny(expr.thenExpression, pred) ||
        exprAny(expr.elseExpression, pred)
      )
    case 'call':
      return exprAny(expr.callee, pred) || expr.args.some((a) => argAny(a, pred))
    case 'index':
      return exprAny(expr.target, pred) || exprAny(expr.index, pred)
    case 'dotIndex':
      return exprAny(expr.target, pred)
    case 'method':
      return exprAny(expr.target, pred) || (expr.args ?? []).some((a) => argAny(a, pred))
    default:
      return false
  }
}

const argAny = (arg: Argument, pred: (e: Expression) => boolean): boolean =>
  arg.kind === 'expression'
    ? exprAny(arg.expression, pred)
    : arg.parts.some((p) => exprAny(p, pred))

/** A call `f(…)` or UFCS `x.f(…)` whose function name is in `names`. */
const callsNamed =
  (names: ReadonlySet<string>) =>
  (e: Expression): boolean =>
    (e.kind === 'call' && e.callee.kind === 'name' && names.has(e.callee.name)) ||
    (e.kind === 'method' && names.has(e.name))

/**
 * True iff any of `stmt`'s own expressions (not nested statement bodies — {@link walkStatements}
 * already recurses those) call or UFCS-call a {@link RETIRED_EXPR_ONLY} name — covers `grayscale`,
 * which (unlike the retired commands) has no Statement shape of its own, only ever reached as a
 * value expression. Same statement-shape enumeration as `walkStatementExprs` below.
 */
const callsRetiredExpr = (stmt: Statement): boolean => {
  const pred = callsNamed(RETIRED_EXPR_ONLY)
  switch (stmt.kind) {
    case 'binding':
    case 'compound':
    case 'maskBlock':
      return exprAny(stmt.expression, pred)
    case 'call':
      return stmt.args.some((a) => argAny(a, pred))
    case 'if':
      return exprAny(stmt.condition, pred)
    case 'match':
      return (
        exprAny(stmt.subject, pred) ||
        stmt.arms.some((arm) => arm.label !== undefined && exprAny(arm.label, pred))
      )
    case 'for':
      return exprAny(stmt.iterable, pred)
    default:
      return false
  }
}

/** A `<region>.intersect(<rect>)` method call — the corner-clip of the retired value patch. */
const isIntersectMethod = (e: Expression): boolean => e.kind === 'method' && e.name === 'intersect'

/**
 * Lint `W013`: a `fill` whose paint uses `litTone`/`shadowTone` and whose region is a
 * `.intersect(rect …)` clip, inside a `model`/`cel` drawing — the retired hand corner-patch that
 * lifted a modeled region's value spread by hand (W2-1b). Canonical: the material's `spread N%`.
 */
const lintCornerPatch = (
  def: DrawDefinition,
  mod: ModuleRecord,
  diagnostics: Diagnostic[],
): void => {
  if (!usesModelOrCel(def)) {
    return
  }
  const tonePred = callsNamed(VALUE_SPREAD_FNS)
  walkStatements(def.body, (s) => {
    if (s.kind !== 'call' || s.callee !== 'fill') {
      return
    }
    const hasTone = s.args.some((a) => argAny(a, tonePred))
    const hasClip = s.args.some((a) => argAny(a, isIntersectMethod))
    if (hasTone && hasClip) {
      diagnostics.push(
        warning(
          'W013',
          'litTone/shadowTone corner-patch fill on a modeled region',
          mod.displayPath,
          s.span,
          "widen the value range with the material's 'spread N%' override, not a clipped litTone/shadowTone fill",
        ),
      )
    }
  })
}

/**
 * Lint `W014`: a `stamp` of a part that declares its own attach `pin`s. A pinned part is meant to be
 * *fitted* (contact-guaranteed) — the sole canonical placement — while `stamp` is for pin-less
 * decoration. A pin-seeded assembly root (its canvas pins declared as `pin <part>.<name>`, ADR-0092)
 * is exempt: stamping the root, then seeding its pins, is the two-phase assembly idiom.
 */
const lintStampWithPins = (
  mod: ModuleRecord,
  def: DrawDefinition,
  diagnostics: Diagnostic[],
): void => {
  const seededRoots = new Set<string>()
  walkStatements(def.body, (s) => {
    if (s.kind === 'pinDeclaration') {
      const dot = s.name.indexOf('.')
      if (dot > 0) {
        seededRoots.add(s.name.slice(0, dot))
      }
    }
  })
  walkStatements(def.body, (s) => {
    if (s.kind !== 'call' || s.callee !== 'stamp') {
      return
    }
    const name = stampTargetName(s.args[0])
    if (!name || seededRoots.has(name)) {
      return
    }
    const target = mod.definitions.get(name)
    if (target?.kind !== 'draw') {
      return
    }
    const hasPins = target.definition.body.some(
      (st) => st.kind === 'pinDeclaration' && !st.name.includes('.'),
    )
    if (!hasPins) {
      return
    }
    diagnostics.push(
      warning(
        'W014',
        `stamp of '${name}', which declares attach pins`,
        mod.displayPath,
        s.span,
        `place a pinned part with 'fit ${name}.<pin> <anchor>' for guaranteed contact, or drop its pins if it is decoration`,
      ),
    )
  })
}

/** The literal centre-y of `ellipse(cx:cy, …)`; `null` for a computed/other expression. */
const ellipseCenterY = (expr: Expression): number | null => {
  if (expr.kind !== 'call' || expr.callee.kind !== 'name' || expr.callee.name !== 'ellipse') {
    return null
  }
  const first = expr.args[0]
  if (first?.kind !== 'expression' || first.expression.kind !== 'point') {
    return null
  }
  return literalNumber(first.expression.y)
}

/**
 * Lint `W015`: a semi-transparent `fill … ellipse(…)` low in the foot zone of a drawing that uses
 * `fit` — a hand contact-shadow. Canonical: the root `fit … shadow` flag drops an auto contact-shadow
 * correctly anchored to the footprint. Conservative: only fires on a statically low-alpha paint whose
 * ellipse centre sits in the bottom fifth of the canvas.
 */
const lintHandContactShadow = (
  engine: Engine,
  mod: ModuleRecord,
  def: DrawDefinition,
  diagnostics: Diagnostic[],
): void => {
  let hasFit = false
  walkStatements(def.body, (s) => {
    if (s.kind === 'fit') {
      hasFit = true
    }
  })
  if (!hasFit) {
    return
  }
  const size = def.size ?? mod.sizeDefault ?? mod.fileTheme?.size
  const h = size?.height
  if (!h) {
    return
  }
  walkStatements(def.body, (s) => {
    if (s.kind !== 'call' || s.callee !== 'fill') {
      return
    }
    let cy: number | null = null
    for (const a of s.args) {
      if (a.kind === 'expression') {
        const y = ellipseCenterY(a.expression)
        if (y !== null) {
          cy = y
        }
      }
    }
    if (cy === null || cy < h * 0.8) {
      return
    }
    const paintArg = s.args.find(
      (a) => a.kind === 'expression' && ellipseCenterY(a.expression) === null,
    )
    if (paintArg?.kind !== 'expression') {
      return
    }
    const alpha = staticPaintAlpha(engine, mod, paintArg.expression)
    if (alpha === null || alpha >= 153) {
      return
    }
    diagnostics.push(
      warning(
        'W015',
        'hand contact-shadow ellipse in the foot zone',
        mod.displayPath,
        s.span,
        "drop it and add the 'shadow' flag to the root 'fit … shadow' (auto contact-shadow, anchored to the footprint)",
      ),
    )
  })
}

/** Runs the three canonical-path lints (W013–W015) against one drawing. */
const canonicalPathChecks = (
  engine: Engine,
  mod: ModuleRecord,
  def: DrawDefinition,
): Diagnostic[] => {
  const out: Diagnostic[] = []
  lintCornerPatch(def, mod, out)
  lintStampWithPins(mod, def, out)
  lintHandContactShadow(engine, mod, def, out)
  return out
}

/** One construct's usage count plus its canonicality flags (ADR-0094 construct census). */
export type CensusEntry = {
  readonly construct: string
  readonly count: number
  /** A floor construct the canonical task path no longer surfaces. */
  readonly specOnly?: boolean
  /** This construct participated in a W013–W015 finding somewhere in the module. */
  readonly nonCanonical?: boolean
  /**
   * A removed construct (ADR-0096 §1, ADR-0097 §1) — still parses/loads, but errors when the
   * drawing renders.
   */
  readonly retired?: boolean
}

/** The deterministic per-module construct census surfaced in `critique`/`check --lint` JSON. */
export type ModuleCensus = {
  readonly constructs: readonly CensusEntry[]
  /**
   * The machine-checkable anti-pattern counts (craft-eval success criteria). ADR-0094's fourth
   * count, `rawShade` (W012), is gone: its three commands were removed by ADR-0097, so the number
   * could only ever be 0 — a metric that cannot move is noise in every report that carries it.
   * Those recipes are now caught earlier, as `retired` construct entries.
   */
  readonly antiPatterns: {
    /** W013 — litTone/shadowTone `.intersect` corner patch. */
    readonly manualSpread: number
    /** W014 — stamp of a part that owns pins. */
    readonly stampWithPins: number
    /** W015 — hand contact-shadow ellipse. */
    readonly handShadow: number
  }
}

/** The construct label a statement contributes to the census, or `null` when it isn't counted. */
const constructLabel = (stmt: Statement): string | null => {
  switch (stmt.kind) {
    case 'call':
      return stmt.callee
    case 'pinDeclaration':
      return 'pin'
    case 'fit':
      return 'fit'
    case 'maskBlock':
      return 'mask'
    case 'materialBinding':
      return 'material'
    case 'lightBinding':
      return 'light'
    case 'for':
    case 'if':
    case 'match':
    case 'scatter':
    case 'mirror':
    case 'pixels':
    case 'use':
      return stmt.kind === 'pixels' ? 'pixels' : stmt.kind
    case 'palette':
      return 'palette'
    default:
      return null
  }
}

/**
 * Count every language construct used across `mod`'s own drawings and flag each `spec-only`
 * (floor), `non-canonical` (a W013–W015 participant) or `retired` (removed, still loads).
 * Deterministic (AST-only, sorted by construct name); the three `antiPatterns` counts are the
 * craft-eval success criteria (manual-spread / stamp-with-pins / hand-ellipse-shadow all target 0).
 */
export const censusModule = (engine: Engine, mod: ModuleRecord): ModuleCensus => {
  const counts = new Map<string, number>()
  let manualSpread = 0
  let stampWithPins = 0
  let handShadow = 0
  for (const [, entry] of mod.definitions) {
    if (entry.kind !== 'draw' || entry.module !== mod) {
      continue
    }
    walkStatements(entry.definition.body, (s) => {
      const label = constructLabel(s)
      if (label) {
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
      // `grayscale` (ADR-0096 §1) has no statement shape of its own — it's only ever reached as
      // a call/UFCS expression, so `constructLabel` above can't see it; check separately. Every
      // retired construct with a real statement shape (`castShadow`, the ADR-0097 hand-light
      // quartet) is already counted by `constructLabel` and can never itself appear in expression
      // position, so this can only ever add a `grayscale` count, never double-count those.
      if (callsRetiredExpr(s)) {
        counts.set('grayscale', (counts.get('grayscale') ?? 0) + 1)
      }
    })
    for (const d of canonicalPathChecks(engine, mod, entry.definition)) {
      if (d.code === 'W013') {
        manualSpread++
      } else if (d.code === 'W014') {
        stampWithPins++
      } else if (d.code === 'W015') {
        handShadow++
      }
    }
  }
  const nonCanonical = new Set<string>()
  if (stampWithPins > 0) {
    nonCanonical.add('stamp')
  }
  const constructs: CensusEntry[] = [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([construct, count]) => ({
      construct,
      count,
      ...(SPEC_ONLY_CONSTRUCTS.has(construct) ? { specOnly: true } : {}),
      ...(nonCanonical.has(construct) ? { nonCanonical: true } : {}),
      ...(RETIRED_CONSTRUCTS.has(construct) ? { retired: true } : {}),
    }))
  return { constructs, antiPatterns: { manualSpread, stampWithPins, handShadow } }
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

/** The literal `{x, y}` of a point expression (`6:52`); `null` for anything computed. */
const pointFromExpr = (expr: Expression): { readonly x: number; readonly y: number } | null => {
  if (expr.kind !== 'point') {
    return null
  }
  const x = literalNumber(expr.x)
  const y = literalNumber(expr.y)
  return x === null || y === null ? null : { x, y }
}

/**
 * Resolves a stamp's placement point only when it's a literal (optionally
 * negated) numeric point expression; `null` for anything computed.
 */
const literalPoint = (
  arg: Argument | undefined,
): { readonly x: number; readonly y: number } | null =>
  arg?.kind === 'expression' ? pointFromExpr(arg.expression) : null

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
// into every nested statement body (`if`/`match`/`for`/`scatter`/`mirror`/
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
      case 'for':
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
    case 'for':
      walkExpr(stmt.iterable, names)
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
