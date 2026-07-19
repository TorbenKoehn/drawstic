# Drawstic character craft

How to build a **modular game figure** (48–64px, or 64×128 chibi with front/side/back — ADR-0089/0090,
§5–7) that reads as the archetype on the **first attempt with few iterations**. SKILL.md § Characters gives the mandatory
order + checklist; this is the detail. Every rule comes from a shipped, check-clean recipe
(`examples/characters/*.drw`) or a rendered probe. `check` verifies grammar only — **seam contact,
silhouette legibility, a genuine side view, and archetype/sex reading are 100 % visual and silent to
`check`; the render, the `--silhouette` black-out, and a per-joint `--crop` are the only judges.**

Characters are **not scenes and not icons.** Keep from scene-craft: **one** light contract, now
carried by a `theme` `light` + `model`/`cel` (ADR-0089 form shading works at chibi scale — see §6)
and the contact-shadow ellipse. Keep from icon-craft: small-raster discipline — the *raw*
`shadeRegion`/`rim` distance veils are still too weak/thin at ≤64px, but **`model` (form-based) is
not**; reach for `model`/`cel`, not the low-level primitives. Add what is character-specific: parts,
**seams**, three views, faction recolor. The dominant bug class here is the **floating limb / 2–3px
seam gap** (5 of 7 first-run builds hit it) — §4 makes it structurally impossible.

## 1. The fixed build order

The order that wins on the first attempt — do not reorder:

1. **Light contract** — ONE `light` in a `theme`, `use`d so every view/variant shares it (the
   structural cross-view fix); `warm`/`cool` + `fn lit/shd/deep` is the ≤64px colour-system fallback (§6).
2. **Material ramps + faction colour set** — metal/skin/cloth/bone as module bindings; **only the
   1–2 varying colours become draw params**, everything else fixed (§3, §6).
3. **Proportions-constant head** — `headTop/shoulderLine/hipLine/kneeLine/footLine` as module
   constants, before the first part (§2).
4. **Parametric parts** — non-exported `draw part(c)`, each declaring its seam rows as **`pin`s** in
   its own space (`pin shoulder 4:0`; `pin` replaces the socket *comment* — §3, §4).
5. **Full body back-to-front via `fit`** (pin-anchored, contact-guaranteed — §4); plant standing
   parts with `fit … shadow` (auto contact-shadow) instead of a hand `ellipse` (§4).
6. **Three composers — front, side, back** (§5): side redraws pose-leading parts, back redraws the
   head (no face) and **declares prop z-order with `behind`/`front`** (mounted cape over the body,
   held prop `behind` it; ADR-0092 — §5b), orienting each per view with `aim` where needed.
7. **Bright accents, then ONE bare `outline` last** — emissive lights/glints/orbs (like scene-craft,
   so the shade pass never dims them), then a single `outline` as the assembly draw's **final**
   statement closes the silhouette (§6, ADR-0090).

## 2. Proportions constants — the head before the first part

The character pendant to scene-craft's *"terrain is a function"*: put the vertical layout in **module
constants** so every part and both views read the same lines. This one block eliminates most of the
trial-and-error coordinate hunting.

```drw
# proportions for a ~56–60px figure (~4 heads tall). Shared by front AND side.
headTop      = 2
shoulderLine = 17
hipLine      = 34
kneeLine     = 44
footLine     = 55
```

**Preferred: the theme `figure:` oracle** (ADR-0093). Declare the numbers once in the theme and read
**named guide points** per view instead of hand-constants — the engine derives them, so eyes/ears/neck
can't drift and the profile eye lands forward automatically:

```drw
theme ro:
  figure:
    heads 3.5
    headW 22
    eyeLine 0.62   # fraction of head height from the crown
    earLine 0.58
    eyeSep 10
# in a draw applying the theme, `fig` is bound over its own w×h:
circle ink fig.eyeL 1            # front: symmetric eyes on fig.eyeL / fig.eyeR
circle ink fig.side.eye 1        # side: one eye, shifted forward off centre
lobe skin fig.earL 4:13 6        # ear on the ear line (no more "wulst" guessing)
```

Views: `fig.front` / `fig.side` / `fig.back` re-view the same numbers; scalars (`fig.headH`,
`fig.center`, …) and points (`fig.crown`/`chin`/`neckL`/`neckR`/`shoulderL`/`shoulderR`/`hipL`/`hipR`)
are all readable. `context` prints the numbers. (The hand-constant block above still works as the
theme-less floor.)

**Build the head and headwear from the organic constructors, not hand poly-lists** (ADR-0093) — they
are exact analytic shapes, even-diameter consistent with `circle`/`ellipse`, smooth at any size:
`dome` = skull / helmet / hat crown; `lobe` = ear / hair strand / plume / hat tassel; `crescent` =
hair fringe / hat-brim curve / eyelid; `band` = a curved hat band, and **3–4 stacked `band`s over a
`dome` read as a turban, not a helmet**. These structurally retire the conical-neck / bulging-ear /
missing-tassel / "helmet-instead-of-turban" / angular-form defects.

**Import-assist alternative** (ADR-0093, for a one-off portrait where an external generator helps):
external PNG → `import name = "…" sha256 …` → `quantize pal` (deterministic OkLab palette snap) →
`outline` → `critique`. Determinism holds from the `sha256` pin onward. The parametric constructors
above stay the main path for anything needing view consistency.

| Figure | Canvas | Head:body | Notes |
|---|---|---|---|
| Normal (knight, archer, mage, robot) | 40–52 × **60–64** | **~1:3.5–4** | head+headgear ≈ 40 % of height; figure fills ~85–90 % of canvas |
| Stocky (dwarf smith) | 44–48 × **56** | **~1:2.5** | short legs, wide torso; same `footLine` discipline |
| Contact ellipse room | — | — | `footLine ≈ canvasH − 5`; ellipse 1px below it |

**Share the vertical lines across views; re-derive horizontal attach-x per view** (§5) — a profile
shifts its mass forward, so the same `shoulderLine` is safe but the same shoulder-x is not.
Confirm centering with `--inspect` `alphaCoverageBBox`.

**Budget vertical headroom for tall headgear explicitly.** A pointed hat/plume/crest eats into the
space above `headTop`; the constants block doesn't remove that arithmetic — check `tip-y ≥ 0` by hand
before the first render, or the tip clips the canvas top on a chibi figure that's already ~4 heads
tall in a fixed `H`.

## 3. Faction recolor — parametric parts, never themes

A theme *palette* **does not cross a `stamp` boundary** (SKILL.md § Gotchas) — a stamped part resolves
its `pal` in its own scope, so a host theme-swap never reaches it. (A theme *light* is different: the
file-level `use` applies the theme to *each* draw as it renders — the composer AND every stamped part
— so the shared default light does reach the parts. Use a theme for the light, parametric params for
the recolor.) **All 7 first-run builds converged on the parametric path** for colour; it is also the best-scoring axis (recolor Ø 1,4). Pass the 1–2 variant
colours as a draw param, derive the rest, and make a **thin non-parametric wrapper per variant** — the
only export price:

```drw
draw torso(c) 16x18:                 # c = the faction cloth colour
  body = poly(2:0, 13:0, 12:17, 3:17)
  fill c body
  fill lit(c) body.intersect(rect(0:0, 6:17))    # toward light
  fill shd(c) body.intersect(rect(10:0, 15:17))  # away from light
  # (pixels: parts derive pal keys from the arg instead — knight: `pal: f = c`)

draw figure(c) 24x60: …             # composer takes the same param
draw figureRed 24x60:               # thin wrapper — 1 literal = 1 faction
  stamp figure(#a83a36) 0:0
```

**Recolor is parametric only.** Thread the faction colour through the part's parameter — one literal
per faction. The exact-swap `replace` filter was removed (ADR-0094): after `model`/`cel` shading the
committed RGBA it matched no longer exists, so an exact swap is brittle. For a quick whole-figure tint
use the `tint` flag on `stamp`/`fit`; for real faction variants, parametrize the part.

## 4. Seam contract — no floating limbs

The character-specific core bug (5/7 first runs; each gap cost ~1 full iteration). **A bbox overlap
does not prove pixel contact** (smith's fist↔haft overlapped in bbox, rendered separate). The
structural fix is **`pin`/`fit`** (ADR-0087): a part declares its seam rows as `pin`s in its own
space, and `fit` *solves* the placement so the pins coincide — contact is guaranteed by the engine,
not by a hand-computed `stamp` coordinate, and a residual seam raises **`W010`** (render) / **C007**
(`critique`) instead of shipping silently. Four rules:

- **(a) Pin each seam in the part's own space; `fit`, don't hand-stamp.** Each part carries a `pin`
  at its seam row; the body seeds the root pin once and fits the rest, which auto-registers the
  fitted part's pins so the chain continues. Verified pattern:

  ```drw
  draw torso(c) 12x18:
    …
    pin neck     6:0     # top seam (bottom-centre of head lands here)
    pin shoulder 11:3
  draw figure(c) 24x60:
    stamp torso(c) 6:(shoulderLine - 2)
    pin torso.neck (6+6):(shoulderLine - 2)     # seeds ALL torso pins in canvas space
    fit head.chin torso.neck shadow             # contact-guaranteed; `shadow` = auto contact pool
    fit armL.shoulder torso.shoulder             # chains off torso's seeded shoulder
  ```

  `pin torso.neck …` on a real part now seeds **all** of torso's pins (neck, shoulder, hip…) from the
  one anchor — the earlier "only the named key registers" trap (a `fit …torso.hip` throwing E001) is
  gone. The old hand-offset form (`stamp head 4:(shoulderLine - 15)` with a socket *comment*) still
  works but reintroduces the off-by-one gap `fit` removes — prefer `fit`. **Plant standing figures
  with the `shadow` flag**, not a hand `ellipse cool.alpha(30%)` — it pools under the part's footprint
  bottom (the feet), not the fit pin, so a joint-to-joint fit (`leg.hip → torso.hip`) still drops
  the shadow under the feet, never at the hip. `fit` checks contact at the **moment it runs**, not on
  the final composite — fit a covering part (a robe hem, a back-mounted cape, §5(b)) only after the
  part it must cover is already placed, and expect a harmless `W010` on an assembly's very first
  (root/ground-oracle) `fit`, since nothing precedes it yet. Both are expected, not bugs.

- **(b) Cut parts along the overlap, not the anatomy.** Pauldron belongs to the *arm* (covers the
  torso shoulder when stamped), faulds/skirt to the *torso* (covers the leg tops) → a slightly wrong
  stamp coordinate cannot open a gap.
- **(c) The silhouette reaches the canvas edge on the seam side** — **no transparent buffer row**. In
  a `pixels:` grid a fully-transparent **last** row silently enlarges the footprint and seams a 1px
  gap below the next part — that is **W009** (`check --lint`); it was the knight's #1 gap cause.
- **(d) Overlap the seams by 1–2px** from the start (archer/mage did this and never floated) rather
  than butting them exactly.
- **(e) A pin must sit ON the part's own ink — contact ≠ correctness.** `fit` guarantees the pins
  *coincide*, not that the part lands where intended: a `chin` pinned in the empty rows *below* the
  head lands the head floating above the neck even though C007 is green (the 2026-07-10 wizard —
  `critique` passed, the head hovered). A target pin >2px off the part's ink now raises **`W011`**
  (loose pin). Put each seam pin on the part's real edge pixel (the head's bottom-centre ink, the
  sleeve's cuff), and **read `render <file>#<draw> --explain`** — it prints, per `fit`, where the
  pin landed, whether it coincides, and the pin-to-ink gap.

**Per-joint crop before "done":** for every seam (neck, shoulder/hip, hand↔prop) render a tight
`--crop` zoom — the full-body @4 is too small on a 56px figure to trust, and a colour-similar
neighbour can hide a multi-pixel gap (villager's torso rip showed **only** under `--silhouette`).
`W011` and `--explain` catch the *placement* class the crop's eyeball is meant to; use both.

## 5. Views — front, side, back

### 5a. Front vs. side — a different pose, not a mirror

Front→side is a **different pose**, not a mirror (`flip`/`mirror` only swaps left/right *within* a
pose). All 7 runs confirmed the split:

- **Redraw** the parts that **lead the pose axis**: head (nose/visor/brim point forward), torso
  (front vs. back drape), the leading arm. A profile also reads **thinner** than a front — widen the
  side torso to ~0.8× the head width, or the head dominates and the figure looks bobble-headed
  (Knight).
- **Reuse** the **pose-invariant** parts: bow, quiver, staff, hammer, boot, leg.
- **Held prop: grip it, don't hand-flip it (HV6).** Give the prop a `grip` pin, author it once in its
  true orientation (blade up), and `fit sword.grip hand.grip` in every view — the grip stays in the
  hand and the blade keeps its direction. A blanket `stamp sword … flipy` per view is the 2026-07-10
  knight bug: it pointed the blade up in front, **down** in side, and reversed on the back (hilt in
  the air). The figure's per-view flip is a *separate* `fit`; it must never touch the prop. Mirror the
  prop deliberately only when a view truly needs it, with the prop's own `fit sword.grip hand.grip
  flipx` (horizontal mirror, blade still up — the pin rides the flip and stays in the hand).
- **Orient a held prop per view with `aim`, not a redraw (ADR-0092).** Give the prop a second pin
  (`tip`) and `fit sword.grip hand.grip aim tip <pt>` to rotate it about the grip until the tip points
  at a canvas point — the sword cants forward in side view (clear of the head), the bow angles out on
  the back. Pick a clean angle: nearest-neighbour rotation of a *thin* limb can open a 1-px pinhole
  (C008) — widen a 3-px bow limb to 4 px, or nudge the aim point (`render --explain` prints the solved
  angle; `critique` catches the hole).
- **Push the far limb back** with a **neutral-grey** `tint` (`tint #2b2b2b 40%`, R=G=B — the cheapest
  depth cue) + a small offset. A **chromatic** `tint cool 40%` is safe **only on already-cool
  material** (knight steel, mage boot); on warm/saturated material it rotates the hue (§6).
- **Symmetric pair once, not twice:** draw one limb, mirror it — `mirror x=24: stamp leg(e) 20:36
  anchor top`, or `flipx` on the second stamp. Both work first-try; don't hand-copy two near-identical
  stamps (skeleton did and paid the boilerplate).

### 5b. Back view — the third view, not front-flipped either (HV4)

Back gets its **own composer and, unlike side, an inverted prop z-order** — the 2026-07-10 run's
worst-scoring structural bug after shading (Assassin, human-graded worst of four). Four rules, each
probe-verified (a compact 4-part front/side/back rig, `--png@6`, scratchpad — not shipped):

**(a) Part selection: no face; a front-posed limb still reads as "facing front" from behind.** The
back head draws hair/nape/collar — **never** eyes/brows/mouth. A pose-invariant limb (a straight
sleeve, a hanging arm) reuses as-is; a limb posed *toward the viewer* (raised to hold a bow, reaching
forward) still reads as facing front when reused unchanged on the back — redraw it relaxed, or accept
the left-right swap in (c) below instead of a literal redraw.

**(b) Declare z-order with `behind`/`front`, don't rely on fit order (ADR-0092).** A part's layer is
set by a trailing `behind <part>` / `front <part>` clause on its `stamp`/`fit`, not by where it sits
in the body — so the intent is explicit and `critique`'s **C013** verifies it. Front/side hide a prop
behind the torso; back mounts the same class of prop *over* the figure and tucks the held prop
*behind* it:

```drw
draw figureBack WxH:
  fit torsoBack.neck cx:shoulderY          # root first, as always
  fit headBack.nape torsoBack.neck
  fit armL.shoulder torsoBack.shoulderL
  fit armR.shoulder torsoBack.shoulderR
  fit cape.attach torsoBack.cape           # cape over the body (its own layer)
  fit pauldron.inner a.shoulderL front cape    # shoulders ABOVE the cape — explicit
  fit sword.grip a.grip aim tip 3:34 behind cape   # slung sword BELOW the cape, canted out
  outline
```

The 2026-07-10 defects this fixes: the Knight back sword painted *in front of* the sprite (declare it
`behind cape`), the side sword stabbed *into the head* (`aim` cants the blade forward), and pauldrons
punched *through* the cape (`front cape`). The old "make it work by fit order" rule was fragile — an
intervening inline paint (a `fill`, a detail `px`) is a barrier that pins order, and C013 turns any
un-honored relation into a red, positioned finding.

**(c) Front and back mirror left↔right at the shoulder/hip attach — the figure turned around, the
part didn't.** Reuse the identical, non-mirrored part draws and swap which named pin each fits to:

```drw
# front: armA -> shoulderL, armB -> shoulderR
# back:  armB -> shoulderL, armA -> shoulderR     (same two arms, sides swapped)
```

A same-side limb/prop front *and* back is also what collapses `critique`'s C009 sibling check by
construction — the mirror fixes both the read and the metric at once.

**(d) Side view: clamp a loose part to the body's own silhouette instead of letting it overstep.** A
cape/cloak authored with its attach pin at the shape's geometric middle (not its edge) hangs half
*behind* the body and half *over* it — the 2026-07-10 Assassin side-cape bug ("juts too far right,
into the character"). Clamp the region to the half behind the attach pin before shading it:

```drw
draw cloakSide WxH:
  raw      = curvePoly(…)                         # authored generously, spans past the attach pin
  cloakReg = raw.intersect(rect(0:0, attachX:h))   # keep only the far side of the pin
  cel cloakReg cloakMat 3
  pin attach attachX:0
```

## 6. Material ramps & light (baked in the colour system)

One named contract, every part derives its tones — light consistency becomes structural, not
disciplinary. **The per-view-mirror bug** (side-facing-right ⇒ back lit, chest shaded) is the #1
lighting failure, and it is now closed **structurally**, not by willpower: put ONE `light` in a
`theme`, `use` it, and it becomes the outermost light of *every* drawing that applies the theme
(ADR-0086 tier 3). Front, side, and every recolor variant then read the **same** world-space source
— the lit edge cannot land on a different side per view, because there is only one light to mirror.

```drw
theme figTheme:
  light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # ONE source; source up-left ⇒ up-left edge lit

use figTheme                          # every draw below shares `sun` as its outermost light

draw torsoFront(c) 14x18: …           # `model body c metal` — no lit block; inherits `sun`
draw torsoSide(c)  14x18: …           # a DIFFERENT pose, same `sun`; lit edge stays world-left
```

A trailing `light L` on one `model`/`cel` still overrides it locally (resolution order: explicit
`light L` > theme default — the `lit L:` block was removed, ADR-0094). Confirm cross-view coherence
numerically: the lit third of the silhouette is the same world side in both `--inspect`ed views.

**Shade volumes with `model` — it is the default now, even at ≤64px** (ADR-0089): the body shade
follows the reconstructed surface normal, so a torso/limb reads as a rounded form with a **smooth,
form-following terminator** (not the old flat linear ramp), and a dark base never crushes to black.
`cel REGION MAT N` renders that *same* body as `N` crisp bands — the **opt-in** RO cel look; pick
`N` 3–4 for a chibi. Smooth is the default; reach for `cel` only when you want visible hard bands.

The hand warm/cool `fn` ramp below stays a valid **lightweight alternative** — for flat/painterly
parts, `pixels:`-grid parts that derive `pal` keys, or when you want full manual control of every
tone — one warm/cool contract, every part derives its tones:

```drw
warm = #ffe8bf                       # light colour
cool = #2c3550                       # cool shadow complement, never pure black
fn lit(c)  = c.litTone(warm, 22%)    # toward light — litTone (= warm mix), not bare lighten
fn shd(c)  = c.shadowTone(cool, 20%) # darken + capped cool nudge — bakes the magenta-cap below
fn deep(c) = c.shadowTone(cool, 34%, 20%)
```

(`litTone`/`shadowTone` are the ADR-0086 helpers; the equivalent hand form is `c.mix(warm, 22%)` and
`c.darken(10%).mix(cool, 20%)`. Prefer the helpers — `shadowTone` bakes the hue cap for free.)

**Shade warm materials with `darken()`, never a raw cool `mix`** — `skin.mix(cool, 20%)` runs the
short OkLCh arc through magenta → a pink "shadow" (hit by archer, villager, smith; robot on emissive
via `tint`). Full rule + the safe `darken().mix(cool, 12%)` recipe: SKILL.md / reference.md § Color.
A raw `mix(cool)` is safe only on **already-cool** cloth (mage's indigo robe).

**Dark material needs a deliberate value-spread dose, or `critique`'s C004 stays red** (Assassin,
Wizard). A `cel`/`model` pass on a near-black base can sit under C004's 0.15 luminance-spread floor
even after shading. **The canonical fix is the material's own `spread N%`** (ADR-0091) — one knob that
scales the highlight + shadow doses symmetrically, so the value range comes *from the form shading*:

```drw
material cloth = #2a2333 cloth spread 300%   # dark cloth: crank spread until C004 clears
```

> **Anti-pattern (retired W2-1b, W013 preview): the hand corner patch.** Do **not** paint value spread
> by clipping a lit/shadow tone to a sub-rect — `fill darkC.litTone(warm, 44%) reg.intersect(rect(…))`
> or a `fn hi/lo` ramp. It reads as a **visible rectangular block** that collides with the form shading
> (the exact defect the 07-10 human grading flagged on every dark part). Use material `spread` instead;
> a CI guard (`examples-critique.test.ts`) rejects the idiom in `examples/characters-ro`.
>
> *Caveat for `model` (smooth) on a **dark monochrome** part:* the smooth terminator is a gradient, so
> only the peak pixel reaches the C004 `p90` — `spread` must run **high** (assassin cloth `~780 %`), and
> lifting a near-black base slightly off the floor (`#2a2333`→`#37304a`) helps it clear without the lit
> face washing warm. `cel`'s flat top band reaches `p90` far cheaper — prefer `cel` for tight-palette
> dark masses. Keep small **bright accents** (a gold hat band, a gem) as a flat `fill`: they *supply*
> the part's p90; modelling them darkens their shadow side and can *lower* C004.

**Hanging cloth → `drape` profile.** A long cloak/skirt/cape shaded with the default `round` field
curls into a **"turtle-shell"** — it darkens toward the hem because the 2D field pins the bottom edge
to zero. Give the drape material the **`drape`** profile (`material cape = capeRed cloth drape spread
200%`): a per-row half-tube that curves only across its width and stays even down its length, so the
hem does not darken and the lower edge reads as standing off. Use `drape` **only** for hanging drapes.

**Stacked limb parts → `over` co-shading.** A leg + boot (or arm + glove) shaded as separate `model`/
`cel` passes restart the height field at the seam — a visible shading break mid-limb. Shade both
**`over` their union** so they read as one continuous form:

```drw
limbReg = thighReg.union(shinReg).union(bootReg)   # the whole limb is one shading unit
model thighReg clothMat   over limbReg
model shinReg  leatherMat over limbReg
model bootReg  leatherMat over limbReg             # field is continuous; each keeps its own material
```

Verified ramps (module bindings; each part pulls its tones from these):

| Material | Tones (light → dark) | Source |
|---|---|---|
| **Metal (5-tone)** | `#eaf2fa` `#b6c3d6` `#8494ac` `#55617c` `#232838` | knight (spec/lite/mid/dark/ink) |
| Metal (mecha) | `#cfd6e0` `#949cab` `#656d7c` `#454b58` `#22262e` + joint `#383c46` | robot |
| **Skin** | `#d69b64` / `#e8b489`, shade via `darken` | archer / mage |
| **Cloth (faction)** | red `#a83a36`, green `#3f7a3e`, indigo `#40357e` → `lit/shd/deep` | archer / mage |
| Leather / wood | `#6d4527` / `#925c2c`, dark `#402616` | archer |
| **Bone** | one base + `accent.lighten(16%)` / `.darken(18%)` steps | skeleton |

Spec/highlight only as a 2–3px cluster top-left; core shadow as the dark column on the light-averted
side; give a helmet/knee **one** glint pixel. Thin blades/staves: core 2–3px, light edge (spec) on
the lit side **without** an outline, dark edge as the outline — a full outline both sides makes every
blade a club. **Never `stroke` a form ≤~4px min-extent** — the inner border eats the whole fill
(skeleton's rib erosion; SKILL.md § Gotchas). Contour thin bones/blades via colour contrast + value
shading instead.

**RO silhouette outline — one `outline` over the composited figure (ADR-0090).** The signature dark
contour is a **single** whole-figure pass: put a bare **`outline`** as the **last statement of the
assembly `draw`**, after every `pin`/`fit`/`stamp`. Bare = 1px, colour derived from the figure
(warm-black for warm, cool-black for cool); pass a colour to pin it (`outline ink`). **Do not bake
`outline` into each part** — per-part rings survive assembly as internal dark seams and never form
one clean silhouette (the biggest outline failure of the 07-10 run). Stay at **width 1** for 64×128
chibi — `outline 2` clubs a thin bow/staff. The pass floors the silhouette at 50% alpha, so a soft
contact shadow (`alpha 38%`) or AA fringe is **not** ringed — you may paint the contact shadow first
and still outline last. It only paints *outside* the mass, so fingers/staff cores stay intact. Want a
deliberate part-to-part separator line? That is the one case for a local per-part `outline` (or a
`line ink`), applied on purpose — not the silhouette default.

## 7. Chibi face — readable at 64×128 (HV3)

A face at chibi part-scale (`headFront`/`headSide`/`headBack` ≈ 18–28px wide) reads as "two dots" if
you stop at pupils — the worst-graded defect of the 2026-07-10 run (Archer). Five marks make it a
face, in this order, on the **head part** (not the composer):

1. **Skin base via `model`, not `cel 2`.** `model face skinMat` gives a smooth, form-following
   terminator at any size (ADR-0089) — a small `cel N` band on a face is a **value trap**: `cel skin
   2` throws half the face into the dark band and reads as stubble/beard (Wizard). Want cel bands on
   a face anyway? Use `N ≥ 3` so the darkest band stays confined to the far corner.
2. **Eyes: white + iris + pupil + one highlight pixel, not a bare dot.** Four layers, four lines —
   white almond, coloured iris, dark pupil, one light pixel offset toward the brow:

   ```drw
   eyeL = ellipse(10:19, 3:2)
   fill white eyeL
   circle iris 10:19 2 fill
   px pupil 10:19
   px highlight.alpha(90%) 9:18
   ```

3. **Brows: a short 1px stroke above each eye, clear of the hairline.** `line brow 8:15 12:14 w1` —
   leave ≥2px of skin between the bang's bottom edge and the brow line, or the two dark shapes merge
   into one shadow and the brow disappears.
4. **Nose: one 1–2px shadow tick, never an outline.** A stroked nose bridge at this scale reads as a
   wart; a single darker vertical `line`/`px` between the eyes is enough.
5. **Mouth: one short stroke, not a filled shape.** A 3–4px `line` at ~70 % alpha reads as a closed
   chibi mouth; a filled shape reads as a wound.

Probe-verified (`--png@8`/`--png@1`, scratchpad, not shipped): this five-layer recipe on a 28×34
`headFront` reads with legible eyes/brows/nose/mouth at both inspection and native scale — the
two-dot failure is a missing-layer problem, not a resolution ceiling.

## 8. Verification cadence

`check` catches almost nothing here — quality is ~100 % visual, and `critique --strict` passing
verifies **structure** (contact, colour-count, silhouette parity), not craft — the 2026-07-10 run
shipped harsh shading, a floating head, a reversed sword, arms on the back, a two-dot face, and weak
outlines all green. The render you look at, not the exit code, is the craft gate. After each edit
batch:

0. **Gate:** `critique --as character --strict --json` → `pass:true` (must-fix C007 catches a
   floating/seamed part under `--strict`; a composed presentation sheet is auto-excluded from the
   C009/C011 family, and C009 never fires between a subject's own front/side/back views — `pass:true`
   no longer needs a sheet-split workaround), then **answer its seam-contact rubric** by looking.
1. `check --lint --json` = `[]` (W002 catches a part that's neither exported, stamped, nor
   `fit`-attached; **W009** the transparent end-row).
2. **Part fragment `--png@6–8`** — each part isolated with literal args (`#head(#a83a36)`); reuse the
   exact numbers in the `stamp` line, no surprises.
3. **Composite `--png@4`** — the full figure; the light contract and proportions read here.
4. **`--silhouette --png@4`** (ADR-0083) — the shape-only black-out. Confirms seam contact + a
   readable archetype signal (helmet+plume, bow-arc+arrow, pointed hat) that a colour render can hide.
5. **Native `--png@1`** — every figure must read as its archetype at 100 %.
6. **Per-joint `--crop`** on each seam (§4) — bbox overlap ≠ pixel contact.
7. **`sheet file.drw --png@4`** over the export wrappers — cross-view × cross-faction consistency
   (grey-value / ramp / hue) in one grid.
8. `build` → look at the artifacts.

The cheapest runs (2–3 full iterations) followed this cascade top to bottom; the expensive ones
(9–11) skipped the `--silhouette`/joint-crop steps and rediscovered each seam gap in a full render.
