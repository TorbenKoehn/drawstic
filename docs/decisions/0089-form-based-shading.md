# 89. Form-based (normal) shading as the `model` default

- Status: Accepted
- Date: 2026-07-10
- Deciders: t.koehn, Claude
- Refines: [ADR-0086](0086-declarative-light-and-material.md) (replaces the `model` body's
  `shadeRegion`→`lightRegion` distance veils; `cel` no longer lowers to `celRegion`+`ramp`). The raw
  `shadeRegion`/`lightRegion`/`celRegion` primitives are unchanged and remain the callable floor /
  hand-tune escape hatch.

## Context

ADR-0086 made `model REGION MATERIAL` lower its shading body onto `shadeRegion` +
`lightRegion` — a pair of **distance-from-one-light-point** ramps over the region's whole bbox
(`forRegionDistance`, `src/raster.ts`), and `cel` onto `celRegion` (the same distance quantized into
bands). The distance is measured from a synthetic light point, normalized to the bbox's farthest
corner, so the shade darkens **linearly across the bounding box** and the band boundaries are
straight iso-distance contours that **ignore the surface**. The 2026-07-10 character-DX evaluation
(`docs/character-dx-evaluation-2026-07-10.md`) made this the #1 human-visual finding (HV1, all four
figures): the shading reads "way too heavy," "way too linear," "does not even follow the form" — *it
does not even read as cel-shading*. The reviewer's explicit ask: the pipeline **default** should
produce clean, smooth, form-following shading (deep normal shading), with hard cel as an **opt-in**
stylization, not the default. HV1 unifies three builder findings under one root: `ramp()` clipping
dark bases (§5.15), the C004 dark-material value-spread blind search (§5.9), and the `model`-cast
grey blob (§5.14) — all downstream of a form-ignoring lowering.

A distance-from-a-point ramp cannot follow form because it carries no notion of surface orientation.
Cel/painted shading that reads as volume needs the **surface normal**: brightest where the surface
faces the light, softly terminating where it turns away — and Drawstic only has flat 2D regions, no
authored depth. The normal must therefore be *reconstructed* from the region geometry, deterministically.

## Decision

**1 — Reconstruct a surface normal from the region's own geometry (`formShade`, `src/raster.ts`).**
The region is inflated to a faux-3D dome and shaded by Lambert's law, per pixel:

- **Height field from an inner SDF.** Compute the exact squared **inner** Euclidean distance-to-
  boundary field over the region's padded bbox with a separable Felzenszwalb–Huttenlocher distance
  transform (`edt1d`/`innerDistance2`) — deterministic (only `+ − * /` and comparisons, a large
  finite sentinel, never `Infinity`), reusing `regionBounds` and region membership. Inflate it to a
  spherical height `H = sqrt(D / Dmax)` — steep at the rim, flat over the spine.
- **Normal per pixel** `n = normalize(−∂H/∂x · puff, −∂H/∂y · puff, 1)` via central differences on
  `H`. `puff` (curvature gain) tunes roundness/puffiness.
- **Lambert intensity** `i = clamp(n · light, 0..1)`, lifted by an `ambient` floor so the shadow side
  never crushes to black: `lit = ambient + (1 − ambient)·i`. `light` is the unit *toward-light*
  vector — the light's in-plane travel direction **negated** (points back at the source, the lit
  side) plus a fixed out-of-plane `z` elevation; a point light derives its in-plane direction
  per-region (source → centre), exactly as `rim`/`cast` do, so all four still read one source.

**2 — Map intensity → tone continuously (smooth default), quantize for cel (opt-in).** `formTone`
maps `lit` to a colour: at the mid-point it is `base`; brighter lifts toward the light colour via
`litTone`; darker sinks toward the cool via `shadowTone` (whose ≥35 %-of-base lightness floor keeps a
dark base legible — the §5.15 fix, inherited for free). The terminator is therefore a **soft
gradient**, never a hard linear step. In pixel mode the smooth intensity is **ordered-dithered**
(Bayer) before tone-mapping so the terminator reads clean at 8-bit without banding. `cel REGION
MATERIAL N` snaps the **same** intensity field into `N` crisp bands (band-centre tone-mapped, no
dither) — so cel is exactly `model`'s body quantized, never a divergent second look, and its bands
**follow the surface normal** instead of straight iso-distance lines.

**3 — Lowering integration.** `model` now lowers to a single **`form`** op (the normal-based body)
followed by the unchanged `rim` → `ambientOcclusion` → `cast` edge steps (`planMaterial`,
`src/shading.ts`); the response's baked `shade`/`hi` doses are reused as the max shadow/highlight mix
amounts, `warm`/`cool`/`ambient` come from the `Light`. `cel` lowers to one `form` op with `bands =
N` (`lowerCel`); no rim/AO/cast — cel is the banded body only. `glow` (self) is unchanged (fill +
inner light). `FormSpec` (the resolved per-pixel parameters) is built by `formSpecOf`, shared by both
paths. Determinism is strict throughout: dmath-only arithmetic (`Math.sqrt` of sums-of-squares, the
`dhypot` philosophy — never `Math.hypot`), the frozen Bayer table, the pinned colour pipeline; no RNG
and no float pulled from evaluation context.

**4 — Predictability.** The `form` op serializes into the `render --explain` trace (`ExplainStep`,
`src/eval.ts`; `formatExplain`, `src/cli.ts`) with its base/warm/cool tints, the toward-light
direction + `z` elevation, the `shade`/`hi`/`ambient`/`puff` doses, and the cel `bands` count — so an
agent can predict the render and, when a baked dose doesn't fit, drop to the raw
`shadeRegion`/`rim`/`shadow` primitives (still the public floor) and hand-tune.

## Consequences

- **`model`'s default shading now follows surface form and terminates softly** — HV1 closed at the
  root, and with it §5.15 (dark-base clip, via the `shadowTone` floor), §5.9 (dark-material value
  spread now varies with the normal), and §5.14 (no baked cast on empty canvas is retained from
  ADR-0086; the body no longer paints a bbox veil either).
- **`cel` is the opt-in stylization, smooth is the default.** `cel N` produces `N` clean bands that
  wrap the form — a real cel look, replacing the old straight-contour ramp. It works at chibi scale
  (≤64px), where the previous distance veils were "too weak" to use.
- **New raster surface:** `formShade`, `FormSpec`, `Vec3` in `src/raster.ts`; the Felzenszwalb inner
  distance transform (`edt1d`/`innerDistance2`). `src/shading.ts` gains `lightVec3`/`formSpecOf`/
  `lowerCel` and a `form` `ShadeOp`; `planMaterial` swaps its shade+light body for the form op. `cel`
  no longer imports `celRegion`/`ramp` in eval; both stay exported (primitive floor / colour helper).
- **Per-region cost** rises by one exact distance transform over the region bbox (O(area)) per
  `model`/`cel` — negligible at figure scale, and only paid by the declarative path.
- Two tuned constants own the look: `LIGHT_ELEVATION` (grazing vs. frontal) and `FORM_PUFF`
  (roundness), plus `FORM_DITHER` (pixel-mode terminator dither amplitude). Changing them re-tunes
  every figure at once — the point of a single lowering.
- Touches [spec § Light & material](../language-spec.md), the product skill
  (`skills/drawstic/SKILL.md` + `reference.md`), and `skills/drawstic/character-craft.md` (smooth
  form shading is now the documented chibi-scale default; hard cel is the opt-in look).
