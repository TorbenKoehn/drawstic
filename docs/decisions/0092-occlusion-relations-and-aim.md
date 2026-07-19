# 92. Occlusion relations (`behind`/`front`), the `aim` solver, and C013 occlusion parity

- Status: Accepted
- Date: 2026-07-19
- Deciders: t.koehn, Claude
- Refines: [ADR-0087](0087-anchored-assembly.md) (`pin`/`fit` place parts with contact guarantee, and
  pins ride the transform machinery — the substrate `aim` and the two-phase pass reuse verbatim).
- Enables: the later skeleton/pose work (Welle 2 §E) lowers auto-Z per view onto these same
  `behind`/`front` edges + `aim` orientation, so the mechanic is cut to be that lowering target.

## Context

`pin`/`fit` (ADR-0087) guarantee that a part makes pixel *contact*, but say nothing about **who
occludes whom** or **which way a held prop points**. The 2026-07-10 human review of the four RO
characters pinned four Z-order / prop-pose defects that shipped green under `critique --strict`
(C007 measures adjacency, not visibility):

- the Knight **back** sword painted *in front of* the sprite (it was the last `fit`, so it composited
  on top) instead of tucking behind the cape;
- the Knight **side** sword ran straight up **into the head**;
- pauldrons / shoulders read as punched **through the cape**;
- the Archer **bow** was authored vertical and `fit` the same way in every view, so it was mis-oriented
  per view — the back bow "clung to the back leg".

Assembly was single-pass: every `stamp`/`fit`/inline paint blitted straight into the shared buffer in
source order, so paint order *was* statement order with no way to declare an exception, and a held prop
could only be re-oriented with a whole-figure flip (which also mirrored the figure — HV6).

## Decision

**1 — Assembly is two-phase.** A drawing body's top-level statements are walked once in source order.
A top-level `stamp` or `fit` is a **placement**: its pin/origin/transform bookkeeping still runs in
statement order (so a chained `fit` reads the pins an earlier one registered), but its pixels render
into a private transparent **layer** instead of the shared buffer. Every other statement (`fill`,
`px`, `line`, blocks, the `outline` filter, …) is a **barrier**: it first *flushes* the pending
placement layers — topologically ordered — onto the shared buffer, then paints live. A `pin`
declaration is neither; it registers an attach point in place without painting. At end of body the
remaining layers flush. Filters that read the composite (`outline`) therefore still see everything
painted before them, and inline paints keep their exact sequence slot — the smallest clean semantics.

**2 — `behind TARGET` / `front TARGET` trailing clauses on `stamp` and `fit`.** `TARGET` is a bare
part-name placed earlier in the same body. `behind` layers the subject *below* `TARGET` in the
resolved paint order, `front` *above*. Both may repeat. Within one barrier-delimited segment the
clauses become precedence edges and the segment is ordered by a **minimal-disruption stable
topological sort** (built top-down, emitting the highest-statement-index layer all of whose
paint-after successors are already placed) — so an unconstrained part keeps its sequence slot and a
lone `behind` moves only its own subject. Ties break by statement order. An unbreakable cycle is a
positioned **E025**; an unplaced target is a positioned error. `behind`/`front` are contextual — bare
bindable names everywhere except the `stamp`/`fit` trailing slot.

**3 — `aim PIN PT` on `fit`.** Rotates the part about its fit pin (any angle, `datan2`) until the
second named pin `PIN` points from the contact point toward the canvas point `PT`. The flag-only
transform positions both pins first; the solved rotation is composed onto it via the ADR-0087
about-a-point matrix machinery, so the pins ride it and the fit pin still lands exactly on its target.
`fit bow.grip a.grip aim bow.tip 8:96`. This is a 1-bone orientation solve — the atomic case of the
forward kinematics the skeleton work will build on.

**4 — C013 "occlusion parity" in `critique`.** During the flush, per-pixel ownership is tracked (the
topmost opaque placement layer at each pixel; inline barrier paints mark a sentinel). For each
declared relation, C013 measures the behind-part's coverage ∩ the occluder's coverage and counts how
many of those overlap pixels the behind-part is still the visible top of. `violating > 0` fires a
`warning`; a zero-overlap relation (probably a wrong target) is silent. It is high-confidence and
purely declarative — it only ever measures relations the author asked for, so it carries no
false-positive risk — and therefore joins the `--strict` must-fix subset (promoted to `error`,
alongside C001/C007). The measured parity travels on the rendered sprite (`Sprite.occlusions`) so
`critique` reads it without re-deriving layer identity.

**5 — `render --explain` prints the resolved paint order and solved angles.** The bottom-to-top layer
order with each layer's `behind`/`front` reason, each `fit`'s solved `aim N°`, and each declared
relation's overlap/violation counts — so a Z-order or orientation choice is inspectable, not implicit.

## Consequences

- The four RO characters express their Z-order / prop-pose declaratively: Knight back sword
  `aim … behind capeBack`, side sword `aim` canted forward, pauldrons `front capeBack`; Archer bow
  `aim`ed per view (back also `behind torsoBack`). All four keep `critique --strict` `pass:true`, and
  the sword/bow/cape defects are visibly fixed in the sheets.
- `behind`/`front` reorder placements only within one barrier-delimited segment; a target across an
  inline paint can't be reordered under it — C013 then flags the un-honored relation in the composite
  rather than the engine silently failing. Documented as the price of letting inline filters see the
  running composite.
- Rotating a thin curved stroke (a 3-px bow limb) via nearest-neighbour can open a 1-px interior
  pinhole (C008) at some angles — an authoring concern, resolved by a slightly wider limb / a clean
  angle, not an engine change.
- Touches `src/ast.ts`/`src/parser.ts` (fit `behind`/`front`/`aim`, contextual `stamp` clauses),
  `src/eval.ts` (`#execAssemblyBody` two-phase pass, `#orderLayers`, `#solveAim`, owner tracking,
  `PaintOrderRecord`, `PlacementRecord.aimDeg`), `src/critique.ts` (C013), `src/values.ts`
  (`Sprite.occlusions`/`OcclusionResult`), `src/diagnostic.ts` (E025), `src/cli.ts` (`--explain`
  paint order + aim + occlusions), [spec § Anchored assembly](../language-spec.md#anchored-assembly--pin--fit),
  and the product skill (`SKILL.md`, `reference.md`, `character-craft.md`).
