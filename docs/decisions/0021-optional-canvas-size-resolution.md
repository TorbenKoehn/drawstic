# 21. Canvas size is optional with a resolution order; `WxH` stays literal

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude
- Refines: [ADR-0003](0003-themes-as-style-guides.md) (fills in the unspecified "canvas defaults")

## Context

`draw <name> <W>x<H>:` ([spec §6](../language-spec.md#6-drawings)) hard-coded the canvas
size into the header as two **literal** integers. Two complaints:

- **It felt static.** Two questions hid inside one: *may `W`/`H` be variable?* and *must
  they be stated at all?*
- **For grid sprites the size is pure redundancy.** [§7](../language-spec.md#7-pixel-literals--explicit-pixels)
  already requires the `grid:` rows to match `WxH`, so a 5×5 sprite states `5x5` and then
  immediately restates it as 5 rows of 5 chars — the header carries no information the grid
  doesn't.
- **Uniform sets repeat themselves.** A 16×16 icon set writes `16x16` on every drawing.
  [ADR-0003](0003-themes-as-style-guides.md) already promised themes carry "canvas
  defaults", and the [§12 merge rules](../language-spec.md#composition-with-with-no-inheritance)
  fold "canvas defaults: by name, last wins" — but no syntax was ever specified.

### Why `W`/`H` must not become expressions

Allowing arbitrary expressions in the size slot loses on every core priority
([§1](../language-spec.md#1-design-priorities)):

- **Self-verifiability (3).** `16x16` is evident on sight; `w*2+pad` must be evaluated
  before the canvas size is known.
- **Grid cross-check (2).** Hand-drawn sprites are verified by *counting* characters
  against a concrete number; a variable dimension defeats that guard.
- **`context` brief (ADR-0008).** The design brief lists drawings as `name + WxH`; a
  runtime expression is not statically presentable.
- **Lexical collision.** The `x` separator is the strongest idiom Drawstic has (`16x16`,
  `1920x1080`) but only works between **literals** — `size x size` and `2*8x2*8` collide
  with multiplication and are unparseable/ugly. A space form `<W> <H>` only buys a problem
  that pure-literal sizes never have, at the cost of that idiom. `W:H` collides with the
  point literal (`x:y`) and the block `:`.

So the right move is **not** to parametrize the slot, but to make it **optional** and hoist
repeated sizes into a **default** — which is exactly what ADR-0003 anticipated.

## Decision

**1 — `WxH` is literal-only and `x`-separated, unchanged in form.** `W` and `H` are integer
literals, never expressions or variables. The `x` separator stays. True scaling is
`scale<N>` on `stamp`/`export` ([§9](../language-spec.md#9-composition-transforms--masks),
[§13](../language-spec.md#13-output--the-export-element)), never a canvas dimension.

**2 — The header size is optional.** A `draw`'s size is resolved in this order; the first
that applies wins:

1. **Explicit header** `draw name WxH:` — wins. If a `grid:` is also present, the header
   is **checked against it** (mismatch = positioned error): explicit size acts as an
   assertion, not a second source of truth.
2. **Inferred from `grid:`** — rows give `H`, row width gives `W` (rows must be equal
   width, already the rule). The redundant header may be dropped.
3. **`size` default** — the nearest active default (see 3).
4. **Otherwise** a positioned error: *"drawing `<name>` has no size — add `WxH`, a `grid:`,
   or a `size` default."*

**3 — A `size WxH` directive sets the default, at module or theme scope.** It is a
command-form directive (like `with`, `mode`, `use` — [§3](../language-spec.md#3-lexical-structure)),
not a `=` binding:

```drw
size 16x16                 # module-level default for every size-less draw in this file

theme icons:
  size 16x16               # the machine-part "canvas default" (ADR-0003); applied via `use`
  pal: …
```

Theme `size` defaults merge by the standard fold ([ADR-0005](0005-theme-composition-by-fold.md)):
later wins. A **module-level `size` overrides the theme's**, mirroring how a local `pal`
overrides a theme palette ("local definitions are folded last and always win",
[§12](../language-spec.md#composition-with-with-no-inheritance)).

`w`/`h` ([§5](../language-spec.md#5-coordinate-system)) resolve to the **resolved** size
regardless of which rule supplied it.

## Consequences

- Three cases, each minimal: a grid sprite omits the size (inferred); a procedural icon in
  a uniform set omits it (theme/module `size`); a one-off procedural drawing is the **only**
  case that must still state `WxH` (it has no intrinsic size and no applicable default).
- The "may W/H be variable?" question is answered without weakening self-verifiability: you
  don't vary the slot, you hoist the default.
- Fills in ADR-0003's "canvas defaults" with concrete syntax and a precedence rule; no new
  concept — `size` reuses the existing module/theme-directive scope split.
- Header-as-assertion keeps the §7 grid checksum available for authors who want the guard,
  while no longer forcing it.
- A drawing whose size depends on a default is **not self-contained**: read in isolation its
  size is unknown. Accepted — the `context` brief resolves and reports the effective `WxH`,
  and the explicit header remains available whenever a drawing should stand alone.
- Touches spec §6 (drawings), §7 (grid — size may be inferred), §12 (theme `size` default),
  §17 (grammar: `size` optional, `size` directive). Tileset/atlas sizing
  ([§9](../language-spec.md#tilesets--atlases)) is unaffected: a `tileset`'s `WxH` is the
  **tile size** and stays mandatory; an `atlas` has no canvas size.
