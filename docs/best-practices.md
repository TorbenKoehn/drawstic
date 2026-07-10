# Drawstic Best Practices

This is the practical guide for idiomatic Drawstic. The language spec defines what is valid;
this file defines what agents should usually write.

## Core Rule

Make the recipe explicit enough that another agent can edit it without guessing. Prefer
small named parts, local color decisions, deterministic helpers, and CLI verification over
large opaque blocks of one-off commands.

## Color

Choose colors per project and per image. Do not rely on bundled palette presets for a house
look; Drawstic images should not converge on the same few standard palettes.

Use plain color bindings for procedural artwork and larger scenes:

```drw
sand = #e9bd72
sandDark = sand.darken(14%)
sandLite = sand.lighten(12%)

sea = #116a96
foam = #e9fbff

draw beach 64x32:
  bg sea
  ellipse sand 32:24 28:7 fill
  ellipse sandLite 24:22 12:3 fill
```

Use `pal` only when a color needs to be a pixel key, when authored palette order matters, or
when indexed/sprite palette control matters. A `pal` is not required for export: PNG indexed
exports collect all rendered colors from the framebuffer and use the authored palette only
as priority order.

For small pixel sprites, derive palette entries locally:

```drw
draw stone:
  pal a=#777 b=a.lighten(14%) c=a.darken(16%)
  pixels:
    .bb.
    baab
    caac
    .cc.
```

For several related procedural colors, use lists and destructuring:

```drw
shadow, base, lit = #6a3b22.darken(16%), #6a3b22, #6a3b22.lighten(18%)
```

Color-ramp helpers preserve this rule: the recipe provides the base color and the ramp
amounts explicitly, for example `#fff.tones(-12%, 0%, 12%)`. Helpers reduce boilerplate, but
they must not choose the palette for the author.

## Palettes

Palette keys are one ASCII letter. Keep a `pal` small and readable. If one drawing needs too
many palette letters, split it into stamped parts with their own local palettes.

Good uses of `pal`:

- hand-pixel sprites with a small color vocabulary
- palette order for `png indexed` or sidecars
- shared theme colors for a deliberately consistent set

Poor uses of `pal`:

- naming every color in a large procedural scene
- storing semantic colors only to make them exportable
- forcing a whole project into generic preset colors

`w` and `h` are legal palette keys inside drawings — `pal w=#fff` shadows the visible canvas
width/height binding for that drawing (ADR-0073). Only keep those two letters free for the
palette if the same drawing also needs the canvas dimension in an expression; otherwise use
the natural colour mnemonic freely.

## Standard Library

Keep `std` small. It should provide abstract construction marks, not a clip-art library.

Prefer generic reusable marks such as dots, dashes, sparks, arcs, blobs, leaves, capsules, or
triangles. Do not add domain packs like `std/nature`, `std/vehicles`, or `std/weather`
without strong repeated evidence. Concrete motifs belong in examples, skills, and docs — see
[motif-cookbook.md](motif-cookbook.md) for proven, copyable snippets of recurring subjects
(palm/tree, cloud, water shimmer, night lighting, dune profile, starfield, …).

An idiomatic std part helps agents build many subjects:

```drw
from std/shapes dot

draw foam 24x6:
  stamp dot 2:3
  stamp dot 8:2
  stamp dot 15:3
```

A non-idiomatic std part bakes a narrow subject into the library:

```drw
from std/nature tropicalIsland
```

## Composition

Build scenes from small drawings and stamps. A local part can have its own palette, size, and
verification surface.

```drw
draw eye:
  pal k=#1a1a1a w=#ffffff
  pixels:
    .k.
    kwk
    .k.

draw face 16x16:
  stamp eye 4:5
  stamp eye 10:5 flipx
```

Use parametric drawings when the same form repeats with different colors or placement.

```drw
draw pebble(c) 6x4:
  ellipse c 3:2 3:2 fill

draw shore 32x12:
  stamp pebble(#806858) 4:6
  stamp pebble(#a58a73) 18:7
```

Preview a parametric drawing standalone with literal render-fragment args — no wrapper draw
needed: `render shore.drw#pebble(#806858)` ([ADR-0067](decisions/0067-render-fragment-literal-arguments.md)).

For a symmetric *passage* (not just a mirrored stamp), wrap it in `mirror x=<n>:` — draw one half
and the block reflects it, stamps flipping and axis pixels painting once
([ADR-0078](decisions/0078-mirror-block.md)):

```drw
draw crest 24x16:
  mirror x=12:                          # author the left, get the right for free
    curvePoly #b08040 12:2 4:6 8:14 12:14 fill
    stamp gem 5:5                        # comes out flipped on the right
```

Nest two `mirror`s (`mirror x=a: mirror y=b:`) for four-fold (kaleidoscopic) symmetry.

## Geometry

Use explicit shape commands for regular forms. Use `pixels:` for hand-authored sprites and
small details. Use `line a b paint` for independent segments and `path` for connected
freehand geometry.

```drw
draw bird 8x4:
  line #25304a 0:3 3:1
  line #25304a 3:1 7:3
```

Use `ellipse` for shadows, islands, stones, highlights, and soft masses. It is often more
editable than a long polygon.

For **organic curves and masses** — dunes, hills, waves, fronds, clouds, rocks — reach for
`curve` / `curvePoly` before stacking `bezier`s or ellipses. Both are centripetal Catmull-Rom
splines that pass *through* the points you give (≥3), so you author the shape you want, not
off-curve Bézier handles. `curve` is an open stroke (optional `w<N>`); `curvePoly` is a closed
loop — `curvePoly p … fill` is a solid mass, and paint-less `curvePoly(…)` is a Region for a
`mask`. Prefer one filled `curvePoly` over an ellipse stack for a cloud or a hillside; its fill
and stroke share one tessellation, so an outline sits exactly on the fill edge.

Three silent `curvePoly` traps to author around (`check` passes, the shape is just wrong): the
closed spline smooths *between* the base points too, so a flat underside on a waterline **bulges
below** the base row — clamp it with `.intersect(rect(…))` on that edge; overlapping **translucent**
loops **compound** in the overlap into a muddy lump — use fewer, narrower loops with less overlap;
and below ~12px a loop is an unrecognizable blob — hand-author small forms with `pixels:` (see below).

For a **procedural** horizon — a dune, hill, or noise ridge defined by a *function* rather than
hand-placed points — reach for `profile <paint> <span> <fn> [<baseline>] [fill]`
([ADR-0076](decisions/0076-profile-filled-function-silhouette.md)). It fills the area under
`y = f(x)` and **samples once per column**, calling `fn` with a **normalized x in `[0,1]`**, so it
replaces the hand-rolled `for x 0..w: line …` loop *and* makes the noise-frequency trap unreachable
(see below). The fill runs to the canvas bottom by default, or to an optional baseline row; paint-less
`profile(0..w, ridgeY)` is a Region for masking/lighting the silhouette.

`quad`/`bezier`/`arc`/`curve`/`curvePoly` round every point to the pixel grid, so below roughly
12px a curve reads as a few blocky straight chunks rather than a smooth line. Hand-author small
curved details with `pixels:` instead.

## Texture And Noise

Seeded `rand` and `noise` are deterministic and useful, but use them sparingly. A few
well-placed procedural marks are usually easier to edit than a dense per-pixel loop.

For **scattered marks** — stars, bubbles, gravel, sparks — reach for the `scatter` block
([ADR-0077](decisions/0077-scatter-block.md)) rather than a hand-rolled `for`+`rand`+`floor`
loop. It draws each point **uniformly from a region's pixels**, so passing a shape confines the
field with no `if region.has …` guard, and it sidesteps the diagonal trap (reusing one seed for x
and y). See the motif cookbook's *Starfield / scatter* for the full pattern.

```drw
scatter s 16 7 rect(0:0, w-1:h-1):
  px #ffffffc0 s                        # 16 sparks, uniform over the canvas, seed 7
```

Be cautious with large loops that paint texture across the whole canvas — prefer the built-in
texture filters (`grain`, `speckle`, `ripple`, `dither`) instead. They are simpler to reason
about but come with sharp edges of their own:

- Each takes an **optional leading region** to scope it (`grain sand 0.3 11 #00000030` grains
  only the sand). This is the direct way to texture one material — reach for it before the
  older detours. **Without** a region they hit **every opaque pixel of the current
  framebuffer**; you can still confine that whole-frame form with an enclosing `mask …:` block,
  or by drawing the content in its own component `draw` and stamping the result in.
- `dither a b t` is a **raw set, not a blend** — it overwrites alpha too, so a partner paint at
  `alpha(0%)` leaves a transparency hole rather than doing nothing. Avoid it on small radial
  fills: the fixed 4×4 Bayer tile reads as a hard checkerboard, not a gradient.
- `ripple`/`grain`/`speckle` take **magnitude then seed** ([ADR-0080](decisions/0080-unified-texture-filter-argument-order.md)):
  the magnitude clamps to `[0,1]` and scales the paint's alpha, so it is roughly linear —
  `ripple 0.5` is a faint shimmer, `ripple 1.2` (clamped to 1.0) is the paint's full alpha. The
  second number only reshuffles the noise.

When sampling `noise(seed, x, y)` on an integer loop counter, scale the input down
(`noise(seed, x * 0.05, 0)`) — sampling at whole-integer steps hits the noise lattice exactly
and returns high-frequency, uncorrelated spikes instead of a smooth curve. For a noise **silhouette**
(dune/hill/ridge) prefer `profile`: its `fn` receives normalized x∈[0,1], so `noise(seed, nx * K, 0)`
with a small `K` is smooth by construction and the integer-lattice trap cannot occur at all.

## Light And Shadow

Keep lighting explicit, and let the engine keep it coherent. The **default** shading path is
declarative ([ADR-0086](decisions/0086-declarative-light-and-material.md)): declare ONE named
`light`, pick a `material` (base colour + a response that sets the *physics*, never the colour), and
shade each object mass with one `model`/`cel` command. That single call lowers, from the one light, to
the whole fill → shade → light → rim → AO → cast sequence — so the shadow, the highlight, and the cast
can never drift apart, and you never re-type the light direction per object:

```drw
light sun      = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # one source of truth; source up-left ⇒ up-left edge lit
material steel = #8a95a5 metal

draw blade 16x40:
  edge = rect(7:2, 9:34)
  lit sun:
    model edge steel                # base + shade/light/rim/AO/cast, all from sun
```

`render <file>#<draw> --explain` prints the exact primitive expansion of every `model`/`cel`, so you
can predict the pixels — and, when a baked material dose genuinely doesn't fit, copy that expansion
down to the raw primitives and hand-tune. Those raw lighting filters (`shadeRegion`, `lightRegion`,
`rim`, `ambientOcclusion`, `shadow`/`castShadow`) are the **floor / escape hatch**, not the first
move — reach for them for hand-tuning, for sub-~24px objects where `model` is too weak, or for
whole-frame veils `model` does not cover. Their pixel effect is not obvious from the call alone, so
verify by rendering, not by reading the recipe:

- `shadeRegion r light base amount` blends `base` as a shadow **veil** over `r` — opacity
  `base.a × amount` at the far corner, fading to untouched at the light. **`amount` is the veil
  opacity**, and it composites over detail rather than repainting it, so an opaque `base` is
  fine.
- `lightRegion r light paint amount` is the additive mirror — a light veil, **brightest nearest
  `light`**, opacity `paint.a × amount`. Reach for it instead of faking warm light with a masked
  gradient. It washes the *whole* region with a distance falloff (not an edge), so keep `amount` low
  or it flattens the form.
- `rim r dir p` lights the edge of `r` facing away from `dir` — `rim r 0:1 p` lights the top
  edge, `rim r 1:0 p` the left edge. On a **filled** silhouette it strokes the *whole* facing
  contour (both slopes of a peak = a wireframe), so `.intersect(rect(…))` it down to the target
  edge; the band is 1px per `w`, nearly invisible on a ~20px sprite.
- For a **soft glow/halo**, don't end a radial gradient on `transparent` (that is black at alpha 0,
  so the RGB fades to a muddy grey ring) — end on `c.alpha(0%)`, or stack a few `alpha`-graded
  `circle … fill`s. Pixel-mode gradients also ordered-dither a wide alpha ramp into hard bands, so
  stacked circles (or `mode smooth`) give the smoothest control.
- `ambientOcclusion r p amount` is a 1px inner-edge stroke, not a soft occlusion gradient.
- All four shadow surfaces share one `[region] dx:dy paint` shape: the whole-frame
  `shadow 1:1 p`, the local `shadow r 1:1 p` / `castShadow r 1:1 p`, and the stamp flag
  `stamp part pt shadow 1:1 p` — the offset is always a `dx:dy` point (no two-bare-number form).
  The whole-frame `shadow` respects an enclosing `mask …:` block. A `stamp … shadow` on a
  **composite** sprite (roof + posts + basin) offsets the whole
  silhouette into a dark clump, not a cast shadow — for a standing object draw a separate
  `ellipse … fill` ground shadow instead.

Good:

```drw
shade = #17394b60

draw object 32x16:
  ellipse shade 16:13 12:3 fill
  circle #e9bd72 16:8 6 fill
```

Good, dropping to the floor by hand (a whole-frame veil, or hand-tuning past a material) — aim the
shadow and the highlight at the same light:

```drw
mask duneShape = ellipse(16:10, 14:5)         # a reusable Region value

draw dune 32x16:
  fill #e9bd72 duneShape
  shadeRegion duneShape 4:2 #201810 0.7       # shadow veil at 70%, deepest away from the light
  lightRegion duneShape 4:2 #fff2c0 0.5       # warm light, brightest at the 4:2 source
  rim duneShape 1:1 #ffffffa0 1               # top-left rim: dir points down-right (light travels from a top-left source)
```

Avoid automatic scene-wide lighting that changes results based on hidden context.

## Themes

Use themes for deliberate sets: a shared icon family, a game UI, or a product illustration
system. Do not use themes as generic color presets for every image.

A theme style guide should describe constraints that help consistency:

```drw
theme uiSet:
  mode pixel
  font small
  pal k=#1a1a1a a=#4b8fd8
  style "Crisp 1px silhouettes. High contrast. No gradients."
```

For one-off scenes, local bindings and local `pal` entries are usually clearer.

## Verification Loop

Agents should verify recipes through the CLI before claiming success:

```sh
bun run src/cli.ts check examples/scenes/island.drw --json
bun run src/cli.ts render examples/scenes/island.drw#island --preview
bun run src/cli.ts render examples/scenes/island.drw#island --png@4 --out out.png
bun run test
```

Use `--ascii` for small palette sprites that can round-trip as text. Use `--preview` or a PNG
render for procedural scenes, gradients, and imported images.

## When To Add More Language

Prefer documentation and std recipe parts before adding syntax. Add language only when it
removes repeated, error-prone structure without hiding decisions.

Good candidates:

- color-list helpers such as `tones` and `mixes`
- explicit local shadows for regions or stamps
- deterministic texture filters with visible seeds
- fitted previews and render inspection data

Bad candidates:

- ambient auto-lighting
- generated palette key ranges
- large bundled style palettes
- concrete motif libraries in `std`
