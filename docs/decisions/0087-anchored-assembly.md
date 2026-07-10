# 87. Anchored assembly (`pin` / `fit`)

- Status: Accepted
- Date: 2026-07-10
- Deciders: t.koehn, Claude
- Refines: [ADR-0024](0024-parametric-drawings.md) (parts as parametric drawings), [ADR-0064](0064-stamp-anchors.md)/[ADR-0072](0072-visual-stamp-anchors.md) (stamp placement); supersedes [ADR-0028](0028-rasterization-semantics.md) §3 for `ellipse` (extends [ADR-0056](0056-even-diameter-circle-rasterization.md)'s convention to it)

## Context

Every part in a modular drawing (`stamp part pt`, [spec §9](../language-spec.md#9-composition-transforms--masks))
is positioned by an absolute literal point the author computed by hand. `stamp` guarantees
nothing about the *result* — bounding-box overlap is not pixel contact. The character
evaluation (`docs/character-dx-evaluation-2026-07-09.md`) found this the #1 build defect: 5 of
7 builds produced floating limbs or 1–3px seams, because a part's hand-computed offset was a
pixel or two short and nothing checked it. Terrain-following placement has the same shape —
`skills/drawstic/scene-craft.md §2` already documents "terrain is a function"
(`fn duneY(nx) = ...`), but nothing stops an author from placing an object at a literal `y`
that silently drifts from the terrain function, floating or sinking it.

A second, unrelated off-by-one lives in the same neighbourhood: `circle`
([ADR-0056](0056-even-diameter-circle-rasterization.md)) rasterizes to an even-diameter
`c-r..c+r-1` footprint centred at the pixel corner, while `ellipse`
([ADR-0028](0028-rasterization-semantics.md) §3) still rasterizes to the older odd
`c-r..c+r` footprint centred on the integer pixel. Two shape primitives that look
interchangeable use two different centering conventions — an author who reasons about one from
the other is off by one pixel on every axis.

## Decision

**1 — `pin NAME PT` declares a named attach point on a part, in that part's own local
coordinate space.** One point concept, not a socket/plug pair — a pin is just a labelled
point, and any pin can be either side of a join:

```drw
draw arm(color) 8x20:
  pixels: …
  pin shoulder 4:0
  pin hand     4:19
```

**2 — `fit partB.NAME partA.NAME` places `partB` so its named pin lands exactly on `partA`'s
already-placed pin.** It replaces hand-computed `stamp` coordinates and socket-offset
comments with a **contact-guaranteed** placement: the engine solves the translation, not the
author.

```drw
draw knight 32x48:
  stamp torso 12:10
  pin torso.shoulder 16:14      # torso's pin, now in canvas space
  fit armLeft.shoulder torso.shoulder
  fit handLeft.wrist armLeft.wrist
```

When each side has exactly one pin with the same name, the shorter `fit armLeft torso`
auto-matches it — the two-keyword surface (`pin` + `fit`) stays terse without a third
`socket`/`plug`/`attach` keyword (rejected on token cost, alongside `intensity`/`matte`/
`emissive` in [ADR-0086](0086-declarative-light-and-material.md)'s budget). A named pin that
does not exist on one side is a positioned error, not a silent no-op.

**3 — The ground-placement oracle is `fit` aimed at a terrain function, not a third
keyword.** `skills/drawstic/scene-craft.md §2`'s `fn duneY(nx) = …` idiom is formalized:
anything standing on terrain fits its base pin to the terrain function's result instead of a
hand literal `y`, making floating/sinking structurally impossible rather than a review item.
`fit` additionally drops a contact shadow at the resolved contact point automatically — the
same "structural, not disciplinary" principle behind [ADR-0086](0086-declarative-light-and-material.md):
the contact shadow can't drift from the actual contact pixel because it is derived from the
same solve.

**4 — `ellipse` adopts `circle`'s even-diameter, corner-centred convention.** `ellipseRegion`
(`src/values.ts`) moves from the odd `c-r..c+r` footprint centred on the integer pixel to the
even `c-rx..c+rx-1` × `c-ry..c+ry-1` footprint centred at `(c-0.5, c-0.5)`, mirroring
`circleRegion`'s existing rule exactly (`ellipse` becomes `circle` with independent `rx`/`ry`).
This supersedes the remaining `ellipse` carve-out in [ADR-0028](0028-rasterization-semantics.md)
§3 the same way [ADR-0056](0056-even-diameter-circle-rasterization.md) already superseded it
for `circle`; `r=0`/axis-degenerate handling carries over unchanged. One centering convention
for both shapes removes the "these two look the same but are off by one" trap.

## Consequences

- Part assembly gets a contact guarantee instead of a convention: a gap is now something the
  engine can measure and report (feeding [`critique`'s C007](0085-critique-command.md)), not
  something an author eyeballs.
- Two new keywords (`pin`, `fit`) at the measured 1-token budget from
  [ADR-0086](0086-declarative-light-and-material.md); `src/ast.ts`/`src/parser.ts` gain the pin
  declaration and the `fit` command; `src/eval.ts` gains pin-space bookkeeping (a part's local
  pins, transformed into canvas space on `stamp`/`fit`, available to later `fit` calls).
- `ellipse` renders one pixel smaller on its bottom/right edge than before wherever `rx`/`ry`
  are unequal from `circle`'s prior change — the same, already-accepted trade [ADR-0056](0056-even-diameter-circle-rasterization.md)
  made for `circle`. Region algebra inherits the new footprint automatically since drawing
  suffixes are sugar over `fill`/`stroke` eliminators ([ADR-0036](0036-shapes-as-region-constructors.md)).
- Touches [spec §9](../language-spec.md#9-composition-transforms--masks) (pin declaration +
  `fit` placement, superseding hand-stamped socket-offset idioms),
  [spec §28's `ellipse` rule](0028-rasterization-semantics.md), `src/values.ts`
  (`ellipseRegion`), `src/eval.ts`, `src/ast.ts`, `src/parser.ts`, `skills/drawstic/scene-craft.md`
  §2 (ground oracle) and `character-craft.md` (attach idiom), and the product skill
  (`skills/drawstic/SKILL.md` + `reference.md`).

**Amendment (2026-07-10, character-DX rerun).** The auto contact-shadow (decision 3) anchors at the
fitted part's **footprint bottom (the feet)**, not the resolved fit pin. For a ground-oracle fit the
two coincide (the base pin sits at the feet), but for a joint-to-joint fit (`leg.hip → torso.hip`)
the fit pin is at the hip — the old pin-anchored pool dropped the shadow at the hip. Anchoring at the
footprint bottom keeps the pool under the feet regardless of which pin the fit used (finding §5.6).
