# Runbook - Improvements from the Scene-DX Evaluation Report

> Status 2026-07-08: ALL TASKS COMPLETED. ADRs 0067–0079 landed (language version 2:
> pragma-gated `shadeRegion` veil-opacity, mask-respecting frame shadow, visual anchors;
> new primitives `curve`/`curvePoly`/`profile`; blocks `scatter`/`mirror`; `xs.cycle(i)`;
> CLI additions — render fragment args, `--grid`, `--diff`, extended `--inspect`; lint
> W005–W007; luminance `--ascii`; reserved-word/E004/E008 diagnostics; pal-namespace pixel
> cells; `docs/motif-cookbook.md`).

Derived from [docs/scene-dx-evaluation-2026-07-08.md](../../../../../docs/scene-dx-evaluation-2026-07-08.md)
(7-scene multi-agent LLM-authoring evaluation). Evidence tags like "7/7" = how many of the
seven graders hit the issue.

Rules: work tiers top-down (P1 → P5); within a tier, top-down. Material language/CLI
decisions need an ADR first (see `general-backlog.md` ground rule). **Every task that changes
language or CLI MUST update `skills/drawstic/SKILL.md` + `reference.md` in the same
change** (AGENTS.md §6).

## Contents

- P1: documentation precision.
- P2: diagnostics and lint.
- P3: CLI drawing aids for the visual loop.
- P4: language semantics fixes.
- P5: new constructs.

## P1 — Documentation precision (no ADR, cheapest, highest yield)

### 1.1 Document filter/light compositing semantics — ✅ done

- `shadeRegion r light base amount`: state that `base` is composited over the ENTIRE
  region (base alpha = veil opacity; opaque base repaints the region and erases detail),
  `amount` only scales the distance darkening toward black, and it acts on the current
  framebuffer regardless of paint order. (7/7 hit this; costliest bug of the evaluation.)
- `rim r dir p w`: give one worked direction example ("`0:1` lights the TOP edge").
- `ambientOcclusion`: describe as "1px inner-boundary stroke at paint alpha × amount".
- `dither a b t`: mark as **raw set, no blend**; warn against `alpha(0%)` partners
  (transparency holes) and note hard Bayer artifacts on small radial fills.
- `grain/speckle/ripple/dither` + frame `shadow`: state they hit ALL opaque framebuffer
  pixels; document the confinement idiom (part draw or `mask` block).
- New gotchas: curve primitives (`quad`/`bezier`/`arc`) below ~12px rasterize as blocks —
  use `pixels:`; `noise(seed, x, 0)` at integer steps is high-frequency — sample at
  `x * 0.05…0.1` for smooth silhouettes.
- Files: `skills/drawstic/SKILL.md`, `skills/drawstic/reference.md`,
  `docs/language-spec.md` (§ Filters), `docs/best-practices.md`.
- Done when: an author can predict the pixel effect of every filter/light helper from the
  shipped docs alone, without reading `src/raster.ts`.

### 1.2 Document the `use` grammar unambiguously — ✅ done

- `use <name>` (theme defined/imported in scope) vs. `use <module-path> <name>`
  (e.g. `use std/themes pixelBase`); make explicit that `themes` in existing examples is a
  *file name*, not a keyword. (3/6 agents hit E008 here.)
- Files: `skills/drawstic/SKILL.md`, `skills/drawstic/reference.md`, `docs/language-spec.md`.
- Done when: both forms appear side by side with a one-line difference statement.

### 1.3 Add a definition-scope table — ✅ done

- One table: `draw/path/fn/theme/tileset/atlas/export/filter` = module scope only;
  `mask/grad/pal/bindings` = module or drawing-local. (6/7 hit E004 on `path`/`fn`.)
- Files: `skills/drawstic/reference.md`, `docs/language-spec.md`; one gotcha line in SKILL.md.
- Done when: the scope of every definition kind is stated in one place.

### 1.4 Document the anchor × transform interaction — ✅ done

- Anchor points are mapped THROUGH the stamp transform: `anchor bottomLeft` + `flipx`
  lands visually bottom-RIGHT; add a worked reflection example (`flipy` mirror idiom).
  (2/7 silent misplacements.) Supersede if 4.5 lands.
- Files: `skills/drawstic/reference.md` (§ Transforms & stamp), `docs/language-spec.md`.

### 1.5 Motif cookbook — ✅ done

- Proven, copyable recipe snippets for the motifs every scene reinvented: palm/tree,
  cloud, water shimmer + foam bands, night lighting, water reflection, dune/hill profile,
  starfield/scatter. Keep std abstract (`general-backlog.md` §5.1 policy) — this is docs, not std.
- Files: new `docs/motif-cookbook.md` + index line in AGENTS.md §5; cross-link from
  `docs/best-practices.md`.
- Done when: the six recurring evaluation motifs have a tested snippet each.

## P2 — Diagnostics & lint (no ADR, small)

### 2.1 Reserved-word diagnostic — ✅ done

- `by = 3` currently yields `E004 "expected an expression, got '='"` pointing at `=`.
  Emit a dedicated message ("'by' is a reserved word — pick another name") anchored on the
  identifier, for the whole `RESERVED` set.
- Files: `src/parser.ts`, `src/diagnostic.ts`, `tests/unit/parser.test.ts`.
- Done when: every reserved word used as a binding name names itself in the message.

### 2.2 Better hints on E004/E008 — ✅ done

- E004 (fn/path scope): hint "move it to module scope, above the draw"; one clause on why
  `mask`/`grad` may stay drawing-local.
- E008 with first segment `themes`/`std`: hint "did you mean `use <name>` (local theme) or
  `use std/themes <name>` (bundled)?".
- Files: `src/eval.ts`/`src/parser.ts`, `src/diagnostic.ts`, tests.

### 2.3 New lint warnings — ✅ done

- W: `shadeRegion` with a fully opaque `base` ("opaque base repaints the whole region —
  give it alpha or call it before details").
- W: `dither` where a partner paint has alpha 0 ("raw set produces transparency holes").
- W: stamp whose bounding box is fully covered by a later opaque stamp/fill (arctic: fox
  vanished under igloo silently).
- Files: `src/lint.ts`, `src/cli.ts`, `docs/language-spec.md` (W-codes), `tests/unit/e2e.test.ts`.
- Done when: warnings carry stable `W###` codes and the three evaluation cases trigger them.

### 2.4 `render file#draw(args)` for parametric draws — ADR (small, CLI surface) — ✅ done (ADR-0067)

- E011 currently forces throwaway wrapper draws to preview parametric components
  (market: 6 components, repeated dance). Accept literal args in the fragment:
  `render parts.drw#house(#c04040, 3)`.
- Files: ADR, `src/cli.ts`, `src/eval.ts`, tests, skill/reference.
- Done when: any parametric draw renders standalone with literal args.

## P3 — CLI drawing aids for the visual loop

### 3.1 Fix `--ascii` ramp (extends `general-backlog.md` §9.1) — ✅ done

- Confirmed in practice: ramp reads as ink-density, not luminance — dark scenes invert
  (`@` = darkest), bright motifs vanish (5/7). Map by true luminance, keep pure ASCII.
  Also fixes `context` previews of bright sprites.
- Files: `src/preview.ts`, `src/inspect.ts`, tests; `general-backlog.md` §9.1 supersedes/merges.

### 3.2 `render --grid N` — ✅ done

- Debug-only coordinate overlay (lines every N px + edge labels) burned into the render
  output; never affects `build` exports. Evidence: agent hand-painted magenta marker lines
  to locate a placement error.
- Files: `src/cli.ts`, `src/preview.ts` or `src/raster.ts` (post-pass), tests, reference.md.
- Done when: `render file#d --png@4 --grid 8` shows labeled gridlines.

### 3.3 `render --diff <png> --json` — ✅ done

- Compare the fresh render against a previous PNG: changed-pixel count + changed bbox
  (+ optional per-region breakdown). Machine answer to "did my edit touch ONLY the sail?" —
  closes the gap between `check` = `[]` and a full image read.
- Files: `src/cli.ts`, `src/png.ts` (decoder reuse), tests, reference.md.
- Done when: an unrelated-region regression is detectable from JSON alone.

### 3.4 `--inspect` form-sanity stats — ✅ done

- Add per-palette-key opaque pixel share and per-named-mask bbox/coverage to
  `render --inspect --json`. Lets agents sanity-check composition without reading pixels;
  also note that `paletteCoveredPercent` is near-meaningless for procedural scenes today.
- Files: `src/inspect.ts`, `src/cli.ts`, tests, reference.md.

## P4 — Language semantics fixes (ADR each)

### 4.1 `shadeRegion` signature honesty — ✅ done (ADR-0068)

- Make `amount` the veil opacity (or add an explicit opacity param) instead of the current
  "base alpha = opacity, amount = distance-darkening" split. Breaking → gate on the
  `drawstic <N>` version pragma. Pair with 1.1 either way.
- Files: ADR, spec, `src/eval.ts`, `src/raster.ts`, tests, skill/reference.

### 4.2 Additive light helper — ✅ done (ADR-0069)

- `lightRegion r lightPt paint amount` — distance-scaled brightening toward a light color;
  counterpart to the darken-only `shadeRegion`. Warm light is currently faked with masked
  gradients + `rim` (volcano, island).
- Files: ADR, spec, parser/AST/eval/raster, tests, skill/reference.

### 4.3 Unify the three `shadow` surfaces — ✅ done (ADR-0070)

- stamp-flag `shadow dx:dy p`, frame filter `shadow 1 1 k`, and `castShadow r dx:dy p`
  have three signatures for one concept (orbit had to read source for arg order). Align
  argument order/shape; keep aliases one release if needed.
- Files: ADR, spec, parser/eval/raster, tests, skill/reference.

### 4.4 Region-scoped texture filters — ✅ done (ADR-0071)

- `grain [r] amount seed p` (likewise speckle/ripple/dither) — optional leading region,
  consistent with `castShadow`. Removes the part-draw detour for "grain only the sand".
- Files: ADR (extends ADR-0062), spec, parser/eval/raster, tests, skill/reference.

### 4.5 Visual anchors — ✅ done (ADR-0072)

- Resolve `anchor` names against the TRANSFORMED stamp result (or add an `anchor visual`
  variant): `bottom` must mean the visible bottom-center after flip/rot/scale. Fixes the
  silent anchor×flip misplacement class (market, desert).
- Files: ADR (revises ADR for stamp anchors), spec, eval/raster, tests, skill/reference.

### 4.6 Defuse identifier collisions — ✅ done (ADR-0073)

- Pixel-row cells resolve ONLY pal keys (separate namespace), making `w`/`h` legal keys —
  4/6 agents hit E007 despite the documented gotcha (w=white/window is the natural
  mnemonic). Evaluate unreserving `by` (ADR-0061 leftover) at the same time.
- Files: ADR, spec, lexer/parser/eval, tests, skill/reference.

## P5 — New constructs (ADR each; biggest drawing levers)

### 5.1 `curve` — through-points spline — ✅ done (ADR-0074)

- `curve <paint> <pt1> <pt2> <pt3> … [w<N>]` (Catmull-Rom through the given points).
  LLMs reason "the line passes through these points", not in bezier control points —
  dunes, hills, waves, fronds become one predictable line. Highest-impact new primitive.
- Files: ADR, spec, parser/AST/eval/raster (deterministic tessellation), tests, skill/reference.

### 5.2 Closed curve region — `curvePoly` — ✅ done (ADR-0075)

- `curvePoly <paint> <pt1> … [fill]`, plus paintless call → Region. Fills the organic-mass
  gap (`bezier`/`quad` cannot fill; desert produced "wire-tangle" palms) and replaces
  ellipse-stacking for clouds/foliage/rocks.
- Files: ADR (pairs with 5.1), spec, parser/eval/raster, tests, skill/reference.

### 5.3 `profile` — filled function silhouette — ✅ done (ADR-0076)

- Draw the filled area under `y = f(x)` across a span, with a built-in sane sampling
  convention. Replaces the per-column noise loop every scene hand-rolled and neutralizes
  the noise-frequency trap by design.
- Candidate: `profile <paint> <x0>..<x1> <fnName> [fill]` (fn gets normalized x).
- Files: ADR, spec, parser/eval/raster, tests, skill/reference.

### 5.4 `scatter` block — ✅ done (ADR-0077)

- `scatter <n> <seed> <region>:` + body executed n times with seeded point binding —
  stars, bubbles, gravel, sparks appeared in 7/7 scenes as a manual for+rand+floor+range
  dance. Deterministic by explicit seed, like `rand`/`noise`.
- Files: ADR, spec, parser/AST/eval, tests, skill/reference.

### 5.5 `mirror` block — ✅ done (ADR-0078)

- `mirror x=<n>:` (and `y=<n>`) — execute body statements and their mirrored copies.
  Symmetry currently exists only per-stamp (`flipx`), not for procedural passages.
- Files: ADR, spec, parser/eval, tests, skill/reference.

### 5.6 Ramp cycling (minor) — ✅ done (ADR-0079)

- `xs.cycle(i)` (auto-wrapping index) or equivalent sugar for `xs[i mod len(xs)]` —
  reduces off-by-one risk in procedural ramp access (volcano #5).
- Files: ADR-light (stdlib addition), `src/eval.ts`/`src/dmath.ts`, tests, reference.md.
