# 61. First-class paths and local pen cursors

- Status: Accepted
- Date: 2026-07-07
- Deciders: t.koehn, Codex
- Supersedes: [ADR-0011](0011-cursor-and-relative-motion.md), [ADR-0020](0020-cursor-line-and-by-point-operator.md), [ADR-0038](0038-closed-shapes-do-not-move-the-cursor.md), [ADR-0059](0059-relative-point-expressions.md)
- Refines: [ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md), [ADR-0044](0044-first-class-transforms.md)

## Context

The global drawing cursor made `line` compact but fragile: a reader had to know which previous
statement set hidden state, which commands read it, and which commands only advanced it. That
hurt self-verifiability, especially once paths needed to be reusable as masks, gradient-filled
geometry, exported vector assets, and cross-file definitions.

The earlier compromise made closed shapes cursor-free but left a mixed model: `line` read the
cursor, `poly`/curves/text advanced it, and `by` could appear in any point slot. The language
needs one visible rule instead.

## Decision

**1 - Drawing commands are explicit geometry.** Outside a `path` definition there is no
cursor. `line` is `line <a> <b> <paint> [w<N>]`; `quad`, `bezier`, `arc`, `poly`, and `text`
never read or update a cursor. `move` is not a drawing command.

```drw
line 0:0 15:0 k
quad 0:0 8:4 15:0 k
```

**2 - A cursor exists only inside a `path` block.** Path commands are pen commands over local
state: `move`, `line`, `quad`, `bezier`, `arc <end> around <center> cw|ccw`, and `close`.
Relative coordinates are written with `rel` in that command slot only.

```drw
path shield 16x16:
  move 8:1
  line rel 6:4
  arc 8:15 around 8:8 cw
  close
```

**3 - `Path` is a first-class vector value.** A `path` definition creates reusable geometry.
`path name = expr` defines aliases or boolean combinations, and parametric paths are called
like parametric drawings.

```drw
path badge = shield.subtract(notch(6))
```

**4 - Paint belongs to use sites.** `fill <path> <paint>` fills a path with even-odd fill.
`stroke <path> <paint> [w<N>]` centerline-strokes it. `path.fill()` and `path.stroke(n)`
convert a Path to a Region for masks and region algebra.

```drw
fill badge linear(90, #fff, #777)
mask badge.fill():
  stamp portrait 0:0
```

**5 - Path boolean operations return Paths.** `union`, `intersect`, `subtract`, and `xor` on
two Paths produce a Path. The current engine normalizes boolean results through deterministic
filled coverage; the semantic result is still a reusable Path value.

**6 - Path export is explicit.** `export <path> <base>:` with a `path` format writes geometry
SVG. Normal `svg` export remains the rendered drawing SVG.

## Consequences

- The hidden drawing cursor is removed from authored drawing commands.
- `by` is no longer the authoring path for relative geometry; path-local `rel` replaces it.
- Masks stay Region-based and therefore require explicit conversion: `path.fill()` or
  `path.stroke(n)`.
- SVG path export is separate from rendered SVG export.
- Touches spec §§4, 5, 8, 9, 13, 17; examples; parser/evaluator/build/export tests.
