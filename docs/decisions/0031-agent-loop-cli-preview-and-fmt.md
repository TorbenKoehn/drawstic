# 31. Agent self-verification: `render --ascii`/`--preview` and `drawstic fmt`

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude

## Context

Two gaps block the agent's write-verify-correct loop.

**(a) The agent draws blind.** The `context` brief ([ADR-0008](0008-cli-design-brief.md))
previews only **imported** drawings — what's *available to use*, not what the agent *just
produced*. Self-verifiability ([spec §1](../language-spec.md#1-design-priorities), #3)
holds for a hand-drawn grid sprite (you read the characters back) but **collapses** for a
32×32 procedural drawing with gradients: no model can predict those pixels from source, and
re-reading the rendered PNG needs an OCR / multimodal round-trip. The agent commits output
it cannot see.

**(b) No canonical form.** The language is **indentation-significant** (whitespace is
meaningful — [spec §3](../language-spec.md#3-lexical-structure)) yet ships no formatter.
That hurts human review (inconsistent layout) and **bench comparability**
([ADR-0014](0014-token-efficiency-bench-suite.md)): paired variants differ on whitespace
noise, so token deltas measure formatting, not content.

## Decision

**1 — `render … --ascii`: deterministic text rendering.** `drawstic render
<file>#<drawing> --ascii` emits a **deterministic** text rendering of the **resolved
framebuffer** to stdout (no file written):

- for pixel/grid sprites, the **palette-key characters** — exact, and **round-trippable**
  with a `grid:` block ([spec §7](../language-spec.md#7-pixel-literals--explicit-pixels); the block is now `pixels:`, [ADR-0041](0041-rename-grid-block-to-pixels.md)),
- output is the resolved buffer, so it reflects stamps, transforms, and defaults
  ([ADR-0021](0021-optional-canvas-size-resolution.md)) — what the agent actually produced.

**2 — `render … --preview`: visual glance.** A `--preview` variant renders with **half-block
glyphs + ANSI truecolor**, a coarse visual of **procedural / gradient** output for which the
key-character form is meaningless. Also stdout, no file. Lossy by design — orientation, not
verification.

**3 — `drawstic fmt`: the canonical `.drw` formatter.** `drawstic fmt <file>` normalizes:

- **indentation** (spaces only, per ADR-0032),
- statement / line layout,
- definition spacing.

It is **idempotent** (`fmt(fmt(x)) == fmt(x)`). `drawstic fmt --check <file>` writes
nothing and **exits non-zero** on unformatted input (CI and bench use).

## Consequences

- The agent closes its **own** loop without OCR or a multimodal round-trip: `--ascii` for
  sprites it can read back, `--preview` for procedural output it can at least eyeball.
- `--ascii` **complements** the `context` brief ([ADR-0008](0008-cli-design-brief.md)):
  brief = *what's available to use*; `--ascii` = *what I just produced*. The two together
  give the agent both ends of the loop.
- A canonical form makes the token-efficiency bench
  ([ADR-0014](0014-token-efficiency-bench-suite.md)) measure **content, not whitespace** —
  variants are formatted before comparison, so deltas are real.
- `fmt --check` is a deterministic gate for CI and bench fixtures.
- Touches [spec §16](../language-spec.md#16-cli-surface): `render` gains `--ascii` /
  `--preview`; `fmt` is a new command (with `--check`).
- `--ascii` round-tripping with `grid:` means a procedurally-built sprite can be
  **frozen** into a hand-editable grid literal — a useful authoring move, not just a
  diagnostic.

## 2026-07-07 refinement

- `render --preview` and `render --ascii` accept `--fit WxH` for deterministic
  nearest-neighbour bounded output.
- Successful preview/ascii JSON uses `{ diagnostics: [], render: ... }` with dimensions,
  output text, and coverage stats.
- `render --inspect --json` emits render-derived facts without image viewing.
- `fmt --check --json` includes first changed line and changed-line count; `--diff` adds a
  unified diff, and `fmt --stdout` emits canonical output without mutation.
