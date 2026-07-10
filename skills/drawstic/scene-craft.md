# Drawstic scene craft

How to make a full scene (landscape, interior, space, underwater) read as a **masterpiece**,
not merely a correct image. SKILL.md § Scenes gives the mandatory order + checklist; this is the
detail. Every rule here comes from rendered evidence. `check` verifies grammar only — **every
failure below is silent to `check`; a render is the only judge.**

## 1. Light contract — the first lines, always

```drw
# light: sun top-left → shadows fall down-right
sun  = 40:-30            # one off-canvas point; EVERY shade/light/rim/shadow reads it
warm = #ffe6b0           # light colour
cool = #2a3a5e           # shadow colour = complement of warm, never pure black
```

- Bind ONE `sun`/`light` point first. Every `shadeRegion`/`lightRegion`/`rim`/shadow-offset and
  every lit tone derives from it — this is the strongest lever for coherence across independent objects.
- Lit tones: `base.mix(warm, 25%)`, **not** `base.lighten(…)` — pure lighten reads chalky and cold;
  mixing toward the light colour keeps golden-hour warmth. Shadow tones: mix toward `cool`.
- A secondary light (moon, aurora, lava, planetshine, bounce/planetshine ≤15%) gets its **own** named
  point and a weaker, cooler veil.
- Write the direction as a comment and check every object against it.

## 2. Terrain is a function

```drw
fn duneY(nx) = 120 + round(noise(3, nx * 4, 0) * 14)   # nx normalized 0..1 → smooth, no lattice trap
profile sand 0..w duneY fill                           # the silhouette
mask ground = profile(0..w, duneY)                     # the region for shade/grain/scatter
footY = duneY(cx / (w - 1))                            # place anything standing at exactly its y
```

One `fn` gives you three things from one source: **silhouette** (fill), **region** (mask/filter),
and **placement oracle** (`y = f(x/(w-1))`). Everything standing on the ground calls it for its y, so
floating/sinking objects are structurally impossible. The oracle is now first-class via **`fit`**
(ADR-0087): a standing part declares a `pin base`, and `fit tree.base cx:duneY(cx/(w-1)) shadow`
lands that base pin exactly on the terrain line with an auto contact-shadow — the object cannot drift
from the ground because its y comes from the same `fn` that drew it. Point lists (`curvePoly`) can't
be a placement oracle — use `profile` for any line that carries objects. Extra shading zones must be
**terrain-following** regions (profile intersects, silhouettes), **never bare `rect` boxes** — an
axis-aligned light box leaves a visible vertical seam across the scene.

## 3. Layer template (back-to-front — filter timing is the whole point)

1. Sky gradient (`bg` / `linear`).
2. Sky detail: stars, aurora, moon, sun-glow (§6).
3. Far silhouette (`profile`, strongly hazed) + caps.
4. **Haze-veil band** — a thin `alpha` band in the horizon colour, placed AFTER the far layer and
   BEFORE the midground. This is the trick that pushes the far layer back.
5. Midground masses.
6. Water, if any (§9): gradient → mirrored silhouette → ripple → glitter path → floating objects.
7. Ground: **shape gradient first** (far = light/desaturated, near = dark/saturated), element sizes
   growing toward the viewer. A flat-filled ground reads as a *wall*; the gradient is the plane.
8. Texture filters (`grain`/`speckle`/`ripple`), **depth-staggered**: far weak, near strong.
9. **THEN** detail marks / highlights. `grain` eats 1px marks — draw them *after* texture, **≥2px**,
   as a **light/dark pair** (dark recess + light lip), or the texture swallows the story.
10. Subjects back-to-front, each: contact-AO ellipse → directional cast shadow → body → **then**
    bright accents → light edge (§4, §8).
11. Foreground framing element (darker, larger, low detail) for depth and scale.
12. Atmosphere last: flakes/dust/spray, then a global vignette (`shadeRegion` whole frame ≤12%).

## 4. Per-object shading order

```
fill (base gradient) → grain (break the flat) → shadeRegion (away from light)
  → lightRegion (toward light, warm) → rim / secondary edge (clamped) → AO (seat edge)
  → THEN bright accents (windows, speculars, glints, nav lights)
```

Accents come **last** so they stay crisp instead of being dimmed by the shade pass.

## 5. Filter dosage (empirical — tune the first number for *how much*, the second only reshuffles)

| Filter | Value | Note |
|---|---|---|
| `shadeRegion` modelling a form | 40–50% | on the object; deepest away from light |
| `shadeRegion` global veil / vignette | ≤10–12% | whole frame; 20% already turns afternoon into dusk |
| `lightRegion` | 15–20% | areal falloff, not an edge; keep low or it flattens the form |
| `rim` width | 1px per `w` | needs ≥~1% of region width to register — invisible on a 300px region; dim + desaturate + `.alpha`, else neon |
| `grain` | 0.04–0.06 subtle … ~0.15 heavy | breaks a flat fill into surface; eats 1px marks |
| `speckle` | density **0.03–0.06** + `alpha(50–60%)` paint | first number is **DENSITY of opaque dots**, not blend strength; 0.14 = harsh static |
| `ripple` | ≤0.25 on non-water | reads as water above that; 0.4–0.6 for actual water |
| stacked-glow alpha step | ≤7% per circle | §6 |
| reflection fill | 30–40% alpha | §9 |
| contact-AO ellipse | 25–35% alpha | §8 |
| cast-shadow fill | ~25%, cool colour | §8 |

Scene closing stack: `grain <ground>` → `lightRegion <all> <sun> <warm> 15–20%` →
`shadeRegion <all> <sun> <cool> ≤12%`.

## 6. Soft glow (verified)

Onion rings come from big alpha **contrast** between stacked bands — they appear at **every** size, so
"a few big rings" never works. A soft glow needs a gentle ramp. Two verified ways:

- **Many fine `alpha` circles** — alpha increment ≤~7%, radius shrinking a few px each. Feathers to
  nothing; best edge. `for i 0..18: circle c.alpha(7%) ctr (R - i*2) fill`.
- **One radial gradient** `radial(c.alpha(70%), c.alpha(0%))` over the glow region — smooth interior,
  one line. Set the radius **well past** the visible falloff so boundary alpha is ~0, else a faint
  disc edge shows. NEVER `radial(c, transparent)` (mixes toward black → muddy halo).

Below ~24px no pixel-mode ramp reads as soft — accept a crisp core, hand-pixel it, or `mode smooth`.

## 7. Depth & 3D

- **Real keystone** (tilted panel, solar wing, card):
  `rect(…).transform(rotatey(θ).perspective(d).about(center))`. A symmetric pair mirrors the sign
  (`rotatey(30)` / `rotatey(-30)`). Without `.perspective(d)`, `rotatex`/`rotatey` on flat z=0 content
  is only an **orthographic squash** — no depth.
- **Ground/floor tilt**: don't use 3D transforms — build a **2.5D fake**: top face as a
  poly/parallelogram, a darker side face, a light edge on the lit side. It looks better than a squashed rect.
- **Occlusion depth** (ring/torus/arch around a hub): split the region into back/front halves
  (`intersect` a rect around the centre), draw back half → occluder → front half.
- **Non-uniform scale** (flatten a shadow, squash a sprite): `scale(sx, sy)` is a real 2-arg
  constructor — `region.transform(scale(1, 0.35).about(base))`. (`region.scale(n)` alone is uniform.)
  `matrix(a, b, c, d, e, f)` = a 2D affine (CSS order) for a full custom map.

## 8. Cast shadows & ground contact

- **Contact first**: a flat `ellipse … fill` at the foot, shadow colour, 25–35% alpha, 1–2px below the
  base. Every standing object needs one or it floats.
- **Directional cast shadow** (lying on the ground):
  `region(sprite(…)).transform(rotate(θ).about(base)).shift(pos).intersect(ground)`, θ from the light
  (`rotate` turns clockwise: +90° sends up→right). `.intersect(ground)` clips it to the terrain — but
  it **silently hides a wrong angle too**, so render the shadow region once in a signal colour +
  `--grid` before trusting it.
- **Composite objects** (roof+posts, multi-part sprite): a `stamp … shadow` or silhouette-offset
  clumps the whole footprint into a dark blob — use an `ellipse` + a directional `poly` instead.
- **Avoid** the region-shear shadow (`flipy().about()` + `skew().about()`): chained `.about` anchors
  are underspecified and the silhouette drops off-canvas when the base is near the bottom edge.

## 9. Water & reflections

```drw
grad water = linear(90, surf, deep)
fill water lake
refl = peaks.transform(flipy().about(0:horizonY)).intersect(lake)
fill mountainCol.alpha(35%) refl                 # 30–40% alpha
ripple lake 0.2 5 surf.alpha(40%)                # subtle, lake only
scatter g 30 7 glintTrapez.intersect(lake):      # glitter path under the light
  px surf.lighten(20%) g
```

Mirror across `flipy().about(0:horizonY)`; keep `ripple` on the reflection/lake mask only; the glitter
trapezoid under the light source is what turns a flat fill into water.

## 10. Atmospheric colour — depth out of one base

Derive each depth layer's colour from ONE base by mixing toward the horizon/haze colour
(`base.mix(haze, 28%)`, then 48%, 67%, 85%, foreground darkened). Depth then lives in the colour
system and stays consistent when you recolour. An object must differ enough in **hue** from its
surroundings (blue-grey on blue water = mud → push to olive/warm). Far = smaller + higher + strong
haze tint + low contrast; near = larger + darker + saturated + no tint.

## 11. Focus & hero

- Name ONE hero. Put its silhouette across a **contrast edge** (over the horizon into a dark mass);
  give it a complementary-colour glow behind it. In a crop, confirm nothing — not even its own host —
  covers it.
- Compose on an axis: hero + a vista terminator (alley/tower) + a near foreground actor → the scene
  reads "built", not "scattered".
- Distant figures = a separate, simplified, smaller draw — never the hero sprite scaled down. Three
  size classes (far / mid / near) carry all the depth.

## 12. Verification cadence

- After each edit batch (3–8 edits): `check --json` = `[]`, then a full render **@4** and LOOK — a
  native `@1` is too small to judge.
- New object / contact: `--crop @6–8` on the **contact zone** (object + shadow + ground).
- Before "done": look at the whole **@4** image — it shows what `@1` swallows (ghost shapes, outline seams).
- Local edit: `--diff` against a **fresh** baseline (pull it immediately before the edit); the bbox
  proves the blast radius.
- Silent geometry bug: fill the region in a **signal colour** + `--grid N` to locate it in one render.
- 5-second composition check: `--ascii --fit 100x40` — if the hero vanishes in the luminance ramp, it
  lacks value contrast.
- Remember: `check` = grammar only; ~5 of every 7 expensive errors are visual and silent.
