# 14. Token-efficiency bench suite (proxy metrics + GPT-BPE devDependency)

- Status: Accepted
- Date: 2026-06-14
- Deciders: t.koehn, Claude

## Context

The Recipe DSL claims to be token-efficient, and the spec's
[§18](../language-spec.md#18-open-questions-for-review) lists many "syntax A vs syntax B"
trade-offs (grid vs procedural, UFCS vs nested calls, expression-`if` vs block-`if` vs
`match`, symbolic vs UFCS set-ops, …). We were deciding these by intuition. We want
objective evidence — but token count is the *lowest* of the four design priorities, so a
tool that optimizes tokens alone would push the language the wrong way. (The priority
*ordering* was later refined by [ADR-0018](0018-idiom-alone-does-not-justify-a-marker.md):
token efficiency now overrides in-distribution but still never error-robustness or
self-verifiability — so the caveat stands unchanged.)

Constraints: it must be **offline and deterministic** (CI-friendly, no API keys), add no
*runtime* dependency to the shipped library, and weigh **human readability** (reviews) and
**machine editability** (tool-call edits) alongside tokens.

## Decision

Add a top-level `bench/` dev-tooling tree that, for one semantic target expressed N ways,
measures token count plus objective proxy metrics and emits a Markdown + JSON report.

- **Corpus of paired variants**, split `internal/` (Drawstic form vs Drawstic form,
  candidates) and `external/` (Drawstic vs raw SVG / JSON baselines). One directory = one
  semantic target; all variants must render the same framebuffer.
- **Tokenizer:** `js-tiktoken` (pure-JS, zero native deps) as a **devDependency**,
  `o200k_base` by default with `cl100k_base` as a cross-check. Claude's exact tokenizer is
  not available offline, so GPT BPE is an explicit *proxy*: relative deltas transfer, the
  online Anthropic count API is rejected to stay offline/deterministic.
- **Proxy metrics (no LLM judge):** chars, lines, indentation depth, symbol density, and
  per-edit Levenshtein token/char/line distance for a canonical edit.
- **Verdicts are input, not law:** winner is computed over candidates only, always carries
  a priority caveat and a noise-band flag, and the report surfaces *conflicts* where the
  token winner is not the most readable/editable candidate.
- **Scope the "no dependencies" rule** (AGENTS.md §3) to *runtime* dependencies of the
  shipped library. Dev-tooling dependencies (Biome, `js-tiktoken`) are permitted: nothing
  in `src/` imports them and they never reach `dist/`.

## Consequences

- This introduces the project's first `package.json` and `tsconfig.json` (the bench is the
  first runnable code); they are minimal and will be refined when `src/` and a `dist/`
  build land.
- Reports live in `bench/reports/` and are git-ignored; results are reproducible via
  `bun run bench`. Corpus files are excluded from `biome format` so the formatter can never
  silently change a measurement input.
- Findings inform §18 but never decide it — priorities 1–3 can and should override a token
  win. The report is structured to make that explicit.
- The GPT-BPE proxy can differ from Claude in absolute counts; we rely on relative deltas
  and flag cross-encoding disagreements.
- Variant equivalence is review-asserted until the engine can compare framebuffers
  (`expectFramebuffer` is a placeholder); the runner warns about this.
