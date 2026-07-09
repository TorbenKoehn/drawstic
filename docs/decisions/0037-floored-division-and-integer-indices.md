# 37. Floored `//` and `%`; list indices must be integers

- Status: Accepted (the modulo spelling `%` is replaced by the infix keyword `mod` in [ADR-0048](0048-mod-keyword-percent-suffix-only.md); the floored semantics are unchanged)
- Date: 2026-07-04
- Deciders: t.koehn, Claude

## Context

Numbers are real-valued (spec §4) and `/` is real division — so the banding idiom the spec
itself used, `cols[row / 8 % 3]`, yields **fractional indices** (`row = 1` → `cols[0.125]`),
whose meaning was undefined. Worse, the sign of `%` on negative operands was never pinned —
a genuine determinism gap ([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)
family): C truncates, Python floors, and a pixel position may depend on the answer. Finally,
a leading-dot float literal (`.2`) would collide lexically with dot-indexing (`xs.2`,
[ADR-0015](0015-unified-call-model.md)).

## Decision

**1 — Add `//`, floored integer division.** Python-style, in-distribution, same precedence
and associativity as `*` `/` `%`. The banding idiom is `cols[row // 8 % 3]`.

**2 — `%` is floored modulo.** The result takes the **sign of the divisor**, and the pair
is consistent: `a == (a // b) * b + a % b`. Pinned as part of the language version
([ADR-0029](0029-language-version-pragma.md)).

**3 — List indices must be integers.** A fractional index is a **positioned error** —
never a silent floor. Coordinates keep their own documented coercion (round half-up, §5);
indices do not coerce because a fractional index is almost always a logic bug, and precise
errors beat silent misreads (priority 2). Out-of-range indices remain errors as well.

**4 — Number literals need a leading digit.** `0.2`, never `.2` — this keeps `.N`
unambiguous as a dot-index and `.name` as a UFCS call
([ADR-0010](0010-ufcs-method-style-calls.md)).

## Consequences

- The spec's own examples become well-defined (`row // 4 % 2` → 0 or 1).
- One more operator, but a familiar one; no new coercion rule to memorize — indices are
  strict, coordinates coerce, and each says so where it is defined.
- The `%`-sign determinism gap is closed and version-pinned.
- Touches spec §4 (number literal, index integrality), §10 (operator list), §11 (example).
