# 11. The cursor and `to`/`by` relative motion

- Status: Superseded by [ADR-0061](0061-first-class-paths-and-local-pen-cursors.md)
- Date: 2026-06-14
- Deciders: t.koehn, Claude

> **Superseded in part by [ADR-0020](0020-cursor-line-and-by-point-operator.md):** `to` is
> removed (a one-point `line` already draws from the cursor), `by` becomes a **point
> operator** rather than a command keyword, and the two-point `line a b` is dropped in favour
> of `poly` / `move` + `line`. **And by [ADR-0038](0038-closed-shapes-do-not-move-the-cursor.md):**
> closed shapes no longer move the cursor at all (the anchor rule below is dropped). The
> cursor-state model below still holds.

## Context

Connected paths (especially lines) want cursor-relative coordinates. The draft used
relative-point literals — `+10:`, `:+20` — which read like block labels (`draw x 4x4:`)
and were ugly for partial axes and negatives. We also need to formalize the implicit
"current point" that path operations move.

## Decision

Every drawing carries an implicit **cursor** (current point), starting at `0:0`.
Cursor-aware commands name their destination two ways:

- **`to <point>`** — an absolute destination (`line to 30:12 k`);
- **`by <dx>:<dy>`** — a relative offset from the cursor (`line by 10:0 k`).

There is **no relative-point literal** (`+10:` is removed). Relativeness lives on the
verb; you write `0` for an unchanged axis.

**Cursor movement:** path/pen ops advance it to a defined exit point — `line`/`poly` to
their end / last vertex, `move` to its target. Closed shapes leave it at their anchor —
`rect` at its first corner, `circle` at its centre. `move to`/`move by` repositions
without drawing.

## Consequences

- Kills the label-look ambiguity; relative paths read clearly, negatives and partial axes
  are just `by -15:0` / `by 0:6`.
- The cursor is a single, predictable piece of state, central to path drawing and to
  chaining shapes.
- Exact exit points for closed shapes are a reviewable detail (spec open question 11).
- A `cursor` value + point arithmetic was considered but rejected as more verbose for the
  common case; `by` covers it.
