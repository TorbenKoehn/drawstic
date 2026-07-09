# Runbook - Tileable Terrain Sets

Status: open. Procedure: `.claude/skills/craft-eval/SKILL.md`. Output: `examples/tilesets/`. Evaluation report: `docs/tileset-dx-evaluation-<date>.md`. Craft guide: `skills/drawstic/tileset-craft.md`.

## Goal

Build tileable terrain sets for games. The craft focus is seamless edges, anti-repetition noise, transition tiles, autotile neighbourhoods, and top-down versus side-on readability. This is a second heavy test for Tiled sidecar export after item sets.

## Phase 0 - Preconditions

Pre-check whether a wrap or tile-repeat preview tool exists. If manual stamp loops are still required, record the missing preview as an expected finding and document the manual idiom in the craft guide.

## Agent Assignment

| Agent | Model | Set | Scope |
|---|---|---|---|
| 1 | fable | Grass and dirt | base variants, path edges, props |
| 2 | opus | Dungeon stone | floor, wall edges, cracks, debris |
| 3 | opus | Coast sand and water | autotile transition set |
| 4 | opus | Lava rock | animated-looking heat motifs without animation |
| 5 | sonnet | Snow and ice | snow, ice, rock, transition edges |
| 6 | sonnet | Forest floor and props | ground variants, roots, tree props |
| 7 | sonnet | Sci-fi panels | metal floor, hazard edges, vents |

## Requirements

- Tile size: 16x16 or 24x24, consistent within each set.
- Base tiles should have at least 2-3 noise variants.
- Include 3x3 repeat renders for base tiles and mixed-transition proof renders in the evaluation report.
- Exports: tileset PNG, `.tsj`, and one small demo-map image per set.
- Quality bar: no visible seams, no blinking hotspot pixels, and transitions read as terrain rather than borders.

## Extra Score Rows

Seamless workflow; autotile neighbourhood DX; `.tsj`/`.tsx` export; repeat-preview tooling; demo-map verification.

## Definition of Done

- [ ] 7 sets in `examples/tilesets/`, all `check --json` = `[]`, fmt-clean.
- [ ] Tileset PNG, `.tsj`, repeat-proof renders, and demo map exist for each set.
- [ ] 7 individual evaluation reports, one consolidated evaluation report, and an AGENTS.md docs-index entry.
- [ ] Fix wave completed with code first, docs second, probe verification, and `bun run test` passing.
- [ ] `skills/drawstic/tileset-craft.md` plus routing in `skills/drawstic/SKILL.md`.
