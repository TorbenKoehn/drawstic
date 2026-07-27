# 99. Opt-in filtered stamp resampling (`aa`) — 4×4 area sampling for transformed sprites

- Status: Accepted; §3's lattice-identity lemma **amended 2026-07-27** — see
  [the amendment](#amendment--2026-07-27-the-quarter-turns-are-parity-dependent) at the end.
- Date: 2026-07-27
- Deciders: t.koehn, Claude
- Refines / amends: [ADR-0043](0043-arbitrary-angle-stamp-rotation.md) §5 (lands the deferred
  "smooth-mode filtered resampling"), [ADR-0044](0044-first-class-transforms.md),
  [ADR-0040](0040-mode-scoped-coordinate-quantization.md) (reuses its pinned 1/16 subsample grid),
  [ADR-0025](0025-alpha-compositing-model.md), [ADR-0013](0013-render-mode-pixel-vs-aa.md)
  (clarifies what `mode smooth` does and does **not** cover), [ADR-0096](0096-language-freeze-for-1-0.md)
  §7 (bare contextual keyword, not a string enum).

## Context

Backlog item §9.2 reads, in full: *"AA for Stamps and hand-drawn (`pixels:`) sprites"*. That headline
covers at least three unrelated features, and one and a half of them are already shipped. Establishing
what exists first is most of this decision.

### What already exists

**1 — `mode pixel|smooth` is real anti-aliasing, but it never touches a stamp.** `mode smooth`
([ADR-0013](0013-render-mode-pixel-vs-aa.md), [ADR-0040](0040-mode-scoped-coordinate-quantization.md))
supersamples **region eliminators** at 4×4 on the 1/16 grid: `raster.ts`'s `coverageAt` tests 16
subsample positions against `Region.test` and `fillPixel` blends `putPixel(…, cov)`. It also switches
gradients from Bayer dithering to round-half-up commit, and masks from 1-bit to alpha coverage. The
e2e test `smooth mode renders anti-aliased coverage` asserts exactly this and nothing more: a filled
`circle` grows partial-alpha edge pixels.

`stampSprite` does not read `ctx.mode` **at all**. Every stamp — in either mode — goes through
`stampTexelAt`: inverse-map the destination pixel centre, `roundHalfUp` both coordinates, copy one
texel or nothing. So `mode smooth` anti-aliases the shapes a drawing paints and leaves every
*composed* part hard-edged. `docs/language-spec.md` §9 currently claims "smooth mode uses the same
mapping on the 1/16 subpixel grid" for stamp rasterization — **that sentence has never been true**
and is corrected by this ADR.

**2 — The outline path is already AA-aware.** [ADR-0090](0090-reliable-silhouette-outline.md) put a
50 %-coverage floor (`OUTLINE_ALPHA_MIN = 128`) on `filterOutline` precisely so that "a soft contact
shadow or an anti-aliased fringe is *not* treated as silhouette". Nothing to build.

**3 — The palette escape hatch already exists.** `quantize [REGION] PALETTE`
([ADR-0093](0093-organic-region-constructors-figure-oracle-quantize.md)) remaps opaque pixels to a
declared palette by OkLab distance, and `critique`'s own advice string already reads "quantize the
palette or drop gradient/AA sprawl for the indexed/SVG export". The remedy for an AA'd sprite bound
for indexed PNG is shipped.

**4 — Lattice transforms are already exact.** `dmath`'s `dsinDeg`/`dcosDeg` return exact `0`/`±1` at
multiples of 90°, so mirrors, quarter-turns and integer scales already resample losslessly.

### What is genuinely missing

Exactly one thing: **a stamp whose transform is *not* lattice-preserving — `rot45`, a non-integer
`scale`, `skew`, a projective `rotatey().perspective()` — reads one texel per destination pixel and
produces a hard staircase**. That is [ADR-0043](0043-arbitrary-angle-stamp-rotation.md) §5's
explicitly deferred item ("smooth-mode filtered resampling is *not* v1"), and it is the whole of
§9.2 that is not already built.

### The `pixels:` half of the headline

A `pixels:` block produces a `Sprite` — the same runtime value a procedural `draw` or an `image`
produces. There is no separate hand-drawn code path to anti-alias. At an integer position with no
transform, `blitIdentity` copies texels verbatim; there is nothing between the source and destination
lattices to filter, and any "AA" applied there would be a *feathering* of authored art, not
resampling. **So the `pixels:` half is not a second feature: it only matters under transform, and it
is covered by the same flag as every other sprite.** The honest answer is unification, not a second
mechanism.

## Decision

### 1 — What `aa` is, and what it is not

Of the three candidate readings of "AA for stamps":

| Candidate | Verdict |
|---|---|
| **Edge AA when a sprite is scaled/rotated by a non-lattice factor** | **In.** This is the feature. |
| **Coverage-correct compositing when a source texel lands between destination pixels** | **In — it is the same feature.** Not a separate mechanism: it is the *mechanism* by which the previous row is delivered. One sampler serves both. |
| **Alpha-feathering a sprite's outer silhouette at an integer position** | **Out, ruled out explicitly.** Softening authored art that the engine placed exactly is a *filter*, not a placement property; it would belong in the `apply NAME` filter family, it destroys the pixel-art contract this project exists for, and no measured session ever asked for it. It is not deferred-but-planned — it is rejected. |

`aa` therefore means: **when a stamp's transform maps a destination pixel to a region of source that
is not a single texel, resolve that destination pixel from the *area* it covers instead of from one
point sample.**

### 2 — The opt-in surface: a bare `aa` flag on `stamp` and `fit`

```drw
stamp needle 32:32 rot37 aa            # smooth compass needle in an otherwise crisp scene
fit blade.hilt hand.grip aim tip 60:8 aa
```

`aa` is a **bare contextual flag** in the `stamp`/`fit` flag slot, exactly like `flipx`, `rot45` and
`scale2` — one token, no argument, no string enum ([ADR-0096](0096-language-freeze-for-1-0.md) §7).
It stays an ordinary bindable name everywhere else (D4/D7).

Rejected alternatives:

- **A parameterised mode (`aa 8`, `aa area|bilinear`).** A quality knob is a second thing to pin and
  invites two recipes that look the same rendering differently. The sample grid is fixed at 4×4, the
  same one [ADR-0040](0040-mode-scoped-coordinate-quantization.md) already pinned for `mode smooth` —
  one AA grid in the whole engine.
- **A directive or a `mode` value.** `mode pixel|smooth` is a **set-wide style trait** living in the
  theme ([ADR-0013](0013-render-mode-pixel-vs-aa.md)); whether one rotated prop should be filtered is
  a **per-placement** call. Folding it into `mode` would also make the crispness default overridable
  set-wide, which is the exact thing this decision refuses.
- **A `material`/theme property.** `material` describes how a *mass* takes light
  ([ADR-0086](0086-declarative-light-and-material.md)); resampling is not a lighting property.
- **Reusing the word `smooth`.** `mode smooth` already owns it for a different mechanism. One way per
  concern cuts both ways: a word must not name two mechanisms either.

**Default is off, always.** Pixel art stays crisp unless the author writes `aa`. There is no theme
switch, no CLI flag, and no `mode` value that turns it on globally.

Grammar (spec §17.4 style — one added alternative in each of the two flag productions):

```ebnf
stamp-flag     = "flipx" | "flipy" | ROT-FLAG | SCALE-FLAG          (* pinned sugar (§9) *)
               | "aa"                                (* opt-in filtered resampling (§9, ADR-0099);
                                                         a no-op on §3's identity set *)
               | "transform" expr | "tint" paint expr | "mask" NAME
               | "anchor" NAME | "shadow" point paint
               | "behind" NAME | "front" NAME ;

fit-flag       = "flipx" | "flipy" | ROT-FLAG | SCALE-FLAG
               | "aa"                                (* same flag, same semantics (ADR-0099) *)
               | "transform" expr | "tint" paint expr | "mask" NAME
               | "ground" | "behind" NAME | "front" NAME | "aim" NAME point ;
```

No parser change is required: bare names already fall through the command-form flag loop as
expression arguments, and `fit`'s own flag loop does the same. `aa` joins `eval.ts`'s `FLAG_RE`.

### 3 — The pinned algorithm (determinism)

For a stamp with an invertible matrix `M` and `aa` set, each destination pixel `(dx, dy)` inside the
existing `stampDestBounds` box resolves as follows. Every step is fixed language behaviour.

1. **Tap grid.** 16 subsample offsets, the *same* grid `coverageAt` uses:
   `o ∈ {−3/8, −1/8, +1/8, +3/8}²`, i.e. `−0.5 + (2k+1)/8` for `k = 0..3`.
2. **Tap mapping.** For each tap, `p = applyMatrix(M⁻¹, dx + ox − px, dy + oy − py)`, then
   `sx = roundHalfUp(p.x)`, `sy = roundHalfUp(p.y)` — **byte-for-byte the same read
   `stampTexelAt` performs**, just 16 times. A tap outside `[0, w) × [0, h)` or on a zero-alpha texel
   contributes nothing.
   *Each tap calls `applyMatrix` independently.* Incrementally stepping the source position by a
   constant delta is **forbidden**: it is not equivalent under the projective divide and it makes the
   result depend on float accumulation order.
3. **Accumulation — exact integers, premultiplied, gamma-encoded sRGB.** Over the 16 taps:
   `A += a`, `R += r·a`, `G += g·a`, `B += b·a`.
   Maxima are `A ≤ 4080` and `R,G,B ≤ 1 040 400` — exact in doubles, so the sum is
   order-independent by construction (the iteration order is documentation, not a determinism
   requirement).
4. **Empty pixel.** `A === 0` ⇒ nothing is written: no `blendColor`, no `Framebuffer.onWrite` tick.
   Identical to the NN path's "transparent texel ⇒ skip" contract.
5. **Commit.** `a = roundHalfUp(A / 16)`; `r = roundHalfUp(R / A)`, `g = roundHalfUp(G / A)`,
   `b = roundHalfUp(B / A)` — note the **divisor differs**: alpha averages over the *grid*, colour
   un-premultiplies over the *accumulated alpha*. A resulting `a === 0` is already a no-op inside
   `Framebuffer.blend`, so a sub-half-percent fringe never writes and never ticks the budget.
6. **Then tint, then composite.** `applyTint` runs on the resolved colour, preserving the resampled
   alpha (unchanged helper); `ctx.buffer.blendColor` performs the pinned source-over of
   [ADR-0025](0025-alpha-compositing-model.md). Order is pinned as **resample → tint → composite**.

**The space is gamma-encoded sRGB with alpha weighting — deliberately not linear light, not OkLab.**
Justification against the existing pipeline:

- `src/framebuffer.ts` composites source-over in **gamma-encoded integer sRGB** and never linearizes
  ([ADR-0025](0025-alpha-compositing-model.md)). Averaging coverage in linear light and then
  compositing in gamma space would make the two halves of one edge disagree.
- `fillRegion`'s smooth coverage already does exactly this: `putPixel(…, cov)` scales `c.a` by the
  coverage fraction in gamma space and leaves RGB alone. A 50 %-covered edge pixel must read the same
  whether its coverage came from `mode smooth` or from `aa`; premultiplied gamma averaging is the
  generalisation of that rule to a *varying* colour across the taps.
- `src/color.ts`'s OkLCh path is for **authored colour operations** (`mix`, `lighten`, ramps), where
  perceptual uniformity is the point. Edge coverage is an **area average of light-blocking**, not a
  colour operation. OkLab would additionally lose the lattice-identity property below (its 8-bit
  round-trip is lossy) and cost a `Math.pow` per tap.

**Lattice-identity lemma (pinned, and asserted by test — amended 2026-07-27, see the amendment
below).** A placement is `dest = origin + M(src)` with an **integral** `origin` (`quantInt`), so only
`M` can put a tap on a rounding boundary. All 16 taps of a destination pixel round to the *same*
texel as its centre tap — and then `A = 16a` ⇒ `roundHalfUp(16a/16) = a` and `R = 16ra` ⇒
`roundHalfUp(16ra/16a) = r`, so **the output is byte-identical to nearest-neighbour** — exactly when
every inverse-mapped pixel-centre coordinate stays farther than `3/(8N)` (the largest tap
displacement under an `N`-fold upscale) from a `roundHalfUp` boundary. Two classes:

1. **Size-free (holds for every sprite size):** integer translations, the axis mirrors
   `flipx`/`flipy`, the half-turn `rot180`, integer uniform upscales `scale<N>` (N ≥ 1), and any
   composition of them. Each maps a destination pixel centre to an inverse-mapped coordinate whose
   distance from the nearest half-integer is `1/(2N)`, and `1/(2N) > 3/(8N)`.
2. **Parity-dependent:** the quarter-turns `rot90`/`rot270` hold **iff the sprite's `w` and `h`
   share a parity** — see the amendment. At mixed parity they are a genuine resample.

`aa` therefore *cannot* soften pixel art under the transforms pixel artists actually use, with that
one stated exception — the promise is mechanical, not a convention. The identity blit
(`matrix === undefined`) skips the sampler entirely for the same reason.

No fast path detects lattice transforms at runtime: the sampler already produces the right bytes, and
adding a classifier would be a second place for the rule to drift. Authoring hygiene is the lint's job
(§5).

`stampDestBounds` needs no change: it floors/ceils the forward-mapped outer footprint
(`−0.5 … w−0.5`), and a tap reaches at most 3/8 px beyond a pixel centre, so no fringe pixel falls
outside the existing box.

### 4 — Interaction matrix

| Interacts with | Decision |
|---|---|
| **`anchor`** ([ADR-0072](0072-visual-stamp-anchors.md)) | **Orthogonal, unchanged.** The visual anchor is solved from the forward-mapped corner bbox and `quantInt`-rounded to an integer origin *before* any sampling. `aa` changes how texels are read, never where the origin lands: `anchor bottom rot30` and `anchor bottom rot30 aa` place at the identical origin. |
| **`flipx` / `flipy` / `rot180` / `scale<N>` / integer `shift`** | **Byte-identical to NN at every sprite size** (lemma above, class 1). `aa` is a provable no-op, not "AA you can't see". |
| **`rot90` / `rot270`** | **Byte-identical to NN iff `w` and `h` share a parity** (lemma class 2). At mixed parity the quarter-turn pivots on a half-integer and `aa` really does resample — a four-way average over a 2×2 texel block plus a half-covered fringe. Amended 2026-07-27. |
| **`rot<other>`, non-integer `scale`, `skew`, `matrix`, `rotatex`/`rotatey`/`perspective`** | The feature: coverage AA at the silhouette and 16-level blends across interior texel boundaries. A projective map is handled by the same sampler — each tap runs the full `applyMatrix` divide. |
| **`tint`** | Applied **after** resampling, to the resolved colour, preserving the resampled alpha. Pinned order removes the ambiguity; the `applyTint` helper is unchanged. |
| **`shadow dx:dy paint`** | Uses the **same** sampler (one placement, one look). The shadow pass tints at `amount 1`, so the resampled colour collapses to the shadow paint while the resampled **alpha carries the AA contour** — the drop shadow gets the same soft edge as the part, instead of a crisp shadow under a soft figure. |
| **`mask` (stamp flag or enclosing `mask` block)** | **Deliberately binary and unchanged.** The mask is tested as `Region.has(dx, dy)` on the destination pixel, before sampling. `aa` softens the *sprite's* edges, not the mask's; making the mask coverage-based here would silently change every existing masked stamp and duplicates what `mode smooth` already does for masks. |
| **`mode pixel` / `mode smooth`** | **Fully orthogonal, both directions.** `aa` works in `mode pixel` — that is the point (one rotated prop in a crisp scene). `mode smooth` does **not** imply `aa`: a stamp is a bitmap blit ([ADR-0043](0043-arbitrary-angle-stamp-rotation.md) §3 stands). The spec sentence claiming otherwise is corrected. |
| **`outline`** ([ADR-0090](0090-reliable-silhouette-outline.md)) | **Already correct, no change.** The 128-alpha floor means a sub-50 % fringe is not silhouette and is not ringed; the contour hugs the 50 %-coverage boundary — exactly the case ADR-0090's rationale names. The standing idiom (run `outline` once over the *composited* figure) is unaffected. |
| **`quantize`** ([ADR-0093](0093-organic-region-constructors-figure-oracle-quantize.md)) | **The canonical remedy**, no change needed. `quantize` remaps **opaque** pixels' RGB by OkLab distance and keeps alpha, so it snaps the widened interior back to a declared palette while the partial-alpha fringe survives — correct, because the fringe is *coverage*, not a colour. |
| **Indexed PNG (`png … indexed`)** | **Mechanism unchanged; consequence is real and already loud.** `indexedPalette` enumerates distinct RGBA quadruples, and each fringe alpha is a distinct entry, so an AA'd sprite can blow past 256 — which is the existing **`E018`** on the export line. No new error and no silent palette truncation: the failure is already positioned at the right statement. Only the message gains a hint naming `quantize` and `aa`. |
| **SVG export** | **Partial coverage *is* expressible — no change.** `encodeSvg` already emits `fill-opacity` for any run with `a !== 255`, so an AA'd stamp renders exactly. The real cost is run fragmentation: a soft diagonal edge breaks pixel-runs and the file grows. The `classes` option only classes fully-opaque palette colours (`cls && a === 255`), so fringe pixels fall to the existing inline-style path. Nothing to build; documented as a size trade-off. |
| **JPEG export** | No alpha, no interaction. Unchanged. |
| **Two-phase assembly, `behind`/`front`** ([ADR-0092](0092-occlusion-relations-and-aim.md)) | Placements paint into private layers and composite source-over. **Honest limit, documented not fixed:** two *overlapping* `aa` parts show a faint double-blended seam where their fringes meet. Remedies are the existing ones — `fit` at a lattice transform for contact seams, or `outline` on the composited figure, whose 128 floor is fringe-blind by design. |
| **`mirror` block** ([ADR-0078](0078-mirror-block.md)) | A reflecting buffer mirrors the whole passage about an axis — a lattice mirror — so an `aa` stamp inside a `mirror` reflects byte-identically. No interaction. |
| **`#stampedFootprint` / `fit` contact detection** | Unchanged: it mirrors the NN centre mapping to attribute ownership. Under `aa` the owned set is the same bbox scan and the extra fringe is ≤1 px, well inside what `#hasContact` already tolerates. Deliberate non-change. |
| **`render --silhouette`** ([ADR-0083](0083-render-silhouette.md)) | Uses `a > 0`, so an `aa` stamp reads ~1 px fatter in the silhouette test. **Deliberately unchanged** — ADR-0083 chose "semi-transparent edge pixels read as solid mass" on purpose, and a silhouette test asks about *area*. Documented, not fixed. |
| **`critique`** ([ADR-0085](0085-critique-command.md)) | No new `C0xx`. The palette-sprawl advice already names AA (`src/critique.ts`), and the RGBA-target carve-out already exempts non-indexed exports. |
| **Pixel-write budget (§15)** | One `onWrite` tick per **written destination pixel**, exactly as NN — the 16 taps are reads. An `aa` stamp costs the extra fringe ring, not 16×. |
| **`atlas` packing, font glyph blits, `sheet`** | All call `stampSprite` without a matrix ⇒ `blitIdentity` ⇒ untouched. |

### 5 — Diagnostics

- **No new `E###`.** An unknown or misplaced recipe flag is already `E012` (`badFlag`) via
  `Args.done()`; `aa` needs no error of its own. (`E026` is CLI-flag-only.) Next free is **E028**,
  deliberately not taken.
- **New `W018`** — next free lint code; `W004` and `W012` are retired and stay burned
  ([ADR-0096](0096-language-freeze-for-1-0.md), [ADR-0097](0097-canonical-shading-floor.md)):

  > `W018` — `aa` on a `stamp`/`fit` the lemma proves byte-identical to the point sample: the flag
  > cannot change a pixel.
  > *hint:* `aa` only changes pixels under a non-lattice transform (`rot45`, non-integer `scale`,
  > `skew`, `perspective`) — drop it.

  Scoped to exactly what the lemma covers (amended 2026-07-27). The **size-free** flags
  (`flipx`/`flipy`/`rot0`/`rot180`/`scale<N>`, or no flag at all) decide from the flag list alone,
  because `rot<deg>` and `scale<N>` carry their value in the token. A **quarter-turn**
  (`rot90`/`rot270`) additionally needs the placed sprite's `w`/`h` parity, which the lint resolves
  by rendering a zero-parameter target exactly as `W003` already does — a *static*, lint-time
  classifier over information the linter genuinely has, not the runtime classifier §3 forbids. Every
  case it cannot resolve is **skipped** rather than guessed: a `transform EXPR` flag, a `fit … aim`
  (ADR-0092) or `bone` (ADR-0095) rotation solved at runtime, and a quarter-turn whose target size is
  not statically known (a parametric draw, an `image`, a local binding). A warning, not an error: an
  author iterating on an angle legitimately passes through `rot90`.

### 6 — Scope discipline: what this is not

The implementation is one sampler function, one boolean threaded through one signature, one flag, one
lint. Explicitly **out of scope**, named so nobody builds them by inference:

- bilinear / bicubic / Lanczos filtering (a box filter over the pinned grid cannot invent a colour
  outside the involved texels; bilinear would blur every interior pixel and is the wrong look here);
- RotSprite ([ADR-0043](0043-arbitrary-angle-stamp-rotation.md) §5 keeps it deferred);
- `aa` on region eliminators — that is `mode smooth`, and it exists;
- a sample-count or filter-kernel knob;
- silhouette feathering as a filter (rejected in §1, not deferred);
- AA-aware indexed quantization (`quantize` before the export is the answer).

## Consequences

- Rotated and perspective-projected stamps stop reading as staircases, without any recipe that
  doesn't ask for it changing by a single byte — the lattice-identity lemma makes "pixel art stays
  crisp" a testable property rather than a promise.
- [ADR-0043](0043-arbitrary-angle-stamp-rotation.md) §5's deferral is closed for filtered resampling;
  RotSprite and non-integer `scale<N>` sugar remain open.
- The spec's false claim that `mode smooth` resamples stamps on the 1/16 grid is removed — a
  documentation bug that predates this ADR and would have made `aa` look redundant.
- The `aa` + indexed-PNG combination is a loud `E018`, not a silent palette drop; `quantize` is the
  documented path and the error now says so.
- Touches `src/raster.ts`, `src/eval.ts`, `src/lint.ts`, `src/build.ts` (one hint string),
  `docs/language-spec.md` (§9, §12 mode text, §14 determinism list, §17.4 grammar, the W-code table),
  `skills/drawstic/reference.md` + `language.md`, and tests. No parser or AST change.
- No bundled example uses `aa`; the corpus renders byte-identically.

## Implementation plan

Ordered. Each step is complete and leaves the suite green.

### 1. `src/raster.ts` — the sampler

1. Extract the pinned subsample offsets that `coverageAt` currently inlines into a shared
   `const SUBSAMPLE_OFFSETS = [-0.375, -0.125, 0.125, 0.375]` (module-level, documented as
   ADR-0040's grid) and rewrite `coverageAt` to read it. **No behaviour change** — assert this by the
   existing smooth-mode tests staying green.
2. Add `const stampTexelAA = (sprite, inverse, px, py, dx, dy): Color | null` implementing §3 steps
   1–5: 16 `applyMatrix` taps, integer premultiplied accumulation, `null` when `A === 0`, otherwise
   `{ type: 'color', r: roundHalfUp(R/A), g: …, b: …, a: roundHalfUp(A/16) }`.
3. `stampSprite(ctx, sprite, px, py, matrix?, tint?, extraMask?, aa = false)` — **additive trailing
   optional parameter**, so no existing call site changes. In the transformed loop, select
   `aa ? stampTexelAA : stampTexelAt`. The `!matrix` branch ignores `aa` and still calls
   `blitIdentity`.
4. Update the module header comment (line 3) to `stamps (inverse-mapped NN; opt-in 4×4 area-sampled
   AA — ADR-0099)`.

### 2. `src/eval.ts` — the flag

5. `FLAG_RE` → `/^(fill|flipx|flipy|aa|w\d+|rot\d+(\.\d+)?|scale\d+)$/`.
   *Verified non-breaking:* `drawFlags`/`strokeFlags` don't match `aa` and break out of their loops,
   after which `Args.done()` raises the same `E012 unexpected extra argument 'aa'` it raises today.
6. `StampFlags` (≈ line 564) gains `aa: boolean`; `#parseStampFlags`'s initializer gains `aa: false`.
7. `#parseOneStampFlag`: `if (flag === 'aa') { args.takeFlag(); f.aa = true; return true }`.
8. `#execStamp` (≈ line 5387): pass `flags.aa` as the 8th argument to **both** `stampSprite` calls —
   the `flags.shadow` pre-pass and the main blit.
9. `#execFit` (≈ line 3160): pass `flags.aa` to its `stampSprite` call. `#dropContactShadow`
   (`ground`) is an ellipse fill, not a blit — untouched.

### 3. `src/lint.ts` — W018

10. Add `lintNoOpAa(engine, mod, def, diagnostics)`: walk statements; for `call` with
    `callee === 'stamp'` (and the `fit` statement kind), collect bare-name flag args. Emit `W018`
    when `aa` is present **and** no `transform` keyword arg is present **and** every other transform
    flag is one the lemma covers: `flipx|flipy|scale\d+|rot(0|180)` unconditionally, and
    `rot(90|270)` only once `staticSpriteSize` resolves the placed sprite (a zero-parameter draw,
    rendered as `W003` renders one) to `(w − h) % 2 === 0`. A `fit` carrying `aim` or a `bone` source
    is skipped outright. Register it in `lintModule`'s per-draw loop next to `lintClippedStamps`.
    *(Amended 2026-07-27 — the original step said every `rot(0|90|180|270)` was unconditionally
    lattice-preserving.)*

### 4. `src/build.ts` — one hint

11. `indexedPalette`'s `E018` gains a `hint`: `` `aa fringes and gradients each cost palette slots —
    run 'quantize <palette>' before an indexed export` ``. (`error()` already accepts a 5th `hint`
    argument; the call currently passes four.)

### 5. Docs and the product skill (same change, non-negotiable per AGENTS.md §6)

12. `docs/language-spec.md`:
    - §9 stamp signature line gains `[aa]`; new paragraph describing the flag, the lattice no-op
      guarantee, and the indexed/SVG cost.
    - **Delete the false sentence** "smooth mode uses the same mapping on the 1/16 subpixel grid" from
      the Rasterization bullet; replace with "both modes point-sample; `aa` opts one placement into
      4×4 area sampling (ADR-0099)".
    - §14 determinism list: add the `aa` sampler (grid, integer premultiplied gamma accumulation,
      rounding rule).
    - §17.4: the two flag productions from §2 above.
    - The `W0xx` table (≈ line 1942): the `W018` row.
13. `skills/drawstic/language.md` (stamp block, ≈ line 230) and `skills/drawstic/reference.md`
    (≈ line 536 + the `fit` grammar): add `[aa]` to both grammar lines and one sentence —
    *"`aa` = 4×4 area-sampled resampling for this placement; a no-op on mirrors/quarter-turns/integer
    scales; widens the palette, so `quantize` before an indexed export."* Add the `W018` row to the
    skill's diagnostics table.
14. `docs/decisions/README.md`: index row for 0099.

### 6. Tests

`tests/unit/raster.test.ts` — new `describe('stampSprite aa')`:

- **`half-pixel shift spreads one texel across two at alpha 128`** — 1×1 opaque `#ff0000`,
  `matrix = shift(0.5, 0)`, canvas 4×2, `aa = true`.
  Assert exactly: `(0,0) = (255, 0, 0, 128)`, `(1,0) = (255, 0, 0, 128)`, `(2,0)` and every `y = 1`
  pixel fully transparent. *(Derivation: 8 of 16 taps hit the texel ⇒ `A = 2040`,
  `roundHalfUp(2040/16) = 128`; `R/A = 255`.)* Without `aa` the same stamp writes a single
  `(255,0,0,255)` at `(0,0)` — assert both.
- **`interior texel boundary blends 50/50 in gamma sRGB`** — 2×1 sprite `#ff0000` `#0000ff`,
  `matrix = shift(0.5, 0)`, `aa = true`.
  Assert exactly `(0,0) = (255,0,0,128)`, **`(1,0) = (128, 0, 128, 255)`**, `(2,0) = (0,0,255,128)`.
  This one assertion discriminates the blend space: linear-light averaging would give ≈188 per
  channel, an OkLCh mix nothing close to `(128,0,128)`.
- **`mirrors, rot180, integer scale and integer shift are byte-identical … at every sprite size`** —
  a deliberately asymmetric sprite at **odd/odd, even/even and both mixed-parity** sizes (3×5, 4×4,
  4×5, 3×4, 6×4); for each of `flipx`, `flipy`, `rot180`, `scale2`, `scale3`, the composition
  `flipx flipy scale2 rot180`, and an integer `shift(3, −2)`, render twice and
  `expect(aaData).toEqual(nnData)` over the whole buffer.
- **`a quarter-turn is byte-identical … only at equal parity`** — `rot90`/`rot270` (alone and
  composed with `flipx scale2`) equal at 3×5/4×4/6×4, and **`not.toEqual`** at 4×5/3×4/2×3/5×6.
- **`a mixed-parity quarter-turn averages a 2×2 texel block`** — a 2×3 sprite of six distinct opaque
  texels under `rot90`: the covered pixel is the exact four-way mean, and the fringe column NN never
  writes is half-covered.
  *(Amended 2026-07-27 — the original fixture was 3×5 only, i.e. both sides odd, so it passed
  vacuously and could not observe the quarter-turn failure.)*
- **`identity blit ignores aa`** — `stampSprite(ctx, s, 2, 3, undefined, undefined, undefined, true)`
  equals the same call with `false`.
- **`aa never ticks the budget for an empty pixel`** — `onWrite` counter equals the number of pixels
  with `a > 0`.

`tests/unit/e2e.test.ts`:

- **`aa softens a rot45 stamp and the un-aa'd twin stays crisp`** — an 8×8 opaque square stamped
  `rot45` into a 24×24 canvas: with `aa`, count of pixels with `0 < a < 255` is `> 0`; without `aa`,
  that count is exactly `0`.
- **`aa composes with tint`** — `rot45 aa tint #0000ff 1.0`: every written pixel's RGB is exactly
  `(0, 0, 255)` while alphas vary (proves resample → tint, alpha preserved).
- **`aa shadow carries the soft contour`** — `rot37 aa shadow 2:2 #000000ff`: the shadow ring contains
  partial-alpha pixels.
- **`svg export of an aa stamp emits fill-opacity`** — the encoded SVG string contains
  `fill-opacity="`.

`tests/unit/lint.test.ts`:

- **`W018 fires on aa with a size-free lattice transform`** — `stamp part 0:0 scale2 aa` and
  `stamp part 0:0 flipx aa` and bare `stamp part 0:0 aa` each warn once.
- **`W018 stays silent on a real transform`** — `stamp part 0:0 rot45 aa`, `stamp part 0:0 rot37 aa`,
  and `stamp part 0:0 transform t aa` produce no `W018`.
- **`W018 fires on a quarter-turn only at equal parity`** — `rot90 aa` (and `flipx scale2 rot270 aa`)
  on a 4×4 part warn once; the same flags on a 4×5 part, and a `rot90 aa` whose target is parametric,
  produce no `W018`, while `flipy aa` on that 4×5 part still warns. `fit` mirrors both arms.
  *(Added 2026-07-27 with the amendment.)*

`tests/unit/parser.test.ts` / `eval.test.ts`:

- **`aa is still a bindable name outside a stamp`** — `aa = 3` followed by a use of `aa` evaluates,
  proving the flag stays contextual.

**Existing tests expected to break: none.** `stampSprite`'s new parameter is trailing and optional, so
`raster.test.ts`'s seven positional call sites are unaffected; `skill-cli-sync.test.ts` checks CLI
verbs/flags only and `aa` is a recipe flag; no bundled recipe uses `aa`, so `lint.test.ts`,
`examples-critique.test.ts` and the build/critique corpus tests keep their current counts. If the
`coverageAt` refactor (step 1) changes any smooth-mode byte, the refactor is wrong — treat a failure
there as a bug in step 1, never as a baseline to update.

## Amendment — 2026-07-27: the quarter-turns are parity-dependent

§3's lemma listed `rot90`/`rot270` among the transforms that are unconditionally byte-identical to
nearest-neighbour. **That was false**, and both the test and the lint built on it were wrong as a
result. The sampler was never wrong: the defect was in the prose, the lint's advice, and a test
fixture that could not see it.

**The arithmetic.** `#buildStampMatrix` (`src/eval.ts`) pivots a quarter-turn about
`cx = (w − 1)/2`, `cy = (h − 1)/2`. Inverting `rot90` gives, for a destination pixel `(dx, dy)` at
integral origin `(px, py)` and tap offsets `(ox, oy) ∈ {±1/8, ±3/8}²`:

```text
p.x = (cx − cy) + (dy − py) + oy
p.y = (cx + cy) − (dx − px) − ox
```

`cx − cy = (w − h)/2` and `cx + cy = (w + h)/2 − 1` differ by the integer `2cy = h − 1`, so both are
integral **iff `w ≡ h (mod 2)`**, and both are half-integral otherwise. `rot270` is the same map with
the signs swapped.

- **Equal parity** (`3×5`, `4×4`, `64×128`, every square sprite): each tap coordinate sits `1/8` from
  the nearest `roundHalfUp` boundary — `1/(2N)` once composed with `scale<N>`, always `> 3/(8N)` —
  so all 16 taps read the centre tap's texel and the output is byte-identical. The quarter-turns do
  belong in the lemma, under that condition.
- **Mixed parity** (`4×5`, `3×4`, `2×3`, `5×6`, …): every tap coordinate lands **exactly** on the
  `roundHalfUp` boundary in *both* axes. The taps split 8/8 per axis — 4/4/4/4 over a 2×2 texel
  block — so an interior destination pixel becomes the four-way mean of that block and the placement
  grows a half-covered fringe one pixel wide on two sides. A 2×3 sprite under `rot90 aa`, for
  instance, writes `(128, 128, 191, 255)` where nearest-neighbour writes an untouched texel, plus a
  fringe column at alpha 128 that nearest-neighbour never writes at all.

Verified numerically over every `flipx`/`flipy`/`rot{0,90,180,270}`/`scale{1,2,3,5,8}` combination
for all sizes `1..16 × 1..16` plus `64×128`, `33×65`, `31×64`, `17×19`: tap-identity holds for every
size in class 1 and for exactly the equal-parity sizes in class 2 — no mixed-parity quarter-turn is
identical, and no equal-parity one differs.

**What changes.** Only prose, one lint, and tests:

- §3's lemma is restated in two classes (size-free, parity-dependent); §4 splits the old
  `flipx/flipy/rot90|180|270/scale<N>/shift` row into a size-free row and a quarter-turn row.
- **`W018` is narrowed** to exactly what the lemma proves. Size-free flags decide from the flag list;
  a quarter-turn additionally requires the placed sprite's `w`/`h` parity, resolved statically via
  the same zero-parameter render `W003` uses (`staticSpriteSize`). Where that does not resolve — a
  parametric target, an `image`, a local binding — **W018 stays silent** rather than guess. The
  message no longer names a "lattice-preserving transform"; it states the reason it proved
  (`no transform` / `a mirror/half-turn/integer-scale transform` / `a quarter-turn of a WxH sprite
  (equal-parity sides)`). §3's ban on a **runtime** lattice classifier is untouched: nothing was
  added to the sampler.
- `tests/unit/raster.test.ts`'s lattice test used a 3×5 sprite — both sides odd — so it passed
  vacuously. It now runs the size-free flags across odd/odd, even/even and both mixed-parity sizes,
  asserts that quarter-turns are equal *only* at equal parity, and pins the exact 2×2 average a
  mixed-parity quarter-turn produces.

**What does not change.** `stampTexelAA`, `stampSprite`, `#buildStampMatrix` and every rendered byte:
the sampler already did the right thing at mixed parity. No bundled recipe uses `aa`, so the corpus
is unaffected.
