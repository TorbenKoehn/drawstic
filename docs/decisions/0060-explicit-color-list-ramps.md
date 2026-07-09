# 60. Explicit color-list ramps

- Status: Accepted
- Date: 2026-07-07
- Deciders: t.koehn, Claude

## Context

Project-specific colour choices should stay local and visible. A bundled palette preset or
hidden ramp generator would save a few tokens but would also hide the choices that make a
drawing fit its set. At the same time, small sprites often need ordered, explicit palette
ramps for pixel keys and indexed exports.

## Decision

**1 - Colour ramps are plain lists.** `tones(base, ...amounts)` returns colours in the same
order as the requested amounts. Negative amounts darken, `0` returns the base, and positive
amounts lighten. UFCS is equivalent:

```drw
dark, mid, light = #cccccc.tones(-12%, 0%, 12%)
```

**2 - Mix ramps are plain lists.** `mixes(a, b, count[, space])` returns `count` colours,
including both endpoints when `count > 1`; `count == 1` returns the first endpoint. The
optional interpolation space follows `mix`.

```drw
sea = #116a96.mixes(#e9fbff, 4)
```

**3 - Palette destructuring is explicit and block-only.** Block-form `pal` may bind a list
to explicit single-letter keys. The right-hand side must be a list with exactly as many
colour values as keys, and the palette artifact records those keys in source order.

```drw
pal:
  a, b, c = #cccccc.tones(-12%, 0%, 12%)
```

## Consequences

- Procedural art can use local semantic colour bindings without `pal`.
- Pixel sprites keep authored palette order without hidden key generation.
- The standard library gains only small pure functions, not theme palettes or style presets.
