# 97. The canonical shading floor — remove the raw light quartet, add `Region.edge()`

- Status: Accepted
- Date: 2026-07-26
- Deciders: t.koehn, Claude
- Refines / amends: [ADR-0096](0096-language-freeze-for-1-0.md) §8 (this is the deferred decision),
  [ADR-0086](0086-declarative-light-and-material.md) (`model`/`cel` become the *only* lighting verbs),
  [ADR-0094](0094-language-diet-and-canonical-lints.md) (retires its own `W012`).

## Context

`rim`, `shadeRegion`, `lightRegion` and `ambientOcclusion` are the pre-declarative hand-light
commands. ADR-0086 added `model`/`cel` but kept them as "the floor", and ADR-0094 added `W012` to
lint them beside a `model`. Two waves later they are still the second way to light anything, and the
audits show the cost:

- 7 of 7 scene builders read `shadeRegion`'s `amount` as **opacity**; it is a distance scalar. No
  diagnostic — a silent, universal misread.
- `W012` fires only *beside* a `model`, so an entire recipe hand-lit end to end stays green.
- The surviving corpus splits along generation lines: `scenes-v3` + `icons` use the quartet 106×,
  `characters-ro2` / `items-v2` use `model`/`cel` exclusively.

Each removal below was proven by **pixel diff**, not argument.

## Decision

### 1 — All four commands are removed

| Removed | Proven equal to | Evidence |
|---|---|---|
| `ambientOcclusion R P A` | `stroke P.alpha(A) R` | `--diff`: **0 px changed** |
| `rim R DX:DY P [N]` | `fill P R.subtract(R.shift(DX:DY))` | `--diff`: **0 px changed** at `w1` and `w2` |
| `shadeRegion` / `lightRegion` | each other, mirrored — and both replaceable | see §2 |

`shadeRegion`/`lightRegion` have exactly two real jobs and each already has a canonical owner:
**shading a solid body** is `model`/`cel` (form-following, strictly better craft), and **veiling
already-composed pixels** is `fill <gradient> <region>` (a gradient is a paint, `fill` is the
eliminator). Three probes confirmed the split, including the one case that constrains it: `model` is
a **repaint**, not a veil — `formShade` writes opaque tones through `putPixel`, so modelling a mound
with hand-drawn grooves *erases the grooves*, while `fill linear(90, transparent, abyss.alpha(70%))`
darkens them identically. Any mechanical `shadeRegion → model` rewrite must branch on whether the
region already carries drawn detail.

### 2 — The one genuine gap becomes region algebra: `REGION.edge(DX:DY [, N])`

What survives the subtraction is a **one-sided edge band with an arbitrary paint** — and it is not a
light. The corpus uses it with *dark* paints (icon bottom bevels `rim face 0:-1 #0a1220.alpha(35%)`,
dark contour edges `rim ground 0:1 lavaDark`), which a material `rim` dose — always `litTone` toward
the light colour — can never produce. So it moves down into the region vocabulary, beside
`.subtract()` and `.stroke(n)`, and obeys the spec's own constructor/eliminator law:

```
R.edge(0:1)        # the top edge band: R minus R shifted down
R.edge(-1:0, 2)    # a 2px band on the right, uniform coverage (no alpha stacking)
R.edge(0:0)        # the empty region
```

`R.edge(DX:DY, N)` ≡ `R.subtract(R.shift(sign(DX)·N : sign(DY)·N))`. Direction reads as `rim` did
(`0:1` = top edge, the light travels down). It composes with `union`/`intersect`/`subtract`/
`transform` like any region.

**This is a correctness fix, not sugar.** The corpus's most common rim idiom,
`rim R.intersect(CLIP) DIR P`, paints the **clip rectangle's** boundary rather than the silhouette
edge, because `rim` fuses constructor and eliminator and so cannot express the right order. A probe
rendered a straight horizontal bar across the middle of a mass where the correct spelling —
`R.edge(0:1).intersect(CLIP)` — correctly paints nothing. The idiom appears ~12× in `scenes-v3`, and
at least one clip rect is visibly hand-tuned to dodge the artifact: authors were paying a per-call
tax for a defect nobody had named.

### 3 — What stays

The material dose vocabulary is unchanged and remains the canonical way to light an object:
`material NAME = COLOR RESPONSE [rim N%] [ao N%] [shade N%] [hi N%] [spec N%] [spread N%] [puff N%]`,
applied by `model` (smooth, default) or `cel N` (crisp bands). Internally `rimRegion`,
`ambientOcclusion` and `lightRegion` remain as helpers driving the `rim`/`ao` doses and the `glow`
self-light.

### 4 — Fallout

- `shadeRegion` (raster) and the never-emitted `ShadeOp` `'shade'` variant become dead — deleted.
  `celRegion` was already dead (zero callers since ADR-0089) — swept in the same wave.
- **`W012` becomes unfireable and is retired** (code reserved, never reused), `RAW_SHADE_COMMANDS`
  dropped. W013–W015 are unaffected. Removing four constructs removes a lint instead of adding one.
- Three `ambientOcclusion` calls in `volcano.drw` are provable no-ops (blending an opaque colour onto
  itself) — verified by pixel diff, unnoticed for two waves.

### 5 — Migration

| old | canonical |
|---|---|
| `rim R DX:DY P [N]` | `fill P R.edge(DX:DY[, N])` |
| `rim R.intersect(C) DIR P` | `fill P R.edge(DIR).intersect(C)` — order flips, artifact gone |
| `ambientOcclusion R P A` | `stroke P.alpha(A) R`, or delete it and use `model`'s `ao` dose |
| `shadeRegion`+`lightRegion` on a **solid body** | one `model R MAT` (or `cel R MAT N`) |
| `shadeRegion R PT C A` **over drawn pixels** | `fill linear(DEG, transparent, C.alpha(A)) R` |
| `lightRegion R PT C A` **over drawn pixels** | `fill linear(DEG, C.alpha(A), transparent) R` |
| whole-frame light+shade pair | one `fill linear(DEG, warm.alpha(a), cool.alpha(b)) rect(0:0, W:H)` |

Volume in the surviving corpus: `scenes-v3` 74 calls, `icons` 32. `items-v2`, `characters-ro2`,
`basic-shapes`, `showcase`, `text`: zero — they are already canonical.

## Consequences

- **One way to light anything**: declare a `light` and a `material`, then `model` or `cel`. Edge
  bands, veils and grades are ordinary region + paint work, which is where the rest of the language
  already lives.
- Breaking, in the same wave as ADR-0096, with the bundled corpus rewritten and re-rendered. The
  scene rewrite is *not* mechanical (the repaint-vs-veil distinction above); each converted scene is
  re-rendered and compared before/after.
- Touches `src/eval.ts` (command removal, `.edge()` region op), `src/raster.ts` (dead-code sweep),
  `src/lint.ts` (W012 retirement), `docs/language-spec.md` (§9 region methods, §Filters, §17.4 EBNF),
  the product skill, and `examples/scenes-v3` + `examples/icons`.
