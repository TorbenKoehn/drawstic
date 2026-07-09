# 70. Unified shadow argument shape (and v2 mask-respecting frame shadow)

- Status: Accepted
- Date: 2026-07-08
- Deciders: t.koehn, Claude
- Refines: [ADR-0062](0062-scoped-shadow-and-texture-filters.md); mask change gated by [ADR-0029](0029-language-version-pragma.md)

## Context

Drawstic exposes one concept — *drop a silhouette shadow at an offset* — through three
surfaces with three different argument shapes ([evaluation](../scene-dx-evaluation-2026-07-08.md),
prioritized action #6; `TODO-IMP.md` §4.3):

- stamp flag `stamp part pt shadow dx:dy paint` — an **`dx:dy` point** offset,
- frame filter `shadow dx dy paint` — **two separate numbers**,
- region forms `castShadow r dx:dy paint` and `shadow r dx:dy paint` (ADR-0062) — region, then
  an `dx:dy` point.

Two of the three already carry a `dx:dy paint` tail; the whole-frame filter alone spelled the
offset as two bare numbers. An author who learned the offset as `dx:dy` from `stamp`/`castShadow`
had to read source to discover the frame filter wanted `dx dy` (orbit hit exactly this).

A second, separate wart from the P1 documentation wave ([spec §12](../language-spec.md#12-colour-gradients-filters--themes)):
the whole-frame `shadow` filter **rebuilds the entire framebuffer and ignores an enclosing
`mask …:` block**, unlike `grain`/`speckle`/`ripple`/`dither` (which respect the mask) and the
region shadow forms (which take an explicit region). Confining a frame shadow therefore forced
the component-`draw` + `stamp` detour even when a `mask` block was already open.

## Decision

**1 — One `[region] dx:dy paint` shape for every shadow surface.** The whole-frame filter gains
the canonical point form `shadow dx:dy paint`, matching the stamp flag, `castShadow r dx:dy p`,
and the region form `shadow r dx:dy p`. The offset is always an `dx:dy` point; the paint always
follows; a region, when present, always leads. There is now a single tail to remember.

```drw
shadow 1:1 #0006          # whole-frame drop shadow (v2 canonical)
shadow hull 2:3 #0008     # local region shadow (ADR-0062)
castShadow hull 2:3 #0008 # explicit region cast (ADR-0062)
stamp boat 8:14 shadow 1:1 #0006   # stamp silhouette shadow (ADR-0062)
```

**2 — The signature change is a pure, version-independent extension.** A frame `shadow`'s first
argument is a **point** (`dx:dy`), a **region**, or — deprecated — a **number**; the three are
runtime-distinguishable, so dispatch is unambiguous and no pragma gate is needed for the shape.
The legacy two-number `shadow dx dy paint` stays **accepted in every language version** as a
deprecated alias (error-robustness, [spec §1](../language-spec.md#1-design-priorities) priority
2 — a forgiving grammar over a silent misparse), but is removed from the docs and skill in
favour of `dx:dy`. A future major version may drop it.

**3 — In language version 2 the frame `shadow` filter respects an enclosing `mask …:` block.**
It writes only mask-visible pixels (the shadow silhouette is cast from the whole buffer but
lands only inside the mask; masked-off pixels keep their content), consistent with the texture
filters and the region shadow forms — so **every** filter under a `mask` block now confines the
same way, and the frame-shadow confinement detour is gone. This is a breaking pixel change for a
`shadow`-inside-`mask` recipe, so it is **gated on the version pragma**
([ADR-0029](0029-language-version-pragma.md)): `drawstic 1` keeps the whole-buffer rebuild
(mask ignored); unpinned recipes and `drawstic 2`+ get the mask-respecting form. Every bundled
scene pins `drawstic 1`, so no existing render changes. An unmasked frame `shadow` is unchanged
in both versions.

Deterministic and pinned throughout: offsets quantize round-half-up, integer straight-alpha
source-over ([ADR-0025](0025-alpha-compositing-model.md)).

## Consequences

- One argument shape across all four shadow surfaces — no source read to recall the frame
  filter's order; closes the evaluation's shadow-signature finding.
- Frame `shadow` joins `grain`/`speckle`/`ripple`/`dither` as mask-respecting (v2), so a `mask
  …:` block confines every filter uniformly; the language-version-2 difference list grows by
  this one behavioural change alongside the [ADR-0068](0068-shaderegion-veil-opacity-signature.md)
  `shadeRegion` change.
- Imposes the [ADR-0029](0029-language-version-pragma.md) retain-old-semantics obligation: the
  v1 whole-buffer frame shadow lives on, selected by the module pragma at command dispatch (the
  `respectMask` flag on `filterShadow`).
- Touches [spec §12](../language-spec.md#12-colour-gradients-filters--themes) (filter list +
  compositing semantics + confinement idiom), [§14](../language-spec.md#14-determinism)
  (version-2 difference list), [§17](../language-spec.md#17-grammar-normative) (filter-cmd
  grammar), `src/eval.ts`, `src/raster.ts`, tests, and the product skill
  (`skills/drawstic/SKILL.md` + `reference.md`), `docs/best-practices.md`.
