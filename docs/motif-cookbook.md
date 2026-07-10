# Motif Cookbook

Tested, copyable Recipe snippets for the motifs every scene in the
[Scene-DX evaluation](scene-dx-evaluation-2026-07-08.md) reinvented from scratch: palm/tree,
cloud, water shimmer + foam bands, night lighting, water reflection, dune/hill profile,
starfield/scatter. Each snippet below was verified with
`drawstic check <file> --json` (`[]`) and rendered (`--preview`/`--png@N`) to confirm it
visually reads as the motif before being copied in here — copy the block, rename the
bindings to your project's palette, and adjust size/position.

These are worked examples, not `std` parts — see [best-practices.md](best-practices.md)
§ Standard Library: concrete motifs stay in examples/docs, `std` stays abstract.

## Palm / tree

Tapered trunk as a 4-point `poly` (narrow at the crown, wide at the base, three tones for
roundness), fronds as `poly` triangles fanning from one crown point, dark-under-light
draw order per frond. Curve primitives rasterize as ugly blocks below ~12px — only the two
longest fronds get a `bezier` midrib, and only because they span well over that.

```drw
trunkDark = #6a3b22
trunk = #9a5b31
trunkLite = #c4864c
frondDark = #2f6b2c
frond = #4e9c45
frondLite = #82c85d

draw palm 40x48:
  # tapered trunk, three tones, slight lean toward the crown
  poly trunkDark 17:47 23:47 20:14 16:15 fill
  poly trunk 19:47 23:47 20:15 17:16 fill
  poly trunkLite 21:45 22:46 19:17 18:17 fill
  rect trunkDark 17:38 22:39 fill
  rect trunkDark 17:30 21:31 fill
  rect trunkDark 16:22 20:23 fill

  # crown: 4 fronds fanning from the trunk apex, dark-under-light layering
  poly frondDark 20:15 2:11 8:6 21:12 fill
  poly frond 20:16 4:16 10:9 21:13 fill
  poly frondDark 20:13 8:1 18:0 22:11 fill
  poly frond 20:14 11:3 19:4 22:12 fill
  poly frondDark 21:12 34:2 33:11 22:15 fill
  poly frond 21:13 31:5 31:11 22:15 fill
  poly frondDark 22:14 38:12 32:17 23:17 fill
  poly frond 22:15 35:14 30:16 23:17 fill

  bezier frondLite 20:15 4:11 2:8 3:9    # midrib on the longest left frond (>12px, safe for bezier)
  bezier frondLite 21:13 33:5 36:8 35:9  # midrib on the longest right frond

  circle trunkDark 20:14 3 fill
  circle #5b311d 17:15 2 fill
  circle #5b311d 23:16 2 fill
```

Stamp with `anchor bottom` to plant it on a shoreline/dune without y-arithmetic.

## Cloud

One closed `curvePoly` *is* the whole silhouette — bumps across the top, a flat underside —
so a cloud is one filled loop, not a stack of ellipses to keep aligned. Draw a shadow mass
first (same loop, one row lower, darkened), the lit body over it, then a small highlight
`curvePoly` upper-left. `curvePoly` passes through every point you give, so the crest bumps
are exactly where you place them ([ADR-0075](decisions/0075-curvepoly-closed-curve-region.md)).

```drw
cloudBase = #eef6ff
cloudShade = cloudBase.darken(14%)
cloudLite = #ffffff

draw cloud 24x12:
  # shadow mass first: the same loop, one row lower and darker
  curvePoly cloudShade 3:11 3:8 7:4 12:3 17:4 21:7 21:11 fill
  # lit body: bumps across the top, flat underside — the crest points are the silhouette
  curvePoly cloudBase 2:10 3:7 7:3 12:2 17:3 21:6 22:10 fill
  # highlight puff, upper-left (implied light from top-left)
  curvePoly cloudLite 4:6 7:3 11:4 8:7 fill
```

Usage (tested against a sky background):

```drw
draw skyTest 40x20:
  bg #6fb8e8
  stamp cloud 4:2
  stamp cloud 20:6 flipx
```

Naming gotcha hit while writing this snippet: a module binding and a `draw` share one
namespace. `cloudBase`/`cloudShade`/`cloudLite` are named that way *because* `cloud = #…`
next to `draw cloud …:` is a hard collision (`E006 expected a drawing, got color`) — don't
name a motif's base color the same as its `draw`.

## Water shimmer + foam bands

`bg` a vertical `grad`, then two bright glint rects at the surface, then per-column
`noise()` thresholds at several fixed depths paint short foam-colored rects — each depth
uses its own noise seed/threshold so the bands don't line up. A `ripple` filter on top adds
the shimmer. This is deliberately *raw* `noise(seed, x, y)` at integer `x` (no `* 0.05`
scaling): foam is supposed to look choppy/high-frequency, unlike a dune silhouette (below).

```drw
seaLite, seaMid, seaDeep = #1f9ec4.tones(20%, 0%, -24%)
foam = #e9fbff
foamSoft = #92dceb

draw waterShimmer 64x24:
  grad water = linear(90, (seaLite, 0%), (seaMid, 45%), (seaDeep, 100%))
  bg water
  rect #ddf8ff 0:0 63:1 fill        # bright glint line right at the surface
  rect #5ecae2 0:2 63:3 fill        # secondary glint band
  for x 0..64:
    if noise(5, x, 0) > 0.55:
      rect foamSoft x:6 (x + 4):6 fill
    if noise(5, x, 9) > 0.57:
      rect foam x:12 (x + 5):12 fill
    if noise(5, x, 17) > 0.6:
      rect #c7f4f9 x:18 (x + 3):18 fill
    if noise(7, x, 4) > 0.62:
      rect #1c88ad x:9 (x + 3):9 fill
  ripple 0.2 23 #0b4b7230
```

## Night lighting

Moon as a radial-gradient halo + solid disc + darkened crater + a lit-rim `arc`, over a
vertical night-sky `grad`. The lit hillside below pairs `shadeRegion` and `lightRegion` **by hand**
aimed at the moon (`48:14`) — shown here as the raw floor so you can see each dose. The declarative
default for the same hillside is `light moon = at 48:14 moonRim gain 0.8` + `lit moon: model hill
hillLit` (ADR-0086), which lowers to exactly this quartet from the one light; drop to the hand form
below only to hand-tune a dose. `shadeRegion`'s `amount` is the veil **opacity** (deepest on the far,
bottom-left corner) and it **composites over** the `fill` rather than repainting it, so an opaque
shadow colour is fine; `lightRegion` then adds a cool moon glow, brightest on the hill nearest the moon.

The halo gradient ends on `haloCol.alpha(0%)` (the rim hue at zero alpha), **not** `transparent`:
`transparent` is black at alpha 0, so a radial fade through it lerps the RGB toward black and reads
as a muddy grey ring instead of a glow. Pixel mode also ordered-dithers a wide alpha ramp into
concentric bands — a small, alpha-graded halo hides that; a large one is smoother built from stacked
`alpha` circles.

```drw
skyDeep = oklch(0.14, 0.05, 265)
skyMid = oklch(0.22, 0.07, 250)
skyHorizon = oklch(0.34, 0.10, 220)
moonCore = #f6f3e2
moonRim = #cfd6a8
haloCol = moonRim.alpha(25%)
shadowCol = #0c1830
hillLit = skyMid.darken(10%)

draw nightLighting 64x48:
  grad night = linear(90, skyDeep, skyMid, skyHorizon)
  bg night

  # moon: halo (radial gradient) + disc + rim light + one crater
  grad halo = radial(haloCol, haloCol.alpha(0%))   # end on the rim hue at alpha 0, NOT `transparent`
  circle halo 48:14 18 fill
  circle moonCore 48:14 8 fill
  circle moonRim.darken(10%) 45:12 1 fill
  arc moonRim.alpha(55%) 48:14 11 200 340

  # lit hillside: shadeRegion veils toward the shadow colour (amount = opacity, deepest away
  # from the moon at 48:14) and composites over the fill; lightRegion adds the moon glow,
  # brightest on the hill nearest the moon; rim + AO finish the edge and contact shadow.
  mask hill = poly(0:48, 0:30, 20:24, 40:28, 64:22, 64:48)
  fill hillLit hill
  shadeRegion hill 48:14 shadowCol 0.7
  lightRegion hill 48:14 moonRim.alpha(55%) 0.45
  rim hill 1:-1 moonRim.alpha(50%) 1
  ambientOcclusion hill shadowCol 0.35
```

Verification note: `--ascii` maps by ink-density, not luminance (tracked separately —
the Scene-DX improvements runbook § 3.1) — a dark scene like this one renders as a wall of `@`. Use `--preview`
or a PNG render to check night/space motifs, not `--ascii`.

## Water reflection

A vertical column of horizontal streaks under the light source, each row's half-width and
alpha shrinking with distance (`t`), colors alternating warm/cool, a per-row `rand` jitter
on both the streak's center and its width so it never looks like a rigid triangle, and a
`rand`-gated gap so the column reads as broken streaks rather than a solid wedge. Finish
with `ripple` for the water surface.

```drw
waterTop = #0b1524
waterDeep = #03050c
reflWarm = #db6a26
reflCool = #d8cc95

draw waterReflection 64x32:
  grad lake = linear(90, waterTop, waterDeep)
  bg lake
  lightX = 32                              # x directly below the light source above the water line
  for y 0..24:
    t = y / 24                             # 0 nearest the light's reflection point, 1 at the far edge
    cx = lightX + (rand(19, y) - 0.5) * 5  # per-row jitter so the column isn't a rigid triangle
    hw = (7 - t * 5) * (0.6 + rand(21, y) * 0.5)
    a = (1 - t) * 0.7
    if rand(17, y) > 0.3:                  # gaps break up the column into broken streaks
      col = if rand(27, y) > 0.5 then reflWarm else reflCool
      rect col.alpha(a) (cx - hw):y (cx + hw):y fill
  ripple 0.35 29 #14324e80
```

## Dune / hill profile

Two techniques for a horizon silhouette, pick by how smooth vs. angular the ridge should be.

**Layered `curvePoly`** — smooth and organic, the default for dunes and rolling hills. One
closed loop per layer: hand-authored crest points across the top, then two base anchors placed
*below* the canvas so the loop's smoothing there is clipped and the underside stays a solid flat
fill. `curvePoly` passes through every crest point, so the ridge is exactly the line you author
([ADR-0075](decisions/0075-curvepoly-closed-curve-region.md)). Far layer darker/hazier drawn
first, near layer lighter on top. (Swap `curvePoly` for `poly` when you want a *deliberately
angular*, faceted range instead of smooth dunes.)

**Noise ridge** — procedural and non-repeating, and a one-liner with `profile`
([ADR-0076](decisions/0076-profile-filled-function-silhouette.md)). `profile <paint> <span> <fn>
[<baseline>] [fill]` fills the area under `y = f(x)` and samples the `fn` **once per column**, passing
it a **normalized x in `[0,1]`**. Because the `fn` never sees a raw pixel coordinate, the noise-
frequency trap that burned an evaluation agent is unreachable: multiply the normalized x by a small
`K` (roughly how many undulations you want across the span) and `noise(seed, nx * K, 0)` is smooth by
construction — no `for` loop, no per-column `line`.

```drw
duneFar = #c9a06b
duneFarDark = duneFar.darken(15%)
duneNear = duneFar.lighten(8%)

# Smooth layered range: one curvePoly per layer through the crest points; the two base
# anchors (y 48) sit below the 40px canvas so their smoothing is clipped and the underside
# stays flat. Far layer darker and drawn first, near layer lighter on top.
draw hillLayers 64x40:
  bg #cfe0f0
  curvePoly duneFarDark 0:27 14:21 30:25 48:18 64:23 64:48 0:48 fill
  curvePoly duneNear 0:34 18:29 36:32 54:27 64:31 64:48 0:48 fill

# Procedural ridge: the fn gets normalized x (0..1); nx * 4 → ~4 smooth undulations
# across the width. Filled to the canvas bottom by default — no integer-lattice spikes.
fn ridgeY(nx) = 16 + round(noise(3, nx * 4, 0) * 10)

draw duneProfile 64x32:
  bg #e8d9b0
  profile duneFarDark 0..64 ridgeY fill
```

## Starfield / scatter

The `scatter` block ([ADR-0077](decisions/0077-scatter-block.md)) is the deterministic
replacement for the hand-rolled `for` + `rand` + `floor` dance that showed up in 7/7 evaluation
scenes. It hands the body a point drawn **uniformly from a region's pixels**, so the diagonal
trap (reusing one seed for x and y) is gone by construction and confining the field to a shape
is free. Add per-mark variety with an index-free `rand` on the point's own coordinates (or a
short counter). The same shape generalizes to bubbles, gravel, or sparks — change the region,
seed, and mark.

```drw
starDim = #8fa6cf
starCols = starDim.mixes(#ffffff, 4)

draw starfield 64x40:
  bg #05060e
  scatter s 40 7 rect(0:0, w-1:h-1):       # 40 stars, uniform over the canvas, seed 7
    tw = 0.35 + rand(11, s.x + s.y * 64) * 0.65      # per-star twinkle alpha, deterministic
    sc = starCols[floor(rand(3, s.x + s.y) * 4)].alpha(tw)
    px sc s

draw bubbles 48x40:
  bg #06202e
  scatter b 26 4 circle(24:26, 16):        # confined to a disk — no `if region.has` guard
    circle #a0d0ff.alpha(55%) b 1 fill
```

`s.x`/`s.y` are the point's coordinates (UFCS `x(s)`/`y(s)`) — feeding them to `rand` gives
per-mark variety without a loop counter. To mix in shaped marks, stamp on `s` instead of `px`
(`stamp star4(sc) s anchor center`).
