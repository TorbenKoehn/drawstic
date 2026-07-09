# 57. Ranges are list expressions

- Status: Accepted
- Date: 2026-07-06
- Deciders: t.koehn, Codex

## Context

Loops originally carried a dedicated range form: `for i a..b:`. That made ranges useful only
in loop headers, while the language already treats comma sequences as first-class lists and
supports binding lists for reuse.

This split made `nums = 1..=8` impossible even though the visual model is "the range denotes
the sequence". It also blocked `for i nums:` where `nums` is a computed or named list.

## Decision

1. **Ranges are expressions.** `<a>..<b>` evaluates to a half-open list and `<a>..=<b>`
   evaluates to an inclusive list.

   ```drw
   nums = 1..=8
   ```

   binds the same value as:

   ```drw
   nums = 1, 2, 3, 4, 5, 6, 7, 8
   ```

2. **For loops iterate lists.** `for <name> <expr>:` evaluates `<expr>` and requires a list.
   Range loops remain valid because a range is now a list expression:

   ```drw
   for row 0..h:
     px 0:row k

   xs = 1..=3
   for x xs:
     px x:0 k
   ```

3. **Range construction is budgeted.** Each generated range element consumes runtime budget,
   matching the total-language constraint for computed list creation.

## Consequences

- `for i a..b:` is retained without adding an `in` marker.
- Named and literal lists can now drive loops directly.
- The normative grammar moves `range` from loop-only syntax into the expression grammar.
