# 19. Source-first module references: position separates, so paths are bareword

- Status: Accepted
- Date: 2026-06-15
- Deciders: t.koehn, Claude
- Relates: [ADR-0006](0006-modules-and-content-output-separation.md), [ADR-0018](0018-idiom-alone-does-not-justify-a-marker.md)

## Context

After [ADR-0018](0018-idiom-alone-does-not-justify-a-marker.md) dropped the middle `from`
connector, imports read `import gem, slime "./creatures"` (names-first, quoted path,
`.drw` implied). The quotes survived on a robustness argument: in **names-first** order the
module/names boundary sits at the *end* of the line, so something must delimit the path.

Flipping to **source-first** removes that need entirely. If the module is the **fixed first
token** after the statement head and the names follow, then **position alone** separates the
two — no quotes, no `./`, no connector — and a malformed path is a *catchable* error (a stray
token), not a silent misparse, so error-robustness (priority 2) is upheld. This is positional
unambiguity, not idiom — so it passes the ADR-0018 test on its own merits.

The bench (`import-syntax`) quantifies the token side:

| Form | Tokens | SymDens |
|------|--------|---------|
| `import gem, slime from "./creatures.drw"` | 11 | 0.167 |
| `import gem, slime "./creatures"` | 8 | 0.179 |
| `from creatures gem, slime` | **5** | **0.045** |

−54 % vs the original, −37.5 % vs the runner-up, lowest symbol density, identical edit cost.

## Decision

**1 — Imports are source-first with a bareword module reference:** `from <module> <names>`.
`from` is the **statement head**; the module is the single first token; the names are the
comma-list after it.

- The module reference is a **relative slash-path**, `.drw` implied, leading `./` optional:
  `from creatures gem` → `./creatures.drw`; `from sub/mod a` → `./sub/mod.drw`;
  `from ../shared/parts a, b` → parent dir.
- **Slash `/`, not dot `.`, for subpaths** — keeps `../` (parent) expressible and avoids
  overloading `.` (already UFCS / dot-index / member access). Dotted module names are prettier
  but cannot go up a directory and add a fourth meaning to `.`.
- No quotes, no extension. Position disambiguates; a whitespace-bearing path is a positioned
  error.
- **Aliasing** stays in the namelist: `from gems gem as ruby, slime`.

**2 — Theme application mirrors it:** `use <module> <theme>`, source-first. A **local** theme
is the one-token form `use <theme>`. Arity disambiguates: **1 token ⇒ local theme, 2 tokens ⇒
module + theme name**. This drops the `theme` keyword, the connector, and the quotes:
`use themes dusk` (imported), `use dusk` (local).

**3 — Export output paths are bareword too**, for one uniform path syntax across the language:
`export <content> <base-path>:`. Content-first (already), path second, the trailing `:` ends
it. `export gem icons/gem:`. No quotes; the per-format extension is appended as before.

**4 — `from` returns only as a statement head**, not the middle connector dropped in
ADR-0018. A head names the statement kind (like `draw`, `use`, `export`) and is load-bearing,
so this does not contradict ADR-0018 — it refines its import examples.

## Consequences

- **One uniform, bareword path syntax** across `from` / `use` / `export`. The only string
  literals left in the language are style guides (`"""…"""`); paths are no longer strings.
- **Resolution stays deterministic** ([ADR-0006](0006-modules-and-content-output-separation.md)):
  relative to the importing file, `/`-separated, `.drw` appended, `..` for parent.
- **Constraint:** module/output paths are whitespace-free bareword tokens. A stray space is a
  positioned error — not a silent misparse (priority 2 holds).
- **Minor wrinkle:** `use` distinguishes local vs imported by token arity; the reader counts
  tokens. Accepted for the terseness; the alternative (split import + apply) costs a line.
- **Supersedes ADR-0018's import example shape** (`import names "path"` → `from path names`);
  ADR-0018's *principle* (idiom alone never justifies a marker; the middle `from`/`in`
  connectors dropped) stands unchanged.
- Backed by the bench case `import-syntax`; re-run `bun run bench --case import-syntax`.
