# Contributing to Drawstic

Thanks for helping build Drawstic. This guide covers the local setup, the commit and
branching conventions, and how a release is cut.

## Development setup

Drawstic uses [Bun](https://bun.com) (≥ 1.3) as its runtime and package manager — not Node.

```sh
bun install          # install dev tooling (no runtime deps)
bun test             # run the test suite
bun run lint         # Biome check (lint + format + import order)
bun run format       # Biome auto-fix (format + safe fixes)
bun run typecheck    # tsc --noEmit (strict)
bun run build        # emit dist/ (ESM JS + .d.ts) for publishing
bun run drawstic ... # run the CLI from source
```

**Before opening a PR, run `bun run format` and `bun run test`** — and, if you touched
`src/`, `bun run typecheck` and `bun run build`. Do not claim a change works without
having observed the checks pass.

The bundled std/ recipes live as plain TS modules (`src/std/**/*.drw.ts`), each exporting
its recipe source as a template-string constant — no codegen, works on Bun, Node and Deno.
Edit the template content directly; keep the fonts on `String.raw` (they contain backslash
glyphs) and keep non-ASCII characters out of the `String.raw` templates (Bun's transpiler
escapes non-ASCII as `\uXXXX`, which corrupts raw-template values).

## Commit messages — Conventional Commits

All commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <description>
```

**Allowed types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`, `revert`.

**Suggested scopes:** `lexer`, `parser`, `engine`, `color`, `raster`, `values`,
`framebuffer`, `png`, `svg`, `jpeg`, `fmt`, `cli`, `build`, `preview`, `std`, `docs`,
`adr`, `bench`, `ci`, `deps`.

PR titles are validated against this spec in CI (`semantic-pr` workflow).

## Branching — gitflow

- **`main`** — release branch. Every release is a tag `vX.Y.Z` cut on `main`.
- **`develop`** — integration branch; features merge here first.
- **`feature/*`, `fix/*`** — topic branches, opened against `develop`.
- **`release/*`** — optional stabilization branch before tagging on `main`.

## Architecture Decision Records

Every material decision (language semantics, syntax, tooling, infrastructure) is
recorded as an ADR under [`docs/decisions/`](docs/decisions/), MADR-lite style. Use the
`new-adr` skill (or copy a recent ADR) and add a row to
[`docs/decisions/README.md`](docs/decisions/README.md). Reflect the decision in
[`AGENTS.md`](AGENTS.md) and the affected docs in the same change.

## Releasing (maintainers)

Releases are tag-driven and fully automated by `.github/workflows/release.yml`:

1. Merge `develop` → `main`.
2. Tag the release commit on `main`: `git tag v1.2.3 && git push origin v1.2.3`.
3. The `release` workflow runs the full checks, builds `dist/`, stamps the version from
   the tag into `package.json` (no commit), packs the npm tarball and smoke-tests it
   under Node — install into a scratch project, `npx drawstic help`, render a tiny inline
   recipe to PNG — publishes to npm with provenance
   (`npm publish --provenance --access public`, authenticated via `NODE_AUTH_TOKEN`), and
   creates a GitHub Release with generated notes.

The same packed-tarball smoke test also runs in `ci.yml` on every PR, so a broken
`files`/`exports`/`bin`/shebang fails before merge, not at release time.

`package.json` stays at version `0.0.0` in the repo; the tag is the single source of truth.

### Required repository secret

- **`NPM_TOKEN`** — an npm **Automation** access token with publish rights to the
  `drawstic` package. Add it under *Settings → Secrets and variables → Actions*.

Provenance (`--provenance`) requires the workflow's `id-token: write` permission (already
set) and a public repository; no extra secret is needed for it.
