# Drawstic

[![CI](https://github.com/TorbenKoehn/drawstic/actions/workflows/ci.yml/badge.svg)](https://github.com/TorbenKoehn/drawstic/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/drawstic.svg)](https://www.npmjs.com/package/drawstic)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Deterministic graphics from text recipes: the same recipe renders a pixel-identical
PNG/SVG/JPEG on every machine.** You write a compact **Recipe** (`.drw`) — theme, light,
materials, shapes — and the Drawstic CLI renders it. No canvas, no editor, no drift.

- **Deterministic** — bundled fixed-point math + a pinned colour pipeline: pixel-identical output on every OS/CPU in `mode pixel`.
- **Token-efficient DSL** — Recipes are designed for LLM agents to write, read and verify cheaply.
- **Zero runtime dependencies** — plain ESM, no `dependencies` in `package.json`; Node ≥ 20 or Bun.
- **CLI-first** — every command is scriptable: `--json` diagnostics, non-zero exit on error, everywhere.

<table>
<tr>
<th align="center">Characters</th>
<th align="center">Icons</th>
<th align="center">Scenes</th>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/hero-characters.png" width="260" alt="Knight character sheet, front/side/back views"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/hero-icons.png" width="260" alt="Games icon family contact sheet"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/hero-scenes.png" width="260" alt="Island scene at sunset"></td>
</tr>
<tr>
<td align="center"><code>knight.drw#knightSheet</code></td>
<td align="center"><code>drawstic sheet games.drw</code></td>
<td align="center"><code>island.drw#island</code></td>
</tr>
</table>

Sources: [`examples/characters-ro2/knight.drw`](examples/characters-ro2/knight.drw) ·
[`examples/icons/games.drw`](examples/icons/games.drw) ·
[`examples/scenes-v3/island.drw`](examples/scenes-v3/island.drw) — one recipe file each,
rendered as-is.

## What it looks like

Three real excerpts from the example corpus below. Each recipe is `check`-clean and the
image next to it is rendered from exactly that recipe — nothing invented, nothing
abbreviated past parsing.

### A — light, material, model: shading is declarative

One named `light`, materials that pick the *physics* (`metal`/`cloth`/…, never the colour),
and `model`/`cel` lower them onto a shape — smooth shading or crisp bands, always
coherent with the one light.

<img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/shading-sword.png" width="90" alt="A shaded sword: cel-banded steel blade, metal guard, modelled leather grip">

```drw
steel   = #8494ac
steelHi = #d7e0ee
gold    = #d9a03a
leather = #6d4527

material steelM   = steel metal
material goldM    = gold metal
material leatherM = leather cloth

theme ro:
  mode pixel
  light sun = dir 1:1 #ffe6b0 amb #2a3a5e 16%

draw sword 14x66:
  use ro
  blade = poly(7:2, 9:8, 9:46, 5:46, 5:8)
  cel blade steelM 3
  fill steelHi rect(6:9, 6:45)
  guard = rect(1:46, 13:49)
  cel guard goldM 3
  grip = rect(6:49, 8:59)
  model grip leatherM
  circle gold 7:61 2 fill
```

Rendered with `drawstic render sword.drw#sword --png@4`. The `sword` draw is unchanged from
[`examples/characters-ro2/knight.drw`](examples/characters-ro2/knight.drw); the `ro` theme's
`figure:` block and the draw's two trailing `pin` lines are omitted here — the sword needs
neither to render.

### B — pin/fit + skeleton/pose: a figure is modular parts, assembled

Each body part is its own `draw` with named `pin` attach points. A `skeleton` declares the
rig once; a `pose` sets each joint's angle and paint depth for one view. `fit` then places
every part with a **contact guarantee** — no hand-computed offsets.

<img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/figure-archer.png" width="130" alt="An archer figure assembled from separate head, torso and leg parts">

```drw
theme archer:
  light sun = dir 1:1 #ffe6b0 amb #2a3a5e 16%
  figure:
    heads 3.5
    headW 30
    eyeLine 0.62
    earLine 0.58
    eyeSep 13
    hipW 20

theme archerHead:
  with archer
  figure:
    heads 1
    headW 26
    eyeLine 0.66
    earLine 0.62
    eyeSep 13

skinC = #e8b489
hairC = #3a2a18
hairLiteC = #5c4326
irisC = #4f7bb0
pupilC = #201810
whiteC = #fbf6ee
mouthC = #7a4030
capC = #3f6b3a
featherC = #f2ead8
featherTipC = #b5453c
clothC = #3f7a3e
clothDarkC = #2a5028
leatherC = #925c2c
leatherDarkC = #402616
buckleC = #b6c3d6

material skinM = skinC skin
material capM = capC cloth spread 160%
material clothM = clothC cloth spread 160%
material leatherM = leatherC cloth spread 160%
material steelM = buckleC metal

draw headFront 30x38:
  use archerHead
  skull = ellipse(15:19, 13:15).union(lobe(fig.earL, 1:23, 5)).union(lobe(fig.earR, 29:23, 5))
  model skull skinM
  bangs = crescent(15:15, 13:13, 6, 0:1)
  fill hairC bangs.intersect(rect(0:0, 29:18))
  fill hairLiteC bangs.intersect(rect(0:0, 29:11))
  fill whiteC ellipse(fig.eyeL, 3:3)
  fill whiteC ellipse(fig.eyeR, 3:3)
  circle irisC fig.eyeL 2 fill
  circle irisC fig.eyeR 2 fill
  px pupilC fig.eyeL
  px pupilC fig.eyeR
  px whiteC.alpha(90%) (fig.eyeL - 1:1)
  px whiteC.alpha(90%) (fig.eyeR - 1:1)
  px skinC.darken(18%) 15:24
  line mouthC 12:27 17:27
  capCrown = dome(15:14, 14:11)
  model capCrown capM
  brim = crescent(15:16, 14:11, 4, 0:1)
  model brim leatherM
  stroke leatherDarkC brim
  plume = lobe(21:11, 27:1, 3)
  fill featherC plume
  fill featherTipC lobe(24:5, 27:1, 3)
  pin chin 15:31

draw torsoFront 48x32:
  use archer
  body = rrect(3:2, 45:31, 7)
  model body clothM
  vest = body.subtract(rrect(11:2, 37:20, 5))
  model vest leatherM
  belt = rect(3:23, 45:27)
  model belt leatherM
  buckle = rect(21:23, 27:27)
  model buckle steelM
  strap = poly(8:2, 13:2, 39:29, 34:29)
  fill leatherDarkC strap
  fill clothDarkC rect(18:2, 30:5)
  pin neck 24:2
  pin quiverAttach 42:6

draw leg 16x60:
  use archer
  pantsTop = rrect(2:1, 14:38, 4)
  model pantsTop clothM
  boot = rrect(1:34, 15:58, 3)
  model boot leatherM
  fill leatherDarkC rect(1:32, 15:36)
  fill leatherDarkC rect(1:56, 15:59)
  pin hip 8:1

skeleton archerRig:
  headJ at fig.chin
  chestJ at fig.neck
  hipLJ at fig.hipL
  hipRJ at fig.hipR

pose front over archerRig:
  view front
  hipLJ 0 z 0
  hipRJ 0 z 0
  chestJ 0 z 2
  headJ 0 z 4

draw figFront 64x128:
  use archer
  pose front
  fit torsoFront.neck bone chestJ
  fit leg.hip bone hipLJ ground
  fit leg.hip bone hipRJ
  fit headFront.chin bone headJ
  outline

export figFront archer-front:
  png @1 @4
```

Rendered with `drawstic render archer.drw#figFront --png@4`. Adapted from
[`examples/characters-ro2/archer.drw`](examples/characters-ro2/archer.drw) — every line
above is unchanged from that file; only the arm/bow/quiver parts and their `fit`s are
omitted here for length. The full character (with arms and bow, three views) renders from
the file as committed.

### C — an icon family with `export`: repeatable, multi-artifact

One theme, one material, two sizes of the same icon. `export` writes PNG at every `@N`
scale plus SVG in one pass — the family stays consistent because the shading path is
shared, not redrawn per size.

<img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/icon-family-dice.png" width="110" alt="A blue die icon with orange pips, shaded via model">

```drw
ink = #22273a
bodyBlue = #4d63d1
accent = #ffb347

theme gamesTheme:
  palette k=ink b=bodyBlue a=accent
  mode pixel
  light sun = dir 1:1 #fff2d0 amb #2a3a5e 22%

use gamesTheme

material bodyM = bodyBlue flat

draw dice 32x32:
  mask body = rrect(4:4,27:27,5)
  model body bodyM
  stroke k body w2
  circle a 9:9 2 fill
  circle a 22:9 2 fill
  circle a 16:16 2 fill
  circle a 9:22 2 fill
  circle a 22:22 2 fill

draw dice16 16x16:
  mask body = rrect(1:1,14:14,2)
  model body bodyM
  stroke k body w1
  circle a 4:4 1 fill
  circle a 11:4 1 fill
  circle a 7:7 1 fill
  circle a 4:11 1 fill
  circle a 11:11 1 fill

export dice games/dice:
  png @1 @2
  svg ids classes

export dice16 games/dice16:
  png @1 @2
  svg ids classes
```

Rendered with `drawstic render games.drw#dice --png@4`; `drawstic build games.drw` writes
`games/dice.png`, `games/dice@2x.png`, `games/dice.svg` and the same trio for `dice16`.
Trimmed from [`examples/icons/games.drw`](examples/icons/games.drw) (same theme, same
`dice`/`dice16` draws, unrelated icons in that file omitted here).

## Install & quickstart

```sh
npm i -D drawstic
# bun add -D drawstic · pnpm add -D drawstic · yarn add -D drawstic
bunx drawstic help
```

A recipe (`icon.drw`, copied from
[`examples/basic-shapes/circles.drw`](examples/basic-shapes/circles.drw)):

```drw
draw circleIcon 16x16:
  palette:
    k = #1a1a1a
    r = #c04040
  bg #fff
  circle k 8:8 7
  circle r 8:8 5 fill
```

```sh
drawstic check icon.drw --json                        # [] = clean
drawstic render icon.drw#circleIcon --out circle.png   # → circle.png
```

<img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/quickstart-circle.png" width="90" alt="A red circle icon with a black outline on white">

<!-- for LLM agents -->

## For LLM agents

Drawstic is built to be operated by an agent from the command line — every command
accepts `--json` and reports positioned diagnostics, never a silent failure.

**Canonical path** (full detail in the shipped skill, pointer below):

1. **Theme** — one `light` (the only shading source of truth) + a `figure:` oracle for characters; `use` it everywhere.
2. **Materials** — `material NAME = COLOR RESPONSE` — response is the physics (`metal`/`skin`/`cloth`/`glass`/`glow`/`flat`), never the colour.
3. **Parts** — each mass is a `Region` (a primitive or an organic constructor: `dome`/`lobe`/`crescent`/`ribbon`); a modular part declares `pin`s.
4. **Assembly** — `fit` for contact-guaranteed placement (`behind`/`front`, `aim`, `ground`); for multi-view figures, one `skeleton` + one `pose` per view.
5. **Shade** — `model REGION MAT` (smooth default) or `cel REGION MAT N` (N crisp bands).
6. **`outline`** — one bare pass, last statement, closes the silhouette.
7. **`critique --as <cat> --strict`** until `pass:true`, then answer the rubric it prints by looking.
8. **`build`** — writes every `export` artifact next to the recipe.

**Verification loop** — run in this order, fix, repeat:

```sh
drawstic check file.drw --json                          # [] = clean, else fix {code,message,line,col,hint}
drawstic render file.drw#name --ascii                    # shape sanity, no colour
drawstic render file.drw#name --png@4 --out check.png    # look at it — never claim success unrendered
drawstic critique file.drw --as icon|scene|character|item --strict --json   # pixel-based craft gate
drawstic build file.drw --json                           # writes every export artifact
```

`critique --as <cat>` `pass:true` is necessary, not sufficient — it also prints a `rubric`
of ordered renders (silhouette → ascii → png@4 → sheet) with prompts you answer by
looking; `check` verifies grammar, `critique --strict` verifies structure, neither
verifies craft on its own.

**Full skill** (ships in the npm package): `node_modules/drawstic/skills/drawstic/SKILL.md`
— the canonical path and core syntax in full, plus `reference.md` (language floor/escape
hatch) and `character-craft.md`/`icon-craft.md`/`item-craft.md`/`scene-craft.md` (per-category
workflows) alongside it.

## CLI commands

Every command accepts `--json` (stable diagnostic records; exit code is non-zero iff an
error diagnostic fired), `--budget N` (evaluation-step budget) and `--mode pixel|smooth`
(override the recipe's render mode) — omitted from the table below. An unrecognized flag
is a positioned `E026` error, never silently ignored.

| Command | Flags | Does |
|---|---|---|
| `check <file>` | `--lint` `--rows` | Parse + deep-validate (renders every drawing, validates every export). `--lint` adds authoring warnings; `--rows` reports per-drawing pixel-row widths. |
| `fmt <file>` | `--check` `--stdout` `--diff` | Canonical formatter, idempotent. `--check` exits non-zero on unformatted input (no write); `--stdout` prints without writing; bare rewrites in place. |
| `context <file>` | — | Resolved design brief: palette, style guide, theme light/figure, importable drawings + ASCII previews, functions, export plans. |
| `build <file>` | `--out <dir>` | Runs every `export`, writing artifacts next to the recipe by default (`--out` relocates the whole tree). |
| `render <file>#<drawing>[(args)]` | `--png@N` `--out <path>` `--stdout` `--ascii` `--preview` `--silhouette` `--inspect` `--explain` `--fit WxH` `--crop x:y WxH` `--grid N` `--diff <png>` | Ad-hoc render of one drawing. Output kind precedence `--ascii` > `--preview` > `--inspect` > `--explain` > PNG. `--silhouette` flattens ink to opaque black. `--explain` prints every `model`/`cel`'s lowered primitives and every `fit`'s placement instead of an image. `--grid`/`--diff` are PNG-only debug aids, never part of `build`. |
| `sheet <file>` | `--all` `--cols N` `--png@N` `--out <path>` `--stdout` `--ascii` `--preview` | One labeled, size-normalized contact sheet of the selected drawings (exported ones by default, or every non-parametric drawing with `--all`) — family QA. |
| `critique <file>` | `--as icon\|scene\|character\|item` `--family a,b,c` `--strict` `--all` | Pixel-based, vision-free quality checks plus family checks across siblings. `--as` enables category thresholds; `--strict` promotes the must-fix subset to `error` (exit 1), the CI gate. |
| `help` / `--help` / `-h` | — | This text. |
| `version` / `--version` / `-v` | — | The installed package version. |

## Library usage

Drawstic exposes one subpath per public module (no barrel) — compiled ESM + `.d.ts` under
`dist/`. Import exactly what you need:

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

| Import | Module | Highlights |
|--------|--------|------------|
| `drawstic` / `drawstic/engine` | evaluator | `Engine`, `defaultBudget` |
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

`docs/`, `examples/` and `src/` are repository-only — the published package ships `dist/`,
`skills/`, `README.md` and `LICENSE` only, so don't rely on those paths existing after
`npm install`.

## Why deterministic

Drawstic guarantees **pixel** determinism in `mode pixel` (not byte-identical PNG/JPEG —
compression varies by encoder; golden tests compare pixels): the same recipe renders the
same framebuffer on every OS, engine and CPU. This is engineered, not assumed —
bundled fixed-point transcendental math (never host `Math.*`), a pinned oklch↔sRGB +
gamut-mapping colour pipeline, integer source-over compositing, pinned rasterization
(inclusive line endpoints, even-diameter circles), no wall-clock/locale input, and
pure-seeded randomness only. A step + pixel-write budget keeps every render total — no
recipe can hang.

- [Language spec](docs/language-spec.md) — the full Recipe DSL grammar and semantics.
- [Architectural decisions](docs/decisions/) — the ADRs behind the language and pipeline.
- [Example corpus](examples/) — characters, icons, items, scenes, showcase, text — the
  source of every image in this README.

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
