# 88. In-place v1 break: collapse the `drawstic 1`/`drawstic 2` double semantics

- Status: Accepted
- Date: 2026-07-10
- Deciders: t.koehn, Claude
- Supersedes: [ADR-0029](0029-language-version-pragma.md) point 3 (newer-than-supported pragma error) and its retain-old-semantics obligation
- Refines: [ADR-0068](0068-shaderegion-veil-opacity-signature.md), [ADR-0069](0069-additive-local-light-helper.md), [ADR-0070](0070-unified-shadow-argument-shape.md), [ADR-0072](0072-visual-stamp-anchors.md) (their v2 behaviour becomes the sole, unconditional behaviour)

## Context

[ADR-0029](0029-language-version-pragma.md) pinned a per-file `drawstic <N>` pragma so a future
semantics change would never silently move an existing recipe's pixels. Four such changes have
since landed, every one gated on the pragma: `shadeRegion`'s veil-opacity signature
([ADR-0068](0068-shaderegion-veil-opacity-signature.md)), the mask-respecting frame `shadow`
([ADR-0070](0070-unified-shadow-argument-shape.md) point 3), and visual stamp anchors
([ADR-0072](0072-visual-stamp-anchors.md)) all read `(ast.pragma ?? LANGUAGE_VERSION) >= 2` at
four call sites in `src/eval.ts` (plus the mirrored check gating lint `W005` in `src/lint.ts`).
Each gate is a legitimate, deliberate compatibility mechanism — but the compatibility it buys
protects **zero** existing consumers: Drawstic has no external users yet
([README](../../README.md), pre-1.0). Carrying two parallel engine semantics forever, to protect
nobody, is pure ongoing liability — every future shading/placement change (this transformation
adds several: [ADR-0086](0086-declarative-light-and-material.md),
[ADR-0087](0087-anchored-assembly.md)) would otherwise have to reason about, implement, and test
against *both* branches, and an agent reading `raster.ts`/`eval.ts` has to hold a v1/v2 mental
model it will never need.

## Decision

**1 — The engine collapses to one semantics.** The current version-2 behaviour of every gated
call site becomes the **only** behaviour, unconditionally:

- `shadeRegion`'s `amount` is always the veil opacity ([ADR-0068](0068-shaderegion-veil-opacity-signature.md));
  `shadeRegionLegacy` (`src/raster.ts`) is deleted, and its v1 dispatch branch (`src/eval.ts`,
  the `pragma >= 2` check around the `shadeRegion` case) is removed.
- The whole-frame `shadow` filter always respects an enclosing `mask …:` block
  ([ADR-0070](0070-unified-shadow-argument-shape.md) point 3); the `respectMask` pragma branch
  (`src/eval.ts`) is removed — there is only the mask-respecting path.
- The eight stamp anchors always resolve against the transformed, visible footprint
  ([ADR-0072](0072-visual-stamp-anchors.md)); the `visualAnchors` pragma branch and the
  `#anchoredStampOrigin` through-transform legacy path (`src/eval.ts`) are removed.
- Lint `W005` is retired outright, not merely "scoped to v1" ([spec §16](../language-spec.md#16-cli-surface)):
  under the sole semantics an opaque `shadeRegion` base is always the correct, intuitive call,
  so the case `W005` warned about no longer exists. The gate in `src/lint.ts` is removed along
  with the check.
- The deprecated two-bare-number `shadow dx dy paint` alias
  ([ADR-0070](0070-unified-shadow-argument-shape.md) point 2) is dropped from the parser; only
  the `dx:dy` point form is accepted for every shadow surface.

**2 — The `drawstic <N>` pragma becomes a parsed no-op.** The directive stays grammatically
legal — `ast.pragma` is still populated, so an existing file that opens with `drawstic 1` still
parses without error, and no author is forced to touch every file the same day this ships — but
nothing in `eval.ts`/`raster.ts`/`lint.ts` reads it anymore. There is exactly one semantics, so
there is nothing left to select. The "pins a version newer than the engine supports" check
([ADR-0029](0029-language-version-pragma.md) point 3, `ERROR_CODE.versionPragma` / `E009`) is
removed with it: no version boundary remains to violate, for any `N`. `LANGUAGE_VERSION` and
the language-version *concept* are retired from the engine's decision surface; the directive is
kept solely so old files don't need a mechanical strip pass.

**3 — This is a deliberate in-place break within language version 1 — not a version bump.**
"Niemand nutzt die Lib" (pre-1.0, no external consumer, [AGENTS.md](../../AGENTS.md) §1): the
cheapest, most honest fix for a compatibility mechanism that protects nobody is to remove the
duality it exists for, immediately, rather than accrete a third branch on top of two that never
mattered. There is no new pragma value to adopt and no migration window — every bundled example
that currently pins `drawstic 1` for v1-legacy pixels (`market`, several character scenes) is
updated to the (now sole) rendering in the same change that removes the branches.

## Consequences

- Deletes four version-branch call sites in `src/eval.ts`, one in `src/lint.ts`, and the
  `shadeRegionLegacy`/`#anchoredStampOrigin` legacy code paths in `src/raster.ts`/`src/eval.ts`
  — a straight simplification with no behavioural branch left to keep in sync.
- [ADR-0086](0086-declarative-light-and-material.md)'s `model`/`cel` lowering and
  [ADR-0087](0087-anchored-assembly.md)'s `fit` both build on exactly one primitive semantics as
  a result — no version parameter to thread through the new lowering code.
- Breaking pixel change for any recipe that relied on v1 `shadeRegion`/frame-`shadow`/anchor
  semantics, on the two-bare-number `shadow dx dy` spelling, or on a `drawstic N > 2` pragma
  erroring; given no external consumers exist, this is accepted outright rather than staged.
- Touches [spec §2](../language-spec.md#2-files--modules) (pragma description: parsed, inert),
  [spec §12](../language-spec.md#12-colour-gradients-filters--themes) (drop the dual-semantics
  filter text, describe the single behaviour), [spec §9](../language-spec.md#9-composition-transforms--masks)
  (drop the dual anchor text), [spec §14](../language-spec.md#14-determinism) (drop the
  version-2 difference list — there is no longer a difference to list), [spec §16](../language-spec.md#16-cli-surface)
  (remove the `W005` row, remove `E009`'s "unsupported version" case), `src/eval.ts`,
  `src/raster.ts`, `src/lint.ts`, `src/parser.ts`, every bundled `examples/*.drw` still pinning
  `drawstic 1`, and the product skill (`skills/drawstic/SKILL.md` + `reference.md`).
