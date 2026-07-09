# Runbook - Icon Families with PNG and SVG Export

Status: completed. Main run: 2026-07-08. Fix wave: 2026-07-09. Procedure: `.claude/skills/craft-eval/SKILL.md`. Output: `examples/icons/`. Evaluation report: `docs/icon-dx-evaluation-2026-07-08.md`. Craft guide: `skills/drawstic/icon-craft.md`.

## Goal

Build icon families for common application domains. The craft focus is pixel-scale readability at 16/32/64 px, optical centering, consistent family style, shared corner radii, stroke weights, and palette discipline. The run also stress-tested themes and SVG export.

## Phase 0 - Preconditions

No engine work was expected. The pre-check covered SVG export ergonomics for ids, classes, and inline styles, plus theme suitability for family consistency.

## Agent Assignment

| Agent | Model | Family | Icons |
|---|---|---|---|
| 1 | fable | Media | camera, gallery, microphone, music, video, podcast |
| 2 | opus | Weather/time | compass, moon, stopwatch, timer, alarm, weather tile |
| 3 | opus | Finance | bank, wallet, chart, invoice, cart, tag |
| 4 | opus | Communication | chat, phone, contacts, feed, share, videocall |
| 5 | sonnet | Productivity | calendar, clock, calculator, mail, notes, todo |
| 6 | sonnet | System | search, settings, files, downloads, terminal, trash |
| 7 | sonnet | Games | controller, dice, heart, map, puzzle, trophy |

## Requirements

- Each family ships 6 icons at 32 px, at least 2 icons redrawn at 16 px, and 1 detailed 64 px icon.
- Each family lives in one recipe and uses a theme for palette, style guide, and defaults.
- Exports: PNG @1/@2 and SVG, with useful ids/classes where applicable.
- Quality bar: recognizable at native size, consistent highlight edge, no orphan pixels, optical centering.

## Extra Score Rows

SVG export DX; theme effectiveness; 16 px redraw workflow; family consistency tooling and contact-sheet support.

## Definition of Done

- [x] 7 family recipes in `examples/icons/`, all `check --json` = `[]`, fmt-clean.
- [x] PNG and SVG exports exist; 189 artifacts total.
- [x] 7 individual evaluation reports, one consolidated evaluation report, and an AGENTS.md docs-index entry.
- [x] Fix wave completed with code first, docs second, probe verification, and `bun run test` passing.
- [x] `skills/drawstic/icon-craft.md` plus routing in `skills/drawstic/SKILL.md`.
