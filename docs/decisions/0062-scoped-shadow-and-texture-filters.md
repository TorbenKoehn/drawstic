# 62. Scoped shadows and deterministic texture filters

- Status: Accepted

## Context

Whole-frame `shadow` is useful for final polish, but local object shadows required duplicated
geometry. Seeded noise existed as a math helper, but texture authoring still required verbose
per-pixel loops.

## Decision

Keep the existing whole-frame `shadow dx dy paint` filter. Add explicit local forms:

- `castShadow region dx:dy paint`
- `shadow region dx:dy paint`
- `stamp part pt shadow dx:dy paint`

The region forms paint only the shifted silhouette. The stamp form paints the tinted source
silhouette first, then the original stamp.

Add deterministic framebuffer texture filters:

- `grain amount seed paint`
- `speckle seed density paint`
- `ripple seed strength paint`
- `dither paintA paintB threshold`

All texture filters operate on existing opaque pixels, respect the active mask, and require
explicit numeric seeds where randomness is involved.

## Consequences

Object-level depth no longer needs geometry duplication. Texture remains an explicit command
surface rather than an ambient material or hidden theme behavior.
