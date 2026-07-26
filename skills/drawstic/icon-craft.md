# Drawstic icon craft

How to make an **app-icon family** (6+ siblings, multi-size, PNG+SVG) read as one coherent,
production set — not six unrelated glyphs. SKILL.md § Icons gives the mandatory order + checklist;
this is the detail. Every rule here comes from a shipped, check-clean recipe
(`examples/icons/*.drw`) or a rendered probe. `check` verifies grammar only — silhouette legibility
and family consistency are **100 % visual and silent to `check`**; a render, and the contact
`sheet`, are the only judges.

Icons are **not scenes.** Drop the scene-craft warm/cool sun contract, haze veils and terrain
functions. Keep only two things: one light direction, and "look at the render."

## 1. Family before glyphs — the fixed build order

Build the shared frame first; draw glyphs onto it last. The order that wins on the first attempt:

1. **Theme** — palette + `size`/`mode` defaults + a `style """…"""` guide that doubles as the
   *family number contract*: corner radius, stroke weight, margin, light direction, shadow-alpha
   **per size**. `context` surfaces this string, so write the numbers down *before* the first
   `draw` — over 6+ icons consistency drifts unnoticed otherwise. A theme carries no non-colour
   constants (radius/margin are literals in each tile), so the style guide is where they live.
2. **Parametric tile/plate component**, one per canvas size, accent as the argument, stamped by
   every icon → radius, margin and light model **cannot diverge**.
3. **Glyphs** — bold white (or paper+ink) silhouettes, optically centered, stamped onto the tile.

```drw
theme system:
  pal:
    k = #20242c
    l = #f7faff
    b = #3b82f0                  # one accent hue per app
  size 32x32
  mode pixel
  style """Rounded-square tiles (radius 6, 2px margin). Light top-left …"""

use system
```

(Weather was the only family that skipped the stamped tile — per-icon masks instead — and it cost
the most iterations. Build the tile.)

## 2. The tile/plate — radius, and ONE light contract

`face = rrect(margin, size−1−margin, radius)` → fill → edge light. **Radius ≈ 19–22 % of the
edge**, identical proportion at every size (32→6, 16→3, 64→12); margin 1–2px.

One light direction for the whole family: **light top-left, dark bottom-right.** Icon *mechanics*
carry it — geometry, a rim pair, discrete zones — **not** scene filters: at 16–32px
`shadeRegion`/`lightRegion` are too weak and areal, and `rim` is a thin band. Three verified
contracts; pick one per family:

- **Vertical gradient + 1px rim/highlight** (productivity, system) — row-uniform, cheap SVG:
  ```drw
  draw tile(c) 32x32:
    rrect linear(90, c.mix(l, 20%), c.darken(14%)) 2:2 29:29 6 fill
    line c.mix(l, 52%) 9:2 22:2          # 1px top highlight
  ```
- **1px bevel lines** (communication) — flattest, best SVG, production-clean:
  ```drw
  rrect t 1:1 30:30 6 fill
  line l 7:1 24:1                         # light: top + left edges
  line l 1:7 1:24
  line d 7:30 24:30                       # shadow: bottom + right edges
  line d 30:7 30:24
  ```
- **Two fills + one line** (weather) — flat-friendly, works where filters are too weak:
  ```drw
  fill base face
  fill shade face.intersect(rect(2:16, 29:29))   # darker lower half
  line light 4:4 12:4                             # short top-left highlight
  ```

A 135° `linear` gradient (media) also reads well but varies along scanlines → heavy SVG (§8).
`rim` on a **filled** silhouette strokes the whole contour — on a `rrect` region it hits the edge,
which is what you want here.

## 3. Glyph = white silhouette, disambiguated

The glyph is a bold near-white mass on the tile (detailed families: paper `p` + ink `k` + at most
**one** accent detail; secondary detail as `k.mix(p, 40%)` steps, never new hues). Give it a 1px
drop shadow *with the stamp* — correct on a single-colour silhouette, not the scene "composite
clump" case:

```drw
draw mail:
  stamp plate(b) 0:0
  stamp mailGlyph 6:9 shadow 0:1 k.alpha(35%)
```

**Silhouette-first: run the mis-reading test before rendering.** Every glyph can collapse into a
wrong reading at native size — mic→wine glass, play→arrow, tag→gem, videocall→arrow. Name the wrong
reading, then add the ONE feature that kills it (mic cradle, note beam, camera lens hole).

**Merge-trap:** two abutting filled sub-forms of equal height/width fuse into a single silhouette
(videocall body + wedge → "arrow"). Make the appended sub-form visibly narrower (a notch) or split
it off with one background pixel — the part boundary must survive in the outline. On an asymmetric
master, keep one asymmetric anchor (tip, hole) alive in the 16px reduction, or it reads generic.

## 4. Optical centering on even canvases (probe-verified)

An even canvas puts the visual centre on a **half-pixel**. Verified on 32px:

- `circle c r fill` covers **`c−r … c+r−1`** (2r px), visual centre **`c−0.5`**. `circle 16:16 10`
  → bbox `{x:6, w:20}` = cols 6..25, centre 15.5. Put circle centres on `16`, not on a guessed 15.
  **`ellipse c rx:ry` follows the identical rule per axis** (`c−rx … c+rx−1` × `c−ry … c+ry−1`) — a
  circle is just the `rx==ry` ellipse, so the same centring math applies to both (one convention, no off-by-one trap).
- A glyph is centred when its bbox satisfies **`x0 + x1 = W−1`** (=31 on 32px) — equal left/right
  margin. Confirm with `--inspect` `alphaCoverageBBox`; don't eyeball it.
- A `stamp … shadow 0:1` shifts visual mass ~0.3px down → set an already-centred glyph 1px
  **higher** (mandatory at 16px, taste at 32).
- **Edge-centred subtract/union circles (notch/bump): r ≤ ~20 % of the block edge.** Probe on a
  16px-wide body: r3 (19 %) = a shallow notch; r6 (40 %) gouges a hemisphere and splits the
  silhouette into two prongs. Always verify with `--png@4 --grid`.

## 5. Stroke weight & the 16px legibility budget

- Bearing strokes **≥2px @32**; a 1px diagonal reads thinner than a 1px straight, so **diagonals
  ≥~16px long get `w2`** (envelope flap, clock hand). Horizontals/verticals 1–2px by weight.
- **@16 the budget is brutal:** margin ≤1px (tiles go full-bleed), radius ~3, strokes still ≥2px.
  **Decide what drops before writing coordinates** — a strike-list comment first (feet, tick marks,
  a third ornament), then the points. (Weather's 16px icons landed first try behind a strike-list;
  its 32px masters without one cost 2–4 iterations each.)
- `poly` takes no trailing `w<N>`; stroke a Region for a wide outline. `arc`/`quad`/`bezier` below
  ~12px rasterize blocky — hand-pixel instead. (Both SKILL.md § Gotchas.)

## 6. Multi-size = redraw, never scale

Never scale a master. Each size is a fresh `draw` with its own explicit `WxH` header — a size-less
draw **silently inherits the theme `size`** (a real, expensive trap) — its own proportioned tile,
and re-thickened strokes.

- **Paradigm threshold ~12px glyph area:** below it, hand-pixel the whole icon (tile + glyph
  together) as **one `pixels:` grid** using theme `pal` keys — identical corner cut-outs to its
  siblings, no stamp-order pitfalls. Above it, primitives.
- **64px is a detail redraw, not an enlargement:** add detail (fluting, glints, vents, a modelled
  lens), keep the *same* contract (radius %, light direction, palette).

## 7. Family palette

- One accent per app; derive every shade with `.mix/.lighten/.darken/.alpha` chains off that accent
  so a single recolour flows through the family.
- **Hue-only oklch** = instant coherence: fix L and C, rotate hue only — `oklch(0.62, 0.15, h)` per
  app (media). Six apps, one line each, guaranteed equal visual weight.
- `grad` stops **intra-hue** (`x.lighten` ↔ `x.darken` of one base); cross-hue interpolates the
  short OkLCh arc through magenta/grey (SKILL.md § Gotchas).
- Theme `pal` keys are single letters — keep a one-line legend in the `style` guide. Never
  `w`/`h`/`shadow`/`rim`/`tint`/`grain`/… as keys or bindings (SKILL.md § Gotchas covers the
  reserved-name and theme-scope traps).

## 8. SVG targets = flat tiles

Pixel-mode SVG merges *horizontal* runs, so anything varying **along a scanline** — a horizontal or
135° gradient, a `shadeRegion`/`lightRegion` veil, `grain` — breaks the merge into ~1 `<rect>`/pixel
(5–25×; measured 3.7 → 50.8 KB for one 32px icon). For SVG-export families use the **flat-tile or
1px-bevel contract (§2)** or 2–3 discrete `pal` zones; reserve gradient/veil tiles for PNG-only. The
row-uniform vertical gradient (§2, first option) is the exception — it stays compact. Full detail:
SKILL.md § Gotchas. **Counter-check `<rect>` count ≪ pixel count after `build`.**

## 9. Verification cadence

`check` catches almost nothing on icons — quality is 100 % visual. After each edit batch:

0. **Gate:** `critique --as icon --strict --json` → `pass:true` (must-fix C003 centering under
   `--strict`), then **answer the rubric** it prints (misread test + merge trap) by looking.
1. `check --json` = `[]` (+ `--rows` for `pixels:` grids, `--lint` to catch W002 orphan draws).
2. **`sheet file.drw --png@4`** — the family contact sheet: every `export`ed draw size-normalized
   and labeled in one grid. This is the cross-sibling consistency judge (radius / stroke /
   grey-value / hue balance) the language previously lacked. **Look here first.**
3. Single **`--png@4`** for the form of one icon; **`--png@1` for the truth** — every icon must read
   at 100 % zoom on its native size.
4. **`--inspect --json`** — `alphaCoverageBBox` as the centering proof (§4); equal
   `opaquePixelCount` across sibling tiles is a cheap consistency check.
5. SVG target → open one `.svg` (§8 counter-check).
6. Placement bug → `--png@4 --grid 8` locates it in one render.

## 10. Export pattern

Every icon: PNG `@1 @2` + `svg`, base path `<family>/<name>`. `svg ids classes` yields CSS-classed,
`<title>`-tagged output (communication):

```drw
export mail productivity/mail:
  png @1 @2
  svg ids classes
```
