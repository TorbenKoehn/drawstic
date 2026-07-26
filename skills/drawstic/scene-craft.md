# Drawstic scene craft

How to make a full scene (landscape, interior, space, underwater) read as **built**, not scattered. The
canonical path (SKILL.md) applies to every object in it; what a scene adds is **one light for the whole
frame**, **terrain authored as a function**, and a **back-to-front layer order where filter timing is
the point**. Copy [starters/scene-layers.drw](starters/scene-layers.drw) — a complete, `check`-clean,
`critique --as scene --strict`-passing 192×128 dusk ridge — and mutate it; it already demonstrates the
light contract, the terrain functions, the haze veil, `fit … ground`, and the soft-glow sun. `check`
verifies grammar only — every rule below is silent to it; a render is the only judge.

## 1. Light contract — the first lines, always

Declare **one** named `light` before the first `draw`. It is the single source of truth every object
reads, so shade, highlight, rim and cast can never drift apart across independently-drawn objects:

```drw
light sun = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # source up-left ⇒ up-left edge lit; amb = cool fill, never pure black
```

- `dir DX:DY` is the light's *travel* direction (`dir 1:1` moves down-right ⇒ source up-left). A point
  source in-frame (a lamp, a fire, the moon) is `light moon = at 48:14 #cfd6a8 gain 0.8`.
- One `model REGION MATERIAL` per object reads this light automatically (a theme default, or the
  module's sole `light` binding — [language.md](language.md) §6 has the full resolution order) and
  lowers the whole shade + rim + AO + cast pass from it — you never re-type the direction.
- A **secondary** light (moon, aurora, lava glow, ≤15% strength) is its own named `light`, applied with
  a trailing `light NAME` argument on just the `model`/`cel` commands it touches — weaker and cooler.
- For tones placed **by hand** (sky/water gradient stops, `pixels:` bands, a sub-~24px object where
  `model` reads too weak), derive with `litTone`/`shadowTone`, never bare `lighten`:
  `base.litTone(warm, 25%)` (a warm highlight, not chalky) and `base.shadowTone(cool, 30%)` (darkens +
  a capped cool hue-nudge, never magenta).

## 2. Terrain is a function

```drw
fn duneY(nx) = 120 + round(noise(3, nx * 4, 0) * 14)   # nx normalized 0..1 → smooth, no lattice trap
profile sand 0..w duneY fill                           # the silhouette
mask ground = profile(0..w, duneY)                     # the region for shade/grain/scatter
footY = duneY(cx / (w - 1))                            # place anything standing at exactly its y
```

One `fn` gives three things from one source: the **silhouette** (`profile … fill`), the **region**
(`mask … = profile(…)`, for shading/grain/scatter), and a **placement oracle**
(`y = f(x / (w - 1))`). Anything standing on the ground calls it for its own y, so floating or sinking
is structurally impossible. `fit` reads the oracle directly: a standing part declares `pin base`, and
`fit tree.base cx:duneY(cx/(w-1)) ground` lands that pin exactly on the terrain line with an automatic
contact shadow (§8). Extra shading zones must be **terrain-following regions** (a `profile` intersect,
a silhouette) — never a bare `rect` box, which leaves a visible seam across the scene.

## 3. Layer template — back-to-front, filter timing is the point

1. Sky gradient (`bg` / `linear`).
2. Sky detail: stars, aurora, moon, sun-glow (§6).
3. Far silhouette (`profile`, strongly hazed) + caps.
4. **Haze-veil band** — a thin `alpha` `rect` in the horizon colour, placed *after* the far layer and
   *before* the midground. This is what pushes the far layer back — order is the whole trick.
5. Midground masses, each object placed by the same terrain `fn` (§2).
6. Water, if any (§9): gradient → mirrored silhouette → `ripple` → glitter scatter → floating objects.
7. Ground: shape a **gradient**, far = light/desaturated, near = dark/saturated. A flat-filled ground
   reads as a wall; the gradient is what makes it a plane.
8. Texture filters (`grain`/`speckle`/`ripple`), depth-staggered: far weak, near strong.
9. **Then** detail marks/highlights, ≥2px as a light/dark pair — `grain` eats 1px marks, so draw them
   after texture or the texture swallows the story.
10. Subjects back-to-front, each: contact-AO → directional cast shadow → body → bright accents last.
11. Foreground framing element (darker, larger, lower detail) for scale.
12. Atmosphere last: one closing `fill linear(deg, warm.alpha(a), cool.alpha(b)) rect(0:0, w:h)` over
    the finished frame, ≤12%.

## 4. Per-object shading — `model` is the default

One `model REGION MATERIAL` (or `cel REGION MATERIAL N` for a crisp banded look) is the whole shading
pass for a solid mass — under the light in scope it lowers to exactly `form body shade (follows the
surface normal) → rim → AO → cast`, every point/direction/offset derived from the light, every dose from
the material's `RESPONSE` (`metal`/`skin`/`cloth`/`glass`/`glow`/`flat`). `render …#scene --explain`
prints that exact expansion before you commit to it.

```drw
rock = curvePoly(2:20, 8:12, 16:14, 22:20)   # the mass as a Region binding
model rock #6b5a48 cloth                      # base + shade/rim/AO/cast, all from the scene's light
```

**Bright accents (windows, speculars, glints, nav lights) still come last, by hand** — after `model`, so
the shade pass never dims them. When a baked dose doesn't fit, tune the **material**'s trailing
overrides (`shade`/`hi`/`rim`/`ao`/`spec`/`puff`/`spread N%`) and re-read `--explain`, rather than
reaching for a raw lighting primitive — there is no separate `rim`/`shade`/`ao` command; what those
verbs did outside of lighting is ordinary region work: an edge band is `fill p r.edge(dx:dy[, n])`, a
veil over already-drawn pixels is `fill linear(deg, transparent, cool.alpha(a)) r`, a seat is
`stroke p.alpha(a) r`.

**Dosage calibration** (what each `RESPONSE` bakes in — tune the material override, not a hand patch):

| Filter | Value | Note |
|---|---|---|
| `shade N%` dose on a form | 40–50% | deepest away from the light |
| global gradient veil / vignette | ≤10–12% | whole frame; 20% already turns afternoon into dusk |
| `hi N%` dose | 15–20% | areal falloff, not an edge — keep low or it flattens the form |
| `r.edge(d, n)` band width | 1px per `n` | needs ≥~1% of region width to register; dim + desaturate + `.alpha`, else neon |
| `grain` | 0.04–0.06 subtle … ~0.15 heavy | breaks a flat fill into surface; eats 1px marks |
| `speckle` | density 0.03–0.06 + `alpha(50–60%)` | first number is dot density, not blend strength — 0.14 is harsh static |
| `ripple` | ≤0.25 off water, 0.4–0.6 for actual water | above ~0.25 on a non-water surface it reads as water |
| stacked-glow alpha step | ≤7% per circle | §6 |
| reflection fill | 30–40% alpha | §9 |
| contact-AO ellipse | 25–35% alpha | §8 |
| cast-shadow fill | ~25%, cool colour | §8 |

**Material dose overrides** (prefer these over a hand tone patch): `spread N%` widens `hi`+`shade`
symmetrically — the value-spread knob for a dark base's flat-reading `C004` range; `spec N%` sets
specular gloss; `puff N%` the form roundness. Glossy responses (`metal`/`glass`/`skin`) already carry a
Blinn specular hotspot.

## 5. Soft glow

Onion rings come from big alpha *contrast* between stacked bands — they appear at every size, so "a few
big rings" never works. A soft glow needs a gentle ramp — `starters/scene-layers.drw` renders one:

```drw
for i 0..12:
  circle #ffe9c0.alpha(6%) 46:47 (26 - i * 2) fill   # many fine rings, alpha step ≤~7%, radius shrinking
circle #fff6e2 46:47 5 fill                          # the solid core
```

The alternative for a single hand-off: one `radial(c.alpha(70%), c.alpha(0%))` gradient over the glow
region, radius pushed **well past** the visible falloff so the boundary alpha is ~0 — never
`radial(c, transparent)` (mixes toward black, reads as a muddy halo). Below ~24px no pixel-mode ramp
reads as soft; accept a crisp core, hand-pixel it, or use `mode smooth`.

## 6. Depth & 3D

- **Real keystone** (a tilted panel, solar wing, sign): `stamp part pt transform
  rotatey(θ).perspective(d).about(center)`. A symmetric pair mirrors the sign (`rotatey(30)` /
  `rotatey(-30)`). Without `.perspective(d)`, `rotatex`/`rotatey` on flat content is only an
  orthographic squash — no depth.
- **Ground/floor tilt:** skip 3D transforms — build a 2.5D fake instead: a top face as a
  poly/parallelogram, a darker side face, a light edge on the lit side. It reads better than a squashed
  rect.
- **Occlusion depth** (a ring/arch around a hub): split the region into back/front halves (`intersect` a
  rect around the centre), draw back half → occluder → front half.
- **Non-uniform scale** (flatten a shadow, squash a sprite): `region.transform(scale(sx, sy).about(pt))`
  is a real 2-argument constructor (`region.scale(n)` alone is uniform only). `matrix(a, b, c, d, e, f)`
  is a full 2D affine for a custom map.

## 7. Cast shadows & ground contact

**Contact first.** Plant the object with `fit part.base <groundPt> ground` — the `ground` flag drops an
automatic contact-shadow ellipse at the resolved contact pixel, cool-toned from the light in scope, so
it can't drift. Every standing object needs one contact shadow or it floats. Only when there is no `pin`
to fit does the hand form apply: a flat `ellipse … fill` at the foot, 25–35% alpha, 1–2px below the base.

For a **directional** cast shadow lying on the ground, transform the object's own silhouette:

<example>

```drw
draw crate 12x12:
  rect #7a5230 0:0 11:11 fill

draw scene 64x48:
  ground = rect(0:36, 63:47)
  fill #6d5a3a ground
  stamp crate 20:24
  cast = crate.region.transform(rotate(70).about(26:36)).intersect(ground)
  fill #2a2016.alpha(30%) cast

export scene scene:
  png @1
```

</example>

`rotate(θ)` turns clockwise (θ from the light — `+90°` sends up→right); `.intersect(ground)` clips the
shadow to the terrain, but **also silently hides a wrong angle** — render it once in a signal colour +
`--grid` before trusting it. For a composite multi-part sprite (roof + posts, a rig), a whole-silhouette
`stamp … shadow` clumps into a dark blob — use an `ellipse` + a directional `poly` instead.

## 8. Water & reflections

<example>

```drw
draw scene 64x48:
  gradient water = linear(90, #6a94b0, #1c3550)
  lake = rect(0:30, 63:47)
  fill water lake
  peaks = poly(4:10, 20:2, 36:14, 50:4, 60:12, 60:30, 4:30)
  refl = peaks.transform(flipy().about(0:30)).intersect(lake)
  fill #8899aa.alpha(35%) refl        # 30–40% alpha reflection
  ripple lake 0.2 5 #ffffff.alpha(40%)
  scatter g 20 7 rect(10:32, 50:40):  # the glitter path under the light
    px #cfe0ee.alpha(60%) g

export scene scene:
  png @1
```

</example>

Mirror across `flipy().about(0:horizonY)`; keep `ripple` on the reflection/lake mask only; the glitter
scatter under the light source is what turns a flat fill into water.

## 9. Atmospheric colour & focus

- **Depth out of one base:** mix each layer's colour toward the horizon/haze colour
  (`base.mix(haze, 28%)`, then 48%, 67%, 85%, foreground darkened) rather than picking colours by hand
  per layer — depth then survives a recolour. An object must differ in **hue**, not just value, from
  its surroundings, or it reads as mud (blue-grey on blue water → push it olive/warm).
- **Name one hero.** Put its silhouette across a contrast edge (over the horizon, into a dark mass) and
  give it a complementary glow behind it; in a crop, confirm nothing — not even its own host — covers
  it.
- **Compose on an axis:** hero + a vista terminator (alley, tower) + a near foreground actor reads as
  built, not scattered.
- **Distant figures are a separate, simplified, smaller `draw`** — never the hero sprite scaled down.
  Three size classes (far/mid/near) carry all the depth a scene needs.

## 10. Verification cadence

Beyond the loop in [verify.md](verify.md), a scene adds:

- **Gate:** `critique --as scene --strict --json` → exit 0, then answer its rubric
  (`hero-contrast`/`no-floating`/`one-light`) by looking — a clean exit is necessary, not sufficient.
- New object or contact: `--crop @6-8` on the contact zone (object + shadow + ground).
- Before "done": look at the whole `@4` image — it shows what `@1` swallows (ghost shapes, outline
  seams).
- Local edit: `--diff` against a **fresh** baseline pulled immediately before the edit — the bbox proves
  the blast radius.
- Silent geometry bug: fill the region in a signal colour + `--grid N` to locate it in one render.
- 5-second composition check: `--ascii --fit 100x40` — if the hero vanishes in the luminance ramp, it
  lacks value contrast.
