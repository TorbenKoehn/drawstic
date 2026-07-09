# Item-DX Evaluation - Game Item Set Authoring (2026-07-09)

This first game-item-set run produced seven sets of six items each, primarily at 32 px, with PNG @1/@4, atlas JSON, and Tiled `.tsj` sidecars. The scoring scale uses 1.0 as best and higher numbers as worse.

## Summary

Overall grade: 1.7. The sidecar stack held under load: all seven sets built cleanly, emitted usable metadata, and exposed no recurring engine-bug class. The main craft gap was differentiating near-neighbour items inside one family.

## Set Results

| Set | Model | Items | Grade |
|---|---|---|---:|
| Swords | GPT-5.5 | dagger, shortsword, longsword, scimitar, two-hander, magic blade | 1.7 |
| Shields | GPT-5.4 | round, herald, tower, buckler, wood, magic barrier | 1.7 |
| Staves and books | GPT-5.4 | combat staff, crystal staff, scepter, spellbook, scroll, amulet | 1.7 |
| Ranged | GPT-5.4 | shortbow, longbow, crossbow, arrow bundle, bolts, quiver | 1.8 |
| Potions and bottles | GPT-5.4-mini | healing, mana, poison, elixir, bomb, empty vial | 1.9 |
| Armor parts | GPT-5.4-mini | helm, breastplate, gloves, boots, belt, cloak | 1.7 |
| Tools and loot | GPT-5.4-mini | pickaxe, axe, key, coin pouch, gem, crown | 1.6 |

## Main Findings

1. Sidecar export was stable. `atlasJson` and `.tsj` worked across all sets.
2. `atlasJson` is preferred for runtime consumers because named frames are clearer than order-only tile metadata.
3. The model spread collapsed: GPT-5.5, GPT-5.4, and GPT-5.4-mini all averaged 1.7.
4. The hardest issue was near-neighbour differentiation: shortbow versus longbow, arrow bundle versus bolts, herald shield versus tower shield, pickaxe versus axe, and similar pairs.
5. 32x32 became the practical default for material-rich inventory items; no set chose 24x24.
6. The missing doc was an item-specific craft and sidecar QA cookbook, not new core syntax.

## Fix Wave

- Added `skills/drawstic/item-craft.md`.
- Documented contact-sheet review as the standard set QA path.
- Kept atlas JSON naming as the stable sidecar contract.

## Craft Rules Distilled

- Establish a set contract first: grid, outline, light direction, material palette, and margin.
- Render confusing pairs side by side early.
- Verify native size and contact sheet before @4 polish.
- Use named atlas frames as the runtime-friendly contract.
- Keep material cues small, repeatable, and distinct.
