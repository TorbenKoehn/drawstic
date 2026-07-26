# 52. Complete normative grammar; pinned lexical disambiguations

- Status: Accepted (refined by [ADR-0066](0066-paint-first-painting-commands.md): painting commands take the paint as first argument; the spec §17 draw-suffix rules change accordingly)
- Date: 2026-07-05
- Deciders: t.koehn, Claude
- Refines: [ADR-0015](0015-unified-call-model.md), [ADR-0017](0017-punctuation-carries-meaning.md), [ADR-0032](0032-lexical-robustness.md)

## Context

[Spec §17](../language-spec.md#17-grammar-normative) was an *informative sketch*: it named
the constructs but left the load-bearing questions open — where the point colon ends and
the block colon begins, where one command-form argument stops and the next starts, how the
hyphenated names the spec formerly used (`pixel-base`, `atlas-json`) coexist with the
`-` operator, and what a match arm's body may be. It also plainly
disagreed with the prose: the `module` production admitted no bindings although
[spec §10](../language-spec.md#10-expressions--functions) allows module-level constants,
and `drawstmt` was missing the drawing-local `grad`/`filter`/`mask` definitions
([§12](../language-spec.md#12-colour-gradients-filters--themes)), the drawing-scoped
`seed`/`font` directives, and `title`/`desc` ([§6](../language-spec.md#6-drawings)).
Undefined grammar is exactly the silent-misparse class that error-robustness
([§1](../language-spec.md#1-design-priorities) #2) forbids.

## Decision

**1 — §17 becomes the complete, normative grammar.** Three layers: layout tokens
(`NL`/`INDENT`/`DEDENT`, per [ADR-0032](0032-lexical-robustness.md)), a lexical grammar
(every token named and defined), and a phrase grammar covering every construct of §§2–13 —
each drawing command with its exact argument sequence, the two call surfaces stated once
as a shared rule ([ADR-0015](0015-unified-call-model.md)). A parser may factor rules
differently but must accept exactly this language.

**2 — The colon is disambiguated by line position (D1, D3).** A `:` that is the last
token of a logical line introduces a block; every other `:` is the point separator — so
`if p == 0:0:` parses without lookahead games. A match arm's label ends at the *first*
depth-0 colon (labels are colon-free at depth 0; parenthesize a point label); its body is
an inline simple statement or an indented block.

**3 — Command-form arguments split at depth-0 whitespace (D2).** Depth counts unclosed
`(` and `[`, so `poly cols[row // 8 mod 3] 0:row w:row` has three arguments. The
keyword-prefixed sequences (`by p`, `transform t`, `tint k 0.3`, `mask m`, `font small`,
`cap round`, `mode smooth`) each form one argument, as listed per command.

**4 — Names carry no hyphen; hyphens live in paths (D5).** `NAME` is letters, digits and
underscores; multi-word names are **camelCase** (preferred over snake_case). `-` is
therefore always the minus operator and needs **no whitespace**: `x-1` subtracts. Hyphens
remain legal in **path segments** (the `SEGMENT` token) — module file names, export base
paths, imported files (`from ui-parts eye`) — but the names a module *defines* (its
importable surface) cannot carry one. The spec's former kebab-case names and the
`atlas-json`/`inline-styles` format keywords become camelCase (`pixelBase`, `warmPal`,
`moonIcon`, `atlasJson`, `inlineStyles`). Rationale: whitespace-significant subtraction
would put a silent trap on the most common arithmetic operator — a direct
error-robustness hit — while the path/name split keeps hyphenated file conventions where
they actually occur (the filesystem), at zero cost to expressions.

**5 — Numeric-suffix flags and paths are contextual tokens (D4).** `w2`, `z9`, `q80`,
`rot45`, `scale2`, `@2`, the path tokens, and the `drawstic` pragma word are recognized
only in their grammar positions; elsewhere the same spellings are ordinary `NAME`s. Only
the expression-level words (`by if then else true false transparent mod as`) are reserved
everywhere; all other keywords are positional, and commands/stdlib remain unshadowable
predefined bindings ([ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md)).

**6 — Dot-adjacent numbers are indices (D8).** Directly after `.`, a numeric token is
always lexed as `INT`: `xs.0.1` is `xs[0][1]`, never the float `0.1`.

**7 — The sketch's omissions are fixed.** Module scope admits bindings; `draw-stmt`
admits drawing-local `grad`/`filter`/`mask =` definitions, `seed`/`font` directives, and
`title`/`desc`; `if` has its `else`; the export format lines, the inline `pal` form, and
`filter-def` are fully specified.

## Consequences

- The parser, formatter ([ADR-0031](0031-agent-loop-cli-preview-and-fmt.md)), and
  diagnostics ([ADR-0030](0030-structured-diagnostics-contract.md)) now have a single
  normative target; "illustrative, not exact" is gone.
- D5 keeps `-` purely arithmetic — no whitespace-sensitive lexing anywhere in the
  language. The cost is hyphen-free multi-word names (camelCase); file names keep their
  hyphens via the separate `SEGMENT` token.
- Spec §17 rewritten (three-layer grammar + D-rules + delta list); §3 gains the
  names/paths bullet; `atlas-json`/`inline-styles` renamed `atlasJson`/`inlineStyles`
  (§13); example names renamed (`pixelBase`, `warmPal`, `moonIcon`); the §17 anchor
  changed
  (`#17-grammar-normative`), updated in ADR-0029.
- No token-efficiency impact: the grammar pins interpretation; it adds no surface syntax.
