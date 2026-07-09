# 28. Rasterization semantics: flood connectivity, clipping, centering, endpoints

- Status: Accepted (primitive-outline definition refined by [ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md): outlines are the extensional 4-inner-boundary of the filled region; circle parity superseded by [ADR-0056](0056-even-diameter-circle-rasterization.md))
- Date: 2026-06-17
- Deciders: t.koehn, Claude

## Context

[Spec §14](../language-spec.md#14-determinism) claims a **pixel-identical** framebuffer, but
several pixel-affecting rules were never written down. Until they are, "pixel-identical" is
**unenforceable** — two conforming engines could legitimately differ on:

- how far a `flood` spreads (4- vs 8-connected; equality test),
- what happens when a draw or `stamp` falls partly or wholly off-canvas,
- exactly which pixels a `circle`/`ellipse` covers (centering, parity of the diameter),
- whether a `line`'s endpoints are drawn.

These are not new features; they are the **unspecified semantics of existing primitives**
([spec §8](../language-spec.md#8-drawing-primitives)). Pin each.

## Decision

**1 — `flood` is 4-connected.** `flood <pt> <paint>` fills the **maximal region of pixels
exactly RGBA-equal** to the seed pixel's colour, spreading **4-connected** (N/E/S/W, never
diagonally). Equality is exact on committed RGBA (the fixed domain of
[ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)), so antialiased edges bound the
fill naturally. The fill is bounded by the runtime budget ([spec §15](../language-spec.md#15-runtime-budget-totality)).

**2 — Out-of-bounds is silently clipped.** Every draw and every `stamp` is **clipped to the
canvas**. Negative coordinates and coordinates ≥ `w`/`h` are **legal** and simply produce no
pixels where they fall outside; they are **not** an error. A `stamp` may hang off **any** edge
(or all of them) and only its on-canvas pixels are written. This keeps procedural and
mirrored/offset composition ([spec §9](../language-spec.md#9-composition-transforms--masks))
robust without per-call bounds guards.

**3 — `circle`/`ellipse` centering is integer and symmetric.** The original rule pinned
`circle <c> <r>` to an odd `2r+1` footprint centered on the integer pixel `c`; this circle
parity rule is superseded by [ADR-0056](0056-even-diameter-circle-rasterization.md), which
uses an even `2r` footprint for `r > 0`. `ellipse` keeps its existing integer-radius
semantics.

**4 — `line` endpoints are inclusive; Bresenham is the reference.** A `line` draws **both**
its start (the cursor) and end pixel — endpoints inclusive. **Bresenham** is the reference
rasterizer. Cursor advance is unchanged ([spec §5](../language-spec.md#5-coordinate-system),
[ADR-0020](0020-cursor-line-and-by-point-operator.md)): `line`/`poly` advance the cursor to
their end / last vertex.

## Consequences

- The [§14](../language-spec.md#14-determinism) pixel-identity claim becomes **testable**:
  golden tests now have a single correct answer for floods, off-canvas stamps, and circle
  parity.
- **No new syntax** — this pins the semantics of primitives that already exist.
- Authors get a clear mental model: pinned circles, inclusive lines, clip-don't-error, exact-
  colour 4-connected floods.
- Touches [spec §5](../language-spec.md#5-coordinate-system) (endpoints/cursor),
  [§8](../language-spec.md#8-drawing-primitives) (primitive semantics), and
  [§14](../language-spec.md#14-determinism) (enforceability).
