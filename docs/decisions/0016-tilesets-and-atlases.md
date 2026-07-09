# 16. Tilesets & atlases: bake many drawings into one image + sidecar export

- Status: Accepted
- Date: 2026-06-14
- Deciders: t.koehn, Claude

## Context

Agents need to ship sprites to game engines and sprite runtimes, which want **one image
plus a coordinate map**, not N separate files. Two distinct shapes exist in the wild:

- a **tileset** — equal-sized tiles in a grid, addressed by **index** (Tiled, Godot maps);
- a **texture atlas** — varied-sized sprites packed tightly, addressed by **name**
  (Phaser/Pixi/TexturePacker, Aseprite sheets).

A plain `draw` with hand-placed `stamp`s already bakes pixels (content/output separation,
[ADR-0006](0006-modules-and-content-output-separation.md)), but it loses the **logical
map** (which rect is "grass" / tile 3) that export formats need, and forces manual layout.
So a dedicated construct earns its place: it carries the index/name → rect map and lays out
automatically.

## Decision

Add two **content** declarations (importable + exportable like `draw`):

**`tileset <name> <W>x<H>:`** — equal-sized tiles in a grid, addressed by index (row-major
from 0). Every member must equal the declared tile size (a mismatch is a positioned error).

```drw
tileset terrain 16x16:
  tiles grass, dirt, water, stone     # bracket-less list (§3); index 0..3
  cols 4                              # optional; default: near-square auto layout
```

**`atlas <name>:`** — varied-sized sprites packed automatically, addressed by name.

```drw
atlas hud:
  sprites play, pause, stop, logo     # any sizes; names address the frames
  pad 1                               # optional inter-sprite padding px (default 0)
  place logo 0:0                      # optional: pin a member; the rest pack around it
```

- **The body is command-form directives, not bindings** ([ADR-0015](0015-unified-call-model.md)),
  exactly like a `draw` body holds drawing commands and a `theme` body holds `with`. So
  `tiles`/`sprites`/`cols`/`pad`/`place` are directives, *not* `=` bindings — they never
  imply a reusable variable. `tiles`/`sprites` take the bracket-less member list
  (`tiles grass, dirt, water, stone`, the same shape as `with pixel-base, warm-pal`);
  `cols`/`pad` take a number; `place` takes a name + point.
- **Layout is auto with explicit override** (the chosen behaviour):
  - `tileset`: auto column count `ceil(sqrt(count))`, row-major; override with `cols N`.
  - `atlas`: auto shelf-packing; pin any subset with `place`, the rest pack around the
    pinned rects.
- **Layout is deterministic** ([ADR-0007](0007-visual-not-byte-determinism.md)). The packer
  is a fixed, documented procedure: members sorted by height desc, then width desc, then
  name asc; shelf/row packing into a near-square sheet; `place`d rects reserved first;
  `pad` applied between and around. Exact tie-breaks are pinned with the implementation,
  the same way midpoint-circle rasterization is.

**Export gains sidecar formats** ([ADR-0006](0006-modules-and-content-output-separation.md)).
A `tileset`/`atlas` exports the baked `png` plus an optional descriptor; the file naming is
fixed to avoid collisions:

| Format line | Emits | Applies to |
|-------------|-------|------------|
| `png` (alone) | `<base>.png` — the grid/packed sheet, engine-agnostic | both |
| `tiled` (`tiled xml` for XML) | `<base>.tsj` / `<base>.tsx` (Tiled tileset) | `tileset` only (Tiled needs uniform tiles) |
| `atlas-json` | `<base>.json` (TexturePacker/Phaser/Pixi frames map) | both |
| `aseprite` | `<base>.aseprite.json` (Aseprite sheet) | both |

```drw
export terrain tiles/terrain:
  png
  tiled

export hud atlas/hud:
  png
  atlas-json
  aseprite
```

## Consequences

- One uniform mental model: `tileset`/`atlas` are content, `export` emits image + sidecar —
  no new output pipeline, just new descriptor writers alongside `png`/`svg`/`jpeg`.
- Game-engine interop without leaving the Recipe: Tiled maps, web-game atlases, and
  pixel-art (Aseprite) sheets all come from one declaration.
- Determinism holds because the packer is fixed; "visual determinism" now also means
  "identical rect layout across runs/platforms" for a given member set.
- The sidecar formats describe an index/name → rect map, so `atlas-json`/`aseprite` work for
  both constructs; `tiled` is restricted to uniform `tileset`s.
- **Open / refinable** (pinned when the parser+packer land): exact shelf-packer tie-breaks
  and sheet-size heuristic; addressing a *single* member for re-stamping (`terrain.0` by
  index is clean; an atlas name key like `hud["play"]` reuses §4 bracket-indexing) — treated
  as a natural extension, not part of this decision's core.
- Backed by the bench philosophy ([ADR-0014](0014-token-efficiency-bench-suite.md)): the
  member-list syntax (`tiles a, b, c`) reuses the bracket-less list shown to be cheapest;
  a corpus case can be added if the layout-directive syntax needs tuning.
