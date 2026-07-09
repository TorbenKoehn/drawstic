# 36. Shapes are region constructors; paint makes the draw

- Status: Accepted (refined by [ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md): `fill`/`stroke` eliminators define the draw suffix; combined regions are paintable directly. Refined by [ADR-0066](0066-paint-first-painting-commands.md): §6's poly paint-first exception is now the rule — every painting command takes the paint first)
- Date: 2026-07-04
- Deciders: t.koehn, Claude

## Context

`circle` appeared in two seemingly different roles: as a drawing **statement**
(`circle 8:8 7 k` — has a paint, draws pixels) and as a **value** in mask expressions
(`circle(8:5, 4)` — no paint, yields a region, [ADR-0012](0012-masks-and-path-combination.md)).
The unified call model ([ADR-0015](0015-unified-call-model.md)) already makes the two
*surfaces* identical, but the *semantics* — when does a shape call draw, when is it a value,
and how does an author define their own shapes — were unspecified. Two `circle`s in one
language is exactly the kind of ambiguity priority 2/3 forbids.

## Decision

**1 — Shape callees are pure region constructors.** `rect`, `rrect`, `circle`, `ellipse`,
and `poly` construct a **Region** — a coverage region ([ADR-0012](0012-masks-and-path-combination.md)).
Called **without a paint**, the call is an ordinary expression yielding that Region, legal
anywhere an expression is (paren-form): `mask m = circle(8:5, 4).union(rect(6:5, 9:14))`.

**2 — The trailing `<paint> [fill] [w<N>]` is the draw suffix.** It is valid **only at
statement position** and means: *construct the region, then rasterize it* — outlined by
default, solid with `fill`, stroke width `w<N>`. `circle 8:8 5 r fill` ≡
`circle(8:8, 5, r, fill)` remains one call; the **effect comes from statement position +
draw suffix, never from the callee**. There is one `circle`, not two.

**3 — A shape statement without a paint is a positioned error** (*"region value dropped —
add a paint, or bind it with `mask <name> = …`"*). Constructing a value and discarding it
is always a bug; erroring serves error-robustness (priority 2).

**4 — `fn`s may return Regions.** Region expressions compose through ordinary functions,
so authors define custom shapes on the value side without any new mechanism:

```drw
fn ring(c, r) = circle(c, r).subtract(circle(c, r - 2))
mask m = ring(8:8, 6)
```

**5 — Custom *commands* stay parametric `draw` + `stamp`** ([ADR-0024](0024-parametric-drawings.md)).
User `fn`s remain pure/total ([ADR-0004](0004-total-not-turing-complete.md),
[ADR-0034](0034-standard-library.md)); effectful commands are engine-defined only. Value
side: region `fn`s (above). Effect side: `draw name(p…):` + `stamp`. Together they cover
"user-defined statements" without opening the determinism guarantees.

**6 — Scope note.** `poly`'s region form takes vertices only (`poly(p1, p2, p3)`); its
statement form stays **paint-first** (`poly k p1 p2 …`) — the documented exception, because
a variadic point tail parses robustly only with the paint out front. Path/effect primitives
(`line`, `arc`, `quad`, `bezier`, `text`, `px`, `flood`, `bg`, `move`, `stamp`) are
**statements only** in v1 — they depend on cursor/canvas state or are inherently effects.
A stroked-path region (e.g. `.stroke(w)`) is a noted extension, not specified now.

## Consequences

- The statement/value duality dissolves: masks need no special-cased shape grammar —
  `mask m = <region expr>` is just a binding, and §8's command table doubles as the region
  constructor list.
- The missing-paint error catches the most likely authoring slip.
- Painting a *combined* region needs no new command: clip with a `mask <m>:` block
  (`mask keyhole:` + `bg y`), per [ADR-0012](0012-masks-and-path-combination.md).
- Touches spec §4 (Region value row), §8 (constructor semantics), §9 (masks wording).
