# 77. `scatter` — seeded point-distribution block

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Resolves: `TODO-IMP.md` §5.4 (Scene-DX evaluation, the hand-rolled `for`+`rand`+`floor` scatter dance)

## Context

Stars, bubbles, gravel, sparks, foam — **7/7 evaluation scenes** hand-rolled the same loop to
throw n marks at pseudo-random points over an area
([evaluation](../scene-dx-evaluation-2026-07-08.md), `docs/motif-cookbook.md` "Starfield / scatter"):

```drw
for i 0..40:
  sx = rand(1, i) * w       # independent seeds per axis — reuse one and every
  sy = rand(2, i) * h       # point lands on a diagonal (a real trap, 7/7)
  px sc sx:sy
```

That loop is boilerplate and it has two recurring traps: (1) reusing one seed for both axes lines
every point up on a diagonal, and (2) `rand(...) * w` scatters over the *bounding rectangle*, not
over a shape — confining marks to a circle/silhouette needs a hand-written `if region.has …`. A
block that samples n points **uniformly over a region's pixels** with one explicit seed removes the
boilerplate and both traps by construction, and stays deterministic like `rand`/`noise`
([ADR-0026](0026-seeded-randomness-and-noise.md)).

## Decision

**1 — `scatter <name> <n> <seed> <region>:` executes its body `n` times, binding `<name>` to a
seeded point drawn from `<region>`.** The header mirrors `for` exactly
([spec §11](../language-spec.md#11-loops)): the keyword, then the **binding name** (like `for`'s
loop variable), then positional operands, then `:` and an indented block. No `in`/`seed`/`over`
filler words — `for` has none either, and every filler word is dead tokens on a construct authors
write constantly. Operand order is **count, seed, region** (the order `TODO-IMP.md` §5.4 states).
The bound name is a `point` value; the body reads it like any point.

```drw
draw stars 64x40:
  bg #05060e
  scatter p 40 1 rect(0:0, w-1:h-1):
    px #ffffff p
```

**2 — Distribution is uniform over the region's on-canvas pixels, by index-sampling into the
enumerated pixel set.** The region's pixels (the integer `(x,y)` where `region.has(x,y)`, within the
region's bbox clipped to the canvas) are enumerated once in **row-major order** (y outer, x inner).
Point `i` is `pixels[floor(rand(seed, i) * count)]`
([ADR-0026](0026-seeded-randomness-and-noise.md) `rand(seed, i)` draws the i-th value of the seed's
stream in `[0,1)`). Index-sampling — not rejection sampling — is chosen deliberately: it is uniform
over *pixels* (not the bbox), it **guarantees exactly `n` iterations** (rejection can starve on a
sparse region and under-fill), and it needs no retry bound to stay deterministic. Sampling is with
replacement (two stars may coincide) — the natural, cheapest choice; distinctness is not a scatter
requirement.

**3 — Same seed + same region + same canvas → identical points, on every platform.** Enumeration
order is fixed (row-major), the index draw is pure integer `hash32` math via `rand`
([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)), and the point is integer pixel
coordinates — so two runs are byte-identical and every platform agrees. A **different seed** yields
a different, decorrelated arrangement (the `rand` stream is reseeded). Iteration order is `i = 0 … n
−1`, deterministic.

**4 — An empty region is a no-op, not an error.** If the region has no on-canvas pixels
(`count === 0`, e.g. an off-canvas or null-bbox region), `scatter` runs its body **zero times** and
draws nothing — no diagnostic, no lint warning. Scattering into an empty area meaning "nothing to
place" is the sane, composable reading (a region computed to be empty by some upstream
`intersect`/`subtract` should not blow up a whole render). Documented as a semantic, not a silent
surprise.

**5 — Region coercion and scoping match the rest of the language.** `<region>` accepts a Region or a
drawing silhouette (a Sprite, coerced via `spriteRegion`, exactly like `mask`/`castShadow`); anything
else is E006. The binding is **child-scoped** per iteration (a fresh environment, like `for`), so it
does not leak; `<name>` must be bindable (not a builtin/palette key, E007). One **step is charged per
iteration** (spec §15) so a `scatter` terminates under the budget like `for`/`repeat`; the one-time
pixel enumeration is bounded by the canvas area.

**6 — `scatter` is a contextual keyword, pure addition, no pragma gate.** It is recognized only in
the block-header shape (`scatter NAME …:`) — `scatter = expr` and `scatter` in expression position
stay an ordinary bindable name (same treatment as `mask`/`font`; unlike the always-committed
`for`/`repeat`). It changes no existing render and is available in every language version (`lang`
stays **2**, [ADR-0068](0068-shaderegion-veil-opacity-signature.md) context).

## Consequences

- The 7/7 scatter loop collapses to a two-line block, and the diagonal-seed trap and the
  bbox-not-shape trap both vanish — points come from the region's pixels directly.
- `scatter` pairs with `mirror` ([ADR-0078](0078-mirror-block.md)): a `scatter` inside a `mirror`
  gives a symmetric random field for free (both passes draw the same seeded points, reflected).
- Cost: the pixel set is materialized (O(canvas-area) transient) so index-sampling is O(1) per
  point — the deliberate trade for exactly-`n`, uniform-over-pixels determinism.
- Touches [spec §11](../language-spec.md#11-loops) (blocks), [§14](../language-spec.md#14-determinism)
  (seeded, platform-stable), [§17](../language-spec.md#17-grammar-normative) (`scatter-stmt`),
  `src/lexer.ts` (none — contextual name), `src/parser.ts` + `src/ast.ts` (new `scatter` node),
  `src/eval.ts` (execution, scoping, budget), tests, `docs/best-practices.md`,
  `docs/motif-cookbook.md`, and the product skill (`skills/drawstic/SKILL.md` + `reference.md`).
