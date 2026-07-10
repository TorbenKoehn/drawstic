# Drawstic item craft

How to build a **32x32 game-item set** (weapons, shields, armor parts, potions, loot) that reads as
one production family on the **first attempt with few iterations**. SKILL.md § Items gives the
mandatory order + checklist; this is the detail. Every rule here comes from shipped, check-clean
recipes in `examples/items/*.drw`. `check` verifies grammar only — **set drift, weak silhouette
splits, and mushy materials are 100 % visual and silent to `check`; the render, the `sheet`, the
native `@1`, and the built sidecars are the only judges.**

Items are **not scenes and not app-icon tiles.** Keep from scene/icon craft only: **one** light
direction, small-raster discipline, and "look at the contact sheet." Drop scene filters as the
primary modelling tool. Inventory items win with **silhouette first, material second**.

## 1. The fixed build order

The order that wins on the first attempt — do not reorder:

1. **Theme + set contract** — palette, `size 32x32`, `mode pixel`, and a `style """..."""` guide that
   records the family numbers: breathing margin, shared axis/pose, outline weight, light direction,
   and material legend.
2. **Hardest confusion pair first** — the pair most likely to collapse at `@1` (`shortbow/longbow`,
   `arrowBundle/bolts`, `pickaxe/axe`, `heraldShield/towerShield`, `healing/mana`).
3. **Shared body shells / axes** — one bottle shell, one shield mass, one shaft angle, one armor
   language, one sword diagonal. Build the family scaffold before the individual item quirks.
4. **Silhouette pass** — the dark outline + filled mass that already reads with colour removed.
5. **Material pass** — metal/wood/leather/cloth/glass/magic/gold/gem accents only after the shape is
   solved.
6. **Production exports** — per-item PNGs, then the set `tileset` + sidecars (`tiled`,
   `atlasJson`), then verification.

## 2. Theme = the family contract, not decoration

Every shipped set starts with the same core contract: transparent `32x32`, one light direction,
2–4 px breathing room, and a shared stance:

- **Long props** (swords, staves, tools, bows): lower-left → upper-right.
- **Front items** (shields, bottles, armor): vertically centered, slightly bottom-weighted.
- **No background plate.** These are inventory sprites, not app icons.
- **One dark outline language** across the whole set (`w1`–`w2`, or thick dark strokes on long tools).

Copy-paste start:

```drw
theme itemSet:
  pal:
    k = #241a20
    m = #95a1b4
    h = #eef4fb
    w = #8b5a31
    g = #c89b32
    c = #7d76ff
  size 32x32
  mode pixel
  style """
  32x32 transparent inventory sprites. Light top-left, dark bottom-right.
  2-4 px breathing room. Long items lean lower-left -> upper-right.
  Metal = dark spine + mid fill + 1-2 px glints; wood/leather stay warm and sparse.
  """

use itemSet
```

The `style` guide is the **set memory**. `context` surfaces it; write the numbers down before the
first `draw` or the family drifts over six siblings.

## 3. Solve the confusion pair before the full set

The biggest quality lever in every item run: **separate the worst pair first**.

- `shortbow` vs. `longbow` — length + curvature first; grip wraps later.
- `arrowBundle` vs. `bolts` — arrowheads/fletching spread first; tie wraps later.
- `pickaxe` vs. `axe` — head silhouette first; shaft can stay shared.
- `heraldShield` vs. `towerShield` — outer mass first; crest details later.
- `healingPotion` vs. `manaPotion` — bottle stays shared; front sign carries the role.

Rule: **name the wrong reading, then add the one feature that kills it.** If two siblings look
"good enough" in isolation, put them next to each other on the first `sheet`.

## 4. Shared scaffolds beat bespoke items

The stable item families reuse one scaffold and vary only the decisive part:

- **Swords / staffs / tools:** shared shaft or blade axis, then head/guard/tip variations.
- **Shields:** one body mass + edge/face split, then emblem or material changes.
- **Armor parts:** shared steel/cloth language; small parts (`gloves`, `boots`) can be stamped from a
  parametric mini-part.
- **Potions:** one bottle shell, one neck, one tag box; liquid + sign define the subtype.

Copy-paste scaffolds:

```drw
fn bottleBody() = rrect(7:8, 24:29, 8)
fn bottleNeck() = rrect(12:2, 20:10, 2)
fn bottleShell() = bottleBody().union(bottleNeck())
fn tagBox() = rrect(10:17, 20:24, 2)
```

```drw
draw gauntlet(t) 12x15:
  pal:
    i = #1f2530
    l = t
    g = t.lighten(18%)
  body = poly(3:5, 8:4, 11:7, 11:12, 9:14, 4:14, 2:11, 2:7)
  fill l body
  stroke i body w1
```

If the family can share a scaffold, do it. Geometry consistency is stronger than taste.

## 5. Silhouette pass — black-first, ornament later

Before the material pass, the item must read in a black-out:

- **Give every sprite a dominant mass.** One bow arc, one shield hull, one bottle body, one coin bag
  body.
- **Keep 2–4 px breathing room.** The `twoHander` run proved that using the full tile too tightly
  is readable but fragile.
- **Prefer filled polygons / parallel lines on thin weapons.** Small blades read better as filled
  metal masses than as `stroke` on a very thin region.
- **Reserve 1–2 hard role marks** for `@1` — a pommel, a buckler boss, a fuse, a label, a gem point,
  a crossguard.

Fast test: `render file.drw#weakPairName --silhouette --png@4`. If the pair still collides in black,
materials will not rescue it.

## 6. Material contracts — sparse, numeric, repeatable

Material quality in the shipped sets comes from **few explicit marks**, not filters.

### Metal — swords, shields, armor, tool heads

- **3–5 tones max:** dark outline/spine, mid fill, light edge, 1–2 bright glints.
- **Light is top-left:** bright pixels live on the lit edge/cap; the far edge carries the dark strip.
- **Glints are tiny:** 1–2 px for small items, 2–3 px cluster on larger shield/helmet masses.
- **Thin blades:** one dark edge + one light edge + mid core; do not outline both sides equally or
  the blade becomes a club.

Copy-paste blade/head idiom:

```drw
poly k 10:23 25:5 28:8 13:26 fill
poly m 11:22 25:7 27:8 13:25 fill
poly h 12:21 25:7 26:8 13:24 fill
line #ffffff 13:20 25:7
```

### Wood — shafts, planks, hafts

- **3 tones:** body, lit edge, dark trailing edge.
- **2–4 grain/wrap marks total.** Staves and wood shields read better with a handful of knots/lines
  than with `grain`.
- **One shared shaft logic** across similar items beats per-item novelty.

Copy-paste:

```drw
line wood 9:25 22:7 w3
line wood.mix(#ffe8bf, 18%) 8:24 21:6
line wood.darken(24%) 10:26 23:8
```

### Leather / cloth — wraps, straps, quivers, cloaks

- **Leather:** compact 2–4 px bands, one highlight line, one dark fold.
- **Cloth:** one lit plane, one dark plane, a few broad fold lines; no micro-noise.
- **Keep warm materials warm in shadow** — darken first, then at most a small cool mix.

### Glass / liquid — bottles, vials

- **Shared shell first.**
- **Glass shell:** ~30–36 % body alpha, ~20–24 % left highlight strip, ~14–22 % right dark strip.
- **Liquid band:** ~84–90 % alpha with one darker meniscus band.
- **Every bottle gets one front sign** (cross, diamond, skull, star, fuse, X) so `@1` survives.

Copy-paste:

```drw
fill glass.alpha(36%) shell
fill #ffffff.alpha(24%) shell.intersect(rect(0:0, 13:31))
fill glassDark.alpha(18%) shell.intersect(rect(17:0, 31:31))
fill liquid.alpha(86%) poly(9:16, 21:15, 22:28, 9:28)
stroke k shell w1
```

### Magic / gold / gem — accents, not fog

- **Magic:** tight alpha-only halo behind the focus, usually **2–3 circles** around 8–20 % alpha.
- **Gold:** warm base + dark edge + 1–2 bright specs, not a flat yellow blob.
- **Gem:** faceted nested polys or one bright center line/px; keep the highlight internal.
- **Do not flood the tile.** The magic sword, staff gems, amulet, and barrier all stay compact.

Copy-paste halo:

```drw
circle arcane.alpha(8%) 24:7 7 fill
circle arcane.alpha(14%) 24:7 5 fill
circle arcane.alpha(20%) 24:7 3 fill
```

## 7. Export pattern — ship the family, not just the singles

The verified default for item sets:

```drw
tileset set 32x32:
  tiles itemA, itemB, itemC, itemD, itemE, itemF
  cols 3

export itemA items/item-a:
  png @1 @4

export set items/set:
  png @1 @4
  tiled
  atlasJson
```

When the named atlas must be separate or padded, use the second verified variant:

```drw
atlas setAtlas:
  sprites itemA, itemB, itemC, itemD, itemE, itemF
  pad 1

export setAtlas items/set-atlas:
  png @1 @4
  atlasJson
```

Use `tiled` for editor grids, `atlasJson` for runtime names, and singles for quick spot checks. Do
not stop at standalone PNGs if the deliverable is a set.

## 8. Verification cadence

`check` catches almost nothing here — item quality is visual. After each edit batch:

0. **Gate:** `critique --as item --json` → `pass:true` (C009 flags a sibling reading like another —
   differentiate, or confirm it's a deliberate recolor/shared-shell), then **answer its
   pair-confusion rubric** by looking.
1. `check --json` = `[]`; `fmt --check --json` clean.
2. **`sheet file.drw --png@4`** — first judge for family drift, pair confusion, grey-value balance.
3. **`render file.drw#name --png@1`** — the truth for every item. Inventory sprites must read at
   native size.
4. **`render file.drw#weakestPair --silhouette --png@4`** — confirms the silhouette split before you
   argue about materials.
5. `build file.drw --out dir --json` — then open the sidecars:
   - `.tsj`: `tilewidth`, `tileheight`, `tilecount`, `columns`
   - atlas `.json`: stable frame names, bounds, untrimmed sizes
6. A placement bug or edge collision → `--png@4 --grid 8`.

The cheapest item runs used this order exactly: contract → worst pair → sheet → native `@1` →
sidecars.
