# Drawstic Recipe Language — Specification

> Status: **Draft for review.** This is the canonical reference for the Recipe DSL.
> Worked examples live in [dsl-examples.md](dsl-examples.md). Material decisions are
> recorded as ADRs in [decisions/](decisions/). Idiomatic authoring guidance lives in
> [best-practices.md](best-practices.md).

Drawstic Recipes describe drawings **deterministically** so that an LLM agent can
produce **visually consistent** icons, sprites, and graphics — and re-produce them
identically. A Recipe is compiled to an internal **framebuffer** (an integer pixel
grid + palette) and then materialized into PNG / SVG / JPEG. See
[ADR-0001](decisions/0001-framebuffer-first-core.md).

---

## 1. Design priorities

The language is authored primarily by LLMs. The **mantra**: make it **as token-efficient as
possible**, subject to two floors that must always hold — **just barely human-readable** (for
reviews) and **just barely perfectly editable/creatable by an LLM**. The four priorities:

1. **In-distribution** — forms the model already knows (`import`, ASCII pixel-art sprites,
   indented blocks, parenthesized function calls). *A **tiebreaker**, not a gate* — see the
   trade-off rule below.
2. **Error-robustness** — no load-bearing punctuation; a forgiving grammar; precise,
   positioned error messages over silent misparses.
3. **Self-verifiability** — a model can read its own output back and predict the
   result. Explicit coordinates over hidden cursor state.
4. **Token efficiency** — terse, once the floors hold.

**Trade-off rule** ([ADR-0018](decisions/0018-idiom-alone-does-not-justify-a-marker.md)).
The LLM-editability floor is guarded by **error-robustness (2) and self-verifiability (3)**,
not by familiarity — LLMs author dense, unusual syntax (Bash, RegEx, ASM) fine, but density
raises error rates unless every form is unambiguous and self-checking. So **token efficiency
(4) may override in-distribution (1), but never (2) or (3)**, and **idiom alone never
justifies a marker** — a marker is kept only if it resolves a real ambiguity or serves (2)/(3).
This is why `=` (a binding marker) and `:` (a block marker) stay while the `from`/`in`
connectors were dropped.

Two consequences that shape everything:

- **Declarative-first.** Pixel literals, palettes, stamps, and exports are pure
  declarations. Expressions (variables, loops, functions) are an *opt-in escape
  hatch* for parametric work — simple drawings stay simple. See [ADR-0002](decisions/0002-hybrid-primitives-and-indexed-palette.md).
- **Total, not Turing-complete.** Every Recipe is guaranteed to terminate, enforced
  by a runtime budget. See §15 and [ADR-0004](decisions/0004-total-not-turing-complete.md).

---

## 2. Files & modules

A `.drw` file is a **module**. Every top-level definition is **public** and importable —
there is no `export` keyword for visibility (the `export` keyword means something else;
see §13). A module's public surface is the set of `(name, type)` it defines:

| Type     | Declared by | Role |
|----------|-------------|------|
| `draw`   | `draw …:`   | a drawing (content). Stampable and/or exportable. |
| `path`   | `path …:` / `path … = …` | reusable vector geometry. Fillable, strokeable, mask-convertible, transformable, importable, and path-exportable (§8–§9, [ADR-0061](decisions/0061-first-class-paths-and-local-pen-cursors.md)). |
| `tileset`| `tileset …:`| equal-sized tiles baked into a grid, index-addressed (§9). |
| `atlas`  | `atlas …:`  | varied-sized sprites packed into one image, name-addressed (§9). |
| `theme`  | `theme …:`  | palette + style guide + shared parts (§12). |
| `fn`     | `fn …`      | a value-returning function (§10). |
| `grad`   | `grad …`    | a gradient paint value (§12). |
| `filter` | `filter …:` | a reusable post-process pipeline (§12). |
| `font`   | `font …:`   | a glyph mapping — characters → drawings (§8, [ADR-0042](decisions/0042-user-defined-fonts.md)). |
| `mask`   | `mask …`    | a coverage region for clipping (§9). |
| `import` | `import … = …` | an **external image** (PNG) as a drawing — stampable, transformable, exportable ([ADR-0045](decisions/0045-import-external-images-as-drawings.md)). |
| `export` | `export …:` | an output specification (§13). Leaf build target — not imported. |

```drw
# creatures.drw — a library module
draw gem 4x4:
  pixels:
    .yy.
    yrry
    yrry
    .yy.

draw slime 8x8:
  # …
```

```drw
# scene.drw — consumes the library
from creatures gem, slime
from gems gem as ruby                  # alias on name collision
from ../shared/parts eye               # parent dir via ../
use themes dusk                        # apply a theme to this file (§12)
```

- **`from <module> <names>`** brings names into scope; the type is inferred from the source.
  Source-first, so the module is the **first token** and position alone separates it from the
  names — no quotes, no connector ([ADR-0019](decisions/0019-source-first-module-references.md)).
- **`use` applies a theme, and its arity — not any keyword — picks local vs. imported**
  ([ADR-0019](decisions/0019-source-first-module-references.md), §12): `use <name>` (one
  token) is a **local** theme already in scope — defined in this file, or brought in earlier
  by a `from <module> <name>` line; `use <module-path> <name>` (two tokens) loads the theme
  directly from `<module-path>` with no preceding `from` needed. In `use themes dusk`, and
  everywhere else in this document, **`themes` is a bareword module path** (a sibling file
  `themes.drw`), not a keyword — the same slot bundled themes use as `use std/themes
  pixelBase`. A module path never doubles as a name: `use dusk` only works if `dusk` was
  defined or imported into the current module first.
- **The module is a bareword relative path**: `/`-separated, `.drw` implied, `./` optional,
  `..` for the parent dir (`from sub/mod a`, `from ../themes dusk`). Aliasing lives in the
  list: `from gems gem as ruby`.
- **Resolution is deterministic and sandboxed**: relative paths only, no network, no globs,
  and `..` may **not escape the project root** (positioned error). Import **cycles between
  modules are an error**, even though definitions *within* a module are order-independent
  (§10). See [ADR-0035](decisions/0035-import-sandbox-and-std-modules.md).
- **Bundled `std/` modules.** A small standard library of shared parts and themes ships under
  the reserved `std/` prefix (`from std/shapes arrow`, `use std/themes pixelBase`); it is
  resolved by the engine, always available, and version-pinned (below). `std/` is deliberately
  small: generic construction marks and base themes belong here; project palettes, domain
  style presets, and concrete motif packs belong in recipes, examples, or skills unless an
  ADR justifies making them core.
- **`export` elements are not importable** — they are build targets, not values.
- **External images** enter as definitions — `import logo = ../brand/logo.png` — binding a
  **PNG file** (exact, lossless decode; explicit extension) as an ordinary drawing under the
  same sandbox rules; an optional trailing `sha256 <hex>` pins the file's content
  (mismatch = positioned error). JPEG is rejected on import: its decoding is not bit-exact
  across platforms ([ADR-0045](decisions/0045-import-external-images-as-drawings.md)).

**Language version.** An optional first line `drawstic <N>` is still accepted for backward
compatibility but is **inert** — it is parsed and otherwise ignored. The language has exactly
one semantics (there is nothing to select), so any `N` is legal and changes nothing; a value
newer than the engine is no longer an error. The directive is kept only so existing files that
open with it keep parsing; new recipes should omit it
([ADR-0088](decisions/0088-in-place-v1-break.md), superseding
[ADR-0029](decisions/0029-language-version-pragma.md)).

---

## 3. Lexical structure

- **Comments:** `#` to end of line. **Source files are UTF-8** (pinned; any other encoding
  is an error — [ADR-0049](decisions/0049-ascii-letter-pixel-keys.md)). A leading U+FEFF
  BOM is skipped (error-robustness, [ADR-0032](decisions/0032-lexical-robustness.md) —
  Windows tooling routinely prepends it).
- **Names are camelCase:** a letter followed by letters, digits, and underscores —
  multi-word names use **camelCase** (`moonIcon`; snake_case is legal, camelCase
  preferred). A name never contains `-`, so **`-` is always the minus operator and needs
  no whitespace**: `x-1` subtracts. Path *segments* — module file names, export base
  paths — may contain hyphens (§2, §13), but the names a module defines may not
  ([ADR-0052](decisions/0052-complete-normative-grammar.md), rule D5 in §17).
- **Layout:** the language is **line-oriented**. One statement per line. Blocks are
  introduced by a trailing `:` and opened by indentation. **Indentation is spaces only**
  (2 recommended); a **tab in indentation is a positioned error**, and a block's direct
  children must share one consistent indent string (pixel-block dedent uses the same rule). A
  statement **continues across newlines while a `(` is unclosed** — so paren-form calls, long
  `poly`s, and many-stop gradients may wrap; command-form (no parens) stays single-line. There
  is no `\` continuation and no `;`. See [ADR-0032](decisions/0032-lexical-robustness.md).
- **One call, two interchangeable surfaces** (pure sugar, same spirit as UFCS §10; see
  [ADR-0015](decisions/0015-unified-call-model.md)):
  - **Command-form** — callee then whitespace-separated arguments, no parens:
    `circle k 8:8 6`. Allowed **only at statement position** (one call per line), where
    there is no nesting to disambiguate. The terse idiom for drawing commands.
  - **Paren-form** — callee immediately followed by `(`, comma-separated arguments:
    `circle(8:8, 6, k)`. Allowed **anywhere**, and **required** in expression position
    (RHS of `=`, nested arguments, `if … then …`) because grouping needs parens.
  - The two are equivalent: `f a b c` ≡ `f(a, b, c)`. Trailing flags such as `fill` are
    bare flag arguments in either form.
- **Two separators, each with one job:**
  - **Whitespace** separates the arguments of a **command-form** call.
  - **Comma** separates the **elements of a comma-sequence**: arguments / parameters of a
    paren-form call, or elements of a **list literal**. Comma is never optional sugar and
    never separates command-form arguments.
- **A list literal needs no brackets, and there is no list bracket.** A bare comma-sequence
  in value position is a list: `x = 1, 2, 3` (parens only **group or nest**:
  `(1, 2), (3, 4)`); symmetrically `r, g, b = rgb` destructures. A `(` *immediately after a
  callee* opens an **argument list**, a `(` elsewhere **groups** — so `f(a, b, c)` is a
  **3-argument call**, not a one-list call. To pass a single list as one argument, bind it
  first: `xs = a, b, c` then `f(xs)`. See [ADR-0002](decisions/0002-hybrid-primitives-and-indexed-palette.md)
  and [ADR-0015](decisions/0015-unified-call-model.md).
- **Every statement is one of three shapes** — and `=` marks a **binding**:
  - **Binding** `[kind] name = expr` — introduces a **referenceable name** (`x = 10`,
    `k = #1a1a1a`, `grad sky = …`, `mask m = …`, `fn area(r) = …`). Scan for `=` to find
    every definition; a leading `kind` keyword only tags the binding's type.
  - **Block** `kind name … :` + indent — opens a **structured body** (`draw`, `theme`,
    `export`, `filter`, `tileset`, `atlas`, `if`/`for`/`match`).
  - **Directive** `verb args` — performs an **action**, introduces no name (`circle k 8:8 6`,
    `tiles grass, dirt`, `with warmPal`).

  Punctuation is kept only where it resolves a real ambiguity or serves error-robustness /
  self-verifiability (so `=` stays even though dropping it benches ~6 % cheaper, while
  command-call parens and the idiom-only `from`/`in` connectors were dropped). Idiom alone
  does not justify a marker. See [ADR-0017](decisions/0017-punctuation-carries-meaning.md)
  and [ADR-0018](decisions/0018-idiom-alone-does-not-justify-a-marker.md).
- **Strings:** `"…"`; multi-line via triple quotes `"""…"""` (used for style guides).

There are **no statement separators or terminators** — one statement per line, structure by
indentation. (There is no inline `{ … }` block and no `;`; see §10 and
[ADR-0018](decisions/0018-idiom-alone-does-not-justify-a-marker.md).)

---

## 4. Values & types

| Value | Syntax | Notes |
|-------|--------|-------|
| Number | `10`, `3.5`, `-2`, `10%` | real-valued; a `%` suffix divides by 100 (`10% == 0.1`); quantized when used as a geometry coordinate — mode-scoped, §5. A literal needs a leading digit — `0.2`, never `.2` (which is a dot-index; [ADR-0037](decisions/0037-floored-division-and-integer-indices.md)). |
| Colour | `#1a1a1a`, `oklch(…)`, `#1a1a1a.lighten(10%).darken(0.2)`, `k` | a **first-class value**: a hex/colour-space literal, a colour operation (call- or method-style, §10), or any name bound to a colour — typically a palette entry (§12). A single char is read as a pixel key only inside a `pixels:` block. |
| Point | `x:y` | absolute or relative (§5). |
| Region | `circle(8:8, 4)`, `a.union(b)`, `gem.region` | a coverage region — a shape callee called **without a paint** (§8), a drawing's silhouette (`region(d)`), combined with set-ops and placed with `.transform` (§9, [ADR-0036](decisions/0036-shapes-as-region-constructors.md), [ADR-0039](decisions/0039-region-algebra-constructors-combinators-eliminators.md)). |
| Transform | `rotate(45).about(8:8)`, `shift(2:0)`, `skew(15)` | a **first-class transform** (4×4 homogeneous matrix — 2D affine + projective 3D); built by constructors, anchored with `.about(pt)`, composed by UFCS in **reading order**; applied via `stamp … transform t` and `region.transform(t)` (§9, [ADR-0044](decisions/0044-first-class-transforms.md)). |
| List | `1, 2, 3` (or `(1, 2, 3)` to group/nest) | comma-separated sequence; supports destructuring `r, g, b = rgb` and indexing `xs[i]`. |
| String | `"…"`, `"""…"""` | style guides (§12). Module/output paths are bareword, not strings (§2, §13). |
| Boolean | from comparisons / `true`, `false` | logic with `& | !`. |

**Indexing** has two interchangeable surfaces for the *same* operation — use the shorter
for the case:

- `xs.0` — **dot-index**, literal integer only; shortest form for a constant index.
- `xs[expr]` — **bracket-index**, any expression; the in-distribution general form.

`xs.3` is exactly `xs[3]`. (A dot followed by a **name** rather than a number is a
method-style call, not an index — see §10.) **An index must be an integer** — a fractional
index is a positioned error, never a silent floor; write `xs[row // 8 mod 3]` with floored
division (§10, [ADR-0037](decisions/0037-floored-division-and-integer-indices.md)).
Coordinates coerce (§5); indices do not.

---

## 5. Coordinate system

- Origin `0:0` is **top-left**. `x` increases right, `y` increases down (raster
  convention).
- Pixel centers sit at integer coordinates. A drawing declared `4x4` addresses
  `0:0 … 3:3`.
- **Coordinate quantization is mode-scoped** and happens at the rasterization boundary
  ([ADR-0040](decisions/0040-mode-scoped-coordinate-quantization.md)): in **pixel mode**
  geometry coordinates round **half-up to integers** (`floor(v + 0.5)`); in **smooth mode**
  they round half-up to the fixed **1/16 subpixel grid** (`floor(v*16 + 0.5) / 16`), so
  anti-aliased output can place geometry between pixels — exactly, deterministically.
  Inherently integer slots — canvas size, pixel cells, `px`, `stamp` position/scale,
  tileset/atlas layout — coerce to integers in **both** modes.
- **Out-of-bounds is clipped:** drawing or stamping outside the canvas is silently clipped;
  negative or over-size coordinates are legal ([ADR-0028](decisions/0028-rasterization-semantics.md)).
- Built-ins `w` and `h` hold the current drawing's width and height.

**Points & path-local cursors.** A point is **absolute** `x:y` from the top-left origin.
Drawing commands are explicit geometry and have **no implicit cursor**. Relative movement
exists only inside `path` definitions, where the command slot may be prefixed with `rel`.

```drw
line k 0:0 10:0

path corner 16x16:
  move 0:0
  line rel 10:0
  line rel 0:6
```

The old drawing-global `by` relative point is superseded by `rel` in path commands
([ADR-0061](decisions/0061-first-class-paths-and-local-pen-cursors.md)). For ordinary
geometry, use point arithmetic with explicit anchors:

```drw
c = 8:8
r = 2:2
rect k c-r c+r
```

---

## 6. Drawings

```drw
draw <name> <W>x<H>:        # size optional — see below
  <body>
```

`W` and `H` are **integer literals** (never expressions or variables) separated by `x`. True
scaling is `scale<N>` on `stamp`/`export` (§9, §13), never a canvas dimension. The header size
is **optional**; a drawing's size is resolved in this order, first match wins
([ADR-0021](decisions/0021-optional-canvas-size-resolution.md)):

1. **Explicit header** `draw name WxH:` — wins. With a `pixels:` block present it is *checked
   against the rows* (mismatch = positioned error): an assertion, not a second source of truth.
2. **Inferred from `pixels:`** — rows give `H`, row width gives `W` (§7); drop the redundant header.
3. **`size` default** — a `size WxH` directive sets the default canvas for size-less drawings.
   It is a command-form directive (like `use`, `with`, `mode` — §3), not a `=` binding, and
   lives at **module** scope (a file-level default, like `use`) or in a **theme** (a "canvas
   default", §12). Theme defaults merge by the standard fold (later wins, [ADR-0005](decisions/0005-theme-composition-by-fold.md));
   a module-level `size` overrides the theme's, as a local `pal` overrides a theme palette.
4. **Otherwise** a positioned error: *"drawing `<name>` has no size — add `WxH`, a `pixels:`
   block, or a `size` default."*

So only a **one-off procedural** drawing (no `pixels:` block, no applicable default) must state
`WxH`; hand-pixeled sprites and uniform sets omit it. `w`/`h` (§5) hold the *resolved* size
whatever supplied it.

**Parametric drawings.** A `draw` may take parameters — `draw <name>(<p1>, <p2>, …) [WxH]:` —
bound as ordinary names in the body; size stays literal (params can't set `WxH`). Instantiate
when stamping: `stamp key(r) 4:4` (§9). This is how an icon *set* shares one definition across
variants. See [ADR-0024](decisions/0024-parametric-drawings.md).

The body may contain, in any order (only `use` is position-bound — it must lead):

- leading `use` line(s) — apply a theme to **this drawing only** (must precede all other
  statements; §12, [ADR-0051](decisions/0051-drawing-level-use.md)),
- a `pal …` line (a drawing-local palette, if no theme is applied; §12),
- a `pixels:` block (explicit pixels; §7),
- drawing commands (§8),
- composition via `stamp` (§9),
- expressions, conditionals, and loops (§10–§11),
- optional `title "…"` / `desc "…"` metadata (emitted to SVG, ignored by raster formats; §13).

A `draw` with no `export` referencing it (§13) is never written to disk — it exists
purely to be `stamp`ed. This is how "components" and "outputs" share one concept.
See [ADR-0006](decisions/0006-modules-and-content-output-separation.md).

---

## 7. Pixel literals — explicit pixels

The primary primitive for hand-designed sprites. A `pixels:` block contains raw rows of
**single-letter pixel keys** (palette entries, §12; `.` = transparent), one character per
pixel, until the block dedents — the block form of the `px` command, and the reason it is
named `pixels` ([ADR-0041](decisions/0041-rename-grid-block-to-pixels.md)):

```drw
draw heart 5x5:
  pal k=#1a1a1a r=#c04040    # inline form: space-separated key=value entries
  pixels:
    .r.r.
    rrkrr
    rrrrr
    .rrr.
    ..r..
```

- The rows **define** the size when the header omits it (rows → `H`, row width → `W`); all
  rows must be equal width. When the header *does* state `W`x`H`, the block is checked against
  it and a mismatch is a positioned error (§6, [ADR-0021](decisions/0021-optional-canvas-size-resolution.md)).
- `.` is **built-in**: a `.` cell is always transparent. It is not a palette entry and
  cannot be remapped (`transparent` is the expression-side spelling); declaring `.` in a
  `pal` is a positioned error ([ADR-0049](decisions/0049-ascii-letter-pixel-keys.md)).
- A `pixels:` block and commands can coexist: draw the rows, then `line`/`stamp` on top.
- **A pixel key is exactly one ASCII letter** (`a`–`z`, `A`–`Z`) — a fixed,
  **expression-safe** set: every key is a valid single-character identifier and therefore
  an ordinary palette binding, referable in expressions and paint slots too (§12). Digits,
  punctuation, and non-ASCII characters are not keys (`1` is a number literal, symbols
  collide with operators — the characters that would split the namespace). Row width =
  character count = editor column count. Rows are pure key sequences with no trailing `#`
  comments (annotate above the block). See
  [ADR-0032](decisions/0032-lexical-robustness.md) and
  [ADR-0049](decisions/0049-ascii-letter-pixel-keys.md).
- **Cells resolve in the palette namespace only** ([ADR-0073](decisions/0073-palette-namespace-for-pixel-cells.md)).
  A cell letter must name a visible single-letter **palette** entry (or, inside a glyph
  render, an inline-glyph paint key); it never resolves against the general lexical scope, so
  a plain value binding of the same letter is not a cell. A letter that names no palette entry
  is a positioned `E007` (palette namespace miss).
- **`w` and `h` are legal palette keys.** Inside a drawing `w`/`h` are also the visible
  canvas-size bindings (§5), but a local `pal w=…` / `pal h=…` is allowed and **shadows** the
  size binding within that drawing — the palette (the colour vocabulary) wins
  ([ADR-0073](decisions/0073-palette-namespace-for-pixel-cells.md)). If you need the canvas
  dimension in an expression, keep those two keys free and pick another letter for the colour.

---

## 8. Drawing primitives

All are statements (one per line). A **`<paint>`** is a **colour or a gradient** (§12); a
gradient is resolved across the bounding box of whatever it paints. The trailing `fill`
flag makes a shape **solid** — without it, shapes are outlined.

Every command is a **call** and may also be written in paren-form —
`circle(k, 8:8, 6)` ≡ `circle k 8:8 6` (§3, [ADR-0015](decisions/0015-unified-call-model.md)).
The command-form shown in this section is the idiom at statement position; paren-form is
required only where a call is nested inside an expression.

**The paint is the first argument of every painting command** — *paint first, geometry
after, flags last* ([ADR-0066](decisions/0066-paint-first-painting-commands.md)).

**Shapes are region constructors** ([ADR-0036](decisions/0036-shapes-as-region-constructors.md)).
`rect`/`rrect`/`circle`/`ellipse`/`poly`/`curvePoly` construct a **Region** (§4); at statement position a
**leading `<paint>`** rasterizes it, with trailing `[fill] [w<N>]` flags as modifiers — the
statement means *construct the region, then rasterize it*. **Without** a paint the same
call is an expression yielding the region (used in masks, §9); a shape *statement* without
a paint is a positioned error ("region value dropped"). There is one `circle`, not two —
the effect comes from statement position + a leading paint, never from the callee.

**Eliminators `fill` / `stroke` — paint any region directly**
([ADR-0039](decisions/0039-region-algebra-constructors-combinators-eliminators.md)).
Any region expression — combined, bound, fn-returned, or a drawing silhouette — can be
rasterized in one statement, Canvas-style:

```drw
mask keyhole = circle(8:5, 4).union(rect(6:5, 9:14))
fill y keyhole                     # solid
stroke k ring(8:8, 6) w2           # inner boundary, width 2
```

The leading paint is **defined as sugar** for these — the flag names the eliminator:
`circle k 8:8 5` ≡ `stroke k circle(8:8, 5)`, and `circle k 8:8 5 fill` ≡
`fill k circle(8:8, 5)`. This is not currying (the paint-less call yields a *value*, not a
function) — it is one pure constructor inside one effectful eliminator. `stroke` is
**extensional**: it paints the region's 4-inner-boundary (`w<N>` = the inner band of width
N via 4-erosion), a function of the coverage set alone — never of how the region was built.

| Command | Form | Effect |
|---------|------|--------|
| `bg`    | `bg <paint>` | flood the whole canvas |
| `px`    | `px <paint> <pt>` | set one pixel |
| `line`  | `line <paint> <a> <b>` | explicit Bresenham segment from `a` to `b` |
| `rect`  | `rect <paint> <a> <b> [fill]` | rectangle (corners `a`,`b`) |
| `rrect` | `rrect <paint> <a> <b> <r> [fill]` | rounded rectangle, corner radius `r` |
| `circle`| `circle <paint> <center> <r> [fill]` | circle region — covers an even `2r` pixel diameter for `r > 0`; `r=0` is one pixel |
| `ellipse`| `ellipse <paint> <center> <rx>:<ry> [fill]` | midpoint ellipse |
| `arc`   | `arc <paint> <center> <r> <a0> <a1>` | circular arc, degrees (0°=+x, clockwise) |
| `quad`  | `quad <paint> <p0> <c1> <p2>` | quadratic Bézier |
| `bezier`| `bezier <paint> <p0> <c1> <c2> <p3>` | cubic Bézier |
| `curve` | `curve <paint> <p1> <p2> <p3> … [w<N>]` | open Catmull-Rom spline **through** the points (≥3; centripetal, [ADR-0074](decisions/0074-curve-through-points-spline.md)) |
| `curvePoly`| `curvePoly <paint> <p1> <p2> <p3> … [fill]` | closed Catmull-Rom loop through the points — fillable organic mass; a Region without paint (≥3; [ADR-0075](decisions/0075-curvepoly-closed-curve-region.md)) |
| `profile`| `profile <paint> <span> <fn> [<baseline>] [fill]` | filled silhouette under `y = f(x)`, sampled once per column; `fn` gets normalized x∈[0,1]; a Region without paint ([ADR-0076](decisions/0076-profile-filled-function-silhouette.md)) |
| `poly`  | `poly <paint> <p1> <p2> … [fill]` | polyline / polygon (explicit vertices) |
| `fill`  | `fill <paint> <region>` | rasterize any region expression solid (§9, [ADR-0039](decisions/0039-region-algebra-constructors-combinators-eliminators.md)) |
| `stroke`| `stroke <paint> <region> [w<N>]` | rasterize a region's inner boundary, width `N` (default 1) |
| `text`  | `text <paint> <pt> <string> [font <name>]` | bitmap text, top-left at `<pt>` |
| `flood` | `flood <paint> <pt>` | 4-connected bucket fill of the region at `<pt>` |

The paint is **first** for every command, `poly` included — one rule, no exceptions
([ADR-0066](decisions/0066-paint-first-painting-commands.md); `poly`'s variadic point tail
also parses robustly only with the paint out front, the `poly-shape` bench case).

Drawing commands never read or update a cursor. For connected freehand geometry, define a
first-class `path` and draw it with `fill`/`stroke`.

### Paths

```drw
path <name>[(<params>)] [WxH]:
  <path-command>

path <name> = <path-expr>
```

A `Path` is reusable vector geometry. The optional `WxH` is its viewBox for export and
gradient bounds. Path bodies have a **local pen cursor**; it never escapes the path:

| Command | Form | Effect |
|---------|------|--------|
| `move` | `move [rel] <pt>` | start a new contour without drawing |
| `line` | `line [rel] <pt>` | line from current point to endpoint |
| `quad` | `quad [rel] <control> [rel] <pt>` | quadratic curve from current point |
| `bezier` | `bezier [rel] <c1> [rel] <c2> [rel] <pt>` | cubic curve from current point |
| `arc` | `arc [rel] <pt> around <center> cw|ccw` | circular arc from current point to endpoint around center |
| `close` | `close` | close the current contour |

Paint belongs to the use site:

```drw
fill linear(90, #fff, #777) shield
stroke k shield w2
mask shield.fill():
  stamp crest 0:0
```

`Path` methods:

- `.fill()` -> Region, even-odd filled coverage.
- `.stroke(n)` -> Region, centerline stroke coverage.
- `.union(p)`, `.intersect(p)`, `.subtract(p)`, `.xor(p)` -> Path.
- `.shift(pt)`, `.scale(n)`, `.rotate(deg)`, `.flipx()`, `.flipy()`, `.transform(t)` -> Path.
Rasterization is integer and anti-aliasing-free in pixel mode (§14).

**Text & std fonts** ([ADR-0022](decisions/0022-text-and-bitmap-fonts.md),
[ADR-0054](decisions/0054-std-fonts-are-recipe-modules.md)). Glyphs are deterministic
Recipe font definitions shipped under `std/fonts/` — Drawstic globally registers the monospace
ASCII faces `small` (5×7, the default) and `micro` (3×5) — both covering the full printable-ASCII set
(micro↔small parity) — so text is deterministic on every platform, in both render modes. `from std/fonts/small small` is optional. Fixed 1px tracking; a newline in the string starts the next line
(line height = glyph height + 1); unknown characters render a visible missing-glyph box,
never a silent gap. `font <name>` is also a **scoped directive** (draw / module / theme —
like `size`, §6): a theme sets the set's face, a per-`text` `font` flag overrides it.

**User-defined fonts** ([ADR-0042](decisions/0042-user-defined-fonts.md)). A **glyph is a
drawing** — pixel it with `pixels:` or draw it with paths — and a `font <name> [WxH]:`
**definition block** (§2; the trailing `:` distinguishes it from the directive) maps
characters to glyphs:

```drw
font runic 5x7:            # optional WxH = monospace assertion
  with small               # fold: fall back to the std face (later wins, §12)
  glyph "A" runeA          # one character → one drawing
  glyph "B":               # inline glyph body; inherits the font size
    pixels:
      kkk
      k.k
      kkk
  glyphs digits "0123456789"   # bulk: i-th tile of a tileset → i-th character
  tracking 1               # optional; default 1
  lineheight 8             # optional; default glyph height + 1
```

Glyph **heights must agree**; widths may vary — the advance is *width + tracking*, so
proportional faces work and monospace is the special case. Rendering blits the glyph
drawings like `stamp` (alpha-honouring), so path-drawn glyphs get AA edges in smooth mode;
an unmapped character renders the missing-glyph box. Glyph drawings must be
non-parametric. Inline glyph bodies bind `k` to the `text` command's paint.

**Stroke width.** Any stroking command takes an optional trailing `w<N>` token (default 1):
`line k 0:0 10:0 w2`, `circle k 8:8 6 w2` — mirroring `scale<N>` (§9). In pixel mode a
width-`N` stroke stamps a disk brush along the path (round cap/join); in smooth mode it is a
true stroked path with `cap butt|round|square` / `join miter|round|bevel` flags (defaults
butt/miter). See [ADR-0023](decisions/0023-curve-and-shape-primitives.md).

**Through-point splines — `curve` / `curvePoly`**
([ADR-0074](decisions/0074-curve-through-points-spline.md),
[ADR-0075](decisions/0075-curvepoly-closed-curve-region.md)). Both draw a **centripetal
Catmull-Rom** curve that passes *through* every given point (≥3) — LLMs reason "the line goes
through these points", not in off-curve Bézier handles, so dunes, hills, waves, fronds, clouds
and rocks become one predictable call. `curve` is an **open** stroke (optional `w<N>`); `curvePoly`
is a **closed** loop with the usual `[fill] [w<N>]` region-eliminator sugar (`fill` = solid organic
mass, no flag = inner-boundary stroke) and, paint-less, is a fillable **Region** (masks, set-ops).
`curvePoly`'s `fill` and stroke share one tessellation, so they align exactly; its fill is
**even-odd** like `poly`/paths. Prefer these over stacking `bezier`s or ellipses for organic shapes.

**Filled function silhouette — `profile`** ([ADR-0076](decisions/0076-profile-filled-function-silhouette.md)).
`profile <paint> <span> <fn> [<baseline>] [fill]` fills the area between `y = f(x)` and a baseline
across a span — the built-in for a *procedural* horizon (a dune, hill, or noise ridge), where you
have a function rather than a point list. It **samples once per output column** and calls `fn` with a
**normalized x in `[0,1]`** (first column `0`, last `1`); `fn` returns the top-edge `y` in recipe
pixels. Because `fn` never sees a raw pixel coordinate, the noise-frequency trap is unreachable —
`noise(seed, nx * K, 0)` with a small `K` (≈ number of undulations across the span) is the natural,
correct idiom:

```drw
fn ridgeY(nx) = 16 + round(noise(3, nx * 4, 0) * 10)   # ~4 smooth undulations
draw dune 64x32:
  bg #e8d9b0
  profile #c9a06b 0..64 ridgeY fill                    # ridge across the width, filled to the bottom
```

- `<span>` is a **range/list of x-columns** (reusing [ADR-0057](decisions/0057-ranges-are-list-expressions.md)) —
  `0..w` is the whole width, and span inclusivity follows the range operator (`..` vs `..=`). One
  element = one column.
- `<fn>` is a **unary `fn` named by a bare identifier** (`fn <name> nx = …`); it must return a number.
- `<baseline>` (optional, a plain number *before* the flags) is the row the fill runs to; it
  **defaults to the canvas bottom `h−1`** (fill-to-bottom silhouette). Each column fills the inclusive
  rows between `round f(x)` and the baseline, so exactly one contiguous run per column — above *or*
  below the baseline, whichever side the curve is on.
- Paint-less, `profile(span, fn [, baseline])` is a **Region** for masks/set-ops ("shade the dune"),
  like every shape; a paint-less `profile` *statement* is the "region value dropped" error.

**Curves & flood determinism.** `arc`/`quad`/`bezier`/`curve`/`curvePoly` are flattened and
rasterized by a *fixed* rule (each curve span → `clamp(ceil(chord), 4, 64)` segments for the
Catmull-Rom curves, chord via the bundled `dhypot`), and `arc` uses the engine's **bundled
deterministic trig** — never host `Math.*` — so results are pixel-identical everywhere (§14,
[ADR-0027](decisions/0027-deterministic-numeric-and-colour-pipeline.md)). `profile` is
deterministic too: integer x per column, `round f(x)` for the top row, and the dmath the `fn`
body calls — no host `Math.*` on the pixel path. `flood` is
4-connected and matches the seed pixel's exact colour; line endpoints are inclusive
([ADR-0028](decisions/0028-rasterization-semantics.md)).

**Small curves rasterize blocky.** The flattener always emits several segments, but every
segment endpoint is rounded to the integer pixel grid before drawing — at spans below
roughly **12px** that rounding dominates and a `quad`/`bezier`/`arc`/`curve`/`curvePoly` reads
as a handful of straight chunks, not a smooth curve. For small curved details, hand-author with
`pixels:` instead.

---

## 9. Composition, transforms & masks

```drw
stamp <name>[(<args>)] <pt> [anchor <name>] [flipx] [flipy] [rot<deg>] [scale<N>] [transform <t>] [tint <paint> <amount>] [shadow <dx:dy> <paint>]
```

`stamp` blits another drawing at `pt` (top-left by default). `anchor center`, `anchor bottom`,
and the other named anchors place a footprint-relative anchor point at `pt`
([ADR-0064](decisions/0064-stamp-anchors.md), [ADR-0072](decisions/0072-visual-stamp-anchors.md));
Drawstic round-half-up subtracts the anchor from `pt`. `shadow dx:dy paint` paints the
transformed source silhouette at the offset before the original stamp.

**The eight offset anchors are *visual*: they name a position on the axis-aligned bounding box
of the stamp *after* flip/rotate/scale** — the box you actually see.
`anchor bottom` is the visible bottom-center; `anchor bottomLeft` + `flipx` lands the visible
**bottom-left** at `pt` (the flip does not move the label); `anchor bottom`
+ `rot90` lands the visible bottom-center of the rotated footprint. An **untransformed** stamp's
box is `[0,w−1]×[0,h−1]`, so anchors are unchanged when no transform is present. `topLeft` (and
the default no-`anchor` placement) is the exception: it always places the sprite's untransformed
**origin** at `pt` — it is the placement origin, not a footprint label.

Because the anchor tracks the *visible* edge, a mirror-reflection is seamed by naming the
seam edge on both copies:

```drw
stamp boat 40:30 anchor bottom                                # hull sits above the waterline
stamp boat 40:30 anchor top flipy tint #305070 40%            # reflection: its top edge meets the same pt
```

Placing by a **computed point** — point arithmetic on `pt` (§8) or a transform pivot
`.about(pt)` — is plain geometry and behaves identically.

Transforms are **first-class values**
([ADR-0044](decisions/0044-first-class-transforms.md)) — a 4×4 homogeneous matrix covering
2D affine (`shift`, `rotate`, `scale`, `skew`, `flipx`/`flipy`, `matrix(…)`) and projective
3D (`rotatex`/`rotatey`/`perspective`, projected back to the plane):

- **Anchor is explicit:** `.about(pt)` conjugates any transform to a definable pivot —
  rotation, scaling, skewing, 3D alike; default origin is `0:0`. No separate
  origin property.
- **Reading order = application order:** `rotate(45).scale(2)` rotates first — UFCS
  chains execute left to right. (Deliberately *not* CSS's right-to-left.)
- **The terse flags are pinned sugar** ([ADR-0043](decisions/0043-arbitrary-angle-stamp-rotation.md)):
  `rot<deg>` ≡ `transform rotate(deg).about(((w−1)/2):((h−1)/2))` (footprint centre),
  `flipx`/`flipy` ≡ the centre-anchored mirrors, `scale<N>` ≡ `transform scale(N)`;
  combined flags expand flip → scale → rotate.
- **Rasterization:** any invertible transform is inverse-mapped **nearest-neighbour** in
  pixel mode (bundled math, half-up rounding — no new colours, alpha honoured); smooth
  mode uses the same mapping on the 1/16 subpixel grid. Lattice-preserving transforms
  (mirrors, quarter-turns, integer shifts/scales) are **lossless**; a non-invertible
  transform is a positioned error.

```drw
t = rotate(30).about(8:8)                              # a transform is an ordinary value
stamp gem 4:4 transform t
stamp card 8:2 transform rotatey(60).perspective(64)   # 3D card flip, projected
```

**Parametric & recoloured stamps.** `stamp key(r) 4:4` instantiates a **parametric drawing**
(§6) with its args; `stamp eye 3:5 tint k 0.3` blends the stamped pixels toward a paint by an
amount (0..1) — the quick "same silhouette, shifted hue" case without parameterizing. See
[ADR-0024](decisions/0024-parametric-drawings.md).

```drw
draw face 16x16:
  stamp eye 3:5            # left eye
  stamp eye 10:5 flipx     # right eye at the mirrored position — draw half, mirror it
  stamp gem 6:9 scale2     # 4x4 → 8x8, nearest-neighbor
  stamp gem 6:1 rot45      # NN-resampled about the footprint centre (ADR-0043)
  stamp boat 8:14 anchor bottom shadow 1:1 #00000060
```

For a whole symmetric *passage* (not just one stamp), wrap it in a **`mirror x=<n>:` block**
(§11.2) — it draws the body and its axis reflection, stamps flip, axis pixels paint once.

**Alpha compositing.** The framebuffer is straight-alpha **RGBA8**; painting composites
**source-over** with a fixed round-half-up rule, in integer math (deterministic). `stamp`
honours the source's **alpha** (not 1-bit); fully transparent pixels are skipped. Pixel mode
stays AA-free — alpha enters only from explicit alpha colours/gradients, never edge coverage,
so silhouettes stay crisp (§14, [ADR-0025](decisions/0025-alpha-compositing-model.md)).

### Masks & path combination

A shape call **without a paint** *is* a region (§8,
[ADR-0036](decisions/0036-shapes-as-region-constructors.md)). Combine regions into a
**mask** — a coverage buffer (1-bit in pixel mode, alpha in smooth mode) — with UFCS
set-ops, then clip drawing to it:

```drw
mask keyhole = circle(8:5, 4).union(rect(6:5, 9:14))

draw badge 16x16:
  mask keyhole:          # everything in this block is clipped to the region expression
    bg #e0b070
    stamp crest 4:4
```

- Set-ops: `.union` · `.intersect` · `.subtract` · `.xor` — coverage-based, so fully
  deterministic. See [ADR-0012](decisions/0012-masks-and-path-combination.md). (Kept UFCS,
  not symbolic `|`/`&`: the bench measured **zero** token difference, so the operators stay
  unoverloaded — resolved open question 12.)
- Placement & transforms: `r.transform(t)` applies any first-class transform
  ([ADR-0044](decisions/0044-first-class-transforms.md)) — rotation, skew, even projective
  3D — with an explicit anchor via `.about(pt)`. `.shift(p)` ≡ `.transform(shift(p))` and
  `.scale(N)` ≡ `.transform(scale(N))` remain the terse sugar
  ([ADR-0039](decisions/0039-region-algebra-constructors-combinators-eliminators.md)).
- **Any drawing is a reusable shape**: `region(d)` / `d.region` is its **silhouette** as a
  Region (alpha > 0 in pixel mode, alpha coverage in smooth mode); parametric
  instantiations work like in `stamp` (`region(key(r))`):

  ```drw
  mask m = gem.region.scale(2).shift(4:4)   # place a drawing's silhouette as a mask
  ```

- Paths convert to regions explicitly: `badge.fill()` for filled coverage,
  `slash.stroke(2)` for stroked coverage. Therefore a path mask is written
  `mask badge.fill():`, not `mask badge:`.
- Apply as a `mask <region-expr>:` block, or inline on a stamp: `stamp crest 4:4 mask keyhole` — or
  paint a region directly with `fill`/`stroke` (§8).
- A `mask` is a top-level value (importable) or drawing-local.
- Regions compose through ordinary `fn`s — the value-side way to define a custom shape:
  `fn ring(c, r) = circle(c, r).subtract(circle(c, r - 2))`, then `mask m = ring(8:8, 6)`.
- A **Region is its coverage**, and a **drawing is a bitmap value** — neither is a vector
  path (framebuffer-first, [ADR-0001](decisions/0001-framebuffer-first-core.md)); an engine
  may keep regions symbolic internally, but the semantics are per-pixel coverage.

### Tilesets & atlases

Bake several drawings into **one image plus a coordinate map**, for game engines and sprite
runtimes. Both are **content** (like `draw`): importable and exportable (§13), with
**deterministic** layout. See [ADR-0016](decisions/0016-tilesets-and-atlases.md).

A **`tileset`** packs **equal-sized** tiles into a grid, addressed by **index** (row-major
from 0). Every member must equal the declared tile size:

```drw
tileset terrain 16x16:                 # 16x16 = tile size; each member must be 16x16
  tiles grass, dirt, water, stone      # index order: grass = 0, dirt = 1, …
  cols 4                               # optional; default: near-square auto layout
```

An **`atlas`** packs **varied-sized** sprites and addresses them by **name**. Members pack
automatically in a fixed order (so the sheet is reproducible); pin any subset with `place`
and the rest pack around them:

```drw
atlas hud:
  sprites play, pause, stop, logo      # any sizes; the member name keys the frame
  pad 1                                # optional inter-sprite padding in px (default 0)
  place logo 0:0                       # optional: pin a member; others auto-pack
```

- **Members** are drawings in scope (local or imported), given as a bracket-less list (§3).
  Order is the tile index for `tileset`; for `atlas` it only seeds the packer.
- `tiles`/`sprites`/`cols`/`pad`/`place` are **command-form directives** (like `with`,
  `apply`, `mode` — §3), *not* `=` bindings, so none implies a reusable variable: the body
  configures the construct just as a `draw` body holds drawing commands. A `tileset` member
  that is not exactly the tile size is a positioned error.
- Layout is **auto with explicit override**: `tileset` auto-columns at `ceil(sqrt(count))`
  (override `cols`); `atlas` shelf-packs deterministically (override by `place`-pinning).
  This upholds visual determinism (§14): the same members yield the same layout.
- A single member can be addressed for re-`stamp`ing — `terrain.0` by index — as a natural
  extension (see [ADR-0016](decisions/0016-tilesets-and-atlases.md)).

---

## 10. Expressions & functions

### Variables

```drw
x = 10
y = x * 2 + 5
x += 10          # mutate: += -= *= /=
```

### Scope & evaluation

- **Module-scope-only definitions** (`draw`/`path`/`fn`/`theme`/`tileset`/`atlas`/`export`)
  live at the top level of a file, are **order-independent** (may reference each other
  forward), and are collected before the module runs. Writing one inside a `draw` body is a
  positioned **E004** error — `fn`/`path` name the restriction explicitly
  ("`fn`/`path` definitions live at module scope"); the others report "statement not allowed
  in a drawing body".
- **`filter` is the one definition kind valid at both scopes**: `filter name: …` at module
  level joins the order-independent set above (forward-referenceable, like `fn`); the same
  syntax inside a `draw` body registers a **drawing-local** filter instead — evaluated in
  sequence, so it must appear before the `apply name` that uses it (like the bindings below).
- **`mask`/`grad`/`pal` and ordinary bindings (`=`)** are allowed at **module scope** (shared
  constants, `TILE = 16`; a top-level `mask`/`grad` is importable) and equally as
  **drawing-local** overrides inside a `draw` body (§9, §12). Unlike the module-scope-only
  definitions above, these are ordinary sequential statements, not order-independent
  definitions — each is visible from its line to the end of its enclosing block, and
  a drawing-local one must be written before it is used. `for`/`if`/`repeat`/`match`/`while`/
  `mask`/`scatter`/`mirror` open a **child scope**: a binding *first introduced* inside the
  block (the loop variable, a block-private temporary) does **not** leak. A `name = expr` whose
  name is **already a mutable binding in the enclosing draw scope reassigns it** rather than
  shadowing — so a loop accumulator persists (`g = g.union(…)`, `n = n + 1`), matching what `+=`
  already did ([ADR-0081](decisions/0081-loop-persistent-rebinding-and-theme-scope-edges.md)).
  The reassignment search is **bounded to the draw body**: a block never mutates a module-scope
  binding (that stays a draw-local shadow), and a `const`/palette binding (canvas `w`/`h`, a
  gradient) is never a reassignment target. Evaluation is eager; statements in a draw body run
  top-to-bottom.

| Kind | Module scope | Drawing-local | Order |
|---|---|---|---|
| `draw` / `path` / `fn` / `theme` / `tileset` / `atlas` / `export` | yes | no (E004) | order-independent |
| `filter` | yes | yes | order-independent at module scope; sequential (must precede `apply`) when drawing-local |
| `mask` / `grad` / `pal` / binding (`=`) | yes | yes | sequential — visible from its line onward |

- **Name resolution is one namespace, lexically scoped — and palette names are `const` and
  reserved** ([ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md),
  superseding the positional rule of [ADR-0033](decisions/0033-evaluation-and-scope-model.md)):
  palette entries are ordinary colour bindings, and a name in a paint slot is a plain lookup
  whose value must be a paint (otherwise a positioned **type error**). The palette-vs-value
  collision is **asymmetric** ([ADR-0073](decisions/0073-palette-namespace-for-pixel-cells.md)):
  a `let`/`const`/loop-variable/parameter may **not** shadow a visible palette entry (still an
  error — a colour word keeps its meaning), but a **`pal` entry may shadow a visible
  non-palette binding** of the same name (the implicit `w`/`h`, a gradient, an outer `let`) —
  the colour vocabulary wins. The redefinition channels are that shadow and palette-to-palette
  composition (theme fold / local `pal` override, §12). The only palette-table context is a
  `pixels:` row, whose cells are literal keys resolved in the palette namespace only, not
  expressions (§7).

### Operators

`+ - * / //` and the keyword **`mod`** (arithmetic), `> < >= <= == !=` (comparison),
`& | !` (logic), with standard precedence (`mod` sits in the multiplicative tier) and
`( … )` grouping. Arithmetic operators accept numbers and points; point arithmetic is
component-wise, and a number paired with a point is promoted to `n:n`:
`4:4 * 2 == 8:8`, `4:4 * 2:3 == 8:12`, `4:4 + 1 == 5:5`
([ADR-0058](decisions/0058-point-arithmetic.md)). Unary `-` also accepts points:
`-(1:2) == -1:-2` ([ADR-0059](decisions/0059-relative-point-expressions.md)). Because point
literals bind as arithmetic operands, composite coordinate expressions are grouped:
`(x + 1):(y + 2)`. `//` is
**floored integer division** and `mod` is **floored modulo** (result takes the sign of the
divisor; `a == (a // b) * b + a mod b`) — pinned for determinism
([ADR-0037](decisions/0037-floored-division-and-integer-indices.md)). **`%` is exclusively
the percent suffix** (§4) — it is not an operator, so no whitespace-dependent reading exists
([ADR-0048](decisions/0048-mod-keyword-percent-suffix-only.md)).

### Conditionals

Expression form (no `:`, so no collision with points):

```drw
c = if x > 15 then y else r
```

Statement form (indented block):

```drw
if x > 15:
  poly k 0:0 15:15
else:
  circle k 8:8 5
```

Match (replaces the cryptic `?!` form):

```drw
match x:
  0: bg k
  10: bg y
  else: bg r
```

### Functions

Parenthesized parameters and calls (mirrors mathematical notation; avoids the `:`
collision of the old `name:a,b` form):

```drw
fn area(r) = pi * r * r
fn lerp(a, b, t) = a + (b - a) * t
fn checker(x, y) = if (x + y) mod 2 == 0 then k else transparent
```

- Called within expressions: `area(5)`, `checker(x, y)`.
- Recursion is allowed and bounded by the runtime budget (§15).
- Destructuring in the body: `r, g, b = rgb`.
- **Functions are first-order**: named, total, pure definitions — **not values**. No
  closures, no partial application, no currying; parametrisation (fn parameters,
  parametric draws §6) is the composition mechanism. This keeps every call site statically
  resolvable and the totality argument trivial
  ([ADR-0039](decisions/0039-region-algebra-constructors-combinators-eliminators.md)).

### Method-style calls (UFCS)

Any function can be called **method-style on its first argument**: `x.f(a)` is exactly
`f(x, a)` — pure syntactic sugar, no methods-on-types machinery. This lets transforming
pipelines read **left-to-right, subject first**, instead of inside-out:

```drw
lighten(hue(grayscale(#235), red), 10%)   # nested — read inside-out
#235.grayscale.hue(red).lighten(10%)      # UFCS — reads in order
```

- A **zero-argument** call may drop its parens: `c.grayscale` ≡ `grayscale(c)`.
- The dot is shared with indexing, disambiguated by what follows: **`.0` (a number) is an
  index**, **`.name` (an identifier) is a call** — e.g. `cols[i].lighten(10%)`.
- It is only sugar: `c.lighten(10%)` and `lighten(c, 10%)` are identical; use whichever
  reads better. See [ADR-0010](decisions/0010-ufcs-method-style-calls.md).
- The same two-surface idea covers **commands** at statement position:
  `f a b c` ≡ `f(a, b, c)` (§3, [ADR-0015](decisions/0015-unified-call-model.md)).

### Standard library

A fixed, **total, side-effect-free** built-in set (deterministic via
[ADR-0027](decisions/0027-deterministic-numeric-and-colour-pipeline.md)); user `fn`s cannot
shadow it. See [ADR-0034](decisions/0034-standard-library.md).

- **Math:** `min max abs clamp floor ceil round sign sqrt hypot dist`, `sin cos tan atan2 pow
  exp log`, `lerp`; constants `pi tau`. (Modulo is the operator `mod`, §above — not a
  stdlib function; [ADR-0048](decisions/0048-mod-keyword-percent-suffix-only.md).)
- **Lists:** `len(xs)`; `xs.cycle(i)` auto-wraps any integer index (including negative) via
  floored modulo — sugar for `xs[i mod len(xs)]`, so `xs.cycle(-1)` is the last element; an
  empty list is E015 ([ADR-0079](decisions/0079-ramp-cycling.md)). Indexing/destructuring are
  in the language (§4).
- **Randomness (seeded):** `rand(seed[, i])` → `[0, 1)`, `noise(seed, x, y)` → `[0, 1)`
  (2D value noise, smooth in `x`/`y`) — pure, never ambient; an optional `seed <N>`
  directive (module/draw scope, like `size`) sets a base seed for sugar helpers, but the
  core functions always take their seed explicitly
  ([ADR-0026](decisions/0026-seeded-randomness-and-noise.md)).
  **`noise` only smooths *between* integer lattice points** — sampling at integer steps
  (`noise(seed, x, 0)` for integer `x`) lands exactly *on* a lattice point every time, so
  interpolation contributes nothing and consecutive samples are uncorrelated (high-frequency,
  "spiky"). Scale the input down so steps fall *between* lattice points, e.g.
  `noise(seed, x * 0.05, 0)` for a smooth silhouette that advances one pixel per `x`.
- **Colour ops** (`lighten`, `mix`, `oklch`, …) are first-class (§12), not repeated here.

No I/O, clock, locale, or ambient randomness — this is what keeps the language **total** (§15)
and deterministic (§14).

---

## 11. Loops & block constructs

```drw
repeat <N>: <body>            # repeat N times, no index
for <i> <a>..<b>: <body>      # i from a to b-1 (half-open); a..=b is inclusive; no `in`
while <cond>: <body>          # allowed, but governed by the runtime budget (§15)
scatter <p> <n> <seed> <region>:  # <body> n times, <p> = a seeded point from <region> (§11.1)
mirror x=<n>: <body>          # draw <body>, then its reflection across x=n (§11.2)
mirror y=<n>: <body>          # …and across the horizontal line y=n
```

```drw
draw bands 32x32:
  pal:
    k = #1a1a1a
    y = #e0b070
    r = #c04040
  cols = k, y, r                          # a bracket-less list (parens only to group)
  for row 0..h:
    poly cols[row // 8 mod 3] 0:row w:row # pick a band colour per row (floored //, §10)
```

**Idiom: prefer bounded `for`/`repeat`.** `while` exists but cannot defeat termination —
it is capped by the budget. See [ADR-0004](decisions/0004-total-not-turing-complete.md). The
loop variable and any binding inside the body are **child-scoped** — they do not leak out (§10,
[ADR-0033](decisions/0033-evaluation-and-scope-model.md)).

### 11.1 `scatter` — seeded points over a region ([ADR-0077](decisions/0077-scatter-block.md))

`scatter <name> <n> <seed> <region>:` runs its body **`n` times**, binding `<name>` to a point
drawn **uniformly from `<region>`'s pixels** — the deterministic replacement for the
`for`+`rand`+`floor` scatter loop (stars, bubbles, gravel, sparks). The header mirrors `for`: the
keyword, the binding name, then positional operands `count seed region`, then the block.

```drw
draw stars 64x40:
  bg #05060e
  scatter s 40 1 rect(0:0, w-1:h-1):    # 40 stars over the whole canvas, seed 1
    px #ffffff s
  scatter b 30 4 circle(20:30, 12):     # 30 bubbles confined to a disk
    circle #a0d0ff.alpha(60%) b 1 fill
```

- **Distribution** is uniform over the region's on-canvas pixels (index-sampled: point `i` is
  `pixels[floor(rand(seed, i) * pixelCount)]`, pixels enumerated row-major). Confining a scatter
  to a shape is free — pass the shape's region (`circle(...)`, `curvePoly(...)`, a `mask`), no
  `if region.has …` guard.
- **Deterministic**: same seed + same region + same canvas → identical points, on every platform
  (§14). A different seed reseeds the whole arrangement. Sampling is with replacement (two points
  may coincide).
- An **empty region is a no-op** (body runs zero times, no error). The binding is child-scoped per
  iteration; one step is charged per iteration (§15).

### 11.2 `mirror` — axis symmetry ([ADR-0078](decisions/0078-mirror-block.md))

`mirror x=<n>:` draws its body **once normally, then its mirror image** across the vertical line
`x = n` (`mirror y=<n>:` mirrors across the horizontal line `y = n`). Symmetry for a whole
procedural passage — not just a single stamp's `flipx`.

```drw
draw butterfly 32x24:
  mirror x=16:                          # author the left wing; the right is its mirror
    curvePoly #b0407a 16:6 4:2 2:12 16:16 fill
    scatter d 8 3 rect(2:4, 14:18):     # speckles — mirrored too (same seed both sides)
      px #ffe08a d
```

- **What mirrors:** every paint/region command — shapes, fills, gradients, `flood`, and **stamps**
  (a stamp comes out horizontally flipped, "mirror-with-flip"). **Text is the exception**: its
  *position* is reflected but its glyphs are **not** — no backwards text.
- **Axis pixels paint exactly once.** A pixel on the axis maps to itself, so the reflected pass
  skips it (the normal pass already painted it). Critically, a 50%-alpha paint on the axis blends
  **once**, never double-darkened.
- **Masks travel with the content:** a `mask R:` clips the shape, and the mirror reflects the
  clipped result (masked shape *and* its mirror both appear). **Nested `mirror`s compose** into
  four-fold symmetry (`mirror x=a: mirror y=b: …`), the shared centre still painted once. `scatter`
  inside `mirror` gives a symmetric random field (both sides share the seed).
- **Cost:** the body **re-executes** for the reflected pass, so keep it to drawing (a side effect
  like `i += 1` on an outer binding would happen twice).

---

## 12. Colour, gradients, filters & themes

### Colour values

A colour is a **first-class value**. Produce one with:

- a **hex literal**: `#1a1a1a`, `#fff`, `#rrggbbaa`;
- a **colour-space constructor**: `rgb(255, 128, 0)`, `hsl(40, 70%, 60%)`, `oklch(0.78, 0.12, 75)`;
- a **colour operation** (colour → colour): `lighten`, `darken`, `saturate`,
  `desaturate`, `hue` (hue rotation — renamed from `rotate`, which is the transform
  constructor; [ADR-0044](decisions/0044-first-class-transforms.md)), `alpha`, `mix` —
  call-style `lighten(c, 20%)` or method-style `c.lighten(20%)` (§10);
- a **colour-list helper**: `tones(base, ...amounts)` / `base.tones(...)` and
  `mixes(a, b, count[, space])` / `a.mixes(b, count[, space])` return ordinary lists of
  colours for explicit local ramps ([ADR-0060](decisions/0060-explicit-color-list-ramps.md));
- a **shading helper** ([ADR-0086](decisions/0086-declarative-light-and-material.md)):
  `litTone(base, light, amt)` mixes toward the light colour (warm highlight, not a chalky
  `lighten`); `shadowTone(base, cool, amt[, darken])` darkens (by `darken`, default `amt`) and
  nudges the hue toward `cool` by at most ~20° along the shorter arc (never cross-hue, so warm
  bases do not drift through magenta), desaturating slightly; `ramp(base, n)` returns an even
  n-step light→dark tone list for `pixels:`/cel banding — distinct from `tones` (arbitrary
  amounts). Unlike the other builtins these three are **not reserved**: a recipe may still bind
  `ramp`/`litTone`/`shadowTone` (a user binding takes precedence; `base.ramp(n)` on a colour
  still reaches the builtin);
- the keyword `transparent`;
- a **palette entry by name** (below).

Operations chain left-to-right via UFCS: `oklch(0.5, 0.12, 30).lighten(20%).alpha(80%)`.
Mixing and gradient interpolation default to **OkLCh** (perceptually even); pass
`rgb`/`hsl` to override.

**Pinned colour pipeline.** `oklch↔sRGB` conversion, gamut mapping (chroma reduced toward the
achromatic axis until in-gamut), the **shorter-arc** hue interpolation, and 8-bit
round-half-up commit are all *exactly specified* and run on the engine's bundled deterministic
math — so colour is pixel-identical across platforms (§14,
[ADR-0027](decisions/0027-deterministic-numeric-and-colour-pipeline.md)).

### Palettes

A `pal` block defines **colour constants in the enclosing scope** — every entry must
evaluate to a **colour** (positioned error otherwise), and the names are **`const` and
reserved**: rebinding, mutating, or shadowing a visible palette entry with a `let`/`const`/
loop-variable/parameter is a positioned error. The reverse is allowed: a `pal` entry **may
shadow** a visible non-palette binding of the same name — the implicit `w`/`h` canvas-size
bindings (§5), a gradient, an outer `let` — since the palette is the drawing's authoritative
colour vocabulary ([ADR-0073](decisions/0073-palette-namespace-for-pixel-cells.md)). This holds
for a **theme** `pal` key too: a theme `pal w=…`/`h=…` shadows the canvas size in applying draws,
exactly like a drawing-local one
([ADR-0081](decisions/0081-loop-persistent-rebinding-and-theme-scope-edges.md)). The
redefinition channels are that shadow and palette-to-palette composition (theme fold / local
override by name, below). **A palette name is exactly one ASCII letter** (`a`–`z`,
`A`–`Z`) — the pixel key *is* the name
([ADR-0049](decisions/0049-ascii-letter-pixel-keys.md),
[ADR-0050](decisions/0050-single-letter-palettes-combined-by-composition.md)): usable in
`pixels:` cells (§7), expressions, and paint slots alike — one namespace, no table-only
tier, no symbol keys. A multi-character name in a `pal` is a positioned error — to name a
colour for expressions, use a **plain binding** (`ink = #1a1a1a`; not const, not a pixel
key, not in the authored palette artifact). Plain color bindings are still rendered normally:
palette-capable exports collect actual framebuffer colors (§13), so a `pal` is not required
to make a color exportable. `.` is not a palette key but the built-in transparent cell
(`transparent` is the expression-side spelling). Entries may derive from earlier ones. See
[ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md) and
[best-practices.md](best-practices.md#color).

A `pal` is also an **artifact**: the ordered key → colour table (after the theme fold) is
stored with the drawing, and palette-capable exports honour it — `png indexed` uses the
artifact as the priority order for rendered colours, then auto-completes the PNG palette from
the actual framebuffer (§13, [ADR-0055](decisions/0055-indexed-png-auto-palette-completion.md));
`aseprite` sidecars carry the authored table.

**Palette scope is per drawing — palettes combine by composition**
([ADR-0050](decisions/0050-single-letter-palettes-combined-by-composition.md)). A scope
holds at most 52 keys *by design*; a drawing that needs more colours **stamps parts**,
each with its own palette scope — keys never cross scopes (`r` in `gem` and `r` in the
host are unrelated). The host's palette **artifact** folds deterministically: own entries
first (declaration order), then each stamped drawing's entries in first-stamp order,
deduplicated by colour (first wins); sidecars qualify colliding keys by source (`gem.r`).

```drw
pal:
  k = #1a1a1a
  y = oklch(0.78, 0.12, 75)
  r = #c04040
  t = lighten(r, 0.15)        # derived from another entry
```

Because colours are ordinary values, a palette name is just a name in scope — there is no
implicit palette generator or hidden ramp state. To pick a colour by index, index a normal
list: `cols = k, y, r` then `cols[i]`. A block-form `pal` may destructure an explicit
colour list into keys, preserving key order in the artifact:

```drw
pal:
  a, b, c = #cccccc.tones(-12%, 0%, 12%)
```

A `pal` may live in a `draw` (local) or a `theme`
(shared). Small palettes may use the **inline form** — one `pal` line of space-separated
`key=value` entries: `pal k=#1a1a1a  r=#c04040` (§7).

### Gradients

A `grad` is a **paint** (§8) — a colour that varies across a region. `linear`/`radial` are
**ordinary callees** in paren-form (the RHS of `=` is expression position, §3); a **stop**
is a colour, or a `(colour, position)` group for an explicit position:

```drw
grad sky  = linear(90, #4060ff, #ffd080)                       # 90° = top→bottom, even stops
grad fire = linear(0, (#000, 0%), (#f00, 60%), (#ff0, 100%))   # explicit stop positions
grad glow = radial(#fff, transparent)                          # OkLCh interpolation (default)
```

Use a gradient anywhere a `<paint>` is expected; it spans the **bounding box of the
region it paints**:

```drw
bg sky                       # gradient fills the whole canvas
rect fire 0:0 31:15 fill     # gradient fills the rect
```

In pixel mode a gradient is **ordered-dithered** to the target precision, so bands stay
crisp and deterministic — the authentic pixel-art look — rather than anti-aliased.

### Filters

A filter post-processes the current framebuffer (or a drawing). Apply built-ins as
commands:

```drw
outline k          # 1px outline around opaque pixels  (outline k 2 = 2px)
replace y r        # swap one colour for another
tint r 0.3         # blend everything toward r by 0.3
shadow 1:1 k       # whole-frame drop shadow, offset dx:dy, colour k (ADR-0070)
castShadow r 2:3 k # local region shadow (region-first)
shadow r 2:3 k     # equivalent local region shadow overload
grain 0.2 11 k     # texture over opaque pixels — amount then seed (ADR-0080)
grain sand 0.2 11 k # …confined to a region — optional leading region, likewise speckle/ripple/dither (ADR-0071)
speckle 0.1 17 k   # sparse marks over opaque pixels — density then seed
ripple 0.4 23 k    # horizontal bands over opaque pixels — strength then seed
dither k y 0.5     # Bayer-select two paints over opaque pixels
shadeRegion r sun #0c1830 0.6   # shadow veil: amount = opacity, deepest away from the light
lightRegion r sun #ffd08a 0.8   # additive light veil: brightest nearest the light
rim r 1:0 #ffffff80 1
ambientOcclusion r #000000 0.4
```

**Compositing semantics — read this before relying on a filter's pixel effect from syntax
alone (`check` cannot catch a wrong filter argument; it stays semantically silent):**

- **`shadeRegion r light base amount`** blends `base` as a shadow **veil** over `r`, with
  opacity **`base.a × amount × t`** where `t` = the pixel's distance from `light` normalized to
  the region's farthest corner. The pixel **at** the light (`t = 0`) is untouched; the far
  corner reaches `base.a × amount`. **`amount` is the veil opacity**, and it is a source-over
  blend, not a repaint — an **opaque `base` no longer erases detail** underneath, it just lets
  the far side reach the full `base` colour. `base`'s own alpha still multiplies (so `.alpha(…)`
  softens the veil further) ([ADR-0068](decisions/0068-shaderegion-veil-opacity-signature.md)).
- **`lightRegion r light paint amount`** is the additive mirror of `shadeRegion` ([ADR-0069](decisions/0069-additive-local-light-helper.md)):
  it blends `paint` as a light **veil** with opacity **`paint.a × amount × (1 − t)`** — **brightest
  nearest `light`** (up to `paint.a × amount`), fading to untouched at the far corner. `shadeRegion`
  darkens by `t`, `lightRegion` brightens by `1 − t`, so a shade/light pair aimed at the same
  point stay mirror-consistent.
- **`rim r dir p w`** lights the edge of `r` **facing away from `dir`** — e.g. `rim r 0:1 p`
  (direction pointing down, +y) lights the region's **top** edge; `rim r 1:0 p` (pointing
  right, +x) lights the **left** edge. Read `dir` as "the direction the light travels", not
  "the side that lights up".
- **`ambientOcclusion r p amount`** is a convenience for a **1px inner-boundary stroke** of
  `r` (§9's `stroke`, extensional 4-erosion) at `p`'s alpha × `amount` — not a soft occlusion
  gradient. Widen it by stacking calls at different `amount`s if a softer falloff is wanted.
- **`dither a b t`** is a **raw set, not a blend**: every opaque pixel of the target is
  overwritten with `a` or `b` (Bayer-selected by `t`), replacing whatever alpha was already
  there. A partner paint at `alpha(0%)` therefore punches a **transparency hole**, not a
  no-op. On small or radial fills the fixed 4×4 Bayer tile reads as a hard checkerboard
  rather than a smooth gradient — expect visible banding below roughly 16px.
- **All four shadow surfaces share one `[region] dx:dy paint` shape**
  ([ADR-0070](decisions/0070-unified-shadow-argument-shape.md)): the stamp flag
  `shadow dx:dy p` (§9), the whole-frame filter `shadow dx:dy p`, the local region form
  `shadow r dx:dy p`, and `castShadow r dx:dy p` — one `dx:dy paint` tail everywhere, a region
  leading when present. The offset is always an `dx:dy` **point**; the older whole-frame
  two-bare-number spelling `shadow dx dy p` was removed
  ([ADR-0088](decisions/0088-in-place-v1-break.md)) — use `dx:dy` everywhere.
- **`grain`/`speckle`/`ripple`/`dither` take an optional leading region**
  ([ADR-0071](decisions/0071-region-scoped-texture-filters.md)): `grain [r] amount seed p`,
  `speckle [r] density seed p`, `ripple [r] strength seed p`, `dither [r] a b t` — region-first
  like `castShadow`. The two numeric scalars are uniformly ordered **magnitude then seed**
  ([ADR-0080](decisions/0080-unified-texture-filter-argument-order.md)). With a region the effect is confined to it (intersected with any active
  mask and the opaque pixels); **without** a region each filter processes **every opaque pixel
  of the current framebuffer**, unchanged, and still respects an enclosing `mask …:` block. The
  leading argument is a region iff it evaluates to one, which never collides with the first real
  argument (a number for grain/speckle/ripple, a paint for dither).
- **The whole-frame `shadow dx:dy p` respects an enclosing `mask …:` block**
  ([ADR-0070](decisions/0070-unified-shadow-argument-shape.md)): it writes only
  mask-visible pixels (the silhouette is cast from the whole buffer but lands only inside the
  mask; masked-off pixels keep their content), matching the texture filters and the region
  shadow forms — so **every** filter under a `mask` block confines the same way.
- **Confining a filter to part of a scene** therefore has a simple path: give the filter a
  leading region (grain/speckle/ripple/dither), or wrap the call in a `mask …:` block — which
  works for the frame `shadow` too, not only the texture filters. The
  component-`draw` + `stamp` detour is no longer required for any of them. `castShadow r dx:dy p`
  and the region-form `shadow r dx:dy p` take an explicit region and need no confinement idiom
  at all.

Define a reusable pipeline with `filter` and run it with `apply`:

```drw
filter retro:
  replace y darken(y, 0.1)
  outline k

draw gem 4x4:
  pixels:
    .yy.
    yrry
    yrry
    .yy.
  apply retro
```

The built-in filter set is intentionally extensible — new filters are added as commands. Texture
filters and local lighting helpers are explicit, deterministic framebuffer operations
([ADR-0062](decisions/0062-scoped-shadow-and-texture-filters.md),
[ADR-0063](decisions/0063-explicit-local-lighting-helpers.md)); the shadow surfaces share one
argument shape and the frame `shadow` respects a `mask` block
([ADR-0070](decisions/0070-unified-shadow-argument-shape.md)), and the texture filters take an
optional leading region ([ADR-0071](decisions/0071-region-scoped-texture-filters.md)).

### Light & material

The `shadeRegion`/`lightRegion`/`rim`/`ambientOcclusion`/`shadow` primitives above are the
**floor**, but re-typing one light source as a point here, an inverted direction there, and a
`dx:dy` offset elsewhere lets the encodings drift. The **declarative** layer
([ADR-0086](decisions/0086-declarative-light-and-material.md)) is the default shading path: one
named **light** drives everything; a named **material** picks the *physics* (never the colour);
one `model`/`cel` command per object lowers to the primitives, coherently, and cannot drift.

```drw
light sun      = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # directional: source up-left, lit edge up-left
light torch    = at 12:8 #ffb060 gain 1.4          # point source at 12:8, 1.4× intensity
material steel = #8a95a5 metal                      # base colour + response (dose profile)

draw sword 24x48:
  lit sun:                 # scopes `sun` over the block body only
    model blade steel      # fill → shade → light → rim → AO → cast, all from `sun`
    model guard #b08040 metal   # inline COLOR RESPONSE (no named material needed)
    model grip  #3a2a1e     # bare colour ⇒ response `flat`
    cel  pommel steel 3     # crisp 3-band cel fill (ramp(base, 3), banded by distance from `sun`)
```

- **`light NAME = dir DX:DY COLOR [amb COOL AMT] [gain N]`** (directional) or **`light NAME = at
  X:Y COLOR …`** (point source) binds a first-class light — **no constructor parentheses**, the
  keyword signals the type. `dir DX:DY` is the light's *travel* direction (`dir 1:1` = moving
  down-right, so the source is up-left and the up-left edge is lit); `at X:Y` is a canvas
  position. `COLOR` is the warm light colour. `amb COOL AMT` is optional fill light (a cool
  colour + a `0..1` amount) that lifts shadows so they never go pure black; `gain N` scales every
  derived dose (default `1`). `dir`/`at`/`amb`/`gain` are keywords **only** in this binding — they
  stay ordinary bindable names everywhere else.
- **`material NAME = COLOR [RESPONSE]`** binds a material: a base colour plus a `RESPONSE ∈
  flat | metal | skin | cloth | glass | glow` that selects a **baked dose profile** (how far to
  shade, how tight a rim, how much AO/cast), never the colour. A bare colour with no response is
  `flat`. `glow` is self-illuminated (fill + inner light only — no shade/rim/cast). The response
  word is a keyword **only** in this trailing slot.
- **`lit L: body`** is a lexical block that scopes light `L` over its body only (set/restored like
  `mask …:`, no global state).
- **Resolution order** for a `model`/`cel` command, most-local first: an explicit `light L`
  argument → the enclosing `lit L:` block → the applied theme's **default** light (`§ Themes`,
  ADR-0086 tier 3). No light in **any** tier is a hard error (`E024`) — a light is always named and
  always visible, never a silent default. The theme default is how a front/side view pair or a
  colour variant shares **one** light without re-authoring it per view — the structural fix for the
  "light mirrored per view" bug.
- **`model REGION MATERIAL [light L]`** lowers `MATERIAL` under the scoped (or explicit `light L`)
  light onto the fixed sequence `fill → shadeRegion → lightRegion → rim → ambientOcclusion →
  cast shadow` — every point/direction/offset derived from the one light, zero-dose steps
  skipped. `MATERIAL` is a `material` value **or** an inline `COLOR [RESPONSE]`.
- **`cel REGION MATERIAL N`** fills `REGION` with `N` crisp cel bands from `ramp(base, N)`
  (even, hue-consistent, warm→cool), banded by distance from the light — a hard-edged
  alternative to `model`'s smooth veils.
- **Predictability.** `drawstic render <file>#<draw> --explain` prints the exact primitive
  expansion of every `model`/`cel` — colours, amounts, points, offsets all resolved — so an agent
  can predict the pixels and, if a baked dose doesn't fit, copy the expansion down to the raw
  primitives (which stay the public floor) and hand-tune.
- **Colour helpers** (usable directly, no new syntax): `litTone(base, light, amt)` (warm
  highlight), `shadowTone(base, cool, amt[, darken])` (darken + capped ≤~20° cool hue nudge, never
  cross-hue), `ramp(base, n)` (the even N-band tone list `cel`/`pixels:` want). See *Colour values*
  above.

### Themes — a dual artifact

A theme carries a **machine part** (palette, shared base drawings, the **canvas-size
default**, **render mode**, **text-font default**, and a **default light**) **and an LLM part**: a
natural-language **style guide**. The style guide is what makes many drawings *look like a set*. See
[ADR-0003](decisions/0003-themes-as-style-guides.md).

```drw
theme dusk:
  pal:
    k = #1a1a1a
    y = oklch(0.78, 0.12, 75)
    r = #c04040
  grad sky = linear(90, oklch(0.6, 0.15, 260), y)
  size 16x16                 # default canvas for size-less draws (§6); a local size wins
  mode pixel                 # crisp, no AA — the set's look (export may override)
  font small                 # default text face (§8); a per-text `font` flag wins
  light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # default light for every view/variant (§ Light & material)
  style """
    2px solid black outline on all silhouettes.
    Light from top-left; shadows use 'r', 1px dithered.
    Chunky, rounded forms. No anti-aliasing.
  """
```

A theme body holds only these forms — `pal:` / `grad NAME = …`, `size` / `mode` / `font` /
`light`, `style`, `with`, and `filter` / `draw` definitions. A theme's `light NAME = …`
([ADR-0086](decisions/0086-declarative-light-and-material.md)) folds like `size`/`mode`/`font`
(later wins) and becomes the drawing's **outermost** light — so every `model`/`cel` in every
drawing applying the theme shares one source unless a nearer `lit L:` block or `light L` argument
overrides it (`§ Light & material`, resolution order). The bound name is decorative; the value is
the default. A **free binding** written directly in the
body (a plain `accent = #d8a53a`, outside `pal:`) has nowhere to fold and is a positioned
**E004** at its declaration: put colours under `pal:` and other constants at **module scope**,
above the theme ([ADR-0081](decisions/0081-loop-persistent-rebinding-and-theme-scope-edges.md)).

### Composition with `with` (no inheritance)

Themes **compose**; they do not inherit. A theme lists its parts; the result is an
**ordered fold**, never a dispatch hierarchy — so the diamond problem cannot arise.
See [ADR-0005](decisions/0005-theme-composition-by-fold.md).

```drw
theme pixelBase:
  style "No AA. 2px black outline. Light top-left."

theme warmPal:
  pal:
    k = #1a1a1a
    y = oklch(0.78, 0.12, 75)

theme creatures:
  with pixelBase, warmpal      # order = merge order
  pal:
    g = #3a8a3a                 # adds / overrides
  style "Organic, rounded bodies. Eyes 1px white."
```

**Merge semantics (deterministic, linear):**

- **Order:** parts are flattened depth-first in declaration order, then folded
  left → right; **later wins**. Local definitions are folded last and always win.
- **Palettes, gradients, filters:** merged by name; on conflict the later source wins.
- **Style:** ordered concatenation of fragments (sectioned by source; identical
  fragments deduplicated).
- **Base drawings / canvas defaults:** by name, last wins.
- **Repeated parts** (a part reached via two paths) fold more than once: idempotent
  when values agree, deterministic (last-wins) when they differ. No MRO, no ambiguity.

### Applying a theme

```drw
use themes dusk                      # file-level default for all drawings here
```

Drawings then see the theme's palette entries as **ordinary bindings in scope**
([ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md)). A
drawing-local `pal`, `grad`, or `filter` overrides individual entries by name.

**Drawing-level `use`** ([ADR-0051](decisions/0051-drawing-level-use.md)) applies a theme
to **one drawing**: the same directive as leading line(s) of a `draw` body (any other
position is a positioned error). Fold order, later wins: file-level `use` → drawing-level
`use` → drawing-local `pal`/`grad`/`filter`. This is how one module mixes sets — a
dark-mode variant next to its siblings — without splitting files by theme:

```drw
use themes dusk                # file default

draw moonIcon 16x16:
  use themes midnight          # this drawing only: midnight's palette + defaults
  pal g = #7a86b8             # local override folds last, as always
  circle g 8:8 6 fill
```

---

## 13. Output — the `export` element

Content (`draw`, `path`, `tileset`, `atlas`) is separate from output. An `export` declares **what
artifacts** to materialize from a content item; the **CLI decides where** they go (disk or
stream). See [ADR-0006](decisions/0006-modules-and-content-output-separation.md).

```drw
export gem icons/gem:
  png  @1 @2 @3  z9          # gem.png, gem@2x.png, gem@3x.png; zlib level 9
  svg  ids classes           # element ids + CSS classes
  path                       # for path definitions: geometry SVG
  jpeg 512  q80  mode smooth # explicit 512px, quality 80, anti-aliased (override theme)
```

- `export <content> <base-path>:` then one line per output format. Source-first, then the
  **bareword** base path — position separates them, no quotes or connector; the per-format
  extension is appended (`png` → `<base>.png`)
  ([ADR-0019](decisions/0019-source-first-module-references.md)).
- **Scale / size:** `@N` = integer scale factor (nearest-neighbor for pixel mode);
  `512` or `512x512` = explicit pixel size.
- **HDPI:** `@1 @2 @3` emits `name.png`, `name@2x.png`, `name@3x.png`.
- **png:** `z0`..`z9` compression level; `indexed` writes an **indexed-colour PNG** whose
  palette contains every distinct rendered RGBA8 colour; a `pal` is not required. The
  deterministic order is transparent if present, then rendered colours that appear in the
  drawing's ordered palette artifact — combined across stamped parts (§12,
  [ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md),
  [ADR-0050](decisions/0050-single-letter-palettes-combined-by-composition.md)) — then any
  missing rendered colours in scanline order, top-to-bottom and left-to-right
  ([ADR-0055](decisions/0055-indexed-png-auto-palette-completion.md)). More than 256 final
  palette entries is a positioned error.
- **jpeg:** `qNN` quality.
- **svg:** flags `ids`, `classes`, `inlineStyles` (in pixel mode, pixels become
  `<rect>`s; in smooth mode, primitives map to shapes). A drawing's optional `title`/`desc`
  (§6) are emitted as SVG `<title>`/`<desc>` for icon accessibility.
- **path:** writes a geometry SVG for a `path` definition. Normal `svg` writes a rendered
  drawing SVG.
- **render mode:** a format line may override the theme's mode with `mode pixel` or
  `mode smooth` (anti-aliased); the default comes from the theme
  ([ADR-0013](decisions/0013-render-mode-pixel-vs-aa.md)).

**Tileset / atlas sidecars.** Exporting a `tileset` or `atlas` (§9) emits the baked `png`
plus an optional descriptor of the index/name → rect map. File names are fixed so multiple
descriptors never collide. See [ADR-0016](decisions/0016-tilesets-and-atlases.md).

| Format line | Emits | Applies to |
|-------------|-------|------------|
| `png` (alone) | `<base>.png` — the grid/packed sheet, engine-agnostic | both |
| `tiled` (`tiled xml`) | `<base>.tsj` / `<base>.tsx` — Tiled tileset | `tileset` only (uniform tiles) |
| `atlasJson` | `<base>.json` — TexturePacker/Phaser/Pixi frames map | both |
| `aseprite` | `<base>.aseprite.json` — Aseprite sheet | both |

```drw
export terrain tiles/terrain:
  png
  tiled                        # + terrain.tsj for the Tiled map editor

export hud atlas/hud:
  png                          # the packed sheet
  atlasJson                    # + hud.json  {frames:{play:{x,y,w,h}, …}}
  aseprite                     # + hud.aseprite.json
```

Animation frames fit naturally as a future `export` form — the core does not change.

---

## 14. Determinism

Drawstic guarantees **visual (pixel) determinism**, not byte determinism. See
[ADR-0007](decisions/0007-visual-not-byte-determinism.md) and the pipeline ADRs below.

- **Guaranteed (pixel mode):** the same Recipe yields a **pixel-identical framebuffer** across
  platforms ([ADR-0007](decisions/0007-visual-not-byte-determinism.md)).
- **Smooth mode** (AA, vector flattening) is deterministic and reproducible, but is more
  float-sensitive; the strong cross-platform guarantee is stated for
  pixel mode ([ADR-0027](decisions/0027-deterministic-numeric-and-colour-pipeline.md)).
- **Not guaranteed:** byte-identical PNG/JPEG files (compression may vary by encoder).
- **Golden tests compare pixels**, not file bytes.

This is **engineered**, not assumed:

- **Bundled deterministic math.** Every transcendental that can touch a pixel (`sin cos tan
  atan2 cbrt pow exp log`, colour conversion, Bézier flattening) uses the engine's own fixed
  implementation — **never host `Math.*`**, whose results differ across engines/platforms
  ([ADR-0027](decisions/0027-deterministic-numeric-and-colour-pipeline.md)). `+ - * /` and
  `sqrt` are IEEE-exact and used directly.
- **Pinned colour pipeline & compositing.** Exact oklch↔sRGB, fixed gamut mapping, shorter-arc
  hue, 8-bit round-half-up commit, and integer source-over alpha
  ([ADR-0025](decisions/0025-alpha-compositing-model.md)).
- **Pinned rasterization.** 4-connected `flood`, inclusive line endpoints, `circle` diameter
  `2r` for `r > 0`, silent out-of-bounds clipping, and NN stamp rotation (centre-pivot inverse
  mapping) ([ADR-0028](decisions/0028-rasterization-semantics.md),
  [ADR-0043](decisions/0043-arbitrary-angle-stamp-rotation.md)).
- **No ambient inputs.** No wall-clock, no locale; fixed, mode-scoped coordinate
  quantization — integers in pixel mode, the 1/16 subpixel grid in smooth mode (§5,
  [ADR-0040](decisions/0040-mode-scoped-coordinate-quantization.md)). Randomness
  is **pure seeded** only ([ADR-0026](decisions/0026-seeded-randomness-and-noise.md)).
- **Seeded blocks are deterministic.** `scatter <p> <n> <seed> <region>` (§11.1) enumerates the
  region's on-canvas pixels row-major and index-samples with `rand(seed, i)` — same seed + region
  + canvas → identical points on every platform ([ADR-0077](decisions/0077-scatter-block.md)).
  `mirror` (§11.2) re-executes its body with reflected pixel writes, so a seeded pass mirrors
  exactly ([ADR-0078](decisions/0078-mirror-block.md)).
- **One semantics.** There is a single, frozen engine semantics — the pipeline above is fixed,
  so nothing selects a variant. The `drawstic <N>` pragma is parsed but inert (§2,
  [ADR-0088](decisions/0088-in-place-v1-break.md)): `shadeRegion`'s `amount` is always the veil
  opacity (§12, [ADR-0068](decisions/0068-shaderegion-veil-opacity-signature.md)), the whole-frame
  `shadow` filter always honours an enclosing `mask …:` block (§12,
  [ADR-0070](decisions/0070-unified-shadow-argument-shape.md)), and the eight offset stamp anchors
  are always *visual* (resolved against the transformed footprint bbox, §9,
  [ADR-0072](decisions/0072-visual-stamp-anchors.md)).

---

## 15. Runtime budget (totality)

Every render runs under a **budget**: a maximum number of evaluation steps and a
maximum number of pixel writes. Exceeding it aborts with a clear, positioned error
rather than hanging. This is what makes the language **total** even though `while` and
recursion exist. The budget is configurable via the CLI with a sensible default.

---

## 16. CLI surface

| Command | Purpose |
|---------|---------|
| `drawstic check <file> [--lint] [--rows]` | parse + semantic validation; positioned errors; optional authoring warnings and row-width metadata. |
| `drawstic fmt <file> [--check] [--stdout] [--diff]` | canonical formatter (indentation, layout); idempotent; `--check` exits non-zero on unformatted input. |
| `drawstic context <file>` | emit the resolved **design brief** for the file (§ below), including export plans. |
| `drawstic build <file>` | run every `export` in the file, writing artifacts to disk. |
| `drawstic render <file>#<drawing>[(args)] [--png@2] [--stdout] [--ascii] [--preview] [--fit WxH] [--crop x:y WxH] [--inspect] [--grid N] [--diff <png>]` | ad-hoc render of one drawing; can stream. A parametric drawing takes literal arguments in the fragment — `file#house(#c04040, 3)` (number, color, string, point, boolean only; [ADR-0067](decisions/0067-render-fragment-literal-arguments.md)). `--ascii` = luminance-ramp grayscale text; `--preview` = half-block ANSI colour; `--inspect --json` emits render facts. `--grid N`/`--diff <png>` are debug-only PNG aids, below. |
| `drawstic sheet <file> [--all] [--cols N] [--png@N] [--out <path>] [--stdout] [--ascii] [--preview]` | family contact sheet ([ADR-0082](decisions/0082-sheet-contact-sheet-cli.md)): composes the selected drawings size-normalized into ONE labeled comparison grid for cross-drawing consistency QA (§ below). Default selection = the module's `export`ed drawings in export order; `--all` = every non-parametric drawing. Reuses the renderer; never part of `build`. |

**`--grid N` / `--diff <png>` — debug-only PNG aids.** Neither ever reaches `build`
exports, and both are inert whenever `--ascii`/`--preview`/`--inspect` also short-circuit
the render to a non-PNG output kind.

- `--grid N` burns a coordinate overlay into the PNG *output raster only*, as the last
  post-pass after `--crop` and the `--png@K` scale: gridlines every N *source* (recipe)
  pixels, plus edge coordinate labels giving each line's source-pixel coordinate. Lines are
  always exactly 1 *output* pixel thin and land on recipe-pixel boundaries — the line pitch
  scales with `--png@K` (`N * K` output pixels apart), but line width never does; label
  glyphs scale with `K` instead, so they read best at `--png@4`+. High-contrast strategy:
  every overlay pixel is a full RGB invert of the pixel underneath it, forced fully opaque —
  visible against any scene, unlike a fixed overlay colour that can vanish into a
  same-toned background.
- `--diff <png>` decodes a previous PNG (reusing the `import`-path decoder, §2) and diffs it
  against the fresh render, reporting `render.diff = {identical, changedPixelCount,
  totalPixelCount, changedBBox: {x, y, width, height} | null}` under `--json` (`changedBBox`
  is `null` iff `identical`), or a one-line `diff: N/M px changed, bbox x:y WxH` summary
  otherwise — a machine-checkable answer to "did this edit touch only the region I meant
  to?". The comparison always uses the fresh render's pixels **before** `--grid` is burned
  in, even when both flags are passed together — `--grid` is purely cosmetic on the PNG
  bytes written to disk and never participates in the diff. A dimension mismatch against the
  comparison PNG (e.g. a different `--png@N` or `--crop`) is a positioned `E023` diagnostic
  with a hint; an unreadable or undecodable comparison PNG is `E019`.

**`--inspect --json` — form-sanity stats.** Beyond the base facts (size, distinct color
count, alpha coverage bbox, opaque/transparent counts, occupancy grid), each `palette[]`
entry carries `opaquePixelShare`: the fraction of *opaque* output pixels whose committed
sRGB is nearest that entry's declared color (squared r/g/b distance; ties keep the
first-declared entry) — an attribution heuristic, not an exact-match count, since
gradients/filters/AA rarely composite back onto the exact declared color. `namedMasks[]`
reports `{name, bbox, coveragePixelCount, coverageFraction}` for every **module-scope**
`mask NAME = <region-expr>` binding (§9) — a mask declared inside the draw body itself is
drawing-local and never escapes the render call, so it is not visible here; `bbox`/coverage
are scanned against the actual (possibly `--crop`ped) canvas, and `coverageFraction` is
density *within the mask's own bbox*, not a fraction of the whole canvas. Separately,
every render kind's `render.stats.paletteCoveredPercent` (ADR-0031) is **near-meaningless
for procedural scenes today** — gradients/filters/`mix` routinely paint colors no `pal` key
ever declared — so prefer the per-key `opaquePixelShare` above for an actionable
breakdown.

**`--json` everywhere.** Every command accepts `--json`, emitting stable diagnostic records
`{severity, code, message, file, line, col, hint?}` (and `context` as JSON). Exit code is
non-zero iff any `error` diagnostic was produced — the agent's machine-readable correction
loop. See [ADR-0030](decisions/0030-structured-diagnostics-contract.md) and
[ADR-0031](decisions/0031-agent-loop-cli-preview-and-fmt.md).

**Authoring loop.** An agent should read `context --json` when imports/themes matter, edit the
recipe, run `check --json`, run `fmt --check`, then render the target drawing with `--ascii`
for small palette sprites or `--preview`/PNG for procedural drawings. For repository changes,
finish with `bun run test`. See [best-practices.md](best-practices.md#verification-loop).

### `context` — the design brief

`context` resolves all imports and theme composition for a file and emits **one flat
brief** the agent loads before editing — one deterministic tool call instead of N file
reads. See [ADR-0008](decisions/0008-cli-design-brief.md). It contains:

- the active theme: **merged palette** (key → hex + name) and **merged style guide**
  (sectioned by source theme),
- **available imported drawings** (name + `WxH` + optional ASCII preview),
- **available functions** (name + signature),
- **exports** (source name, output base path, formats and scale/size flags),
- cheap per-drawing authoring facts: size source, local palette keys, the drawing's own
  `themes` (draw-local `use` names) and effective folded `themePalette`, and fitted-preview
  hints for large drawings.

### `sheet` — the family contact sheet

`sheet` ([ADR-0082](decisions/0082-sheet-contact-sheet-cli.md)) resolves the family-consistency
gap: `render` rasterizes one drawing and `--diff` only compares a drawing to its own past, but an
icon family / tileset is a **cross-drawing** artifact whose radii, stroke weights, one light edge,
and grey-value/hue balance must agree across siblings. `sheet` composes every selected drawing at
its native size — each centered in a uniform cell (normalized to the largest drawing and widest
label) on a transparency checkerboard, framed with a 1px separator, captioned below in the bundled
`small` font — into one labeled grid.

- **Selection.** Default = the module's `export`ed drawings in export-declaration order; `--all` =
  every non-parametric drawing in definition order. Parametric drawings never render (no arguments).
  Two fallbacks avoid an empty sheet: a module with no exports, or an export set resolving to no
  renderable draw, both fall back to every non-parametric drawing; a module with genuinely no
  non-parametric drawing is `E022` (`no drawings to sheet`).
- **Output** follows `render`'s precedence (`--ascii` > `--preview` > PNG); `--png@N`/`--stdout`/
  `--out` behave as for `render`; default PNG path is `<file-basename>.sheet.png` in the cwd.
- **Layout** is fully deterministic (byte-identical PNG across platforms): `--cols N` (clamped to
  the tile count) or a `ceil(sqrt(n))` default; rows `ceil(n / cols)`; fixed palette/margins/gaps.
- **`--json`** reports layout, not pixels: `{diagnostics, sheet: {cols, rows, cell: {width,
  height}, width, height, cells: [{name, w, h, x, y}], kind, output}}`, where `x`/`y` are the tile's
  top-left in **unscaled** sheet coordinates (multiply by `--png@N` for output pixels).

### Lint warnings — `check --lint`

`check --lint` folds non-fatal authoring warnings into the same `W###`-coded diagnostic
record as every other check ([ADR-0030](decisions/0030-structured-diagnostics-contract.md)).
Every check is best-effort and conservative by design (src/lint.ts): a case that can't be
statically resolved (a dynamic expression, a parametric drawing, a draw-local name) is
skipped rather than guessed at, so a lint pass never produces a false positive.

| Code | Fires when | Fix |
|------|------------|-----|
| `W001` | a locally declared `pal` key is never used by `pixels:` or a paint expression | remove it or use it |
| `W002` | a drawing is neither `export`ed nor `stamp`ed from another drawing | export it or stamp it |
| `W003` | a `stamp`'s literal target at a literal point lands entirely outside the host canvas | move it on-canvas or drop it |
| `W004` | a procedural (no `pixels:`) drawing exceeds **128 px on either axis** (a square ceiling, so the canonical 48/64/128-px icon detail redraws stay silent) | preview with `render --preview --fit` |
| `W006` | a `dither` partner paint statically resolves to alpha 0 — `dither` is a raw set, not a blend (§12 Filters), so this punches a transparency hole | give the partner a visible alpha |
| `W007` | a `stamp` is fully covered by a later, provably opaque `stamp`/`rect …fill`/`bg` in the same drawing | reorder the stamps, or delete the dead one |
| `W008` | a `text` command's **literal** string contains character(s) that have no glyph in the resolved font (font resolution: per-`text` `font` flag > theme/draw/module directive > `small`), so they render silently as the unknown-glyph box | add the glyphs to the font, pick a font that has them, or drop them |
| `W009` | a `pixels:` grid's **last row** is fully transparent (`.`) while a row above it has content — because stamps place by the sprite's top-left corner, that trailing empty row silently enlarges the footprint and seams a 1px gap below adjacently stamped parts. Scoped to the last row only (never the first row, never a column — side-padding and top-centring are legitimate) | trim the trailing row, or account for the offset |

---

## 17. Grammar (normative)

The complete grammar, in three layers: **layout** (synthesized tokens), the **lexical
grammar** (tokens), and the **phrase grammar** (parser rules). The implemented parser may
factor rules differently, but must accept exactly this language. Pinned by
[ADR-0052](decisions/0052-complete-normative-grammar.md).

**Notation.** `UPPERCASE` = lexer token, `lowercase` = parser rule, `"…"` = literal keyword
or punctuation, `[x]` optional, `{x}` zero-or-more, `|` alternation, `N * x` exactly-N
repetition, `(* … *)` comment.

### 17.1 Layout layer

Three synthesized tokens carry the line/indentation structure of §3:

- **`NL`** ends a logical line. A *logical* line spans physical lines while a `(` is
  unclosed ([ADR-0032](decisions/0032-lexical-robustness.md)); blank lines and `#` comments
  emit nothing.
- **`INDENT` / `DEDENT`** bracket an indented block. Indentation is spaces-only,
  per-block-consistent; a tab in indentation is a positioned error (§3).

### 17.2 Lexical grammar

```ebnf
(* character classes *)
LETTER      = "a" … "z" | "A" … "Z" ;
DIGIT       = "0" … "9" ;
HEXDIGIT    = DIGIT | "a" … "f" | "A" … "F" ;

(* names — letters, digits, underscores; camelCase preferred; never a hyphen (D5) *)
NAME        = LETTER { LETTER | DIGIT | "_" } ;
KEY         = LETTER ;                    (* palette/pixel key: exactly one letter (§7, §12) *)

(* numbers — a literal needs a leading digit: 0.2, never .2 (§4) *)
INT         = DIGIT { DIGIT } ;
FLOAT       = INT "." INT ;
PERCENT     = ( INT | FLOAT ) "%" ;       (* % is only this suffix — never an operator (§10) *)
SIZE        = INT "x" INT ;               (* one token, no interior whitespace: 16x16 (§6) *)

(* colors & strings *)
COLOR       = "#" ( 3 * HEXDIGIT | 4 * HEXDIGIT | 6 * HEXDIGIT | 8 * HEXDIGIT ) ;
HEX         = HEXDIGIT { HEXDIGIT } ;     (* sha256 content pin (§2) *)
STRING      = '"' { ? any char except '"' or newline ? } '"'
            | '"""' { ? any char ? } '"""' ;                   (* multi-line (§3) *)

(* pixel rows — only inside a pixels: block; no SPACE, no trailing comment (§7) *)
PIXEL-ROW   = ( KEY | "." ) { KEY | "." } ;

(* paths — contextual: lexed only in path position (D4); segments may hyphenate (D5) *)
SEGMENT     = ( LETTER | DIGIT ) { LETTER | DIGIT | "_" | "-" } ;
MODULE-PATH = [ "./" | "../" { "../" } ] SEGMENT { "/" SEGMENT } ;  (* bareword, .drw implied (§2) *)
OUTPUT-PATH = MODULE-PATH ;                                    (* export base path (§13) *)
FILE-PATH   = MODULE-PATH "." NAME ;                           (* explicit extension: logo.png (§2) *)

(* numeric-suffix flags — contextual: only in flag position (D4) *)
AT-SCALE    = "@" INT ;                   (* @2 = HDPI scale (§13) *)
Z-FLAG      = "z" DIGIT ;                 (* z0..z9 = PNG compression (§13) *)
Q-FLAG      = "q" INT ;                   (* q80 = JPEG quality (§13) *)
W-FLAG      = "w" INT ;                   (* w2 = stroke width (§8) *)
ROT-FLAG    = "rot" ( INT | FLOAT ) ;     (* degrees, clockwise, any angle (§9, ADR-0043) *)
SCALE-FLAG  = "scale" INT ;               (* integer stamp scale (§9) *)

(* operators & punctuation *)
OP          = "=" | "+=" | "-=" | "*=" | "/=" | "==" | "!=" | ">=" | "<=" | ">" | "<"
            | "+" | "-" | "*" | "/" | "//" | ".." | "..=" | ":" | "," | "." | "!"
            | "&" | "|" | "(" | ")" | "[" | "]" ;
```

**Reserved words.** Only the words that can appear *inside an expression* are reserved
everywhere: `rel if then else true false transparent mod as`. (`by` was reserved as a leftover
of the removed drawing-global relative point; [ADR-0073](decisions/0073-palette-namespace-for-pixel-cells.md)
unreserved it — it is an ordinary bindable name.) Every other keyword is
**positional** — recognized by statement shape (`draw`, `pal`, `fill`, `tiles`, …) — and
the drawing commands and stdlib functions are predefined, unshadowable bindings
(§10, [ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md)), not
lexer keywords.

### 17.3 Disambiguation rules (pinned)

- **D1 — Block colon vs point colon.** A `:` that is the *last token of a logical line*
  introduces a block; every other `:` is the point separator. (`if p == 0:0:` parses:
  interior colon = point, final colon = block.)
- **D2 — Command-form argument boundary.** Command-form arguments are separated by
  **depth-0 whitespace**, where depth counts unclosed `(` and `[` — whitespace inside
  brackets never splits (`poly cols[row // 8 mod 3] 0:row w:row` has three arguments).
  The keyword-prefixed sequences in the phrase grammar (`transform t`,
  `tint k 0.3`, `mask m`, `font small`, `cap round`, `join bevel`, `mode smooth`,
  `sha256 hex`) each form one argument.
- **D3 — Match arms.** An arm's label ends at the *first* depth-0 `:` of the line, so a
  label is colon-free at depth 0 (parenthesize a point label: `(0:0): …`). The body is an
  inline simple statement or an indented block.
- **D4 — Contextual tokens.** The numeric-suffix flags, the path tokens, and the
  `drawstic` pragma word are recognized only in their grammar positions; elsewhere the
  same spellings are ordinary `NAME`s (`w2` may be a binding).
- **D5 — Hyphens live in paths, not names.** A `NAME` never contains `-`, so `-` is
  always the minus operator and needs no whitespace: `x-1` subtracts. Multi-word names
  are **camelCase** (`pixelBase`; snake_case is legal, camelCase preferred). Path
  *segments* — module file names, export base paths, imported file names — may contain
  hyphens (`from ui-parts eye`), but the names a module defines cannot.
- **D6 — `(` after a callee** opens an argument list; a `(` elsewhere groups
  ([ADR-0015](decisions/0015-unified-call-model.md)).
- **D7 — Keyword triple duty** (`font`, `mask`, `pal`, `size`) resolves by the token that
  follows the name: `=` → value binding, line-final `:` → definition/clip block,
  otherwise → directive or flag.
- **D8 — Dot.** After `.`: an integer is an index, a name is a UFCS call (§4, §10).
  Directly after a `.`, a numeric token is always lexed as `INT` — `xs.0.1` is
  `xs[0][1]`, never a float.

### 17.4 Phrase grammar

```ebnf
(* ───────────────────────── module structure ───────────────────────── *)

module         = [ version-pragma ] { top-stmt } EOF ;
version-pragma = "drawstic" INT NL ;                (* first line; pins semantics (§2, §14) *)

top-stmt       = from-stmt | use-stmt | size-dir | seed-dir | font-dir
               | binding | definition ;
definition     = draw-def | path-def | theme-def | fn-def | grad-def | filter-def | mask-def
               | light-def | material-def                              (* §12, ADR-0086 *)
               | font-def | image-import | tileset-def | atlas-def | export-def ;

from-stmt      = "from" MODULE-PATH import-item { "," import-item } NL ;  (* source-first (§2) *)
import-item    = NAME [ "as" NAME ] ;
use-stmt       = "use" [ MODULE-PATH ] NAME NL ;    (* 2 tokens = imported, 1 = local (§12) *)

size-dir       = "size" SIZE NL ;                   (* module- or theme-scope (§6) *)
seed-dir       = "seed" INT NL ;                    (* module- or draw-scope (§10) *)
font-dir       = "font" NAME NL ;                   (* module-, draw- or theme-scope (§8); D7 *)
mode-flag      = "mode" ( "pixel" | "smooth" ) ;
mode-dir       = mode-flag NL ;                     (* theme-scope (§12) *)

(* ───────────────────────── bindings & value defs ───────────────────────── *)

binding        = name-list "=" expr-seq NL          (* incl. destructuring: r, g, b = rgb *)
               | NAME ( "+=" | "-=" | "*=" | "/=" ) expr NL ;
name-list      = NAME { "," NAME } ;

fn-def         = "fn" NAME "(" [ name-list ] ")" "=" expr NL ;   (* first-order (§10) *)
grad-def       = "grad" NAME "=" expr NL ;          (* linear(…) / radial(…) paint (§12) *)
mask-def       = "mask" NAME "=" expr NL ;          (* region expression (§9) *)
light-def      = "light" NAME "=" ( "dir" | "at" ) point paint          (* Light value (§12, ADR-0086) *)
                 [ "amb" paint expr ] [ "gain" expr ] NL ;              (* dir/at/amb/gain: contextual (D7) *)
material-def   = "material" NAME "=" paint [ RESPONSE ] NL ;            (* Material value (§12, ADR-0086) *)
RESPONSE       = "flat" | "metal" | "skin" | "cloth" | "glass" | "glow" ; (* contextual keyword (D7) *)
image-import   = "import" NAME "=" FILE-PATH [ "sha256" HEX ] NL ;  (* PNG → drawing (§2) *)
filter-def     = "filter" NAME ":" NL
                 INDENT filter-cmd NL { filter-cmd NL } DEDENT ;    (* pipeline (§12) *)
path-def       = "path" NAME [ "(" [ name-list ] ")" ] [ SIZE ] ":" NL
                 INDENT path-cmd NL { path-cmd NL } DEDENT
               | "path" NAME [ "(" [ name-list ] ")" ] "=" expr NL ;
path-cmd       = "move" [ "rel" ] point
               | "line" [ "rel" ] point
               | "quad" [ "rel" ] point [ "rel" ] point
               | "bezier" [ "rel" ] point [ "rel" ] point [ "rel" ] point
               | "arc" [ "rel" ] point "around" point ( "cw" | "ccw" )
               | "close" ;

(* ───────────────────────────── drawings ───────────────────────────── *)

draw-def       = "draw" NAME [ "(" [ name-list ] ")" ] [ SIZE ] ":" NL
                 INDENT { use-stmt } { draw-stmt } DEDENT ;  (* `use` must lead (§6, §12) *)

draw-stmt      = pal-stmt | pixels-block | meta-stmt
               | seed-dir | font-dir                (* drawing-scoped directives (§8, §10) *)
               | grad-def | filter-def | mask-def   (* drawing-local overrides (§9, §12) *)
               | light-def | material-def           (* drawing-local light/material (§12, ADR-0086) *)
               | binding | control-stmt | mask-block | lit-block | call-stmt ;

meta-stmt      = ( "title" | "desc" ) STRING NL ;   (* SVG metadata (§6, §13) *)
mask-block     = "mask" expr ":" block ;            (* expr must evaluate to a Region (§9) *)
lit-block      = "lit" NAME ":" block ;             (* NAME must evaluate to a Light (§12, ADR-0086);
                                                       `lit` is contextual — a name elsewhere (D7) *)
block          = NL INDENT draw-stmt { draw-stmt } DEDENT ;

pal-stmt       = "pal" pal-entry { pal-entry } NL                 (* inline form (§7) *)
               | "pal" ":" NL INDENT pal-entry NL { pal-entry NL } DEDENT ;
pal-entry      = KEY "=" expr ;                     (* expr must be a colour (§12); in the
                                                       inline form it is whitespace-free (D2) *)
pixels-block   = "pixels" ":" NL INDENT PIXEL-ROW NL { PIXEL-ROW NL } DEDENT ;

(* ─────────────── call statements — the two surfaces (§3, ADR-0015) ───────────────
   Every call statement is written in either surface, interchangeably:
     command-form   callee arg { arg }              — statement position only;
                                                      args split at depth-0 whitespace (D2)
     paren-form     callee "(" arg { "," arg } ")"  — commas; may wrap lines (§3)
   The productions below list each command's argument sequence once; both surfaces
   apply. Trailing flags are bare arguments in either surface.                       *)

call-stmt      = ( draw-cmd | filter-cmd ) NL ;

draw-cmd       = "bg"      paint                     (* paint first everywhere (§8, ADR-0066) *)
               | "px"      paint point
               | "line"    paint point point stroke-flags
               | "rect"    paint point point draw-flags
               | "rrect"   paint point point expr draw-flags
               | "circle"  paint point expr draw-flags
               | "ellipse" paint point pair draw-flags
               | "arc"     paint point expr expr expr stroke-flags
               | "quad"    paint point point point stroke-flags
               | "bezier"  paint point point point point stroke-flags
               | "curve"   paint point point point { point } stroke-flags  (* through-points spline, ≥3 (ADR-0074) *)
               | "curvePoly" paint point point point { point } draw-flags  (* closed loop, region ctor, ≥3 (ADR-0075) *)
               | "profile" paint expr NAME [ expr ] draw-flags     (* filled fn silhouette; expr=span (range/list), NAME=fn, opt. baseline; fn gets normalized x (ADR-0076) *)
               | "poly"    paint point point { point } [ "fill" ]
               | "fill"    paint ( path-value | region )             (* eliminators (§8) *)
               | "stroke"  paint ( path-value | region ) stroke-flags
               | "text"    paint point STRING [ "font" NAME ]
               | "flood"   paint point
               | "stamp"   stampable point { stamp-flag }
               | "apply"   NAME ;                                   (* run a filter (§12) *)

draw-flags     = [ "fill" ] stroke-flags ;          (* trailing sugar for fill/stroke (§8, ADR-0039, ADR-0066) *)
stroke-flags   = [ W-FLAG ] [ "cap" ( "butt" | "round" | "square" ) ]
                 [ "join" ( "miter" | "round" | "bevel" ) ] ;  (* cap/join: smooth mode (§8) *)

stampable      = NAME [ "(" [ expr-seq ] ")" ]      (* plain or parametric drawing (§6) *)
               | NAME "." INT ;                     (* tileset member by index (§9) *)
stamp-flag     = "flipx" | "flipy" | ROT-FLAG | SCALE-FLAG          (* pinned sugar (§9) *)
               | "transform" expr | "tint" paint expr | "mask" NAME
               | "anchor" NAME | "shadow" point paint ;

filter-cmd     = "outline" paint [ expr ]           (* built-in filter set (§12); *)
               | "replace" paint paint              (* extensible — new filters   *)
               | "tint"    paint expr               (* follow the same shape      *)
               | "shadow"  point paint              (* whole-frame drop shadow: dx:dy (ADR-0070) *)
               | "shadow"  region point paint       (* local region shadow (ADR-0062) *)
               | "castShadow" region point paint
               | "grain" [ region ] expr expr paint (* optional leading region scope (ADR-0071) *)
               | "speckle" [ region ] expr expr paint
               | "ripple" [ region ] expr expr paint
               | "dither" [ region ] paint paint expr
               | "shadeRegion" region point paint expr
               | "lightRegion" region point paint expr
               | "rim" region point paint [ expr ]
               | "ambientOcclusion" region paint expr
               | "model" region material [ "light" NAME ]      (* declarative shading (§12, ADR-0086) *)
               | "cel" region material expr [ "light" NAME ] ; (* N-band cel fill; expr = band count *)
material       = NAME | paint [ RESPONSE ] ;        (* a `material` value, or inline COLOR [RESPONSE] *)

(* ───────────────────────────── control flow ───────────────────────────── *)

control-stmt   = if-stmt | match-stmt | repeat-stmt | for-stmt | while-stmt
               | scatter-stmt | mirror-stmt ;
if-stmt        = "if" expr ":" block [ "else" ":" block ] ;
match-stmt     = "match" expr ":" NL INDENT match-arm { match-arm } DEDENT ;
match-arm      = ( arm-label | "else" ) ":" arm-body ;
arm-label      = expr ;                             (* colon-free at depth 0 (D3) *)
arm-body       = call-stmt | binding | block ;      (* inline simple stmt, or block (D3) *)
repeat-stmt    = "repeat" expr ":" block ;
for-stmt       = "for" NAME range ":" block ;
range          = expr ( ".." | "..=" ) expr ;       (* half-open | inclusive (§11) *)
while-stmt     = "while" expr ":" block ;           (* budget-governed (§15) *)
scatter-stmt   = "scatter" NAME expr expr expr ":" block ;  (* NAME count seed region (§11.1, ADR-0077);
                                                       operand exprs are cmd-arg bounded (D2) *)
mirror-stmt    = "mirror" ( "x" | "y" ) "=" expr ":" block ; (* axis symmetry (§11.2, ADR-0078) *)
                                                    (* `scatter`/`mirror` are contextual — recognized
                                                       only in this header shape; both remain
                                                       ordinary bindable names elsewhere (D7) *)

(* ───────────────────────────── themes ───────────────────────────── *)

theme-def      = "theme" NAME ":" NL INDENT { theme-item } DEDENT ;
theme-item     = with-stmt | pal-stmt | style-stmt | size-dir | font-dir | mode-dir
               | grad-def | filter-def | draw-def ;                 (* §12 *)
with-stmt      = "with" name-list NL ;              (* compose parts, ordered fold (§12) *)
style-stmt     = "style" STRING NL ;                (* "…" or """…""" *)

(* ──────────────────────── user-defined fonts ──────────────────────── *)

font-def       = "font" NAME [ SIZE ] ":" NL INDENT { font-item } DEDENT ;  (* §8 *)
font-item      = "with" NAME NL                     (* fallback face, fold (§8) *)
               | "glyph" STRING NAME NL             (* one character → one drawing *)
               | "glyph" STRING [ SIZE ] ":" NL INDENT { draw-item } DEDENT
                                                        (* inline glyph; SIZE defaults to font SIZE *)
               | "glyphs" NAME STRING NL            (* bulk: tileset → characters *)
               | "tracking" INT NL
               | "lineheight" INT NL ;

(* ─────────────────────── tilesets & atlases ─────────────────────── *)

tileset-def    = "tileset" NAME SIZE ":" NL INDENT { tileset-item } DEDENT ;  (* §9 *)
tileset-item   = "tiles" name-list NL | "cols" INT NL ;
atlas-def      = "atlas" NAME ":" NL INDENT { atlas-item } DEDENT ;
atlas-item     = "sprites" name-list NL | "pad" INT NL | "place" NAME point NL ;

(* ───────────────────────────── exports ───────────────────────────── *)

export-def     = "export" NAME OUTPUT-PATH ":" NL
                 INDENT format-line { format-line } DEDENT ;        (* §13 *)
format-line    = "png"  { out-size | Z-FLAG | "indexed" | mode-flag } NL
               | "svg"  { "ids" | "classes" | "inlineStyles" | mode-flag } NL
               | "jpeg" { out-size | Q-FLAG | mode-flag } NL
               | "path" NL
               | "tiled" [ "xml" ] NL               (* tileset sidecar: .tsj / .tsx (§13) *)
               | "atlasJson" NL
               | "aseprite" NL ;
out-size       = AT-SCALE | INT | SIZE ;            (* @N | 512 | 512x512 (§13) *)

(* ───────────────────────────── expressions ───────────────────────────── *)

expr-seq       = expr { "," expr } ;                (* bare list literal (§3, §4) *)
expr           = if-expr | or-expr ;
if-expr        = "if" expr "then" expr "else" expr ;  (* both branches required (§10) *)
or-expr        = and-expr { "|" and-expr } ;
and-expr       = not-expr { "&" not-expr } ;
not-expr       = "!" not-expr | comparison ;
comparison     = sum [ ( "==" | "!=" | ">=" | "<=" | ">" | "<" ) sum ] ;
sum            = term { ( "+" | "-" ) term } ;
term           = point { ( "*" | "/" | "//" | "mod" ) point } ;
point          = point-coord [ ":" point-coord ] ;   (* absolute point | plain value *)
point-coord    = "-" point-coord | postfix ;         (* group arithmetic coords: (x+1):(y+1) *)
postfix        = atom { postfix-op } ;
postfix-op     = call-args                          (* "(" immediately after callee (D6) *)
               | "[" expr "]"                       (* bracket index — any expr (§4) *)
               | "." INT                            (* dot index — literal only (§4, D8) *)
               | "." NAME [ call-args ] ;           (* UFCS method call (§10, D8) *)
call-args      = "(" [ expr-seq ] ")" ;             (* n exprs = n arguments (ADR-0015) *)
atom           = INT | FLOAT | PERCENT | COLOR | STRING
               | "true" | "false" | "transparent"
               | NAME | "(" expr-seq ")" ;          (* parens group or nest (§3) *)

(* semantic aliases — same surface as expr, constrained by the type check (§4, §10) *)
paint          = expr ;                             (* must be a colour or gradient (§12) *)
region         = expr ;                             (* must be a Region (§4, §9) *)
path-value     = expr ;                             (* must be a Path (§4, §8) *)
pair           = point ;                            (* rx:ry — no "by" (§8) *)
```

### 17.5 Fixes over the previous sketch

Formalizing the sketch surfaced these gaps and ambiguities, resolved above (recorded in
[ADR-0052](decisions/0052-complete-normative-grammar.md)):

- **Module scope was missing `binding`** — §10 allows module-level constants (`TILE = 16`).
- **`draw-stmt` was missing** the drawing-local `grad`/`filter`/`mask =` definitions
  (§9, §12), the drawing-scoped `seed`/`font` directives (§8, §10), and `title`/`desc` (§6).
- **The block-vs-point colon** had no rule → D1 (line-final colon opens the block).
- **Command-form argument boundaries** were unstated → D2 (depth-0 whitespace).
- **Hyphenated names vs the minus operator** were never reconciled → D5 (names are
  hyphen-free camelCase, so `-` is always the operator; path segments keep their hyphens).
- **Match-arm bodies** (inline vs block) were unpinned → D3.
- **`fmtline`, the inline `pal` form, `if`'s `else`, and the flag tokens** were undefined —
  now fully specified.

---

## 18. Open questions for review

Choices made here that are most worth your scrutiny:

1. **Resolved ([ADR-0015](decisions/0015-unified-call-model.md)) — separators & lists.**
   Whitespace separates command-form arguments; comma separates the elements of a
   comma-sequence (paren-form arguments/params, or a list literal). A `(` after a callee is
   an argument list, elsewhere it groups — so `f(a, b, c)` is a **3-argument call**, and a
   single list is passed via a binding (`xs = a, b, c` on one line, then `f(xs)`). No list
   bracket.
2. **Resolved ([ADR-0015](decisions/0015-unified-call-model.md)) — one call, two surfaces.**
   `f a b c` ≡ `f(a, b, c)`: command-form (statement position only) is the terse idiom,
   paren-form is required in expression position. Backed by the bench — paren-form
   everywhere costs ~+13 % tokens and roughly doubles symbol density.
3. **Resolved — both conditional forms stay.** They are not redundant: the expression form
   is *required* in expression position (`c = if x > 15 then y else r`), the block form is
   *required* for multi-statement bodies — dropping either creates a gap, not simplicity.
   Same two-surface logic as [ADR-0015](decisions/0015-unified-call-model.md); the bench
   (`if-forms-checker`) shows the expression form is also −6.9 % tokens where usable.
4. **Resolved — `pixels:` stays explicit** (renamed from `grid:`,
   [ADR-0041](decisions/0041-rename-grid-block-to-pixels.md)). Implicit "body is a pixel
   literal if it has no commands" would let a stray command line silently reinterpret every
   row — exactly the silent-misparse class that error-robustness (priority 2) forbids. One
   line is the price.
5. **Resolved — coordinate rounding stays half-up, now mode-scoped.** Half-up is pinned and
   version-frozen ([ADR-0027](decisions/0027-deterministic-numeric-and-colour-pipeline.md),
   [ADR-0029](decisions/0029-language-version-pragma.md)); `floor` would bias drift
   down-left. Pixel mode snaps to integers; smooth mode snaps to the 1/16 subpixel grid so
   AA geometry keeps sub-pixel precision
   ([ADR-0040](decisions/0040-mode-scoped-coordinate-quantization.md)). Indices, by
   contrast, never coerce ([ADR-0037](decisions/0037-floored-division-and-integer-indices.md)).
6. **Resolved — no `sprite` alias.** One name per concept: an alias splits the corpus the
   model learns from and adds a synonym decision to every recipe — idiom alone never
   justifies a marker ([ADR-0018](decisions/0018-idiom-alone-does-not-justify-a-marker.md)).
7. **Re-resolved ([ADR-0051](decisions/0051-drawing-level-use.md)) — `use` is also
   drawing-level.** Leading line(s) of a `draw` body apply a theme to that drawing only;
   fold order file-level `use` → drawing-level `use` → local `pal`/`grad`/`filter`, later
   wins. Mixed-theme modules no longer force file splits — the evidence Q7 waited for.
8. **Resolved — colours are first-class values** (hex / `oklch()` / `lighten()` / …), so
   gradients and colour operations work and `ramp` is gone (see
   [ADR-0009](decisions/0009-first-class-colours-gradients-filters.md)). Palette entries
   are named colours in scope; a single char is a pixel key **only inside `pixels:`**.
   *Re-resolved ([ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md),
   superseding [ADR-0033](decisions/0033-evaluation-and-scope-model.md) point 5):* there is
   **one namespace** — palette entries are **const, reserved colour bindings** (a value binding
   may not shadow a palette entry; a `pal` entry may shadow a non-palette binding —
   [ADR-0073](decisions/0073-palette-namespace-for-pixel-cells.md); the theme fold is the other
   override channel), and a non-paint value in a paint slot is a positioned type error. The
   palette is additionally
   an **ordered export artifact** (`png indexed`, `aseprite`); for `png indexed`, it is now
   the priority prefix for rendered colours, not a complete-colour requirement
   ([ADR-0055](decisions/0055-indexed-png-auto-palette-completion.md)).
9. **Resolved ([ADR-0033](decisions/0033-evaluation-and-scope-model.md)) — mutability.** `+=`
   is kept for bounded loop accumulators (mutates an in-scope binding only); totality is
   guarded by the budget (§15), not by banning mutation. *Refined
   ([ADR-0081](decisions/0081-loop-persistent-rebinding-and-theme-scope-edges.md)):* a plain
   `=` likewise reassigns an existing mutable binding in the enclosing draw scope (loop-
   persistent), and only declares a fresh binding when none is reachable — bounded to the draw
   body so no block mutates module scope.
10. **Resolved ([ADR-0034](decisions/0034-standard-library.md)) — standard library.** A fixed,
    total, deterministic built-in set (math + `len` + seeded `rand`/`noise`); see §10.
11. **Resolved ([ADR-0061](decisions/0061-first-class-paths-and-local-pen-cursors.md)) —
    the drawing-global cursor is removed.** Cursor state exists only inside first-class
    `path` definitions; drawing commands are explicit geometry.
12. **Resolved — mask set-ops stay UFCS** (`a.union(b)`), not symbolic (`a | b`). The bench
    (`mask-setops-symbolic-vs-ufcs`) measured **zero** token difference, so there is nothing
    to buy by overloading `&`/`|` — they stay logic-only ([ADR-0012](decisions/0012-masks-and-path-combination.md)).

**Newly specified (2026-06-17).** A review pass closed the main gaps: text & bundled fonts
([ADR-0022](decisions/0022-text-and-bitmap-fonts.md)), curves/stroke
([ADR-0023](decisions/0023-curve-and-shape-primitives.md)), parametric drawings
([ADR-0024](decisions/0024-parametric-drawings.md)), alpha compositing
([ADR-0025](decisions/0025-alpha-compositing-model.md)), seeded noise
([ADR-0026](decisions/0026-seeded-randomness-and-noise.md)), the deterministic numeric/colour
pipeline ([ADR-0027](decisions/0027-deterministic-numeric-and-colour-pipeline.md)),
rasterization semantics ([ADR-0028](decisions/0028-rasterization-semantics.md)), the version
pragma ([ADR-0029](decisions/0029-language-version-pragma.md)), the diagnostics contract &
agent-loop CLI ([ADR-0030](decisions/0030-structured-diagnostics-contract.md),
[ADR-0031](decisions/0031-agent-loop-cli-preview-and-fmt.md)), lexical robustness
([ADR-0032](decisions/0032-lexical-robustness.md)), the scope model
([ADR-0033](decisions/0033-evaluation-and-scope-model.md)), the standard library
([ADR-0034](decisions/0034-standard-library.md)), and the import sandbox + `std/`
([ADR-0035](decisions/0035-import-sandbox-and-std-modules.md)). **Most worth scrutiny:**
ADR-0027 (bundled math is the load-bearing determinism claim) and ADR-0024 (parametric draws
reshape how a set is authored).

**Consistency pass (2026-07-04).** A full-language review unified shapes as **region
constructors** — one `circle` for statements and mask expressions, paint = leading draw
argument ([ADR-0036](decisions/0036-shapes-as-region-constructors.md), later made paint-first
by [ADR-0066](decisions/0066-paint-first-painting-commands.md)) — added floored `//`/`%` and
strict integer indices ([ADR-0037](decisions/0037-floored-division-and-integer-indices.md)),
pinned path-local cursors and first-class paths ([ADR-0061](decisions/0061-first-class-paths-and-local-pen-cursors.md)),
moved gradients to ordinary paren-form callees (§12), and resolved open questions 3–7, 11
and 12 above. A second pass completed the **region algebra** — `fill`/`stroke` eliminators
(the leading paint is now *defined* as their sugar), `.shift`/`.scale` placement, the
`region(d)` silhouette bridge, extensional stroke semantics, and first-order-only functions
([ADR-0039](decisions/0039-region-algebra-constructors-combinators-eliminators.md)); the
hand-pixel block was renamed `grid:` → `pixels:`
([ADR-0041](decisions/0041-rename-grid-block-to-pixels.md)). Transforms were then unified
as a **first-class value** — matrix-backed, `.about(pt)` anchors, reading-order
composition, projective 3D, one syntax for stamps and regions — with the stamp flags and
region `.shift`/`.scale` as pinned sugar ([ADR-0044](decisions/0044-first-class-transforms.md)),
and external images joined as first-class inputs — `import name = file.png`, PNG-only for
exact decode, sandboxed, optionally content-pinned
([ADR-0045](decisions/0045-import-external-images-as-drawings.md)). Finally the scope model
was flattened to **one namespace**: palette entries are **const, reserved** colour
bindings (collisions are hard errors both ways; the theme fold is the only override
channel), paint slots type-check, and the palette doubles as an ordered export artifact
(`png indexed`; completed from rendered colours by
[ADR-0055](decisions/0055-indexed-png-auto-palette-completion.md))
([ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md)); pixel keys
were briefly opened to Unicode ([ADR-0047](decisions/0047-unicode-pixel-keys.md)), then
rolled back to a **fixed expression-safe set** — one ASCII letter per cell, every key an
ordinary binding, `.` the built-in transparent cell, so no table-only tier remains
([ADR-0049](decisions/0049-ascii-letter-pixel-keys.md)) — and palette names were pinned to
exactly those single letters, with per-drawing key scopes and combined palette artifacts
via stamp composition
([ADR-0050](decisions/0050-single-letter-palettes-combined-by-composition.md)); and modulo
became the infix keyword **`mod`**, leaving `%` exclusively the percent suffix — no
whitespace-dependent operator reading remains
([ADR-0048](decisions/0048-mod-keyword-percent-suffix-only.md)).
