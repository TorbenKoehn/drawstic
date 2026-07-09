# 26. Seeded randomness & value noise (the determinism-safe texture escape hatch)

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude

## Context

Organic textures — starfields, dust, scattered foliage, grain, dither scatter — need
**pseudo-randomness**. But [spec §14](../language-spec.md#14-determinism) forbids *ambient*
randomness: no wall-clock seed, no per-call global counter, nothing that varies run to run.
And no randomness primitive existed at all, so textures were simply impossible — an author
wanting noise had to hand-place every pixel.

The tension is only apparent. Randomness that is **pure and seeded** is a deterministic
function of its arguments: same seed → same value, every platform, every run. The job is to
ship that as a first-class helper and to specify it so exactly that two engines cannot
disagree on a single bit.

## Decision

**1 — All randomness is pure and seeded; never ambient.** The stdlib
([ADR-0034](0034-standard-library.md)) provides three built-ins:

- `rand(seed)` → a deterministic value in `[0, 1)`.
- `rand(seed, i)` → the `i`-th value of the stream for `seed` (still pure: a function of
  `(seed, i)`, not a stateful draw).
- `noise(seed, x, y)` → 2D value noise in `[0, 1)`, smooth in `x`/`y`.

There is **no** zero-argument `rand()` and **no** hidden counter. The seed is always an
explicit argument, so a recipe is self-verifiable ([spec §1](../language-spec.md#1-design-priorities)
priority 3): a reader can predict every value from what is written on the line.

**2 — The integer hash and the noise construction are exactly specified, in integers.** No
pixel-affecting randomness may touch host floating-point `Math.*` (ties to
[ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)). The base mixer is a
**splitmix32-style integer hash** on `u32`, all ops mod 2³²:

```
hash(x):
  x = (x + 0x9e3779b9)      mod 2^32
  x = (x ^ (x >>> 16)) * 0x21f0aaad   mod 2^32
  x = (x ^ (x >>> 15)) * 0x735a2d97   mod 2^32
  x =  x ^ (x >>> 15)
```

- `rand(seed)`   = `hash(seed) / 2^32`.
- `rand(seed,i)` = `hash(seed ^ hash(i)) / 2^32` (combine, then mix again).
- `noise(seed,x,y)` = bilinear blend of four integer-lattice corner hashes
  `hash(seed ^ hash(ix ^ hash(iy)))` at the cell corners `(ix,iy)…(ix+1,iy+1)`, weighted by
  an **integer/fixed-point smoothstep** `s(t) = t²(3−2t)` evaluated in fixed point — never
  floating `Math.*`. The division by `2^32` to reach `[0,1)` is the only float step and is
  IEEE-exact (a power-of-two divide).

These constants are frozen: the hash mix steps, the multipliers, the corner-combination
order, and the fixed-point smoothstep are part of the language version
([ADR-0029](0029-language-version-pragma.md)) — changing them is a version bump, not a patch.

**3 — An optional `seed <N>` directive sets a base seed; the core stays explicit.** A module-
or draw-level command-form directive `seed <N>` (like `size`, [ADR-0021](0021-optional-canvas-size-resolution.md))
may set a base seed that *sugar* helpers reference, for authors who don't want to thread a
literal everywhere. But the core functions **always** take their seed argument — the directive
never becomes a hidden global the functions read implicitly. Self-verifiability wins over a
few saved tokens.

## Consequences

- Procedural texture becomes expressible while **pixel determinism** ([ADR-0007](0007-visual-not-byte-determinism.md))
  is fully preserved — noise is just another pure function.
- Adds `rand`/`noise` to the numeric stdlib ([ADR-0034](0034-standard-library.md));
  the integer-only rule keeps them safe under [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md).
- Touches [spec §10](../language-spec.md#10-expressions--functions) (built-in functions) and
  [§14](../language-spec.md#14-determinism) (the "pure seeded" promise now has a concrete API).
- Designed in now, with the explicit-seed and integer-hash rules baked in, so randomness can
  never devolve into an ambient bolt-on later.
