# 56. Even-diameter circle rasterization

- Status: Accepted
- Date: 2026-07-06
- Deciders: t.koehn, Codex

## Context

ADR-0028 pinned `circle <c> <r>` to an odd `2r+1` footprint centered on the integer pixel
`c`. That makes icon-sized circles visually drift down-right: `circle 8:8 7` in a 16x16
canvas occupies rows/columns `1..15`, leaving 1px padding on the top/left and 0px on the
bottom/right.

For icon work, the declared radius is expected to produce a pixel-perfect diameter of `2r`.
The previous rule made authors compensate with off-by-one coordinates or switch primitives,
which weakens recipe predictability.

## Decision

`circle <c> <r>` now rasterizes to an even-diameter pixel region for integer `r > 0`:

- pixel-mode bounds are `c-r .. c+r-1` on each axis, so the footprint is `2r` pixels wide
  and tall;
- membership is tested against a disc centered at `c - 0.5` in both axes, collapsing the old
  center pixel into the four center-adjacent pixels;
- `r=0` remains a single pixel at `c`.

This supersedes ADR-0028 point 3 for `circle`. `ellipse` keeps its existing integer-radius
semantics.

## Consequences

- `circle 8:8 7` fits a 16x16 icon with balanced 1px padding on all sides.
- Existing circles render one pixel smaller on the right and bottom than before.
- Strokes and region algebra inherit the new `circle` region because drawing suffixes are
  sugar over `fill`/`stroke` eliminators.
