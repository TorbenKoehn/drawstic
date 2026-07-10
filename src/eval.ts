// The evaluator: module loading (sandboxed imports, ADR-0035), theme
// composition (ADR-0005), one-namespace scope with const palettes
// (ADR-0046/0050), drawing rendering, the command set (§8–§9), the runtime
// budget (§15), tilesets/atlases (ADR-0016), fonts (ADR-0022/0042).

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import type {
  Argument,
  AtlasDefinition,
  DrawDefinition,
  ExportDefinition,
  Expression,
  FontDefinition,
  FontItem,
  Module,
  PathCommand,
  PathDefinition,
  Statement,
  ThemeDefinition,
  TilesetDefinition,
} from './ast.js'
import {
  type Color,
  darken,
  desaturate,
  grayscale,
  hsl,
  lighten,
  litTone,
  type MixSpace,
  mix,
  oklch,
  parseHexColor,
  ramp,
  rgb,
  rotateHue,
  saturate,
  shadowTone,
  TRANSPARENT,
  withAlpha,
} from './color.js'
import { DrawsticError, ERROR_CODE, error, type TextSpan } from './diagnostic.js'
import {
  datan2,
  dcos,
  dexp,
  dhypot,
  dlog,
  dpow,
  dsin,
  dtan,
  noise,
  PI,
  rand,
  roundHalfUp,
  TAU,
} from './dmath.js'
import { Framebuffer, MirrorFramebuffer } from './framebuffer.js'
import { parse, parseStandaloneExpr } from './parser.js'
import { decodePng } from './png.js'
import {
  ambientOcclusion,
  arcPoints,
  bezierPoints,
  type Context,
  catmullRomLoopPoints,
  catmullRomPoints,
  drawText,
  type FontResolved,
  fillRegion,
  filterDither,
  filterGrain,
  filterOutline,
  filterReplace,
  filterRipple,
  filterShadow,
  filterSpeckle,
  filterTint,
  flood,
  lightRegion,
  type Paint,
  PixelSink,
  putPixel,
  quadPoints,
  quantInt,
  type RenderMode,
  rimRegion,
  shadeRegion,
  shadeRegionLegacy,
  stampSprite,
  strokeLine,
  strokePath,
  strokeRegion,
  type UserFontResolved,
} from './raster.js'
import { STD_GLOBAL_FONTS, STD_MODULES } from './std.js'
import {
  aboutPoint,
  applyMatrix,
  circleRegion,
  compose,
  ellipseRegion,
  emptyRegion,
  type Grad,
  IDENTITY,
  invertMatrix,
  list,
  multiplyMatrix,
  type Path,
  type PathContour,
  type PathPoint,
  type Point,
  path,
  pathFillRegion,
  pathFromRegion,
  pathStrokeRegion,
  pathTransform,
  perspectiveMatrix,
  point,
  polyRegion,
  type Region,
  rectRegion,
  regionIntersect,
  regionSubtract,
  regionTransform,
  regionUnion,
  regionXor,
  rotationDeg,
  rotationXDeg,
  rotationYDeg,
  rrectRegion,
  type Sprite,
  scaling,
  skewX,
  spriteRegion,
  type Transform,
  translation,
  typeName,
  type Value,
} from './values.js'

/**
 * Highest recipe `lang` pragma this engine accepts (ADR-0029); recipes
 * pinning a newer version fail fast with E009 rather than mis-evaluating.
 */
export const LANGUAGE_VERSION = 2

/**
 * The optional leading region of a scoped texture filter (`grain [r] …`, ADR-0071) or a shadow
 * form. Returns a Region when `v` already is one, or the silhouette of a drawing (coerced like
 * {@link Args.region}); `undefined` for any other value, so the caller falls back to the
 * whole-frame form. The first argument is evaluated once and classified here — never re-evaluated.
 */
const regionScopeOf = (v: Value): Region | undefined => {
  if (typeof v === 'object' && v !== null && v.type === 'region') {
    return v
  }
  if (typeof v === 'object' && v !== null && v.type === 'sprite') {
    return spriteRegion(v)
  }
  return undefined
}

/**
 * The Region of a closed Catmull-Rom loop through `pts` (ADR-0075): tessellate the
 * loop, quantize to the pixel grid, and even-odd fill via {@link polyRegion} — the
 * same coverage rule as `poly`/paths. Shared by the `curvePoly` command and the
 * paintless `curvePoly(...)` shape call so both forms are pixel-identical.
 */
const curvePolyRegion = (pts: readonly { readonly x: number; readonly y: number }[]): Region =>
  polyRegion(catmullRomLoopPoints(pts).map((p) => ({ x: quantInt(p.x), y: quantInt(p.y) })))

// ── budget (spec §15) ───────────────────────────────────────────────────────

/**
 * Mutable evaluation-cost counters enforcing totality (spec §15, ADR-0004):
 * every recipe terminates because steps and pixel writes are capped.
 * `steps`/`writes` accumulate across the whole {@link Engine} lifetime;
 * exceeding either throws E010.
 */
export type Budget = {
  maxSteps: number
  readonly maxWrites: number
  steps: number
  writes: number
}

/** Fresh budget with the v1-pinned default caps (ADR-0053). */
export const defaultBudget = (): Budget => ({
  steps: 0,
  maxSteps: 5_000_000,
  writes: 0,
  maxWrites: 50_000_000,
})

// ── environments (one namespace, ADR-0046) ──────────────────────────────────

type Binding = { readonly isConst: boolean; readonly isPalette: boolean; value: Value }

/**
 * A lexical scope. Palettes, params, and `let`/`const` bindings all share
 * one namespace (ADR-0046) — a single map distinguishes const/palette
 * status per entry rather than segregating palettes into their own table.
 */
class Environment {
  readonly #map = new Map<string, Binding>()
  readonly parent: Environment | null
  /**
   * A scope root that outward assignment ({@link assignLocal}) must not cross:
   * a block/loop body reaches the enclosing *draw* body, but a draw never
   * reassigns module-scope state (ADR-0081). Set on the drawing-body environment.
   */
  readonly barrier: boolean

  constructor(parent: Environment | null, barrier = false) {
    this.parent = parent
    this.barrier = barrier
  }

  lookup(name: string): Binding | null {
    const binding = this.#map.get(name)
    if (binding) {
      return binding
    }
    return this.parent ? this.parent.lookup(name) : null
  }

  /** The visible palette binding for a name, if any. */
  visiblePalette(name: string): Binding | null {
    const binding = this.lookup(name)
    return binding?.isPalette ? binding : null
  }

  declare = (name: string, v: Value, isConst = false, isPalette = false): void => {
    this.#map.set(name, { value: v, isConst, isPalette })
  }

  has = (name: string): boolean => this.#map.has(name)

  assign = (name: string, v: Value): boolean => {
    const binding = this.#map.get(name)
    if (binding) {
      binding.value = v
      return true
    }
    return this.parent ? this.parent.assign(name, v) : false
  }

  /**
   * Reassign `name` to `v` in the nearest enclosing scope that already binds it as a
   * *mutable* (non-const, non-palette) binding — searching outward but never crossing a
   * {@link barrier} scope root (ADR-0081). Returns `true` if an existing mutable binding
   * was updated so a `name = expr` inside a loop/`if`/block body persists to the enclosing
   * draw scope (region/number/point accumulators). Returns `false` when no such binding is
   * reachable, when the reachable binding is const/palette, or when a barrier is hit — the
   * caller then declares a fresh binding in the current scope (preserving ADR-0073
   * shadowing of the const canvas `w`/`h`, gradients, and outer consts).
   */
  assignLocal = (name: string, v: Value): boolean => {
    let env: Environment | null = this
    while (env) {
      const binding = env.#map.get(name)
      if (binding) {
        if (binding.isConst || binding.isPalette) {
          return false
        }
        binding.value = v
        return true
      }
      if (env.barrier) {
        return false
      }
      env = env.parent
    }
    return false
  }

  entries = (): Map<string, Binding> => this.#map
}

// ── definitions & modules ───────────────────────────────────────────────────

/**
 * A named top-level definition, paired with the module it was declared in
 * (so evaluation can resolve names against the *defining* module's scope,
 * not the importing one — imports copy the entry, not its closure).
 */
export type DefinitionEntry =
  | { readonly kind: 'draw'; readonly definition: DrawDefinition; readonly module: ModuleRecord }
  | { readonly kind: 'path'; readonly definition: PathDefinition; readonly module: ModuleRecord }
  | { readonly kind: 'theme'; readonly definition: ThemeDefinition; readonly module: ModuleRecord }
  | {
      readonly kind: 'function'
      readonly name: string
      readonly params: readonly string[]
      readonly body: Expression
      readonly module: ModuleRecord
    }
  | {
      readonly kind: 'filter'
      readonly name: string
      readonly body: readonly Statement[]
      readonly module: ModuleRecord
    }
  | { readonly kind: 'font'; readonly definition: FontDefinition; readonly module: ModuleRecord }
  | {
      readonly kind: 'tileset'
      readonly definition: TilesetDefinition
      readonly module: ModuleRecord
    }
  | { readonly kind: 'atlas'; readonly definition: AtlasDefinition; readonly module: ModuleRecord }
  | {
      readonly kind: 'image'
      readonly name: string
      readonly path: string
      readonly sha256: string | undefined
      readonly span: TextSpan
      readonly module: ModuleRecord
    }

/**
 * One loaded `.drw` file (or std module): its AST, top-level definitions,
 * module-scope environment, and the file-level directives (`use`, `size`,
 * `seed`, `font`) that apply to every drawing in it. Cached by absolute
 * path in {@link Engine} — a module is parsed and its top level executed
 * exactly once per engine instance.
 */
export type ModuleRecord = {
  readonly file: string
  readonly displayPath: string
  readonly ast: Module
  readonly definitions: Map<string, DefinitionEntry>
  readonly env: Environment
  readonly exports: ExportDefinition[]
  fileTheme: FoldedTheme | undefined
  sizeDefault: { readonly width: number; readonly height: number } | undefined
  seed: number | undefined
  fontDefault: string | undefined
}

/**
 * The flattened result of composing a theme's `with` parts and its own
 * items into one set of palette/gradient/filter/draw bindings plus style
 * directives (ADR-0005 fold semantics, ADR-0003). Later sources win on
 * key collisions (see {@link mergeThemes}); style text and filters/draws
 * are unioned.
 */
export type FoldedTheme = {
  readonly palette: {
    readonly key: string
    readonly color: Color
    readonly source: string
  }[]
  readonly gradients: Map<string, Grad>
  readonly filters: Map<
    string,
    { readonly body: readonly Statement[]; readonly module: ModuleRecord }
  >
  readonly draws: Map<
    string,
    { readonly definition: DrawDefinition; readonly module: ModuleRecord }
  >
  readonly style: { readonly source: string; readonly text: string }[]
  size: { readonly width: number; readonly height: number } | null
  mode: RenderMode | null
  font: string | null
}

const emptyTheme = (): FoldedTheme => ({
  palette: [],
  gradients: new Map(),
  filters: new Map(),
  draws: new Map(),
  size: null,
  mode: null,
  font: null,
  style: [],
})

/**
 * A built tileset (ADR-0016): tiles blitted into one `sheet` sprite on a
 * regular grid, `frames[i]` giving tile `i`'s rect in sheet coordinates in
 * declaration order (matching `names`). Built lazily by {@link Engine.buildTileset}
 * and cached per definition.
 */
export type TilesetValue = {
  readonly sheet: Sprite
  readonly tileWidth: number
  readonly tileHeight: number
  readonly columns: number
  readonly frames: readonly {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }[]
  readonly names: readonly string[]
}

/**
 * A built atlas (ADR-0016): member sprites deterministically shelf-packed
 * into one `sheet` (see {@link packShelves}), with each frame's placement
 * and original name recorded for downstream lookup/export.
 */
export type AtlasValue = {
  readonly sheet: Sprite
  readonly frames: readonly {
    readonly name: string
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }[]
}

/**
 * Per-drawing mutable state threaded through statement/command execution:
 * the raster {@link Context} (buffer, active mask, render mode), the pen
 * cursor for relative motion (spec §5/§9), the sprite-artifact accumulator
 * (palette + first-stamp order, ADR-0050), and the drawing's folded theme.
 */
type DrawState = {
  readonly context: Context
  cursor: { readonly x: number; readonly y: number }
  readonly pixelPaintKeys: ReadonlySet<string>
  readonly sprite: {
    readonly palette: { readonly key: string; readonly color: Color; readonly source: string }[]
    readonly stamped: Sprite[]
  }
  readonly theme: FoldedTheme
  readonly drawName: string
  fontName: string | undefined
  title: string | undefined
  description: string | undefined
  /**
   * The active `mirror` reflection (ADR-0078) during the reflected pass, or `null`
   * outside any mirror / during the normal pass. `matrix` maps author → real
   * coordinates (the full composition of nested mirrors), `inverse` is its inverse,
   * and `base` is the innermost real framebuffer — used to reflect masks/stamp masks
   * and to draw forward text at the mirrored origin.
   */
  mirror: {
    readonly matrix: readonly number[]
    readonly base: Framebuffer
  } | null
}

/**
 * Parsed `stamp` modifiers (ADR-0043 rotation, ADR-0064 anchors) before
 * they're compiled into a single transform matrix by {@link Engine.#buildStampMatrix}.
 */
type StampFlags = {
  flipx: boolean
  flipy: boolean
  scale: number
  rotation: number
  transform: readonly number[] | undefined
  tint: { readonly color: Color; readonly amount: number } | undefined
  mask: Region | undefined
  anchor: StampAnchor
  shadow: { readonly dx: number; readonly dy: number; readonly color: Color } | undefined
}

type StampAnchor =
  | 'topLeft'
  | 'top'
  | 'topRight'
  | 'left'
  | 'center'
  | 'right'
  | 'bottomLeft'
  | 'bottom'
  | 'bottomRight'

const STAMP_ANCHORS: readonly StampAnchor[] = [
  'topLeft',
  'top',
  'topRight',
  'left',
  'center',
  'right',
  'bottomLeft',
  'bottom',
  'bottomRight',
]

const isStampAnchor = (value: string | null): value is StampAnchor =>
  value !== null && STAMP_ANCHORS.includes(value as StampAnchor)

/**
 * Ambient evaluation context threaded through every eval/exec call: which
 * module's scope errors report against, the shared budget, the enclosing
 * drawing (`null` outside a drawing body — e.g. module-level bindings or
 * path definitions), and the `fn` recursion depth (capped at 512, E010).
 */
type State = {
  readonly module: ModuleRecord
  readonly budget: Budget
  readonly draw: DrawState | null
  readonly functionDepth: number
}

/**
 * Every predefined name — builtins, commands, filters — reserved and
 * unshadowable (E007) regardless of scope; checked by {@link Engine.#checkBindable}
 * and at definition-collection time.
 */
const BUILTIN_NAMES = new Set([
  // math (ADR-0034)
  'min',
  'max',
  'abs',
  'clamp',
  'floor',
  'ceil',
  'round',
  'sign',
  'sqrt',
  'hypot',
  'dist',
  'sin',
  'cos',
  'tan',
  'atan2',
  'pow',
  'exp',
  'log',
  'lerp',
  'len',
  'cycle',
  'rand',
  'noise',
  'pi',
  'tau',
  // color (§12)
  'rgb',
  'hsl',
  'oklch',
  'lighten',
  'darken',
  'saturate',
  'desaturate',
  'grayscale',
  'hue',
  'alpha',
  'mix',
  'tones',
  'mixes',
  // gradients
  'linear',
  'radial',
  // shapes / regions (ADR-0036/0039)
  'circle',
  'rect',
  'rrect',
  'ellipse',
  'poly',
  'region',
  'union',
  'intersect',
  'subtract',
  'xor',
  // transforms (ADR-0044)
  'shift',
  'rotate',
  'scale',
  'skew',
  'flipx',
  'flipy',
  'matrix',
  'rotatex',
  'rotatey',
  'perspective',
  'about',
  'transform',
  // commands
  'bg',
  'px',
  'move',
  'line',
  'arc',
  'quad',
  'bezier',
  'curve',
  'curvePoly',
  'profile',
  'fill',
  'stroke',
  'text',
  'flood',
  'stamp',
  'apply',
  'outline',
  'replace',
  'tint',
  'shadow',
  'castShadow',
  'grain',
  'speckle',
  'ripple',
  'dither',
  'shadeRegion',
  'lightRegion',
  'rim',
  'ambientOcclusion',
])

// ── the engine ──────────────────────────────────────────────────────────────

type AtlasPlaced = {
  readonly name: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly sprite: Sprite
}

/**
 * The first already-placed rect (padded) that would overlap the given
 * rect, or `null` if the slot is free.
 */
const overlapsAny = (
  placed: AtlasPlaced[],
  x: number,
  y: number,
  width: number,
  height: number,
  padding: number,
): AtlasPlaced | null => {
  for (const p of placed) {
    if (
      x < p.x + p.width + padding &&
      p.x < x + width + padding &&
      y < p.y + p.height + padding &&
      p.y < y + height + padding
    ) {
      return p
    }
  }
  return null
}

/** Deterministic shelf packing of `rest` into `placed` (mutates `placed`). */
const packShelves = (
  rest: readonly { readonly name: string; readonly sprite: Sprite }[],
  placed: AtlasPlaced[],
  targetWidth: number,
  padding: number,
): void => {
  let shelfY = 0
  let shelfHeight = 0
  let currentX = 0
  for (const m of rest) {
    const spriteWidth = m.sprite.w
    const spriteHeight = m.sprite.h
    for (;;) {
      if (currentX + spriteWidth > targetWidth && currentX > 0) {
        shelfY += shelfHeight + padding
        shelfHeight = 0
        currentX = 0
        continue
      }
      const hit = overlapsAny(placed, currentX, shelfY, spriteWidth, spriteHeight, padding)
      if (hit) {
        currentX = hit.x + hit.width + padding
        continue
      }
      break
    }
    placed.push({
      name: m.name,
      x: currentX,
      y: shelfY,
      width: spriteWidth,
      height: spriteHeight,
      sprite: m.sprite,
    })
    currentX += spriteWidth + padding
    shelfHeight = Math.max(shelfHeight, spriteHeight)
  }
}

/**
 * Shared arg-checking surface handed to each `#builtinX` dispatcher
 * (ADR-0015 unified call model) so type coercion/arity errors are
 * reported consistently regardless of which builtin group handles `name`.
 */
type BuiltinContext = {
  readonly name: string
  readonly args: Value[]
  readonly state: State
  readonly span: TextSpan
  readonly file: string
  number(index: number): number
  color(index: number): Color
  point(index: number): Point
  path(index: number): Path
  region(index: number): Region
  transform(index: number): Transform
  arity(n: number): void
  isType(index: number, type: string): boolean
  mixSpace(index: number): MixSpace | null
}

/**
 * True for a number literal or a unary `-` directly wrapping one (`3`,
 * `-3`) — the only shape a render-fragment argument's own number or a
 * point's `x`/`y` coordinate may take (ADR-0067). Rejects anything with a
 * name, arithmetic, or a call underneath, even though the full expression
 * grammar (reused for parsing) would otherwise allow it there.
 */
const isSignedNumberLiteral = (expr: Expression): boolean =>
  expr.kind === 'number' ||
  (expr.kind === 'unary' && expr.operator === '-' && expr.operand.kind === 'number')

/**
 * Restricts one `render file#draw(args)` fragment argument (ADR-0067) to a
 * recipe-language *literal* expression: number, color, string, boolean,
 * `transparent`, or a point of two signed number literals. Anything else —
 * a name, arithmetic, a call, a list/range — throws E004; the fragment
 * takes no arbitrary expressions, unlike ordinary recipe code.
 */
const assertLiteralArg = (expr: Expression, file: string): void => {
  const ok =
    expr.kind === 'number' ||
    expr.kind === 'string' ||
    expr.kind === 'boolean' ||
    expr.kind === 'color' ||
    expr.kind === 'transparent' ||
    isSignedNumberLiteral(expr) ||
    (expr.kind === 'point' && isSignedNumberLiteral(expr.x) && isSignedNumberLiteral(expr.y))
  if (!ok) {
    throw error(
      ERROR_CODE.syntax,
      `render arguments must be literals (number, color, string, point, boolean) — got a '${expr.kind}' expression`,
      file,
      expr.span,
      'no names, arithmetic, or calls in render arguments',
    )
  }
}

/**
 * The Drawstic evaluator. One `Engine` instance owns a project root, a
 * shared {@link Budget}, and per-instance caches for parsed modules and
 * rendered sprites/tilesets/atlases — so repeated references to the same
 * drawing (e.g. stamped many times, or requested for several export
 * targets) are evaluated once. An engine is not meant to be reused across
 * unrelated recipes: caches are keyed by file path plus arguments/theme
 * fingerprint, not invalidated, so create a fresh `Engine` per invocation
 * (this is what the CLI's `createEngine` does — one instance shared across
 * loading and building within a single `check`/`render`/`build` run).
 *
 * Public entry points: {@link loadEntry}/{@link loadSource} to parse and
 * run a module's top level, {@link renderDraw} to rasterize a drawing to a
 * {@link Sprite}, {@link buildTileset}/{@link buildAtlas} for sheet content,
 * {@link evalPath}/{@link defToSprite} for path and generic content
 * resolution, {@link renderFragment} for the CLI `render file#draw(args)`
 * fragment (ADR-0067), and {@link evalExpr}/{@link evalNumber}/
 * {@link callBuiltinOrFn} for expression evaluation (used by the CLI's
 * `context`/`check` commands and by nested evaluation). Everything else is
 * internal machinery for module loading, theme folding, statement
 * execution, and the builtin function/command tables.
 */
export class Engine {
  readonly root: string
  readonly budget: Budget
  readonly #modules = new Map<string, ModuleRecord>()
  readonly #loading = new Set<string>()
  readonly #spriteCache = new Map<string, Sprite>()
  readonly #tilesetCache = new Map<string, TilesetValue>()
  readonly #atlasCache = new Map<string, AtlasValue>()
  /** Render-mode override for ad-hoc renders/exports. */
  modeOverride: RenderMode | null = null

  /**
   * The `root` directory bounds every relative import/image path (ADR-0035
   * sandbox); resolving outside it throws E008.
   */
  constructor(root: string, budget: Budget = defaultBudget()) {
    this.root = resolve(root)
    this.budget = budget
  }

  /**
   * Advance the step budget by one; throws E010 past `maxSteps` (spec
   * §15). Called once per statement/expression/loop-iteration so runaway
   * loops and recursion terminate deterministically rather than hanging.
   */
  step(span: TextSpan, file: string): void {
    this.budget.steps++
    if (this.budget.steps > this.budget.maxSteps) {
      throw error(
        ERROR_CODE.budget,
        'render budget exceeded (evaluation steps)',
        file,
        span,
        'simplify loops or raise --budget',
      )
    }
  }

  // ── module loading (ADR-0035 sandbox) ─────────────────────────────────

  /** Load and fully execute the CLI's entry-point `.drw` file. */
  loadEntry(file: string): ModuleRecord {
    return this.#loadAbsolute(resolve(file), file)
  }

  /**
   * Load-or-cache a module by absolute path; `#loading` detects import
   * cycles mid-resolution and reports E008 rather than recursing forever.
   */
  #loadAbsolute(abs: string, display: string): ModuleRecord {
    const cached = this.#modules.get(abs)
    if (cached) {
      return cached
    }
    if (this.#loading.has(abs)) {
      throw error(ERROR_CODE.importError, `import cycle involving '${display}'`, display, {
        line: 1,
        column: 1,
      })
    }
    if (!existsSync(abs)) {
      throw error(ERROR_CODE.importError, `module not found: '${display}'`, display, {
        line: 1,
        column: 1,
      })
    }
    this.#loading.add(abs)
    try {
      const source = readFileSync(abs, 'utf8')
      return this.loadSource(source, abs, display)
    } finally {
      this.#loading.delete(abs)
    }
  }

  /**
   * Parse `source`, check its `lang` pragma (E009 if unsupported), then
   * collect definitions and execute top-level statements. The module is
   * registered in the cache only *after* its body finishes running, so a
   * re-import that reaches back into a module still executing its top level
   * is caught as an import cycle by the `#loading` stack (spec §2, E008)
   * rather than served a half-built record from the cache. A module whose
   * body throws is therefore never cached.
   */
  loadSource(source: string, abs: string, display: string): ModuleRecord {
    const ast = parse(source, display)
    if (ast.pragma !== undefined && ast.pragma > LANGUAGE_VERSION) {
      throw error(
        ERROR_CODE.versionPragma,
        `recipe pins language version ${ast.pragma}, engine supports ${LANGUAGE_VERSION}`,
        display,
        { line: 1, column: 1 },
      )
    }
    const rec: ModuleRecord = {
      file: abs,
      displayPath: display,
      ast,
      definitions: new Map(),
      env: new Environment(null),
      fileTheme: undefined,
      sizeDefault: undefined,
      seed: undefined,
      fontDefault: undefined,
      exports: [],
    }
    this.#collectDefs(rec)
    this.#execTopLevel(rec)
    this.#modules.set(abs, rec)
    return rec
  }

  /**
   * Resolve an import path to an absolute file (or a `std:` pseudo-path);
   * `.drw` is appended if the path has no extension. Throws E008 if the
   * resolved path would escape {@link root} — the sandbox boundary that
   * keeps a recipe from reading arbitrary filesystem locations.
   */
  readonly #resolveModulePath = (
    fromFile: string,
    path: string,
    span: TextSpan,
    display: string,
  ): string => {
    if (path.startsWith('std/')) {
      return `std:${path}`
    }
    const base = dirname(fromFile)
    const abs = resolve(base, path.endsWith('.drw') || path.includes('.') ? path : `${path}.drw`)
    const withExt = abs.endsWith('.drw') ? abs : `${abs}.drw`
    if (!withExt.startsWith(this.root + sep) && withExt !== this.root) {
      throw error(
        ERROR_CODE.importError,
        `import escapes the project root: '${path}'`,
        display,
        span,
      )
    }
    return withExt
  }

  readonly #loadImport = (from: ModuleRecord, path: string, span: TextSpan): ModuleRecord => {
    const resolved = this.#resolveModulePath(from.file, path, span, from.displayPath)
    if (resolved.startsWith('std:')) {
      return this.#loadStdModule(resolved.slice(4), from.displayPath, span)
    }
    return this.#loadAbsolute(resolved, path)
  }

  /**
   * Load one of the embedded `std/` modules (ADR-0035/ADR-0054) by its
   * key (path with the `std/` prefix stripped); these are bundled source
   * strings ({@link STD_MODULES}), not filesystem reads.
   */
  #loadStdModule(key: string, display: string, span: TextSpan): ModuleRecord {
    const resolved = `std:${key}`
    const cached = this.#modules.get(resolved)
    if (cached) {
      return cached
    }
    if (this.#loading.has(resolved)) {
      throw error(ERROR_CODE.importError, `import cycle involving '${key}'`, display, {
        line: 1,
        column: 1,
      })
    }
    const src = STD_MODULES[key]
    if (src === undefined) {
      throw error(ERROR_CODE.importError, `unknown std module '${key}'`, display, span)
    }
    this.#loading.add(resolved)
    try {
      return this.loadSource(src, resolved, key)
    } finally {
      this.#loading.delete(resolved)
    }
  }

  /**
   * Register every top-level definition in `rec.definitions` before any
   * statement runs, so forward references (a drawing used before its
   * textual definition) resolve. Throws E007 for a name colliding with a
   * builtin or an earlier definition in the same module.
   */
  #collectDefs(rec: ModuleRecord): void {
    const add = (name: string, entry: DefinitionEntry, span: TextSpan): void => {
      if (BUILTIN_NAMES.has(name)) {
        throw error(
          ERROR_CODE.paletteCollision,
          `'${name}' is a predefined, unshadowable name`,
          rec.displayPath,
          span,
        )
      }
      if (rec.definitions.has(name)) {
        throw error(
          ERROR_CODE.paletteCollision,
          `duplicate definition of '${name}'`,
          rec.displayPath,
          span,
        )
      }
      rec.definitions.set(name, entry)
    }
    for (const s of rec.ast.statements) {
      switch (s.kind) {
        case 'drawDefinition':
          add(s.def.name, { kind: 'draw', definition: s.def, module: rec }, s.span)
          break
        case 'pathDefinition':
          add(s.def.name, { kind: 'path', definition: s.def, module: rec }, s.span)
          break
        case 'themeDefinition':
          add(s.def.name, { kind: 'theme', definition: s.def, module: rec }, s.span)
          break
        case 'functionDefinition':
          add(
            s.name,
            { kind: 'function', name: s.name, params: s.params, body: s.body, module: rec },
            s.span,
          )
          break
        case 'filterDefinition':
          add(s.name, { kind: 'filter', name: s.name, body: s.body, module: rec }, s.span)
          break
        case 'fontDefinition':
          add(s.def.name, { kind: 'font', definition: s.def, module: rec }, s.span)
          break
        case 'tilesetDefinition':
          add(s.def.name, { kind: 'tileset', definition: s.def, module: rec }, s.span)
          break
        case 'atlasDefinition':
          add(s.def.name, { kind: 'atlas', definition: s.def, module: rec }, s.span)
          break
        case 'imageImport':
          add(
            s.name,
            {
              kind: 'image',
              name: s.name,
              path: s.path,
              sha256: s.sha256,
              span: s.span,
              module: rec,
            },
            s.span,
          )
          break
        case 'exportDefinition':
          rec.exports.push(s.def)
          break
        default:
          break
      }
    }
  }

  /**
   * Run a module's top-level statements (imports, `use`, directives,
   * bindings/palettes) once, in source order — definitions themselves
   * were already collected by {@link #collectDefs} and don't re-execute
   * here; `export` elements run later, during {@link build.ts}.
   */
  #execTopLevel(rec: ModuleRecord): void {
    const state: State = { module: rec, budget: this.budget, draw: null, functionDepth: 0 }
    for (const s of rec.ast.statements) {
      this.step(s.span, rec.displayPath)
      switch (s.kind) {
        case 'import': {
          const dep = this.#loadImport(rec, s.module, s.span)
          for (const item of s.items) {
            const entry = dep.definitions.get(item.name)
            if (entry) {
              rec.definitions.set(item.alias ?? item.name, entry)
              continue
            }
            const b = dep.env.lookup(item.name)
            if (b) {
              rec.env.declare(item.alias ?? item.name, b.value, b.isConst, false)
              continue
            }
            throw error(
              ERROR_CODE.unknownName,
              `'${item.name}' is not defined in module '${s.module}'`,
              rec.displayPath,
              s.span,
            )
          }
          break
        }
        case 'use': {
          rec.fileTheme = this.resolveUse(rec, s.module, s.name, s.span, rec.fileTheme)
          break
        }
        case 'sizeDirective':
          rec.sizeDefault = { width: s.width, height: s.height }
          break
        case 'seedDirective':
          rec.seed = s.seed
          break
        case 'fontDirective':
          rec.fontDefault = s.name
          break
        case 'binding':
          this.#execBinding(s, rec.env, state)
          break
        case 'pathDefinition':
          break
        case 'compound':
          this.#execCompound(s, rec.env, state)
          break
        case 'palette':
          this.#execPal(s.entries, rec.env, state, 'module')
          break
        default:
          break // definitions collected already; exports run in build
      }
    }
  }

  /**
   * Resolve a `use [module] theme` directive: look up the named theme
   * (locally or in an imported module), fold it, and merge onto `base` if
   * one is already active (a later `use` layers over an earlier one —
   * ADR-0005/ADR-0051, later source wins on key collisions).
   */
  resolveUse(
    rec: ModuleRecord,
    modulePath: string | undefined,
    name: string,
    span: TextSpan,
    base: FoldedTheme | undefined,
  ): FoldedTheme {
    let entry: DefinitionEntry | undefined
    if (modulePath === undefined) {
      entry = rec.definitions.get(name)
    } else {
      let dep: ModuleRecord
      try {
        dep = this.#loadImport(rec, modulePath, span)
      } catch (e) {
        throw this.#withUseModuleHint(e, modulePath)
      }
      entry = dep.definitions.get(name)
    }
    if (entry?.kind !== 'theme') {
      throw error(ERROR_CODE.unknownName, `theme '${name}' not found`, rec.displayPath, span)
    }
    const folded = this.#foldTheme(entry.definition, entry.module, new Set())
    return base ? mergeThemes(base, folded) : folded
  }

  /**
   * Attaches the `use <module> <name>` mis-typing hint (§2.2) to an E008
   * raised while resolving `modulePath`: `themes` and `std` both read like
   * keywords in `use themes X` / `use std X` but are ordinary module paths
   * (`themes` is a plain file name; `std` needs a `/<module>` suffix, e.g.
   * `std/themes`) — 3/6 evaluation agents hit exactly this. Only fires for
   * paths whose first segment is one of those two words; every other E008
   * (and every other error kind) passes through unchanged.
   */
  readonly #withUseModuleHint = (e: unknown, modulePath: string): unknown => {
    const first = modulePath.split('/')[0]
    if (
      e instanceof DrawsticError &&
      e.code === ERROR_CODE.importError &&
      (first === 'themes' || first === 'std')
    ) {
      return error(
        e.code,
        e.message,
        e.file,
        e.span,
        'did you mean `use <name>` (local theme) or `use std/themes <name>` (bundled)?',
      )
    }
    return e
  }

  /** Fold a theme's `with a, b` part list onto `acc`, left to right. */
  #foldWith(
    item: Extract<Statement, { readonly kind: 'with' }>,
    mod: ModuleRecord,
    acc: FoldedTheme,
    seen: Set<string>,
  ): FoldedTheme {
    let out = acc
    for (const partName of item.names) {
      const part = mod.definitions.get(partName)
      if (part?.kind !== 'theme') {
        throw error(
          ERROR_CODE.unknownName,
          `theme part '${partName}' not found`,
          mod.displayPath,
          item.span,
        )
      }
      out = mergeThemes(out, this.#foldTheme(part.definition, part.module, seen))
    }
    return out
  }

  #foldPal(
    item: Extract<Statement, { readonly kind: 'palette' }>,
    def: ThemeDefinition,
    mod: ModuleRecord,
    acc: FoldedTheme,
    state: State,
  ): void {
    // entries may derive from earlier ones: evaluate with the folded
    // palette visible
    const env = new Environment(mod.env)
    for (const p of acc.palette) {
      env.declare(p.key, p.color, true, true)
    }
    for (const e of item.entries) {
      const v = this.evalExpr(e.expression, env, state)
      const pairs = this.#palettePairs(e, v, mod.displayPath)
      for (const pair of pairs) {
        env.declare(pair.key, pair.color, true, true)
        const existing = acc.palette.findIndex((p) => p.key === pair.key)
        const rec2 = { key: pair.key, color: pair.color, source: def.name }
        if (existing >= 0) {
          acc.palette[existing] = rec2
        } else {
          acc.palette.push(rec2)
        }
      }
    }
  }

  #foldBinding(
    item: Extract<Statement, { kind: 'binding' }>,
    mod: ModuleRecord,
    acc: FoldedTheme,
    state: State,
  ): void {
    if (item.bindKind !== 'grad') {
      // A theme body carries only pal/grad/size/mode/font/style/with + filter/draw
      // definitions; a plain (or `mask`) binding here folds into nothing and used to
      // vanish silently, surfacing later as E001 at the use site (ADR-0081). Reject it
      // at the declaration with an actionable hint instead.
      throw error(
        ERROR_CODE.syntax,
        `a theme body has no place for the binding '${item.names.join(', ')}'`,
        mod.displayPath,
        item.span,
        'put colours under `pal:` (or use `grad NAME = …`); move other constants to module scope, above the theme',
      )
    }
    const env = new Environment(mod.env)
    for (const p of acc.palette) {
      env.declare(p.key, p.color, true, true)
    }
    const v = this.evalExpr(item.expression, env, state)
    if (typeof v !== 'object' || v?.type !== 'grad') {
      throw error(
        ERROR_CODE.typeError,
        "a 'grad' binding must be a gradient",
        mod.displayPath,
        item.span,
      )
    }
    acc.gradients.set(item.names[0] ?? '', v)
  }

  #foldThemeItem(
    item: Statement,
    def: ThemeDefinition,
    mod: ModuleRecord,
    acc: FoldedTheme,
    seen: Set<string>,
    state: State,
  ): FoldedTheme {
    switch (item.kind) {
      case 'with':
        return this.#foldWith(item, mod, acc, seen)
      case 'palette':
        this.#foldPal(item, def, mod, acc, state)
        return acc
      case 'style':
        if (!acc.style.some((f) => f.text === item.text)) {
          acc.style.push({ source: def.name, text: item.text })
        }
        return acc
      case 'sizeDirective':
        acc.size = { width: item.width, height: item.height }
        return acc
      case 'modeDirective':
        acc.mode = item.mode
        return acc
      case 'fontDirective':
        acc.font = item.name
        return acc
      case 'binding':
        this.#foldBinding(item, mod, acc, state)
        return acc
      case 'filterDefinition':
        acc.filters.set(item.name, { body: item.body, module: mod })
        return acc
      case 'drawDefinition':
        acc.draws.set(item.def.name, { definition: item.def, module: mod })
        return acc
      default:
        return acc
    }
  }

  /**
   * Fold one theme definition's items into a fresh {@link FoldedTheme}.
   * `seen` tracks `file#themeName` keys across the recursive `with` chain
   * to reject a composition cycle with E008 rather than recursing forever.
   */
  #foldTheme(def: ThemeDefinition, mod: ModuleRecord, seen: Set<string>): FoldedTheme {
    const key = `${mod.file}#${def.name}`
    if (seen.has(key)) {
      throw error(
        ERROR_CODE.importError,
        `theme composition cycle at '${def.name}'`,
        mod.displayPath,
        def.span,
      )
    }
    seen.add(key)
    let acc = emptyTheme()
    const state: State = { module: mod, budget: this.budget, draw: null, functionDepth: 0 }
    for (const item of def.items) {
      acc = this.#foldThemeItem(item, def, mod, acc, seen, state)
    }
    seen.delete(key)
    return acc
  }

  // ── bindings & scope rules ────────────────────────────────────────────

  /**
   * Reject binding `name` if it's a reserved builtin (E007) or shadows a
   * visible palette entry (E007) — palette keys are const and can only be
   * overridden through a theme fold or a local `pal` re-declaration, never
   * through a plain `let`/`const`/param binding.
   */
  #checkBindable(name: string, env: Environment, span: TextSpan, state: State): void {
    if (BUILTIN_NAMES.has(name)) {
      throw error(
        ERROR_CODE.paletteCollision,
        `'${name}' is a predefined, unshadowable name`,
        state.module.displayPath,
        span,
      )
    }
    if (env.visiblePalette(name)) {
      throw error(
        ERROR_CODE.paletteCollision,
        `'${name}' is a palette entry — palette names are const and reserved`,
        state.module.displayPath,
        span,
        'the only redefinition channel is a theme fold or local pal override',
      )
    }
  }

  /**
   * Execute a `let`/`const`/`grad`/`mask` binding, including list
   * destructuring (`a, b = list`). `grad`/`mask` bindings are additionally
   * type-checked (E006) since their declared kind promises a gradient or
   * region respectively.
   */
  #execBinding(
    stmt: Extract<Statement, { readonly kind: 'binding' }>,
    env: Environment,
    state: State,
  ): void {
    const v = this.evalExpr(stmt.expression, env, state)
    if (stmt.bindKind === 'grad' && (typeof v !== 'object' || v?.type !== 'grad')) {
      throw error(
        ERROR_CODE.typeError,
        "a 'grad' binding must be a gradient",
        state.module.displayPath,
        stmt.span,
      )
    }
    if (stmt.bindKind === 'mask' && (typeof v !== 'object' || v?.type !== 'region')) {
      throw error(
        ERROR_CODE.typeError,
        "a 'mask' binding must be a region",
        state.module.displayPath,
        stmt.span,
      )
    }
    if (stmt.names.length === 1) {
      const name = stmt.names[0] ?? ''
      this.#checkBindable(name, env, stmt.span, state)
      // Reassign an existing mutable binding in the enclosing draw scope (so a
      // `g = g.union(…)` accumulator inside a loop/`if`/block persists, ADR-0081);
      // otherwise declare a fresh binding in the current scope.
      if (!env.assignLocal(name, v)) {
        env.declare(name, v)
      }
      return
    }
    // destructuring
    if (typeof v !== 'object' || v?.type !== 'list') {
      throw error(
        ERROR_CODE.typeError,
        'destructuring needs a list on the right-hand side',
        state.module.displayPath,
        stmt.span,
      )
    }
    if (v.items.length !== stmt.names.length) {
      throw error(
        ERROR_CODE.typeError,
        `destructuring mismatch: ${stmt.names.length} names, ${v.items.length} values`,
        state.module.displayPath,
        stmt.span,
      )
    }
    stmt.names.forEach((n, i) => {
      this.#checkBindable(n, env, stmt.span, state)
      const item = v.items[i] ?? 0
      if (!env.assignLocal(n, item)) {
        env.declare(n, item)
      }
    })
  }

  #applyCompound(op: string, value: Value, rhs: Value, state: State, span: TextSpan): Value {
    return this.#applyArithmetic(op.slice(0, -1), value, rhs, state, span)
  }

  /**
   * Execute a compound assignment (`+=`, `-=`, …). Throws E001 for an
   * unbound name and E007 for a const or palette binding — both `let` and
   * loop targets are mutable, everything else is not.
   */
  #execCompound(
    stmt: Extract<Statement, { readonly kind: 'compound' }>,
    env: Environment,
    state: State,
  ): void {
    const binding = env.lookup(stmt.name)
    if (!binding) {
      throw error(
        ERROR_CODE.unknownName,
        `unknown name '${stmt.name}'`,
        state.module.displayPath,
        stmt.span,
      )
    }
    if (binding.isConst || binding.isPalette) {
      throw error(
        ERROR_CODE.paletteCollision,
        `'${stmt.name}' is const and cannot be mutated`,
        state.module.displayPath,
        stmt.span,
      )
    }
    const currentValue = binding.value
    const rhs = this.evalExpr(stmt.expression, env, state)
    const newValue = this.#applyCompound(stmt.operator, currentValue, rhs, state, stmt.span)
    env.assign(stmt.name, newValue)
  }

  /**
   * Expand one palette entry (single `key: expr` or destructuring
   * `a, b: list`) into key/color pairs, type-checking that every value is
   * a color (E006) and that a destructuring's arity matches (E006).
   */
  #palettePairs(
    entry: Extract<Statement, { readonly kind: 'palette' }>['entries'][number],
    value: Value,
    file: string,
  ): { readonly key: string; readonly color: Color; readonly span: TextSpan }[] {
    if (entry.kind === 'entry') {
      if (typeof value !== 'object' || value?.type !== 'color') {
        throw error(
          ERROR_CODE.typeError,
          `palette entry '${entry.key}' must be a color`,
          file,
          entry.span,
        )
      }
      return [{ key: entry.key, color: value, span: entry.span }]
    }
    if (typeof value !== 'object' || value?.type !== 'list') {
      throw error(
        ERROR_CODE.typeError,
        'palette destructuring needs a list on the right-hand side',
        file,
        entry.span,
      )
    }
    if (value.items.length !== entry.keys.length) {
      throw error(
        ERROR_CODE.typeError,
        `palette destructuring mismatch: ${entry.keys.length} keys, ${value.items.length} values`,
        file,
        entry.span,
      )
    }
    return entry.keys.map((key, i) => {
      const item = value.items[i]
      if (typeof item !== 'object' || item?.type !== 'color') {
        throw error(
          ERROR_CODE.typeError,
          `palette entry '${key}' must be a color`,
          file,
          entry.span,
        )
      }
      return { key, color: item, span: entry.span }
    })
  }

  /**
   * Execute a `pal` block: declare each entry as a const palette binding
   * and, inside a drawing, fold it into the sprite's palette artifact
   * (ADR-0050, `source` records provenance for the folded output). `.`
   * is reserved for the built-in transparent cell (E007). A palette entry
   * may shadow a visible *non-palette* binding (the implicit `w`/`h`
   * canvas size, a gradient, an outer `let`/param) — the colour vocabulary
   * wins (ADR-0073); the reverse (a value binding shadowing a palette
   * entry) stays an error, enforced in {@link Engine.#checkBindable}.
   */
  #execPal(
    entries: Extract<Statement, { readonly kind: 'palette' }>['entries'],
    env: Environment,
    state: State,
    source: string,
  ): void {
    for (const e of entries) {
      const v = this.evalExpr(e.expression, env, state)
      for (const pair of this.#palettePairs(e, v, state.module.displayPath)) {
        if (pair.key === '.') {
          throw error(
            ERROR_CODE.paletteCollision,
            "'.' is the built-in transparent cell and cannot be declared",
            state.module.displayPath,
            pair.span,
          )
        }
        env.declare(pair.key, pair.color, true, true)
        if (state.draw) {
          const idx = state.draw.sprite.palette.findIndex((p) => p.key === pair.key)
          const rec = { key: pair.key, color: pair.color, source }
          if (idx >= 0) {
            state.draw.sprite.palette[idx] = rec
          } else {
            state.draw.sprite.palette.push(rec)
          }
        }
      }
    }
  }

  // ── drawing rendering ─────────────────────────────────────────────────

  /**
   * Render a drawing definition to a sprite (cached). The cache key
   * combines module file, drawing name, argument values, the enclosing
   * file theme's fingerprint, and `modeOverride` — so re-rendering the
   * same parametric drawing with the same args and theme is free, but a
   * different theme or render-mode override produces a distinct sprite.
   */
  renderDraw(
    entry: Extract<DefinitionEntry, { kind: 'draw' }>,
    args: Value[],
    span: TextSpan,
  ): Sprite {
    const def = entry.definition
    const mod = entry.module
    if ((def.params?.length ?? 0) !== args.length) {
      throw error(
        ERROR_CODE.arity,
        `drawing '${def.name}' takes ${def.params?.length ?? 0} argument(s), got ${args.length}`,
        mod.displayPath,
        span,
      )
    }
    const themeKey = mod.fileTheme ? themeFingerprint(mod.fileTheme) : ''
    const cacheKey = `${mod.file}#${def.name}(${args.map(valueKey).join(',')})@${themeKey}|${this.modeOverride ?? ''}`
    const cached = this.#spriteCache.get(cacheKey)
    if (cached) {
      return cached
    }
    const sprite = this.#renderDrawBody(def, mod, args, mod.fileTheme)
    this.#spriteCache.set(cacheKey, sprite)
    return sprite
  }

  /**
   * Resolve a drawing's canvas size (ADR-0021 precedence: explicit `WxH`
   * header, then an inline `pixels:` block's own dimensions, then the
   * active theme's `size`, then the module's `size` directive). When both
   * a header and a `pixels:` block are present, cross-checks them and
   * throws E002 on a mismatch or a ragged row. Throws E003 if no size can
   * be determined at all.
   */
  #resolveDrawSize(
    def: DrawDefinition,
    mod: ModuleRecord,
    pixels: Extract<Statement, { readonly kind: 'pixels' }> | undefined,
    theme: FoldedTheme,
  ): { width: number; height: number } {
    const firstRagged = (
      rows: Extract<Statement, { readonly kind: 'pixels' }>['rows'],
      expectedWidth: number,
    ): { readonly row: (typeof rows)[number]; readonly index: number } | null => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i]
        if (row && row.text.length !== expectedWidth) {
          return { row, index: i + 1 }
        }
      }
      return null
    }
    if (def.size) {
      const { width, height } = def.size
      if (pixels) {
        const rows = pixels.rows
        const ragged = firstRagged(rows, width)
        if (ragged) {
          throw error(
            ERROR_CODE.pixelsSizeMismatch,
            `pixels row ${ragged.index} is ${ragged.row.text.length} wide; expected ${width}`,
            mod.displayPath,
            ragged.row.span,
            `actual width ${ragged.row.text.length}; expected width ${width}`,
          )
        }
        const rw = rows[0]?.text.length ?? 0
        if (rows.length !== height || rw !== width) {
          throw error(
            ERROR_CODE.pixelsSizeMismatch,
            `pixels block is ${rw}x${rows.length}, header says ${width}x${height}`,
            mod.displayPath,
            rows[0]?.span ?? pixels.span,
            `actual ${rw}x${rows.length}; expected ${width}x${height}`,
          )
        }
      }
      return { width, height }
    }
    if (pixels) {
      const height = pixels.rows.length
      const width = pixels.rows[0]?.text.length ?? 0
      const ragged = firstRagged(pixels.rows, width)
      if (ragged) {
        throw error(
          ERROR_CODE.pixelsSizeMismatch,
          `pixels row ${ragged.index} is ${ragged.row.text.length} wide; expected ${width}`,
          mod.displayPath,
          ragged.row.span,
          `actual width ${ragged.row.text.length}; expected width ${width}`,
        )
      }
      return { width, height }
    }
    if (theme.size) {
      return { width: theme.size.width, height: theme.size.height }
    }
    if (mod.sizeDefault) {
      return { width: mod.sizeDefault.width, height: mod.sizeDefault.height }
    }
    throw error(
      ERROR_CODE.sizeUnresolved,
      `drawing '${def.name}' has no size — add WxH, a pixels: block, or a size default`,
      mod.displayPath,
      def.span,
    )
  }

  // palette artifact fold (ADR-0050): own first, then stamped, color-dedup
  #foldSpritePalette(
    draw: DrawState,
  ): { readonly key: string; readonly color: Color; readonly source: string }[] {
    const palette: { key: string; color: Color; source: string }[] = []
    const seenColor = new Set<string>()
    const push = (p: { key: string; color: Color; source: string }): void => {
      const ck = `${p.color.r},${p.color.g},${p.color.b},${p.color.a}`
      if (seenColor.has(ck)) {
        return
      }
      seenColor.add(ck)
      palette.push(p)
    }
    for (const p of draw.sprite.palette) {
      push(p)
    }
    for (const sp of draw.sprite.stamped) {
      for (const p of sp.pal) {
        push({ ...p, source: sp.name })
      }
    }
    return palette
  }

  /**
   * The uncached rasterization pipeline behind {@link renderDraw}: fold
   * drawing-level `use`, resolve size, build the drawing's environment
   * (palette, `w`/`h`, params, any inline-glyph `paintBindings`), run the
   * body against a fresh {@link Framebuffer} wired to the write budget,
   * then fold the sprite's palette artifact. `paintBindings` exists for
   * inline font glyphs (§ fonts), which render through this same path
   * with the glyph's ink color pre-bound to `k`.
   */
  #renderDrawBody(
    def: DrawDefinition,
    mod: ModuleRecord,
    args: Value[],
    baseTheme: FoldedTheme | undefined,
    paintBindings: ReadonlyMap<string, Paint> = new Map(),
  ): Sprite {
    // 1 — drawing-level `use` folds after the file theme (ADR-0051)
    let theme = baseTheme ?? emptyTheme()
    for (const s of def.body) {
      if (s.kind === 'use') {
        theme = this.resolveUse(mod, s.module, s.name, s.span, theme)
      }
    }
    // 2 — size resolution (ADR-0021)
    const pixels = def.body.find(
      (stmt): stmt is Extract<Statement, { kind: 'pixels' }> => stmt.kind === 'pixels',
    )
    const { width, height } = this.#resolveDrawSize(def, mod, pixels, theme)
    // 3 — environment (barrier: block-body assignment stops here, never mutating
    // module scope — ADR-0081). Canvas `w`/`h` are declared first so a theme `pal`
    // key `w`/`h` shadows the size binding, consistent with a drawing-local `pal`
    // (ADR-0073 extended to theme palettes — ADR-0081).
    const env = new Environment(mod.env, true)
    env.declare('w', width, true, false)
    env.declare('h', height, true, false)
    for (const p of theme.palette) {
      env.declare(p.key, p.color, true, true)
    }
    for (const [name, g] of theme.gradients) {
      if (!env.visiblePalette(name)) {
        env.declare(name, g, true, false)
      }
    }
    for (const [name, paint] of paintBindings) {
      env.declare(name, paint, true, false)
    }
    const mode: RenderMode = this.modeOverride ?? theme.mode ?? 'pixel'
    const buffer = new Framebuffer(width, height)
    buffer.onWrite = () => {
      this.budget.writes++
      if (this.budget.writes > this.budget.maxWrites) {
        throw error(
          ERROR_CODE.budget,
          'render budget exceeded (pixel writes)',
          mod.displayPath,
          def.span,
        )
      }
    }
    const draw: DrawState = {
      context: { buffer: buffer, mask: null, mode },
      cursor: { x: 0, y: 0 },
      pixelPaintKeys: new Set(paintBindings.keys()),
      sprite: { palette: [], stamped: [] },
      theme,
      drawName: def.name,
      fontName: theme.font ?? mod.fontDefault,
      title: undefined,
      description: undefined,
      mirror: null,
    }
    const state: State = { module: mod, budget: this.budget, draw, functionDepth: 0 }
    // seed theme palette into the artifact (drawing-local pal overrides later)
    for (const p of theme.palette) {
      draw.sprite.palette.push({ ...p })
    }
    if (def.params) {
      def.params.forEach((p, i) => {
        this.#checkBindable(p, env, def.span, state)
        env.declare(p, args[i] ?? 0)
      })
    }
    // 4 — run the body
    for (const s of def.body) {
      if (s.kind === 'use') {
        continue
      }
      this.#execDrawStmt(s, env, state)
    }
    // 5 — palette artifact fold (ADR-0050)
    const palette = this.#foldSpritePalette(draw)
    return {
      type: 'sprite',
      name: def.name,
      w: width,
      h: height,
      data: buffer.data,
      pal: palette,
      title: draw.title,
      desc: draw.description,
    }
  }

  // ── statement execution inside a drawing ──────────────────────────────

  #execBody(body: Statement[], env: Environment, state: State): void {
    const child = new Environment(env)
    for (const inner of body) {
      this.#execDrawStmt(inner, child, state)
    }
  }

  /**
   * Execute a `mask { … }` block: intersect the active mask (if any) with
   * the block's region for the duration of its body, then restore the
   * previous mask — masks nest by intersection, never replace outright.
   */
  #execMaskBlock(
    stmt: Extract<Statement, { readonly kind: 'maskBlock' }>,
    env: Environment,
    state: State,
  ): void {
    const value = this.evalExpr(stmt.expression, env, state)
    if (typeof value !== 'object' || value?.type !== 'region') {
      throw error(
        ERROR_CODE.typeError,
        `mask needs a region, got ${typeName(value)}`,
        state.module.displayPath,
        stmt.span,
      )
    }
    const draw = state.draw
    if (!draw) {
      throw error(
        ERROR_CODE.syntax,
        'mask blocks belong in a drawing body',
        state.module.displayPath,
        stmt.span,
      )
    }
    // A mask clips content in the drawing's coordinate space; inside a `mirror` the
    // reflecting buffer then mirrors the already-clipped content, so the mask needs no
    // reflection here — it travels with the content (ADR-0078 §5).
    const prev = draw.context.mask
    draw.context.mask = prev ? regionIntersect(prev, value) : value
    try {
      this.#execBody(stmt.body, env, state)
    } finally {
      draw.context.mask = prev
    }
  }

  #execIf(stmt: Extract<Statement, { readonly kind: 'if' }>, env: Environment, state: State): void {
    const condition = this.evalExpr(stmt.condition, env, state)
    const body = truthy(condition) ? stmt.thenStatement : stmt.elseStatement
    if (body) {
      this.#execBody(body, env, state)
    }
  }

  #execMatch(stmt: Extract<Statement, { kind: 'match' }>, env: Environment, state: State): void {
    const subject = this.evalExpr(stmt.subject, env, state)
    for (const arm of stmt.arms) {
      const matched =
        arm.label === undefined || valueEquals(subject, this.evalExpr(arm.label, env, state))
      if (matched) {
        this.#execBody(arm.body, env, state)
        return
      }
    }
  }

  #execRepeat(stmt: Extract<Statement, { kind: 'repeat' }>, env: Environment, state: State): void {
    const n = this.evalNumber(stmt.count, env, state)
    for (let i = 0; i < n; i++) {
      this.step(stmt.span, state.module.displayPath)
      this.#execBody(stmt.body, env, state)
    }
  }

  #execFor(stmt: Extract<Statement, { kind: 'for' }>, env: Environment, state: State): void {
    const iterable = this.evalExpr(stmt.iterable, env, state)
    if (typeof iterable !== 'object' || iterable?.type !== 'list') {
      throw error(
        ERROR_CODE.typeError,
        `for needs a list, got ${typeName(iterable)}`,
        state.module.displayPath,
        stmt.iterable.span,
      )
    }
    this.#checkBindable(stmt.target, env, stmt.span, state)
    for (const item of iterable.items) {
      this.step(stmt.span, state.module.displayPath)
      const child = new Environment(env)
      child.declare(stmt.target, item)
      for (const inner of stmt.body) {
        this.#execDrawStmt(inner, child, state)
      }
    }
  }

  #execWhile(stmt: Extract<Statement, { kind: 'while' }>, env: Environment, state: State): void {
    for (;;) {
      this.step(stmt.span, state.module.displayPath)
      if (!truthy(this.evalExpr(stmt.condition, env, state))) {
        break
      }
      this.#execBody(stmt.body, env, state)
    }
  }

  /**
   * Enumerate a region's on-canvas pixels in row-major order (y outer, x inner) —
   * the deterministic pixel set a {@link #execScatter} index-samples into (ADR-0077).
   * The region's bbox is clipped to the canvas; a null bbox yields no pixels.
   */
  #regionPixels(region: Region, width: number, height: number): { x: number; y: number }[] {
    const bb = region.bbox
    if (!bb) {
      return []
    }
    const x0 = Math.max(0, Math.floor(bb.x0))
    const y0 = Math.max(0, Math.floor(bb.y0))
    const x1 = Math.min(width - 1, Math.ceil(bb.x1))
    const y1 = Math.min(height - 1, Math.ceil(bb.y1))
    const pts: { x: number; y: number }[] = []
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (region.has(x, y)) {
          pts.push({ x, y })
        }
      }
    }
    return pts
  }

  /**
   * Execute a `scatter NAME count seed region:` block (ADR-0077): draw `count`
   * seeded points uniformly from `region`'s pixels, binding `target` (child-scoped,
   * like `for`) to each point. An empty region is a no-op. One step per iteration
   * (§15). Point `i` is `pixels[floor(rand(seed, i) * pixels.length)]`.
   */
  #execScatter(
    stmt: Extract<Statement, { kind: 'scatter' }>,
    env: Environment,
    state: State,
  ): void {
    const draw = state.draw
    if (!draw) {
      throw error(
        ERROR_CODE.syntax,
        'scatter blocks belong in a drawing body',
        state.module.displayPath,
        stmt.span,
      )
    }
    const n = quantInt(this.evalNumber(stmt.count, env, state))
    const seed = this.evalNumber(stmt.seed, env, state)
    const regionValue = this.evalExpr(stmt.region, env, state)
    let region: Region
    if (typeof regionValue === 'object' && regionValue !== null && regionValue.type === 'region') {
      region = regionValue
    } else if (
      typeof regionValue === 'object' &&
      regionValue !== null &&
      regionValue.type === 'sprite'
    ) {
      region = spriteRegion(regionValue)
    } else {
      throw error(
        ERROR_CODE.typeError,
        `scatter needs a region, got ${typeName(regionValue)}`,
        state.module.displayPath,
        stmt.region.span,
      )
    }
    const buffer = draw.context.buffer
    const pixels = this.#regionPixels(region, buffer.width, buffer.height)
    if (pixels.length === 0) {
      return // empty region → no-op (ADR-0077 §4)
    }
    this.#checkBindable(stmt.target, env, stmt.span, state)
    for (let i = 0; i < n; i++) {
      this.step(stmt.span, state.module.displayPath)
      const idx = Math.min(pixels.length - 1, Math.floor(rand(seed, i) * pixels.length))
      const p = pixels[idx] ?? { x: 0, y: 0 }
      const child = new Environment(env)
      child.declare(stmt.target, point(p.x, p.y))
      for (const inner of stmt.body) {
        this.#execDrawStmt(inner, child, state)
      }
    }
  }

  /** The author→real reflection matrix for one mirror axis (`x → 2n − x` / `y → 2n − y`). */
  #mirrorAxisMatrix(axis: 'x' | 'y', at: number): readonly number[] {
    return axis === 'x' ? aboutPoint(scaling(-1, 1), at, 0) : aboutPoint(scaling(1, -1), 0, at)
  }

  /**
   * Execute a `mirror x=<n>:` / `mirror y=<n>:` block (ADR-0078): draw the body once
   * normally, then re-execute it with a {@link MirrorFramebuffer} reflecting every write
   * across the axis (axis pixels paint once). `draw.mirror` carries the composed
   * reflection so masks/stamp-masks reflect and text draws forward at the mirrored origin.
   * Nested mirrors compose by wrapping the already-reflecting buffer.
   */
  #execMirror(stmt: Extract<Statement, { kind: 'mirror' }>, env: Environment, state: State): void {
    const draw = state.draw
    if (!draw) {
      throw error(
        ERROR_CODE.syntax,
        'mirror blocks belong in a drawing body',
        state.module.displayPath,
        stmt.span,
      )
    }
    const at = quantInt(this.evalNumber(stmt.at, env, state))
    // pass 1 — draw the body normally (exactly as without the block)
    this.#execBody(stmt.body, env, state)
    // pass 2 — re-execute with a reflecting buffer; every write mirrors across the axis
    const ctx = draw.context
    const prevBuffer = ctx.buffer
    const prevMirror = draw.mirror
    const rThis = this.#mirrorAxisMatrix(stmt.axis, at)
    // full author→real reflection (this wrapper composed with any enclosing mirror), for
    // reflecting the text origin (glyphs stay forward, ADR-0078 §4)
    const matrix = prevMirror ? multiplyMatrix(prevMirror.matrix, rThis) : rThis
    const base = prevMirror ? prevMirror.base : prevBuffer
    ctx.buffer = new MirrorFramebuffer(prevBuffer, stmt.axis, at) as unknown as Framebuffer
    draw.mirror = { matrix, base }
    try {
      this.#execBody(stmt.body, env, state)
    } finally {
      ctx.buffer = prevBuffer
      draw.mirror = prevMirror
    }
  }

  /**
   * The statement dispatcher for drawing bodies (and nested blocks):
   * advances the step budget, then routes each `Statement` AST kind to
   * its handler. Statements only valid at module scope (`fn`, path defs,
   * `use` after the first statement) throw E004 here.
   */
  #execDrawStmt(stmt: Statement, env: Environment, state: State): void {
    this.step(stmt.span, state.module.displayPath)
    const draw = state.draw
    // Shared by every "lives at module scope" E004 below: mask/grad are the
    // two definition-shaped statements that stay legal inside a draw, so
    // that's the natural next question once an author hits this error.
    const moduleScopeHint =
      'move it to module scope, above the draw — mask and grad definitions may stay drawing-local'
    switch (stmt.kind) {
      case 'binding':
        this.#execBinding(stmt, env, state)
        return
      case 'compound':
        this.#execCompound(stmt, env, state)
        return
      case 'palette':
        this.#execPal(stmt.entries, env, state, state.draw?.drawName ?? 'local')
        return
      case 'pixels':
        this.#execPixels(stmt, env, state)
        return
      case 'meta':
        if (draw) {
          if (stmt.which === 'title') {
            draw.title = stmt.value
          } else {
            draw.description = stmt.value
          }
        }
        return
      case 'seedDirective':
        return // stored for sugar helpers (none in v1); core fns take seeds explicitly
      case 'fontDirective':
        if (draw) {
          draw.fontName = stmt.name
        }
        return
      case 'functionDefinition':
        throw error(
          ERROR_CODE.syntax,
          'fn definitions live at module scope',
          state.module.displayPath,
          stmt.span,
          moduleScopeHint,
        )
      case 'pathDefinition':
        throw error(
          ERROR_CODE.syntax,
          'path definitions live at module scope',
          state.module.displayPath,
          stmt.span,
          moduleScopeHint,
        )
      case 'drawDefinition':
        throw error(
          ERROR_CODE.syntax,
          'draw definitions live at module scope',
          state.module.displayPath,
          stmt.span,
          moduleScopeHint,
        )
      case 'themeDefinition':
        throw error(
          ERROR_CODE.syntax,
          'theme definitions live at module scope',
          state.module.displayPath,
          stmt.span,
          moduleScopeHint,
        )
      case 'fontDefinition':
        throw error(
          ERROR_CODE.syntax,
          'font definitions live at module scope',
          state.module.displayPath,
          stmt.span,
          moduleScopeHint,
        )
      case 'tilesetDefinition':
        throw error(
          ERROR_CODE.syntax,
          'tileset definitions live at module scope',
          state.module.displayPath,
          stmt.span,
          moduleScopeHint,
        )
      case 'atlasDefinition':
        throw error(
          ERROR_CODE.syntax,
          'atlas definitions live at module scope',
          state.module.displayPath,
          stmt.span,
          moduleScopeHint,
        )
      case 'exportDefinition':
        throw error(
          ERROR_CODE.syntax,
          'export definitions live at module scope',
          state.module.displayPath,
          stmt.span,
          moduleScopeHint,
        )
      case 'imageImport':
        throw error(
          ERROR_CODE.syntax,
          'image imports live at module scope',
          state.module.displayPath,
          stmt.span,
          moduleScopeHint,
        )
      case 'filterDefinition':
        if (draw) {
          draw.theme.filters.set(stmt.name, { body: stmt.body, module: state.module })
        }
        return
      case 'maskBlock':
        this.#execMaskBlock(stmt, env, state)
        return
      case 'if':
        this.#execIf(stmt, env, state)
        return
      case 'match':
        this.#execMatch(stmt, env, state)
        return
      case 'repeat':
        this.#execRepeat(stmt, env, state)
        return
      case 'for':
        this.#execFor(stmt, env, state)
        return
      case 'while':
        this.#execWhile(stmt, env, state)
        return
      case 'scatter':
        this.#execScatter(stmt, env, state)
        return
      case 'mirror':
        this.#execMirror(stmt, env, state)
        return
      case 'apply':
        this.#runFilter(stmt.name, env, state, stmt.span)
        return
      case 'call':
        this.#execCommand(stmt, env, state)
        return
      case 'use':
        throw error(
          ERROR_CODE.syntax,
          "drawing-level 'use' must precede all other statements",
          state.module.displayPath,
          stmt.span,
        )
      default:
        throw error(
          ERROR_CODE.syntax,
          `statement not allowed in a drawing body`,
          state.module.displayPath,
          stmt.span,
        )
    }
  }

  /**
   * Paint one cell of a `pixels:` block (spec §7, ADR-0049 ASCII keys).
   * `.` is always transparent and skipped; any other key must be a single
   * ASCII letter (E004). Cells resolve in the **palette namespace only**
   * (ADR-0073): a visible single-letter palette entry, or — inside a glyph
   * render — a bound inline-glyph paint key; a general scope binding of the
   * same letter (e.g. the canvas-size `w`/`h`) is never a cell. An
   * unresolved letter is E007 (palette namespace miss). Palette-color keys
   * blend directly; paint (gradient) keys go through the mode-aware
   * {@link putPixel} so AA mode still applies.
   */
  #execPixel(
    draw: DrawState,
    env: Environment,
    state: State,
    row: { text: string; span: TextSpan },
    x: number,
    y: number,
    bbox: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
  ): void {
    const ch = row.text[x] ?? '.'
    if (ch === '.') {
      return
    }
    if (!/^[a-zA-Z]$/.test(ch)) {
      throw error(
        ERROR_CODE.syntax,
        `'${ch}' is not a pixel key (one ASCII letter or '.')`,
        state.module.displayPath,
        {
          line: row.span.line,
          column: row.span.column + x,
        },
      )
    }
    // Palette-only resolution: a palette entry, else an inline-glyph paint
    // key. `visiblePalette` filters out non-palette bindings (canvas w/h,
    // outer lets), so those letters miss instead of leaking into cells.
    const b = draw.pixelPaintKeys.has(ch) ? env.lookup(ch) : env.visiblePalette(ch)
    if (!b) {
      throw error(
        ERROR_CODE.paletteCollision,
        `pixel key '${ch}' names no visible palette entry`,
        state.module.displayPath,
        {
          line: row.span.line,
          column: row.span.column + x,
        },
        `declare it in a 'pal' (e.g. 'pal ${ch}=<color>')`,
      )
    }
    const paint = b.value
    if (
      typeof paint !== 'object' ||
      paint === null ||
      (paint.type !== 'color' && paint.type !== 'grad')
    ) {
      throw error(
        ERROR_CODE.typeError,
        `pixel key '${ch}' must resolve to a paint`,
        state.module.displayPath,
        {
          line: row.span.line,
          column: row.span.column + x,
        },
      )
    }
    if (draw.context.mask && !draw.context.mask.has(x, y)) {
      return
    }
    if (b.isPalette && paint.type === 'color') {
      draw.context.buffer.blendColor(x, y, paint)
      return
    }
    putPixel(draw.context, x, y, paint, bbox)
  }

  #execPixels(stmt: Extract<Statement, { kind: 'pixels' }>, env: Environment, state: State): void {
    const draw = state.draw
    if (!draw) {
      throw error(
        ERROR_CODE.syntax,
        'pixels blocks belong in a drawing body',
        state.module.displayPath,
        stmt.span,
      )
    }
    const width = Math.max(0, ...stmt.rows.map((row) => row.text.length))
    const bbox = { x0: 0, y0: 0, x1: width - 1, y1: stmt.rows.length - 1 }
    for (let y = 0; y < stmt.rows.length; y++) {
      const row = stmt.rows[y]
      if (!row) {
        continue
      }
      for (let x = 0; x < row.text.length; x++) {
        this.#execPixel(draw, env, state, row, x, y, bbox)
      }
    }
  }

  /**
   * Execute an `apply name` filter: looks up `name` first in the active
   * theme's filters, then module-scope, and runs its body's `call`
   * statements as commands against the current draw context/mask.
   */
  #runFilter(name: string, env: Environment, state: State, span: TextSpan): void {
    const draw = state.draw
    if (!draw) {
      throw error(
        ERROR_CODE.syntax,
        "'apply' belongs in a drawing body",
        state.module.displayPath,
        span,
      )
    }
    const f = draw.theme.filters.get(name) ?? this.#findFilterDef(state.module, name)
    if (!f) {
      throw error(
        ERROR_CODE.unknownName,
        `unknown filter '${name}'`,
        state.module.displayPath,
        span,
      )
    }
    for (const cmd of f.body) {
      if (cmd.kind !== 'call') {
        continue
      }
      this.#execCommand(cmd, env, state)
    }
  }

  #findFilterDef(
    mod: ModuleRecord,
    name: string,
  ): { readonly body: readonly Statement[]; readonly module: ModuleRecord } | undefined {
    const e = mod.definitions.get(name)
    if (e?.kind === 'filter') {
      return { body: e.body, module: e.module }
    }
    return undefined
  }

  // ── command interpretation (§8–§9) ───────────────────────────────────

  #execPx(ctx: Context, draw: DrawState, A: Args): void {
    const paint = A.paint()
    const p = A.point(draw)
    A.done()
    const x = quantInt(p.x)
    const y = quantInt(p.y)
    if (ctx.mask && !ctx.mask.has(x, y)) {
      return
    }
    if (paint.type === 'color') {
      ctx.buffer.blendColor(x, y, paint)
    } else {
      fillRegion(ctx, rectRegion(x, y, x, y), paint)
    }
  }

  /**
   * Execute `poly`: paint-first, variadic points, optional trailing
   * `fill` flag (§8). Needs at least two points (E011); strokes as an
   * open polyline unless `fill` is given.
   */
  #execPoly(ctx: Context, draw: DrawState, A: Args, state: State, span: TextSpan): void {
    // paint-first, variadic points, optional trailing fill (§8)
    const paint = A.drawPaint(span)
    const pts: { x: number; y: number }[] = []
    let fill = false
    while (!A.empty()) {
      if (A.peekFlag() === 'fill') {
        A.takeFlag()
        fill = true
        break
      }
      const p = A.point(draw)
      pts.push({ x: p.x, y: p.y })
    }
    A.done()
    if (pts.length < 2) {
      throw error(
        ERROR_CODE.arity,
        'poly needs at least two points',
        state.module.displayPath,
        span,
      )
    }
    if (fill) {
      fillRegion(ctx, polyRegion(pts.map((p) => ({ x: quantInt(p.x), y: quantInt(p.y) }))), paint)
    } else {
      const sink = new PixelSink()
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        if (!a || !b) {
          continue
        }
        strokeLine(sink, quantInt(a.x), quantInt(a.y), quantInt(b.x), quantInt(b.y), 1)
      }
      sink.paint(ctx, paint)
    }
  }

  /**
   * Consume a variadic run of point arguments off `A`, stopping at the first
   * trailing flag (`fill`/`w<N>`) or keyword (`cap`/`join`) — shared by `curve`
   * and `curvePoly`, whose geometry is an open-ended list of through-points
   * (ADR-0074/0075).
   */
  #collectPoints(A: Args, draw: DrawState): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = []
    while (!A.empty() && A.peekFlag() === undefined && A.peekKeyword() === null) {
      pts.push(A.point(draw))
    }
    return pts
  }

  /**
   * Execute `curve` (ADR-0074): paint-first, an open Catmull-Rom spline *through*
   * the given points, optional trailing `w<N>` stroke width. Needs at least three
   * points — two points is a straight segment, so it's an E011 pointing at `line`.
   */
  #execCurve(ctx: Context, draw: DrawState, A: Args, state: State, span: TextSpan): void {
    const paint = A.paint()
    const pts = this.#collectPoints(A, draw)
    const flags = A.strokeFlags()
    A.done()
    if (pts.length < 3) {
      throw error(
        ERROR_CODE.arity,
        'curve needs at least three points',
        state.module.displayPath,
        span,
        'for a straight two-point segment use `line`',
      )
    }
    const sink = new PixelSink()
    strokePath(sink, catmullRomPoints(pts), flags.width)
    sink.paint(ctx, paint)
  }

  /**
   * Execute `curvePoly` (ADR-0075): a closed Catmull-Rom loop through the given
   * points, rasterized through the same `[fill] [w<N>]` region-eliminator sugar as
   * `rect`/`circle` (`#emitShape`) — with `fill` a solid organic mass, without it
   * the region's inner-boundary stroke. Its fill and stroke share one tessellation
   * (the loop region), so they align exactly. Needs at least three points.
   */
  #execCurvePoly(ctx: Context, draw: DrawState, A: Args, state: State, span: TextSpan): void {
    const paint = A.drawPaint(span)
    const pts = this.#collectPoints(A, draw)
    const flags = A.drawFlags()
    A.done()
    if (pts.length < 3) {
      throw error(
        ERROR_CODE.arity,
        'curvePoly needs at least three points',
        state.module.displayPath,
        span,
      )
    }
    this.#emitShape(ctx, curvePolyRegion(pts), paint, flags)
  }

  /**
   * Coerce a `profile` span value (ADR-0076) into its list of integer x-columns: the
   * span is a range/list of numbers (typically `0..w`), one element per output column.
   * A non-list or a list with a non-number item is an E006, and an empty span yields an
   * empty column list (→ empty region, draws nothing) rather than an error.
   */
  #profileColumns(v: Value, span: TextSpan, state: State): number[] {
    if (typeof v !== 'object' || v === null || v.type !== 'list') {
      throw error(
        ERROR_CODE.typeError,
        `profile: the span must be a range or list of x-columns (e.g. 0..w), got ${typeName(v)}`,
        state.module.displayPath,
        span,
      )
    }
    return v.items.map((item) => {
      if (typeof item !== 'number') {
        throw error(
          ERROR_CODE.typeError,
          `profile: every span column must be a number, got ${typeName(item)}`,
          state.module.displayPath,
          span,
        )
      }
      return quantInt(item)
    })
  }

  /**
   * The Region of a `profile` (ADR-0076): sample `fnName` once per column, the `fn`
   * receiving NORMALIZED x in [0,1] (`i/(n−1)`, first column 0, last 1) and returning the
   * top-edge `y` in recipe pixels. Each column is filled over the inclusive rows between
   * `round f(x)` and `baseline` — exactly one contiguous vertical run per column, so the
   * noise-frequency trap is unreachable (`noise(seed, nx*K, 0)` is naturally low-frequency).
   * Shared by the `profile` command and the paint-less `profile(...)` region call so both
   * forms are pixel-identical. Deterministic (integer x, `roundHalfUp` y, dmath only,
   * ADR-0027); one step charged per column for the §15 budget.
   */
  #profileRegion(
    columns: readonly number[],
    fnName: string,
    baseline: number,
    state: State,
    span: TextSpan,
  ): Region {
    const entry = state.module.definitions.get(fnName)
    if (entry?.kind !== 'function') {
      throw error(
        ERROR_CODE.unknownName,
        `profile: '${fnName}' is not a function`,
        state.module.displayPath,
        span,
        'name a unary fn, e.g. `fn ridgeY nx = 16 + round(noise(3, nx * 4, 0) * 10)`',
      )
    }
    const n = columns.length
    if (n === 0) {
      return emptyRegion
    }
    const base = quantInt(baseline)
    const spans = new Map<number, { lo: number; hi: number }>()
    let x0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let y0 = Number.POSITIVE_INFINITY
    let y1 = Number.NEGATIVE_INFINITY
    for (let i = 0; i < n; i++) {
      this.step(span, state.module.displayPath)
      const nx = n > 1 ? i / (n - 1) : 0
      const yValue = this.callBuiltinOrFn(fnName, [nx], state, span)
      if (typeof yValue !== 'number') {
        throw error(
          ERROR_CODE.typeError,
          `profile: fn '${fnName}' must return a number, got ${typeName(yValue)}`,
          state.module.displayPath,
          span,
        )
      }
      const col = columns[i] ?? 0
      const top = quantInt(yValue)
      const lo = Math.min(top, base)
      const hi = Math.max(top, base)
      const existing = spans.get(col)
      if (existing) {
        existing.lo = Math.min(existing.lo, lo)
        existing.hi = Math.max(existing.hi, hi)
      } else {
        spans.set(col, { lo, hi })
      }
      x0 = Math.min(x0, col)
      x1 = Math.max(x1, col)
      y0 = Math.min(y0, lo)
      y1 = Math.max(y1, hi)
    }
    return {
      type: 'region',
      bbox: { x0, y0, x1, y1 },
      has: (x, y) => {
        const s = spans.get(x)
        return s !== undefined && y >= s.lo && y <= s.hi
      },
      test: (fx, fy) => {
        const s = spans.get(roundHalfUp(fx))
        return s !== undefined && fy >= s.lo - 0.5 && fy <= s.hi + 0.5
      },
    }
  }

  /**
   * Execute the `profile` command (ADR-0076): `profile <paint> <span> <fnName> [<baseline>]
   * [fill] [w<N>]`. The baseline is read only when the next argument is not a trailing flag
   * or keyword, so `profile p 0..w f fill` (default baseline = canvas bottom `h−1`) and
   * `profile p 0..w f 40 fill` (baseline 40) both parse. Rasterized through the same
   * `[fill] [w<N>]` region-eliminator sugar as `curvePoly` (`#emitShape`).
   */
  #execProfile(ctx: Context, A: Args, state: State, span: TextSpan): void {
    const paint = A.drawPaint(span)
    const columns = this.#profileColumns(A.value(), span, state)
    const fnName = A.rawName()
    const hasBaseline = !A.empty() && A.peekFlag() === undefined && A.peekKeyword() === null
    const baseline = hasBaseline ? A.num() : ctx.buffer.height - 1
    const flags = A.drawFlags()
    A.done()
    this.#emitShape(ctx, this.#profileRegion(columns, fnName, baseline, state, span), paint, flags)
  }

  /**
   * The paint-less `profile(span, fnName [, baseline])` region form (ADR-0076 §5), mirroring
   * `curvePoly(...)`. Handled here rather than in {@link #builtinShape} because the `fn` is
   * referenced by bare NAME (there are no first-class function values), so its argument must
   * stay unevaluated. The default baseline is the canvas bottom `h−1`, read from the drawing
   * env. Delegates to {@link #profileRegion} so it is pixel-identical to the command form.
   */
  #evalProfileRegion(
    expr: Extract<Expression, { readonly kind: 'call' }>,
    env: Environment,
    state: State,
  ): Region {
    const items = expr.args
    if (items.length < 2 || items.length > 3) {
      throw error(
        ERROR_CODE.arity,
        'profile(span, fn [, baseline]) takes two or three arguments',
        state.module.displayPath,
        expr.span,
      )
    }
    const spanArg = items[0]
    const fnArg = items[1]
    if (spanArg?.kind !== 'expression') {
      throw error(
        ERROR_CODE.typeError,
        'profile: the first argument is the span (a range or list of x-columns)',
        state.module.displayPath,
        expr.span,
      )
    }
    if (fnArg?.kind !== 'expression' || fnArg.expression.kind !== 'name') {
      throw error(
        ERROR_CODE.typeError,
        'profile: the second argument must be a function name',
        state.module.displayPath,
        expr.span,
      )
    }
    const columns = this.#profileColumns(
      this.evalExpr(spanArg.expression, env, state),
      expr.span,
      state,
    )
    const fnName = fnArg.expression.name
    const hBinding = env.lookup('h')
    let baseline = typeof hBinding?.value === 'number' ? hBinding.value - 1 : 0
    const baseArg = items[2]
    if (baseArg) {
      if (baseArg.kind !== 'expression') {
        throw error(
          ERROR_CODE.typeError,
          'profile: the third argument is the baseline (a number)',
          state.module.displayPath,
          expr.span,
        )
      }
      baseline = this.evalNumber(baseArg.expression, env, state)
    }
    return this.#profileRegion(columns, fnName, baseline, state, expr.span)
  }

  /**
   * Disambiguate an unrecognized statement-position callee: a user
   * `filter` name is run as `apply` sugar; a `fn`/builtin name used as a
   * bare statement means its value was silently dropped, which is almost
   * always a missing paint (E013); anything else is genuinely unknown
   * (E001).
   */
  #execCommandFallback(
    stmt: Extract<Statement, { readonly kind: 'call' }>,
    env: Environment,
    state: State,
  ): void {
    // a user filter name used as a command? a fn call whose value drops?
    const entry = state.module.definitions.get(stmt.callee)
    if (entry?.kind === 'filter') {
      this.#runFilter(stmt.callee, env, state, stmt.span)
      return
    }
    if (entry?.kind === 'function' || BUILTIN_NAMES.has(stmt.callee)) {
      throw error(
        ERROR_CODE.regionDropped,
        `the value of '${stmt.callee}' is dropped — a shape statement needs a paint`,
        state.module.displayPath,
        stmt.span,
      )
    }
    throw error(
      ERROR_CODE.unknownName,
      `unknown command '${stmt.callee}'`,
      state.module.displayPath,
      stmt.span,
    )
  }

  /**
   * The command dispatcher for every drawing primitive and built-in
   * filter (spec §8 shapes/strokes, §9 stamp/apply, §12 filters). Each
   * case reads its fixed argument shape off `args` (an {@link Args}
   * cursor over the call's AST arguments) and calls straight into
   * `raster.ts`; unrecognized callees fall through to
   * {@link #execCommandFallback}.
   */
  #execCommand(
    stmt: Extract<Statement, { readonly kind: 'call' }>,
    env: Environment,
    state: State,
  ): void {
    const draw = state.draw
    if (!draw) {
      throw error(
        ERROR_CODE.syntax,
        `'${stmt.callee}' belongs in a drawing body`,
        state.module.displayPath,
        stmt.span,
      )
    }
    const ctx = draw.context
    const args = new Args(this, stmt.args, env, state, stmt.span)
    switch (stmt.callee) {
      case 'bg': {
        const paint = args.paint()
        args.done()
        fillRegion(ctx, rectRegion(0, 0, ctx.buffer.width - 1, ctx.buffer.height - 1), paint)
        return
      }
      case 'px': {
        this.#execPx(ctx, draw, args)
        return
      }
      case 'move': {
        throw error(
          ERROR_CODE.syntax,
          "'move' is only valid inside a path definition",
          state.module.displayPath,
          stmt.span,
        )
      }
      case 'line': {
        const paint = args.paint()
        const a = args.point(draw)
        const b = args.point(draw)
        const flags = args.strokeFlags()
        args.done()
        const sink = new PixelSink()
        strokeLine(sink, quantInt(a.x), quantInt(a.y), quantInt(b.x), quantInt(b.y), flags.width)
        sink.paint(ctx, paint)
        return
      }
      case 'rect': {
        const paint = args.drawPaint(stmt.span)
        const a = args.point(draw)
        const b = args.point(draw)
        const flags = args.drawFlags()
        args.done()
        this.#emitShape(
          ctx,
          rectRegion(quantInt(a.x), quantInt(a.y), quantInt(b.x), quantInt(b.y)),
          paint,
          flags,
        )
        return
      }
      case 'rrect': {
        const paint = args.drawPaint(stmt.span)
        const a = args.point(draw)
        const b = args.point(draw)
        const r = args.num()
        const flags = args.drawFlags()
        args.done()
        this.#emitShape(
          ctx,
          rrectRegion(quantInt(a.x), quantInt(a.y), quantInt(b.x), quantInt(b.y), r),
          paint,
          flags,
        )
        return
      }
      case 'circle': {
        const paint = args.drawPaint(stmt.span)
        const c = args.point(draw)
        const r = args.num()
        const flags = args.drawFlags()
        args.done()
        this.#emitShape(ctx, circleRegion(quantInt(c.x), quantInt(c.y), r), paint, flags)
        return
      }
      case 'ellipse': {
        const paint = args.drawPaint(stmt.span)
        const c = args.point(draw)
        const rr = args.pair()
        const flags = args.drawFlags()
        args.done()
        this.#emitShape(ctx, ellipseRegion(quantInt(c.x), quantInt(c.y), rr.x, rr.y), paint, flags)
        return
      }
      case 'arc': {
        const paint = args.paint()
        const c = args.point(draw)
        const r = args.num()
        const a0 = args.num()
        const a1 = args.num()
        const flags = args.strokeFlags()
        args.done()
        const pts = arcPoints(c.x, c.y, r, a0, a1)
        const sink = new PixelSink()
        strokePath(sink, pts, flags.width)
        sink.paint(ctx, paint)
        return
      }
      case 'quad': {
        const paint = args.paint()
        const p0 = args.point(draw)
        const c1 = args.point(draw)
        const p2 = args.point(draw)
        const flags = args.strokeFlags()
        args.done()
        const pts = quadPoints(p0, c1, p2)
        const sink = new PixelSink()
        strokePath(sink, pts, flags.width)
        sink.paint(ctx, paint)
        return
      }
      case 'bezier': {
        const paint = args.paint()
        const p0 = args.point(draw)
        const c1 = args.point(draw)
        const c2 = args.point(draw)
        const p3 = args.point(draw)
        const flags = args.strokeFlags()
        args.done()
        const pts = bezierPoints(p0, c1, c2, p3)
        const sink = new PixelSink()
        strokePath(sink, pts, flags.width)
        sink.paint(ctx, paint)
        return
      }
      case 'curve': {
        this.#execCurve(ctx, draw, args, state, stmt.span)
        return
      }
      case 'poly': {
        this.#execPoly(ctx, draw, args, state, stmt.span)
        return
      }
      case 'curvePoly': {
        this.#execCurvePoly(ctx, draw, args, state, stmt.span)
        return
      }
      case 'profile': {
        this.#execProfile(ctx, args, state, stmt.span)
        return
      }
      case 'fill': {
        const paint = args.paint()
        const value = args.value()
        args.done()
        if (typeof value === 'object' && value !== null && value.type === 'path') {
          fillRegion(ctx, pathFillRegion(value), paint)
          return
        }
        if (typeof value === 'object' && value !== null && value.type === 'region') {
          fillRegion(ctx, value, paint)
          return
        }
        throw error(
          ERROR_CODE.typeError,
          `fill needs a path or region, got ${typeName(value)}`,
          state.module.displayPath,
          stmt.span,
        )
      }
      case 'stroke': {
        const paint = args.paint()
        const value = args.value()
        const flags = args.strokeFlags()
        args.done()
        if (typeof value === 'object' && value !== null && value.type === 'path') {
          fillRegion(ctx, pathStrokeRegion(value, flags.width), paint)
          return
        }
        if (typeof value === 'object' && value !== null && value.type === 'region') {
          strokeRegion(ctx, value, paint, flags.width)
          return
        }
        throw error(
          ERROR_CODE.typeError,
          `stroke needs a path or region, got ${typeName(value)}`,
          state.module.displayPath,
          stmt.span,
        )
      }
      case 'text': {
        const paint = args.paint()
        const p = args.point(draw)
        const str = args.string()
        const fontName = args.keywordName('font') ?? draw.fontName ?? 'small'
        args.done()
        const font = this.resolveFont(fontName, state, stmt.span)
        if (draw.mirror) {
          // text mirrors position, not glyphs (ADR-0078 §4): draw forward glyphs at the
          // reflected origin, straight to the real buffer. The mask is in canvas
          // coordinates, so it clips the forward text at its real landing position as-is.
          const o = applyMatrix(draw.mirror.matrix, p.x, p.y) ?? p
          const forwardCtx: Context = { buffer: draw.mirror.base, mask: ctx.mask, mode: ctx.mode }
          drawText(forwardCtx, font, quantInt(o.x), quantInt(o.y), str, paint)
          return
        }
        drawText(ctx, font, quantInt(p.x), quantInt(p.y), str, paint)
        return
      }
      case 'flood': {
        const paint = args.paint()
        const p = args.point(draw)
        args.done()
        flood(ctx, quantInt(p.x), quantInt(p.y), paint, () =>
          this.step(stmt.span, state.module.displayPath),
        )
        return
      }
      case 'stamp':
        this.#execStamp(stmt, args, env, state)
        return
      case 'apply': {
        const name = args.rawName()
        args.done()
        this.#runFilter(name, env, state, stmt.span)
        return
      }
      // built-in filters (§12)
      case 'outline': {
        const paint = args.paint()
        const width = args.empty() ? 1 : args.num()
        args.done()
        filterOutline(ctx, paint, quantInt(width))
        return
      }
      case 'replace': {
        const from = args.color()
        const to = args.color()
        args.done()
        filterReplace(ctx, from, to)
        return
      }
      case 'tint': {
        const paint = args.color()
        const amount = args.num()
        args.done()
        filterTint(ctx, paint, amount)
        return
      }
      case 'shadow': {
        // Unified `[region] dx:dy paint` shape (ADR-0070). The first argument disambiguates the
        // three forms by value type: a region → local region shadow (ADR-0062); a dx:dy point →
        // the canonical whole-frame drop shadow; a bare number → the deprecated two-number frame
        // alias, kept for error-robustness in every version.
        const first = args.value()
        if (typeof first === 'object' && first !== null && first.type === 'region') {
          const offset = args.pair()
          const paint = args.paint()
          args.done()
          const dx = quantInt(offset.x)
          const dy = quantInt(offset.y)
          fillRegion(ctx, regionTransform(first, translation(dx, dy), translation(-dx, -dy)), paint)
          return
        }
        // language version 2 makes the whole-frame shadow honour an enclosing `mask …:` block
        // (ADR-0070); `drawstic 1` keeps the whole-buffer rebuild.
        const respectMask = (state.module.ast.pragma ?? LANGUAGE_VERSION) >= 2
        if (typeof first === 'object' && first !== null && first.type === 'point') {
          if (first.rel) {
            throw error(
              ERROR_CODE.typeError,
              "'shadow' expects an absolute dx:dy offset",
              state.module.displayPath,
              stmt.span,
            )
          }
          const paint = args.color()
          args.done()
          filterShadow(ctx, quantInt(first.x), quantInt(first.y), paint, respectMask)
          return
        }
        if (typeof first !== 'number') {
          throw error(
            ERROR_CODE.typeError,
            `shadow needs a dx:dy offset or region, got ${typeName(first)}`,
            state.module.displayPath,
            stmt.span,
          )
        }
        const dx = first
        const dy = args.num()
        const paint = args.color()
        args.done()
        filterShadow(ctx, quantInt(dx), quantInt(dy), paint, respectMask)
        return
      }
      case 'castShadow': {
        const region = args.region()
        const offset = args.pair()
        const paint = args.paint()
        args.done()
        const dx = quantInt(offset.x)
        const dy = quantInt(offset.y)
        fillRegion(ctx, regionTransform(region, translation(dx, dy), translation(-dx, -dy)), paint)
        return
      }
      // Texture filters take an optional leading region scope (ADR-0071): the first argument is a
      // region → confine to it; otherwise it is the filter's first real argument (a number for
      // grain/speckle/ripple, a paint for dither), and the whole-frame form runs unchanged.
      // The two numeric scalars are uniformly ordered `magnitude seed` (ADR-0080).
      case 'grain': {
        const first = args.value()
        const region = regionScopeOf(first)
        const amount = region ? args.num() : this.#asNumber(first, stmt.span, state)
        const seed = args.num()
        const paint = args.paint()
        args.done()
        filterGrain(ctx, amount, seed, paint, region)
        return
      }
      case 'speckle': {
        const first = args.value()
        const region = regionScopeOf(first)
        const density = region ? args.num() : this.#asNumber(first, stmt.span, state)
        const seed = args.num()
        const paint = args.paint()
        args.done()
        filterSpeckle(ctx, density, seed, paint, region)
        return
      }
      case 'ripple': {
        const first = args.value()
        const region = regionScopeOf(first)
        const strength = region ? args.num() : this.#asNumber(first, stmt.span, state)
        const seed = args.num()
        const paint = args.paint()
        args.done()
        filterRipple(ctx, strength, seed, paint, region)
        return
      }
      case 'dither': {
        const first = args.value()
        const region = regionScopeOf(first)
        const paintA = region ? args.paint() : this.#asPaint(first, stmt.span, state)
        const paintB = args.paint()
        const threshold = args.num()
        args.done()
        filterDither(ctx, paintA, paintB, threshold, region)
        return
      }
      case 'shadeRegion': {
        const region = args.region()
        const light = args.pair()
        const base = args.color()
        const amount = args.num()
        args.done()
        // ADR-0068: language version 2 makes `amount` the veil opacity; `drawstic 1`
        // recipes keep the v1 "base alpha = opacity, amount = distance-darkening" split.
        if ((state.module.ast.pragma ?? LANGUAGE_VERSION) >= 2) {
          shadeRegion(ctx, region, light, base, amount)
        } else {
          shadeRegionLegacy(ctx, region, light, base, amount)
        }
        return
      }
      case 'lightRegion': {
        const region = args.region()
        const light = args.pair()
        const paint = args.color()
        const amount = args.num()
        args.done()
        lightRegion(ctx, region, light, paint, amount)
        return
      }
      case 'rim': {
        const region = args.region()
        const direction = args.pair()
        const paint = args.paint()
        const width = args.empty() ? 1 : args.num()
        args.done()
        rimRegion(ctx, region, direction, paint, quantInt(width))
        return
      }
      case 'ambientOcclusion': {
        const region = args.region()
        const paint = args.color()
        const amount = args.num()
        args.done()
        ambientOcclusion(ctx, region, paint, amount)
        return
      }
      default: {
        this.#execCommandFallback(stmt, env, state)
        return
      }
    }
  }

  #emitShape(
    ctx: Context,
    region: Region,
    paint: Paint,
    flags: { readonly fill: boolean; readonly width: number },
  ): void {
    if (flags.fill) {
      fillRegion(ctx, region, paint)
    } else {
      strokeRegion(ctx, region, paint, flags.width)
    }
  }

  /**
   * Reuse an already-evaluated value as a number argument (ADR-0071): the first argument of a
   * scoped texture filter is evaluated once to classify it (region vs. not), so when it is not a
   * region it is validated here rather than re-read from the arg stream.
   */
  #asNumber(v: Value, span: TextSpan, state: State): number {
    if (typeof v === 'number') {
      return v
    }
    throw error(
      ERROR_CODE.typeError,
      `expected a number, got ${typeName(v)}`,
      state.module.displayPath,
      span,
    )
  }

  /** As {@link Engine.#asNumber}, but validates the value as a paint (dither's first argument). */
  #asPaint(v: Value, span: TextSpan, state: State): Paint {
    if (typeof v === 'object' && v !== null && (v.type === 'color' || v.type === 'grad')) {
      return v
    }
    throw error(
      ERROR_CODE.typeError,
      `expected a paint (color or gradient), got ${typeName(v)}`,
      state.module.displayPath,
      span,
    )
  }

  /**
   * Parse one keyword-form `stamp` modifier (`transform:`, `tint:`,
   * `mask:`, `anchor:`, `shadow:`) into `f`, mutating it in place. Returns
   * `false` (without consuming input) if the next arg isn't a recognized
   * keyword, so callers can loop until no more modifiers match.
   */
  #parseStampKeyword(args: Args, state: State, span: TextSpan, f: StampFlags): boolean {
    const keyword = args.peekKeyword()
    if (keyword === 'transform') {
      const t = args.keywordExpression()
      if (typeof t !== 'object' || t?.type !== 'transform') {
        throw error(
          ERROR_CODE.typeError,
          "'transform' expects a transform value",
          state.module.displayPath,
          span,
        )
      }
      f.transform = t.m
      return true
    }
    if (keyword === 'tint') {
      const [color, amount] = args.keywordExpressions('tint')
      if (typeof color !== 'object' || color?.type !== 'color' || typeof amount !== 'number') {
        throw error(
          ERROR_CODE.typeError,
          "'tint' expects a color and an amount",
          state.module.displayPath,
          span,
        )
      }
      f.tint = { color, amount }
      return true
    }
    if (keyword === 'mask') {
      const mask = args.keywordExpression()
      if (typeof mask !== 'object' || mask?.type !== 'region') {
        throw error(ERROR_CODE.typeError, "'mask' expects a region", state.module.displayPath, span)
      }
      f.mask = mask
      return true
    }
    if (keyword === 'anchor') {
      const anchor = args.keywordName('anchor')
      if (!isStampAnchor(anchor)) {
        throw error(
          ERROR_CODE.badFlag,
          `'anchor' expects ${STAMP_ANCHORS.join(', ')}`,
          state.module.displayPath,
          span,
        )
      }
      f.anchor = anchor
      return true
    }
    if (keyword === 'shadow') {
      const [offset, color] = args.keywordExpressions('shadow')
      if (typeof offset !== 'object' || offset?.type !== 'point' || offset.rel) {
        throw error(
          ERROR_CODE.typeError,
          "'shadow' expects an absolute dx:dy pair",
          state.module.displayPath,
          span,
        )
      }
      if (typeof color !== 'object' || color?.type !== 'color') {
        throw error(
          ERROR_CODE.typeError,
          "'shadow' expects a color",
          state.module.displayPath,
          span,
        )
      }
      f.shadow = { dx: offset.x, dy: offset.y, color }
      return true
    }
    return false
  }

  /**
   * Parse one bare-flag `stamp` modifier (`flipx`, `flipy`, `rotN`,
   * `scaleN`) or delegate to {@link #parseStampKeyword}; `false` means no
   * more flags to consume.
   */
  #parseOneStampFlag(args: Args, st: State, span: TextSpan, f: StampFlags): boolean {
    const flag = args.peekFlag()
    if (flag === 'flipx') {
      args.takeFlag()
      f.flipx = true
      return true
    }
    if (flag === 'flipy') {
      args.takeFlag()
      f.flipy = true
      return true
    }
    if (flag && /^rot\d+(\.\d+)?$/.test(flag)) {
      args.takeFlag()
      f.rotation = Number.parseFloat(flag.slice(3))
      return true
    }
    if (flag && /^scale\d+$/.test(flag)) {
      args.takeFlag()
      f.scale = Number.parseInt(flag.slice(5), 10)
      return true
    }
    return this.#parseStampKeyword(args, st, span, f)
  }

  #parseStampFlags(args: Args, state: State, span: TextSpan): StampFlags {
    const f: StampFlags = {
      flipx: false,
      flipy: false,
      scale: 1,
      rotation: 0,
      transform: undefined,
      tint: undefined,
      mask: undefined,
      anchor: 'topLeft',
      shadow: undefined,
    }
    while (this.#parseOneStampFlag(args, state, span, f)) {
      // consume flags until none match
    }
    return f
  }

  // integer scaling anchors at the footprint's top-left pixel corner
  // (-0.5 in centre coords) so NN block-doubling is exact (ADR-0043)
  #buildStampMatrix(sprite: Sprite, f: StampFlags): readonly number[] | undefined {
    const cx = (sprite.w - 1) / 2
    const cy = (sprite.h - 1) / 2
    const parts: (readonly number[])[] = []
    if (f.flipx) {
      parts.push(aboutPoint(scaling(-1, 1), cx, cy))
    }
    if (f.flipy) {
      parts.push(aboutPoint(scaling(1, -1), cx, cy))
    }
    if (f.scale !== 1) {
      parts.push(aboutPoint(scaling(f.scale, f.scale), -0.5, -0.5))
    }
    if (f.rotation !== 0) {
      parts.push(aboutPoint(rotationDeg(f.rotation), cx, cy))
    }
    if (f.transform) {
      parts.push(f.transform)
    }
    if (parts.length === 0) {
      return undefined
    }
    let m = IDENTITY
    for (const part of parts) {
      m = compose(m, part)
    }
    return m
  }

  /**
   * The sprite-local point (in unscaled source pixels) that `anchor`
   * names (ADR-0064) — e.g. `center` is the sprite's midpoint, `topLeft`
   * is the origin and needs no lookup (handled separately by callers).
   */
  #stampAnchorPoint(
    sprite: Sprite,
    anchor: StampAnchor,
  ): { readonly x: number; readonly y: number } {
    const cx = (sprite.w - 1) / 2
    const cy = (sprite.h - 1) / 2
    switch (anchor) {
      case 'top':
        return { x: cx, y: 0 }
      case 'topRight':
        return { x: sprite.w - 1, y: 0 }
      case 'left':
        return { x: 0, y: cy }
      case 'center':
        return { x: cx, y: cy }
      case 'right':
        return { x: sprite.w - 1, y: cy }
      case 'bottomLeft':
        return { x: 0, y: sprite.h - 1 }
      case 'bottom':
        return { x: cx, y: sprite.h - 1 }
      case 'bottomRight':
        return { x: sprite.w - 1, y: sprite.h - 1 }
      default:
        return { x: 0, y: 0 }
    }
  }

  /**
   * Legacy (`drawstic 1`, ADR-0064) anchor resolution: the source-local
   * anchor point pushed *through* the stamp transform, so flip/rotate/scale
   * carry the named point with the pixels. `undefined` when it maps to
   * infinity (projective/singular).
   */
  #throughTransformAnchorPoint(
    sprite: Sprite,
    anchor: StampAnchor,
    matrix: readonly number[] | undefined,
  ): { readonly x: number; readonly y: number } | undefined {
    const local = this.#stampAnchorPoint(sprite, anchor)
    if (!matrix) {
      return local
    }
    return applyMatrix(matrix, local.x, local.y) ?? undefined
  }

  /**
   * The offset-anchor position on the *transformed* footprint's axis-aligned
   * bounding box (visual semantics, ADR-0072) — e.g. `bottom` is the visible
   * bottom-centre after flip/rotate/scale. The bbox is forward-mapped from the
   * sprite's pixel-centre corners, so an untransformed footprint yields
   * `[0,w−1]×[0,h−1]` and every anchor coincides with its source point.
   * Returns `undefined` when a corner maps to infinity (projective/singular).
   */
  #visualAnchorPoint(
    sprite: Sprite,
    anchor: StampAnchor,
    matrix: readonly number[] | undefined,
  ): { readonly x: number; readonly y: number } | undefined {
    const corners: readonly (readonly [number, number])[] = [
      [0, 0],
      [sprite.w - 1, 0],
      [0, sprite.h - 1],
      [sprite.w - 1, sprite.h - 1],
    ]
    let minX = Number.POSITIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const [x, y] of corners) {
      const p = matrix ? applyMatrix(matrix, x, y) : { x, y }
      if (!p) {
        return undefined
      }
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    const midX = (minX + maxX) / 2
    const midY = (minY + maxY) / 2
    switch (anchor) {
      case 'top':
        return { x: midX, y: minY }
      case 'topRight':
        return { x: maxX, y: minY }
      case 'left':
        return { x: minX, y: midY }
      case 'center':
        return { x: midX, y: midY }
      case 'right':
        return { x: maxX, y: midY }
      case 'bottomLeft':
        return { x: minX, y: maxY }
      case 'bottom':
        return { x: midX, y: maxY }
      case 'bottomRight':
        return { x: maxX, y: maxY }
      default:
        return { x: minX, y: minY }
    }
  }

  /**
   * The top-left stamp origin such that `anchor` lands on `point`. `topLeft`
   * (and the implicit default) always places the untransformed origin at
   * `point` (ADR-0072 §2). For the eight offset anchors: language version 2
   * resolves them against the *transformed* footprint bbox (visual — ADR-0072);
   * `drawstic 1` maps the source-local anchor point *through* the transform
   * (legacy — ADR-0064). Both fall back to raw origin placement if the anchor
   * maps outside the transform's domain.
   */
  #anchoredStampOrigin(
    sprite: Sprite,
    point: { readonly x: number; readonly y: number },
    matrix: readonly number[] | undefined,
    anchor: StampAnchor,
    visual: boolean,
  ): { readonly x: number; readonly y: number } {
    if (anchor === 'topLeft') {
      return { x: quantInt(point.x), y: quantInt(point.y) }
    }
    const mapped = visual
      ? this.#visualAnchorPoint(sprite, anchor, matrix)
      : this.#throughTransformAnchorPoint(sprite, anchor, matrix)
    if (!mapped) {
      return { x: quantInt(point.x), y: quantInt(point.y) }
    }
    return { x: quantInt(point.x - mapped.x), y: quantInt(point.y - mapped.y) }
  }

  #execStamp(
    stmt: Extract<Statement, { readonly kind: 'call' }>,
    args: Args,
    _env: Environment,
    state: State,
  ): void {
    const draw = state.draw
    if (!draw) {
      return
    }
    const sprite = args.sprite()
    const point = args.point(draw)
    // flags: flip → scale → rotate about the footprint centre (ADR-0043)
    const flags = this.#parseStampFlags(args, state, stmt.span)
    args.done()
    const matrix = this.#buildStampMatrix(sprite, flags)
    // A stamp `mask` region is in canvas coordinates like every mask; inside a `mirror` the
    // reflecting buffer flips the sprite pixels and the mask travels with them (ADR-0078 §5).
    // v2 = visual anchors (transformed footprint bbox); v1 = through-transform (ADR-0072)
    const visualAnchors = (state.module.ast.pragma ?? LANGUAGE_VERSION) >= 2
    const origin = this.#anchoredStampOrigin(sprite, point, matrix, flags.anchor, visualAnchors)
    if (flags.shadow) {
      const shadowOk = stampSprite(
        draw.context,
        sprite,
        origin.x + quantInt(flags.shadow.dx),
        origin.y + quantInt(flags.shadow.dy),
        matrix,
        { color: flags.shadow.color, amount: 1 },
        flags.mask,
      )
      if (!shadowOk) {
        throw error(
          ERROR_CODE.nonInvertible,
          'stamp transform is not invertible',
          state.module.displayPath,
          stmt.span,
        )
      }
    }
    const ok = stampSprite(draw.context, sprite, origin.x, origin.y, matrix, flags.tint, flags.mask)
    if (!ok) {
      throw error(
        ERROR_CODE.nonInvertible,
        'stamp transform is not invertible',
        state.module.displayPath,
        stmt.span,
      )
    }
    // palette artifact: record first-stamp order (ADR-0050)
    if (!draw.sprite.stamped.includes(sprite)) {
      draw.sprite.stamped.push(sprite)
    }
  }

  // ── fonts (ADR-0022 bitmap fonts, ADR-0042 user fonts, ADR-0054 std fonts) ─

  /**
   * Resolve a font name to a renderable {@link FontResolved}: either a
   * std global font (loaded from its own `std:` module) or a user `font`
   * definition in the current module. `seen` guards against a `with`
   * fallback cycle (E017), threaded through recursive resolution of the
   * fallback chain.
   */
  resolveFont(name: string, state: State, span: TextSpan, seen = new Set<string>()): FontResolved {
    const globalModule = STD_GLOBAL_FONTS[name]
    if (globalModule) {
      const mod = this.#loadStdModule(globalModule, state.module.displayPath, span)
      const entry = mod.definitions.get(name)
      if (entry?.kind !== 'font') {
        throw error(ERROR_CODE.fontError, `unknown font '${name}'`, state.module.displayPath, span)
      }
      return this.#buildUserFont(entry.definition, entry.module, span, seen)
    }
    const entry = state.module.definitions.get(name)
    if (entry?.kind !== 'font') {
      throw error(ERROR_CODE.fontError, `unknown font '${name}'`, state.module.displayPath, span)
    }
    return this.#buildUserFont(entry.definition, entry.module, span, seen)
  }

  /**
   * Render a `glyph 'x' drawingName` item to its sprite; the referenced
   * drawing must be non-parametric (E017) since glyphs are rendered once
   * and reused verbatim for every occurrence of the character.
   */
  #renderFontGlyph(item: Extract<FontItem, { readonly kind: 'glyph' }>, mod: ModuleRecord): Sprite {
    this.#checkGlyphKey(item.char, mod, item.span)
    const def = mod.definitions.get(item.drawing)
    if (def?.kind !== 'draw') {
      throw error(
        ERROR_CODE.fontError,
        `glyph drawing '${item.drawing}' not found`,
        mod.displayPath,
        item.span,
      )
    }
    if (def.definition.params && def.definition.params.length > 0) {
      throw error(
        ERROR_CODE.fontError,
        'glyph drawings must be non-parametric',
        mod.displayPath,
        item.span,
      )
    }
    return this.renderDraw(def, [], item.span)
  }

  /**
   * Synthesize a throwaway {@link DrawDefinition} for an inline glyph body
   * (`glyph 'x': …` directly in the font), so it can be rendered through
   * the normal {@link #renderDrawBody} path with the glyph ink pre-bound
   * to `k` (see {@link #buildUserFont}'s `inlineGlyphs` draw callback).
   */
  #inlineGlyphDrawDef(
    font: FontDefinition,
    item: Extract<FontItem, { readonly kind: 'inlineGlyph' }>,
  ): DrawDefinition {
    return {
      name: `${font.name}.${item.char}`,
      params: undefined,
      size: item.size ?? font.size,
      body: item.body,
      span: item.span,
    }
  }

  /**
   * The width/height an inline glyph will render at, without actually
   * rendering it — resolved the same way as a drawing's size ({@link
   * #resolveDrawSize}) so per-glyph size overrides and the font's default
   * size both work.
   */
  #inlineGlyphMetrics(
    font: FontDefinition,
    item: Extract<FontItem, { readonly kind: 'inlineGlyph' }>,
    mod: ModuleRecord,
  ): { readonly w: number; readonly h: number } {
    const def = this.#inlineGlyphDrawDef(font, item)
    const pixels = def.body.find(
      (stmt): stmt is Extract<Statement, { kind: 'pixels' }> => stmt.kind === 'pixels',
    )
    const size = this.#resolveDrawSize(def, mod, pixels, emptyTheme())
    return { w: size.width, h: size.height }
  }

  #checkGlyphKey(char: string, mod: ModuleRecord, span: TextSpan): void {
    if (char.length !== 1) {
      throw error(
        ERROR_CODE.fontError,
        `glyph key must be one character, got "${char}"`,
        mod.displayPath,
        span,
      )
    }
  }

  /**
   * Expand a `glyphs tilesetName "abc…"` item: maps each character in
   * `item.chars` to the tileset frame at the same index (E017 if the
   * tileset is shorter than the character string).
   */
  #addFontGlyphs(
    item: Extract<FontItem, { readonly kind: 'glyphs' }>,
    mod: ModuleRecord,
    glyphs: Map<string, Sprite>,
  ): void {
    const tileset = mod.definitions.get(item.tileset)
    if (tileset?.kind !== 'tileset') {
      throw error(
        ERROR_CODE.fontError,
        `glyphs tileset '${item.tileset}' not found`,
        mod.displayPath,
        item.span,
      )
    }
    const value = this.buildTileset(tileset, item.span)
    for (let i = 0; i < item.chars.length; i++) {
      const ch = item.chars[i] ?? ''
      const frame = value.frames[i]
      if (!frame) {
        throw error(
          ERROR_CODE.fontError,
          `tileset has no tile ${i} for character "${ch}"`,
          mod.displayPath,
          item.span,
        )
      }
      glyphs.set(ch, extractSubSprite(value.sheet, frame, `${item.tileset}.${i}`))
    }
  }

  /**
   * Check every glyph agrees on height (E017) and, for a monospace font
   * (`def.size` set), that every glyph matches the declared width (E017).
   * Returns the height to use for the font (the first glyph's, if `initial`
   * wasn't already fixed by the font's own size).
   */
  #validateGlyphMetrics(
    glyphs: Iterable<readonly [string, { readonly w: number; readonly h: number }]>,
    def: FontDefinition,
    mod: ModuleRecord,
    initial: number | undefined,
  ): number | undefined {
    let height = initial
    for (const [char, glyph] of glyphs) {
      height ??= glyph.h
      if (glyph.h !== height) {
        throw error(
          ERROR_CODE.fontError,
          `glyph "${char}" is ${glyph.h}px tall — glyph heights must agree (${height})`,
          mod.displayPath,
          def.span,
        )
      }
      if (def.size && glyph.w !== def.size.width) {
        throw error(
          ERROR_CODE.fontError,
          `glyph "${char}" is ${glyph.w}px wide — font declares monospace ${def.size.width}x${def.size.height}`,
          mod.displayPath,
          def.span,
        )
      }
    }
    return height
  }

  /**
   * Build a user `font` definition into a {@link FontResolved}: renders
   * every `glyph`/`glyphs` item to a sprite, compiles `inlineGlyph` items
   * into lazy draw callbacks (so their ink color can be bound per call
   * site), resolves any `with` fallback font, and validates glyph metrics
   * agree (E017). `seen` detects a fallback cycle across recursive calls.
   */
  #buildUserFont(
    def: FontDefinition,
    mod: ModuleRecord,
    span: TextSpan,
    seen: Set<string>,
  ): FontResolved {
    const fontKey = `${mod.file}:${def.name}`
    if (seen.has(fontKey)) {
      throw error(
        ERROR_CODE.fontError,
        `font fallback cycle includes '${def.name}'`,
        mod.displayPath,
        span,
      )
    }
    seen.add(fontKey)
    const glyphs = new Map<string, Sprite>()
    const inlineGlyphs: UserFontResolved['inlineGlyphs'] = new Map()
    let fallback: string | undefined
    let tracking = 1
    let lineHeight: number | undefined
    let height: number | undefined = def.size?.height ?? undefined
    for (const item of def.items) {
      switch (item.kind) {
        case 'with':
          fallback = item.name
          break
        case 'glyph':
          glyphs.set(item.char, this.#renderFontGlyph(item, mod))
          break
        case 'inlineGlyph': {
          this.#checkGlyphKey(item.char, mod, item.span)
          const metrics = this.#inlineGlyphMetrics(def, item, mod)
          inlineGlyphs.set(item.char, {
            width: metrics.w,
            height: metrics.h,
            draw: (ctx, x, y, paint) => {
              const sprite = this.#renderDrawBody(
                this.#inlineGlyphDrawDef(def, item),
                mod,
                [],
                undefined,
                new Map([['k', paint]]),
              )
              stampSprite(ctx, sprite, x, y)
            },
          })
          break
        }
        case 'glyphs':
          this.#addFontGlyphs(item, mod, glyphs)
          break
        case 'tracking':
          tracking = item.value
          break
        case 'lineheight':
          lineHeight = item.value
          break
        default:
          break
      }
    }
    height = this.#validateGlyphMetrics(
      [
        ...glyphs.entries(),
        ...[...inlineGlyphs.entries()].map(
          ([char, glyph]) => [char, { w: glyph.width, h: glyph.height }] as const,
        ),
      ],
      def,
      mod,
      height,
    )
    const fb = fallback
      ? this.resolveFont(
          fallback,
          { module: mod, budget: this.budget, draw: null, functionDepth: 0 },
          span,
          seen,
        )
      : null
    const fbHeight = fb ? (fb.kind === 'bitmap' ? fb.font.h : fb.height) : undefined
    const h = height ?? fbHeight ?? 7
    seen.delete(fontKey)
    return {
      kind: 'user',
      name: def.name,
      glyphs,
      inlineGlyphs,
      fallback: fb,
      tracking,
      lineHeight: lineHeight ?? h + 1,
      height: h,
    }
  }

  // ── tilesets & atlases (ADR-0016) ─────────────────────────────────────

  /**
   * Build (or fetch cached) a `tileset` definition: renders each named
   * tile, checks every tile matches the declared `tileWidth`x`tileHeight`
   * (E016), then blits them in declaration order onto a grid sheet
   * (`columns` defaults to a square-ish layout via `ceil(sqrt(n))`).
   */
  buildTileset(
    entry: Extract<DefinitionEntry, { readonly kind: 'tileset' }>,
    span: TextSpan,
  ): TilesetValue {
    const key = `${entry.module.file}#${entry.definition.name}`
    const cached = this.#tilesetCache.get(key)
    if (cached) {
      return cached
    }
    const def = entry.definition
    const mod = entry.module
    const sprites: Sprite[] = def.tiles.map((name) => {
      const tileDef = mod.definitions.get(name)
      if (!tileDef) {
        throw error(ERROR_CODE.unknownName, `tile '${name}' not found`, mod.displayPath, def.span)
      }
      const tile = this.defToSprite(tileDef, span)
      if (tile.w !== def.tileWidth || tile.h !== def.tileHeight) {
        throw error(
          ERROR_CODE.tileSize,
          `tile '${name}' is ${tile.w}x${tile.h} — tileset '${def.name}' requires ${def.tileWidth}x${def.tileHeight}`,
          mod.displayPath,
          def.span,
        )
      }
      return tile
    })
    const columns = def.columns ?? Math.ceil(Math.sqrt(sprites.length))
    const rows = Math.ceil(sprites.length / columns)
    const width = columns * def.tileWidth
    const height = rows * def.tileHeight
    const buffer = new Framebuffer(width, height)
    const frames: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }[] = []
    const ctx: Context = { buffer: buffer, mask: null, mode: 'pixel' }
    sprites.forEach((sp, i) => {
      const x = (i % columns) * def.tileWidth
      const y = Math.floor(i / columns) * def.tileHeight
      stampSprite(ctx, sp, x, y)
      frames.push({ x, y, width: def.tileWidth, height: def.tileHeight })
    })
    const palette = foldPalettes(sprites)
    const value: TilesetValue = {
      sheet: {
        type: 'sprite',
        name: def.name,
        w: width,
        h: height,
        data: buffer.data,
        pal: palette,
        title: undefined,
        desc: undefined,
      },
      tileWidth: def.tileWidth,
      tileHeight: def.tileHeight,
      columns,
      frames,
      names: def.tiles.slice(),
    }
    this.#tilesetCache.set(key, value)
    return value
  }

  /**
   * Build (or fetch cached) an `atlas` definition: explicitly `place`d
   * members keep their pinned coordinates; the rest are shelf-packed
   * deterministically (tallest-first, then declaration order — see
   * {@link packShelves}) around them. Overlapping members blit in
   * declaration order, so later members paint over earlier ones.
   */
  buildAtlas(entry: Extract<DefinitionEntry, { kind: 'atlas' }>, span: TextSpan): AtlasValue {
    const key = `${entry.module.file}#${entry.definition.name}`
    const cached = this.#atlasCache.get(key)
    if (cached) {
      return cached
    }
    const def = entry.definition
    const mod = entry.module
    const members = def.sprites.map((name) => {
      const memberDef = mod.definitions.get(name)
      if (!memberDef) {
        throw error(ERROR_CODE.unknownName, `sprite '${name}' not found`, mod.displayPath, def.span)
      }
      return { name, sprite: this.defToSprite(memberDef, span) }
    })
    const padding = def.padding
    const pinned = new Map(def.place.map((p) => [p.name, p]))
    const placed: AtlasPlaced[] = []
    for (const member of members) {
      const pin = pinned.get(member.name)
      if (pin) {
        placed.push({
          name: member.name,
          x: pin.x,
          y: pin.y,
          width: member.sprite.w,
          height: member.sprite.h,
          sprite: member.sprite,
        })
      }
    }
    // deterministic shelf packing: height desc, then declaration order
    const rest = members
      .filter((m) => !pinned.has(m.name))
      .map((m, i) => ({ ...m, i }))
      .sort((a, b) => b.sprite.h - a.sprite.h || a.i - b.i)
    const totalArea = members.reduce(
      (n, m) => n + (m.sprite.w + padding) * (m.sprite.h + padding),
      0,
    )
    const maxWidth = Math.max(
      1,
      ...members.map((m) => m.sprite.w),
      ...placed.map((p) => p.x + p.width),
    )
    const targetWidth = Math.max(maxWidth, Math.ceil(Math.sqrt(totalArea)))
    packShelves(rest, placed, targetWidth, padding)
    const width = Math.max(1, ...placed.map((p) => p.x + p.width))
    const height = Math.max(1, ...placed.map((p) => p.y + p.height))
    const buffer = new Framebuffer(width, height)
    const ctx: Context = { buffer: buffer, mask: null, mode: 'pixel' }
    // blit in declaration order for deterministic overlap behaviour
    for (const member of members) {
      const p = placed.find((q) => q.name === member.name)
      if (!p) {
        continue
      }
      stampSprite(ctx, p.sprite, p.x, p.y)
    }
    const value: AtlasValue = {
      sheet: {
        type: 'sprite',
        name: def.name,
        w: width,
        h: height,
        data: buffer.data,
        pal: foldPalettes(members.map((m) => m.sprite)),
        title: undefined,
        desc: undefined,
      },
      frames: members.flatMap((member) => {
        const p = placed.find((q) => q.name === member.name)
        return p ? [{ name: member.name, x: p.x, y: p.y, width: p.width, height: p.height }] : []
      }),
    }
    this.#atlasCache.set(key, value)
    return value
  }

  // ── images (ADR-0045) ─────────────────────────────────────────────────

  /**
   * Load an `import image` definition (ADR-0045) as a plain sprite (empty
   * palette — imported images aren't required to be palette-clean). PNG
   * only: JPEG's lossy, non-bit-exact decoding would break ADR-0007
   * visual determinism. Enforces the sandbox root (E008) and, if the
   * definition pins a `sha256`, verifies it (E020) so a recipe's imported
   * asset can't silently change out from under it.
   */
  #loadImage(entry: Extract<DefinitionEntry, { kind: 'image' }>): Sprite {
    const cacheKey = `img:${entry.module.file}#${entry.name}`
    const cached = this.#spriteCache.get(cacheKey)
    if (cached) {
      return cached
    }
    if (!entry.path.toLowerCase().endsWith('.png')) {
      throw error(
        ERROR_CODE.importError,
        `only PNG images can be imported (got '${entry.path}') — JPEG decoding is not bit-exact`,
        entry.module.displayPath,
        entry.span,
      )
    }
    const abs = resolve(dirname(entry.module.file), entry.path)
    if (!abs.startsWith(this.root + sep) && abs !== this.root) {
      throw error(
        ERROR_CODE.importError,
        `image import escapes the project root: '${entry.path}'`,
        entry.module.displayPath,
        entry.span,
      )
    }
    if (!existsSync(abs)) {
      throw error(
        ERROR_CODE.importError,
        `image not found: '${entry.path}'`,
        entry.module.displayPath,
        entry.span,
      )
    }
    const bytes = new Uint8Array(readFileSync(abs))
    if (entry.sha256) {
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (digest !== entry.sha256.toLowerCase()) {
        throw error(
          ERROR_CODE.shaMismatch,
          `sha256 mismatch for '${entry.path}'`,
          entry.module.displayPath,
          entry.span,
          `actual: ${digest}`,
        )
      }
    }
    let decoded: { w: number; h: number; data: Uint8Array }
    try {
      decoded = decodePng(bytes)
    } catch (e) {
      throw error(
        ERROR_CODE.importError,
        `failed to decode '${entry.path}': ${(e as Error).message}`,
        entry.module.displayPath,
        entry.span,
      )
    }
    const sprite: Sprite = {
      type: 'sprite',
      name: entry.name,
      w: decoded.w,
      h: decoded.h,
      data: decoded.data,
      pal: [],
      title: undefined,
      desc: undefined,
    }
    this.#spriteCache.set(cacheKey, sprite)
    return sprite
  }

  /**
   * Evaluate a path command's point operand. A relative point value
   * (`expr.rel`) isn't allowed inside path definitions — paths have their
   * own `rel` keyword on the command instead (ADR-0061) — E006 either
   * way if relative without a current point (need a prior `move`).
   */
  #evalPathPoint(
    expr: Expression,
    env: Environment,
    state: State,
    cursor: PathPoint | null,
    relative: boolean,
  ): PathPoint {
    const value = this.evalExpr(expr, env, state)
    if (typeof value !== 'object' || value?.type !== 'point') {
      throw error(
        ERROR_CODE.typeError,
        `path point must be a point, got ${typeName(value)}`,
        state.module.displayPath,
        expr.span,
      )
    }
    if (value.rel) {
      throw error(
        ERROR_CODE.typeError,
        "relative points are not allowed in path definitions; use 'rel' in the path command",
        state.module.displayPath,
        expr.span,
      )
    }
    if (!relative) {
      return { x: value.x, y: value.y }
    }
    if (!cursor) {
      throw error(
        ERROR_CODE.typeError,
        "relative path coordinates need a current point; add 'move' first",
        state.module.displayPath,
        expr.span,
      )
    }
    return { x: cursor.x + value.x, y: cursor.y + value.y }
  }

  /**
   * Tessellate the shorter/named-direction arc from `start` to `end`
   * around `center` (radius taken from `start`; `end` is assumed
   * equidistant) into a point chain, walking `endDeg` past `startDeg` in
   * 360° increments until it's on the requested side of `clockwise`.
   */
  #arcThrough(
    start: PathPoint,
    end: PathPoint,
    center: PathPoint,
    clockwise: boolean,
  ): PathPoint[] {
    const r = dhypot(start.x - center.x, start.y - center.y)
    if (r === 0) {
      return [start, end]
    }
    const startDeg = (datan2(start.y - center.y, start.x - center.x) * 180) / PI
    let endDeg = (datan2(end.y - center.y, end.x - center.x) * 180) / PI
    if (clockwise) {
      while (endDeg <= startDeg) {
        endDeg += 360
      }
    } else {
      while (endDeg >= startDeg) {
        endDeg -= 360
      }
    }
    return arcPoints(center.x, center.y, r, startDeg, endDeg)
  }

  /**
   * Evaluate a path definition's command list into flattened point
   * contours (for fill/stroke rasterization) alongside the resolved
   * command list (for re-export as an SVG path). `move` starts a new open
   * contour; `close` closes the current one and resets the cursor to its
   * first point (spec path semantics, ADR-0061). Curve/arc commands are
   * tessellated via {@link quadPoints}/{@link bezierPoints}/{@link #arcThrough}
   * and their point chains appended, deduping an exactly-repeated
   * endpoint at the seam.
   */
  #evalPathCommands(
    commands: readonly PathCommand[],
    env: Environment,
    state: State,
  ): { readonly contours: PathContour[]; readonly commands: import('./values.js').PathCommand[] } {
    const contours: PathContour[] = []
    const outCommands: import('./values.js').PathCommand[] = []
    let current: PathPoint | null = null
    let points: PathPoint[] | null = null
    const finishOpen = (): void => {
      if (points && points.length > 0) {
        contours.push({ points, closed: false })
      }
      points = null
    }
    const requireCurrent = (cmd: PathCommand): PathPoint => {
      if (!current || !points) {
        throw error(
          ERROR_CODE.typeError,
          `path '${cmd.kind}' needs a current point; add 'move' first`,
          state.module.displayPath,
          cmd.span,
        )
      }
      return current
    }
    const appendChain = (chain: readonly PathPoint[]): void => {
      if (!points) {
        points = []
      }
      for (const p of chain) {
        const last = points.at(-1)
        if (last && last.x === p.x && last.y === p.y) {
          continue
        }
        points.push({ x: p.x, y: p.y })
      }
    }
    for (const cmd of commands) {
      this.step(cmd.span, state.module.displayPath)
      switch (cmd.kind) {
        case 'move': {
          finishOpen()
          const p = this.#evalPathPoint(cmd.point, env, state, current, cmd.relative)
          current = p
          points = [p]
          outCommands.push({ kind: 'move', to: p })
          break
        }
        case 'line': {
          requireCurrent(cmd)
          const p = this.#evalPathPoint(cmd.point, env, state, current, cmd.relative)
          appendChain([p])
          current = p
          outCommands.push({ kind: 'line', to: p })
          break
        }
        case 'quad': {
          const start = requireCurrent(cmd)
          const c = this.#evalPathPoint(cmd.control, env, state, current, cmd.controlRelative)
          const p = this.#evalPathPoint(cmd.point, env, state, current, cmd.pointRelative)
          appendChain(quadPoints(start, c, p))
          current = p
          outCommands.push({ kind: 'quad', control: c, to: p })
          break
        }
        case 'bezier': {
          const start = requireCurrent(cmd)
          const c1 = this.#evalPathPoint(cmd.control1, env, state, current, cmd.control1Relative)
          const c2 = this.#evalPathPoint(cmd.control2, env, state, current, cmd.control2Relative)
          const p = this.#evalPathPoint(cmd.point, env, state, current, cmd.pointRelative)
          appendChain(bezierPoints(start, c1, c2, p))
          current = p
          outCommands.push({ kind: 'bezier', control1: c1, control2: c2, to: p })
          break
        }
        case 'arc': {
          const start = requireCurrent(cmd)
          const p = this.#evalPathPoint(cmd.point, env, state, current, cmd.pointRelative)
          const c = this.#evalPathPoint(cmd.center, env, state, current, false)
          appendChain(this.#arcThrough(start, p, c, cmd.clockwise))
          current = p
          outCommands.push({ kind: 'arc', center: c, to: p, clockwise: cmd.clockwise })
          break
        }
        case 'close': {
          if (!points || points.length < 1) {
            throw error(
              ERROR_CODE.typeError,
              "path 'close' needs an open contour",
              state.module.displayPath,
              cmd.span,
            )
          }
          contours.push({ points, closed: true })
          current = points[0] ?? null
          points = null
          outCommands.push({ kind: 'close' })
          break
        }
      }
    }
    finishOpen()
    return { contours, commands: outCommands }
  }

  /**
   * Evaluate a `path` definition to a {@link Path} value: either a single
   * expression that must itself produce a path, or a command-list body
   * run through {@link #evalPathCommands}. Not cached — paths are cheap
   * and, unlike drawings, don't allocate a framebuffer.
   */
  evalPath(entry: Extract<DefinitionEntry, { kind: 'path' }>, args: Value[], span: TextSpan): Path {
    const def = entry.definition
    const params = def.params ?? []
    if (args.length !== params.length) {
      throw error(
        ERROR_CODE.arity,
        `path '${def.name}' takes ${params.length} argument(s), got ${args.length}`,
        entry.module.displayPath,
        span,
      )
    }
    const state: State = {
      module: entry.module,
      budget: this.budget,
      draw: null,
      functionDepth: 0,
    }
    const env = new Environment(entry.module.env)
    params.forEach((param, i) => {
      env.declare(param, args[i] ?? 0)
    })
    if (def.body.kind === 'expression') {
      const value = this.evalExpr(def.body.expression, env, state)
      if (typeof value !== 'object' || value?.type !== 'path') {
        throw error(
          ERROR_CODE.typeError,
          `path '${def.name}' expression must evaluate to a path`,
          entry.module.displayPath,
          def.span,
        )
      }
      return value
    }
    const built = this.#evalPathCommands(def.body.commands, env, state)
    return path(built.contours, built.commands, def.size)
  }

  /**
   * Resolve any content definition to a sprite: drawings render, tilesets
   * and atlases yield their full sheet, images decode. Themes/functions/
   * filters/fonts/paths aren't stampable content and throw E006.
   */
  defToSprite(entry: DefinitionEntry, span: TextSpan, args: Value[] = []): Sprite {
    switch (entry.kind) {
      case 'draw':
        return this.renderDraw(entry, args, span)
      case 'tileset':
        return this.buildTileset(entry, span).sheet
      case 'atlas':
        return this.buildAtlas(entry, span).sheet
      case 'image':
        return this.#loadImage(entry)
      default:
        throw error(
          ERROR_CODE.typeError,
          `'${(entry as { kind: string }).kind}' is not stampable content`,
          entry.module.displayPath,
          span,
        )
    }
  }

  /**
   * Parses `${name}${argsText}` as a standalone `name(args…)` call — the
   * same D6 "unspaced open-paren" grammar a recipe uses to instantiate a
   * parametric drawing (ADR-0067) — and evaluates each argument as a
   * recipe-language literal against `entry`'s module scope (no name
   * resolution, arithmetic, or nested calls; {@link assertLiteralArg}).
   * `argsText` includes its surrounding parens, e.g. `(#c04040, 3)`. Used
   * only by {@link renderFragment}.
   */
  #evalFragmentArgs(entry: DefinitionEntry, name: string, argsText: string): Value[] {
    const file = entry.module.displayPath
    const expr = parseStandaloneExpr(`${name}${argsText}`, file)
    if (expr.kind !== 'call') {
      throw error(
        ERROR_CODE.syntax,
        'malformed render arguments',
        file,
        expr.span,
        'use render <file>#<drawing>(arg, arg, …)',
      )
    }
    const state: State = { module: entry.module, budget: this.budget, draw: null, functionDepth: 0 }
    return expr.args.map((arg) => {
      if (arg.kind !== 'expression') {
        throw error(
          ERROR_CODE.syntax,
          `keyword argument '${arg.keyword}' is not valid in render arguments`,
          file,
          arg.span,
        )
      }
      assertLiteralArg(arg.expression, file)
      return this.evalExpr(arg.expression, entry.module.env, state)
    })
  }

  /**
   * Renders the CLI `render file#draw(args)` fragment's target (ADR-0067).
   * `argsText` is the exact `(...)` substring from the CLI target string —
   * including its parens (e.g. `(#c04040, 3)`) — or `null` when the
   * fragment had no parens at all (today's zero-arg render). A count
   * mismatch against `entry`'s own parameters (no parens, empty parens, or
   * the wrong count) is E011 — same shape {@link renderDraw} already
   * throws for an in-recipe call — but carries a hint pointing at this
   * syntax, spelled out with the real parameter names, so a parametric
   * drawing never needs a throwaway wrapper `draw` just to preview.
   */
  renderFragment(
    entry: DefinitionEntry,
    name: string,
    argsText: string | null,
    span: TextSpan,
  ): Sprite {
    const args = argsText === null ? [] : this.#evalFragmentArgs(entry, name, argsText)
    const params = entry.kind === 'draw' ? (entry.definition.params ?? []) : []
    const expected = entry.kind === 'draw' ? params.length : 0
    if (args.length !== expected) {
      throw error(
        ERROR_CODE.arity,
        entry.kind === 'draw'
          ? `drawing '${name}' takes ${expected} argument(s), got ${args.length}`
          : `'${name}' takes ${expected} argument(s), got ${args.length}`,
        entry.module.displayPath,
        span,
        entry.kind === 'draw'
          ? `pass literal arguments: render <file>#${name}(${params.join(', ')})`
          : `'${name}' is not a parametric drawing`,
      )
    }
    return this.defToSprite(entry, span, args)
  }

  // ── expressions ───────────────────────────────────────────────────────

  #evalUnary(
    expr: Extract<Expression, { readonly kind: 'unary' }>,
    env: Environment,
    state: State,
  ): Value {
    const value = this.evalExpr(expr.operand, env, state)
    if (expr.operator === '-') {
      if (typeof value === 'number') {
        return -value
      }
      if (isPointValue(value)) {
        return point(-value.x, -value.y, value.rel)
      }
      throw error(
        ERROR_CODE.typeError,
        "unary '-' needs a number or point",
        state.module.displayPath,
        expr.span,
      )
    }
    return !truthy(value)
  }

  /**
   * Evaluate `target.index` (dot-index sugar). A bare tileset name gets a
   * fast path straight to its frame (`terrain.0`) without materializing
   * the whole sheet as a value first; everything else falls through to
   * generic {@link #indexValue} on the evaluated target.
   */
  #evalDotIndex(
    expr: Extract<Expression, { readonly kind: 'dotIndex' }>,
    env: Environment,
    state: State,
  ): Value {
    // tileset member? `terrain.0`
    if (expr.target.kind === 'name') {
      const entry = state.module.definitions.get(expr.target.name)
      if (entry?.kind === 'tileset') {
        const tv = this.buildTileset(entry, expr.span)
        const frame = tv.frames[expr.index]
        if (!frame) {
          throw error(
            ERROR_CODE.indexError,
            `tileset '${expr.target.name}' has no tile ${expr.index}`,
            state.module.displayPath,
            expr.span,
          )
        }
        return extractSubSprite(tv.sheet, frame, `${expr.target.name}.${expr.index}`)
      }
    }
    const obj = this.evalExpr(expr.target, env, state)
    return this.#indexValue(obj, expr.index, state, expr.span)
  }

  /**
   * The expression evaluator: advances the step budget, then dispatches
   * on `Expression` AST kind. This is the recursive core the rest of the
   * engine (statements, commands, path/font resolution) bottoms out into
   * for every value-producing subexpression.
   */
  evalExpr(expr: Expression, env: Environment, state: State): Value {
    this.step(expr.span, state.module.displayPath)
    switch (expr.kind) {
      case 'number':
        return expr.value
      case 'string':
        return expr.value
      case 'boolean':
        return expr.value
      case 'transparent':
        return TRANSPARENT
      case 'color': {
        const color = parseHexColor(expr.hex)
        if (!color) {
          throw error(
            ERROR_CODE.syntax,
            `invalid color literal '${expr.hex}'`,
            state.module.displayPath,
            expr.span,
          )
        }
        return color
      }
      case 'name':
        return this.#resolveName(expr.name, env, state, expr.span)
      case 'point': {
        const x = this.evalNumber(expr.x, env, state)
        const y = this.evalNumber(expr.y, env, state)
        return point(x, y)
      }
      case 'list':
        return list(expr.items.map((i) => this.evalExpr(i, env, state)))
      case 'range':
        return this.#evalRange(expr, env, state)
      case 'unary':
        return this.#evalUnary(expr, env, state)
      case 'binary':
        return this.#evalBin(expr, env, state)
      case 'ifExpression':
        return truthy(this.evalExpr(expr.condition, env, state))
          ? this.evalExpr(expr.thenExpression, env, state)
          : this.evalExpr(expr.elseExpression, env, state)
      case 'call':
        return this.#evalCall(expr, env, state)
      case 'index': {
        const obj = this.evalExpr(expr.target, env, state)
        const idx = this.evalExpr(expr.index, env, state)
        return this.#indexValue(obj, idx, state, expr.span)
      }
      case 'dotIndex':
        return this.#evalDotIndex(expr, env, state)
      case 'method': {
        const obj = this.evalExpr(expr.target, env, state)
        const args = (expr.args ?? []).map((a) => this.#evalArgValue(a, env, state))
        return this.callBuiltinOrFn(expr.name, [obj, ...args], state, expr.span)
      }
      default:
        throw error(
          ERROR_CODE.syntax,
          'unsupported expression',
          state.module.displayPath,
          (expr as Expression).span,
        )
    }
  }

  /**
   * Evaluate a `from..to` / `from..=to` range literal (ADR-0057: ranges
   * are eager list expressions, not a lazy iterator type) into a materialized
   * list. Each element counts against the step budget, so an unbounded or
   * huge range still terminates via E010 rather than exhausting memory
   * silently.
   */
  #evalRange(expr: Extract<Expression, { kind: 'range' }>, env: Environment, state: State): Value {
    const from = this.evalNumber(expr.from, env, state)
    const to = this.evalNumber(expr.to, env, state)
    const end = expr.inclusive ? to : to - 1
    const items: Value[] = []
    for (let i = from; i <= end; i++) {
      this.step(expr.span, state.module.displayPath)
      items.push(i)
    }
    return list(items)
  }

  /**
   * Evaluate `expr` and require it to be a number (E006 otherwise) — the
   * common case for coordinates, counts, and arithmetic operands.
   */
  evalNumber(expr: Expression, env: Environment, state: State): number {
    const value = this.evalExpr(expr, env, state)
    if (typeof value !== 'number') {
      throw error(
        ERROR_CODE.typeError,
        `expected a number, got ${typeName(value)}`,
        state.module.displayPath,
        expr.span,
      )
    }
    return value
  }

  /**
   * Resolve a bare name reference, in order: a scoped binding (env
   * chain), the `pi`/`tau` constants, a module-level definition
   * (instantiating non-parametric drawings/paths and building
   * tilesets/atlases/images on the fly), then a theme base drawing
   * (a drawing folded in via `use` but not locally redefined). Unresolved
   * names throw E001 with a did-you-mean suggestion ({@link suggest}) —
   * except `w`/`h` outside a draw body, which get a scope hint instead
   * (they're declared straight into the draw's environment, ADR-0021, so
   * a module-level `mask`/`path`/`fn` reaching for them is the single most
   * common shape of this error).
   */
  #resolveName(name: string, env: Environment, state: State, span: TextSpan): Value {
    const binding = env.lookup(name)
    if (binding) {
      return binding.value
    }
    if (name === 'pi') {
      return PI
    }
    if (name === 'tau') {
      return TAU
    }
    // theme gradients visible in draw scope handled via env; fall through to defs
    const entry = state.module.definitions.get(name)
    if (entry) {
      switch (entry.kind) {
        case 'draw':
          if (entry.definition.params && entry.definition.params.length > 0) {
            throw error(
              ERROR_CODE.arity,
              `drawing '${name}' is parametric — instantiate it: ${name}(…)`,
              state.module.displayPath,
              span,
            )
          }
          return this.renderDraw(entry, [], span)
        case 'path':
          if (entry.definition.params && entry.definition.params.length > 0) {
            throw error(
              ERROR_CODE.arity,
              `path '${name}' is parametric - instantiate it: ${name}(...)`,
              state.module.displayPath,
              span,
            )
          }
          return this.evalPath(entry, [], span)
        case 'tileset':
          return this.buildTileset(entry, span).sheet
        case 'atlas':
          return this.buildAtlas(entry, span).sheet
        case 'image':
          return this.#loadImage(entry)
        default:
          break
      }
    }
    // theme base drawings
    const themeDraw = state.draw?.theme.draws.get(name)
    if (themeDraw) {
      return this.renderDraw(
        { kind: 'draw', definition: themeDraw.definition, module: themeDraw.module },
        [],
        span,
      )
    }
    throw error(
      ERROR_CODE.unknownName,
      `unknown name '${name}'`,
      state.module.displayPath,
      span,
      !state.draw && (name === 'w' || name === 'h')
        ? 'w/h are the canvas size and only exist inside a draw body — move this into the draw, or pass the size in explicitly'
        : suggest(name, env, state),
    )
  }

  /**
   * Index a list value: the index must be an integer number (E015 for a
   * non-integer, with a floored-division hint — see ADR-0037) and
   * in-bounds (E015 otherwise); non-lists are not indexable (E006).
   */
  #indexValue(obj: Value, index: Value, state: State, span: TextSpan): Value {
    if (typeof index !== 'number') {
      throw error(
        ERROR_CODE.indexError,
        'an index must be a number',
        state.module.displayPath,
        span,
      )
    }

    if (!Number.isInteger(index)) {
      throw error(
        ERROR_CODE.indexError,
        `an index must be an integer, got ${index}`,
        state.module.displayPath,
        span,
        'use floored division: xs[i // n]',
      )
    }

    if (typeof obj !== 'object' || obj?.type !== 'list') {
      throw error(
        ERROR_CODE.typeError,
        `cannot index a ${typeName(obj)}`,
        state.module.displayPath,
        span,
      )
    }
    const value = obj.items[index]
    if (value === undefined) {
      throw error(
        ERROR_CODE.indexError,
        `index ${index} out of range (len ${obj.items.length})`,
        state.module.displayPath,
        span,
      )
    }
    return value
  }

  /**
   * Evaluate a binary expression. `&`/`|` short-circuit (right operand
   * only evaluated when needed); `==`/`!=` use structural {@link
   * valueEquals}; arithmetic ops delegate to {@link #applyArithmetic}
   * (numbers or points); comparisons require both operands to be numbers
   * (E006).
   */
  #evalBin(
    expr: Extract<Expression, { readonly kind: 'binary' }>,
    env: Environment,
    state: State,
  ): Value {
    const op = expr.operator
    if (op === '&') {
      return (
        truthy(this.evalExpr(expr.left, env, state)) &&
        truthy(this.evalExpr(expr.right, env, state))
      )
    }
    if (op === '|') {
      return (
        truthy(this.evalExpr(expr.left, env, state)) ||
        truthy(this.evalExpr(expr.right, env, state))
      )
    }
    const l = this.evalExpr(expr.left, env, state)
    const r = this.evalExpr(expr.right, env, state)
    if (op === '==') {
      return valueEquals(l, r)
    }
    if (op === '!=') {
      return !valueEquals(l, r)
    }
    if (['+', '-', '*', '/', '//', 'mod'].includes(op)) {
      return this.#applyArithmetic(op, l, r, state, expr.span)
    }
    if (['>', '<', '>=', '<='].includes(op)) {
      if (typeof l !== 'number' || typeof r !== 'number') {
        throw error(
          ERROR_CODE.typeError,
          `'${op}' needs numbers, got ${typeName(l)} and ${typeName(r)}`,
          state.module.displayPath,
          expr.span,
        )
      }
      switch (op) {
        case '>':
          return l > r
        case '<':
          return l < r
        case '>=':
          return l >= r
        default:
          return l <= r
      }
    }
    throw error(ERROR_CODE.syntax, `unknown operator '${op}'`, state.module.displayPath, expr.span)
  }

  /**
   * Apply an arithmetic op to number/point operands (ADR-0058 point
   * arithmetic): number-number is scalar math; if either side is a point,
   * the other is broadcast to a point and the op applies component-wise,
   * with the result `rel` if either input was. Any other operand
   * combination throws E006.
   */
  #applyArithmetic(op: string, l: Value, r: Value, state: State, span: TextSpan): Value {
    if (typeof l === 'number' && typeof r === 'number') {
      return applyNumberArithmetic(op, l, r)
    }
    if (isPointValue(l) || isPointValue(r)) {
      if (!isPointArithmeticOperand(l) || !isPointArithmeticOperand(r)) {
        throw error(
          ERROR_CODE.typeError,
          `'${op}' needs numbers or points, got ${typeName(l)} and ${typeName(r)}`,
          state.module.displayPath,
          span,
        )
      }
      const lp = isPointValue(l) ? l : point(l, l)
      const rp = isPointValue(r) ? r : point(r, r)
      return point(
        applyNumberArithmetic(op, lp.x, rp.x),
        applyNumberArithmetic(op, lp.y, rp.y),
        lp.rel || rp.rel,
      )
    }
    throw error(
      ERROR_CODE.typeError,
      `'${op}' needs numbers or points, got ${typeName(l)} and ${typeName(r)}`,
      state.module.displayPath,
      span,
    )
  }

  #evalArgValue(arg: Argument, env: Environment, state: State): Value {
    if (arg.kind === 'expression') {
      return this.evalExpr(arg.expression, env, state)
    }
    throw error(
      ERROR_CODE.syntax,
      `keyword argument '${arg.keyword}' is not valid here`,
      state.module.displayPath,
      arg.span,
    )
  }

  /**
   * Evaluate a call expression `name(args…)`. A drawing/path definition
   * not shadowed by a local binding is instantiated directly (parametric
   * drawing/path call); everything else goes through {@link
   * callBuiltinOrFn}'s user-fn-then-builtin dispatch.
   */
  #evalCall(
    expr: Extract<Expression, { readonly kind: 'call' }>,
    env: Environment,
    state: State,
  ): Value {
    if (expr.callee.kind !== 'name') {
      throw error(
        ERROR_CODE.syntax,
        'only named callees can be called',
        state.module.displayPath,
        expr.span,
      )
    }
    const name = expr.callee.name
    // profile's region form references its fn by bare NAME (no first-class fn values,
    // ADR-0076 §5), so its args can't be pre-evaluated like a normal shape callee.
    if (name === 'profile') {
      return this.#evalProfileRegion(expr, env, state)
    }
    // parametric drawing instantiation: key(r) where key is a draw def
    const entry = state.module.definitions.get(name)
    if (entry?.kind === 'draw' && !env.lookup(name)) {
      const args = expr.args.map((a) => this.#evalArgValue(a, env, state))
      return this.renderDraw(entry, args, expr.span)
    }
    if (entry?.kind === 'path' && !env.lookup(name)) {
      const args = expr.args.map((a) => this.#evalArgValue(a, env, state))
      return this.evalPath(entry, args, expr.span)
    }
    const args = expr.args.map((a) => this.#evalArgValue(a, env, state))
    return this.callBuiltinOrFn(name, args, state, expr.span)
  }

  /**
   * Central dispatcher: user fns, then builtins (with type-directed
   * dispatch for the shared names like `scale`/`shift`). A user `fn`
   * call gets a fresh environment seeded with the enclosing drawing's
   * palette (so fns can reference palette colors without them being
   * passed explicitly) and its own params; recursion past depth 512
   * throws E010. A bare drawing/path name found here (not caught by
   * {@link #evalCall}'s fast path) is instantiated with `args`.
   */
  callBuiltinOrFn(name: string, args: Value[], state: State, span: TextSpan): Value {
    const entry = state.module.definitions.get(name)
    if (entry?.kind === 'function') {
      if (args.length !== entry.params.length) {
        throw error(
          ERROR_CODE.arity,
          `fn '${name}' takes ${entry.params.length} argument(s), got ${args.length}`,
          state.module.displayPath,
          span,
        )
      }
      if (state.functionDepth > 512) {
        throw error(ERROR_CODE.budget, 'recursion too deep', state.module.displayPath, span)
      }
      const fnEnv = new Environment(entry.module.env)
      // palette entries of the current draw context stay visible inside fns
      if (state.draw) {
        for (const p of state.draw.theme.palette) {
          if (!fnEnv.has(p.key)) {
            fnEnv.declare(p.key, p.color, true, true)
          }
        }
      }
      entry.params.forEach((p, i) => {
        fnEnv.declare(p, args[i] ?? 0)
      })
      const inner: State = { ...state, functionDepth: state.functionDepth + 1 }
      return this.evalExpr(entry.body, fnEnv, inner)
    }
    if (entry?.kind === 'draw') {
      return this.renderDraw(entry, args, span)
    }
    if (entry?.kind === 'path') {
      return this.evalPath(entry, args, span)
    }
    return this.#callBuiltin(name, args, state, span)
  }

  // ── builtin functions (ADR-0015 unified call model) ────────────────────
  // Each `#builtinX` returns `undefined` for a name it doesn't own, so
  // `#callBuiltin` below tries them in a fixed priority order; `x`/`y`
  // (point accessors) live here alongside pure math (ADR-0034).

  #builtinMath(ctx: BuiltinContext): Value | undefined {
    switch (ctx.name) {
      case 'min':
        return Math.min(...ctx.args.map((_, i) => ctx.number(i)))
      case 'max':
        return Math.max(...ctx.args.map((_, i) => ctx.number(i)))
      case 'abs':
        ctx.arity(1)
        return Math.abs(ctx.number(0))
      case 'clamp':
        ctx.arity(3)
        return Math.max(ctx.number(1), Math.min(ctx.number(2), ctx.number(0)))
      case 'floor':
        ctx.arity(1)
        return Math.floor(ctx.number(0))
      case 'ceil':
        ctx.arity(1)
        return Math.ceil(ctx.number(0))
      case 'round':
        ctx.arity(1)
        return roundHalfUp(ctx.number(0))
      case 'sign':
        ctx.arity(1)
        return Math.sign(ctx.number(0))
      case 'sqrt':
        ctx.arity(1)
        return Math.sqrt(ctx.number(0))
      case 'hypot':
        ctx.arity(2)
        return dhypot(ctx.number(0), ctx.number(1))
      case 'dist': {
        ctx.arity(2)
        const a = ctx.point(0)
        const b = ctx.point(1)
        return dhypot(b.x - a.x, b.y - a.y)
      }
      case 'x':
        ctx.arity(1)
        return ctx.point(0).x
      case 'y':
        ctx.arity(1)
        return ctx.point(0).y
      case 'sin':
        ctx.arity(1)
        return dsin(ctx.number(0))
      case 'cos':
        ctx.arity(1)
        return dcos(ctx.number(0))
      case 'tan':
        ctx.arity(1)
        return dtan(ctx.number(0))
      case 'atan2':
        ctx.arity(2)
        return datan2(ctx.number(0), ctx.number(1))
      case 'pow':
        ctx.arity(2)
        return dpow(ctx.number(0), ctx.number(1))
      case 'exp':
        ctx.arity(1)
        return dexp(ctx.number(0))
      case 'log':
        ctx.arity(1)
        return dlog(ctx.number(0))
      case 'lerp':
        ctx.arity(3)
        return ctx.number(0) + (ctx.number(1) - ctx.number(0)) * ctx.number(2)
      case 'len': {
        ctx.arity(1)
        const v = ctx.args[0]
        if (typeof v === 'string') {
          return v.length
        }
        if (typeof v === 'object' && v !== null && v.type === 'list') {
          return v.items.length
        }
        throw error(ERROR_CODE.typeError, 'len needs a list or a string', ctx.file, ctx.span)
      }
      /**
       * `xs.cycle(i)` — sugar for `xs[i mod len(xs)]` (ADR-0079): auto-wraps
       * any integer index, including negative ones, into range via floored
       * modulo (the same wrap direction as `mod`/`//`, ADR-0037/0048), so
       * `xs.cycle(-1)` is the last element. An empty list is E015, same as a
       * plain out-of-range index.
       */
      case 'cycle': {
        ctx.arity(2)
        const v = ctx.args[0]
        if (typeof v !== 'object' || v === null || v.type !== 'list') {
          throw error(
            ERROR_CODE.typeError,
            `cycle needs a list, got ${typeName(v ?? 0)}`,
            ctx.file,
            ctx.span,
          )
        }
        const i = ctx.args[1]
        if (typeof i !== 'number') {
          throw error(ERROR_CODE.indexError, 'an index must be a number', ctx.file, ctx.span)
        }
        if (!Number.isInteger(i)) {
          throw error(
            ERROR_CODE.indexError,
            `an index must be an integer, got ${i}`,
            ctx.file,
            ctx.span,
            'use floored division: xs[i // n]',
          )
        }
        const n = v.items.length
        if (n === 0) {
          throw error(ERROR_CODE.indexError, 'cycle needs a non-empty list', ctx.file, ctx.span)
        }
        const wrapped = floorMod(i, n)
        const value = v.items[wrapped]
        if (value === undefined) {
          throw error(
            ERROR_CODE.indexError,
            `index ${wrapped} out of range (len ${n})`,
            ctx.file,
            ctx.span,
          )
        }
        return value
      }
      case 'rand':
        if (ctx.args.length === 1) {
          return rand(ctx.number(0))
        }
        ctx.arity(2)
        return rand(ctx.number(0), ctx.number(1))
      case 'noise':
        ctx.arity(3)
        return noise(ctx.number(0), ctx.number(1), ctx.number(2))
      default:
        return undefined
    }
  }

  /**
   * Color builtins (spec §12): construction, adjustment, and mixing. `mix`
   * and `mixes` accept a trailing bare `rgb`/`hsl`/`oklch` name to pick
   * the interpolation space (default `oklch`, ADR-0027); `mixes` produces
   * an evenly-spaced N-stop ramp.
   */
  #builtinColor(ctx: BuiltinContext): Value | undefined {
    const { name, args, number: num, color: col, arity, mixSpace: spaceArg } = ctx
    switch (name) {
      case 'rgb':
        if (args.length === 4) {
          return rgb(num(0), num(1), num(2), num(3) * 255)
        }
        arity(3)
        return rgb(num(0), num(1), num(2))
      case 'hsl':
        if (args.length === 4) {
          return hsl(num(0), num(1), num(2), num(3))
        }
        arity(3)
        return hsl(num(0), num(1), num(2))
      case 'oklch':
        if (args.length === 4) {
          return oklch(num(0), num(1), num(2), num(3))
        }
        arity(3)
        return oklch(num(0), num(1), num(2))
      case 'lighten':
        arity(2)
        return lighten(col(0), num(1))
      case 'darken':
        arity(2)
        return darken(col(0), num(1))
      case 'saturate':
        arity(2)
        return saturate(col(0), num(1))
      case 'desaturate':
        arity(2)
        return desaturate(col(0), num(1))
      case 'grayscale':
        arity(1)
        return grayscale(col(0))
      case 'hue': {
        arity(2)
        const a1 = args[1]
        if (typeof a1 === 'number') {
          return rotateHue(col(0), a1)
        }
        return rotateHue(col(0), col(1))
      }
      case 'alpha':
        arity(2)
        return withAlpha(col(0), num(1))
      case 'mix': {
        if (args.length === 4) {
          const space = spaceArg(3) ?? 'oklch'
          return mix(col(0), col(1), num(2), space)
        }
        arity(3)
        return mix(col(0), col(1), num(2))
      }
      // ADR-0086 §5 shading helpers. Intentionally NOT in BUILTIN_NAMES:
      // unlike `tones`/`mixes` they stay shadowable, because `ramp` is a
      // long-standing user binding name (ADR-0060/0079, many examples) and
      // reserving it would break existing recipes. UFCS/call dispatch reaches
      // them here via callBuiltinOrFn's builtin fallback regardless.
      case 'litTone':
        arity(3)
        return litTone(col(0), col(1), num(2))
      case 'shadowTone':
        if (args.length === 4) {
          return shadowTone(col(0), col(1), num(2), num(3))
        }
        arity(3)
        return shadowTone(col(0), col(1), num(2))
      case 'ramp': {
        arity(2)
        const count = num(1)
        if (!Number.isInteger(count) || count < 1) {
          throw error(
            ERROR_CODE.typeError,
            'ramp: count must be an integer >= 1',
            ctx.file,
            ctx.span,
          )
        }
        return list(ramp(col(0), count))
      }
      case 'tones': {
        if (args.length < 2) {
          throw error(ERROR_CODE.arity, 'tones takes at least 2 argument(s)', ctx.file, ctx.span)
        }
        const base = col(0)
        return list(
          args.slice(1).map((_, i) => {
            const amount = num(i + 1)
            if (amount < 0) {
              return darken(base, -amount)
            }
            if (amount > 0) {
              return lighten(base, amount)
            }
            return base
          }),
        )
      }
      case 'mixes': {
        let space: MixSpace = 'oklch'
        if (args.length === 4) {
          space = spaceArg(3) ?? 'oklch'
        } else {
          arity(3)
        }
        const count = num(2)
        if (!Number.isInteger(count) || count < 1) {
          throw error(
            ERROR_CODE.typeError,
            'mixes: count must be an integer >= 1',
            ctx.file,
            ctx.span,
          )
        }
        if (count === 1) {
          return list([col(0)])
        }
        return list(
          Array.from({ length: count }, (_, i) => mix(col(0), col(1), i / (count - 1), space)),
        )
      }
      default:
        return undefined
    }
  }

  /**
   * Parse one `linear`/`radial` gradient stop argument: a bare color (even
   * spacing) or a `(color, position)` pair (explicit stop position).
   */
  #parseGradStop(ctx: BuiltinContext, i: number, start: number): { c: Color; pos: number | null } {
    const v = ctx.args[i]
    if (typeof v === 'object' && v !== null && v.type === 'color') {
      return { c: v, pos: null }
    }
    if (typeof v === 'object' && v !== null && v.type === 'list' && v.items.length === 2) {
      const c = v.items[0]
      const p = v.items[1]
      if (typeof c === 'object' && c !== null && c.type === 'color' && typeof p === 'number') {
        return { c, pos: p }
      }
    }
    throw error(
      ERROR_CODE.typeError,
      `${ctx.name}: stop ${i - start + 1} must be a color or (color, position)`,
      ctx.file,
      ctx.span,
    )
  }

  /**
   * Handles `linear`/`radial` gradient construction (spec §12). `linear` takes a
   * leading angle argument; `radial` doesn't. Needs at least one stop
   * (E011).
   */
  #builtinGradient(ctx: BuiltinContext): Value | undefined {
    const { name, args, number: num, mixSpace: spaceArg, file, span } = ctx
    if (name !== 'linear' && name !== 'radial') {
      return undefined
    }
    const stops: { c: Color; pos: number | null }[] = []
    let space: MixSpace = 'oklch'
    const start = name === 'linear' ? 1 : 0
    const angle = name === 'linear' ? num(0) : 0
    for (let i = start; i < args.length; i++) {
      const sp = spaceArg(i)
      if (sp) {
        space = sp
        continue
      }
      stops.push(this.#parseGradStop(ctx, i, start))
    }
    if (stops.length < 1) {
      throw error(ERROR_CODE.arity, `${name} needs at least one stop`, file, span)
    }
    const g: Grad = { type: 'grad', kind: name, angle, stops, space }
    return g
  }

  /**
   * Shape-constructor builtins (spec §8/ADR-0036/ADR-0039): `region(x)`
   * additionally accepts a sprite or path and converts it to a region.
   */
  #builtinShape(ctx: BuiltinContext): Value | undefined {
    const { name, args, number: num, point: pt, arity, file, span } = ctx
    switch (name) {
      case 'circle': {
        arity(2)
        const c = pt(0)
        return circleRegion(quantInt(c.x), quantInt(c.y), num(1))
      }
      case 'rect': {
        arity(2)
        const a = pt(0)
        const b = pt(1)
        return rectRegion(quantInt(a.x), quantInt(a.y), quantInt(b.x), quantInt(b.y))
      }
      case 'rrect': {
        arity(3)
        const a = pt(0)
        const b = pt(1)
        return rrectRegion(quantInt(a.x), quantInt(a.y), quantInt(b.x), quantInt(b.y), num(2))
      }
      case 'ellipse': {
        arity(2)
        const c = pt(0)
        const r = pt(1) // rx:ry pair
        return ellipseRegion(quantInt(c.x), quantInt(c.y), r.x, r.y)
      }
      case 'poly': {
        const pts = args.map((_, i) => pt(i))
        return polyRegion(pts.map((p) => ({ x: quantInt(p.x), y: quantInt(p.y) })))
      }
      case 'curvePoly': {
        if (args.length < 3) {
          throw error(ERROR_CODE.arity, 'curvePoly needs at least three points', file, span)
        }
        return curvePolyRegion(args.map((_, i) => pt(i)))
      }
      case 'region': {
        arity(1)
        const v = args[0]
        if (typeof v === 'object' && v !== null && v.type === 'sprite') {
          return spriteRegion(v)
        }
        if (typeof v === 'object' && v !== null && v.type === 'region') {
          return v
        }
        if (typeof v === 'object' && v !== null && v.type === 'path') {
          return pathFillRegion(v)
        }
        throw error(ERROR_CODE.typeError, 'region(d) needs a drawing', file, span)
      }
      default:
        return undefined
    }
  }

  /**
   * Region-algebra builtins (ADR-0039): `union`/`intersect`/`subtract`/`xor`
   * operate on two regions, or on two paths (result re-wrapped as a path
   * sharing the first operand's viewBox) when both operands are paths.
   * `fill`/`stroke` here are the path→region converters used in
   * expression position (as opposed to the `fill`/`stroke` *commands*).
   */
  #builtinRegionOp(ctx: BuiltinContext): Value | undefined {
    const { name, path: pathArg, region: reg, arity } = ctx
    switch (name) {
      case 'union': {
        arity(2)
        if (ctx.isType(0, 'path') && ctx.isType(1, 'path')) {
          const a = pathArg(0)
          const b = pathArg(1)
          return pathFromRegion(regionUnion(pathFillRegion(a), pathFillRegion(b)), a.viewBox)
        }
        return regionUnion(reg(0), reg(1))
      }
      case 'intersect': {
        arity(2)
        if (ctx.isType(0, 'path') && ctx.isType(1, 'path')) {
          const a = pathArg(0)
          const b = pathArg(1)
          return pathFromRegion(regionIntersect(pathFillRegion(a), pathFillRegion(b)), a.viewBox)
        }
        return regionIntersect(reg(0), reg(1))
      }
      case 'subtract': {
        arity(2)
        if (ctx.isType(0, 'path') && ctx.isType(1, 'path')) {
          const a = pathArg(0)
          const b = pathArg(1)
          return pathFromRegion(regionSubtract(pathFillRegion(a), pathFillRegion(b)), a.viewBox)
        }
        return regionSubtract(reg(0), reg(1))
      }
      case 'xor': {
        arity(2)
        if (ctx.isType(0, 'path') && ctx.isType(1, 'path')) {
          const a = pathArg(0)
          const b = pathArg(1)
          return pathFromRegion(regionXor(pathFillRegion(a), pathFillRegion(b)), a.viewBox)
        }
        return regionXor(reg(0), reg(1))
      }
      case 'fill':
        arity(1)
        return pathFillRegion(pathArg(0))
      case 'stroke': {
        if (ctx.isType(0, 'path')) {
          const p = pathArg(0)
          const width = ctx.args.length === 1 ? 1 : ctx.number(1)
          if (ctx.args.length !== 1 && ctx.args.length !== 2) {
            throw error(
              ERROR_CODE.arity,
              `stroke takes 1 or 2 argument(s), got ${ctx.args.length}`,
              ctx.file,
              ctx.span,
            )
          }
          return pathStrokeRegion(p, width)
        }
        return undefined
      }
      default:
        return undefined
    }
  }

  // ── transforms (ADR-0044 first-class transforms) ───────────────────────
  // Each of rotate/skew/rotatex/rotatey/perspective shares this dispatch
  // shape: applied to a path or region it composes into that value's
  // matrix and immediately transforms it (E014 if the composed matrix
  // isn't invertible); applied bare or to a `transform` value it builds/
  // extends a standalone transform value instead.

  /**
   * Shared dispatch for the single-number transform builtins (`rotate`,
   * `skew`, `rotatex`, `rotatey`, `perspective`); `f` maps the numeric
   * argument to that transform's matrix.
   */
  #unaryTransform(ctx: BuiltinContext, f: (n: number) => number[]): Value {
    if (ctx.isType(0, 'path')) {
      ctx.arity(2)
      const matrix = f(ctx.number(1))
      const inverse = invertMatrix(matrix)
      if (!inverse) {
        throw error(ERROR_CODE.nonInvertible, 'transform is not invertible', ctx.file, ctx.span)
      }
      return pathTransform(ctx.path(0), matrix, inverse)
    }
    if (ctx.isType(0, 'transform')) {
      ctx.arity(2)
      return { type: 'transform', m: compose(ctx.transform(0).m, f(ctx.number(1))) }
    }
    ctx.arity(1)
    return { type: 'transform', m: f(ctx.number(0)) }
  }

  /**
   * Shared dispatch for the zero-argument transform builtins (`flipx`,
   * `flipy`); `base` is that flip's fixed matrix.
   */
  #flipTransform(ctx: BuiltinContext, base: number[]): Value {
    if (ctx.isType(0, 'path')) {
      ctx.arity(1)
      const inverse = invertMatrix(base)
      if (!inverse) {
        throw error(ERROR_CODE.nonInvertible, 'transform is not invertible', ctx.file, ctx.span)
      }
      return pathTransform(ctx.path(0), base, inverse)
    }
    if (ctx.args.length === 1 && ctx.isType(0, 'transform')) {
      return { type: 'transform', m: compose(ctx.transform(0).m, base) }
    }
    ctx.arity(0)
    return { type: 'transform', m: base }
  }

  /** The `shift` builtin: accepts a point or an `x, y` number pair. */
  #builtinShift(ctx: BuiltinContext): Value {
    if (ctx.isType(0, 'path')) {
      ctx.arity(2)
      const point = ctx.point(1)
      const matrix = translation(point.x, point.y)
      return pathTransform(ctx.path(0), matrix, translation(-point.x, -point.y))
    }
    if (ctx.isType(0, 'region')) {
      ctx.arity(2)
      const point = ctx.point(1)
      const matrix = translation(point.x, point.y)
      return regionTransform(ctx.region(0), matrix, translation(-point.x, -point.y))
    }
    if (ctx.isType(0, 'transform')) {
      ctx.arity(2)
      const point = ctx.point(1)
      return { type: 'transform', m: compose(ctx.transform(0).m, translation(point.x, point.y)) }
    }
    if (ctx.args.length === 2) {
      return { type: 'transform', m: translation(ctx.number(0), ctx.number(1)) }
    }
    ctx.arity(1)
    const point = ctx.point(0)
    return { type: 'transform', m: translation(point.x, point.y) }
  }

  /**
   * The `scale` builtin: accepts a uniform factor or separate `sx, sy` factors.
   * `scale(0)` on a path/region is non-invertible and throws E014.
   */
  #builtinScale(ctx: BuiltinContext): Value {
    if (ctx.isType(0, 'path')) {
      ctx.arity(2)
      const number = ctx.number(1)
      const matrix = scaling(number, number)
      const inverse = invertMatrix(matrix)
      if (!inverse) {
        throw error(ERROR_CODE.nonInvertible, 'scale(0) is not invertible', ctx.file, ctx.span)
      }
      return pathTransform(ctx.path(0), matrix, inverse)
    }
    if (ctx.isType(0, 'region')) {
      ctx.arity(2)
      const number = ctx.number(1)
      // corner-anchored so silhouette doubling is exact (ADR-0039/0043)
      const matrix = aboutPoint(scaling(number, number), -0.5, -0.5)
      const inverse = invertMatrix(matrix)
      if (!inverse) {
        throw error(ERROR_CODE.nonInvertible, 'scale(0) is not invertible', ctx.file, ctx.span)
      }
      return regionTransform(ctx.region(0), matrix, inverse)
    }
    if (ctx.isType(0, 'transform')) {
      if (ctx.args.length === 3) {
        return {
          type: 'transform',
          m: compose(ctx.transform(0).m, scaling(ctx.number(1), ctx.number(2))),
        }
      }
      ctx.arity(2)
      return {
        type: 'transform',
        m: compose(ctx.transform(0).m, scaling(ctx.number(1), ctx.number(1))),
      }
    }
    if (ctx.args.length === 2) {
      return { type: 'transform', m: scaling(ctx.number(0), ctx.number(1)) }
    }
    ctx.arity(1)
    return { type: 'transform', m: scaling(ctx.number(0), ctx.number(0)) }
  }

  /**
   * Dispatch table for all transform-family builtins, plus `matrix`
   * (6-value CSS-order 2D affine, or a full 16-value 4x4), `about`
   * (re-anchor a transform's origin), and `transform` (apply a
   * `transform` value to a path/region — E014 if non-invertible).
   */
  #builtinTransform(ctx: BuiltinContext): Value | undefined {
    switch (ctx.name) {
      case 'shift':
        return this.#builtinShift(ctx)
      case 'scale':
        return this.#builtinScale(ctx)
      case 'rotate':
        return this.#unaryTransform(ctx, rotationDeg)
      case 'skew':
        return this.#unaryTransform(ctx, skewX)
      case 'rotatex':
        return this.#unaryTransform(ctx, rotationXDeg)
      case 'rotatey':
        return this.#unaryTransform(ctx, rotationYDeg)
      case 'perspective':
        return this.#unaryTransform(ctx, perspectiveMatrix)
      case 'flipx':
        return this.#flipTransform(ctx, scaling(-1, 1))
      case 'flipy':
        return this.#flipTransform(ctx, scaling(1, -1))
      case 'matrix': {
        if (ctx.args.length === 6) {
          // 2D affine a b c d e f (CSS order)
          return {
            type: 'transform',
            m: [
              ctx.number(0),
              ctx.number(2),
              0,
              ctx.number(4),
              ctx.number(1),
              ctx.number(3),
              0,
              ctx.number(5),
              0,
              0,
              1,
              0,
              0,
              0,
              0,
              1,
            ],
          }
        }
        ctx.arity(16)
        return { type: 'transform', m: ctx.args.map((_, i) => ctx.number(i)) }
      }
      case 'about': {
        ctx.arity(2)
        const point = ctx.point(1)
        return { type: 'transform', m: aboutPoint(ctx.transform(0).m, point.x, point.y) }
      }
      case 'transform': {
        // region.transform(t) / path.transform(t)
        ctx.arity(2)
        const matrix = ctx.transform(1).m
        const inverse = invertMatrix(matrix)
        if (!inverse) {
          throw error(ERROR_CODE.nonInvertible, 'transform is not invertible', ctx.file, ctx.span)
        }
        if (ctx.isType(0, 'path')) {
          return pathTransform(ctx.path(0), matrix, inverse)
        }
        return regionTransform(ctx.region(0), matrix, inverse)
      }
      default:
        return undefined
    }
  }

  /**
   * The terminal builtin dispatcher: builds the {@link BuiltinContext}
   * argument-checking surface once, then tries each `#builtinX` group in
   * priority order (math, color, gradient, shape, region-op, transform)
   * until one claims `name`. E001 if none do.
   */
  #callBuiltin(name: string, args: Value[], state: State, span: TextSpan): Value {
    const file = state.module.displayPath
    const ctx: BuiltinContext = {
      name,
      args,
      state,
      span,
      file,
      number(index: number): number {
        const value = args[index]
        if (typeof value !== 'number') {
          throw error(
            ERROR_CODE.typeError,
            `${name}: argument ${index + 1} must be a number`,
            file,
            span,
          )
        }
        return value
      },
      color(index: number): Color {
        const value = args[index]
        if (typeof value !== 'object' || value?.type !== 'color') {
          throw error(
            ERROR_CODE.typeError,
            `${name}: argument ${index + 1} must be a color`,
            file,
            span,
          )
        }
        return value
      },
      point(index: number): Point {
        const value = args[index]
        if (typeof value !== 'object' || value?.type !== 'point') {
          throw error(
            ERROR_CODE.typeError,
            `${name}: argument ${index + 1} must be a point`,
            file,
            span,
          )
        }
        if (value.rel) {
          if (!state.draw) {
            throw error(ERROR_CODE.typeError, 'a relative point needs a drawing cursor', file, span)
          }
          return point(state.draw.cursor.x + value.x, state.draw.cursor.y + value.y)
        }
        return value
      },
      path(index: number): Path {
        const value = args[index]
        if (typeof value === 'object' && value !== null && value.type === 'path') {
          return value
        }
        throw error(
          ERROR_CODE.typeError,
          `${name}: argument ${index + 1} must be a path`,
          file,
          span,
        )
      },
      region(index: number): Region {
        const value = args[index]
        if (typeof value === 'object' && value !== null && value.type === 'region') {
          return value
        }
        if (typeof value === 'object' && value !== null && value.type === 'sprite') {
          return spriteRegion(value)
        }
        throw error(
          ERROR_CODE.typeError,
          `${name}: argument ${index + 1} must be a region`,
          file,
          span,
        )
      },
      transform(index: number): Transform {
        const value = args[index]
        if (typeof value !== 'object' || value?.type !== 'transform') {
          throw error(
            ERROR_CODE.typeError,
            `${name}: argument ${index + 1} must be a transform`,
            file,
            span,
          )
        }
        return value
      },
      arity(n: number): void {
        if (args.length !== n) {
          throw error(
            ERROR_CODE.arity,
            `${name} takes ${n} argument(s), got ${args.length}`,
            file,
            span,
          )
        }
      },
      isType(index: number, t: string): boolean {
        const value = args[index]
        return typeof value === 'object' && value !== null && value.type === t
      },
      /** A `rgb`/`hsl`/`oklch` string arg selects the mix space. */
      mixSpace(index: number): MixSpace | null {
        const value = args[index]
        if (typeof value === 'string' && ['rgb', 'hsl', 'oklch'].includes(value)) {
          return value as MixSpace
        }
        return null
      },
    }
    const result =
      this.#builtinMath(ctx) ??
      this.#builtinColor(ctx) ??
      this.#builtinGradient(ctx) ??
      this.#builtinShape(ctx) ??
      this.#builtinRegionOp(ctx) ??
      this.#builtinTransform(ctx)
    if (result !== undefined) {
      return result
    }
    throw error(ERROR_CODE.unknownName, `unknown function '${name}'`, file, span)
  }
}

// ── argument reader for commands ────────────────────────────────────────────

const FLAG_RE = /^(fill|flipx|flipy|w\d+|rot\d+(\.\d+)?|scale\d+)$/

/**
 * A consuming cursor over one command call's argument list (spec §8/§9's
 * positional-then-flags-then-keywords grammar, D4 contextual tokens).
 * Each `xyz()` reader evaluates the next expression argument and type-
 * checks it (E006 on mismatch); `peekFlag`/`peekKeyword` look ahead
 * without consuming so command handlers can loop over optional trailing
 * modifiers. {@link done} enforces that every argument was consumed
 * (E012 on leftovers), catching typos and misplaced flags.
 */
class Args {
  readonly #items: Argument[]
  readonly #engine: Engine
  readonly #env: Environment
  readonly #state: State
  readonly #span: TextSpan
  #index = 0

  constructor(engine: Engine, items: Argument[], env: Environment, state: State, span: TextSpan) {
    this.#engine = engine
    this.#items = items
    this.#env = env
    this.#state = state
    this.#span = span
  }

  empty(): boolean {
    return this.#index >= this.#items.length
  }

  #fail(msg: string): never {
    throw error(ERROR_CODE.arity, msg, this.#state.module.displayPath, this.#span)
  }

  #nextExpr(): Expression {
    const arg = this.#items[this.#index]
    if (arg?.kind !== 'expression') {
      return this.#fail('missing argument')
    }
    this.#index++
    return arg.expression
  }

  /** Peek: is the current arg a bare flag name (D4 contextual)? */
  peekFlag(): string | undefined {
    const arg = this.#items[this.#index]
    if (
      arg?.kind === 'expression' &&
      arg.expression.kind === 'name' &&
      FLAG_RE.test(arg.expression.name)
    ) {
      return arg.expression.name
    }
    return undefined
  }

  /** Consume the current bare-flag argument; callers pre-match it via {@link peekFlag}. */
  takeFlag(): void {
    this.#index++
  }

  peekKeyword(): string | null {
    const arg = this.#items[this.#index]
    return arg?.kind === 'keyword' ? arg.keyword : null
  }

  /**
   * Read the current keyword argument's first expression part. Callers pre-match
   * the keyword via {@link peekKeyword} and the parser guarantees at least one
   * part, so both are asserted structurally rather than re-checked.
   */
  keywordExpression(): Value {
    const arg = this.#items[this.#index] as Extract<Argument, { kind: 'keyword' }>
    this.#index++
    return this.#engine.evalExpr(arg.parts[0] as Expression, this.#env, this.#state)
  }

  keywordExpressions(keyword: string): Value[] {
    const arg = this.#items[this.#index]
    if (arg?.kind !== 'keyword' || arg.keyword !== keyword) {
      return this.#fail(`expected '${keyword}'`)
    }
    this.#index++
    return arg.parts.map((p) => this.#engine.evalExpr(p, this.#env, this.#state))
  }

  /** A `font small`-style kw whose payload is a bare name. */
  keywordName(keyword: string): string | null {
    const arg = this.#items[this.#index]
    if (arg?.kind === 'keyword' && arg.keyword === keyword) {
      this.#index++
      const part = arg.parts[0]
      if (part?.kind === 'name') {
        return part.name
      }
      return this.#fail(`'${keyword}' expects a name`)
    }
    return null
  }

  /** A raw name argument (not resolved as a value): `apply retro`. */
  rawName(): string {
    const arg = this.#items[this.#index]
    if (arg?.kind === 'expression' && arg.expression.kind === 'name') {
      this.#index++
      return arg.expression.name
    }
    return this.#fail('expected a name')
  }

  value(): Value {
    return this.#engine.evalExpr(this.#nextExpr(), this.#env, this.#state)
  }

  num(): number {
    const expr = this.#nextExpr()
    return this.#engine.evalNumber(expr, this.#env, this.#state)
  }

  string(): string {
    const expr = this.#nextExpr()
    const value = this.#engine.evalExpr(expr, this.#env, this.#state)
    if (typeof value !== 'string') {
      this.#fail('expected a string')
    }
    return value
  }

  /**
   * An absolute point argument. `_draw` is accepted but unused here —
   * relative (`rel`) points aren't valid in drawing commands at all (only
   * inside path definitions, ADR-0061), so there's no cursor to resolve
   * against; kept for call-site symmetry with other point-consuming call
   * sites that do need the cursor.
   */
  point(_draw: DrawState): { x: number; y: number } {
    const expr = this.#nextExpr()
    const value = this.#engine.evalExpr(expr, this.#env, this.#state)
    if (typeof value !== 'object' || value?.type !== 'point') {
      throw error(
        ERROR_CODE.typeError,
        `expected a point, got ${typeName(value)}`,
        this.#state.module.displayPath,
        expr.span,
      )
    }
    if (value.rel) {
      throw error(
        ERROR_CODE.typeError,
        "relative points are not allowed in drawing commands; use a path with 'rel'",
        this.#state.module.displayPath,
        expr.span,
      )
    }
    return { x: value.x, y: value.y }
  }

  /**
   * A non-relative point used as a magnitude pair (e.g. ellipse `rx:ry`,
   * shadow/rim offset) rather than a canvas coordinate — same shape as
   * {@link point} but framed for radii/offsets in error messages.
   */
  pair(): { readonly x: number; readonly y: number } {
    const expr = this.#nextExpr()
    const value = this.#engine.evalExpr(expr, this.#env, this.#state)
    if (typeof value !== 'object' || value?.type !== 'point' || value.rel) {
      throw error(
        ERROR_CODE.typeError,
        'expected a rx:ry pair',
        this.#state.module.displayPath,
        expr.span,
      )
    }
    return { x: value.x, y: value.y }
  }

  paint(): Paint {
    const expr = this.#nextExpr()
    const value = this.#engine.evalExpr(expr, this.#env, this.#state)
    if (
      typeof value === 'object' &&
      value !== null &&
      (value.type === 'color' || value.type === 'grad')
    ) {
      return value
    }
    throw error(
      ERROR_CODE.typeError,
      `expected a paint (color or gradient), got ${typeName(value)}`,
      this.#state.module.displayPath,
      expr.span,
    )
  }

  color(): Color {
    const expr = this.#nextExpr()
    const value = this.#engine.evalExpr(expr, this.#env, this.#state)
    if (typeof value === 'object' && value !== null && value.type === 'color') {
      return value
    }
    throw error(ERROR_CODE.typeError, 'expected a color', this.#state.module.displayPath, expr.span)
  }

  region(): Region {
    const expr = this.#nextExpr()
    const value = this.#engine.evalExpr(expr, this.#env, this.#state)
    if (typeof value === 'object' && value !== null && value.type === 'region') {
      return value
    }
    if (typeof value === 'object' && value !== null && value.type === 'sprite') {
      return spriteRegion(value)
    }
    throw error(
      ERROR_CODE.typeError,
      `expected a region, got ${typeName(value)}`,
      this.#state.module.displayPath,
      expr.span,
    )
  }

  sprite(): Sprite {
    const expr = this.#nextExpr()
    const value = this.#engine.evalExpr(expr, this.#env, this.#state)
    if (typeof value === 'object' && value !== null && value.type === 'sprite') {
      return value
    }
    throw error(
      ERROR_CODE.typeError,
      `expected a drawing, got ${typeName(value)}`,
      this.#state.module.displayPath,
      expr.span,
    )
  }

  /**
   * The leading paint of a region-constructor shape statement (§8,
   * ADR-0066). Absent or a non-paint first argument is the "region value
   * dropped" error — the shape's region has no eliminator to consume it.
   */
  drawPaint(span: TextSpan): Paint {
    const arg = this.#items[this.#index]
    if (arg?.kind === 'expression' && !this.peekFlag()) {
      const value = this.#engine.evalExpr(arg.expression, this.#env, this.#state)
      if (
        typeof value === 'object' &&
        value !== null &&
        (value.type === 'color' || value.type === 'grad')
      ) {
        this.#index++
        return value
      }
    }
    throw error(
      ERROR_CODE.regionDropped,
      'region value dropped — a shape statement needs a paint',
      this.#state.module.displayPath,
      span,
      'the paint is the first argument — add one, or use the call in expression position as a region',
    )
  }

  /** Trailing draw flags after paint+geometry: [fill] [wN] [cap …] [join …] (§8). */
  drawFlags(): { fill: boolean; width: number } {
    let fill = false
    let width = 1
    for (;;) {
      const flag = this.peekFlag()
      if (flag === 'fill') {
        this.takeFlag()
        fill = true
        continue
      }
      if (flag && /^w\d+$/.test(flag)) {
        this.takeFlag()
        width = Number.parseInt(flag.slice(1), 10)
        continue
      }
      if (this.peekKeyword() === 'cap' || this.peekKeyword() === 'join') {
        this.#index++ // accepted; round brush is the v1 behaviour in both modes
        continue
      }
      break
    }
    return { fill, width }
  }

  strokeFlags(): { width: number } {
    let width = 1
    for (;;) {
      const flag = this.peekFlag()
      if (flag && /^w\d+$/.test(flag)) {
        this.takeFlag()
        width = Number.parseInt(flag.slice(1), 10)
        continue
      }
      if (this.peekKeyword() === 'cap' || this.peekKeyword() === 'join') {
        this.#index++
        continue
      }
      break
    }
    return { width }
  }

  done(): void {
    if (!this.empty()) {
      const arg = this.#items[this.#index]
      let what = 'argument'
      if (arg?.kind === 'keyword') {
        what = arg.keyword
      } else if (arg?.kind === 'expression' && arg.expression.kind === 'name') {
        what = arg.expression.name
      }
      throw error(
        ERROR_CODE.badFlag,
        `unexpected extra argument '${what}'`,
        this.#state.module.displayPath,
        this.#span,
      )
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * A condition value: only booleans and non-zero numbers are truthy —
 * everything else (color, point, list, …) is a programmer error, not an
 * implicit falsy/truthy coercion, so it throws rather than returning
 * `false`.
 */
const truthy = (value: Value): boolean => {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  throw new Error(`a ${typeName(value)} is not a condition`)
}

const isPointValue = (value: Value): value is Point =>
  typeof value === 'object' && value !== null && value.type === 'point'

const isPointArithmeticOperand = (value: Value): value is number | Point =>
  typeof value === 'number' || isPointValue(value)

/**
 * Floored modulo (ADR-0037/0048): the result takes the sign of `r` and is
 * always in `[0, r)` for `r > 0` — the same wrap-positive semantics `xs.cycle(i)`
 * (ADR-0079) reuses for its auto-wrapping index.
 */
const floorMod = (l: number, r: number): number => l - Math.floor(l / r) * r

const applyNumberArithmetic = (op: string, l: number, r: number): number => {
  switch (op) {
    case '+':
      return l + r
    case '-':
      return l - r
    case '*':
      return l * r
    case '/':
      return l / r
    case '//':
      return Math.floor(l / r) // floored (ADR-0037)
    default:
      return floorMod(l, r)
  }
}

/**
 * Structural equality for object-shaped values, used by {@link valueEquals}.
 * Regions/sprites/transforms/paths/grads aren't comparable and fall
 * through to `false` (only color/point/list have `==` semantics in the
 * language).
 */
const objectValueEquals = (a: Extract<Value, object>, b: Extract<Value, object>): boolean => {
  if (a.type === 'color' && b.type === 'color') {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
  }
  if (a.type === 'point' && b.type === 'point') {
    return a.x === b.x && a.y === b.y && a.rel === b.rel
  }
  if (a.type === 'list' && b.type === 'list') {
    return (
      a.items.length === b.items.length && a.items.every((v, i) => valueEquals(v, b.items[i] ?? 0))
    )
  }
  return false
}

/**
 * The language's `==` semantics: structural equality for primitives,
 * colors, points (including `rel` flag), and lists (recursively);
 * mismatched types or non-comparable object kinds are never equal. Used
 * by `match` arm matching as well as the `==`/`!=` operators.
 */
export const valueEquals = (a: Value, b: Value): boolean => {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a === b
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return objectValueEquals(a, b)
  }
  return false
}

/**
 * A stable string encoding of a value for use in {@link renderDraw}'s
 * sprite-cache key — must distinguish any two values that would render
 * differently (unlike {@link valueEquals}, which only needs to compare;
 * non-primitive types other than color/point/list collapse to their bare
 * type tag since drawings can't currently take them as parameters).
 */
const valueKey = (value: Value): string => {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (value.type === 'color') {
    return `#${value.r},${value.g},${value.b},${value.a}`
  }
  if (value.type === 'point') {
    return `${value.x}:${value.y}`
  }
  if (value.type === 'list') {
    return `[${value.items.map(valueKey).join(',')}]`
  }
  return value.type
}

const spanKey = (s: TextSpan | undefined): string => (s ? `${s.line}:${s.column}` : '~')

/** A deterministic digest of a gradient's kind, angle, space, and stops. */
const gradFingerprint = (g: Grad): string =>
  `${g.kind}:${g.angle}:${g.space}:${g.stops
    .map((stop) => `${stop.c.r},${stop.c.g},${stop.c.b},${stop.c.a}@${stop.pos ?? '~'}`)
    .join('/')}`

/**
 * A deterministic, cheap digest of every rendering-relevant part of a folded
 * theme — palette, gradients, filters, base draws, style text, size, mode, and
 * font — used as part of {@link renderDraw}'s sprite-cache key. Two themes that
 * differ in any of these (down to a single gradient binding) must digest
 * differently, or a stale sprite could be served from the cache. Filters and
 * base draws are AST-backed, so they are keyed by name plus their defining
 * module file and source position — a stable identity within one engine — not
 * by serializing their bodies.
 */
const themeFingerprint = (t: FoldedTheme): string => {
  const pal = t.palette
    .map((p) => `${p.key}${p.color.r},${p.color.g},${p.color.b},${p.color.a}`)
    .join(';')
  const grads = [...t.gradients].map(([name, g]) => `${name}=${gradFingerprint(g)}`).join(';')
  const filters = [...t.filters]
    .map(([name, f]) => `${name}@${f.module.file}:${spanKey(f.body[0]?.span)}`)
    .join(';')
  const draws = [...t.draws]
    .map(([name, d]) => `${name}@${d.module.file}:${spanKey(d.definition.span)}`)
    .join(';')
  const style = t.style.map((s) => s.text).join('')
  const size = t.size ? `${t.size.width}x${t.size.height}` : ''
  return `${pal}|${t.mode ?? ''}|${t.font ?? ''}|${size}|G:${grads}|F:${filters}|D:${draws}|S:${style}`
}

/**
 * Merge several sprites' palette artifacts into one, deduped by color
 * (first occurrence wins, in `sprites` order) — used when building a
 * tileset/atlas sheet so its combined palette reflects its members'.
 */
const foldPalettes = (sprites: Sprite[]): { key: string; color: Color; source: string }[] => {
  const palette: { key: string; color: Color; source: string }[] = []
  const seen = new Set<string>()
  for (const sp of sprites) {
    for (const p of sp.pal) {
      const ck = `${p.color.r},${p.color.g},${p.color.b},${p.color.a}`
      if (seen.has(ck)) {
        continue
      }
      seen.add(ck)
      palette.push({ ...p, source: sp.name })
    }
  }
  return palette
}

/**
 * Crop a rectangular `frame` out of a larger sheet sprite into its own
 * standalone {@link Sprite}, copying pixel data (not a view) and carrying
 * the sheet's full palette along — used to pull individual tiles/atlas
 * frames out for indexed access (e.g. `terrain.0`).
 */
export const extractSubSprite = (
  sheet: Sprite,
  frame: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  },
  name: string,
): Sprite => {
  const data = new Uint8Array(frame.width * frame.height * 4)
  for (let y = 0; y < frame.height; y++) {
    const src = ((frame.y + y) * sheet.w + frame.x) * 4
    data.set(sheet.data.subarray(src, src + frame.width * 4), y * frame.width * 4)
  }
  return {
    type: 'sprite',
    name,
    w: frame.width,
    h: frame.height,
    data,
    pal: sheet.pal,
    title: undefined,
    desc: undefined,
  }
}

/**
 * Compose two folded themes, `b` layered over `a` (ADR-0005 fold order —
 * `b` is the later `with`/`use` source). Palette entries and style lines
 * are merged by key/text with `b` overriding on collision; gradients/
 * filters/draws are unioned as maps (`b` wins on same-key collision via
 * `Map` spread order); scalar fields (`size`/`mode`/`font`) take `b`'s
 * value only if it's set, otherwise fall back to `a`'s.
 */
const mergeThemes = (a: FoldedTheme, b: FoldedTheme): FoldedTheme => {
  const pal = a.palette.slice()
  for (const p of b.palette) {
    const i = pal.findIndex((q) => q.key === p.key)
    if (i >= 0) {
      pal[i] = p
    } else {
      pal.push(p)
    }
  }
  const style = a.style.slice()
  for (const f of b.style) {
    if (!style.some((g) => g.text === f.text)) {
      style.push(f)
    }
  }
  return {
    palette: pal,
    gradients: new Map([...a.gradients, ...b.gradients]),
    filters: new Map([...a.filters, ...b.filters]),
    draws: new Map([...a.draws, ...b.draws]),
    size: b.size ?? a.size,
    mode: b.mode ?? a.mode,
    font: b.font ?? a.font,
    style,
  }
}

/**
 * A "did you mean '…'?" hint for an unknown-name error: nearest visible
 * candidate (scope chain + module definitions) within edit distance 2,
 * or `undefined` if nothing is close enough to be a plausible typo.
 */
const suggest = (name: string, env: Environment, state: State): string | undefined => {
  const candidates = new Set<string>()
  for (let e: Environment | null = env; e; e = e.parent) {
    for (const k of e.entries().keys()) {
      candidates.add(k)
    }
  }
  for (const k of state.module.definitions.keys()) {
    candidates.add(k)
  }
  let best: string | null = null
  let bestD = 3
  for (const c of candidates) {
    const d = editDistance(name, c)
    if (d < bestD) {
      bestD = d
      best = c
    }
  }
  return best ? `did you mean '${best}'?` : undefined
}

/**
 * Levenshtein edit distance, short-circuited to a large sentinel when the
 * length difference alone rules out a close match (cheap pre-filter for
 * {@link suggest} scanning every visible name).
 */
const editDistance = (a: string, b: string): number => {
  if (Math.abs(a.length - b.length) > 2) {
    return 99
  }
  const dp: number[] = []
  for (let j = 0; j <= b.length; j++) {
    dp[j] = j
  }
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0] ?? 0
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = dp[j] ?? 0
      dp[j] = Math.min(t + 1, (dp[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return dp[b.length] ?? 0
}
