# 54. Standard fonts are Recipe modules

- Status: Accepted
- Date: 2026-07-06
- Deciders: t.koehn, Claude
- Refines: [ADR-0022](0022-text-and-bitmap-fonts.md), [ADR-0035](0035-import-sandbox-and-std-modules.md), [ADR-0042](0042-user-defined-fonts.md)

## Context

Drawstic originally shipped `small` and `micro` as TypeScript bitmap tables in `src/fonts.ts`.
That kept text deterministic, but made bundled fonts a separate implementation-only path from
user-defined fonts. After [ADR-0042](0042-user-defined-fonts.md), fonts are first-class Recipe
definitions, so std fonts should use the same authored format as user fonts.

The standard library already resolves bundled `std/` modules through [ADR-0035](0035-import-sandbox-and-std-modules.md).
Fonts need the same behavior: globally available defaults, but also normal optional imports for
agents that want explicit context.

## Decision

**1 - `small` and `micro` live under `std/fonts/`.** The bundled faces are authored as
`src/std/fonts/small.drw` and `src/std/fonts/micro.drw`, each containing a normal `font`
definition with inline glyph bodies.

**2 - Standard fonts are globally registered.** `small` and `micro` resolve without an import,
including default text rendering and scoped `font small` / `font micro` directives.

**3 - Standard fonts remain importable.** Authors may write:

```drw
from std/fonts/small small
font small
```

The import is optional and uses the same `std/` module machinery as other standard-library
modules.

**4 - Fallbacks resolve through font resolution.** `with small` in a user font resolves the
standard font definition instead of a TypeScript-only bundled bitmap. Fallback cycles are font
errors.

**5 - String escapes cover font glyph keys.** Normal string literals support `\"` and `\\` so
standard fonts can define quote and backslash glyphs in Recipe source.

## Consequences

- `src/fonts.ts` no longer owns the `small` / `micro` glyph data; it only holds shared font helpers.
- `std.ts` imports bundled `.drw` files with `{ type: 'text' }`; std modules are no longer inline
  Recipe strings.
- The user-font rendering path now handles the bundled faces, so performance may need glyph
  caching if large text workloads become common.
- `micro` preserves its previous lowercase behavior by explicitly defining lowercase glyphs.
