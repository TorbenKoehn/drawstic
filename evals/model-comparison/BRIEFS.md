# Model comparison: briefs and protocol

The inputs behind the comparison table in [README.md](../../README.md), committed so the run can
be reproduced or contested. Decided in [ADR-0100](../../docs/decisions/0100-model-comparison-eval-corpus.md).

**A recipe in this tree is frozen once rendered.** Improving a weak result afterwards would turn
a measurement into a portfolio piece. A rerun is a new dated directory, not an edit.

## Protocol

Every builder gets exactly this, and nothing else:

1. The shipped product skill at `skills/drawstic/`. That is what a real user installs, so it is
   the only documentation a builder may read. Reading `examples/`, `docs/`, or another model's
   recipe in this tree is out of bounds, since no consumer of the npm package has them.
2. One brief from the list below, byte-identical across models.
3. The repo-local CLI, invoked as `bun run drawstic`.
4. A fixed output location: `evals/model-comparison/<model>/<category>.drw`.
5. The same stopping rule: iterate until `check --json` returns `[]` **and**
   `critique --as <category> --strict --json` exits 0, or until 10 repair iterations have passed,
   whichever comes first.

Each recipe declares exactly one drawing at the canvas size its brief names, and exactly one
export block:

```
export <drawName>:
  png @1 @4
```

Recorded per cell: whether the first `check` was clean, how many repair iterations followed, and
the final `critique --strict` verdict. Craft quality is left to the reader, because `critique`
verifies structure rather than craft.

## Brief 1 of 4: icon

```
Draw a compass rose icon for a maps application, 32x32, drawing name `compass`.
It has to stay readable at 32 pixels: a clear silhouette, no detail that turns to mush.
Choose your own palette.
```

## Brief 2 of 4: item

```
Draw a healing potion for a game inventory, 48x48, drawing name `potion`.
A glass bottle with liquid inside, a stopper, and light falling on it from one direction.
Choose your own palette.
```

## Brief 3 of 4: character

```
Draw a chibi blacksmith in Ragnarok Online style, front view, 64x128, drawing name `blacksmith`.
Roughly three head heights, a dark outline, cel shading, and a hammer.
Choose your own palette.
```

## Brief 4 of 4: scene

```
Draw a lighthouse on a rocky cliff at dusk, 192x108, drawing name `lighthouse`.
Sea in the foreground, sky behind, one light source, and a sense of depth from front to back.
Choose your own palette.
```
