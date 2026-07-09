# 69. `lightRegion` additive local light helper

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0063](0063-explicit-local-lighting-helpers.md); pairs with [ADR-0068](0068-shaderegion-veil-opacity-signature.md)

## Context

The explicit local lighting helpers ([ADR-0063](0063-explicit-local-lighting-helpers.md)) only
**darken**: `shadeRegion` veils toward a shadow colour, `ambientOcclusion` strokes contact
shadow, `rim` lights a one-pixel edge. There is no distance-scaled **brightening** helper. The
Scene-DX evaluation ([evaluation](../scene-dx-evaluation-2026-07-08.md), prioritized action #6) found
warm local light was repeatedly **faked** with masked radial gradients plus `rim` (volcano
glow, island sun) — verbose, hard to aim, and inconsistent with the region-first darkening
helpers authors already knew.

## Decision

**1 — Add `lightRegion region lightPoint paint amount`**, the additive mirror of the version-2
`shadeRegion` ([ADR-0068](0068-shaderegion-veil-opacity-signature.md)). It blends `paint` as a
light **veil** over each in-region pixel with opacity

```
alpha = paint.a × amount × (1 − t),   t = clamp01(dist(pixel, light) / maxDist)
```

Nearest the light point is **brightest** (up to `paint.a × amount`); the far corner is
untouched. It shares the exact region-scan + normalized-distance spine as `shadeRegion` — that
darkens by `t`, this brightens by `1 − t` — so a shade/light pair aimed at the same point are
mirror-consistent by construction. Deterministic and pinned: integer straight-alpha source-over
([ADR-0025](0025-alpha-compositing-model.md)), bundled `hypot`
([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)), round-half-up commit.

```drw
fill lava crater
lightRegion crater vent #ffd08a 0.8   # hottest at the vent, fading outward
```

**2 — A new command, introduced with language version 2.** `lightRegion` is reserved like every
other command name; parsing is the generic command form (no parser/AST change). It has no v1
counterpart, so no legacy path is needed.

## Consequences

- Warm/cool local light is now one explicit, aimable call instead of a masked-gradient +
  `rim` detour — symmetric with `shadeRegion`, so authors reuse one mental model for both
  directions of light.
- Touches [spec §12](../language-spec.md#12-colour-gradients-filters--themes) (filter list +
  compositing semantics), [§17](../language-spec.md#17-grammar-normative) (filter-cmd grammar),
  `src/raster.ts`, `src/eval.ts`, tests, and the product skill
  (`skills/drawstic/SKILL.md` + `reference.md`).
