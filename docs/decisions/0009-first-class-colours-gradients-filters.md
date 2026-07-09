# 9. Colours are first-class values; gradients & filters

- Status: Accepted
- Date: 2026-06-13
- Deciders: t.koehn, Claude

## Context

New requirements arrived: colour-space constructors (`oklch()`, `rgb()`, `hsl()`),
colour operations (`lighten()`, `darken()`, `mix()`, …), **gradients** (the priority),
and **filters**. The draft colour model could not express any of these: it treated
colours as non-first-class single-character keys resolved *by argument position*, with a
special `ramp` construct for indexed selection. That cannot represent a computed or
interpolated colour, and `ramp` plus the cramped `pal .=- k=#1a1a1a` syntax were hard to
read and understand.

## Decision

- **Colours are first-class values**: hex (`#1a1a1a`), colour-space constructors
  (`rgb`/`hsl`/`oklch`), operations (`lighten`/`darken`/`saturate`/`desaturate`/`rotate`/
  `alpha`/`mix`), and `transparent`. Mixing/interpolation defaults to **OkLCh**.
- **`pal` is a block** of `name = colour` bindings; single-char names double as **grid
  keys**. Entries may derive from earlier ones (`r2 = lighten(r, 0.15)`).
- **`ramp` is removed.** Discrete selection is just indexing an ordinary colour list
  (`cols = (k, y, r); cols[i]`).
- **`grad` defines gradients** as fill values (linear/radial, interpolation space,
  stops). Usable anywhere a fill is expected; spans the filled region's bounding box;
  **ordered-dithered in pixel mode** for crisp, deterministic banding.
- **Filters post-process the framebuffer**: built-in commands (`outline`, `replace`,
  `tint`, `shadow`, …) plus reusable `filter … apply`. Extensible.
- **Themes** may carry shared palettes, gradients, and filters; composition merges them
  by name, last-wins ([ADR-0005](0005-theme-composition-by-fold.md)).

## Consequences

- Colours, gradients, and filters compose and read like CSS — in-distribution for LLMs.
- The single-char namespace is now special **only inside `grid:`**; elsewhere palette
  entries are named colours in scope. Residual: a palette name can shadow a same-named
  variable (open question 8 in the spec) — current stance is scope-rules + guidance, no
  sigil.
- Dithering ties gradients to authentic pixel-art output while preserving visual
  determinism ([ADR-0007](0007-visual-not-byte-determinism.md)).
- **Supersedes the colour-model aspect of [ADR-0002](0002-hybrid-primitives-and-indexed-palette.md)**
  ("colours are palette-index-only; raw `#hex` only in palette definitions") and the
  draft-only `ramp` / position-based idea. The hybrid-primitives and single-char *grid*
  key decisions in ADR-0002 still stand.
