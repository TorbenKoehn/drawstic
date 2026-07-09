# 32. Lexical robustness: indentation, line continuation, grid character rules

- Status: Accepted (the pixel-key charset is pinned to ASCII letters by [ADR-0049](0049-ascii-letter-pixel-keys.md); the full lexical grammar is pinned by [ADR-0052](0052-complete-normative-grammar.md))
- Date: 2026-06-17
- Deciders: t.koehn, Claude
- Refines: [ADR-0030](0030-structured-diagnostics-contract.md), [ADR-0031](0031-agent-loop-cli-preview-and-fmt.md)

## Context

[Spec §3](../language-spec.md#3-lexical-structure) only **recommends** 2-space
indentation. That is too soft for an indentation-significant grammar authored by LLMs:
"recommended" leaves a mixed-indent or tab-indented block as undefined behaviour rather
than a catchable error — a direct hit on error-robustness ([§1](../language-spec.md#1-design-priorities) #2).

Two more gaps:

- **No line continuation.** A long statement — a 20-vertex `poly`, a many-stop `grad` —
  had no way to wrap and became an unsplittable mega-line, hostile to both review and
  diffing.
- **Grid rows had undefined whitespace/comment handling** ([§7](../language-spec.md#7-pixel-literals--explicit-pixels)).
  Editors trim trailing whitespace; if SPACE were a meaningful grid key, a trim would
  silently corrupt a row. Whether a row could carry a trailing `#` comment was unstated.

## Decision

**1 — Indentation is spaces-only and per-block-consistent.** A TAB anywhere in
indentation is a positioned error ([ADR-0030](0030-structured-diagnostics-contract.md)). A block's
**direct children must share one consistent indent string**; mixing widths within a block
is a positioned error. 2 spaces recommended. Grid-block dedent uses the same rule.

**2 — Parenthesis-driven line continuation.** A statement continues across newlines
**while a `(` is unclosed** — so paren-form calls, long `poly` vertex lists, and many-stop
gradients may wrap freely. **Command-form** (no parens) stays single-line by definition;
to wrap such a statement, switch it to paren-form. There is **no `\` continuation and no
`;` separator** — consistent with [ADR-0018](0018-idiom-alone-does-not-justify-a-marker.md)
(one block style, no statement separator).

**3 — Grid rows are pure key sequences** ([§7](../language-spec.md#7-pixel-literals--explicit-pixels)):

- The **SPACE** character is **not** a valid grid key (positioned error). Trailing-trim can
  therefore never corrupt a row, and the `.` transparent convention is unambiguous.
- A grid row carries **no trailing `#` comment** — annotate **above** the block. `#` is
  therefore not a usable grid key either.

**Considered and rejected — run-length / sparse grid encoding.** It would cut tokens, but
defeats self-verifiability ([§1](../language-spec.md#1-design-priorities) #3): a model can
no longer count characters against `WxH`. The grid/commands hybrid
([ADR-0002](0002-hybrid-primitives-and-indexed-palette.md)) already covers large uniform
areas without giving up the visual checksum.

## Consequences

- Removes the whitespace and continuation footguns — every layout question now has a
  defined answer and a positioned error when violated ([§1](../language-spec.md#1-design-priorities) #2).
- Pairs with the canonical formatter ([ADR-0031](0031-agent-loop-cli-preview-and-fmt.md)): the
  formatter normalizes to 2-space indent and wraps long paren-form statements, so the
  rules above are what the formatter targets, not a separate convention.
- The SPACE-is-not-a-key rule makes the §7 grid genuinely trim-safe across editors — a
  practical robustness win for hand-authored sprites.
- Touches spec §3 (indentation, continuation), §7 (grid character rules), §17 (grammar).
