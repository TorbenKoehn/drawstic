# 47. Unicode pixel keys: one code point per cell, symbol keys are table-only

- Status: Superseded by [ADR-0049](0049-ascii-letter-pixel-keys.md)
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Refines: [ADR-0032](0032-lexical-robustness.md) (the space ban generalizes), [ADR-0041](0041-rename-grid-block-to-pixels.md), [ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md)

> **Superseded (2026-07-04):** the Unicode key charset and the symbol-key tier are rolled
> back — pixel keys are a fixed, expression-safe set of ASCII letters, `.` is the built-in
> transparent cell ([ADR-0049](0049-ascii-letter-pixel-keys.md)). The UTF-8 source pinning
> and the no-grapheme-cluster cell rule carry over.

## Context

Pixel keys were "single characters" with exactly one exclusion (the space,
[ADR-0032](0032-lexical-robustness.md)) — the charset was otherwise undefined. Authors want
the full expressive range: shade blocks `█ ▓ ▒ ░`, box drawing, `♥`, `@` — ASCII-/ANSI-art
style authoring inside `pixels:`. Two hard problems hide in "just allow Unicode":

1. **"One character" is ambiguous.** Grapheme-cluster segmentation (UAX #29) changes with
   Unicode versions — a cluster-based cell rule would silently reinterpret rows across
   engines, breaking version pinning ([ADR-0029](0029-language-version-pragma.md)).
2. **Keys are scope bindings** ([ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md)) —
   but `█`, `1`, or `♥` cannot be identifiers (`1` is a number literal; `█.lighten(10%)`
   would wreck the lexer).

## Decision

**1 — Source files are UTF-8.** Pinned; any other encoding is an error.

**2 — A pixel key is exactly one Unicode scalar value (code point).** Never a grapheme
cluster — code point identity is eternally stable, cluster segmentation is not. A cell is
one code point; row width counts code points.

**3 — Allowed: every code point except the hazardous and the structural.** Banned as keys:

- **all whitespace** (space, tab, NBSP, Zs/Zl/Zp — generalizing ADR-0032's space rule),
- **control & format characters** (Cc, Cf) — this bans zero-width characters, BOM, and
  **bidi controls**, hardening against Trojan-Source-style visual spoofing,
- **combining marks** (Mn/Mc/Me) — they attach to the neighbouring glyph and would
  visually corrupt the grid,
- the **structural ASCII set** `#` `=` `:` `,` `(` `)` `"` — each would break comment,
  binding, block, list, or string syntax. `.` stays legal (the transparent idiom).

Everything else is a valid key: letters of any script, digits, `█ ▓ ▒ ░`, box drawing,
single-code-point emoji, `@ * + - /`.

**4 — Two tiers, resolving the ADR-0046 tension.** An entry whose name is a valid
**identifier** is an ordinary const binding, usable everywhere (paint slots, expressions,
cells). An entry whose key is **not** a valid identifier — a **symbol key** — is declarable
in `pal` and usable in `pixels:` cells, but is **not referable in expressions or paint
slots**: it is a table key, not a name. For expression-side use, bind an identifier
(`shade = #333`) or use a literal; the expression-side spelling of `.`'s usual meaning is
the keyword `transparent`.

```drw
draw dither 6x3:
  pal .=transparent  █=#1a1a1a  ▓=#555  ░=#bbb   # shade blocks as keys
  pixels:
    █▓░░▓█
    ▓░██░▓
    █▓░░▓█
```

**5 — Semantic exactness over editor alignment.** Wide glyphs (CJK, emoji) may *render*
two columns wide in editors while being **one cell** semantically — counting code points
is exact and self-verifiable; visual alignment is an authoring concern. `drawstic check`
MAY warn on mixed-display-width keys in one palette and on **confusable** key pairs
(e.g. Cyrillic а vs Latin a).

## Consequences

- ASCII-/ANSI-art authoring works: shade and box-drawing glyphs make `pixels:` blocks
  *self-illustrating* — the source approximates the rendered sprite.
- The cell rule is version-proof (code points) and the format-character ban closes the
  visual-spoofing class by construction.
- Fixes a latent spec bug: `fn checker(x, y) = … else .` used the symbol key `.` in
  expression position — now written `else transparent`.
- Touches spec §3 (UTF-8), §7 (key charset), §10 (checker example), §12 (symbol-key tier).
