# Recipe Examples

A gallery of worked Recipes. The authoritative reference is
[language-spec.md](language-spec.md) — this file shows the language *in use*.

Idiomatic authoring guidance lives in [best-practices.md](best-practices.md).

---

## 1. A hand-drawn sprite (pixel literal)

The most direct primitive: one character per pixel, mapped through a palette.

```drw
draw heart 5x5:
  pal:
    k = #1a1a1a
    r = #c04040
  pixels:
    .r.r.
    rrkrr
    rrrrr
    .rrr.
    ..r..

export heart icons/heart:
  png @1 @2 @3
```

Keys are single ASCII letters — a fixed, expression-safe set, so every key is an ordinary
colour binding usable in cells *and* expressions
([ADR-0049](decisions/0049-ascii-letter-pixel-keys.md)); `.` is the built-in transparent
cell (never declared in `pal`):

```drw
draw dither 6x3:
  pal k=#1a1a1a  d=#555  l=#bbb   # inline form
  pixels:
    kdlldk
    dlkkld
    kdlldk
```

---

## 2. A procedural sprite

Geometry rasterized onto the integer grid. Good for parametric / regular shapes.

```drw
draw target 16x16:
  k = #1a1a1a
  r = #c04040
  circle k 8:8 7
  circle r 8:8 5 fill
  circle k 8:8 2 fill
```

Procedural drawings do not need `pal` just to use colors. Plain bindings are often clearer;
reserve `pal` for pixel keys, authored palette order, or indexed/sprite palette control.

Commands are calls: the space-separated **command-form** above is the idiom, but each line
may equally be written in **paren-form** — `circle(k, 8:8, 7)` ≡ `circle k 8:8 7`
(see the [language spec §3](language-spec.md#3-lexical-structure) and
[ADR-0015](decisions/0015-unified-call-model.md)).

---

## 3. Composition with stamps and mirroring

Draw half, mirror it — symmetry for free, pixel-exact. Existing graphics join via
`import` ([ADR-0045](decisions/0045-import-external-images-as-drawings.md)).

```drw
from parts eye, mouth
use themes dusk
import logo = ../brand/logo.png    # an external PNG is just another drawing

draw face 16x16:
  bg y
  stamp eye 3:5
  stamp eye 10:5 flipx     # right eye at the mirrored position — draw half, mirror it
  stamp mouth 6:10
  stamp logo 1:12          # stamp the imported graphic like any other
```

Generic std marks stay abstract; concrete motifs are composed locally:

```drw
from std/shapes blob, arcMark, capsule, dash, leaf, tri

draw marksScene 42x18:
  stamp blob(#ffffff) 0:2
  stamp blob(#d9f2ff) 5:2              # cloud from blobs
  stamp arcMark(#25304a) 17:1          # bird mark
  stamp capsule(#7a4a24) 2:12
  stamp tri(#fff6d5) 7:8               # boat from capsule + tri
  stamp leaf(#4e9c45) 24:7
  stamp leaf(#82c85d) 29:8             # foliage from leaves
  stamp dash(#e9fbff) 24:15
  stamp dash(#92dceb) 31:15            # wave marks
```

---

## 4. Expressions, loops, functions

The opt-in escape hatch for parametric drawings. Colours are ordinary values, so a `fn`
can compute the *index* into a colour list.

```drw
fn band(row) = row // 4 mod 2   # → 0 or 1 (floored integer division & modulo, spec §10)

draw stripes 32x32:
  pal:
    k = #1a1a1a
    y = #e0b070
  cols = k, y                  # a list needs no brackets
  for row 0..h:
    poly cols[band(row)] 0:row w:row
```

Point arithmetic is the idiom for centered procedural geometry; keep arithmetic tight in
command-form arguments:

```drw
draw squares 128x16:
  pal k=#1a1a1a
  for i 1..=8:
    c = (i*16):8
    r = i:i
    rect k c-r c+r
```

---

## 5. A theme as a style guide + composition

```drw
# themes.drw

theme pixelBase:
  style "No AA. 2px black outline. Light from top-left."

theme warmPal:
  pal:
    k = #1a1a1a
    y = #e0b070
    r = #c04040

theme dusk:
  with pixelBase, warmPal
  style "Cozy dusk mood; long soft shadows in 'r'."
```

Applied per file:

```drw
use themes dusk
# every drawing below resolves colors against dusk's merged palette
# and the agent receives dusk's merged style guide via `drawstic context`.
```

Or per drawing — leading `use` line(s) in the body
([ADR-0051](decisions/0051-drawing-level-use.md)):

```drw
use themes dusk

draw moonIcon 16x16:
  use themes midnight          # this drawing only; folds after the file theme
  circle k 8:8 6 fill
```

---

## 6. Multiple drawings + selective output in one module

```drw
use themes dusk

draw gem:            # size omitted → inferred 4x4 from the pixels (§6). Only stamped, never exported.
  pixels:
    .yy.
    yrry
    yrry
    .yy.

draw crown 16x6:     # procedural, no `pixels:` and a non-default size → header required
  for i 0..3:
    stamp gem (i*5):0  # three gems across, at absolute positions

export crown ui/crown:
  png  @1 @2
  svg  ids classes
```

---

## 7. Gradients, colour operations & filters

Colours are first-class: build them in any space, transform them, interpolate them in a
gradient, post-process with filters. Gradients are ordered-dithered in pixel mode.

```drw
theme dusk:
  pal:
    k = #1a1a1a
    y = oklch(0.78, 0.12, 75)
  grad sky = linear(90, oklch(0.62, 0.15, 260), y)   # night → warm horizon

filter softshadow:
  shadow 1:1 darken(k, 0.2)     # whole-frame drop shadow, offset dx:dy (ADR-0070)

from parts tree
use dusk                      # local theme, file-level

draw scene 32x24:
  bg sky                      # dithered vertical gradient fills the canvas
  rect k 4:18 27:23 fill      # ground line
  stamp tree 6:10
  apply softshadow
```

For one-off procedural art, choose project-local colors with semantic bindings:

```drw
draw shore 64x32:
  sand = #e9bd72
  sandDark = sand.darken(14%)
  sandLite = sand.lighten(12%)
  sea = #116a96
  foam = #e9fbff

  bg sea
  ellipse sandDark 32:25 29:7 fill
  ellipse sand 32:23 28:7 fill
  ellipse sandLite 24:21 12:3 fill
  rect foam 0:17 63:17 fill

export shore scenes/shore:
  png indexed
```

The `indexed` export still collects all rendered colors. `pal` is not required to make
`sand`, `sea`, or `foam` exportable.

Use colour-list helpers when a local ramp is clearer than repeated bindings:

```drw
draw surf 32x12:
  sea = #116a96.mixes(#e9fbff, 4)
  bg sea.0
  rect sea.1 0:8 31:8
  rect sea.2 0:9 31:9
  rect sea.3 0:10 31:10
```

For small hand-pixeled sprites, `pal` remains the right tool because cells need palette keys:

```drw
draw pebble:
  pal:
    a, b, c = #777.tones(0%, 14%, -16%)
  pixels:
    .bb.
    baab
    caac
    .cc.
```

---

## 8. Reusable paths & masks

Drawing commands use explicit coordinates. Connected freehand geometry lives in first-class
`path` definitions with a local pen cursor ([ADR-0061](decisions/0061-first-class-paths-and-local-pen-cursors.md)).
Paths can be filled, stroked, transformed, combined, imported, exported, or converted to
regions for masks.

```drw
from parts crest

path framePath 16x16:
  move 0:0
  line rel 15:0
  line rel 0:15
  line rel -15:0
  close

path keyhole 16x16:
  move 8:1
  arc 8:9 around 8:5 cw
  line 6:14
  line 10:14
  close

path slot 16x16:
  move 6:5
  line 10:5
  line 10:14
  line 6:14
  close

path cutKeyhole = keyhole.union(slot)

# custom shapes are region-returning fns; paint any region directly
fn ring(c, r) = circle(c, r).subtract(circle(c, r - 2))

draw frame 16x16:
  pal:
    k = #1a1a1a
  stroke k framePath

draw badge 16x16:
  mask cutKeyhole.fill():
    bg #e0b070
    stamp crest 4:4

draw medal 16x16:
  fill #e0b070 cutKeyhole          # path filled with paint
  stroke k ring(8:8, 7) w2         # a fn-built shape, outlined
  mask m = crest.region.shift(4:4) # any drawing's silhouette, placed, as a mask
  mask m:
    bg k
```

---
## 9. Tilesets & atlases — bake sprites into one image

A uniform `tileset` (grid, index-addressed) and a packed `atlas` (varied sizes,
name-addressed), each exported with a sidecar for common engines. Layout is automatic and
deterministic; both are content, exported like any drawing.

```drw
from tiles grass, dirt, water, stone
from hud play, pause, stop, logo

tileset terrain 16x16:
  tiles grass, dirt, water, stone     # index 0..3; every member is exactly 16x16

atlas hud:
  sprites play, pause, stop, logo     # varied sizes, packed automatically
  pad 1

export terrain tiles/terrain:
  png            # the baked grid sheet
  tiled          # + terrain.tsj for the Tiled map editor

export hud atlas/hud:
  png            # the packed sheet
  atlasJson      # + hud.json  {frames:{play:{x,y,w,h}, …}}
  aseprite       # + hud.aseprite.json
```

---

## 10. Text & bitmap fonts

Labels, counters, badges — bitmap glyphs from globally registered std fonts ([ADR-0054](decisions/0054-std-fonts-are-recipe-modules.md)).

```drw
draw badge 16x16:
  pal:
    k = #1a1a1a
    r = #c04040
  circle r 8:8 7 fill
  text k 5:5 "9" font small      # numeral; default font is `small` (5x7), `micro` is 3x5
```

Custom faces: a **glyph is a drawing** — pixel it or draw it with paths — and a `font`
block maps characters to glyphs ([ADR-0042](decisions/0042-user-defined-fonts.md)).

```drw
draw runeA 5x7:            # pixeled glyph
  pixels:
    ..k..
    .k.k.
    k...k
    kkkkk
    k...k
    k...k
    k...k

draw runeO 5x7:            # path-drawn glyph — same tools as any drawing
  circle k 2:3 2

font runic 5x7:            # WxH = monospace assertion (optional)
  with small               # fall back to the std face for unmapped chars
  glyph "A" runeA
  glyph "O" runeO

draw seal 16x16:
  text k 2:4 "AO" font runic
```

---

## 11. Curves, rounded shapes & stroke width

Vector primitives plus `w<N>` for thick strokes. `arc`/`quad`/`bezier` use the bundled
deterministic trig so they stay pixel-identical ([ADR-0023](decisions/0023-curve-and-shape-primitives.md)).

```drw
draw tile 24x24:
  pal:
    k = #1a1a1a
    g = #3a8a3a
  rrect k 0:0 23:23 4 w2          # 2px rounded frame
  arc k 12:12 8 180 360 w2        # top half-ring
  ellipse g 12:17 7:3 fill        # squashed base
  poly k 8:8 16:12 8:16           # outline chevron
```

---

## 12. Parametric drawings — one definition, many variants

A `draw` with parameters is the component mechanism: author the silhouette once, instantiate
per colour/place. This is how a set stays consistent ([ADR-0024](decisions/0024-parametric-drawings.md)).

```drw
use themes dusk                # k, r resolve against the theme palette

draw chevron(c) 8x8:           # one arrow; colour is a parameter
  poly c 2:1 6:4 2:7

draw nav 24x8:
  stamp chevron(k) 0:0           # black chevron
  stamp chevron(r) 8:0           # red chevron
  stamp chevron(k) 16:0 flipx    # mirrored, reused
```

---

## 13. Alpha compositing & seeded noise

Alpha colours composite **source-over** ([ADR-0025](decisions/0025-alpha-compositing-model.md));
`rand`/`noise` give organic texture without breaking determinism — seeded only
([ADR-0026](decisions/0026-seeded-randomness-and-noise.md)).

```drw
draw glow 32x32:
  pal:
    n = #0b1030
  bg n
  circle #ffd08080 16:16 10 fill                  # 50%-alpha warm glow over the night bg
  for i 0..40:
    px #ffffffc0 (rand(7, i) * w):(rand(9, i) * h) # deterministic seeded starfield
```

---

See the spec's [Open questions](language-spec.md#18-open-questions-for-review) for syntax
points still up for decision.
