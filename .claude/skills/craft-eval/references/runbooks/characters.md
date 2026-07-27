# Runbook - Modular Game Figures

*Recipes consolidated for the 1.0 release — this run's recipes live in git history; see
`docs/release-1.0/README.md` (D3).*

Status: completed on 2026-07-09. Procedure: `.claude/skills/craft-eval/SKILL.md`. Output: `examples/characters/`. Evaluation report: `docs/character-dx-evaluation-2026-07-09.md`. Craft guide: `skills/drawstic/character-craft.md`.

## Goal

Build full characters from modular parts: head, torso, arms, legs, and accessory. The craft focus is small-grid proportion control, part composition with stamps and anchors, readable silhouettes, material ramps for skin/cloth/metal/leather, and palette swaps for variants. This stresses `stamp`, `anchor`, `flip`, `mirror`, and `pal` more than prior runs.

## Phase 0 - Preconditions

No engine work was expected. The pre-check asked whether `pal` can produce clean colour-swap variants for stamped characters. The result was a documented gap: stamped parts need parametric colour input or explicit palette-swap structure.

## Agent Assignment

| Agent | Model | Archetype | Focus |
|---|---|---|---|
| 1 | fable | Knight | Metal shading, helmet, visor |
| 2 | opus | Mage | Cloth folds, staff, glow accent |
| 3 | opus | Robot | Hard surface, joints, emissive lights |
| 4 | opus | Archer | Asymmetric pose, bow, quiver |
| 5 | sonnet | Villager | Everyday clothing, warm palette |
| 6 | sonnet | Skeleton warrior | Bone ramp, damaged shield |
| 7 | sonnet | Dwarf smith | Stocky proportions, beard, hammer, apron |

## Requirements

- Parts are standalone non-exported draws and the full body is composed with stamps. Composition quality is part of the score.
- Full body height: 48-64 px, with front and side view. A side view must be redrawn or explicitly justified if derived by flip or mirror.
- One colour variant via theme or palette-swap structure.
- Exports: PNG @1 and @4 for each view and variant. Parts must remain inspectable through fragment renders.
- Quality bar: unambiguous @1 silhouette, consistent light direction, contact shadow, and no floating limbs.

## Extra Score Rows

Part composition and anchor discipline; palette-swap/recolor quality; small-grid proportion DX; two-view workflow and reuse strategy.

## Construct-census success criteria (ADR-0094)

`critique --json` (and `check --lint --json`) carry a deterministic `census` with four `antiPatterns`
counts. A character build passes the census gate only when **all four are 0** across every recipe:

- `rawShade` (**raw-rim = 0**) — no raw `rim`/`shadeRegion`/`lightRegion` beside a `model`/`cel`; the
  lit edge is the material's own `rim`/`spread` dose (W012).
- `manualSpread` (**manual-spread = 0**) — no `litTone`/`shadowTone` `.intersect(rect)` corner patch;
  value spread comes from the material `spread N%` (W013).
- `stampWithPins` (**stamp-of-pinned-part = 0**) — every pinned part is placed by `fit` (contact
  guaranteed); `stamp` is for pin-less decoration only; the pin-seeded assembly root is exempt (W014).
- `handShadow` (**hand-ellipse-shadow = 0**) — contact shadows come from the root `fit … shadow`, never
  a hand `ellipse` in the foot zone (W015).

Also watch the `spec-only`/`non-canonical` construct flags: a build leaning on floor constructs
(`scatter`/`mirror`/`pixels:`/raw shading) where a canonical path exists is a craft signal. The
Oracle-usage quote (proportions oracle) is added in W2-3.

## Definition of Done

- [x] 7 character recipes in `examples/characters/`, all `check --json` = `[]`, fmt-clean.
- [x] Front, side, and variant PNGs at @1 and @4 exist and were visually sampled.
- [x] 7 individual evaluation reports, one consolidated evaluation report, and an AGENTS.md docs-index entry.
- [x] Fix wave completed with code first, docs second, probe verification, and `bun run test` passing.
- [x] `skills/drawstic/character-craft.md` plus routing in `skills/drawstic/SKILL.md`.
