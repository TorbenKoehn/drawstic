# 80. Unified texture-filter argument order (magnitude then seed)

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0071](0071-region-scoped-texture-filters.md), [ADR-0062](0062-scoped-shadow-and-texture-filters.md)

## Context

The deterministic texture filters carried **inconsistent scalar orders**
([ADR-0071](0071-region-scoped-texture-filters.md)):

```
grain   [region] amount seed paint      # magnitude first
speckle [region] seed density paint     # seed first
ripple  [region] seed strength paint    # seed first
```

`grain` leads with its **magnitude** (amount), while `speckle` and `ripple` lead with the
**seed**. Both slots are plain numbers, so a swapped pair is not a type error: `check` cannot
flag it, and the recipe renders silently wrong (wrong noise density / band strength, or a seed
outside its intended range). The Scene-DX evaluation
([evaluation](../scene-dx-evaluation-2026-07-08.md)) hit exactly this on 2 of 7 scenes — a
"silently-wrong" defect, the worst class per the design priorities (self-verifiability is a
floor, [spec §1](../language-spec.md#1-design-priorities)). The remaining filter, `dither`, has
**no seed** (`a b threshold`) and so is not part of the ambiguity.

Language version 2 is pre-release with LLM-only consumers, so a breaking argument reorder costs
nothing but a mechanical repo sweep.

## Decision

**1 — All texture filters order their two numeric scalars as `magnitude seed`.** `grain` keeps
its order; `speckle` and `ripple` swap so the effect's primary scalar (density / strength) leads
and the seed follows in a fixed second numeric slot:

```
grain   [region] amount   seed paint
speckle [region] density  seed paint
ripple  [region] strength seed paint
dither  [region] paintA paintB threshold   # unchanged — no seed, no ambiguity
```

```drw
grain   sand  0.3  11 #00000030    # 30% coverage, seed 11
speckle sand  0.1  17 #ffffff40    # 10% density,  seed 17
ripple  water 0.4  23 #0b4b7230    # 40% strength, seed 23
```

**2 — Magnitude leads because it is the tuned parameter; the seed is a fixed second slot.**
Authors reach for the filter to set *how much* effect (coverage / strength) and only bump the
seed to reshuffle the pattern. Putting the magnitude first matches `grain` (the pre-existing,
in-distribution order) and — more importantly — makes the **same slot mean the same thing across
all three filters**, which is what removes the silent-swap trap: there is one order to remember,
not two.

**3 — The internal `raster.ts` filter functions adopt the same `(magnitude, seed)` parameter
order** so the engine tells one story end-to-end (`filterGrain(ctx, amount, seed, …)`,
`filterSpeckle(ctx, density, seed, …)`, `filterRipple(ctx, strength, seed, …)`). Region-scope
disambiguation ([ADR-0071](0071-region-scoped-texture-filters.md)) is unchanged — the leading arg
is still a region iff it evaluates to one.

## Consequences

- Removes a silently-wrong defect class: one uniform `magnitude seed` order across
  `grain`/`speckle`/`ripple`, so a transposed pair no longer renders wrong past a clean `check`.
- Breaking change to the `speckle`/`ripple` surface (v2, pre-release) — swept mechanically across
  every recipe, example, doc, and test in the same change; renders are identical because each
  literal keeps the same value in the same role.
- Touches [spec §12](../language-spec.md#12-colour-gradients-filters--themes) (filter list +
  cheat-sheet), `src/eval.ts`, `src/raster.ts`, `tests/unit/{eval,raster}.test.ts`,
  `examples/scenes/**`, `examples/scenes-v2/**`, `docs/motif-cookbook.md`, and the product skill
  (`skills/drawstic/reference.md`). Refines [ADR-0071](0071-region-scoped-texture-filters.md)'s
  scalar order; the region-first shape and whole-frame semantics from ADR-0071 stand.
