# 72. Visual stamp anchors (language version 2)

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0064](0064-stamp-anchors.md); gated by [ADR-0029](0029-language-version-pragma.md)

## Context

`stamp part pt anchor <name>` ([ADR-0064](0064-stamp-anchors.md),
[spec §9](../language-spec.md#9-composition-transforms--masks)) names a **source-local** point
and maps it **through** the stamp transform before subtracting it from `pt`. So a flip/rotate
carries the named point with the pixels: `anchor bottomLeft` + `flipx` mirrors the named corner
and lands the object **bottom-right** at `pt`, not bottom-left; `anchor bottom` + `rot90` lands
the source's bottom-center — now on a *side* edge — at `pt`.

This is the natural reading only for someone who already holds the source→transform mental
model. The [Scene-DX evaluation](../scene-dx-evaluation-2026-07-08.md) recorded it as a **silent
misplacement class** (2/7 graders; market and desert): an author writes the visually-obvious
anchor, gets the mirrored/rotated placement, and no `check` can catch it because the recipe is
well-formed. The P1 documentation wave ([spec §9](../language-spec.md#9-composition-transforms--masks),
`TODO-IMP.md` §1.4) documented the through-transform rule with a worked `flipx`→bottom-right
example as a stopgap and flagged "supersede if 4.5 lands". This is that supersede.

Every LLM author reasons about the *visible* result: `bottom` should mean "the bottom of the
thing I see", after the flip, not before it.

## Decision

**1 — In language version 2, the eight offset anchors resolve against the transformed
footprint's bounding box (visual semantics).** `top`, `topRight`, `left`, `center`, `right`,
`bottomLeft`, `bottom`, and `bottomRight` name a position on the **axis-aligned bounding box of
the stamp after flip/scale/rotation and any explicit `transform`** — the box you actually see —
and Drawstic round-half-up subtracts that position from `pt`. `anchor bottom` is the visible
bottom-center; `anchor bottomLeft` + `flipx` puts the visible **bottom-left** at `pt`; `anchor
bottom` + `rot90` puts the visible bottom-center (a rotated side) at `pt`.

```drw
# v2: the visible bottom-left sits at pt, mirror or not
stamp sign 40:30 anchor bottomLeft            # visible bottom-left at 40:30
stamp sign 40:30 anchor bottomLeft flipx      # still visible bottom-left at 40:30
```

The bounding box is forward-mapped from the sprite's pixel-center corners `(0,0) (w−1,0)
(0,h−1) (w−1,h−1)`, so an **untransformed** stamp's visual box is `[0,w−1]×[0,h−1]` and every
named anchor coincides bit-for-bit with its v1 source point — v2 changes nothing without a
transform.

**2 — `topLeft` is the placement origin and is unchanged in both versions.** The implicit
default (no `anchor` keyword) and the explicit `anchor topLeft` place the stamp's **untransformed
origin** at `pt` (round-half-up), exactly as before — `dest = pt + M(src)`. `topLeft` is the
*origin of the sprite's coordinate frame*, not a footprint-relative label; it is the anchor from
which manual point-arithmetic placement is reckoned, so it stays geometrically stable and
version-independent. (For flips the footprint box is preserved, so this also equals the visible
top-left; for rotation/scale it is the raw origin, and an author who wants the visible top-left
of a rotated stamp names `topLeft`'s visual cousins via an explicit offset anchor.)

**3 — Numeric / point placement keeps its meaning in every version.** The `anchor` keyword takes
only the nine names above; there is no numeric anchor form. Placing by a computed point — point
arithmetic on `pt` (§8), or a transform pivot `.about(pt)` (§9,
[ADR-0044](0044-first-class-transforms.md)) — is plain geometry and is unaffected by this ADR in
either version.

**4 — The change is gated on the version pragma
([ADR-0029](0029-language-version-pragma.md)).** Recipes pinning `drawstic 1` keep the v1
through-transform mapping (retained on the `#anchoredStampOrigin` legacy path); unpinned recipes
and `drawstic 2`+ get visual anchors. Every bundled scene that pairs an offset anchor with an
asymmetric transform (`market` `anchor bottomRight flipx`) pins `drawstic 1`, so no existing
render changes; the two unpinned scenes that stamp with a transform (`desert`, `showcase`) use
only `topLeft`/`center`/`bottom` under symmetric or origin-preserving transforms, which coincide
across versions, and were re-verified pixel-identical. Version 2 is otherwise identical to
version 1 ([ADR-0053](0053-v1-engine-pinned-implementation-constants.md) constants carry
forward).

Deterministic throughout: forward-mapping and offsets quantize round-half-up
([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)); a non-invertible/projective
anchor that maps to infinity falls back to raw origin placement, as before.

## Consequences

- The visually-obvious anchor now does the visually-obvious thing under flip/rotate/scale —
  closes the evaluation's silent anchor×transform misplacement class.
- The mirror-reflection idiom changes shape: v1 reflected by *reusing* `anchor bottom` + `flipy`
  (the point mapped to top-center, seaming the copies); v2 seams by naming the seam edge
  explicitly (`anchor bottom` for the upper copy, `anchor top` + `flipy` for the reflection).
  Documented in [spec §9](../language-spec.md#9-composition-transforms--masks).
- Imposes the [ADR-0029](0029-language-version-pragma.md) retain-old-semantics obligation: the v1
  through-transform mapping lives on, selected by the module pragma at stamp dispatch.
- The language-version-2 difference list grows by this one behavioural change, alongside the
  [ADR-0068](0068-shaderegion-veil-opacity-signature.md) `shadeRegion` change and the
  [ADR-0070](0070-unified-shadow-argument-shape.md) mask-respecting frame shadow.
- Touches [spec §9](../language-spec.md#9-composition-transforms--masks) (anchor semantics +
  worked example, replacing the through-transform text),
  [§14](../language-spec.md#14-determinism) (version-2 difference list), `src/eval.ts`, tests,
  and the product skill (`skills/drawstic/SKILL.md` + `reference.md`).
