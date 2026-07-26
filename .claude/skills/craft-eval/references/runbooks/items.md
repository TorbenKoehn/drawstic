# Runbook - Item and Equipment Sets with Atlas Export

*Recipes consolidated for the 1.0 release — this run's `examples/items/` output lives in git
history; the V2 rerun's `examples/items-v2/` output is unaffected. See `docs/release-1.0/README.md`
(D3).*

Status: completed on 2026-07-09. Procedure: `.claude/skills/craft-eval/SKILL.md`. Output: `examples/items/`. Evaluation report: `docs/item-dx-evaluation-2026-07-09.md`. Craft guide: `skills/drawstic/item-craft.md`.

V2 rerun completed on 2026-07-09 with 64x64 items in `examples/items-v2/`. Evaluation report: `docs/item-dx-v2-evaluation-2026-07-09.md`. Model tiers used GPT labels instead of legacy labels: `fable -> gpt-5.5`, `opus -> gpt-5.4`, `sonnet -> gpt-5.4-mini`.

## Goal

Build game-item sets in a consistent set style. The craft focus is material rendering for metal, wood, leather, glass, liquid, and gems; grid discipline; set coherence; atlas and Tiled sidecar usability.

## Phase 0 - Preconditions

No engine work was expected. The pre-check focused on atlas and tileset export ergonomics from one recipe with many draws: naming, ordering, metadata, and consumer readability.

## Agent Assignment

| Agent | Model | Set | Items |
|---|---|---|---|
| 1 | gpt-5.5 | Swords | dagger, shortsword, longsword, scimitar, two-hander, magic blade |
| 2 | gpt-5.4 | Shields | round shield, herald shield, tower shield, buckler, wood shield, magic barrier |
| 3 | gpt-5.4 | Staves and books | combat staff, crystal staff, scepter, spellbook, scroll, amulet |
| 4 | gpt-5.4 | Ranged | shortbow, longbow, crossbow, arrow bundle, bolts, quiver |
| 5 | gpt-5.4-mini | Potions and bottles | healing potion, mana potion, poison, elixir, bomb, empty vial |
| 6 | gpt-5.4-mini | Armor parts | helm, breastplate, gloves, boots, belt, cloak |
| 7 | gpt-5.4-mini | Tools and loot | pickaxe, axe, key, coin pouch, gem, crown |

## Requirements

- One grid per set: 24x24 or 32x32 per item, consistent within the set.
- Consistent item orientation, shared theme, palette, and outline convention.
- Exports: individual PNGs @1/@4, atlas JSON, and Tiled `.tsj`.
- Quality bar: material is immediately readable, items remain distinct at inventory size, and the family feels unified.

## Extra Score Rows

Atlas/sidecar export DX; material idioms; grid and set consistency; theme effectiveness across six items.

## Definition of Done

- [x] 7 set recipes in `examples/items/`, all `check --json` = `[]`, fmt-clean.
- [x] Individual PNGs, atlas, and `.tsj` exist for each set and were sampled for content correctness.
- [x] 7 individual evaluation reports, one consolidated evaluation report, and an AGENTS.md docs-index entry.
- [x] Fix wave completed with code first, docs second, probe verification, and `bun run test` passing.
- [x] `skills/drawstic/item-craft.md` plus routing in `skills/drawstic/SKILL.md`.
- [x] V2 rerun: 7 recipes in `examples/items-v2/`, 64x64 items, all `check --json` = `[]`, sidecars verified for 64x64 frames.
