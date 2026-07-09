# Runbook - Agent Authoring Improvements

This plan captures concrete improvements from authoring `examples/scenes/island.drw`.
The focus is not a broader feature wishlist, but changes that make Drawstic easier for
LLM agents to write, verify, and correct.

## Contents

- P0: pixel-row diagnostics and palette-name guidance.
- P1: preview scaling, lint, inspect, render JSON, render target diagnostics, check collection,
  context expansion, std marks, local ramps, scoped shadows, texture filters.
- P2: lighting helpers, stamp anchors, segment sugar, row-width side channel, formatter feedback,
  example smoke tests, render crop, docs drift.
- Acceptance order and verification commands.

## P0 - Fix misleading `pixels:` size diagnostics

Problem: When a `pixels:` block has inconsistent row lengths, `check` reports only the
first row width, e.g. `pixels block is 18x8, header says 18x8`, even when later rows are
shorter. That message is technically tied to the first row, but it gives the agent no
actionable row index.

Solution:
- Split `E002` into two message shapes while keeping the stable code:
  - header mismatch with uniform rows:
    `pixels block is 17x8, header says 18x8`
  - ragged rows:
    `pixels row 3 is 17 wide; expected 18`
- Point the diagnostic span at the offending row, not the `pixels:` keyword.
- Add `hint` with the local expected width and actual width.

Implementation:
- `src/eval.ts`: refine `#resolveDrawSize`.
- `src/diagnostic.ts`: no new code is required unless a helper is useful.
- `tests/unit/eval.test.ts`: add ragged-row tests with exact line/column expectations.

LLM value: The agent can repair one row at a time without re-counting every sprite row.

## P0 - Reserve-name guidance for palette collisions

Problem: Palette keys are single letters, but `w` and `h` collide with built-in canvas
bindings. The current error says the key collides with a visible non-palette binding, but
does not tell the agent which letters are unsafe or which replacement pattern is idiomatic.

Solution:
- Keep the hard collision rule.
- Add targeted hints for built-ins:
  - `palette key 'w' collides with canvas width; use another single-letter key, e.g. 'v'`
  - `palette key 'h' collides with canvas height; use another single-letter key, e.g. 't'`
- Document the reserved one-letter bindings near the palette rule.

Implementation:
- `src/eval.ts`: where palette collisions are raised, detect visible built-ins.
- `docs/language-spec.md`: add a short note in sections 7 and 12 that `w` and `h` are visible canvas
  bindings and therefore poor palette keys inside drawings.
- `tests/unit/eval.test.ts`: assert diagnostics and hints.

LLM value: The correction is local and deterministic; agents stop retrying with other
reserved or confusing keys.

## P1 - Add compact preview scaling

Problem: `render --preview` is useful for small drawings but too verbose for a 160x96 scene.
The ANSI output floods the terminal and becomes harder to inspect than a PNG.

Solution:
- Add a lossy preview downscale option:
  - `drawstic render file.drw#name --preview --fit 80x40`
  - optional shorthand: `--preview80` if benchmarks show it is worth the parser cost.
- Downscale in framebuffer space before ANSI conversion using deterministic nearest or
  box sampling. Use nearest for pixel-faithful inspection; add box only if we need a second
  explicit mode later.
- Preserve current `--preview` behavior when no fit is provided.

Implementation:
- `src/cli.ts`: parse `--fit WxH` for `render`.
- `src/preview.ts`: add `fitSpriteForPreview(sprite, maxW, maxH)`.
- `tests/unit/e2e.test.ts` or new preview unit tests: assert dimensions and deterministic
  output.
- `docs/language-spec.md` and ADR-0031 follow-up: document the CLI surface if accepted.

LLM value: Agents can inspect large procedural scenes in text without generating a PNG or
needing multimodal review.

## P1 - Add `check --lint` authoring warnings

Problem: `check` correctly validates renderability, but several authoring mistakes are
valid and still suspicious for LLM output: unused palette entries, hidden/off-canvas stamps,
huge previews, or sprites with no export and no inbound stamp.

Solution:
- Add opt-in warnings under `drawstic check <file> --lint`.
- Initial warning set:
  - unused local palette key
  - drawing is neither exported nor stamped
  - stamp is completely clipped outside the canvas
  - procedural drawing larger than a preview-friendly threshold, with hint to use `--fit`
- Warnings must not fail the command, matching ADR-0030.

Implementation:
- `src/cli.ts`: parse `--lint`.
- `src/eval.ts` or a new `src/lint.ts`: analyze resolved module/draw metadata.
- `src/diagnostic.ts`: add stable `W###` codes.
- `tests/unit/e2e.test.ts`: assert warning JSON shape.

LLM value: Agents receive non-fatal feedback that catches likely visual omissions before the
user sees the asset.

## P1 - Add `render --inspect` machine-readable image summary

Problem: The agent can render and visually inspect PNGs, but there is no compact structured
summary for non-visual self-checks. `context` describes definitions; it does not describe
the rendered framebuffer.

Solution:
- Add `drawstic render file.drw#name --inspect --json`.
- Emit a stable object with:
  - width, height
  - distinct color count
  - alpha coverage bbox
  - opaque/transparent pixel counts
  - palette artifact order
  - optional coarse color bands or 8x8 occupancy grid
- Keep it render-derived, not source-derived.

Implementation:
- `src/cli.ts`: add render flag handling.
- New `src/inspect.ts`: pure framebuffer summarizer.
- `tests/unit/e2e.test.ts`: assert deterministic summaries.
- `docs/language-spec.md`: document under CLI surface if accepted.

LLM value: Agents can detect blank renders, clipped drawings, missing alpha, and palette
explosions without OCR or image viewing.

## P1 - Make successful preview renders JSON-addressable

Problem: `--json` is useful for diagnostics, but successful `render --ascii` and
`render --preview` still emit raw text/ANSI only. Agents then need separate parsing rules
for success and failure.

Solution:
- With `--json`, successful render preview commands should emit:
  - `diagnostics: []`
  - `render.drawing`, `render.width`, `render.height`, `render.kind`
  - `render.output` for ASCII or ANSI preview text
  - `render.stats` with at least color count and palette coverage
- Preserve current stdout behavior without `--json`.
- For `--ascii`, include unknown-pixel facts:
  - `unknownPixelCount`
  - `unknownColorCount`
  - `paletteCoveredPercent`
- In non-JSON human mode, print a short warning when ASCII output contains many `?`
  pixels.

Implementation:
- `src/cli.ts`: change successful render JSON branch.
- `src/preview.ts`: return preview text plus coverage stats instead of only a string.
- `src/diagnostic.ts`: add warning code if warnings are emitted in human mode.
- `tests/unit/e2e.test.ts`: assert JSON shape for `--ascii --json` and `--preview --json`.
- ADR-0031/spec: document that preview output has a structured JSON surface.

LLM value: Agents get one stable machine-readable contract for both failure and success.

## P1 - Improve render target diagnostics

Problem: Typos like `file.drw#islnad` currently become generic CLI/runtime failures. The
agent needs the available drawing names and a stable code to recover.

Solution:
- Malformed render targets get a stable CLI syntax diagnostic with a hint:
  `use <file>#<drawing>`.
- Unknown drawing targets use `E001` or a dedicated stable code with:
  `hint: available drawings: cloud, smallCloud, bird, boat, shell, starfish, island`.
- Keep positions at `1:1` only if no better target span exists; otherwise point at the
  drawing-name slice after `#`.

Implementation:
- `src/cli.ts`: replace generic `Error` throws in `runRender`.
- `src/diagnostic.ts`: add stable CLI syntax code if needed.
- `tests/unit/e2e.test.ts`: assert JSON diagnostics for malformed target and typo target.

LLM value: A misspelled render target becomes a one-step correction instead of a manual
source inspection loop.

## P1 - Collect independent check diagnostics after parse

Problem: `check` stops at the first thrown semantic/render error. For a file with several
independent sprites, agents must fix errors serially.

Solution:
- Keep lex/parse fail-fast.
- After a valid parse, validate/render independent top-level drawings, tilesets, atlases,
  and exports in isolation and collect all diagnostics that can be collected safely.
- Avoid duplicate cascades from the same root cause by tagging each diagnostic with the
  entry being checked internally.

Implementation:
- `src/cli.ts`: adjust `runCheck` collection loop.
- `src/eval.ts` and `src/build.ts`: ensure failures do not poison later independent checks.
- `tests/unit/e2e.test.ts`: fixture with two bad independent drawings should emit two
  diagnostics.

LLM value: Agents can batch-fix obvious errors instead of running repeated check/repair
cycles.

## P1 - Extend `context` with export and authoring facts

Problem: `context` lists drawings, functions, and theme facts, but does not show export
targets or enough per-drawing authoring metadata. For `island.drw`, an agent cannot see from
context that `island` exports PNG and SVG.

Solution:
- Add `exports` to the context brief:
  - source drawing/tileset/atlas name
  - output base path
  - formats and scale flags
- Add per-drawing facts where cheap:
  - size source: header, pixels, theme/module default
  - local palette keys
  - large-drawing flag with hint to use fitted preview

Implementation:
- `src/cli.ts`: extend `buildBrief`.
- `src/ast.ts`: expose/export format facts already parsed.
- `tests/unit/e2e.test.ts`: assert context JSON includes exports and size source.
- ADR-0008/spec: document the expanded brief.

LLM value: Agents get a better planning surface before rendering or editing a recipe.

## P1 - Add small abstract std construction primitives

Problem: `std/shapes` currently contains only `arrow` and `dot`. During scene authoring, the
pain was not that Drawstic lacked an island, cloud, boat, or palm library. Adding concrete
motifs would make the shipped library feel larger and more opinionated. The real gap is a
tiny set of abstract, reusable building blocks that help agents construct many motif types
without hand-counting the same geometric patterns over and over.

Principles:
- Keep `std` small and sleek. Do not add domain packs like `std/nature`, `std/vehicles`, or
  `std/weather` unless repeated evidence proves they are broadly useful.
- Prefer abstract parts that combine into many subjects over named real-world motifs.
- Prefer parametric drawings with one to three obvious parameters over many fixed variants.
- Keep the language surface unchanged where a std recipe can solve the problem.
- Concrete motifs belong in `examples/`, `skills/`, or documentation patterns, not the core
  std package.

Candidate abstract primitives:
- `tri(c)` / `triFill(c)` in small fixed sizes: sails, leaves, arrows, mountains, fins,
  pennants, sparkle points.
- `arcMark(c)` or `curveMark(c)`: birds, waves, smiles, motion strokes, distant silhouettes.
- `dash(c, len)` or a few fixed dash drawings: water highlights, ground texture, horizon
  marks, stitching, speed lines.
- `blob(c)` / `blob2(c)`: cloud lobes, stones, foliage clusters, foam, bushes, smoke.
- `leaf(c)` as an abstract tapered lozenge, not a palm-specific leaf: plants, feathers,
  flames, grass clumps, decorative strokes.
- `spark(c)` / `star4(c)`: sun glints, stars, sand highlights, magic effects.
- `capsule(c)` or `pill(c)`: boats, logs, rounded shadows, clouds, UI marks.
- `shadowOval(c)` as a tiny soft-edged pixel sprite or parametric ellipse wrapper if std
  drawings can express it cleanly.

Better std shape direction:
- Add a very small `src/std/marks.drw` or extend `src/std/shapes.drw`.
- Group by geometric role, not subject matter:
  - point marks: `dot`, `spark`, `star4`
  - line marks: `dash`, `arcMark`, `zig`
  - mass marks: `blob`, `capsule`, `leaf`, `tri`
- Keep names generic enough that agents are not nudged into one visual domain.
- Avoid adding more than roughly 8-12 primitives in the first pass.

Potential recipe examples outside std:
- `docs/dsl-examples.md`: show how abstract marks compose into cloud, bird, boat, foliage,
  fire, mountain, and wave patterns.
- `examples/scenes/`: keep concrete scenes as examples, not bundled primitives.
- `skills/draw-image/`: teach agents composition patterns such as "cloud = 3 blobs + flat
  underside" or "boat = capsule + tri sail + shadow dash".

Implementation:
- Decide whether this needs an ADR. If only std recipe content changes, a short docs note
  may be enough; if new naming policy for std is adopted, record it.
- Add or extend `src/std/shapes.drw` with the first small set of generic marks.
- Register a new std module in `src/std.ts` only if splitting from `shapes` materially
  improves discoverability.
- Add context/import tests proving agents can `from std/shapes leaf, dash`.
- Add example recipes that build concrete motifs from abstract marks without adding those
  motifs to std.

LLM value: Agents get a compact visual vocabulary that lowers pixel-counting and geometry
boilerplate, while Drawstic stays a small deterministic drawing language rather than a clip
art library.

## P1 - Support explicit local color ramps, not std palettes

Problem: The scene needed many related colors: base, dark, light, foam, haze, trunk, grass,
sand, and sea variants. A bundled `std/palettes` module or lighting-oriented preset themes
would solve some token cost, but it would also bias agents toward the same few looks. That
works against project-specific art direction and could make Drawstic images feel too
similar.

Current idiom:
- The basic local form already works and should remain the first recommendation:
  - `pal a=#cccccc b=a.lighten(10%) c=b.lighten(10%)`
  - `pal a=#68bff0 b=a.darken(12%) c=a.lighten(14%)`
- This is explicit, local, deterministic, and easy to read.
- For procedural shapes, prefer semantic plain bindings instead of palette keys:
  - `sand = #e9bd72`
  - `sandDark = sand.darken(14%)`
  - `sandLite = sand.lighten(12%)`
- Use `pal` only when a color must be a pixel key, be part of the authored palette artifact,
  or participate in indexed/sprite palette ordering.

Concern:
- The real friction is not choosing colors; that should stay project-local.
- The friction is generating and assigning many related single-letter `pal` keys when a
  pixel sprite needs a small ramp.
- The 52-key limit is still good. If a single drawing needs too many palette letters, the
  idiomatic answer remains decomposition into stamped parts with their own local palettes.

Possible solution A: document the existing ramp idiom.
- Add examples showing sequential `pal` derivation with `lighten`, `darken`, `mix`, and
  method-style calls.
- Explain when to use plain semantic bindings instead of palette entries.
- This may be enough; implement before adding syntax.

Possible solution B: add pure color ramp helpers, not palettes.
- Add small stdlib functions that return colors or color lists:
  - `tone(base, amount)` as an alias-like semantic wrapper around light/dark adjustment only
    if it improves readability.
  - `tones(base, -12%, 0%, 12%)` returning a list of adjusted colors.
  - `mixes(a, b, 4)` returning evenly spaced colors between two explicit endpoints.
- These helpers do not choose a palette. The recipe still supplies all base colors.

Possible solution C: add `pal` destructuring for explicit key assignment.
- Extend block-form `pal` to allow list destructuring:
  - `a, b, c = tones(#cccccc, -12%, 0%, 12%)`
  - `s, t, u, v = mixes(#116a96, #e9fbff, 4)`
- The keys remain explicit. There is no hidden key generation and no std look.
- The RHS must evaluate to exactly as many colors as keys.
- This reuses the language's existing destructuring concept, but inside the palette artifact
  channel.

Syntax to avoid for now:
- `pal ramp a..f = #cccccc`: too magical; it hides key choice and introduces range/key
  generation rules.
- `use std/themes tropicalDay`: too style-prescriptive for the core library.
- Ambient palette defaults from theme text or lighting state.

Implementation:
- Phase 1: documentation only.
  - `docs/dsl-examples.md`: add local ramp examples.
  - `docs/language-spec.md`: clarify `pal` versus plain color bindings.
- Phase 2, only if examples show real pain:
  - ADR for `pal` destructuring and/or color-list helpers.
  - `src/parser.ts`, `src/ast.ts`, `src/eval.ts`: support destructuring in block-form `pal`.
  - `src/eval.ts`: add pure color-list helpers if accepted.
  - Tests for exact arity, non-color RHS elements, palette artifact order, and indexed PNG
    behavior.

LLM value: Agents can build coherent local ramps without inheriting a house style. Color
choice stays explicit and project-based; only repetitive ramp assignment gets lighter.

## P1 - Add scoped shadow and cast-shadow helpers

Problem: The built-in `shadow` filter is useful, but it applies to the current framebuffer.
For the island scene, object shadows were easier to draw manually with ellipses and darker
polygons than to isolate every object into its own drawing just to apply a shadow.

Solution:
- Add a scoped shadow primitive or filter form that works on a region or stamp:
  - `castShadow region dx:dy paint`
  - or `shadow region dx dy paint`
  - or `stamp palm 40:20 shadow 2:3 #0005`
- Keep the effect deterministic and explicit: no automatic light detection.
- Prefer region/stamp-local forms over whole-frame filters for object composition.

Implementation:
- `docs/language-spec.md` and ADR before implementation; this changes command surface.
- `src/parser.ts`, `src/ast.ts`, `src/eval.ts`, `src/raster.ts`.
- Tests for region shadow, stamp shadow, clipping, alpha compositing, and SVG behavior if
  applicable.

LLM value: Agents can add depth to scenes with one local command instead of fragile manual
duplicate geometry.

## P1 - Add deterministic texture paints or texture filters

Problem: Seeded `noise(seed, x, y)` exists and is deterministic, but it is awkward for
actual artwork. To make sand grain or water shimmer, an agent must write per-pixel loops
with `px`, threshold logic, and manually chosen colors. That is verbose and budget-heavy for
large scenes.

Solution:
- Add texture paints or filters that stay explicit and deterministic:
  - `grain amount seed paint`
  - `speckle seed density paint`
  - `ripple seed strength paint`
  - `dither paintA paintB threshold/noise`
- Allow them as filters first; later consider first-class texture paints if the model stays
  simple.
- Make seed mandatory or inherited only from an explicit `seed` directive.

Implementation:
- `src/raster.ts`: texture/filter implementations over framebuffer or mask.
- `src/eval.ts`: filter command evaluation.
- `docs/language-spec.md`: clarify deterministic seeds and budget behavior.
- Tests for determinism, bounds, and stable output bytes.

LLM value: Agents can create rich surfaces with short, auditable commands instead of long
procedural loops.

## P2 - Add local lighting helpers without hidden auto-lighting

Problem: Auto-lighting would be useful, but a fully automatic light model would cut against
Drawstic's deterministic, inspectable recipe style. The missing piece is not hidden lighting;
it is concise, explicit lighting composition.

Solution:
- Add explicit light helpers:
  - `lightSource 120:16 #fff6 20` as a local binding or directive only if it remains visible
    in context.
  - `shadeRegion region lightPoint base amount`
  - `rim region direction paint width`
  - `ambientOcclusion region paint amount` if implemented as a deterministic edge/coverage
    filter.
- Prefer commands that operate on regions or stamps and produce normal framebuffer edits.
- Do not infer material, light direction, or shadow strength implicitly from theme text.

Implementation:
- Write an ADR first; this is a material semantic addition.
- Likely files: `docs/decisions/`, `docs/language-spec.md`, `src/parser.ts`, `src/ast.ts`,
  `src/eval.ts`, `src/raster.ts`.
- Tests must pin output on simple circles/rects.

LLM value: Agents get depth and consistency while recipes remain explainable and editable.

## P2 - Add placement anchors for stamps

Problem: `stamp` positions by top-left. That is exact and simple, but for scene composition
an agent often thinks in center/baseline positions: sun center, boat baseline, bird center,
object foot on ground. Manual offset math is easy to get wrong.

Solution:
- Add explicit anchor flags:
  - `stamp boat 136:70 anchor bottom`
  - `stamp bird 88:18 anchor center`
  - or `stampAt center boat 88:18`
- Keep top-left as the default.
- Define anchors in sprite-local integer coordinates and pin rounding.

Implementation:
- ADR/spec update before implementation.
- `src/parser.ts`, `src/ast.ts`, `src/eval.ts`, `src/raster.ts`.
- Tests for odd/even sprite sizes, scale, flip, rotation, and transform composition.

LLM value: Agents can place composed parts in scene coordinates instead of doing repeated
width/height offset calculations.

## P2 - Add simple segment/polyline sugar

Problem: `line` is cursor-based and `poly paint a b` is the current explicit-segment idiom.
That works, but LLMs naturally try to draw a segment with two points. For waves, birds, and
small marks, a direct segment command would be clearer.

Solution:
- Consider a minimal explicit segment command:
  - `seg a b paint [wN]`
  - or `line a b paint` only if it does not break the existing cursor-line model.
- Prefer `seg` if added; it keeps `line` semantics stable and avoids overload ambiguity.
- Benchmark token cost against `poly k a b`.

Implementation:
- ADR/spec update because this adds a primitive.
- `src/parser.ts`, `src/ast.ts`, `src/eval.ts`, `src/raster.ts`.
- Tests for cursor non-movement and equivalence to `poly paint a b`.

LLM value: Reduces accidental cursor bugs and makes small scene marks more direct.

## P2 - Add a row-width side channel to `fmt --check`

Problem: For hand-authored pixel sprites, the formatter preserves rows but does not help
count them. Agents repeatedly miscount long rows by one character.

Solution:
- Add `drawstic fmt <file> --check --rows` or `drawstic check <file> --rows`.
- Emit machine-readable row metadata for every `pixels:` block:
  - draw name
  - expected width and height
  - actual width per row
  - first ragged row, if any
- Do not modify source and do not introduce comments into recipes.

Implementation:
- `src/parser.ts`: parser already stores row text and spans.
- New small CLI path in `src/cli.ts`, or integrate into `check --json` as optional context.
- Tests around row metadata and no source mutation.

LLM value: Gives exact counting feedback while keeping recipes clean and token-efficient.

## P2 - Improve formatter check feedback

Problem: `fmt --check --json` tells agents the file is not formatted, but not where the
first relevant difference is.

Solution:
- Keep `fmt` write behavior unchanged.
- Add JSON metadata for `fmt --check --json`:
  - first changed line
  - changed-line count
  - optional unified diff, behind a flag if output size is a concern
- Consider `fmt --stdout` for agents that want the canonical text without mutating files.

Implementation:
- `src/fmt.ts`: expose diff metadata from canonicalization.
- `src/cli.ts`: emit metadata in the diagnostic `hint` or structured context.
- `tests/unit/fmt.test.ts`: assert line/count metadata.

LLM value: Formatting failures become patchable without dumping and comparing whole files.

## P2 - Add optional PNG artifact smoke check to examples

Problem: The project tests cover examples broadly, but a newly added scene can pass syntax
and still be visually blank, fully clipped, or missing its intended export.

Solution:
- Add a focused example smoke helper that renders selected examples and asserts:
  - output dimensions
  - non-background color count above a threshold
  - non-empty alpha/coverage bbox
  - expected export formats build
- Keep thresholds loose and deterministic.

Implementation:
- `tests/unit/e2e.test.ts`: add `examples/scenes/island.drw` render/build smoke.
- Reuse PNG decoder from `src/png.ts`.

LLM value: Gives future agents a fast regression signal for representative scene recipes.

## P2 - Add render crop for local visual debugging

Problem: Debugging a small bad area inside a procedural scene requires rendering the whole
canvas. Large previews are noisy, and PNG inspection may hide exact local pixel structure.

Solution:
- Add `drawstic render file.drw#name --crop x:y WxH`.
- Allow crop with `--preview`, `--ascii`, `--inspect`, PNG output, and JSON output.
- Clip crop bounds deterministically and report the final crop rectangle in JSON.
- Treat `--trace-pixel x:y` as a later separate feature; it needs instrumentation across
  raster operations and should not block crop.

Implementation:
- `src/cli.ts`: parse crop point and size.
- `src/framebuffer.ts` or new helper: crop RGBA data.
- `src/preview.ts` / `src/inspect.ts`: operate on cropped sprite data.
- `tests/unit/e2e.test.ts`: assert cropped dimensions and deterministic preview.

LLM value: Agents can inspect or summarize exactly the area they just changed.

## P2 - Fix documentation/index drift

Problem: `AGENTS.md` lists `src/diag.ts`, but the actual file is `src/diagnostic.ts`.
This is small, but agents use that file as the first navigation map.

Solution:
- Update the project structure index to match real files.
- Add a tiny docs consistency test only if more drift appears.

Implementation:
- `AGENTS.md` and `CLAUDE.md` if it mirrors the same content.

LLM value: Reduces wasted lookup steps and failed file reads during debugging.

## Acceptance order

1. Implement P0 diagnostics first. They are small, low-risk, and improve every correction
   loop.
2. Implement compact preview next. It directly addresses the large-scene authoring gap.
3. Add `--inspect` and `--lint` once the diagnostic vocabulary is settled.
4. Add example smoke coverage and docs drift cleanup as follow-up maintenance.

Every item should be verified with:

```sh
bun run format
bun run test
```
