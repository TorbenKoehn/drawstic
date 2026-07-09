# 59. Relative point expressions

- Status: Superseded by [ADR-0061](0061-first-class-paths-and-local-pen-cursors.md)
- Date: 2026-07-07
- Deciders: t.koehn, Codex
- Refines: [ADR-0020](0020-cursor-line-and-by-point-operator.md), [ADR-0058](0058-point-arithmetic.md)

## Context

ADR-0020 made `by dx:dy` the relative-point spelling. ADR-0058 later made points ordinary
arithmetic operands, so common centered geometry can be written from an explicit center:

```drw
c = (i*16):8
r = i:i
rect c-r c+r k
```

That explicit form is the preferred idiom for closed shapes because it avoids using the
cursor as hidden anchor state. But the old `by dx:dy` grammar remained coordinate-shaped:
`rect by -(i:i) by i:i k` failed even though `-(i:i)` is the natural point-expression
spelling for a symmetric negative offset. Authors had to write `by (-i):(-i)`, which is
longer and less self-checking.

## Decision

**1 - `by` accepts a point expression.** A relative point is now `by <point-expr>`, not only
`by dx:dy`. Existing Recipes keep working because `by 10:0` is still a point expression.

```drw
move c
rect by -(i:i) by i:i k
```

The expression after `by` must evaluate to a point. A number alone is a type error; write
`by i:i` for a uniform offset.

**2 - Unary minus accepts points.** `-(x:y)` evaluates to `(-x):(-y)`, preserving relative
status if the operand is relative. This completes the point arithmetic model where `+ - * /
// mod` already operate component-wise.

**3 - Explicit center arithmetic is the idiom for centered closed shapes.** For rectangles
centered on `c` with half-extent `r`, the preferred form is:

```drw
rect c-r c+r k
```

Closed shapes still do not move the cursor. Relative points remain useful for cursor paths
and for deliberately cursor-anchored drawing, but they are not the recommended way to express
centered geometry.

## Consequences

- The parser no longer special-cases relative points as coordinate pairs; it marks an
  arbitrary point expression as relative.
- `by -(i:i)` and other point-derived relative offsets become legal without changing cursor
  semantics.
- No `box`/`centerRect` standard helper is added. Authors can define local region functions
  when the name is useful, but the core language stays on `rect` plus point arithmetic.
- Touches spec §5, §8, §10, §17; examples; parser/evaluator tests; and the `squares.drw`
  example.
