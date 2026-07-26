# 96. Language freeze for 1.0 — removals, renames, one way per concern

- Status: Accepted
- Date: 2026-07-26
- Deciders: t.koehn, Claude
- Refines / amends: [ADR-0094](0094-language-diet-and-canonical-lints.md) (same intrinsic removal
  criterion, applied to the whole surface instead of the character path), [ADR-0088](0088-in-place-v1-break.md)
  (breaking in place, no version gate), [ADR-0086](0086-declarative-light-and-material.md),
  [ADR-0087](0087-anchored-assembly.md), [ADR-0065](0065-npm-and-github-publishing.md).

## Context

Drawstic is about to be published. Everything the audits in [docs/release-1.0/](../release-1.0/)
found that would become a **breaking change after 1.0** has to happen now or never.

Four independent audits (language surface, 180-session forensics, 68-recipe corpus usage, product
skill) converged on one diagnosis: the language is not too small, it is **too plural**. Every wave
added a better way and kept the old one. The measured consequences:

- ~40 of ~180 documented names are dead in the entire corpus; another ~25 appear ≤2× in one file.
- Six shading verbs, four placement idioms, three contact-shadow spellings, three ways to run a
  filter, three export-size spellings coexist — and the recipes split along generation lines rather
  than converging (`scenes*` never adopted `model`/`cel`; `characters-ro2` never adopted `mirror`).
- Agents hallucinate the *plural* parts: `use themes` for `use std/themes` (806 occurrences),
  `path`/`fn` inside a `draw` body (5 of 6 scene builders), point-shaped size headers.
- `shadeRegion`'s `amount` was read as opacity by **7 of 7** scene builders — a silent, universal
  misread of an API that has a declarative replacement.

The intrinsic criterion from ADR-0094 governs: a construct goes if it is **redundant** (a second way
to say the same thing), **confusing**, or a **special case without its own role**. Repo usage is not
a criterion — existing recipes get rewritten (and, per release decision D3, the superseded example
generations are deleted outright).

## Decision

### 1 — Removals (grammar-visible)

| Removed | Why | Say instead |
|---|---|---|
| `cap X`, `join X` | parsed and **discarded** since ADR-0053 deferred the geometry; `cap` additionally swallowed the next command argument | — (nothing was ever rendered) |
| `castShadow r dx:dy p` | byte-identical implementation to `shadow r dx:dy p` | `shadow r dx:dy p` |
| `seed N` | stored, never read | — |
| `grayscale(c)` | exactly `desaturate(c, 100%)` | `desaturate(c, 100%)` |
| `drawstic <N>` pragma | inert since ADR-0088 | — |
| bare-int export size (`png 512`) | third spelling of a size | `png 512x512` or `png @N` |
| bare filter name as a statement | third dispatch path for one filter | `apply NAME` |
| `anchor` on `fit` | parsed, explicitly ignored — a silently no-op flag is worse than an error | drop it (`fit` solves contact from the pins) |

Each removal keeps a **positioned error with a hint** naming the replacement, as ADR-0094 established
— a removed construct must teach, not just fail.

### 2 — Renames (all token-neutral or cheaper)

| Was | Now | Why |
|---|---|---|
| `import N = f.png` | `image N = f.png` | `import` means *module import* everywhere else; Drawstic's module import is `from` |
| `band(...)` | `ribbon(...)` | `band` already means cel band, `ripple` band, gradient band |
| `fit … shadow` | `fit … ground` | same word as `stamp … shadow dx:dy p` but zero-arity and different semantics |
| `ambientOcclusion` | `ao` | 4 tokens for a 1px contact-darkening helper |
| `pal` | `palette` | abbreviation that buys nothing |
| `grad` | `gradient` | same |

**`model` stays.** *Modelling* is the standing art term for rendering volume with light; the verb is
correct and the churn would be pure noise.

### 3 — One construct for sheet packing

`tileset` and `atlas` are merged: same concern (bake N drawings into one image plus a map), two
member keywords, two layout vocabularies. The survivor carries an optional uniform tile size, and the
sidecar exports (`tiled`, `tiled xml`, `atlasJson`, `aseprite`) hang off the one construct.

### 4 — A single light resolution rule

`model`/`cel` resolve their light as: **explicit `light L` argument → theme light → the module's sole
`light` binding → `E024`**. The third step is new. A file that declares exactly one light and no
theme currently raises `E024` from every `model`, which was the most common first-run trap in the
session corpus (19 hits across 12 transcripts) — an author who has declared one light in one file has
unambiguously said what the light is. Two or more module-scope lights without a theme keep raising
`E024`, now naming the candidates.

### 5 — Builtin reservation is uniform

Every name in the builtin catalogue is reserved (`E007` on shadowing). Today `ramp`/`litTone`/
`shadowTone` are shadowable while `tones`/`mixes` are not, and `model`/`cel` are absent from
`BUILTIN_NAMES` entirely — an unexplained split at one abstraction level.

### 6 — Export paths are recipe-relative

`build` defaults `--out` to **the recipe file's own directory**; an `export` path is relative to that
and must not contain `..`. Rebuilding the corpus surfaced five different conventions in one repo
(bare name, `dir/name`, full `examples/x/y/name`) and produced duplicated junk directories, because
the recipe and the build command each encoded half of the destination. Now the recipe alone decides
the layout and `--out` only relocates the whole tree. A new lint flags an export path that repeats
its own directory prefix.

### 7 — `mix`'s colour-space argument is a bare keyword

`mix(a, b, t, rgb)` — the form the spec documents — parses. The string form was the only string enum
in a language whose every other enum is a bare contextual keyword.

### 8 — The raw shading floor

Decided separately in [ADR-0097](0097-canonical-shading-floor.md) after probe verification: at most
one hand-light primitive survives, and `model`/`cel` + `material` is the canonical path for every
shaded mass.

## Consequences

- **Breaking, deliberately, before anyone depends on it.** The bundled corpus is rewritten in the
  same change; there is no compatibility mode and no version pragma (ADR-0088 precedent).
- The removed names stay burned: `W004` and every removed construct keep their code/identity and are
  never reused for something else.
- Touches `src/parser.ts`, `src/ast.ts`, `src/eval.ts`, `src/lint.ts`, `src/cli.ts`, `src/values.ts`,
  `docs/language-spec.md` (including the §17.4 grammar, which also gains the missing `pin`/`fit`,
  `behind`/`front`, `quantize` and organic-constructor productions), the product skill, and every
  `examples/**/*.drw`.
- The census in `critique --json` gains the removed names as *retired* entries so a stale recipe is
  diagnosed rather than silently mis-parsed.
