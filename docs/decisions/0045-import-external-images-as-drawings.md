# 45. `import`: external images as drawings

- Status: Accepted
- Date: 2026-07-04
- Deciders: t.koehn, Claude
- Refines: [ADR-0035](0035-import-sandbox-and-std-modules.md) (the file sandbox extends to image files)

## Context

`export` materializes drawings into image files; the reverse was missing — a recipe could
not consume **existing graphics** (a brand logo, a licensed sprite, output from another
tool) and `stamp` them. Authors had to hand-transcribe bitmaps into `pixels:` blocks.

The hard constraint is determinism (§14): an external file is an *input*, and its decoding
must be **bit-exact everywhere**. PNG qualifies (inflate + defilter is exact). JPEG does
**not** — IDCT implementations legally differ across decoders, so the same `.jpg` can yield
different pixels on different platforms. That is precisely the class of ambient variance
the language forbids.

## Decision

**1 — `import <name> = <path>` is a module-level definition** — binding form, so the §3
rule "scan for `=` to find every definition" keeps holding (`import` is the kind keyword,
exactly like `mask m = …`). The result is an ordinary **Drawing** (a bitmap value, §9 /
[ADR-0039](0039-region-algebra-constructors-combinators-eliminators.md)): stampable,
transformable, silhouette-bridgeable, a legal tileset/atlas member, re-exportable, and
importable by other modules like any definition (§2).

```drw
import logo = ../brand/logo.png
import hero = assets/hero.png sha256 9f2c…   # optional integrity pin

draw splash 64x32:
  stamp logo 4:4 scale2
  mask m = logo.region.shift(30:4)           # imported pixels join the region algebra
```

**2 — PNG only in v1.** The path is a **bareword with an explicit `.png` extension** (the
format is load-bearing, so it stays visible — unlike `.drw`, which is implied). PNG decode
is lossless and exact; the intrinsic pixel size becomes the drawing's `WxH`, and alpha is
honoured ([ADR-0025](0025-alpha-compositing-model.md)). **JPEG import is rejected for v1**:
its decoding is not bit-exact across implementations, which would silently break pixel
determinism (§14). It may return later behind the engine's own bundled, version-pinned
decoder.

**3 — The module sandbox applies unchanged** ([ADR-0035](0035-import-sandbox-and-std-modules.md)):
relative bareword paths only, `..` may not escape the project root, no network, no globs —
each a positioned error.

**4 — Optional integrity pin: `sha256 <hex>`.** A trailing pair on the RHS verifies the
file's content hash before use; a mismatch is a positioned error. This is the input-side
analogue of the `drawstic <N>` version pragma ([ADR-0029](0029-language-version-pragma.md)):
a recipe that pins its inputs renders identically or fails loudly — never differently.

**5 — Imported pixels are literal.** No palette applies (colours are baked RGBA); themes
do not recolour them. `tint`, filters, masks, and transforms all work — they operate on
pixels. `render --ascii` is unavailable for imported drawings (no palette keys to emit).

**6 — Noted extensions:** sprite-sheet slicing on import (a rect option), JPEG via a
bundled decoder, indexed-PNG palette adoption.

## Consequences

- The asset pipeline becomes two-way: `import` reads, `export` writes, and everything
  between is the existing algebra — no special-cased "image" type, just a Drawing.
- Determinism holds by construction: exact decode (PNG), sandboxed resolution, optional
  content pinning; `drawstic check`/`context` can enumerate all file dependencies
  statically because `import` is a declaration, not a runtime call.
- Touches spec §2 (definition table + modules bullet), §17 (grammar `importdef`), and
  [dsl-examples.md](../dsl-examples.md).
