# 23. Curve & shape primitives; stroke width via `w<N>`

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude

## Context

[Spec §8](../language-spec.md#8-drawing-primitives) offered only `line`/`rect`/`circle`/
`poly` — a heavy **pixel-art bias**. Two costs:

- It left the **smooth/SVG branch** ([ADR-0013](0013-render-mode-pixel-vs-aa.md)) almost
  unusable for real vector icons, which are *curves*: an arrow, a heart, a speech bubble are
  Béziers and arcs, not Bresenham lines.
- There was **no rounded rect and no thick stroke** despite the style guides themselves
  asking for a "2px solid outline" ([spec §12](../language-spec.md#themes--a-dual-artifact)) —
  the language demanded something it could not draw.

## Decision

All of the following are statements / calls ([spec §3](../language-spec.md#3-lexical-structure)),
fully deterministic.

**New primitives:**

```drw
ellipse 8:8 6:4 k fill          # midpoint ellipse; rx:ry is a point-shaped radius pair
arc 8:8 6 0 90 k                # circular arc, angles in degrees
quad 0:0 8:0 8:8 k              # quadratic Bézier: p0, control, p2
bezier 0:0 4:0 4:8 8:8 k        # cubic Bézier: p0, c1, c2, p3
rrect 0:0 15:15 3 k fill        # rounded rect, corner radius 3
```

- `ellipse <center> <rx>:<ry> <paint> [fill]` — midpoint ellipse; the radius pair is a
  point literal (`rx:ry`).
- `arc <center> <r> <a0> <a1> <paint>` — circular arc; angles in **degrees** (0° = +x,
  clockwise in the raster convention, [spec §5](../language-spec.md#5-coordinate-system)).
  Relies on the bundled deterministic trig of [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md).
- `quad <p0> <c1> <p2> <paint>` and `bezier <p0> <c1> <c2> <p3> <paint>` — quadratic / cubic
  Béziers, **flattened by a FIXED, documented subdivision rule** (deterministic; the flattening
  tolerance is pinned by [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)), then
  rasterized.
- `rrect <a> <b> <r> <paint> [fill]` — rounded rectangle; corner radius `r` drawn as
  quarter-arcs at the four corners.

**Stroke width — a trailing `w<N>` token.** Any stroking command takes an optional trailing
`w<N>` (default `1`), mirroring `scale<N>` / `@N`
([spec §9](../language-spec.md#9-composition-transforms--masks), [spec §13](../language-spec.md#13-output--the-export-element)):

```drw
line by 10:0 k w2               # 2px stroke
circle 8:8 6 k w2               # 2px outline — the "2px solid" the style guides assume
```

- **PIXEL mode:** a width-`N` stroke is a **disk/square brush of diameter N** stamped along
  the path (default cap = round disk, join = round); pixel-exact, no AA.
- **SMOOTH mode:** a true stroked vector path; default `cap butt`, `join miter`, overridable
  by `cap butt|round|square` / `join miter|round|bevel` flags.

## Consequences

- Makes smooth/SVG export *meaningful* — vector icons are finally expressible — and gives the
  "2px outline" the style guides assume a **first-class** form instead of hand-stamped pixels.
- `arc`, `quad`, `bezier` are the **first primitives that REQUIRE the bundled deterministic
  math** (trig + fixed Bézier flattening) — forward-ref [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md).
- `circle` stays as the common special case of `ellipse` (`rx == ry`); no churn to existing
  recipes.
- Touches spec §8 (new primitives, `w<N>`, cap/join flags) and §17 (grammar).
