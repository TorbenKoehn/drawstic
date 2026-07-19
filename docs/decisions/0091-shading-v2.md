# 91. Shading v2 — Poisson height field, Blinn specular, dither/cel-edge policy, spread/puff overrides

- Status: Accepted
- Date: 2026-07-19
- Deciders: t.koehn, Claude
- Refines / amends: [ADR-0089](0089-form-based-shading.md) (replaces its `H = sqrt(D / Dmax)`
  inner-distance height field and its pixel-mode-only terminator dither; keeps the normal→Lambert→tone
  pipeline, `formSpecOf`/`lightVec3`, and the smooth-default / cel-opt-in split). The raw
  `shadeRegion`/`lightRegion`/`celRegion` primitives remain the unchanged floor.

## Context

ADR-0089 made `model` follow the surface normal, but the 2026-07-10 human review (Welle 2) still
graded the four RO characters 3–6/10 and pinned four **shading** defects, all root-caused in read-only
exploration (`src/raster.ts`, `src/shading.ts`):

1. **Toblerone ridge.** The height field `H = sqrt(D / Dmax)` from the inner EDT is a **tent** on any
   elongated region: the medial axis is a C¹ crease where the normal flips hard, and the **global**
   `Dmax` normalization flattens thin limbs while keeping the ridge. Round masses read fine, so the
   fault was purely topological.
2. **Banding / stairs.** The terminator dither (`FORM_DITHER = 0.06`, ±0.03) was too weak **and**
   gated to pixel mode only — smooth `model` at 8-bit banded.
3. **Matte metal.** No specular term existed at all — pure Lambert + ambient. `metal` was only a dose
   scale, so it never read as metal.
4. **Hard cel bands.** Cel band boundaries were crisp lines with no dither — a "three-colour cape".

A separate language finding: authors were hand-patching value spread ~30× with
`.intersect(rect)+litTone/shadowTone` because there was no material knob for it, and `puff` was one
global constant that could not vary per material.

## Decision

**1 — Poisson-inflation height field (`poissonHeight`, `src/raster.ts`).** Replace the EDT tent with
the solution of `∇²P = −c` on the region interior under a homogeneous Dirichlet boundary (`P = 0` on
every out-of-region cell), by **Jacobi relaxation** (ping-pong buffers, order-independent), then
`H = sqrt(P)`. A disc inflates to an exact hemisphere and a stripe to a half-cylinder cross-section:
the field is smooth (no medial crease), and because the boundary condition is purely **local**, a thin
limb bulges in proportion to its **own** width — the global `Dmax` (and the raster lines that computed
it) are gone. The **linear** inner-distance field (`sqrt(dist2)`, the EDT) warm-starts the solve: it
carries the per-part magnitude so thick masses reach full height in few sweeps, and — unlike the
*squared* field, whose gradient is a constant-slope cone that Jacobi needs many sweeps to round off —
its cone smooths into a dome within a handful of iterations (no hard terminator shoulder). Iterations
are a **fixed, deterministic** function of the bounds size (`round(0.6·maxDim)`, clamped `[8, 48]`), so
cost is `O(iters · area)` with a bounded worst case. In practice the Jacobi loop is dwarfed by the
existing EDT pass (measured: iters=1 baseline ≈ full-Poisson per-op time), so example render times are
**unchanged**. Deterministic throughout: `+ − * /`, `Math.sqrt` of a non-negative field, no RNG.

**2 — Blinn specular (`formShade`).** After the Lambert tone, add a specular hotspot
`s = clamp(n · h)^specPow` with `h = normalize(L + (0,0,1))` (the halfway vector between the
toward-light direction and the viewer). New `DOSE` columns **`spec`** (metal 0.5, glass 0.6, skin 0.08,
cloth/flat/glow 0) and **`specPow`** (metal 16, glass 24, skin 4). In **smooth** mode the tone is a soft
`mix(tone, litTone(base, warm, 0.85), s·spec)`; in **cel** mode a **hard glint** above `s > 0.5` (the
tone snaps to the spec colour, no mix — the classic pixel-art metal look). Metal `hi` was recalibrated
`0.22 → 0.30` in the same pass.

**3 — Dither policy.** `FORM_DITHER` `0.06 → 0.10`, and the `ctx.mode === 'pixel'` gate is **removed** —
smooth `model` is Bayer-dithered **always**, so the terminator reads as clean pixel-art stipple rather
than a soft-but-banded 8-bit gradient.

**4 — Cel band-edge dither.** A cel boundary is no longer a crisp line: the band index is
`floor(u·N + (bayer − 0.5))`, so a ±0.5-band zone around every boundary is Bayer-dithered between the
two adjacent band tones (a dithered pixel-art band edge). The tones are still exactly the `N` band
centres — cel keeps its clean N-colour palette.

**5 — `spread` / `puff` material overrides (`src/values.ts`, `shading.ts`, parser/eval).** `puff`
moves from a global constant into the per-response `DOSE` (base 1.5; cloth ×0.75 = 1.125; metal/skin
1.0). A `material NAME = COLOR [RESPONSE]` binding gains **order-free trailing dose overrides**
(keywords only in that slot, contextual): `shade`/`hi`/`rim`/`ao`/`spec` replace a response's baked
dose, `puff` its curvature gain, and **`spread N%`** scales `hi`+`shade` symmetrically — the one-knob
value-spread control that retires the hand `.intersect` tone patches. `render --explain` serializes the
resolved `spec`/`specPow`/`puff` alongside the existing form fields.

## Consequences

- **The four shading defects close at the root.** Golden probes (`--png@8`, sphere / capsule / stripe /
  cape, per response — the recipe is documented below) confirm visually: no Toblerone ridge on the
  capsule/stripe (smooth half-cylinder), a soft form-following terminator on the sphere, a visible
  specular hotspot on metal/glass (the wizard's glass orb glints), no stairs on flat cloth, and dithered
  cel band edges on the cape. This is an **engine-only** change — the four RO recipes are re-rendered
  unchanged (Welle-2 Messpunkt 1).
- **`spread` replaces the manual value-spread patch class.** A dark material's C004 value spread now
  comes from the shading itself via `spread N%`, not a hand `.intersect(rect)+shadowTone` copy.
- **New surface.** `poissonHeight` in `src/raster.ts`; `FormSpec` gains `spec`/`specPow`; the `DOSE`
  table gains `spec`/`specPow`/`puff`; `Material` + `material()` gain `spec`/`puff`/`spread`; the
  material-binding parser gains the trailing-override loop (`MATERIAL_OVERRIDE_KEYS`, `ast.ts`).
- **Constants own the look** (`raster.ts`): `FORM_DITHER`, `SPEC_TINT`, `POISSON_SOURCE`,
  `POISSON_ITER_GAIN`/`_MIN`/`_MAX`; per-response `spec`/`specPow`/`puff` live in `DOSE` (`shading.ts`).
  Changing one re-tunes every figure at once — the point of a single lowering.
- Touches [spec § Light & material](../language-spec.md), the product skill
  (`skills/drawstic/SKILL.md` + `reference.md`), and `character-craft.md`/`scene-craft.md` where dose
  numbers are quoted.

### Golden-probe recipe (documented test fixture)

```drw
size 64x64
light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%
material steel = #8a95a5 metal
material flesh = #e0a878 skin
material robe  = #6a5a8a cloth
draw sphereMetal 56x56:                     # soft dome, visible warm hotspot up-light
  model circle(28:28, 24) steel light sun
draw capsuleMetal 64x28:                     # rounded rod — NO medial ridge
  model rrect(4:8, 59:19, 6) steel light sun
draw stripeMetal 64x16:                      # half-cylinder — no medial crease
  model rect(4:5, 59:10) steel light sun
draw capeClothCel 48x56:                     # dithered cel band edges
  cel curvePoly(24:2, 40:12, 44:50, 24:44, 4:50, 8:12) robe 4 light sun
```

The programmatic equivalents (Poisson ridge-freeness, specular hotspot placement, always-on dither,
cel-edge dither, symmetric spread, determinism) are pinned in `tests/unit/shading.test.ts`.

## Amendment — W2-1b (2026-07-19): `drape` profile + `over` co-shading + patch-idiom retirement

The Messpunkt-1 human grading kept two shading defects the isotropic field could not fix, plus a
now-visible collision with the old hand value patches. This amendment adds two orthogonal knobs and
retires the patch idiom across the four RO recipes. Engine surface, tests, and the golden defects:

**6 — `drape` height-field profile (`drapeHeight`, `src/raster.ts`).** A material binding may carry a
trailing **form-profile keyword** — `round` (default, the 2D Poisson field above) or `drape` —
alongside the response and dose overrides (`material cloak = #4a3f56 cloth drape`, contextual keyword
in that slot only, like `spec`/`puff`). `drape` inflates the region **row by row in 1D**: each
horizontal run of `n` in-region cells becomes a half-cylinder `H[i] = sqrt(0.5·i·(n+1−i))` (the
discrete `−P''=1`, `P=0` at the two **left/right** run ends only). The top and bottom edges are never
pinned to zero, so a hanging cloak/skirt curves only left↔right (a vertical half-tube) and **does not
accumulate the downward darkening** the isotropic 2D field bakes into a long region — the
"turtle-shell" the assassin cape showed. Because independent per-row solves step by whole pixels
wherever the silhouette slopes (a faint horizontal banding), a few **vertical-only Neumann smoothing
passes** (average with in-region vertical neighbours; an out-of-region neighbour falls back to the
cell itself → a free, un-pinned top/bottom edge) flatten the steps while keeping the hem lift.
`FormSpec` gains `profile`; `Material`/`material()` gain `profile`; `FORM_PROFILES`/`isFormProfile`
live in `values.ts` (single source, mirrors `MATERIAL_RESPONSES`). Deterministic (`+ − * /`, `sqrt`).

**7 — `over UNIONREGION` co-shading (`formShade` field/paint split; `model`/`cel` trailing clause).**
`model REGION MATERIAL over UNIONREGION` (and the same on `cel … N over U`) derives the height field
and normals from `UNIONREGION` but tones/fills **only** `REGION`. Passing a union of two adjacent
parts (`legReg.union(bootReg)`) makes them share **one continuous form** — a leg and its boot shade as
a single limb instead of restarting the field (and its terminator) at the part seam — while each part
keeps its own material and edge steps. `formShade` takes an optional `fieldRegion` (default: the paint
region); the plan's `form` op carries an optional `field`; `planMaterial`/`lowerMaterial`/`lowerCel`
thread it through. `render --explain` serialises `profile` when non-default.

**8 — the manual value-spread corner patch is retired (anti-pattern).** The `fill hi(c)
REGION.intersect(rect…)` idiom (and `fn hi/lo` ramps, `capeHi/capeDeep` fills) — needed pre-v2 to
force a C004 value spread — collided with the form shading as visible rectangular blocks. All four RO
recipes drop it; the C004 spread now comes from the material's own `spread` (dark near-black cloth was
lifted slightly off the floor so `spread` reaches `p90−p10 ≥ 0.15` without a patch — this is a
**W013-lint preview**: `litTone/shadowTone` clipped to a sub-rect on a modelled region is the
anti-pattern, material `spread` the canonical replacement). A CI guard
(`tests/unit/examples-critique.test.ts`) fails if the idiom reappears in `examples/characters-ro`.

Known limit (recorded, not fixed here): reaching C004 on a **dark monochrome** part via *smooth*
`model` needs a high `spread` (assassin `~780–820 %`) because the form gradient lifts only the peak
pixel toward `p90`, where a flat patch lifted a whole block; `cel`'s flat top band reaches `p90`
cheaper. The programmatic drape (no down-length gradient), `over` field continuity, `planMaterial`
field attachment, and determinism are pinned in `tests/unit/shading.test.ts`.
