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
| `atlas`  | `atlas …:`  | N drawings baked into one image plus a name-addressed rect map; `tile WxH` opts into a uniform grid (§9, [ADR-0096](decisions/0096-language-freeze-for-1-0.md) §3 — merges the former `tileset`). |
| `theme`  | `theme …:`  | palette + style guide + shared parts (§12). |
| `fn`     | `fn …`      | a value-returning function (§10). |
| `gradient`   | `gradient …`    | a gradient paint value (§12). |
| `filter` | `filter …:` | a reusable post-process pipeline (§12). |
| `font`   | `font …:`   | a glyph mapping — characters → drawings (§8, [ADR-0042](decisions/0042-user-defined-fonts.md)). |
| `mask`   | `mask …`    | a coverage region for clipping (§9). |
| `image`  | `image … = …` | an **external image** (PNG) as a drawing — stampable, transformable, exportable ([ADR-0045](decisions/0045-import-external-images-as-drawings.md)). |
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
- **External images** enter as definitions — `image logo = ../brand/logo.png` — binding a
  **PNG file** (exact, lossless decode; explicit extension) as an ordinary drawing under the
  same sandbox rules; an optional trailing `sha256 <hex>` pins the file's content
  (mismatch = positioned error). JPEG is rejected on import: its decoding is not bit-exact
  across platforms ([ADR-0045](decisions/0045-import-external-images-as-drawings.md)).

**Language version.** There is no version pragma. The `drawstic <N>` first-line directive
([ADR-0029](decisions/0029-language-version-pragma.md)) was inert since
[ADR-0088](decisions/0088-in-place-v1-break.md) — the language has exactly one semantics, so
no `N` ever selected anything — and was removed outright in
[ADR-0096](decisions/0096-language-freeze-for-1-0.md): a leading `drawstic <N>` line is now a
positioned error naming the removal. Delete the line from any file that still opens with it.

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
    `k = #1a1a1a`, `gradient sky = …`, `mask m = …`, `fn area(r) = …`). Scan for `=` to find
    every definition; a leading `kind` keyword only tags the binding's type.
  - **Block** `kind name … :` + indent — opens a **structured body** (`draw`, `theme`,
    `export`, `filter`, `atlas`, `if`/`for`/`match`).
  - **Directive** `verb args` — performs an **action**, introduces no name (`circle k 8:8 6`,
    `sprites grass, dirt`, `with warmPal`).

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
  atlas layout — coerce to integers in **both** modes.
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
   a module-level `size` overrides the theme's, as a local `palette` overrides a theme palette.
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
- a `palette …` line (a drawing-local palette, if no theme is applied; §12),
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
  palette k=#1a1a1a r=#c04040    # inline form: space-separated key=value entries
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
  `palette` is a positioned error ([ADR-0049](decisions/0049-ascii-letter-pixel-keys.md)).
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
  canvas-size bindings (§5), but a local `palette w=…` / `palette h=…` is allowed and **shadows** the
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
`rect`/`rrect`/`circle`/`ellipse`/`poly`/`curvePoly`/`dome`/`lobe`/`crescent`/`ribbon` construct a **Region** (§4); at statement position a
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
| `bg`    | `bg <paint>` | fill the whole canvas |
| `px`    | `px <paint> <pt>` | set one pixel |
| `line`  | `line <paint> <a> <b>` | explicit Bresenham segment from `a` to `b` |
| `rect`  | `rect <paint> <a> <b> [fill]` | rectangle (corners `a`,`b`) |
| `rrect` | `rrect <paint> <a> <b> <r> [fill]` | rounded rectangle, corner radius `r` |
| `circle`| `circle <paint> <center> <r> [fill]` | circle region — covers an even `2r` pixel diameter for `r > 0` (`c−r … c+r−1` per axis, disc centred at the pixel-corner `c−0.5`); `r=0` is one pixel |
| `ellipse`| `ellipse <paint> <center> <rx>:<ry> [fill]` | ellipse region — `circle` with independent `rx`/`ry`: the **same** even-diameter, corner-centred convention (`c−rx … c+rx−1` × `c−ry … c+ry−1`); a circle is exactly the `rx==ry` ellipse, a zero axis is a 1px line ([ADR-0087](decisions/0087-anchored-assembly.md), supersedes the old odd `2r+1` rule) |
| `arc`   | `arc <paint> <center> <r> <a0> <a1>` | circular arc, degrees (0°=+x, clockwise) |
| `quad`  | `quad <paint> <p0> <c1> <p2>` | quadratic Bézier |
| `bezier`| `bezier <paint> <p0> <c1> <c2> <p3>` | cubic Bézier |
| `curve` | `curve <paint> <p1> <p2> <p3> … [w<N>]` | open Catmull-Rom spline **through** the points (≥3; centripetal, [ADR-0074](decisions/0074-curve-through-points-spline.md)) |
| `curvePoly`| `curvePoly <paint> <p1> <p2> <p3> … [fill]` | closed Catmull-Rom loop through the points — fillable organic mass; a Region without paint (≥3; [ADR-0075](decisions/0075-curvepoly-closed-curve-region.md)) |
| `profile`| `profile <paint> <span> <fn> [<baseline>] [fill]` | filled silhouette under `y = f(x)`, sampled once per column; `fn` gets normalized x∈[0,1]; a Region without paint ([ADR-0076](decisions/0076-profile-filled-function-silhouette.md)) |
| `poly`  | `poly <paint> <p1> <p2> … [fill]` | polyline / polygon (explicit vertices) |
| `dome`  | `dome <paint> <center> <rx>:<ry> [fill]` | dome / cap: the upper half of the same-parameter `ellipse` with a flat bottom edge (rows `cy−ry … cy−1`; `center` is the flat base midpoint) — skull, helmet, hat crown ([ADR-0093](decisions/0093-organic-region-constructors-figure-oracle-quantize.md)) |
| `lobe`  | `lobe <paint> <base> <tip> <w> [fill]` | teardrop: round cap of diameter `w` at `base` tapering to a point at `tip` — ear, hair strand, side nose, plume, hat tassel |
| `crescent`| `crescent <paint> <center> <rx>:<ry> <thick> <dir> [fill]` | crescent/lune: outer ellipse minus an inner one `thick` px smaller and shifted `thick` px toward `dir`; thickest opposite `dir`, tapering to nothing on the `dir` side — hair fringe, brim curve, eyelid |
| `ribbon`| `ribbon <paint> <p0> <p1> <p2> <w> [fill]` | constant-width `w` ribbon along the quadratic arc through the three points — curved hat band, belt; **stacked = turban wraps** |
| `fill`  | `fill <paint> <region>` | rasterize any region expression solid (§9, [ADR-0039](decisions/0039-region-algebra-constructors-combinators-eliminators.md)) |
| `stroke`| `stroke <paint> <region> [w<N>]` | rasterize a region's inner boundary, width `N` (default 1) |
| `text`  | `text <paint> <pt> <string> [font <name>]` | bitmap text, top-left at `<pt>` |

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
  glyphs digits "0123456789"   # bulk: i-th member of a uniform-tile atlas → i-th character
  tracking 1               # optional; default 1
  lineheight 8             # optional; default glyph height + 1
```

Glyph **heights must agree**; widths may vary — the advance is *width + tracking*, so
proportional faces work and monospace is the special case. Rendering blits the glyph
drawings like `stamp` (alpha-honouring), so path-drawn glyphs get AA edges in smooth mode;
an unmapped character renders the missing-glyph box. Glyph drawings must be
non-parametric. Inline glyph bodies bind `k` to the `text` command's paint.

**Stroke width.** Any stroking command takes an optional trailing `w<N>` token (default 1):
`line k 0:0 10:0 w2`, `circle k 8:8 6 w2` — mirroring `scale<N>` (§9). A width-`N` stroke stamps
a uniform round-cap/round-join disk brush along the path in both modes — the only brush the
engine has ever rendered. `cap butt|round|square` / `join miter|round|bevel` trailing flags
were removed: they parsed (and `cap` additionally swallowed the next argument) but the geometry
behind them was deferred indefinitely and never rendered, so they are now a positioned error
naming the removal ([ADR-0096](decisions/0096-language-freeze-for-1-0.md) §1). See
[ADR-0023](decisions/0023-curve-and-shape-primitives.md).

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

**Curve determinism.** `arc`/`quad`/`bezier`/`curve`/`curvePoly` are flattened and
rasterized by a *fixed* rule (each curve span → `clamp(ceil(chord), 4, 64)` segments for the
Catmull-Rom curves, chord via the bundled `dhypot`), and `arc` uses the engine's **bundled
deterministic trig** — never host `Math.*` — so results are pixel-identical everywhere (§14,
[ADR-0027](decisions/0027-deterministic-numeric-and-colour-pipeline.md)). `profile` is
deterministic too: integer x per column, `round f(x)` for the top row, and the dmath the `fn`
body calls — no host `Math.*` on the pixel path. Line endpoints are inclusive
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

### Anchored assembly — `pin` / `fit` ([ADR-0087](decisions/0087-anchored-assembly.md))

```drw
pin <key> <pt>                         # declare a named attach point in this drawing's space
fit <partB>[.<pin>] <partA>.<pin> [flags] [ground]   # place partB so its pin lands on partA's pin
fit <partB>.<pin> <x:y> [flags] [ground]       # ground-placement oracle: pin lands on a computed point
```

Instead of computing a `stamp` point by hand — which guarantees nothing about the *result*, since
a bbox overlap is not pixel contact — a part **declares named attach points** and the engine
**solves the placement and guarantees contact**:

- **`pin <key> <pt>`** registers a named point in the current drawing's coordinate space. In a
  **part** draw the key is a bare name (`pin shoulder 4:0`); it is exported on the rendered
  drawing, so an assembler can read it. In an **assembly** the key is a dotted `part.name`
  (`pin torso.shoulder 16:14`) that seeds a **canvas-space** attach point. When `part` names an
  already-drawn part sprite that owns that pin, this seeds **all** of the part's pins from the one
  anchor — so a later `fit …torso.hip` chains without re-declaring it (a bare hand-label like
  `a.spot`, whose head is not a part, still registers just that one key).
- **`fit partB.pin partA.pin`** places `partB` so its named pin lands *exactly* on `partA`'s
  already-placed pin — a contact-guaranteed replacement for a hand-stamped socket-offset. It then
  registers `partB`'s pins in canvas space, so the next `fit` chains off them
  (`fit hand.wrist arm.wrist`). When each side has one pin of the same name, the shorter
  `fit partB partA` **auto-matches** it. A named pin absent on one side is a positioned error.
- **Transform flags — the pin rides the transform.** `fit` takes the same modifiers as `stamp`
  (`flipx`/`flipy`/`rotN`/`scaleN`/`transform t`/`tint c p%`/`mask r`) **except `anchor`** — the
  pin already *is* the anchor, so an `anchor` flag on `fit` is a positioned error
  ([ADR-0096](decisions/0096-language-freeze-for-1-0.md) §1; it used to parse and be silently
  ignored). Flags apply to the part about its footprint centre. The pin still lands *exactly* on
  the target (the engine solves
  `origin = target − M(pin)`) and the part's **other** pins are registered through the same `M`, so
  a pin on the left shoulder becomes the correctly-located right shoulder after `flipx`. This makes
  the depth-tint far-limb idiom (`fit armFar.shoulder a.shoulder tint #2b2b2b 45%`) and mirrored
  side/back assembly reliable.
- **Placement self-check.** Contact is not correctness: `fit` also measures how far the target pin
  sits from the part's **own ink**. A pin in empty part space (a chin below the head, a hand off the
  sleeve) lands the join floating even though the pins coincide — a non-fatal **`W011` loose-pin
  warning** with the exact gap, distinct from the `W010`/C007 contact gap. `render --explain` prints
  a per-`fit` placement line — where each pin landed, whether they coincide, and the pin-to-ink gap —
  so a misplacement is *visible*, not silently green.
- **Contact guarantee.** Checked against the drawing's **final composite**, once the whole `draw`
  body has painted — not at `fit`-statement time — so deliberate back-to-front layering (e.g.
  fitting feet before the covering robe is stamped over them, closing the seam) never false-warns
  just because the covering part hadn't painted yet at the moment of the `fit`. `fit` checks that
  the part touches content *other than itself* (pixel overlap or 8-adjacency) by the end of the
  body. No contact ⇒ a non-fatal **`W010` gap warning** (the same seam the `critique` **C007**
  check measures) — never a silent float. It surfaces in the `diagnostics` of every render path:
  `render`, `build`, and `sheet` (JSON and human output).
- **Ground-placement oracle.** A `fit` whose source is a **computed point** plants a part on a
  terrain function: `fit tree.base x:duneY(x/(w-1))` (scene-craft §2's *"terrain is a function"*
  formalized) makes floating/sinking structurally impossible. A point source needs a named target
  pin.
- **`ground`** drops an auto contact-shadow ellipse under the part's footprint bottom (the feet)
  first, so feet overdraw it — anchored at the footprint, **not** the fit pin, so a joint-to-joint
  fit (`leg.hip → torso.hip`) still pools the shadow under the feet, never at the hip. Cool-tinted
  from the light in scope.

```drw
draw arm(c) 8x20:                       # a part exports its own attach points
  …
  pin shoulder 4:0
  pin wrist    4:19
draw knight 32x48:
  stamp torso 12:10
  pin torso.shoulder 16:14              # seeds ALL torso pins in canvas space
  fit armLeft.shoulder torso.shoulder   # contact-guaranteed; registers armLeft.wrist
  fit handLeft.wrist  armLeft.wrist     # chains
```

- **Held props keep grip + orientation across views.** A prop (sword, staff) declares a `grip` pin
  and is authored once in its true orientation (blade up). Grip it with `fit sword.grip hand.grip` —
  the grip stays in the hand and the blade keeps its authored direction. A **per-view flip of the
  figure never touches the prop**: it is a separate `fit`, so front/side/back show the same grip.
  Mirror the prop *deliberately* only when the view needs it (`fit sword.grip hand.grip flipx` mirrors
  horizontally, keeping the blade up) — never let a figure-wide flip invert it.

#### Occlusion relations & aim ([ADR-0092](decisions/0092-occlusion-relations-and-aim.md))

Assembly is **two-phase**: top-level `stamp`/`fit` placements render into private layers and composite
in a resolved order; every other statement (`fill`, `px`, `line`, blocks, `outline`, …) is an ordering
**barrier** that flushes the pending layers, then paints live in sequence. So inline paints keep their
exact slot and a whole-figure `outline` still closes over the full composite, while placements can be
re-layered declaratively — no `z` numbers, no view-specific hacks.

```drw
fit sword.grip a.grip behind capeBack       # sword layered BELOW the cape
stamp pauldron 12:44 front capeBack          # pauldron layered ABOVE the cape
fit bow.grip a.grip aim tip 60:20            # rotate about the grip until `tip` points at 60:20
```

- **`behind TARGET` / `front TARGET`** — trailing clauses on `stamp` **and** `fit`. `TARGET` is a bare
  part-name placed earlier in the same body. `behind` layers the subject below `TARGET`, `front` above
  it. Both may repeat. Ordering is a **minimal-disruption** stable sort — an unconstrained part keeps
  its statement slot and a lone `behind` moves only its own subject; ties break by statement order.
  A relation whose target sits on the far side of an intervening barrier can't be reordered across it.
  A conflicting pair (`behind X front X`) is a positioned **E025** cycle; an unplaced target is a
  positioned error. `behind`/`front` are ordinary bindable names everywhere except this trailing slot.
- **`aim PIN PT`** — a trailing clause on `fit`. Rotates the part about its fit pin (any angle) until
  the second named pin `PIN` points from the contact point toward the canvas point `PT`. The pins ride
  the rotation, so the fit pin still lands exactly on its target. A 1-bone orientation solve — orient a
  bow/sword per view without a bespoke redraw. An unknown `PIN` is a positioned error.
- **Verified.** `critique`'s **C013 occlusion parity** measures each declared relation in the final
  composite: how many of the overlap pixels the behind-part is still the visible top of (`> 0` fires,
  and is a `--strict` must-fix). `render --explain` prints the resolved bottom-to-top paint order with
  each layer's reason, every `fit`'s solved `aim N°`, and each relation's overlap/violation counts.

`pin` and `fit` are keywords **only** in these statement positions (D7) — bindable as ordinary
names anywhere else. `fit` is at its core a `stamp` with a pin-derived offset, so alpha/palette
semantics are identical.

### Skeleton & pose ([ADR-0095](decisions/0095-skeleton-and-pose.md))

A **skeleton** is a named rig — one parent-tree of joints — that a figure's three views are *poses*
of, instead of three hand-placed assemblies. Declared once at module scope:

```drw
skeleton body:
  pelvis at fig.hip                # anchored joint: position from a point (a fig guide point)
  chest  at fig.shoulder
  neck   at fig.neck
  shoulderL at fig.shoulderL
  hipL   at fig.hipL
  armL   from shoulderL 90 20 limit -60:120   # FK joint: parent, local rest angle, bone length
```

- A joint is **anchored** (`NAME at POINT` — its position is a point, typically a `fig` guide point
  so the rig binds to the figure oracle's proportions, §12) or **forward-kinematic** (`NAME from
  PARENT ANGLE LENGTH` — placed off its parent by a local rest angle and a bone length; both may read
  `fig` values). Joints are declared parents-first.
- `limit MIN:MAX` (either form, optional) bounds the pose delta the joint may take (degrees).
- Forward kinematics is deterministic (dmath, no iteration): a joint's world angle is its parent's
  plus its local rest angle plus its pose delta, so a delta on a parent rotates the whole subtree.

A **pose** is an angle set over a skeleton (module scope):

```drw
pose front over body:
  view front               # folds the figure oracle to this projection
  chest 0 z 1              # JOINT DELTA [z DEPTH]: add DELTA° to the rest angle; DEPTH is auto-Z
  shoulderL 0 z 2
  hipL 0 z 0
```

- `view front|side|back` folds `fig` to that projection (shoulders/hips collapse in profile, §12).
- Each `JOINT DELTA [z Z]` adds `DELTA` degrees to the joint's rest angle. A delta **outside the
  joint's `limit` is a positioned error** — an unreachable pose is a red diagnostic, never a silent
  clamp. `z Z` declares the joint's view depth (higher = nearer the viewer).

A drawing applies a pose and fits parts to bones:

```drw
draw front 64x128:
  pose front                       # solves the rig over this canvas + figure oracle
  fit torso.neck bone chest        # land the pin on joint `chest`, inherit its pose orientation
  fit legL.hip  bone hipL ground
  fit head.chin bone neck
```

- `pose NAME` solves the named pose's skeleton over the drawing's own `w`×`h` + figure oracle, then
  binds every joint as a bone anchor. A view/stance is one `pose`.
- `fit part.pin bone JOINT` lands `part`'s named pin on joint `JOINT`'s solved position and rotates
  the part by the joint's **pose-angle change** about that pin (the same about-a-point machinery as
  `aim`), so the part inherits the bone's orientation from the active pose. At the rest pose (delta 0)
  it is a plain translation, identical to a pin fit — a part is authored in the rest pose and posing
  rotates it. `bone` is a keyword only in this fit-source slot.
- **Auto-Z.** A bone fit carries its joint's view depth onto its placement layer; in the resolved
  paint order (§9 anchored assembly) depth orders the bone-fitted layers automatically — deeper
  paints first (behind), nearer last (front) — so the per-view occlusion falls out of the pose. A
  layer with no bone depth keeps its sequence slot. **Explicit `behind`/`front` always wins** — manual
  occlusion is the override, auto-Z orders only what the author left unstated.
- **Verified.** `render --explain` prints each applied pose's joints (solved world position, world
  angle, pose-angle delta, depth) and the resolved paint order with each bone-fit's `zN` reason. C013
  occlusion parity is unchanged — it measures only *declared* `behind`/`front` relations.

`skeleton`/`pose`/`bone` and the block keywords `at`/`from`/`limit`/`over`/`view`/`z` are contextual
(D7) — bindable as ordinary names everywhere else. A pose is an interpolable set of joint deltas over
a fixed skeleton (the data model for later animation).

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
- **`r.edge(dx:dy [, n])`** is the **one-sided edge band**: `r` minus `r` shifted `n` px along
  `sign(dx):sign(dy)`, i.e. `r.subtract(r.shift(sign(dx)·n : sign(dy)·n))`
  ([ADR-0097](decisions/0097-canonical-shading-floor.md)). `n` defaults to `1`; only the *sign* of
  the direction matters. Read the direction as **the way the light travels**, so `0:1` (down) is the
  **top** edge and `1:0` (right) is the **left** edge. `0:0` (or `n = 0`) is the empty region. The
  whole band is one region, so a translucent paint lands at its own alpha — no stacking.

  ```drw
  fill #ffffff.alpha(50%) face.edge(0:1)        # 1px light band on the top edge
  fill #0a1220.alpha(25%) face.edge(0:-1, 2)    # 2px dark bevel on the bottom edge
  fill lavaDark ground.edge(0:1).intersect(c)   # …clipped — note the ORDER
  ```

  It is pure geometry: no light, no paint, any colour (the removed `rim` command could only ever
  paint *toward* the light colour, so dark contour edges were out of reach). Because the
  constructor is separate from the `fill` eliminator, the clip can come **last**:
  `r.edge(d).intersect(c)` clips the silhouette band, while `r.intersect(c).edge(d)` bands the clip
  rectangle — a straight bar across the middle of the mass.
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

### Atlases

Bake several drawings into **one image plus a coordinate map**, for game engines and sprite
runtimes. **Content** (like `draw`): importable and exportable (§13), with **deterministic**
layout. One construct, `atlas`, covers both uniform sprite sheets and packed atlases — the
only irreducible difference is whether the tiles are uniform, which is exactly what an
optional `tile WxH` declaration toggles ([ADR-0016](decisions/0016-tilesets-and-atlases.md);
[ADR-0096](decisions/0096-language-freeze-for-1-0.md) §3 merged the former separate `tileset`
construct in). *(`tileset NAME SIZE:` is removed — a positioned error names the replacement.)*

**With `tile WxH`:** members pack onto a **uniform grid**, addressed by **name**, row-major
from the top-left. Every member must equal the declared tile size:

```drw
atlas terrain:
  sprites grass, dirt, water, stone    # any declaration order; row-major grid placement
  tile 16x16                           # 16x16 = tile size; each member must be exactly 16x16
  cols 4                               # optional; default: near-square auto layout ceil(sqrt(n))
  pad 1                                # optional grid gutter in px (default 0) — also the `tiled` sidecar's spacing
```

**Without `tile`:** members shelf-pack (tallest-first, then declaration order) at **varied**
sizes, still addressed by **name**. Pin any subset with `place` and the rest pack around them:

```drw
atlas hud:
  sprites play, pause, stop, logo      # any sizes; the member name keys the frame
  pad 1                                # optional inter-sprite gutter in px (default 0)
  place logo 0:0                       # optional: pin a member; others auto-pack
```

- **Members** are drawings in scope (local or imported), given as a bracket-less `sprites`
  list (§3) — repeatable, entries accumulate. **Addressed by name only**: `terrain.grass`
  resolves that member's sub-sprite directly (for re-`stamp`ing, e.g.); the numeric
  `terrain.0` index form the old `tileset` supported is removed (name addressing covers every
  case index addressing did, uniform or not). An unknown member name is a positioned E015.
- `sprites`/`tile`/`cols`/`pad`/`place` are **command-form directives** (like `with`, `apply`,
  `mode` — §3), *not* `=` bindings: the body configures the construct just as a `draw` body
  holds drawing commands. With `tile` declared, a member that isn't exactly that size is a
  positioned **E016**.
- **`cols`** requires a `tile` declaration (nothing to count grid columns of otherwise) — a
  positioned E004 without one. **`place`** is rejected alongside `tile` — a grid already has
  fixed slots — also a positioned E004. **`place`** naming a name not in `sprites` is a
  positioned E001 (previously silently ignored). Zero `sprites`, or an explicit `cols 0`, are
  guarded positioned errors rather than a silent divide-by-zero.
- Layout is **auto with explicit override** either way — `cols`'s default (`tile` mode) or
  `place`-pinning (shelf-pack mode) — upholding visual determinism (§14): the same members
  yield the same layout.

---

## 10. Expressions & functions

### Variables

```drw
x = 10
y = x * 2 + 5
x += 10          # mutate: += -= *= /=
```

### Scope & evaluation

- **Module-scope-only definitions** (`draw`/`path`/`fn`/`theme`/`atlas`/`export`)
  live at the top level of a file, are **order-independent** (may reference each other
  forward), and are collected before the module runs. Writing one inside a `draw` body is a
  positioned **E004** error — `fn`/`path` name the restriction explicitly
  ("`fn`/`path` definitions live at module scope"); the others report "statement not allowed
  in a drawing body".
- **`filter` is the one definition kind valid at both scopes**: `filter name: …` at module
  level joins the order-independent set above (forward-referenceable, like `fn`); the same
  syntax inside a `draw` body registers a **drawing-local** filter instead — evaluated in
  sequence, so it must appear before the `apply name` that uses it (like the bindings below).
- **`mask`/`gradient`/`palette` and ordinary bindings (`=`)** are allowed at **module scope** (shared
  constants, `TILE = 16`; a top-level `mask`/`gradient` is importable) and equally as
  **drawing-local** overrides inside a `draw` body (§9, §12). Unlike the module-scope-only
  definitions above, these are ordinary sequential statements, not order-independent
  definitions — each is visible from its line to the end of its enclosing block, and
  a drawing-local one must be written before it is used. `for`/`if`/`match`/
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
| `draw` / `path` / `fn` / `theme` / `atlas` / `export` | yes | no (E004) | order-independent |
| `filter` | yes | yes | order-independent at module scope; sequential (must precede `apply`) when drawing-local |
| `mask` / `gradient` / `palette` / binding (`=`) | yes | yes | sequential — visible from its line onward |

- **Name resolution is one namespace, lexically scoped — and palette names are `const` and
  reserved** ([ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md),
  superseding the positional rule of [ADR-0033](decisions/0033-evaluation-and-scope-model.md)):
  palette entries are ordinary colour bindings, and a name in a paint slot is a plain lookup
  whose value must be a paint (otherwise a positioned **type error**). The palette-vs-value
  collision is **asymmetric** ([ADR-0073](decisions/0073-palette-namespace-for-pixel-cells.md)):
  a `let`/`const`/loop-variable/parameter may **not** shadow a visible palette entry (still an
  error — a colour word keeps its meaning), but a **`palette` entry may shadow a visible
  non-palette binding** of the same name (the implicit `w`/`h`, a gradient, an outer `let`) —
  the colour vocabulary wins. The redefinition channels are that shadow and palette-to-palette
  composition (theme fold / local `palette` override, §12). The only palette-table context is a
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
lighten(hue(desaturate(#235, 100%), red), 10%)   # nested — read inside-out
#235.desaturate(100%).hue(red).lighten(10%)      # UFCS — reads in order
```

- A **zero-argument** call may drop its parens: `n.floor` ≡ `floor(n)`.
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
  stdlib function; [ADR-0048](decisions/0048-mod-keyword-percent-suffix-only.md).) `x(pt)`/`y(pt)`
  extract a point's coordinates as plain numbers (`x(4:5) == 4`, `y(4:5) == 5`) — the escape hatch
  for treating a point's components as independent scalars (e.g. `noise(seed, x(p) * 0.05, 0)`).
- **Lists:** `len(xs)`; `xs.cycle(i)` auto-wraps any integer index (including negative) via
  floored modulo — sugar for `xs[i mod len(xs)]`, so `xs.cycle(-1)` is the last element; an
  empty list is E015 ([ADR-0079](decisions/0079-ramp-cycling.md)). Indexing/destructuring are
  in the language (§4).
- **Randomness (seeded):** `rand(seed[, i])` → `[0, 1)`, `noise(seed, x, y)` → `[0, 1)`
  (2D value noise, smooth in `x`/`y`) — pure, never ambient; every core function takes its
  seed explicitly ([ADR-0026](decisions/0026-seeded-randomness-and-noise.md)). (A `seed <N>`
  module/draw directive once stored a base seed for sugar helpers that were never built; it
  was removed — ADR-0096 §1 — since it was stored but never read.)
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
for <i> <a>..<b>: <body>      # i from a to b-1 (half-open); a..=b is inclusive; no `in` — the ONE loop
scatter <p> <n> <seed> <region>:  # <body> n times, <p> = a seeded point from <region> (§11.1)
mirror x=<n>: <body>          # draw <body>, then its reflection across x=n (§11.2)
mirror y=<n>: <body>          # …and across the horizontal line y=n
```

`for` is the only loop. `repeat N:` (a duplicate of `for i 0..N:`) and `while cond:` (an unbounded
loop, a budget hazard `for` never poses) were removed in [ADR-0094](decisions/0094-language-diet-and-canonical-lints.md).

```drw
draw bands 32x32:
  palette:
    k = #1a1a1a
    y = #e0b070
    r = #c04040
  cols = k, y, r                          # a bracket-less list (parens only to group)
  for row 0..h:
    poly cols[row // 8 mod 3] 0:row w:row # pick a band colour per row (floored //, §10)
```

**Idiom: bounded `for` is the only loop.** Termination is guaranteed by construction (and the
budget backstops recursion). See [ADR-0004](decisions/0004-total-not-turing-complete.md). The
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

- **What mirrors:** every paint/region command — shapes, fills, gradients, and **stamps**
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
  `desaturate`, `hue` (renamed from `rotate`, which is the transform constructor;
  [ADR-0044](decisions/0044-first-class-transforms.md)) — two overloads: `hue(c, degrees)`
  **rotates** the hue by `degrees`, `hue(c, targetColor)` **sets** the hue to exactly match
  `targetColor`'s (lightness/chroma untouched) — `#235.hue(red)` reads as "recolour to red's hue";
  `alpha`, `mix` — call-style `lighten(c, 20%)` or method-style `c.lighten(20%)` (§10);
- a **colour-list helper**: `tones(base, ...amounts)` / `base.tones(...)` and
  `mixes(a, b, count[, space])` / `a.mixes(b, count[, space])` return ordinary lists of
  colours for explicit local ramps ([ADR-0060](decisions/0060-explicit-color-list-ramps.md));
- a **shading helper** ([ADR-0086](decisions/0086-declarative-light-and-material.md)):
  `litTone(base, light, amt)` mixes toward the light colour (warm highlight, not a chalky
  `lighten`); `shadowTone(base, cool, amt[, darken])` darkens (by `darken`, default `amt`) and
  nudges the hue toward `cool` by at most ~20° along the shorter arc (never cross-hue, so warm
  bases do not drift through magenta), desaturating slightly; `ramp(base, n)` returns an even
  n-step light→dark tone list for `pixels:`/cel banding — distinct from `tones` (arbitrary
  amounts). Reserved like every other builtin (§17.2,
  [ADR-0096](decisions/0096-language-freeze-for-1-0.md)) — a recipe may not bind `ramp`,
  `litTone`, or `shadowTone`;
- the keyword `transparent`;
- a **palette entry by name** (below).

Operations chain left-to-right via UFCS: `oklch(0.5, 0.12, 30).lighten(20%).alpha(80%)`.
Mixing and gradient interpolation default to **OkLCh** (perceptually even); pass the bare
colour-space keyword `rgb`/`hsl`/`oklch` as `mix`'s fourth argument to override
(`mix(a, b, t, rgb)` — same bare-contextual-keyword shape as every other enum in the language,
[ADR-0096](decisions/0096-language-freeze-for-1-0.md) §7).

**Pinned colour pipeline.** `oklch↔sRGB` conversion, gamut mapping (chroma reduced toward the
achromatic axis until in-gamut), the **shorter-arc** hue interpolation, and 8-bit
round-half-up commit are all *exactly specified* and run on the engine's bundled deterministic
math — so colour is pixel-identical across platforms (§14,
[ADR-0027](decisions/0027-deterministic-numeric-and-colour-pipeline.md)).

### Palettes

A `palette` block defines **colour constants in the enclosing scope** — every entry must
evaluate to a **colour** (positioned error otherwise), and the names are **`const` and
reserved**: rebinding, mutating, or shadowing a visible palette entry with a `let`/`const`/
loop-variable/parameter is a positioned error. The reverse is allowed: a `palette` entry **may
shadow** a visible non-palette binding of the same name — the implicit `w`/`h` canvas-size
bindings (§5), a gradient, an outer `let` — since the palette is the drawing's authoritative
colour vocabulary ([ADR-0073](decisions/0073-palette-namespace-for-pixel-cells.md)). This holds
for a **theme** `palette` key too: a theme `palette w=…`/`h=…` shadows the canvas size in applying draws,
exactly like a drawing-local one
([ADR-0081](decisions/0081-loop-persistent-rebinding-and-theme-scope-edges.md)). The
redefinition channels are that shadow and palette-to-palette composition (theme fold / local
override by name, below). **A palette name is exactly one ASCII letter** (`a`–`z`,
`A`–`Z`) — the pixel key *is* the name
([ADR-0049](decisions/0049-ascii-letter-pixel-keys.md),
[ADR-0050](decisions/0050-single-letter-palettes-combined-by-composition.md)): usable in
`pixels:` cells (§7), expressions, and paint slots alike — one namespace, no table-only
tier, no symbol keys. A multi-character name in a `palette` is a positioned error — to name a
colour for expressions, use a **plain binding** (`ink = #1a1a1a`; not const, not a pixel
key, not in the authored palette artifact). Plain color bindings are still rendered normally:
palette-capable exports collect actual framebuffer colors (§13), so a `palette` is not required
to make a color exportable. `.` is not a palette key but the built-in transparent cell
(`transparent` is the expression-side spelling). Entries may derive from earlier ones. See
[ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md) and
[best-practices.md](best-practices.md#color).

A `palette` is also an **artifact**: the ordered key → colour table (after the theme fold) is
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
palette:
  k = #1a1a1a
  y = oklch(0.78, 0.12, 75)
  r = #c04040
  t = lighten(r, 0.15)        # derived from another entry
```

Because colours are ordinary values, a palette name is just a name in scope — there is no
implicit palette generator or hidden ramp state. To pick a colour by index, index a normal
list: `cols = k, y, r` then `cols[i]`. A block-form `palette` may destructure an explicit
colour list into keys, preserving key order in the artifact:

```drw
palette:
  a, b, c = #cccccc.tones(-12%, 0%, 12%)
```

A `palette` may live in a `draw` (local) or a `theme`
(shared). Small palettes may use the **inline form** — one `palette` line of space-separated
`key=value` entries: `palette k=#1a1a1a  r=#c04040` (§7).

### Gradients

A `gradient` is a **paint** (§8) — a colour that varies across a region. `linear`/`radial` are
**ordinary callees** in paren-form (the RHS of `=` is expression position, §3); a **stop**
is a colour, or a `(colour, position)` group for an explicit position:

```drw
gradient sky  = linear(90, #4060ff, #ffd080)                       # 90° = top→bottom, even stops
gradient fire = linear(0, (#000, 0%), (#f00, 60%), (#ff0, 100%))   # explicit stop positions
gradient glow = radial(#fff, transparent)                          # OkLCh interpolation (default)
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
outline            # 1px silhouette outline, derived-dark ink  (colour+width optional; ADR-0090)
outline k          # …explicit colour  (outline k 2 = 2px; outline 2 = derived ink, 2px)
tint r 0.3         # blend everything toward r by 0.3  (recolor is parametric — draw params + `tint`)
shadow 1:1 k       # whole-frame drop shadow, offset dx:dy, colour k (ADR-0070)
shadow r 2:3 k     # local region shadow overload (region-first; `castShadow`, byte-identical, removed — ADR-0096 §1)
grain 0.2 11 k     # texture over opaque pixels — amount then seed (ADR-0080)
grain sand 0.2 11 k # …confined to a region — optional leading region, likewise speckle/ripple/dither (ADR-0071)
speckle 0.1 17 k   # sparse marks over opaque pixels — density then seed
ripple 0.4 23 k    # horizontal bands over opaque pixels — strength then seed
dither k y 0.5     # Bayer-select two paints over opaque pixels
quantize pal8      # remap opaque pixels to the nearest palette colour (OkLab, first-declared wins ties; ADR-0093)
quantize face pal8 # …confined to a region (optional leading region, like grain/speckle/ripple/dither)
```

There is **no raw lighting filter**. `shadeRegion`, `lightRegion`, `rim` and `ao` were removed
([ADR-0097](decisions/0097-canonical-shading-floor.md)) — lighting is `model`/`cel` (next section),
and the jobs those four also did are ordinary region + paint work:

| instead of | write |
|---|---|
| shading a **solid body** | `model r mat` (or `cel r mat n`) — form-following, one light |
| veiling **already-drawn** pixels | `fill linear(deg, transparent, c.alpha(a)) r` (`fill linear(deg, c.alpha(a), transparent) r` to lighten) |
| a one-sided **edge band** | `fill p r.edge(dx:dy[, n])` (§9 region methods) |
| **contact darkening** | `stroke p.alpha(a) r`, or the material's own `ao N%` dose |

The two veil rows are **not interchangeable**: `model` is a *repaint* — it writes opaque tones, so
modelling a region that already carries hand-drawn detail erases it. Over drawn pixels, veil with a
gradient `fill`.

**Compositing semantics — read this before relying on a filter's pixel effect from syntax
alone (`check` cannot catch a wrong filter argument; it stays semantically silent):**

- **`dither a b t`** is a **raw set, not a blend**: every opaque pixel of the target is
  overwritten with `a` or `b` (Bayer-selected by `t`), replacing whatever alpha was already
  there. A partner paint at `alpha(0%)` therefore punches a **transparency hole**, not a
  no-op. On small or radial fills the fixed 4×4 Bayer tile reads as a hard checkerboard
  rather than a smooth gradient — expect visible banding below roughly 16px.
- **`quantize [region] palette`** remaps every opaque pixel's RGB to its **perceptually nearest**
  colour in `palette` (squared OkLab distance; on an exact tie the **first-declared** entry wins),
  keeping the source alpha. `palette` is a list of colours (`pal8 = #111, #eee, …`). It is the
  pipeline half of the **import-assist workflow** — external PNG → `image … sha256` → `quantize`
  → `outline` → `critique`: determinism holds from the `sha256` pin onward, the PNG's generation
  stays outside the engine ([ADR-0093](decisions/0093-organic-region-constructors-figure-oracle-quantize.md)).
- **All three shadow surfaces share one `[region] dx:dy paint` shape**
  ([ADR-0070](decisions/0070-unified-shadow-argument-shape.md)): the stamp flag
  `shadow dx:dy p` (§9), the whole-frame filter `shadow dx:dy p`, and the local region form
  `shadow r dx:dy p` — one `dx:dy paint` tail everywhere, a region leading when present. The
  offset is always an `dx:dy` **point**; the older whole-frame two-bare-number spelling
  `shadow dx dy p` was removed ([ADR-0088](decisions/0088-in-place-v1-break.md)) — use `dx:dy`
  everywhere. (A fourth surface, `castShadow r dx:dy p`, was a byte-identical duplicate of the
  local region form and was removed — [ADR-0096](decisions/0096-language-freeze-for-1-0.md) §1;
  say `shadow r dx:dy p`.)
- **`grain`/`speckle`/`ripple`/`dither` take an optional leading region**
  ([ADR-0071](decisions/0071-region-scoped-texture-filters.md)): `grain [r] amount seed p`,
  `speckle [r] density seed p`, `ripple [r] strength seed p`, `dither [r] a b t` — region-first
  like `shadow`. The two numeric scalars are uniformly ordered **magnitude then seed**
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
  component-`draw` + `stamp` detour is no longer required for any of them. The region-form
  `shadow r dx:dy p` takes an explicit region and needs no confinement idiom at all.

Define a reusable pipeline with `filter` and run it with `apply`:

```drw
filter retro:
  tint #402010 0.15
  outline k

draw gem 4x4:
  pixels:
    .yy.
    yrry
    yrry
    .yy.
  apply retro
```

Always run a user `filter` through `apply` — a bare filter name as a statement (`retro` alone,
without `apply`) is a positioned error, a removed third dispatch path beside the `apply`
statement and the `apply` command ([ADR-0096](decisions/0096-language-freeze-for-1-0.md) §1).

The built-in filter set is intentionally extensible — new filters are added as commands. Texture
filters are explicit, deterministic framebuffer operations
([ADR-0062](decisions/0062-scoped-shadow-and-texture-filters.md)); the shadow surfaces share one
argument shape and the frame `shadow` respects a `mask` block
([ADR-0070](decisions/0070-unified-shadow-argument-shape.md)), and the texture filters take an
optional leading region ([ADR-0071](decisions/0071-region-scoped-texture-filters.md)).

### Light & material

Lighting has exactly **one** path. There used to be a raw floor as well
([ADR-0063](decisions/0063-explicit-local-lighting-helpers.md)'s `shadeRegion`/`lightRegion`/
`rim`/`ao`), but re-typing one light source as a point here, an inverted direction there, and a
`dx:dy` offset elsewhere let the encodings drift — and 7 of 7 audited authors read `shadeRegion`'s
`amount` as opacity when it is a distance scalar. All four are removed
([ADR-0097](decisions/0097-canonical-shading-floor.md)). The **declarative** layer
([ADR-0086](decisions/0086-declarative-light-and-material.md)) is the shading path: one
named **light** drives everything; a named **material** picks the *physics* (never the colour);
one `model`/`cel` command per object lowers to the primitives, coherently, and cannot drift.

```drw
light sun      = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # directional: source up-left, lit edge up-left
light torch    = at 12:8 #ffb060 gain 1.4          # point source at 12:8, 1.4× intensity
material steel = #8a95a5 metal                      # base colour + response (dose profile)

draw sword 24x48:
  model blade steel light sun      # smooth form shade → rim → AO → cast, all from `sun`
  model guard #b08040 metal light sun   # inline COLOR RESPONSE (no named material needed)
  model grip  #3a2a1e light sun    # bare colour ⇒ response `flat`
  cel  pommel steel 3 light sun    # opt-in: the same form body as 3 crisp bands
```

(A `theme` default `light` lets every `model`/`cel` drop the per-command `light sun` arg — § Themes.)

- **`light NAME = dir DX:DY COLOR [amb COOL AMT] [gain N]`** (directional) or **`light NAME = at
  X:Y COLOR …`** (point source) binds a first-class light — **no constructor parentheses**, the
  keyword signals the type. `dir DX:DY` is the light's *travel* direction (`dir 1:1` = moving
  down-right, so the source is up-left and the up-left edge is lit); `at X:Y` is a canvas
  position. `COLOR` is the warm light colour. `amb COOL AMT` is optional fill light (a cool
  colour + a `0..1` amount) that lifts shadows so they never go pure black; `gain N` scales every
  derived dose (default `1`). `dir`/`at`/`amb`/`gain` are keywords **only** in this binding — they
  stay ordinary bindable names everywhere else.
- **`material NAME = COLOR [RESPONSE] [OVERRIDES…]`** binds a material: a base colour plus a
  `RESPONSE ∈ flat | metal | skin | cloth | glass | glow` that selects a **baked dose profile** (how
  far to shade, how tight a rim, how much AO/cast, how glossy the specular, how round the form), never
  the colour. A bare colour with no response is `flat`. `glow` is self-illuminated (fill + inner light
  only — no shade/rim/cast/specular). The response word is a keyword **only** in this trailing slot.
  **Dose overrides** (ADR-0091) are order-free trailing keywords, each a `0..1`/percent value, keywords
  only in this slot: `shade`/`hi`/`rim`/`ao`/`spec` replace one baked dose, `puff` the surface-curvature
  gain, and **`spread N%`** scales `hi`+`shade` symmetrically (the one knob for value spread — e.g.
  `material leather = #3a2a1e cloth spread 140%` widens a dark base's range without a hand tone patch).
  A trailing **form-profile** keyword `round` (default) | `drape` (same slot, no value) picks the
  height field: `round` is the isotropic 2D dome; **`drape`** inflates a **per-row 1D half-tube**
  (curvature only across each row, flat down its length) so a *hanging* cloth reads as a vertical
  half-cylinder that does **not** darken toward its hem — the fix for a long cloak curling into a
  "turtle-shell" (`material cloak = #4a3f56 cloth drape spread 200%`). Use `drape` only for hanging
  drapes; keep `round` for compact masses.
- **Resolution order** for a `model`/`cel` command, most-local first: an explicit `light L`
  argument → the applied theme's **default** light (`§ Themes`, ADR-0086 tier 2) → the module's
  **sole** bare `light NAME = …` binding (tier 3, [ADR-0096](decisions/0096-language-freeze-for-1-0.md)
  §4). Tier 3 fires only when tier 2 is empty (no theme, or a theme with no default light) **and**
  the file declares **exactly one** module-scope light: an author who has named one light in one
  file has unambiguously said what the light is, so every `model`/`cel` there resolves without
  needing a per-command `light sun` or a theme just to carry it. Two or more module-scope lights
  don't collapse the ambiguity — the error names every candidate so the fix is one keystroke away.
  No light in **any** tier is a hard error (`E024`) — a light is always named and always visible,
  never a silent default. (The `lit L: body` scoping block was removed in
  [ADR-0094](decisions/0094-language-diet-and-canonical-lints.md): tiers 1–2 cover both cases it
  used to.) The theme default is how a front/side view pair or a
  colour variant shares **one** light without re-authoring it per view — the structural fix for the
  "light mirrored per view" bug.
- **`model REGION MATERIAL [over UNION] [light L]`** lowers `MATERIAL` under the resolved light (the
  explicit `light L` arg or the theme default)
  onto a **form (normal-based) body shade → rim → ao → cast shadow**
  ([ADR-0089](decisions/0089-form-based-shading.md), [ADR-0091](decisions/0091-shading-v2.md)) — every
  direction/offset derived from the one light, zero-dose edge steps skipped. `MATERIAL` is a `material`
  value **or** an inline `COLOR [RESPONSE]`. The **body follows the surface**: an inner
  distance-to-boundary field is **Poisson-inflated** to a smooth dome (a disc → hemisphere, a stripe →
  half-cylinder — **no medial ridge**, and thin limbs bulge in proportion to their own width), a
  per-pixel surface normal is dotted against the light (Lambert), and the intensity is tone-mapped
  `warm → base → cool` — smooth and form-following by default with a soft, **undithered** terminator
  (the tone map is continuous, so a dither would only add speckle; deliberate stipple is `cel N` or
  the `dither` filter), never the old linear ramp. A **Blinn
  specular** hotspot then lifts a glossy response (`metal`/`glass`/`skin`) toward the light colour (a
  soft mix in smooth mode). A dark base keeps ≥35 % of its lightness in shadow (never `#000000`). The
  **cast is clipped to
  already-drawn content** (silhouette offset down-light, minus the region, minus every transparent
  pixel): within one draw body a later region's cast falls on an earlier-drawn opaque neighbour (draw
  ground/back-to-front, scene-craft §8), but it **never bakes onto empty canvas** — an isolated part
  casts nothing (no detached grey blob); grounding for assembled figures comes from `fit … ground`
  (§9), not a baked material cast. **`over UNION`** (optional, ADR-0091) computes the height field and
  normals from `UNION` (a region — typically `partA.union(partB)`) but tones/fills **only** `REGION`,
  so two adjacent parts co-shade as **one continuous form** instead of restarting the field at their
  seam — a leg and its boot read as a single limb (`model legReg pants over legReg.union(bootReg)` then
  `model bootReg leather over legReg.union(bootReg)`). Each part keeps its own material and edge steps.
- **`cel REGION MATERIAL N [over UNION] [light L]`** renders the **same form body as `N` crisp bands** that follow the
  surface normal (the intensity field quantized, band-centre tone-mapped) — the **opt-in** hard
  cel-shaded look, where `model` is the smooth default. Its bands wrap the form, unlike the old
  straight iso-distance ramp; a `flat` cel is deliberate flat styling. Band **boundaries are crisp**
  (exactly `N` tones, no dither — soften a step with more bands or with `model`), and a glossy
  response adds a **hard specular glint** in the spec colour.
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
default**, **render mode**, **text-font default**, a **default light**, and an optional **figure
proportions oracle**) **and an LLM part**: a natural-language **style guide**. The style guide is
what makes many drawings *look like a set*. See [ADR-0003](decisions/0003-themes-as-style-guides.md).

```drw
theme dusk:
  palette:
    k = #1a1a1a
    y = oklch(0.78, 0.12, 75)
    r = #c04040
  gradient sky = linear(90, oklch(0.6, 0.15, 260), y)
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

A theme body holds only these forms — `palette:` / `gradient NAME = …`, `size` / `mode` / `font` /
`light` / `figure:`, `style`, `with`, and `filter` / `draw` definitions. A theme's `light NAME = …`
([ADR-0086](decisions/0086-declarative-light-and-material.md)) folds like `size`/`mode`/`font`
(later wins) and becomes the drawing's **outermost** light — so every `model`/`cel` in every
drawing applying the theme shares one source unless a `light L` argument
overrides it (`§ Light & material`, resolution order). The bound name is decorative; the value is
the default. A **free binding** written directly in the
body (a plain `accent = #d8a53a`, outside `palette:`) has nowhere to fold and is a positioned
**E004** at its declaration: put colours under `palette:` and other constants at **module scope**,
above the theme ([ADR-0081](decisions/0081-loop-persistent-rebinding-and-theme-scope-edges.md)).
A theme carries a default `light`, but **not** materials: a `material NAME = …` in a theme body is
the same positioned **E004** — materials live in module/draw scope, where a `model`/`cel` reads
them ([ADR-0086](decisions/0086-declarative-light-and-material.md)).

**Figure proportions oracle** ([ADR-0093](decisions/0093-organic-region-constructors-figure-oracle-quantize.md)).
A theme may declare a `figure:` block — the PROJECT's proportion numbers. Drawstic gives no style; it
supplies the mechanism to read a *declared* position instead of inventing coordinates (the structural
fix for conical necks, bulging ears, and eyes too central in profile). It folds like `light` (later
wins) and binds a first-class **`fig`** value in every drawing applying the theme, laid out over that
drawing's own `w`×`h`:

```drw
theme ro:
  figure:
    heads 3.5       # figure height in head-heights
    headW 22        # head width, px
    eyeLine 0.62    # eye line as a fraction of head height, from the crown
    earLine 0.58
    eyeSep 10       # front eye separation, px  (derives from headW if omitted)
    neckW 11        # + shoulderW / hipW
```

`fig` exposes guide **scalars** (`fig.headH`, `fig.headW`, `fig.eyeY`, `fig.earY`, `fig.center`, …)
and guide **points** — `fig.crown`, `fig.chin`, `fig.neckL`/`fig.neckR`, `fig.eyeL`/`fig.eyeR`,
`fig.earL`/`fig.earR`, `fig.shoulderL`/`fig.shoulderR`, `fig.hipL`/`fig.hipR`. Views are a
token-minimal specializer: `fig.front` / `fig.side` / `fig.back` re-view the same numbers
(`fig.side.eye`, `fig.back.earL`); `fig.NAME(view)` is also accepted. The crown sits at `y=0`, one
head is `h/heads` tall, so every line falls out of the head height. **Side view faces `+x`**, shifting
its single eye forward off centre and its ear toward the back. `context` prints the figure numbers.
Field names are contextual keywords — validated at fold time (`heads`, `headW`, `eyeLine`, `earLine`,
`eyeSep`, `neckW`, `shoulderW`, `hipW`); an unknown name is a positioned error.

### Composition with `with` (no inheritance)

Themes **compose**; they do not inherit. A theme lists its parts; the result is an
**ordered fold**, never a dispatch hierarchy — so the diamond problem cannot arise.
See [ADR-0005](decisions/0005-theme-composition-by-fold.md).

```drw
theme pixelBase:
  style "No AA. 2px black outline. Light top-left."

theme warmPal:
  palette:
    k = #1a1a1a
    y = oklch(0.78, 0.12, 75)

theme creatures:
  with pixelBase, warmpal      # order = merge order
  palette:
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
drawing-local `palette`, `gradient`, or `filter` overrides individual entries by name.

**Drawing-level `use`** ([ADR-0051](decisions/0051-drawing-level-use.md)) applies a theme
to **one drawing**: the same directive as leading line(s) of a `draw` body (any other
position is a positioned error). Fold order, later wins: file-level `use` → drawing-level
`use` → drawing-local `palette`/`gradient`/`filter`. This is how one module mixes sets — a
dark-mode variant next to its siblings — without splitting files by theme:

```drw
use themes dusk                # file default

draw moonIcon 16x16:
  use themes midnight          # this drawing only: midnight's palette + defaults
  palette g = #7a86b8             # local override folds last, as always
  circle g 8:8 6 fill
```

---

## 13. Output — the `export` element

Content (`draw`, `path`, `atlas`) is separate from output. An `export` declares **what
artifacts** to materialize from a content item; the **CLI decides where** they go (disk or
stream). See [ADR-0006](decisions/0006-modules-and-content-output-separation.md).

```drw
export gem icons/gem:
  png  @1 @2 @3  z9          # gem.png, gem@2x.png, gem@3x.png; zlib level 9
  svg  ids classes           # element ids + CSS classes
  path                       # for path definitions: geometry SVG
  jpeg 512x512  q80  mode smooth # explicit 512x512, quality 80, anti-aliased (override theme)
```

- `export <content> <base-path>:` then one line per output format. Source-first, then the
  **bareword** base path — position separates them, no quotes or connector; the per-format
  extension is appended (`png` → `<base>.png`)
  ([ADR-0019](decisions/0019-source-first-module-references.md)).
- **The base path is recipe-relative** ([ADR-0096](decisions/0096-language-freeze-for-1-0.md) §6):
  `drawstic build` defaults `--out` to the recipe file's own directory, and the base path is
  relative to that — the recipe alone decides the output layout; an explicit `--out` only
  relocates the whole tree. Grammar: `SEGMENT { "/" SEGMENT }` — no leading `/`, no `.`/`..`
  segment, no file extension (the format line appends the real one); a violation is a positioned
  `E018`, checked by `check` (not `build`). Lint `W016` flags a base path whose first segment
  repeats the recipe's own directory name (e.g. `export scene showcase/scene:` inside
  `showcase/showcase.drw`) — `build` already writes next to the recipe, so the prefix is always
  redundant.
- **Scale / size:** `@N` = integer scale factor (nearest-neighbor for pixel mode);
  `512x512` = explicit pixel size. (A bare-int size, `512`, was a third spelling — removed,
  ADR-0096 §1.)
- **HDPI:** `@1 @2 @3` emits `name.png`, `name@2x.png`, `name@3x.png`.
- **png:** `z0`..`z9` compression level; `indexed` writes an **indexed-colour PNG** whose
  palette contains every distinct rendered RGBA8 colour; a `palette` is not required. The
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

**Atlas sidecars.** Exporting an `atlas` (§9) emits the baked `png` plus an optional descriptor
of the name → rect map. File names are fixed so multiple descriptors never collide. See
[ADR-0016](decisions/0016-tilesets-and-atlases.md).

| Format line | Emits | Applies to |
|-------------|-------|------------|
| `png` (alone) | `<base>.png` — the grid/packed sheet, engine-agnostic | both atlas modes |
| `tiled` (`tiled xml`) | `<base>.tsj` / `<base>.tsx` — Tiled tileset, `spacing` = the atlas's `pad` | a `tile WxH` atlas only (uniform tiles) — **E018** otherwise |
| `atlasJson` | `<base>.json` — TexturePacker/Phaser/Pixi frames map | both atlas modes |
| `aseprite` | `<base>.aseprite.json` — Aseprite sheet | both atlas modes |

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
- **Pinned rasterization.** Inclusive line endpoints, even-diameter
  `circle`/`ellipse` (`2r` per axis for `r > 0`, one corner-centred convention for both —
  [ADR-0056](decisions/0056-even-diameter-circle-rasterization.md),
  [ADR-0087](decisions/0087-anchored-assembly.md)), silent out-of-bounds clipping, and NN stamp
  rotation (centre-pivot inverse mapping) ([ADR-0028](decisions/0028-rasterization-semantics.md),
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
  so nothing ever selected a variant, which is why the `drawstic <N>` pragma was removed outright
  (§2, [ADR-0096](decisions/0096-language-freeze-for-1-0.md)): the whole-frame
  `shadow` filter always honours an enclosing `mask …:` block (§12,
  [ADR-0070](decisions/0070-unified-shadow-argument-shape.md)), and the eight offset stamp anchors
  are always *visual* (resolved against the transformed footprint bbox, §9,
  [ADR-0072](decisions/0072-visual-stamp-anchors.md)).

---

## 15. Runtime budget (totality)

Every render runs under a **budget**: a maximum number of evaluation steps and a
maximum number of pixel writes. Exceeding it aborts with a clear, positioned error
rather than hanging. This is what makes the language **total** even though recursion
exists (`for` is the only loop; `while` was removed — ADR-0094). The budget is
configurable via the CLI with a sensible default.

---

## 16. CLI surface

| Command | Purpose |
|---------|---------|
| `drawstic check <file> [--lint] [--rows]` | parse + semantic validation; positioned errors; optional authoring warnings and row-width metadata. |
| `drawstic fmt <file> [--check] [--stdout] [--diff]` | canonical formatter (indentation, layout); idempotent; `--check` exits non-zero on unformatted input. |
| `drawstic context <file>` | emit the resolved **design brief** for the file (§ below), including export plans. |
| `drawstic build <file> [--out <dir>]` | run every `export` in the file, writing artifacts to disk. `--out` defaults to the recipe file's own directory ([ADR-0096](decisions/0096-language-freeze-for-1-0.md) §6) — an export path is relative to that, and an explicit `--out` only relocates the whole tree. |
| `drawstic render <file>#<drawing>[(args)] [--png@2] [--out <path>] [--stdout] [--ascii] [--preview] [--silhouette] [--inspect] [--explain] [--fit WxH] [--crop x:y WxH] [--grid N] [--diff <png>] [--mode pixel\|smooth]` | ad-hoc render of one drawing; can stream. A parametric drawing takes literal arguments in the fragment — `file#house(#c04040, 3)` (number, color, string, point, boolean only; [ADR-0067](decisions/0067-render-fragment-literal-arguments.md)). `--ascii` = luminance-ramp grayscale text; `--preview` = half-block ANSI colour; `--silhouette` = shape-only black-out ([ADR-0083](decisions/0083-render-silhouette.md)); `--inspect --json` emits render facts; `--explain` prints every `model`/`cel`'s lowered primitive expansion ([ADR-0086](decisions/0086-declarative-light-and-material.md) §6) **and every `fit`'s placement** — where each pin landed, whether the pins coincide, and the pin-to-ink gap ([ADR-0087](decisions/0087-anchored-assembly.md)) — instead of an image. Output-kind precedence `--ascii` > `--preview` > `--inspect` > `--explain` > PNG. `--grid N`/`--diff <png>` are debug-only PNG aids, below; `--mode` overrides the recipe's own `mode pixel\|smooth` (§12). |
| `drawstic sheet <file> [--all] [--cols N] [--png@N] [--out <path>] [--stdout] [--ascii] [--preview]` | family contact sheet ([ADR-0082](decisions/0082-sheet-contact-sheet-cli.md)): composes the selected drawings size-normalized into ONE labeled comparison grid for cross-drawing consistency QA (§ below). Default selection = the module's `export`ed drawings in export order; `--all` = every non-parametric drawing. Reuses the renderer; never part of `build`. |
| `drawstic critique <file> [--as icon\|scene\|character\|item] [--family a,b,c] [--strict] [--all]` | pixel-based, vision-free quality checks (`C0xx`) over every rendered drawing, plus family checks across siblings ([ADR-0085](decisions/0085-critique-command.md); § below). `--as` selects a category threshold profile; `--strict` promotes the must-fix subset to `error` (exit 1) as a CI gate; `--all` widens the family-check sibling selection to every non-parametric drawing (like `sheet --all`), overridden by `--family`. Complements `check` (grammar) — catches the visual, silent bug class. |
| `drawstic help` \| `--help` \| `-h` | print usage and exit 0 (also the default with no command). |
| `drawstic version` \| `--version` \| `-v`/`-V` | print the installed package version and exit 0. |

**Global flags.** Every command that evaluates a recipe (`check`, `context`, `build`, `render`,
`sheet`, `critique` — not `fmt`, which is pure text formatting, nor `help`/`version`) additionally
accepts **`--budget N`** (overrides the evaluation-step budget, §15) and **`--mode pixel|smooth`**
(overrides the recipe's own render mode, §12). An **unrecognized flag** is a positioned `E026` (one
diagnostic per bad flag, exit 1) naming the flag — never silently ignored, so a typo (`--pgn@4`,
`--strickt`) fails loudly instead of reading as "the flag had no effect".

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
- `--diff <png>` decodes a previous PNG (reusing the `image`-path decoder, §2) and diffs it
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
for procedural scenes today** — gradients/filters/`mix` routinely paint colors no `palette` key
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

### `critique` — pixel-based quality checks

`critique` ([ADR-0085](decisions/0085-critique-command.md)) closes the gap `check` structurally
cannot see: `check` validates grammar, but roughly five of every seven expensive category-evaluation
bugs are **visual and silent** (off-centre glyph, floating/seamed part, near-identical sibling
silhouettes, flat unshaded value, edge-clip, transparent trailing row). It renders every non-parametric
drawing and runs a fixed catalog of vision-free assertions against the framebuffer — reusing the
`render --inspect` metric bundle, `--silhouette` signatures, and the `sheet` sibling selection — each
finding a structured diagnostic in a new **`C0xx`** namespace carrying `{measured, threshold, fix}`.

- **Category-agnostic (always run):** `C001` empty/near-empty · `C003` optical centring (`x0+x1==W−1`)
  · `C004` value/contrast spread · `C006` palette/complexity budget · `C008` interior pinholes ·
  `C012` asymmetric bottom-padding · `C013` occlusion parity — a declared `behind`/`front` relation
  whose behind-part is still the visible top of the overlap zone ([ADR-0092](decisions/0092-occlusion-relations-and-aim.md);
  declarative + high-confidence, so also a `--strict` must-fix).
- **Profile-gated (`--as`):** `C002` edge-clip (`icon`/`item`) · `C005` stroke width (`icon`/`item`/
  `character`) · `C007` floating-part/seam via 8-connected components + chamfer distance (`character`).
- **Family (needs ≥2 exported siblings, or `--family a,b,c`):** `C009` sibling-silhouette collapse
  (scale-/position-invariant 32×32 signatures) · `C011` weight parity.
- **Severity/gating.** Every `C0xx` defaults to `warning` (exit 0 — never blocks). `--strict` promotes
  only the unambiguous must-fix subset — `C001`, `C007`, plus `C003` for `icon` — to `error` (exit 1),
  the CI regression gate over `examples/`; the rest stay advisory because the corpus proves each has a
  legitimate form a pixel check cannot distinguish from a bug (recolor/shared-shell silhouettes, open
  frames enclosing small gaps, symmetric breathing room).
- **Vision rubric.** After the automatic gate, `critique` prints an ordered list of silhouette-first
  render commands plus a category rubric. `pass:true` is **necessary, not sufficient** — the rubric is
  the part that still requires looking, and the product skill states this as the definition of done.

### Lint warnings — `check --lint`

`check --lint` folds non-fatal authoring warnings into the same `W###`-coded diagnostic
record as every other check ([ADR-0030](decisions/0030-structured-diagnostics-contract.md)).
Every check is best-effort and conservative by design (src/lint.ts): a case that can't be
statically resolved (a dynamic expression, a parametric drawing, a draw-local name) is
skipped rather than guessed at, so a lint pass never produces a false positive.

| Code | Fires when | Fix |
|------|------------|-----|
| `W001` | a locally declared `palette` key is never used by `pixels:` or a paint expression | remove it or use it |
| `W002` | a drawing is neither `export`ed, `stamp`ed, nor a `fit` target from another drawing | export it, stamp it, or fit it |
| `W003` | a `stamp`'s literal target at a literal point lands entirely outside the host canvas | move it on-canvas or drop it |
| `W004` | *retired* (code never reused) — it fired on every scene-sized canvas without carrying an action; verifying a large drawing is the render-and-look loop's job | — |
| `W006` | a `dither` partner paint statically resolves to alpha 0 — `dither` is a raw set, not a blend (§12 Filters), so this punches a transparency hole | give the partner a visible alpha |
| `W007` | a `stamp` is fully covered by a later, provably opaque `stamp`/`rect …fill`/`bg` in the same drawing | reorder the stamps, or delete the dead one |
| `W008` | a `text` command's **literal** string contains character(s) that have no glyph in the resolved font (font resolution: per-`text` `font` flag > theme/draw/module directive > `small`), so they render silently as the unknown-glyph box | add the glyphs to the font, pick a font that has them, or drop them |
| `W009` | a `pixels:` grid's **last row** is fully transparent (`.`) while a row above it has content — because stamps place by the sprite's top-left corner, that trailing empty row silently enlarges the footprint and seams a 1px gap below adjacently stamped parts. Scoped to the last row only (never the first row, never a column — side-padding and top-centring are legitimate) | trim the trailing row, or account for the offset |
| `W010` | a `fit` part touches no other content in the **final composite** (a floating/seamed part — the same gap `critique` **C007** measures); checked after the whole `draw` body paints, so back-to-front layering never false-warns | move the pin onto solid pixels, overlap the seam 1–2px, or add the missing part |
| `W011` | a `fit` target pin sits **>2 px off the part's own ink** (`ADR-0087`): the pins coincide but the join floats because the pin is in empty part space (a chin below the head). Contact-blind, so C007 misses it; inspect with `render --explain` | move the `pin` onto the part's real contact edge, or pick the pin that marks it |
| `W012` | *retired* (code never reused) — it fired on a raw `rim`/`shadeRegion`/`lightRegion` beside a `model`/`cel`, and all three were removed by [ADR-0097](decisions/0097-canonical-shading-floor.md); a stale recipe now surfaces as a `retired` census entry instead, which needs no `model` nearby to notice | — |
| `W013` | a `litTone`/`shadowTone` `fill` clipped by `.intersect(rect)` on a modeled region — the retired value-spread corner patch (ADR-0094) | use the material's `spread N%` override |
| `W014` | a `stamp` of a part that declares attach `pin`s (unless it is a pin-seeded assembly root, ADR-0092/0094) — `stamp` is for pin-less decoration | place it with `fit <part>.<pin> <anchor>`, or drop the pins if it is decoration |
| `W015` | a semi-transparent `fill … ellipse(…)` low in the foot zone of a drawing that uses `fit` — a hand contact-shadow (ADR-0094) | drop it; add the `ground` flag to the root `fit … ground` |
| `W016` | an `export` base path's first segment repeats the recipe file's own directory name (ADR-0096 §6) — `build` already writes next to the recipe | drop the redundant `<dirname>/` prefix |
| `W017` | a `Front`/`Back` view pair (two draws sharing a name stem, same canvas width) repeats an off-centre attach `pin`'s `x` verbatim — the back view is the same figure turned 180°, so the pin should mirror. Exempt when the pin is part of an L/R pair (a sibling pin in the same draw with the trailing `L`/`R` swapped) — that pin set is already mirror-symmetric | mirror the coordinate: `x = w - 1 - x`, the axis `flipx` mirrors about |

**Construct census.** `critique --json` and `check --lint --json` carry a deterministic `census`
(AST-only, [ADR-0094](decisions/0094-language-diet-and-canonical-lints.md)): every construct used in
the module, each flagged `spec-only` (a floor construct the canonical path no longer surfaces),
`non-canonical` (a W013–W015 participant) or **`retired`** (a removed construct that still parses
and loads but errors at render — `castShadow`, `grayscale`, `rim`, `shadeRegion`, `lightRegion`,
`ao`), plus three `antiPatterns` counts — `manualSpread` (W013), `stampWithPins` (W014),
`handShadow` (W015). `check --lint --json` wraps its diagnostics as `{diagnostics, census}`.

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
**positional** — recognized by statement shape (`draw`, `palette`, `fill`, `tiles`, …) — and
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
  `tint k 0.3`, `mask m`, `font small`, `sha256 hex`) each form one argument.
- **D3 — Match arms.** An arm's label ends at the *first* depth-0 `:` of the line, so a
  label is colon-free at depth 0 (parenthesize a point label: `(0:0): …`). The body is an
  inline simple statement or an indented block.
- **D4 — Contextual tokens.** The numeric-suffix flags and the path tokens are recognized
  only in their grammar positions; elsewhere the same spellings are ordinary `NAME`s (`w2`
  may be a binding). `drawstic` at the very start of a file is sniffed only to raise the
  removed-pragma error (§2); elsewhere it is an ordinary `NAME`.
- **D5 — Hyphens live in paths, not names.** A `NAME` never contains `-`, so `-` is
  always the minus operator and needs no whitespace: `x-1` subtracts. Multi-word names
  are **camelCase** (`pixelBase`; snake_case is legal, camelCase preferred). Path
  *segments* — module file names, export base paths, imported file names — may contain
  hyphens (`from ui-parts eye`), but the names a module defines cannot.
- **D6 — `(` after a callee** opens an argument list; a `(` elsewhere groups
  ([ADR-0015](decisions/0015-unified-call-model.md)).
- **D7 — Keyword triple duty** (`font`, `mask`, `palette`, `size`) resolves by the token that
  follows the name: `=` → value binding, line-final `:` → definition/clip block,
  otherwise → directive or flag.
- **D8 — Dot.** After `.`: an integer is an index, a name is a UFCS call (§4, §10).
  Directly after a `.`, a numeric token is always lexed as `INT` — `xs.0.1` is
  `xs[0][1]`, never a float.

### 17.4 Phrase grammar

```ebnf
(* ───────────────────────── module structure ───────────────────────── *)

module         = { top-stmt } EOF ;                 (* no version pragma — removed (§2, ADR-0096 §1) *)

top-stmt       = from-stmt | use-stmt | size-dir | font-dir
               | binding | definition ;
definition     = draw-def | path-def | theme-def | fn-def | gradient-def | filter-def | mask-def
               | light-def | material-def                              (* §12, ADR-0086 *)
               | skeleton-def | pose-def                               (* §9, ADR-0095 *)
               | font-def | image-import | atlas-def | export-def ;

from-stmt      = "from" MODULE-PATH import-item { "," import-item } NL ;  (* source-first (§2) *)
import-item    = NAME [ "as" NAME ] ;
use-stmt       = "use" [ MODULE-PATH ] NAME NL ;    (* 2 tokens = imported, 1 = local (§12) *)

size-dir       = "size" SIZE NL ;                   (* module- or theme-scope (§6) *)
                                                     (* `seed N` removed — stored, never read (ADR-0096 §1) *)
font-dir       = "font" NAME NL ;                   (* module-, draw- or theme-scope (§8); D7 *)
mode-flag      = "mode" ( "pixel" | "smooth" ) ;
mode-dir       = mode-flag NL ;                     (* theme-scope (§12) *)

(* ───────────────────────── bindings & value defs ───────────────────────── *)

binding        = name-list "=" expr-seq NL          (* incl. destructuring: r, g, b = rgb *)
               | NAME ( "+=" | "-=" | "*=" | "/=" ) expr NL ;
name-list      = NAME { "," NAME } ;

fn-def         = "fn" NAME "(" [ name-list ] ")" "=" expr NL ;   (* first-order (§10) *)
gradient-def   = "gradient" NAME "=" expr NL ;      (* linear(…) / radial(…) paint (§12) *)
mask-def       = "mask" NAME "=" expr NL ;          (* region expression (§9) *)
light-def      = "light" NAME "=" ( "dir" | "at" ) point paint          (* Light value (§12, ADR-0086) *)
                 { "amb" paint expr | "gain" expr } NL ;                (* order-free; dir/at/amb/gain
                                                                            are contextual (D7) *)
material-def   = "material" NAME "=" paint [ RESPONSE ] { dose-override | FORM-PROFILE } NL ;
                                                                (* Material value (§12, ADR-0086/0091) *)
RESPONSE       = "flat" | "metal" | "skin" | "cloth" | "glass" | "glow" ; (* contextual keyword (D7) *)
dose-override  = ( "shade" | "hi" | "rim" | "ao" | "spec" | "puff" | "spread" ) expr ;
                                                       (* order-free trailing dose override (ADR-0091) *)
FORM-PROFILE   = "round" | "drape" ;                  (* height-field profile, default round (ADR-0091) *)
skeleton-def   = "skeleton" NAME ":" NL                                 (* rig (§9, ADR-0095) *)
                 INDENT skel-joint NL { skel-joint NL } DEDENT ;
skel-joint     = NAME ( "at" point                                     (* anchored joint *)
                      | "from" NAME expr expr )                        (* FK: parent, angle, length *)
                 [ "limit" point ] ;                                   (* MIN:MAX pose-delta bound *)
pose-def       = "pose" NAME "over" NAME ":" NL                        (* pose (§9, ADR-0095) *)
                 INDENT { pose-line NL } DEDENT ;
pose-line      = "view" ( "front" | "side" | "back" )                  (* projection (folds fig) *)
               | NAME expr [ "z" expr ] ;                              (* JOINT DELTA [z DEPTH] *)
image-import   = "image" NAME "=" FILE-PATH [ "sha256" HEX ] NL ;   (* PNG → drawing (§2) *)
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

draw-stmt      = palette-stmt | pixels-block | meta-stmt
               | font-dir                            (* drawing-scoped directive (§8) *)
               | gradient-def | filter-def | mask-def   (* drawing-local overrides (§9, §12) *)
               | light-def | material-def           (* drawing-local light/material (§12, ADR-0086) *)
               | pose-apply                          (* apply a pose (§9, ADR-0095) *)
               | pin-decl | fit-stmt                 (* anchored assembly (§9, ADR-0087/0092/0095) *)
               | binding | control-stmt | mask-block | call-stmt ;
pose-apply     = "pose" NAME NL ;                    (* solves the pose's rig for this drawing *)

(* ─────────────────── anchored assembly: pin / fit (§9) ───────────────────
   ADR-0087 (contact-guaranteed placement), ADR-0092 (occlusion + aim),
   ADR-0095 (bone source). Both are keywords only in this statement position (D7). *)

pin-decl       = "pin" pin-key point NL ;
pin-key        = NAME [ "." NAME ] ;                 (* unspaced dot; a dotted PART.pin seeds a
                                                         canvas-space point from an already-placed part *)

fit-stmt       = "fit" fit-ref fit-source { fit-flag } NL ;
fit-ref        = NAME [ "." NAME ] ;                 (* unspaced dot: TARGET or TARGET.pin; a bare
                                                         ref auto-matches the one pin shared by name *)
fit-source     = fit-ref                             (* another already-placed part's pin *)
               | "bone" NAME                         (* the active pose's solved joint (ADR-0095) *)
               | point ;                             (* canvas point — the ground-placement oracle *)
fit-flag       = "flipx" | "flipy" | ROT-FLAG | SCALE-FLAG
               | "transform" expr | "tint" paint expr | "mask" NAME
                                                      (* NOT "anchor" — the pin already is the
                                                         anchor, so that stamp-flag is a positioned
                                                         error here (ADR-0096 §1) *)
               | "ground"                            (* auto contact-shadow ellipse; the bare
                                                         `shadow` spelling was renamed, ADR-0096 §2 *)
               | "behind" NAME | "front" NAME         (* occlusion order, may repeat (ADR-0092) *)
               | "aim" NAME point ;                   (* orient toward a point via a second pin
                                                         (ADR-0092) *)

meta-stmt      = ( "title" | "desc" ) STRING NL ;   (* SVG metadata (§6, §13) *)
mask-block     = "mask" expr ":" block ;            (* expr must evaluate to a Region (§9) *)
block          = NL INDENT draw-stmt { draw-stmt } DEDENT ;

palette-stmt   = "palette" palette-entry { palette-entry } NL             (* inline form (§7) *)
               | "palette" ":" NL INDENT palette-entry NL { palette-entry NL } DEDENT ;
palette-entry  = KEY "=" expr ;                     (* expr must be a colour (§12); in the
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
               | "dome"    paint point pair draw-flags              (* upper-half ellipse cap (ADR-0093) *)
               | "lobe"    paint point point expr draw-flags        (* base point, tip point, width *)
               | "crescent" paint point pair expr pair draw-flags   (* center, rx:ry, thickness, dir *)
               | "ribbon"  paint point point point expr draw-flags  (* p0 p1 p2 through a quadratic arc, width *)
               | "fill"    paint ( path-value | region )             (* eliminators (§8) *)
               | "stroke"  paint ( path-value | region ) stroke-flags
               | "text"    paint point STRING [ "font" NAME ]
               | "stamp"   stampable point { stamp-flag }
               | "apply"   NAME ;                                   (* run a filter (§12) *)

draw-flags     = [ "fill" ] stroke-flags ;          (* trailing sugar for fill/stroke (§8, ADR-0039, ADR-0066) *)
stroke-flags   = [ W-FLAG ] ;                       (* `cap`/`join` removed — parsed but never
                                                        rendered (§8, ADR-0096 §1) *)

stampable      = NAME [ "(" [ expr-seq ] ")" ]      (* plain or parametric drawing (§6) *)
               | NAME "." NAME ;                    (* atlas member by name (§9) *)
stamp-flag     = "flipx" | "flipy" | ROT-FLAG | SCALE-FLAG          (* pinned sugar (§9) *)
               | "transform" expr | "tint" paint expr | "mask" NAME
               | "anchor" NAME | "shadow" point paint
               | "behind" NAME | "front" NAME ;      (* occlusion order vs. an earlier-placed part,
                                                         may repeat (ADR-0092); `stamp` only *)

filter-cmd     = "outline" [ paint ] [ expr ]       (* built-in filter set (§12); paint+width optional, ADR-0090 *)
               | "tint"    paint expr               (* extensible — new filters follow the same shape *)
               | "shadow"  point paint              (* whole-frame drop shadow: dx:dy (ADR-0070) *)
               | "shadow"  region point paint       (* local region shadow (ADR-0062);
                                                        `castShadow` (byte-identical) removed, ADR-0096 §1 *)
               | "grain" [ region ] expr expr paint (* optional leading region scope (ADR-0071) *)
               | "speckle" [ region ] expr expr paint
               | "ripple" [ region ] expr expr paint
               | "dither" [ region ] paint paint expr
               | "quantize" [ region ] expr        (* palette remap (ADR-0093); the raw light quartet
                                                      `shadeRegion`/`lightRegion`/`rim`/`ao` was
                                                      removed, ADR-0097 §1 *)
               | "model" region material [ "over" region ] [ "light" NAME ]  (* declarative shading
                                                                    (§12, ADR-0086); over: ADR-0091 *)
               | "cel" region material expr [ "over" region ] [ "light" NAME ] ;
                                                       (* N-band cel fill; expr = band count *)
material       = NAME | paint [ RESPONSE ] ;        (* a `material` value, or inline COLOR [RESPONSE] *)

(* ───────────────────────────── control flow ───────────────────────────── *)

control-stmt   = if-stmt | match-stmt | for-stmt
               | scatter-stmt | mirror-stmt ;
if-stmt        = "if" expr ":" block [ "else" ":" block ] ;
match-stmt     = "match" expr ":" NL INDENT match-arm { match-arm } DEDENT ;
match-arm      = ( arm-label | "else" ) ":" arm-body ;
arm-label      = expr ;                             (* colon-free at depth 0 (D3) *)
arm-body       = call-stmt | binding | block ;      (* inline simple stmt, or block (D3) *)
for-stmt       = "for" NAME range ":" block ;       (* the one loop; `repeat`/`while` removed (ADR-0094) *)
range          = expr ( ".." | "..=" ) expr ;       (* half-open | inclusive (§11) *)
scatter-stmt   = "scatter" NAME expr expr expr ":" block ;  (* NAME count seed region (§11.1, ADR-0077);
                                                       operand exprs are cmd-arg bounded (D2) *)
mirror-stmt    = "mirror" ( "x" | "y" ) "=" expr ":" block ; (* axis symmetry (§11.2, ADR-0078) *)
                                                    (* `scatter`/`mirror` are contextual — recognized
                                                       only in this header shape; both remain
                                                       ordinary bindable names elsewhere (D7) *)

(* ───────────────────────────── themes ───────────────────────────── *)

theme-def      = "theme" NAME ":" NL INDENT { theme-item } DEDENT ;
theme-item     = with-stmt | palette-stmt | style-stmt | size-dir | font-dir | mode-dir
               | gradient-def | filter-def | draw-def
               | light-def | figure-block ;          (* §12, ADR-0086/0093; a material-def or a
                                                         non-gradient binding also parses here but is
                                                         rejected at fold time (E004) — materials and
                                                         other constants live at module scope, above
                                                         the theme *)
with-stmt      = "with" name-list NL ;              (* compose parts, ordered fold (§12) *)
style-stmt     = "style" STRING NL ;                (* "…" or """…""" *)
figure-block   = "figure" ":" NL INDENT figure-field { figure-field } DEDENT ;
                                                     (* proportions oracle (§12, ADR-0093) *)
figure-field   = NAME expr NL ;                     (* heads/headW/eyeLine/earLine/eyeSep/neckW/
                                                        shoulderW/hipW — contextual, validated at fold *)

(* ──────────────────────── user-defined fonts ──────────────────────── *)

font-def       = "font" NAME [ SIZE ] ":" NL INDENT { font-item } DEDENT ;  (* §8 *)
font-item      = "with" NAME NL                     (* fallback face, fold (§8) *)
               | "glyph" STRING NAME NL             (* one character → one drawing *)
               | "glyph" STRING [ SIZE ] ":" NL INDENT { draw-item } DEDENT
                                                        (* inline glyph; SIZE defaults to font SIZE *)
               | "glyphs" NAME STRING NL            (* bulk: uniform-tile atlas → characters *)
               | "tracking" INT NL
               | "lineheight" INT NL ;

(* ────────────────────────────── atlases ────────────────────────────── *)
(* ADR-0096 §3 merged the former separate `tileset NAME SIZE:` construct into `atlas`; the *)
(* removed keyword keeps a positioned error naming the replacement. *)

atlas-def      = "atlas" NAME ":" NL INDENT { atlas-item } DEDENT ;  (* §9 *)
atlas-item     = "sprites" name-list NL | "tile" SIZE NL | "cols" INT NL
               | "pad" INT NL | "place" NAME INT ":" INT NL ;
                 (* `place`'s coordinates are two literal INTs around a literal ":", not the point-
                    expression grammar — no arithmetic there. Cross-item constraints (checked once the
                    whole body is read, order-independent): at least one `sprites` name is required;
                    `cols` needs a `tile` declaration; `place` and `tile` are mutually exclusive — a
                    grid (`tile`) has fixed slots either way, so freeform `place` only applies to a
                    grid-less atlas. `sprites`/`tile`/`cols`/`pad` may each repeat (last/accumulate
                    wins); none is order-restricted. *)

(* ───────────────────────────── exports ───────────────────────────── *)

export-def     = "export" NAME OUTPUT-PATH ":" NL
                 INDENT format-line { format-line } DEDENT ;        (* §13 *)
format-line    = "png"  { out-size | Z-FLAG | "indexed" | mode-flag } NL
               | "svg"  { "ids" | "classes" | "inlineStyles" | mode-flag } NL
               | "jpeg" { out-size | Q-FLAG | mode-flag } NL
               | "path" NL
               | "tiled" [ "xml" ] NL               (* uniform-tile atlas sidecar: .tsj / .tsx (§13) *)
               | "atlasJson" NL
               | "aseprite" NL ;
out-size       = AT-SCALE | SIZE ;                  (* @N | 512x512 (§13); a bare-int size
                                                        (`512`) was removed — third spelling of
                                                        a size, ADR-0096 §1 *)

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
- **`draw-stmt` was missing** the drawing-local `gradient`/`filter`/`mask =` definitions
  (§9, §12), the drawing-scoped `seed`/`font` directives (§8, §10), and `title`/`desc` (§6).
- **The block-vs-point colon** had no rule → D1 (line-final colon opens the block).
- **Command-form argument boundaries** were unstated → D2 (depth-0 whitespace).
- **Hyphenated names vs the minus operator** were never reconciled → D5 (names are
  hyphen-free camelCase, so `-` is always the operator; path segments keep their hyphens).
- **Match-arm bodies** (inline vs block) were unpinned → D3.
- **`fmtline`, the inline `palette` form, `if`'s `else`, and the flag tokens** were undefined —
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
   fold order file-level `use` → drawing-level `use` → local `palette`/`gradient`/`filter`, later
   wins. Mixed-theme modules no longer force file splits — the evidence Q7 waited for.
8. **Resolved — colours are first-class values** (hex / `oklch()` / `lighten()` / …), so
   gradients and colour operations work and `ramp` is gone (see
   [ADR-0009](decisions/0009-first-class-colours-gradients-filters.md)). Palette entries
   are named colours in scope; a single char is a pixel key **only inside `pixels:`**.
   *Re-resolved ([ADR-0046](decisions/0046-one-namespace-palettes-as-bindings-and-artifact.md),
   superseding [ADR-0033](decisions/0033-evaluation-and-scope-model.md) point 5):* there is
   **one namespace** — palette entries are **const, reserved colour bindings** (a value binding
   may not shadow a palette entry; a `palette` entry may shadow a non-palette binding —
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
and external images joined as first-class inputs — `image name = file.png`, PNG-only for
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
