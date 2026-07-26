# 50. Palette names are single letters; palettes combine by composition

- Status: Accepted
- Date: 2026-07-05
- Deciders: t.koehn, Claude
- Refines: [ADR-0049](0049-ascii-letter-pixel-keys.md) (drops its multi-character palette names), [ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md)

## Context

[ADR-0049](0049-ascii-letter-pixel-keys.md) pinned pixel keys to single ASCII letters but
still allowed **multi-character palette names**, "usable everywhere except as cells". That
leaves `pal` doing two jobs: the drawing's **pixel-key vocabulary** *and* general
expression-side colour naming. The second job is redundant — since
[ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md) palette entries are
ordinary bindings, a plain binding (`ink = #1a1a1a`) already names a colour for
expressions; the only things `pal` adds are const-ness and artifact membership, neither of
which a general named colour needs. And a palette that outgrows 52 letters is not a
naming problem — it signals that one hand-authored scope is carrying too many colours,
which is what the language's composition mechanism (`stamp`, §9) exists for.

## Decision

**1 — A `pal` entry name is exactly one ASCII letter (`a`–`z`, `A`–`Z`).** The pixel key
*is* the name — there is nothing else a palette entry is for. A multi-character name in a
`pal` is a positioned error (*"palette names are single letters — use a plain binding for
a named colour"*). Everything else from ADR-0046/0049 stands: entries are const, reserved,
theme-foldable, and referable everywhere as ordinary bindings.

**2 — Expression-side colour naming is a plain binding, not a palette entry.** `ink =
#1a1a1a` at module or draw scope names a colour for expressions and paint slots; it is not
const, not a pixel key, and not part of the palette artifact. `pal` keeps one job.

**3 — Palette scope is per drawing; palettes combine by composition.** Each drawing's key
scope is its own (local `pal` + theme fold) — capped at 52 keys *by design*. A drawing
that needs more colours **stamps parts**, each with its own palette scope; keys never
cross scopes (`r` in `gem` and `r` in the host are unrelated names — no collision, no
fold). The host's **palette artifact** (ADR-0046 point 4) then folds deterministically:
own entries first (declaration order), then each stamped drawing's entries in
first-stamp order; an entry whose colour is already in the table deduplicates (first
wins). Sidecar descriptors qualify colliding keys by source (`gem.r`); the indexed-PNG
256-entry cap applies to the combined table.

```drw
draw gem 4x4:
  pal y=#e0b070  r=#c04040
  # …

draw scene 32x32:
  pal k=#1a1a1a  b=#4060ff        # scene's own scope
  stamp gem 6:9                    # combined artifact: k, b, y, r — gem keeps its scope
```

## Consequences

- `pal` has exactly one purpose (the cell vocabulary + export artifact); the overlap with
  plain colour bindings is gone, and the const/reserved machinery of ADR-0046 now guards
  only 52 short names — minimal collision surface.
- "More than 52 colours" has a designed answer: decompose into stamped parts — which is
  the better-factored recipe anyway — and the export artifact combines automatically.
- `stamp tint`/parametric recolouring produce colours outside any authored table; `png
  indexed` now auto-completes those rendered colours into the final PNG palette
  ([ADR-0055](0055-indexed-png-auto-palette-completion.md)).
- Partially supersedes ADR-0049 (its multi-character-name sentence); touches spec §12
  (palettes), §13 (`indexed`), §18.
