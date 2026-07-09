# 66. Paint-first painting commands

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0036](0036-shapes-as-region-constructors.md) §6 (poly's exception becomes the rule), [ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md) (eliminator signatures), [ADR-0052](0052-complete-normative-grammar.md) (draw-suffix grammar rules)

## Context

Command-form painting statements placed the paint **after** the geometry
(`rect 0:0 15:15 k fill`) — except `poly`, which is paint-first because a variadic point
tail parses robustly only with the paint out front ([ADR-0036](0036-shapes-as-region-constructors.md) §6).
Two argument orders for one concept is a consistency defect against priorities 2/3:
authors must remember which command is the exception, switching a shape between `poly`
and `rect` moves the paint across the line, and the paint — the argument most often edited
during palette work — sits at a different column per command. User decision (2026-07-08):
one rule, no exceptions.

## Decision

**1 — The paint is the first argument of every painting command.** Applies to `px`,
`line`, `rect`, `rrect`, `circle`, `ellipse`, `arc`, `quad`, `bezier`, `poly` (already),
`fill`, `stroke`, `text`, and `flood`; `bg` is unaffected (single argument).

```drw
px k 3:3
line k 0:0 10:0
rect k 0:0 15:15 fill
rrect k 0:0 23:23 4 w2
circle r 8:8 5 fill
ellipse g 12:17 7:3 fill
arc k 12:12 8 180 360 w2
quad k 0:8 4:0 8:8
bezier k 0:8 2:0 6:0 8:8
poly k 2:1 6:4 2:7
fill y keyhole
stroke k ring(8:8, 7) w2
text k 5:5 "9" font small
flood y 3:3
```

**2 — The draw suffix becomes a paint prefix; flags stay trailing.** The desugaring of
[ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md) is re-anchored:
`circle k 8:8 5` ≡ `stroke circle(8:8, 5) k` → now written `stroke k circle(8:8, 5)`;
`circle k 8:8 5 fill` ≡ `fill k circle(8:8, 5)`. Trailing `fill` / `w<N>` (and smooth-mode
`cap`/`join`) flags remain trailing — they are modifiers, not arguments.

**3 — Region constructors are unchanged.** A shape call **without a paint** stays a pure
region expression (`circle(8:8, 5)`, [ADR-0036](0036-shapes-as-region-constructors.md)).
Disambiguation is unchanged in kind: statement position + paint present = draw; the paint
merely moved from last to first. A shape statement without a paint remains the
"region value dropped" positioned error.

**4 — Out of scope.** Filter commands (`outline`, `replace`, `dither`, …, whose leading
paint/region orders are their own signatures), `stamp` flag paints (`tint`, `shadow`),
path-body commands (no paint), and `grad` constructors are unchanged. No language-version
bump: v1 is unreleased (0.0.0), so the change lands in v1 semantics
([ADR-0029](0029-language-version-pragma.md) is untouched).

## Consequences

- One memorable rule — *"paint first, geometry after, flags last"* — replaces a
  per-command lookup; `poly` stops being special.
- **Breaking for every existing recipe.** One repo-wide sweep must update: engine argument
  order (`src/eval.ts` command handlers / draw-suffix helper), spec §8 table + §17 grammar
  (draw-suffix rules), [dsl-examples](../dsl-examples.md), [best-practices](../best-practices.md),
  `examples/**/*.drw`, all test recipes (including position-sensitive diagnostics
  assertions), `src/std/*.drw.ts` recipe modules, `skills/drawstic/` (SKILL.md +
  reference.md — product-skill rule, AGENTS.md §6), the README example, and TODO.md
  snippets.
- Error hints referencing the old order (e.g. missing-paint hints) must name the new
  position.
