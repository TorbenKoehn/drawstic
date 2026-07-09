// Shared deterministic bitmap-font primitives. The bundled faces themselves live
// as std font modules under src/std/fonts/.

/**
 * A resolved bitmap font face: fixed glyph cell size, per-glyph pixel rows
 * keyed by character (ADR-0054).
 */
export type BitmapFont = {
  name: string
  w: number
  h: number
  /** Extra pixel gap added after each glyph's width when advancing the cursor. */
  tracking: number
  /** Vertical pixel advance between lines. */
  lineHeight: number
  glyphs: Map<string, string[]>
  /** Map lowercase onto uppercase glyphs when the face has no lowercase. */
  upcase: boolean
}

/** The visible missing-glyph box for a face of the given cell size. */
export const missingGlyph = (w: number, h: number): string[] => {
  const rows: string[] = []
  for (let y = 0; y < h; y++) {
    if (y === 0 || y === h - 1) {
      rows.push('#'.repeat(w))
    } else {
      rows.push(`#${'.'.repeat(Math.max(0, w - 2))}${w > 1 ? '#' : ''}`)
    }
  }
  return rows
}
