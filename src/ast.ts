// AST for the Recipe language (spec §17.4).

import type { TextSpan } from './diagnostic.js'

/**
 * Expression grammar (spec §17.4 `expr`). Every node carries a `span` for
 * positioned diagnostics. `operator` fields are plain `string`s rather than
 * literal unions because the parser's precedence-climbing methods (see
 * parser.ts) already constrain which operator each one can produce.
 */
export type Expression =
  | { readonly kind: 'number'; readonly value: number; readonly span: TextSpan }
  | { readonly kind: 'string'; readonly value: string; readonly span: TextSpan }
  | { readonly kind: 'boolean'; readonly value: boolean; readonly span: TextSpan }
  | { readonly kind: 'color'; readonly hex: string; readonly span: TextSpan }
  | { readonly kind: 'transparent'; readonly span: TextSpan }
  | { readonly kind: 'name'; readonly name: string; readonly span: TextSpan }
  | {
      readonly kind: 'point'
      readonly x: Expression
      readonly y: Expression
      readonly span: TextSpan
    }
  | { readonly kind: 'list'; readonly items: Expression[]; readonly span: TextSpan }
  | {
      /**
       * A `from..to` (half-open) or `from..=to` (inclusive) range. A first-class
       * list expression, not loop-only syntax (ADR-0057) — evaluates to
       * the same value as the equivalent literal list.
       */
      readonly kind: 'range'
      readonly from: Expression
      readonly to: Expression
      readonly inclusive: boolean
      readonly span: TextSpan
    }
  | {
      readonly kind: 'unary'
      readonly operator: '-' | '!'
      readonly operand: Expression
      readonly span: TextSpan
    }
  | {
      readonly kind: 'binary'
      readonly operator: string
      readonly left: Expression
      readonly right: Expression
      readonly span: TextSpan
    }
  | {
      /**
       * An `if cond then a else b` expression. Both branches are mandatory (unlike the
       * `if` statement, which has an optional `else` block).
       */
      readonly kind: 'ifExpression'
      readonly condition: Expression
      readonly thenExpression: Expression
      readonly elseExpression: Expression
      readonly span: TextSpan
    }
  | {
      /**
       * A `callee(args)` call (D6). `args` reuses the command's keyword-argument
       * shape (D2), not a plain expression list — parenthesized calls in
       * expression position accept `transform t`-style arguments too.
       */
      readonly kind: 'call'
      readonly callee: Expression
      readonly args: Argument[]
      readonly span: TextSpan
    }
  | {
      /** A `target[index]` expression — bracket index, any expression. */
      readonly kind: 'index'
      readonly target: Expression
      readonly index: Expression
      readonly span: TextSpan
    }
  | {
      /**
       * A `target.N` expression — tuple index by integer literal (D8). Distinguished
       * from `method` by what follows the dot: a number is always an
       * index, never a float (`xs.0.1` is `xs[0][1]`).
       */
      readonly kind: 'dotIndex'
      readonly target: Expression
      readonly index: number
      readonly span: TextSpan
    }
  | {
      /**
       * A `target.name` or `target.name(args)` expression — UFCS call, `x.f(a)` sugar
       * for `f(x, a)` (ADR-0010, D8). `args` is `undefined` for the bare,
       * parenless zero-argument form (`c.grayscale`) and an array
       * (possibly empty) for an explicit parenthesized call
       * (`c.grayscale()`); both mean the same thing to the evaluator.
       */
      readonly kind: 'method'
      readonly target: Expression
      readonly name: string
      readonly args: Argument[] | undefined
      readonly span: TextSpan
    }

/**
 * A call argument: an expression, or a keyword-prefixed sequence forming one
 * argument (D2): `transform t`, `tint k 0.3`, `mask m`, `font small`,
 * `cap round`, `join bevel`, `mode smooth`, `sha256 hex`.
 */
export type Argument =
  | { readonly kind: 'expression'; readonly expression: Expression; readonly span: TextSpan }
  | {
      readonly kind: 'keyword'
      readonly keyword: string
      readonly parts: Expression[]
      readonly span: TextSpan
    }

/**
 * One `pal` line (spec §7). `entry` binds a single key (`k = #235`);
 * `destructure` binds several keys positionally from one list-valued
 * expression (`r, g, b = rgb`) — evaluation requires the list length to
 * match `keys.length`, one key per list item, all colors.
 */
export type PaletteEntry =
  | {
      readonly kind: 'entry'
      readonly key: string
      readonly expression: Expression
      readonly span: TextSpan
    }
  | {
      readonly kind: 'destructure'
      readonly keys: readonly string[]
      readonly expression: Expression
      readonly span: TextSpan
    }

/**
 * One row of a `pixels:` block. `text` is the literal run of pixel keys
 * (each an ASCII letter naming a palette entry) and `.` cells (transparent,
 * spec §7, ADR-0049) — never expanded or validated at parse time.
 */
export type PixelRow = { readonly text: string; readonly span: TextSpan }

/** The dose-override keys a `material NAME = …` binding may carry (ADR-0091). */
export const MATERIAL_OVERRIDE_KEYS = [
  'shade',
  'hi',
  'rim',
  'ao',
  'spec',
  'puff',
  'spread',
] as const
export type MaterialOverrideKey = (typeof MATERIAL_OVERRIDE_KEYS)[number]
/** A partial map of material dose overrides → their (percent/`0..1`) value expressions (ADR-0091). */
export type MaterialOverrides = Partial<Record<MaterialOverrideKey, Expression>>

/**
 * Statement grammar (spec §17.4 `draw-stmt` / `top-stmt`). Covers module-,
 * theme-, and drawing-level statements in one union; which kinds are legal
 * in a given position is enforced by the parser's call site, not by this
 * type.
 */
export type Statement =
  | {
      /**
       * A `names = expr` binding (plain, incl. destructuring), `grad NAME = expr`, or
       * `mask NAME = expr`. `bindKind` records which keyword form produced
       * the binding — `grad`/`mask` bindings still carry a single name in
       * `names`.
       */
      readonly kind: 'binding'
      readonly names: string[]
      readonly expression: Expression
      readonly bindKind: 'plain' | 'grad' | 'mask'
      readonly span: TextSpan
    }
  | {
      /**
       * A `name += expr` statement and friends (`-=`, `*=`, `/=`); single-target only,
       * unlike `binding`.
       */
      readonly kind: 'compound'
      readonly name: string
      readonly operator: string
      readonly expression: Expression
      readonly span: TextSpan
    }
  | {
      /**
       * A drawing command or filter command in either surface —
       * command-form (`callee arg arg`) or paren-form (`callee(a, b)`),
       * interchangeably (ADR-0015). `callee` is always a bare name here,
       * unlike the expression `call` kind.
       */
      readonly kind: 'call'
      readonly callee: string
      readonly args: Argument[]
      readonly span: TextSpan
    }
  | {
      readonly kind: 'if'
      readonly condition: Expression
      readonly thenStatement: Statement[]
      readonly elseStatement: Statement[] | undefined
      readonly span: TextSpan
    }
  | {
      readonly kind: 'match'
      readonly subject: Expression
      readonly arms: MatchArm[]
      readonly span: TextSpan
    }
  | {
      readonly kind: 'for'
      readonly target: string
      readonly iterable: Expression
      readonly body: Statement[]
      readonly span: TextSpan
    }
  | {
      /**
       * A `scatter NAME count seed region:` block (ADR-0077): runs `body` `count`
       * times with `target` bound to a seeded point drawn uniformly from
       * `region`'s pixels. The header mirrors `for` — keyword, binding name, then
       * positional operands (count, seed, region), then the block.
       */
      readonly kind: 'scatter'
      readonly target: string
      readonly count: Expression
      readonly seed: Expression
      readonly region: Expression
      readonly body: Statement[]
      readonly span: TextSpan
    }
  | {
      /**
       * A `mirror x=<n>:` / `mirror y=<n>:` block (ADR-0078): runs `body` once
       * normally, then again reflected across the axis at `at` (`px → 2n − px` for
       * `x`, `py → 2n − py` for `y`). Axis pixels paint once.
       */
      readonly kind: 'mirror'
      readonly axis: 'x' | 'y'
      readonly at: Expression
      readonly body: Statement[]
      readonly span: TextSpan
    }
  | {
      /**
       * A `mask expr: body` block — clips `body`'s drawing to a region (`expr`
       * must evaluate to a Region, checked at eval time).
       */
      readonly kind: 'maskBlock'
      readonly expression: Expression
      readonly body: Statement[]
      readonly span: TextSpan
    }
  | {
      /**
       * A `light NAME = dir DX:DY COLOR [amb COOL AMT] [gain N]` (directional) or
       * `light NAME = at X:Y COLOR …` (point-source) binding (ADR-0086): inline args,
       * no constructor parentheses. `dir`/`at`/`amb`/`gain` are keywords *only* in
       * this position (contextual, D7) — ordinary bindable names everywhere else.
       */
      readonly kind: 'lightBinding'
      readonly name: string
      readonly source: 'dir' | 'at'
      readonly vec: Expression
      readonly color: Expression
      readonly amb: { readonly color: Expression; readonly amount: Expression } | undefined
      readonly gain: Expression | undefined
      readonly span: TextSpan
    }
  | {
      /**
       * A `material NAME = COLOR [RESPONSE]` binding (ADR-0086): a base colour plus an
       * optional response word (`flat|metal|skin|cloth|glass|glow`; omitted ⇒ `flat`).
       * The response is a keyword *only* in this slot (contextual, D7); validated at
       * parse time so `response` is always a real {@link import('./values.js').MaterialResponse}.
       */
      readonly kind: 'materialBinding'
      readonly name: string
      readonly color: Expression
      readonly response: string | undefined
      /**
       * Optional form profile (`round`|`drape`, ADR-0091): how the height field inflates the region.
       * A contextual keyword in this trailing slot only (`omitted ⇒ round`); validated at parse time.
       */
      readonly profile: string | undefined
      /**
       * Optional trailing dose overrides (ADR-0091), order-free keywords in this slot only:
       * `shade`/`hi`/`rim`/`ao`/`spec` replace a response's baked dose; `puff` its curvature gain;
       * `spread` scales `hi`+`shade` symmetrically. Each value is a `0..1`/percent expression.
       */
      readonly overrides: MaterialOverrides
      readonly span: TextSpan
    }
  | {
      /**
       * A `pin KEY PT` attach-point declaration (ADR-0087): registers a named point `KEY` in the
       * enclosing drawing's own coordinate space. `KEY` is a bare name in a part draw
       * (`pin shoulder 4:0`, exported on the rendered sprite) or a dotted `part.name`
       * (`pin torso.shoulder 16:14`) that seeds a canvas-space attach point for `fit`. `pin` is a
       * keyword *only* in this `pin NAME …` statement position (contextual, D7).
       */
      readonly kind: 'pinDeclaration'
      readonly name: string
      readonly point: Expression
      readonly span: TextSpan
    }
  | {
      /**
       * A `fit TARGET SOURCE [flags] [shadow]` anchored-assembly placement (ADR-0087): places
       * `TARGET`'s part so its named pin lands exactly on `SOURCE` — a contact-guaranteed replacement
       * for a hand-computed `stamp` point. `target` names the part (a bare name resolving to a drawing/
       * sprite) and its pin (`undefined` ⇒ auto-match the single pin name shared with the source).
       * `source` is either another placed part's already-registered pin (`ref`) or a canvas point
       * expression (`point` — the ground-placement oracle: `fit tree.base x:groundY(x)`). `flags` are
       * the same `stamp` transform/paint modifiers (`flipx`/`flipy`/`rotN`/`scaleN`/`transform:`/
       * `tint:`/`mask:`), applied to the part about its footprint centre; the pins ride the same
       * transform so the fit pin still lands exactly on `SOURCE` (ADR-0087 amendment 2). `shadow`
       * drops an auto contact-shadow ellipse under the footprint first. `fit` is a keyword *only* in
       * this statement position (contextual, D7).
       */
      readonly kind: 'fit'
      readonly target: { readonly head: string; readonly pin: string | undefined }
      readonly source:
        | { readonly kind: 'ref'; readonly head: string; readonly pin: string | undefined }
        | { readonly kind: 'point'; readonly expression: Expression }
      readonly flags: Argument[]
      readonly shadow: boolean
      /**
       * Optional occlusion relations (ADR-0092): `behind TARGET` layers this part below the
       * already-placed part `TARGET` in the resolved paint order; `front TARGET` layers it above.
       * `TARGET` is a bare part-name (a `head` of an earlier top-level `stamp`/`fit`). Contextual
       * keywords in this trailing slot only. Both may repeat; ties break by statement order, a cycle
       * is a positioned E025.
       */
      readonly behind: readonly string[]
      readonly front: readonly string[]
      /**
       * Optional 1-bone orientation solve (ADR-0092): `aim PIN PT` rotates the part about its fit
       * pin until the named second pin `PIN` points at the canvas point `PT` (atan2). Contextual
       * keyword in this trailing slot only.
       */
      readonly aim: { readonly pin: string; readonly point: Expression } | undefined
      readonly span: TextSpan
    }
  | { readonly kind: 'palette'; readonly entries: PaletteEntry[]; readonly span: TextSpan }
  | { readonly kind: 'pixels'; readonly rows: PixelRow[]; readonly span: TextSpan }
  | {
      readonly kind: 'meta'
      readonly which: 'title' | 'desc'
      readonly value: string
      readonly span: TextSpan
    }
  | {
      /**
       * A `use [MODULE-PATH] NAME` statement — applies a theme. Two tokens (`module`
       * present) means an imported theme; one token (`module` is
       * `undefined`) means a locally-defined one (spec §12). Drawing-level
       * `use` must lead the body — enforced by `#parseDraw`, not by this
       * type.
       */
      readonly kind: 'use'
      readonly module: string | undefined
      readonly name: string
      readonly span: TextSpan
    }
  | {
      readonly kind: 'sizeDirective'
      readonly width: number
      readonly height: number
      readonly span: TextSpan
    }
  | { readonly kind: 'seedDirective'; readonly seed: number; readonly span: TextSpan }
  | { readonly kind: 'fontDirective'; readonly name: string; readonly span: TextSpan }
  | { readonly kind: 'modeDirective'; readonly mode: 'pixel' | 'smooth'; readonly span: TextSpan }
  | { readonly kind: 'with'; readonly names: string[]; readonly span: TextSpan }
  | { readonly kind: 'style'; readonly text: string; readonly span: TextSpan }
  | { readonly kind: 'apply'; readonly name: string; readonly span: TextSpan }
  | {
      readonly kind: 'functionDefinition'
      readonly name: string
      readonly params: string[]
      readonly body: Expression
      readonly span: TextSpan
    }
  | {
      /**
       * A `filter NAME: body` definition. `body` holds `call`-kind statements only —
       * the parser rejects any other statement kind with a positioned
       * E004 (`#parseFilterDef`).
       */
      readonly kind: 'filterDefinition'
      readonly name: string
      readonly body: Statement[]
      readonly span: TextSpan
    }
  | { readonly kind: 'pathDefinition'; readonly def: PathDefinition; readonly span: TextSpan }
  | { readonly kind: 'drawDefinition'; readonly def: DrawDefinition; readonly span: TextSpan }
  | { readonly kind: 'themeDefinition'; readonly def: ThemeDefinition; readonly span: TextSpan }
  | { readonly kind: 'fontDefinition'; readonly def: FontDefinition; readonly span: TextSpan }
  | { readonly kind: 'tilesetDefinition'; readonly def: TilesetDefinition; readonly span: TextSpan }
  | { readonly kind: 'atlasDefinition'; readonly def: AtlasDefinition; readonly span: TextSpan }
  | { readonly kind: 'exportDefinition'; readonly def: ExportDefinition; readonly span: TextSpan }
  | {
      /**
       * An `import NAME = FILE-PATH [sha256 HEX]` statement — a PNG loaded as a
       * drawing. `sha256`, if present, pins the source file's content
       * hash (checked at build time, E020 on mismatch).
       */
      readonly kind: 'imageImport'
      readonly name: string
      readonly path: string
      readonly sha256: string | undefined
      readonly span: TextSpan
    }
  | {
      /**
       * A `from MODULE-PATH item, item as alias, …` import — always module-qualified,
       * unlike `use`.
       */
      readonly kind: 'import'
      readonly module: string
      readonly items: { readonly name: string; readonly alias: string | undefined }[]
      readonly span: TextSpan
    }

/**
 * One `match` arm. `label` is `undefined` for the catch-all `else:` arm;
 * otherwise it is the arm's expression, which ends at the first depth-0
 * `:` on the line (D3) — parenthesize a point label (`(0:0): …`).
 */
export type MatchArm = {
  readonly label: Expression | undefined
  readonly body: Statement[]
  readonly span: TextSpan
}

export type DrawDefinition = {
  readonly name: string
  readonly params: string[] | undefined
  readonly size: { readonly width: number; readonly height: number } | undefined
  readonly body: Statement[]
  readonly span: TextSpan
}

export type ThemeDefinition = {
  readonly name: string
  readonly items: Statement[]
  readonly span: TextSpan
}

/**
 * Path pen commands (spec §17.4 `path-cmd`), legal only inside a `path`
 * block — the only place the language has a cursor (ADR-0061). The
 * `…Relative` flags record a `rel` keyword before the corresponding
 * point/control argument (path-local relative motion, the only surviving
 * relative mechanism after ADR-0061 removed the `by` expression).
 */
export type PathCommand =
  | {
      readonly kind: 'move'
      readonly point: Expression
      readonly relative: boolean
      readonly span: TextSpan
    }
  | {
      readonly kind: 'line'
      readonly point: Expression
      readonly relative: boolean
      readonly span: TextSpan
    }
  | {
      readonly kind: 'quad'
      readonly control: Expression
      readonly point: Expression
      readonly controlRelative: boolean
      readonly pointRelative: boolean
      readonly span: TextSpan
    }
  | {
      readonly kind: 'bezier'
      readonly control1: Expression
      readonly control2: Expression
      readonly point: Expression
      readonly control1Relative: boolean
      readonly control2Relative: boolean
      readonly pointRelative: boolean
      readonly span: TextSpan
    }
  | {
      /**
       * An `arc <end> around <center> cw|ccw` command. Only `point` (the end point)
       * can be relative — `center` is always absolute.
       */
      readonly kind: 'arc'
      readonly point: Expression
      readonly center: Expression
      readonly clockwise: boolean
      readonly pointRelative: boolean
      readonly span: TextSpan
    }
  | { readonly kind: 'close'; readonly span: TextSpan }

/**
 * A `path NAME [(params)] [SIZE]: body` or `path NAME [(params)] = expr`
 * definition (spec §17.4 `path-def`). The two `body` forms are mutually exclusive:
 * `commands` for a pen-command block, `expression` for an alias or a
 * Path-valued boolean combination (`path badge = shield.subtract(notch)`).
 */
export type PathDefinition = {
  readonly name: string
  readonly params: string[] | undefined
  readonly size: { readonly width: number; readonly height: number } | undefined
  readonly body:
    | { readonly kind: 'commands'; readonly commands: PathCommand[] }
    | { readonly kind: 'expression'; readonly expression: Expression }
  readonly span: TextSpan
}

/** One item inside a `font NAME: body` block (spec §17.4 `font-item`). */
export type FontItem =
  | { readonly kind: 'with'; readonly name: string; readonly span: TextSpan }
  | {
      readonly kind: 'glyph'
      readonly char: string
      readonly drawing: string
      readonly span: TextSpan
    }
  | {
      /**
       * A `glyph STRING [SIZE]: body` item — a glyph defined inline instead of
       * referencing a named drawing.
       */
      readonly kind: 'inlineGlyph'
      readonly char: string
      readonly size: { readonly width: number; readonly height: number } | undefined
      readonly body: Statement[]
      readonly span: TextSpan
    }
  | {
      /**
       * A `glyphs TILESET STRING` item — bulk-assigns one tileset's tiles to the
       * characters of `chars`, positionally.
       */
      readonly kind: 'glyphs'
      readonly tileset: string
      readonly chars: string
      readonly span: TextSpan
    }
  | { readonly kind: 'tracking'; readonly value: number; readonly span: TextSpan }
  | { readonly kind: 'lineheight'; readonly value: number; readonly span: TextSpan }

export type FontDefinition = {
  readonly name: string
  readonly size: { readonly width: number; readonly height: number } | undefined
  readonly items: FontItem[]
  readonly span: TextSpan
}

export type TilesetDefinition = {
  readonly name: string
  readonly tileWidth: number
  readonly tileHeight: number
  readonly tiles: string[]
  readonly columns: number | undefined
  readonly span: TextSpan
}

export type AtlasDefinition = {
  readonly name: string
  readonly sprites: string[]
  readonly padding: number
  readonly place: { readonly name: string; readonly x: number; readonly y: number }[]
  readonly span: TextSpan
}

/**
 * One `export` format line (spec §17.4 `format-line`). Flags are order-free
 * and format-specific — `#parseFormatLine` accepts any of them and leaves
 * the ones a given `format` doesn't use at their default. The
 * non-`readonly` fields (`zlib`, `quality`, `indexed`, `tiledXml`, `mode`)
 * are filled in by mutating this object flag-by-flag while scanning the
 * line, unlike the rest of the AST, which is built bottom-up and frozen by
 * construction.
 */
export type FormatLine = {
  readonly format: 'png' | 'svg' | 'jpeg' | 'tiled' | 'atlasJson' | 'aseprite' | 'path'
  readonly scales: number[] // @N flags
  readonly sizes: { readonly width: number; readonly height: number | undefined }[] // 512 or 512x512
  zlib: number | undefined
  quality: number | undefined
  indexed: boolean
  readonly svgFlags: string[]
  tiledXml: boolean
  mode: 'pixel' | 'smooth' | undefined
  readonly span: TextSpan
}

export type ExportDefinition = {
  readonly name: string
  readonly basePath: string
  readonly formats: FormatLine[]
  readonly span: TextSpan
}

/**
 * The parsed form of one `.drw` file. `pragma` is the optional leading
 * `drawstic N` version pin (ADR-0029); `undefined` means "engine's current
 * version". `file` is the display path used in diagnostics, not
 * necessarily a filesystem path.
 */
export type Module = {
  readonly pragma: number | undefined
  readonly statements: Statement[]
  readonly file: string
}
