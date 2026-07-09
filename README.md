# Drawstic

[![CI](https://github.com/TorbenKoehn/drawstic/actions/workflows/ci.yml/badge.svg)](https://github.com/TorbenKoehn/drawstic/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/drawstic.svg)](https://www.npmjs.com/package/drawstic)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Drawstic** (a play on *drastic* and *draw deterministic*) is a deterministic drawing
engine. You describe an image in a compact, LLM-optimized **Recipe** DSL and Drawstic
renders it — pixel-for-pixel identically on every machine — to **PNG**, **SVG** or **JPEG**.

- **Deterministic** — bundled math and a pinned colour pipeline, no floating-point drift across platforms.
- **Token-efficient DSL** — Recipes are designed for LLM agents to write and edit cheaply.
- **Zero runtime dependencies** — ships as ESM, runs on Node ≥ 20, Bun and Deno.
- **CLI first** — agents call it on the command line; a typed library surface is available too.

## Agent skill

Drawstic's primary use case is LLM agents authoring and verifying Recipe files. Install the
bundled product skill into your agent first:

```sh
npx skills add torbenkoehn/drawstic
```

For non-interactive setups that should install only the Drawstic product skill:

```sh
npx skills add torbenkoehn/drawstic --skill drawstic -y
```

Alternatively, tell your agent the following:

```
Install the Drawstic skill from GitHub: torbenkoehn/drawstic
```

## Quickstart (CLI)

No install required — run it straight from the registry with your package manager's runner:

```sh
bunx drawstic render icon.drw#icon --out icon.png
# npm:  npx drawstic render icon.drw#icon --out icon.png
# pnpm: pnpm dlx drawstic render icon.drw#icon --out icon.png
# yarn: yarn dlx drawstic render icon.drw#icon --out icon.png
```

A Recipe (`icon.drw`):

```drw
draw circleIcon 16x16:
  pal:
    k = #1a1a1a
    r = #c04040
  bg #fff
  circle k 8:8 7
  circle r 8:8 5 fill
```

Render that drawing to PNG:

```sh
drawstic render icon.drw#circleIcon --out circle.png
```

## CLI commands

```
drawstic check   <file> [--json]                     # parse + deep-validate a recipe
drawstic fmt     <file> [--check] [--json]            # canonical formatter
drawstic context <file> [--json]                      # agent-facing structural brief
drawstic build   <file> [--out <dir>] [--json]        # run every `export` (PNG/SVG/JPEG + sidecars)
drawstic render  <file>#<drawing> [--out <path>] [--stdout]
                 [--png@N] [--ascii] [--preview] [--silhouette]
                 [--grid N] [--diff <png>] [--mode pixel|smooth] [--json]
drawstic sheet   <file> [--all] [--cols N] [--png@N]  # labeled contact sheet for drawing families
                 [--out <path>] [--stdout] [--ascii] [--preview] [--json]
```

Every command accepts `--json` for stable diagnostic records; exit code is non-zero
iff an error diagnostic was produced.

## Library usage

Drawstic exposes one subpath per public module (no barrel). Import exactly what you need.
Each subpath ships compiled ESM and `.d.ts` files from `dist/`.

```ts
import { Engine } from 'drawstic/engine'       // also the default: 'drawstic'
import { encodePngRgba } from 'drawstic/png'
import { writeFileSync } from 'node:fs'

const recipe = `draw icon 16x16:
  bg #fff
  circle #c04040 8:8 6 fill
`

const engine = new Engine(process.cwd())
const mod = engine.loadSource(recipe, '<memory>', 'icon.drw')
const entry = mod.definitions.get('icon')
if (entry?.kind !== 'draw') throw new Error('no drawing named icon')

const sprite = engine.renderDraw(entry, [], entry.definition.span)
writeFileSync('icon.png', encodePngRgba(sprite.data, sprite.w, sprite.h))
```

### Public subpaths

| Import | Module | Highlights |
|--------|--------|------------|
| `drawstic` / `drawstic/engine` | evaluator | `Engine`, `defaultBudget`, `LANGUAGE_VERSION` |
| `drawstic/parser` | parser | `parse` |
| `drawstic/lexer` | lexer | `lex` |
| `drawstic/ast` | AST | `Module`, `Statement`, `Expression`, node types |
| `drawstic/color` | colour pipeline | `Color`, `mix`, `oklch`, `parseHexColor`, … |
| `drawstic/diagnostics` | diagnostics | `Diagnostic`, `DrawsticError`, `formatDiagnostic` |
| `drawstic/values` | runtime values | `Sprite`, `Region`, `Path`, transforms |
| `drawstic/framebuffer` | framebuffer | `Framebuffer` |
| `drawstic/png` | PNG codec | `encodePngRgba`, `encodePngIndexed`, `decodePng` |
| `drawstic/jpeg` | JPEG encoder | `encodeJpeg` |
| `drawstic/svg` | SVG writer | `encodeSvg`, `encodePathSvg` |
| `drawstic/preview` | ASCII/ANSI preview | `spriteToAscii`, `spriteToAnsi` |
| `drawstic/fmt` | formatter | `format`, `formatDiff` |
| `drawstic/build` | export runner | `buildModule`, `runExport` |
| `drawstic/cli` | CLI | `main(argv)` |

## Documentation

The npm package includes the compact [agent skill](skills/drawstic/) because it is part of
the product surface for LLM agents. Full docs, examples and ADRs live in the repository
and are intentionally excluded from the published package.

## Development

Drawstic is built with [Bun](https://bun.com) (≥ 1.3). See [CONTRIBUTING.md](CONTRIBUTING.md).

```sh
bun install
bun test          # run the test suite
bun run lint      # Biome check
bun run typecheck # tsc --noEmit
bun run build     # emit dist/ (ESM + .d.ts)
```

## License

[MIT](LICENSE) (c) Torben Koehn
