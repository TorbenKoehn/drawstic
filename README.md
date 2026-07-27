# Drawstic

[![CI](https://github.com/TorbenKoehn/drawstic/actions/workflows/ci.yml/badge.svg)](https://github.com/TorbenKoehn/drawstic/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/drawstic.svg)](https://www.npmjs.com/package/drawstic)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Drawstic draws pictures from text files. You write a short recipe (a `.drw` file) that says
what to draw, and the Drawstic CLI turns it into a PNG, SVG or JPEG. The same recipe produces
the same pixels on every machine, every time.

The name is a play on *drastic* and *draw deterministic*.

<table>
<tr>
<th align="center">Characters</th>
<th align="center">Icons</th>
<th align="center">Scenes</th>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/hero-characters.png" width="260" alt="Knight character sheet, front/side/back views"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/hero-icons.png" width="260" alt="Productivity icon family contact sheet: mail, calendar, notes, calculator, clock, todo at 16, 32 and 64 px"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/hero-scenes.png" width="260" alt="Island scene at sunset"></td>
</tr>
<tr>
<td align="center"><code>knight.drw#knightSheet</code></td>
<td align="center"><code>drawstic sheet productivity.drw</code></td>
<td align="center"><code>island.drw#island</code></td>
</tr>
</table>

Each of those is one recipe file, rendered as it is committed:
[`examples/characters-ro2/knight.drw`](examples/characters-ro2/knight.drw),
[`examples/icons/productivity.drw`](examples/icons/productivity.drw),
[`examples/scenes-v3/island.drw`](examples/scenes-v3/island.drw).

## Why it exists

Coding agents are good at writing text and bad at drawing. Image models can make a picture,
but not the same picture twice, and you cannot ask them to nudge one pixel. Graphics editors
need a human with a mouse.

Drawstic moves graphics onto ground where an agent is already strong: a small text file it can
write, read back, diff and repair. And because the output follows entirely from the recipe, a
sprite belongs in git right next to the code that uses it. Change one colour, rerun the build,
review the diff like any other change.

## How it works

A recipe declares a theme (one light source, a palette), materials that say how a surface
responds to light (metal, cloth, skin, glass), and drawings built from regions: rectangles,
circles, polygons, organic shapes. Shading is derived from the light and the material, so you
never pick highlight and shadow colours by hand. Larger things are assembled from smaller
drawings that carry named attach points, so a figure is parts that snap together instead of
coordinates you compute yourself.

The CLI does the rest:

```sh
npx drawstic render icon.drw#circleIcon --out icon.png
```

Every command takes `--json`, reports problems with a code, a line and a column, and exits
non-zero when something is wrong. Nothing fails quietly.

## Install

Drawstic is built to be operated by a coding agent, so install it as an agent skill:

```sh
npx skills add torbenkoehn/drawstic
```

Non-interactive, only this skill:

```sh
npx skills add torbenkoehn/drawstic --skill drawstic -y
```

Or simply tell your agent:

```
Install the Drawstic skill from GitHub: torbenkoehn/drawstic
```

The skill is what the agent actually reads. `SKILL.md` is the entry point and routes to
`language.md` (the language surface, with every trap tied to the error code it produces),
`verify.md` (the verification loop as an algorithm, plus a code to fix table),
`walkthrough.md` (one complete run from request to finished artifact), craft guides for
icons, scenes, characters and items, `reference.md` as the full CLI and language reference,
and `starters/`, a set of runnable recipes to copy instead of retype.

The CLI needs no separate install. It runs straight from the registry with `npx drawstic`,
`bunx drawstic`, `pnpm dlx drawstic` or `yarn dlx drawstic`, on Node 20 or newer, or on Bun.

## Your first recipe

Put this in `icon.drw`:

```drw
draw circleIcon 16x16:
  palette:
    k = #1a1a1a
    r = #c04040
  bg #fff
  circle k 8:8 7
  circle r 8:8 5 fill
```

Then check it and render it:

```sh
drawstic check icon.drw --json      # [] means clean
drawstic render icon.drw#circleIcon --out circle.png
```

<img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/quickstart-circle.png" width="90" alt="A red circle icon with a black outline on white">

## What recipes look like

Everything below comes from the example corpus in this repository, and a test keeps it that
way: each complete recipe shown is `check`-clean, each excerpt is proved line by line against
the file it came from, and every image was rendered from exactly the recipe beside it.

### Shading comes from the light, not from you

There is one named `light`. Materials pick the physics (`metal`, `cloth`, `skin`, and so on)
and never the colour. `model` and `cel` then lower a material onto a shape, smooth or in crisp
bands, always consistent with that one light.

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
`figure:` block and the draw's two trailing `pin` lines are left out here, because the sword
renders without them.

### A figure is parts that snap together

Each body part is its own `draw` with named `pin` attach points. A `skeleton` declares the rig
once, a `pose` sets each joint's angle and paint depth for one view, and `fit` places every
part with a contact guarantee. No offset is computed by hand, and `aim` and `behind` state
what a part points at and what covers it instead of hiding that in coordinates.

<img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/figure-archer.png" width="130" alt="An archer figure assembled from separate head, torso and leg parts">

<!-- excerpt-of: examples/characters-ro2/archer.drw -->
```drw
skeleton archerRig:
  headJ at fig.chin
  chestJ at fig.neck
  shLJ at fig.shoulderL
  shRJ at fig.shoulderR
  hipLJ at fig.hipL
  hipRJ at fig.hipR

pose front over archerRig:
  view front
  hipLJ 0 z 0
  hipRJ 0 z 0
  chestJ 0 z 2
  shRJ 0 z 1
  shLJ 0 z 3
  headJ 0 z 4

draw figFront 64x128:
  use archer
  pose front
  fit torsoFront.neck bone chestJ
  fit leg.hip bone hipLJ ground
  fit leg.hip bone hipRJ
  fit armBow.shoulder bone shLJ
  fit armRelax.shoulder bone shRJ
  fit headFront.chin bone headJ
  fit bow.grip armBow.grip aim tip 8:14
  fit quiver.attach torsoFront.quiverAttach behind torsoFront
  outline
```

Every line above is verbatim from the committed recipe, and a test enforces that. The parts it
assembles are ordinary `draw`s with `pin`s:

<details>
<summary><strong>Full recipe</strong>: theme, figure oracle, parts, rig, pose, assembly</summary>

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

</details>

Rendered with `drawstic render archer.drw#figFront --png@4`. Every line of the full recipe is
unchanged from [`examples/characters-ro2/archer.drw`](examples/characters-ro2/archer.drw); only
the arm, bow and quiver parts are left out, which is why its assembly is three `fit`s shorter
than the excerpt above. The committed file renders all three views.

### One export block, several files

One theme, one material, two sizes of the same icon. A single `export` block names every
drawing it covers, `dir` gives them a shared output directory, and each format line applies to
all of them. The family stays consistent because the shading path is shared rather than
redrawn per size.

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

export dice, dice16:
  dir games
  png @1 @2
  svg ids classes
```

Rendered with `drawstic render games.drw#dice --png@4`. `drawstic build games.drw` writes
`games/dice.png`, `games/dice@2x.png`, `games/dice.svg` and the same trio for `dice16`.
Trimmed from [`examples/icons/games.drw`](examples/icons/games.drw): same theme, same
`dice` and `dice16` draws, unrelated icons in that file omitted.

## Does the model matter?

Same brief, same skill, three model tiers, four categories. Each cell was drawn by an agent
that could read only the shipped skill, with no sight of this repository's examples and no
sight of any other model's work. The briefs and the twelve recipes are committed under
[`evals/model-comparison/`](evals/model-comparison/), and a recipe there is frozen once
rendered, so nothing was quietly cleaned up afterwards.

<table>
<tr>
<th></th>
<th align="center">Haiku 4.5</th>
<th align="center">Sonnet 5</th>
<th align="center">Opus 5</th>
</tr>
<tr>
<td><strong>Icon</strong><br><sub>32x32</sub></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/icon-haiku.png" width="96" alt="Compass rose icon drawn by Haiku 4.5"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/icon-sonnet.png" width="96" alt="Compass rose icon drawn by Sonnet 5"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/icon-opus.png" width="96" alt="Compass rose icon drawn by Opus 5"></td>
</tr>
<tr>
<td><strong>Item</strong><br><sub>48x48</sub></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/item-haiku.png" width="96" alt="Healing potion drawn by Haiku 4.5"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/item-sonnet.png" width="96" alt="Healing potion drawn by Sonnet 5"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/item-opus.png" width="96" alt="Healing potion drawn by Opus 5"></td>
</tr>
<tr>
<td><strong>Character</strong><br><sub>64x128</sub></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/character-haiku.png" width="72" alt="Chibi blacksmith drawn by Haiku 4.5"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/character-sonnet.png" width="72" alt="Chibi blacksmith drawn by Sonnet 5"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/character-opus.png" width="72" alt="Chibi blacksmith drawn by Opus 5"></td>
</tr>
<tr>
<td><strong>Scene</strong><br><sub>192x108</sub></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/scene-haiku.png" width="190" alt="Lighthouse scene drawn by Haiku 4.5"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/scene-sonnet.png" width="190" alt="Lighthouse scene drawn by Sonnet 5"></td>
<td align="center"><img src="https://raw.githubusercontent.com/TorbenKoehn/drawstic/main/docs/images/model-eval/scene-opus.png" width="190" alt="Lighthouse scene drawn by Opus 5"></td>
</tr>
</table>

What it cost each of them to get there:

| | Icon | Item | Character | Scene |
|---|---|---|---|---|
| **Haiku 4.5** | first `check` failed, 2 rounds | 1 round | clean, 0 rounds | first `check` failed, 1 round |
| **Sonnet 5** | clean, 0 rounds | clean, 0 rounds | 0 forced, 2 after looking | clean, 0 rounds |
| **Opus 5** | 0 forced, 6 after looking | 0 forced, 2 after looking | 9 rounds | 7 rounds, 1 of them forced |

All twelve end in the same place: `check` clean, and `critique --as <category> --strict`
exiting 0. The gate does not separate them at all. What separates them is what they got stuck
on. Haiku's failures were language failures, a Unicode minus sign in a light direction and
names colliding between a theme and a drawing. Sonnet and Opus wrote valid recipes immediately
and then spent their rounds on the picture: a moustache that merged into a black blob, a hammer
that read as an axe and buried the arm, a cliff that came out looking like brickwork. Opus used
the most rounds because it was the only tier that kept working against its own render instead
of against the gate.

That is also the honest limit of the tooling. `check` verifies grammar, `critique` verifies
structure, and neither one can tell you the hammer looks like an axe. Somebody still has to
look at the picture.

Round counts are self-reported by the drawing agent, and one cell contradicted itself, so treat
them as indicative. The `check` and `critique` verdicts are not self-reported: they were re-run
centrally over all twelve recipes afterwards.

## Checking your work

An agent cannot see its own output, so Drawstic checks everything a program can check and is
explicit about the rest. Run these in order, fix what they report, repeat:

```sh
drawstic check file.drw --json                         # [] is clean, else {code,message,line,col,hint}
drawstic render file.drw#name --ascii                  # shape sanity, no colour
drawstic render file.drw#name --png@4 --out check.png  # look at it before claiming it works
drawstic critique file.drw --as icon --strict --json   # pixel-based quality checks
drawstic build file.drw --json                         # writes every export artifact
```

`check` verifies grammar and validation. `critique --strict` verifies structure and exits
non-zero while the must-fix subset is dirty, which makes it a usable CI gate. Neither of them
verifies craft, which is why `critique` also prints a rubric of ordered renders (silhouette,
ascii, png@4, contact sheet) with questions you answer by looking at the image. Codes outside
the must-fix subset stay advisory on purpose, because each has a real exception. They are meant
to be read and then either fixed or justified, not driven to zero.

## CLI commands

Every command accepts `--json` (stable diagnostic records, non-zero exit if an error fired),
`--budget N` (evaluation-step budget) and `--mode pixel|smooth` (override the recipe's render
mode), so those are left out of the table. An unrecognized flag is a positioned `E026` error
rather than something silently ignored.

| Command | Flags | Does |
|---|---|---|
| `check <file>` | `--lint` `--rows` | Parse and deep-validate: renders every drawing, validates every export. `--lint` adds authoring warnings, `--rows` reports per-drawing pixel-row widths. |
| `fmt <file>` | `--check` `--stdout` `--diff` | Canonical formatter, idempotent. `--check` exits non-zero on unformatted input without writing, `--stdout` prints without writing, bare rewrites in place. |
| `context <file>` | | Resolved design brief: palette, style guide, theme light and figure, importable drawings with ASCII previews, functions, export plans. |
| `build <file>` | `--out <dir>` | Runs every `export`, writing artifacts next to the recipe by default. `--out` relocates the whole tree. |
| `render <file>#<drawing>[(args)]` | `--png@N` `--out <path>` `--stdout` `--ascii` `--preview` `--silhouette` `--inspect` `--explain` `--fit WxH` `--crop x:y WxH` `--grid N` `--diff <png>` | Ad-hoc render of one drawing. Output kind precedence is `--ascii`, `--preview`, `--inspect`, `--explain`, then PNG. `--silhouette` flattens ink to opaque black. `--explain` prints every `model` and `cel` as lowered primitives and every `fit` placement instead of an image. `--grid` and `--diff` are PNG-only debug aids and never part of `build`. |
| `sheet <file>` | `--all` `--cols N` `--png@N` `--out <path>` `--stdout` `--ascii` `--preview` | One labeled, size-normalized contact sheet of the selected drawings (exported ones by default, every non-parametric drawing with `--all`). Useful for reviewing a family at once. |
| `critique <file>` | `--as icon\|scene\|character\|item` `--family a,b,c` `--strict` `--all` | Pixel-based quality checks that need no vision, plus family checks across siblings. `--as` enables category thresholds, `--strict` promotes the must-fix subset to `error` and exits 1. |
| `help` / `--help` / `-h` | | This text. |
| `version` / `--version` / `-v` | | The installed package version. |

## What determinism buys you

In `mode pixel`, the same recipe renders the same framebuffer on every operating system,
engine and CPU. That holds because the engine works for it:

- fixed-point math bundled with the library, never the host's `Math.*`
- a pinned colour pipeline (oklch to sRGB with gamut mapping) and integer source-over compositing
- pinned rasterization rules, such as inclusive line endpoints and even-diameter circles
- no wall clock, no locale, no unseeded randomness
- a step and pixel-write budget, so no recipe can hang

The guarantee is about pixels, not bytes: PNG and JPEG output depends on the encoder, so the
golden tests compare decoded pixels. What you get in practice is that a rebuild produces an
empty diff unless you actually changed the recipe.

## Documentation

- [Language spec](docs/language-spec.md): the full Recipe DSL grammar and semantics.
- [Best practices](docs/best-practices.md): idiomatic authoring, from colour to composition.
- [Motif cookbook](docs/motif-cookbook.md): tested snippets for recurring scene motifs.
- [Architectural decisions](docs/decisions/): the ADRs behind the language and the pipeline.
- [Example corpus](examples/): characters, icons, items, scenes, showcase and text, the source
  of every image in this README.

Those paths exist in this repository. The published npm package ships `dist/`, `skills/`,
`README.md` and `LICENSE` only, so do not rely on `docs/`, `examples/` or `src/` after an
install.

## Development

Drawstic is built with [Bun](https://bun.com) (1.3 or newer). See
[CONTRIBUTING.md](CONTRIBUTING.md).

```sh
bun install
bun test          # run the test suite
bun run lint      # Biome check
bun run typecheck # tsc --noEmit
bun run build     # emit dist/ (ESM + .d.ts)
```

## License

[MIT](LICENSE) (c) Torben Koehn
