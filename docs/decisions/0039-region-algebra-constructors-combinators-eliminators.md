# 39. The region algebra: constructors, combinators, eliminators

- Status: Accepted (refined by [ADR-0044](0044-first-class-transforms.md): `.shift`/`.scale` are sugar over `.transform(t)`; the region-rotation deferral is resolved via explicit `.about(pt)` anchors. Refined by [ADR-0066](0066-paint-first-painting-commands.md): eliminators and the draw sugar are paint-first — `fill <paint> <region>`, `stroke <paint> <region> [wN]`)
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Refines: [ADR-0012](0012-masks-and-path-combination.md), [ADR-0028](0028-rasterization-semantics.md) (outline definition), [ADR-0036](0036-shapes-as-region-constructors.md)

## Context

[ADR-0036](0036-shapes-as-region-constructors.md) made shapes region constructors, but the
algebra was incomplete, and a PL-critical review found four gaps:

1. **No direct eliminator.** Building a combined region and *painting it* required a
   `mask <m>:` block + `bg` — two lines and an indirection for the most natural operation
   ("build shapes, combine them, draw them").
2. **No placement.** A bound or imported region is frozen at its authored coordinates;
   reuse elsewhere was impossible (fn parameters cover constructor-built shapes, but not
   *values* you already hold).
3. **No bridge from drawings.** A drawing's silhouette is the most obvious reusable shape,
   but Drawing → Region did not exist.
4. **The paint suffix was principled but not *defined*.** Is `circle 8:8 5 k` vs
   `circle(8:8, 5)` currying? No — currying is partial application returning a function;
   the paint-less call returns a *value*, not a function awaiting paint. It is **arity
   overloading**, and undefined overloading is exactly what priorities 2/3 forbid. It needs
   a desugaring semantics.

Additionally, the primitive-outline definition ([ADR-0028](0028-rasterization-semantics.md))
was *intensional* (midpoint algorithm on the constructor), which would make a future
"outline of a combined region" depend on provenance — two extensionally equal regions could
stroke differently, breaking referential transparency.

## Decision

**1 — The value/effect algebra is the standard.** Every value domain has pure
**constructors** and **combinators** (usable anywhere, expression position) and named
**eliminators** — the *only* effects, legal *only* at statement position:

| Domain | Constructors | Combinators | Eliminators |
|--------|--------------|-------------|-------------|
| Region | `rect` `rrect` `circle` `ellipse` `poly` (paint-less), `region(d)` | `.union` `.intersect` `.subtract` `.xor` `.shift` `.scale` | `fill`, `stroke`, `mask …:` block |
| Drawing | `draw` definition (+ parametric instantiation) | — (v1) | `stamp`, `export` |
| Colour/Gradient | literals, `rgb`/`oklch`/…, `linear`/`radial` | `lighten`/`mix`/… | consumed by paint slots |

This is command–query separation enforced by the grammar: expressions are total and pure
([ADR-0004](0004-total-not-turing-complete.md)); statements have effects.

**2 — Eliminators `fill` and `stroke`.** Any region expression can be painted directly:

```drw
fill <region> <paint>              # rasterize the region solid
stroke <region> <paint> [w<N>]     # rasterize the region's inner boundary, width N (default 1)
```

```drw
mask keyhole = circle(8:5, 4).union(rect(6:5, 9:14))
fill keyhole y                     # draw the combined shape — one line
stroke ring(8:8, 6) k w2           # region-returning fns compose (ADR-0036)
```

In-distribution: this is Canvas2D/SVG `fill()`/`stroke()`.

**3 — The paint suffix is *defined* as eliminator sugar.** The flag names the eliminator:

- `circle 8:8 5 k` ≡ `stroke circle(8:8, 5) k`
- `circle 8:8 5 k fill` ≡ `fill circle(8:8, 5) k`
- `circle 8:8 6 k w2` ≡ `stroke circle(8:8, 6) k w2`

Not currying — **eliminator sugar**: constructor + draw suffix desugars to one pure
constructor call inside one effectful eliminator. The overloading of [ADR-0036](0036-shapes-as-region-constructors.md)
now has a single defining equation instead of two informal readings. `poly`'s paint-first
statement form remains sugar-level only (ADR-0036 §6); its desugaring target is the same.

**4 — Regions are extensional; `stroke` is a function of the coverage set.**
A Region *is* its coverage — never its construction history. In pixel mode:

- `fill R` paints every pixel of `R`.
- `stroke R w1` paints the **4-inner-boundary**: pixels of `R` with at least one 4-neighbour
  outside `R` (outside the canvas counts as outside).
- `stroke R wN` paints `R \ erode4^N(R)` (N-fold 4-erosion — the inner band of width N).

This **refines [ADR-0028](0028-rasterization-semantics.md)**: the filled disc/span
definitions stay the reference; primitive *outlines* are now pinned to the inner boundary
of their filled region (the midpoint outline remains the mental model; where the two differ
by a corner pixel, the extensional rule wins). Referential transparency holds: equal
coverage ⇒ equal stroke. Smooth mode uses the deterministic coverage-band analogue, pinned
per language version ([ADR-0029](0029-language-version-pragma.md)).

**5 — Placement combinators.** Two pixel-safe, frame-free transforms:

- `.shift(dx:dy)` — exact integer translation.
- `.scale(N)` — integer scale about the origin `0:0`, nearest-neighbour coverage
  (coordinates ×N), mirroring `scale<N>` on `stamp`.

Flips/rotations on regions are **deferred**: they need a reference frame (a pivot), and no
canonical one exists for an arbitrary coverage set. `shift` is chosen over an
`.at(pt)`-style bbox placement because its result is predictable without knowing the bbox
(self-verifiability, priority 3).

**6 — The Drawing → Region bridge: `region(d)` / `d.region`.** The **silhouette** of a
drawing as a Region: pixels with alpha > 0 in pixel mode, alpha coverage in smooth mode.
Accepts a drawing name or a parametric instantiation (mirroring `stamp`):

```drw
mask m = gem.region.scale(2).shift(4:4)   # any drawing is a reusable, placeable mask
```

The reverse direction needs nothing new: a region becomes pixels via `fill`/`stroke`, and
a clipped composition via the `mask <m>:` block.

**7 — What a drawing *is*, and what it is not.** A Drawing is a **bitmap value**
(pixels + size) — a data structure, addressable by name, instantiable with parameters,
bridgeable to a Region. It is **not a vector path**, and neither is a Region: both are
framebuffer-native ([ADR-0001](0001-framebuffer-first-core.md), [ADR-0012](0012-masks-and-path-combination.md));
an engine may keep regions symbolic internally, but the *semantics* are per-pixel coverage.
Drawings stay second-class in expressions in v1 (no `d = …` binding, no fn returning a
drawing) — first-class images (e.g. filters as `Drawing → Drawing` functions) are a noted
extension that this algebra accommodates without change.

**8 — Functions stay first-order.** `fn`s are named, total, pure definitions — **not
values**: no closures, no partial application, no currying. Parametrisation is the
composition mechanism (fn parameters; parametric draws, [ADR-0024](0024-parametric-drawings.md)).
This keeps `drawstic check` able to resolve every call site statically and keeps the
totality argument ([ADR-0004](0004-total-not-turing-complete.md)) trivial.

**9 — Path-to-region stays out (v1).** `line`/`arc`/`quad`/`bezier` remain statements only;
a "thickened path as region" combinator is a noted extension (unrelated to the `stroke`
eliminator above, which operates on regions).

## Consequences

- The user-facing story is complete and compositional: **build** (constructors + fns) →
  **combine** (set-ops) → **place** (`shift`/`scale`) → **use** (`fill`/`stroke` to draw,
  `mask` to clip) — and any drawing joins the algebra via `region()`.
- Supersedes ADR-0036's consequence "painting a combined region needs no new command";
  the mask-block route still works but is no longer the only one.
- The suffix desugaring gives the checker one canonical form; diagnostics and `fmt` can
  normalize to it internally.
- Extensional `stroke` changes primitive outlines by at most corner pixels vs classic
  midpoint — acceptable under visual determinism ([ADR-0007](0007-visual-not-byte-determinism.md)),
  pinned by version ([ADR-0029](0029-language-version-pragma.md)).
- Touches spec §4 (Region row), §8 (eliminators + suffix sugar), §9 (combinators, bridge),
  §10 (first-order fns), §18 (consistency-pass note).
