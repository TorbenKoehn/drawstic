# 25. Alpha compositing model (supersedes 1-bit transparency)

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude
- Supersedes: the "1-bit transparency for v1" clause of [spec §9](../language-spec.md#9-composition-transforms--masks)
- Refines: [ADR-0007](0007-visual-not-byte-determinism.md), [ADR-0009](0009-first-class-colours-gradients-filters.md)

## Context

The colour model is **full-alpha** — `#rrggbbaa`, `.alpha(80%)`, `transparent`
([spec §4](../language-spec.md#4-values--types) / [§12](../language-spec.md#colour-values)) — but
[spec §9](../language-spec.md#9-composition-transforms--masks) froze compositing at *"1-bit
transparency for v1"*. That is a **contradiction**: a 50%-alpha pixel drawn over another pixel
had an **undefined** result. Undefined also means **non-deterministic**
([ADR-0007](0007-visual-not-byte-determinism.md)) — two engines could disagree. The first-class
colour model ([ADR-0009](0009-first-class-colours-gradients-filters.md)) wrote a cheque the
compositor could not cash.

## Decision

**1 — The framebuffer stores straight-alpha RGBA8** (8 bits per channel).

**2 — Compositing is Porter-Duff source-over, straight alpha, fixed rounding.** Done in
integer / fixed-point math with **round-half-up** on the 0..255 result, so it is fully
deterministic. For source `s` over destination `d` (alphas `a_s`, `a_d` in 0..1):

```
out_a = a_s + a_d·(1 − a_s)
out   = (src·a_s + dst·a_d·(1 − a_s)) / out_a        # per channel, round-half-up
```

The exact reference math (fixed-point form, rounding) is pinned by
[ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md).

**3 — Applies uniformly.** `px`, every primitive painted with an alpha colour or gradient, and
`stamp` all composite through this rule. `stamp` now **honours source alpha** instead of the
old 1-bit test. **Fully transparent (`a = 0`) pixels are never written** — so a transparent
grid cell or `transparent` paint is a no-op, preserving today's behaviour at the limit.

**4 — PIXEL mode stays anti-aliasing-FREE.** Alpha enters **only** from explicit alpha colours
/ gradients, **never from edge coverage** — silhouettes stay crisp
([ADR-0013](0013-render-mode-pixel-vs-aa.md) unchanged). Partial alpha is a **stored value**,
not edge softening:

```drw
px 4:4 #c04040aa                # 67% red, composited over whatever is there
bg #ffffff
rect 2:2 9:9 #00000080 fill     # 50% black overlay — defined, deterministic result
```

**5 — Blend modes beyond source-over** (`multiply`, `screen`, …) are a noted **extension**, not
v1. The core compositor exposes only source-over.

## Consequences

- **Supersedes** the "1-bit transparency for v1" clause of [spec §9](../language-spec.md#9-composition-transforms--masks)
  and aligns the compositor with the first-class colour model
  ([ADR-0009](0009-first-class-colours-gradients-filters.md)) — alpha colours now mean something
  everywhere they are accepted.
- **Determinism is preserved** via integer math + a fixed rounding rule, refining
  [ADR-0007](0007-visual-not-byte-determinism.md) rather than weakening it; the "undefined
  result" hole is closed.
- The crisp pixel-art look is untouched: no coverage AA in pixel mode, so existing sprites are
  byte-for-pixel identical at `a ∈ {0, 255}`.
- Touches spec §9 (stamp + compositing) and §14 (determinism — fixed compositing rounding).
