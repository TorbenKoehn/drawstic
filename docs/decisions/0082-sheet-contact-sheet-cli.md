# 82. `drawstic sheet` — family contact-sheet CLI

- Status: Accepted
- Date: 2026-07-09
- Deciders: t.koehn, Claude
- Resolves: [Icon evaluation 2026-07-08](../icon-dx-evaluation-2026-07-08.md) §5 finding 1 + §9.1 — the
  7/7, Ø 3,9 "no family-consistency / contact-sheet tooling" gap (the worst system grade of all four
  DX runs)

## Context

Icons ship as **families**, not single images. Their quality is a cross-drawing property — corner
radii, stroke weights, the one light edge, grey-value/hue balance must agree across six-plus
siblings. Yet `render` rasterizes **one** drawing per call and `--diff` only compares a drawing to
its own past. **All 7** icon-evaluation agents named the same missing tool and worked around it by
hand-building a throwaway montage recipe (`from <file> …` + a stamp grid), which itself trips `W002`
("neither exported nor stamped") or silent stamp overlap — the single most expensive line item in
their verification budgets (Productivity spent 9 of 12 debug renders on it). No `E`/`W` code and no
command covered family QA.

## Decision

**1 — `drawstic sheet <file> [--all] [--cols N] [--png@N] [--out <path>] [--stdout] [--ascii]
[--preview] [--json]` composes every selected drawing size-normalized into ONE labeled comparison
grid.** It reuses the existing render/raster/PNG/preview infrastructure (import-only, new module
`src/sheet.ts`); it adds no new rendering path. Each tile is the drawing rendered at its native
size, centered in a uniform cell, seated on a transparency checkerboard, framed with a 1px
separator, and captioned with the drawing name below it in the bundled `small` (5×7) font. Output
kind follows `render`'s precedence — `--ascii` > `--preview` > PNG — and `--png@N`/`--stdout`/`--out`
behave as they do for `render`. Default PNG path is `<file-basename>.sheet.png` in the cwd.

**2 — Default selection is the module's *exported* drawings, in export-declaration order; `--all`
selects *every* non-parametric drawing in definition order.** Parametric drawings are excluded either
way — they can't render without arguments. The default matches the deliverable set an author cares
about comparing; `--all` is the "show me everything, including intermediate glyph/tile parts" escape
hatch. Two safety fallbacks keep the sheet from being pointlessly empty: a module with **no exports
at all**, and an export set that resolves to **no renderable draw** (all parametric/tilesets), both
fall back to every non-parametric drawing. A module with genuinely no non-parametric drawing is an
`E022` error (`no drawings to sheet`), not a blank image.

**3 — Layout is fully deterministic.** Column count is `--cols N` (clamped to the tile count) or a
square-ish `ceil(sqrt(n))` default; rows are `ceil(n / cols)`. Every cell is normalized to the
**largest** drawing width/height and the **widest** label, so radii/stroke/grey-value comparisons are
size-fair and labels never clip. Tile and label positions are integer-centered; the palette (dark
canvas, mid-grey checker, frame, label ink), margins, gaps, and checker cell size are fixed
constants. Same input → byte-identical PNG on every platform (verified: repeat renders hash-equal).

**4 — `--json` reports the layout facts, not the pixels.** The payload is
`{diagnostics, sheet: {cols, rows, cell: {width, height}, width, height, cells: [{name, w, h, x, y}],
kind, output|width|height}}` — one `cells` entry per tile giving the drawing's own size (`w`,`h`) and
its top-left origin (`x`,`y`) in **unscaled sheet coordinates** (multiply by `--png@N` for output
pixels). This lets an agent locate/crop any tile and confirm the grid shape without decoding the
image.

**5 — `sheet` is a pure addition** — a new subcommand and a new `src/sheet.ts`; no existing command,
render, or export changes. It never participates in `build` (it is a QA aid, like `--grid`/`--diff`/
`--inspect`). Labels are drawn with the standard `small` font through the normal `drawText` path, so
they inherit whatever glyph coverage the bundled face has (and would surface the same
unknown-glyph gap that `W008` now flags).

## Consequences

- The 7/7 contact-sheet workaround collapses to one command; family consistency QA (all icons native,
  side by side, at 100% and any `--png@N`) is a first-class, deterministic operation.
- Pairs with `--inspect`: agents keep using `opaquePixelCount` equality as a numeric consistency
  proof, and now have the visual sheet as its companion.
- Cost: a second, self-contained composition module that depends on `framebuffer`/`raster`/`preview`
  — the deliberate trade for reusing the real renderer instead of a bespoke blitter.
- Touches [spec §16](../language-spec.md#16-cli) (new subcommand), `src/cli.ts` (dispatch, `--cols`/
  `--all` flags, `runSheet`), `src/sheet.ts` (new), tests, and the product skill
  (`skills/drawstic/SKILL.md` + `reference.md` — the family-QA workflow and the `sheet` synopsis).
