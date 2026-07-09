# 1. Framebuffer-first rendering core

- Status: Accepted
- Date: 2026-06-13
- Deciders: t.koehn, Claude

## Context

The primary use case is **pixel-perfect** raster graphics (pixel art / sprites), with
vector and later 3D rasterization as secondary targets. An earlier sketch made SVG the
canonical internal model with raster as "rasterize the SVG". For pixel-perfect work
that is wrong: SVG is resolution-independent and rasterization introduces anti-aliasing
and sub-pixel positioning — exactly the fuzz pixel art must avoid.

It also collides with the "no dependencies" rule: rasterizing SVG in Bun without a
native library (resvg/skia/sharp) is impractical.

## Decision

The canonical internal model is a **framebuffer**: an integer pixel grid + palette.
Drawing commands rasterize directly onto the grid (Bresenham, midpoint circle, flood
fill), with no anti-aliasing in pixel mode.

Output formats are **render targets over the framebuffer**, not the source of truth:

- **PNG** is encoded directly from the framebuffer using Bun's built-in zlib — **no
  native dependency required**.
- **SVG** is an optional target (pixels → `<rect>`s in pixel mode; primitives → shapes
  in smooth mode).
- **3D** later writes to the same framebuffer (+ a z-buffer) — the substrate is
  future-compatible.

## Consequences

- "No dependencies" is achievable for the core + PNG path. Only the SVG→raster path
  (not taken) would have forced a native dep.
- One Recipe can drive multiple render targets; the renderer decides pixel-exact
  (nearest, no AA) vs smooth (AA) vs SVG.
- Pixel-art Recipes are inherently resolution-specific; the primitives transfer across
  targets, the artwork does not 1:1.
- See also [ADR-0007](0007-visual-not-byte-determinism.md) — the framebuffer is the
  determinism boundary.
