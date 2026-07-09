# Character-DX Evaluation - Modular Character Authoring (2026-07-09)

This first modular-character run produced seven archetypes with head, torso, arms, legs, accessories, front and side views, and a colour variant. The scoring scale uses 1.0 as best and higher numbers as worse.

## Summary

Overall grade: 1.8. The run validated stamp-based modular composition, but exposed the widest model spread so far: fable 1.3, opus 1.6, and sonnet 2.1. The largest gaps were part composition, anchor discipline, missing attach/joint idioms, and silent seam failures that only silhouette review exposed.

## Archetypes

| Archetype | Model | Main stress area | Result |
|---|---|---|---|
| Knight | fable | armor, visor, faction colour | strongest |
| Mage | opus | cloth, staff, glow | strong |
| Robot | opus | hard surface, joints, emissive parts | strong |
| Archer | opus | asymmetric pose, bow, quiver | solid |
| Villager | sonnet | everyday clothes, warm palette | solid with seam risk |
| Skeleton warrior | sonnet | thin bones, damaged shield | weakest engine-bug candidate |
| Dwarf smith | sonnet | stocky body, beard, hammer | solid |

## Main Findings

1. Full-body composition needs explicit attach points. Loose stamp coordinates caused floating limbs and visible seams.
2. Side views are usually different drawings, not mirrored front views.
3. Palette swaps do not automatically recolor already-stamped parts; parametric part colours are the better idiom.
4. Silhouette review is essential. Some body gaps were invisible in colour but obvious under `render --silhouette`.
5. A possible thin-region stroke erosion around skeleton parts was registered for verification.

## Fix Wave

- Added `skills/drawstic/character-craft.md` with a concrete definition of done.
- Documented attach and overlap idioms for modular parts.
- Clarified cross-hue `.mix()` usage.
- Added `render --silhouette` and tests through ADR-0083.

## Craft Rules Distilled

- Define shared body metrics before drawing parts.
- Give every part an anchor seam in its own local space.
- Compose full bodies back-to-front with a contact shadow first.
- Overlap joints by 1-2 px where anatomy permits.
- Verify silhouette, native size, and side view before polishing variants.
