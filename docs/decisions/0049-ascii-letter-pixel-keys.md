# 49. Pixel keys are ASCII letters — a fixed, expression-safe key set

- Status: Accepted (multi-character palette names removed by [ADR-0050](0050-single-letter-palettes-combined-by-composition.md))
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Supersedes: [ADR-0047](0047-unicode-pixel-keys.md) (the UTF-8 source pinning and the
  no-grapheme-cluster cell rule carry over); refines [ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md)

## Context

[ADR-0047](0047-unicode-pixel-keys.md) opened pixel keys to nearly all Unicode and paid
for it with a **two-tier namespace**: symbol keys (`█`, `1`, `♥`) cannot be identifiers
(`1` is a number literal, operators collide, `.` is dot-index), so they were declarable in
`pal` but **not referable in expressions or paint slots** — the one remaining exception to
ADR-0046's "palette entries are ordinary bindings". Further costs: rare code points are
multi-token (against the mantra), wide glyphs misalign the grid in editors, and `check`
needed confusable- and width-warnings.

The imagined payoff — large palettes via a huge key charset — is a mirage. A keyboard tops
out around ~80 typeable keys, and a hand-authored `pixels:` block with more colours than a
few dozen is the wrong tool anyway: procedural commands, gradients, `px` overlays, `tint`,
and `import` (PNG) cover that range. Expression-referability of *every* key is worth more
than charset breadth.

## Decision

**1 — A pixel key is exactly one ASCII letter: `a`–`z`, `A`–`Z`.** 52 keys, each a valid
single-character identifier — so **every** `pal` entry is an ordinary const colour binding
([ADR-0046](0046-one-namespace-palettes-as-bindings-and-artifact.md)), referable everywhere:
expressions, paint slots, and (single-letter names) `pixels:` cells. The **symbol-key tier
of ADR-0047 is removed** — there are no table-only keys. Digits, punctuation, and non-ASCII
characters are not keys: exactly the characters that forced the tier split. Multi-character
palette names remain ordinary identifiers, usable everywhere except as cells.

**2 — `.` is a built-in cell literal, not a palette key.** In a `pixels:` row, `.` always
means **transparent** — fixed, never remappable, and it contributes no entry to the ordered
palette artifact (transparency is the absence of paint, handled by the export format).
Declaring `.` (or any non-identifier) in a `pal` is a positioned error; the expression-side
spelling remains the keyword `transparent`. This keeps the universal pixel-art convention
while keeping the palette purely identifier-named.

```drw
draw dither 6x3:
  pal k=#1a1a1a  d=#555  l=#bbb    # every key an ordinary binding
  pixels:
    kdlldk
    dlkkld
    kdlldk
  outline lighten(k, 10%)            # the same names work in expressions
```

**3 — Cells resolve against single-letter palette entries only.** A cell letter must name
a visible single-letter palette entry (positioned error otherwise); `.` is transparent.
Rows remain literal — no expressions, no trailing comments
([ADR-0032](0032-lexical-robustness.md)). Since keys are ASCII, row width = character
count = editor column count; ADR-0047's wide-glyph and confusable warnings are dropped.

**4 — Carried over from ADR-0047:** source files are pinned **UTF-8** (comments, strings,
and style guides may use any Unicode — only keys/cells are restricted), and a cell is never
a grapheme cluster (now trivially single-column).

**5 — Large palettes stay out of scope for `pixels:`.** 52 keys is deliberately generous
for hand-authored sprites; needing more signals the wrong tool (see Context). A fixed-width
cell mode (`pixels 2:` — two characters per cell, quadratic key space, square editor
aspect) is the designated extension if real evidence ever demands one — rejected today as
speculative.

## Consequences

- ADR-0046's scope model becomes **exception-free**: every palette name is a const
  binding, referable everywhere — the symbol-key wart is gone.
- Cells are token-cheap (plain ASCII), keyboard-typeable, and column-exact in every
  editor; no confusable/width lints needed.
- The `█▓░` shade-block idiom is gone; ramps are named letters (`k`, `d`, `l`) — the
  source is less self-illustrating. Accepted for the uniform namespace.
- `pal . = transparent` lines disappear (the built-in covers them); recipes get a line
  shorter. Bench corpus files are unchanged (measurement inputs, never edited to spec).
- Supersedes ADR-0047. Touches spec §3 (UTF-8 cite), §7 (key set, `.` rule), §12
  (palettes), §18 (consistency note); [dsl-examples](../dsl-examples.md) §1/2/5/8/10/11.
