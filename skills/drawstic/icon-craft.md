# Drawstic icon craft

How to make an **app-icon family** (6+ siblings, multi-size, PNG+SVG) read as one coherent set, not six
unrelated glyphs. Icons are the one exception to the canonical path (SKILL.md): at 16–32px a flat plate
with a 1px bevel reads better than `model`/`cel` form shading, so drop that step entirely. Keep only two
things from the canonical path: one light *direction* (as geometry, not a shading pass) and "look at the
render." Copy [starters/icon-family.drw](starters/icon-family.drw) — a complete, `check`-clean,
`critique --as icon --strict`-passing 6-icon family with a shared tile, five glyphs and a hand-pixeled
16px redraw — and mutate it. `check` verifies grammar only; silhouette legibility and family consistency
are **100% visual** — a render, and the family `sheet`, are the only judges.

## 1. Family before glyphs — the build order

Build the shared frame first; draw glyphs onto it last:

1. **Theme** — palette + `size`/`mode` defaults + a `style """…"""` guide that doubles as the family's
   number contract: corner radius, margin, light direction, stroke weight per size. `context` surfaces
   this string — write the numbers down before the first `draw`, or consistency drifts unnoticed across
   6+ icons.
2. **One parametric tile**, stamped by every icon with the accent as its argument — radius, margin and
   the light contract then cannot diverge between siblings.
3. **Glyphs** — a bold, near-white silhouette, optically centered, stamped onto the tile.

```drw
theme system:
  palette:
    k = #20242c
    l = #f7faff
    b = #3b82f0                  # one accent hue per app
  size 32x32
  mode pixel
  style """Rounded-square tiles (radius 6, 2px margin). Light top-left …"""

use system
```

## 2. The tile — radius, margin, one light contract

`face = rrect(margin, size−1−margin, radius)`. **Radius ≈ 19–22% of the edge**, the same proportion at
every size (32→6, 16→3, 64→12); margin 1–2px.

**Default contract — an edge-band pair, no filter.** `REGION.edge(dx:dy[, n])` is a one-sided band in
the direction the light travels; give the tile a lit band and a shade band with the same geometry and
opposite colours:

<example>

```drw
draw plate(t) 32x32:
  face = rrect(2:2, 29:29, 6)
  fill t face
  fill l.alpha(34%) face.edge(1:1, 2)     # light travels 1:1 ⇒ the up-left contour is lit
  fill k.alpha(28%) face.edge(-1:-1, 2)   # …and the down-right contour takes the shade
```

</example>

This is `starters/icon-family.drw`'s actual tile — flat-friendly, the cheapest SVG output, and it holds
up at 16px where an areal shade veil is too weak to read at all. `n` widens the band while keeping
**uniform** coverage (one region, one fill — a translucent paint never stacks toward the outer row).

**Escape hatch — a vertical gradient** when a family wants more visual weight than two flat bands. It
stays SVG-cheap because it is *row-uniform* (a horizontal or 135° gradient is not — §8):

```drw
draw tile(c) 32x32:
  rrect linear(90, c.mix(l, 20%), c.darken(14%)) 2:2 29:29 6 fill
  line c.mix(l, 52%) 9:2 22:2          # 1px top highlight
```

Pick one contract for the whole family — never mix the two between siblings.

## 3. Glyph = white silhouette, disambiguated

The glyph is a bold near-white mass on the tile (detailed families: paper `l` + ink `k` + at most **one**
accent detail; secondary detail as `k.mix(l, 40%)` steps, never a new hue). A 1px drop shadow on the
`stamp` reads correctly here — a single-colour silhouette, not the composite-clump case a scene's
multi-part sprite would hit:

```drw
draw mail 32x32:
  stamp plate(b) 0:0
  stamp mailGlyph 6:9 shadow 0:1 k.alpha(35%)
```

**Run the mis-reading test with `--silhouette --png@6`** (the plate auto-detects and subtracts, leaving
just the glyph). Every glyph can collapse into a wrong reading at native size — mic→wine glass,
play→arrow, tag→gem. Name it, then add the one feature that kills it (mic cradle, note beam, camera lens
hole).

**Merge trap:** two abutting filled sub-forms of equal height/width fuse into one silhouette (a body +
wedge reads as an arrow). Make the appended sub-form visibly narrower, or split it off with one
background pixel — the part boundary must survive in the outline.

## 4. Optical centering on even canvases

An even canvas puts the visual centre on a half-pixel:

- `circle c r fill` covers `c−r … c+r−1` (2r px), visual centre `c−0.5`. `circle 16:16 10` on a 32px
  canvas gives bbox `{x:6, w:20}` — centre 15.5. Put circle/ellipse centres on `16`, not a guessed `15`
  ([language.md](language.md) §4 has the full rule; it applies identically to both axes of `ellipse`).
- A glyph is centred when its bbox satisfies `x0 + x1 = W−1` (=31 on 32px). Confirm with
  `render … --inspect --json`'s `alphaCoverageBBox` — don't eyeball it.
- A hand-built `poly`/`curvePoly` (a compass rose, dial ticks) gets none of `circle`'s automatic
  half-pixel handling — every vertex is a literal coordinate, so a shape authored around a guessed
  integer centre inherits its bias wholesale and sits half a pixel off whatever else shares the
  frame. Build every opposite point pair as a span that sums to `W−1` (not from one centre variable),
  then confirm with the same bbox check above.
- A `stamp … shadow 0:1` shifts visual mass ~0.3px down — set an already-centred glyph 1px **higher** to
  compensate (mandatory at 16px, taste at 32).
- An edge-centred notch/bump (subtract/union circle): keep `r` ≤ ~20% of the block edge, or it gouges a
  hemisphere and splits the silhouette into two prongs. Verify with `--png@4 --grid`.

## 5. Stroke weight & the 16px budget

- Bearing strokes ≥2px @32; a diagonal reads thinner than a straight line of the same width, so a
  diagonal ≥~16px long gets `w2`.
- **@16 the budget is brutal:** margin ≤1px (tiles go full-bleed), radius ~3, strokes still ≥2px.
  Decide what drops *before* writing coordinates — a one-line strike-list comment (feet, tick marks, a
  third ornament), then the points.
- `poly` takes no trailing `w<N>` and `arc`/`quad`/`bezier` rasterize blocky below ~12px — both traps
  and their fixes are in [language.md](language.md) §4.
- **Small filled circles square off.** `circle c 3 fill` covers a 6×6 box with only its four corner
  pixels clipped — verified via `--inspect --json`'s `occupancy`, it reads as a black square, not a
  dot. Below r≈4 don't lean on `circle` for a round accent — size it up, or hand-pixel the mark.

## 6. Multi-size = redraw, never scale

Each size is a fresh `draw` with its own explicit `WxH` header (a size-less draw silently inherits the
theme `size` — a real, expensive trap), its own proportioned tile, and re-thickened strokes.

- **Below ~12px glyph area:** hand-pixel the whole icon (tile + glyph together) as one `pixels:` grid
  using the theme's `palette` keys — identical corner cut-outs to its siblings, no stamp-order pitfalls.
  `starters/icon-family.drw`'s `mailSmall` is this pattern, verified.
- **64px is a detail redraw, not an enlargement:** add detail (fluting, glints, a modelled lens), keep
  the same contract (radius %, light direction, palette).

## 7. Family palette

One accent per app; derive every shade with `.mix`/`.lighten`/`.darken`/`.alpha` off that accent, so one
recolour flows through the family. **Hue-only oklch** gives instant coherence across many apps: fix `L`
and `C`, rotate hue only — `oklch(0.62, 0.15, h)` per app, one line each, guaranteed equal visual weight.
Theme `palette` keys are single letters — keep a one-line legend in the `style` guide.

## 8. SVG targets = flat tiles

Pixel-mode SVG merges *horizontal* runs into one `<rect>` — anything varying **along a scanline** (a
horizontal or 135° gradient, `model` form shade, `grain`) breaks the merge into roughly one `<rect>` per
pixel (measured 5–25× file-size growth on a 32px icon). Use the edge-band or vertical-gradient contract
(§2) for any family that exports SVG; reserve scanline-varying gradients for PNG-only targets. Counter-
check after `build`: `<rect>` count should stay far below pixel count.

## 9. Verification cadence

Beyond the loop in [verify.md](verify.md), an icon family adds:

0. **Gate:** `critique --as icon --strict --json` → must-fix `C003` (centering) is clean; then answer
   the rubric it prints (misread test + merge trap) by looking. The shared tile/plate is detected and
   subtracted before `C009` signs, so a finding there means two *glyphs* genuinely collapse
   ([verify.md](verify.md)) — differentiate them.
1. **`sheet file.drw --png@4`** first — the family contact sheet, every exported icon size-normalized
   and labeled in one grid. This is the cross-sibling judge for radius/stroke/grey-value/hue drift.
2. `render …#name --png@1` — the truth at native zoom; `--png@4` for form.
3. `render …#name --inspect --json` — `alphaCoverageBBox` is the centering proof (§4); equal
   `opaquePixelCount` across sibling tiles is a cheap consistency check.
4. SVG target → open one `.svg` (§8 counter-check).
5. Placement bug → `--png@4 --grid 8` locates it in one render.

## 10. Export pattern

Every icon: PNG `@1 @2` + `svg`, base path `<family>/<name>` — export paths are relative to the
recipe's own folder, so `<family>` is the recipe's own file stem (`productivity.drw` → exports
`productivity/mail`), never the recipe's *directory* name (that repeat is lint `W016`). `svg ids
classes` yields CSS-classed, `<title>`-tagged output:

```drw
export mail productivity/mail:
  png @1 @2
  svg ids classes
```
