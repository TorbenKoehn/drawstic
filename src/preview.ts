// ASCII (`--ascii`) and ANSI half-block (`--preview`) renderings of a sprite
// (ADR-0031), the `--grid` coordinate overlay, and the `--diff` raster
// comparison: the agent's self-verification signals. Every export here is a
// debug-only CLI post-pass on already-rendered RGBA8 — none of it is
// reachable from `build`.

import { relativeLuminance } from './color.js'
import { scaleBitmap } from './raster.js'
import type { Sprite } from './values.js'

/**
 * How much of a painted (non-transparent) sprite is covered by its own declared
 * `sprite.pal` artifact vs. colors that only came from rendering (gradients,
 * filters, AA, imports) — surfaced in `render --json` so an agent can tell a
 * clean pixel-key sprite from one with unaccounted-for color.
 */
export type PreviewStats = {
  readonly unknownPixelCount: number
  readonly unknownColorCount: number
  readonly paletteCoveredPercent: number
}

/** RGBA8 at byte offset `i`, as a dedupable string key. */
const colorKeyAt = (data: Uint8Array, i: number): string =>
  `${data[i] ?? 0},${data[i + 1] ?? 0},${data[i + 2] ?? 0},${data[i + 3] ?? 0}`

export const spritePreviewStats = (sprite: Sprite): PreviewStats => {
  const byColor = new Set(
    sprite.pal.map((p) => `${p.color.r},${p.color.g},${p.color.b},${p.color.a}`),
  )
  const unknown = new Set<string>()
  let painted = 0
  let covered = 0
  for (let i = 0; i < sprite.data.length; i += 4) {
    const a = sprite.data[i + 3] ?? 0
    if (a === 0) {
      continue
    }
    painted++
    const key = colorKeyAt(sprite.data, i)
    if (byColor.has(key)) {
      covered++
    } else {
      unknown.add(key)
    }
  }
  return {
    unknownPixelCount: painted - covered,
    unknownColorCount: unknown.size,
    paletteCoveredPercent: painted === 0 ? 100 : Math.round((covered / painted) * 10000) / 100,
  }
}

/**
 * Crops to `crop`, clamped to the sprite's bounds; the returned `crop` is the
 * clamped rectangle actually applied (may be smaller than requested, never
 * negative or out-of-bounds). Backs `render --crop`.
 */
export const cropSprite = (
  sprite: Sprite,
  crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): {
  readonly sprite: Sprite
  readonly crop: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
} => {
  const x0 = Math.max(0, Math.min(sprite.w, crop.x))
  const y0 = Math.max(0, Math.min(sprite.h, crop.y))
  const x1 = Math.max(x0, Math.min(sprite.w, crop.x + crop.width))
  const y1 = Math.max(y0, Math.min(sprite.h, crop.y + crop.height))
  const width = x1 - x0
  const height = y1 - y0
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const src = ((y0 + y) * sprite.w + x0) * 4
    data.set(sprite.data.subarray(src, src + width * 4), y * width * 4)
  }
  return {
    sprite: { ...sprite, w: width, h: height, data },
    crop: { x: x0, y: y0, width, height },
  }
}

/**
 * Downscales with deterministic nearest-neighbour sampling (ADR-0031) to fit
 * within `fit`, preserving aspect ratio; a no-op (`fitted: false`) if the
 * sprite already fits. Backs `render --ascii`/`--preview --fit WxH` — never
 * applied to PNG output, only to text/terminal previews.
 */
export const fitSprite = (
  sprite: Sprite,
  fit: { readonly width: number; readonly height: number },
): { readonly sprite: Sprite; readonly fitted: boolean } => {
  if (sprite.w <= fit.width && sprite.h <= fit.height) {
    return { sprite, fitted: false }
  }
  const scale = Math.min(fit.width / sprite.w, fit.height / sprite.h)
  const width = Math.max(1, Math.floor(sprite.w * scale))
  const height = Math.max(1, Math.floor(sprite.h * scale))
  return {
    sprite: {
      ...sprite,
      w: width,
      h: height,
      data: scaleBitmap(sprite.data, sprite.w, sprite.h, width, height),
    },
    fitted: true,
  }
}

/**
 * Solid black-silhouette test (`render --silhouette`): every painted pixel
 * (`alpha > 0`) becomes opaque black (`#000000ff`); fully transparent pixels
 * (`alpha === 0`) stay transparent. A deterministic per-pixel transform on
 * already-rendered RGBA8 — the shape-only readout an agent uses to sanity-check
 * a modular character/sprite's occupancy, proportion, and part alignment
 * without colour distracting the eye. Chosen over an "RGB→0, keep alpha" variant
 * so semi-transparent edge pixels read as solid mass, not a faint fringe: a
 * silhouette test asks "what area does this cover", for which a hard 1-bit
 * coverage mask is the honest answer (see ADR-0083). Applied to the rendered
 * framebuffer before any output kind, so it composes with `--ascii`/`--preview`/
 * `--inspect`/PNG and with `--crop`/`--fit`/`--grid`.
 */
export const silhouetteSprite = (sprite: Sprite): Sprite => {
  const data = new Uint8Array(sprite.data.length)
  for (let i = 0; i < sprite.data.length; i += 4) {
    if ((sprite.data[i + 3] ?? 0) > 0) {
      data[i + 3] = 255
    }
  }
  return { ...sprite, data }
}

// sparse→dense glyph ramp; darker pixels map to earlier (sparser) glyphs, as
// on a dark terminal background — bright pixels map to later (denser) glyphs.
const ASCII_RAMP = ' .:-=+*#%@'

/**
 * True relative luminance of pixel `i` (0 = black or fully transparent, 1 =
 * white), alpha-composited over an implied black backdrop — the metric
 * `spriteToAscii` maps onto `ASCII_RAMP`. Composited over black (not white)
 * because the preview is read on a dark terminal: a transparent/unpainted
 * pixel must read as background-dark (sparse glyph), not paper-white.
 */
const luminanceAt = (sprite: Sprite, i: number): number =>
  relativeLuminance(
    sprite.data[i] ?? 0,
    sprite.data[i + 1] ?? 0,
    sprite.data[i + 2] ?? 0,
    sprite.data[i + 3] ?? 0,
  )

/** Grayscale ASCII preview derived from rendered RGBA pixels. */
export const spriteToAscii = (sprite: Sprite): string => {
  const lines: string[] = []
  for (let y = 0; y < sprite.h; y++) {
    let line = ''
    for (let x = 0; x < sprite.w; x++) {
      const i = (y * sprite.w + x) * 4
      const luminance = luminanceAt(sprite, i)
      const index = Math.max(
        0,
        Math.min(ASCII_RAMP.length - 1, Math.round(luminance * (ASCII_RAMP.length - 1))),
      )
      line += ASCII_RAMP[index] ?? ' '
    }
    lines.push(line)
  }
  return `${lines.join('\n')}\n`
}

/** A 24-bit ANSI color preview using half blocks (two pixel rows per line). */
export const spriteToAnsi = (sprite: Sprite): string => {
  const lines: string[] = []
  for (let y = 0; y < sprite.h; y += 2) {
    let line = ''
    for (let x = 0; x < sprite.w; x++) {
      const ti = (y * sprite.w + x) * 4
      const bi = ((y + 1) * sprite.w + x) * 4
      const ta = sprite.data[ti + 3] ?? 0
      const ba = y + 1 < sprite.h ? (sprite.data[bi + 3] ?? 0) : 0
      if (ta === 0 && ba === 0) {
        line += '\x1b[0m '
        continue
      }
      if (ta > 0 && ba > 0) {
        line += `\x1b[38;2;${sprite.data[ti]};${sprite.data[ti + 1]};${sprite.data[ti + 2]}m\x1b[48;2;${sprite.data[bi]};${sprite.data[bi + 1]};${sprite.data[bi + 2]}m\u2580`
      } else if (ta > 0) {
        line += `\x1b[0m\x1b[38;2;${sprite.data[ti]};${sprite.data[ti + 1]};${sprite.data[ti + 2]}m\u2580`
      } else {
        line += `\x1b[0m\x1b[38;2;${sprite.data[bi]};${sprite.data[bi + 1]};${sprite.data[bi + 2]}m\u2584`
      }
    }
    lines.push(`${line}\x1b[0m`)
  }
  return `${lines.join('\n')}\n`
}

// ── `render --grid N` coordinate overlay (§16, P3 drawing aids) ────────────

/** A tiny fixed 3×5 digit font for grid coordinate labels — debug-only, never real text. */
const DIGIT_W = 3
const DIGIT_H = 5
const DIGIT_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
}

/** Marks one digit's "on" cells into `mark` at `(px, py)`, each glyph cell drawn `cell` px wide/tall. */
const markDigit = (
  mark: Uint8Array,
  width: number,
  height: number,
  digit: string,
  px: number,
  py: number,
  cell: number,
): void => {
  const glyph = DIGIT_GLYPHS[digit]
  if (!glyph) {
    return
  }
  for (let gy = 0; gy < DIGIT_H; gy++) {
    const row = glyph[gy] ?? ''
    for (let gx = 0; gx < DIGIT_W; gx++) {
      if (row[gx] !== '1') {
        continue
      }
      for (let sy = 0; sy < cell; sy++) {
        const y = py + gy * cell + sy
        if (y < 0 || y >= height) {
          continue
        }
        for (let sx = 0; sx < cell; sx++) {
          const x = px + gx * cell + sx
          if (x < 0 || x >= width) {
            continue
          }
          mark[y * width + x] = 1
        }
      }
    }
  }
}

/** Marks a non-negative integer as a row of digit glyphs starting at `(px, py)`. */
const markNumber = (
  mark: Uint8Array,
  width: number,
  height: number,
  value: number,
  px: number,
  py: number,
  cell: number,
): void => {
  let x = px
  for (const ch of String(value)) {
    markDigit(mark, width, height, ch, x, py, cell)
    x += (DIGIT_W + 1) * cell
  }
}

/**
 * `render --grid N` (§16): burns a coordinate overlay into the OUTPUT raster
 * only — never `build` exports, never the diff comparison in {@link
 * diffRasters} (grid is purely cosmetic there). Runs as the very last
 * post-pass, after `--crop` and the `--png@K` scale, so `data`/`width`/
 * `height` are already the final output pixels; `spacing` (N) is in *source*
 * (recipe) pixels and `scale` is the `--png@K` factor already baked into
 * `data` — the actual line pitch is `spacing * scale` output pixels, which
 * keeps gridlines exactly 1 output-pixel thin and landing on recipe-pixel
 * boundaries at any scale. Edge labels (source-pixel coordinates, top edge
 * for columns, left edge for rows) scale their glyph size with `scale` so
 * they stay legible at typical debug scales (`--png@4`+). High-contrast
 * strategy: every overlay pixel is a full color invert of the pixel
 * underneath (forced opaque), which is visible against any scene — a fixed
 * overlay color could vanish into a same-toned background.
 */
export const applyGridOverlay = (
  data: Uint8Array,
  width: number,
  height: number,
  spacing: number,
  scale: number,
): Uint8Array => {
  if (spacing <= 0 || width <= 0 || height <= 0) {
    return data
  }
  const pitch = Math.max(1, Math.round(spacing * scale))
  const glyphCell = Math.max(1, Math.round(scale))
  const mark = new Uint8Array(width * height)
  for (let x = 0; x < width; x += pitch) {
    for (let y = 0; y < height; y++) {
      mark[y * width + x] = 1
    }
  }
  for (let y = 0; y < height; y += pitch) {
    for (let x = 0; x < width; x++) {
      mark[y * width + x] = 1
    }
  }
  for (let x = 0, k = 0; x < width; x += pitch, k++) {
    markNumber(mark, width, height, k * spacing, x + glyphCell, glyphCell, glyphCell)
  }
  for (let y = 0, k = 0; y < height; y += pitch, k++) {
    markNumber(mark, width, height, k * spacing, glyphCell, y + glyphCell, glyphCell)
  }
  const out = new Uint8Array(data)
  for (let i = 0; i < mark.length; i++) {
    if (mark[i] !== 1) {
      continue
    }
    const o = i * 4
    out[o] = 255 - (data[o] ?? 0)
    out[o + 1] = 255 - (data[o + 1] ?? 0)
    out[o + 2] = 255 - (data[o + 2] ?? 0)
    out[o + 3] = 255
  }
  return out
}

// ── `render --diff <png>` raster comparison (§16, P3 drawing aids) ─────────

/** Result of {@link diffRasters}: what changed between two same-sized RGBA8 rasters. */
export type RasterDiff = {
  readonly identical: boolean
  readonly changedPixelCount: number
  readonly totalPixelCount: number
  readonly changedBBox: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  } | null
}

/**
 * `render --diff <png>` (§16): per-pixel RGBA comparison of two equally-sized
 * rasters — the machine answer to "did my edit touch only the region I
 * meant to?" Compares the fresh render BEFORE `--grid` is burned in (the CLI
 * passes the pristine post-scale, pre-grid buffer); callers must pre-check
 * dimensions match (mismatched sizes are a CLI-level diagnostic, not handled
 * here). `changedBBox` is `null` iff `identical` — there is nothing to bound.
 */
export const diffRasters = (
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
): RasterDiff => {
  let changed = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (
        a[i] !== b[i] ||
        a[i + 1] !== b[i + 1] ||
        a[i + 2] !== b[i + 2] ||
        a[i + 3] !== b[i + 3]
      ) {
        changed++
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minY = Math.min(minY, y)
        maxY = Math.max(maxY, y)
      }
    }
  }
  return {
    identical: changed === 0,
    changedPixelCount: changed,
    totalPixelCount: width * height,
    changedBBox:
      changed === 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
  }
}
