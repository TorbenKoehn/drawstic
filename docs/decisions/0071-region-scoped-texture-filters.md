# 71. Region-scoped texture filters

- Status: Accepted (scalar order refined by [ADR-0080](0080-unified-texture-filter-argument-order.md))
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0062](0062-scoped-shadow-and-texture-filters.md)

> **Update ([ADR-0080](0080-unified-texture-filter-argument-order.md)):** the `speckle`/`ripple`
> scalar order below (`seed density` / `seed strength`) was later unified to **`magnitude seed`**
> — `speckle [region] density seed paint`, `ripple [region] strength seed paint`. The
> region-first shape and whole-frame semantics in this ADR are unchanged.

## Context

The deterministic texture filters `grain`/`speckle`/`ripple`/`dither`
([ADR-0062](0062-scoped-shadow-and-texture-filters.md)) hit **every opaque pixel of the current
framebuffer** — they carry no region argument. Confining one to part of a scene ("grain only the
sand, not the sky") forced the author either to wrap the call in a `mask …:` block or to draw
the content in its own component `draw` and stamp the result in
([evaluation](../scene-dx-evaluation-2026-07-08.md), prioritized action #6; `TODO-IMP.md` §4.4). Both
are boilerplate detours for what is conceptually one extra argument — and the region-first
lighting helpers (`shadeRegion`/`castShadow`) already read `region first`, so the texture
filters were the odd ones out.

## Decision

**1 — Each texture filter takes an optional leading region**, region-first exactly like
`castShadow r dx:dy p` and `shadeRegion r …`:

```
grain   [region] amount seed paint
speckle [region] seed density paint
ripple  [region] seed strength paint
dither  [region] paintA paintB threshold
```

```drw
grain sand 0.3 11 #00000030      # grain only the sand region; the sky is untouched
speckle sand 17 0.1 #ffffff40
ripple water 23 0.4 #0b4b7230
dither sand #b98a4a #d8b070 0.5
```

The region confines the effect to the intersection of the region, any enclosing `mask …:`
block, and the buffer's opaque pixels — nothing outside the region is touched. This removes the
part-draw / `mask`-block detour for the "texture one material" case.

**2 — Without a region, behaviour is exactly as before — a pure extension, no pragma gate.** An
omitted region is the version-1 whole-frame filter unchanged, so this adds a form without
altering any existing render. It therefore needs **no** language-version gate (unlike
[ADR-0068](0068-shaderegion-veil-opacity-signature.md)/[ADR-0070](0070-unified-shadow-argument-shape.md),
which change existing pixels); it is available in every language version.

**3 — Region-vs-first-argument disambiguation is by value type, cleanly.** The leading argument
is treated as a region iff it evaluates to a Region (or a drawing silhouette, coerced like
`castShadow`'s region argument). This never collides with the first non-region argument:
`grain`/`speckle`/`ripple` lead with a **number**, `dither` with a **paint** — both disjoint
from Region. The first argument is evaluated once and then classified, so no expression is
double-evaluated (no double budget charge).

Deterministic and pinned: the same per-pixel hash spine ([ADR-0062](0062-scoped-shadow-and-texture-filters.md)),
integer straight-alpha source-over ([ADR-0025](0025-alpha-compositing-model.md)); the region
merely gates which pixels the existing pass visits.

## Consequences

- "Texture only this material" is one argument, not a component-draw or `mask`-block detour —
  the texture filters now match the region-first shape authors already know from the shadow and
  lighting helpers.
- No behavioural change to any existing recipe: the region-less form is byte-for-byte the v1
  filter, so no version pragma is involved.
- Touches [spec §12](../language-spec.md#12-colour-gradients-filters--themes) (filter list +
  compositing semantics + confinement idiom), [§17](../language-spec.md#17-grammar-normative)
  (filter-cmd grammar), `src/eval.ts`, `src/raster.ts`, tests, and the product skill
  (`skills/drawstic/SKILL.md` + `reference.md`), `docs/best-practices.md`.
