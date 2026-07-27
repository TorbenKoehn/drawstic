# Runbook - General Backlog

Concrete backlog for agents. Work top-down unless a task explicitly says it is independent.
Material language or CLI decisions need an ADR in `docs/decisions/` before implementation.

**Read the status line under a heading before implementing it.** Sections 4-7 shipped in
2026-07; several of them were then reshaped by a later ADR, so the task text above a `Shipped`
line describes the original intent, not the current surface. Verify against the code before
touching anything here.

## Contents

- 4: context and lint.
- 5: small abstract std construction primitives.
- 6: drawing primitives and effects.
- 7: example and docs maintenance.
- 8: longer-term backlog.
- 9: additional improvements and fixes.
- Verification rule.

## 4. Context and lint

### 4.1 Extend `context`

**Shipped.** `context --json` carries `exports` plus per-drawing facts (`src/cli.ts` `buildBrief`).

- Add `exports` to the context brief:
  - source name
  - output base path
  - formats and scale flags
- Add cheap per-drawing authoring facts:
  - size source
  - local palette keys
  - large-drawing hint to use fitted preview
- Files: `src/cli.ts`, `src/ast.ts`, `docs/language-spec.md`, ADR-0008 update, `tests/unit/e2e.test.ts`.
- Done when `context --json` describes what `build` will write.

### 4.2 Add opt-in authoring lint

**Shipped.** `check --lint`, stable `W###` codes in `src/lint.ts`.

- Add `drawstic check <file> --lint`.
- Emit warnings, never failing the command:
  - unused local palette key
  - drawing is neither exported nor stamped
  - stamp is completely clipped outside canvas
  - large procedural drawing without fitted preview hint
- Files: new `src/lint.ts` or `src/eval.ts`, `src/cli.ts`, `src/diagnostic.ts`, `tests/unit/e2e.test.ts`.
- Done when warnings use stable `W###` codes and JSON shape.

### 4.3 Add row-width metadata

**Shipped.** `check --rows` (`src/cli.ts` `rowMetadata`).

- Add either `drawstic check <file> --rows` or include row metadata in `check --json` behind a flag.
- Emit for each `pixels:` block:
  - draw name
  - expected width and height
  - actual width per row
  - first ragged row, if any
- Do not mutate recipe source.
- Files: `src/parser.ts`, `src/cli.ts`, tests.
- Done when agents can repair row counts without manual character counting.

### 4.4 Improve `fmt --check --json`

**Shipped.** `fmt --check --json` diff metadata plus `--stdout` and `--diff`.

- Add formatter diff metadata:
  - first changed line
  - changed-line count
  - optional unified diff behind a flag if output size is a concern
- Consider `fmt --stdout` for canonical output without mutation.
- Files: `src/fmt.ts`, `src/cli.ts`, `tests/unit/fmt.test.ts`.
- Done when formatting failures are patchable from JSON.

## 5. Small abstract std construction primitives

### 5.1 Define std marks policy

- Keep std small and sleek.
- Do not add domain packs like `std/nature`, `std/vehicles`, or `std/weather`.
- Concrete motifs belong in `examples/`, `skills/`, and docs.
- Std may contain abstract marks that compose into many subjects.
- Write an ADR only if this becomes a formal std policy.

### 5.2 Add first generic mark set

**Shipped.** Nine marks in `src/std/shapes.drw.ts` (`spark`, `star4`, `dash`, `arcMark`, `zig`, `blob`, `capsule`, `leaf`, `tri`).

- Add roughly 8-12 generic drawings, not motif names.
- Candidate names:
  - `spark`
  - `star4`
  - `dash`
  - `arcMark`
  - `zig`
  - `blob`
  - `capsule`
  - `leaf`
  - `tri`
- Prefer parametric color only where it stays obvious: `spark(c)`, `dash(c)`, `leaf(c)`.
- Files: `src/std/shapes.drw` or new `src/std/marks.drw`, `src/std.ts` if new module, tests, docs examples.
- Done when examples compose cloud/bird/boat/foliage/wave patterns from abstract marks without adding those motifs to std.

## 6. Drawing primitives and effects

### 6.1 Add scoped shadow/cast-shadow support

**Shipped** as `shadow` (ADR-0070); `castShadow` was later removed as a duplicate spelling (ADR-0096 §1).

- Add an ADR first.
- Support local shadowing for regions or stamps, not only whole-frame `apply shadow`.
- Candidate syntax to decide in ADR:
  - `castShadow region dx:dy paint`
  - `shadow region dx dy paint`
  - `stamp part 10:10 shadow 2:3 #0005`
- Keep all shadow parameters explicit.
- Files: `docs/decisions/`, `docs/language-spec.md`, `src/parser.ts`, `src/ast.ts`, `src/eval.ts`, `src/raster.ts`, tests.
- Done when object-level shadows no longer require duplicating manual geometry.

### 6.2 Add deterministic texture filters

**Shipped** (ADR-0071, argument order unified in ADR-0080).

- Add deterministic, explicit texture commands before considering texture paints.
- Candidate filters:
  - `grain amount seed paint`
  - `speckle seed density paint`
  - `ripple seed strength paint`
  - `dither paintA paintB threshold`
- Seed must be explicit or come from an explicit `seed` directive.
- Files: `src/raster.ts`, `src/eval.ts`, docs, tests.
- Done when sand/water texture can be produced without per-pixel loops.

### 6.3 Design explicit local lighting helpers

**Shipped**, then largely superseded: `model`/`cel` + `material` is the canonical path (ADR-0086, ADR-0089, ADR-0091, ADR-0097). `ambientOcclusion` is now `ao` (ADR-0096 §2).

- Add an ADR first.
- Do not add hidden auto-lighting.
- Candidate helpers:
  - `shadeRegion region lightPoint base amount`
  - `rim region direction paint width`
  - `ambientOcclusion region paint amount`
- All light direction, amount, and color choices must be visible in the recipe.
- Files: ADR, spec, parser, AST, eval, raster, tests.
- Done when simple circle/rect fixtures pin deterministic highlights/shadows.

### 6.4 Add stamp anchors

**Shipped** (ADR-0072).

- Add an ADR first.
- Keep top-left stamp placement as default.
- Add explicit anchors:
  - `stamp boat 136:70 anchor bottom`
  - `stamp bird 88:18 anchor center`
- Pin odd/even rounding and interaction with scale, flip, rotation, and transforms.
- Files: parser, AST, eval, raster, spec, tests.
- Done when scene placement can use center/bottom anchors without manual offset math.

## 7. Example and docs maintenance

### 7.1 Add scene smoke tests

**Shipped.** `tests/unit/e2e.test.ts` renders and exports `examples/scenes-v3/island.drw`.

- Render selected examples and assert:
  - dimensions
  - non-background color count above a loose threshold
  - non-empty coverage bbox
  - expected export formats build
- Include `examples/scenes/island.drw`.
- Files: `tests/unit/e2e.test.ts`, `src/png.ts` decoder reuse.
- Done when visual regressions in representative scenes fail fast.

### 7.2 Fix docs/index drift

**Shipped.** `AGENTS.md` and `CLAUDE.md` name `src/diagnostic.ts`.

- Update project structure docs where they reference stale file names.
- Known drift: `AGENTS.md` mentions `src/diag.ts`; actual file is `src/diagnostic.ts`.
- Update `CLAUDE.md` too if it mirrors the same content.
- Done when navigation docs match real files.

## 8. Existing longer-term backlog

### 8.1 Layouts

- Grid and flow layouts for multiple drawables.
- Spacing, alignment, and relative sizing.

### 8.2 Text improvements

- Newline support.
- Text alignment.
- Baseline controls.
- Word/character wrapping.
- Overflow modes: clip, ellipsis, fade.
- Likely depends on layouts.

### 8.3 Coverage and tooling

- 100% test coverage target.
- Watch mode for CLI preview and exports.
- VSCode extension.
- Documentation website with interactive examples.

## 9. Additional Improvements and Fixes

### 9.1. Improve ASCII Preview

Right now ASCII-Mode (ie `bun drawstic render .\examples\scenes\island.drw#island --ascii`) uses palette color names to determine the char to be rendered, which leads to
sprites without palettes always rendering `?` for every pixel.

ASCII should rather use "color approximations", light calculating the lightness and selecting fitting pixels to approximate a somewhat real representation
of the image in grayscale. There should be no ANSI sequences in the output, it's a pure ASCII text.

Superseded/merged by `scene-dx-improvements.md` §3.1 — ramp now maps true sRGB relative luminance (alpha-composited over an implied black backdrop), fixing the ink-density inversion; implemented in `src/preview.ts`.

### 9.2. AA for Stamps and hand-drawn (`pixels:`) sprites

**Shipped.** Decided in ADR-0099 and implemented as the opt-in `aa` flag on `stamp` and `fit`:
a 16-tap filtered resampler that is byte-identical to nearest-neighbour on lattice transforms
(`W018` flags the no-op case). Feathering a silhouette at integer position was rejected there.
`pixels:` sprites are not a second mechanism; they are ordinary sprites and only differ under
a non-lattice transform.

### 9.3. Multiple `export`

**Shipped.** Decided in ADR-0098 and implemented: optional output path, comma-separated
targets, `dir` and a quoted `file` template with six inflectors (snake, camel, pascal, kebab,
upper, lower) and `\{` / `\}` escapes. Two deliberate cuts from the sketch below: `{ext}` and
`{full}` are gone because `file` renders a stem and the format line owns the extension (`E028`),
and date functions are gone because they break determinism. `plural`/`singular`/`title` were
rejected in the same ADR. The example corpus was rewritten onto the new form: 145 export
statements became 40 blocks with byte-identical artifact paths.

1. Allow omitting the file name to default to the recipe name, e.g. `export island` instead of `export island island`.
2. Allow export of multiple items separated with commas

  ```
  export pickaxe, axe, key:
    png @1 @2
  ```

  export pickaxe assets/pick-axe, axe assets/axe, key assets/key:
    png @1 @2
  ```
3. Add `dir` and `names` declarations to `export` block:
   
  ```
  export pickaxe, axe, key, coinPouch:
    dir "assets/items"
    file "{snake base}_{date YY-MM-DD}.{ext}"
    png

    # Yields:
    #  - assets/items/pickaxe_2024-06-01.png
    #  - assets/items/axe_2024-06-01.png
    #  - assets/items/key_2024-06-01.png
    #  - assets/items/coin_pouch_2024-06-01.png
    # Available variables inside `file`:
    #  - base: the name of the exported drawable (e.g. `pickaxe`, `axe`, `key`, `coinPouch`)
    #  - full: the full name of the exported drawable (e.g. `coinPouch.png`)
    #  - ext: the file extension of the exported drawable (e.g. `png`)
    # New functions:
    #  - Inflectors (snake, camel, pascal, kebab, upper, lower, title, plural, singular)
    #  - Dates (date, date YY-MM-DD, date YYYY-MM-DD, date YYYYMMDD)
    # New syntax:
    #  - String Interpolation (ie `"{a} and {upper b}"` yields `"test and TOAST"` if a="test" and b="toast")
    #  - String Escaping (ie `"{a} and \{b\}"` yields `"test and {b}"` if a="test" and b="toast"), but also common \n, \t, \\, \", etc.
  ```

Existing syntax is still possible:

```
export pickaxe assets/pick-axe:
  png @1 @2
```

## Verification rule

Every completed task must report real results from:

```sh
bun run format
bun run test
```
