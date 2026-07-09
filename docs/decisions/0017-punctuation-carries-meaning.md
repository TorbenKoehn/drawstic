# 17. Punctuation must carry meaning; `=` marks a binding

- Status: Accepted (operational test refined by [ADR-0018](0018-idiom-alone-does-not-justify-a-marker.md))
- Date: 2026-06-14
- Deciders: t.koehn, Claude

## Context

Resolving the syntax-unification questions surfaced the same underlying decision over and
over: *when is a piece of punctuation worth its tokens?* The bench suite
([ADR-0014](0014-token-efficiency-bench-suite.md)) gave two opposite answers, which only
make sense under one principle:

- **Command-call parens** (`circle(8:8, 6, k)` vs `circle 8:8 6 k`) cost +12.7 % tokens and
  ~2× symbol density and carried **no** meaning at statement position — pure overhead. They
  were dropped in favour of command-form ([ADR-0015](0015-unified-call-model.md)).
- **`=` on declarations** (`grad sky = …`, `k = #1a1a1a`) is ~6 % more tokens and higher
  symbol density, yet it **carries meaning**: it marks that a referenceable name is being
  bound. The bench cases `decl-eq-vs-bare` and `pal-eq-vs-bare` confirm the bare form is
  cheaper, but the saving is ~1 token per binding and removing `=` erases a scoping signal.

Lower symbol density is not automatically better; the question is whether the punctuation
does work the reader/parser would otherwise have to infer.

## Decision

**Principle.** Punctuation is justified only when it carries meaning that is not free
otherwise. Meaning-bearing punctuation is **kept** even at a token cost (the spec's
priorities 2 and 3 — error-robustness, self-verifiability — outrank priority 4, token
efficiency); punctuation that is pure overhead is **dropped**. The bench is the instrument
that tells the two apart.

**Operational test.** Keep a marker only if it (1) **resolves a real ambiguity** — e.g. `=`
separates a binding from a command, since `k #1a1a1a` would otherwise read as a command — or
(2) **serves error-robustness / self-verifiability** (priorities 2–3) — e.g. `:` makes a
missing block body a catchable error. If neither holds, drop it. The `export` source→path
connector does neither: `export` + source-first order + the path's position already
disambiguate, so it is written bare — `export gem icons/gem:`, no `->`/`to` (bench
`export-connector`; the arrow was also the only `->` in the language). The path itself later
lost its quotes too, by the same positional argument ([ADR-0019](0019-source-first-module-references.md)).

> **Refined by [ADR-0018](0018-idiom-alone-does-not-justify-a-marker.md).** This test
> originally had a second clause — *"matches a strong in-distribution idiom"* — with `from`
> (`import X from "…"`) as its example. Under the assumption that LLMs author dense/unusual
> syntax fine, **idiom alone no longer justifies a marker**: in-distribution (priority 1)
> is a tiebreaker, and `from`/`in` were subsequently **dropped**. The clause is replaced by
> the priority-2/3 clause shown above.

**Concrete rule — every statement is one of three shapes:**

| Shape | Form | Marker | Meaning |
|-------|------|--------|---------|
| **Binding** | `[kind] name = expr` | `=` | introduces a **referenceable name** (`x = 10`, `k = #1a1a1a`, `grad sky = …`, `mask m = …`, `fn area(r) = …`) |
| **Block** | `kind name [sig]:` + indent | `:` | opens a **structured body** (`draw`, `theme`, `export`, `filter`, `tileset`, `atlas`, `if`/`for`/`match`) |
| **Directive** | `verb args` | — | performs an **action**, introduces no name (`circle 8:8 6 k`, `tiles grass, dirt`, `with warm-pal`, `apply softshadow`) |

So `=` ⟺ "a name is bound here" — you can scan a Recipe for `=` to find every definition,
and a leading `kind` keyword (`grad`/`mask`/`fn`) only tags the binding's type. `=` is
therefore **kept** on `grad`/`mask`/`fn`/palette entries/variables, even though the bare
form benches ~6 % cheaper.

## Consequences

- One self-verifiable signal: `=` = definition, `:` = body, bare = action. A reader/editor
  tells the three apart from the line shape alone, without knowing each keyword's nature.
- Future "should this punctuation exist?" questions are decided by the principle, measured
  with the bench — not by taste. This ADR is the reference for that class of question.
- The ~1-token-per-binding cost of `=` is accepted as the price of the scoping signal;
  token efficiency (priority 4) does not override it.
- Complements [ADR-0015](0015-unified-call-model.md): command-form won there for the same
  reason `=` wins here — drop punctuation that is overhead, keep punctuation that means
  something.
- Backed by reproducible cases (`call-shape-commands`, `decl-eq-vs-bare`, `pal-eq-vs-bare`,
  `export-connector`); re-run `bun run bench` to reproduce.
