# 53. v1 engine: pinned implementation constants

- Status: Accepted
- Date: 2026-07-05
- Deciders: t.koehn, Claude
- Refines: [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md), [ADR-0028](0028-rasterization-semantics.md), [ADR-0040](0040-mode-scoped-coordinate-quantization.md), [ADR-0043](0043-arbitrary-angle-stamp-rotation.md)

## Context

The v1 engine (the reference implementation in `src/`) had to pin several
constants and micro-semantics that the spec and prior ADRs left open — each
one pixel-affecting, so each is part of language version 1
([ADR-0029](0029-language-version-pragma.md)). Changing any of them is a
version bump, not a patch.

## Decision

**1 — Gradient dithering rule (pixel mode).** A gradient resolves to
continuous per-channel values; each channel commits to 8-bit by
**ordered dithering against the standard 4×4 Bayer matrix**
(`threshold = (bayer[y mod 4][x mod 4] + 0.5) / 16`, floor + conditional
carry). Smooth mode commits round-half-up instead (spec §12).

**2 — Smooth-mode coverage.** Region fills sample **4×4 subsamples per
pixel** at offsets `(2k+1)/8 − 0.5` (all on the 1/16 grid of
[ADR-0040](0040-mode-scoped-coordinate-quantization.md)); coverage =
hits/16, scaling the paint's alpha. Path strokes rasterize identically in
both modes (crisp Bresenham + disk brush); a true stroked path with
`cap`/`join` geometry is deferred — the flags parse and the round brush is
the v1 behaviour.

**3 — Integer scaling anchors at the footprint corner.** `scale<N>` on
`stamp` and `.scale(N)` on regions conjugate the scaling matrix to
**(−0.5, −0.5)** (the top-left pixel corner in centre coordinates), so
nearest-neighbour block-doubling is exact — every source pixel becomes an
N×N block, no holes. Rotation and the mirror flags stay anchored at the
footprint **centre** `((w−1)/2, (h−1)/2)` per
[ADR-0043](0043-arbitrary-angle-stamp-rotation.md).

**4 — Curve flattening constants.** `quad`/`bezier` flatten to
`clamp(ceil(controlPolygonLength) · 2, 8, 256)` segments; `arc` uses
`clamp(ceil(|sweep|/360 · max(16, 8r)), 8, 512)` steps — fixed functions of
the pinned numeric domain ([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md) §5).

**5 — Bundled math implementations.** `sin`/`cos` use the fdlibm kernel
polynomials with Cody-Waite π/2 reduction; `atan` uses four
angle-halvings + the odd Taylor series to t²¹; `exp`/`log` use
Cody-Waite ln 2 splitting + fixed-length series; `pow` has an exact
integer-exponent fast path (|b| ≤ 64); `cbrt` is `exp(log/3)` + two Newton
steps. `rotate(deg)` returns **exact** matrix entries at multiples of 90°,
which is what makes quarter-turns lossless.

**6 — Colour values commit at construction.** Every colour operation
(`lighten`, `mix`, `oklch(…)`, …) returns an already-committed 8-bit sRGB
value (round-half-up, gamut-mapped per [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)) —
chains re-quantize at every step. There is no hidden high-precision colour
state; what a binding holds is what a `px` writes.

**7 — `fmt` v1 scope.** The canonical formatter normalizes line endings to
LF, indentation to 2 spaces per level (structure-preserving), strips
trailing whitespace, collapses blank-line runs to one, and guarantees one
trailing newline. Wrapped logical lines (unclosed `(`) keep their manual
alignment. It does not re-shape tokens; comments are preserved verbatim.

## Consequences

- Golden tests have a single correct answer for gradients, smooth coverage,
  scaled stamps, and curve rasterization — §14's pixel-identity claim is
  now fully testable against the reference implementation.
- The constants above are frozen into language version 1; improving any of
  them (e.g. true stroked paths with `cap`/`join`, RotSprite) requires a
  version bump per [ADR-0029](0029-language-version-pragma.md).
- Touches spec §8 (stroke flags note), §12 (dither rule), §13 (fmt), §14
  (pinned list grows by these items).
