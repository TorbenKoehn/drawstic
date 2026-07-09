# 75. `curvePoly` — closed through-points curve & organic-mass region

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Resolves: `TODO-IMP.md` §5.2 (Scene-DX evaluation, organic-mass gap)
- Pairs with: [ADR-0074](0074-curve-through-points-spline.md) (open counterpart)

## Context

`curve` ([ADR-0074](0074-curve-through-points-spline.md)) draws an *open* through-points spline, but a
huge share of scene content is a **closed organic mass**: clouds, foliage clumps, rocks, islands,
puddles, hills-as-fills. `quad`/`bezier` cannot fill — they are stroke-only — so authors approximated
every soft blob by **ellipse-stacking** (the cloud motif is literally "overlapping ellipse puffs,
never one ellipse") or a many-vertex `poly` that reads as a faceted gem, not a soft mass
([evaluation](../scene-dx-evaluation-2026-07-08.md), prioritized action #2). What is missing is a *closed*
through-points curve that can be **filled** — and, since shapes are region constructors
([ADR-0036](0036-shapes-as-region-constructors.md)), that can also serve as a Region for masks and
set-ops.

## Decision

**1 — `curvePoly <paint> <pt1> <pt2> <pt3> … [fill] [w<N>]` is a closed Catmull-Rom loop through the
given points.** Paint-first, variadic points, then the standard `[fill] [w<N>]` region-eliminator
sugar shared with `rect`/`circle`/`ellipse`/`poly` ([ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md),
[ADR-0066](0066-paint-first-painting-commands.md)): `fill` → a solid organic mass, no flag → the
region's inner-boundary stroke (`w<N>` = band width).

```drw
curvePoly cloud 6:8 14:4 24:6 30:10 22:13 10:12 fill   # a soft cloud mass, one call
curvePoly rock 4:14 10:6 20:8 24:15                    # stroke-only outline
```

**2 — The paintless call form is a Region**, exactly like every other shape callee
([ADR-0036](0036-shapes-as-region-constructors.md)): `curvePoly(p1, p2, …)` in expression position
yields the filled coverage, for masks, `fill`/`stroke`, and `.union/.intersect/.subtract/.xor`. A
paintless `curvePoly` *statement* is the same "region value dropped" E013 as a paintless `circle`.

```drw
mask blob = curvePoly(4:12, 12:3, 20:12, 12:21)        # closed curve as a reusable Region
```

**3 — The loop wraps cyclically** (each control point's neighbours are its ring predecessor and
successor), so the seam between the last and first point is as smooth as every other point — no
open gap, no special-cased join. Parameterization, knot spacing, and the per-span
`clamp(ceil(chord), 4, 64)` tessellation are **identical to `curve`** (centripetal α = ½, `sqrt`-only,
[ADR-0074](0074-curve-through-points-spline.md) §2/§4), hence deterministic and platform-identical
([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)).

**4 — Fill uses even-odd coverage, and stroke and fill share one tessellation.** The closed polyline
is quantized to the pixel grid and passed to the same `poly`/path region builder — **even-odd**
scanline fill plus an inclusive boundary ([ADR-0028](0028-rasterization-semantics.md), the pinned
poly/path rule). Both `fill` and the stroke-only form are eliminators over that *one* region (fill =
its interior, stroke = its 4-erosion inner boundary), so they align exactly by construction.

**5 — Minimum three points.** Two points cannot bound an area.

**6 — Pure addition, no pragma gate** ([ADR-0074](0074-curve-through-points-spline.md) §6): a new
callee, no existing render changes, available in every language version (`lang` stays **2**).

## Consequences

- Clouds, foliage, rocks, and islands become **one filled organic mass** instead of an ellipse stack
  or a faceted `poly` — the motif cookbook's cloud is rewritten to a single `curvePoly … fill` over a
  shadow-offset `curvePoly`.
- The paintless form gives organic **masks** for free (`mask blob = curvePoly(…)`), so lighting/texture
  helpers (`shadeRegion`, `grain`, …) apply to soft shapes without a component-draw detour.
- Below ~12px the loop rounds to the grid and reads faceted, same caveat as `curve`/`bezier`.
- Touches [spec §8](../language-spec.md#8-drawing-primitives) (primitive table + region-constructor
  note), [§9](../language-spec.md#9-composition-transforms--masks) (masks list),
  [§17](../language-spec.md#17-grammar-normative) (`draw-cmd` grammar), `src/raster.ts`, `src/eval.ts`
  (command, `#builtinShape` region form, `BUILTIN_NAMES`), tests, `docs/best-practices.md`,
  `docs/motif-cookbook.md`, and the product skill (`skills/drawstic/SKILL.md` + `reference.md`).
