# TODO-UI - Pixel UI Kits for Games and Apps

Status: open. Procedure: `.claude/skills/craft-eval/SKILL.md`. Output: `examples/ui/`. Evaluation report: `docs/ui-dx-evaluation-<date>.md`. Craft guide: `skills/drawstic/ui-craft.md`.

## Goal

Build complete UI kits for games and apps. The craft focus is state variants without copy-paste, nine-slice discipline, parametric fill amounts for HP/progress bars, kit coherence, and metadata gaps for nine-slice export.

## Phase 0 - Preconditions

No engine work is expected. Pre-check whether fragment arguments such as `file#draw(args)` are ergonomic enough for state and fill variants. Treat missing nine-slice metadata export as an expected finding if it appears.

## Agent Assignment

| Agent | Model | Kit style |
|---|---|---|
| 1 | fable | Fantasy stone and parchment |
| 2 | opus | Clean productivity UI |
| 3 | opus | Sci-fi cockpit |
| 4 | opus | Cozy farming game |
| 5 | sonnet | Dark roguelike |
| 6 | sonnet | Mobile casual game |
| 7 | sonnet | Minimal monochrome tool UI |

## Required Components

All 7 kits must include: button with 4 states, nine-slice panel, HP/mana bar at 0/33/66/100 percent, checkbox, slider, dialog box with title bar, 4x2 inventory grid with one sample slot, cursor or pointer, and active/inactive tabs.

## Requirements

- Button states must be generated parametrically or through theme variants; copy-paste frames are a scoring penalty.
- Nine-slice proof: render a panel at two stretched sizes such as 64x48 and 128x64; corners must not distort.
- Button states must stay distinguishable at @1.
- Exports: overview sheet and individual PNGs @1/@2.
- Quality bar: coherent kit, clean contrast, and no unreadable labels or controls.

## Extra Score Rows

State-variant DX; nine-slice idiom and metadata gap; parametric fragments in build; kit coherence tooling.

## Definition of Done

- [ ] 7 kits in `examples/ui/`, all `check --json` = `[]`, fmt-clean.
- [ ] Overview sheet, individual exports, nine-slice proof, and bar fill states exist for each kit.
- [ ] 7 individual evaluation reports, one consolidated evaluation report, and an AGENTS.md docs-index entry.
- [ ] Fix wave completed with code first, docs second, probe verification, and `bun run test` passing.
- [ ] `skills/drawstic/ui-craft.md` plus routing in `skills/drawstic/SKILL.md`.
