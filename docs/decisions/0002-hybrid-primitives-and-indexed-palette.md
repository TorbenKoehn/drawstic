# 2. Hybrid primitives + indexed single-char palette

- Status: Accepted (colour-model aspect superseded by [ADR-0009](0009-first-class-colours-gradients-filters.md))
- Date: 2026-06-13
- Deciders: t.koehn, Claude

## Context

How should an agent describe a sprite? Two modes exist and neither alone is enough:

- **Grid/bitmap literals** (ASCII-art-style) are the most direct and most
  in-distribution way for an LLM to express a hand-designed sprite, but scale poorly to
  large or parametric images.
- **Procedural primitives** (line/rect/circle/fill on the integer grid) are DRY and
  parametric, but awkward for irregular, organic sprites — which pixel art often is.

The original DSL had only procedural primitives; the grid literal — arguably the
central primitive — was missing.

## Decision

Support **both as first-class, co-equal primitives**, plus `stamp` to place sub-drawings.
A drawing body may freely mix a `grid:` block, procedural commands, and stamps.

Colors are **palette-indexed with single-character keys** (`k`, `y`, `.`). Raw `#hex`
appears only in palette definitions.

The language is **declarative-first**: grids, palettes, stamps, exports are pure
declarations; expressions/loops/functions are an opt-in escape hatch. Separators have
**one job each**: **whitespace** separates a command's arguments; **comma** separates
**sequence elements** (list literals, call arguments, parameters, destructuring), which
makes bracket-less list literals work (`x = 1, 2, 3`). Comma has a single meaning and is
never overloaded with command-argument separation.

## Consequences

- Covers both hand-designed icons and generated scenes — the real, harder requirement.
- Single-char keys keep grid rows aligned and token-light, mirror indexed-PNG, and make
  **theming** clean: a theme is a palette (same keys, different hex) + style + parts.
- Removing comma/`:`-overloading is the single biggest robustness win over the original
  dense infix design.
- Slightly more language surface (two authoring modes) to specify and test.
