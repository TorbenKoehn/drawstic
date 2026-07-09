# Item-DX v2 Evaluation - 64x64 Game Item Sets (2026-07-09)

This rerun repeated the item-set task at 64x64 in `examples/items-v2/`. Outputs included PNG @1/@4, atlas JSON, and Tiled `.tsj` sidecars. The scoring scale uses 1.0 as best and higher numbers as worse.

## Summary

Overall grade: 1.7, unchanged from the 32 px run. Larger canvases improved material readability, glints, folds, and facets, but did not automatically solve near-neighbour silhouette issues.

## Score Snapshot

| Axis | Grade | Notes |
|---|---:|---|
| Export and sidecar DX | 1.0-1.3 | Singles, sheet/atlas PNG, JSON, and `.tsj` worked across all sets. |
| Set consistency | 1.6 | Shared outline, light side, and material palette held at 64x64. |
| Material readability | 1.6 | More pixels helped glass, cloth, metal, and gems. |
| Silhouette and native-size readability | 1.7 | Still the main craft check. |

## Main Findings

1. 64x64 improves material detail but does not remove the need for strong primary silhouettes.
2. Sidecars verified cleanly: seven sets, six 64x64 frames each, and matching Tiled dimensions.
3. GPT tier labels replaced the legacy model labels cleanly.
4. Contact-sheet review remained mandatory.
5. No engine-bug cluster appeared.

## Craft Rules Distilled

- Build the large form first, then material.
- Give each item one role anchor that survives native-size review.
- Put problem pairs next to each other early.
- Treat @1 as the final inventory truth; @4 is for repair and review.
- Choose sidecar names deliberately and keep them stable.
