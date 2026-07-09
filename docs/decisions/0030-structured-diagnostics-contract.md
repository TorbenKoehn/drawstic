# 30. Structured diagnostics contract (`--json`) for the agent loop

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude
- Refines: [ADR-0008](0008-cli-design-brief.md)

## Context

The spec leans on "positioned errors" in roughly ten places ([spec §16](../language-spec.md#16-cli-surface),
[§6](../language-spec.md#6-drawings), [§7](../language-spec.md#7-pixel-literals--explicit-pixels),
[§21](../language-spec.md#21-canvas-size)…) but never pins down their **shape**. That is a
hole, because the author is an LLM that writes and then **self-corrects** ([spec §1](../language-spec.md#1-design-priorities),
priorities 2 *error-robustness* and 3 *self-verifiability*): the diagnostic **is** the
feedback signal. Prose tuned for humans forces the agent to scrape free text — brittle,
and it drifts as messages are reworded.

[ADR-0008](0008-cli-design-brief.md) already gave the agent a machine-readable **input**
(the `context` brief). The symmetric **output** — what went wrong — was left informal.
A diagnostic the agent can parse deterministically closes the loop.

## Decision

**1 — One stable diagnostic record.** Every diagnostic the CLI emits is the same shape:

```json
{
  "severity": "error" | "warning" | "info",
  "code": "E001",
  "message": "unknown name 'slmie'",
  "file": "creatures/slime.drw",
  "line": 12, "col": 3,
  "endLine": 12, "endCol": 8,
  "hint": "did you mean 'slime'? (imported from creatures/parts.drw)"
}
```

- `line`/`col` (and optional `endLine`/`endCol`) are **1-based**; the span is half-checked
  against the source so a model can point at the exact token.
- `endLine`/`endCol` and `hint` are optional; everything else is always present.

**2 — Stable codes.** `code` is a **stable** identifier, never reworded, grouped `E###`
(error) / `W###` (warning) / `I###` (info). Illustrative:

| Code   | Meaning |
|--------|---------|
| `E001` | unknown name (undeclared / not imported) |
| `E002` | grid size mismatch (`grid:` rows vs header `WxH`, §7/§21) |
| `E003` | size unresolved (no `WxH`, no `grid:`, no `size` default, ADR-0021) |
| `E010` | render budget exceeded (§15, total-not-Turing-complete) |
| `W001` | palette key defined but unused |
| `W002` | theme style-guide conflict on fold (ADR-0005) |

**3 — `--json` on every command.** `check`, `build`, `render`, and `context` all accept
`--json`. With it, the command emits a **JSON array of diagnostic records** to stdout
(for `context`, the design brief is additionally emitted as JSON). Without it, the same
diagnostics print in the human-readable positioned form.

**4 — Same information, two surfaces.** The human format and the JSON carry the **same**
`code`, position, and `hint`, derived from one record — so the two **cannot drift**. The
human form is a rendering of the record, not a parallel string.

**5 — Exit code.** A command exits non-zero **iff** at least one `error`-severity
diagnostic was produced. Warnings and infos never fail the command.

## Consequences

- Closes the agent's correction loop: it parses diagnostics deterministically instead of
  scraping prose, the missing half of [ADR-0008](0008-cli-design-brief.md)'s agent
  ergonomics (brief in, diagnostics out).
- Stable codes become a **compatibility surface** — once `E002` ships it keeps its
  meaning. They must be documented and treated like public API; renumbering is a breaking
  change.
- One record type for all severities keeps `check`/`build`/`render`/`context` output
  uniform — the agent writes one parser.
- Touches [spec §16](../language-spec.md#16-cli-surface) (a `--json` flag on every command;
  the diagnostic record and the code table become normative).
- Directly serves priorities 2 and 3 ([spec §1](../language-spec.md#1-design-priorities)):
  positioned, self-describing, machine-readable feedback.
