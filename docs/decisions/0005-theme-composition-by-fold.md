# 5. Theme composition by ordered fold, not inheritance

- Status: Accepted (refined by [ADR-0081](0081-loop-persistent-rebinding-and-theme-scope-edges.md) — a theme body holds only pal/grad/size/mode/font/style/`with` + filter/draw definitions; a free binding there is E004)
- Date: 2026-06-13
- Deciders: t.koehn, Claude

## Context

Themes need to share a base style and specialize it per category (creatures, UI, …).
The obvious mechanism, inheritance (`extends`), risks the **diamond problem** under
multiple bases. The requirement is explicit: prevent diamonds, prefer composition.

## Decision

Themes **compose** via an ordered parts list (`with a, b`), resolved as a
**deterministic linear fold** — never a dispatch hierarchy. There is no `extends`.

**Merge semantics:**

- **Order:** parts flattened depth-first in declaration order, folded left → right,
  **later wins**; local definitions fold last and always win.
- **Palette:** key-wise union; later source wins on conflict.
- **Style:** ordered concatenation of fragments, sectioned by source, identical
  fragments deduplicated.
- **Base drawings / canvas defaults:** by name, last wins.

## Consequences

- The diamond problem **cannot arise**: it is an ambiguity of *method resolution* under
  multiple inheritance. With an ordered data fold there is no dispatch and no ambiguity —
  a part reached via two paths simply folds twice (idempotent if equal, last-wins if
  not). No MRO, no C3 linearization.
- The resolver can always produce a fully merged result, enabling the design brief
  ([ADR-0008](0008-cli-design-brief.md)) and **conflict warnings** (e.g. "key `k` from
  `pixel-base` overridden by `warm-pal`").
- Order is significant and must be documented; long chains can bloat style text.
