# Walkthrough — one complete run

Everything below is copied from a real session against the shipped CLI. Commands are written as
`drawstic …`; prefix them with your runner.

## The request

> "Give me a compass icon, 32×32, PNG and SVG."

Small, standalone, one drawing — so no craft guide is needed (see the routing table in
[SKILL.md](SKILL.md)). Straight to the recipe.

## Attempt 1 — write it

<example>

```drw
theme uiIcons:
  palette:
    k = #26344a
    p = #eef2f8
    r = #e05a5a
  size 32x32
  mode pixel

use uiIcons

draw plate(accent) 32x32:
  rrect k 1:1 30:30 6 fill
  rrect accent 2:2 29:29 6 fill
  rrect accent.lighten(14%) 3:3 28:16 5 fill

draw compass 32x32:
  stamp plate(#3f6fb5) 0:0
  circle p 15:15 9 fill
  circle k 15:15 9
  poly r 15:7 18:16 12:16 w2
  poly k 15:24 18:16 12:16 fill
```

</example>

## Stage 1 — `check`

```
$ drawstic check compass.drw --lint --json
```

<example>

```json
{ "diagnostics": [
    { "severity": "error", "code": "E001", "message": "unknown name 'w2'",
      "file": "compass.drw", "line": 20, "column": 27, "hint": "did you mean 'w'?" },
    { "severity": "warning", "code": "W002",
      "message": "drawing 'compass' is neither exported, stamped, nor fitted",
      "file": "compass.drw", "line": 16, "column": 1,
      "hint": "export it, stamp it, or fit it from another drawing" } ],
  "census": { "antiPatterns": { "manualSpread": 0, "stampWithPins": 0, "handShadow": 0 } } }
```

</example>

Two real defects, both classic:

- **`E001 unknown name 'w2'`** — `poly` is the one shape command that takes no `w<N>`; its variadic
  point tail swallows the flag. Stroke a region instead: `stroke r poly(15:7, 18:16, 12:16) w2`.
- **`W002`** — there is no `export` block, so `build` would have written **nothing** and still
  exited 0. Add it now, not later.

```drw
export compass compass:
  png @1 @4
  svg ids classes
```

Re-run until the diagnostics array is empty:

```
$ drawstic check compass.drw --lint --json
diagnostics: []   antiPatterns: {"manualSpread":0,"stampWithPins":0,"handShadow":0}
$ drawstic fmt compass.drw
```

## Stage 3 — `critique`

```
$ drawstic critique compass.drw --as icon --strict --json     # exit 0
{ "critique": { "pass": true, "failedCodes": [], … } }
```

Green. **This is exactly the moment where a run goes wrong** — a green gate is not a finished icon.

## Stage 4 — the rubric, answered by looking

`critique --json` prints the commands to run and the questions to answer:

<example>

```json
"rubric": {
  "renders": [ "render compass.drw#compass --silhouette --png@6",
               "render compass.drw#compass --ascii --fit 64x64",
               "render compass.drw#compass --png@4" ],
  "items": [
    { "id": "misread", "when": "at native @1",
      "ask": "Cover the names. From the silhouettes alone, write down what you think each glyph
              is, one word each. Only then compare with what you meant …" },
    { "id": "merge-trap", "when": "glyph meets plate or a neighbour",
      "ask": "At @1, name every place a stroke touches another stroke or the plate edge …" } ],
  "note": "Answer every item from the renders above, with an observation — a name, a count, a
           location. \"Yes\" is not an answer. …" }
```

</example>

Running them and **opening the PNG** shows the north needle as a hollow red outline with the white
dial showing through it — it reads as a wobbly antenna, not a compass needle. `pass: true` could
never have caught that: the pixels are structurally fine, the drawing is just wrong. The fix:

```drw
  poly r 15:7 19:16 11:16 fill      # fill the north needle, widen its base
  poly k 15:24 19:16 11:16 fill
  circle k 15:16 1 fill             # pivot dot where the two needles meet
```

Re-render, look again: it now reads as a compass at a glance.

## Stage 5 — `build`

```
$ drawstic build compass.drw --json
{ "diagnostics": [],
  "artifacts": [ { "path": "…/compass.png",    "bytes": 312 },
                 { "path": "…/compass@4x.png", "bytes": 642 },
                 { "path": "…/compass.svg",    "bytes": 15138 } ] }
```

Three artifacts, all non-empty, written next to the recipe. Done — and only now.

So the finished recipe is attempt 1 plus the `export` block, with the two needle lines replaced by
the three above. Note that the stage-1 fix (`stroke r poly(…) w2`) was itself superseded at stage 4
— the needle looked wrong because it should never have been an outline at all. A green `check` told
you the line was *legal*; only the image told you it was *wrong*.

---

# Three follow-ups

## "Also give me the 16 px version."

**Redraw it by hand — never scale.** Below roughly 16 px, curves and strokes rasterize to mush, so
a `pixels:` grid is the right tool and the only one that reads. Keys are single ASCII letters,
`.` is transparent and never declared, every row is the same width.

<example>

```drw
draw compass16:
  palette k = #26344a p = #eef2f8 r = #e05a5a b = #3f6fb5
  pixels:
    ..bbbbbbbbbbbb..
    .bbbbbbbbbbbbbb.
    bbbbbkkkkkkbbbbb
    bbbkkppppppkkbbb
    bbkkpppprppppkbb
    bkkppppprpppppkb
    bkppppprrrppppkb
    bkpppprrrrrppppk
    bkppppkkkkkppppk
    bkpppppkkkppppkb
    bkkppppkkkppppkb
    bbkkppppkppppkbb
    bbbkkppppppkkbbb
    bbbbbkkkkkkbbbbb
    .bbbbbbbbbbbbbb.
    ..bbbbbbbbbbbb..

export compass16 compass16:
  png @1 @2
```

</example>

Ragged rows are `E002`; `check FILE --rows --json` reports every row's width so you never count by
hand.

## "Make it a tile set the game engine can load."

An `atlas` has two modes and you frequently want both from one recipe. `tile WxH` is the switch:
**with** it, members sit in fixed slots on a `cols`-wide grid — the only form the `tiled` sidecar
accepts; **without** it, members are shelf-packed to their own bounds, which is what a runtime
atlas (`atlasJson`) wants.

<example>

```drw
atlas terrainGrid:            # WITH tile: fixed slots on a grid
  sprites grass, dirt, water, stone
  tile 16x16
  cols 2
  pad 1

atlas terrainPack:            # WITHOUT tile: shelf-packed to each sprite's own bounds
  sprites grass, dirt, water, stone
  pad 1

export terrainGrid terrain-grid:
  png @1 @4
  tiled

export terrainPack terrain-pack:
  png @1
  atlasJson
```

</example>

```
$ drawstic build terrain.drw --json
terrain-grid.png 175 · terrain-grid@4x.png 518 · terrain-grid.tsj 234
terrain-pack.png 175 · terrain-pack.json 1155
```

**Gotcha, verified:** listing a drawing under `sprites` does **not** satisfy `W002`. Each member
still needs its own `export … png @1` (which you want anyway — engines load single frames too).
Members are addressed by name (`terrainGrid.grass`); the old numeric `.0` form is gone. `tileset`
no longer exists and hard-fails with an error naming `atlas`.

## "Now the same banner in three faction colours."

**Recolour parametrically, never by swapping the theme** — theme and host palettes do not cross a
`stamp`/`fit` boundary, so a stamped part keeps the palette it was drawn with. Make the colour a
parameter:

<example>

```drw
draw banner(c) 24x32:
  poly c 2:2 21:2 21:26 12:22 2:26 fill
  fill #ffffff.alpha(35%) poly(2:2, 21:2, 21:26, 12:22, 2:26).edge(0:1, 2)
  stroke #201a24 poly(2:2, 21:2, 21:26, 12:22, 2:26)

draw banners 80x32:
  stamp banner(#a83a36) 2:0
  stamp banner(#3a6fa8) 28:0
  stamp banner(#3f8a4a) 54:0

export banners banners:
  png @1 @4
```

</example>

Note `.edge(0:1, 2)` for the 2 px top highlight: the direction is **where the light travels**, so
`0:1` (downward) bands the **top** edge. `tint` on the `stamp` is the other option when you want to
push a whole variant toward one hue instead of repainting one mass.
