# 46. One namespace: palettes are ordered colour bindings plus an export artifact

- Status: Accepted (the palette-captures-a-value-binding collision half of point 2 is relaxed by [ADR-0073](0073-palette-namespace-for-pixel-cells.md); a `pal` key may now shadow a visible non-palette binding)
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Supersedes: the paint-vs-expression name resolution of [ADR-0033](0033-evaluation-and-scope-model.md) (its point 5); scope/evaluation rules (points 1–4) stand
- Refined by: [ADR-0049](0049-ascii-letter-pixel-keys.md), [ADR-0073](0073-palette-namespace-for-pixel-cells.md)

## Context

[ADR-0033](0033-evaluation-and-scope-model.md) resolved the palette-key/variable collision
**positionally**: in paint position a name meant the palette entry first, in expression
position the value binding first. That avoided a sigil — but at the price of
**context-dependent meaning**: the same identifier resolved differently depending on the
slot it sat in. That is itself a self-verifiability wart (priority 3): a reader must know
the slot type before knowing what `r` denotes, and the rule was the last remaining
"spooky" special case in the scope model.

There is a boring, standard alternative: **one namespace with ordinary lexical shadowing**,
plus a type check at the paint slot. And palettes have a second, underserved role the dual
namespace obscured: a palette is not just names — it is an **ordered artifact** that
palette-capable output formats (indexed PNG, Aseprite) should carry.

## Decision

**1 — `pal` defines ordinary colour bindings in the enclosing scope.** Each entry
`name = <colour expr>` is a normal binding (names arbitrary, single- or multi-char);
a draw-local `pal` binds into the draw's scope, a theme `pal` contributes entries that
`use` materializes at module scope (fold semantics unchanged,
[ADR-0005](0005-theme-composition-by-fold.md)). An entry that does not evaluate to a
**colour** (incl. `transparent`) is a positioned error.

**2 — One namespace; palette names are `const` and reserved — both directions, hard
errors.** A name in a paint slot is a plain scope lookup whose value must be a paint
(otherwise a positioned **type error**). Palette entries are **constants**:

- **Rebinding or mutating a visible palette name is a positioned error** — `k = row * 2`,
  `k += 1`, a loop variable `for k …`, or a `fn`/parametric-draw parameter named `k` all
  fail when a palette entry `k` is visible. No shadowing, no warning-and-continue.
- **Declaring a palette entry that collides with a visible non-palette binding is equally
  a positioned error** — a local `pal` may not capture a module-scope variable's name.
- The **only** legal redefinition channel is **palette-to-palette composition**: the theme
  fold and a drawing-local `pal` overriding an entry *by name* (later wins,
  [ADR-0005](0005-theme-composition-by-fold.md)) — that is composition-time merging, not
  scoped shadowing.

This mirrors the stdlib rule (user `fn`s cannot shadow built-ins,
[ADR-0034](0034-standard-library.md)): the palette is the recipe's **colour vocabulary**,
and a vocabulary word means the same thing on every line (self-verifiability, priority 3).
Palette entries are usable in expressions like any binding — no "fallback" machinery.

**3 — Pixel cells remain the one palette-table context.** Inside `pixels:` rows a
character resolves against the **palette table only** (single-char entries of the active
palette), never against arbitrary scope bindings — rows are literal cells, not expressions
([ADR-0002](0002-hybrid-primitives-and-indexed-palette.md), [ADR-0032](0032-lexical-robustness.md)).
This is bounded and literal-like (akin to string contents), not a resolution rule.

**4 — The palette is also an artifact.** A `pal` additionally records an **ordered
key → colour table** on the drawing (theme + local entries after the fold, in declaration
order). Palette-capable exports honour it: a `png` format line accepts an **`indexed`**
flag that writes an indexed-colour PNG with the authored palette in authored order
(auto-completion from rendered colours is refined by
[ADR-0055](0055-indexed-png-auto-palette-completion.md); > 256 final entries is a
positioned error);
`aseprite` sidecars carry the table. Non-palette formats ignore it — the artifact is
metadata, never a rendering input.

## Consequences

- The scope model becomes one sentence: *names are lexically scoped; paint slots
  type-check; palette names are const and reserved.* No positional resolution table to
  memorize; palette entries are just the most common colour bindings — frozen ones.
- The collision ADR-0033 dissolved by context is now **rejected loudly**: rename the
  variable or rename the palette key — a deliberate trade of a rare rename for the
  guarantee that a colour name never silently changes meaning mid-recipe.
- Palettes gain their missing output half: authored palette order survives into indexed
  PNG / Aseprite — pixel-art tooling round-trips.
- Supersedes ADR-0033 point 5; its scope/evaluation/mutation rules (points 1–4) are
  untouched. Touches spec §4 (colour row), §10 (name resolution), §12 (palettes,
  applying a theme), §13 (`indexed` flag), §18 (Q8 note).
