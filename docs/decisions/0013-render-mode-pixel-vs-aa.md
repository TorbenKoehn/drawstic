# 13. Render mode (pixel vs anti-aliased): theme default + export override

- Status: Accepted
- Date: 2026-06-14
- Deciders: t.koehn, Claude

## Context

Drawstic must render both **pixel-perfect** (crisp, no anti-aliasing — its primary use
case) and **smooth** (anti-aliased) output, chosen per the style of the game/project. The
question is where that choice lives: the theme, the export, the drawing, or some
combination.

## Decision

Render mode lives in the **theme as the default**, with a **per-export override**.

- A theme declares `mode pixel` or `mode smooth`. It is a **style trait** — consistent
  across a set, and already implied by the style guide ("No AA").
- An `export` format line may override it: `png 512 mode smooth` — for the occasional
  "same art, also smooth at 4×" artifact.
- Mode is consumed by the rasterizer: it governs anti-aliasing, gradient dithering
  ([ADR-0009](0009-first-class-colours-gradients-filters.md)), and mask coverage
  (1-bit vs alpha, [ADR-0012](0012-masks-and-path-combination.md)).

## Consequences

- The look stays consistent across a themed set by default, but a single artifact can
  opt out without forking the artwork.
- Both modes are deterministic ([ADR-0007](0007-visual-not-byte-determinism.md)); pixel
  mode is the crisp, dithered-gradient path, smooth mode the anti-aliased one.
- Export-only and per-draw placement were considered; theme-default best matches "mode is
  part of the set's style".
