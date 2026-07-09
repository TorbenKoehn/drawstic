# 65. NPM & GitHub publishing: no-barrel subpath exports, scriptless per-file dist build, tag-driven release

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0035](0035-import-sandbox-and-std-modules.md), [ADR-0054](0054-std-fonts-are-recipe-modules.md) (std embedding mechanism)
- Refined by: [ADR-0084](0084-minimal-npm-package-contents.md)

## Context

Drawstic was a `private` single-package repo with a Bun-only entry surface: `src/index.ts`
re-exported everything, `src/std.ts` pulled the bundled `.drw` modules via Bun's
`import ... with { type: 'text' }`, and `src/cli.ts` self-ran through `import.meta.main`.
None of that ships to Node or Deno, and there was no `dist/`, license, README, CI or
release automation. This ADR records the packaging strategy that makes Drawstic
publishable to npm and GitHub while keeping the zero-runtime-dependency rule
([AGENTS.md §3](../../AGENTS.md)), the Bun-native dev flow, and a **scriptless build**
(plain `tsc`, no codegen or post-processing) intact.

## Decision

**1 — No barrel; one subpath per public module.** `src/index.ts` is deleted. The public
API is a hand-authored `exports` map with semantic subpaths. Root `.` is a deliberate
alias of `./engine` (the primary artifact: `parse` → `Engine` → render); both resolve the
exact same file, so the path-keyed module cache yields one instance, not two. Public
subpaths:

`.`/`engine` (eval), `parser`, `lexer`, `ast`, `color`, `diagnostics` (diagnostic),
`values`, `framebuffer`, `png`, `jpeg`, `svg`, `preview`, `fmt`, `build`, `cli`, plus
`./package.json`.

**Internal (no subpath):** `raster` (rendering kernel), `dmath` (pinned numeric
implementation, not a stability contract), `fonts` (bitmap-font helper for raster/std),
`sidecars` (helper of `build`), `std` (engine-resolved bundle), `inspect` and `lint`
(surfaced through the CLI `context`/`check` commands). Keeping the surface minimal is safe
because adding a subpath later is non-breaking; removing one is not.

**2 — `bun` export condition: raw TS is the primary API under Bun.** Every subpath
resolves four conditions, in order `types` → `bun` → `import` → `default`:

```json
"./engine": {
  "types": "./dist/eval.d.ts",
  "bun": "./src/eval.ts",
  "import": "./dist/eval.js",
  "default": "./dist/eval.js"
}
```

Bun consumers execute the actual TypeScript sources (`src/` ships in the package,
`files: ["dist", "src", "skills", "README.md", "LICENSE"]`); Node/Deno and bundlers take
`dist/`. The `bin` stays `dist/bin.js` (`#!/usr/bin/env node`, always-runs wrapper — no
`import.meta.main`, absent before Node 24) so `npx`/`node` work; `src/cli.ts` keeps its
`import.meta.main` self-run for Bun dev.

**3 — nodenext-style `.js` specifiers; scriptless per-file `tsc` emit.** All relative
imports in `src/` and `tests/` use `.js` extensions (`./parser.js`). TypeScript resolves
them to the `.ts` sources in every mode, Bun executes raw TS with them natively, and
`tsc -p tsconfig.build.json` (`module`/`moduleResolution: NodeNext`) emits ESM JS **and**
`.d.ts` with correct specifiers as-is — zero rewriting. (The rejected alternative,
`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`, does not rewrite
declaration output — TS issue #61037 — and would force a post-processing script.)
`bun run build` is exactly `tsc -p tsconfig.build.json`. Each `src` module maps 1:1 to a
`dist` file, so **module identity is preserved by construction** across subpath imports;
output is deterministic and no bundler or runtime dep is involved.

**4 — std recipes are `.drw.ts` modules.** Each bundled recipe is a TS module and the
source of truth (`src/std/shapes.drw.ts`, `themes.drw.ts`, `fonts/micro.drw.ts`,
`fonts/small.drw.ts`) exporting its source as a template-string constant; `src/std.ts`
imports them with plain imports — portable to Node/Deno, no text imports, no ambient
declarations, no codegen. Pinned constraints (verified against the original `.drw` bytes,
LF-normalized — template literals normalize CRLF per ECMAScript):
- **Fonts use `String.raw`** — they define backslash glyphs that must survive verbatim.
  The backtick glyph is spliced in as a `${'`'}` interpolation. Raw templates must
  stay **ASCII-only**: Bun's transpiler escapes non-ASCII as `\uXXXX`, which corrupts
  *raw* (tagged) template values.
- **shapes/themes use cooked templates** — they contain non-ASCII comments (the `\uXXXX`
  escaping round-trips in cooked mode) and must stay free of backslashes and backticks.

**5 — Tag-driven release, gitflow.** `package.json` stays at `0.0.0`; the git tag `vX.Y.Z`
(cut on `main`) is the single version source. `release.yml` verifies, builds, stamps the
version from the tag (`npm version --no-git-tag-version`, no commit), publishes with
`npm publish --provenance --access public` (auth via `NPM_TOKEN`, `id-token: write`), and
creates a GitHub Release. `ci.yml` runs lint/typecheck/test/build plus a Node smoke test
of `dist`; `semantic-pr.yml` enforces Conventional Commit PR titles.

## Consequences

- Publishable to npm/GitHub: ESM + `.d.ts` for Node ≥ 20 and bundlers, raw TS for Bun;
  verified by `npm pack` + Node and Bun install/import/CLI smoke tests.
- `package.json` gains `exports` (types/bun/import/default), `files`, `engines`
  (`node >=20`), `sideEffects: false`, metadata, and `build`/`typecheck`/`prepublishOnly`
  scripts; `private` is removed.
- Repo-wide convention change: relative imports are `./x.js`, never `./x.ts`;
  `allowImportingTsExtensions` is dropped ([AGENTS.md §3](../../AGENTS.md) updated).
- New files: `tsconfig.build.json`, `src/bin.ts`, `src/std/*.drw.ts`, `LICENSE`,
  `README.md`, `CONTRIBUTING.md`, `.github/` (workflows, dependabot, PR template).
  Removed: `src/index.ts`, `src/globals.d.ts`, `src/std/**/*.drw` (superseded by the
  `.drw.ts` modules).
- Docs to change: [AGENTS.md §2/§3](../../AGENTS.md) (done); `README.md` and
  `CONTRIBUTING.md` are the npm/GitHub front matter.
- Repository URLs point at `TorbenKoehn/drawstic`; the maintainer adds the `NPM_TOKEN`
  secret before the first release.
