# 41. Rename the `grid:` block to `pixels:`

- Status: Accepted
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Refines: [ADR-0002](0002-hybrid-primitives-and-indexed-palette.md), [ADR-0032](0032-lexical-robustness.md) (rules unchanged, keyword renamed)

## Context

The hand-pixeled bitmap block was introduced as `grid:`. "Grid" was the wrong word on two
counts. First, it names the *arrangement*, not the *act*: the block means "I am placing
these pixels by hand", and its natural reading pairs with the `px` command (one pixel ↔
all pixels). Second, "grid" was already overloaded three ways elsewhere in the spec: the
**tileset layout** ("tiles baked into a grid", §9), the **integer pixel grid** of the
framebuffer, and the **1/16 subpixel grid** of smooth mode ([ADR-0040](0040-mode-scoped-coordinate-quantization.md)) —
so the keyword collided with established terminology instead of standing apart from it.

Alternatives considered: `px:` (collides with the `px` command), `bitmap:`/`raster:`
(implementation nouns, not authoring verbs), `sprite:` (already rejected as an alias,
spec §18 Q6), `rows:`/`art:`/`image:` (structure or vagueness, not meaning).

## Decision

**The block keyword is `pixels:`.** Everything else — explicitness (§18 Q4), size
inference ([ADR-0021](0021-optional-canvas-size-resolution.md)), single-character palette
keys, the no-space / no-inline-comment row rules ([ADR-0032](0032-lexical-robustness.md)) —
is unchanged:

```drw
draw heart 5x5:
  pal .=transparent  k=#1a1a1a  r=#c04040
  pixels:
    .r.r.
    rrkrr
    rrrrr
    .rrr.
    ..r..
```

Terminology follows the keyword: "grid literal" → **pixel literal**, "grid key" →
**pixel key**, "grid cell" → **pixel cell**. "Grid" now refers exclusively to layout
(tileset) and coordinate lattices (pixel grid, subpixel grid).

## Consequences

- One token, same cost; the keyword now says what the author is doing and frees "grid"
  from a three-way overload — self-verifiability by vocabulary.
- Spec (§2, §3, §4, §6, §7 incl. heading/anchor, §12, §16, §17, §18) and
  [dsl-examples.md](../dsl-examples.md) updated; the §7 anchor changes, so older ADR links
  to `#7-grid-literals--explicit-pixels` are retargeted.
- Older ADR *prose* (0002, 0021, 0030–0032) keeps saying "grid" — ADRs are historical
  records; this ADR is the rename record. Bench corpus files are measurement inputs and
  keep their authored syntax.
