# 35. Import resolution: root sandbox, cycle policy, bundled `std/` modules

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude
- Refines: [ADR-0019](0019-source-first-module-references.md)

## Context

[Spec §2](../language-spec.md#2-files--modules) allows `from ../themes dusk` with `..` but
never **bounded** it — an unbounded `..` is a path-traversal and non-determinism risk (the
same Recipe could resolve differently depending on what sits above the project root). The
spec also said nothing about **import cycles**, and shipped **no shared library** — so every
agent re-authors common parts and themes by hand, undermining the cross-drawing consistency
the project exists to provide.

## Decision

**1 — Resolution is rooted and sandboxed.** Imports resolve relative to the **project root**
— the entry file's directory, or a CLI-configured root. `..` **may not escape the root**;
escaping is a positioned error ([ADR-0030](0030-structured-diagnostics-contract.md)). Relative paths only:
**no network, no globs** — [ADR-0019](0019-source-first-module-references.md) is otherwise
unchanged.

**2 — Import cycles are a positioned error in v1.** Even though definitions are
order-independent **within** a module ([ADR-0033](0033-evaluation-and-scope-model.md)),
**cross-module cycles are rejected** for simplicity and analyzability. (May be revisited if
a real need appears.)

**3 — Ship a bundled standard library under `std/`.** A small standard library lives under
the **reserved prefix `std/`** — e.g. `from std/shapes arrow, chevron`;
`use std/themes pixel-base`. Initial contents are minimal and grow by ADR. `std/` is
resolved **by the engine, not the filesystem**, so it is always available and
**version-pinned** with the engine ([ADR-0029](0029-language-version-pragma.md)).

## Consequences

- Makes imports **safe and deterministic**: the reachable file set is bounded by the root,
  with no escape, no network, no glob nondeterminism.
- Gives agents a **shared, consistent starting set** of shapes and themes — directly serving
  the consistency goal instead of leaving every agent to re-author common parts.
- The cycle ban keeps the module graph a DAG, so resolution and the `context` brief
  ([§16](../language-spec.md#16-cli-surface)) stay analyzable.
- The `std/` namespace is **reserved** — user modules cannot shadow it, so `std/shapes`
  always means the bundled module.
- Refines [ADR-0019](0019-source-first-module-references.md). Touches spec §2 (resolution,
  cycles, `std/`), §16 (CLI root), §17 (grammar: `std/` prefix).
