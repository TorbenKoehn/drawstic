# 63. Explicit local lighting helpers

- Status: Accepted (`shadeRegion` signature refined by [ADR-0068](0068-shaderegion-veil-opacity-signature.md); additive `lightRegion` added by [ADR-0069](0069-additive-local-light-helper.md))

## Context

Recipes need concise highlights, rims, and contact darkening, but hidden auto-lighting would
make drawings harder to inspect and reproduce.

## Decision

Add local, explicit commands:

- `shadeRegion region lightPoint base amount`
- `rim region direction paint [width]`
- `ambientOcclusion region paint amount`

The commands operate on regions and write normal pixels into the current framebuffer. They do
not infer scene lights, materials, or global state.

## Consequences

Authors can add deterministic depth to simple shapes while keeping every light position,
direction, color, and strength visible in the recipe.
