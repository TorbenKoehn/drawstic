# Drawstic reference

Complete practical reference for recipe authors — every construct, its exact grammar, and its traps.
Self-contained; nothing here depends on a file outside this package. For the common path start at
[SKILL.md](SKILL.md); for a trap tied to a diagnostic code see [language.md](language.md); this file is
the exhaustive fallback for whatever those two don't cover.

## Contents

- [CLI](#cli)
  - [Fragment arguments](#fragment-arguments)
  - [Render outputs](#render-outputs)
  - [`sheet` — family contact sheet](#sheet--family-contact-sheet)
  - [Critique in detail](#critique-in-detail)
  - [`check --lint` warnings](#check---lint-warnings)
  - [Construct census](#construct-census)
- [Modules & imports](#modules--imports)
- [Definition scope](#definition-scope)
- [Values](#values)
- [Coordinates](#coordinates)
- [Drawings](#drawings)
- [Pixel literals](#pixel-literals)
- [Primitives](#primitives)
- [Paths](#paths)
- [Regions & masks](#regions--masks)
- [Transforms & stamp](#transforms--stamp)
- [Anchored assembly — pin / fit](#anchored-assembly--pin--fit)
- [Skeleton & pose](#skeleton--pose)
- [Expressions, functions, loops](#expressions-functions-loops)
- [Scatter](#scatter)
- [Mirror](#mirror)
- [Color](#color)
- [Palettes](#palettes)
- [Gradients & filters](#gradients--filters)
- [Light & material](#light--material)
- [Themes](#themes)
- [Text & fonts](#text--fonts)
- [Atlases](#atlases)
- [Export](#export)
- [Determinism & budget](#determinism--budget)

## CLI

Runner prefix (`bunx` / `npx` / `pnpm dlx` / `yarn dlx`) omitted below.

| Command | Purpose |
|---|---|
| `drawstic check <file> [--lint] [--rows] [--json]` | parse + semantic validation. `--lint` adds authoring warnings; `--rows` adds per-`pixels:`-block row-width metadata (find ragged rows). |
| `drawstic fmt <file> [--check] [--stdout] [--diff] [--json]` | canonical formatter. Default rewrites in place; `--check` fails (no write) if unformatted; `--stdout` prints instead; `--diff` adds first-changed-line metadata to `--check --json`. |
| `drawstic context <file> [--json]` | resolved design brief: merged theme palette (key→hex+source), merged style guide, theme default light (`theme.light`), available drawings (name, WxH, ASCII preview), functions (signatures), export plans, per-drawing facts (size source, palette keys, draw-local `themes` (its `use` names) + effective `themePalette`, fitted-preview hints). Read before editing files with imports/themes. |
| `drawstic build <file> [--out <dir>] [--json]` | run every `export`, write artifacts (`--out` defaults to the recipe file's own directory — an explicit `--out` relocates the whole tree). JSON: `{diagnostics, artifacts: [{path, bytes}]}`. |
| `drawstic render <file>#<drawing>[(args)] …` | ad-hoc render of one drawing ([Render outputs](#render-outputs) below). |
| `drawstic help` (or `--help`, `-h`, no args) | usage text, exit 0. Works as a flag after a subcommand too (`render --help`). |
| `drawstic version` (or `--version`, `-v`) | the installed package version, exit 0. |
| `drawstic sheet <file> [--all] [--cols N] [--png@N] [--out <path>] [--stdout] [--ascii] [--preview] [--json]` | family contact sheet: composes selected drawings size-normalized into one labeled comparison grid ([`sheet`](#sheet--family-contact-sheet) below). |
| `drawstic critique <file> [--as icon\|scene\|character\|item] [--family a,b,c] [--strict] [--json]` | pixel-based, vision-free quality checks (`C0xx`) over every rendered non-parametric drawing, plus family checks across siblings — full breakdown in [Critique in detail](#critique-in-detail) below. |

### Fragment arguments

A parametric drawing takes literal args directly in the `#<drawing>(...)` fragment —
`render parts.drw#house(#c04040, 3)` — no throwaway wrapper draw needed. `(...)` must sit immediately
after the name (no space). Args are restricted to recipe-language *literals*: number, color
(`#rrggbb[aa]`) or `transparent`, string, point (`x:y`, plain signed numbers only), boolean — no names,
arithmetic, or nested calls (E004). No parens, or `()`, means zero args (today's behavior). Argument
count must match the drawing's own params — a mismatch is `E011` with a hint spelling out the fix
(`pass literal arguments: render <file>#house(c, count)`). Non-parametric targets (a plain `draw`, an
`atlas`/`image`) take no args.

### Render outputs

Mutually exclusive:

- default → writes `<drawing>.png` (`--png@N` → `<drawing>@Nx.png`, nearest-neighbor N×); `--out <path>`
  overrides; `--stdout` streams the PNG. Judge form/colour at `--png@4`+ (or `--ascii`/`--preview`) — a
  native `@1` sprite is usually too small on screen to assess.
- `--ascii` → pure-ASCII grayscale approximation (luminance ramp ` .:-=+*#%@`, transparent = space; no
  ANSI codes).
- `--preview` → ANSI truecolor half-block preview (two pixel rows per line).
- `--inspect --json` → `{width, height, distinctColorCount, alphaCoverageBBox, opaquePixelCount,
  transparentPixelCount, palette, namedMasks, occupancy}` — form-sanity stats so an agent can
  sanity-check composition without reading pixels:
  - `palette[]` entries add `opaquePixelShare`: the fraction of *opaque* output pixels whose committed
    sRGB is nearest that entry's color (squared distance over r/g/b; ties keep the first-declared
    entry) — an attribution *heuristic*, not an exact-match count, since gradients/filters/AA rarely
    composite back to the exact declared color.
  - `namedMasks[]` is one `{name, bbox, coveragePixelCount, coverageFraction}` per module-scope
    `mask NAME = <region-expr>` binding (the reusable form, [Regions & masks](#regions--masks) below) —
    **not** a mask declared inside the draw body itself, which is drawing-local and never escapes the
    render call. `bbox`/coverage are scanned against the actual (possibly `--crop`ped) canvas, `null`/`0`
    if the mask touches no canvas pixel; `coverageFraction` is density *within the mask's own bbox* (a
    thin ring reads sparse even though its bbox is a full square), not a fraction of the whole canvas.
- `--explain` → prints the exact primitive expansion of every `model`/`cel` command instead of an image:
  each record `{command, region, light:{x,y}, steps:[…]}`, one step per lowered primitive with its
  resolved args — `{op:'fill'|'shade'|'light'|'rim'|'ao'|'cast', color, amount?, point?, dir?, width?,
  offset?}` for `model`, `{op:'band', color}×N` for `cel`. Renders the drawing to run the commands, then
  reports the trace (no PNG written). It also reports each `fit`'s placement (landed pins, aim angle)
  and, for a two-phase assembly with `behind`/`front` relations, the resolved bottom-to-top `paintOrder`
  (each `{name, reason}`) and each relation's `occlusions` (`{behind, front, clause, overlap,
  violating}`). `--json` → `{diagnostics, render:{kind: 'explain', explain:[…], placements:[…],
  paintOrder?:[…], occlusions?:[…]}}`; plain text otherwise. The predictability guardrail: verify a
  material lowers as intended, or copy the sequence down to the raw primitives to hand-tune.
  Output-kind order is `--ascii` > `--preview` > `--inspect` > `--explain` > PNG.

Every render kind's JSON also carries `render.stats = {unknownPixelCount, unknownColorCount,
paletteCoveredPercent}`: how much of the painted (non-transparent) sprite is covered by its own declared
`palette` artifact vs. colors that only came from rendering. **`paletteCoveredPercent` is near-meaningless
for procedural scenes today** — gradients/filters/`mix` routinely paint colors no `palette` key ever
declared, so a low score is normal, not a defect. For a gradient/procedural scene a high
`unknownColorCount`, a low `paletteCoveredPercent`, and a lopsided per-key `opaquePixelShare` are **all
expected** (nothing to fix); read them as rough attribution, not an error signal. `--inspect`'s per-key
`opaquePixelShare` is still the most actionable per-color view.

Render modifiers: `--fit WxH` (downscale ascii/preview only), `--crop x:y WxH` (the size slot is
**`WxH`**, e.g. `--crop 96:56 72x44` — a `x:y` **point** in the size slot is **silently ignored** and the
full canvas renders, no error), `--mode pixel|smooth` (override theme), `--budget N` (evaluation-step
cap).

**`--silhouette` — shape-only black-out.** A deterministic framebuffer pre-pass applied **before** the
output kind is chosen: every pixel with `alpha > 0` becomes opaque black `#000000ff`, `alpha == 0` stays
transparent (a hard 1-bit coverage mask). The colour-free shape test — silhouette legibility, occupancy,
modular-part alignment. Composes with every output kind (`--ascii`/`--preview`/`--inspect`/PNG via
`--png@N`) and every downstream framebuffer op (`--crop`/`--fit`/`--grid`); `--inspect` then describes
the silhouette (a fully-opaque sprite collapses toward `distinctColorCount: 1`) and `--json` carries
`silhouette: true`. **Caveat:** under `--ascii` the luminance ramp reads black as empty — view a
silhouette as PNG or `--preview`. Never reaches `build`.

**Debug-only PNG aids** (never reach `build` exports; inert under `--ascii`/`--preview`/`--inspect` since
those short-circuit before the PNG stage):

- `--grid N` → burns a coordinate overlay into the PNG output raster only: gridlines every N *source*
  (recipe) pixels, always exactly 1 *output* pixel thin and landing on recipe-pixel boundaries even under
  `--png@K` (pitch scales, line width doesn't), plus edge coordinate labels (source-pixel values; label
  glyphs scale with `--png@K` for legibility — use `--png@4`+ to read them). High-contrast strategy:
  every overlay pixel is a full color invert of the pixel underneath, forced opaque — visible over any
  scene.
- `--diff <png>` → compares the fresh render against a previous PNG (decoded via the `image`-path
  decoder), reporting `render.diff = {identical, changedPixelCount, totalPixelCount, changedBBox: {x, y,
  width, height} | null}` under `--json`, or a `diff: N/M px changed, bbox x:y WxH` line otherwise — the
  machine/human answer to "did this edit touch only the region I meant to?". The comparison always uses
  the fresh render's UNgridded pixels, even when `--grid` is passed in the same invocation — grid is
  purely cosmetic on the PNG bytes written to disk. A dimension mismatch (different `--png@N`/`--crop`
  than the comparison PNG) is `E023` with a hint; an unreadable or undecodable comparison PNG is `E019`.

**`--json` everywhere.** Diagnostics are stable records `{severity: "error"|"warning", code:
"E###"|"W###", message, file, line, col, hint?}`. `check --json` emits the bare array (`[]` = clean);
other commands wrap `{diagnostics, …payload}`. Exit code is non-zero iff any `error` was produced.

### `sheet` — family contact sheet

Composes every selected drawing at its native size, each centered in a uniform cell (normalized to the
largest drawing + widest label) on a transparency checkerboard with a 1px frame and its name captioned
below in the `small` font — one labeled grid for family-consistency QA (radii / stroke / grey-value /
hue balance across siblings). **Selection:** default = the module's `export`ed drawings in
export-declaration order; `--all` = every non-parametric drawing in definition order. Parametric
drawings are never rendered (no args); a module with no non-parametric drawing at all is `E022`. Output
kind follows `render`'s precedence (`--ascii` > `--preview` > PNG); default PNG path is
`<basename>.sheet.png`. `--cols N` sets columns (clamped to the tile count; default `ceil(sqrt(n))`),
rows are `ceil(n/cols)`. Layout is byte-deterministic. `--json` reports layout, not pixels:
`{diagnostics, sheet: {cols, rows, cell: {width, height}, width, height, cells: [{name, w, h, x, y}],
kind, output}}` — `x`/`y` are the tile's top-left in **unscaled** sheet coordinates (× `--png@N` for
output pixels). Never part of `build`.

### Critique in detail

`drawstic critique <file> [--as icon|scene|character|item] [--family a,b,c] [--strict] [--json]` runs a
catalog of pixel-based, vision-free quality checks (`C0xx`) over every rendered non-parametric drawing,
plus family checks across siblings.

**Category-agnostic checks** (always run, regardless of `--as`):

| Code | Fires when |
|---|---|
| C001 | empty/near-empty canvas |
| C003 | optical centering off |
| C004 | value/contrast spread too flat |
| C006 | palette/complexity budget over ceiling — export-target-aware, see below |
| C008 | interior pinholes |
| C012 | asymmetric bottom-padding |
| C013 | occlusion parity: a declared `behind`/`front` relation whose behind-part is still visible atop its occluder in the composite |

Without `--as`, only this agnostic subset runs, plus a `C000` info nudge to pick a profile.

**Profile-gated checks** — `--as` selects a category profile (thresholds are never inferred) and opts in:

| Code | Fires when | Gated to |
|---|---|---|
| C002 | edge-clip: opaque content touching a canvas edge | `icon`/`item` only, never full-bleed scenes |
| C007 | floating-part/seam: 8-connected components + chamfer distance | `character` only |
| C005 | stroke width under the profile floor | `icon`/`item`/`character` |

**Family checks** compare the exported siblings (or `--all`; `--family a,b,c` overrides), minus any
drawing that is itself a composed presentation of ≥2 other candidates (a hand-built `draw xSheet: stamp
xFront …; stamp xSide …` panel never pollutes its own family — name it explicitly via `--family` if you
do want it compared). Need ≥2 members:

| Code | Fires when |
|---|---|
| C009 | sibling-silhouette collapse: scale-/position-invariant 32×32 signatures, mass-normalized L1 < 0.12. Under `--as character`, never fires between two views that share a front/side/back name stem (e.g. `knightFront`/`knightBack`); still fires between different characters/items |
| C011 | weight parity: a sibling >6× off the family median mass |

**Severity and `--strict`.** All findings default to `warning` (exit 0, never blocking). `--strict`
promotes only the *unambiguous* must-fix subset to `error` (exit 1, the CI regression gate): **C001**
empty, **C007** character seam, **C013** occlusion parity (declarative, no false-positive risk), plus
**C003** for `icon`. C002/C005/C006/C008/C009/C011/C012 stay advisory — silhouette-sharing
recolors/shared-shells, gradient sprawl, and legitimate small gaps are correct art, so none of them trip
the `--strict` exit.

**C006 is export-target-aware:** only a drawing that declares an indexed-PNG (`png … indexed`) or `svg`
export budgets its colour count — there it is a `warning` that blocks `pass` (indexed palettes cap, SVG
emits one `<rect>` run per band). A straight-alpha RGBA-PNG/JPEG target, or no export at all, has no
palette budget (smooth `model` shading spends hundreds of colours by design), so C006 is a non-blocking
advisory `info` there.

Each finding carries `{measured, threshold, fix}`.

```
{ diagnostics,
  critique: { pass, profile, strict, failedCodes,
    drawings: [ { name, width, height, bbox, coveredPixelCount, opaquePixelCount, distinctColorCount,
                   unknownColorCount, luminance, componentCount?, minStrokeWidth?, checks: […] } ],
    familyMetrics?: { members: [ { name, coveredPixelCount, bbox, nearest: { name, distance } } ],
                       distanceMatrix, medianCoveredPixelCount },
    rubric: { renders: […], items: [ { id, when, ask } ], note } } }
```

**`pass` ≠ exit code.** `pass` is `false` on *any* fired finding (must-fix or advisory — one lone
C009/C011/C012 warning flips it); the process exit code trips only on the `--strict` must-fix subset
above, so exit 0 does not imply `pass:true`. Read `failedCodes`/per-drawing `checks[]` for what's
actually outstanding. `pass:true` is necessary, not sufficient — run `rubric.renders` (silhouette-first)
and answer every `rubric.items` prompt by looking. The metric bundle is a superset of `render --inspect`.

### `check --lint` warnings

| Code | Fires on |
|---|---|
| W001 | unused local `palette` key |
| W002 | drawing never `export`ed, `stamp`ed, nor a `fit` target |
| W003 | stamp's literal target at a literal point lands fully off-canvas |
| W004 | *retired* — never emitted |
| W006 | `dither` partner paint statically alpha-0 (transparency hole) |
| W007 | stamp fully covered by a later, provably opaque stamp/fill |
| W008 | `text` literal has char(s) with no glyph in the resolved font (renders as the unknown-glyph box) — static cases only |
| W009 | a `pixels:` grid's **last** row is fully transparent (`.`) while a row above has content — stamps place by top-left, so the trailing empty row silently enlarges the footprint and seams a 1px gap below adjacently stamped parts. Last row only; a fully transparent first row or side column (top-centring / padding) stays legit |
| W010 | a `fit` part touches nothing in the final composite (floating/seamed — the gap C007 measures) |
| W011 | a `fit` target pin sits >2px off the part's own ink (the join floats) |
| W012 | *retired, never reused* — its three commands were removed; a stale recipe shows up as a `retired` census entry instead |
| W013 | a `litTone`/`shadowTone` `fill` clipped by `.intersect(rect)` on a modeled region → use `spread N%` |
| W014 | a `stamp` of a part that declares attach `pin`s (not a pin-seeded root) → `fit` it, or drop the pins if decoration |
| W015 | a semi-transparent `fill … ellipse(…)` in the foot zone of a `fit`-using drawing → use the root `fit … ground` |
| W016 | an `export` base path's first segment repeats the recipe's own directory name → drop the redundant `<dirname>/` prefix |

### Construct census

`critique --json` and `check --lint --json` carry a deterministic `census`: every construct used,
flagged `spec-only`/`non-canonical`/`retired`, plus three `antiPatterns` counts
(`manualSpread`/`stampWithPins`/`handShadow` = W013–W015; target 0). `retired` marks a removed name that
still loads — `castShadow`, `grayscale`, `rim`, `shadeRegion`, `lightRegion`, `ao` — rendering it errors;
the other removals fail to parse/load at all, so they never reach the census. `check --lint --json` wraps
its output as `{diagnostics, census}`.

## Modules & imports

A `.drw` file is a module; every top-level definition is public. There is no version pragma — a leading
`drawstic <N>` line is a positioned error; delete it from any old file.

```drw
from creatures gem, slime        # ./creatures.drw; type inferred
from gems gem as ruby            # alias on collision
from ../shared/parts eye         # parent dir ok; never escapes project root
from std/shapes dot              # bundled std (always available, version-pinned)
use themes dusk                  # apply theme to this file (2 tokens: module `themes` + name `dusk`)
image logo = ../brand/logo.png  # external PNG as a drawing (lossless; JPEG rejected)
image logo = ../brand/logo.png sha256 <hex>   # optional content pin
```

**`use` grammar — arity picks the meaning, not any keyword:**

| Form | Tokens | Meaning |
|---|---|---|
| `use dusk` | 1 (name only) | **local** theme: `dusk` must already be defined in this file, or brought in by an earlier `from <module> dusk` |
| `use themes dusk` | 2 (path + name) | **imported** theme: load `dusk` straight from `themes` (→ `./themes.drw`) — no `from` needed first |
| `use std/themes pixelBase` | 2 | same 2-token form, bundled `std/` module |

`themes` here is a **bareword module path** (a sibling file `themes.drw` by convention), never a
keyword — any module name works in that slot. Confusing the two forms is the #1 cause of `E008 module
not found`: `use pixelBase` fails unless `pixelBase` was imported by name first; the fix is either `from
std/themes pixelBase` + `use pixelBase`, or the one-line `use std/themes pixelBase`.

Module paths are bareword, `/`-separated, `.drw` implied, no quotes/globs/network. Resolution is
relative to the importing file and sandboxed to the **project root — the CLI's working directory**
(`..` escaping it = E008); run drawstic from the tree containing all recipes. Import cycles between
modules are errors; definitions within a module are order-independent. `export` elements are not
importable.

**Bundled `std/shapes` parts** (tiny abstract marks; `(c)` = takes a paint, the rest are fixed dark
`#1a1a1a`): `arrow` 7×7 right arrow · `dot` 3×3 **plus/cross** (a `+`, *not* a filled disc) · `spark(c)`
5×5 thin 4-ray · `star4(c)` 7×7 4-point star · `dash(c)` 5×1 line · `arcMark(c)` 7×4 shallow arc ·
`zig(c)` 7×3 zigzag · `blob(c)` 7×5 filled lump · `capsule(c)` 8×3 filled bar · `leaf(c)` 7×4 filled leaf
with midrib · `tri(c)` 5×5 filled triangle (apex up). For anything more concrete, author it locally or
copy from the motif cookbook — `std` stays abstract.

## Definition scope

| Kind | Module scope | Drawing-local | Notes |
|---|---|---|---|
| `draw` `path` `fn` `theme` `atlas` `export` | yes | **no** — E004 | order-independent; may forward-reference each other |
| `filter` | yes | **yes** | module-level `filter name:` is order-independent like `fn`; a `filter name:` written inside a `draw` body is drawing-local and must precede its `apply name` |
| `mask` `gradient` `light` `material` `palette` / any binding (`=`) | yes | yes | sequential, not order-independent — a drawing-local one must be written before it is used |

Writing `fn`/`path` (or `draw`/`theme`/`atlas`/`export`) inside a `draw` body is a positioned `E004`.
`mask`/`gradient`/`light`/`material`/`palette`/`filter`/bindings have no such restriction — they read
identically at module or drawing-local scope; only their *position* changes what's already in scope
when they run.

## Values

| Value | Syntax | Notes |
|---|---|---|
| Number | `10`, `3.5`, `-2`, `10%` | `%` divides by 100. Literal needs a leading digit (`0.2`, never `.2`). |
| Point | `x:y` | component-wise arithmetic; `pt * 2`, `pt + 1` (number promotes to `n:n`), unary `-`; components `pt.x`/`pt.y` (UFCS `x(pt)`/`y(pt)`). |
| Color | `#1a1a1a`, `#fff`, `#rrggbbaa`, `oklch(l, c, h)`, `rgb(r, g, b)`, `hsl(h, s%, l%)`, `transparent`, palette name | first-class value. |
| Region | shape call without paint, `d.region`, set-ops | per-pixel coverage. |
| Transform | `rotate(45).about(8:8)`, `shift(2:0)` | 4×4 matrix, first-class. |
| List | `1, 2, 3` (bare; parens only group/nest) | `xs[expr]` any-expression index, `xs.0` literal index; destructure `r, g, b = rgb`; `len(xs)`; `xs.cycle(i)` auto-wraps (incl. negative `i`) — sugar for `xs[i mod len(xs)]`; empty list is E015. |
| String | `"…"`, `"""…"""` | text/style guides only; paths are bareword. |
| Boolean | comparisons, `true`, `false` | logic `& \| !`. |
| Light | `light NAME = dir DX:DY COLOR [amb COOL AMT] [gain N]` / `= at X:Y …` | first-class light source (§ Light & material); drives `model`/`cel` (theme default or `light L` arg). |
| Material | `material NAME = COLOR [RESPONSE] [round\|drape] [shade/hi/rim/ao/spec/puff/spread N]` | base colour + response dose profile (+ optional `round`/`drape` height-field profile + trailing dose overrides, `spread N%` = value-spread knob); consumed by `model`/`cel`. |

Indices must be integers (fractional = error). `xs.0` is an index; `xs.name` is a UFCS call.

## Coordinates

Origin `0:0` top-left, y down; pixel centers at integers; `WxH` addresses `0:0 … W-1:H-1`. Quantization
at rasterization: pixel mode rounds half-up to integers; smooth mode to a 1/16 subpixel grid. Canvas
size, pixel cells, `px`, stamp position/scale always coerce to integers. Out-of-bounds is silently
clipped. `w`/`h` = resolved canvas size of the current drawing. No implicit cursor; `rel` prefixes exist
only inside `path` bodies.

## Drawings

```drw
draw name(params) WxH:    # params optional; size optional (resolution order below)
  use themes t            # leading lines only: theme for this drawing
  title "…"               # optional; emitted to SVG <title>/<desc>
  palette …                   # local palette
  pixels: …               # explicit rows
  <commands / stamps / expressions / loops>
```

Size resolution (first wins): explicit header (checked against `pixels:` rows if both) → inferred from
`pixels:` → `size WxH` default (module- or theme-scope directive) → error. `W`/`H` are integer literals
only. A `draw` never referenced by an `export` is a component.

## Pixel literals

`pixels:` = raw rows, one char per pixel, until dedent. Keys: one ASCII letter each, resolved in the
**palette namespace only** — a visible single-letter `palette`/theme entry (a plain value binding of the
same letter is never a cell); a letter with no palette entry = `E007`. `.` = built-in transparent
(declaring it = error). Equal row widths (header mismatch = error; rows define size when header
omitted). No trailing comments on rows. Rows and commands may coexist — rows first, then draw on top.
`w`/`h` are legal palette keys (they shadow the canvas-size binding in that draw).

## Primitives

`<paint>` = color or gradient. **The paint is the first argument of every command** — paint first,
geometry after, flags last. Stroke width: trailing `w<N>` (default 1; a uniform round-cap/round-join
brush in both modes — that's the only brush the engine renders, so trailing `cap`/`join` flags no longer
exist and now hard-error) — on every stroking command **except `poly`** (see its row).

| Command | Form |
|---|---|
| `bg` | `bg <paint>` — fill the canvas |
| `px` | `px <paint> <pt>` |
| `line` | `line <paint> <a> <b>` — inclusive Bresenham |
| `rect` | `rect <paint> <a> <b> [fill]` — corners a, b |
| `rrect` | `rrect <paint> <a> <b> <r> [fill]` |
| `circle` | `circle <paint> <c> <r> [fill]` — even 2r diameter: covers pixels `c−r … c+r−1` per axis, visual centre `c−0.5` (r>0); `r=0` = one pixel |
| `ellipse` | `ellipse <paint> <c> <rx>:<ry> [fill]` — even 2rx×2ry footprint, same convention as `circle`: covers `c−rx … c+rx−1` × `c−ry … c+ry−1`, visual centre `c−0.5`; a circle is exactly the `rx==ry` ellipse; a zero axis = a 1px line |
| `arc` | `arc <paint> <c> <r> <a0> <a1>` — degrees, 0°=+x, clockwise |
| `quad` | `quad <paint> <p0> <c1> <p2>` |
| `bezier` | `bezier <paint> <p0> <c1> <c2> <p3>` |
| `curve` | `curve <paint> <p1> <p2> <p3> … [w<N>]` — open spline **through** the points (≥3; centripetal Catmull-Rom) |
| `curvePoly` | `curvePoly <paint> <p1> <p2> <p3> … [fill]` — closed loop through the points; `fill` = solid mass, else inner-boundary stroke; a Region without paint (≥3) |
| `profile` | `profile <paint> <span> <fn> [<baseline>] [fill]` — filled area under `y=f(x)`, one sample/column; `fn` gets normalized x∈[0,1]; a Region without paint |
| `poly` | `poly <paint> <p1> <p2> … [fill]` — no trailing `w<N>` (its variadic point tail consumes it: `w2` → `E001 unknown name 'w2'`); for a wide outline stroke a Region: `stroke p poly(p1, p2, …) w2` |
| `dome` | `dome <paint> <c> <rx>:<ry> [fill]` — upper half of the same-param `ellipse`, flat bottom edge (rows `cy−ry … cy−1`; `c` = flat base midpoint) — skull/helmet/hat crown |
| `lobe` | `lobe <paint> <base> <tip> <w> [fill]` — teardrop: round cap (Ø`w`) at `base` tapering to a point at `tip` — ear/hair strand/nose/plume/tassel |
| `crescent` | `crescent <paint> <c> <rx>:<ry> <thick> <dir> [fill]` — outer ellipse minus inner (`thick` px smaller, shifted `thick` toward `dir`); thickest opposite `dir`, tapers to 0 on the `dir` side — fringe/brim/eyelid |
| `ribbon` | `ribbon <paint> <p0> <p1> <p2> <w> [fill]` — width-`w` ribbon along the arc through the 3 points; **stacked = turban wraps**; curved hat band/belt |
| `fill` | `fill <paint> <region>` — rasterize any region solid |
| `stroke` | `stroke <paint> <region> [w<N>]` — inner boundary, width N; on a region whose **short axis is ≤2N px** the border spans the whole region and the fill shows 0 % (an 8×2 bar stroked `w1` is 100 % stroke colour) — fill thin bars/bones/blades, don't stroke them |
| `text` | `text <paint> <pt> <string> [font <name>]` — top-left at pt |

`quad`/`bezier`/`arc`/`curve`/`curvePoly` flatten by a fixed rule (Catmull-Rom curves: each span →
`clamp(ceil(chord), 4, 64)` segments) but round every point to the pixel grid — below roughly 12px that
rounding dominates and the curve reads as blocky chunks, not smooth. Prefer `pixels:` for small curved
details.

`curve`/`curvePoly` are **through-points** splines (centripetal Catmull-Rom, ≥3 points): the line passes
through every point you give, so prefer them over stacking `bezier`s or ellipses for organic shapes
(dunes, hills, waves, fronds, clouds, rocks). `curve` is open and stroke-only; `curvePoly` is a closed
loop, its `fill` and stroke share one tessellation (they align) and its fill is even-odd.

**`curvePoly` geometry caveats** (all silent — `check` passes, the shape is just wrong): the closed
spline also smooths *between the base points*, so a flat underside (island/hill on a waterline) **bulges
below** the base row — clamp it with `.intersect(rect(…))` on the base edge. Overlapping **translucent**
(`alpha`) loops **compound in the overlap** into a muddy lump — use fewer, narrower loops with less
overlap. Below ~12px a `curvePoly` is an unrecognizable blob — hand-author small curved details with
`pixels:` instead.

`profile <paint> <span> <fn> [<baseline>] [fill]` fills the area under `y = f(x)` — the built-in for a
*procedural* horizon (dune / hill / noise ridge) authored as a **function** rather than points. It
**samples once per column** and calls `fn` with a **normalized x in `[0,1]`** (first column 0, last 1);
`fn` (a unary `fn <name> nx = …`) returns the top-edge `y` in recipe pixels. The `<span>` is a
range/list of x-columns (`0..w` = the whole width; inclusivity follows `..` vs `..=`), one element per
column. Each column fills the inclusive rows between `round f(x)` and `<baseline>` (a plain number
before the flags; **defaults to the canvas bottom `h−1`**), so exactly one contiguous run per column,
above or below the baseline. Because `fn` never sees a raw pixel coordinate, the noise-frequency trap is
unreachable — `noise(seed, nx * K, 0)` with a small `K` (undulations across the span) is smooth by
construction:

```drw
fn ridgeY(nx) = 16 + round(noise(3, nx * 4, 0) * 10)   # ~4 smooth undulations
profile #c9a06b 0..w ridgeY fill                       # dune filled to the bottom
mask dune = profile(0..w, ridgeY)                      # paintless → Region, for model/grain
```

Both lines above are **draw-body** statements: `w`/`h` are the canvas size and exist only inside a
`draw` (at module scope `profile(0..w, …)` is `E001 unknown name 'w'`). Keep the mask drawing-local, or
hard-code the span (`profile(0..64, …)`) if you need it at module scope. The optional baseline likewise
defaults to the canvas bottom `h−1`, a draw-scope value.

Shapes are region constructors (`rect`/`rrect`/`circle`/`ellipse`/`poly`/`curvePoly` + the organic
`dome`/`lobe`/`crescent`/`ribbon`): with a leading paint at statement position they draw (`circle k 8:8
5` ≡ `stroke k circle(8:8, 5)`; `… fill` ≡ `fill k circle(8:8, 5)`); without a paint, the call is a
Region expression (`mask blob = curvePoly(4:12, 12:3, 20:12, 12:21)`; `mask cap = dome(8:8, 6:6)`). A
paintless shape *statement* is an error. The four organic constructors are exact analytic tests (smooth
at any size, no bezier blocking) and even-diameter consistent with `circle`/`ellipse`.

## Paths

```drw
path name [WxH]:          # WxH = viewBox for export/gradient bounds
  move [rel] <pt>         # start contour
  line [rel] <pt>
  quad [rel] <c> [rel] <pt>
  bezier [rel] <c1> [rel] <c2> [rel] <pt>
  arc [rel] <pt> around <center> cw|ccw
  close

path combo = keyhole.union(slot)   # expression form
```

Local pen cursor (never escapes). Paint at use site: `fill paint p`, `stroke paint p w2`. Methods:
`.fill()` → Region (even-odd) · `.stroke(n)` → Region · `.union/.intersect/.subtract/.xor(p)` → Path ·
`.shift(pt)/.scale(n)/.rotate(deg)/.flipx()/.flipy()/.transform(t)` → Path.

`arc <pt> around <center> cw|ccw` sweeps **clockwise as drawn on the y-down screen** (silent — no
`check` error for the wrong side). For a left→right chord with the centre on it, `cw` bulges the arc
**up** (smaller y), `ccw` **down**; the wrong one sends the curve off-canvas (an invisible dome) — render
to confirm. A full circle built from four `arc … around` quarters just reinvents `circle()` (and
rasterizes slightly differently at the rim) — use `circle()`.

## Regions & masks

```drw
mask keyhole = circle(8:5, 4).union(rect(6:5, 9:14))   # top-level or drawing-local
mask keyhole:            # block: statements inside clip to the region
  bg #e0b070
stamp crest 4:4 mask keyhole                            # inline on a stamp
fn ring(c, r) = circle(c, r).subtract(circle(c, r - 2)) # fns compose regions
mask m = gem.region.scale(2).shift(4:4)                 # any drawing's silhouette (alpha>0)
fill #ffffff.alpha(50%) face.edge(0:1)                  # 1px band on the TOP edge
fill #0a1220.alpha(35%) face.edge(0:-1, 2)              # 2px dark bevel on the bottom
```

Set-ops: `.union` `.intersect` `.subtract` `.xor`. Placement: `.shift(pt)`, `.scale(n)`, `.transform(t)`.
Paths convert explicitly: `mask badge.fill():`, `slash.stroke(2)`.

**`r.edge(dx:dy [, n])`** = the one-sided edge band, `r.subtract(r.shift(sign(dx)·n : sign(dy)·n))`. `n`
defaults to 1; only the direction's **sign** matters; `0:0` (or `n = 0`) is empty. Read the direction as
**where the light travels**, so `0:1` (down) = the **top** edge, `1:0` (right) = the **left** edge. One
region ⇒ one fill ⇒ a translucent paint lands at its own alpha, no stacking. It takes **any** paint —
this is how you get a *dark* contour edge, which a material `rim` dose (always toward the light colour)
cannot make.
**Order matters:** `r.edge(d).intersect(c)` clips the silhouette band (right); `r.intersect(c).edge(d)`
bands the clip rectangle and lays a bar across the middle of the mass. Parametric silhouettes:
`region(key(r))`. Only the **top-level** form (`mask keyhole = …` above the `draw`) shows up in `render
--inspect --json`'s `namedMasks` — a drawing-local `mask NAME = …` is invisible to `--inspect` since it
never escapes the render call.

## Transforms & stamp

```drw
stamp name[(args)] <pt> [anchor <name>] [flipx] [flipy] [rot<deg>] [scale<N>]
      [transform <t>] [tint <paint> <amount>] [shadow <dx:dy> <paint>] [mask <region>]
```

Top-left placement by default; anchors `topLeft top topRight left center right bottomLeft bottom
bottomRight` place a footprint anchor point at `pt` (round-half-up). `shadow dx:dy paint` paints the
transformed silhouette at the offset first. `tint p 0.3` blends stamped pixels toward p by 0..1. On a
**composite** sprite (roof + posts + basin) that offset silhouette fills the gaps and reads as a heavy
dark clump, not a cast shadow — for a standing object drop a separate `ellipse … fill` ground shadow
instead.

**Anchors are *visual*: the eight offset anchors name a spot on the bounding box you actually see, after
flip/rotate/scale.** `anchor bottom` = the visible bottom-center; `anchor bottomLeft` + `flipx` lands the
visible **bottom-left** at `pt` (the flip does not move the label); `anchor bottom` + `rot90` lands the
rotated footprint's visible bottom-center. Untransformed stamps are unaffected. `topLeft` (and the
default no-`anchor`) is special: it puts the sprite's untransformed **origin** at `pt`. Reflect a sprite
by naming the seam edge on both copies:

```drw
stamp boat 40:30 anchor bottom                         # hull above the waterline
stamp boat 40:30 anchor top flipy tint #305070 40%     # reflection: top edge meets the same pt
```

Placing by a computed point (point arithmetic on `pt`, or `.about(pt)`) is plain geometry.

Constructors: `shift(pt)` · `rotate(deg)` (clockwise on the y-down screen — `+90°` sends up→right; mirror
the sign for a symmetric pair) · `scale(n)` uniform / **`scale(sx, sy)` non-uniform** · `skew(deg)` ·
`flipx()` `flipy()` · **`matrix(a, b, c, d, e, f)`** (2D affine, CSS order) or **`matrix(…16)`** (full
row-major 4×4) · `rotatex(deg)` `rotatey(deg)` `perspective(d)`. Anchor: `.about(pt)` (default origin
`0:0`). A region's own `.scale(n)` is uniform only — flatten/squash a region via
`region.transform(scale(1, 0.35).about(pt))`. `rotatex`/`rotatey` on flat `z=0` content is only an
orthographic squash unless paired with `.perspective(d)` (real keystone:
`rotatey(θ).perspective(d).about(center)`; for a ground/floor tilt a 2.5D poly fake looks better).
**Reading order = application order** (`rotate(45).scale(2)` rotates first). Sugar: `rot45` ≡
`transform rotate(45).about(((w−1)/2):((h−1)/2))`; `flipx`/`flipy` = centre mirrors; `scale2` ≡
`transform scale(2)`; combined flags expand flip → scale → rotate. Pixel mode resamples
nearest-neighbour (no new colors); mirrors, quarter-turns, integer shifts/scales are lossless;
non-invertible transforms are errors.

## Anchored assembly — pin / fit

```drw
pin <key> <pt>                                     # attach point in this drawing's own space
fit <partB>[.<pin>] <partA>.<pin> [flags] [rel] [aim <pin> <pt>] [ground]  # land partB's pin on partA's placed pin
fit <partB>.<pin> <x:y> [flags] [rel] [ground]     # ground oracle: land the pin on a computed point
stamp <part> <pt> [flags] [rel]                    # rel = behind <part> | front <part>
```

- **`pin key pt`** — a bare key in a **part** (`pin shoulder 4:0`) exports on the rendered sprite; a
  dotted `part.name` in an **assembly** (`pin torso.shoulder 16:14`) seeds a canvas attach point. When
  `part` names an already-drawn part, this seeds **all** its pins from the one anchor (so a later `fit
  …torso.hip` chains without re-declaring); a bare hand-label (`a.spot`) seeds just one.
- **`fit b.pin a.pin`** solves the translation so `b`'s pin lands exactly on `a`'s placed pin, then
  registers `b`'s pins in canvas space so the next `fit` chains (`fit hand.wrist arm.wrist`). Bare `fit b
  a` auto-matches a single shared pin name. Replaces hand-stamped socket offsets.
- **Transform flags** — `fit` takes the same modifiers as `stamp` (`flipx`/`flipy`/`rotN`/`scaleN`/
  `transform t`/`tint c p%`/`mask r`), about the footprint centre. **The pin rides the transform:** the
  fit pin still lands exactly on target, and `b`'s other pins register through the same flip/rot (a
  left-shoulder pin becomes the correctly-located right shoulder after `flipx`). Enables the depth-tint
  far limb (`fit armFar.shoulder a.shoulder tint #2b2b2b 45%`) and mirrored side/back parts.
- **Contact guarantee:** checked against the drawing's **final composite** (every later `stamp`/`fit` has
  painted) — deliberate back-to-front layering (e.g. fitting feet before the covering robe is stamped
  over them) never false-warns just because the covering part hadn't painted yet. No pixel contact by
  the end of the body ⇒ non-fatal **`W010`** gap warning (the seam `critique` C007 also measures) —
  never silent, and in the `diagnostics` of `render`, `build`, and `sheet` alike. `fit` reuses the
  `stamp` blit (same alpha/palette).
- **Placement self-check (contact ≠ correctness):** a target pin >2px off the part's **own ink** warns
  **`W011`** (loose pin) — the pins coincide but the join floats because the pin is in empty part space
  (a chin below the head). `render <file>#<draw> --explain` prints a per-`fit` line (landed coords ·
  coincident? · pin-to-ink gap) so a misplacement is *visible*, not silently green.
- **Held prop across views:** author the prop once in its true orientation with a `grip` pin, grip it
  with `fit sword.grip hand.grip`; the per-view *figure* flip is a separate `fit` that never touches the
  prop, so the blade keeps its direction front/side/back. Mirror the prop deliberately with its own `fit
  … flipx`, never via a figure-wide flip.
- **Ground oracle:** a computed-point source plants on terrain — `fit tree.base x:duneY(x/(w-1))` (needs
  a named target pin) → floating/sinking impossible.
- **`ground`** flag: auto contact-shadow ellipse anchored at the footprint bottom (the feet), not the fit
  pin — a joint-to-joint fit still pools under the feet, never at the hip. Drawn first (feet cover it),
  cool from the light in scope.
- **Occlusion relations** — `behind <part>` / `front <part>` trailing clauses on `stamp` **and** `fit`
  layer the subject below/above an already-placed part in the resolved paint order (no `z` numbers).
  Assembly is two-phase: placements defer into layers and composite in a minimal-disruption topological
  order (a lone `behind` moves only its subject; ties = statement order); inline paints
  (`fill`/`px`/`outline`/…) are barriers that keep their sequence slot. A conflicting pair is a positioned
  **E025** cycle; an unplaced target errors. `critique` **C013** measures each relation in the composite
  (a still-visible behind-part fires; declarative so it is a `--strict` must-fix).
- **`aim <pin> <pt>`** (fit only) — rotate the part about its fit pin until the named second `<pin>`
  points at canvas `<pt>` (any angle). Orient a bow/sword per view without a redraw: `fit bow.grip
  a.grip aim tip 60:20`. Pins ride the rotation. `render --explain` prints the resolved paint order,
  each solved `aim N°`, and each relation's overlap/violation.

`pin`/`fit` are contextual keywords (only in these statement shapes) — bindable as names elsewhere.
`behind`/`front`/`aim` are likewise contextual (only in the trailing slot of `stamp`/`fit`).

## Skeleton & pose

```drw
skeleton body:                          # module scope: a rig — the three views are poses of it
  pelvis at fig.hip                     # anchored joint: position from a point (usually a fig guide)
  shoulderL at fig.shoulderL
  hipL at fig.hipL
  armL from shoulderL 90 20 limit -60:120   # FK joint: parent, local rest angle°, bone length

pose front over body:                   # module scope: an angle set over a skeleton
  view front                            # folds the figure oracle to this projection
  shoulderL 0 z 2                       # JOINT DELTA° [z DEPTH] — DELTA adds to the rest angle
  hipL 0 z 0                            # z DEPTH: auto-Z (higher = nearer the viewer)

draw front 64x128:
  pose front                            # solve the rig over this canvas + figure oracle
  fit torso.neck bone chest             # land the pin on joint `chest`, inherit its pose orientation
  fit legL.hip  bone hipL ground
```

- **`skeleton NAME:`** — a joint per line: `NAME at POINT` (anchored — usually a `fig` guide point, so
  the rig binds to the figure oracle's proportions) or `NAME from PARENT ANGLE LENGTH` (forward-kinematic
  — placed off its parent; both read `fig`). `limit MIN:MAX` (either form) bounds the pose delta. Parents
  first. FK is deterministic; a delta on a parent rotates the whole subtree.
- **`pose NAME over SKELETON:`** — `view front|side|back` folds `fig` to that projection; each `JOINT
  DELTA [z Z]` adds `DELTA°` to the rest angle. A delta **outside a joint's `limit` is a positioned
  error** (never a silent clamp). `z Z` is the joint's view depth.
- **`pose NAME`** (draw body) — solves the pose's skeleton over the drawing and binds every joint as a
  bone anchor. A view/stance is one pose.
- **`fit part.pin bone JOINT`** — land `part`'s pin on joint `JOINT`'s solved position and rotate the
  part by the joint's pose-angle change about the pin (inherits the bone orientation). At the rest pose
  (delta 0) it is a plain translation. `bone` is contextual (only in this fit-source slot).
- **Auto-Z** — a bone fit carries its joint's depth onto its layer; the paint order sorts bone-fitted
  layers by depth (deeper behind, nearer front) automatically. **Explicit `behind`/`front` overrides**
  it. `render --explain` prints each pose's solved joints (position, angle, delta, depth) and the paint
  order's `zN` reasons; C013 still checks only *declared* relations.
- `skeleton`/`pose`/`bone` + the block words `at`/`from`/`limit`/`over`/`view`/`z` are contextual —
  bindable as names elsewhere. A pose is an interpolable delta set (the animation data model).

## Expressions, functions, loops

```drw
x = 10                    # bind — or reassign the nearest in-scope mutable (loop-persistent, like +=)
x += 10                   # mutate: += -= *= /=
fn lerp2(a, b, t) = a + (b - a) * t   # first-order, pure, total; recursion budget-bounded
c = if x > 15 then y else r           # expression conditional
if x > 15:                            # statement conditional
  poly k 0:0 15:15
else:
  circle k 8:8 5
match x:
  0: bg k
  10: bg y
  else: bg r
for i 0..8: …             # the ONE loop — half-open; 0..=8 inclusive; loop var child-scoped
                          # (repeat/while removed)
scatter p 40 7 rect(0:0, w-1:h-1): …   # body n times; p = seeded point from region (§ Scatter)
mirror x=8: …             # draw body + its reflection across x=8 (§ Mirror)
```

Operators: `+ - * / //` (floored int division) · `mod` keyword (floored, sign of divisor) · `> < >= <=
== !=` · `& | !` · `( )` grouping. `%` is only the percent suffix. `draw`/`path`/`fn`/`theme`/`atlas`/
`export` are module-level, order-independent definitions; `mask`/`gradient`/`palette`/`filter`/bindings
run top-to-bottom eagerly and may also be drawing-local (§ Definition scope above). One namespace,
lexically scoped; palette names are const and reserved. Collision rule is asymmetric: a value binding
may **not** shadow a live palette entry (error), but a `palette` key **may** shadow a non-palette binding
(`w`/`h`, a gradient, an outer `let`) — the palette wins.
**`name = expr` reassigns an existing mutable binding visible in the enclosing draw scope**, declaring a
fresh local only when none is reachable — so an accumulator inside a `for`/`if`/`mask`/`scatter`/… body
persists to the draw (`g = g.union(…)` in a loop now accumulates, matching `+=`). The search stops at the
draw body: a block never mutates module-scope state, and `const`/palette/canvas-`w`/`h` are never
reassignment targets (there `=` shadow-declares as before). Every builtin/command/filter name is reserved
and unshadowable, uniformly — binding or `palette`-keying any of them (`rim`, `shadow`, `tint`, `grain`,
`dither`, `outline`, `model`, `cel`, `ramp`, `litTone`, `shadowTone`, …) is a clean `E007` at the
**declaration**, not a later use-site surprise; also avoid `pi`/`tau`/`w`/`h`.
UFCS: `x.f(a)` ≡ `f(x, a)`; zero-arg may drop parens (`n.floor`).

Stdlib (fixed, unshadowable, deterministic): `min max abs clamp floor ceil round sign sqrt hypot dist
sin cos tan atan2 pow exp log lerp len`; constants `pi tau`.
**`sin`/`cos`/`tan`/`atan2` work in radians** (`sin(pi/2) == 1`; use `x * pi / 180` to convert) —
**unlike `arc`, whose `a0`/`a1` are degrees.**
`rand(seed[, i])` → [0,1), `noise(seed, x, y)` → [0,1) (2D value noise) — always with explicit seeds;
there is no `seed <N>` directive (removed — it was stored but never read).
No I/O, clock, or ambient randomness.
`xs.cycle(i)`: auto-wrapping list index, sugar for `xs[i mod len(xs)]` — negative `i` wraps positively
(Euclidean/floored mod, same direction as `mod`/`//`); empty list is E015. Idiomatic for cyclic ramp
access in a `for` loop without off-by-one bounds checks: `for row 0..h: px ramp.cycle(row) 0:row`.

`noise` interpolates only *between* integer lattice points — sampling at integer steps (`noise(seed, x,
0)` for integer `x`) hits a lattice point every time and returns raw, uncorrelated values (high-frequency
"spikes"). Scale the input down instead, e.g. `noise(seed, x * 0.05, 0)`, so consecutive samples fall
between lattice points. For a noise **silhouette** (dune/hill/ridge) use `profile` (§ Primitives): its
`fn` receives normalized x∈[0,1], so `noise(seed, nx * K, 0)` is smooth by construction and the trap
can't occur.

## Scatter

```drw
scatter <name> <n> <seed> <region>:      # header mirrors `for`: keyword, name, then operands
  <body>                                 # runs n times; <name> = a point, child-scoped
```

The seeded replacement for the `for`+`rand`+`floor`+bbox scatter loop (stars, bubbles, gravel, sparks).
Points are drawn **uniformly from the region's on-canvas pixels** (index-sampled with `rand(seed, i)`),
so confining a scatter to a shape is free — pass the shape's region, no `if region.has …`. `<region>` is
a Region or a drawing silhouette.

```drw
draw stars 64x40:
  bg #05060e
  scatter s 40 1 rect(0:0, w-1:h-1):     # 40 stars over the canvas, seed 1
    px #ffffff.alpha(0.4 + rand(9, s.x + s.y) * 0.6) s   # per-star twinkle via the point's x/y
  scatter b 24 4 circle(20:30, 12):      # confined to a disk — no manual guard
    circle #a0d0ff.alpha(60%) b 1 fill
```

- **Deterministic**: same seed + region + canvas → identical points, every platform. Different seed →
  different arrangement. Sampling is with replacement (points may coincide).
- **Empty region** (no on-canvas pixels) → **no-op** (zero iterations, no error).
- One step per iteration (budget). The binding does not leak past the block.

## Mirror

```drw
mirror x=<n>: <body>      # draw <body>, then its reflection across the vertical line x=n
mirror y=<n>: <body>      # …across the horizontal line y=n  (n is an integer axis)
```

Symmetry for a whole passage, not just one stamp. `<body>` executes **normally, then again with every
pixel write reflected** across the axis (`px → 2n − px`).

```drw
draw butterfly 32x24:
  mirror x=16:                           # author the left wing; the right is its mirror
    curvePoly #b0407a 16:6 4:2 2:12 16:16 fill
    scatter d 8 3 rect(2:4, 14:18):      # speckles mirror too (same seed → symmetric)
      px #ffe08a d
```

- **Stamps flip** (a stamped sprite comes out horizontally mirrored). **Text does not** — its position
  reflects but glyphs stay forward (no backwards text).
- **Axis pixels paint once** — a 50%-alpha paint on the axis blends once, never double-darkened.
- **Masks travel with the content** (a masked shape *and* its mirror both appear). **Nested mirrors
  compose** into four-fold symmetry (`mirror x=a: mirror y=b: …`); centre paints once.
- The body **re-executes** for the reflected pass — keep it to drawing (a `+=` on an outer binding would
  run twice).

## Color

Ops (call- or method-style): `lighten darken saturate desaturate hue alpha mix`. (`grayscale(c)` was
removed — it was exactly `desaturate(c, 100%)`; say that instead.)
Ramps: `tones(base, …amounts)` and `mixes(a, b, count[, space])` return color lists — `palette: a, b, c =
#ccc.tones(-12%, 0%, 12%)`.
Shading (call- or method-style): `base.litTone(light, amt)` mixes toward the light colour (warm highlight
— not chalky `lighten`); `base.shadowTone(cool, amt[, darken])` darkens (by `darken`, default `amt`, but
never below 35% of the base lightness → a **dark base keeps visible detail, never crushes to
`#000000`**) + nudges hue toward `cool` capped ≤20° along the short arc (never cross-hue → **no magenta
shadow on warm bases** — `shadowTone` bakes both traps) + slight desaturate; `base.ramp(n)` → even n-step
light→dark tone list (hue-stable, for `pixels:`/cel banding). Reserved like every other builtin — a
recipe may not bind `ramp`/`litTone`/`shadowTone`.
Mixing/gradients interpolate in OkLCh by default (pass the bare colour-space keyword `rgb`/`hsl`/`oklch`
as `mix`'s 4th argument to override, e.g. `mix(a, b, t, rgb)`); pipeline (oklch↔sRGB, gamut map, shorter-
arc hue, 8-bit round-half-up) is pinned — pixel-identical everywhere.

**Cross-hue `mix`/`tint` rotates hue along the short OkLCh arc (silent).** Blending toward a *chromatic*
colour swings the hue — a warm skin tone toward a cool blue runs through **magenta/rose**
(`#e0a878.mix(#3a6fd8, 30%)` → `#e0828c`, pink; `tint #3a6fd8 40%` likewise). Same trap as the cross-hue
`gradient`. Shade **warm materials with `darken()`** (a small cool `mix` stays warm:
`skin.darken(25%).mix(cool, 12%)` reads as a cooler brown, not pink); reach for a depth-`tint` **only
with an exactly neutral grey** (`R==G==B`, chroma 0 — an achromatic endpoint adopts the base hue, so no
rotation). A **near-neutral** cast is not safe: `tint #2a2b2f 40%` (a faint blue bias) still swings a
warm base to magenta, because *any* non-zero endpoint chroma engages the full hue interpolation — use
`#2b2b2b`, not `#2a2b2f`.

## Palettes

`palette` defines const color bindings in the enclosing scope (draw or theme). Key = exactly one ASCII
letter (a–z, A–Z; ≤52 per scope by design — split into stamped parts for more), usable in `pixels:`
cells, expressions, and paint slots. Any letter is a legal key, including `w`/`h` — a `palette w=…`
shadows the canvas-size binding in the applying draw, in **both** drawing-local and **theme** palettes,
resolving to the colour in expressions, paint slots, and `pixels:` cells alike. Forms: inline `palette
k=#1a1a1a r=#c04040`, block `palette:` + indented entries (may derive from earlier ones; may destructure
a list). Multi-char color names = plain bindings (`ink = #1a1a1a`), fine for rendering — indexed exports
collect actual framebuffer colors; the authored `palette` only sets priority order. Keys never cross
stamp scopes; the host artifact folds: own entries, then stamped drawings' entries in first-stamp order,
deduplicated by color.

## Gradients & filters

```drw
gradient sky  = linear(90, #4060ff, #ffd080)                     # angle°, stops; 90 = top→bottom
gradient fire = linear(0, (#000, 0%), (#f00, 60%), (#ff0, 100%)) # (color, position) stops
gradient glow = radial(#fff, #fff.alpha(0%))                     # fade to zero alpha, not `transparent` (see below)
```

A gradient is a paint; it spans the bounding box of what it paints. Pixel mode ordered-dithers (crisp
bands, no AA).

**Cross-hue stops interpolate the short OkLCh arc — often through magenta/grey (silent).** Two stops
from different hue families take the shorter hue arc, which for e.g. blue↔amber runs through magenta
(verified: `linear(0, #3a6fd8, #d8a53a)` midpoint is `#d5659b`, a pink). Same class as the `radial(c,
transparent)` trap. Build gradient stops **intra-hue** (`x.lighten(…)` ↔ `x.darken(…)` of one base), or
set an explicit mid stop, or pass `rgb`/`hsl` to change the interpolation space.

**`radial(c, transparent)` darkens toward the edge (silent).** `transparent` is black at alpha 0, so the
interpolated straight-alpha RGB lerps `c → black` and the fade reads as a muddy grey halo, not a clean
glow. End on the same hue at zero alpha instead: `radial(c, c.alpha(0%))`. A genuinely soft glow needs a
**gentle** alpha ramp: either **many fine** `alpha`-graded `circle … fill`s (increment ≤~7%, radius
shrinking a few px each — a *few coarse* rings give concentric onion rings at every size) or the
`radial(c.alpha(x), c.alpha(0%))` gradient itself with its radius pushed **past** the visible falloff (so
the boundary alpha is ~0, else a faint disc edge shows), or `mode smooth`. Below ~24px no pixel-mode ramp
reads as soft — accept a crisp core or hand-pixel it.

Filter commands (post-process framebuffer; `r` = a region where shown). All three shadow surfaces share
one `[region] dx:dy paint` shape (a fourth spelling, `castShadow`, was a byte-identical duplicate of the
region form and was removed — say `shadow r dx:dy p`); the four texture filters take an optional leading
region scope: `outline [k] [2]` (silhouette outline; colour+width both optional — bare `outline` = 1px
derived-dark ink; builds the silhouette from ≥50%-alpha pixels, so it ignores soft shadows/AA and never
eats thin features) · `tint p 0.3` · `shadow dx:dy p` (whole-frame drop) · `shadow r 2:3 p` (local,
region-first) · `grain [r] amount seed p` · `speckle [r] density seed p` · `ripple [r] strength seed p` ·
`dither [r] a b threshold` · `quantize [r] palette` (remap opaque pixels to the nearest palette colour —
OkLab, first-declared wins ties; `palette` is a colour list; import-assist: `image … sha256` →
`quantize` → `outline` → `critique`).

**There is no raw lighting filter.** `shadeRegion`/`lightRegion`/`rim`/`ao` are removed; each still
parses, so a stale recipe gets a positioned error naming its replacement:

| you want | write |
|---|---|
| shade a **solid body** | `model r mat` / `cel r mat n` (below) |
| veil **already-drawn** pixels | `fill linear(deg, transparent, c.alpha(a)) r` — lighten: `fill linear(deg, c.alpha(a), transparent) r` |
| a one-sided **edge band** | `fill p r.edge(dx:dy[, n])` |
| **contact darkening** | `stroke p.alpha(a) r`, or the material's `ao N%` dose |

Pick the veil row, not `model`, whenever the region already carries hand-drawn detail: `model` is a
**repaint** (it writes opaque tones), so it erases grooves/marks; a gradient `fill` darkens them.

**Compositing semantics (silent — `check` never flags a wrong effect here):**

- `outline [k] [w]` rings the **outer silhouette** of everything painted so far (dilate `w`px, paint the
  outside ring). Run it **once as the last statement of the assembly draw**, over the composited figure —
  not per part, or every part-to-part seam gets its own dark ring. Colour+width optional (`outline` = 1px
  derived-dark; `outline k` explicit; `outline 2` derived+2px). Silhouette = pixels ≥50% alpha, so a soft
  contact shadow or AA fringe is **not** ringed; it only paints outside, so a 1px staff/finger keeps its
  core (width 2 still clubs a 2px prop — stay at 1 for a chibi).
- `dither a b t` is a **raw set, not a blend** — every opaque pixel is overwritten with `a`/`b`
  (Bayer-picked by `t`), so an `alpha(0%)` partner punches a transparency hole, not a no-op. Small/radial
  fills show a hard checkerboard, not a smooth gradient.
- `grain [r]`/`speckle [r]`/`ripple [r]`/`dither [r]` take an **optional leading region** that confines
  the effect to it (intersected with any active mask); the leading arg is a region iff it evaluates to
  one, never colliding with the first real arg (a number for grain/speckle/ripple, a paint for dither).
  **Without** a region each still hits **every opaque pixel of the whole framebuffer**, and still
  respects an enclosing `mask …:` block.
- `grain`/`speckle`/`ripple` order their two numeric scalars uniformly as **magnitude then seed** (`grain
  amount seed`, `speckle density seed`, `ripple strength seed`; both are numbers, so `check` cannot catch
  a swap). Tune the first number for how much effect, the second only to reshuffle the noise. The
  magnitude clamps to `[0,1]` and scales the paint's alpha, so it is roughly linear: `ripple 0.5` is a
  faint shimmer, `ripple 1.2` (clamped to 1.0) the paint's full alpha. **For `speckle` the first number is
  the density of scattered (near-)opaque dots, not a wash**: ~0.03–0.06 with an `alpha(50–60%)` paint
  reads as material texture, 0.14 as harsh static. `ripple` above ~0.25 on a smooth surface reads as
  water, not texture.
- The whole-frame `shadow dx:dy p` hits every opaque pixel too, and respects an enclosing `mask …:` block
  (writes only in-mask pixels), like the texture filters. The offset is always a `dx:dy` point — a
  two-bare-number `shadow dx dy p` spelling never parses.
- **Confine a filter** by giving it a leading region (grain/speckle/ripple/dither) or by wrapping the
  call in a `mask …:` block — which also confines the frame `shadow`. The component-`draw` + `stamp`
  detour is no longer needed. The region-form `shadow` takes an explicit region and needs no confinement
  idiom.
- **Always run a user `filter` through `apply`** — a bare filter name as a statement (no `apply`) is a
  positioned error.

```drw
filter retro:            # reusable pipeline
  tint #402010 0.15
  outline k
draw gem: …
  apply retro
```

## Light & material

The **only** shading path — one named light drives every dose, so shade, rim, and cast can't drift
apart. One `model`/`cel` per object; there is no second, hand-dosed way to light anything any more.

```drw
light sun      = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # directional; source up-left ⇒ up-left edge lit
light torch    = at 12:8 #ffb060 gain 1.4          # point source at 12:8, 1.4× intensity
material steel = #8a95a5 metal                      # base colour + response

draw sword 24x48:
  model blade steel light sun      # smooth form shade → rim → AO → cast, all from `sun`
  model guard #b08040 metal light sun   # inline COLOR RESPONSE — no named material needed
  model grip  #3a2a1e light sun    # bare colour ⇒ response `flat`
  cel  pommel steel 3 light sun    # opt-in: the same form body as 3 crisp bands
```

(A `theme` with a default `light` lets you drop the per-command `light sun` — every `model`/`cel` then
reads the theme light; the explicit arg is for overriding it on one command.)

- **`light NAME = dir DX:DY COLOR [amb COOL AMT] [gain N]`** (directional) / **`light NAME = at X:Y
  COLOR …`** (point source). `dir` = the light's *travel* direction (`dir 1:1` moves down-right ⇒ source
  up-left ⇒ up-left edge lit); `at` = a canvas position. `COLOR` = warm light colour; `amb COOL AMT` =
  optional fill light (cool colour + `0..1` amount, lifts shadows off pure black); `gain N` scales every
  dose (default `1`). **No constructor parens.** `dir`/`at`/`amb`/`gain` are keywords **only** in this
  binding — ordinary names elsewhere (a recipe may still write `dir = …`).
- **`material NAME = COLOR [RESPONSE] [OVERRIDES…]`**, `RESPONSE ∈ flat | metal | skin | cloth | glass |
  glow`. The response selects a **baked dose profile** (shade depth, rim tightness, AO/cast, specular
  gloss, form roundness) — never the colour, which stays yours. Bare colour ⇒ `flat`. `glow` is
  self-illuminated (fill + inner light only, no shade/rim/cast/spec). The response word is a keyword
  **only** in this slot. **Overrides** (order-free trailing keywords, this slot only): `shade`/`hi`/
  `rim`/`ao`/`spec` replace one dose, `puff` the curvature gain, **`spread N%`** scales `hi`+`shade`
  symmetrically (the value-spread knob — `material robe = #3a2a1e cloth spread 140%`). A trailing
  **profile** `round` (default) | `drape` picks the height field: **`drape`** inflates a per-row 1D
  half-tube (curves across, flat down its length) so a *hanging* cloak/skirt does **not** darken toward
  its hem (`material cloak = #4a3f56 cloth drape spread 200%`) — the fix for a "turtle-shell" cape; keep
  `round` for compact masses.
- **Resolution order** (most-local first): explicit `light L` arg → applied **theme default** (`light`
  in a `theme` body, § Themes) → the module's **sole** bare `light NAME = …` binding (fires only when the
  theme tier is empty and the file declares *exactly one* module-scope light: one light, one file, no
  theme is unambiguous). Two or more module lights keep raising `E024`, naming every candidate. (The `lit
  L:` scoping block was removed; tiers 1–2 cover both cases it used to.) The theme default is the
  cross-view fix: front + side + recolor variants applying one theme share **one** light, so shading is
  never mirrored per view.
- **`model REGION MATERIAL [over UNION] [light L]`** lowers the material under the resolved light onto a
  **form (normal-based) body shade → rim → AO → cast**; `MATERIAL` is a `material` value **or** inline
  `COLOR [RESPONSE]`. Zero-dose edge steps are skipped (so `flat` emits no rim/cast). **No light in any
  tier = hard `E024`** — never a silent default. The **body follows the surface**: an inner
  distance-to-boundary field is **Poisson-inflated** to a smooth dome (disc → hemisphere, stripe →
  half-cylinder, **no medial ridge**; thin limbs bulge by their own width), a per-pixel normal is dotted
  against the light, and the intensity is tone-mapped `warm → base → cool` — **smooth and form-following
  by default**, soft **undithered** terminator (the tone map is continuous — for deliberate stipple use
  `cel N` or the `dither` filter), works at chibi scale; a **Blinn specular** hotspot lifts glossy
  `metal`/`glass`/`skin`; a dark base never crushes to `#000000` (keeps ≥35 % lightness). The **cast is
  clipped to already-drawn content** (silhouette offset down-light, minus the region, minus every
  transparent pixel): within one draw it lands on an earlier-drawn opaque neighbour but never bakes onto
  empty canvas, so an isolated part casts nothing (no floating blob). Ground assembled figures with `fit
  … ground`, not a baked material cast. **`over UNION`** builds the height field from `UNION` (a region,
  usually `partA.union(partB)`) but tones only `REGION`, so stacked parts (leg + boot, arm + glove)
  co-shade as **one continuous limb** instead of restarting the field at the seam — each part keeps its
  own material.
- **`cel REGION MATERIAL N [over UNION]`** renders the **same form body as `N` crisp bands** that follow
  the surface normal (the intensity field quantized, band-centre tone-mapped) — the **opt-in** hard
  cel-shaded look (`model` is the smooth default). Bands wrap the form, not straight iso-distance lines;
  band **boundaries are crisp** (exactly N tones, no dither — soften with more bands or `model`), and a
  glossy response adds a **hard specular glint**. `--explain` shows one `form` step carrying the band
  count.
- **`render <file>#<draw> --explain`** prints the exact primitive expansion of every `model`/`cel` (§ CLI
  above) — predict the pixels, or copy the sequence to hand-tune with the raw primitives.
- `light`/`material` bindings live at **module scope or drawing-local** (like `gradient`/`mask`).
  `model`/`cel` are command verbs; `light`/`material`/`model`/`cel` all stay ordinary bindable names
  outside these shapes.

## Themes

```drw
theme dusk:
  with pixelBase, warmPal   # ordered fold, later wins; no inheritance
  palette: …                    # adds/overrides by name
  gradient sky = …
  size 16x16                # default canvas for size-less draws
  mode pixel                # pixel (crisp) | smooth (AA); export line may override
  font small                # default text face
  light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # default light — shared by every view/variant
  style """…"""             # natural-language style guide — read it via `context`
```

A theme body holds **only** `palette:` / `gradient NAME = …` / `size` / `mode` / `font` / `light` /
`figure:` / `style` / `with` / `filter` / `draw`. A theme `light NAME = …` folds like `size`/`mode`/
`font` (later wins) → the drawing's outermost light (§ Light & material resolution order); the bound
name is decorative. Surfaced by `context` (`## lighting`).

**Figure oracle.** A theme `figure:` block declares the project's proportion numbers (`heads`, `headW`,
`eyeLine`/`earLine` as head-height fractions, `eyeSep`, `neckW`, `shoulderW`, `hipW`); it folds like
`light` (later wins) and binds a first-class `fig` in every drawing over that drawing's `w`×`h`. Read
guide **points** — `fig.crown`/`chin`/`neckL`/`neckR`/`eyeL`/`eyeR`/`earL`/`earR`/`shoulderL`/
`shoulderR`/`hipL`/`hipR` — and **scalars** (`fig.headH`/`headW`/`eyeY`/`earY`/`center`/…) instead of
inventing coordinates. Views: `fig.front`/`fig.side`/`fig.back` re-view the same numbers
(`fig.side.eye`, `fig.back.earL`); `fig.NAME(view)` also works. Crown at `y=0`, one head = `h/heads`;
**side faces `+x`** (eye forward off centre, ear toward the back). Surfaced by `context` (`## figure`). A
free binding there (`accent = #d8a53a`) — or a `material NAME = …` (materials live in module/draw scope,
not the theme) — is `E004` **at the declaration** (hint: put colours under `palette:`, move other
constants/materials to module scope) — a theme carries no non-colour design tokens (radius/margin/alpha),
so keep those at module scope above the theme. Apply: `use themes dusk` at file level, or as the leading
line(s) of one `draw` body. Fold order: file `use` → drawing `use` → drawing-local
`palette`/`gradient`/`filter` (last wins). Style guides concatenate (sectioned by source, deduplicated).

**A theme palette does not cross a `stamp` boundary.** A stamped `draw` resolves its own `palette` keys
in its own scope (keys never cross stamp scopes, § Palettes) — a key that is not defined there is a
static `E007`, not a fall-through to the host theme. Recolour a stamped variant **parametrically** (`draw
part(c)` + `palette a=c`, or derived shades `c.darken(…)`), or `tint` it on `stamp`/`fit` — the one
recolor path (the exact-swap `replace` filter was removed) — never by swapping the applied theme.

## Text & fonts

Std faces (always registered): `small` 5×7 (default), `micro` 3×5 — monospace ASCII. Fixed 1px tracking;
`\n` in the string wraps (line height = glyph height + 1); unknown chars render a visible box. `font
<name>` is also a scoped directive (theme/module/draw); a per-`text` `font` flag wins.

```drw
font runic 5x7:            # WxH = optional monospace assertion
  with small               # fallback for unmapped chars
  glyph "A" runeA          # a glyph is a drawing (pixels or paths; non-parametric)
  glyph "B":               # inline body; k binds to the text paint
    pixels: …
  glyphs digits "0123456789"   # bulk: i-th member of a uniform-tile atlas → i-th char
  tracking 1
  lineheight 8
```

Glyph heights must agree; widths may vary (advance = width + tracking).

## Atlases

One construct, two modes — `tile WxH` toggles a uniform grid (`tileset` was merged into `atlas` and is
now a positioned error naming this replacement):

```drw
atlas terrain:
  sprites grass, dirt, water, stone  # every member exactly 16x16
  tile 16x16                         # uniform grid: row-major, name-addressed
  cols 4                             # optional; default near-square; requires `tile` (else E004)
  pad 1                              # optional grid gutter px (default 0) — also `tiled`'s spacing

atlas hud:
  sprites play, pause, stop, logo    # varied sizes, name-addressed (no `tile`)
  pad 1                              # optional inter-sprite gutter px
  place logo 0:0                     # optional pin; rest auto-packs deterministically (E004 with `tile`)
```

Address a member for stamping: `terrain.grass` (**by name only** — the numeric `terrain.0` index form
does not exist; an unknown member is E015). Zero `sprites` or `cols 0` are positioned errors, not a
silent empty/degenerate sheet. `place` naming a name not in `sprites` is E001.

## Export

```drw
export gem icons/gem:        # source-first, bareword base path
  png @1 @2 @3 z9            # gem.png, gem@2x.png, gem@3x.png; zlib 0–9
  png indexed                # indexed PNG: transparent, then authored-palette order, then scanline; >256 = error
  svg ids classes inlineStyles   # pixel mode → pixel-run <rect>s; smooth → shapes
  jpeg 512 q80 mode smooth   # explicit size (512 or 512x512), quality, mode override
  path                       # geometry SVG (path definitions only)
```

Sheet sidecars (atlas exports): `png` (the sheet) · `tiled` (`.tsj`; `tiled xml` → `.tsx`; requires the
atlas's `tile WxH` — E018 otherwise) · `atlasJson` (`.json` frames map — TexturePacker/Phaser/Pixi) ·
`aseprite` (`.aseprite.json`).

**Base path is recipe-relative:** `build` defaults `--out` to the recipe file's own directory, and the
base path is relative to that — the recipe alone decides the layout; an explicit `--out` only relocates
the whole tree. Grammar: `SEGMENT { "/" SEGMENT }` — no leading `/`, no `.`/`..` segment, no file
extension (the format line appends the real one); a violation is a positioned `E018`, caught by `check`
(not `build`). Above, `icons/gem` is a *family/name* prefix inside some other recipe directory (e.g. a
recipe `games.drw` exporting `export dice games/dice`) — never repeat the recipe's own directory name as
the leading segment (a recipe that already lives in a `showcase/` directory exporting `export scene
showcase/scene` repeats it); `build` already writes next to the recipe, so that prefix is always
redundant (lint `W016`).

**SVG size — pixel mode merges *horizontal* same-color runs into `<rect width=run height=1>`, so colour
that varies along a scanline explodes the file.** A horizontal or radial gradient, a `model` form shade
(it follows the surface, so it varies in both axes), `grain`/`speckle`, or `dither` paints (nearly) every
pixel a distinct colour → ~1 `<rect>` per pixel (measured: a flat 32×32 tile 28 rects / 1.8 KB vs. the
same tile + `grain` 369 rects / 22 KB — ~12×; icon runs saw 5–25× and a 64px `camera` 1928 rects / 115
KB). A purely **vertical** (row-uniform) gradient stays compact — one rect per row. For an **SVG** export
target, prefer flat fills or a few discrete `palette` zones (or `mode smooth`, which emits shapes, not
per-pixel rects); reserve scanline-varying gradients / veils / texture for **PNG-only** targets.
Counter-check after `build`: `<rect>` count ≪ pixel count.

## Determinism & budget

Pixel mode guarantees pixel-identical output across platforms. There is **one** engine semantics: the
whole-frame `shadow` respects an enclosing `mask …:` block, and the eight offset stamp anchors are
visual (§ Transforms & stamp). There is no version pragma — `drawstic <N>` was removed; delete the line
from any old file. Byte-identical files are NOT guaranteed — compare pixels, not bytes. Bundled
deterministic math (never host `Math.*`), pinned color pipeline and rasterization, integer source-over
alpha (straight RGBA8; pixel mode adds alpha only from explicit alpha colors, never edge AA). Every
render runs under a step/pixel budget — runaway recursion aborts with a positioned error; raise via
`--budget N`.
