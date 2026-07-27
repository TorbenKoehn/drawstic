---
name: drawstic
description: Draws deterministic pixel art and vector graphics from a text recipe — sprites, spritesheets, chibi and RO-style game characters, tilesets and atlases, icon families, favicons, app icons, game items, textures and full scenes, exported to PNG, SVG or JPEG. Use when the user asks to draw, generate, design or edit any of those, when a .drw recipe file is involved, or when graphics must be reproducible and version-controlled instead of prompted. Covers authoring .drw recipes and running the drawstic CLI (check, fmt, context, render, sheet, critique, build). Not for editing or filtering an existing photo, and not for art direction without a runnable recipe.
---

# Drawstic

You author a text **recipe** (`.drw`); the engine renders it. Same recipe, pixel-identical output
everywhere. You can read a recipe and predict the pixels.

<start_here>

**Do these three things before writing a single recipe line.**

**1 — Pick the runner once.** Look for a lockfile in the project and use the matching column for
*every* command in this skill. Default: `npx drawstic`. If several lockfiles exist, prefer `bun`.

| lockfile | run drawstic as |
|---|---|
| `bun.lock` / `bun.lockb` | `bunx drawstic` |
| `pnpm-lock.yaml` | `pnpm dlx drawstic` |
| `yarn.lock` | `yarn dlx drawstic` |
| `package-lock.json`, or none | `npx drawstic` |

Every command below is written as `drawstic …` — prefix it with your runner. Working inside the
Drawstic repository itself? Use `bun run drawstic` instead.

**2 — Route to your craft guide and your starter.** Read the guide *before* drawing. Copy the
starter and restyle it — it already has the right skeleton, and it is verified to build.

| You are making | Read | Copy |
|---|---|---|
| a character, figure, chibi, sprite with several views | [character-craft.md](character-craft.md) | [starters/character-3view.drw](starters/character-3view.drw) |
| an icon family, app icons, a favicon set | [icon-craft.md](icon-craft.md) | [starters/icon-family.drw](starters/icon-family.drw) |
| game items, equipment, loot, a tileset or atlas | [item-craft.md](item-craft.md) | [starters/item-set.drw](starters/item-set.drw) |
| a scene, landscape, interior, background | [scene-craft.md](scene-craft.md) | [starters/scene-layers.drw](starters/scene-layers.drw) |
| one small standalone shape, logo or diagram | nothing extra — the recipe below is enough | — |

**3 — Know where the other two files are.** [verify.md](verify.md) is the verification loop as an
algorithm plus a code→fix table — read it before your first `check`. [language.md](language.md) is
the whole language surface with every trap tied to its diagnostic code — open it whenever you are
unsure of a construct or hit a code you do not recognise. [reference.md](reference.md) is the last
resort, for something neither one covers. Never used Drawstic before?
[walkthrough.md](walkthrough.md) is one complete run, request → artifact, with the real diagnostics
and the real fixes in between.

</start_here>

## The canonical path

Every shaded or modular asset is built in this order. Use this term for it — *the canonical path* —
and do not invent a different order.

1. **Theme** — one `light` (the single source of truth for shade, rim and cast) plus, for a figure,
   a `figure:` oracle. Every view and every variant applies the same theme, so they cannot drift.
2. **Materials** — `material NAME = COLOR RESPONSE`. The response is the *physics*
   (`metal`/`skin`/`cloth`/`glass`/`glow`/`flat`), never the colour.
3. **Parts** — each mass is a `Region` binding from a primitive or an organic constructor
   (`dome`/`lobe`/`crescent`/`ribbon`). A part that will be assembled declares its seams as `pin`s.
4. **Assembly** — `fit` places a part so its pin lands exactly on another part's pin; contact is
   structural, not eyeballed. `behind`/`front` set paint order, `aim` orients a held prop.
5. **Shade** — `model REGION MAT` (smooth, form-following; the default) or `cel REGION MAT N`
   (N crisp bands). There is no third way and no hand-shading floor.
6. **`outline`** — one bare pass as the assembly's last statement. It rings the sprite against
   **transparency**, so it is what separates a part-built asset from its background. A full-bleed
   scene has no transparency, so there it is a no-op — omit it, as `starters/scene-layers.drw` does.
7. **`critique` → answer its rubric → `build`.**

Icons are the one exception: at 16–32 px a flat plate with a 1 px bevel reads better than `model`.
icon-craft.md gives the rules.

## Workflow

```
1  context   drawstic context file.drw            # only when editing a file you did not write
2  write     theme → materials → parts → assembly → outline → export
3  check     drawstic check file.drw --lint --json     → must be []
4  fmt       drawstic fmt file.drw                     # canonical, idempotent, in place
5  look      drawstic render file.drw#name --png@4 --out /tmp/x.png   # then open the image
6  critique  drawstic critique file.drw --as <profile> --strict --json
7  answer    run critique.rubric.renders, answer every rubric item by looking
8  build     drawstic build file.drw --json
```

Steps 3 and 6 are loops: **do not proceed to the next step until the current one is green.**
The full loop, with a code→fix table for every diagnostic you can hit, is in [verify.md](verify.md).

## A complete recipe

Copy this shape. It is a real recipe: `check --lint` returns `[]`, `critique --as item --strict`
exits 0 with `pass:true`, and `build` writes both PNGs.

<example>

```drw
light sun      = dir 1:1 #ffe6b0 amb #2a3a5e 15%   # ONE source: light travels down-right ⇒ up-left edge is lit
material steel = #8a95a5 metal                     # colour + response; the response is physics, not colour
material grip  = #6d4527 cloth

draw sword 32x64:
  blade  = poly(16:6, 20:14, 20:40, 12:40, 12:14)  # each mass is a Region binding
  guard  = rrect(7:40, 25:44, 2)
  handle = rect(14:44, 18:54)
  pommel = circle(16:56, 3)
  model blade steel                                # smooth form shade → rim → AO → cast, all from sun
  cel   guard #d9a03a metal 3                      # 3 crisp bands; inline COLOR RESPONSE, no named material
  model handle grip
  cel   pommel #d9a03a metal 3
  outline                                          # one bare pass, last

export sword:                                      # path defaults to the name; WITHOUT this block, build writes nothing
  png @1 @4
```

```
$ drawstic check sword.drw --lint --json
{ "diagnostics": [], "census": { … "antiPatterns": { "manualSpread": 0, "stampWithPins": 0, "handShadow": 0 } } }

$ drawstic critique sword.drw --as item --strict --json    # exit 0
{ "critique": { "pass": true, "failedCodes": [], … } }

$ drawstic build sword.drw --json
{ "diagnostics": [], "artifacts": [ { "path": "…/sword.png", "bytes": 933 },
                                    { "path": "…/sword@4x.png", "bytes": 1793 } ] }
```

</example>

Three things that example is teaching:

- **No `export` block ⇒ `build` writes nothing** and still exits 0. A drawing that is never
  exported, stamped or fitted also raises lint `W002`. Write the `export` block with the recipe,
  not after it.
- **The light is declared once.** A file with exactly one `light` and no theme needs no `light L`
  argument anywhere — the single binding is found automatically. See the tier list in
  [language.md](language.md) before you add a second one.
- **`export` paths are relative to the recipe's own folder.** `build` writes next to the recipe;
  `--out <dir>` overrides. A path that starts with the recipe's own directory name raises `W016`.

**A family shares one export block** — comma-separated targets, a shared `dir`, one format list:

```drw
export chat, phone, contacts:   # one block, three drawings
  dir communication              # shared prefix; a target keeping its own path still wins over it
  png @1 @2
```

Add `file "{kebab base}"` only when names need reshaping for the block (e.g. camelCase drawing
names → kebab-case files) — skip it whenever the drawing name is already the filename you want.
Full precedence, `dir`/`file` grammar and the six inflectors: [language.md](language.md) §13.

## Verification default

There are several render modes. **Use this one unless you have a reason not to:**

```
drawstic render file.drw#name --png@4 --out /tmp/x.png     # then open the image and look
```

`@1` is too small on screen to judge; `--ascii` cannot show colour or a silhouette. The other modes
(`--silhouette`, `--inspect`, `--explain`, `--grid`, `--diff`, `--preview`, `sheet`) each answer one
specific question — [verify.md](verify.md) says which question each one answers. `critique --json`
also prints a `rubric.renders` list of the exact commands to run for *your* category; when it does,
run those instead of guessing.

## Definition of done

All four, every time. There is no fifth condition and no "accepted anyway" clause.

1. `drawstic check file.drw --lint --json` → `diagnostics` is `[]` **and** all three
   `census.antiPatterns` counters are `0`.
2. `drawstic critique file.drw --as <profile> --strict --json` → **exit code 0**. That is the
   must-fix subset — `C001`, `C007`, `C013`, plus `C003` for `icon` — and it is not negotiable.
   Then read **every** code in `critique.failedCodes` and, for each, either fix it or name it and
   say why it stands. Each carries a `fix` field that tells you how. Codes outside the must-fix
   subset are advisory *by design*, because each has a legitimate exception — `C009` between
   siblings that share a silhouette on purpose (a faction recolor, a shared plate or bottle shell),
   `C012` on a sprite whose padding is a deliberate baseline, `C004` on a near-black subject. An
   unexplained advisory code is a defect you did not look at; an explained one is a decision.
3. Every item in `critique.rubric.items` answered **by looking at a rendered image**, not by
   reasoning about the recipe. A clean `critique` verifies structure; only your eyes verify craft.
4. `drawstic build file.drw --json` → every artifact in the list has `bytes > 0`.

`critique.pass` goes `false` on *any* fired check, advisory ones included, so it is stricter than
the exit code and stricter than this gate. Read it as a prompt to explain, not as a failure.

If you cannot reach all four, say so and report the outstanding codes. Do not describe an unbuilt
or unviewed asset as finished.

## Map

| File | What is in it |
|---|---|
| [language.md](language.md) | the whole language surface + every trap tied to its error code |
| [verify.md](verify.md) | the verification loop as an algorithm + diagnostic→fix table |
| [walkthrough.md](walkthrough.md) | one complete run, request → artifact, plus short worked pairs |
| [character-craft.md](character-craft.md) · [icon-craft.md](icon-craft.md) · [item-craft.md](item-craft.md) · [scene-craft.md](scene-craft.md) | craft rules per category |
| [starters/](starters/) | runnable, verified recipes to copy and restyle |
| [reference.md](reference.md) | exhaustive CLI + language reference; the last resort |

<details>
<summary>Maintenance note (Drawstic developers only)</summary>

This skill ships in the npm package and is the only thing a consuming agent reads. It mirrors
`docs/language-spec.md` and `src/cli.ts`: any language or CLI change MUST update SKILL.md,
language.md, verify.md and reference.md in the same change, without loosening their precision or
token economy. Ground edits in real recipe runs, never in generic advice. Constructs removed from
the language (the raw shading quartet `rim`/`shadeRegion`/`lightRegion`/`ao`, the `lit L:` block,
`replace`, `tileset`, `cap`/`join`, the `drawstic N` pragma) must not reappear in any example here.
</details>
