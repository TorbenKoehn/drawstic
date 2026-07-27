# Verification — the loop

`check` verifies grammar. `critique` verifies structure. **Only your eyes verify craft.** All three
are required; none substitutes for another.

Prefix every command with your runner (see the routing block in [SKILL.md](SKILL.md)).

## The algorithm

Run this literally. Do not skip a stage because the previous one looked fine.

```
STAGE 1 — grammar
  run: drawstic check FILE --lint --json
  if diagnostics is not []          -> fix the FIRST record (warnings count), re-run STAGE 1.
  if any antiPatterns counter > 0   -> replace that construct (table below), re-run STAGE 1.
  else                              -> drawstic fmt FILE, go to STAGE 2.

STAGE 2 — look
  run: drawstic render FILE#DRAWING --png@4 --out /tmp/x.png
  open the image.
  if it does not show what you intended -> edit, go back to STAGE 1. Do not proceed.

STAGE 3 — structure
  run: drawstic critique FILE --as PROFILE --strict --json
  PROFILE is one of: icon | item | character | scene   (never omit it — thresholds differ)
  if exit code != 0                 -> a must-fix code fired. Fix it, go to STAGE 1. Not negotiable.
  for each code left in critique.failedCodes:
      if you can state, in one sentence, why it is correct here
                                    -> keep it, and say that sentence in your final message.
      else                          -> apply that check's own `fix` field, go to STAGE 1.
  when every remaining code has a stated reason -> go to STAGE 4.

STAGE 4 — craft
  run every command in critique.rubric.renders, in the order given.
  answer every critique.rubric.items[].ask by LOOKING at those renders.
  if any answer is "no"             -> edit, go back to STAGE 1.
  else                              -> go to STAGE 5.

STAGE 5 — ship
  run: drawstic build FILE --json
  if any artifact has bytes == 0, or the artifacts list is empty -> you are missing an `export`
  block, or it names a drawing that paints nothing. Fix, go to STAGE 1.
  else -> done.
```

**`pass`, `failedCodes` and the exit code are three different signals.** `--strict` promotes only
the must-fix subset (C001 empty, C007 character seam, C013 occlusion parity, plus C003 centering for
the icon profile) to errors, so a clean exit code can still carry advisory findings.
`critique.pass` goes `false` on *any* fired check — read it, but it is not the gate: a family of
icons/items sharing one scaffold silhouette on purpose (a plate, a bottle, a shield) fires `C009`
**by design** and can never reach `pass: true`. Size variants are never compared at all — C009
only pairs siblings of the same canvas size — so a size ladder never fires it.

**Every advisory code may stand — with a stated reason, never silently.** Each one has a real
exception: `C009` for a deliberate shared scaffold, `C012` for a sprite whose padding is a chosen
baseline, `C004` for a near-black subject, `C002` for an object that touches the frame on purpose.
Of the 29 recipes bundled with this engine, 17 ship with at least one advisory code standing, and
every one is a decision, not an oversight. What is never acceptable is a code you did not read.

In the twelve-cell model-comparison eval, two cells shipped a visibly broken drawing with `check`
and `critique --strict` both green — a clean gate never proved the render was right. STAGE 2's look
and STAGE 4's rubric are what would have caught it; skipping either because STAGE 1/3 passed is
exactly the failure mode.

## Which render mode answers which question

You almost always want the first row. Reach past it only for the specific question in column 2.

| command | answers |
|---|---|
| `render F#D --png@4 --out x.png` | **the default.** What does it actually look like? (`@1` is too small on screen to judge) |
| `render F#D --silhouette --png@6` | Does the shape read with colour stripped? Are the parts aligned? (under `--ascii` black reads as empty — use PNG) |
| `render F#D --inspect --json` | Facts without pixels: `alphaCoverageBBox`, `distinctColorCount`, an ASCII `occupancy` grid, `namedMasks`. Optically centred iff `2·x + width - 1 == W - 1` |
| `render F#D --explain --json` | What will `model`/`cel` actually paint? Resolved colours, doses, offsets, each `fit`'s landed pins, paint order, each `aim` angle — *before* you render |
| `render F#D --png@4 --grid 8` | Where exactly is that misplaced part? (gridlines burned into the PNG only, never into `build`) |
| `render F#D --diff old.png --json` | Did my edit change anything I did not intend? returns `render.diff` = `{identical, changedPixelCount, totalPixelCount, changedBBox}` |
| `render F#D --preview` | A colour check straight in the terminal (ANSI truecolor); add `--fit 80x40` if big |
| `render F#D --ascii` | A shape check with no image viewer at all (luminance ramp). Cannot show colour or silhouette |
| `sheet F --png@4` | Cross-drawing consistency: every exported drawing (or `--all`) in one labelled, size-normalised grid. The tool for radius / stroke / grey-value / hue drift across a family. `--cols N` sets columns |

`render F#D(#c04040, 3)` renders a parametric drawing directly — literal arguments only (number,
colour, string, point, boolean). You never need a throwaway wrapper drawing.

`drawstic context F` prints one flat design brief for a file that imports or applies a theme: merged
palette, style guide, theme light, `figure:` numbers, importable drawings with previews, functions
and export plans. Run it before editing someone else's recipe.

## Anti-pattern counters → replacement

`check --lint --json` returns `census.antiPatterns`. All three must be `0`.

| counter | what it counted | write instead |
|---|---|---|
| `manualSpread` | a `litTone`/`shadowTone` fill clipped by `.intersect(rect…)` — the hand corner patch (`W013`) | the material's `spread N%` dose |
| `stampWithPins` | `stamp` of a part that declares attach pins (`W014`) | `fit part.pin host.pin` |
| `handShadow` | a semi-transparent ellipse hand-placed in the foot zone (`W015`) | `fit part.base … ground` |

## Diagnostic → fix

Errors fail the exit code; warnings and info never do. Every record is
`{severity, code, message, file, line, column, hint?}`.

| code | fix |
|---|---|
| `E001 unknown name 'w2'` | `poly` takes no `w<N>`. `stroke p poly(…) w2` |
| `E001` otherwise | typo; the hint suggests the nearest name |
| `E002` | ragged `pixels:` rows — run `check FILE --rows --json` for per-row widths |
| `E004` | misplaced or removed construct; the message names the replacement |
| `E007` | you bound a reserved builtin/command/filter name — rename |
| `E008` | import path is relative to the recipe and may not escape the project root |
| `E011` | argument count; often caused by using a removed keyword as a name |
| `E015` | bad list index, or an atlas member addressed by number instead of name |
| `E018` | export/sidecar mismatch, e.g. `tiled` on an atlas without `tile WxH` |
| `E024` | no light: declare exactly one `light`, or add a theme `light`, or pass `light L` |
| `E025` | a `behind`/`front` cycle — drop one relation |
| `E026` | unknown CLI flag (a typo like `--pgn@4`) — fix the command, not the recipe |
| `W001` | unused palette key — remove it, or use it |
| `W002` | add the `export` block, or stamp/fit the drawing (an atlas `sprites` listing does not count) |
| `W003` | a `stamp` at a literal point lands off-canvas — fix the point |
| `W006` | `dither a b t` is a raw set, not a blend: every opaque pixel becomes `a` or `b` |
| `W007` | a `stamp` is completely covered by a later one — delete it, or reorder |
| `W008` | `text` uses characters the font has no glyph for |
| `W009` | trim the transparent last pixel row |
| `W010` | a `fit` landed with no contact — move the pins onto real ink |
| `W011` | pin more than 2 px off the part's own ink |
| `W013` `W014` `W015` | see the anti-pattern table above |
| `W016` | export path repeats the recipe's directory name — drop the prefix |

Codes not listed (`E003 E005 E006 E010 E012 E013 E014 E016 E017 E019 E020 E021 E022 E023 E027`)
are self-describing — the record's `message` and `hint` name the fix directly.

| check | fires when | fix |
|---|---|---|
| `C001` | empty or near-empty canvas | you drew nothing, or exported the wrong drawing name |
| `C002` | opaque content touching a canvas edge on a transparent-framed sprite | leave 2–4 px breathing room (not applied to `character`/`scene`) |
| `C003` | optical centring off (`x0 + x1 != W-1`) | shift the glyph; must-fix under `--strict` for `icon` |
| `C004` | luminance p90−p10 reads flat | raise that material's `spread N%` — the `fix` field computes the exact multiplier — or switch the mass to `cel N`. Never hand-patch tones onto the region (that is `W013`) |
| `C005` | most load-bearing strokes are under `round(2·maxDim/32)` px at ≥32 px | thicken the dominant forms; fill masses instead of stroking them |
| `C006` | distinct-colour sprawl over the profile ceiling | advisory; matters for `indexed` PNG and SVG size |
| `C007` | a detached component overlapping the body bbox — a seam | must-fix under `--strict` for `character`: fix the pin geometry |
| `C008` | 1–3 px transparent pinholes enclosed by paint | widen the overlap where two regions join |
| `C009` | two same-canvas-size siblings collapse to the same silhouette (never compares across sizes) | differentiate them — **or**, when the shared silhouette *is* the point (faction recolor, shared plate/bottle/shield scaffold), leave it and say which pair and why. The only code you may leave standing |
| `C011` | one sibling's covered mass is far off the family average | advisory |
| `C012` | a transparent trailing edge row | trim or balance the margin |
| `C013` | a declared `behind`/`front` relation is not visible in the composite | must-fix under `--strict`: the occluder does not actually cover |
| `C014` | a landmark sits inconsistently across views | re-derive it from the `figure:` oracle instead of by hand |

## Honest reporting

If you stop before all five stages are green, say which stage and list the outstanding codes. Do not
call an asset finished that you did not build and did not look at. `critique.pass: true` is
necessary and **not** sufficient — it is a structural check, and the rubric exists precisely because
a machine cannot see whether the sword looks like a sword.
