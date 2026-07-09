# 64. Stamp anchors

- Status: Accepted (offset-anchor semantics refined by [ADR-0072](0072-visual-stamp-anchors.md): visual in language version 2, this through-transform mapping retained for `drawstic 1`)

## Context

`stamp` places by top-left, which is exact but awkward for scene composition where authors
often know an object's center or baseline point.

## Decision

Keep top-left placement as the default. Add an explicit keyword flag:

```drw
stamp boat 136:70 anchor bottom
stamp bird 88:18 anchor center
```

Accepted anchors are `topLeft`, `top`, `topRight`, `left`, `center`, `right`, `bottomLeft`,
`bottom`, and `bottomRight`. The anchor is a source-local point; after flip/scale/rotation and
an explicit `transform`, Drawstic maps that local point through the stamp transform and
round-half-up subtracts it from the requested destination point.

## Consequences

Existing recipes are unchanged. New recipes can place stamps by center or bottom without
manual width/height offset math, including when other stamp transforms are present.
