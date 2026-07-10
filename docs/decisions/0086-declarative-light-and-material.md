# 86. Declarative light + material

- Status: Accepted
- Date: 2026-07-10
- Deciders: t.koehn, Claude
- Refines: [ADR-0063](0063-explicit-local-lighting-helpers.md), [ADR-0068](0068-shaderegion-veil-opacity-signature.md), [ADR-0069](0069-additive-local-light-helper.md), [ADR-0070](0070-unified-shadow-argument-shape.md) (unifies their point/direction/offset encodings behind one `Light` value); depends on [ADR-0088](0088-in-place-v1-break.md) (the primitives this lowers onto stop being version-gated)

## Context

Drawstic has no light-source model. Light is a literal repeated by hand at every call, in
**three incompatible encodings**: a point for `shadeRegion`/`lightRegion`
([ADR-0068](0068-shaderegion-veil-opacity-signature.md), [ADR-0069](0069-additive-local-light-helper.md)),
an inverted direction vector for `rim` ([ADR-0063](0063-explicit-local-lighting-helpers.md)),
and a `dx:dy` offset for `shadow`/`castShadow` ([ADR-0070](0070-unified-shadow-argument-shape.md)).
Nothing keeps the three calls that are meant to describe *one* light source in agreement, so
they drift: a scene's rim faces one way while its cast shadows fall another. There is also no
material concept — every shade/highlight/rim call is hand-placed and hand-dosed per region, so
the correct dose (how far to darken, how tight a rim, how much AO) is reinvented, and reasoning
instincts go wrong in predictable ways: `lighten()` instead of a warm `mix()` (chalky highlights),
pure black shadows, overdose, and — without a capped hue nudge — a cool-shadow `mix()` that
crosses hue into magenta on warm bases. This is the single most repeated finding across the
scene, character, and item evaluations (`docs/*-dx-*.md`): shading correctness does not
transfer between calls, because nothing structurally holds it together.

## Decision

**1 — `Light` and `Material` become first-class values (`src/values.ts`).** `Light = { dir,
pos?, color, gain, amb? }`; `Material = { base, response, shade?, hi?, rim?, ao? }`. Both bind
without constructor parentheses — the binding keyword already signals the type:

```drw
light sun      = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # directional; gain defaults to 1
light torch    = at 12:8 #ffb060 gain 1.4          # point light
material steel = #8a95a5 metal                      # base colour + response
```

`response ∈ flat|metal|skin|cloth|glass|glow` (a bare colour with no response defaults to
`flat`). `response` selects a **baked dose profile** — the dosage table from
`skills/drawstic/scene-craft.md §5` becomes the material default (referenced, not duplicated) —
never the colour; colour choice stays the author's.

**2 — `lit L:` is a lexical block that scopes a light for its body only.** No global mutable
light state; a `draw` with no `lit` block and no explicit `light L` argument on a shading
command is a **hard error**, never a silent default — the whole point is that a light is
always named and always visible.

```drw
draw sword 24x48:
  lit sun:
    model blade steel      # base + shadow + specular + rim + AO + cast, all driven by `sun`
    model guard #b08040 metal
    model grip  #3a2a1e     # bare colour ⇒ flat
    cel  pommel steel 3     # banded cel look, 3 bands
```

Light resolves in three tiers, each inspectable: value binding → lexical `lit L:` block
(`DrawState.light`, scoped to its body) → theme default (`FoldedTheme.light`), which is how a
front/side view pair or a colour variant shares one light without re-authoring it per view —
structurally closing the "light mirrored per view" bug class.

**3 — `model REGION MATERIAL [light L]` and `cel REGION MATERIAL N` lower to existing
primitives — no new rendering path.** `model` expands to the fixed, craft-correct sequence
fill → `shadeRegion` → `lightRegion` → `rim` → `ambientOcclusion` → cast `shadow`, every
argument derived from `MATERIAL` and the resolved `Light`; steps whose dose is zero for the
material's response are skipped. `cel REGION MATERIAL N` is a new banded distance-fill primitive
in `src/raster.ts` (N discrete bands instead of a continuous veil) for a crisper cel-shaded look.
Because [ADR-0088](0088-in-place-v1-break.md) collapses the engine onto one semantics, `model`
lowers onto exactly one `shadeRegion`/`rim`/`shadow` behaviour — no version branch to pick
between when expanding.

**4 — Encoding unification lives in a new internal `src/shading.ts`.** The *one* `Light` value
is converted per region into whatever a target primitive needs — `lightPointFor`, `lightDirOf`,
`shadowOffsetFor` — so a rim, a shade veil, and a cast shadow driven by the same `Light` are
coherent **structurally**, not by author discipline. This is the breaking part of the decision:
the raw three-encoding surface (a bare point here, a bare direction there, a bare `dx:dy`
elsewhere) is no longer the public default authoring path for shading — `model`/`cel` are.

**5 — New pure colour helpers in `src/color.ts`, usable immediately via UFCS.**
`litTone(base, light, amt)` mixes toward `light`'s colour (warm direction), replacing the
reflexive-but-wrong `lighten()`. `shadowTone(base, cool, amt, darken)` combines an OkLCh
`darken` step with a **capped** hue nudge toward `cool` (≤~20°, never cross-hue) — this is the
concrete fix for the magenta-shadow bug on warm bases. `ramp(base, n)` returns an `n`-step
light→dark tone list for `pixels:` banding; it is distinct from `tones()`
([ADR-0060](0060-explicit-color-list-ramps.md)), which takes explicit, arbitrary amounts —
`ramp` is the even, material-consistent N-band spread `cel`/hand pixel-art want.

**6 — Predictability guardrail.** `context` and `render --explain` print the exact primitive
expansion of a `model`/`cel` call, so an agent can predict it, and copy-and-handtune the
expansion when a material's baked dose genuinely doesn't fit. Primitives remain the public
floor; `model`/`cel` are sugar, not a closed box.

**7 — Token budget.** Every new keyword measures at 1 `js-tiktoken` (o200k) token except
`glow` (2, rare): `light`, `material`, `dir`, `at`, `amb`, `gain`, `flat`, `metal`, `skin`,
`cloth`, `glass`, `glow`, `model`, `cel`, `lit`. Rejected on token cost: `intensity` (2 →
`gain`), `matte` (2 → `flat`), `emissive` (3 → `glow`), and constructor-call spellings
(`source(...)`/`surface(...)`) in favour of inline args after `=`.

## Consequences

- Shading collapses from ~4 hand-repeated, drift-prone calls per region to one `model`/`cel`
  call reading one named light — closes the evaluation's #1 shading finding structurally
  instead of by lint or convention.
- Two new first-class value types (`Light`, `Material`) and a new internal module
  (`src/shading.ts`); `src/raster.ts` gains `celRegion`; `src/color.ts` gains `litTone`,
  `shadowTone`, `ramp`.
- Parser/eval gain `light`/`material` bindings (inline-args, no constructors), the `lit L:`
  block, and `model`/`cel` dispatch (`src/parser.ts`, `src/ast.ts`, `src/eval.ts`); theme
  folding gains a `light` field with fold/merge/fingerprint semantics for cross-view coherence.
- The raw point/direction/offset shading primitives (`shadeRegion`, `lightRegion`, `rim`,
  `ambientOcclusion`, `shadow`/`castShadow`) are unchanged in signature and remain callable —
  they become `model`/`cel`'s compile target and the escape hatch for hand-tuning, per AGENTS.md
  §1 (no throwaway code: the low-level surface stays the real floor, not scaffolding to delete).
- Touches [spec §12](../language-spec.md#12-colour-gradients-filters--themes) (new §Light &
  Material), `docs/best-practices.md` (materials replace hand-dosed shading as the default),
  `skills/drawstic/scene-craft.md` §5 (referenced dosage table), and the product skill
  (`skills/drawstic/SKILL.md` + `reference.md`).
