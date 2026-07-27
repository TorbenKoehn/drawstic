# 100. A model-comparison eval corpus, kept out of `examples/`

- Status: Accepted
- Date: 2026-07-27
- Deciders: t.koehn, Claude
- Relates to: [ADR-0096](0096-language-freeze-for-1-0.md) (release decision D3: one canonical
  generation per category in `examples/`), [ADR-0085](0085-critique-command.md), the
  Scene-DX / Icon-DX / Character-DX / Item-DX evaluations in [docs/](../).

## Context

Drawstic's pitch is that an LLM agent can author graphics from a text recipe. The obvious
question a reader has is: *which* agent, and how much does the model matter? Nothing in the
repository answers that today. The DX evaluations measure the language and the tooling against
one model tier at a time, and `examples/` deliberately holds a single, curated generation per
category, so it cannot show a spread.

Answering the question needs several models drawing **the same** subject from the **same**
brief, side by side. That collides with release decision D3 in two ways:

1. D3 requires one canonical generation per category in `examples/`, with superseded ones living
   in git history rather than next to each other in the tree.
2. `tests/unit/examples-critique.test.ts` gates `examples/**` on craft thresholds. A comparison
   corpus must be allowed to contain weak output, because a weak cell is the finding, not a bug.

Putting the comparison in `examples/` would either break D3 or force the weak results to be
cleaned up, which destroys the measurement.

## Decision

### 1 — A separate top-level `evals/` tree

Model comparisons live in `evals/model-comparison/<model>/<category>.drw`, never in `examples/`.
One directory per model, so each cell's artifacts land next to their own recipe and no two cells
can collide on an output name.
`examples/` keeps its D3 meaning: curated, canonical, craft-gated. `evals/` means measured,
as-produced, never touched up after the fact.

A recipe under `evals/` is **frozen once rendered**. Fixing a wonky result later would silently
turn a measurement into a portfolio piece. Reruns produce a new dated corpus instead.

### 2 — What is measured, and what is not

Four categories, chosen because they exercise different parts of the language and because they
stay legible at README thumbnail size:

| Category | Canvas | Exercises |
|---|---|---|
| Icon | 32x32 | palette discipline, silhouette clarity under extreme size pressure |
| Item | 48x48 | material response, `model`/`cel` shading, highlight placement |
| Character | 64x128 | figure oracle, modular parts, `skeleton`/`pose`/`fit` assembly |
| Scene | 192x108 | layered back-to-front composition, one light, depth and atmosphere |

Every model gets a byte-identical brief per category, no sight of any other model's work, the
same shipped product skill, and the same stopping rule. The comparison is therefore about the
model, not about the prompt.

Recorded per cell, alongside the image: whether the first `check` was clean, how many
check-and-fix iterations it took to get there, and the final `critique --as <cat> --strict`
verdict. Those numbers are cheap, objective and reproducible, and they say something the picture
alone does not: a cell that looks fine after nine repair rounds is a different result from the
same cell produced clean on the first pass.

Craft quality itself stays a human judgement. `critique` verifies structure, not craft
(the standing finding of the Character-DX evaluation), so the README presents the images and
lets the reader compare, rather than printing a grade the tool cannot actually compute.

### 3 — The briefs are committed

`evals/model-comparison/BRIEFS.md` holds the four briefs verbatim plus the protocol. A
comparison whose inputs are not recoverable is an anecdote, so the inputs ship with the outputs.

### 4 — Rendered images live in `docs/images/model-eval/`

README images are served from `raw.githubusercontent.com` on the default branch, so they have to
be committed. They stay out of the npm package, which continues to ship `dist/`, `skills/`,
`README.md` and `LICENSE` only ([ADR-0084](0084-minimal-npm-package-contents.md)).

### 5 — The corpus is gated for validity, not for craft

A new test asserts that every `evals/**/*.drw` parses, is `check`-clean and renders at its
declared size. It deliberately does **not** apply craft thresholds. This catches a corpus that
rots against a language change without ever pressuring the results themselves.

## Consequences

- `AGENTS.md` gains `evals/` in the project structure, with its "frozen once rendered" rule
  stated where an agent will actually read it.
- The README gains a comparison table. It is the first place in the project that shows Drawstic
  output which is not curated, which is the point.
- Model names and dates are recorded in the corpus, because the result is only meaningful with
  both. A rerun against newer models is a new dated directory, not an edit.
- `examples/` is unaffected, and its craft gate keeps its current strictness.
