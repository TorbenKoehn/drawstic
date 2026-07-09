# TODO-ANIMATION - Animation Frames, Animated GIF, and Sprite Sheets

Status: open; engine groundwork required. Procedure: `.claude/skills/craft-eval/SKILL.md`. Output: `examples/animations/`. Evaluation report: `docs/animation-dx-evaluation-<date>.md`. Craft guide: `skills/drawstic/animation-craft.md`.

## Goal

Build frame animations such as walk cycles, loops, and effects. The craft focus is frame coherence, timing, arcs, squash and stretch, and seamless loops. Export targets are animated GIF and sprite sheets, plus existing sidecars such as `atlasJson`, Aseprite JSON, and Tiled metadata.

## Phase 0 - Engine Groundwork

Current state: `build.ts` supports png/svg/jpeg only. `sidecars.ts` already has frame-oriented structures for atlas, Aseprite, and Tiled outputs.

1. ADR: define animation semantics for the DSL. Decide whether frames are a parametric draw over a frame index or a list of named frame draws. Criteria: token economy, part reuse between frames, and `--diff` as an onion-skin substitute.
2. Add `src/gif.ts`: deterministic GIF89a encoder with LZW, global/local palette support, frame delays, loop count, disposal, and no runtime dependencies. Add only enough decoder support for structural tests.
3. Integrate export support: GIF target in `build.ts` and CLI, plus sprite-sheet strip/grid PNG generation wired to existing sidecar writers.
4. Update tests, `docs/language-spec.md`, and the product skill in the same change. `bun run test` must pass.

## Agent Assignment

| Agent | Model | Animation | Target frames |
|---|---|---|---|
| 1 | fable | Side-view figure walk cycle | 8 |
| 2 | opus | Run cycle | 6-8 |
| 3 | opus | Coin spin | 6 |
| 4 | opus | Explosion | 7-9 |
| 5 | sonnet | Idle bounce for a slime or character | 4-6 |
| 6 | sonnet | Water or fire loop suitable for tiles | 4-8 |
| 7 | sonnet | Waving flag | 6-8 |

## Requirements

- Frame size: 32-64 px. Loops must be seamless from final frame back to first frame.
- Deliverables per agent: `.drw`, animated GIF, sprite-sheet PNG, one sidecar, and a contact sheet of all frames at @4.
- Verification: individual fragment renders, `--diff` from frame N to N+1, and visual review of GIF or sprite-sheet frames.
- Quality bar: stable volume, arc-based motion, no flicker, and 1-2 smear or anticipation frames where useful.

## Extra Score Rows

Frame semantics and reuse; GIF export quality, palette, and delays; sprite-sheet and sidecar sync; `--diff` workflow; loop tooling.

## Definition of Done

- [ ] Phase 0 complete: ADR, `src/gif.ts`, export integration, sidecars, tests passing, skill synced.
- [ ] 7 animations in `examples/animations/` with GIF, sprite sheet, sidecar, and `check --json` = `[]`.
- [ ] 7 individual evaluation reports, one consolidated evaluation report, and an AGENTS.md docs-index entry.
- [ ] Fix wave completed with code first, docs second, probe verification, and `bun run test` passing.
- [ ] `skills/drawstic/animation-craft.md` plus a routing line in `skills/drawstic/SKILL.md`.
