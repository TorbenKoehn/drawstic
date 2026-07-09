# 22. Text rendering via bundled deterministic bitmap fonts

- Status: Accepted (extension 6 — user-defined fonts — specified by [ADR-0042](0042-user-defined-fonts.md))
- Date: 2026-06-17
- Deciders: t.koehn, Claude

## Context

The language drew lines, rects, circles and polys but had **no way to render text** —
no labels, no numbers, no badges. For an "icon" tool that is the single biggest product
gap: a UI agent cannot draw a counter badge, a version number, or a keycap glyph.

Naïvely, text means *fonts*, and fonts mean platform font files, hinting, and a shaping
stack — every one of which is a source of **non-determinism** ([ADR-0007](0007-visual-not-byte-determinism.md))
and a heavy runtime dependency the shipped library forbids (AGENTS.md §3). The model
already drops to `px`/`grid:` to fake a glyph today; that is pure token waste and visually
inconsistent.

## Decision

**1 — A `text` primitive.** Draw a string with its **top-left** at `<pt>`; it advances the
cursor to the end of the drawn text, exactly like `line` ([spec §5](../language-spec.md#5-coordinate-system)).
Both call surfaces work ([spec §3](../language-spec.md#3-lexical-structure), [ADR-0015](0015-unified-call-model.md)):

```drw
text 1:1 "HP 24" k              # command-form, default font
text(0:0, "hi", k)              # paren-form — identical
text 2:9 "lvl" w font micro     # per-text font override
```

```ebnf
text = "text" point string paint [ "font" name ] ;
```

**2 — Glyphs are bundled bitmap fonts.** Glyphs are **baked pixel bitmaps** shipped with
the library — no platform font lookup, no shaping. v1 ships two monospace ASCII fonts:
`micro` (3×5) and `small` (5×7). The **default font is `small`**. Because every glyph is a
fixed bitmap, rendering is trivially deterministic on every platform.

**3 — `font` is a scoped directive.** A `font <name>` command-form directive sets the
active font at **draw / module / theme** scope, like `mode`, `size`, `use`
([spec §3](../language-spec.md#3-lexical-structure)); a `draw`-local or per-`text` `font`
overrides it. A theme `font` default merges by the standard fold (later wins,
[ADR-0005](0005-theme-composition-by-fold.md)):

```drw
theme dusk:
  font small                    # the set's default face
```

**4 — Layout rules (fixed in v1).** Fixed **1px tracking** between glyphs. A newline in the
string advances to the next line; **line height = glyph height + 1**. Non-printable or
unknown characters render as a `missing-glyph` box (the glyph cell, outlined) — never a
silent gap.

**5 — Same bitmap in both render modes.** `text` rasterizes the **bitmap** in *both* pixel
and smooth mode — there is **no vector/outline font in v1**. This keeps determinism free and
sidesteps the entire hinting question; the smooth branch ([ADR-0013](0013-render-mode-pixel-vs-aa.md))
simply emits the same pixels (as rects in SVG).

**6 — Noted extensions (not specified now).** User-defined fonts loaded from a glyph
`tileset` ([spec §9](../language-spec.md#tilesets--atlases)); alignment flags
(`center`/`right`); variable tracking. None of these changes the core `text` primitive.

## Consequences

- Closes the biggest product gap: labels, numbers and badges become first-class, so an icon
  set no longer fakes glyphs with `grid:`/`px`.
- Determinism is **free** — baked bitmaps have no platform dependency and no AA, so they
  uphold [ADR-0007](0007-visual-not-byte-determinism.md) by construction and add no runtime
  dependency to `dist/`.
- Touches spec §8 (new `text` primitive), §12 (theme `font` default), §16/§17 (CLI brief may
  surface the active font; grammar gains `text` and the `font` directive).
- `font` reuses the existing module/theme-directive scope split (like `size`,
  [ADR-0021](0021-optional-canvas-size-resolution.md)) — no new scoping concept.
