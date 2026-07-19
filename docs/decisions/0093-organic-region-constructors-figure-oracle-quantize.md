# 93. Organic region constructors, figure proportions oracle, and `quantize`

- Status: Accepted
- Date: 2026-07-19
- Deciders: t.koehn, Claude
- Refines: [ADR-0036](0036-shapes-as-region-constructors.md)/[ADR-0039](0039-region-algebra.md) (shapes as regions),
  [ADR-0056](0056-even-diameter-circle-rasterization.md)/[ADR-0087](0087-anchored-assembly.md) (even-diameter
  convention), [ADR-0086](0086-declarative-light-and-material.md) (theme-folded defaults), [ADR-0024](0024-parametric-drawings.md)
  (image import + recolor); implements Plan Welle 2 §C1–C3.

## Context

The second authoritative human review of the RO chibi characters
([character-dx-evaluation-2026-07-10](../character-dx-evaluation-2026-07-10.md)) traced a whole class
of low grades to **hand-typed point lists for organic forms**: conical necks, bulging "wulst" ears,
missing hat tassels, "helmet instead of turban", angular overall shapes, faces with the eyes too
central in profile. LLMs are poor at inventing coordinate lists but good at parametrising *named*
shapes and at reading *declared* positions. Two gaps followed:

1. There was no style-neutral vocabulary for the recurring organic masses (skull cap, ear, hair
   fringe, curved hat band / turban wrap). Authors reached for `poly`/`curvePoly` with magic numbers.
2. There was no way for a project to declare its proportions once and have the engine hand back named
   guide points, so eye/ear/neck/shoulder positions were re-guessed per view and drifted.

Separately, the user chose a **hybrid** import path: external image generators plus Drawstic
post-processing. `import … sha256` already pins an external PNG deterministically, but there was no
deterministic way to collapse an anti-aliased, many-colour import onto a chosen palette.

Drawstic gives no style — it supplies **mechanism** for a project to elect and apply a style
consistently (user principle). So: no `std/chibi`, no built-in character library.

## Decision

**1 — Four style-neutral parametric region constructors** (`src/values.ts`), first-class Regions
(maskable, `model`/`cel`-shadeable, `outline`-able), available in both draw-command form
(`dome ink C rx:ry`) and expression form (`dome(C, rx:ry)`), UFCS included. All share the
even-diameter, corner-centred convention (ADR-0056/ADR-0087) and are **exact analytic tests** — no
low-resolution bezier blocking at small sizes:

- `dome(c, rx:ry)` — the upper half of the same-parameter ellipse with a flat bottom edge (skull,
  helmet, hat crown). `dome(c, rx, ry).has(x, y) === ellipse(c, rx, ry).has(x, y) && y <= cy-1` by
  construction — one convention shared with the ellipse it is half of.
- `lobe(base, tip, w)` — a teardrop: a round cap of diameter `w` at `base` tapering (half-elliptically,
  C¹ at the join) to a point at `tip` (ears, hair strands, side nose, plume, hat tassel).
- `crescent(c, rx:ry, thick, dir)` — an outer ellipse minus an inner ellipse `thick` px smaller and
  shifted `thick` px toward `dir`; the band is thickest opposite `dir` and tapers to nothing on the
  `dir` side (hair fringes, brim curves, eyelids, shells).
- `band(p0, p1, p2, w)` — a constant-width sweep of `w` px along the quadratic arc through the three
  points (curved hat band, belt; stacked = **turban wraps**), flattened to a dense polyline and tested
  by exact min-distance for a smooth, even-width ribbon with round caps.

**2 — A figure proportions oracle as theme mechanic** (ADR-0086 pattern). A theme declares the
PROJECT's numbers in a `figure:` block; the engine folds them (like the theme light — later wins) and
binds a first-class `fig` value per drawing, laid out over that drawing's own `w`×`h`:

```drw
theme ro:
  figure:
    heads 3.5
    headW 22
    eyeLine 0.62   # fraction of head height from the crown
    earLine 0.58
    eyeSep 10
    neckW 11
    shoulderW 26
    hipW 20
```

`fig` exposes named guide **scalars** (`fig.headH`, `fig.headW`, `fig.eyeY`, `fig.center`, …) and
guide **points** (`fig.crown`, `fig.chin`, `fig.neckL/R`, `fig.eyeL/R`, `fig.earL/R`,
`fig.shoulderL/R`, `fig.hipL/R`). Views are the token-minimal specializer form: `fig.front` /
`fig.side` / `fig.back` re-view the same numbers (`fig.side.eye`, `fig.back.earL`), and `fig.NAME(view)`
is also accepted. The crown sits at `y=0`, one head is `h/heads` tall, so every line falls out of the
head height; **side view faces `+x`**, shifting its single eye forward off centre and its ear toward
the back — the structural fix for "eyes too central in profile". The author reads a position instead
of inventing it: chibi vs. realistic vs. mecha is only different numbers. `context` prints the figure
numbers.

**3 — `quantize [REGION] PALETTE` filter** (`src/raster.ts`) — remaps every opaque pixel's RGB to its
perceptually nearest palette colour (OkLab distance; ties resolve to the first-declared entry),
keeping the source alpha. `PALETTE` is a list of colours; an optional leading region scope confines
it like the other texture filters. This is the pipeline half of the documented import-assist workflow:
external PNG → `import … sha256` → `quantize` → `outline` → `critique`. Determinism holds from the
`sha256` pin onward; the PNG's generation stays outside the engine.

## Consequences

- `dome`, `lobe`, `crescent`, `band`, and `quantize` join the reserved builtin names — like every
  shape primitive (`circle`/`ellipse`/…), they are unshadowable. Existing recipes that bound those
  words as local identifiers were rewritten (the ADR-0088 precedent): `dome`→`skull`/`mound`,
  `crescent`→`moon`/`moonCut`, `band`→`rowBand`/`strip` across a handful of examples/tests.
- The `figure:` block is a new theme-body directive (`figureBlock` AST kind); it folds into
  `FoldedTheme.figure`, merges later-wins, and joins the theme fingerprint so a figure-only change
  never serves a stale cached sprite. `fig` member access is intercepted before the global UFCS
  dispatch, so guide names (`crown`/`eye`/`ear`/…) stay ordinary bindable names everywhere else.
- Touches `src/values.ts` (constructors, `Figure`/`figureField`), `src/color.ts` (`nearestColor`),
  `src/raster.ts` (`filterQuantize`), `src/eval.ts` (dispatch, theme fold/merge/fingerprint, `fig`
  binding, `#figureMember`), `src/ast.ts`/`src/parser.ts` (`figureBlock`), `src/cli.ts` (`context`
  figure block), the language spec (§Regions, §Themes, §Filters), and the product skill
  (`reference.md`, `SKILL.md`, `character-craft.md`). The full product-skill restructure and the
  archetype scaffolds remain W2-3b (Plan §D).
