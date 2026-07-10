---
name: drawstic
description: Use this skill when creating or editing deterministic graphics with Drawstic recipes and CLI output: icons, sprites, pixel art, scenes, tilesets, spritesheets, textures, favicons, and game assets. Author .drw recipes, run check/fmt/render, visually verify output, and build PNG/SVG/JPEG artifacts. Do not use for general image editing, non-Drawstic raster manipulation, or conceptual art direction without a reproducible recipe.
---

# Drawstic

Deterministic drawing engine. You author a text **recipe** (`.drw`), the engine renders it —
same recipe, pixel-identical output on every platform. Recipes are token-optimized,
self-verifiable text: you can read one and predict the pixels.

Full language + CLI reference: [reference.md](reference.md). Load it when you need a
construct not covered below.

## Runner

Detect once, reuse: Bun → `bunx drawstic`, npm → `npx drawstic`,
pnpm → `pnpm dlx drawstic`, Yarn → `yarn dlx drawstic`.
Examples below use `bunx drawstic`. Inside the Drawstic repo itself: `bun run drawstic`.

## Workflow — author, verify, build

**The one default path:** *declare intent* (a `light`, `material`s, parts with `pin`) → *assemble*
(`model`/`cel` for shading, `fit` for placement) → *`critique --as <cat>`* until `pass:true` →
*answer the vision rubric* it prints → *`build`*. The declarative constructs (§ Core syntax) let the
engine own coordinate math, light coherence, and pixel contact; the raw primitives stay the escape
hatch (§ Idioms). Steps in full:

1. **Context** (only when the file has imports or themes):
   `bunx drawstic context file.drw` → one flat design brief: merged palette, style guide,
   importable drawings with ASCII previews, functions, export plans.
2. **Write** the recipe — declare intent, then assemble (anatomy below).
3. **Check** `bunx drawstic check file.drw --json` → `[]` = OK. Otherwise fix each
   `{severity, code, message, file, line, col, hint?}` and re-check. Exit code ≠ 0 iff errors.
   Ragged pixel rows? `check file.drw --rows --json` reports per-row widths — no manual counting.
4. **Format** `bunx drawstic fmt file.drw` (canonical, idempotent, rewrites in place).
5. **Look at the output** — never claim success without rendering:
   - shape check in plain text → `render file.drw#name --ascii` (grayscale luminance ramp)
   - color check → `render file.drw#name --preview` (ANSI truecolor), add `--fit 80x40` if big
   - facts → `render file.drw#name --inspect --json` (size, bbox, distinct colors, occupancy,
     per-palette-key opaque pixel share, per-named-mask bbox/coverage — form-sanity without
     reading pixels)
   - predict shading → `render file.drw#name --explain --json` (the exact primitive expansion of
     every `model`/`cel` — colours, amounts, points, offsets resolved; verify a material lowers as
     intended before committing, or copy the sequence to hand-tune)
   - shape-only silhouette → `render file.drw#name --silhouette --png@4` (or `--preview`) — flattens
     every covered pixel to opaque black, so you judge silhouette legibility + modular-part alignment
     with colour stripped; composes with `--inspect`/`--crop`/`--grid`, `--json` carries
     `silhouette: true`. (Under `--ascii` black reads as empty — use PNG/`--preview`.)
   - real file → `render file.drw#name --png@4 --out check.png` (judge at `@4`+; a native `@1`
     sprite is too small on screen to assess)
   - locate a placement bug → `render file.drw#name --png@4 --grid 8` (coordinate gridlines +
     edge labels burned into the PNG only, never `build`; view the PNG)
   - regression check → `render file.drw#name --diff old.png --json` → `render.diff`
     `{identical, changedPixelCount, totalPixelCount, changedBBox}` pinpoints an unintended
     change; compares UNgridded pixels even if `--grid` is also passed
   - parametric draw → `render file.drw#name(#c04040, 3)` — literal args only (number, color,
     string, point, boolean); no throwaway wrapper draw needed
   - family QA (icon set, tileset, any sibling group) → `bunx drawstic sheet file.drw --png@4`
     composes every `export`ed draw (or `--all` = every non-parametric draw) into one labeled,
     size-normalized contact grid — the tool for cross-drawing radius/stroke/grey-value/hue
     consistency; `--json` gives `{cols, rows, cell, cells:[{name, w, h, x, y}]}`, `--cols N` sets
     columns. Parametric draws are skipped; no renderable draw → `E022`.
6. **Critique — MANDATORY, never skip.** `bunx drawstic critique file.drw --as icon|scene|character|item --json`
   runs pixel-based, vision-free quality checks (`C0xx`) `check` structurally can't — off-center,
   floating/seamed parts, flat value, edge-clip, sibling-silhouette collapse — each with
   `{measured, threshold, fix}`. Pass `--as` (thresholds are per-category; sibling checks C009/C011
   compare the exported family minus any composed presentation sheet, `--family a,b,c` overrides;
   under `--as character` C009 never fires between a subject's own front/side/back views). `--strict` → exit 1 on the must-fix
   subset (C001 empty, C007 character seam, +C003 icon centering) — the CI gate. **`pass`≠exit
   code**: `critique.pass` in the JSON goes `false` on *any* fired finding, must-fix or advisory
   (a lone C009/C011/C012 warning flips it), while `--strict`'s exit code trips only on the
   must-fix subset above — a clean `--strict` exit (0) can still carry `pass:false`; read the exit
   code for CI, `failedCodes`/`checks[]` for what's actually outstanding. Then **do what
   `critique.rubric` says**: run its ordered `renders` (silhouette@6 → ascii → png@4 → sheet) and
   answer every `items[]` prompt by looking. `pass:true` is necessary, **not** sufficient — a clean
   automatic gate with an unanswered rubric is not done.
7. **Build** `bunx drawstic build file.drw --out dir --json` → writes every `export`
   artifact, returns `{diagnostics, artifacts: [{path, bytes}]}`.

**Definition of done:** `check` clean · `critique --as <cat>` `pass:true` (or every remaining
`warning` consciously accepted) · the `critique` **rubric answered by looking** · `build` wrote the
artifacts. Skipping `critique` or its rubric is not done — `check` verifies grammar only; every
quality failure is otherwise silent.

## Recipe anatomy

Hand-pixeled sprite — palette keys are one ASCII letter, `.` = transparent (built-in, never declared):

```drw
draw heart:                  # size inferred from rows (5x5)
  pal k=#1a1a1a r=#c04040    # inline palette; block form: pal: + indented k = #...
  pixels:
    .r.r.
    rrkrr
    rrrrr
    .rrr.
    ..r..

export heart icons/heart:    # bareword base path; extension appended
  png @1 @2                  # heart.png + heart@2x.png
  svg ids classes
```

Procedural drawing — plain color bindings, no `pal` needed:

```drw
draw target 16x16:           # one-off procedural: header WxH required (integer literals)
  k = #1a1a1a
  bg #fff
  circle k 8:8 7             # outlined
  circle k.lighten(30%) 8:8 5 fill
```

Composition + parameters + theme:

```drw
from parts eye, tree         # import from ./parts.drw; type inferred
use themes dusk              # file-level theme: `themes` is a module path (./themes.drw), not a keyword; `use dusk` alone means a LOCAL theme already in scope

draw pebble(c) 6x4:          # parametric: instantiate per stamp
  ellipse c 3:2 3:2 fill

draw scene 32x24:
  bg sky                     # gradient/palette names come from the theme
  stamp tree 6:10
  stamp eye 3:5
  stamp eye 10:5 flipx       # draw half, mirror it
  stamp pebble(#806858) 4:20
  stamp pebble(#a58a73) 18:21
```

Declarative object — **the default for any shaded or modular art** (ADR-0086/0087). Declare intent
(one `light`, a `material`, parts with `pin`), then assemble with `model`/`cel`/`fit`; the engine owns
the coordinate math, the light coherence, and the contact — you never hand-dose a shadow or
hand-compute a seam:

```drw
light sun      = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # ONE source of truth; source up-left ⇒ up-left edge lit
material steel = #8a95a5 metal                      # base colour + response (dose profile, never the colour)

draw sword 24x48:
  blade  = rect(11:2, 13:30)     # each mass is a Region binding
  guard  = rect(7:31, 17:34)
  pommel = circle(12:46, 2)
  lit sun:                       # scopes the light over the block
    model blade steel            # smooth form shade→rim→AO→cast, all from sun — can't drift
    model guard #b08040 metal    # inline COLOR RESPONSE, no named material
    cel   pommel steel 3         # opt-in: same form body as 3 crisp bands
```

## Core syntax

- **Three statement shapes:** binding `name = expr` (scan for `=` to find every definition);
  block `kind name …:` + indent; directive `verb args` (`use`, `with`, `stamp`, `size`, `mode`).
- **Line-oriented.** One statement per line, blocks by indentation (spaces only, 2 preferred).
  No `;`, no brackets for lists: `cols = k, y, r` is a list; `xs[i]` / `xs.0` index it.
- **Calls have two surfaces:** command-form `circle k 8:8 6` (statement position only) ≡
  paren-form `circle(k, 8:8, 6)` (required inside expressions). UFCS: `x.f(a)` ≡ `f(x, a)`.
- **Point** `x:y`, origin top-left, y down. Point arithmetic: `c-r`, `4:4 * 2 == 8:8`;
  group composite coords: `(x+1):(y+2)`. `w`/`h` = current canvas size.
- **Colors are values:** `#1a1a1a`, `#rrggbbaa`, `oklch(0.78, 0.12, 75)`, `rgb()`, `hsl()`;
  ops chain: `c.lighten(12%).alpha(80%)`; ramps: `#777.tones(-16%, 0%, 14%)`,
  `a.mixes(b, 4)`; shading (ADR-0086): `base.litTone(warm, 25%)` (warm highlight, not chalky
  `lighten`), `base.shadowTone(cool, 30%)` (darken + hue-nudge capped ≤20° → no magenta shadow; floored at 35%
  of base L → a dark base never crushes to `#000000`), `base.ramp(3)` (n-step light→dark band list);
  `transparent`.
- **Primitives** (**paint FIRST** — paint, geometry, then flags; `fill` = solid, `w2` = stroke width 2):
  `bg p` · `px p pt` · `line p a b` · `rect p a b [fill]` · `rrect p a b r [fill]` ·
  `circle p c r [fill]` · `ellipse p c rx:ry [fill]` · `arc p c r a0 a1` ·
  `quad p p0 c1 p2` · `bezier p p0 c1 c2 p3` · `poly p pt1 pt2 … [fill]` ·
  `curve p pt1 pt2 pt3 … [w2]` (open spline **through** the points, ≥3) ·
  `curvePoly p pt1 pt2 pt3 … [fill]` (closed loop through the points; fillable organic mass; a Region without paint, ≥3) ·
  `profile p span fn [baseline] [fill]` (filled silhouette under `y=f(x)`, one sample/column; `fn` gets normalized x∈[0,1]; a Region without paint) ·
  `text p pt "s" [font name]` · `flood p pt`.
- **Stamp** `stamp name[(args)] pt [anchor center|bottom|…] [flipx] [flipy] [rot45] [scale2]
  [transform t] [tint p 0.3] [shadow 1:1 #0006] [mask r]`.
- **Anchored assembly** (default for modular composition, ADR-0087) — a part declares named attach
  points; the engine solves placement and **guarantees pixel contact** instead of trusting a
  hand-computed `stamp` point: `pin shoulder 4:0` (a part's own-space attach point; exported) ·
  `fit armL.shoulder torso.shoulder` (land armL's pin exactly on torso's placed pin; registers
  armL's pins so the next `fit` chains; bare `fit armL torso` auto-matches a shared name). Seed the
  root with a dotted `pin torso.shoulder 16:14` — when `torso` is a real part this seeds **all** its
  pins, so a later `fit …torso.hip` chains without re-declaring. **`fit` takes the `stamp` flags**
  (`flipx`/`flipy`/`rotN`/`transform`/`tint`/`mask`) and **the pin rides the transform** (a
  left-shoulder pin becomes the correct right shoulder after `flipx`; the fit pin still lands exactly)
  — so mirrored side/back parts and depth-tinted far limbs stay reliable. No contact after fit ⇒
  non-fatal **`W010`** gap (the seam C007 catches). **Contact ≠ correctness:** a pin >2px off the
  part's own ink ⇒ **`W011`** loose-pin (the join floats though the pins meet); `render … --explain`
  reports every fit's landed coords, coincidence, and pin-to-ink gap — always eyeball it. **Held
  prop:** author it once in true orientation with a `grip` pin, `fit sword.grip hand.grip`; the
  per-view figure flip is a *separate* fit that never touches the prop, so the blade direction holds
  across views. **Ground oracle:** `fit tree.base x:duneY(x/(w-1))` plants a part on a terrain fn
  (needs a named target pin) → no floating/sinking. `shadow` flag = auto contact-shadow ellipse.
  `pin`/`fit` are keywords only in these slots.
- **Declarative light + material** (default shading path, ADR-0086) — one named light drives
  everything, so encodings can't drift: `light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%` (travel dir;
  source up-left ⇒ up-left edge lit) or `light torch = at 12:8 #ffb060 gain 1.4` (point source;
  `gain` = intensity, `amb COOL AMT` = fill light). `material steel = #8a95a5 metal` (response ∈
  `flat|metal|skin|cloth|glass|glow`; bare colour ⇒ `flat`; `glow` = self-lit). Then `lit sun:`
  scopes the light over its body, and per object `model REGION MAT [light L]` lowers to a **smooth
  form (normal-based) shade** → rim → AO → cast (all from the one light — follows the surface, soft
  terminator, the default) · `cel REGION MAT N` = the **same form body as N crisp bands** (opt-in
  hard cel look).
  `MAT` = a `material` value **or** inline `COLOR [RESPONSE]`. Resolution order: explicit `light L`
  → `lit L:` block → **theme default** (a `light` in a `theme` body → shared by every view/variant,
  the cross-view fix). None in any tier = hard `E024` (never a silent default). `render … --explain`
  prints the exact primitive expansion. `dir/at/amb/gain` + the response words are keywords **only**
  in their slot.
- **Control flow:** `for i 0..8:` (half-open; `..=` inclusive) · `repeat n:` · `if c:`/`else:` ·
  `match x:` · expression `if c then a else b` · `fn f(a, b) = expr`.
- **Scatter** `scatter p n seed region:` → body n times, `p` = a seeded point drawn uniformly from
  `region`'s pixels (stars/bubbles/gravel/sparks; deterministic; empty region = no-op).
- **Mirror** `mirror x=n:` / `mirror y=n:` → draw the body **and** its reflection across the axis
  (stamps flip; text stays forward; axis pixels paint once; nests for 4-fold symmetry).
- **Export formats:** `png [@N] [z0-9] [indexed]` · `svg [ids] [classes] [inlineStyles]` ·
  `jpeg [512] [q80]` · `path` · `tiled`/`atlasJson`/`aseprite` (sheets) · `mode pixel|smooth`.

## Idioms

- **Choose colors per project** — semantic bindings (`sand = #e9bd72`, `sandLite = sand.lighten(12%)`),
  never generic presets. `pal` only when a color must be a pixel key, palette order matters,
  or for indexed/sprite export control.
- **Compose from small stamped parts**, each with its own local palette; parametric draws
  for variants (`draw chevron(c) 8x8:` → `stamp chevron(k) 0:0`).
- **Symmetry via `mirror x=n:`** for a whole passage (per-stamp `flipx`/`flipy` for one sprite),
  regular forms via shape commands, hand detail via `pixels:`,
  freehand via `path` + `fill`/`stroke`. **Organic shapes** (dunes, hills, waves, fronds, clouds,
  rocks) via `curve`/`curvePoly` — the line passes *through* the points you give, so prefer them over
  stacking `bezier`s or ellipses; `curvePoly … fill` is a soft mass, `curvePoly(…)` a Region for masks.
  A closed `curvePoly` bulges *between* base points — `.intersect(rect(…))` to clamp a flat underside;
  overlapping translucent loops turn muddy; under ~12px use `pixels:` instead.
  For a **procedural** horizon from a function (noise dune/ridge) use `profile p 0..w ridgeY fill`
  instead of a per-column loop — the `fn` gets normalized x∈[0,1], so `noise(seed, nx*4, 0)` is smooth
  by construction (the integer-lattice trap can't happen); `profile(0..w, ridgeY)` is a Region.
- **Explicit light — declare it once**: bind a `light` and let `model`/`cel` lower it, so the body
  shade, rim, and cast can't drift apart. `light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%` then `lit
  sun:` and `model blade steel` (smooth **form-following** shade, the default) / `cel pommel steel 3`
  (same body as crisp bands, the opt-in cel look) per object — one call replaces the hand-dosed
  shade+rim+AO+cast quartet, and `--explain` shows the exact expansion so you can predict it.
  `material` picks the *physics* (`metal`/`skin`/…), never the colour. The raw primitives stay the
  **floor / escape hatch** for hand-tuning: `shadeRegion r light base amount` (shadow veil, `amount`
  = opacity, deepest away from `light`; opaque `base` composites, not repaints), `lightRegion` (its
  additive mirror), `rim r dir p` (lights the edge facing away from `dir`; on a filled silhouette
  `.intersect(rect(…))` it to one edge). Copy `--explain`'s output to drop down to them.
  Full semantics: reference.md § Light & material and § Gradients & filters.
- **Scattered marks** (stars, bubbles, gravel, sparks): `scatter p 40 7 rect(0:0, w-1:h-1):` then
  a mark on `p` — points come uniformly from the region's pixels, so pass a shape to confine them
  (no manual `rand`+`floor`+bbox loop). `noise(seed, x, y)` for smooth 2D texture. Deterministic.
- **Themes only for deliberate sets** (icon family, game UI): palette + `style "…"` guide +
  `size`/`mode`/`font` defaults; compose with `with a, b` (ordered fold, later wins).
- **A `draw` without an `export` is a component** — it exists to be stamped. One concept for
  parts and outputs.

## Craft routing

Building a specific kind of graphic? Load the matching craft guide before drawing — this file
teaches the language, the guides teach the craft:

| Deliverable | Guide |
|---|---|
| Full scene (landscape, interior, space, underwater …) | [scene-craft.md](scene-craft.md) |
| Icon family / app icons (multi-size, PNG+SVG set) | [icon-craft.md](icon-craft.md) |
| Modular character / game figure (parts, two views, faction recolor) | [character-craft.md](character-craft.md) |
| Game item / equipment set (weapons, shields, armor, potions, loot) | [item-craft.md](item-craft.md) |

## Scenes — masterpiece workflow

For a full scene (landscape, interior, space, underwater), a correct render is not enough. Follow
this order; the detailed recipes, dosages, and 3D/shadow/water idioms are in
[scene-craft.md](scene-craft.md) — load it before building any scene ≥~150px.

**Mandatory order:** (1) **light contract** — declare ONE `light sun = dir 1:1 …` before the first
`draw` (ADR-0086); every object's shade/light/rim/cast is lowered from it by `model`/`cel`, so it
can't drift. Hand-placed tones (gradient stops, `pixels:` bands) derive from the light colour via
`litTone`/`shadowTone`, never bare `lighten`. (2) **terrain is a function** — each ground line is a
`fn` + `profile`; everything standing `fit`s its base pin to it (no floating). (3) paint
**back-to-front**: sky → far layer → haze veil → midground → ground (shape gradient far-light→near-dark,
growing sizes) → texture filters (depth-staggered) → **then** detail marks (≥2px, light/dark pair —
grain eats 1px) → subjects (`fit … shadow` for contact + directional shadow + light edge) → foreground
frame → vignette. (4) each object mass: `model REGION MAT` under `lit sun:` (lowers
fill→shade→light→rim→AO→cast from the one light) → **then bright accents by hand**; the raw
`shadeRegion`/`rim` quartet is the floor for hand-tuning past a material (`--explain`).

**Checklist before "done":** run **`critique --as scene`** `pass:true` (+ answer its hero-contrast/
no-floating/one-light rubric), one declared light, no floating objects, ground reads as a plane (not a
wall), hero silhouette crosses a contrast edge, material/veil dosages sane (scene-craft.md § 5), and
you **looked at the @4 image** — `check` verifies grammar only; every quality failure is silent.

## Icons — family workflow

For an app-icon family (6+ siblings, multi-size, PNG+SVG), build the **shared frame first, glyphs
last** — full recipes, dosages and multi-size rules in [icon-craft.md](icon-craft.md), load it
before drawing any family.

**Mandatory order:** (1) **theme** = palette + a `style` guide that records the family number
contract (radius, stroke, margin, light dir per size). (2) **one parametric tile/plate per size**
(accent as arg), stamped by every icon — radius ≈19–22 % of the edge, ONE light contract (light
top-left / dark bottom-right) via *icon mechanics* — a vertical gradient+rim, a 1px bevel, or two
fills+a line — **not** scene filters (`shadeRegion`/`rim` are too weak at 16–32px). (3) **white
silhouette glyphs**, optically centered, stamped on. Multi-size = **redraw, never scale** (fresh
`WxH` header each; ≤~12px = one hand-pixeled `pixels:` grid); family palette = hue-only oklch or
accent-derived shades, `grad` stops intra-hue.

**Checklist before "done":** run **`critique --as icon`** (must-fix C003 centering under `--strict`;
answer its misread + merge-trap rubric), silhouette-first (run the mis-reading test; watch the
merge-trap), optically centered (`--inspect` bbox: `x0+x1 = W−1`; `circle c r` **and** `ellipse c rx:ry` share one even-diameter rule — cover `c−r…c+r−1` per axis, centre `c−0.5`;
notch/bump circle r ≤~20 % of the edge), and you ran **`sheet file.drw --png@4`** for cross-sibling
consistency + **`--png@1`** to confirm each icon reads at 100 %. SVG target → flat tiles only,
counter-check `<rect>` count. `check` catches almost nothing here — icon quality is 100 % visual.

## Characters — modular figure workflow

For a modular game figure (parts stamped into a body, front/side/back, faction recolor), build the
**parts first, the body last** — full recipes, ramps, seam + three-view rules in
[character-craft.md](character-craft.md), load it before building any figure.

**Mandatory order:** (1) **light contract** — put ONE `light` in a `theme` and `use` it, so every
view + recolor variant shares that outermost source and the lit edge lands on the **same world
side** in front AND side (the structural fix for "light mirrored per view" — ADR-0086; a shared
`warm`/`cool` + `fn lit/shd/deep` colour system is the ≤64px fallback where `shadeRegion`/`rim` are
too weak). Side is a different pose, **not** a mirror; the theme light stays put across both.
(2) **proportions constants** (`headTop/shoulderLine/hipLine/kneeLine/footLine` at module scope; ~4
heads for 48–64px). (3) **parametric parts** (`draw part(c)`), each declaring its seam rows as
**`pin`s** in its own space (`pin shoulder 4:0` — replaces the old socket *comment*). (4) full body
**back-to-front via `fit`** (not hand-computed `stamp` points): seed the root with `pin
torso.shoulder …`, then `fit armL.shoulder torso.shoulder` — pixel contact is now structural and a
seam raises `W010`/C007 instead of shipping silently. Plant a standing figure with `fit base`
+ its `shadow` flag (auto contact-shadow) rather than a hand `ellipse`. (5) **recolor
parametrically, never themes** (a theme palette does not cross a `stamp`/`fit`; pass the 1–2 variant
colours, thin wrapper per variant). (6) **redraw pose-leading parts for side AND back — neither is a
flip.** Side: reuse pose-invariant limbs, far limb via neutral-grey `tint`. Back: its own part set
(no face — hair/nape instead), **inverted prop z-order** (a hidden prop fits/stamps *before* the
torso on front/side, a mounted prop/cape fits *after* every limb on back), and **mirrored left-right**
shoulder/hip attach vs. front (character-craft.md §5b). (7) **the RO silhouette outline is ONE bare
`outline` as the last statement of the assembly draw** (ADR-0090) — over the composited figure, width
1, colour derived-or-`ink`. Never bake `outline` per part (rings become internal seams); the
50%-alpha floor means a soft contact shadow painted first is not ringed.

**Checklist before "done":** run **`critique --as character`** (must-fix C007 catches a floating/
seamed part under `--strict`; a composed presentation sheet no longer needs excluding by hand — the
family auto-drops it and never fires C009 between a subject's own front/side/back views, so
`pass:true` doesn't require a sheet-split; answer its seam-contact rubric), `--silhouette` black-out
reads as the archetype and shows connected seams on every view including the back; per-joint `--crop`
(bbox overlap ≠ pixel contact); native `@1` reads; body adds socket offsets, never a shared `y`; warm
materials shaded via `darken` (a raw cool `mix` → magenta); `sheet` across the variant wrappers.
`check` verifies grammar only — every seam/silhouette failure is silent, and a clean `critique --strict`
verifies structure, not craft — look at the render.

## Items — equipment set workflow

For a game item / equipment set (weapons, shields, armor parts, potions, loot), build the **set
contract first, the confusing pairs second, the materials third** — full recipes, dosages and
sidecar patterns live in [item-craft.md](item-craft.md); load it before building any inventory
family.

**Mandatory order:** (1) **theme + set contract** = `size 32x32`, transparent inventory sprites, one
light direction, 2–4 px breathing room, shared axis/footprint, and the outline/material legend in
`style`. (2) **hardest confusion pairs first** (`shortbow/longbow`, `arrowBundle/bolts`,
`pickaxe/axe`, `heraldShield/towerShield`, bottle variants by front sign) — solve silhouette
distance before ornament. (3) **shared scaffolds** — one bottle shell, one shaft angle, one shield
mass, one armor/material language. (4) **silhouette pass, then material pass** — metal = dark spine,
mid fill, and 1–2 px glints; wood/leather/cloth stay sparse; glass = left/right strips + liquid
band; magic/gold/gem accents stay tight. (5) **ship the family** — per-item `png @1 @4`, plus a
`tileset` export with `tiled` + `atlasJson`; use a separate `atlas ... pad 1` only when the named
atlas needs its own packed sheet.

**Checklist before "done":** run **`critique --as item`** (C009 flags a sibling whose silhouette
reads like another's — differentiate or confirm it's a deliberate recolor/shared-shell variant;
answer its pair-confusion rubric), **`sheet file.drw --png@4`** first, then native **`--png@1`** for
every sibling, then **`--silhouette --png@4`** on the weakest pair. After `build`, open the `.tsj`
and atlas `.json` and confirm `tilecount`, `columns`, stable frame names, and frame bounds. `check`
verifies grammar only — pair confusion, weak silhouettes, and mushy materials are silent.

## Gotchas

- Pixel keys: exactly one ASCII letter, declared in a visible `pal`/theme; every row equal
  width; `.` is transparent and never declared. Cells resolve in the **palette namespace only**
  — a plain value binding of the same letter is never a cell; a letter with no `pal` entry is
  `E007`. `w`/`h` are **fine** as pal keys (`pal w=#fff`): they shadow the canvas-size binding
  inside the applying draw — in **both** drawing-local and **theme** palettes — keep them free
  only if you need the dimension in an expression there.
- A bare comma-sequence IS a list — `f(a, b, c)` is a 3-arg call; to pass one list, bind it
  first (`xs = a, b, c` then `f(xs)`).
- Every painting command is **paint-first** — `circle k 8:8 6`, `poly` included: paint, then
  geometry, then trailing flags. `poly` takes `fill` but **not** `w<N>` (its variadic point tail
  eats it → `E001 unknown name 'w2'`); for a wide outline stroke a Region: `stroke p poly(…) w2`.
- Names are camelCase, never hyphenated — `-` always subtracts, no whitespace needed.
- Indices must be integers: `xs[row // 8 mod 3]` (`//` floored division, `mod` keyword);
  `%` is only the percent suffix (`10% == 0.1`).
- Shape statement without paint = error; shape *call* without paint = Region value (for
  `mask`, `fill`, `stroke`, set-ops `.union/.intersect/.subtract/.xor`).
- `stroke` on a **thin** region (short axis ≤2px, or ≤4px with `w2`) paints the *whole* region —
  the 1px border **is** the region, so the fill shows 0 % (an 8×2 bar stroked = 100 % stroke colour).
  Fill thin bars/bones/blades; don't stroke them.
- No cursor in drawings — coordinates are absolute; `rel` movement exists only inside `path`.
- Canvas `WxH` are integer literals, never expressions; scale via `stamp … scale2` or export `@N`.
- Drawing-level `use themes x` lines must be the first statements of the body.
- Scope: `draw`/`path`/`fn`/`theme`/`tileset`/`atlas`/`export` are **module-scope only** (E004
  inside a `draw` body); `mask`/`grad`/`pal`/`filter`/bindings may also be drawing-local.
  Full table: reference.md § Definition scope.
- A `theme` body holds **only** `pal:`/`grad NAME=…`/`size`/`mode`/`font`/`light`/`style`/`with`/
  `filter`/`draw`. A theme `light NAME=…` (ADR-0086) is the shared **default light** for every view/
  variant — folds like `size`/`mode`/`font` (later wins), overridable by a nearer `lit L:`/`light L`.
  A free binding there (`accent = #d8a53a`) is `E004` **at the declaration** — put colours under
  `pal:`, other constants (radius/margin/alpha) at module scope above the theme.
- Theme/host palettes **don't cross a `stamp` boundary** — a stamped `draw` resolves its own `pal`
  keys in its own scope (missing key = static `E007`, not a theme fall-through). Recolour a stamped
  variant **parametrically** (`draw part(c)` + `pal a=c`, or derived `c.darken(…)`) or **post-hoc**
  with a `replace old new` chain (exact colour match, one line per tone) — not by swapping the theme.
- `name = expr` **reassigns the nearest in-scope mutable binding** (loop-persistent, like `+=`),
  declaring a fresh local only when none is reachable — so `g = g.union(…)` inside a `for` now
  accumulates. The search stops at the draw body (blocks never mutate module scope; `const`/palette/
  canvas `w`/`h` are not targets).
- Reserved names as bindings: a **stdlib math name** (`min max abs clamp floor ceil round sign sqrt
  hypot dist sin cos tan atan2 pow exp log lerp len`), a constant (`pi`/`tau`), or a predefined like
  `rim` gives a clean `E007` (`'tan' is a predefined, unshadowable name` — caught by `check`), but a
  **filter/directive** keyword (`shadow`, `tint`, `grain`, `dither`, `replace`, `outline`, `speckle`,
  `ripple`) parses as its directive — `shadow = …` then `shadow.alpha(…)` fails as `E004` at the
  **use** site, not the declaration. Also avoid `w`/`h`. Full stdlib list: reference.md § Expressions.
- SVG export stays compact for flat or row-uniform fills; scanline-varying gradients, veils, texture,
  and grain can explode `<rect>` count. Full export tradeoffs: reference.md § Export.
- `dither` is a **raw set, not a blend** — an `alpha(0%)` partner punches a transparency hole.
  `grain`/`speckle`/`ripple`/`dither` take an **optional leading region** to scope them
  (`grain sand 0.3 11 p`); without one they hit every opaque pixel (still respecting a `mask …:`
  block). All shadow forms share one `[region] dx:dy paint` shape (`shadow 1:1 p`,
  `shadow r 1:1 p`, `castShadow r 1:1 p`, `stamp … shadow 1:1 p` — always a `dx:dy` point, never
  two bare numbers); the whole-frame `shadow` respects a `mask …:` block. A `stamp … shadow` on
  a **composite** sprite clumps the whole silhouette into a dark blob — use an `ellipse … fill` ground
  shadow for standing objects.
- `radial(c, transparent)` muddies a glow; end on `c.alpha(0%)`. Cross-hue OkLCh blends can drift
  through muddy/magenta colours; use intra-hue ramps or explicit `rgb`/`hsl` stops. Full colour traps:
  reference.md § Color and § Gradients & filters.
- Stamp anchors are visual: offset anchors name a spot on the post-transform footprint. A leading
  `drawstic <N>` pragma is parsed but inert (one engine semantics); omit it. Details: reference.md.
- `quad`/`bezier`/`arc` below ~12px rasterize blocky — use `pixels:` instead. `noise(seed, x, 0)`
  at integer `x` is high-frequency spikes — sample fractional steps (`x * 0.05`) for smoothness, or
  use `profile` for a silhouette (its `fn` gets normalized x, so the trap can't occur).
- Runaway loops abort via the step budget — raise with `--budget N` only for legitimately
  heavy recipes.
- Out-of-bounds drawing is silently clipped (legal, useful for partial stamps).
- Imports resolve relative to the recipe file but may not escape the **project root =
  the CLI's working directory** — run drawstic from the directory tree containing all
  imported recipes.

---
*Maintenance (Drawstic developers): this skill ships with the package and mirrors
`docs/language-spec.md` + `src/cli.ts`. Any language or CLI change MUST update SKILL.md and
reference.md in the same change — without compromising their precision or token economy.
Ground edits in real recipe runs/evaluation reports, not generic advice. For substantial skill
changes, compare the new skill against the previous version on 2–3 realistic prompts and grade the
rendered artifacts with concrete evidence. Add helper scripts only when agents repeatedly rewrite
the same deterministic logic; scripts need flags/`--help`, no prompts, structured stdout, diagnostics
on stderr, safe retry behaviour, and an executed test.*
