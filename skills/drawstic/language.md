# The Drawstic language

The whole surface you need for the canonical path, in the order you write a recipe. Each trap sits
next to the construct that causes it and names the diagnostic code you will actually see.
Anything not here is in [reference.md](reference.md).

## 1 — Shape of a recipe

Line-oriented, indentation-structured (spaces only, 2 per level). No `;`, no braces.
Three statement shapes, and that is all:

```text
name = expr                  # binding      — scan for `=` to find every definition
kind name …:                 # block        — followed by an indented body
verb args                    # directive    — use, with, stamp, fit, model, size, mode, …
```

A file is a **module**. `draw`, `path`, `fn`, `theme`, `atlas` and `export` are **module scope
only** and order-independent — they may reference each other in any order. Writing one inside a
`draw` body is `E004`. `mask`, `gradient`, `palette`, `light`, `material`, `filter` and plain
bindings work at module scope *and* inside a draw, but run top-to-bottom: a drawing-local one must
appear before its use.

```drw
from parts eye, tree         # import named drawings from ./parts.drw
use themes dusk              # apply a theme from ./themes.drw at file level
```

Imports resolve relative to the recipe and may not escape the project root (the CLI's working
directory). A drawing-level `use` must be the first statement of the draw body.

## 2 — Values and coordinates

| | |
|---|---|
| point | `x:y`, origin top-left, **y grows downward**. `c-r`, `4:4 * 2 == 8:8`. Group composite coords: `(x+1):(y+2)` |
| canvas | `w` / `h` inside a `draw`; canvas `WxH` are integer **literals**, never expressions |
| number | `10`, `0.5`, `10%` (== `0.1`; `%` is *only* the percent suffix) |
| list | a bare comma sequence: `xs = a, b, c`; index `xs[i]` or `xs.0`; `xs.cycle(i)` wraps |
| region | any paintless shape call; see §5 |
| color | §3 |

**Trap.** `f(a, b, c)` is a **three-argument call**, not a call with one list. To pass a list, bind
it first: `xs = a, b, c` then `f(xs)`.
**Trap.** Indices must be integers — `xs[row // 8 mod 3]`. `//` is floored division, `mod` is a
keyword. Names are camelCase; `-` always subtracts, whitespace or not.

## 3 — Colour

```text
#1a1a1a · #rrggbbaa · oklch(0.78, 0.12, 75) · rgb(…) · hsl(…) · transparent
c.lighten(12%) · c.darken(20%) · c.alpha(80%) · c.mix(other, 30%) · c.saturate(…) · c.rotate(…)
c.tones(-16%, 0%, 14%) · a.mixes(b, 4) · c.ramp(3)          # ramps: lists of colours
base.litTone(warm, 25%) · base.shadowTone(cool, 30%)        # shading-aware pair
```

`litTone` adds a *warm* highlight instead of chalky `lighten`. `shadowTone` darkens with a hue nudge
capped at 20° (no magenta shadows) and floors at 35 % of the base lightness (a dark base never
crushes to black).

**Trap.** Cross-hue blends (`mix`, `tint`, gradient stops) take the short OkLCh arc and drift
through magenta or grey — silently. Blue↔amber midpoint is pink. Stay intra-hue
(`x.lighten` ↔ `x.darken` of one base), set an explicit mid stop, or pass `rgb`/`hsl`.
**Trap.** `radial(c, transparent)` fades to *black at zero alpha* and reads as a grey halo.
End on `c.alpha(0%)` instead.

## 4 — Primitives — paint comes first

Every painting command is **paint, then geometry, then flags**. Trailing `fill` = solid, otherwise
outlined; trailing `w<N>` sets stroke width.

```text
bg p · px p pt · line p a b · rect p a b [fill] · rrect p a b r [fill]
circle p c r [fill] · ellipse p c rx:ry [fill] · arc p c r a0 a1        # arc angles are DEGREES
quad p p0 c1 p2 · bezier p p0 c1 c2 p3
curve p pt1 pt2 pt3 … [w2]          # open spline THROUGH the points (≥3)
curvePoly p pt1 pt2 pt3 … [fill]    # closed loop through the points — fillable organic mass (≥3)
profile p span fn [baseline] [fill] # filled area under y=f(x); fn receives normalized x ∈ [0,1]
poly p pt1 pt2 … [fill]
text p pt "s" [font name]
fill p region · stroke p region [w2]
```

**Organic constructors** — exact analytic shapes, smooth at any size. Build heads, hair and hats
from these, never from hand poly-lists:

```text
dome p c rx:ry [fill]              # upper half-ellipse, flat base — skull, helmet, hat crown
lobe p base tip w [fill]           # teardrop — ear, nose, hair strand, plume, tassel
crescent p c rx:ry thick dir [fill] # tapering band — fringe, brim, eyelid
ribbon p p0 p1 p2 w [fill]         # width-w ribbon through 3 points; stacked = turban wraps
```

**Trap — `E001 unknown name 'w2'`.** `poly` takes `fill` but **not** `w<N>`: its variadic point
tail eats the flag. For a wide outline, stroke a region: `stroke p poly(a, b, c) w2`.
**Trap — silent.** `stroke` on a thin region (short axis ≤ 2·N px) paints the *whole* region. Fill
thin bars, bones and blades; do not stroke them.
**Trap — silent.** `sin`/`cos`/`tan`/`atan2` are radians; `arc`'s `a0`/`a1` are degrees.
**Trap — silent.** `quad`/`bezier`/`arc` below ~12 px rasterize blocky. Use `pixels:` or the
organic constructors there.
**Trap — silent.** `noise(seed, x, 0)` at integer `x` returns uncorrelated spikes. Scale the input
(`noise(seed, x * 0.05, 0)`), or use `profile`, whose `fn` gets a normalized x by construction.

## 5 — Regions

A shape call **without** a paint is a `Region` value, not a drawing:

```drw
mask keyhole = circle(8:5, 4).union(rect(6:5, 9:14))
blob = curvePoly(4:12, 12:3, 20:12, 12:21)
```

Set ops `.union .intersect .subtract .xor` · placement `.shift(pt) .scale(n) .transform(t)` ·
`drawing.region` = any drawing's silhouette, **in that drawing's own space, not where a `fit` or
`stamp` put it**. To reuse it over a placed part — a reflection, a light pool, a contact band —
`.shift()` it by the placement offset yourself (`part.region.shift(landedX - pinX : landedY - pinY)`,
and `render --explain --json` prints each `fit`'s `landed` point).

**`REGION.edge(DX:DY [, N])`** is the one-sided edge band, `N` px wide (default 1), at uniform
coverage. **The direction is where the light travels**, so `0:1` is the **top** edge and `1:0` the
**left** edge; `0:0` is empty. It takes any paint — this is the only way to get a *dark* contour
band, which a material's `rim` dose (always toward the light colour) cannot produce.

```drw
fill #ffffff.alpha(50%) face.edge(0:1)          # 1px top bevel
fill #0a1220.alpha(35%) face.edge(0:-1, 2)      # 2px dark bottom bevel
```

**Trap — silent.** Clip **after** banding: `r.edge(d).intersect(c)`. Writing
`r.intersect(c).edge(d)` bands the clip rectangle and lays a bar across the middle of the mass.
**Trap — silent.** A `curvePoly` also smooths *between* its base points, so a flat underside bulges
below the base row. Clamp it with `.intersect(rect(…))`.
**Trap.** A paintless shape as a *statement* is an error; a paintless shape in an *expression* is a
Region. That is the whole distinction.

## 6 — Light, material, and the two shading commands

```drw
light sun   = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # directional: the vector is where light TRAVELS,
                                                # so 1:1 (down-right) lights the up-left edges
light torch = at 12:8 #ffb060 gain 1.4          # point source; `amb COOL AMT` is the fill light
material steel = #8a95a5 metal                  # COLOR RESPONSE
```

Response ∈ `flat | metal | skin | cloth | glass | glow`. It is the **physics**, never the colour; a
bare colour means `flat`, and `glow` is self-lit. A material binding takes a height-field profile —
`round` (default) or **`drape`** (a hanging cloak or skirt as a per-row half-tube that does not
darken toward its hem) — and trailing dose overrides `shade / hi / rim / ao / spec / puff / spread N%`.

```text
model REGION MAT [over UNION] [light L]    # smooth normal-based body shade → rim → AO → cast
cel   REGION MAT N [over UNION] [light L]  # the same form body rendered as N crisp bands
```

`MAT` is a `material` value **or** an inline `COLOR [RESPONSE]`. `over UNION` builds the height
field from `UNION` (e.g. `leg.union(boot)`) but paints only `REGION`, so stacked parts co-shade as
one continuous limb.

**Light resolution — three tiers, first match wins:**

1. an explicit trailing `light L` on the command;
2. the applied theme's `light`;
3. **the module's sole bare `light NAME = …` binding** — one light, one file, no theme is
   unambiguous, so no argument is needed.

None of the three ⇒ **`E024`**. Two or more module lights with no theme is also `E024`, and the
hint names every candidate.

So: declare exactly one light and you never write `light L` again. A theme light is the multi-view
fix — front, side, back and every recolor variant apply one theme, so shading cannot mirror per view.

**Trap — `W013` / census `manualSpread`.** To raise contrast on a dark base, use the material's
`spread N%` (it widens `hi` and `shade` symmetrically). A hand `litTone(…)` fill clipped with
`.intersect(rect…)` is the retired corner-patch idiom and is linted.
**Trap — `E004` naming the replacement.** The raw quartet `rim` / `shadeRegion` / `lightRegion` /
`ao` was removed. There is no hand-shading floor. Use:

| you want | write |
|---|---|
| shade a solid body | `model r mat` / `cel r mat n` |
| veil pixels that are already drawn | `fill linear(deg, transparent, c.alpha(a)) r` |
| a one-sided edge band | `fill p r.edge(dx:dy[, n])` |
| contact darkening | `stroke p.alpha(a) r`, or the material's `ao N%` dose |

Use the veil row, not `model`, when the region already carries hand-drawn detail: `model` repaints
opaquely and erases grooves.

## 7 — Assembly

```drw
pin shoulder 4:0                       # inside a part: declare an attach point (exported with it)

fit bodyFront.neck 32:43               # ROOT of an assembly: paints the part at a literal point
                                       # AND seeds every one of its pins for the fits that follow
fit armL.shoulder bodyFront.shoulder   # land armL's pin exactly on bodyFront's placed pin
fit armL bodyFront                     # bare form: auto-match a shared pin name
fit tree.base 40:duneY(40/(w-1)) ground  # plant on terrain; `ground` = auto contact shadow at the feet
pin torso.shoulder 16:14               # dotted form: seed a part's pins WITHOUT painting it
```

`fit` takes the same flags as `stamp`, and **the pin rides the transform** — a left-shoulder pin
becomes the correct right shoulder after `flipx`, and still lands exactly. Each `fit` registers the
part's pins so the next `fit` can chain off them. Start an assembly with the root `fit` above, not
with a `stamp`: a `stamp` of a pinned part is `W014`.

Layering is declarative, not fit-order: trailing **`behind <part>`** / **`front <part>`** on a
`stamp` or `fit` set the paint order (a slung sword `behind cape`, pauldrons `front cape`). A cycle
is `E025`; critique **C013** verifies each relation actually holds in the composite.
**`aim <pin> <pt>`** rotates a `fit` about its landed pin until a second pin points at a canvas
point — how you orient a bow or staff per view.

For a multi-view figure, declare the rig once as a `skeleton NAME:` (joints as `NAME at POINT`, or
FK as `NAME from PARENT ANGLE LENGTH [limit MIN:MAX]`) and make each view a `pose NAME over
SKELETON:` with a `view front|side|back` line and per-joint `JOINT DELTA [z DEPTH]` lines. In a
draw, `pose NAME` solves the rig and `fit part.pin bone JOINT` lands a pin on a joint and inherits
its orientation. The `z` depth drives **auto-Z**: the body's paint order falls out of the pose.

**Trap — `W010`.** No pixel contact after a `fit` is a non-fatal gap warning; critique **C007**
turns the same defect into a `--strict` failure. Fix the geometry, do not silence it.
**Trap — `W011`.** A pin more than 2 px off its part's own ink is a loose pin.
**Trap — `W014` / census `stampWithPins`.** `stamp`ing a part that declares pins skips the contact
guarantee. Use `fit`, or drop the pins if the part really is decoration.
**Trap — `E004`.** `anchor` is not valid on `fit`; the pin already *is* the anchor.
**Trap — silent.** `outline` runs **once, as the last statement of the assembly draw**. Per part it
rings every internal seam.
**Trap — silent.** Theme and host palettes do **not** cross a `stamp`/`fit` boundary. Recolour a
stamped variant parametrically (`draw part(c)`) or with `tint`.

## 8 — Stamp and transforms

```text
stamp name[(args)] pt [anchor <name>] [flipx] [flipy] [rot45] [scale2]
     [transform t] [tint p 0.3] [shadow 1:1 #0006] [mask r]
```

Default placement is top-left; the eight anchors (`topLeft top topRight left center right
bottomLeft bottom bottomRight`) are **visual** — they name a spot on the footprint you actually see
*after* flip/rotate/scale. Transform constructors: `shift rotate scale skew flipx flipy matrix
rotatex rotatey perspective`, anchored with `.about(pt)`. **Reading order is application order.**
Pixel mode resamples nearest-neighbour; mirrors, quarter-turns and integer scales are lossless; a
non-invertible transform is `E014`.

**Trap — silent.** A stamp `shadow` on a *composite* sprite offsets the whole silhouette and reads
as a dark clump. For a standing object draw a separate ground ellipse, or use `fit … ground`.

## 9 — Themes and the figure oracle

A `theme` body holds **only** `palette:`, `gradient NAME = …`, `size`, `mode`, `font`, `light`,
`figure:`, `style`, `with`, `filter` and `draw`. `light`, `figure:`, `size` and `font` fold like
settings — a later one wins.

```drw
theme ro:
  palette:
    k = #26344a                          # keys are single ASCII letters when used by `pixels:`
    p = k.lighten(20%)
  size 64x128
  mode pixel
  light sun = dir 1:1 #ffe6b0 amb #2a3a5e 16%
  figure:                                # heads headW eyeLine earLine eyeSep neckW shoulderW hipW
    heads 3
    headW 34
    eyeLine 0.66
  style """
    Free-text guide the agent reads back via `context`: number contract, light rule, material legend.
  """
```

The `figure:` oracle binds `fig` in every drawing that applies the theme, so guide points are
declared once and cannot drift:

- points — `fig.crown fig.chin fig.neckL/R fig.eyeL/R fig.earL/R fig.shoulderL/R fig.hipL/R`
- scalars — `fig.heads fig.headW fig.headH fig.eyeLine fig.earLine fig.eyeSep fig.neckW
  fig.shoulderW fig.hipW fig.center fig.eyeY fig.earY fig.chinY fig.shoulderY fig.hipY`
- views — `fig.front… fig.side… fig.back…`, e.g. `fig.side.eye`. The side view faces **+x**, so its
  single eye sits forward of centre and its ear toward the back.

**Trap — `E004`, but only once the theme is applied.** A free binding (`accent = #d8a53a`) or a
`material` inside a theme body is an error at the declaration — colours belong under `palette:`,
materials at module scope. An **unapplied** theme is never validated, so the error appears the
moment you add `use`.
**Trap — `E007`.** Every builtin, command and filter name is reserved and unshadowable —
`shadow tint grain dither outline rim model cel ramp litTone shadowTone speckle ripple cap join
min sqrt w h pi tau` and the rest. Binding one is a clean error **at the declaration**.

## 10 — Pixel literals

Hand pixels are the **floor**, not the default: a sprite ≤ ~12–16 px, or a flat icon glyph.

```drw
draw bird:
  palette k = #33435c s = #8fa3c4
  pixels:
    k...k
    .k.k.
    .sks.
```

Keys are exactly one ASCII letter, declared in a visible `palette`; `.` is transparent and never
declared; every row must be the same width. Cells resolve in the palette namespace only.

**Trap — `E002`.** Ragged rows. `check file.drw --rows --json` reports per-row widths, so you never
count by hand.
**Trap — `W009`.** A fully transparent last row.
**Trap — `W001`.** A declared palette key that nothing uses.

## 11 — Control flow, functions, stdlib

```text
for i 0..8:                 # the ONE loop — half-open; `0..=8` inclusive
if c: … else: …             # statement form
match x: …                  # arms, plus `else:`
c = if x > 15 then y else r # expression form
fn lerp2(a, b, t) = a + (b - a) * t
x += 10                     # += -= *= /=
```

Stdlib (fixed, deterministic): `min max abs clamp floor ceil round sign sqrt hypot dist sin cos tan
atan2 pow exp log lerp len`, constants `pi tau`, plus `rand(seed[, i])` and `noise(seed, x, y)`.
UFCS: `x.f(a)` ≡ `f(x, a)`; zero-arg calls may drop the parens.

**Trap — silent.** `name = expr` **reassigns the nearest reachable mutable binding** (like `+=`) and
only declares a fresh local when none is in scope. That is why `g = g.union(…)` inside a `for`
accumulates. The search stops at the draw body.

Beyond the canonical path, and only when it does not cover a need: `scatter` (seeded points over a
region — stars, gravel), `mirror x=n:` (a passage plus its reflection), `quantize` (snap an imported
raster onto your palette), the texture filters (`grain speckle ripple dither`) and user `filter`
blocks run via `apply`. Details in [reference.md](reference.md).

## 12 — Atlases

One construct, two modes. `tile WxH` is the switch.

```drw
atlas terrainGrid:                       # WITH tile: fixed slots on a cols-wide grid.
  sprites grass, dirt, water, stone      # This is the only form `tiled` accepts.
  tile 16x16
  cols 4                                 # optional; requires `tile`
  pad 1                                  # optional gutter, also `tiled`'s spacing

atlas hud:                               # WITHOUT tile: shelf-packed to each sprite's own
  sprites play, pause, stop, logo        # bounds — what a runtime atlas (`atlasJson`) wants.
  pad 1
  place logo 0:0                         # optional pin; cannot be combined with `tile`
```

Address a member **by name**: `terrainGrid.grass`. The old numeric `terrain.0` index form is gone;
an unknown member is `E015`.

**Trap — `E004` naming the replacement.** `tileset` was merged into `atlas` and now hard-fails.
**Trap — `E018`.** A `tiled` sidecar on an atlas without `tile WxH`.

## 13 — Export

```drw
export sword sword:          # <drawing> <base path>, then one line per format
  png @1 @4                  # @N scale variants; also `z0-9`, `indexed`
  svg ids classes            # also `inlineStyles`
  jpeg 512 q80
  path                       # geometry-only SVG
```

Sheet sidecars on an atlas export: `png` (the sheet) · `tiled` (`.tsj`; `tiled xml` → `.tsx`;
needs `tile`) · `atlasJson` (frames map) · `aseprite`.

**The base path is relative to the recipe's own folder** — `build` defaults `--out` to the recipe's
directory, so an export path is a plain basename.

**Trap — silent, and the single most common "it worked but nothing appeared".** No `export` block
means `build` writes nothing and still exits 0.
**Trap — `W002`.** A drawing that is neither exported, stamped nor fitted. Listing it under an
atlas's `sprites` does **not** count — atlas members need their own `export` too.
**Trap — `W016`.** An export path whose first segment repeats the recipe's own directory name.
**Trap — silent.** SVG stays compact for flat, row-uniform fills. Scanline-varying gradients,
veils, texture and grain explode the `<rect>` count — keep those for PNG targets.

## 14 — When something goes wrong

Every diagnostic is `{severity, code, message, file, line, column, hint?}`; errors fail the exit
code, warnings and info never do. The complete code→fix table — errors, lint warnings and the
`C0xx` critique checks — is in [verify.md](verify.md), together with the loop that clears them.
