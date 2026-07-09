---
name: new-adr
description: Creates a new Architectural Decision Record for Drawstic. Use whenever a material design or architecture decision is made (language semantics, syntax, tooling, infrastructure) — every such decision must be recorded as an ADR and synced into the docs.
---

# New ADR

Record a material decision as an ADR in `docs/decisions/` (MADR-lite house style).

## Steps

1. **Number:** next free 4-digit number — check the table in `docs/decisions/README.md`.
2. **File:** `docs/decisions/NNNN-short-kebab-title.md`.
3. **Body** (house style, see any recent ADR e.g. 0036):

   ```markdown
   # <N, no leading zeros>. <Sentence-case title>

   - Status: Accepted
   - Date: <YYYY-MM-DD>
   - Deciders: t.koehn, Claude
   - Resolves: <optional: spec open question N / supersedes ADR-XXXX part>

   ## Context
   <The problem/tension. Link related ADRs as [ADR-XXXX](XXXX-file.md) and spec sections as
   [spec §N](../language-spec.md#anchor). Cite bench evidence (`bench/reports/latest.md`) when it exists.>

   ## Decision
   <Numbered bold points: **1 — Rule.** Prose. Include minimal ` ```drw ` examples.>

   ## Consequences
   <Bullets: what it resolves, costs, which spec §§ / docs / examples must change.>
   ```

4. **Sync — never skip:**
   - Add a row to the table in `docs/decisions/README.md` (`| [NNNN](file.md) | Title | Accepted (…) |`).
   - If it supersedes/refines an older ADR: update that ADR's `Status:` line (and blockquote note) and its README row.
   - Reflect the decision in `docs/language-spec.md` (and mark any resolved item in §18 Open questions).
   - Update `docs/dsl-examples.md` if the syntax shown there changes.
   - Update `AGENTS.md` if project rules/structure are affected.

## Conventions

- Decisions are evidence-based where possible: run `bun run bench` for token/readability questions.
- Design priorities order (spec §1): in-distribution is a tiebreaker; error-robustness and self-verifiability are floors; token efficiency may override in-distribution, never the floors.
- Newest ADRs supersede older ones **explicitly** — status lines on both sides, never silently.
