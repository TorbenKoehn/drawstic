# 18. Idiom alone never justifies a marker; in-distribution is a tiebreaker

- Status: Accepted
- Date: 2026-06-15
- Deciders: t.koehn, Claude
- Refines: [ADR-0017](0017-punctuation-carries-meaning.md)

## Context

The governing principle (the **mantra**): make the language **as token-efficient as
possible**, subject to two floors that must always hold — **just barely human-readable**
(for reviews) and **just barely perfectly editable/creatable by an LLM**.

[ADR-0017](0017-punctuation-carries-meaning.md) gave an operational test with **two**
justifications for keeping a marker: (1) it resolves a real ambiguity, or (2) it matches a
**strong in-distribution idiom**. Clause (2) let `from` survive on idiom alone.

We re-examined every construct under a working assumption: **LLMs author even dense,
unusual syntax reliably** — they write Bash, PowerShell, RegEx, and ASM. Two lessons fall
out, and they point in opposite directions:

- **Familiarity is worth far less than priority 1 implied.** If the model writes RegEx
  fluently, an unfamiliar-but-regular Recipe form is not a barrier. In-distribution-ness
  does not earn a marker its tokens.
- **Density is not free — but the guardrail is not familiarity.** RegEx is exactly where
  terseness *raises* error rates: one transposed character silently changes meaning. What
  keeps dense syntax safely editable is **unambiguity + self-verifiability**, not idiom.

So the **LLM-editability floor is guarded by error-robustness (priority 2) and
self-verifiability (priority 3)** — never by in-distribution (priority 1).

## Decision

**1 — Re-weight the priorities.** In-distribution (priority 1) is demoted to a
**tiebreaker**: a nice-to-have when it is free, never a reason to keep a marker that costs
tokens. **Token efficiency (priority 4) may override in-distribution (1), but never
error-robustness (2) or self-verifiability (3).** The numbered list in
[spec §1](../language-spec.md#1-design-priorities) keeps its labels (other docs reference
"priority 4"); this ADR fixes the **trade-off rules** between them.

**2 — Sharpen ADR-0017's operational test.** Drop justification (2). A marker is kept
**only if** it **(a) resolves a real ambiguity** or **(b) serves error-robustness /
self-verifiability**. *Idiom alone is insufficient.*

**3 — Drop the idiom-connector class.** Connectors whose operands are already
positionally/type-unambiguous, and which carried only idiom, go:

- **`from`** — `import a, b from "x"` → `import a, b "x"`; `use theme t from "x"` →
  `use theme t "x"`. The quoted path is type-unambiguous as the source.
- **`in`** — `for i in a..b:` → `for i a..b:`. The range is type-unambiguous; the loop
  name precedes it.

This **reverses ADR-0017's `from` example** (it was the poster child for clause (2)).

> **Sequel: [ADR-0019](0019-source-first-module-references.md).** The import was then
> reordered **source-first** — `from creatures gem, slime` — bringing `from` back as a
> *statement head* (not the middle connector dropped here) and dropping the path quotes and
> `./` too, since position now separates module from names. The drop of the *connector*
> `from` stands; ADR-0019 owns the final import/`use`/`export` shape.

**4 — One block style.** Remove the inline `{ … }` block **and the `;` statement
separator** (which lived only inside it). It was the only `{}`/`;` in an otherwise
indentation-plus-`:` grammar — a self-verifiability wart (two block styles for one idea).
Local intermediate values are written as **sequential bindings** before the expression, or
factored into a **`fn`**.

**Markers explicitly kept** — each survives on ambiguity or priority 2/3, never on idiom,
so the demotion of priority 1 does not touch them:

| Marker | Survives because |
|--------|------------------|
| `=` (binding) | ambiguity (`x 10` = command or binding?) + scan-for-definitions self-verification |
| `:` (block) | a missing body is a catchable error; line shape signals "body follows" |
| `as` (alias) | ambiguity: `import gem as ruby` ≠ importing two names |
| comma (list/arg) | ambiguity: multi-word elements |
| `x:y` colon | ambiguity x/y; expr-`if` already uses `then`/`else` to avoid it |
| `then` / `else` | delimit condition/consequent/alternative in expression position |
| UFCS mask set-ops (`.union` …) | keep `&`/`\|` unoverloaded — symbolic would force context-dependent parsing (§18.12) |
| `@N` (export scale) | distinguishes scale factor from absolute size (`@2` vs `512`) |
| `to` / `by` (cursor) | semantics: absolute vs relative |
| `..` / `..=`, fused flags (`scale2`, `rot90`, `z9`, `q80`) | semantic, terse, locally unambiguous |

## Consequences

- **Confirmed under the sharpened test, no change:** §18.4 keep `grid:` explicit
  (robustness, not idiom); §18.6 **do not** add a `sprite` alias (a readability/idiom
  luxury — `draw` clears the floor); §18.12 UFCS set-ops stay (ambiguity); §18.3 keep all
  three conditional forms (distinct positions); §18.9 keep `+=` (terse; the mild
  self-verification cost of mutation is accepted).
- **Lowest-conviction keep:** dot-index `xs.0` alongside `xs[expr]` — a second indexing
  form (mild surface cost) that the assumption now supports keeping (LLMs carry surface);
  the first candidate to cut if "minimal surface" ever outranks micro-token savings.
- **Propagated** in this change: spec §1 (trade-off note), §2/§3/§10/§11/§17; the examples;
  the bench corpus (`for` lines updated; new `import-connector` and `for-connector` cases
  documenting the token side).
- **Token magnitude is small and beside the point.** Dropping `from`/`in` saves ≈1 token a
  few times per file; the decision is on **principle** (idiom no longer pays its way), not
  magnitude. `=` benches ≈6 %/binding cheaper if dropped, yet stays — because that saving
  trades against priority 2/3, which the mantra forbids.
- **The binding floor is unmeasured.** The bench is an offline GPT-BPE proxy and we
  deliberately do **not** put an LLM in the loop ([ADR-0014](0014-token-efficiency-bench-suite.md)),
  so it cannot measure LLM-editability. These calls are **reasoned** under the stated
  premise; the bench documents only the token side.
- **Risk:** the premise — that LLMs author terse/unusual syntax without losing editability
  — is an assumption, not a measurement. Revisit if real authoring shows otherwise.
