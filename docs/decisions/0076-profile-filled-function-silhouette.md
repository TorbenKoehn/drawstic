# 76. `profile` — filled function silhouette

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Resolves: `TODO-IMP.md` §5.3 (Scene-DX evaluation, the hand-rolled per-column noise loop)

## Context

Every evaluation scene that wanted a procedural horizon — a dune ridge, a hill line, a
noise-driven silhouette — hand-rolled the **same per-column loop**: `for x 0..w: line paint
x:f(x) x:bottom` ([evaluation](../scene-dx-evaluation-2026-07-08.md), motif cookbook "Noise ridge").
That loop is boilerplate, and it walks straight into the **noise-frequency trap**: `noise(seed,
x, 0)` sampled at raw integer `x` hits the noise lattice exactly and returns high-frequency,
uncorrelated spikes instead of a smooth curve (7/7 graders; [ADR-0026](0026-seeded-randomness-and-noise.md),
`TODO-IMP.md` §1.1). `curve`/`curvePoly` ([ADR-0074](0074-curve-through-points-spline.md),
[ADR-0075](0075-curvepoly-closed-curve-region.md)) cover *hand-authored* through-points silhouettes,
but not a **procedural** `y = f(x)` swept across a span, where the author has a function, not a
point list. A built-in that samples the function once per output column — with the function seeing
a normalized coordinate — makes the loop disappear and makes the frequency trap unreachable by
construction.

## Decision

**1 — `profile <paint> <span> <fnName> [<baseline>] [fill] [w<N>]` fills the area between `y =
f(x)` and a baseline across a span.** Paint-first like every painting command
([ADR-0066](0066-paint-first-painting-commands.md)); `<span>` is a list of x-columns (a range),
`<fnName>` names a unary `fn`, `<baseline>` is an optional plain number, then the standard
`[fill] [w<N>]` region-eliminator sugar shared with `rect`/`circle`/`curvePoly`
([ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md)).

```drw
fn ridgeY(nx) = 16 + round(noise(3, nx * 4, 0) * 10)   # nx ∈ [0,1]; ×4 → ~4 undulations
draw dune 64x32:
  bg #e8d9b0
  profile #c9a06b 0..64 ridgeY fill                    # ridge swept across the width, filled to the bottom
```

**2 — The `fn` receives NORMALIZED x in `[0,1]` and returns the top-edge `y` in recipe pixels.**
For a span of `n` columns, column `i` (0-based) is sampled at `nx = n > 1 ? i / (n − 1) : 0` — the
first column is `0`, the last is `1`. The function never sees a raw pixel coordinate, so the
**noise-frequency trap cannot occur**: `noise(seed, nx * K, 0)` with a small `K` (2–8 undulations
across the whole span) is the natural, correct idiom, and integer-lattice aliasing is impossible by
construction. A unary `fn` (`fn <name> nx = …`) keeps the one degree of freedom the author needs;
extra fixed inputs (seed, amplitude) are baked into the `fn` body.

**3 — The span is a range/list of x-columns; one sample per column** ([ADR-0057](0057-ranges-are-list-expressions.md)
reused, no new grammar). `0..w` (half-open) is the whole canvas width — columns `0 … w−1`, exactly
the valid pixel columns — and `x0..=x1` is an explicit inclusive span. **Span inclusivity is
whichever range operator the author picks** (`..` vs `..=`), consistent with `for`/binding ranges;
`profile` adds no special range form. Each list element is one output column, so sampling is
"one sample per output column" by definition — the built-in sane convention the trap needs. An empty
span yields the empty region (draws nothing), like `poly` with too few points.

**4 — Fill runs between `f(x)` and a baseline; the baseline defaults to the canvas bottom
`h−1`.** Each column is filled over the inclusive rows `min(round f(x), baseline) …
max(round f(x), baseline)` — one contiguous vertical run per column, robust whether the curve
sits above or below the baseline. The **fill-to-canvas-bottom default** matches the dominant case
(a silhouette rooted on the bottom edge — dune, hill, mountain) at zero extra tokens; the optional
positional `<baseline>` (a plain number *before* the flags) handles a ridge sitting on a horizon,
e.g. hills behind water filled only down to the waterline `y`. The baseline is read only when the
next argument is not a flag/keyword, so `profile p 0..w f fill` (no baseline) and `profile p 0..w f
40 fill` (baseline 40) both parse unambiguously.

**5 — The paint-less call form is a Region**, exactly like `curvePoly`
([ADR-0075](0075-curvepoly-closed-curve-region.md) §2) and every shape
([ADR-0036](0036-shapes-as-region-constructors.md)): `profile(span, fnName [, baseline])` in
expression position yields the per-column coverage, for masks and `.union/.intersect/.subtract/.xor`
— "shade the dune" (`mask dune = profile(0..w, ridgeY)`, then `shadeRegion`/`grain`) is the natural
move. A paint-less `profile` *statement* is the same "region value dropped" E013 as a paint-less
`circle`. Command and expression forms share one region builder, so they are pixel-identical.

**6 — Determinism and budget.** Columns are integer x via `quantInt`; `f(x)` is rounded with
`roundHalfUp`; the sweep uses only division and the bundled dmath the `fn` body calls — no host
`Math.*` on the pixel path ([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)), so two
runs are byte-identical and every platform agrees. One step is charged per column (plus the `fn`
body's own steps), so a `profile` terminates under the §15 budget like every other construct.

**7 — Pure addition, no pragma gate** ([ADR-0074](0074-curve-through-points-spline.md) §6): a new
command/callee that changes no existing render, available in every language version (`lang` stays
**2**). `profile` is a reserved, unshadowable name.

## Consequences

- The per-column horizon loop collapses to one line, and the noise-frequency trap becomes
  unreachable — the `fn` sees `[0,1]`, never pixel indices. The motif cookbook's "Noise ridge"
  variant is rewritten to `profile`.
- The paint-less form gives procedural silhouettes as **masks** for free, so lighting/texture
  helpers apply to a dune without a component-draw detour.
- `profile` is authored in a *function*, complementing `curve`/`curvePoly` (authored in *points*):
  procedural sweeps vs. hand-placed crests.
- Touches [spec §8](../language-spec.md#8-drawing-primitives) (primitive table + a profile note),
  [§9](../language-spec.md#9-composition-transforms--masks) (masks), [§17](../language-spec.md#17-grammar-normative)
  (`draw-cmd` grammar), `src/eval.ts` (command, region form, `BUILTIN_NAMES`), tests,
  `docs/best-practices.md`, `docs/motif-cookbook.md`, and the product skill
  (`skills/drawstic/SKILL.md` + `reference.md`). No `src/raster.ts` change — the region reuses the
  shared `fill`/`stroke` eliminators.
