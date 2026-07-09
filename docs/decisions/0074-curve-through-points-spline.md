# 74. `curve` — a through-points spline primitive

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Resolves: `TODO-IMP.md` §5.1 (Scene-DX evaluation, highest-impact new primitive)
- Pairs with: [ADR-0075](0075-curvepoly-closed-curve-region.md) (closed-loop / fillable counterpart)

## Context

The only smooth-line primitives are `quad`/`bezier` ([spec §8](../language-spec.md#8-drawing-primitives),
[ADR-0023](0023-curve-and-shape-primitives.md)), authored in **control points** the curve does *not*
pass through. Every evaluation scene that wanted a dune ridge, a hill, a wave, or a palm frond had
to reverse-engineer Bézier handles from the shape it actually wanted — LLMs reason "the line passes
*through* these points", not "these are the off-curve tangents". The desert scene's palms came out a
"wire-tangle" of mis-placed `bezier`s ([evaluation](../scene-dx-evaluation-2026-07-08.md), prioritized
action #1). A primitive whose arguments are the points the line visits is the single biggest missing
drawing lever.

## Decision

**1 — `curve <paint> <pt1> <pt2> <pt3> … [w<N>]` strokes an open Catmull-Rom spline *through* the
given points.** Paint-first like every painting command ([ADR-0066](0066-paint-first-painting-commands.md)),
variadic points, an optional trailing `w<N>` stroke width (default 1) exactly like `line`/`bezier`.

```drw
curve sand 0:22 16:14 32:20 48:12 64:18       # a dune ridge through five points
curve frond 20:15 12:10 6:4 2:3 w2            # a palm frond, one predictable line
```

**2 — Centripetal parameterization (α = ½) is pinned.** Uniform and chordal Catmull-Rom cusp and
self-intersect on unevenly-spaced or sharply-turning control polygons; the centripetal variant
provably does neither, so a `curve` stays predictable through any points an author throws at it. The
knot spacing is `Δt = dist^½ = sqrt(dist)`, which needs only `sqrt` — no `pow` (banned from the pixel
path, [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)).

**3 — Endpoints are duplicated (the phantom-point rule), so the curve passes through *every* control
point** including the first and last. Interpolation is exact at each point (centripetal Catmull-Rom
is interpolating): the rasterized stroke covers each control pixel within ±1px after grid rounding.

**4 — Deterministic, resolution-independent tessellation.** Each span between consecutive control
points is flattened to `clamp(ceil(chord), 4, 64)` segments, where `chord` is the point-to-point
distance via the bundled `dhypot` (exact `sqrt`). The rule uses only `ceil`/`min`/`max`/`+`/`−`/`*`/`/`
and `sqrt` — all IEEE-exact — so the flattened polyline is bit-identical across platforms and across
runs ([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)), like the fixed `quad`/`bezier`
flattener before it. The flattened chain is then stroked by the same disc-brush centerline path as
`quad`/`bezier` (round cap/join in pixel mode).

**5 — Minimum three points; two points is an E011 pointing at `line`.** A two-point "curve" is a
straight segment, so `curve` rejects it with a hint to use `line` rather than silently drawing a line.

**6 — Pure addition, no pragma gate.** `curve` is a new callee; it changes no existing render, so it
is available in every language version (the recipe `lang` version stays **2**), unlike the
signature-changing ADRs 0068/0070.

`curve` is a **stroke-only** primitive with no region form — like `line`/`arc`/`quad`/`bezier`, an
open chain has no fillable interior. The closed, fillable counterpart is `curvePoly`
([ADR-0075](0075-curvepoly-closed-curve-region.md)).

## Consequences

- Dunes, hills, waves, and fronds become **one predictable line** authored in the points it visits,
  not reverse-engineered Bézier handles — the motif cookbook's dune ridge is rewritten to a single
  `curve`.
- Small curves still round to the pixel grid; below ~12px a `curve` reads blocky just like
  `quad`/`bezier` — the existing §8 caveat covers it.
- Touches [spec §8](../language-spec.md#8-drawing-primitives) (primitive table + curve notes),
  [§17](../language-spec.md#17-grammar-normative) (`draw-cmd` grammar), `src/raster.ts` (tessellation),
  `src/eval.ts` (command + `BUILTIN_NAMES`), tests, `docs/best-practices.md`, `docs/motif-cookbook.md`,
  and the product skill (`skills/drawstic/SKILL.md` + `reference.md`).
