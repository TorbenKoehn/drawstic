# 8. CLI design brief (`context`) for agent ergonomics

- Status: Accepted
- Date: 2026-06-13
- Deciders: t.koehn, Claude

## Context

A theme's style guide and a module's imported parts live across multiple files. When an
agent edits `creatures/slime.drw`, it needs the active style guide, palette, and
available parts in context. The options were: duplicate style into barrel files (drift),
have the agent read every imported file (N extra tool calls, error-prone), or have the
CLI provide a resolved guide.

## Decision

The CLI exposes **`drawstic context <file>`**, which resolves all imports and theme
composition for that file and emits **one flat design brief** the agent loads before
editing — a single deterministic tool call instead of N file reads. It contains:

- the active theme: **merged palette** (key → hex + name) and **merged style guide**
  (sectioned by source theme, per [ADR-0005](0005-theme-composition-by-fold.md)),
- **available imported drawings** (name + `WxH` + optional ASCII preview),
- **available functions** (name + signature).

This is a first-class feature and the backbone of the `draw-image` agent skill.

## Consequences

- The CLI already parses the module graph, so the brief is produced essentially for free.
- Theme composition being a deterministic fold guarantees a single resolvable brief and
  enables conflict warnings.
- The brief's size scales with style-guide length — another reason to keep style
  fragments short ([ADR-0003](0003-themes-as-style-guides.md)).

## 2026-07-07 refinement

The brief also includes export plans (source name, output base path, formats and scale/size
flags) plus cheap per-drawing authoring facts: size source, local palette keys, and
large-preview hints. This lets `context --json` describe what `build` will write before the
agent starts editing.
