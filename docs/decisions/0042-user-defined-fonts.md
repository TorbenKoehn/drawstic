# 42. User-defined fonts: `font` maps characters to drawings

- Status: Accepted
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Refines: [ADR-0022](0022-text-and-bitmap-fonts.md) (specifies its noted extension 6)

## Context

[ADR-0022](0022-text-and-bitmap-fonts.md) shipped two bundled bitmap faces and noted
user-defined fonts as an extension. Authors need them: pixel a display face for a game,
or draw glyphs with paths (`arc`/`bezier`) for a smooth-mode logo face. The design question
is what a *glyph* is — and the answer is already in the language: a glyph is pixels or
strokes on a small canvas, which is exactly a **drawing** ([spec §6](../language-spec.md#6-drawings)).
No new content mechanism is warranted; what is missing is only the **mapping** from
characters to drawings.

## Decision

**1 — A glyph is a drawing.** Pixeled with `pixels:`, drawn with path primitives, or both —
every existing authoring tool applies. Glyph drawings must be **non-parametric** (a font
maps to concrete bitmaps; a parametric reference is a positioned error).

**2 — `font <name> [WxH]:` is a module-level definition** — the glyph mapping. The trailing
`:` distinguishes it from the `font <name>` *directive* (scope default, ADR-0022), exactly
as `mask m = …` and `mask m:` coexist. Fonts are importable like any definition (§2) and
referenced by name in the directive, the per-`text` flag, and themes.

```drw
draw runeA 5x7:            # a glyph is just a drawing — pixel it…
  pixels:
    ..k..
    .k.k.
    k...k
    kkkkk
    k...k
    k...k
    k...k

draw runeO 5x7:            # …or draw it with paths
  circle 2:3 2 k

font runic 5x7:
  with small               # fold: fall back to the bundled face (later wins)
  glyph "A" runeA
  glyph "B":
    pixels:
      kkk
      k.k
      kkk
  glyph "O" runeO

draw badge 16x16:
  text 2:4 "AO" k font runic
```

**3 — Body directives** (command-form, like `tiles`/`pad` in §9):

- `glyph "<c>" <drawing>` — map one character (a 1-char string) to a drawing.
- `glyph "<c>": <body>` — define a glyph inline; the body is a drawing body, inherits the
  font `WxH` unless it declares its own size, and binds `k` to the `text` command's paint.
- `glyphs <tileset> "<charset>"` — bulk mapping: the i-th tile is the i-th character;
  charset length must equal the member count (positioned error otherwise). This is the
  realistic authoring path for a full face — one tileset, one line.
- `with <font>` — compose by the standard **ordered fold** (later wins,
  [ADR-0005](0005-theme-composition-by-fold.md)): extend or patch a face (bundled ones
  included) glyph by glyph.
- `tracking <N>` (default 1) and `lineheight <N>` (default glyph height + 1) — the
  ADR-0022 layout constants, now per-font overridable.

**4 — Uniform height, free width.** The font's glyph **heights must agree** (positioned
error otherwise); **widths may vary** — the advance is *glyph width + tracking*, so
proportional pixel fonts work and monospace is the special case. A header `WxH` is an
optional **monospace assertion**: every glyph must be exactly `WxH` (the
[ADR-0021](0021-optional-canvas-size-resolution.md) check pattern — an assertion, not a
second source of truth).

**5 — Rendering is stamping.** `text` with a user font blits the mapped glyph drawings
left to right — alpha-honouring like `stamp` ([ADR-0025](0025-alpha-compositing-model.md)),
so path-drawn glyphs get AA edges in smooth mode for free. A character with no mapping
after the fold renders the **missing-glyph box** (ADR-0022 rule 4, unchanged). Bundled
`small`/`micro` are unchanged and behave as predefined fonts in this model.

## Consequences

- Custom faces cost one mapping block; all glyph authoring reuses `draw` — pixel literals,
  paths, palettes, even `stamp` composition inside a glyph.
- Deterministic by construction: glyphs are drawings, layout constants are pinned
  per font, composition is the existing fold.
- `text` layout generalizes from monospace to width+tracking advance; ADR-0022's bundled
  behaviour is the monospace special case.
- Touches spec §2 (definition table), §8 (fonts paragraph), §17 (grammar `fontdef`), and
  [dsl-examples.md](../dsl-examples.md) §10.
