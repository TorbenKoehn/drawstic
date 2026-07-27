# Drawstic character craft

How to build a **modular game figure** (chibi or realistic, one or three views) that reads as the
archetype on the first attempt. The canonical path (SKILL.md) applies unchanged; a figure adds four
things to it: a **figure oracle** for proportions, **organic head construction**, a **seam contract**
(`pin`/`fit`) that guarantees limb contact, and **multi-view redraw discipline**. Copy
[starters/character-3view.drw](starters/character-3view.drw) — a complete, `check`-clean,
`critique --as character --strict`-passing 64×128 three-view chibi — and mutate it; every idiom below
is verified against it or an equally clean recipe, never invented.

`check` verifies grammar only. Seam contact, a genuine side view, and archetype/sex reading are **100 %
visual** — a rendered image, a `--silhouette` black-out, and a per-joint `--crop` are the only judges. A
clean `critique --strict` verifies structure, not craft.

## 1. The canonical path, for a figure

1. **Theme = one `light` + a `figure:` oracle** (§2). The light makes cross-view lighting structural;
   the oracle makes eye/ear/neck/shoulder positions structural — neither can drift between views or
   recolor variants.
2. **Materials** — metal/skin/cloth as `material` bindings, tuned with `spread`/`drape`/`over` (§7).
3. **Parts** — each mass a `Region` from a primitive or an organic constructor (§3), each declaring its
   seam rows as **`pin`s**.
4. **Assembly by `fit`** (§4) — a root `fit` seeds every pin that follows; contact is engine-checked,
   not eyeballed. `behind`/`front` order props, `aim` orients a held one.
5. **One bare `outline`**, last statement of the assembly draw.
6. **`critique --as character --strict`** → exit 0, then answer its rubric by looking (§9).

Three views (§5) and faction recolor (§6) repeat steps 1–5 with the same theme and the same parts.

## 2. Proportions — the figure oracle

Declare the proportion numbers **once, in the theme**, and read **named guide points** instead of
hand-picked coordinates — the engine derives them, so eyes/ears/neck/shoulder can't drift and the side
view's eye lands forward automatically:

```drw
theme figThree:
  light sun = dir 1:1 #ffe6b0 amb #2a3a5e 16%
  figure:
    heads 3          # the whole figure is 3 head-heights tall
    headW 34
    eyeLine 0.66     # eye line as a fraction of head height from the crown
    earLine 0.6
    eyeSep 12
```

In any drawing applying the theme, `fig` is bound over that drawing's own `w`×`h`. Full grammar and
every `fig.*` name are in [language.md](language.md) §9 — the craft rule on top of it:

- **A head *part* is one head tall.** The oracle lays `heads` over the drawing it applies to, so a
  standalone 34×42 head part needs its **own** tiny theme with `heads 1` (the part canvas *is* one
  head); the full-body assembly keeps the real `heads` (3 for a chibi, more for a realistic figure).
  `starters/character-3view.drw` declares exactly this pair (`figThree` / `figHead`) — copy it rather
  than re-deriving the split.
- **Side faces `+x`.** `fig.side.eye`/`fig.side.ear` are already shifted forward/back — never hand-nudge
  a profile eye toward the front; read the oracle point instead.
- Chibi vs. realistic vs. mech is only **different numbers** in one `figure:` block, never a different
  construction method.

## 3. Head & headwear — organic constructors, copied and mutated

Build heads, hair and hats from the **organic constructors**, never hand poly-lists: `dome(c, rx:ry)`
(flat-based upper ellipse — skull, helmet, hat crown), `lobe(base, tip, w)` (teardrop — ear, nose, hair
strand, plume), `crescent(c, rx:ry, thick, dir)` (tapering band — fringe, brim), `ribbon(p0, p1, p2, w)`
(width-`w` band through 3 points — **stacked ribbons over a dome read as a turban, not a helmet**). Full
grammar: [language.md](language.md) §4.

Drawstic ships no character library — it gives you the mechanism, you own the style. Four silhouette
approaches cover most archetypes; each is one line of `head = …` construction, not a different
technique:

| Archetype | Head silhouette |
|---|---|
| Round chibi | one wide `ellipse`/`circle` skull + `lobe` ears + a `crescent` fringe |
| Slim / realistic | a `dome` cranium unioned with a tapered `curvePoly` jaw |
| Angular / mech | a hard `dome` helmet unioned with a `poly` faceplate, `cel`-shaded |
| Turban / hood | a `dome` cap with 2–3 stacked `ribbon`s wrapped over it |

Shade the skull mass with one `model`/`cel` call so it reads as a single form; layer face features on
top in this order — skin base, hair mass, eyes, brows, nose, mouth (§8 has the exact marks). Copy
`starters/character-3view.drw`'s `headFront`/`headSide`/`headBack` (34×42, one head tall, both front
and side verified) as the running template; restyle the silhouette per the table above and keep the
oracle points (`fig.eyeL`/`fig.earL`/`fig.side.eye`/…) so the face stays on-line automatically. A
profile nose belongs strictly between the eye and mouth lines, with a clear gap below the eye first —
flush against it, any bump reads as a beak, not a nose.

**Trap — verified.** Never name a binding `transform`, `tint`, `mask`, `font`, `cap`, `join`,
`sha256`, `anchor` or `shadow`: the parser reads it as that keyword's own argument slot the moment
you pass it as one (`cap = dome(16:15, 14:12)` then `model cap turbM`). `E011` names the hijacked
keyword and suggests a rename, so it is a one-render detour rather than a mystery — but a qualified
name (`turbCap`, `hoodMask`) skips it entirely.

## 4. Seam contract — no floating limbs (`pin`/`fit`)

**A bounding-box overlap does not prove pixel contact.** The fix is `pin`/`fit`: a part declares its
seam rows as `pin`s in its own space, and `fit` *solves* the placement so the pins coincide exactly —
contact is engine-guaranteed, and a residual gap raises `W010` (render) / `C007` (`critique --strict`,
must-fix for the `character` profile) instead of shipping silently. Full grammar:
[language.md](language.md) §7.

<example>

```drw
draw bodyFront 48x86:
  # … legs, torso, arms …
  pin neck 24:2
  pin grip 7:52
  pin hip  24:52

draw heroFront 64x128:
  fit bodyFront.neck 32:43        # root: paints the part AND seeds every one of its pins
  fit headFront.neck bodyFront.neck   # lands on the seeded neck pin, no re-declaration
  fit staff.grip bodyFront.grip aim tip 12:16 front bodyFront
  outline
```

```
$ drawstic render heroes.drw#heroFront --explain --json
"placements": [
  { "target": "bodyFront.neck", "landed": { "x": 32, "y": 43 }, "coincident": true, "pinToInk": 0 },
  { "target": "headFront.neck", "landed": { "x": 32, "y": 43 }, "coincident": true, "pinToInk": 1 },
  { "target": "staff.grip",     "landed": { "x": 15, "y": 93 }, "coincident": true, "pinToInk": 0 } ]
```

</example>

This is `starters/character-3view.drw`'s actual assembly — `check --lint --json` on it returns `[]` and
`critique --as character --strict --json` returns `pass:true`. Five rules:

- **(a) Root-fit first, then chain.** A `fit` on a real part seeds *all* its pins from one anchor, so a
  later `fit …bodyFront.hip` never re-declares. Plant a standing figure with `ground` (pools under the
  footprint's own bottom — the feet — never the fit pin), not a hand `ellipse` (that idiom is `W015`).
- **(b) Cut parts along the overlap, not the anatomy.** A pauldron belongs to the *arm*, not the torso —
  a slightly off stamp coordinate then can't open a gap between them.
- **(c) No transparent trailing `pixels:` row.** It silently enlarges the part's footprint and opens a
  1px seam below whatever fits onto it (`W009`).
- **(d) Overlap seams by 1–2px** rather than butting them exactly.
- **(e) A pin must sit *on* the part's own ink — contact ≠ correctness.** A `chin` pinned in the empty
  rows below the head lands the head floating even with pins coincident; a pin >2px off its part's own
  ink raises `W011`. `pinToInk` in the `--explain` trace above is exactly this distance — read it before
  calling a seam done.

**Before "done": render a tight `--crop` per seam.** A full-body `@4` is too small to catch a 1–2px gap
on a 64×128 figure, and a colour-similar neighbour hides it entirely at any zoom above 1× —
`--silhouette` is what actually shows a seam.

## 5. Three views — front, side, back

Front, side and back are **three separate assemblies over the same theme and the same parts**, never a
mirrored copy of one draw — `flipx`/`flipy` only swap left/right *within* one pose.

- **Redraw the parts that lead the pose axis:** head (nose/visor forward, ear toward the back — the
  side scaffold in §3), torso (front vs. back drape), the leading arm. A profile reads thinner than a
  front view — widen the side torso toward ~0.8× the head width or the figure looks bobble-headed.
- **Reuse the parts that don't change with view angle:** boots, a held prop's own geometry, a straight
  staff or bow shaft.
- **Grip a held prop, don't hand-flip it.** Give it a `grip` pin (and a second `tip` pin), author it
  once in true orientation, and `fit prop.grip hand.grip aim tip <pt>` in every view — the grip stays in
  the hand and `aim` rotates the whole prop about it, so the blade/bow always points the right way. A
  blanket `stamp prop … flipy` per view points it backwards in side/back. `starters/character-3view.drw`
  does exactly this for its staff: `fit staff.grip bodyFront.grip aim tip 12:16 front bodyFront`.
- **A chunky prop (hammer, mace, wide axe head) is the hardest thing to get right.** A wide flat
  head misreads as the wrong tool (hammer→axe) unless its proportions commit hard, and `aim`'s
  arbitrary rotation shears that same head thin, reading as a blade — reserve `aim` for slender
  props (staff, bow, sword) and give a chunky head its own literal orientation per view instead.
  Lengthen the shaft so the head clears the shoulder line, and give the prop an explicit
  `behind`/`front` — an unlayered haft plows through the forearm and hides the hand. Check every fix
  in a cropped `--silhouette`, not the colour render: value and material hide a geometry collision
  that a black silhouette shows immediately.
- **Back view: no face.** Build the back head from the same skull/hair mass, minus every eye/brow/mouth
  mark — a front-posed limb redrawn "facing front" from behind is the tell that gives away a reused
  front part.
- **Front and back mirror left↔right at the shoulder/hip attach**, not the part itself: reuse the
  identical arm part and swap which pin it fits to (`armA.shoulder → torso.shoulderL` in front becomes
  `→ torso.shoulderR` in back). When the body is one draw rather than separate limbs, the same rule is
  a **mirrored pin coordinate** — `pin grip 7:52` in a 48-wide front body becomes `pin grip 40:52`
  (`w - 1 - x`, the same axis `flipx` mirrors about), and the `aim` target mirrors with it
  (`12:16` → `51:16` on a 64-wide
  canvas). Copying the front pin verbatim is the classic back-view bug: the prop stays on the viewer's
  left, so the character silently swaps hands between views — `check --lint` catches a repeated
  off-centre pin here as `W017`. This also collapses `critique`'s `C009` sibling-silhouette check by
  construction for a subject's own views — it never fires between `…Front`/`…Side`/`…Back` of one name
  stem.
- **A dominating prop is an explicit layer, not auto-order.** A slung sword or a back cape doesn't ride
  a bone, so give it its own `behind <part>` / `front <part>` clause (`fit sword.grip a.grip aim tip
  3:34 behind cape`) — `critique`'s `C013` (must-fix under `--strict`) verifies the relation actually
  holds in the composite.

**Larger or animated rigs:** declare the attach points once as a `skeleton`, then make each view a `pose`
of it — a joint's `z` depth then drives auto-Z (paint order falls out of the pose, no hand
`behind`/`front` on the body itself). Full grammar and a worked rig: [language.md](language.md) §7.

## 6. Faction recolor — parametric parts, never a theme swap

A theme **palette** does not cross a `stamp`/`fit` boundary (a stamped part resolves its own `palette`
in its own scope) — but a theme **light** does, since `use` applies the whole theme to every drawing as
it renders. So: theme for the light, **parameters for the recolor**.

<example>

```drw
light sun = dir 1:1 #ffe6b0 amb #2a3a5e 16%

draw torso(c) 16x18:                  # c = the faction cloth colour
  body = poly(2:0, 13:0, 12:17, 3:17)
  model body c cloth                  # form shading supplies the tone range — no hand patch

draw figureRed 16x18:                 # thin non-parametric wrapper: one literal per faction
  stamp torso(#a83a36) 0:0

export figureRed figureRed:
  png @1
```

```
$ drawstic check faction.drw --lint --json
{ "diagnostics": [], "census": { … "antiPatterns": { "manualSpread": 0, "stampWithPins": 0, "handShadow": 0 } } }
```

</example>

For a whole-variant push without a second parameter, `tint c 0.3` on the `stamp`/`fit` is the cheaper
alternative — a **neutral grey** tint (`R==G==B`) is always safe; a **chromatic** one only on
already-cool material (a warm base swings toward magenta otherwise, [language.md](language.md) §3).

## 7. Materials, light & shading dosage

One `light` in the theme, applied once via `use`, is what keeps front/side/back and every recolor
variant reading the same world-space source — never re-declare it per drawing. `model REGION MAT` is
the default even at chibi scale (smooth, form-following, no medial ridge); `cel REGION MAT N` renders
the same body as `N` crisp bands (pick 3–4 for an RO look). Full grammar and the light-resolution tiers:
[language.md](language.md) §6.

Three material knobs replace every hand tone patch (trailing on the `material` binding):

- **`spread N%`** widens `hi`+`shade` symmetrically — the fix for a dark base reading flat (`C004`).
  Verified working ranges: 140–260% for most cloth/leather, up to ~440% for a large near-black drape.
  Never a hand `litTone(…).intersect(rect…)` corner patch — that is lint `W013` / census
  `manualSpread`.
- **`drape`** — a hanging cloak/skirt shaded with the default `round` field curls into a "turtle-shell"
  (darkens toward the hem); `drape` gives it a per-row half-tube instead, so the hem stays lit.  Use it
  **only** for things that actually hang.
- **`over UNION`** — a leg + boot shaded as two separate passes restarts the height field at the seam;
  shade both `over` their union (§4's dosage example does this for `leg.union(boot)`) so they co-shade
  as one continuous limb, each keeping its own material.

Spec/highlight as a 2–3px cluster top-left; core shadow as the dark column on the light-averted side.
**Never `stroke` a form whose short axis is ≤~4px** — the border eats the whole fill; contour thin
bones/blades via colour + value instead.

**One bare `outline`, last statement of the assembly draw.** Per-part outlines survive assembly as
internal dark seams — bare `outline` derives its own colour and stays at width 1 for a chibi; it floors
the silhouette at 50% alpha, so a soft contact shadow is never ringed.

## 8. Chibi face — five marks

A face at chibi part-scale reads as "two dots" if you stop at pupils. In order, on the head part:

1. **Skin base via `model`, not `cel 2`.** `cel skin 2` throws half the face into a dark band and reads
   as stubble — want cel on a face, use `N ≥ 3`.
2. **Eyes: white + iris + pupil + one catch-light pixel** — four layers, not a bare dot.
3. **Brows: a short 1px stroke above each eye**, with ≥2px of skin between bang and brow or they merge.
4. **Nose: one 1–2px shadow tick**, never an outline (a stroked bridge reads as a wart).
5. **Mouth: one short `line` at ~70% alpha**, not a filled shape (that reads as a wound).

## 9. Verification cadence

`check` catches almost nothing here — quality is ~100% visual, and a clean `critique --strict` verifies
structure, not craft (the render you look at is the actual gate). Beyond the loop in
[verify.md](verify.md), a figure adds:

0. **Gate:** `critique --as character --strict --json` → exit 0 (`C007` catches a floating/seamed
   part; `C009` never fires between a subject's own front/side/back, nor across canvas sizes — it
   does fire between different same-size characters, which is expected), then answer its
   `seam-contact` rubric item by looking.
1. **Part fragment `--png@6-8`** — each part isolated with literal args before assembly.
2. **Composite `--png@4`** — light contract + proportions read here.
3. **`--silhouette --png@4`** — seam contact + archetype signal, colour stripped, every view including
   back.
4. **Native `--png@1`** — the figure must read as its archetype at 100%.
5. **Per-seam `--crop`** (§4) — a bbox overlap is not pixel contact.
6. **`sheet file.drw --png@4`** over the exported views — cross-view and cross-faction consistency.
7. `build` → look at the artifacts.
