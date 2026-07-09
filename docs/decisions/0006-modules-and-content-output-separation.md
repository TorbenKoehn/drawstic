# 6. Modules: all public; content/output separation (`export`)

- Status: Accepted
- Date: 2026-06-13
- Deciders: t.koehn, Claude

## Context

Two questions converged:

1. Visibility — is an `export` keyword for "public" worth its weight?
2. Output — a `draw` does not always become a file; some drawings are only stamped. And
   producing a file involves real configuration (target resolutions, naming, HDPI,
   compression, SVG options) that does not belong on the drawing itself.

## Decision

- **Every top-level definition is public.** No visibility keyword. A module's surface is
  the set of `(name, type)` it defines; imports reference by name, type inferred.
- **Content is separate from output.** A single content concept (`draw`) describes the
  pixels/vectors. A separate **`export` element** declares *what artifacts* to produce
  from a drawing (formats × scales × per-format options × naming). The **CLI decides
  where** they go (disk or stream) — the element declares intent, not the sink.
- Consequently `sprite` and `draw` **unify into one concept**: a drawing is stampable
  and/or exportable based on use, not on which keyword declared it. `export` elements
  are leaf build targets and are not importable.

## Consequences

- Fewer concepts and one fewer keyword.
- A drawing with no `export` is never written to disk — clean answer to "some are only
  stamped".
- Output presets are versioned with the artwork (reproducible builds); the CLI can still
  override or stream ad-hoc.
- Animation frames / sprite-sheets fit later as a new `export` form without core changes.
