// SVG output (spec §13, ADR-0013): in pixel mode pixels become <rect>s
// (horizontal same-color runs merged); title/desc metadata for icon
// accessibility.

import { toHexColor } from './color.js'
import type { Path, Sprite } from './values.js'

/**
 * Flags for the `svg` export (spec §13): `ids` numbers every emitted `<rect>` (`px-0`,
 * `px-1`, …); `classes` emits a `<style>` block with one CSS class per distinct
 * *opaque* palette colour and references it from matching rects; `inlineStyles`
 * writes `fill`/`fill-opacity` via a `style="…"` attribute instead of separate
 * presentation attributes (used for non-palette or non-opaque pixels, or
 * whenever `classes` is off).
 */
export type SvgOptions = {
  ids: boolean
  classes: boolean
  inlineStyles: boolean
}

const quote = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

/**
 * Rasterized SVG for a rendered `Sprite` (spec §13): scans each row and merges
 * horizontal runs of RGBA-identical pixels into one `<rect width=run height=1>` —
 * a "pixel-run rect". Fully transparent pixels emit nothing. Always
 * pixel-rasterized regardless of render mode (no vector/shape reconstruction);
 * `title`/`desc`, when present on the sprite, are emitted for icon
 * accessibility.
 *
 * `shape-rendering="crispEdges"` is emitted only for `sprite.mode === 'pixel'` (ADR-0013). In
 * `'smooth'` mode the rasterizer already produced anti-aliased edge pixels (partial-alpha runs);
 * `crispEdges` tells the viewer to skip anti-aliasing the emitted `<rect>` geometry on scale, which
 * would discard exactly that — so smooth-mode output omits the attribute and takes the viewer's
 * default (`auto`, anti-aliased).
 */
export const encodeSvg = (sprite: Sprite, opts: SvgOptions): string => {
  const { w, h, data } = sprite
  const lines: string[] = []
  const crisp = sprite.mode === 'pixel' ? ' shape-rendering="crispEdges"' : ''
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${crisp}>`,
  )
  if (sprite.title) {
    lines.push(`  <title>${quote(sprite.title)}</title>`)
  }
  if (sprite.desc) {
    lines.push(`  <desc>${quote(sprite.desc)}</desc>`)
  }
  // class per palette key when requested
  const classByHex = new Map<string, string>()
  if (opts.classes) {
    const css: string[] = []
    for (const p of sprite.pal) {
      const hex = toHexColor(p.color)
      if (classByHex.has(hex)) {
        continue
      }
      classByHex.set(hex, `c-${p.key}`)
      css.push(`.c-${p.key}{fill:${hex}}`)
    }
    if (css.length > 0) {
      lines.push(`  <style>${css.join('')}</style>`)
    }
  }
  let n = 0
  for (let y = 0; y < h; y++) {
    let x = 0
    while (x < w) {
      const i = (y * w + x) * 4
      const a = data[i + 3] ?? 0
      if (a === 0) {
        x++
        continue
      }
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      let run = 1
      while (x + run < w) {
        const j = (y * w + x + run) * 4
        if (data[j] !== r || data[j + 1] !== g || data[j + 2] !== b || data[j + 3] !== a) {
          break
        }
        run++
      }
      const hex = toHexColor({ type: 'color', r, g, b, a: 255 })
      const attrs: string[] = [`x="${x}"`, `y="${y}"`, `width="${run}"`, `height="1"`]
      if (opts.ids) {
        attrs.push(`id="px-${n}"`)
      }
      const cls = classByHex.get(a === 255 ? hex : toHexColor({ type: 'color', r, g, b, a }))
      const opacity = a === 255 ? '' : ` fill-opacity="${(a / 255).toFixed(4)}"`
      if (cls && a === 255) {
        attrs.push(`class="${cls}"`)
      } else if (opts.inlineStyles) {
        const fillOpacity = a === 255 ? '' : `;fill-opacity:${(a / 255).toFixed(4)}`
        attrs.push(`style="fill:${hex}${fillOpacity}"`)
      } else {
        attrs.push(`fill="${hex}"${opacity}`)
      }
      lines.push(`  <rect ${attrs.join(' ')}/>`)
      n++
      x += run
    }
  }
  lines.push('</svg>')
  return `${lines.join('\n')}\n`
}

/** Rounds to 4 decimal places and drops trailing zeros, for compact `d=""` output. */
const fmt = (n: number): string => Number.parseFloat(n.toFixed(4)).toString()

/**
 * Renders `path.commands` to an SVG path `d` mini-language string. `arc` has no
 * SVG-arc equivalent here — it degrades to a straight line (`L`) to its `to`
 * point, same as the polyline approximation used for fill/stroke elsewhere.
 */
const pathData = (path: Path): string => {
  const out: string[] = []
  for (const cmd of path.commands) {
    switch (cmd.kind) {
      case 'move':
        out.push(`M${fmt(cmd.to.x)} ${fmt(cmd.to.y)}`)
        break
      case 'line':
        out.push(`L${fmt(cmd.to.x)} ${fmt(cmd.to.y)}`)
        break
      case 'quad':
        out.push(`Q${fmt(cmd.control.x)} ${fmt(cmd.control.y)} ${fmt(cmd.to.x)} ${fmt(cmd.to.y)}`)
        break
      case 'bezier':
        out.push(
          `C${fmt(cmd.control1.x)} ${fmt(cmd.control1.y)} ${fmt(cmd.control2.x)} ${fmt(
            cmd.control2.y,
          )} ${fmt(cmd.to.x)} ${fmt(cmd.to.y)}`,
        )
        break
      case 'arc':
        out.push(`L${fmt(cmd.to.x)} ${fmt(cmd.to.y)}`)
        break
      case 'close':
        out.push('Z')
        break
    }
  }
  return out.join(' ')
}

/**
 * Vector SVG for a `Path` definition (`export … path`, ADR-0061 §6) — geometry,
 * not the rendered bitmap ({@link encodeSvg} does that). Prefers an SVG `<path>`
 * built from the authored commands (even-odd fill, `currentColor` so the
 * consumer controls colour); if the path has no commands (e.g. one built by
 * {@link pathFromRegion}) it falls back to pixel-run `<rect>`s over the region's
 * coverage. `viewBox`/size come from `path.viewBox` when set, else the region's
 * bbox.
 */
export const encodePathSvg = (path: Path): string => {
  const w = path.viewBox?.width ?? Math.max(1, Math.ceil(path.region?.bbox?.x1 ?? 0))
  const h = path.viewBox?.height ?? Math.max(1, Math.ceil(path.region?.bbox?.y1 ?? 0))
  const lines: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
  ]
  const d = pathData(path)
  if (d) {
    lines.push(`  <path d="${quote(d)}" fill="currentColor" fill-rule="evenodd"/>`)
  } else if (path.region?.bbox) {
    const b = path.region.bbox
    for (let y = b.y0; y <= b.y1; y++) {
      let x = b.x0
      while (x <= b.x1) {
        if (!path.region.has(x, y)) {
          x++
          continue
        }
        let run = 1
        while (x + run <= b.x1 && path.region.has(x + run, y)) {
          run++
        }
        lines.push(`  <rect x="${x}" y="${y}" width="${run}" height="1" fill="currentColor"/>`)
        x += run
      }
    }
  }
  lines.push('</svg>')
  return `${lines.join('\n')}\n`
}
