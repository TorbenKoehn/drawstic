# 40. Mode-scoped coordinate quantization (subpixel geometry in smooth mode)

- Status: Accepted
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Refines: [ADR-0013](0013-render-mode-pixel-vs-aa.md), [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md), [ADR-0028](0028-rasterization-semantics.md)

## Context

[Spec §5](../language-spec.md#5-coordinate-system) coerced **every** non-integer coordinate
to an integer (round half-up), globally. That is right for pixel mode — and wrong for
**smooth mode**: anti-aliasing exists precisely to render sub-pixel geometry, and
[ADR-0023](0023-curve-and-shape-primitives.md) already promises true stroked paths with
caps/joins there, which presupposes real-valued geometry. Snapping `circle 8.5:8.5 3.25`
to `9:9 3` discards the information before the rasterizer ever sees it — high-resolution
AA output could never place anything between pixels.

The naïve fix — free floats in smooth mode — would tie the determinism story (§14) to
unbounded float sensitivity. The industry answer is a **fixed subpixel grid** (FreeType
works in 1/64ths; GPU rasterizers snap to 1/16–1/256): quantization stays exact and
predictable, precision is preserved.

## Decision

**1 — Quantization moves to the rasterization boundary and is scoped by render mode.**
Numbers (and therefore point components, radii, control points, angles) are real-valued in
the language (§4); a coordinate is quantized only when geometry is rasterized:

- **Pixel mode:** round **half-up to integers** (`floor(v + 0.5)`) — unchanged, the
  [ADR-0028](0028-rasterization-semantics.md) semantics.
- **Smooth mode:** round **half-up to the fixed 1/16 subpixel grid**
  (`floor(v * 16 + 0.5) / 16`). Exact (power-of-two scale), deterministic, and it bounds
  float sensitivity: two platforms that agree to 1/32 of a pixel produce identical output.

**2 — Inherently integer slots stay integer in both modes.** Quantities that *are* raster
indices — canvas size `WxH`, grid cells, `px` positions, `stamp` position/`scale<N>`,
tileset/atlas layout, `@N` export scales, `w`/`h` — coerce half-up to integers always.
Sub-pixel blitting and sub-pixel canvas sizes stay out by construction.

**3 — The subpixel grid constant (1/16) is version-pinned** ([ADR-0029](0029-language-version-pragma.md)),
like every other rasterization constant. Smooth-mode coverage (regions,
[ADR-0012](0012-masks-and-path-combination.md)) consumes the quantized geometry.

## Consequences

- Smooth mode gains genuine sub-pixel expressiveness — the point of having it — without
  weakening determinism: quantization is exact, specified, and self-verifiable (a reader
  can compute the snapped value from the source).
- Pixel mode is byte-for-byte unaffected.
- The same recipe may diverge more between modes than before (geometry snaps differently);
  that is inherent to what a render mode *is* ([ADR-0013](0013-render-mode-pixel-vs-aa.md)).
- Touches spec §5 (coercion rule) and §14 (determinism list).
