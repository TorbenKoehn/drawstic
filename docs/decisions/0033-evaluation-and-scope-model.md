# 33. Evaluation & scope model; paint-vs-expression name resolution

- Status: Accepted (point 5 — paint-vs-expression name resolution — superseded by [ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md); points 1–4 stand; block-scope/mutability refined by [ADR-0081](0081-loop-persistent-rebinding-and-theme-scope-edges.md) — `=` now reassigns an in-scope mutable binding like `+=`)
- Date: 2026-06-17
- Deciders: t.koehn, Claude
- Resolves: spec open questions 8 and 9

## Context

The spec never pinned the **evaluation model**: order of definitions, whether module-level
`=` bindings exist, whether a `for`/`if` body leaks names, or how the
palette-name-vs-variable shadowing — the [ADR-0009](0009-first-class-colours-gradients-filters.md)
residual, [spec open question 8](../language-spec.md#18-open-questions-for-review) —
resolves. Without these, "self-verifiable" output ([§1](../language-spec.md#1-design-priorities) #3)
isn't actually predictable: the same source could mean different things under different
assumed scoping.

## Decision

**1 — Definitions are module-level and order-independent.** `draw`, `fn`, `theme`, `grad`,
`filter`, `mask`, `tileset`, `atlas`, and `export` may reference each other **forward** —
declaration order does not matter. (Cross-module import cycles remain errors,
[ADR-0035](0035-import-sandbox-and-std-modules.md)).

**2 — Statements execute top-to-bottom.** Inside a `draw` body, statements run in source
order (imperative paint order). **Each `draw` render is independent** and starts the cursor
at `0:0`.

**3 — Bindings (`=`) and lexical scope.** `=` bindings are allowed at **module scope**
(shared constants, e.g. `TILE = 16`) and inside any body. A binding is visible **from its
line to the end of its enclosing block**. `for` / `if` / `repeat` / `match` introduce a
**child scope**: the loop variable and any binding made inside do **not** leak out.
Evaluation is **eager**.

**4 — Mutation (`+=` etc.) — resolves open question 9.** Compound assignment is **kept**,
but mutates **only a binding already in scope**. This resolves Q9 in favour of mutable loop
accumulators, bounded by the runtime budget ([ADR-0004](0004-total-not-turing-complete.md)).
There are **no closures over mutable state across draws** — mutation cannot escape its
draw.

**5 — Name resolution — resolves open question 8 structurally, no sigil.** The same name
resolves differently by **position**:

- In **paint position** — a `<paint>` argument slot, or a grid cell — a single- or
  multi-char name resolves to a **palette entry first**.
- In **expression position** a name resolves to a **value binding first**.

So `r` is red where a colour is expected and a variable in `r = row*2`. The long-standing
`y`/`r`/`x` palette-key vs loop-variable collision **disappears without a marker** —
consistent with [ADR-0018](0018-idiom-alone-does-not-justify-a-marker.md) ("idiom/markers
only when they resolve a real ambiguity"; here position already disambiguates).

## Consequences

- Makes output predictable from source alone ([§1](../language-spec.md#1-design-priorities) #3):
  scope, order, and the dual namespace are now defined, not guidance.
- Resolves [open questions 8 and 9](../language-spec.md#18-open-questions-for-review).
- **Supersedes** the "avoid reusing palette key letters as variable names" guidance in
  [ADR-0009](0009-first-class-colours-gradients-filters.md): reuse is now well-defined, not
  discouraged.
- Forward references make definition ordering a non-issue for authors; child-scope loop
  variables prevent the most common leak bug.
- Touches spec §10 (scope, evaluation), §11 (loop-variable scope), §12 (palette-name
  resolution), §18 (resolves Q8, Q9).
