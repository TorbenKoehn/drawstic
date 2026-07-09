# 84. Minimal npm package contents

- Status: Accepted
- Date: 2026-07-09
- Deciders: t.koehn, Codex
- Refines: [ADR-0065](0065-npm-and-github-publishing.md)

## Context

ADR-0065 shipped both `dist/` and `src/` so Bun could resolve a `bun` export condition
to raw TypeScript sources. That kept Bun development convenient, but it duplicated the
runtime surface in the published npm tarball. The package also must not ship repository
documentation or examples; those are useful in the repo, but they are not runtime assets.

Drawstic still has one nonstandard package asset: `skills/drawstic/`. This is product
surface, not developer documentation. It is how LLM agents consume Drawstic effectively,
so it belongs in the npm package even though `docs/` and `examples/` do not.

## Decision

The npm package is compiled-only for code:

- include `dist/`, `skills/`, `README.md`, and `LICENSE`;
- exclude `src/`, `docs/`, `examples/`, tests, TODO files, repo tooling, and generated
  local artifacts;
- remove `bun` export conditions that point at `src/*.ts`;
- keep `types`, `import`, and `default` export entries pointing at `dist/`.

Bun consumers use the same compiled ESM entrypoints as Node, Deno, and bundlers.

## Consequences

- The package is smaller and no longer duplicates the codebase.
- `npm pack --dry-run --json` is the packaging verification command.
- `docs/` and `examples/` remain repository assets only.
- The README must not rely on local `docs/` or `examples/` paths being present in an
  installed npm package.
