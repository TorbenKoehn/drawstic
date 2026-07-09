# Drawstic character craft

How to build a **modular game figure** (48–64px, front + side view, faction recolor) that reads as
the archetype on the **first attempt with few iterations**. SKILL.md § Characters gives the mandatory
order + checklist; this is the detail. Every rule comes from a shipped, check-clean recipe
(`examples/characters/*.drw`) or a rendered probe. `check` verifies grammar only — **seam contact,
silhouette legibility, a genuine side view, and archetype/sex reading are 100 % visual and silent to
`check`; the render, the `--silhouette` black-out, and a per-joint `--crop` are the only judges.**

Characters are **not scenes and not icons.** Keep from scene-craft: **one** light contract baked into
the colour system + the contact-shadow ellipse. Keep from icon-craft: small-raster discipline (no
`shadeRegion`/`rim` at ≤64px — too weak). Add what is character-specific: parts, **seams**, two
views, faction recolor. The dominant bug class here is the **floating limb / 2–3px seam gap** (5 of 7
first-run builds hit it) — §4 makes it structurally impossible.

## 1. The fixed build order

The order that wins on the first attempt — do not reorder:

1. **Light contract** — `warm`/`cool` + `fn lit/shd/deep`, the first lines (§6).
2. **Material ramps + faction colour set** — metal/skin/cloth/bone as module bindings; **only the
   1–2 varying colours become draw params**, everything else fixed (§7).
3. **Proportions-constant head** — `headTop/shoulderLine/hipLine/kneeLine/footLine` as module
   constants, before the first part (§2).
4. **Parametric parts** — non-exported `draw part(c)`, each with a **socket comment** (§3, §4).
5. **Full body back-to-front via `stamp`**, contact-shadow `ellipse` as the **first** statement (§5).
6. **Bright accents last** (emissive lights, glints, orbs) — like scene-craft, so the shade pass
   never dims them.

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

| Figure | Canvas | Head:body | Notes |
|---|---|---|---|
| Normal (knight, archer, mage, robot) | 40–52 × **60–64** | **~1:3.5–4** | head+headgear ≈ 40 % of height; figure fills ~85–90 % of canvas |
| Stocky (dwarf smith) | 44–48 × **56** | **~1:2.5** | short legs, wide torso; same `footLine` discipline |
| Contact ellipse room | — | — | `footLine ≈ canvasH − 5`; ellipse 1px below it |

**Share the vertical lines across views; re-derive horizontal attach-x per view** (§5) — a profile
shifts its mass forward, so the same `shoulderLine` is safe but the same shoulder-x is not.
Confirm centering with `--inspect` `alphaCoverageBBox`.

## 3. Faction recolor — parametric parts, never themes

A theme palette **does not cross a `stamp` boundary** (SKILL.md § Gotchas) — a stamped part resolves
its `pal` in its own scope, so a host theme-swap never reaches it. **All 7 first-run builds converged
on the parametric path**; it is also the best-scoring axis (recolor Ø 1,4). Pass the 1–2 variant
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

**Post-hoc alternative** (verified pixel-identical to the parametric result): stamp one variant, then
a `replace` chain, one line per tone — exact colour match required:

```drw
stamp torso(red) 0:0
replace red blue
replace lit(red) lit(blue)
replace shd(red) shd(blue)
```

## 4. Seam contract — no floating limbs

The character-specific core bug (5/7 first runs; each gap cost ~1 full iteration). **A bbox overlap
does not prove pixel contact** (smith's fist↔haft overlapped in bbox, rendered separate). Four rules
make gaps structurally impossible:

- **(a) Socket comment + body adds offsets, never a shared `y`.** Each part documents its seam row in
  its **own** coordinate space; the body computes each stamp from the shared line. Verified:

  ```drw
  # head: bottom-center seam at row 15 (silhouette reaches row 15 — no buffer row)
  # torso: top seam at row 0, bottom seam at row 17
  draw figure(c) 24x60:
    fill cool.alpha(30%) ellipse(12:56, 8:2)   # contact shadow FIRST — feet cover it
    stamp torso(c) 4:(shoulderLine - 2)         # top seam overlaps head by 2px
    stamp head(c) 4:(shoulderLine - 15)         # bottom seam (row 15) sits on shoulderLine
  ```

- **(b) Cut parts along the overlap, not the anatomy.** Pauldron belongs to the *arm* (covers the
  torso shoulder when stamped), faulds/skirt to the *torso* (covers the leg tops) → a slightly wrong
  stamp coordinate cannot open a gap.
- **(c) The silhouette reaches the canvas edge on the seam side** — **no transparent buffer row**. In
  a `pixels:` grid a fully-transparent **last** row silently enlarges the footprint and seams a 1px
  gap below the next part — that is **W009** (`check --lint`); it was the knight's #1 gap cause.
- **(d) Overlap the seams by 1–2px** from the start (archer/mage did this and never floated) rather
  than butting them exactly.

**Per-joint crop before "done":** for every seam (neck, shoulder/hip, hand↔prop) render a tight
`--crop` zoom — the full-body @4 is too small on a 56px figure to trust, and a colour-similar
neighbour can hide a multi-pixel gap (villager's torso rip showed **only** under `--silhouette`).

## 5. Two views — side ≠ flip

Front→side is a **different pose**, not a mirror (`flip`/`mirror` only swaps left/right *within* a
pose). All 7 runs confirmed the split:

- **Redraw** the parts that **lead the pose axis**: head (nose/visor/brim point forward), torso
  (front vs. back drape), the leading arm.
- **Reuse** the **pose-invariant** parts: bow, quiver, staff, hammer, boot, leg. A held weapon may be
  `flipy`ed (knight `stamp sword(c) 6:26 flipy`).
- **Push the far limb back** with a **neutral-grey** `tint` (`tint #2b2b2b 40%`, R=G=B — the cheapest
  depth cue) + a small offset. A **chromatic** `tint cool 40%` is safe **only on already-cool
  material** (knight steel, mage boot); on warm/saturated material it rotates the hue (§6).
- **Symmetric pair once, not twice:** draw one limb, mirror it — `mirror x=24: stamp leg(e) 20:36
  anchor top`, or `flipx` on the second stamp. Both work first-try; don't hand-copy two near-identical
  stamps (skeleton did and paid the boilerplate).

## 6. Material ramps & light (baked in the colour system)

One named contract, every part derives its tones — light consistency becomes structural, not
disciplinary. **Do not mirror the light per view** (side-facing-right ⇒ back lit, chest shaded).

```drw
warm = #ffe8bf                       # light colour
cool = #2c3550                       # cool shadow complement, never pure black
fn lit(c)  = c.mix(warm, 22%)        # toward light — MIX, not bare lighten
fn shd(c)  = c.darken(10%).mix(cool, 20%)
fn deep(c) = c.darken(20%).mix(cool, 34%)
```

**Shade warm materials with `darken()`, never a raw cool `mix`** — `skin.mix(cool, 20%)` runs the
short OkLCh arc through magenta → a pink "shadow" (hit by archer, villager, smith; robot on emissive
via `tint`). Full rule + the safe `darken().mix(cool, 12%)` recipe: SKILL.md / reference.md § Color.
A raw `mix(cool)` is safe only on **already-cool** cloth (mage's indigo robe).

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

## 7. Verification cadence

`check` catches almost nothing here — quality is ~100 % visual. After each edit batch:

1. `check --lint --json` = `[]` (W002 catches an un-stamped part; **W009** the transparent end-row).
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
