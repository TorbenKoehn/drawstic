# Icon-DX Evaluation - Icon Family Authoring (2026-07-08)

This first icon-family run produced seven families with six icons each, at 32 px plus selected 16 px and 64 px variants. Outputs included PNG and SVG. The scoring scale uses 1.0 as best and higher numbers as worse.

## Summary

Overall grade: 1.8. Theme use and SVG export worked under real load. The biggest gap was not core drawing syntax, but family-consistency tooling and the specific discipline needed for 16 px redraws.

## Family Results

| Family | Model | Main assets | Grade |
|---|---|---|---:|
| Media | fable | camera, gallery, mic, music, video, podcast | solid |
| Weather/time | opus | compass, moon, stopwatch, timer, alarm, weather | solid |
| Finance | opus | bank, wallet, chart, invoice, cart, tag | solid |
| Communication | opus | chat, phone, contacts, feed, share, videocall | solid |
| Productivity | sonnet | calendar, clock, calculator, mail, notes, todo | solid |
| System | sonnet | search, settings, files, downloads, terminal, trash | solid |
| Games | sonnet | controller, dice, heart, map, puzzle, trophy | solid |

## Main Findings

1. Family consistency needs a contact-sheet workflow. Single-icon review misses drift in stroke, radius, margin, and highlight placement.
2. Pixel-mode SVG can become large when gradients, veils, or per-pixel detail prevent rectangle merging.
3. 16 px variants are redraws, not scaled-down 32 px masters.
4. Theme palettes help colour consistency but do not store geometry constants such as radius, margin, or stroke width.
5. Two engine-bug candidates were investigated: loop region accumulation and theme palette edge cases were fixed later; a suspected weather stroke issue was refuted.

## Fix Wave

- Added `drawstic sheet` for contact sheets (ADR-0082).
- Added warning W008 for excessive detail in small icons.
- Added `skills/drawstic/icon-craft.md`.

## Craft Rules Distilled

- Review each family as a sheet early and often.
- Redraw 16 px icons with fewer pixels and stronger silhouettes.
- Keep SVG-oriented assets flat and discrete when compact SVG matters.
- Put geometry constants in recipe-level values until themes support them.
- Make the role glyph clear before adding material or lighting polish.
