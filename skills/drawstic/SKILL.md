---
name: drawstic
description: Use this skill when creating or editing deterministic graphics with Drawstic recipes and CLI output: icons, sprites, pixel art, scenes, tilesets, spritesheets, textures, favicons, and game assets. Author .drw recipes, run check/fmt/render, visually verify output, and build PNG/SVG/JPEG artifacts. Do not use for general image editing, non-Drawstic raster manipulation, or conceptual art direction without a reproducible recipe.
---

# Drawstic

Deterministic drawing engine. You author a text **recipe** (`.drw`), the engine renders it —
same recipe, pixel-identical output on every platform. Recipes are token-optimized,
self-verifiable text: you can read one and predict the pixels.

This file teaches the **one canonical path** and the language on it. The **floor / escape hatch**
(raw `shadeRegion`/`rim`/`lightRegion`, `scatter`, `mirror`, hand `pixels:`/`pal:` work, filter
internals) lives in [reference.md](reference.md) — load it when the canonical path doesn't cover a
need, or for any construct not shown here.

## Runner

Detect once, reuse: Bun → `bunx drawstic`, npm → `npx drawstic`,
pnpm → `pnpm dlx drawstic`, Yarn → `yarn dlx drawstic`.
Examples below use `bunx drawstic`. Inside the Drawstic repo itself: `bun run drawstic`.

## The canonical path

Every shaded or modular asset follows the same declarative arc — the engine owns the coordinate math,
the light coherence, and the pixel contact, so you declare intent instead of hand-dosing pixels:

1. **Theme** — one `light` (the single source of truth for shade/rim/cast), plus a `figure:` oracle
   for characters. `use` it so every view/variant shares it.
2. **Materials** — `material NAME = COLOR RESPONSE` (response = the *physics*: `metal`/`skin`/`cloth`/
   `glass`/`glow`/`flat`, never the colour) `[drape] [spread N%]`.
3. **Parts** — each mass is a `Region` binding from a primitive or an **organic constructor**
   (`dome`/`lobe`/`crescent`/`band`); a modular part declares its seams as **`pin`s**.
4. **Assembly** — `fit` (contact-guaranteed placement) with `behind`/`front` (z-order), `aim` (orient a
   held prop), `fit … shadow` (plant on the ground), `fit … tint` (push a far limb back). For a
   multi-view figure, declare one `skeleton` and make each view a `pose` (auto-Z from bone depth) —
   `fit part.pin bone JOINT` (ADR-0095).
5. **Shade** — `model REGION MAT` (smooth, form-following, the default) or `cel REGION MAT N` (crisp
   bands, opt-in).
6. **`outline`** — one bare pass as the last statement, for a closed silhouette.
7. **`critique --as <cat> --strict`** until `pass:true`, then answer the rubric it prints by looking.
8. **`build`**.

Each step is engine-verifiable: `render … --explain` prints the exact primitive expansion of every
`model`/`cel`, each `fit`'s landed pins, the resolved paint order, and each `aim` angle.

## Workflow — author, verify, build

1. **Context** (only when the file has imports or themes):
   `bunx drawstic context file.drw` → one flat design brief: merged palette, style guide,
   theme default light, `figure:` numbers, importable drawings with ASCII previews, functions,
   export plans.
2. **Write** the recipe — theme → materials → parts → assembly (anatomy below).
3. **Check** `bunx drawstic check file.drw --json` → `[]` = OK. Otherwise fix each
   `{severity, code, message, file, line, col, hint?}` and re-check. Exit code ≠ 0 iff errors.
   Ragged pixel rows? `check file.drw --rows --json` reports per-row widths — no manual counting.
4. **Format** `bunx drawstic fmt file.drw` (canonical, idempotent, rewrites in place).
5. **Look at the output** — never claim success without rendering:
   - shape check in plain text → `render file.drw#name --ascii` (grayscale luminance ramp)
   - color check → `render file.drw#name --preview` (ANSI truecolor), add `--fit 80x40` if big
   - facts → `render file.drw#name --inspect --json` (size, bbox, distinct colors, occupancy,
     per-palette-key opaque share, per-named-mask bbox/coverage — form-sanity without reading pixels)
   - predict shading → `render file.drw#name --explain --json` (the exact primitive expansion of
     every `model`/`cel` — colours, amounts, points, offsets resolved; plus each `fit`'s landed pins,
     paint order, and `aim` angle) — verify before committing, or copy the sequence to hand-tune
   - shape-only silhouette → `render file.drw#name --silhouette --png@4` (or `--preview`) — flattens
     every covered pixel to opaque black, so you judge silhouette legibility + modular-part alignment
     with colour stripped (composes with `--inspect`/`--crop`/`--grid`; under `--ascii` black reads as
     empty — use PNG/`--preview`)
   - real file → `render file.drw#name --png@4 --out check.png` (judge at `@4`+; a native `@1`
     sprite is too small on screen to assess)
   - locate a placement bug → `render file.drw#name --png@4 --grid 8` (coordinate gridlines + edge
     labels burned into the PNG only, never `build`)
   - regression check → `render file.drw#name --diff old.png --json` → `render.diff`
     `{identical, changedPixelCount, totalPixelCount, changedBBox}` pinpoints an unintended change
   - parametric draw → `render file.drw#name(#c04040, 3)` — literal args only (number, color,
     string, point, boolean); no throwaway wrapper draw needed
   - family QA (icon set, tileset, any sibling group) → `bunx drawstic sheet file.drw --png@4`
     composes every `export`ed draw (or `--all`) into one labeled, size-normalized contact grid — the
     tool for cross-drawing radius/stroke/grey-value/hue consistency; `--cols N` sets columns
6. **Critique — MANDATORY, never skip.** `bunx drawstic critique file.drw --as icon|scene|character|item --json`
   runs pixel-based, vision-free quality checks (`C0xx`) `check` structurally can't — off-center,
   floating/seamed parts, flat value, edge-clip, sibling-silhouette collapse, occlusion parity — each
   with `{measured, threshold, fix}`. Pass `--as` (thresholds are per-category). `--strict` → exit 1 on
   the must-fix subset (C001 empty, C007 character seam, C013 occlusion parity, +C003 icon centering) —
   the CI gate. **`pass`≠exit code**: `critique.pass` in the JSON goes `false` on *any* fired finding
   (a lone C009/C011/C012 advisory flips it), while `--strict`'s exit code trips only on the must-fix
   subset — a clean `--strict` exit (0) can still carry `pass:false`; read the exit code for CI,
   `failedCodes`/`checks[]` for what's outstanding. Then **do what `critique.rubric` says**: run its
   ordered `renders` (silhouette@6 → ascii → png@4 → sheet) and answer every `items[]` prompt by
   looking. `pass:true` is necessary, **not** sufficient. `critique --json` also carries a **construct
   census** (every construct used, `spec-only`/`non-canonical` flags, and four `antiPatterns` counts
   `rawShade`/`manualSpread`/`stampWithPins`/`handShadow` = W012–W015, **target 0**).
7. **Build** `bunx drawstic build file.drw --out dir --json` → writes every `export`
   artifact, returns `{diagnostics, artifacts: [{path, bytes}]}`.

**Definition of done:** `check` clean · `critique --as <cat>` `pass:true` (or every remaining
`warning` consciously accepted) · the `critique` **rubric answered by looking** · `build` wrote the
artifacts. Skipping `critique` or its rubric is not done — `check` verifies grammar only; a clean
`--strict` verifies structure, not craft; every quality failure is otherwise silent.

## Recipe anatomy — the declarative object (default)

**The default for any shaded or modular art** (ADR-0086/0087). Declare intent (one `light`, a
`material`, parts with `pin`), then assemble with `model`/`cel`/`fit`; the engine owns the coordinate
math, the light coherence, and the contact — you never hand-dose a shadow or hand-compute a seam:

```drw
light sun      = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # ONE source of truth; source up-left ⇒ up-left edge lit
material steel = #8a95a5 metal                      # base colour + response (dose profile, never the colour)

draw sword 24x48:
  blade  = rect(11:2, 13:30)     # each mass is a Region binding
  guard  = rect(7:31, 17:34)
  pommel = circle(12:46, 2)
  model blade steel light sun    # smooth form shade→rim→AO→cast, all from sun — can't drift
  model guard #b08040 metal light sun   # inline COLOR RESPONSE, no named material
  cel   pommel steel 3 light sun # opt-in: same form body as 3 crisp bands
```

(A `theme` default `light` lets every `model`/`cel` drop the `light sun` arg — § Themes.)

Composition + parameters + theme:

```drw
from parts eye, tree         # import from ./parts.drw; type inferred
use themes dusk              # file-level theme: `themes` is a module path (./themes.drw), not a keyword

draw pebble(c) 6x4:          # parametric: instantiate per stamp
  ellipse c 3:2 3:2 fill

draw scene 32x24:
  bg sky                     # gradient/palette names come from the theme
  stamp tree 6:10
  stamp eye 3:5
  stamp eye 10:5 flipx       # draw half, mirror it
  stamp pebble(#806858) 4:20
```

**Hand-pixeled art is the floor**, not the default: a tiny/flat sprite (≤~12px, a flat icon glyph) can
be a `pixels:` grid with a `pal` (palette keys = one ASCII letter, `.` = transparent). Full `pixels:`/
`pal` rules: reference.md § Pixel literals / § Palettes.

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
  ops chain: `c.lighten(12%).alpha(80%)`; ramps: `#777.tones(-16%, 0%, 14%)`, `a.mixes(b, 4)`;
  shading (ADR-0086): `base.litTone(warm, 25%)` (warm highlight, not chalky `lighten`),
  `base.shadowTone(cool, 30%)` (darken + hue-nudge capped ≤20° → no magenta shadow; floored at 35% of
  base L → a dark base never crushes to `#000000`), `base.ramp(3)` (light→dark band list); `transparent`.
- **Primitives** (**paint FIRST** — paint, geometry, then flags; `fill` = solid, `w2` = stroke width 2):
  `bg p` · `px p pt` · `line p a b` · `rect p a b [fill]` · `rrect p a b r [fill]` ·
  `circle p c r [fill]` · `ellipse p c rx:ry [fill]` · `arc p c r a0 a1` ·
  `quad p p0 c1 p2` · `bezier p p0 c1 c2 p3` · `poly p pt1 pt2 … [fill]` ·
  `curve p pt1 pt2 pt3 … [w2]` (open spline **through** the points, ≥3) ·
  `curvePoly p pt1 pt2 pt3 … [fill]` (closed loop through the points; fillable organic mass; ≥3) ·
  `profile p span fn [baseline] [fill]` (filled silhouette under `y=f(x)`; `fn` gets normalized x∈[0,1]) ·
  `text p pt "s" [font name]`.
- **Organic constructors** (ADR-0093 — exact analytic, even-diameter-consistent, smooth at any size;
  build heads/hair/hats from these, **not** hand poly-lists): `dome p c rx:ry [fill]` (upper-half
  ellipse, flat base — skull/helmet/hat crown) · `lobe p base tip w [fill]` (teardrop — ear/nose/
  strand/plume/tassel) · `crescent p c rx:ry thick dir [fill]` (tapering band — fringe/brim/eyelid) ·
  `band p p0 p1 p2 w [fill]` (width-`w` ribbon through 3 points; **stacked = turban wraps**). Paintless
  call = a `Region` (`dome(c, rx:ry)`) for `.union`/`model`/`mask`.
- **Stamp** `stamp name[(args)] pt [anchor center|bottom|…] [flipx] [flipy] [rot45] [scale2]
  [transform t] [tint p 0.3] [shadow 1:1 #0006] [mask r]`.
- **Anchored assembly** (default for modular composition, ADR-0087) — a part declares named attach
  points; the engine solves placement and **guarantees pixel contact**: `pin shoulder 4:0` (a part's
  own-space attach point; exported) · `fit armL.shoulder torso.shoulder` (land armL's pin exactly on
  torso's placed pin; registers armL's pins so the next `fit` chains; bare `fit armL torso`
  auto-matches a shared name). Seed the root with a dotted `pin torso.shoulder 16:14` — when `torso`
  is a real part this seeds **all** its pins. **`fit` takes the `stamp` flags** and **the pin rides the
  transform** (a left-shoulder pin becomes the correct right shoulder after `flipx`; the fit pin still
  lands exactly) — so mirrored side/back parts and depth-tinted far limbs stay reliable. No contact ⇒
  non-fatal **`W010`** gap (the seam C007 catches); a pin >2px off the part's own ink ⇒ **`W011`**
  loose-pin. **Ground:** `fit tree.base x:duneY(x/(w-1))` plants a part on a terrain fn; `shadow` flag =
  auto contact-shadow at the footprint bottom (the feet), not the fit pin.
- **Occlusion + aim (ADR-0092)** — layer parts declaratively, not by fit order: `behind <part>` /
  `front <part>` trailing clauses on `stamp`/`fit` set the paint order (a slung sword `behind cape`,
  pauldrons `front cape`), and `aim <pin> <pt>` rotates a `fit` about its pin until a second pin points
  at a canvas point (orient a bow/sword per view: `fit bow.grip a.grip aim tip 60:20`). Assembly is
  two-phase (placements defer into layers, inline paints are barriers). A conflict is E025. `critique`
  **C013** verifies each relation in the composite (a `--strict` must-fix).
- **Skeleton + pose (ADR-0095, the canonical multi-view path)** — declare a figure's attach points
  once as a `skeleton NAME:` (each joint `NAME at POINT` — usually a `fig` guide point — or FK `NAME
  from PARENT ANGLE LENGTH [limit MIN:MAX]`); make each view a `pose NAME over SKELETON:` with a `view
  front|side|back` line and per-joint `JOINT DELTA [z DEPTH]` lines. In a draw: `pose NAME` solves the
  rig, then `fit part.pin bone JOINT` lands the pin on the joint and inherits its pose orientation. The
  **`z` depth drives auto-Z** — the body's paint order falls out of the pose (no hand `behind`/`front`
  on limbs; explicit `behind`/`front` stays the override for props). A delta past a joint's `limit` is
  a positioned error. `render --explain` prints solved joints + the paint order. See
  character-craft.md §6·0 and `examples/characters-ro/*.drw`.
- **Declarative light + material** (default shading path, ADR-0086) — one named light drives
  everything, so encodings can't drift: `light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%` (travel dir;
  source up-left ⇒ up-left edge lit) or `light torch = at 12:8 #ffb060 gain 1.4` (point source; `amb
  COOL AMT` = fill light). `material steel = #8a95a5 metal` (response ∈ `flat|metal|skin|cloth|glass|
  glow`; bare colour ⇒ `flat`; `glow` = self-lit). The light reaches a command via a theme default or a
  `light L` arg; per object `model REGION MAT [over UNION] [light L]` lowers to a **smooth form
  (normal-based) shade** → rim → AO → cast (Poisson-inflated dome, no medial ridge; soft undithered
  terminator; Blinn specular on `metal`/`glass`/`skin`; the default) · `cel REGION MAT N` = the **same
  form body as N crisp bands**. `MAT` = a `material` value **or** inline `COLOR [RESPONSE]`. A binding
  takes a trailing height-field profile `round` (default) | **`drape`** and trailing dose overrides
  `shade/hi/rim/ao/spec/puff/spread N%`. **`spread N%`** widens `hi`+`shade` symmetrically (the
  value-spread knob — use it, **never** a hand `litTone(…).intersect(rect…)` corner patch, for a dark
  base's C004 contrast). **`drape`** shades a *hanging* cloak/skirt as a per-row half-tube that doesn't
  darken toward its hem. **`over UNION`** builds the field from `UNION` (e.g. `leg.union(boot)`) but
  tones only `R`, so stacked parts co-shade as **one continuous limb**. Resolution: explicit `light L` →
  **theme default** (the `lit L:` block was removed — ADR-0094); neither = hard `E024`.
- **Control flow:** `for i 0..8:` (the one loop — half-open; `..=` inclusive) · `if c:`/`else:` ·
  `match x:` · expression `if c then a else b` · `fn f(a, b) = expr`.
- **Floor constructs** (reach past the canonical path — reference.md): `scatter` (seeded points from a
  region — stars/gravel), `mirror x=n:` (a whole passage + its reflection), raw `shadeRegion`/`rim`/
  `lightRegion`/`ambientOcclusion` (the hand shading quartet `model` replaces), `quantize` (palette
  snap — § Import-assist), hand `pixels:`/`pal:` work.
- **Export formats:** `png [@N] [z0-9] [indexed]` · `svg [ids] [classes] [inlineStyles]` ·
  `jpeg [512] [q80]` · `path` · `tiled`/`atlasJson`/`aseprite` (sheets) · `mode pixel|smooth`.

## Import-assist — primitives vs. an external PNG

**Parametric primitives are the main path** (ADR-0093). They are deterministic from the recipe, redraw
consistently across front/side/back views, and stay editable — build heads/hair/hats from the organic
constructors + the `figure:` oracle (see character-craft.md § 3 scaffolds).

Reach for **import-assist only for a one-off** where an external image generator genuinely helps (a
detailed portrait, a texture) and cross-view consistency is not required:

```drw
import face = ../gen/portrait.png sha256 <hex>   # pin the external PNG (determinism starts here)
pal8 = #1a1420, #e7b088, #a86a44, #47331f, #6b4d2e, #4f7bb0, #fbf6ee, #9a5240
draw hero 48x48:
  stamp face 0:0
  quantize pal8                                   # snap the anti-aliased import onto YOUR palette (OkLab-nearest)
  outline
```

Then `critique` it like any sprite. **Honest limits:** the PNG's *generation* is not deterministic and
lives outside Drawstic — only the pipeline from the `sha256` pin onward is reproducible; and an imported
raster carries its own style, so it rarely matches a primitive-built family. Prefer primitives whenever
you need more than one view or a consistent set.

## Craft routing

Building a specific kind of graphic? Load the matching craft guide before drawing — this file
teaches the language + canonical path, the guides teach the craft:

| Deliverable | Guide |
|---|---|
| Full scene (landscape, interior, space, underwater …) | [scene-craft.md](scene-craft.md) |
| Icon family / app icons (multi-size, PNG+SVG set) | [icon-craft.md](icon-craft.md) |
| Modular character / game figure (parts, three views, faction recolor) | [character-craft.md](character-craft.md) |
| Game item / equipment set (weapons, shields, armor, potions, loot) | [item-craft.md](item-craft.md) |

## Scenes — masterpiece workflow

For a full scene, a correct render is not enough. Detailed recipes, dosages, and 3D/shadow/water
idioms are in [scene-craft.md](scene-craft.md) — load it before building any scene ≥~150px.

**Canonical order:** (1) **light contract** — ONE `light sun = dir 1:1 …` before the first `draw`;
every object's shade/rim/cast is lowered from it by `model`/`cel`. (2) **terrain is a function** — each
ground line is a `fn` + `profile`; everything standing `fit`s its base pin to it (no floating). (3)
paint **back-to-front**: sky → far layer → haze veil → midground → ground (shape gradient far-light→
near-dark) → texture filters (depth-staggered) → detail marks (≥2px, light/dark pair) → subjects
(`fit … shadow` for contact) → foreground frame → vignette. (4) each mass: `model REGION MAT` under the
theme's `sun` → **then bright accents by hand**.

**Before "done":** `critique --as scene` `pass:true` (+ answer its hero-contrast/no-floating/one-light
rubric), one declared light, no floating objects, ground reads as a plane, hero silhouette crosses a
contrast edge, and you **looked at the @4 image**.

## Icons — family workflow

For an app-icon family (6+ siblings, multi-size, PNG+SVG), build the **shared frame first, glyphs
last** — full recipes in [icon-craft.md](icon-craft.md).

**Canonical order:** (1) **theme** = palette + a `style` guide recording the family number contract
(radius, stroke, margin, light dir per size). (2) **one parametric tile/plate per size** (accent as
arg), stamped by every icon — radius ≈19–22 % of the edge, ONE light contract (light top-left / dark
bottom-right) via *icon mechanics* (a vertical gradient+rim, a 1px bevel, or two fills+a line — **not**
scene filters, too weak at 16–32px). (3) **white silhouette glyphs**, optically centered, stamped on.
Multi-size = **redraw, never scale**; ≤~12px = one hand-pixeled `pixels:` grid.

**Before "done":** `critique --as icon` (must-fix C003 centering under `--strict`; answer its misread +
merge-trap rubric), silhouette-first, optically centered (`--inspect` bbox: `x0+x1 = W−1`), and you ran
**`sheet --png@4`** + **`--png@1`**. SVG target → flat tiles only, counter-check `<rect>` count.

## Characters — modular figure workflow

For a modular figure (parts stamped into a body, front/side/back, faction recolor), build the **parts
first, the body last** — full recipes, scaffolds, and three-view rules in
[character-craft.md](character-craft.md).

**Canonical order:** (1) **theme = one `light` + the `figure:` oracle** (ADR-0086/0093) — the light so
every view + recolor variant shares one world-space source (the "light mirrored per view" fix); the
oracle so `heads/headW/eyeLine/…` are declared once and read as named guide points (`fig.crown`,
`fig.eyeL/R`, `fig.side.eye`, `fig.earL/R`, `fig.neckL/R`, `fig.shoulderL/R`) — eyes/ears/neck can't
drift and the profile eye lands forward. (2) **build head + headwear from the organic constructors and a
copied archetype scaffold** (character-craft.md § 3) — `dome`/`lobe`/`crescent`/`band`, **stacked bands
= turban**. (3) **parametric parts** (`draw part(c)`), each declaring its seam rows as **`pin`s**. (4)
full body **back-to-front via `fit`**: seed the root with `pin torso.shoulder …`, then `fit
armL.shoulder torso.shoulder` — contact is structural, a seam raises `W010`/C007. Plant a standing
figure with `fit base … shadow`. (5) **recolor parametrically, never themes**. (6) **redraw pose-leading
parts for side AND back — neither is a flip.** Side: reuse pose-invariant limbs, far limb via
neutral-grey `tint`, orient a held prop with `aim`. Back: its own part set (no face), **declared prop
z-order** (`behind`/`front` — C013 verifies), **mirrored left-right** attach vs. front. (7) **one bare
`outline`** as the assembly draw's last statement (never per part).

**Before "done":** `critique --as character` (must-fix C007 seam under `--strict`; C009 never fires
between a subject's own front/side/back views; answer its seam-contact rubric), `--silhouette` reads as
the archetype on every view incl. back, per-joint `--crop`, native `@1` reads, `sheet` across the
variant wrappers. A clean `critique --strict` verifies structure, not craft — look at the render.

## Items — equipment set workflow

For a game item / equipment set, build the **set contract first, the confusing pairs second, the
materials third** — full recipes and sidecar patterns in [item-craft.md](item-craft.md).

**Canonical order:** (1) **theme + set contract** = `size 32x32`, transparent inventory sprites, one
light direction, 2–4 px breathing room, shared axis/footprint, outline/material legend in `style`. (2)
**hardest confusion pairs first** (`shortbow/longbow`, `pickaxe/axe`, bottle variants) — solve
silhouette distance before ornament. (3) **shared scaffolds** — one bottle shell, one shaft angle, one
shield mass. (4) **silhouette pass, then material pass** — metal = dark spine + mid fill + 1–2px glints;
wood/leather/cloth stay sparse; glass = strips + liquid band; accents stay tight. (5) **ship the family**
— per-item `png @1 @4`, plus a `tileset` export with `tiled` + `atlasJson`.

**Before "done":** `critique --as item` (C009 flags a sibling reading like another — differentiate or
confirm a deliberate recolor/shared-shell; answer its pair-confusion rubric), **`sheet --png@4`** first,
then native **`--png@1`**, then **`--silhouette --png@4`** on the weakest pair. After `build`, open the
`.tsj` and atlas `.json` and confirm `tilecount`, `columns`, frame names, bounds.

## Gotchas

- Pixel keys: exactly one ASCII letter, declared in a visible `pal`/theme; every row equal
  width; `.` is transparent and never declared. Cells resolve in the **palette namespace only**.
  `w`/`h` are fine as pal keys (they shadow the canvas-size binding inside the applying draw).
- A bare comma-sequence IS a list — `f(a, b, c)` is a 3-arg call; to pass one list, bind it
  first (`xs = a, b, c` then `f(xs)`).
- Every painting command is **paint-first** — `circle k 8:8 6`, `poly` included. `poly` takes `fill`
  but **not** `w<N>` (its variadic point tail eats it → `E001 unknown name 'w2'`); for a wide outline
  stroke a Region: `stroke p poly(…) w2`.
- Names are camelCase, never hyphenated — `-` always subtracts, no whitespace needed.
- Indices must be integers: `xs[row // 8 mod 3]` (`//` floored division, `mod` keyword);
  `%` is only the percent suffix (`10% == 0.1`).
- Shape statement without paint = error; shape *call* without paint = Region value (for
  `mask`, `fill`, `stroke`, `.union/.intersect/.subtract/.xor`).
- `stroke` on a **thin** region (short axis ≤2px, or ≤4px with `w2`) paints the *whole* region —
  fill thin bars/bones/blades; don't stroke them.
- Canvas `WxH` are integer literals, never expressions; scale via `stamp … scale2` or export `@N`.
- Drawing-level `use themes x` lines must be the first statements of the body.
- Scope: `draw`/`path`/`fn`/`theme`/`tileset`/`atlas`/`export` are **module-scope only** (E004
  inside a `draw` body); `mask`/`grad`/`pal`/`light`/`material`/`filter`/bindings may also be
  drawing-local. Full table: reference.md § Definition scope.
- A `theme` body holds **only** `pal:`/`grad NAME=…`/`size`/`mode`/`font`/`light`/`figure:`/`style`/
  `with`/`filter`/`draw`. A theme `light`/`figure:` folds like `size`/`font` (later wins). A free
  binding there (`accent = #d8a53a`) — or a `material` — is `E004` **at the declaration** (colours go
  under `pal:`; materials/constants at module scope).
- Theme/host palettes **don't cross a `stamp`/`fit` boundary** — recolour a stamped variant
  **parametrically** (`draw part(c)`) or `tint` it (`replace` was removed, ADR-0094), not by swapping
  the theme.
- **Don't bind a directive/keyword name** (`cap`, `shadow`, `tint`, `grain`, `dither`, `outline`,
  `rim`, `w`, `h`): `cap` is a stroke keyword-arg and **hijacks the next command's argument**; a
  stdlib name (`min`/`sqrt`/…) or predefined gives a clean `E007`; `shadow = …` then `shadow.alpha(…)`
  fails as `E004` at the **use** site. Full stdlib list: reference.md § Expressions.
- `name = expr` **reassigns the nearest in-scope mutable binding** (loop-persistent, like `+=`),
  declaring a fresh local only when none is reachable — so `g = g.union(…)` inside a `for` accumulates.
  The search stops at the draw body.
- SVG export stays compact for flat/row-uniform fills; scanline-varying gradients, veils, texture,
  and grain explode `<rect>` count — reserve them for PNG targets. Full tradeoffs: reference.md § Export.
- `radial(c, transparent)` muddies a glow; end on `c.alpha(0%)`. Cross-hue OkLCh blends (`mix`/`tint`/
  `grad` stops) drift through magenta/grey; use intra-hue ramps or explicit `rgb`/`hsl` stops. Shade
  **warm materials with `darken()`**, never a raw cool `mix` (→ pink). Full colour traps: reference.md.
- `quad`/`bezier`/`arc` below ~12px rasterize blocky — use `pixels:` or the organic constructors
  (exact at any size). `noise(seed, x, 0)` at integer `x` is high-frequency spikes — sample fractional
  steps, or use `profile` (its `fn` gets normalized x).
- Stamp anchors are visual (name a spot on the post-transform footprint). A leading `drawstic <N>`
  pragma is parsed but inert; omit it. Out-of-bounds drawing is silently clipped. Imports resolve
  relative to the recipe file but may not escape the **project root = the CLI's working directory**.

---
*Maintenance (Drawstic developers): this skill ships with the package and mirrors
`docs/language-spec.md` + `src/cli.ts`. Any language or CLI change MUST update SKILL.md and
reference.md in the same change — without compromising their precision or token economy.
Ground edits in real recipe runs/evaluation reports, not generic advice. For substantial skill
changes, compare the new skill against the previous version on 2–3 realistic prompts and grade the
rendered artifacts with concrete evidence. Add helper scripts only when agents repeatedly rewrite
the same deterministic logic; scripts need flags/`--help`, no prompts, structured stdout, diagnostics
on stderr, safe retry behaviour, and an executed test.*
