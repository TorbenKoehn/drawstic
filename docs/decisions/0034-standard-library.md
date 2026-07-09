# 34. Standard library — a fixed, total built-in set

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude
- Resolves: spec open question 10

## Context

[Spec §10](../language-spec.md#10-expressions--functions) used `fn lerp(…)` in examples
and **implied** trig, but specified **no built-in set**. That gap is load-bearing, not
cosmetic: without `len`, list iteration cannot be written generically; without `clamp` and
trig, procedural drawing cannot compute positions at all. Listing it as an "open question"
understated how much depends on it.

## Decision

A **fixed, total, side-effect-free** built-in set — every entry deterministic via the
bundled math ([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)):

- **Math:** `min`, `max`, `abs`, `clamp(x, lo, hi)`, `floor`, `ceil`, `round`, `sign`,
  `sqrt`, `hypot`, `dist(a, b)`, `sin`, `cos`, `tan`, `atan2`, `pow`, `exp`, `log`,
  `lerp(a, b, t)`, `mod` (and the `%` operator). Constants: `pi`, `tau`.
- **Lists:** `len(xs)`; indexing and destructuring are already in the language
  ([§4](../language-spec.md#4-values--types)). `range(a, b)` is the half-open bound source
  for `for` ([§11](../language-spec.md#11-loops)).
- **Randomness:** `rand`, `noise` — **seeded** ([ADR-0026](0026-seeded-randomness-and-noise.md)), no
  ambient entropy.
- **Colour ops** (`lighten`, `mix`, `oklch`, …) are already first-class
  ([ADR-0009](0009-first-class-colours-gradients-filters.md)) and are **not re-listed** here.

**No I/O, no time, no locale, no ambient random.** This preserves totality
([ADR-0004](0004-total-not-turing-complete.md)) and determinism
([ADR-0007](0007-visual-not-byte-determinism.md), [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)).
The set is **closed in v1** — additions are future ADRs — and **user `fn`s cannot shadow a
built-in** (a positioned error), so a built-in name always means the built-in.

## Consequences

- Makes procedural drawing actually expressible: positions, radii, and counts can be
  computed; lists can be iterated generically via `len`/`range`.
- Resolves [open question 10](../language-spec.md#18-open-questions-for-review).
- All trig and transcendentals route through the bundled deterministic math
  ([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)) — identical results across platforms, not the
  host's libm.
- The no-shadow rule keeps the built-in namespace stable and self-verifiable: a reader never
  has to check whether `clamp` was redefined.
- Touches spec §10 (new "Standard library" subsection), §18 (resolves Q10).
