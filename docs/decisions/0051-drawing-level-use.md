# 51. Drawing-level `use` — apply a theme to a single drawing

- Status: Accepted
- Date: 2026-07-05
- Deciders: t.koehn, Claude
- Resolves: spec open question 7 (re-resolved; was "file-level for now")

## Context

`use` was file-level only ([spec §12](../language-spec.md#12-colour-gradients-filters--themes));
open question 7 deferred a per-`draw` `use` until evidence demanded it. The per-entry
overrides (drawing-local `pal`/`grad`/`filter`) cover one-off tweaks, but not the real
case: **one drawing in a module belongs to a different set** — an icon sheet with one
dark-mode variant, a scene stamping parts from two styles. Today that forces splitting
the module by theme, an organizational constraint the content does not have. Per-drawing
palette scopes ([ADR-0050](0050-single-letter-palettes-combined-by-composition.md)) make
this natural: a drawing already owns its key scope; it should be able to own its theme.

## Decision

**1 — `use` is legal inside a `draw` body.** Same directive, same forms (`use dusk` local,
`use themes dusk` imported), same resolution rules (§2). It applies the theme **to that
drawing only** — palette entries, gradients, filters, and the `size`/`mode`/`font`
defaults.

**2 — Fold order (standard fold, later wins,
[ADR-0005](0005-theme-composition-by-fold.md)):** engine defaults → file-level `use` (in
declaration order) → **drawing-level `use`** (in declaration order) → drawing-local
`pal`/`grad`/`filter` entries. A drawing-level theme overrides same-name entries from the
file theme through the composition channel — not scoped shadowing; the const/reserved
rules of [ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md) hold
unchanged within the drawing's scope.

**3 — `use` lines must lead the body.** A drawing-level `use` before any other statement
is the only legal position (positioned error otherwise) — the drawing's vocabulary is
declared before it is used, never rebound mid-body (self-verifiability; mirrors the
module level, where `use` conventionally leads the file).

```drw
use themes dusk                # file-level default

draw moon-icon 16x16:
  use themes midnight          # this drawing only: midnight's palette + defaults
  pal g = #7a86b8             # local override folds last, as always
  circle 8:8 6 g fill
```

## Consequences

- Re-resolves open question 7: mixed-theme modules work; file splits are organizational
  again, not semantic.
- Grammar: `drawstmt` gains `use` (leading position enforced semantically, not in the
  EBNF sketch).
- No existing recipe changes meaning — the construct is purely additive.
- Touches spec §6 (draw body list), §12 (applying a theme), §17 (grammar), §18 (Q7);
  [dsl-examples](../dsl-examples.md) §5.
