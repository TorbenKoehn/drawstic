# 67. `render` fragment literal arguments

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0024](0024-parametric-drawings.md) (parametric drawings), [ADR-0030](0030-structured-diagnostics-contract.md) (diagnostics contract), [ADR-0031](0031-agent-loop-cli-preview-and-fmt.md) (agent-loop CLI)

## Context

`drawstic render <file>#<drawing>` instantiates a drawing with zero arguments
([src/cli.ts](../../src/cli.ts)); a parametric drawing ([ADR-0024](0024-parametric-drawings.md))
has no way to receive its parameters from the CLI, so `render` on one throws **E011**
(`drawing 'x' takes N argument(s), got 0`). The Scene-DX evaluation
([evaluation](../scene-dx-evaluation-2026-07-08.md)) hit this on every market scene with a
parametric component (6 components, repeated dance): the only workaround was a throwaway
0-arg wrapper `draw` per component, purely to preview it standalone — pure token waste and
drift risk (the wrapper can silently go stale against the real signature).

## Decision

**1 — The `render` fragment takes an optional literal argument list.**
`<file>#<drawing>(arg, arg, …)` — no space between the drawing name and `(` (same D6
"unspaced open-paren" rule a recipe call uses):

```
drawstic render parts.drw#house(#c04040, 3)
drawstic render scene.drw#parametricDot(#ff0000)
```

`<file>#<drawing>` with no parens is unchanged (today's zero-arg render). `()` is
equivalent to no parens.

**2 — Arguments are parsed with the exact call grammar, then restricted to literals.**
`<drawing>(<args>)` is parsed as one standalone `name(args…)` expression — the identical
grammar a recipe uses to instantiate a parametric drawing/path/fn
([ADR-0015](0015-unified-call-model.md)) — so nested parens, strings containing `)`, and
whitespace all behave exactly as they would inside a `.drw` file. Once parsed, every
argument must be one of the recipe-language **literal** expressions:

- number (`3`, `-3`)
- color (`#c04040`, `#c04040ff`) or `transparent`
- string (`"label"`)
- point of two signed number literals (`3:4`, `-3:-4`)
- boolean (`true`, `false`)

Anything else — a name, arithmetic, a call, a list/range literal, a keyword argument
(`mask m`) — is **E004** (syntax), the same code the parser already uses for a malformed
expression, worded to name the restriction (`render arguments must be literals …`) and
hinting that no names/arithmetic/calls are accepted. This is deliberately **not** "any
expression": the fragment is a CLI argument, not recipe source, so it gets no module
context to resolve names against, and letting it run arbitrary expressions (loops, calls
into other definitions) would blur `render` into a second entry point for evaluating
code. Literal-only keeps it a pure, obviously-total instantiation of one drawing.

Literal expressions are evaluated in the **target module's scope** (`entry.module.env`)
via the same `evalExpr` case arms recipes use for these literal kinds — no name lookup
ever happens for a literal, so "target module's scope" only matters in that it anchors
positioned errors to that module's file. Reusing `evalExpr` (rather than a bespoke literal
evaluator) means color-hex validation, point construction, etc. can never drift from
in-recipe behavior.

**3 — Arity mismatch stays E011, now with a hint pointing at this syntax.** Whether the
fragment has no parens, empty parens, or the wrong argument count, a count mismatch against
the target drawing's own parameters throws the existing `drawing 'x' takes N argument(s),
got M` E011 — but from the `render` command specifically (not from a nested call inside the
drawing body, which keeps today's hint-less message), it now carries a hint spelling out the
fix with the drawing's real parameter names, e.g. `pass literal arguments: render
<file>#house(c, count)`. Passing arguments to a non-parametric draw, or to a
tileset/atlas/image target (none of which take arguments), is the same E011 shape with a
`takes 0 argument(s)` message.

**4 — `build` exports are unaffected.** Exports only ever instantiate the drawings named in
`export` blocks, which the language already requires to be non-parametric (an `export` of a
parametric drawing is unrelated existing behavior, untouched here). This feature only
changes what the ad-hoc `render` fragment accepts.

## Consequences

- Any parametric drawing can be rendered standalone for a visual check without a wrapper
  `draw` — closes the P2.4 gap from
  [TODO-IMP.md](../../TODO-IMP.md) §2.4.
- Touches: `src/parser.ts` (one new standalone-expression entry point reusing the existing
  private expression-parsing methods, no grammar change), `src/eval.ts` (`Engine.renderFragment`
  + a private literal-argument evaluator/validator), `src/cli.ts` (`parseRenderTarget` grows an
  `argsText` field), [language-spec.md §16](../language-spec.md#16-cli-surface),
  `skills/drawstic/SKILL.md` + `reference.md` (product-skill rule, AGENTS.md §6).
- No language grammar change and no `drawstic <N>` version-pragma bump ([ADR-0029](0029-language-version-pragma.md))
  — this is CLI-surface only; `.drw` source syntax is untouched.
- The malformed-target E022 diagnostic gains new trigger cases (unclosed `(`, `(` with no
  preceding drawing name) alongside the existing hash-related ones, with the same
  `malformed render target` message and hint.
