# 43. Arbitrary-angle stamp rotation (pinned nearest-neighbour resampling)

- Status: Accepted (refined by [ADR-0044](0044-first-class-transforms.md): the stamp flags become pinned sugar over first-class transforms; semantics unchanged)
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Refines: [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md), [ADR-0028](0028-rasterization-semantics.md) (supersedes the spec-§9 "90° only" exclusion)

## Context

`stamp` allowed only mirror, quarter-turns, and integer upscaling; arbitrary rotation was
"deliberately excluded because it breaks pixel-perfect output". That rationale conflates
two different things. **Non-determinism** would be disqualifying — but rotation by any
angle is fully deterministic once the resampling algorithm is pinned (the bundled trig of
[ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md) exists precisely for this).
**Aesthetics** — resampled sprites get jaggies — is the author's call, not the language's:
Aseprite, the reference pixel-art tool, rotates at arbitrary angles (nearest-neighbour by
default, RotSprite optionally) and pixel artists use it deliberately. A tool whose pitch is
"pixel-perfect graphics" must be able to do what the genre's editor does.

## Decision

**1 — `rot<deg>` accepts any angle.** Degrees, clockwise (matching `arc`, spec §8),
normalized mod 360; `rot90`/`rot180`/`rot270` are the same flag at special values:

```drw
stamp gem 6:9 rot45            # NN-resampled, centre-fixed
stamp arrow 2:2 rot30 scale2   # transforms compose: scale, then rotate
```

**2 — One anchor rule: rotation is about the footprint centre.** The pivot is
`pt + ((w−1)/2 : (h−1)/2)` — the centre of the source footprint placed at `pt` — and stays
fixed under rotation. Rotated pixels may extend beyond the original footprint; the canvas
clips as usual ([ADR-0028](0028-rasterization-semantics.md)). For square sprites the
quarter-turn results are identical to the previous top-left-anchored behaviour; non-square
sprites with odd `w−h` shift by the half-pixel that centre-pinning implies (placement
rounds half-up). One sentence, no per-angle anchor table (priority 3).

**3 — Exact multiples of 90° are lossless.** They use pure index transposition — no trig,
no resampling, every source pixel preserved. All other angles use **inverse-mapped
nearest-neighbour**: for each destination pixel centre, rotate back about the pivot with
the bundled `sin`/`cos`, round half-up, copy the source pixel (outside the source →
transparent). NN introduces **no new colours** and honours alpha — palette and silhouette
discipline survive. The same algorithm runs in both render modes (a stamp is a bitmap
blit); smooth-mode filtered resampling is *not* v1.

**4 — Determinism is unchanged in kind.** Bundled trig, fixed rounding, version-pinned
([ADR-0029](0029-language-version-pragma.md)) — the rotation joins the pinned
rasterization list in §14. Same recipe, same pixels, every platform.

**5 — Noted extensions, not specified now:** a `rotsprite` quality flag (Aseprite's
pixel-art-preserving algorithm — deterministic but heavy to pin), arbitrary (non-integer)
`scale`, and region rotation ([ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md)
keeps it deferred — a *stamp* has a canonical pivot, its footprint; an arbitrary coverage
set does not).

## Consequences

- The capability gap to the genre's reference editor closes; rotated variants (compass
  needles, clock hands, projectiles) no longer need hand-pixeled per-angle drawings.
- Authors own the aesthetic trade-off: quarter-turns/mirrors stay lossless, everything
  else is visibly resampled — exactly as in Aseprite.
- Order of composed transforms is pinned: flip → scale → rotate (each about the rule above).
- Touches spec §9 (stamp syntax + transforms paragraph) and §14 (pinned rasterization).
