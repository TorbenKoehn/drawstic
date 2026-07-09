# TODO-PORTRAITS - Pixel Portraits of Historical Figures

Status: open. Procedure: `.claude/skills/craft-eval/SKILL.md`. Output: `examples/portraits/`. Evaluation report: `docs/portrait-dx-evaluation-<date>.md`. Craft guide: `skills/drawstic/portrait-craft.md`.

## Goal

Build recognizable portraits of historical public-domain figures from model knowledge. The craft focus is skin-tone ramps, face geometry on a small grid, hair, beard, glasses, clothing anchors, likeness, and respectful characterization.

## Phase 0 - Preconditions

No engine work is expected. Only historical, long-deceased people should be used, with respectful depiction.

## Agent Assignment

| Agent | Model | Person | Recognition anchors |
|---|---|---|---|
| 1 | fable | Ada Lovelace | hair, period dress, analytical-engine context |
| 2 | opus | Leonardo da Vinci | beard, cap, sketchbook mood |
| 3 | opus | Cleopatra | headdress, jewelry, profile cues |
| 4 | opus | Nikola Tesla | hair, suit, electric accent |
| 5 | sonnet | Marie Curie | hair, lab coat, radium glow restraint |
| 6 | sonnet | Abraham Lincoln | beard, tall hat, long face |
| 7 | sonnet | Frida Kahlo | brows, flowers, strong colour blocks |

## Requirements

- Bust portrait: head and shoulders on a calm background, at least 96x128.
- Include 3 recognition anchors and make them visible in the @4 review.
- Exports: PNG @1/@4 plus one crop or detail sheet for anchor review.
- Verification: @1 silhouette/value test, grayscale readability, @4 detail review, and honest likeness score.
- Quality bar: respectful portrait, not caricature, with coherent lighting and skin/material ramps.

## Extra Score Rows

Likeness anchors; face-grid geometry; skin and material ramps; respectful stylization; value-readability workflow.

## Definition of Done

- [ ] 7 portraits in `examples/portraits/`, all `check --json` = `[]`, fmt-clean, PNGs @1/@4.
- [ ] 7 individual evaluation reports including anchor self-checks, one consolidated evaluation report, and an AGENTS.md docs-index entry.
- [ ] Fix wave completed with code first, docs second, probe verification, and `bun run test` passing.
- [ ] `skills/drawstic/portrait-craft.md` plus routing in `skills/drawstic/SKILL.md`.
