# 94. Language diet: drop redundant constructs, consolidate recolor, add canonical lints + a construct census

- Status: Accepted
- Date: 2026-07-19
- Deciders: t.koehn, Claude
- Precedent: [ADR-0088](0088-in-place-v1-break.md) (an in-place, pre-1.0 break — one semantics, no migration window)
- Relates to: [ADR-0086](0086-declarative-light-and-material.md) (`model`/`cel`/theme light + explicit `light L` arg), [ADR-0087](0087-anchored-assembly.md) (`pin`/`fit`), [ADR-0091](0091-shading-v2.md) (material `rim`/`spread` doses), [ADR-0092](0092-occlusion-relations-and-aim.md) (`fit … behind/front`)

## Context

The Welle-2 language audit (plan §D) found ~35 of ~150 language constructs actually used, several
constructs offering a **second way to do the same thing**, and a human review showing the LLM builder
picking the non-canonical path when one exists. The user's directive: the removal criterion is
**intrinsic** — a construct is dropped when it is redundant (a second path for the same intent),
confusing, or a special case with no distinct role — *not* merely because current bundled recipes
happen not to use it. Existing recipes are rewritten onto the surviving path as part of the removal.

## Decision

**1 — Remove five constructs.** All are pre-1.0 in-place breaks (no external consumers, ADR-0088):

- **`repeat N:`** — a pure duplicate of `for i 0..N:`. Removed; `for` is the one loop.
- **`while cond:`** — an unbounded loop is a budget hazard `for` never poses; the bounded `for`
  covers every real case. Removed.
- **`flood <paint> <pt>`** — a determinism special case (seed-color bucket fill) with no role a
  region `fill <paint> <region>` doesn't already serve. Removed (the internal `flood` raster
  primitive is deleted too).
- **`lit L: body` block** — a *third* way to supply a light. The theme default light and the explicit
  `light L` argument on `model`/`cel` cover both real cases; the block scoped a light over a body only
  to feed those same verbs. Removed; light resolution collapses to **explicit `light L` arg > theme
  default**.
- **`replace <from> <to>` recolor filter** — the loser of the recolor consolidation (see §2).

**2 — Consolidate recolor onto one path: parametric recolor / `tint`; drop `replace`.** Recolor had
two ways: the `replace` filter (an exact post-hoc RGBA swap) and parametric recolor-on-stamp
([ADR-0024](0024-parametric-drawings.md): `draw part(c)` + a `tint` stamp/`fit` flag). `replace` is
the intrinsically worse one — an exact-match swap is **brittle after shading/AA** (the committed RGBA
it must match no longer exists once `model`/`cel` shade the region), it only ever swaps one flat
colour, and ADR-0024 already declared "one clean recolor mechanism, not two". Parametric recolor is
the canonical, well-used path (every RO character faction variant threads a colour parameter). So
**`replace` falls; parametric recolor + `tint` stays.**

**3 — Removed keywords error with a hint, and return to the free-name pool.** Each removed construct's
old *statement shape* raises a positioned `E004` naming the replacement (e.g. `'repeat' was removed —
use 'for i 0..N:'`; `the 'lit L:' block was removed — pass 'light L' to each model/cel`). Because they
are contextual (D7), the bare names (`repeat = …`, `flood = …`) remain usable as ordinary bindings —
only the removed construct's shape errors. `flood`/`replace` leave `BUILTIN_NAMES`.

**4 — Four canonical-path lints, `W012`–`W015`** (`src/lint.ts`, conservative/high-confidence like
every other `W0xx` — they skip rather than risk a false positive), each hinting the one canonical way:

| Code | Fires on | Canonical path |
|---|---|---|
| `W012` | raw `rim`/`shadeRegion`/`lightRegion` in a `model`/`cel`-shaded drawing | the material's own rim/AO dose (raise `rim N%`/`spread N%`) |
| `W013` | a `litTone`/`shadowTone` `fill` clipped by `.intersect(rect)` on a modeled region (the corner patch) | the material's `spread N%` override |
| `W014` | a `stamp` of a part that declares attach `pin`s (unless it is a pin-seeded assembly root, ADR-0092) | `fit <part>.<pin> <anchor>`, or drop the pins if it's decoration |
| `W015` | a semi-transparent `fill … ellipse(…)` low in the foot zone of a drawing that uses `fit` | the root `fit … shadow` auto contact-shadow |

**5 — A deterministic construct census** in `critique --json` and `check --lint --json`: `censusModule`
(`src/lint.ts`) counts every construct used across a module's own drawings (AST-only, sorted) and flags
each `spec-only` (a floor construct the canonical task path no longer surfaces) or `non-canonical` (a
W012–W015 participant). It carries four `antiPatterns` counts — `rawShade` (W012), `manualSpread`
(W013), `stampWithPins` (W014), `handShadow` (W015) — the craft-eval success criteria (target 0). The
`check --lint --json` payload now wraps its diagnostics in `{diagnostics, census}` (as `--rows`
already wraps).

## Consequences

- Parser/AST/eval/diagnostics for `repeat`/`while`/`litBlock` are deleted; the `flood`/`replace`
  command cases and their raster primitives (`flood`, `filterReplace`) are removed. `DrawState.light`
  stays (theme seed + explicit arg); only the block writer is gone.
- The four bundled RO characters are rewritten onto the canonical paths and remain
  `critique --as character --strict` `pass:true` and census-clean (antiPatterns all 0): the assassin
  drops ~12 raw `rim`s for a material `rim`/`spread` dose (W012); the knight seeds its stamped-root
  torso pins in canvas space, drops vestigial decoration pins, fits its far leg, and replaces three
  hand contact-shadow ellipses with `fit … shadow` (W014/W015); the wizard grip-fits its staff and far
  sleeve instead of stamping them (W014, pixel-identical); the archer drops a vestigial quiver pin
  (W014). Wizard/archer renders are byte-identical; knight/assassin changes are the intended shading
  edits. A new AST-based CI gate (`examples-critique.test.ts`) keeps every example census-clean.
- Tests for the removed constructs convert from function tests to removal-hint tests; the many `lit L:`
  test fixtures convert to the explicit `light L` argument; new tests cover each W012–W015 fire/clean
  case and the census counting + determinism.
- Touches `docs/language-spec.md` (drop repeat/while/flood/replace/lit from the grammar, filter list,
  loop section, and light-resolution order; add the W012–W015 rows + census), `skills/drawstic/*`, and
  the craft-eval runbooks (census success criteria). The **global product-skill restructure stays
  deferred to W2-3** (plan §D) — this ADR only keeps the docs consistent with the removals.
