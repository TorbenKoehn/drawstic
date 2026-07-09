# 12. Masks & path combination as coverage buffers

- Status: Accepted
- Date: 2026-06-14
- Deciders: t.koehn, Claude

## Context

The language needs to combine shapes/paths (union, intersect, subtract, xor), turn the
result into a **mask**, and clip other drawing — e.g. a stamp — to it. This must stay
deterministic and fit the framebuffer-first core ([ADR-0001](0001-framebuffer-first-core.md))
rather than introduce a separate vector/region engine.

## Decision

A **mask is a coverage buffer** — per-pixel coverage, **1-bit in pixel mode, alpha in
smooth mode** ([ADR-0013](0013-render-mode-pixel-vs-aa.md)). Shapes are also regions;
combining them is a **per-pixel coverage operation**, so path booleans are mask booleans.

- Set-ops via **UFCS** (consistent with [ADR-0010](0010-ufcs-method-style-calls.md)),
  not overloaded arithmetic operators: `a.union(b)`, `a.intersect(b)`, `a.subtract(b)`,
  `a.xor(b)`.
- Apply a mask as a **`mask <m>:` block** (clips all drawing inside) or **inline** on a
  stamp (`stamp crest 4:4 mask keyhole`).
- A `mask` is a top-level value (importable) or drawing-local.

## Consequences

- Fully deterministic and framebuffer-native; no separate vector boolean engine.
- Coverage operations are well-defined in both modes (1-bit set logic; alpha
  min/max/`a·(1−b)` for smooth), preserving visual determinism
  ([ADR-0007](0007-visual-not-byte-determinism.md)).
- UFCS keeps `&`/`|`/`-` free for arithmetic/logic; symbolic set-ops remain a reviewable
  alternative (spec open question 12).
