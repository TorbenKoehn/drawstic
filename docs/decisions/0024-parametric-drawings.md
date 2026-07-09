# 24. Parametric drawings and recolor-on-stamp

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude

## Context

A `draw` was a **fixed bitmap** and `stamp` blitted it verbatim
([spec §9](../language-spec.md#9-composition-transforms--masks)); `fn` returns *values*, not
*pixels* ([spec §10](../language-spec.md#10-expressions--functions)). So an icon **set** — the
project's core goal — could not express "the same arrow in 4 colours" or "a key in colour `c`"
without **duplicating whole drawings**. That costs tokens *and* manufactures the very
visual inconsistency the project exists to prevent: four hand-copied arrows drift apart.

## Decision

**1 — A `draw` may take parameters.** Params are ordinary bindings in scope in the body:

```drw
draw key(r) 8x8:                # r is bound in the body like any binding
  bg transparent
  circle 2:2 2 r
  rect 3:3 6:5 r fill

draw arrow(c, len) 16x16:
  poly c 0:8 len:8
```

Canvas size stays **literal** ([ADR-0021](0021-optional-canvas-size-resolution.md)): params
**cannot** set `WxH`. A parametric procedural draw states `WxH` explicitly or relies on a
`size` default as usual.

```ebnf
draw = "draw" name [ "(" [ params ] ")" ] [ size ] ":" INDENT { drawstmt } DEDENT ;
```

**2 — Stamp a parametric draw by passing args.** `key(r)` instantiates the drawing with `r`
bound; this is the unified call model ([ADR-0015](0015-unified-call-model.md)) — the stamp
target is a (possibly applied) drawing reference, and transforms still trail it:

```drw
stamp key(red)  4:4
stamp key(blue) 4:4 flipx       # transforms compose with the instantiation
```

**3 — Recolor convenience on ANY stamp — `tint`.** For the common "same silhouette, shifted
hue" case *without* parameterizing, any `stamp` may blend the stamped pixels toward a paint:

```drw
stamp crest 4:4 tint r 0.4      # blend stamped pixels toward r by 0.4 (0..1)
```

Full palette remap is **intentionally not added** — pass a colour parameter (rule 1) instead.
One drawing keeps one clean recolor mechanism, not two overlapping ones.

## Consequences

- **Components become first-class.** An icon set is authored *once* and instantiated, so visual
  consistency holds **by construction** — the whole point of the project — instead of relying on
  the author to keep copies in sync.
- Touches spec §6 (the `draw` header gains optional params), §9 (`stamp` gains args + `tint`),
  §17 (grammar: `draw` params).
- Composes cleanly with the transforms and masks already on `stamp` (flip/rot/scale/mask) and
  with the new curve primitives ([ADR-0023](0023-curve-and-shape-primitives.md)) — a parametric
  draw may itself use any primitive.
