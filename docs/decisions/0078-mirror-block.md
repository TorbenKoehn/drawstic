# 78. `mirror` — axis-symmetry block

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Resolves: `TODO-IMP.md` §5.5 (Scene-DX evaluation, symmetry only per-stamp, never for procedural passages)

## Context

Symmetry is everywhere in the evaluation scenes — a face, a butterfly, a UI frame, a reflected
tree — but the language only offered symmetry **per stamp** (`flipx`/`flipy`, ADR-0043): you draw a
sprite once, then stamp a flipped copy. A *procedural* passage (a scatter, a run of shapes, a
gradient fill) had no way to say "and its mirror image too"; authors re-typed the whole passage with
hand-reflected coordinates ([evaluation](../scene-dx-evaluation-2026-07-08.md)). A block that executes its
body **and its reflected copy** across a chosen axis closes that gap.

The architecture had no coordinate-transform context for paint commands (only `stamp` builds a
per-sprite matrix), and no draw-command recorder to replay. Every primitive — shapes, region
fills, `flood`, stamps, text, filters — ultimately writes pixels through the one
`Framebuffer.blend`/`set` surface ([ADR-0025](0025-compositing-and-alpha.md)). That single write
chokepoint is what makes a **reflecting-buffer** mechanism both uniform and cheap.

## Decision

**1 — `mirror x=<n>:` / `mirror y=<n>:` draws the body once normally, then draws its reflection
across the axis.** `x=n` reflects horizontally about the vertical line `x = n` (`px → 2n − px`);
`y=n` about the horizontal line `y = n`. The body statements **execute normally** (the un-mirrored
copy is byte-for-byte what the same statements would draw without the block — it is drawn directly
to the real buffer, not a flattened layer), then the body is **re-executed** with a reflecting
buffer active.

```drw
draw butterfly 32x24:
  mirror x=16:                 # draw the left wing; the right is its mirror
    curvePoly #b0407a 16:6 4:2 2:12 16:16 fill
    circle #ffe08a 8:9 2 fill
```

**2 — Mechanism: two-pass re-execution through a reflecting `Framebuffer` wrapper (`MirrorFramebuffer`).**
Pass 1 runs the body against the real buffer. Pass 2 runs the *same* body with `ctx.buffer` swapped
to a wrapper that reflects the x (or y) coordinate on every `blend`/`set`/`get`/`alphaAt`/`inBounds`
and delegates to the real buffer. Because all rasterization funnels through that surface, **every
primitive mirrors with zero per-command code** — shapes, region fills, gradients, arcs, `flood`, and
filters all reflect uniformly and self-consistently (reads reflect too, so read-modify-write filters
stay coherent). Re-execution (not layer compositing) was chosen because it keeps the un-mirrored copy
exactly normal, reproduces seeded randomness identically in both passes (a `scatter` inside a
`mirror` is a *true* mirror of the same points, [ADR-0077](0077-scatter-block.md)), and is the only
mechanism that can render **forward text** (see §4). Its cost — the body's non-drawing side effects
(e.g. a `+=` on an outer `let`) happen twice — is the same re-execution model as filter and loop
bodies; keep `mirror` bodies to drawing.

**3 — Axis pixels paint exactly once (no double-blend).** A pixel exactly on the axis maps to
itself (`2n − n = n`), so the reflected pass would re-blend it — a visible seam under any non-opaque
paint, and an alpha error. The `MirrorFramebuffer` **skips writes whose source coordinate is on the
axis** (`x === n` for `x=n`), so the axis line is painted once, by pass 1. Content strictly on one
side never otherwise overlaps its mirror; content that itself straddles the axis overlaps by the
author's own choice (the block mirrors, it does not clip to one side). `n` is an integer (`quantInt`
of the header expression), so the axis is a single pixel column/row.

**4 — Stamps mirror with a flip; text mirrors position, not glyphs.** A `stamp` in the reflected
pass has its pixels reflected — i.e. the sprite comes out **horizontally flipped** and repositioned,
the intuitive "mirror the stamp". **Text is special-cased**: nobody wants backwards glyphs, so in the
reflected pass a `text` command draws **forward glyphs at the reflected origin** — the text's origin
point is reflected across the axis, the string reads left-to-right normally. (It is drawn directly to
the underlying buffer at the mapped origin, with the mask transformed back so clipping still holds.)
Pinned: **stamps flip, text does not.**

**5 — A mask clips content in canvas space; the mirror reflects the clipped content. Nested mirrors
compose.** A `mask R:` clips the drawing to `R` in canvas coordinates as always; the reflecting
buffer then mirrors whatever survived — so a masked shape and **its mirror image** both appear (the
mask *travels with the content*, it does not need reflecting). This is the useful reading: `mask
leftHalf: mirror x=w/2: scene` draws `scene` clipped to the left half **and** its reflection filling
the right half, rather than an outer mask silently deleting the mirror copy. Stamp `mask` regions
behave the same. **Nested `mirror` blocks compose** rather than being rejected — `mirror x=a:` around
`mirror y=b:` yields four-fold symmetry (identity, x-mirror, y-mirror, xy-mirror) by wrapping the
already-reflecting buffer, and the centre pixel `(a,b)` is still painted exactly once (each wrapper
skips its own axis). `scatter` inside `mirror` composes too (both passes place the same seeded
points; the reflected pass mirrors them). Only **text** needs the composed reflection matrix — to map
its origin so glyphs land mirrored-in-position but forward-in-orientation (§4).

**6 — `mirror` is a contextual keyword, pure addition, no pragma gate.** Recognized only in the
`mirror x=…:` / `mirror y=…:` header shape; `mirror = expr` and `mirror` in expression position stay
an ordinary bindable name (same treatment as `scatter`/`mask`). It changes no existing render and is
available in every language version (`lang` stays **2**).

## Consequences

- Any procedural passage becomes symmetric with one wrapping line; symmetry is no longer a
  stamp-only, hand-reflected chore. Pairs with `scatter` for symmetric random fields.
- The axis-once rule makes 50%-alpha paint on the axis correct (a single blend), which a naive
  "draw twice" would double-darken.
- `MirrorFramebuffer` (a coordinate-reflecting wrapper over the real buffer) is the single new piece
  in `src/raster.ts`'s neighbour `src/framebuffer.ts`; the rest is eval orchestration. `Framebuffer`
  itself stays a pure pixel store.
- Costs: the body re-executes (side effects twice — documented; keep bodies to drawing), and
  whole-frame filters inside a `mirror` run in both the normal and reflected frame (an edge case,
  self-consistent).
- Touches [spec §9](../language-spec.md#9-composition-transforms--masks) (symmetry, masks),
  [§11](../language-spec.md#11-loops) (blocks), [§14](../language-spec.md#14-determinism),
  [§17](../language-spec.md#17-grammar-normative) (`mirror-stmt`), `src/framebuffer.ts`
  (`MirrorFramebuffer`), `src/parser.ts` + `src/ast.ts` (new `mirror` node), `src/eval.ts`
  (two-pass execution, mask/stamp/text reflection, budget), tests, `docs/best-practices.md`,
  and the product skill (`skills/drawstic/SKILL.md` + `reference.md`).
