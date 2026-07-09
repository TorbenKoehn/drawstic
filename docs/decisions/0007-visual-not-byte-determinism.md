# 7. Visual (pixel) determinism, not byte determinism

- Status: Accepted
- Date: 2026-06-13
- Deciders: t.koehn, Claude

## Context

"Deterministic" was the original headline, but any code-based drawing is deterministic;
the non-deterministic element is the LLM, not the engine. The real question is *what
level* of determinism we guarantee. Byte-identical files would require pinning the exact
compressor (zlib version/level) or shipping a custom deterministic encoder — cost the
project does not need.

## Decision

Guarantee **visual (pixel) determinism only**:

- **Guaranteed:** the same Recipe yields a **pixel-identical framebuffer** across
  platforms and engine versions.
- **Not guaranteed:** byte-identical PNG/JPEG output (compression may vary by encoder).
- **Golden tests compare pixels**, not file bytes.

To uphold it: no wall-clock, no locale-dependent behavior, fixed coordinate rounding
(half-up). Any future randomness must be a **pure seeded** function, never ambient.

## Consequences

- Frees us from pinning/hand-rolling a deterministic compressor.
- The test strategy is pixel-diffing against golden framebuffers.
- Lossy JPEG is fine: still deterministic given a fixed encoder, and only ever a derived
  output — never the determinism boundary.
