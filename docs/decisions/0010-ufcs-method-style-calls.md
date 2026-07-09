# 10. Uniform function call syntax (UFCS) for readable composition

- Status: Accepted
- Date: 2026-06-14
- Deciders: t.koehn, Claude

## Context

Colour operations compose heavily (`grayscale` → `hue` → `lighten` → `alpha`). In prefix
form they nest inside-out — `lighten(hue(grayscale(#235), red), 10%)` — which is hard to
read and write: the subject (`#235`) is buried deepest and modifiers wrap around it. We
want left-to-right, subject-first composition without introducing an OOP method system on
a functional, declarative language.

## Decision

Adopt **UFCS**: any function may be called **method-style on its first argument** —
`x.f(a)` is exactly `f(x, a)`, pure syntactic sugar.

- Both forms are always valid and identical: `c.lighten(10%)` ≡ `lighten(c, 10%)`.
- A **zero-argument** call may drop its parens: `c.grayscale` ≡ `grayscale(c)`.
- The `.` is shared with indexing and disambiguated by what follows: **`.0` (a number) is
  an index**, **`.name` (an identifier) is a call**. (Precedented: Rust `tuple.0` vs
  `value.method()`.)
- A **`%` numeric suffix** divides by 100 (`10% == 0.1`), so amounts read naturally:
  `c.lighten(20%)`.

## Consequences

- Chains read in order: `#235.grayscale.hue(red).lighten(10%)` — no inside-out nesting.
- `lighten` and friends stay ordinary functions; nothing is special-cased, and UFCS works
  for any function, not only colours.
- No methods-on-types machinery — the language stays functional/declarative.
- Reuses the existing `.`; the number-vs-name rule keeps indexing and calls unambiguous.
- **Rejected alternative:** a pipe operator (`|>`). `|` is already boolean-or, and
  method chains are more in-distribution for LLMs than pipes.
