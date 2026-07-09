# 44. First-class transforms: affine + projective, one syntax for stamps and regions

- Status: Accepted
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Refines: [ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md) (`.shift`/`.scale` become sugar; the region-rotation deferral is resolved), [ADR-0043](0043-arbitrary-angle-stamp-rotation.md) (stamp flags become sugar over the general model)

## Context

Transforms were scattered: stamps had ad-hoc flags with a hard-wired pivot
([ADR-0043](0043-arbitrary-angle-stamp-rotation.md)), regions had `.shift`/`.scale` about
`0:0` with rotation deferred for want of a pivot ([ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md)),
and there was no skew, no anchor control, and no 3D at all. The user-facing need is CSS-like:
a **uniform transform model** — matrix-backed, anchor-definable, applicable to every
transformable thing the same way. CSS gets two things wrong that we will not copy: the
origin lives in a separate property (`transform-origin`, action at a distance), and the
transform list applies **right-to-left** (famously confusing) — both violate
self-verifiability (priority 3).

## Decision

**1 — `Transform` is a first-class value** (a new §4 row), backed by a **4×4 homogeneous
matrix** (the CSS model: 2D affine embeds exactly; 3D constructors project back to the
plane by perspective divide). Transforms are built by pure constructors, composed by UFCS,
bound with `=`, and importable like any value:

| Constructor | Meaning |
|-------------|---------|
| `shift(dx:dy)` | translation (the ADR-0039 name, kept — one word for one concept) |
| `rotate(deg)` | 2D rotation, degrees clockwise (matches `arc`) |
| `scale(s)` / `scale(sx, sy)` | scaling — **non-integer allowed** |
| `skew(degx[, degy])` | shear |
| `flipx` / `flipy` | zero-arg mirrors ≡ `scale(-1, 1)` / `scale(1, -1)` |
| `rotatex(deg)` / `rotatey(deg)` | 3D rotation about the x/y axis, projected |
| `perspective(d)` | perspective distance `d` px (applies to subsequent 3D terms) |
| `matrix(a, b, c, d, e, f)` | 2D affine escape hatch (CSS argument order) |

**2 — The anchor is a combinator, not a side channel: `.about(pt)`.** It conjugates:
`t.about(p)` ≡ `shift(-p)` → `t` → `shift(p)`. One mechanism gives every transform —
rotation, scaling, skewing, 3D — a definable anchor, inline, where the transform is
written. Without `.about`, the origin is `0:0`. No `transform-origin` twin property.

**3 — Reading order = application order.** `rotate(45).scale(2)` rotates **first**, then
scales — UFCS chains read subject-first, left to right ([ADR-0010](0010-ufcs-method-style-calls.md)),
and the pipeline executes in exactly that order. This deliberately breaks with CSS's
right-to-left convention; a note in the spec calls it out. Pleasant side effect:
`rotatey(60).perspective(64)` reads as its actual pipeline — rotate, then project.

**4 — One application point per domain, same value:**

- **Regions:** `r.transform(t)` — a region combinator. `.shift(p)` ≡ `.transform(shift(p))`
  and `.scale(N)` ≡ `.transform(scale(N))` (ADR-0039 refined, not broken). Rotation/flips
  of regions are no longer deferred: the pivot problem is solved by `.about(pt)` being
  explicit.
- **Stamps:** a `transform <t>` keyword-pair flag (like `tint`), applied in the **source
  drawing's coordinate space**, then placed at `pt`. The terse flags stay as pinned sugar:
  `rot<deg>` ≡ `transform rotate(deg).about(((w−1)/2):((h−1)/2))` (the ADR-0043 centre),
  `flipx` ≡ the centre-anchored mirror, `scale<N>` ≡ `transform scale(N)` (about `0:0`);
  combined flags expand in the pinned flip → scale → rotate order.

```drw
t = rotate(30).about(8:8)                       # transforms are ordinary values
stamp gem 4:4 transform t
stamp card 8:2 transform rotatey(60).perspective(64)   # 3D card flip, projected
mask m = gem.region.transform(skew(15).about(0:7))     # same value, region side
```

**5 — Rasterization generalizes [ADR-0043](0043-arbitrary-angle-stamp-rotation.md) §3.**
In pixel mode any **invertible** transform is **inverse-mapped nearest-neighbour** (bundled
math, half-up rounding — no new colours, alpha honoured); in smooth mode the same inverse
mapping runs on the 1/16 subpixel grid ([ADR-0040](0040-mode-scoped-coordinate-quantization.md))
with coverage. **Exactness guarantee:** transforms that map the pixel lattice to itself
(axis mirrors, quarter-turns, integer shifts, integer scales) must produce the same pixels
as the dedicated lossless paths. A **non-invertible** transform (`det = 0`, or a
perspective divide crossing zero inside the footprint) is a positioned error — never a
silent smear.

**6 — Name hygiene: the colour op `rotate` is renamed `hue`.** `rotate(30)` must mean the
transform; the hue rotation becomes `hue(c, deg)` / `c.hue(deg)` — which the spec's own
UFCS example (`#235.grayscale.hue(red)…`) already used, so this also fixes a latent
§10/§12 inconsistency.

## Consequences

- One model answers anchor, skew, 3D, and uniformity at once; stamps and regions (and thus
  shapes and masks) consume the identical value. Filters/text stay non-transformable in v1.
- ADR-0043's flags survive as sugar with unchanged semantics; ADR-0039's deferral note is
  obsolete.
- Non-integer `scale` arrives for free on both surfaces (the stamp *flag* `scale<N>` stays
  integer; the general form is not restricted).
- 3D is projective sugar over the same matrix — no scene graph, no z-buffer; it exists for
  card-flip/pseudo-3D effects and stays fully deterministic.
- Touches spec §4 (Transform row), §9 (stamp syntax + transforms, region placement), §12
  (`rotate` → `hue`), §18 (consistency note).
