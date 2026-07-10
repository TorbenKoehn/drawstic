# 85. `critique` — pixel-based, vision-free quality assertions

- Status: Accepted
- Date: 2026-07-10
- Deciders: t.koehn, Claude
- Refines: [ADR-0030](0030-structured-diagnostics-contract.md), [ADR-0031](0031-agent-loop-cli-preview-and-fmt.md); reuses [ADR-0082](0082-sheet-contact-sheet-cli.md), [ADR-0083](0083-render-silhouette.md)

## Context

`check` validates grammar and, with `--lint`, a handful of static authoring smells
([spec §16](../language-spec.md#16-cli-surface)); neither ever looks at a rendered pixel.
Across the category evaluations (`docs/scene-dx-*.md`, `docs/icon-dx-*.md`,
`docs/character-dx-*.md`, `docs/item-dx-*.md`) the recurring finding is the same: **roughly 5
of 7 expensive bugs per category are visual and silent** — off-center icons, floating/seamed
character parts, near-identical item silhouettes, flat unshaded regions, transparent trailing
edge rows — a well-formed recipe that `check` passes clean. Closing them today spends the
agent's own vision on every render, which is unreliable for a weak or vision-poor model and is
nowhere documented as a gate: there is no machine quality signal, so "is this good?" has no
answer besides eyeballing, and `--ascii` can itself mislead (a dark scene renders as a wall of
`@`).

## Decision

**1 — New CLI verb `drawstic critique <file> [--as icon|scene|character|item] [--family
a,b,c] [--strict] [--json]`.** It renders the target drawing (and, for family checks, its
siblings via [`selectSheetDrawings`](0082-sheet-contact-sheet-cli.md)) and runs a fixed catalog
of **pixel-based, vision-free assertions** against the framebuffer — no LLM vision call, no
heuristic guess. Metric computation reuses `inspectSprite` (`src/inspect.ts`),
`silhouetteSprite`/`spritePreviewStats` (`src/preview.ts`, [ADR-0083](0083-render-silhouette.md)),
the RGBA8 framebuffer, and `src/color.ts` luminance/contrast helpers — no metric is computed
twice.

```
drawstic critique examples/items-v2/potion.drw --as item --family vial,flask,potion --json
```

**2 — A new diagnostic namespace `C0xx`, alongside `E0xx`/`W0xx`.** Every finding is a normal
structured diagnostic record ([ADR-0030](0030-structured-diagnostics-contract.md)) extended with
`measured`, `threshold`, and a concrete fix command — auditable and teachable, never a bare
pass/fail:

```json
{ "severity": "warning", "code": "C007", "message": "floating part: 3px gap between torso and armLeft",
  "measured": 3, "threshold": 1, "hint": "fit armLeft.shoulder torso.shoulder, or move armLeft 0:-3" }
```

**3 — The check catalog** (one metric bundle, computed once, read by every check):

- **C001** empty/near-empty · **C002** edge-clip (opaque pixel touches the canvas edge) ·
  **C003** optical centering (`x0+x1==W−1`, `y0+y1==H−1` bbox parity) · **C004** value/contrast
  spread (luminance histogram — catches the "wall of `@`" flat-shading class) · **C005** stroke
  width (distance transform) · **C006** palette/complexity budget.
- **C007** floating-part/seam — the #1 character bug: 8-connected alpha components, body = the
  largest component, a chamfer distance transform from the body; flags only the signature
  *bbox-overlap **with** a pixel gap ≥1*, so legitimate detachments (a thrown weapon, a
  separate accessory) are never penalized.
- **C008** holes/pinholes (border flood-fill; a 1–3px interior gap is almost always a bug).
- **C009** sibling-silhouette collapse — alpha box-resampled onto a fixed 32×32 grid (scale-
  and position-invariant), normalized L1 distance between siblings; a pair under ~0.12 is
  flagged (catches e.g. a shortbow/longbow pair reading as the same shape at a glance).
- **C011** family weight parity · **C012** the rendered form of `W009` — an *asymmetric* bottom
  gap (trailing transparent rows exceeding the top margin beyond the centering tolerance), measured
  from pixels rather than the static `pixels:` grid; symmetric breathing room is never flagged.
- Every threshold is relative/scale-invariant; the one absolute figure — minimum stroke width
  — scales as `round(2·size/32)`.

**4 — `--as` selects a `CritiqueProfile` (thresholds), never inference.** Category profiles
for `icon`/`scene`/`character`/`item` fix the C005/C006/C009/C011 thresholds to the values each
category's evaluation already measured as its craft floor; omitting `--as` runs the
category-agnostic subset only. `--family` overrides the default sibling selection
(`selectSheetDrawings`, [ADR-0082](0082-sheet-contact-sheet-cli.md)); canvas size is read from
the render, never inferred.

**5 — Severity and gating.** Every `C0xx` finding defaults to `warning` (exit 0 — `critique`
never blocks a render or build by default). `--strict` promotes a fixed must-fix subset to
`error` (exit 1), making `critique --strict` usable as a CI regression gate over `examples/`.
Phase 1c **calibrated that subset against the full bundled corpus** to the *unambiguous
structural defects only* — **C001** (empty), **C007** (character floating-part/seam), plus
**C003** for the `icon` profile (icons must optically centre). The other codes are deliberately
left advisory (`warning`, exit 0) because the corpus proves each has a legitimate form that a
pixel check cannot distinguish from a bug: **C002** (icons/items intentionally fill to an edge),
**C008** (open bow/crossbow frames, arrow bundles, glyph counters, organic overlaps all enclose
1–3 px gaps), **C009** (faction recolors, size variants, and shared bottle/shield/plate scaffolds
collapse to one silhouette *by design* — a colour-blind silhouette check cannot tell an intended
variant from a duplicate), **C011** (item sets legitimately mix a ring and a greatsword), **C012**
(symmetric bottom breathing room), **C005/C006** (thin detail and gradient sprawl are style
choices). This narrows the originally-planned list (C001/C002/C007/C008/C009); the rationale and
measured floor are recorded in `docs/impl-progress.md`.

**6 — A vision rubric block, printed after the automatic gate.** `critique` additionally
prints an ordered list of silhouette-first render commands plus a category-specific rubric
(icon: misread test + merge trap; character: seam contact; item: pair confusion). Automatic
`pass:true` is **necessary, not sufficient** — the rubric is the part that still requires the
agent to look. The product-skill workflow states this as the explicit "definition of done":
`critique` passes **and** the rubric was answered.

## Consequences

- Gives the agent loop a machine quality signal for the class of bug `check` structurally
  cannot see — closes the "check is grammar-only, ~5/7 costly bugs are visual and silent" gap
  named across every category evaluation.
- `critique --strict` becomes the regression gate for `examples/` once wired into CI; every
  bundled example must re-baseline against it.
- New file `src/critique.ts` (metric engine, `C0xx` catalog, `CritiqueProfile`s, rubric text);
  new CLI verb in `src/cli.ts`. No change to `check`, `build`, or `render` semantics —
  `critique` is purely additive and reuses the existing renderer and metric helpers.
- Touches [spec §16](../language-spec.md#16-cli-surface) (new CLI verb + diagnostic-code
  table), the product skill (`skills/drawstic/SKILL.md` + `reference.md` — the mandatory
  workflow gains a `critique` step before "done"), and `docs/best-practices.md` (verification
  loop).
- `tests/unit/critique.test.ts` fixtures pin each check's `measured` value against a
  known-bad sprite (floating part, pinhole, near-identical sibling pair, off-center icon,
  flat-value region), so thresholds are test-asserted, not just documented.
