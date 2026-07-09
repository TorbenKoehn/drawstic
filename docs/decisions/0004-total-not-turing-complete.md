# 4. Total language, not Turing-complete (runtime budget)

- Status: Accepted
- Date: 2026-06-13
- Deciders: t.koehn, Claude

## Context

The Recipe language needs real expressions (arithmetic, conditionals, loops, functions)
for complex/parametric graphics. The instinct "real expressions ⇒ Turing-complete" does
not follow, and Turing-completeness is actively undesirable here: the author is a
**stochastic model** that *will* occasionally write a non-terminating loop, and a CLI
agents call in a loop must never hang. (The original DSL's `while x<100 = …` is exactly
the construct that breaks totality.)

Determinism is orthogonal — a Turing-complete language can be deterministic — so this is
purely about **guaranteed termination** and analyzability.

## Decision

Target **"expressive enough for any drawing + guaranteed to terminate"**, not
Turing-completeness.

- **Idiom:** bounded `for` / `repeat`.
- `while` and recursion are allowed but cannot defeat termination: every render runs
  under a **runtime budget** (max evaluation steps + max pixel writes). Exceeding the
  budget aborts with a clear, positioned error instead of hanging.
- The budget is CLI-configurable with a sensible default.

## Consequences

- Real drawings lose nothing; pathological recipes fail fast and legibly.
- The same budget caps accidental "fill a billion pixels" mistakes.
- Full static analyzability is not required, but termination is guaranteed in practice
  by the budget backstop.
