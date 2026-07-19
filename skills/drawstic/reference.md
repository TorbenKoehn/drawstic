# Drawstic reference

Complete practical reference for recipe authors. Canonical spec: `docs/language-spec.md`
in the Drawstic repo (not shipped with the package — this file is self-contained).

## CLI

Runner prefix (`bunx` / `npx` / `pnpm dlx` / `yarn dlx`) omitted below.

| Command | Purpose |
|---|---|
| `drawstic check <file> [--lint] [--rows] [--json]` | parse + semantic validation. `--lint` adds authoring warnings; `--rows` adds per-`pixels:`-block row-width metadata (find ragged rows). |
| `drawstic fmt <file> [--check] [--stdout] [--diff] [--json]` | canonical formatter. Default rewrites in place; `--check` fails (no write) if unformatted; `--stdout` prints instead; `--diff` adds first-changed-line metadata to `--check --json`. |
| `drawstic context <file> [--json]` | resolved design brief: merged theme palette (key→hex+source), merged style guide, theme default light (`theme.light`, ADR-0086), available drawings (name, WxH, ASCII preview), functions (signatures), export plans, per-drawing facts (size source, palette keys, draw-local `themes` (its `use` names) + effective `themePalette`, fitted-preview hints). Read before editing files with imports/themes. |
| `drawstic build <file> [--out <dir>] [--json]` | run every `export`, write artifacts (default: cwd). JSON: `{diagnostics, artifacts: [{path, bytes}]}`. |
| `drawstic render <file>#<drawing>[(args)] …` | ad-hoc render of one drawing (see below). |
| `drawstic sheet <file> [--all] [--cols N] [--png@N] [--out <path>] [--stdout] [--ascii] [--preview] [--json]` | family contact sheet: composes selected drawings size-normalized into one labeled comparison grid (see below). |
| `drawstic critique <file> [--as icon\|scene\|character\|item] [--family a,b,c] [--strict] [--json]` | pixel-based, vision-free quality checks (`C0xx`) over every rendered non-parametric drawing, plus family checks across siblings. Category-agnostic (always run): C001 empty/near-empty, C003 optical centering, C004 value/contrast spread, C006 palette/complexity budget (export-target-aware — see below), C008 interior pinholes, C012 asymmetric bottom-padding. `--as` selects a category profile (thresholds, never inferred) and opts in the profile-gated checks — **C002** edge-clip (opaque content touching a canvas edge; `icon`/`item` only, not full-bleed scenes), **C007** floating-part/seam (8-connected components + chamfer distance; `character` only), **C005** stroke width (`icon`/`item`/`character`); without `--as` only the agnostic subset runs plus a `C000` info nudge. Family checks compare the exported siblings (or `--all`; `--family a,b,c` overrides) **minus any drawing that is itself a composed presentation of ≥2 other candidates** (a hand-built `draw xSheet: stamp xFront …; stamp xSide …` panel never pollutes its own family — name it explicitly via `--family` if you do want it compared), need ≥2 members: **C009** sibling-silhouette collapse (scale-/position-invariant 32×32 signatures, mass-normalized L1 < 0.12 — under `--as character`, never fires between two views that share a front/side/back name stem, e.g. `knightFront`/`knightBack`; still fires between different characters/items) and **C011** weight parity (a sibling >6× off the family median mass). All findings default to `warning` (exit 0, never blocking); `--strict` promotes only the *unambiguous* must-fix subset — **C001** empty, **C007** character seam, plus **C003** for `icon` — to `error` (exit 1), the CI regression gate. C002/C005/C008/C009/C011/C012 stay advisory (silhouette-sharing recolors/shared-shells, gradient sprawl, and legit small gaps are correct art). **C006 is export-target-aware**: only a drawing that declares an indexed-PNG (`png … indexed`) or `svg` export budgets its colour count — a `warning` that blocks `pass` (indexed palettes cap, SVG emits one `<rect>` run per band); a straight-alpha RGBA-PNG/JPEG target, or no export at all, has no palette budget (smooth `model` shading spends hundreds of colours by design), so C006 is a non-blocking advisory `info` there. None of C002/C005/C006/C008/C009/C011/C012 trip the `--strict` exit. Each finding carries `{measured, threshold, fix}`. JSON: `{diagnostics, critique: {pass, profile, strict, failedCodes, drawings:[{name,width,height,bbox,coveredPixelCount,opaquePixelCount,distinctColorCount,unknownColorCount,luminance,componentCount?,minStrokeWidth?,checks:[…]}], familyMetrics?:{members:[{name,coveredPixelCount,bbox,nearest:{name,distance}}],distanceMatrix,medianCoveredPixelCount}, rubric:{renders:[…],items:[{id,when,ask}],note}}}`. **`pass`≠exit code:** `pass` is `false` on *any* fired finding (must-fix or advisory — one lone C009/C011/C012 warning flips it); the process exit code trips only on the `--strict` must-fix subset above, so exit 0 does not imply `pass:true`. Read `failedCodes`/per-drawing `checks[]` for what's actually outstanding. `pass:true` is necessary, not sufficient — run `rubric.renders` (silhouette-first) and answer every `rubric.items` prompt by looking. The metric bundle is a superset of `render --inspect`. |

**Fragment arguments** (ADR-0067): a parametric drawing takes literal args directly in the
`#<drawing>(...)` fragment — `render parts.drw#house(#c04040, 3)` — no throwaway wrapper draw
needed. `(...)` must sit immediately after the name (no space). Args are restricted to
recipe-language *literals*: number, color (`#rrggbb[aa]`) or `transparent`, string, point
(`x:y`, plain signed numbers only), boolean — no names, arithmetic, or nested calls (E004).
No parens, or `()`, means zero args (today's behavior). Argument count must match the
drawing's own params — a mismatch is `E011` with a hint spelling out the fix
(`pass literal arguments: render <file>#house(c, count)`). Non-parametric targets
(a plain `draw`, a `tileset`/`atlas`/`image`) take no args.

Render outputs (mutually exclusive):

- default → writes `<drawing>.png` (`--png@N` → `<drawing>@Nx.png`, nearest-neighbor N×);
  `--out <path>` overrides; `--stdout` streams the PNG. Judge form/colour at `--png@4`+ (or
  `--ascii`/`--preview`) — a native `@1` sprite is usually too small on screen to assess.
- `--ascii` → pure-ASCII grayscale approximation (luminance ramp ` .:-=+*#%@`,
  transparent = space; no ANSI codes).
- `--preview` → ANSI truecolor half-block preview (two pixel rows per line).
- `--inspect --json` → `{width, height, distinctColorCount, alphaCoverageBBox,
  opaquePixelCount, transparentPixelCount, palette, namedMasks, occupancy}` — form-sanity
  stats so an agent can sanity-check composition without reading pixels:
  - `palette[]` entries add `opaquePixelShare`: the fraction of *opaque* output pixels
    whose committed sRGB is nearest that entry's color (squared distance over r/g/b; ties
    keep the first-declared entry) — an attribution *heuristic*, not an exact-match count,
    since gradients/filters/AA rarely composite back to the exact declared color.
  - `namedMasks[]` is one `{name, bbox, coveragePixelCount, coverageFraction}` per
    module-scope `mask NAME = <region-expr>` binding (the reusable form, § Regions & masks
    below) — **not** a mask declared inside the draw body itself, which is
    drawing-local and never escapes the render call. `bbox`/coverage are scanned against
    the actual (possibly `--crop`ped) canvas, `null`/`0` if the mask touches no canvas
    pixel; `coverageFraction` is density *within the mask's own bbox* (a thin ring reads
    sparse even though its bbox is a full square), not a fraction of the whole canvas.
- `--explain` (ADR-0086 §6) → prints the exact primitive expansion of every `model`/`cel` command
  instead of an image: each record `{command, region, light:{x,y}, steps:[…]}`, one step per lowered
  primitive with its resolved args — `{op:'fill'|'shade'|'light'|'rim'|'ao'|'cast', color, amount?,
  point?, dir?, width?, offset?}` for `model`, `{op:'band', color}×N` for `cel`. Renders the drawing
  to run the commands, then reports the trace (no PNG written). `--json` → `{diagnostics, render:{kind:
  'explain', explain:[…]}}`; plain text otherwise. The predictability guardrail: verify a material
  lowers as intended, or copy the sequence down to the raw primitives to hand-tune. Output-kind order
  is `--ascii` > `--preview` > `--inspect` > `--explain` > PNG.

Every render kind's JSON also carries `render.stats = {unknownPixelCount,
unknownColorCount, paletteCoveredPercent}`: how much of the painted (non-transparent)
sprite is covered by its own declared `pal` artifact vs. colors that only came from
rendering. **`paletteCoveredPercent` is near-meaningless for procedural scenes today** —
gradients/filters/`mix` routinely paint colors no `pal` key ever declared, so a low score
is normal, not a defect. For a gradient/procedural scene a high `unknownColorCount`, a low
`paletteCoveredPercent`, and a lopsided per-key `opaquePixelShare` are **all expected** (nothing to
fix); read them as rough attribution, not an error signal. `--inspect`'s per-key `opaquePixelShare`
is still the most actionable per-color view.

Render modifiers: `--fit WxH` (downscale ascii/preview only), `--crop x:y WxH`
(the size slot is **`WxH`**, e.g. `--crop 96:56 72x44` — a `x:y` **point** in the size slot is
**silently ignored** and the full canvas renders, no error), `--mode pixel|smooth` (override
theme), `--budget N` (evaluation-step cap).

**`--silhouette` — shape-only black-out (ADR-0083).** A deterministic framebuffer pre-pass applied
**before** the output kind is chosen: every pixel with `alpha > 0` becomes opaque black `#000000ff`,
`alpha == 0` stays transparent (a hard 1-bit coverage mask). The colour-free shape test — silhouette
legibility, occupancy, modular-part alignment — that replaces a hand-rolled flatten-to-black
throwaway `draw`. Composes with every output kind (`--ascii`/`--preview`/`--inspect`/PNG via
`--png@N`) and every downstream framebuffer op (`--crop`/`--fit`/`--grid`); `--inspect` then describes
the silhouette (a fully-opaque sprite collapses toward `distinctColorCount: 1`) and `--json` carries
`silhouette: true`. **Caveat:** under `--ascii` the luminance ramp reads black as empty — view a
silhouette as PNG or `--preview`. Never reaches `build`.

**Debug-only PNG aids** (never reach `build` exports; inert under `--ascii`/`--preview`/
`--inspect` since those short-circuit before the PNG stage):

- `--grid N` → burns a coordinate overlay into the PNG output raster only: gridlines every
  N *source* (recipe) pixels, always exactly 1 *output* pixel thin and landing on
  recipe-pixel boundaries even under `--png@K` (pitch scales, line width doesn't), plus
  edge coordinate labels (source-pixel values; label glyphs scale with `--png@K` for
  legibility — use `--png@4`+ to read them). High-contrast strategy: every overlay pixel is
  a full color invert of the pixel underneath, forced opaque — visible over any scene.
- `--diff <png>` → compares the fresh render against a previous PNG (decoded via the
  `import`-path decoder), reporting `render.diff = {identical, changedPixelCount,
  totalPixelCount, changedBBox: {x, y, width, height} | null}` under `--json`, or a
  `diff: N/M px changed, bbox x:y WxH` line otherwise — the machine/human answer to "did
  this edit touch only the region I meant to?". The comparison always uses the fresh
  render's UNgridded pixels, even when `--grid` is passed in the same invocation — grid is
  purely cosmetic on the PNG bytes written to disk. A dimension mismatch (different
  `--png@N`/`--crop` than the comparison PNG) is `E023` with a hint; an unreadable or
  undecodable comparison PNG is `E019`.

**`--json` everywhere.** Diagnostics are stable records
`{severity: "error"|"warning", code: "E###"|"W###", message, file, line, col, hint?}`.
`check --json` emits the bare array (`[]` = clean); other commands wrap
`{diagnostics, …payload}`. Exit code is non-zero iff any `error` was produced.

**`sheet` — family contact sheet (ADR-0082).** Composes every selected drawing at its native
size, each centered in a uniform cell (normalized to the largest drawing + widest label) on a
transparency checkerboard with a 1px frame and its name captioned below in the `small` font —
one labeled grid for family-consistency QA (radii / stroke / grey-value / hue balance across
siblings). **Selection:** default = the module's `export`ed drawings in export-declaration order;
`--all` = every non-parametric drawing in definition order. Parametric drawings are never rendered
(no args); a module with no non-parametric drawing at all is `E022`. Output kind follows `render`'s
precedence (`--ascii` > `--preview` > PNG); default PNG path is `<basename>.sheet.png`. `--cols N`
sets columns (clamped to the tile count; default `ceil(sqrt(n))`), rows are `ceil(n/cols)`. Layout is
byte-deterministic. `--json` reports layout, not pixels: `{diagnostics, sheet: {cols, rows,
cell: {width, height}, width, height, cells: [{name, w, h, x, y}], kind, output}}` — `x`/`y` are the
tile's top-left in **unscaled** sheet coordinates (× `--png@N` for output pixels). Never part of
`build`.

**`check --lint` warnings:**

| Code | Fires on |
|---|---|
| W001 | unused local `pal` key |
| W002 | drawing never `export`ed, `stamp`ed, nor a `fit` target |
| W003 | stamp's literal target at a literal point lands fully off-canvas |
| W004 | procedural (no `pixels:`) drawing over 128 px on either axis (icon detail sizes 48/64/128 stay silent) |
| W006 | `dither` partner paint statically alpha-0 (transparency hole) |
| W007 | stamp fully covered by a later, provably opaque stamp/fill |
| W008 | `text` literal has char(s) with no glyph in the resolved font (renders as the unknown-glyph box) — static cases only |
| W009 | a `pixels:` grid's **last** row is fully transparent (`.`) while a row above has content — stamps place by top-left, so the trailing empty row silently enlarges the footprint and seams a 1px gap below adjacently stamped parts. Last row only; a fully transparent first row or side column (top-centring / padding) stays legit |

Full detail: `docs/language-spec.md` § Lint warnings.

## Modules & imports

A `.drw` file is a module; every top-level definition is public.

```drw
drawstic 1                       # optional legacy first line: parsed but inert (omit it)
from creatures gem, slime        # ./creatures.drw; type inferred
from gems gem as ruby            # alias on collision
from ../shared/parts eye         # parent dir ok; never escapes project root
from std/shapes dot              # bundled std (always available, version-pinned)
use themes dusk                  # apply theme to this file (2 tokens: module `themes` + name `dusk`)
import logo = ../brand/logo.png  # external PNG as a drawing (lossless; JPEG rejected)
import logo = ../brand/logo.png sha256 <hex>   # optional content pin
```

**`use` grammar — arity picks the meaning, not any keyword:**

| Form | Tokens | Meaning |
|---|---|---|
| `use dusk` | 1 (name only) | **local** theme: `dusk` must already be defined in this file, or brought in by an earlier `from <module> dusk` |
| `use themes dusk` | 2 (path + name) | **imported** theme: load `dusk` straight from `themes` (→ `./themes.drw`) — no `from` needed first |
| `use std/themes pixelBase` | 2 | same 2-token form, bundled `std/` module |

`themes` here is a **bareword module path** (a sibling file `themes.drw` by convention), never
a keyword — any module name works in that slot. Confusing the two forms is the #1 cause of
`E008 module not found`: `use pixelBase` fails unless `pixelBase` was imported by name first;
the fix is either `from std/themes pixelBase` + `use pixelBase`, or the one-line
`use std/themes pixelBase`.

Module paths are bareword, `/`-separated, `.drw` implied, no quotes/globs/network.
Resolution is relative to the importing file and sandboxed to the **project root — the
CLI's working directory** (`..` escaping it = E008); run drawstic from the tree containing
all recipes. Import cycles between modules are errors; definitions within a module are
order-independent. `export` elements are not importable.

**Bundled `std/shapes` parts** (tiny abstract marks; `(c)` = takes a paint, the rest are fixed dark
`#1a1a1a`): `arrow` 7×7 right arrow · `dot` 3×3 **plus/cross** (a `+`, *not* a filled disc) ·
`spark(c)` 5×5 thin 4-ray · `star4(c)` 7×7 4-point star · `dash(c)` 5×1 line · `arcMark(c)` 7×4
shallow arc · `zig(c)` 7×3 zigzag · `blob(c)` 7×5 filled lump · `capsule(c)` 8×3 filled bar ·
`leaf(c)` 7×4 filled leaf with midrib · `tri(c)` 5×5 filled triangle (apex up). For anything more
concrete, author it locally or copy from the motif cookbook — `std` stays abstract.

## Definition scope

| Kind | Module scope | Drawing-local | Notes |
|---|---|---|---|
| `draw` `path` `fn` `theme` `tileset` `atlas` `export` | yes | **no** — E004 | order-independent; may forward-reference each other |
| `filter` | yes | **yes** | module-level `filter name:` is order-independent like `fn`; a `filter name:` written inside a `draw` body is drawing-local and must precede its `apply name` |
| `mask` `grad` `light` `material` `pal` / any binding (`=`) | yes | yes | sequential, not order-independent — a drawing-local one must be written before it is used (`light`/`material` = ADR-0086) |

Writing `fn`/`path` (or `draw`/`theme`/`tileset`/`atlas`/`export`) inside a `draw` body is a
positioned `E004`. `mask`/`grad`/`light`/`material`/`pal`/`filter`/bindings have no such restriction — they read
identically at module or drawing-local scope; only their *position* changes what's already in
scope when they run.

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
| Light | `light NAME = dir DX:DY COLOR [amb COOL AMT] [gain N]` / `= at X:Y …` | first-class light source (§ Light & material, ADR-0086); drives `lit`/`model`/`cel`. |
| Material | `material NAME = COLOR [RESPONSE] [round\|drape] [shade/hi/rim/ao/spec/puff/spread N]` | base colour + response dose profile (+ optional `round`/`drape` height-field profile + trailing dose overrides, `spread N%` = value-spread knob); consumed by `model`/`cel`. |

Indices must be integers (fractional = error). `xs.0` is an index; `xs.name` is a UFCS call.

## Coordinates

Origin `0:0` top-left, y down; pixel centers at integers; `WxH` addresses `0:0 … W-1:H-1`.
Quantization at rasterization: pixel mode rounds half-up to integers; smooth mode to a 1/16
subpixel grid. Canvas size, pixel cells, `px`, stamp position/scale always coerce to integers.
Out-of-bounds is silently clipped. `w`/`h` = resolved canvas size of the current drawing.
No implicit cursor; `rel` prefixes exist only inside `path` bodies.

## Drawings

```drw
draw name(params) WxH:    # params optional; size optional (resolution order below)
  use themes t            # leading lines only: theme for this drawing
  title "…"               # optional; emitted to SVG <title>/<desc>
  pal …                   # local palette
  pixels: …               # explicit rows
  <commands / stamps / expressions / loops>
```

Size resolution (first wins): explicit header (checked against `pixels:` rows if both) →
inferred from `pixels:` → `size WxH` default (module- or theme-scope directive) → error.
`W`/`H` are integer literals only. A `draw` never referenced by an `export` is a component.

## Pixel literals

`pixels:` = raw rows, one char per pixel, until dedent. Keys: one ASCII letter each,
resolved in the **palette namespace only** — a visible single-letter `pal`/theme entry (a plain
value binding of the same letter is never a cell); a letter with no palette entry = `E007`.
`.` = built-in transparent (declaring it = error). Equal row widths (header mismatch = error;
rows define size when header omitted). No trailing comments on rows. Rows and commands may
coexist — rows first, then draw on top. `w`/`h` are legal pal keys (they shadow the canvas-size
binding in that draw — ADR-0073).

## Primitives

`<paint>` = color or gradient. **The paint is the first argument of every command** — paint
first, geometry after, flags last. Trailing `fill` = solid; default outlined. Stroke width:
trailing `w<N>` (default 1; smooth mode adds `cap butt|round|square`, `join miter|round|bevel`) —
on every stroking command **except `poly`** (see its row).

| Command | Form |
|---|---|
| `bg` | `bg <paint>` — flood the canvas |
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
| `fill` | `fill <paint> <region>` — rasterize any region solid |
| `stroke` | `stroke <paint> <region> [w<N>]` — inner boundary, width N; on a region whose **short axis is ≤2N px** the border spans the whole region and the fill shows 0 % (an 8×2 bar stroked `w1` is 100 % stroke colour) — fill thin bars/bones/blades, don't stroke them |
| `text` | `text <paint> <pt> <string> [font <name>]` — top-left at pt |
| `flood` | `flood <paint> <pt>` — 4-connected, exact seed color |

`quad`/`bezier`/`arc`/`curve`/`curvePoly` flatten by a fixed rule (Catmull-Rom curves: each span →
`clamp(ceil(chord), 4, 64)` segments) but round every point to the pixel grid — below roughly 12px
that rounding dominates and the curve reads as blocky chunks, not smooth. Prefer `pixels:` for small
curved details.

`curve`/`curvePoly` are **through-points** splines (centripetal Catmull-Rom, ≥3 points): the line
passes through every point you give, so prefer them over stacking `bezier`s or ellipses for organic
shapes (dunes, hills, waves, fronds, clouds, rocks). `curve` is open and stroke-only; `curvePoly` is
a closed loop, its `fill` and stroke share one tessellation (they align) and its fill is even-odd.

**`curvePoly` geometry caveats** (all silent — `check` passes, the shape is just wrong): the closed
spline also smooths *between the base points*, so a flat underside (island/hill on a waterline)
**bulges below** the base row — clamp it with `.intersect(rect(…))` on the base edge. Overlapping
**translucent** (`alpha`) loops **compound in the overlap** into a muddy lump — use fewer, narrower
loops with less overlap. Below ~12px a `curvePoly` is an unrecognizable blob — hand-author small
curved details with `pixels:` instead.

`profile <paint> <span> <fn> [<baseline>] [fill]` fills the area under `y = f(x)` — the built-in for
a *procedural* horizon (dune / hill / noise ridge) authored as a **function** rather than points. It
**samples once per column** and calls `fn` with a **normalized x in `[0,1]`** (first column 0, last 1);
`fn` (a unary `fn <name> nx = …`) returns the top-edge `y` in recipe pixels. The `<span>` is a
range/list of x-columns (`0..w` = the whole width; inclusivity follows `..` vs `..=`), one element per
column. Each column fills the inclusive rows between `round f(x)` and `<baseline>` (a plain number
before the flags; **defaults to the canvas bottom `h−1`**), so exactly one contiguous run per column,
above or below the baseline. Because `fn` never sees a raw pixel coordinate, the noise-frequency trap
is unreachable — `noise(seed, nx * K, 0)` with a small `K` (undulations across the span) is smooth by
construction:

```drw
fn ridgeY(nx) = 16 + round(noise(3, nx * 4, 0) * 10)   # ~4 smooth undulations
profile #c9a06b 0..w ridgeY fill                       # dune filled to the bottom
mask dune = profile(0..w, ridgeY)                      # paintless → Region, for shadeRegion/grain
```

Both lines above are **draw-body** statements: `w`/`h` are the canvas size and exist only inside a
`draw` (at module scope `profile(0..w, …)` is `E001 unknown name 'w'`). Keep the mask drawing-local,
or hard-code the span (`profile(0..64, …)`) if you need it at module scope. The optional baseline
likewise defaults to the canvas bottom `h−1`, a draw-scope value.

Shapes are region constructors (`rect`/`rrect`/`circle`/`ellipse`/`poly`/`curvePoly`): with a leading
paint at statement position they draw (`circle k 8:8 5` ≡ `stroke k circle(8:8, 5)`; `… fill` ≡
`fill k circle(8:8, 5)`); without a paint, the call is a Region expression (`mask blob =
curvePoly(4:12, 12:3, 20:12, 12:21)`). A paintless shape *statement* is an error.

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

Local pen cursor (never escapes). Paint at use site: `fill paint p`, `stroke paint p w2`.
Methods: `.fill()` → Region (even-odd) · `.stroke(n)` → Region ·
`.union/.intersect/.subtract/.xor(p)` → Path · `.shift(pt)/.scale(n)/.rotate(deg)/.flipx()/.flipy()/.transform(t)` → Path.

`arc <pt> around <center> cw|ccw` sweeps **clockwise as drawn on the y-down screen** (silent — no
`check` error for the wrong side). For a left→right chord with the centre on it, `cw` bulges the arc
**up** (smaller y), `ccw` **down**; the wrong one sends the curve off-canvas (an invisible dome) —
render to confirm. A full circle built from four `arc … around` quarters just reinvents `circle()`
(and rasterizes slightly differently at the rim) — use `circle()`.

## Regions & masks

```drw
mask keyhole = circle(8:5, 4).union(rect(6:5, 9:14))   # top-level or drawing-local
mask keyhole:            # block: statements inside clip to the region
  bg #e0b070
stamp crest 4:4 mask keyhole                            # inline on a stamp
fn ring(c, r) = circle(c, r).subtract(circle(c, r - 2)) # fns compose regions
mask m = gem.region.scale(2).shift(4:4)                 # any drawing's silhouette (alpha>0)
```

Set-ops: `.union` `.intersect` `.subtract` `.xor`. Placement: `.shift(pt)`, `.scale(n)`,
`.transform(t)`. Paths convert explicitly: `mask badge.fill():`, `slash.stroke(2)`.
Parametric silhouettes: `region(key(r))`. Only the **top-level** form
(`mask keyhole = …` above the `draw`) shows up in `render --inspect --json`'s
`namedMasks` — a drawing-local `mask NAME = …` is invisible to `--inspect` since it
never escapes the render call.

## Transforms & stamp

```drw
stamp name[(args)] <pt> [anchor <name>] [flipx] [flipy] [rot<deg>] [scale<N>]
      [transform <t>] [tint <paint> <amount>] [shadow <dx:dy> <paint>] [mask <region>]
```

Top-left placement by default; anchors `topLeft top topRight left center right bottomLeft
bottom bottomRight` place a footprint anchor point at `pt` (round-half-up). `shadow dx:dy paint`
paints the transformed silhouette at the offset first. `tint p 0.3` blends stamped pixels
toward p by 0..1. On a **composite** sprite (roof + posts + basin) that offset silhouette fills the
gaps and reads as a heavy dark clump, not a cast shadow — for a standing object drop a separate
`ellipse … fill` ground shadow instead.

**Anchors are *visual*: the eight offset anchors name a spot on the bounding box you
actually see, after flip/rotate/scale.** `anchor bottom` = the visible bottom-center; `anchor
bottomLeft` + `flipx` lands the visible **bottom-left** at `pt` (the flip does not move the
label); `anchor bottom` + `rot90` lands the rotated footprint's visible bottom-center.
Untransformed stamps are unaffected. `topLeft` (and the default no-`anchor`) is special: it puts
the sprite's untransformed **origin** at `pt`. Reflect a sprite by naming the
seam edge on both copies:

```drw
stamp boat 40:30 anchor bottom                         # hull above the waterline
stamp boat 40:30 anchor top flipy tint #305070 40%     # reflection: top edge meets the same pt
```

Placing by a computed point (point arithmetic on `pt`, or `.about(pt)`) is plain geometry.

Constructors: `shift(pt)` · `rotate(deg)` (clockwise on the y-down screen — `+90°` sends
up→right; mirror the sign for a symmetric pair) · `scale(n)` uniform / **`scale(sx, sy)`
non-uniform** · `skew(deg)` · `flipx()` `flipy()` · **`matrix(a, b, c, d, e, f)`** (2D affine,
CSS order) or **`matrix(…16)`** (full row-major 4×4) · `rotatex(deg)` `rotatey(deg)`
`perspective(d)`. Anchor: `.about(pt)` (default origin `0:0`). A region's own `.scale(n)` is
uniform only — flatten/squash a region via `region.transform(scale(1, 0.35).about(pt))`.
`rotatex`/`rotatey` on flat `z=0` content is only an orthographic squash unless paired with
`.perspective(d)` (real keystone: `rotatey(θ).perspective(d).about(center)`; for a ground/floor
tilt a 2.5D poly fake looks better). **Reading order = application order** (`rotate(45).scale(2)`
rotates first). Sugar: `rot45` ≡ `transform rotate(45).about(((w−1)/2):((h−1)/2))`;
`flipx`/`flipy` = centre mirrors; `scale2` ≡ `transform scale(2)`; combined flags expand
flip → scale → rotate. Pixel mode resamples nearest-neighbour (no new colors); mirrors,
quarter-turns, integer shifts/scales are lossless; non-invertible transforms are errors.

## Anchored assembly — pin / fit (ADR-0087)

```drw
pin <key> <pt>                                     # attach point in this drawing's own space
fit <partB>[.<pin>] <partA>.<pin> [flags] [shadow] # land partB's pin on partA's placed pin (contact-guaranteed)
fit <partB>.<pin> <x:y> [flags] [shadow]           # ground oracle: land the pin on a computed point
```

- **`pin key pt`** — a bare key in a **part** (`pin shoulder 4:0`) exports on the rendered sprite;
  a dotted `part.name` in an **assembly** (`pin torso.shoulder 16:14`) seeds a canvas attach point.
  When `part` names an already-drawn part, this seeds **all** its pins from the one anchor (so a
  later `fit …torso.hip` chains without re-declaring); a bare hand-label (`a.spot`) seeds just one.
- **`fit b.pin a.pin`** solves the translation so `b`'s pin lands exactly on `a`'s placed pin, then
  registers `b`'s pins in canvas space so the next `fit` chains (`fit hand.wrist arm.wrist`). Bare
  `fit b a` auto-matches a single shared pin name. Replaces hand-stamped socket offsets.
- **Transform flags** — `fit` takes the same modifiers as `stamp` (`flipx`/`flipy`/`rotN`/`scaleN`/
  `transform t`/`tint c p%`/`mask r`), about the footprint centre. **The pin rides the transform:**
  the fit pin still lands exactly on target, and `b`'s other pins register through the same flip/rot
  (a left-shoulder pin becomes the correctly-located right shoulder after `flipx`). Enables the
  depth-tint far limb (`fit armFar.shoulder a.shoulder tint #2b2b2b 45%`) and mirrored side/back parts.
- **Contact guarantee:** checked against the drawing's **final composite** (every later
  `stamp`/`fit` has painted) — deliberate back-to-front layering (e.g. fitting feet before the
  covering robe is stamped over them) never false-warns just because the covering part hadn't
  painted yet. No pixel contact by the end of the body ⇒ non-fatal **`W010`** gap warning (the
  seam `critique` C007 also measures) — never silent, and in the `diagnostics` of `render`, `build`,
  and `sheet` alike. `fit` reuses the `stamp` blit (same alpha/palette).
- **Placement self-check (contact ≠ correctness):** a target pin >2px off the part's **own ink**
  warns **`W011`** (loose pin) — the pins coincide but the join floats because the pin is in empty
  part space (a chin below the head). `render <file>#<draw> --explain` prints a per-`fit` line
  (landed coords · coincident? · pin-to-ink gap) so a misplacement is *visible*, not silently green.
- **Held prop across views:** author the prop once in its true orientation with a `grip` pin, grip
  it with `fit sword.grip hand.grip`; the per-view *figure* flip is a separate `fit` that never
  touches the prop, so the blade keeps its direction front/side/back. Mirror the prop deliberately
  with its own `fit … flipx`, never via a figure-wide flip.
- **Ground oracle:** a computed-point source plants on terrain — `fit tree.base x:duneY(x/(w-1))`
  (needs a named target pin) → floating/sinking impossible.
- **`shadow`** flag: auto contact-shadow ellipse anchored at the footprint bottom (the feet), not
  the fit pin — a joint-to-joint fit still pools under the feet, never at the hip. Drawn first (feet
  cover it), cool from the light in scope.

`pin`/`fit` are contextual keywords (only in these statement shapes) — bindable as names elsewhere.

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
repeat 4: …               # no index
for i 0..8: …             # half-open; 0..=8 inclusive; loop var child-scoped
while cond: …             # allowed; budget-capped
scatter p 40 7 rect(0:0, w-1:h-1): …   # body n times; p = seeded point from region (§ Scatter)
mirror x=8: …             # draw body + its reflection across x=8 (§ Mirror)
```

Operators: `+ - * / //` (floored int division) · `mod` keyword (floored, sign of divisor) ·
`> < >= <= == !=` · `& | !` · `( )` grouping. `%` is only the percent suffix.
`draw`/`path`/`fn`/`theme`/`tileset`/`atlas`/`export` are module-level, order-independent
definitions; `mask`/`grad`/`pal`/`filter`/bindings run top-to-bottom eagerly and may also be
drawing-local (§ Definition scope above). One namespace, lexically scoped; palette names are
const and reserved. Collision rule is asymmetric (ADR-0073): a value binding may **not** shadow
a live palette entry (error), but a `pal` key **may** shadow a non-palette binding (`w`/`h`, a
gradient, an outer `let`) — the palette wins.
**`name = expr` reassigns an existing mutable binding visible in the enclosing draw scope**
(ADR-0081), declaring a fresh local only when none is reachable — so an accumulator inside a
`for`/`if`/`mask`/`scatter`/… body persists to the draw (`g = g.union(…)` in a loop now accumulates,
matching `+=`). The search stops at the draw body: a block never mutates module-scope state, and
`const`/palette/canvas-`w`/`h` are never reassignment targets (there `=` shadow-declares as before).
Reserved/directive keywords are unavailable as binding or `pal`-key names — a stdlib name or
predefined like `rim` is a clean `E007`, but a **filter/directive** keyword (`shadow`, `tint`,
`grain`, `dither`, `replace`, `outline`, `speckle`, `ripple`) parses as its directive, so
`shadow = …` then `shadow.alpha(…)` fails as `E004` at the **use** site, not the declaration; also
avoid `pi`/`tau`/`w`/`h`.
UFCS: `x.f(a)` ≡ `f(x, a)`; zero-arg may drop parens (`c.grayscale`).

Stdlib (fixed, unshadowable, deterministic): `min max abs clamp floor ceil round sign sqrt
hypot dist sin cos tan atan2 pow exp log lerp len`; constants `pi tau`.
**`sin`/`cos`/`tan`/`atan2` work in radians** (`sin(pi/2) == 1`; use `x * pi / 180` to convert) —
**unlike `arc`, whose `a0`/`a1` are degrees.**
`rand(seed[, i])` → [0,1), `noise(seed, x, y)` → [0,1) (2D value noise) — always with
explicit seeds (a `seed <N>` directive is accepted but reserved; no effect).
No I/O, clock, or ambient randomness.
`xs.cycle(i)` (ADR-0079): auto-wrapping list index, sugar for `xs[i mod len(xs)]` — negative
`i` wraps positively (Euclidean/floored mod, same direction as `mod`/`//`); empty list is E015.
Idiomatic for cyclic ramp access in a `for` loop without off-by-one bounds checks:
`for row 0..h: px ramp.cycle(row) 0:row`.

`noise` interpolates only *between* integer lattice points — sampling at integer steps
(`noise(seed, x, 0)` for integer `x`) hits a lattice point every time and returns raw,
uncorrelated values (high-frequency "spikes"). Scale the input down instead, e.g.
`noise(seed, x * 0.05, 0)`, so consecutive samples fall between lattice points. For a noise
**silhouette** (dune/hill/ridge) use `profile` (§ Drawing primitives): its `fn` receives
normalized x∈[0,1], so `noise(seed, nx * K, 0)` is smooth by construction and the trap can't occur.

## Scatter (ADR-0077)

```drw
scatter <name> <n> <seed> <region>:      # header mirrors `for`: keyword, name, then operands
  <body>                                 # runs n times; <name> = a point, child-scoped
```

The seeded replacement for the `for`+`rand`+`floor`+bbox scatter loop (stars, bubbles, gravel,
sparks). Points are drawn **uniformly from the region's on-canvas pixels** (index-sampled with
`rand(seed, i)`), so confining a scatter to a shape is free — pass the shape's region, no
`if region.has …`. `<region>` is a Region or a drawing silhouette.

```drw
draw stars 64x40:
  bg #05060e
  scatter s 40 1 rect(0:0, w-1:h-1):     # 40 stars over the canvas, seed 1
    px #ffffff.alpha(0.4 + rand(9, s.x + s.y) * 0.6) s   # per-star twinkle via the point's x/y
  scatter b 24 4 circle(20:30, 12):      # confined to a disk — no manual guard
    circle #a0d0ff.alpha(60%) b 1 fill
```

- **Deterministic**: same seed + region + canvas → identical points, every platform. Different
  seed → different arrangement. Sampling is with replacement (points may coincide).
- **Empty region** (no on-canvas pixels) → **no-op** (zero iterations, no error).
- One step per iteration (budget). The binding does not leak past the block.

## Mirror (ADR-0078)

```drw
mirror x=<n>: <body>      # draw <body>, then its reflection across the vertical line x=n
mirror y=<n>: <body>      # …across the horizontal line y=n  (n is an integer axis)
```

Symmetry for a whole passage, not just one stamp. `<body>` executes **normally, then again with
every pixel write reflected** across the axis (`px → 2n − px`).

```drw
draw butterfly 32x24:
  mirror x=16:                           # author the left wing; the right is its mirror
    curvePoly #b0407a 16:6 4:2 2:12 16:16 fill
    scatter d 8 3 rect(2:4, 14:18):      # speckles mirror too (same seed → symmetric)
      px #ffe08a d
```

- **Stamps flip** (a stamped sprite comes out horizontally mirrored). **Text does not** — its
  position reflects but glyphs stay forward (no backwards text).
- **Axis pixels paint once** — a 50%-alpha paint on the axis blends once, never double-darkened.
- **Masks travel with the content** (a masked shape *and* its mirror both appear). **Nested
  mirrors compose** into four-fold symmetry (`mirror x=a: mirror y=b: …`); centre paints once.
- The body **re-executes** for the reflected pass — keep it to drawing (a `+=` on an outer
  binding would run twice).

## Color

Ops (call- or method-style): `lighten darken saturate desaturate hue alpha mix grayscale`.
Ramps: `tones(base, …amounts)` and `mixes(a, b, count[, space])` return color lists —
`pal: a, b, c = #ccc.tones(-12%, 0%, 12%)`.
Shading (ADR-0086, call- or method-style): `base.litTone(light, amt)` mixes toward the light
colour (warm highlight — not chalky `lighten`); `base.shadowTone(cool, amt[, darken])` darkens
(by `darken`, default `amt`, but never below 35% of the base lightness → a **dark base keeps
visible detail, never crushes to `#000000`**) + nudges hue toward `cool` capped ≤20° along the
short arc (never cross-hue → **no magenta shadow on warm bases** — `shadowTone` bakes both traps) +
slight desaturate; `base.ramp(n)` → even n-step light→dark tone list (hue-stable, for
`pixels:`/cel banding). Unlike other ops these three are **not reserved** — a recipe may still bind
`ramp`/`litTone`/`shadowTone` (a local binding wins; `.ramp(n)` on a colour still hits the builtin).
Mixing/gradients interpolate in OkLCh by
default (pass `rgb`/`hsl` to override); pipeline (oklch↔sRGB, gamut map, shorter-arc hue,
8-bit round-half-up) is pinned — pixel-identical everywhere.

**Cross-hue `mix`/`tint` rotates hue along the short OkLCh arc (silent).** Blending toward a
*chromatic* colour swings the hue — a warm skin tone toward a cool blue runs through **magenta/rose**
(`#e0a878.mix(#3a6fd8, 30%)` → `#e0828c`, pink; `tint #3a6fd8 40%` likewise). Same trap as the
cross-hue `grad`. Shade **warm materials with `darken()`** (a small cool `mix` stays warm:
`skin.darken(25%).mix(cool, 12%)` reads as a cooler brown, not pink); reach for a depth-`tint` **only
with an exactly neutral grey** (`R==G==B`, chroma 0 — an achromatic endpoint adopts the base hue, so
no rotation). A **near-neutral** cast is not safe: `tint #2a2b2f 40%` (a faint blue bias) still swings
a warm base to magenta, because *any* non-zero endpoint chroma engages the full hue interpolation —
use `#2b2b2b`, not `#2a2b2f`.

## Palettes

`pal` defines const color bindings in the enclosing scope (draw or theme). Key = exactly one
ASCII letter (a–z, A–Z; ≤52 per scope by design — split into stamped parts for more), usable
in `pixels:` cells, expressions, and paint slots. Any letter is a legal key, including `w`/`h`
— a `pal w=…` shadows the canvas-size binding in the applying draw, in **both** drawing-local
(ADR-0073) and **theme** (ADR-0081) palettes, resolving to the colour in expressions, paint slots,
and `pixels:` cells alike. Forms: inline
`pal k=#1a1a1a r=#c04040`,
block `pal:` + indented entries (may derive from earlier ones; may destructure a list).
Multi-char color names = plain bindings (`ink = #1a1a1a`), fine for rendering — indexed
exports collect actual framebuffer colors; the authored `pal` only sets priority order.
Keys never cross stamp scopes; the host artifact folds: own entries, then stamped drawings'
entries in first-stamp order, deduplicated by color.

## Gradients & filters

```drw
grad sky  = linear(90, #4060ff, #ffd080)                     # angle°, stops; 90 = top→bottom
grad fire = linear(0, (#000, 0%), (#f00, 60%), (#ff0, 100%)) # (color, position) stops
grad glow = radial(#fff, #fff.alpha(0%))                     # fade to zero alpha, not `transparent` (see below)
```

A gradient is a paint; it spans the bounding box of what it paints. Pixel mode
ordered-dithers (crisp bands, no AA).

**Cross-hue stops interpolate the short OkLCh arc — often through magenta/grey (silent).** Two
stops from different hue families take the shorter hue arc, which for e.g. blue↔amber runs through
magenta (verified: `linear(0, #3a6fd8, #d8a53a)` midpoint is `#d5659b`, a pink). Same class as the
`radial(c, transparent)` trap. Build gradient stops **intra-hue** (`x.lighten(…)` ↔ `x.darken(…)` of
one base), or set an explicit mid stop, or pass `rgb`/`hsl` to change the interpolation space.

**`radial(c, transparent)` darkens toward the edge (silent).** `transparent` is black at alpha 0, so
the interpolated straight-alpha RGB lerps `c → black` and the fade reads as a muddy grey halo, not a
clean glow. End on the same hue at zero alpha instead: `radial(c, c.alpha(0%))`. A genuinely soft
glow needs a **gentle** alpha ramp: either **many fine** `alpha`-graded `circle … fill`s (increment
≤~7%, radius shrinking a few px each — a *few coarse* rings give concentric onion rings at every size)
or the `radial(c.alpha(x), c.alpha(0%))` gradient itself with its radius pushed **past** the visible
falloff (so the boundary alpha is ~0, else a faint disc edge shows), or `mode smooth`. Below ~24px no
pixel-mode ramp reads as soft — accept a crisp core or hand-pixel it.

Filter commands (post-process framebuffer; `r` = a region where shown). All four shadow
surfaces share one `[region] dx:dy paint` shape (ADR-0070); the four texture filters take an
optional leading region scope (ADR-0071):
`outline [k] [2]` (silhouette outline; colour+width both optional — bare `outline` = 1px derived-dark ink; builds the silhouette from ≥50%-alpha pixels, so it ignores soft shadows/AA and never eats thin features — ADR-0090) · `replace a b` · `tint p 0.3` · `shadow dx:dy p` (whole-frame drop) ·
`castShadow r 2:3 p` / `shadow r 2:3 p` (local, region-first) · `grain [r] amount seed p` ·
`speckle [r] density seed p` · `ripple [r] strength seed p` · `dither [r] a b threshold` ·
`shadeRegion r lightPt base amount` · `lightRegion r lightPt paint amount` ·
`rim r dir p width` · `ambientOcclusion r p amount`.

**Compositing semantics (silent — `check` never flags a wrong effect here):**

- `shadeRegion r light base amount` — blends `base` as a shadow **veil**
  over `r` with opacity **`base.a × amount × t`** (`t` = normalized distance from `light`):
  untouched at `light`, up to `base.a × amount` at the far corner. **`amount` is the veil
  opacity** and it composites over detail, so an opaque `base` does not repaint `r`.
- `lightRegion r light paint amount` — additive mirror of `shadeRegion`: a light **veil** with
  opacity **`paint.a × amount × (1 − t)`**, **brightest nearest `light`**, fading to untouched at
  the far corner. Reach for it for warm/cool local light instead of a masked gradient. It washes the
  **whole region** (a distance falloff, not an edge), so keep `amount` low or it flattens the form.
- `rim r dir p w` lights the edge **facing away from `dir`**: `rim r 0:1 p` (dir points down)
  lights the **top** edge; `rim r 1:0 p` (dir points right) lights the **left** edge. On a **filled**
  silhouette this strokes the *whole* facing contour (both slopes of a peak = a neon wireframe), not
  one chosen edge — confine it with `.intersect(rect(…))` to the target edge. **Any edge with a
  normal component opposing `dir` lights — including the straight cut edge that `.intersect(rect(…))`
  itself introduces and the canvas border where the silhouette meets it, giving a stray glow bar.**
  So for a top edge use `dir 0:1` (no x-component) → only the true top lights, not the vertical cut;
  if you need a side edge lit, cut the region larger than the visible edge or apply `rim` before the
  clip. The band is 1px per `w`, so on a ~20px sprite it barely registers, and on a ~300px region it
  is nearly invisible even at high `w` (raise `w`, or skip it and rely on a lit cap zone).
- `ambientOcclusion r p amount` = a 1px **inner-boundary stroke** of `r` at `p`'s alpha ×
  `amount` — not a soft gradient.
- `outline [k] [w]` rings the **outer silhouette** of everything painted so far (dilate `w`px,
  paint the outside ring). Run it **once as the last statement of the assembly draw**, over the
  composited figure — not per part, or every part-to-part seam gets its own dark ring. Colour+width
  optional (`outline` = 1px derived-dark; `outline k` explicit; `outline 2` derived+2px). Silhouette
  = pixels ≥50% alpha, so a soft contact shadow or AA fringe is **not** ringed; it only paints
  outside, so a 1px staff/finger keeps its core (width 2 still clubs a 2px prop — stay at 1 for RO).
- `dither a b t` is a **raw set, not a blend** — every opaque pixel is overwritten with `a`/`b`
  (Bayer-picked by `t`), so an `alpha(0%)` partner punches a transparency hole, not a no-op.
  Small/radial fills show a hard checkerboard, not a smooth gradient.
- `grain [r]`/`speckle [r]`/`ripple [r]`/`dither [r]` take an **optional leading region** that
  confines the effect to it (intersected with any active mask); the leading arg is a region iff
  it evaluates to one, never colliding with the first real arg (a number for grain/speckle/
  ripple, a paint for dither). **Without** a region each still hits **every opaque pixel of the
  whole framebuffer**, and still respects an enclosing `mask …:` block.
- `grain`/`speckle`/`ripple` order their two numeric scalars uniformly as **magnitude then
  seed** (`grain amount seed`, `speckle density seed`, `ripple strength seed`; ADR-0080) — both
  are numbers, so `check` cannot catch a swap. Tune the first number for how much effect, the
  second only to reshuffle the noise. The magnitude clamps to `[0,1]` and scales the paint's alpha,
  so it is roughly linear: `ripple 0.5` is a faint shimmer, `ripple 1.2` (clamped to 1.0) the paint's
  full alpha. **For `speckle` the first number is the density of scattered (near-)opaque dots, not a
  wash**: ~0.03–0.06 with an `alpha(50–60%)` paint reads as material texture, 0.14 as harsh static.
  `ripple` above ~0.25 on a smooth surface reads as water, not texture.
- The whole-frame `shadow dx:dy p` hits every opaque pixel too, and respects an enclosing
  `mask …:` block (writes only in-mask pixels), like the texture filters. The offset is always a
  `dx:dy` point — the old two-bare-number `shadow dx dy p` spelling was removed.
- **Confine a filter** by giving it a leading region (grain/speckle/ripple/dither) or by
  wrapping the call in a `mask …:` block — which also confines the frame `shadow`. The
  component-`draw` + `stamp` detour is no longer needed. `castShadow`/region-form `shadow` take
  an explicit region and need no confinement idiom.

```drw
filter retro:            # reusable pipeline
  replace y darken(y, 0.1)
  outline k
draw gem: …
  apply retro
```

## Light & material (ADR-0086)

The **default** shading path — one named light drives every dose, so shade, rim, and cast can't
drift apart, and one `model`/`cel` per object replaces the hand-dosed
`shadeRegion`+`lightRegion`+`rim`+`ambientOcclusion`+`shadow` quartet above (which stays the
**floor / escape hatch**).

```drw
light sun      = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # directional; source up-left ⇒ up-left edge lit
light torch    = at 12:8 #ffb060 gain 1.4          # point source at 12:8, 1.4× intensity
material steel = #8a95a5 metal                      # base colour + response

draw sword 24x48:
  lit sun:                 # scopes `sun` over the block body only (set/restore, no global state)
    model blade steel      # smooth form shade → rim → AO → cast, all from `sun`
    model guard #b08040 metal   # inline COLOR RESPONSE — no named material needed
    model grip  #3a2a1e     # bare colour ⇒ response `flat`
    cel  pommel steel 3     # opt-in: the same form body as 3 crisp bands
```

- **`light NAME = dir DX:DY COLOR [amb COOL AMT] [gain N]`** (directional) / **`light NAME = at X:Y
  COLOR …`** (point source). `dir` = the light's *travel* direction (`dir 1:1` moves down-right ⇒
  source up-left ⇒ up-left edge lit); `at` = a canvas position. `COLOR` = warm light colour; `amb
  COOL AMT` = optional fill light (cool colour + `0..1` amount, lifts shadows off pure black);
  `gain N` scales every dose (default `1`). **No constructor parens.** `dir`/`at`/`amb`/`gain` are
  keywords **only** in this binding — ordinary names elsewhere (a recipe may still write `dir = …`).
- **`material NAME = COLOR [RESPONSE] [OVERRIDES…]`**, `RESPONSE ∈ flat | metal | skin | cloth | glass
  | glow`. The response selects a **baked dose profile** (shade depth, rim tightness, AO/cast, specular
  gloss, form roundness) — never the colour, which stays yours. Bare colour ⇒ `flat`. `glow` is
  self-illuminated (fill + inner light only, no shade/rim/cast/spec). The response word is a keyword
  **only** in this slot. **Overrides** (order-free trailing keywords, this slot only): `shade`/`hi`/
  `rim`/`ao`/`spec` replace one dose, `puff` the curvature gain, **`spread N%`** scales `hi`+`shade`
  symmetrically (the value-spread knob — `material robe = #3a2a1e cloth spread 140%`). A trailing
  **profile** `round` (default) | `drape` picks the height field: **`drape`** inflates a per-row 1D
  half-tube (curves across, flat down its length) so a *hanging* cloak/skirt does **not** darken toward
  its hem (`material cloak = #4a3f56 cloth drape spread 200%`) — the fix for a "turtle-shell" cape; keep
  `round` for compact masses.
- **`lit L: body`** scopes light `L` over its body (like `mask …:`). `L` must evaluate to a light.
- **Resolution order** (most-local first): explicit `light L` arg → enclosing `lit L:` block →
  applied **theme default** (`light` in a `theme` body, § Themes). None in any tier = hard `E024`.
  The theme default is the cross-view fix: front + side + recolor variants applying one theme share
  **one** light, so shading is never mirrored per view.
- **`model REGION MATERIAL [over UNION] [light L]`** lowers the material under the resolved light onto a **form
  (normal-based) body shade → rim → AO → cast** (ADR-0089, ADR-0091); `MATERIAL` is a `material` value
  **or** inline `COLOR [RESPONSE]`. Zero-dose edge steps are skipped (so `flat` emits no rim/cast).
  **No light in any tier = hard `E024`** — never a silent default. The **body follows the surface**: an
  inner distance-to-boundary field is **Poisson-inflated** to a smooth dome (disc → hemisphere, stripe
  → half-cylinder, **no medial ridge**; thin limbs bulge by their own width), a per-pixel normal is
  dotted against the light, and the intensity is tone-mapped `warm → base → cool` — **smooth and
  form-following by default**, soft terminator, **always Bayer-dithered** (pixel-art stipple), works at
  chibi scale; a **Blinn specular** hotspot lifts glossy `metal`/`glass`/`skin`; a dark base never
  crushes to `#000000` (keeps ≥35 % lightness). The **cast is clipped to already-drawn content**
  (silhouette offset down-light, minus the region, minus every transparent pixel): within one draw it
  lands on an earlier-drawn opaque neighbour but never bakes onto empty canvas, so an isolated part
  casts nothing (no floating blob). Ground assembled figures with `fit … shadow`, not a baked
  material cast. **`over UNION`** builds the height field from `UNION` (a region, usually
  `partA.union(partB)`) but tones only `REGION`, so stacked parts (leg + boot, arm + glove) co-shade as
  **one continuous limb** instead of restarting the field at the seam — each part keeps its own material.
- **`cel REGION MATERIAL N [over UNION]`** renders the **same form body as `N` crisp bands** that follow the
  surface normal (the intensity field quantized, band-centre tone-mapped) — the **opt-in** hard
  cel-shaded look (`model` is the smooth default). Bands wrap the form, not straight iso-distance
  lines; band **boundaries are Bayer-dithered** (a ±0.5-band dithered edge, not a hard line), and a
  glossy response adds a **hard specular glint**. `--explain` shows one `form` step carrying the band count.
- **`render <file>#<draw> --explain`** prints the exact primitive expansion of every `model`/`cel`
  (CLI § above) — predict the pixels, or copy the sequence to hand-tune with the raw primitives.
- `light`/`material` bindings live at **module scope or drawing-local** (like `grad`/`mask`).
  `model`/`cel` are command verbs; `light`/`material`/`lit`/`model`/`cel` all stay ordinary bindable
  names outside these shapes.

## Themes

```drw
theme dusk:
  with pixelBase, warmPal   # ordered fold, later wins; no inheritance
  pal: …                    # adds/overrides by name
  grad sky = …
  size 16x16                # default canvas for size-less draws
  mode pixel                # pixel (crisp) | smooth (AA); export line may override
  font small                # default text face
  light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # default light — shared by every view/variant
  style """…"""             # natural-language style guide — read it via `context`
```

A theme body holds **only** `pal:` / `grad NAME = …` / `size` / `mode` / `font` / `light` / `style` /
`with` / `filter` / `draw` (ADR-0081/0086). A theme `light NAME = …` folds like `size`/`mode`/`font`
(later wins) → the drawing's outermost light (§ Light & material resolution order); the bound name is
decorative. Surfaced by `context` (`## lighting`). A free binding there (`accent = #d8a53a`) — or a
`material NAME = …` (materials live in module/draw scope, not the theme) — is `E004` **at the
declaration** (hint: put colours under `pal:`, move other constants/materials to module scope) — a
theme carries no non-colour design tokens (radius/margin/alpha), so keep those at module scope above
the theme. Apply: `use themes dusk` at file level, or as the leading line(s) of one `draw` body.
Fold order: file `use` → drawing `use` → drawing-local `pal`/`grad`/`filter` (last wins).
Style guides concatenate (sectioned by source, deduplicated).

**A theme palette does not cross a `stamp` boundary.** A stamped `draw` resolves its own `pal` keys
in its own scope (keys never cross stamp scopes, § Palettes) — a key that is not defined there is a
static `E007`, not a fall-through to the host theme. Recolour a stamped variant **parametrically**
(`draw part(c)` + `pal a=c`, or derived shades `c.darken(…)`) or **post-hoc** with a `replace old new`
chain on the host (exact colour match, one line per tone) — never by swapping the applied theme.

## Text & fonts

Std faces (always registered): `small` 5×7 (default), `micro` 3×5 — monospace ASCII.
Fixed 1px tracking; `\n` in the string wraps (line height = glyph height + 1); unknown chars
render a visible box. `font <name>` is also a scoped directive (theme/module/draw); a
per-`text` `font` flag wins.

```drw
font runic 5x7:            # WxH = optional monospace assertion
  with small               # fallback for unmapped chars
  glyph "A" runeA          # a glyph is a drawing (pixels or paths; non-parametric)
  glyph "B":               # inline body; k binds to the text paint
    pixels: …
  glyphs digits "0123456789"   # bulk: i-th tile of a tileset → i-th char
  tracking 1
  lineheight 8
```

Glyph heights must agree; widths may vary (advance = width + tracking).

## Tilesets & atlases

```drw
tileset terrain 16x16:               # every member exactly 16x16
  tiles grass, dirt, water, stone    # index 0..3, row-major
  cols 4                             # optional; default near-square

atlas hud:
  sprites play, pause, stop, logo    # varied sizes, name-addressed
  pad 1                              # optional padding px
  place logo 0:0                     # optional pin; rest auto-packs deterministically
```

Address a member for stamping: `terrain.0`.

## Export

```drw
export gem icons/gem:        # source-first, bareword base path
  png @1 @2 @3 z9            # gem.png, gem@2x.png, gem@3x.png; zlib 0–9
  png indexed                # indexed PNG: transparent, then authored-palette order, then scanline; >256 = error
  svg ids classes inlineStyles   # pixel mode → pixel-run <rect>s; smooth → shapes
  jpeg 512 q80 mode smooth   # explicit size (512 or 512x512), quality, mode override
  path                       # geometry SVG (path definitions only)
```

Sheet sidecars (tileset/atlas exports): `png` (the sheet) · `tiled` (`.tsj`; `tiled xml` →
`.tsx`; tileset only) · `atlasJson` (`.json` frames map — TexturePacker/Phaser/Pixi) ·
`aseprite` (`.aseprite.json`).

**SVG size — pixel mode merges *horizontal* same-color runs into `<rect width=run height=1>`, so
colour that varies along a scanline explodes the file.** A horizontal or radial gradient, a
`shadeRegion`/`lightRegion` veil (distance-based, so it varies in both axes), `grain`/`speckle`, or
`dither` paints (nearly) every pixel a distinct colour → ~1 `<rect>` per pixel (measured: a flat
32×32 tile 28 rects / 1.8 KB vs. the same tile + `grain` 369 rects / 22 KB — ~12×; icon runs saw
5–25× and a 64px `camera` 1928 rects / 115 KB). A purely **vertical** (row-uniform) gradient stays
compact — one rect per row. For an **SVG** export target, prefer flat fills or a few discrete `pal`
zones (or `mode smooth`, which emits shapes, not per-pixel rects); reserve scanline-varying
gradients / veils / texture for **PNG-only** targets. Counter-check after `build`: `<rect>` count ≪
pixel count.

## Determinism & budget

Pixel mode guarantees pixel-identical output across platforms. There is **one** engine
semantics: `shadeRegion`'s `amount` is the veil opacity (with `lightRegion` its additive
mirror, § Gradients & filters), the whole-frame `shadow` respects an enclosing `mask …:` block,
and the eight offset stamp anchors are visual (§ Transforms & stamp). The `drawstic <N>` pragma
is parsed but inert — kept only so old files still open; omit it in new recipes. Byte-identical
files are NOT guaranteed —
compare pixels, not bytes. Bundled deterministic math (never host `Math.*`), pinned color pipeline
and rasterization, integer source-over alpha (straight RGBA8; pixel mode adds alpha only
from explicit alpha colors, never edge AA). Every render runs under a step/pixel budget —
runaway `while`/recursion aborts with a positioned error; raise via `--budget N`.
