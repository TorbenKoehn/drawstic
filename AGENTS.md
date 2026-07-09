Drawstic
========

Drawstic (A play on "Drastic" and "Draw Deterministic") is a BunJS library for deterministically drawing icons, images and other graphics.

Drawings are written in LLM-optimized "Recipes" that care about token-optimization, consistency and speed. Recipes are then executed by the Drawstic engine to produce the final image.

Images can be drawn into several formats, including PNG, SVG and JPEG.

Drawstic is a pure CLI tool. LLM Agents are supposed to call it via the command line, provide their recipes and get back the resulting image.

Recipes can be organized into Themes that define a consistent style for a set of images. This allows agents to maintain visual consistency across multiple drawings.

---

## 1. Non-negotiable rules - read first, every session

1. **No throwaway code. Ever.** No spikes, MVPs, slices, mockups, prototypes, or "temporary" scaffolding. Build the real thing in the real place. 
2. **This file + the ADRs are law.** When they conflict with your instinct, they win. When you make a material decision, write an ADR ([docs/decisions/](docs/decisions/)), then reflect it here and in [docs/](docs/).
3. **Verify before you claim done.** Run `bun run test`. Report real results — if something fails, say so; never assert success you didn't observe.
4. **You own the lifecycle.** Manage infrastructure and tests yourself; the user does as little manual work as possible.
5. **Match the surrounding code and the user's conventions** — they are deliberate. Read neighbouring files before adding new ones.
6. **When a requirement, the structure, or a decision is unclear: ask one precise question. Do not guess on scope or structure.**
7. Launch subagents. Output only the modified or requested code block.
8. Do not provide line-by-line explanations, setup guides, introductory, concluding remarks, or markdown commentary unless explicitly asked.
9. Adopt an ultra-concise, high-density communication style.
---

## 2. Project Structure

This is a single library project.

```
package.json    # Library package.json (bin: drawstic → dist/bin.js; subpath exports, no barrel — ADR-0065)
tsconfig.json   # Strict TypeScript config (src + bench + tests)
tsconfig.build.json # Emit config for dist/ (per-file ESM + .d.ts via plain tsc — ADR-0065)
biome.json      # Formatter/linter config
AGENTS.md       # This file - project rules and structure
CLAUDE.md       # Rules for CLAUDE (same as AGENTS.md)
README.md       # npm/GitHub front page
CONTRIBUTING.md # Dev setup, Conventional Commits, gitflow, release flow
LICENSE         # MIT
.github/        # CI + release + semantic-PR workflows, dependabot, PR template
src/            # Main library code (also code when importing from BunJS/Deno)
  cli.ts          # CLI logic: check / fmt / context / build / render (--json everywhere)
  bin.ts          # Published CLI entry (#!/usr/bin/env node, always-runs; ADR-0065)
  lexer.ts        # layout lexer (NL/INDENT/DEDENT, pixel rows, contextual tokens)
  parser.ts       # recursive descent over spec §17 (D1–D8)
  ast.ts          # AST node types
  eval.ts         # evaluator: modules, themes, scopes, commands, budget (largest file)
  dmath.ts        # bundled deterministic math (ADR-0027) + hash/rand/noise (ADR-0026)
  color.ts        # pinned color pipeline: oklch↔sRGB, gamut map, mix, ops
  values.ts       # runtime values: points, regions, 4×4 transforms, sprites
  framebuffer.ts  # RGBA8 straight-alpha + pinned source-over (ADR-0025)
  raster.ts       # primitives, eliminators, gradients, stamps, filters, text
  fonts.ts        # shared font helpers; std font faces live in src/std/fonts/ (ADR-0054)
  png.ts          # PNG encoder (RGBA + indexed) + decoder (for `import`)
  svg.ts          # SVG writer (pixel-run rects, ids/classes/inlineStyles)
  jpeg.ts         # baseline JPEG encoder (quality-scaled tables)
  sidecars.ts     # tiled .tsj/.tsx, atlasJson, aseprite descriptors
  build.ts        # export runner (spec §13)
  fmt.ts          # canonical formatter
  preview.ts      # --ascii / --preview renderings
  std.ts          # bundled std/ modules (ADR-0035, ADR-0054); recipe sources are src/std/*.drw.ts TS modules (ADR-0065)
  diagnostic.ts   # structured diagnostics (ADR-0030)
  inspect.ts      # sprite inspection for CLI `context` (internal)
  lint.ts         # recipe lint checks for CLI `check` (internal)
  # No barrel: the public API is the package.json subpath `exports` map (ADR-0065).
dist/           # Compiled library output (bun run build; only in NPM package)
tests/          # Tests
  unit/           # lexer/parser/dmath/eval/fmt + e2e (render → PNG → decode → assert)
    bench/         # Tests for the bench dev tooling
bench/          # token-efficiency bench suite (see bench/README.md)
examples/
  basic-shapes/   # circle.drw, square.drw
  showcase/       # showcase.drw + parts.drw + themes.drw — full-surface e2e example
skills/          # User-facing agent skills, consumable by LLM agents (the actual "product"; shipped in the npm package)
  drawstic/      # How an LLM agent uses Drawstic: SKILL.md (workflow, core syntax, idioms) + reference.md (full CLI + language reference)
.claude/
  skills/        # Agent skills for library development
```

---

## 3. Tech stack and tools

- **Runtime & package manager: [Bun](https://bun.com)** (v1.3+). Not Node. `bun install`, `bun run`.
- **Language: TypeScript, `strict` + `noUncheckedIndexedAccess`.** ESM only; relative imports use
  **`.js` extensions** (nodenext style, e.g. `./parser.js` — Bun and tsc resolve them to the `.ts`
  source; the build emits them as-is, ADR-0065), `verbatimModuleSyntax` — use `import type` for types.
- Compatibility to NodeJS, Deno, PNPM, Yarn for exported package.
- **No _runtime_ dependencies** in the shipped library unless absolutely necessary. Dev
  tooling (Biome, `js-tiktoken` for the bench suite) is a `devDependency` and is fine —
  nothing in `src/` imports it and it never reaches `dist/`. See [ADR-0014](docs/decisions/0014-token-efficiency-bench-suite.md).

---

## 4. Style — let the tools enforce it

- Code style is enforced by **Biome** (`biome.json`) and a strict `tsconfig`. Don't restate rules — run `bun run format`. Full reference: [docs/code-style.md](docs/code-style.md).
- **`type` over `interface`** for object types — Biome-enforced (`useConsistentTypeDefinitions`); `interface` only for declaration merging / augmentation.
- The one rule Biome can't enforce: **arrow functions over function declarations** — follow it by hand.
- Functional code style is preferred, but OOP can be used where it makes sense.

---

## 5. Documentation

`docs/` holds the detail (progressive disclosure — read what's relevant). Keep this index current when adding docs.

- [Language spec](docs/language-spec.md) — canonical reference for the Recipe DSL.
- [Best practices](docs/best-practices.md) — idiomatic Drawstic authoring: colours, palettes, std, composition, verification.
- [Recipe examples](docs/dsl-examples.md) — worked Recipes showing the language in use.
- [Motif cookbook](docs/motif-cookbook.md) — tested, copyable snippets for recurring scene motifs (palm, cloud, water, night lighting, dunes, starfield).
- [Code style](docs/code-style.md) — detailed code style rules.
- [Bench suite](bench/README.md) — token-efficiency + readability/editability benchmarking.
- [Scene-DX Evaluation 2026-07-08](docs/scene-dx-evaluation-2026-07-08.md) - first multi-agent LLM-authoring evaluation for seven scenes; overall grade 1.9; main gaps were lighting ergonomics, organic closed shapes, verification workflow, and composition guidance.
- [Scene-DX Rerun Evaluation 2026-07-08](docs/scene-dx-rerun-evaluation-2026-07-08.md) - blind rebuild of all seven scenes after the first fix wave; overall grade improved from 1.9 to 1.7, with clear gains in lighting and diagnostics.
- [Scene-DX Masterpiece Evaluation 2026-07-08](docs/scene-dx-masterpiece-evaluation-2026-07-08.md) - larger-canvas scene rebuild with masks, transforms, and richer composition; overall grade improved to 1.6; remaining gaps shifted from syntax to craft discipline.
- [Icon-DX Evaluation 2026-07-08](docs/icon-dx-evaluation-2026-07-08.md) - first icon-family run: seven families, six icons each, PNG and SVG export; overall grade 1.8; fix wave shipped `drawstic sheet`, W008, and [icon-craft.md](skills/drawstic/icon-craft.md).
- [Character-DX Evaluation 2026-07-09](docs/character-dx-evaluation-2026-07-09.md) - first modular-character run with front/side views and colour variants; overall grade 1.8; main gaps were attach discipline, seam detection, and silhouette review.
- [Item-DX Evaluation 2026-07-09](docs/item-dx-evaluation-2026-07-09.md) - first game-item-set run: seven sets of six items, PNG @1/@4, `atlasJson`, and Tiled `.tsj`; overall grade 1.7; sidecars held, near-neighbour differentiation remained the main craft gap.
- [Item-DX v2 Evaluation 2026-07-09](docs/item-dx-v2-evaluation-2026-07-09.md) - 64x64 item rerun in `examples/items-v2/`; overall grade stayed 1.7; material readability improved while silhouette and contact-sheet QA remained mandatory.
- [Decisions](docs/decisions/) — Architectural Decision Records (ADRs) for all material decisions, including language updates such as [ADR-0059](docs/decisions/0059-relative-point-expressions.md).
  Latest packaging update: [ADR-0084](docs/decisions/0084-minimal-npm-package-contents.md) keeps npm package contents to compiled code, product skill, README, and license.

## 6. Skills & self-improvement — grow the project's tooling

You are expected to **extend your own tooling** as the project grows, not just execute tasks.

**Agent Skills** live in `.claude/skills/<name>/SKILL.md` — Claude Code auto-discovers these (`.agents/skills/` is *not* discovered, so we use `.claude/skills/`; the only robustly cross-platform discovery path). Each skill is a concise `SKILL.md` with `name` + `description` frontmatter; the `description` (third person, lead with the use case + when to use) is what triggers auto-invocation. Keep bodies under ~500 lines and link bundled files for progressive disclosure.

- **Create a skill when a multi-step procedure repeats or is error-prone** — a content type, a release step, a subsystem edit, an infra routine. Don't pre-build speculative skills; add one the **second** time you'd run the same dance ("keep it small").
- **Keep skills accurate:** when a command, path, or convention changes, update the affected skill in the same change.

**Product skill — `skills/drawstic/` is source code.** It ships in the npm package and is
how consuming agents learn Drawstic. **Any change to the language, CLI, or workflow MUST
update `skills/drawstic/SKILL.md` + `reference.md` in the same change** — precisely and
token-optimized, never letting quality slip. Treat a stale product skill as a failing test.

**Self-improvement loop** — when you learn something durable, capture it where it compounds:
- a **skill** (`.claude/skills/`) for a repeatable procedure,
- an **ADR** ([docs/decisions/](docs/decisions/)) for a material decision (use the `new-adr` skill),
- a **doc** ([docs/](docs/)) for feature/architecture detail,
- a **memory** for a user or workflow preference.

Keep the indexes current: this file (§5 docs + the skill list below) and each skill's `description`.

**Current skills:** [new-adr](.claude/skills/new-adr/SKILL.md) — record a material decision as an ADR and sync the indexes. [craft-eval](.claude/skills/craft-eval/SKILL.md) — run a multi-agent OOTB craft evaluation for a graphics category (`TODO-<CAT>.md` in repo root): builder wave, Evaluation report, consolidation, fix wave, craft-guide distillation, skill routing.
