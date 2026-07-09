# 81. Loop-persistent `=` rebinding; theme-`pal` shadows canvas size; theme-body free bindings rejected

- Status: Accepted
- Date: 2026-07-09
- Deciders: t.koehn, Claude
- Refines: [ADR-0033](0033-evaluation-and-scope-model.md) (mutability/scope, point 9),
  [ADR-0073](0073-palette-namespace-for-pixel-cells.md) (extends the `pal`-shadows-`w`/`h` rule
  to theme palettes), [ADR-0005](0005-theme-composition-by-fold.md) /
  [ADR-0003](0003-themes-as-style-guides.md) (theme-body contents)

## Context

The [Icon-DX evaluation](../icon-dx-evaluation-2026-07-08.md) (§6, §9) put the theme system and
procedural control flow under load for the first time and surfaced three distinct scope-edge
defects, each verified with an isolated repro before this decision:

- **E2 — region accumulation in a loop is silently discarded.** `g = g.union(circle(…))` inside
  a `for` body rebinds only the loop's child scope; the enclosing draw-scope binding never
  changes, so only the pre-loop value survives — eight gear teeth vanished, `check` clean. The
  shipped workaround was one chained expression (system.drw). This is a general accumulator bug,
  not a region one: any `name = f(name)` inside a `for`/`repeat`/`while`/`if`/`match`/`mask`/
  `scatter`/`mirror` body was discarded. Notably, **`+=` already accumulates correctly** in a
  loop (it mutates the in-scope binding via an outward walk — [ADR-0033](0033-evaluation-and-scope-model.md)
  point 9); only plain `=`, which always *declared* in the current scope, did not.

- **E3 — a theme-`pal` key `w`/`h` collides with the canvas size.** [ADR-0073](0073-palette-namespace-for-pixel-cells.md)
  made a **drawing-local** `pal w=…` shadow the implicit canvas-width binding. A **theme**-`pal`
  key `w` did not: the draw environment declared the theme palette first and then overwrote `w`/
  `h` with the canvas dimensions, so `w` resolved to the number `32` — E006/E013 as a paint,
  E007 as a `pixels:` cell. The documented rule and the observed behaviour disagreed.

- **E4 — free bindings in a theme body vanish, then fail at the use site.** A plain
  `accent = #d8a53a` written directly in a `theme:` body (outside `pal:`) folded into nothing —
  the theme fold only handled `grad` bindings and silently dropped the rest — surfacing later as
  E001 `unknown name 'accent'` at the *use* site, far from the mistake.

## Decision

**1 — `=` reassigns an existing mutable binding in the enclosing draw scope (loop-persistent).**
A `name = expr` statement now first looks for an already-visible **mutable** (non-`const`,
non-palette) binding of `name` in the current environment chain; if found, it **reassigns** it,
so an accumulator written inside a block persists to the enclosing draw. Only when no such
binding is reachable does `=` **declare** a fresh binding in the current scope (unchanged for
genuinely new locals, including a `for` loop's own `i` and block-private temporaries). This
makes `=` consistent with `+=`, which already mutated in-scope accumulators.

```drw
draw gear 20x12:
  g = circle(4:6, 2)
  for i 0..3:
    g = g.union(circle((8 + i * 4):6, 2))   # now accumulates; all four circles render
  fill #c0c0c0 g
```

The search is **bounded to the draw body** (a `barrier` scope root): a block inside a draw
reaches the draw's own bindings but **never** a module-scope binding — a draw cannot mutate
shared module state, so render order stays irrelevant and determinism is preserved. A block-body
`=` naming a module constant therefore still shadow-declares draw-locally, exactly as before. A
reachable binding that is `const`/palette (the canvas `w`/`h`, a gradient, a theme palette entry)
is **not** a reassignment target — `=` there declares a shadowing binding as it always did
([ADR-0073](0073-palette-namespace-for-pixel-cells.md)), preserving that relaxation.

**2 — A theme-`pal` key `w`/`h` shadows the canvas size, exactly like a drawing-local `pal`.**
The draw environment declares the canvas `w`/`h` **first**, then the theme palette, so a theme
`pal w=#fff` wins — resolving to the colour in expressions, paint slots, and `pixels:` cells
alike. This extends [ADR-0073](0073-palette-namespace-for-pixel-cells.md) decision 2 from
drawing-local palettes to theme palettes; the two are now consistent.

```drw
theme mono:
  pal:
    w = #ffffff        # 'w' is the family's white, not the canvas width, in applying draws
    k = #1a1a1a
```

**3 — A theme body holds only pal/grad/size/mode/font/style/`with` + filter/draw definitions; a
free binding there is a positioned E004.** A plain (or `mask`) binding directly in a `theme:`
body — a value that the fold has no home for — is now rejected at its **declaration** with an
actionable hint (`put colours under pal:; move other constants to module scope`) instead of
folding into nothing and failing later as E001 at the use site. `grad NAME = …` stays legal.
Theme *design-token constants* (radius/margin/alpha) remain a module-scope concern (the shipped
finance.drw idiom); carrying them inside a theme is a possible future feature, deliberately not
bolted on here.

```drw
tile = #1f3a5f          # constants live at module scope, above the theme
theme fin:
  pal t=tile
  # accent = #d8a53a    ← E004 here, not E001 at the use site
```

**4 — Not version-gated.** Decisions 2 and 3 are pure relaxations/diagnostics: every affected
input previously errored (E006/E013/E007 for the `pal w` collision; E001 for the free binding),
so no valid `drawstic 1` recipe changes meaning. Decision 1 corrects a silent discard: the only
recipes whose output changes are those that performed a block-scoped accumulation the engine used
to throw away — behaviour no author intended (the same reasoning as
[ADR-0073](0073-palette-namespace-for-pixel-cells.md) §3). `lang` stays **2**. Verified: all
bundled `examples/**/*.drw` remain `check`-clean and pixel-identical (none use a theme-`pal`
`w`/`h`, a theme-body free binding, or a block-scoped self-reassignment).

## Consequences

- Closes the icon evaluation semantic/diagnostic edges E2, E3, E4. Region/number/point accumulators
  in loops "just work"; the family palette can use `w`/`h` as colour mnemonics under a theme; a
  misplaced theme-body binding points at the mistake, not its downstream symptom.
- `=` and `+=` now share one scope contract (reassign the nearest mutable in-scope binding),
  differing only in that `=` may also declare and is bounded to the draw body for determinism.
- New diagnostic surface: E004 at a theme-body free binding (was silent → E001 at use). No new
  error codes; no new syntax; no runtime value type.
- Touches [spec §9 Scope & evaluation](../language-spec.md) (block rebinding), [spec §10
  Palettes](../language-spec.md) / [§12 Themes](../language-spec.md) (theme-`pal` `w`/`h` shadow,
  theme-body contents), [§18 point 9](../language-spec.md) (mutability now covers `=`);
  `src/eval.ts` (`Environment.assignLocal` + `barrier`, `#execBinding`, `#renderDrawBody`
  ordering, `#foldBinding`); eval tests; the product skill (`skills/drawstic/SKILL.md` +
  `reference.md`).
