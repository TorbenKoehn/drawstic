# 55. Indexed PNG auto-completes the palette from rendered colours

- Status: Accepted
- Date: 2026-07-06
- Deciders: t.koehn, Claude
- Refines: [ADR-0002](0002-hybrid-primitives-and-indexed-palette.md), [ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md), [ADR-0050](0050-single-letter-palettes-combined-by-composition.md)

## Context

`png indexed` originally treated the authored palette artifact as complete: every rendered
colour had to already be present in the drawing's ordered palette, and rendering any colour
outside that table was an error. That made hand-pixel recipes compact, but it made indexed PNG
unnecessarily hostile to normal first-class colour usage: gradients, filters, imported images,
anti-aliased edges, text, and explicit colour literals can render colours that were never useful
as single-letter pixel keys.

Drawstic's export contract is deterministic image output, not a requirement that authors
predeclare every possible RGBA sample. Indexed PNG should preserve authored palette order where
it exists, while still being able to encode the image actually rendered.

## Decision

**1 - `png indexed` builds its PNG palette from rendered RGBA colours.** All distinct RGBA8
colours present in the final rendered framebuffer are candidates for the indexed PNG palette.
A `pal` is not required merely to use `png indexed`.

**2 - Authored and stamped palette artifacts keep priority.** Palette entries that correspond
to colours actually present in the rendered framebuffer are emitted before auto-discovered
colours, using the existing deterministic artifact order: local authored entries, then stamped
drawing entries in first-stamp order, deduplicated by RGBA colour with first occurrence winning.

**3 - Transparent is first when present.** If the rendered framebuffer contains transparent
RGBA, the transparent colour is emitted as palette entry 0 before authored/stamped entries.
This applies regardless of whether transparency came from `.` pixels, `transparent`, imports,
or compositing.

**4 - Missing rendered colours are appended in scanline order.** After transparent and
authored/stamped colours, any remaining rendered RGBA colours are appended in first-seen
scanline order: top to bottom, left to right, over the final output pixels after scaling and
render-mode effects.

**5 - The 256-entry PNG limit remains hard.** If the resulting completed palette would contain
more than 256 distinct RGBA colours, `png indexed` is a positioned export error. Authors can
reduce colours, choose non-indexed PNG, or change render settings.

## Consequences

- `png indexed` no longer requires a `pal`; palette declarations remain useful for compact
  pixel keys, named colour bindings, and preferred palette ordering.
- Indexed PNG exports can represent colours produced by filters, imported images, text, and
  smooth-mode coverage without redundant palette declarations.
- Recipes that depended on authored palette order keep that order for colours that are actually
  rendered.
- Large smooth or imported images may exceed 256 colours and must export as non-indexed PNG or
  be quantized explicitly by the recipe before export.
