# 58. Point arithmetic

- Status: Accepted (refined by [ADR-0059](0059-relative-point-expressions.md): unary minus accepts points, and `by` accepts point expressions)
- Date: 2026-07-06
- Deciders: t.koehn, Codex

## Context

Point literals are frequent in drawing code, and Recipes often need offsets and scales derived
from a base point. Without point arithmetic, agents must split coordinates into `.x`/`.y`
accesses or duplicate expressions:

```drw
p = 4:4
q = (p.x * 2):(p.y * 2)
```

The existing grammar parsed `4:4 * 2` as `4:(4 * 2)` because `:` bound looser than sum and
term expressions. That made the compact form unavailable and contradicted the visual reading
of a point literal as one value.

## Decision

1. **Point literals are arithmetic operands.** A point literal binds tighter than `*`, `/`,
   `//`, `mod`, `+`, and `-`, so:

   ```drw
   4:4 * 2
   4:4 + 1
   ```

   evaluate as `(4:4) * 2` and `(4:4) + 1`.

2. **Arithmetic is component-wise for points.** Arithmetic operators accept `number` and
   `point` operands. A number is promoted to `n:n` when paired with a point:

   ```drw
   4:4 * 2   # 8:8
   4:4 * 2:3 # 8:12
   4:4 + 1   # 5:5
   4:4 + 1:2 # 5:6
   ```

   The same rule applies to `-`, `/`, `//`, and `mod`.

   Refined by [ADR-0059](0059-relative-point-expressions.md): unary `-` also accepts a point,
   so `-(1:2)` evaluates to `-1:-2`.

3. **Composite coordinate expressions stay explicit.** Because `:` now binds tighter than
   arithmetic, coordinates that are themselves arithmetic expressions must be grouped:

   ```drw
   (x + 1):(y + 2)
   ```

## Consequences

- Point offsets and scaling become compact without new builtins.
- The grammar moves point literal parsing into the arithmetic operand tier.
- Existing Recipes with arithmetic inside point coordinates must use parentheses; current
  examples already do this for composite coordinate expressions.
