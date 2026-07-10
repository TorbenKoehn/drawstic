# 68. `shadeRegion` veil-opacity signature (language version 2)

- Status: Accepted (made unconditional — no longer version-gated, `shadeRegionLegacy` removed —
  by [ADR-0088](0088-in-place-v1-break.md); this signature is now the sole `shadeRegion`
  semantics)
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0063](0063-explicit-local-lighting-helpers.md); gated by [ADR-0029](0029-language-version-pragma.md) (gate removed by [ADR-0088](0088-in-place-v1-break.md))

## Context

`shadeRegion region light base amount` ([ADR-0063](0063-explicit-local-lighting-helpers.md),
[spec §12](../language-spec.md#12-colour-gradients-filters--themes)) was **the single costliest
bug of the Scene-DX evaluation — 7/7 graders hit it**
([evaluation](../scene-dx-evaluation-2026-07-08.md), consolidated finding #1). Its v1 semantics split
two concerns dishonestly:

- `base`'s **alpha** doubled as the veil opacity for the *whole* region, so a natural opaque
  `base` (`#223344`, `blockShade`) **repainted the region solid and erased detail already
  painted inside it**, regardless of paint order.
- `amount` scaled **only** the distance-darkening toward black (`0` = flat `base` tint, `1` =
  far corner fully black), not opacity — the opposite of what the argument name suggests.

The intuitive call `shadeRegion hill sun #001a33 0.5` ("a dark veil at ~50%, deepest away from
the sun") produced a flat opaque repaint. No `check` could catch it (semantically silent); only
reading `raster.ts` or a probe render revealed it. Lint `W005` was added as a stopgap but a lint
that fires on the *intuitive* call is a symptom, not a fix.

## Decision

**1 — In language version 2, `amount` is the veil opacity.** `shadeRegion r light base amount`
blends `base` as a shadow **veil** over each in-region pixel with opacity

```
alpha = base.a × amount × t,   t = clamp01(dist(pixel, light) / maxDist)
```

where `maxDist` is the region bbox's farthest corner from `light`. The pixel **at** the light
(`t = 0`) is untouched; the far corner reaches `base.a × amount`. It is a source-over blend, not
a repaint — **an opaque `base` no longer erases detail**; it just lets the far side reach the
full `base` colour. `base`'s own alpha still multiplies (so `.alpha(…)` further softens the
veil), but it no longer *is* the opacity.

```drw
# v2: intuitive — a cool shadow, deepest away from the sun, detail underneath survives
fill hillLit hill
shadeRegion hill sun #0c1830 0.6
```

**2 — The change is a breaking pixel change, gated on the version pragma
([ADR-0029](0029-language-version-pragma.md)).** The engine now supports **language version 2**
(`LANGUAGE_VERSION = 2`). Recipes pinning `drawstic 1` keep the v1 "base alpha = opacity, amount
= distance-darkening toward black" semantics (retained as `shadeRegionLegacy` in `raster.ts`);
unpinned recipes and `drawstic 2`+ get the v2 signature. Every existing bundled scene already
pins `drawstic 1`, so their rendering is unchanged. Version 2 is identical to version 1 in every
other respect ([ADR-0053](0053-v1-engine-pinned-implementation-constants.md) constants carry
forward); `shadeRegion` is its sole difference, joined by the additive
[`lightRegion`](0069-additive-local-light-helper.md) helper.

**3 — Lint `W005` is retired for version 2.** Under v2 an opaque `base` is the *correct*
intuitive call, so `W005` ("opaque base repaints the whole region") fires only for `drawstic 1`
modules; v2/unpinned recipes never see it.

## Consequences

- The intuitive `shadeRegion` call now does the intuitive thing — closes the evaluation's #1
  finding without a lint crutch.
- Imposes the [ADR-0029](0029-language-version-pragma.md) retain-old-semantics obligation: the
  v1 path lives on as `shadeRegionLegacy`, selected by the module pragma at command dispatch.
- Touches [spec §12](../language-spec.md#12-colour-gradients-filters--themes) (filter
  semantics), [§14](../language-spec.md#14-determinism) (version-2 difference list),
  [§16](../language-spec.md#16-cli-surface) (W005 scoped to v1), `src/raster.ts`, `src/eval.ts`,
  `src/lint.ts`, tests, and the product skill (`skills/drawstic/SKILL.md` + `reference.md`),
  `docs/best-practices.md`, `docs/motif-cookbook.md`.
