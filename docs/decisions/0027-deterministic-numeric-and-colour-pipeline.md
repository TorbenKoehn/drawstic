# 27. Deterministic numeric & colour pipeline (bundled math; pinned colour conversion)

- Status: Accepted
- Date: 2026-06-17
- Deciders: t.koehn, Claude
- Refines: [ADR-0007](0007-visual-not-byte-determinism.md)

## Context

This is the project's deepest under-appreciated risk, so state it plainly.
[Spec §14](../language-spec.md#14-determinism) promises a **pixel-identical framebuffer across
platforms and engine versions**. ADR-0007 established that we guarantee *pixel* and not *byte*
identity — but it only addressed the **encoder** (zlib), never the **arithmetic** that
produces the pixels.

That arithmetic is full of transcendentals:

- the colour model — `oklch → sRGB` needs `cbrt` and `pow` (transfer function);
- gradient / `mix` interpolation in OkLCh ([spec §12](../language-spec.md#12-colour-gradients-filters--themes));
- `sin`/`cos`/`atan2` for arcs ([ADR-0023](0023-arc-and-rounded-primitives.md));
- any math stdlib ([ADR-0034](0034-standard-library.md)).

Bun runs on JavaScriptCore. `Math.sin/cos/tan/atan2/pow/cbrt/exp/log` are **not** guaranteed
bit-identical across platforms or engine versions — they bottom out in the platform `libm`
and the JIT, which differ by OS, CPU, and version in their last ULPs. So **the §14
determinism promise is not met by naive `Math.*`**: two machines can compute different sRGB
bytes for the same `oklch(...)` and golden pixel tests will flap.

## Decision

**1 — Bundle deterministic implementations of every pixel-affecting transcendental.** Ship a
fixed, documented implementation (fdlibm-derived port or pinned polynomial/LUT) of `sin`,
`cos`, `tan`, `atan2`, `cbrt`, `pow`, `exp`, `log`, `hypot`. **Never** call host `Math.*` for
anything that can reach a pixel. Exceptions, by IEEE-754 guarantee:

- `Math.sqrt` is exempt — correctly-rounded and identical on every conforming platform.
- Basic `+ − × ÷` on doubles are IEEE-exact and fine.

**2 — Pin the colour pipeline exactly.**

- The `oklch ↔ sRGB` conversion uses **fixed matrices** (LMS ↔ linear-sRGB) and **fixed
  transfer-function constants** (the sRGB EOTF / inverse), all evaluated with the bundled
  `pow`/`cbrt`.
- **Gamut mapping:** for an out-of-sRGB colour, reduce OkLCh **chroma toward the achromatic
  axis** by a fixed **bisection** — a fixed iteration count of **16** (tolerance ≤ 1/2¹⁶ in
  chroma) — until in gamut, then **round-half-up** to 8-bit.
- **Hue interpolation** takes the **shorter arc** by default; a `via long` option is reserved
  for a future revision and documented as not-yet-available.
- Gradient and `mix` interpolation default to **OkLCh** ([spec §12](../language-spec.md#12-colour-gradients-filters--themes)).

**3 — Commit pixels in a fixed integer/fixed-point domain.** All intermediate colour and
coverage math reduces to this fixed domain **at commit**, with **round-half-up** (matching the
coordinate rule, [spec §5](../language-spec.md#5-coordinate-system)). The double-precision
intermediates never reach the framebuffer directly; they are quantised deterministically.

**4 — State the guarantee honestly, per mode** ([ADR-0013](0013-render-mode-pixel-vs-aa.md)):

- **PIXEL mode:** bit-identical framebuffer **guaranteed** across platforms (given a pinned
  language version) — this is the strong claim.
- **SMOOTH mode:** anti-aliased coverage and vector flattening are deterministic and
  reproducible **given a fixed language/math version** (it shares the bundled math), but is
  more sensitive; we do **not** advertise the cross-everything guarantee for it.
- **Cross-version identity holds only within a pinned language version**
  ([ADR-0029](0029-language-version-pragma.md)). A version bump may **intentionally** change
  pixels (better gamut mapping, a corrected constant).

**5 — Flattening constants live here.** Bézier flattening tolerance and the arc step
([ADR-0023](0023-arc-and-rounded-primitives.md)) are defined as **fixed constants in the
pinned numeric domain**, so curve rasterization is reproducible like everything else.

## Consequences

- This is what actually makes [spec §14](../language-spec.md#14-determinism) **true**; it
  **refines** [ADR-0007](0007-visual-not-byte-determinism.md), which only handled
  byte-vs-pixel and never float portability.
- The engine gains a hard obligation: a **bundled-math module** is the single source of all
  transcendentals; a lint/CI rule should forbid `Math.{sin,cos,…}` in `src/`.
- The "across engine versions" wording in §14 / ADR-0007 is **narrowed** to "within a pinned
  language version" ([ADR-0029](0029-language-version-pragma.md)).
- Touches [spec §12](../language-spec.md#12-colour-gradients-filters--themes) (colour
  pipeline) and [§14](../language-spec.md#14-determinism) (guarantee scope).
