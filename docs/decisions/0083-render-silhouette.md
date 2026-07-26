# 83. `render --silhouette` — solid black-silhouette shape test

- Status: Accepted
- Date: 2026-07-09
- Deciders: t.koehn, Claude
- Resolves: recurring hand-rolled silhouette check in the character-DX craft eval (4 of 7 builder agents wrote a throwaway `draw` to flatten a modular character to a single colour to verify occupancy/proportion/part alignment)

## Context

When authoring a modular character or sprite (parts stamped into a full-body
`draw`, as in `examples/characters/knight.drw`), the single most repeated
verification is the *shape-only* readout: strip all colour, keep only "which
pixels are covered", and eyeball the silhouette for occupancy, proportion, and
part alignment — colour distracts from form. In the character craft eval, 4 of 7
agents built this by hand: a throwaway parametric `draw` that re-paints every
part in one flat colour, or a `tint`-to-black overlay — pure scaffolding, exactly
the throwaway code AGENTS.md §1 forbids, rebuilt per session.

The verification loop is already the CLI's job: `render` owns the agent-facing
self-verification post-passes on the rendered framebuffer — `--ascii`,
`--preview`, `--inspect`, `--grid`, `--diff` ([ADR-0031](0031-agent-loop-cli-preview-and-fmt.md),
[ADR-0030](0030-structured-diagnostics-contract.md)). A silhouette is one more
such post-pass and belongs there, not in recipe source.

## Decision

**1 — `render --silhouette` flag.** `drawstic render` gains a `--silhouette`
boolean flag. It is a pure, deterministic per-pixel transform of the rendered
framebuffer, applied *before* any output kind is selected — so it composes with
every output kind (`--ascii` / `--preview` / `--inspect` / PNG via `--png@N` /
`--out` / `--stdout`) and with every downstream framebuffer op (`--crop` /
`--fit` / `--grid`). It introduces no new error case: it is a total transform on
already-valid RGBA8.

```
drawstic render examples/characters/knight.drw#knightFront --silhouette --png@4 --out sil.png
drawstic render examples/characters/knight.drw#knightFront --silhouette --ascii
```

**2 — Semantics: solid 1-bit coverage, not RGB-zeroed.** Every pixel with
`alpha > 0` becomes opaque black `#000000ff`; every fully transparent pixel
(`alpha === 0`) stays transparent. This is a hard 1-bit coverage mask.

The considered alternative — zero the RGB channels but *keep* each pixel's
original alpha — was rejected. A silhouette test asks a single question: "what
area does this shape cover?" A modular character's antialiased or intentionally
translucent edges (glass, glow, `alpha()` contact shadows) would render under the
keep-alpha variant as a faint grey fringe, blurring the very outline the test
exists to sharpen — the reader then can't tell a soft edge from thin coverage.
Forcing every covered pixel to full opacity gives one unambiguous mass with a
crisp boundary, which is the honest answer to the coverage question and reads
identically in PNG, ANSI preview, and ASCII. The cost — losing the soft-edge
information — is precisely what the test wants gone; anyone needing edge alpha
uses a plain render or `--inspect`.

**3 — Output surfacing.** When `--json` is set, the `render` payload carries
`silhouette: true` (omitted otherwise), mirroring how `--crop` / `--fit` /
`--grid` already surface their application, so an agent can confirm the transform
ran. The silhouette is applied before `spritePreviewStats` / `--inspect`, so
those stats describe the silhouette (e.g. a fully-opaque sprite collapses to
`distinctColorCount: 1`), which is the intended shape-level view.

## Consequences

- Removes the recurring throwaway silhouette `draw`; the shape check is now a
  first-class, zero-source CLI post-pass.
- Implementation is a `silhouetteSprite(sprite)` helper in `src/preview.ts`
  (home of the other render post-pass sprite transforms `cropSprite` /
  `fitSprite`), wired into `runRender` in `src/cli.ts` immediately after
  `renderFragment`, before `--crop`/`--fit`/output selection.
- Product skill `skills/drawstic/` (SKILL.md + reference.md) must document the
  `--silhouette` flag on `render`; the `--silhouette` line is the exact addition.
- No new diagnostic code, no grammar/spec change, no `build`-path change
  (`--silhouette`, like `--ascii`/`--grid`, is a `render`-CLI-only post-pass and
  never touches `export`).
- Covered by `tests/unit/cli.test.ts` (`render` → `--silhouette` describe): PNG
  black-out + transparency preservation, `--png@N` composition, `--inspect`
  single-colour collapse, and `--ascii --json` flag surfacing.

## Amendment (release 1.0 hardening): plate-aware

`silhouetteSprite` no longer signs the full covered mask unconditionally: it reuses
`detectPlateFigure` (`src/preview.ts`, originally the C009 sibling-silhouette
plate-blindness fix — see [ADR-0085](0085-critique-command.md) §C009 "Round 4") to
detect an opaque plate/tile from pixel evidence and, when found, silhouette the
*figure* stamped on it instead — otherwise a canonically-built icon (`icon-craft.md`'s
mandatory opaque plate) silhouettes as a featureless black square, exactly the failure
a blind usability run hit. A detected plate is announced on stderr and via `--json`'s
new `plateDetected` field, so the caller is never silently shown a different image
than expected. A non-plate sprite (every character/item/scene in the bundled corpus,
parts included) is unaffected — `detectPlateFigure` returns `null` and the full
covered mask silhouettes byte-identical to before this amendment. Full rationale,
the two false-positive classes this closed, and the calibration evidence live in
[ADR-0085](0085-critique-command.md).
