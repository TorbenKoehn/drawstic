# 29. Language version pragma for cross-version reproducibility

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude
- Refines: [ADR-0007](0007-visual-not-byte-determinism.md)

## Context

"Reproducible across engine versions" ([spec §14](../language-spec.md#14-determinism)) sitting
next to "Status: **Draft**" ([spec top](../language-spec.md)) is a contradiction. If a future
v2 improves gamut mapping ([ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md)),
changes rounding, or refines the noise hash ([ADR-0026](0026-seeded-randomness-and-noise.md)),
then **every existing recipe silently changes output** on upgrade. That is the opposite of
deterministic.

A drawing tool that promises reproducibility across upgrades needs a way to **pin the
semantics version per file**, so an old recipe keeps rendering the way it did the day it was
written, and any change of pixels is **explicit and opt-in**.

## Decision

**1 — An optional first-line `drawstic <N>` directive pins the language version.** It is a
**bareword command-form** directive (the same shape as `use`, `size`, `seed` — [spec §3](../language-spec.md#3-lexical-structure)),
placed at the **top of the module**. `N` is an integer **major** version:

```drw
drawstic 1          # render this module under v1 semantics, forever
from creatures gem
```

**2 — The engine renders a pinned file under that version's semantics.** Rounding rules, the
bundled-math version, and the colour pipeline of [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md),
plus the frozen noise hash of [ADR-0026](0026-seeded-randomness-and-noise.md), are all
selected by `N`. **Absent the pragma**, the file uses the engine's **current/latest** version;
`drawstic fmt` and `drawstic check` ([spec §16](../language-spec.md#16-cli-surface)) may
**suggest** pinning so a file becomes upgrade-stable.

**3 — Newer-than-supported is an error; older stays renderable.** If a file pins a version
**newer** than the engine supports, the CLI fails with a **positioned error**
([ADR-0030](0030-positioned-cli-errors.md)) — e.g. *"this file requires drawstic 3; this
engine supports up to 2."* **Older** pinned versions remain renderable: the engine **retains**
prior-version semantics (they are versioned, not deleted), so a v1 recipe renders identically
on a v3 engine.

## Consequences

- Makes "reproducible across engine versions" **honest**: reproducibility is guaranteed
  **within** a pinned version; cross-version pixel changes become **explicit, opt-in** events
  (re-pin to adopt them).
- **Narrows** the [§14](../language-spec.md#14-determinism) / [ADR-0007](0007-visual-not-byte-determinism.md)
  wording from "across engine versions" to "within a pinned language version", aligned with
  [ADR-0027](0027-deterministic-numeric-and-colour-pipeline.md).
- Imposes an engine obligation: **retain historical semantics** for every supported major
  version (a versioned numeric/colour/raster core).
- Touches [spec §2](../language-spec.md#2-files--modules) (module top), [§14](../language-spec.md#14-determinism)
  (determinism scope), [§16](../language-spec.md#16-cli-surface) (CLI error on unsupported
  version), and [§17](../language-spec.md#17-grammar-normative) (grammar: an optional
  leading `version` directive).
