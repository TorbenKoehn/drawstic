# 79. `xs.cycle(i)` — auto-wrapping list index

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Resolves: scene-dx improvements runbook §5.6 (Scene-DX evaluation, procedural ramp access, volcano #5)

## Context

Procedural drawing routinely indexes a small color ramp from a loop counter that runs past
the ramp's length (a band count, a row index, a scatter iteration) — `cols[row % n]` written
by hand, or worse, plain `cols[row]` that throws E015 the moment the loop outruns the ramp.
The evaluation scenes hit this directly (volcano #5,
[evaluation](../scene-dx-evaluation-2026-07-08.md)): off-by-one risk in a hand-rolled wrap
expression is exactly the kind of small, repeated tax the stdlib should absorb, per
[ADR-0034](0034-standard-library.md)'s standing charter for the built-in set.

The wrap semantics are not a new decision: floored `mod` already exists, its result already
takes the sign of the divisor and is pinned deterministic
([ADR-0037](0037-floored-division-and-integer-indices.md),
[ADR-0048](0048-mod-keyword-percent-suffix-only.md)). For a positive divisor (a list length),
floored mod is exactly Euclidean mod — always in `[0, n)`, negative dividends wrap positively.
This is purely packaging that identity as a list method.

## Decision

**1 — `xs.cycle(i)` is sugar for `xs[i mod len(xs)]`.** Any integer `i` — including negative —
wraps into range via floored/Euclidean modulo, the same wrap direction already used by `mod`
and `//`. `xs.cycle(-1)` is the last element.

```drw
ramp = a, b, c
for row 0..h:
  px ramp.cycle(row) 0:row       # row 3 wraps back to ramp[0], no bounds check needed
```

**2 — Works on any list value.** A "ramp" has no separate runtime type — it is a plain list
of colors ([ADR-0060](0060-explicit-color-list-ramps.md)) — so `cycle` is a general list
method, not colour-specific, matching `len`.

**3 — An empty list is E015, not a crash or a silent `0`.** Same diagnostic code plain
indexing already uses for a bad index; the message names the operation (`cycle needs a
non-empty list`) rather than reporting a phantom index.

**4 — A fractional index is still a positioned error.** `cycle` does not relax
[ADR-0037](0037-floored-division-and-integer-indices.md) point 3 — a non-integer `i` is E015,
same as plain indexing.

**5 — Ordinary UFCS, ordinary stdlib entry — no grammar change.** `xs.cycle(i)` parses as any
other method call ([ADR-0010](0010-ufcs-method-style-calls.md)); `cycle` is added to the
reserved built-in name set alongside `len` ([ADR-0034](0034-standard-library.md)) so a `fn`
cannot shadow it. `lang` stays **2** — pure addition, no pragma gate.

## Consequences

- Removes the off-by-one tax from procedural ramp access; the volcano #5 idiom becomes one
  call instead of a hand-written `mod` expression.
- One more reserved stdlib name; no new syntax, no new runtime value type.
- Touches [spec §10](../language-spec.md#10-expressions--functions) (Standard library list),
  `src/eval.ts` (`cycle` in `#builtinMath`, `BUILTIN_NAMES`; shared `floorMod` helper also
  used by the `mod` operator), tests, and the product skill
  (`skills/drawstic/reference.md`).
