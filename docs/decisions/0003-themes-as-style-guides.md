# 3. Themes are style guides (machine + LLM dual artifact)

- Status: Accepted
- Date: 2026-06-13
- Deciders: t.koehn, Claude

## Context

Diffusion models cannot hold a consistent visual style across many images. Consistency —
not just determinism — is Drawstic's core value. A palette alone does not tell an agent
*how* sprites in a set are drawn (outline rules, shading technique, light direction,
proportions, vibe).

## Decision

A `theme` is a **dual artifact**:

- **Machine part:** palette (key → color), shared base drawings, canvas defaults.
- **LLM part:** a natural-language **style guide** (`style "…"`), surfaced to the agent
  before it draws within the theme.

The style guide is delivered to the agent via the CLI design brief
([ADR-0008](0008-cli-design-brief.md)), not by forcing the agent to read theme files.

## Consequences

- This is the mechanism that lets an LLM produce a *coherent set*, which is the reason
  to choose Drawstic over "the model just emits SVG".
- Style guides are free-form prose; long composition chains can bloat them
  ([ADR-0005](0005-theme-composition-by-fold.md)) — keep fragments short.
- The brief must merge and section style fragments by source theme for readability.
