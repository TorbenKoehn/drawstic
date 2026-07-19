# Architecture Decision Records

Material decisions for Drawstic, in [MADR](https://adr.github.io/madr/)-lite form.
Newest decisions supersede older ones explicitly. When you make a material decision,
add an ADR here and reflect it in [AGENTS.md](../../AGENTS.md) and the affected docs.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-framebuffer-first-core.md) | Framebuffer-first rendering core | Accepted |
| [0002](0002-hybrid-primitives-and-indexed-palette.md) | Hybrid primitives + indexed single-char palette | Accepted |
| [0003](0003-themes-as-style-guides.md) | Themes are style guides (machine + LLM dual artifact) | Accepted |
| [0004](0004-total-not-turing-complete.md) | Total language, not Turing-complete (runtime budget) | Accepted |
| [0005](0005-theme-composition-by-fold.md) | Theme composition by ordered fold, not inheritance | Accepted (refined by 0081) |
| [0006](0006-modules-and-content-output-separation.md) | Modules: all public; content/output separation (`export`) | Accepted |
| [0007](0007-visual-not-byte-determinism.md) | Visual (pixel) determinism, not byte determinism | Accepted (refined by 0027, 0028, 0029) |
| [0008](0008-cli-design-brief.md) | CLI design brief (`context`) for agent ergonomics | Accepted (refined by 0030, 0031) |
| [0009](0009-first-class-colours-gradients-filters.md) | First-class colours, gradients & filters (supersedes 0002 colour model) | Accepted (1-bit part superseded by 0025; residual resolved by 0033) |
| [0010](0010-ufcs-method-style-calls.md) | UFCS — method-style calls (`x.f(a)` ≡ `f(x, a)`) for readable composition | Accepted |
| [0011](0011-cursor-and-relative-motion.md) | The cursor and `to`/`by` relative motion (no relative-point literal) | Superseded by 0061 |
| [0012](0012-masks-and-path-combination.md) | Masks & path combination as coverage buffers (UFCS set-ops) | Accepted |
| [0013](0013-render-mode-pixel-vs-aa.md) | Render mode (pixel vs AA): theme default + export override | Accepted |
| [0014](0014-token-efficiency-bench-suite.md) | Token-efficiency bench suite (proxy metrics + GPT-BPE devDep) | Accepted |
| [0015](0015-unified-call-model.md) | Unified call model: one call, two surfaces; no list bracket | Accepted |
| [0016](0016-tilesets-and-atlases.md) | Tilesets & atlases: bake drawings into one image + sidecar export | Accepted |
| [0017](0017-punctuation-carries-meaning.md) | Punctuation must carry meaning; `=` marks a binding | Accepted (refined by 0018) |
| [0018](0018-idiom-alone-does-not-justify-a-marker.md) | Idiom alone never justifies a marker; in-distribution is a tiebreaker; one block style (drops `from`/`in`/inline-`{}`) | Accepted |
| [0019](0019-source-first-module-references.md) | Source-first module refs (`from path names`); bareword `/`-paths, no quotes/extension, incl. `use`/`export` | Accepted (refined by 0035) |
| [0020](0020-cursor-line-and-by-point-operator.md) | `line` is cursor-only; `by` is a point operator; `to` removed; two-point `line` → `poly`/`move` | Superseded by 0061 |
| [0021](0021-optional-canvas-size-resolution.md) | Canvas size optional (header/grid/`size`-default resolution); `WxH` stays literal | Accepted (refines 0003) |
| [0022](0022-text-and-bitmap-fonts.md) | Text rendering via bundled deterministic bitmap fonts | Accepted (user fonts specified by 0042) |
| [0023](0023-curve-and-shape-primitives.md) | Curve & shape primitives (`ellipse`/`arc`/`quad`/`bezier`/`rrect`); stroke width `w<N>` | Accepted |
| [0024](0024-parametric-drawings.md) | Parametric drawings `draw name(p…)` & recolor-on-stamp (`tint`) | Accepted |
| [0025](0025-alpha-compositing-model.md) | Alpha compositing (straight-alpha RGBA8 source-over) | Accepted (supersedes 1-bit part of 0009) |
| [0026](0026-seeded-randomness-and-noise.md) | Seeded randomness & value noise (`rand`/`noise`) | Accepted |
| [0027](0027-deterministic-numeric-and-colour-pipeline.md) | Deterministic numeric & colour pipeline (bundled math; pinned conversion) | Accepted (refines 0007) |
| [0028](0028-rasterization-semantics.md) | Rasterization semantics (flood/clip/centering/endpoints) | Accepted (outline refined by 0039; circle parity superseded by 0056; ellipse parity superseded by 0087) |
| [0029](0029-language-version-pragma.md) | Language version pragma `drawstic <N>` | Accepted (refines 0007; version-gating superseded by 0088 — pragma parsed but inert) |
| [0030](0030-structured-diagnostics-contract.md) | Structured diagnostics contract (`--json`) | Accepted (refines 0008; `C###` family added by 0085) |
| [0031](0031-agent-loop-cli-preview-and-fmt.md) | Agent-loop CLI: `render --ascii/--preview` + `drawstic fmt` | Accepted |
| [0032](0032-lexical-robustness.md) | Lexical robustness (indentation, line continuation, grid rules) | Accepted (pixel-key charset pinned by 0049) |
| [0033](0033-evaluation-and-scope-model.md) | Evaluation & scope model; paint-vs-expression name resolution | Accepted (resolves open Q8/Q9; point 5 superseded by 0046; scope/mutability refined by 0081) |
| [0034](0034-standard-library.md) | Standard library — fixed total built-in set | Accepted (resolves open Q10) |
| [0035](0035-import-sandbox-and-std-modules.md) | Import sandbox, cycle policy, bundled `std/` modules | Accepted (refines 0019) |
| [0036](0036-shapes-as-region-constructors.md) | Shapes are region constructors; paint is the draw suffix | Accepted (refines 0012, 0015; refined by 0039) |
| [0037](0037-floored-division-and-integer-indices.md) | Floored `//` and modulo; list indices must be integers | Accepted (refines 0027; modulo spelling → `mod` in 0048) |
| [0038](0038-closed-shapes-do-not-move-the-cursor.md) | Closed shapes do not move the cursor; all path exits pinned | Superseded by 0061 |
| [0039](0039-region-algebra-constructors-combinators-eliminators.md) | Region algebra: `fill`/`stroke` eliminators, `.shift`/`.scale`, `region(d)` bridge, first-order fns | Accepted (refines 0012, 0028, 0036; refined by 0044) |
| [0040](0040-mode-scoped-coordinate-quantization.md) | Mode-scoped coordinate quantization (1/16 subpixel grid in smooth mode) | Accepted (refines 0013, 0027, 0028) |
| [0041](0041-rename-grid-block-to-pixels.md) | Rename the `grid:` block to `pixels:` | Accepted (refines 0002, 0032) |
| [0042](0042-user-defined-fonts.md) | User-defined fonts: `font` maps characters to drawings (glyphs are drawings) | Accepted (refines 0022) |
| [0043](0043-arbitrary-angle-stamp-rotation.md) | Arbitrary-angle stamp rotation (pinned NN resampling; quarter-turns stay lossless) | Accepted (refines 0027, 0028; refined by 0044) |
| [0044](0044-first-class-transforms.md) | First-class transforms: affine + projective 3D, `.about(pt)` anchors, one syntax for stamps & regions | Accepted (refines 0039, 0043; colour `rotate` → `hue`) |
| [0045](0045-import-external-images-as-drawings.md) | `import`: external images (PNG) as drawings — sandboxed, exact decode, optional sha256 pin | Accepted (refines 0035) |
| [0046](0046-one-namespace-palettes-as-bindings-and-artifact.md) | One namespace: palettes are **const, reserved** colour bindings + an export artifact (`png indexed`) | Accepted (supersedes 0033 point 5; refined by 0049, 0073) |
| [0047](0047-unicode-pixel-keys.md) | Unicode pixel keys: one code point per cell; symbol keys table-only; UTF-8 pinned | Superseded by 0049 |
| [0048](0048-mod-keyword-percent-suffix-only.md) | Modulo is the infix keyword `mod`; `%` is exclusively the percent suffix | Accepted (refines 0034, 0037) |
| [0049](0049-ascii-letter-pixel-keys.md) | Pixel keys are ASCII letters (expression-safe set); `.` is the built-in transparent cell | Accepted (supersedes 0047; refines 0046; multi-char names removed by 0050) |
| [0050](0050-single-letter-palettes-combined-by-composition.md) | Palette names are single letters only; per-drawing key scopes; combined palette artifacts via composition | Accepted (refines 0046, 0049) |
| [0051](0051-drawing-level-use.md) | Drawing-level `use` — apply a theme to a single drawing (leading position, standard fold) | Accepted (re-resolves open Q7) |
| [0052](0052-complete-normative-grammar.md) | Complete normative grammar (§17); pinned lexical disambiguations (colon rule, depth-0 args, camelCase names — hyphens only in paths, contextual flags) | Accepted (refines 0015, 0017, 0032) |
| [0053](0053-v1-engine-pinned-implementation-constants.md) | v1 engine: pinned implementation constants (Bayer dither, 4×4 smooth coverage, corner-anchored integer scale, flattening steps, bundled-math kernels, fmt scope) | Accepted (refines 0027, 0028, 0040, 0043) |
| [0054](0054-std-fonts-are-recipe-modules.md) | Standard fonts are Recipe modules | Accepted (refines 0022, 0035, 0042) |
| [0055](0055-indexed-png-auto-palette-completion.md) | Indexed PNG auto-completes the palette from rendered colours | Accepted (refines 0002, 0046, 0050) |
| [0056](0056-even-diameter-circle-rasterization.md) | Even-diameter circle rasterization | Accepted (supersedes 0028 point 3 for `circle`; `ellipse` unified to it by 0087) |
| [0057](0057-ranges-are-list-expressions.md) | Ranges are list expressions | Accepted |
| [0058](0058-point-arithmetic.md) | Point arithmetic | Accepted (refined by 0059) |
| [0059](0059-relative-point-expressions.md) | Relative point expressions | Superseded by 0061 |
| [0060](0060-explicit-color-list-ramps.md) | Explicit color-list ramps | Accepted |
| [0061](0061-first-class-paths-and-local-pen-cursors.md) | First-class paths and local pen cursors | Accepted (supersedes 0011, 0020, 0038, 0059; refines 0039, 0044) |
| [0062](0062-scoped-shadow-and-texture-filters.md) | Scoped shadows and deterministic texture filters | Accepted (refined by 0070, 0071) |
| [0063](0063-explicit-local-lighting-helpers.md) | Explicit local lighting helpers | Accepted (refined by 0068, 0069; encoding unified under `Light`/`model` by 0086) |
| [0064](0064-stamp-anchors.md) | Stamp anchors | Accepted (offset-anchor semantics refined by 0072, made unconditional by 0088) |
| [0065](0065-npm-and-github-publishing.md) | NPM & GitHub publishing: no-barrel subpath exports, scriptless per-file dist build, tag-driven release | Accepted (refines 0035, 0054) |
| [0066](0066-paint-first-painting-commands.md) | Paint-first painting commands | Accepted (refines 0036 §6, 0039, 0052) |
| [0067](0067-render-fragment-literal-arguments.md) | `render` fragment literal arguments (`<file>#<drawing>(args)`) | Accepted (refines 0024, 0030, 0031) |
| [0068](0068-shaderegion-veil-opacity-signature.md) | `shadeRegion` veil-opacity signature (language version 2) | Accepted (refines 0063; unconditional — gate removed — by 0088) |
| [0069](0069-additive-local-light-helper.md) | `lightRegion` additive local light helper | Accepted (refines 0063, pairs with 0068; encoding unified under `Light` by 0086) |
| [0070](0070-unified-shadow-argument-shape.md) | Unified shadow argument shape; v2 mask-respecting frame shadow | Accepted (refines 0062; mask behaviour unconditional and `shadow dx dy` alias removed by 0088) |
| [0071](0071-region-scoped-texture-filters.md) | Region-scoped texture filters (`grain [r] …`) | Accepted (refines 0062; scalar order refined by 0080) |
| [0072](0072-visual-stamp-anchors.md) | Visual stamp anchors (language version 2) | Accepted (refines 0064; unconditional — gate removed, legacy path removed — by 0088) |
| [0073](0073-palette-namespace-for-pixel-cells.md) | Palette namespace for pixel cells; `pal` may shadow `w`/`h`; unreserve `by` | Accepted (refines 0046, 0049, 0061; extended to theme `pal` by 0081) |
| [0074](0074-curve-through-points-spline.md) | `curve` — open centripetal Catmull-Rom spline through points | Accepted (pairs with 0075) |
| [0075](0075-curvepoly-closed-curve-region.md) | `curvePoly` — closed through-points curve, fillable organic-mass region | Accepted (pairs with 0074) |
| [0076](0076-profile-filled-function-silhouette.md) | `profile` — filled function silhouette; fn gets normalized x, one sample per column | Accepted |
| [0077](0077-scatter-block.md) | `scatter` — seeded point-distribution block; uniform over region pixels, index-sampled | Accepted |
| [0078](0078-mirror-block.md) | `mirror` — axis-symmetry block; two-pass reflecting buffer, axis paints once | Accepted |
| [0079](0079-ramp-cycling.md) | `xs.cycle(i)` — auto-wrapping list index, sugar for `xs[i mod len(xs)]` | Accepted |
| [0080](0080-unified-texture-filter-argument-order.md) | Unified texture-filter argument order (`magnitude seed`) | Accepted (refines 0071) |
| [0081](0081-loop-persistent-rebinding-and-theme-scope-edges.md) | Loop-persistent `=` rebinding; theme-`pal` shadows canvas size; theme-body free bindings rejected | Accepted (refines 0033, 0073, 0005) |
| [0082](0082-sheet-contact-sheet-cli.md) | `drawstic sheet` — family contact-sheet CLI (size-normalized labeled grid, deterministic layout) | Accepted |
| [0083](0083-render-silhouette.md) | `render --silhouette` — solid black-silhouette shape test (framebuffer post-pass, composes with all output kinds) | Accepted |
| [0084](0084-minimal-npm-package-contents.md) | Minimal npm package contents: compiled code, product skill, README, and license only | Accepted (refines 0065) |
| [0085](0085-critique-command.md) | `critique` — pixel-based, vision-free quality assertions (`C0xx`) | Accepted (refines 0030, 0031) |
| [0086](0086-declarative-light-and-material.md) | Declarative light + material (`light`/`material`/`lit`/`model`/`cel`) | Accepted (refines 0063, 0068, 0069, 0070) |
| [0087](0087-anchored-assembly.md) | Anchored assembly (`pin`/`fit`); ellipse unified to circle's centering | Accepted (supersedes 0028 point 3 for `ellipse`; refines 0024, 0064, 0072) |
| [0088](0088-in-place-v1-break.md) | In-place v1 break: collapse `drawstic 1`/`drawstic 2` double semantics | Accepted (supersedes 0029 point 3; refines 0068, 0069, 0070, 0072) |
| [0089](0089-form-based-shading.md) | Form-based (normal) shading as the `model` default; `cel` = the same body as opt-in bands | Accepted (refines 0086) |
| [0090](0090-reliable-silhouette-outline.md) | Reliable silhouette `outline`: 50 %-coverage floor (ignores soft shadows/AA), optional derived-dark colour, composited-figure idiom | Accepted (refines 0009 §filters) |
| [0091](0091-shading-v2.md) | Shading v2: Poisson-inflation height field (no ridge), Blinn specular, always-on dither + dithered cel-edges, `spread`/`puff`/`spec` material overrides | Accepted (amends 0089) |
| [0092](0092-occlusion-relations-and-aim.md) | Two-phase assembly: `behind`/`front` occlusion relations on `stamp`/`fit`, the `aim PIN PT` 1-bone solver, C013 occlusion parity, `render --explain` paint order + angles | Accepted (refines 0087) |
| [0093](0093-organic-region-constructors-figure-oracle-quantize.md) | Organic region constructors `dome`/`lobe`/`crescent`/`band`, the theme `figure:` proportions oracle (`fig` guide points/scalars per view), and the `quantize` palette-reduction filter for the import-assist workflow | Accepted (refines 0036/0039/0056/0087/0086/0024) |
| [0094](0094-language-diet-and-canonical-lints.md) | Language diet: drop `repeat`/`while`/`flood`/`replace`/`lit L:`, consolidate recolor onto parametric/`tint`, add canonical lints `W012`–`W015` + a construct census | Accepted (refines 0086 light-resolution, 0024 recolor; precedent 0088) |
