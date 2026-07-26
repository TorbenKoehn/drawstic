# 38. Closed shapes do not move the cursor; all path exits pinned

- Status: Superseded by [ADR-0061](0061-first-class-paths-and-local-pen-cursors.md)
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Resolves: spec open question 11 (supersedes the closed-shape anchor rule of
  [ADR-0011](0011-cursor-and-relative-motion.md) / [ADR-0020](0020-cursor-line-and-by-point-operator.md))

## Context

[ADR-0011](0011-cursor-and-relative-motion.md) gave closed shapes an "anchor" exit —
`rect` left the cursor at its first corner, `circle` at its centre — and flagged the exact
exits as open question 11. That rule is a **per-shape table of hidden state changes** an
author must memorize, hurting self-verifiability (priority 3). Meanwhile `arc`, `quad`, and
`bezier` ([ADR-0023](0023-curve-and-shape-primitives.md)) had **no specified cursor
behaviour at all**.

## Decision

**The cursor moves only when a path is being built.**

- **Move it:** `move` → its target; `line` → its endpoint; `poly` → its last vertex;
  `arc` → the arc's endpoint (at angle `a1`); `quad` / `bezier` → their final point
  (`p2` / `p3`); `text` → the end of the drawn text ([ADR-0022](0022-text-and-bitmap-fonts.md)).
- **Never move it:** the closed shapes `rect`, `rrect`, `circle`, `ellipse` — and `px`,
  `flood`, `bg`, `stamp`, and all filters. The anchor rule is dropped.

One sentence replaces a lookup table: *path ops advance the cursor to where the path ends;
everything else leaves it alone.*

## Consequences

- Resolves open question 11; predictability wins over the (never-used) ability to chain a
  `line` off a rectangle's corner — write `move` first if that is wanted.
- `quad`/`bezier` take an explicit `p0` and still do **not** read the cursor — they only
  set it on exit; `line` remains the only primitive that *starts* at the cursor
  ([ADR-0020](0020-cursor-line-and-by-point-operator.md)).
- Touches spec §5 (cursor rules) and §8 (path-op paragraph); ADR-0011's exit-point
  paragraph is superseded in this part.
