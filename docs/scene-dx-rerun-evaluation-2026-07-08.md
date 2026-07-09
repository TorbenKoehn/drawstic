# Scene-DX Rerun Evaluation - Blind Rebuild (2026-07-08)

This rerun rebuilt all seven scenes from scratch after the first fix wave. Agents did not reuse the first-run recipes. The scoring scale uses 1.0 as best and higher numbers as worse.

## Summary

Overall grade improved from 1.9 to 1.7. All seven recipes passed `check --json` with `[]`, all PNG outputs existed, and visual verification confirmed that the first fix wave materially improved authoring quality.

## Score Snapshot

| Area | Rerun average | First run |
|---|---:|---:|
| Overall | 1.7 | 1.9 |
| Lighting | 1.9 | 2.6 |
| Diagnostics | 1.6 | 2.0 |
| New constructs | 1.3 | n/a |
| Self-verification | 1.6 | 1.9 |

## What Improved

1. Lighting became more predictable after documentation and helper updates.
2. New constructs reduced syntax friction and enabled cleaner organic shapes.
3. Diagnostics and lint output became easier for agents to act on.
4. The recipe authoring loop stayed stable across all seven scenes.

## Remaining Gaps

1. Visual craft still needs explicit contact-sheet or image-review discipline.
2. Radial effects in pixel mode and full-outline rim behavior still need clearer guidance.
3. Debug/probe render counts differ by scene, so iteration counts should be treated as observational rather than normalized metrics.

## Follow-Up Actions

- Preserve image review as part of the definition of done.
- Keep improving scene-craft docs where agent confusion repeats.
- Treat new helper syntax as successful when it removes repeated workaround patterns.
