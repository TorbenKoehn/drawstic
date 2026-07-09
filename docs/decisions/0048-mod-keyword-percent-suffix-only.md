# 48. Modulo is the infix keyword `mod`; `%` is exclusively the percent suffix

- Status: Accepted
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Refines: [ADR-0037](0037-floored-division-and-integer-indices.md) (semantics unchanged, spelling replaced), [ADR-0034](0034-standard-library.md) (the stdlib `mod` fn folds into the operator)

## Context

`%` carried two meanings: the **percent suffix** on number literals (`10% == 0.1`, spec §4)
and the **floored modulo operator** (`a % b`, [ADR-0037](0037-floored-division-and-integer-indices.md)).
Only whitespace told them apart — `10 % 3` was modulo, `10%` a suffix, and `10%3` a
coin-flip. Whitespace-sensitive operator meaning inside expressions is exactly the
silent-misparse class error-robustness (priority 2) forbids. Meanwhile the stdlib
([ADR-0034](0034-standard-library.md)) already listed a `mod` *function* — the same concept
under a second name, violating "one name per concept"
([ADR-0018](0018-idiom-alone-does-not-justify-a-marker.md)).

## Decision

**1 — `mod` is the infix modulo operator.** `a mod b`, multiplicative precedence (same tier
as `*` `/` `//`), **floored** exactly as [ADR-0037](0037-floored-division-and-integer-indices.md)
pinned it: the result takes the sign of the divisor, and `a == (a // b) * b + a mod b`.
A word operator is at home here — the language already uses `by`, `then`/`else`, and `as`
as syntactic words, and `mod` is the in-distribution spelling (Pascal, Ada, Haskell, SQL).

```drw
cols[row // 8 mod 3]        # the banding idiom
fn band(row) = row // 4 mod 2
```

**2 — `%` means percent, and only percent.** The suffix (`10%`) keeps its single meaning;
`10%3` is now a positioned **syntax error** (two juxtaposed expressions), never a silent
modulo. No whitespace-dependent reading remains.

**3 — Follow-on removals, one name per concept:** the compound assignment `%=` is dropped
(write `x = x mod n`; the idiom is rare), and the stdlib **`mod` function is removed** —
the operator *is* the concept (UFCS on an operator does not apply; there is nothing left
to call).

## Consequences

- The lexer needs no whitespace heuristics around `%`; every remaining meaning of every
  operator token is position-independent.
- ADR-0037's floored semantics and the `//`/`mod` consistency law survive verbatim under
  the new spelling; the determinism pin ([ADR-0029](0029-language-version-pragma.md))
  carries over.
- Touches spec §4 (indexing note), §10 (operators, compound assignments, stdlib list,
  `checker` example), §11 (bands example), and [dsl-examples.md](../dsl-examples.md) §4.
