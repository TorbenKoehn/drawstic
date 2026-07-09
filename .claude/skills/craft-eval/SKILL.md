---
name: craft-eval
description: Use this skill when executing a Drawstic category evaluation or an "Evaluation report" run for a graphics category. Runs the full multi-agent builder wave, consolidation report, fix wave, craft-guide distillation, and product-skill routing from bundled runbooks. Do not use for one-off asset creation, normal recipe authoring, code-only bug fixes, or small docs updates.
---

# craft-eval

Run Drawstic's established category-evaluation loop from a bundled runbook: produce category
artifacts in `examples/<cat>/`, capture DX findings, ship fixes, and distill a reusable craft
guide in `skills/drawstic/<cat>-craft.md`.

## Runbook selection

Load exactly the runbook needed for the requested category or backlog item:

| Request | Runbook |
|---|---|
| animation frames, GIF, sprite sheets | [references/runbooks/animation.md](references/runbooks/animation.md) |
| modular characters / game figures | [references/runbooks/characters.md](references/runbooks/characters.md) |
| icon families | [references/runbooks/icons.md](references/runbooks/icons.md) |
| item or equipment sets | [references/runbooks/items.md](references/runbooks/items.md) |
| portraits | [references/runbooks/portraits.md](references/runbooks/portraits.md) |
| tilesets / terrain tiles | [references/runbooks/tilesets.md](references/runbooks/tilesets.md) |
| game/app UI kits | [references/runbooks/ui.md](references/runbooks/ui.md) |
| Scene-DX fix backlog | [references/runbooks/scene-dx-improvements.md](references/runbooks/scene-dx-improvements.md) |
| general authoring/tooling backlog | [references/runbooks/authoring-improvements.md](references/runbooks/authoring-improvements.md) |
| older general backlog | [references/runbooks/general-backlog.md](references/runbooks/general-backlog.md) |

If the user names a category without a matching runbook, create a compact runbook first only when
the category scope is clear. Otherwise ask one precise scope question.

## Phase 0 - Preconditions

Read the selected runbook before doing work. If it calls for engine or product-skill groundwork
such as a new export, semantic change, CLI surface, or craft-guide route, implement that as a
separate wave first. Material decisions require `new-adr`; language, CLI, or workflow changes must
update `skills/drawstic/SKILL.md` and `skills/drawstic/reference.md` in the same change. End the
groundwork wave with `bun run test`.

## Phase 1 - Builder Wave

Use the model mix and assignments from the selected runbook. The historical default is 7 builders:
1 fable, 3 opus, 3 sonnet; newer runbooks may map those labels to current model tiers.

Builder prompt template, filling placeholders from the runbook:

> You are an LLM agent using Drawstic out of the box for the first time. Repo: current workspace.
> Your ONLY instruction is the product skill at `skills/drawstic/` (`SKILL.md`, `reference.md`, and
> the craft guides linked from there). Read it fully. CLI: `bun run drawstic <cmd>` from the repo root.
> IMPORTANT: You are the author. Do not start sub-agents and do not delegate.
> FORBIDDEN: do not read `docs/*evaluation*`, `.claude/skills/craft-eval/references/runbooks/*`,
> `docs/motif-cookbook.md`, `docs/dsl-examples.md`, previous outputs for this category, or sibling
> outputs from the same run. Escape to `src/` or other docs only if truly blocked, and record that as
> a DX finding.
> TASK: build the assigned masterpiece from the runbook at the assigned output path.
> QUALITY BAR: use the category quality criteria from the runbook.
> WORKFLOW: follow `skills/drawstic/SKILL.md`: `check` -> `fmt` -> `render` -> inspect PNG visually
> -> refine until the artifact is genuinely strong. Count full renders after edits separately from
> debug/crop/fragment renders. Finish with `check --json` = `[]`, fmt-clean source, and the exports
> required by the runbook.
> REPORT: write an English evaluation report to the scratchpad path:
> 1. Header: subject, model, dimensions, line count, full/debug iterations, overall grade.
> 2. Grade table for used systems only, otherwise n/a: pixels+pal, primitives, gradients, stamp,
> shadow/castShadow, textures, lighting, regions & masks, transforms, path, new constructs,
> control flow+rand/noise, color system, std modules, themes, exports/sidecars, CLI
> check/render/fmt/context, diagnostics, plus the category-specific rows from the runbook.
> 3. Syntax assessment: writability, intuitiveness, token economy, editability,
> self-verifiability.
> 4. Findings: numbered, with E/W codes when relevant, iteration cost, and whether `check` caught
> the issue or it was silent.
> 5. Highlights.
> 6. Craft retrospective: the reusable rules, recipes, and checklists the product skill would need
> for first-run quality.
> Reply with raw facts only: dimensions, line count, iterations, grade, top 3 findings, top 3 craft
> retrospective points, and paths.

Operational lessons:

- Some builders delegate despite the prompt. If that happens, send them back: "You are the author;
  no sub-agents. Continue and report only when artifacts exist."
- If an API run fails mid-task, resume the same agent at the same point so context is preserved.
- After the wave, verify yourself: directory listing has only expected artifacts, remove debug
  leftovers, and run `check --json` over every recipe.

## Phase 2 - Consolidation

Use one strong agent to read all individual evaluation reports plus relevant prior evaluation
reports. Write `docs/<cat>-dx-evaluation-<date>.md` following the established evaluation-report
shape: header table, averaged grade table, syntax table, delta against previous runs when available,
deduplicated findings by hit count, excellence consensus, meta findings, prioritized actions, and
overall verdict.

Include a "Craft Retrospective Synthesis" section with deduplicated rules and requester count
(`x/7`). Name contradictions between reviewers instead of averaging them away. Do not normalize
iteration counts; add a footnote if needed. Add the report to the docs index in `AGENTS.md`.

## Phase 3 - Fix Wave

Implement prioritized actions from the consolidated report: code fixes first, then docs/product
skill updates after signatures and behavior are stable. Do not document a behavioral claim without
a probe render in scratch output. If a report claim is disproven, record the discrepancy instead of
propagating it. End with `bun run test` and all relevant `examples/**/*.drw` files check-clean.

## Phase 4 - Craft Guide and Routing

Distill the best artifacts plus craft retrospectives into `skills/drawstic/<cat>-craft.md`.
Match the existing craft-guide style: mandatory order, numeric dosages, copyable idioms, and
verification cadence, with every claim probe-verified. Add the route to `skills/drawstic/SKILL.md`
under "Craft routing" and add a compact mandatory core for the category there. Keep the product
skill precise and token-economical.

## Phase 5 - Closeout

Run `bun run test`, full-check relevant examples, mark the runbook Definition of Done inside the
runbook if the run is completed, and report the grade table, deltas, top findings, artifact paths,
and recommended next step.
