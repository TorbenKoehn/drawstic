# 73. Palette namespace for pixel cells; unreserve `by`

- Status: Accepted (extended to theme palettes by [ADR-0081](0081-loop-persistent-rebinding-and-theme-scope-edges.md) — a theme-`pal` key `w`/`h` shadows the canvas size too)
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md) (relaxes its
  palette-captures-a-value collision half), [ADR-0049](0049-ascii-letter-pixel-keys.md) (cell
  resolution); [ADR-0061](0061-first-class-paths-and-local-pen-cursors.md) (removes the last
  `by` residue)

## Context

The [Scene-DX evaluation](../scene-dx-evaluation-2026-07-08.md) found **4 of 6 agents hit `E007`**
declaring `pal w=…` / `pal h=…` — the natural colour mnemonics (`w`=white/window/wood,
`h`=hair) are stronger than the documented "avoid `w`/`h` as keys" gotcha, so the warning
lost every time. The collision is not a cell-resolution problem: it fires at *declaration
time*. Inside a drawing the engine binds `w`/`h` to the canvas size ([spec §5](../language-spec.md)),
and [ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md) made a palette entry
that captures a visible **non-palette** binding a hard error — so `pal w=#fff` errors against
the implicit `w`-is-width binding the author never wrote.

That reverse-direction ban was ADR-0046's weakest half. Its stated goal — "a colour name
never silently changes meaning mid-recipe" — is served by the *other* direction (a `let`/param
may not steal a live palette key). But rejecting a **deliberate `pal` declaration** because it
shadows an *engine-injected* `w`/`h` protects nothing the author owns; it just blocks the most
natural key names. Empirically (`check`) every `pal <value-binding>` case errors today, so no
valid recipe relies on the ban.

Separately, [ADR-0061](0061-first-class-paths-and-local-pen-cursors.md) removed the drawing-
global `by` relative point (replaced by path-local `rel`), but `by` was left in the parser's
`RESERVED` set. It plays **no grammar role** — `for-stmt = "for" NAME range ":" block` has no
step clause, and `by` appears nowhere else in the grammar. The evaluation flagged it: `by = 3`
now yields a reserved-word `E004` (task 2.1) for a word that no longer means anything.

## Decision

**1 — Pixel-row cells resolve in the palette namespace only.** A `pixels:` cell letter
resolves *exclusively* against the active palette (visible single-letter `pal`/theme entries)
plus any inline-glyph paint keys — never against the general lexical scope. A cell that names
no such entry is a positioned **`E007`** (palette namespace miss), with a hint pointing at
`pal <k>=<color>`. This was already the observable behaviour (a non-palette binding in a cell
always errored); it is now the *rule*, and the miss is coded `E007` (a palette concern) rather
than the generic `E001` unknown-name.

**2 — A `pal` key may shadow a visible non-palette binding; `w`/`h` and any letter are legal
keys.** Declaring a palette entry whose name matches a visible **non-palette** binding
(implicit `w`/`h`, a gradient name, an outer `let`, a parameter) is no longer an error — the
`pal` entry shadows it within its scope (later binding wins, standard lexical shadowing). The
palette *is* the drawing's colour vocabulary, so an explicit colour declaration is
authoritative.

```drw
draw window 4x4:
  pal w=#fff  h=#8af      # 'w'/'h' shadow the canvas-size bindings here
  pixels:
    wwww
    whhw
    whhw
    wwww
```

Within a drawing that names `pal w`/`pal h`, `w`/`h` in an expression then mean the colour, not
the canvas dimension — if you need the size, pick another key. The **reverse** direction is
unchanged ([ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md)): a
`let`/`const`/loop-var/parameter may **not** shadow a visible palette entry (still `E007`) —
that is the guarantee that a colour word keeps its meaning.

**3 — Not version-gated.** Both changes are pure relaxations: every affected input errored
before, so no `drawstic 1` recipe changes meaning. The fix applies to all language versions.

**4 — `by` is unreserved.** `by` is removed from the parser's reserved set — it is an ordinary
name again (`by = 3` binds normally). The two historic "'by' relative points are not allowed"
error messages (thrown when a `rel` point reaches a drawing/path command) drop the dead `by`
spelling and name `rel` instead. `RESERVED` is now `rel if then else true false transparent
mod as`.

## Consequences

- Closes the evaluation **`E007` w/h class** (finding 4) and the reserved-`by` E004 confusion
  (finding 9): the natural mnemonic keys just work.
- Relaxes [ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md)'s
  "palette-may-not-capture-a-non-palette-binding" bullet; the value-may-not-shadow-palette
  bullet stands. The two directions are now asymmetric by design.
- Cell resolution is a genuine separate namespace (`Environment.visiblePalette` + glyph paint
  keys), decoupled from arbitrary scope — future scope changes cannot leak into `pixels:`.
- Reclassifies the pixel-cell miss `E001` → `E007`; no test or contract pinned the old code
  (the ADR-0030 table is illustrative and omits both).
- Touches [spec §7](../language-spec.md) (cell namespace, `w`/`h` legal), §10 / §12 (asymmetric
  collision rule), §17.2 (reserved list drops `by`), §18; `src/parser.ts` (RESERVED),
  `src/eval.ts` (`#execPal`, `#execPixel`, `by` messages); `skills/drawstic/SKILL.md` +
  `reference.md` (the w/h gotcha → new rule); `docs/best-practices.md`; parser/eval tests.
