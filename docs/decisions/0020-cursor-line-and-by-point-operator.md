# 20. `line` is cursor-only; `by` is a point operator; no `to`

- Status: Superseded by [ADR-0061](0061-first-class-paths-and-local-pen-cursors.md)
- Date: 2026-06-15
- Deciders: t.koehn, Claude
- Supersedes (in part): [ADR-0011](0011-cursor-and-relative-motion.md)

## Context

[ADR-0011](0011-cursor-and-relative-motion.md) modelled cursor motion with two **command
keywords**, `to` (absolute destination) and `by` (relative offset), and kept a **two-point**
`line a b`. Reconsidering under the mantra:

- **`to` is redundant.** A one-point destination drawn *from the cursor* already means "to" —
  the keyword adds a token and a concept without resolving anything.
- **Relativeness belongs to points, not verbs.** Making it a property of the *point* (`by
  dx:dy`) is more composable than attaching it to each cursor command, and it is the
  relative-point literal ADR-0011 rejected as `+10:` — except `by dx:dy` reads as a word, so
  the block-label confusion that killed `+10:` does not apply.
- **A two-point `line a b` plus a one-point cursor `line` would need arity to tell them
  apart.** Dropping the two-point form removes that ambiguity entirely.

## Decision

**1 — A point is `x:y` (absolute) or `by dx:dy` (relative to the cursor).** Refined by
[ADR-0059](0059-relative-point-expressions.md): `by` now accepts any point expression.
`by` is a **point
operator**, usable in any point position (not a command keyword): `line by 10:0`,
`rect by 0:0 by 8:8`, `circle by 2:2 6`.

**2 — `to` is removed.** A cursor-path command draws from the cursor to its point; the bare
point *is* the destination:

```drw
move 0:0          # set the cursor, no drawing
line by 10:0 k    # cursor → cursor + (10,0)
line 30:12 k      # cursor → absolute 30:12
```

**3 — `line` is cursor-only and takes exactly one point.** The two-point form `line a b` is
**removed**. `line` always starts at the cursor and draws to its one point (absolute or
`by`-relative), then advances the cursor there. Explicit, cursor-free segments use **`poly`**
(`poly k 0:0 8:8`) or a `move` first (`move 0:0` then `line 8:8 k`). Every command now has a
**fixed arity** — no one-vs-two-point ambiguity.

**4 — Cursor movement is unchanged** ([ADR-0011](0011-cursor-and-relative-motion.md)):
`line`/`poly` advance to end / last vertex, `move` sets, `rect`/`circle` anchor (first corner
/ centre). `rect`/`circle` keep their explicit point arguments (corners / centre); any of
those points may also be `by`-relative.

## Consequences

- One fewer keyword (`to`); relativeness is unified into the point grammar; `line` has a
  single job (the cursor-path primitive).
- **Self-verifiability:** the fully explicit, cursor-free path is `poly` (or `move` + `line`);
  the cursor forms are the terse turtle idiom, and `by` is an explicit relative marker — so a
  reader always sees whether a coordinate is absolute, relative, or explicit.
- **Trade:** an explicit horizontal/diagonal segment that used to be `line a b` is now
  `poly <paint> a b` or `move a` + `line b` — one extra token or line. Accepted: `line`'s one
  job and the removed ambiguity are worth it.
- Supersedes ADR-0011's `to` keyword and two-point `line`; ADR-0011's cursor-state model and
  closed-shape exit points still stand.
- Touches spec §5 (cursor & points), §8 (primitives), §17 (grammar); the examples; and the
  bench corpus (row-band fills move from `line a b` to `poly`).
