# Drawstic character craft

How to build a **modular game figure** (48–64px, or 64×128 chibi with front/side/back — ADR-0089/0090)
that reads as the archetype on the **first attempt with few iterations**. SKILL.md § Characters gives
the mandatory order + checklist; this is the detail. Every rule comes from a shipped, check-clean
recipe (`examples/characters-ro2/*.drw`) or a rendered probe. `check` verifies grammar only — **seam
contact, silhouette legibility, a genuine side view, and archetype/sex reading are 100 % visual and
silent to `check`; the render, the `--silhouette` black-out, and a per-joint `--crop` are the only
judges, and a clean `critique --strict` verifies structure, not craft.**

Characters are **not scenes and not icons.** Keep one **light contract** (a `theme` `light`) and
`model`/`cel` form shading (it works at chibi scale — §6); the contact-shadow ellipse. The *raw*
`shadeRegion`/`rim` veils are too weak at ≤64px — reach for `model`/`cel`, never the low-level
primitives. Add what is character-specific: the **figure oracle** (§2), **organic head construction**
(§3), parts + **seams** (§5), **three views** with declared z-order (§6), faction recolor (§4).

## 1. The fixed build order (the one canonical path)

Do not reorder:

1. **Theme = one `light` + the `figure:` oracle** (§2). The light makes cross-view lighting structural;
   the oracle makes eye/ear/neck/shoulder positions structural.
2. **Materials** — metal/skin/cloth as `material` bindings with `spread`/`drape` where needed (§6).
3. **Parts** — parametric `draw part(c)`, each declaring its seam rows as **`pin`s**; build the head +
   headwear from the **organic constructors and a copied archetype scaffold** (§3), not hand poly-lists.
4. **Assembly back-to-front via `fit`** (§5) — pin-anchored, contact-guaranteed; `behind`/`front` sets
   prop z-order, `aim` orients a held prop, `fit … shadow` plants a standing figure (§6).
5. **One bare `outline`** as the assembly draw's last statement (§6).
6. **`critique --as character --strict`** → `pass:true`, then answer its rubric by looking (§8).

## 2. Proportions — the figure oracle (ADR-0093)

The character pendant to scene-craft's *"terrain is a function"*: declare the proportion numbers **once
in the theme** and read **named guide points** — the engine derives them, so eyes/ears/neck/shoulder
can't drift and the profile eye lands forward automatically. This retires the hand `headTop/
shoulderLine/…` constant block (which stays as the theme-less floor).

```drw
theme ro:
  light sun = dir 1:1 #ffe6b0 amb #2a3a5e 16%   # §6 — shared by every view
  figure:
    heads 3.5        # figure is 3.5 head-heights tall
    headW 22
    eyeLine 0.62     # eye line as a fraction of head height from the crown
    earLine 0.58
    eyeSep 10        # neckW/shoulderW/hipW default off headW if omitted
```

In any draw applying the theme, **`fig`** is bound over that draw's own `w`×`h`:

```drw
circle iris fig.eyeL 1        # front: symmetric eyes on fig.eyeL / fig.eyeR
lobe skin fig.earL 1:13 5     # ear on the derived ear line — no "wulst" guessing
circle iris fig.side.eye 1    # side: one eye, shifted forward off centre automatically
```

- **Points**: `fig.crown`/`chin`/`neckL`/`neckR`/`eyeL`/`eyeR`/`earL`/`earR`/`shoulderL`/`shoulderR`/
  `hipL`/`hipR`. **Scalars**: `fig.headH`/`headW`/`eyeY`/`earY`/`center`/`shoulderY`/`hipY`/…
- **Views**: `fig.front`/`fig.side`/`fig.back` re-view the same numbers (`fig.side.eye`, `fig.back.earL`).
  Crown at `y=0`, one head = `h/heads`; **side faces `+x`** (eye forward, ear toward the back) — the
  structural fix for "eyes too central in profile".
- **A head *part* is one head tall.** The oracle lays `heads` over the drawing's full height, so a
  standalone head-part draw uses its own tiny theme with **`heads 1`** (the whole part canvas = one
  head — see the scaffolds in §3); the project figure keeps the real `heads` for the full-body draw.
- `context` prints the figure numbers. Chibi vs. realistic vs. mecha is only different numbers.

## 3. Head & headwear archetype scaffolds — copy, then mutate

Drawstic ships **no** character library and **no** `std/chibi` — it gives you mechanism, you own the
style. Below are **complete, runnable** head/face/headwear templates built from the organic
constructors (`dome` skull/helmet/crown · `lobe` ear/nose/plume/tassel · `crescent` fringe/brim ·
`band`; **stacked `band`s over a `dome` = a turban, not a helmet**) and the `fig` oracle. **Copy one
into your project and mutate it** — ownership stays with the project, so there is no shared reference
and no forced uniformity. Three face archetypes show the range (round chibi · slim/realistic ·
angular mech) plus a turban headwear scaffold; each is probe-verified front **and** side (`--png@6`).

**Constructor cheatsheet:** union the skull + ears into one region and `model` it **once** so it shades
as a single form; paint the face features on top. `dome(c, rx:ry)` is the flat-based upper ellipse
half; `lobe(base, tip, w)` a teardrop (round cap Ø`w` at `base` → point at `tip`); `crescent(c, rx:ry,
thick, dir)` a tapering band (fringe/brim); `band(p0, p1, p2, w) fill` a width-`w` ribbon through 3
points.

### 3a. Round chibi (RO) — big round head, big eyes

```drw
theme roundHead:
  mode pixel
  light sun = dir 1:1 #ffe6b0 amb #33405e 16%
  figure:
    heads 1
    headW 26
    eyeLine 0.66
    earLine 0.62
    eyeSep 13

skin = #e7b088
hair = #47331f
hairLite = #6b4d2e
white = #fbf6ee
iris = #4f7bb0
pupil = #221a1a
mouth = #9a5240
material skinM = skin skin

draw roundFront 30x34:
  use roundHead
  head = ellipse(15:18, 12:14).union(lobe(fig.earL, 0:22, 6)).union(lobe(fig.earR, 30:22, 6))
  model head skinM                                 # skull + ears shaded as one form
  bangs = crescent(15:14, 13:12, 6, 0:1)           # fringe hugging the crown
  fill hair bangs.intersect(rect(0:0, 29:16))
  fill hairLite bangs.intersect(rect(0:0, 29:9))
  fill white ellipse(fig.eyeL, 3:3)                # eyes on the oracle lines
  fill white ellipse(fig.eyeR, 3:3)
  circle iris fig.eyeL 2 fill
  circle iris fig.eyeR 2 fill
  px pupil fig.eyeL
  px pupil fig.eyeR
  px white.alpha(90%) (fig.eyeL - 1:1)             # catch-light toward the brow
  px white.alpha(90%) (fig.eyeR - 1:1)
  px skin.darken(18%) 15:23                        # nose tick
  line mouth 13:26 17:26
  outline

draw roundSide 30x34:
  use roundHead
  # side faces +x: ear via fig.side.ear (toward the back), nose lobe out front
  head = ellipse(13:18, 12:14).union(lobe(fig.side.ear, 5:23, 6)).union(lobe(23:19, 27:18, 4))
  model head skinM
  bangs = crescent(13:14, 13:12, 6, 0:1)
  fill hair bangs.intersect(rect(0:0, 28:15))
  fill hairLite bangs.intersect(rect(0:0, 28:9))
  fill white ellipse(fig.side.eye, 3:2)            # one almond eye, shifted forward
  circle iris fig.side.eye 1 fill
  px pupil fig.side.eye
  px skin.darken(20%) 25:20                         # nostril tick
  line mouth 20:25 23:25
  outline
```

### 3b. Slim / realistic — dome cranium + tapered jaw

```drw
theme slimHead:
  mode pixel
  light sun = dir 1:1 #ffe6b0 amb #33405e 16%
  figure:
    heads 1
    headW 20
    eyeLine 0.54
    earLine 0.5
    eyeSep 9

skin2 = #d9a06f
hair2 = #2c2116
white2 = #f6efe4
iris2 = #6b4a2e
brow2 = #3a2c1c
material skin2M = skin2 skin

draw slimFront 26x38:
  use slimHead
  cranium = dome(13:19, 11:13)                      # upper skull, flat base
  jaw = curvePoly(4:17, 13:33, 22:17)               # tapered chin below
  head = cranium.union(jaw).union(lobe(fig.earL, 1:20, 4)).union(lobe(fig.earR, 25:20, 4))
  model head skin2M
  fill hair2 crescent(13:14, 12:11, 5, 0:1).intersect(rect(0:0, 25:14))
  fill hair2 dome(13:13, 12:9).subtract(dome(13:12, 10:7))   # hair shell (dome minus dome)
  fill white2 ellipse(fig.eyeL, 2:2)
  fill white2 ellipse(fig.eyeR, 2:2)
  circle iris2 fig.eyeL 1 fill
  circle iris2 fig.eyeR 1 fill
  px #201810 fig.eyeL
  px #201810 fig.eyeR
  line brow2 6:17 11:16                              # straight brows above the eyes
  line brow2 15:16 20:17
  line skin2.darken(20%) 13:20 13:24                 # nose bridge
  line #8a4a3a 11:28 15:28                           # mouth
  outline

draw slimSide 26x38:
  use slimHead
  cranium = dome(12:19, 11:13)
  jaw = curvePoly(3:17, 13:33, 20:18)
  nose = lobe(20:19, 25:21, 4)                        # nose profile out front (+x)
  head = cranium.union(jaw).union(nose).union(lobe(fig.side.ear, 4:22, 4))
  model head skin2M
  fill hair2 dome(12:13, 12:9).subtract(dome(12:12, 10:7))
  fill hair2 crescent(12:14, 12:11, 5, 0:1).intersect(rect(0:0, 16:14))
  fill white2 ellipse(fig.side.eye, 2:2)
  px iris2 fig.side.eye
  px skin2.darken(22%) 23:22
  line #8a4a3a 18:28 21:28
  outline
```

### 3c. Angular mech — hard `dome` helmet + `band` visor + glowing optic

```drw
theme mechHead:
  mode pixel
  light sun = dir 1:1 #e8eefc amb #263049 18%
  figure:
    heads 1
    headW 26
    eyeLine 0.5
    earLine 0.5

steelC = #8f9bb0
visorC = #22303f
glowC = #58e0d8
trimC = #d9a03a
material steelM = steelC metal
material visorM = visorC metal

draw mechFront 32x36:
  use mechHead
  crown = dome(16:17, 13:12)                          # helmet dome
  face = poly(4:16, 28:16, 26:29, 16:34, 6:29)        # angular faceplate
  head = crown.union(face)
  cel head steelM 4                                    # crisp metal bands
  cel band(4:20, 16:18, 28:20, 7) visorM 3            # visor band across the eye line
  fill glowC rect(9:20, 23:22)                         # glowing optic bar
  px #ffffff 11:20
  fill trimC rect(15:3, 17:9)                          # crest fin
  line #4a5464 16:29 16:33                             # jaw seam
  outline
# side view: same crown+faceplate poly re-shaped for profile, band(...) sweeping to +x,
# the optic bar pushed toward the front edge — see examples/characters-ro2 for a full rig.
```

### 3d. Turban — stacked `band`s over a `dome` (reads as turban, not helmet)

```drw
turbCloth = #6a5aa8
turbLite = #8b7ccb
turbDark = #443a70
gemC = #e8c15a
material turbM = turbCloth cloth spread 220%

draw turbanFront 32x34:
  use roundHead                                        # reuse the round-head theme + face palette
  head = ellipse(16:20, 11:12).union(lobe(fig.earL, 4:23, 5)).union(lobe(fig.earR, 28:23, 5))
  model head skinM
  fill white ellipse(fig.eyeL + 1:2, 2:2)              # small face — the turban dominates
  fill white ellipse(fig.eyeR - 1:2, 2:2)
  px pupil (fig.eyeL + 1:2)
  px pupil (fig.eyeR - 1:2)
  line mouth 14:27 18:27
  turbCap = dome(16:15, 14:12)                          # cloth cap crown
  model turbCap turbM
  band turbLite 2:15 16:8 30:15 6 fill                 # 3 stacked wraps = turban
  band turbCloth 1:19 16:12 31:19 6 fill
  band turbDark 2:22 16:16 30:22 5 fill
  fill turbLite rect(14:11, 18:16)                      # front knot
  circle gemC 16:13 1 fill                              # jewel
  outline
# side view: same dome + 3 bands sweeping to the profile, plus a `lobe` tail at the back.
```

**Do not name a local binding `cap`, `w`, `h`, `shadow`, `tint`, `rim`, `grain`** (or another
directive/keyword) — `cap` is a stroke keyword-arg and hijacks the next command's argument (§ Gotchas).
The turban scaffold uses `turbCap`.

## 4. Faction recolor — parametric parts, never themes

A theme *palette* **does not cross a `stamp`/`fit` boundary** (a stamped part resolves its `pal` in its
own scope). A theme *light* **does** reach the parts (the file-level `use` applies the theme to each
draw as it renders). So: theme for the light, **parametric params for the recolor**. Pass the 1–2
variant colours, derive the rest, make a thin non-parametric wrapper per variant — the only export
price:

```drw
draw torso(c) 16x18:                 # c = the faction cloth colour
  body = poly(2:0, 13:0, 12:17, 3:17)
  model body c cloth                 # form shading supplies the value range (no hand tone patch)

draw figure(c) 24x60: …             # composer takes the same param
draw figureRed 24x60:               # thin wrapper — 1 literal = 1 faction
  stamp figure(#a83a36) 0:0
```

The exact-swap `replace` filter was removed (ADR-0094): after `model`/`cel` shading the committed RGBA
no longer exists, so an exact swap is brittle. For a quick whole-figure recolor use the **`tint` flag**
on `stamp`/`fit`; for real faction variants, parametrize the part. Recolor is the best-scoring axis when
parametric.

## 5. Seam contract — no floating limbs (`pin`/`fit`)

The character-specific core bug (5/7 first runs; each gap ≈ one iteration). **A bbox overlap does not
prove pixel contact.** The structural fix is **`pin`/`fit`** (ADR-0087): a part declares its seam rows
as `pin`s in its own space, and `fit` *solves* the placement so the pins coincide — contact is
engine-guaranteed, and a residual seam raises **`W010`** (render) / **C007** (`critique`) instead of
shipping silently.

```drw
draw torso(c) 12x18:
  …
  pin neck     6:0     # top seam (head's bottom-centre lands here)
  pin shoulder 11:3
draw figure(c) 24x60:
  stamp torso(c) 6:16
  pin torso.neck 12:16                 # seeds ALL torso pins in canvas space (pin-seeded root)
  fit head.chin torso.neck shadow      # contact-guaranteed; `shadow` = auto contact pool
  fit armL.shoulder torso.shoulder     # chains off torso's seeded shoulder
```

Five rules:

- **(a) Pin each seam in the part's own space; `fit`, don't hand-stamp.** `pin torso.neck …` on a real
  part seeds **all** its pins from the one anchor, so a later `fit …torso.hip` chains without
  re-declaring. Plant standing figures with the **`shadow` flag** (it pools under the footprint bottom
  — the feet — not the fit pin, so a `leg.hip → torso.hip` fit still drops the shadow at the feet), not
  a hand `ellipse` (that idiom is **W015**). Expect a harmless `W010` on an assembly's very first
  (root/ground) fit, since nothing precedes it yet.
- **(b) Cut parts along the overlap, not the anatomy.** Pauldron belongs to the *arm*, faulds to the
  *torso* → a slightly wrong stamp coordinate can't open a gap.
- **(c) No transparent buffer row.** A fully-transparent **last** `pixels:` row silently enlarges the
  footprint and seams a 1px gap — that is **W009**.
- **(d) Overlap the seams by 1–2px** from the start rather than butting them exactly.
- **(e) A pin must sit ON the part's own ink — contact ≠ correctness.** A `chin` pinned in the empty
  rows *below* the head lands the head floating even though C007 is green; a target pin >2px off the
  part's ink raises **`W011`**. **Read `render <file>#<draw> --explain`** — it prints, per `fit`, where
  the pin landed, whether it coincides, and the pin-to-ink gap.

**Per-joint crop before "done":** for every seam render a tight `--crop` — the full-body @4 is too small
on a 56px figure, and a colour-similar neighbour hides a multi-pixel gap (visible only under
`--silhouette`).

## 6. Views — front, side, back (one skeleton, three poses)

### 6·0. The canonical multi-view path: a skeleton (ADR-0095)

Declare the figure's attach points **once** as a `skeleton`, then make each view a `pose` of it —
instead of three assembly draws full of hand-placed coordinates. A pose folds the figure oracle to its
view and declares each joint's **auto-Z depth**, so the limb paint order falls out of the pose; no hand
`behind`/`front` on the body.

```drw
skeleton rig:                          # one rig; anchored joints usually read fig guide points
  chestF at fig.shoulder
  headF  at fig.neck
  shLF   at fig.shoulderL
  shRF   at fig.shoulderR
  hipLF  at 26:84                      # a tuned point where the oracle line doesn't suit
  hipRF  at 38:84
  # …side/back joints (a joint per body part; two parts sharing a point take different depths)

pose front over rig:
  view front
  chestF 0 z 0                         # JOINT DELTA° [z DEPTH] — DELTA 0 for a static view
  hipLF 0 z 0
  shLF 0 z 2
  headF 0 z 3                          # head highest → paints over the torso/arms

draw figFront 64x128:
  pose front
  fit torsoFront.neck bone chestF      # land the pin on the joint; inherit its pose orientation
  fit legFront.hip    bone hipLF shadow
  fit armFront.shoulder bone shLF
  fit helmFront.chin  bone headF
  outline
```

- **Give each body part its own joint.** Two parts that share a point (torso + head at the neck) get
  two joints at that point with **different depths**, so auto-Z stacks the head over the torso.
- **Depth = view stacking.** Higher `z` = nearer the viewer = painted later. Match it to the desired
  order; the back view's "arms behind the torso" is just a lower depth on the arm joints (no reordered
  stamp). `render --explain` prints every joint's solved position/angle/depth and the paint order.
- **Constraints.** `limit MIN:MAX` on a joint (mostly for FK/animatable limbs) makes an over-bent pose
  a positioned error, not a silent clamp.
- **Held props stay props.** A sword/bow/staff keeps its own `grip` fit + `aim` (§6a); a dominating
  cape stays an explicit `behind`/`front` layer (§6b) — auto-Z orders the body, overrides handle props.

The rest of §6 is the detail this path builds on: what to redraw per view (§6a), the back-view rules
and explicit prop z-order (§6b). See `examples/characters-ro2/*.drw` for four full skeleton rigs.

### 6a. Front vs. side — a different pose, not a mirror

`flip`/`mirror` only swaps left/right *within* a pose. Front→side is a **redraw**:

- **Redraw** the parts that **lead the pose axis**: head (from the side scaffold — nose/visor forward),
  torso (front vs. back drape), the leading arm. A profile reads **thinner** — widen the side torso to
  ~0.8× the head width, or the figure looks bobble-headed.
- **Reuse** the **pose-invariant** parts: bow, quiver, staff, boot, leg.
- **Held prop: grip it, don't hand-flip it.** Give the prop a `grip` pin, author it once in true
  orientation (blade up), and `fit sword.grip hand.grip` in every view — the grip stays in the hand and
  the blade keeps its direction. A blanket `stamp sword … flipy` per view points the blade the wrong way
  in side/back. The figure's per-view flip is a *separate* `fit` that never touches the prop.
- **Orient a held prop per view with `aim` (ADR-0092), not a redraw.** Give the prop a second pin
  (`tip`) and `fit sword.grip hand.grip aim tip <pt>` to rotate it about the grip until the tip points
  at a canvas point — the sword cants forward in side view (clear of the head). Pick a clean angle:
  NN-rotation of a *thin* limb can open a 1-px pinhole (C008) — widen a 3-px bow limb to 4 px, or nudge
  the aim point (`--explain` prints the solved angle; `critique` catches the hole).
- **Push the far limb back** with a **neutral-grey** `tint` (`tint #2b2b2b 40%`, R=G=B — the cheapest
  depth cue). A **chromatic** `tint cool 40%` is safe **only on already-cool** material; on warm/
  saturated material it rotates the hue through magenta (§ Color).
- **Symmetric pair once, not twice:** `mirror x=24:` a limb, or `flipx` the second stamp.

### 6b. Back view — its own composer, inverted prop z-order

Back gets its own composer. Four rules:

**(a) Part selection: no face; a front-posed limb still reads as "facing front" from behind.** The back
head draws hair/nape/collar — never eyes/brows/mouth (build it from the same `dome`/`crescent` skull,
minus the face marks). A limb posed *toward the viewer* redraws relaxed.

**(b) Auto-Z orders the body; `behind`/`front` is the override for props (ADR-0095/0092).** The pose's
per-joint depth already stacks the limbs (§6·0) — reach for an explicit trailing `behind <part>` /
`front <part>` clause on a `stamp`/`fit` only for a **prop** that doesn't ride a bone (a dominating
cape, a slung sword). It always wins over auto-Z, and `critique`'s **C013** verifies it. Front/side
hide a prop behind the torso; back mounts a cape *over* the figure and tucks the held prop *behind* it:

```drw
draw figureBack 64x128:
  fit torsoBack.neck 32:44                  # root first
  fit headBack.nape torsoBack.neck
  fit armL.shoulder torsoBack.shoulderR     # NB: left↔right swapped vs front (rule c)
  fit armR.shoulder torsoBack.shoulderL
  fit cape.attach torsoBack.cape            # cape over the body (its own layer)
  fit pauldron.inner a.shoulderL front cape        # shoulders ABOVE the cape
  fit sword.grip a.grip aim tip 3:34 behind cape   # slung sword BELOW the cape, canted out
  outline
```

The defects this fixes: a back sword painting *in front of* the sprite (→ `behind cape`), a side sword
stabbing *into the head* (→ `aim` cants the blade forward), pauldrons punching *through* the cape (→
`front cape`). An intervening inline paint (`fill`/`px`) is an ordering barrier; C013 turns any
un-honored relation into a red, positioned finding.

**(c) Front and back mirror left↔right at the shoulder/hip attach** — the figure turned around, the part
didn't. Reuse the identical non-mirrored parts and swap which named pin each fits to (front: armA→
shoulderL; back: armA→shoulderR). This also collapses C009's sibling-silhouette check by construction —
the mirror fixes the read and the metric at once.

**(d) Side view: clamp a loose part to the body's silhouette.** A cape whose attach pin is at its
geometric middle hangs half *over* the body ("juts into the character"). Keep only the half behind the
pin before shading: `cloakReg = raw.intersect(rect(0:0, attachX:h))`.

## 7. Materials, light & form shading

**One light contract, structural.** The per-view-mirror bug (side-facing-right ⇒ back lit) is closed by
putting ONE `light` in the `theme` and `use`-ing it: it becomes the outermost light of *every* drawing
that applies the theme, so front/side/back + every recolor variant read the **same** world-space source.
A trailing `light L` on one `model`/`cel` overrides locally (resolution: explicit `light L` > theme
default; the `lit L:` block was removed — ADR-0094). Confirm numerically: the lit third of the
silhouette is the same world side in both `--inspect`ed views.

**Shade volumes with `model` — the default even at ≤64px** (ADR-0089/0091): the body shade follows the
reconstructed surface normal (Poisson-inflated dome, no medial ridge), so a torso/limb reads as a
rounded form with a smooth terminator, and a dark base never crushes to black. `cel REGION MAT N`
renders that *same* body as `N` crisp bands — the opt-in RO cel look (pick `N` 3–4 for a chibi). Note:
`model` (continuous tones) can overshoot the character C006 palette ceiling at 64×128 for an
**indexed-PNG/SVG** target — `cel` is the palette-tight smooth path there (a straight RGBA PNG has no
palette budget). Verified material ramps:

| Material | Tones (light → dark) | Source |
|---|---|---|
| **Metal (5-tone)** | `#eaf2fa` `#b6c3d6` `#8494ac` `#55617c` `#232838` | knight |
| Metal (mecha) | `#cfd6e0` `#949cab` `#656d7c` `#454b58` `#22262e` | robot |
| **Skin** | `#d69b64` / `#e8b489`, response `skin` (shades via `darken`) | archer / mage |
| **Cloth (faction)** | red `#a83a36`, green `#3f7a3e`, indigo `#40357e` | archer / mage |
| Leather / wood | `#6d4527` / `#925c2c`, dark `#402616` | archer |
| **Bone** | base + `.lighten(16%)` / `.darken(18%)` | skeleton |

Three material knobs replace every hand tone patch (all trailing on the `material`, ADR-0091):

- **`spread N%`** — widens `hi`+`shade` symmetrically. **This is the canonical fix for a dark base's
  C004 value range** — never a hand `litTone(…).intersect(rect…)` corner patch (that reads as a
  rectangular block, is **W013**, and is CI-rejected in `examples/characters-ro2`). *Caveat:* `model`
  (smooth) on a **dark monochrome** part only reaches C004's `p90` at the peak pixel, so `spread` runs
  **high** (assassin cloth ~780–900 %) and lifting a near-black base off the floor
  (`#2a2333`→`#37304a`) helps; `cel`'s flat top band reaches `p90` far cheaper — prefer `cel` for
  tight-palette dark masses. Keep small **bright accents** (a gem, a gold band) as flat `fill`.
- **`drape`** profile — a *hanging* cloak/skirt shaded with the default `round` field curls into a
  "turtle-shell" (darkens toward the hem). `material cape = capeRed cloth drape spread 200%` gives a
  per-row half-tube that stays even down its length. Use `drape` **only** for hanging drapes.
- **`over UNION`** — a leg + boot shaded as separate passes restart the height field at the seam. Shade
  both **`over` their union** (`model bootReg leatherMat over legReg.union(bootReg)`) so they co-shade
  as one continuous limb; each keeps its own material.

Spec/highlight as a 2–3px cluster top-left; core shadow as the dark column on the light-averted side.
Thin blades/staves: core 2–3px, light edge on the lit side, dark edge as the outline — a full outline
both sides makes every blade a club. **Never `stroke` a form ≤~4px min-extent** (the inner border eats
the whole fill) — contour thin bones/blades via colour + value instead.

**RO silhouette outline — one `outline` over the composited figure (ADR-0090).** Put a bare **`outline`**
as the **last statement of the assembly `draw`**, after every `pin`/`fit`/`stamp`. Bare = 1px, colour
derived from the figure. **Do not bake `outline` into each part** — per-part rings survive assembly as
internal dark seams. Stay at **width 1** for chibi. The pass floors the silhouette at 50% alpha, so a
soft contact shadow is not ringed; it only paints outside the mass, so fingers/staff cores stay intact.

## 8. Chibi face — five marks (built into the §3 scaffolds)

A face at chibi part-scale reads as "two dots" if you stop at pupils. Five marks, in order, on the
**head part** (the §3 scaffolds already carry them):

1. **Skin base via `model`, not `cel 2`** — a `cel skin 2` throws half the face into a dark band and
   reads as stubble. Want cel on a face? `N ≥ 3`.
2. **Eyes: white + iris + pupil + one catch-light pixel** — four layers, not a bare dot (§3a).
3. **Brows: a short 1px stroke above each eye**, ≥2px of skin between bang and brow, or they merge.
4. **Nose: one 1–2px shadow tick**, never an outline (a stroked bridge reads as a wart).
5. **Mouth: one short `line` at ~70 % alpha**, not a filled shape (that reads as a wound).

## 9. Verification cadence

`check` catches almost nothing — quality is ~100 % visual, and `critique --strict` passing verifies
**structure**, not craft. The render you look at is the gate. After each edit batch:

0. **Gate:** `critique --as character --strict --json` → `pass:true` (C007 catches a floating/seamed
   part; C009 never fires between a subject's own front/side/back views), then **answer its seam-contact
   rubric** by looking.
1. `check --lint --json` = `{diagnostics:[], census}` (W002 orphan part, W009 transparent end-row,
   W012–W015 the retired hand idioms — antiPatterns all 0).
2. **Part fragment `--png@6–8`** — each part isolated with literal args (`#head(#a83a36)`).
3. **Composite `--png@4`** — light contract + proportions read here.
4. **`--silhouette --png@4`** — seam contact + archetype signal, colour stripped, every view incl. back.
5. **Native `--png@1`** — every figure must read as its archetype at 100 %.
6. **Per-joint `--crop`** on each seam (§5) — bbox overlap ≠ pixel contact.
7. **`sheet file.drw --png@4`** over the export wrappers — cross-view × cross-faction consistency.
8. `build` → look at the artifacts.
