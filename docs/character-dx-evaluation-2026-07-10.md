# Character-DX Evaluation — RO-Style Chibi, Declarative Pipeline (2026-07-10)

This rerun rebuilt the modular-character task under the **new declarative shade pipeline as the
default** (`light` / `material` / `lit` / `model` / `cel`, `pin`/`fit` assembly, and
`critique --as character --strict` as the done-gate). Four builders each authored a
Ragnarok-Online-style chibi in **three views** (front / side / back, each **≥64×128 px**) plus a
composed sheet, out-of-the-box from the product skill only. Artifacts live in
`examples/characters-ro/`. Fable was omitted this run (4 builders, not the historical 7).

## Summary — the headline is a verification-blindness gap

**All four builders cleared `critique --as character --strict` (exit 0), self-graded themselves
1.4–1.8 (on their "1.0 = best" scale), and reported the run a success. A human reviewer then looked
at the rendered sheets and graded the same four artifacts 2.4 / 3.6 / 4.6 / 5.5 on the German 1–6
scale — mediocre to near-failing — with a partly *inverted* ordering.** Structural seams (the
dominant historical bug) are genuinely solved: zero floating-limb iterations, every composer C007
clean. But **shading, placement correctness, faces, outlines, and held-prop orientation are visibly
failing across the run, and neither the builder self-assessment nor `critique --strict` detected any
of it.** The automated verification loop is measuring contact and colour-count, not craft — and here
it does not correlate, and partly anti-correlates, with human perception. That gap is the primary
finding of this evaluation; the builder-reported grade improvement (§8) is real only for structure.

## 1. Per-builder header

| Subject | Model | Per-view dims | Sheet | Lines | Full renders¹ | `critique` | `--strict` | Builder self-grade (rank) | **Human grade 1–6 (rank)** |
|---|---|---|---|---|---|---|---|---|---|
| Knight / Swordsman | opus | 64×128 ×3 | 216×150 | 313 | 9 | pass | exit 0 | 1.7 (3rd) | **2.4 (1st — best)** |
| Wizard / Mage | opus | 64×128 ×3 | sep. file | 234 | 3 | pass (2 rounds) | exit 0 | 1.4 (1st) | **3.6 (2nd)** |
| Assassin / Thief | sonnet | 64×128 ×3 | 248×160 | 284 | 6 | pass | exit 0 | 1.6 (2nd) | **4.6 (3rd)** |
| Archer / Hunter | sonnet | 64×128 ×3 | 208×140 | 268 | ~11 | C009 accepted | exit 0 | 1.8 (4th) | **5.5 (4th — worst)** |

¹ Iteration counts are **not normalized** — builders bucketed differently (Assassin counts render
*batches*, Archer counts individual `check`/`render` calls, Knight folds `critique` into its single
`build`). Within-builder signal only, not cross-builder arithmetic.

## 2. Human visual review (AUTHORITATIVE) — and the verification-blindness finding

This section is authoritative and outranks every builder self-report and `critique` result below it.

### 2.1 Grade divergence (quantified)

- **The two scales are not directly comparable in absolute value** (builder "1.0 = best, finer" vs.
  German 1–6). **The relative ordering is the signal**, and it partly inverts:
  - **Knight**: builder-3rd (1.7) → **human-best (2.4)**.
  - **Wizard**: builder-*best* (1.4) → a **mediocre human 3.6** — lost the top spot to what the
    builders ranked 3rd.
  - **Assassin**: builder-2nd (1.6) → **human-3rd (4.6)**.
  - **Archer**: builder-worst (1.8) → **human-worst (5.5, near-failing)** — the *only* point of
    agreement.
- **Spearman rank correlation ≈ 0.4** — weak, and carried entirely by Archer being last in both.
  The top three reshuffle.
- **The gate discriminates nothing about craft.** All four cleared `--strict` (exit 0), yet the human
  grades span **2.4 → 5.5 — a 3.1-point spread on a 6-point scale**. A pass/exit-0 result carries no
  information about whether the figure reads well.
- **Directly contradicts the builders' own top "wins" (§6).** Opus builders called `cel` shading "the
  star" / "the RO workhorse" and `pin`/`fit` a contact guarantee — human review faults exactly those:
  the shading (2.2 below) and part placement (2.3 below). Self-reported excellence tracked the tool's
  green lights, not the picture.

### 2.2 Visual findings (own cluster, highest priority)

**HV1 — Shading is too harsh, stepped, and linear; the default must become smooth. (ALL 4 → top
priority.)** The reviewer: "way too heavy," "way too linear," follows the form poorly — *does not even
read as cel-shading*. It needs more steps → smoother; **the pipeline default should produce clean
(smooth) shading, not harsh cel.** Root: the `model`/`shadeRegion`/`cel` lowering builds a
distance-from-a-point ramp across the whole region, so the band boundary ignores surface form. This is
the **same root** as the builder findings that the run already surfaced blind: `ramp()`'s fixed 0.35
darken clipping dark bases to black (§5.15), the C004 value-spread blind search (§5.9), and the
`model`-cast grey blob (§5.14). One shading-lowering rework addresses all of them.

**HV2 — `pin`/`fit` guarantees contact, not correct placement. (Wizard, worst-broken.)** In the
Wizard the **head sits *above* the neck** (floating, not on it) and the **hat is far too high** — yet
`critique` C007 was green. **C007 checks contact/connectedness, not anatomically correct placement.**
The slot/anchor system needs hardening, and there is no check for "is this part in the right *place*,"
only "does it touch something." This is why the figure the builder rated 1.4 (best) is a mediocre
human 3.6.

**HV3 — Faces / small detail fail at 64×128 chibi. (Archer, worst grade.)** The Archer face is
"terrible — consists of just 2 dots." Face and fine-detail craft at chibi scale collapsed; this drove
the worst human grade (5.5).

**HV4 — Back-view part selection and z-order are wrong; side-view silhouette bleeds. (Assassin.)** In
the **back view the arms are visible *on the back*** (wrong part choice / z-order for a rear view);
in the **side view the cape juts too far right, into the character.** Same root as the missing
back-view z-order idiom (§5.17).

**HV5 — Outlines render poorly. (ALL 4.)** The dark RO outline mechanism "doesn't work well yet" —
the signature RO silhouette outline is not landing cleanly across the run.

**HV6 — A held prop is not oriented consistently across views. (Knight.)** The sword is anchored/gripped
differently per view: **front** points up (ok); **side** points *down* with the hilt at shoulder
height (wrong); **back** is fully reversed — the hilt floats in the air and the Knight visually holds
the *blade*. Root: the prop is anchored at the wrong end per view, or a per-view flip inverts its
orientation, instead of guaranteeing "hilt stays in the hand, blade orientation stays constant
relative to the figure." Same root family as HV2 (contact ≠ correctness) and HV4 (missing back-view
orientation/z-order idiom).

**Consequence for the fix wave:** HV1–HV6 are craft/code defects that the entire automated loop
missed. They are weighted to the top of §9 by the human grades (shading affects all four; placement
and faces produced the worst absolute grades).

## 3. Builder self-assessment grade table (recontextualized — self-reported, not craft-validated)

Retained as data, but read against §2: these grades tracked the tool's green lights. Averages are the
mean of the numeric grades builders gave; where opus split a row the sonnets grouped, the note records
both.

| System | Avg | Range | Notes |
|---|---:|---|---|
| `themes` / shared light | **1.4** | 1.0–1.6 | Genuinely good and human-uncontested: one `light` in a `theme` reached every part + view with zero drift. Assassin graded it 1.0. |
| `light` (declarative) | 1.25² | 1.2–1.3 | Opus split it out; sonnets folded it into a 2.0 pipeline row. Trap: a **module-scope** `light` does not reach stamped parts (E024). |
| `material` | 1.5 | 1.5 | Believable base colours; `glow` (emissive) a standout. Inert under `cel`. |
| `model` | ~1.5³ | 1.5 | Sparingly used. Hit the silent grey-blob artifact (§5.14) and, per §2.2/HV1, the harsh-linear shading. |
| `cel` | 1.35² | 1.3–1.4 | **Self-rated "the star"; human review contradicts it (HV1).** Builders read crisp bands at part scale as the RO look; the reviewer read them as too hard and form-ignoring. |
| `pin` / `fit` | **1.7** | 1.2–2.3 | Widest self-grade spread. Loved for the contact guarantee (Wizard 1.3, Assassin 1.2) — but **HV2/HV6 show contact ≠ correct placement**, so the guarantee is narrower than the grades imply. |
| `stamp` | 1.5 | 1.4–1.7 | Reliable; `flipx`/`flipy`/`tint` worked (but per-view flip is implicated in HV6). |
| regions / masks | 1.6 | 1.4–1.8 | Expressive once the paren-vs-statement split was internalized. |
| `color` | 1.7 | 1.4–2.0 | No magenta drift; dinged for no forward luminance signal and dark-base clipping. |
| exports / sheet | 1.6 | 1.3–1.8 | Per-view trivial; the composed-sheet-vs-clean-critique tension (§5.1) cost every builder. |
| `critique` | 1.65 | 1.3–2.2 | Self-rated an autopilot — **§2 shows it is blind to shading, placement, faces, outlines, prop orientation.** It catches contact/colour/mass, not craft. |
| `check` / `render` / `fmt` | 1.3 | 1.1–1.4 | Fast, deterministic, `--json` everywhere. Uncontested. |
| diagnostics | 1.45 | 1.3–1.6 | Hints actionable; W002/W010 false-positives cost beats of doubt. |
| Part-composition / anchor discipline | 1.5 | 1.2–1.8 | Scaled to 6–15 parts × 3 views with no *seam* regression — but not placement-correct (HV2/HV6). |
| Proportion-DX (module constants) | 1.6 | 1.4–1.6 | Constants document intent; `fit` owns truth — and `fit` placed the Wizard head wrong (HV2). |
| Three-view workflow | 1.6 | 1.3–2.1 | Free light coherence; back view under-documented (HV4/HV6 are its failures). |
| `recolor` | n/a | — | Not exercised by any builder. |

² Mean of the opus split-out grades; sonnets grouped `light/material/model/cel` at 2.0.
³ Single numeric grade (Wizard).

## 4. Syntax assessment (averaged, builder self-report)

| Axis | Grade | Consensus |
|---|---:|---|
| Writability | ~1.5 | Declarative spine reads clean; once the first part compiled the rest were copy-adapt. Sharpest edge: the `fill`-command vs. `fill`-flag duality (§5.11). |
| Intuitiveness | ~1.6 | Names read like what they do. Non-obvious: module-vs-theme light; `fit` checking contact at *statement* time; `cel N` silently controlling darkness; `material` inert under `cel`. |
| Token economy | ~1.35 | Very high — one `light` line drives all shading; `cel region mat N` replaces a hand-dosed quartet. 234–313 lines for a 3-view figure is lean. |
| Editability | ~1.5 | Semantic bindings + one-statement-per-line ease surgical edits; part-internal polygons remain magic-number point lists. |
| Self-verifiability | ~1.5 | Builders rated this a strength — **§2 is the counter-evidence**: `check`/`critique`/`--strict` verified structure while shipping bad shading, a floating head, a 2-dot face, and a reversed sword. Self-verification covered the axes the tools measure and nothing else. |

## 5. Deduplicated builder findings (by hit-count)

Contradictions between reviewers are named, not averaged away. These are the builders' *own* findings;
the authoritative human findings are §2.

### 4/4

**5.1 — Composed sheet pollutes the character `critique` family.** *(Knight F6, Wizard F4, Archer F8,
Assassin F5.)* A three-figure sheet busts C006/C009/C011 vs. the individual views. Fixed four
different ways (transparent bg / separate `*-sheet.drw` / `--family` / lived with it). Hit by
construction if you export all four deliverables.

**5.2 — Front↔back of the same figure collapses as sibling-silhouettes (C009).** *(Knight F5, Wizard
F5, Archer F8, Assassin F2.)* **Contradiction:** three builders fixed it with a real art improvement
(cape flare, mirrored staff, enlarged cloak); **Archer** could never clear it (0.1194 → 0.0908) and
argues C009 is a poor metric for a character's own multi-view family. Unresolved judgement call.

**5.3 — `critique.pass:true` is achievable but not always without over-manipulating art.** Corollary
of 5.2 — three reached it, Archer consciously accepted C009. (And per §2, `pass:true` is not evidence
of craft either way.)

### 3/4

**5.4 — W002 false-positive on every `fit`-attached part.** *(Knight F3 ×7, Wizard F1 ×7, Assassin F6
×12; Archer silent.)* `check --lint` counts `stamp` but not `fit`. Confirmed: `src/lint.ts`
`collectStamped` (line 734) walks only `stmt.callee === 'stamp'`. Pure noise on any pin/fit-built
character.

**5.5 — W010 draw-order / first-fit false-positives.** *(Wizard F3, Archer F4, Assassin F4.)* `fit`
checks adjacency at statement time, not on the final composite: fitting before the covering part is
stamped (Wizard), an assembly's first fit onto empty canvas (Archer), and a fabricated 1×1 anchor part
that paints nothing (Assassin) all warn on a finally-connected figure.

### 2/4

**5.6 — `fit … shadow` anchors at the fit's own contact point, not the feet.** *(Archer F5, Assassin
F4.)* Correct for a ground-oracle fit, wrong for a joint-to-joint fit (drops the shadow at hip
height). Archer dropped `shadow` entirely (losing the required contact shadow).

**5.7 — `critique.pass` ≠ `--strict` exit code.** *(Knight F7, Archer F8.)* Exit trips only on
C001/C007; `pass` is false on any finding incl. advisories (C008/C009/C011/C012) that exit 0.

**5.8 — character-craft §4(a) root-seed idiom does not compile.** *(Archer F3 — E001; Assassin syntax
note.)* `stamp part POINT` + single `pin part.key POINT` registers only one key; the next `fit`
throws. **Only `fit` registers pins in canvas space.** Working form: ground-oracle `fit root.pin
CANVAS_POINT`. A bug in the skill's own worked example.

**5.9 — C004 value-spread on dark material = blind search.** *(Assassin F1 — 4/6 batches; Wizard
F7.)* Dark bases sit at 0.08–0.12 vs. the 0.15 floor; `litTone(warm, X%)` had no measurable effect
below ~35% then overwhelmed above ~50% — no intermediate signal. **Same root as HV1** (form-ignoring
lowering) and §5.15.

**5.10 — `fit` lacks `flipx`/`flipy`/`tint`/`mask`.** *(Knight F8, Archer F6.)* The far-limb depth-tint
idiom the guide recommends for fit-attached limbs is `stamp`-only; both fell back to a hand-stamp or a
duplicate part.

**5.11 — `fill` command vs. `fill` primitive-flag trap.** *(Wizard F2 ×5, Archer F1.)* `fill red
circle(c,r)` vs. `circle red c r fill`. Most likely first-session syntax error; caught by `check`.

**5.12 — C008 interior pinhole from natural gaps / overlapping cel.** *(Knight F4, Archer F9.)*
Inter-leg gap under one contact ellipse; a 1–3px cel-overlap pinhole never located even at `@8`.

### 1/4

- **5.13 — E024: module-scope `light` doesn't reach stamped parts** (Knight F1). *The* first-run trap
  for the mandated shared light.
- **5.14 — `model`/material-cast paints a grey blob onto transparent canvas** (Assassin F3). Silent to
  `check`/`critique`; found only via `--crop`. Same root family as HV1.
- **5.15 — `cel`/`ramp()` fixed ~0.35 OkLCh darken clips dark bases to `#000000`** (Archer F2). Silent;
  only `--explain` reveals it. Confirmed: `RAMP_SHADOW_MAX = 0.35` (`src/color.ts:421`), an absolute
  L-units darken. **Same root as HV1.**
- **5.16 — `cel N` band-count silently controls small-mass "beardiness"** (Wizard F6). `cel skin 2`
  half-darkens a ≤28px face. Related to HV1/HV3.
- **5.17 — back-mounted prop z-order inverts between views** (Archer F7). Stamp before the torso for
  front/side, after for back. **Same root as HV4/HV6.**
- **5.18 — profile torso must be widened vs. front** (Knight). A side reads thinner; head dominates.
- **5.19 — runner echo breaks `--json` pipes** (Knight F9). Repo-local papercut.

## 6. Excellence / highlight consensus (with the human contradiction named)

- **One theme `light` → free cross-view light coherence (4/4).** The one self-reported win human review
  does *not* contradict — light *direction* is coherent. (Its *hardness* is HV1.)
- **`pin`/`fit` eliminated seam gaps (4/4).** True for connectedness (C007 clean) — **but HV2/HV6 show
  contact is not placement**; the head still floated and the sword still reversed.
- **`critique` as autopilot QA (4/4 self-reported) — refuted by §2.** It caught contact/colour/mass; it
  missed shading, placement, faces, outlines, and prop orientation.
- **`cel` "the star" (3/4 self-reported) — refuted by HV1.** The builders' single most-praised system is
  the reviewer's single biggest complaint. This pairing is the cleanest evidence of the blindness gap.

## 7. Meta-findings

1. **Automated verification is blind to craft — this is the run's headline.** Builder self-grades and
   `critique --strict` (all four pass/exit-0) do not correlate (Spearman ≈ 0.4), and partly
   anti-correlate, with the human grades (2.4–5.5). The gate all four cleared discriminates none of a
   3.1-point human spread. `critique` measures contact, colour count, and silhouette parity; it does
   not measure shading quality, placement correctness, facial legibility, outline quality, or prop
   orientation — the axes humans judge first.
2. **Structural correctness is solved; the *visible* craft is not.** No builder spent an iteration on a
   seam. But shading (HV1), placement (HV2/HV6), faces (HV3), back-view (HV4), and outlines (HV5) all
   failed and shipped green. The cost did not move to "harder polish" — it moved to defects the tools
   cannot see.
3. **`fit` guarantees contact, not correctness.** C007 connectedness passed while a head floated above
   a neck and a sword reversed. The system needs a placement/anchor-correctness notion (expected slot
   position, orientation constancy) beyond adjacency.
4. **The declarative shading default is wrong for the target look.** A form-ignoring
   distance-from-a-point ramp produces harsh linear bands; the RO/chibi target wants smooth,
   form-following shading. HV1 unifies §5.9, §5.14, §5.15 under one lowering rework.

## 8. Delta vs. the 2026-07-09 run

The task was **materially harder** (three views not two, 64×128 not 48–64, a mandated pipeline, a
stricter gate; recolor dropped; 4 builders not 7, no fable):

| Dimension | 2026-07-09 | 2026-07-10 |
|---|---|---|
| Views | 2 (front+side) | **3** (front+side+back) |
| Per-view size | 48–64 px | **≥64×128 px** |
| Shading | stamp-based, hand-dosed | **mandatory declarative pipeline** |
| Assembly | loose stamp coords | **`pin`/`fit` default** |
| Done-gate | silhouette review | **`critique --as character --strict`** |
| Builders | 7 (1 fable, 3 opus, 3 sonnet) | 4 (2 opus, 2 sonnet; no fable) |
| Dominant bug | floating limbs / seams (5/7) | **none structural** — but shading/placement/faces/outlines fail (human review) |
| Builder self-grade | 1.8 | ~1.63 |
| **Human-reviewed craft** | (not separately captured) | **2.4–5.5 (German 1–6), mediocre-to-failing** |

**Read the delta narrowly.** The builder-reported 1.8 → 1.63 is real *only for structure*: `pin`/`fit`
did eliminate the floating-limb failure that dominated the prior run. But this is the first run with an
authoritative human pass, and it shows the self-reported improvement does not extend to visible craft —
the shading, placement, face, outline, and prop-orientation quality is mediocre-to-failing and went
undetected. The honest summary: **structure improved and is now solved; craft quality is unverified by
the tooling and, on inspection, poor.**

## 9. Prioritized actions (fix-wave input, weighted by the human grades)

### Code fixes — human-visual defects first (highest priority)

1. **Smooth, form-following shading as the pipeline default (HV1; all 4).** Rework the
   `model`/`shadeRegion`/`cel` lowering so bands follow surface form (normal/curvature-driven), not a
   flat distance-from-a-point ramp, and make the default **smooth** (more steps), not harsh cel. This
   single change also fixes §5.15 (ramp clips dark→black), §5.9 (C004 blind search), and §5.14
   (`model`-cast blob) — same root. Highest leverage: affects every figure.
2. **`pin`/`fit` placement *correctness*, not just contact (HV2/HV6; drove the worst absolute grades).**
   Harden the slot/anchor system so a part lands in the anatomically expected position, and add a
   **placement check** (expected slot vs. actual, e.g. head-on-neck) beyond C007 connectedness, so a
   floating head cannot pass green.
3. **Reliable held-prop anchoring + orientation consistency across views (HV6).** Guarantee the
   grip-pin stays in the hand and the blade direction stays constant relative to the figure — do **not**
   let a per-view flip invert prop orientation. Front/side/back must show the same grip.
4. **Back-view part-selection + z-order idiom in the engine (HV4; §5.17).** A rear view must select
   rear-appropriate parts and invert prop z-order (prop after the torso for back), so arms don't render
   on the back and props aren't swallowed.
5. **Outline mechanism (HV5; all 4).** Fix the dark RO silhouette outline so it renders cleanly at
   64×128 — the signature look is not landing.
6. **Face / small-detail legibility at chibi scale (HV3; worst grade).** Provide an engine-supported
   face-feature path (or a validated face primitive) so a 64×128 chibi face is more than 2 dots.

### Code fixes — tooling / trust (lower human-visible impact)

7. **W002: count `fit` targets** (3/4; `src/lint.ts:734`). Cheapest fix; restores `--lint` trust.
8. **`critique` family scoping** (4/4; §5.1). Auto-exclude internal helper parts and opaque composed
   sheets from the default character family.
9. **Align `critique.pass` with the `--strict` exit subset** (2/4; §5.7) — or add a `mustFixPass`
   field. (Note §2: `pass` should *never* be read as a craft signal regardless.)
10. **W010: evaluate connectivity on the final composite, or suppress on the root/first fit** (3/4;
    §5.5).
11. **`fit … shadow` foot anchoring** (2/4; §5.6) — anchor to the fitted part's footprint bottom or add
    a ground-Y param.
12. **Add `flipx`/`flipy`/`tint`/`mask` to `fit`** (2/4; §5.10) — but see action 3: prop flips must not
    invert orientation.

### Docs / product-skill fixes

- **Make smooth, form-following shading the documented default** and demote harsh cel to an opt-in look
  (HV1). Ship a dosage table once the lowering rework lands.
- **Write a chibi-face recipe** (HV3) — eyes/nose/mouth at 64×128 that reads.
- **Write the back-view chapter** (HV4/HV6; §5.17) — rear part selection, prop z-order inversion,
  held-prop grip-and-orientation constancy, deliberate silhouette differentiation instead of chasing
  C009.
- **Document that `critique`/`--strict`/`pass:true` verify structure, not craft** (§2/§7) — mandate a
  human/visual pass on the rendered sheet before "done."
- **Fix character-craft §4(a) root-seed idiom** (2/4; §5.8) — ground-oracle `fit root.pin CANVAS_POINT`.
- **State the theme-light rule first** (§5.13); keep the composed sheet out of the critiqued file
  (§5.1); document `pass` vs. exit (§5.7).
- **Value-spread (C004) budget recipe for dark material** (§5.9); `cel N` face trap (§5.16); `ramp()`
  dark-base clip caveat (§5.15); `fill` command-vs-flag (§5.11); `fit` missing flags + `shadow`-joint
  (§5.6/§5.10); profile-torso-widen + vertical-budget for tall headgear (§5.18); `material` inert under
  `cel`.

## 10. Craft-retrospective synthesis (deduplicated, requester count)

Human-visual items are marked **[HV]** and take precedence.

1. **[HV] Default shading must be smooth and form-following, not harsh linear cel.** (Human, all 4;
   subsumes builder §5.9/§5.15/§5.14.)
2. **[HV] `pin`/`fit` must place parts correctly, not merely in contact; held props must keep grip +
   orientation across views.** (Human — Wizard head, Knight sword.)
3. **[HV] Chibi faces and outlines need a real craft path at 64×128.** (Human — Archer face, all-4
   outlines.)
4. **Fix the root-seed idiom: only `fit` registers pins** — use ground-oracle `fit root.pin
   CANVAS_POINT`. **(2/4** — Archer proved it; Assassin, Knight noted friction.)**
5. **Keep the composed sheet out of the critiqued family** (transparent bg / separate file / `--family`).
   **(4/4.)**
6. **Write the back-view chapter** (rear parts, prop z-order inversion, prop orientation constancy).
   **(Human HV4/HV6 + 2/4 builders + 4/4 C009 behind it.)**
7. **`fit`'s missing `tint`/`flip` flags + `shadow`-joint anchoring** need documenting or fixing.
   **(3/4.)**
8. **Document that the automated gate verifies structure, not craft** — require a human visual pass.
   **(Meta, from §2; no builder flagged it — itself evidence of the blindness.)**
9. **Document `pass` vs. `--strict` split** (2/4); **value-spread budget for dark material** (2/4);
   **W010 first-fit is expected** (2/4); **`fill` command vs. flag** (2/4).
10. **`cel N` small-mass value trap** (1/4); **`ramp()` dark-base clip** (1/4); **theme-light first**
    (1/4); **profile-torso widen** (1/4); **vertical budget for tall headgear** (1/4).

**Named contradiction (§5.2):** three builders treat the C009 front/back collapse as a real forcing
function; Archer treats it as a poor metric for a character's own views. Resolve at the metric level
(exclude own views from C009, or relax the threshold for `--as character`).

## 11. Overall verdict

**Structure is solved; craft is unverified and, on human inspection, mediocre-to-failing (2.4–5.5).**
`pin`/`fit` and the theme-light model genuinely eliminated the seam/floating-limb failure that
dominated every prior character run — a real, durable win. But the run's decisive finding is that the
**automated verification loop (builder self-grade + `critique --strict`) is blind to the craft axes
humans judge**: it certified as "done" four figures with harsh form-ignoring shading, a floating head,
a reversed sword, arms on the back, a 2-dot face, and weak outlines, and its ordering does not track
human perception. The fix wave must lead with the human-visual code defects in §9 — smooth
form-following shading, placement correctness, held-prop orientation, back-view idiom, outlines, faces
— and must add a placement/craft check plus a mandated human visual pass so that "green" stops meaning
"structurally connected" and starts meaning "reads as the intended character."

## Fix Wave — Results (2026-07-10)

The fix wave landed the §9 code-and-docs actions. It does **not** re-run the human visual review or
change the §2 verdict — that authoritative human/vision pass and the follow-up craft-eval re-runs stay
HUMAN-GATED. What shipped:

- **HV1 — Form-following shading is now the `model` default** ([ADR-0089](decisions/0089-form-based-shading.md)).
  The harsh distance-from-a-point veil (`shadeRegion`+`lightRegion` over the bbox) is replaced by
  normal-based shading: exact inner distance-to-boundary (Felzenszwalb EDT) → dome height field →
  per-pixel Lambert with an ambient floor, toned `warm→base→cool`. **Smooth is the default** (Bayer-
  dithered terminator in pixel mode); `cel N` is the same intensity field as N form-following bands
  (opt-in). Subsumes the builder findings §5.9 (C004 dark-material blind search), §5.14 (`model` grey
  blob), §5.15 (`ramp()` dark→black clip) under one lowering rework.
- **HV2/HV6 — `pin`/`fit` placement correctness + held-prop orientation** ([ADR-0087](decisions/0087-anchored-assembly.md)
  Amendment 2). `fit` now takes the `stamp` transform flags (`flipx`/`flipy`/`rotN`/`scaleN`/`tint`/`mask`)
  with pins riding the transform; `pin HEAD.KEY PT` seeds all of a real part's pins (fixes the §5.8
  root-seed idiom); a placement self-check flags a pin >2px off its own part ink as **W011** (loose pin,
  part-local, high-confidence). Held props carry a `grip` pin authored in true orientation and the
  per-view *figure* flip is a separate `fit` that never touches the prop — front/side/back show the same
  grip. `render … --explain` reports each fit's landing point, coincidence, and pin-to-ink gap.
- **HV5 — Reliable silhouette outline** ([ADR-0090](decisions/0090-reliable-silhouette-outline.md)).
  `filterOutline` now rings the **whole-figure** silhouette from ≥50% coverage (`OUTLINE_ALPHA_MIN=128`,
  so the mandated soft contact shadow and AA fringe are not ringed), colour optional with a derived
  dark tone (`inkTone`, OkLCh L≈0.15), default width 1, 4-connected. RO idiom: one bare `outline` as the
  last statement of the assembly `draw`, not per part.
- **HV4 — Back-view idiom** and **HV3 — chibi faces** shipped as craft/docs units in `character-craft.md`
  §5b (rear part-selection, prop z-order inversion, front/back mirroring, side-clamp) and §7 (five-layer
  face recipe: `model` skin base, almond+iris+pupil+highlight eye, separated brow, shadow-stroke nose,
  ~70%-alpha mouth) — no engine change needed beyond the Amendment-2 fit transform.
- **Tooling / trust:** W002 now counts `fit`/`pin` targets (not just `stamp`); the default critique family
  auto-excludes a composed presentation sheet that stamps ≥2 siblings (§5.1); W010/W011 assembly warnings
  surface through `render`/`build`/`sheet`/`critique` (§5.5); C009 no longer fires between a character's
  own front/side/back views under `--as character` (§5.2 named contradiction resolved).
- **C006 export-target-aware** ([ADR-0085](decisions/0085-critique-command.md) known-limitation fix, this
  closeout). Smooth `model` shading spends 400–600 colours — a defect only for an indexed-PNG (≤256
  palette) or SVG (`<rect>`-per-band) export, not for a straight-alpha RGBA-PNG sprite. C006 now reads the
  drawing's declared export formats: a `'budgeted'` target (any `png … indexed`/`svg` line) enforces the
  tight profile ceiling as a `pass`-blocking `warning`; an `'unbudgeted'` target (RGBA-PNG/JPEG or no
  export — the conservative default) is a non-blocking advisory `info` under a generous ceiling. C006 was
  never in the `--strict` must-fix subset, so the exit gate and the `examples-critique` CI gate are
  unaffected.

### Re-rendered characters + final gate status

All four artifacts in `examples/characters-ro/` were rebuilt on the new default pipeline (Commit `5331bce`)
and re-verified with `critique --as character` after the C006 fix:

| Character | Shading style | distinct colours (view / sheet) | export | `pass` (plain) | `pass` (`--strict`) | `failedCodes` |
|---|---|---|---|---|---|---|
| Knight  | band `cel`/`flat`   | 21–29 / 33  | RGBA PNG @1 @4 | **true** | **true** (exit 0) | `[]` |
| Archer  | band `cel`/`flat`   | 43–62 / 75  | RGBA PNG @1 @4 | **true** | **true** (exit 0) | `[]` |
| Wizard  | full-smooth `model` | 468–481     | RGBA PNG @1 @4 | **true** | **true** (exit 0) | `[]` |
| Assassin| full-smooth `model` | 270–382 / 534 | RGBA PNG @1 @4 | **true** | **true** (exit 0) | `[]` |

Before the C006 fix, Wizard and Assassin were `pass:false` with `failedCodes:["C006"]` purely because
their smooth-`model` colour count exceeded the tight 96 character ceiling — not a defect for their RGBA
target. A synthetic indexed/SVG export of the same many-colour draw still fails (test-pinned), so the
budget is not simply removed, only scoped to the targets where colour count is real.

### One remaining open design decision (HUMAN-GATED)

**Default shading style is not yet unified: Knight/Archer use band `cel`/`flat`, Wizard/Assassin use
full-smooth `model`.** Both are ADR-0089 form-correct; which becomes the single RO default is a style
preference, not a correctness question, and is deliberately left to the user. (The authoritative human
visual pass on the re-rendered sheets and the craft-eval re-runs likewise remain HUMAN-GATED — see
`docs/impl-progress.md` §Character Fix-Wave open points and `measure-phase2`/`measure-phase4`.)
