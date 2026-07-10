# 90. Reliable silhouette outline for composited figures

- Status: Accepted
- Date: 2026-07-10
- Deciders: t.koehn, Claude
- Resolves: character-DX HV5 (2026-07-10) — "outlines render poorly" across all four RO chibi builders — and the same run's item/icon idiom that bakes an outline into each part.

## Context

The RO/chibi look needs a clean, dark, closed 1px silhouette outline. The
`outline` filter (spec §12) already builds one by dilating the silhouette and
painting the newly-covered ring. Human review (HV5) still graded the outline poor
across the whole character run. Rendering the four artifacts isolates three
compounding failures — none a dilation bug:

1. **No first-class *composited-figure* path → per-part baking.** `outline` acts
   on the current buffer, so the natural (and guide-encouraged) idiom applied it
   inside each part `draw`, before assembly (knight 15×, wizard 12×). On
   `pin`/`fit` assembly those per-part rings become internal dark seams and a
   lumpy, doubled contour — the single clean silhouette never forms.
2. **The silhouette test `alpha > 0` swallowed soft/AA pixels.** When the outline
   *was* applied to the whole figure (archer), any earlier semi-transparent paint
   counted as silhouette. The mandated soft contact shadow (`alpha 38%`) got its
   own dark ring; an anti-aliased fringe pushed the contour outward. (Reproduced:
   a soft ground ellipse rings under the old filter.)
3. **Weak defaults.** The colour was mandatory (forcing a hardcoded `ink`) and
   width 2 (archer) fattened thin props — a 2px ring on a 2px bow/staff is a club.

The mechanism was close; its defaults and robustness were not.

## Decision

Make `outline` the reliable *silhouette* op — one clean outer contour over the
**composited figure** — by hardening the filter and relaxing its arguments. No
grammar change: `outline` stays a §12 filter; both arguments become optional.

**1 — Silhouette floors at 50 % coverage.** The silhouette is built from pixels
with `alpha ≥ 128`, not `alpha > 0`. A soft contact shadow or an AA fringe is no
longer treated as figure, so the ring hugs the solid figure at its
50 %-coverage contour and never rings the shadow. (`OUTLINE_ALPHA_MIN = 128` in
`src/raster.ts`.)

**2 — Colour optional, derived-dark default.** `outline` with no colour derives
one consistent ink from the silhouette's mean via `inkTone` (`src/color.ts`):
OkLCh lightness crushed to ≈0.15, chroma clamped to ≈0.05, hue kept — a
warm-black for a warm figure, cool-black for a cool one. An explicit paint
(`outline ink`) still wins. `Args.optPaint()` (`src/eval.ts`) consumes a leading
colour/gradient when present, else leaves the slot for the width.

**3 — Width still defaults to 1**, applied by 4-connected dilation (no diagonal
corner nubs — the pixel-art-correct hug). All four forms parse:
`outline` · `outline ink` · `outline ink 2` · `outline 2`. Because the filter
only ever paints *outside* the silhouette, it never eats a thin feature: a 1px
staff/finger keeps its core and gains only the ring.

**4 — The RO default idiom is one `outline` as the last statement of the assembly
`draw`,** over the composited silhouette — not per part. Per-part outline remains
legal (and is the way to get deliberate part-to-part inner separators), but the
silhouette contour is a single composite pass. Documented in the product skill
(SKILL.md, reference.md, character-craft.md) and the language spec.

## Consequences

- The signature is now `filterOutline(ctx, paint: Paint | null, width)`; a null
  paint triggers the `inkTone`-of-mean derivation. `Args.optPaint()` is reusable
  for any future both-optional paint slot.
- **Behaviour change:** `outline` no longer rings pixels below 50 % coverage.
  This is the intended fix (soft shadows/AA fringe excluded); a recipe that
  relied on outlining a translucent shape must raise its alpha or pre-flatten.
- Determinism holds: the derived ink is a pure function of the committed
  framebuffer; 4-connected dilation is unchanged.
- Covered by `tests/unit/raster.test.ts` (coverage floor, thin-feature core
  survival, derived-ink darkness) and `tests/unit/eval.test.ts` (both-optional
  `outline` parse forms).
