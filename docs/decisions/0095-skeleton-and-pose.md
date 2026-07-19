# 95. Skeleton / pose rig, angle constraints, and auto-Z from bone depth

- Status: Accepted
- Date: 2026-07-19
- Deciders: t.koehn, Claude
- Refines: [ADR-0087](0087-anchored-assembly.md) (`pin`/`fit` place parts; pins ride the transform —
  a bone fit reuses that machinery), [ADR-0092](0092-occlusion-relations-and-aim.md) (two-phase
  assembly + `behind`/`front` + `aim` = the lowering target auto-Z compiles onto; `aim` is the 1-bone
  case of the forward kinematics here), [ADR-0093](0093-organic-region-constructors-figure-oracle-quantize.md)
  (the figure oracle — a skeleton's rest positions bind to the same proportion numbers).
- Implements Plan Welle 2 §E.

## Context

The four RO characters were assembled three times each — one hand-placed set of `pin`/`fit`
coordinates per view — with the view-to-view Z-order and prop pose fixed up by hand (ADR-0092's
`behind`/`front`, a per-view stamp reorder). Nothing tied the three views to one structure, so a
proportion change meant editing three coordinate blocks, and the back view's "arms behind the torso"
was a hand-reordered stamp rather than a declared fact. The 2026-07-10 review's remaining defects were
all *placement*: a view is not a flip of another, and the correct occluder in each view is a function
of depth, which the recipe never stated.

The prior layers give the substrate: `pin`/`fit` already place a part and carry its pins through a
transform (ADR-0087); the two-phase assembly already orders placements by `behind`/`front` edges and
`aim` already solves a 1-bone orientation (ADR-0092); the figure oracle already hands back proportioned
guide points (ADR-0093). What was missing was a *rig* — one named structure the three views are poses
of — and a way for depth to produce the occlusion edges instead of the author.

## Decision

**1 — `skeleton NAME:` declares a rig once, module scope.** Each body line is a joint: `NAME at POINT`
(anchored — its position is a point, typically a `fig` guide point, so the rig binds to the figure
oracle's proportions) or `NAME from PARENT ANGLE LENGTH` (forward-kinematic — placed off its parent by
a local rest angle and a bone length, the length free to read `fig` values). Either form may carry a
trailing `limit MIN:MAX` (the allowed pose-delta range, degrees). Joints are declared parents-first.
Forward kinematics is deterministic (dmath `dcosDeg`/`dsinDeg`/`datan2`, no iteration): a joint's world
angle is its parent's plus its local rest angle plus its pose delta, so a delta on a parent rotates the
whole subtree. A skeleton is a first-class value.

**2 — `pose NAME over SKELETON:` is an angle set over the rig.** A `view front|side|back` line folds
the figure oracle to that projection (shoulders/hips collapse in profile — ADR-0093); each
`JOINT DELTA [z Z]` line adds `DELTA` degrees to that joint's rest angle and optionally declares its
auto-Z depth `Z` (higher = nearer the viewer). A delta outside a joint's `limit` is a **positioned
error**, never a silent clamp — an unreachable pose is a red diagnostic, like an occlusion cycle.

**3 — A figure is a skeleton plus parts bound to bones.** `pose NAME` in a drawing body solves the rig
over the drawing's own canvas + figure oracle and binds every joint as a bone anchor. `fit part.pin
bone JOINT` then lands `part`'s pin on joint `JOINT`'s solved position and rotates the part by the
joint's pose-angle change about that pin (the ADR-0087 about-a-point machinery `aim` uses), so the part
inherits the bone's orientation from the active pose. A view/stance is one `pose`; the three views
become poses of one skeleton instead of three hand-placed assemblies.

**4 — Auto-Z: bone depth compiles to `behind`/`front` edges.** A `bone` fit carries its joint's view
depth onto its placement layer. In the two-phase paint order (ADR-0092) depth is the ordering key for
bone-fitted layers — deeper paints first (bottom), nearer last (top) — while a layer with no bone depth
inherits the nearest earlier one (a decoration stamped next to a limb sits with it). Explicit
`behind`/`front` edges remain hard constraints that always win, so **manual occlusion is the override**
and depth only orders what the author left unstated. The back view's "arms behind the torso" is now a
lower depth on the arm joints, not a reordered stamp.

**5 — `render --explain` prints the solved rig and C013 is unchanged.** Each applied pose prints every
joint's solved world position, world angle, pose-angle delta, and depth; the resolved paint order
prints each bone-fit's `zN` reason. C013 occlusion parity still measures only *declared* `behind`/`front`
relations (auto-Z needs no check — it *is* the order), so a manual override stays verified exactly as
before.

**6 — Animation-ready by construction, but not built.** A pose is an interpolable set of joint angle
deltas over a fixed skeleton; forward kinematics is a pure function of `(skeleton, deltas)`. Tweening
two poses is therefore linear interpolation of the delta maps followed by the same solve, and frame
generation is that plus the existing export path — a later unit (Plan §E3). This ADR only cuts the data
model so that work is pure interpolation, and builds none of it.

## Consequences

- The four RO characters are one skeleton + three poses each; the assembly draws are coordinate-free
  (`pose X` then `fit part.pin bone JOINT`). Wizard and assassin re-render byte-identical; knight and
  archer change only the side view (fig-derived shoulders / far limbs now correctly behind the torso —
  a small improvement). All four keep `critique --as character --strict` `pass:true`, and the
  sword/bow/cape fixes survive (aim on the prop fit, cape as an explicit `behind`/`front` override).
- A bone fit anchors the part at the joint's own position and applies only the pose *delta* rotation,
  so a part is authored in the rest pose and posing rotates it — the rest angle of the skeleton bone is
  never baked into the art. At the rest pose every delta is 0 and a bone fit degrades to a plain
  translation, identical to a pin fit.
- `behind`/`front` still target a part **name**, so two instances of the same part fitted to different
  joints can't be disambiguated by an override — a real recipe gives its parts distinct names (as the
  RO characters do). Auto-Z is the mechanism for same-named parts; explicit overrides are for the rest.
- Touches `src/values.ts` (`Skeleton`/`Pose`/`SolvedJoint`, `solveSkeleton` forward kinematics),
  `src/ast.ts`/`src/parser.ts` (`skeletonBlock`/`poseBlock`/`poseApply`, the `bone` fit source, all
  contextual keywords — `skeleton`/`pose`/`bone`/`at`/`from`/`limit`/`over`/`view`/`z` stay bindable
  everywhere else), `src/eval.ts` (`skeleton`/`pose` definitions, `#execPoseApply`, `#buildSkeleton`/
  `#buildPose`, the bone branch of `#resolveFitSource`, the bone rotation in `#execFit`, depth in
  `#execAssemblyBody`/`#orderLayers`, `PoseSolveRecord`), `src/cli.ts` (`render --explain` poses), the
  language spec (§Skeleton & pose), and the product skill (`reference.md`, `SKILL.md`,
  `character-craft.md`).
