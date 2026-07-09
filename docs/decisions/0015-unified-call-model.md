# 15. Unified call model: one call, two surfaces; no list bracket

- Status: Accepted
- Date: 2026-06-14
- Deciders: t.koehn, Claude

## Context

The language had two unrelated-looking call shapes — space-separated commands
(`circle 8:8 6 k`) and parenthesized functions (`lighten(c, 20%)`) — plus a residual
ambiguity: if a bare comma-sequence is a list (`x = 1, 2, 3`) and comma "always builds a
sequence", is `f(a, b, c)` a 3-argument call or a 1-argument call taking the list
`(a, b, c)`? This is the substance of open questions §18.1 and §18.2.

We resolved it with evidence rather than taste, using the bench suite (`bench/`,
[ADR-0014](0014-token-efficiency-bench-suite.md)). Measured on identical drawings
(o200k_base):

- **Call shape** (`call-shape-commands`): forcing everything to paren-form costs **+12.7 %
  tokens** and nearly **doubles symbol density** (0.151 → 0.298). Command-form wins on the
  two axes that matter for priorities 2 and 4, and edit cost was equal.
- **List parens** (`list-paren-vs-bare`): wrapping a list in parens costs ~1 token —
  negligible, within the noise band.
- **Indexing** (`index-dot-vs-bracket`): `.N` vs `[N]` differs by ~1 token over four
  accesses — negligible.
- **Passing one list** (`list-arg-passing`): a hypothetical `[k, y, r]` marker tokenizes
  **identically** to the double-paren `((k, y, r))` workaround (79 = 79) — it buys zero
  token savings — while a `cols = k, y, r` binding is +5.1 % for single use but has the
  lowest symbol density and amortizes on reuse.

## Decision

**1. One call, two interchangeable surfaces.** A call is a callee applied to arguments,
written either way, as pure sugar (the same idea as UFCS, [ADR-0010](0010-ufcs-method-style-calls.md)):

- **Command-form** `f a b c` — whitespace-separated arguments, no parens. Allowed **only at
  statement position** (one call per line), where there is no nesting to disambiguate.
- **Paren-form** `f(a, b, c)` — callee immediately followed by `(`, comma-separated
  arguments. Allowed **anywhere**, and **required** in expression position (RHS of `=`,
  nested arguments, `if … then …`) because grouping needs parens.
- `f a b c` ≡ `f(a, b, c)`. Command-form stays the **idiom for drawing statements** (it is
  measurably terser and calmer); paren-form is for expressions and for anyone who prefers
  explicit argument boundaries. Trailing flags such as `fill` are bare flag arguments in
  both forms (`circle 8:8 5 r fill` ≡ `circle(8:8, 5, r, fill)`).

**2. The `(` disambiguates by what precedes it.** A `(` *immediately after a callee* opens
an **argument list** (commas separate arguments); a `(` elsewhere **groups**. A bare
comma-sequence in value position is a **list literal**. So comma separates the elements of
the comma-sequence it sits in, and context (callee present?) fixes whether that sequence is
an argument list or a list literal. Whitespace never separates sequence elements; comma
never separates command-form arguments.

**3. `f(a, b, c)` is a 3-argument call; there is no list bracket.** To pass a single list
as one argument, bind it: `xs = a, b, c` then `f(xs)`. A dedicated `[…]` list marker is
**rejected**: the bench shows it saves no tokens over the binding/double-paren forms, and
it would add a second bracket type and reopen [ADR-0002](0002-hybrid-primitives-and-indexed-palette.md).

**4. Declarations stay a separate family.** `draw`, `theme`, `fn`, `grad`, `mask`, `export`
*bind a name* (and often open a block); they are not folded into the call model, because
the name is being defined, not passed.

**5. Indexing is confirmed unchanged.** `xs.N` for a literal index (bracket-free), `xs[expr]`
for any dynamic index (`.name` stays reserved for UFCS calls). The token difference is
negligible; both are kept.

## Consequences

- §18.1 and §18.2 are resolved. The terse, in-distribution command-form remains the default
  for drawings; the language gains a single, uniform mental model — "a callee plus a
  sequence" — for commands, functions, and lists alike.
- `f(a, b, c)` meaning 3 arguments is the in-distribution default (C/JS/Python), so the
  "one literal list" footgun is low-risk; the binding idiom is the documented escape hatch
  and reads best.
- The old `circle(8:8 6 k)` form (parens *with* spaces, no commas) is dropped: inside parens
  arguments are always comma-separated.
- No new bracket type; ADR-0002's bracket-free lists stand.
- Open: the precise treatment of `fill`-style flags in paren-form (positional flag vs named)
  is documented as a bare flag argument here and can be refined when the parser lands.
- This decision is backed by reproducible bench cases (`call-shape-commands`,
  `list-paren-vs-bare`, `index-dot-vs-bracket`, `list-arg-passing`); re-run `bun run bench`
  to reproduce the numbers.
