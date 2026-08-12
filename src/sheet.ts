// Family contact sheet (`drawstic sheet`, ADR-0082): renders every selected
// drawing of a module size-normalized into ONE labeled comparison grid, so an
// agent can QA a whole icon/sprite family — corner radii, stroke weights, light
// edges, grey-value balance — at a glance instead of eyeballing single renders.
// Deterministic: fixed layout math, fixed palette, drawing order from the
// module's export/definition order. Composed with the same render/raster
// infrastructure as everything else (import-only).

import type { Statement } from './ast.js'
import { type Color, rgb } from './color.js'
import type { TextSpan } from './diagnostic.js'
import type { DefinitionEntry, Engine, ModuleRecord } from './eval.js'
import { Framebuffer } from './framebuffer.js'
import { stampTargetName, walkStatements } from './lint.js'
import { type Context, drawText, type FontResolved, stampSprite } from './raster.js'
import type { Sprite } from './values.js'

/** One tile's placement in the composed sheet (unscaled sheet-pixel coordinates). */
export type SheetCell = {
  readonly name: string
  /** The drawing's own rendered width/height (before centering in the cell). */
  readonly w: number
  readonly h: number
  /** Top-left of the drawing within the sheet (the tile origin, label sits below). */
  readonly x: number
  readonly y: number
}

/** The result of composing a sheet: the RGBA sprite plus its deterministic layout facts. */
export type SheetLayout = {
  readonly sprite: Sprite
  readonly cols: number
  readonly rows: number
  readonly cell: { readonly width: number; readonly height: number }
  readonly cells: readonly SheetCell[]
}

const SPAN: TextSpan = { line: 1, column: 1 }

// Fixed, theme-neutral palette (dark canvas + mid-grey transparency checker),
// chosen so both near-white and near-black icons read against it.
const BG: Color = rgb(0x1e, 0x21, 0x28)
const CHECKER_A: Color = rgb(0x5f, 0x64, 0x6c)
const CHECKER_B: Color = rgb(0x51, 0x56, 0x5d)
const FRAME: Color = rgb(0x3a, 0x3f, 0x4a)
const LABEL: Color = rgb(0xd6, 0xda, 0xe1)

const MARGIN = 3
const GAP = 2
const LABEL_GAP = 2
const CHECKER_CELL = 4
/** The font every label is drawn in (5×7, legible at 100%); resolved once per sheet. */
const LABEL_FONT = 'small'

/**
 * Select the drawings a sheet should show: by default every **exported** drawing
 * (in export-declaration order, deduped), or **every** non-parametric drawing in
 * definition order when `all` is set. Parametric drawings are excluded either way
 * (they can't be rendered without arguments). When a module exports nothing at
 * all, the default falls back to every drawing so the sheet is never empty for a
 * module that plainly has drawings to compare.
 */
export const selectSheetDrawings = (
  mod: ModuleRecord,
  all: boolean,
): Extract<DefinitionEntry, { readonly kind: 'draw' }>[] => {
  const isOwnDraw = (
    entry: DefinitionEntry | undefined,
  ): entry is Extract<DefinitionEntry, { readonly kind: 'draw' }> =>
    entry?.kind === 'draw' && entry.module === mod && (entry.definition.params?.length ?? 0) === 0
  const allDraws = (): Extract<DefinitionEntry, { readonly kind: 'draw' }>[] => {
    const out: Extract<DefinitionEntry, { readonly kind: 'draw' }>[] = []
    for (const [, entry] of mod.definitions) {
      if (isOwnDraw(entry)) {
        out.push(entry)
      }
    }
    return out
  }
  if (all || mod.exports.length === 0) {
    return allDraws()
  }
  const out: Extract<DefinitionEntry, { readonly kind: 'draw' }>[] = []
  const seen = new Set<string>()
  for (const ex of mod.exports) {
    if (seen.has(ex.name)) {
      continue
    }
    const entry = mod.definitions.get(ex.name)
    if (isOwnDraw(entry)) {
      seen.add(ex.name)
      out.push(entry)
    }
  }
  // an export-only module whose exports are all parametric/tilesets: fall back
  // to every drawing rather than emit an empty sheet.
  return out.length > 0 ? out : allDraws()
}

/**
 * True iff `body` `stamp`s two or more OTHER names from `candidateNames` — the structural
 * signature of a hand-authored presentation sheet (`draw xSheet: stamp xFront …; stamp xSide …`)
 * that visually composes its own siblings onto one panel, as opposed to an independent view.
 */
const stampsMultipleCandidates = (
  body: readonly Statement[],
  ownName: string,
  candidateNames: ReadonlySet<string>,
): boolean => {
  const stamped = new Set<string>()
  walkStatements(body, (stmt) => {
    if (stmt.kind !== 'call' || stmt.callee !== 'stamp') {
      return
    }
    const name = stampTargetName(stmt.args[0])
    if (name && name !== ownName && candidateNames.has(name)) {
      stamped.add(name)
    }
  })
  return stamped.size >= 2
}

/**
 * Select the drawings a **critique family** should compare (ADR-0085, hardened for the
 * character-DX 2026-07-10 rerun §5.1/§9.8): the same candidate set as {@link selectSheetDrawings}
 * (exported drawings by default, every drawing under `all`), MINUS any candidate that is itself a
 * composed presentation of ≥2 other candidates ({@link stampsMultipleCandidates}) — a hand-built
 * `draw xSheet: stamp xFront …; stamp xSide …` panel. Structural, not name-based: the moment a
 * drawing visually assembles its own family it is disqualified as a "view," because its combined
 * mass/palette is exactly what pollutes C009 (sibling-silhouette collapse) and C011 (weight
 * parity) with noise unrelated to the individual views' craft. The `sheet` CLI command still uses
 * {@link selectSheetDrawings} directly — composing an on-demand presentation sheet is legitimate;
 * only the critique family excludes one that's already checked in as its own export.
 */
export const selectCritiqueFamily = (
  mod: ModuleRecord,
  all: boolean,
): Extract<DefinitionEntry, { readonly kind: 'draw' }>[] => {
  const candidates = selectSheetDrawings(mod, all)
  const candidateNames = new Set(candidates.map((c) => c.definition.name))
  return candidates.filter(
    (c) => !stampsMultipleCandidates(c.definition.body, c.definition.name, candidateNames),
  )
}

/** Fills an opaque axis-aligned rectangle straight into the buffer. */
const fillRect = (
  fb: Framebuffer,
  x0: number,
  y0: number,
  width: number,
  height: number,
  c: Color,
): void => {
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) {
      fb.set(x, y, c)
    }
  }
}

/** Paints a 2-tone transparency checkerboard into a rectangle. */
const fillChecker = (
  fb: Framebuffer,
  x0: number,
  y0: number,
  width: number,
  height: number,
): void => {
  for (let y = y0; y < y0 + height; y++) {
    for (let x = x0; x < x0 + width; x++) {
      const odd = (Math.floor((x - x0) / CHECKER_CELL) + Math.floor((y - y0) / CHECKER_CELL)) % 2
      fb.set(x, y, odd === 0 ? CHECKER_A : CHECKER_B)
    }
  }
}

/** Draws a 1px frame just outside a content box. */
const strokeFrame = (
  fb: Framebuffer,
  x0: number,
  y0: number,
  width: number,
  height: number,
): void => {
  for (let x = x0 - 1; x <= x0 + width; x++) {
    fb.set(x, y0 - 1, FRAME)
    fb.set(x, y0 + height, FRAME)
  }
  for (let y = y0 - 1; y <= y0 + height; y++) {
    fb.set(x0 - 1, y, FRAME)
    fb.set(x0 + width, y, FRAME)
  }
}

/** Horizontal advance of one glyph, mirroring {@link drawText}'s layout (for centering labels). */
const glyphAdvance = (font: FontResolved, ch: string): number => {
  if (font.kind === 'bitmap') {
    return font.font.w + font.font.tracking
  }
  const inline = font.inlineGlyphs.get(ch)
  if (inline) {
    return inline.width + font.tracking
  }
  const glyph = font.glyphs.get(ch)
  if (glyph) {
    return glyph.w + font.tracking
  }
  return font.fallback
    ? glyphAdvance(font.fallback, ch)
    : Math.max(3, font.height - 2) + font.tracking
}

const measureText = (font: FontResolved, text: string): number =>
  [...text].reduce((w, ch) => w + glyphAdvance(font, ch), 0)

const fontHeight = (font: FontResolved): number =>
  font.kind === 'bitmap' ? font.font.h : font.height

/**
 * Compose a family contact sheet from `entries` (already selected, e.g. via
 * {@link selectSheetDrawings}). Renders each drawing, size-normalizes every cell
 * to the largest drawing (and widest label), lays them out in `cols` columns
 * (default a square-ish `ceil(sqrt(n))`), and labels each tile. Returns `null`
 * when nothing renders. Drawings that fail to render are skipped (their errors
 * surface via `check`, not here).
 */
export const composeSheet = (
  engine: Engine,
  mod: ModuleRecord,
  entries: readonly Extract<DefinitionEntry, { readonly kind: 'draw' }>[],
  cols: number | null,
): SheetLayout | null => {
  const rendered: { readonly name: string; readonly sprite: Sprite }[] = []
  for (const entry of entries) {
    try {
      rendered.push({
        name: entry.definition.name,
        sprite: engine.renderDraw(entry, [], entry.definition.span),
      })
    } catch {
      // render errors are reported by `check`'s deep validation, not the sheet
    }
  }
  if (rendered.length === 0) {
    return null
  }

  const font = engine.resolveFont(
    LABEL_FONT,
    { module: mod, budget: engine.budget, draw: null, functionDepth: 0 },
    SPAN,
  )
  const labelH = fontHeight(font)
  const contentW = Math.max(...rendered.map((r) => r.sprite.w))
  const contentH = Math.max(...rendered.map((r) => r.sprite.h))
  const labelW = Math.max(...rendered.map((r) => measureText(font, r.name)))
  const cellW = Math.max(contentW, labelW)
  const cellH = contentH + LABEL_GAP + labelH

  const n = rendered.length
  const nCols = cols && cols > 0 ? Math.min(cols, n) : Math.ceil(Math.sqrt(n))
  const nRows = Math.ceil(n / nCols)

  const sheetW = MARGIN * 2 + nCols * cellW + (nCols - 1) * GAP
  const sheetH = MARGIN * 2 + nRows * cellH + (nRows - 1) * GAP
  const fb = new Framebuffer(sheetW, sheetH)
  fillRect(fb, 0, 0, sheetW, sheetH, BG)
  const ctx: Context = { buffer: fb, mask: null, mode: 'pixel' }

  const cells: SheetCell[] = []
  rendered.forEach((r, i) => {
    const col = i % nCols
    const row = Math.floor(i / nCols)
    const cellX = MARGIN + col * (cellW + GAP)
    const cellY = MARGIN + row * (cellH + GAP)
    fillChecker(fb, cellX, cellY, cellW, contentH)
    strokeFrame(fb, cellX, cellY, cellW, contentH)
    const tileX = cellX + Math.floor((cellW - r.sprite.w) / 2)
    const tileY = cellY + Math.floor((contentH - r.sprite.h) / 2)
    stampSprite(ctx, r.sprite, tileX, tileY)
    const lblX = cellX + Math.floor((cellW - measureText(font, r.name)) / 2)
    const lblY = cellY + contentH + LABEL_GAP
    drawText(ctx, font, lblX, lblY, r.name, LABEL)
    cells.push({ name: r.name, w: r.sprite.w, h: r.sprite.h, x: tileX, y: tileY })
  })

  return {
    sprite: {
      type: 'sprite',
      name: `${mod.displayPath}#sheet`,
      w: sheetW,
      h: sheetH,
      data: fb.data,
      pal: [],
      title: undefined,
      desc: undefined,
      // The diagnostic grid is composited by an identity blit, never region-rasterized (ADR-0013).
      mode: 'pixel',
    },
    cols: nCols,
    rows: nRows,
    cell: { width: cellW, height: cellH },
    cells,
  }
}

/**
 * Select + compose in one step (the CLI entry point). `null` when the module has
 * no drawing to sheet.
 */
export const buildSheet = (
  engine: Engine,
  mod: ModuleRecord,
  opts: { readonly cols: number | null; readonly all: boolean },
): SheetLayout | null => composeSheet(engine, mod, selectSheetDrawings(mod, opts.all), opts.cols)
