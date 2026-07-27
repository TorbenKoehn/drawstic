# Drawstic item craft

How to build a **32×32 game-item set** (weapons, shields, armor parts, potions, loot) that reads as one
production family, not six unrelated sprites. The canonical path (SKILL.md) applies unchanged; an item
set adds **family-first ordering** (contract → hardest confusion pair → shared scaffold → the rest) and
**silhouette-before-material** discipline. Copy [starters/item-set.drw](starters/item-set.drw) — a
complete, `check`-clean, `critique --as item --strict`-passing 6-item set with a shared shaft scaffold,
both `atlas` modes, and both sidecars — and mutate it. `check` verifies grammar only — set drift, weak
silhouette splits, and mushy materials are **100% visual**; the render, the `sheet`, the native `@1`, and
the built sidecars are the only judges.

## 1. The build order

1. **Theme + set contract** — palette, `size 32x32`, `mode pixel`, and a `style """…"""` guide recording
   the family numbers: breathing margin, shared axis/pose, outline weight, light direction, material
   legend.
2. **The one light** for the set (a module-scope `light` binding, or a theme default — resolution order
   in [language.md](language.md) §6).
3. **Hardest confusion pair first** — the pair most likely to collapse at `@1` (`shortbow`/`longbow`,
   `pickaxe`/`axe`, `healingPotion`/`manaPotion`).
4. **Shared body shells / axes** — one bottle shell, one shield mass, one shaft angle, before the
   individual item quirks.
5. **Silhouette pass** — the dark mass that already reads with colour removed.
6. **Material pass** — metal/wood/leather/cloth/glass/magic/gold accents only after the shape is solved.
7. **Production exports** — per-item PNGs, then the set `atlas` + sidecars (§7), then verification.

## 2. Theme = the family contract, not decoration

Every set starts with the same core contract: transparent `32x32`, one light direction, 2–4px breathing
room, a shared stance — long props (swords, staves, bows) lean lower-left → upper-right; front items
(shields, bottles, armor) sit vertically centered, slightly bottom-weighted; no background plate (these
are inventory sprites, not app-icon tiles).

```drw
theme smithKit:
  palette:
    k = #221a1e          # the one outline ink for the whole set
  size 32x32
  mode pixel
  style """
  32x32 transparent inventory sprites, 2-4 px breathing room, no background plate.
  Light travels down-right (1:1) => every lit edge is up-left, every shade down-right.
  Long props stand upright on the 15.5 centre line; front items are vertically centred.
  Materials: steel/gold = metal, wood = cloth (there is no `wood` response), brew = glass.
  Raise contrast with a material `spread N%`, never with a tone patch.
  """

use smithKit

light sun = dir 1:1 #ffe6b0 amb #2a3a5e 16%   # the set's one light; no theme light needed alongside it
```

The `style` guide is the set's memory — `context` surfaces it. Write the numbers down before the first
`draw`, or the family drifts over six siblings.

## 3. Solve the confusion pair before the full set

The biggest quality lever in an item run: **separate the worst pair first.**

- `shortbow` vs. `longbow` — length + curvature first; grip wraps later.
- `pickaxe` vs. `axe` — head silhouette first; the shaft can stay shared.
- `heraldShield` vs. `towerShield` — outer mass first; crest details later.
- `healingPotion` vs. `manaPotion` — bottle shell stays shared; the front sign carries the role.

**Name the wrong reading, then add the one feature that kills it.** If two siblings look "good enough"
in isolation, put them next to each other on the first `sheet` before trusting that.

## 4. Shared scaffolds beat bespoke items

The stable families reuse one scaffold and vary only the decisive part — swords/staves/tools share a
shaft or blade axis; shields share a body mass with an edge/face split; potions share one bottle shell,
one neck, one tag box.

```drw
fn haft(cx, y0, y1) = rrect((cx - 2):y0, (cx + 1):y1, 1)   # one 4px shaft, centred on the 15.5 axis
```

`starters/item-set.drw` uses this exact `haft` for both the sword's grip and the axe's handle — one
scaffold, two items, no geometry drift between them.

## 5. Silhouette pass — black-first, ornament later

Before the material pass, an item must read in a black-out:

- **Give every sprite a dominant mass** — one bow arc, one shield hull, one bottle body.
- **Keep 2–4px breathing room.** Using the full tile too tightly is readable but fragile across edits.
- **Prefer filled polygons over `stroke` on thin weapons** — a small blade reads better as a filled
  metal mass than as a stroked outline on a narrow region ([language.md](language.md) §4: `stroke` on a
  short-axis region paints the whole thing, not a border).
- **Reserve 1–2 hard role marks for `@1`** — a pommel, a buckler boss, a fuse, a gem point.

Fast test: `render file.drw#weakPairName --silhouette --png@4`. If the pair still collides in black,
materials will not rescue it.

## 6. Material contracts — sparse, numeric, repeatable

Item material quality comes from **few explicit marks**, not filters:

- **Metal** (swords, shields, tool heads): 3–5 tones max — dark outline/spine, mid fill, light edge,
  1–2 bright glints on the lit edge. A thin blade gets one dark edge + one light edge + a mid core —
  outlining both sides equally turns it into a club.
- **Wood** (shafts, hafts): 3 tones — body, lit edge, dark trailing edge; 2–4 grain/knot marks total,
  a handful reads better than `grain`'s procedural texture at this scale.
- **Leather/cloth** (wraps, straps, cloaks): compact 2–4px bands, one highlight line, one dark fold;
  keep warm materials warm in shadow — darken first, then at most a small cool mix.
- **Glass/liquid** (bottles, vials): paint order is part of the contract — shell first (~30–36% body
  alpha), then the liquid fill (~84–90% alpha, one darker meniscus line), then the front-wall veils
  and specular **last**: ~20–24% left highlight strip, ~14–22% right dark strip. Liquid painted over
  those veils buries them and the bottle reads as a tinted blob instead of glass. Every bottle gets
  one front sign (cross, diamond, skull, star) so it survives `@1`.
- **Magic/gold/gem accents, not fog:** a magic halo is 2–3 alpha-only circles around 8–20% alpha behind
  the focus — never flood the tile; gold is a warm base + dark edge + 1–2 bright specs, not a flat
  yellow blob.

`starters/item-set.drw`'s `sword`/`axe`/`shield`/`potion`/`key`/`ring` draws are a verified instance of
every contract above — copy the one matching your item, not a blank silhouette.

## 7. Export pattern — one atlas serves both consumers

`tile WxH` on an `atlas` bakes a uniform grid; **the same baked sheet carries both the `tiled` editor
sidecar and the `atlasJson` runtime map** — export both from one atlas definition, one export block:

<example>

```drw
atlas kitGrid:
  sprites sword, axe, shield, potion, key, ring
  tile 32x32
  cols 3
  pad 1                      # optional grid gutter — also the `tiled` sidecar's spacing

export sword kit/sword:
  png @1 @4

# … one export block per item …

export kitGrid kit/kit-grid:
  png @1 @4
  tiled
  atlasJson
```

```
$ drawstic build items.drw --json
{ "diagnostics": [], "artifacts": [
  { "path": "…/kit/sword.png", "bytes": 613 }, { "path": "…/kit/sword@4x.png", "bytes": 998 }, … ,
  { "path": "…/kit/kit-grid.png", "bytes": 2975 }, { "path": "…/kit/kit-grid@4x.png", "bytes": 5693 },
  { "path": "…/kit/kit-grid.tsj", "bytes": 226 }, { "path": "…/kit/kit-grid.json", "bytes": 1668 } ] }
```

</example>

Use this by default. The **escape hatch** — an `atlas` *without* `tile` — shelf-packs each member to its
own bounds instead of a uniform grid; reach for it only when the set mixes sharply unequal sizes (a
greatsword next to a ring) and nothing consumes the `tiled` sidecar, since `tiled` needs `tile WxH` and
hard-errors (`E018`) without it.

Members are addressed **by name** (`kitGrid.sword`); the numeric index form does not exist. Export paths are
relative to the recipe's own folder — `build` writes next to the recipe, so bare names like the ones
above are correct as-is; never repeat the recipe's own directory name as a leading prefix (lint `W016`).

## 8. Verification cadence

Beyond the loop in [verify.md](verify.md), an item set adds:

0. **Gate:** `critique --as item --strict --json` → exit 0 (`C009` flags a sibling reading like
   another — differentiate it, or, for a deliberate recolor/shared-shell, confirm the pair and reason in
   your final message), then answer its `pair-confusion` rubric item by looking.
1. **`sheet file.drw --png@4`** first — the family-drift and pair-confusion judge.
2. `render …#name --png@1` — the truth for every item; inventory sprites must read at native size.
3. `render …#weakestPair --silhouette --png@4` — confirms the silhouette split before arguing materials.
4. `build file.drw --out dir --json` — then open the sidecars: the `.tsj`'s `tilewidth`/`tileheight`/
   `tilecount`/`columns`, the atlas `.json`'s frame names and bounds.
5. A placement bug or edge collision → `--png@4 --grid 8`.

The cheapest item runs follow this order exactly: contract → worst pair → sheet → native `@1` →
sidecars.
