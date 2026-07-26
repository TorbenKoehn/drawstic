// `drawstic build`: run every export in a module, writing artifacts to disk
// (spec §13, ADR-0006).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { ExportDefinition, FormatLine } from './ast.js'
import type { Color } from './color.js'
import { ERROR_CODE, error, type TextSpan } from './diagnostic.js'
import type { DefinitionEntry, Engine, ModuleRecord } from './eval.js'
import { encodeJpeg } from './jpeg.js'
import { encodePngIndexed, encodePngRgba } from './png.js'
import { scaleBitmap } from './raster.js'
import { asepriteJson, atlasJson, type Frame, tiledTsj, tiledTsx } from './sidecars.js'
import { encodePathSvg, encodeSvg } from './svg.js'
import type { Path, Sprite } from './values.js'

/** One file written to disk; the shape reported per-artifact in `build --json`. */
export type BuiltArtifact = { readonly path: string; readonly bytes: number }

/**
 * The rendered result of one export's content reference, resolved once per
 * format line (§13) so a per-line `mode` override re-renders under that
 * mode. `path` is set only for `path` definitions (geometry, not pixels);
 * `frames`/`tileMeta` are set only for `tileset`/`atlas` sidecars.
 */
type Content = {
  readonly sprite: Sprite
  readonly path: Path | null
  readonly kind: 'draw' | 'tileset' | 'atlas' | 'image' | 'path'
  readonly frames: readonly Frame[] | null
  readonly tileMeta: {
    readonly tileWidth: number
    readonly tileHeight: number
    readonly columns: number
    readonly count: number
  } | null
}

const renderContent = (engine: Engine, mod: ModuleRecord, ex: ExportDefinition): Content => {
  const entry = mod.definitions.get(ex.name)
  if (!entry) {
    throw error(
      ERROR_CODE.exportError,
      `export references unknown content '${ex.name}'`,
      mod.displayPath,
      ex.span,
    )
  }
  return contentFromEntry(engine, entry, ex)
}

const contentFromEntry = (
  engine: Engine,
  entry: DefinitionEntry,
  ex: ExportDefinition,
): Content => {
  switch (entry.kind) {
    case 'draw':
      return {
        sprite: engine.renderDraw(entry, [], ex.span),
        path: null,
        kind: 'draw',
        frames: null,
        tileMeta: null,
      }
    case 'tileset': {
      const tv = engine.buildTileset(entry, ex.span)
      return {
        sprite: tv.sheet,
        path: null,
        kind: 'tileset',
        frames: tv.frames.map((f, i) => ({ name: tv.names[i] ?? String(i), ...f })),
        tileMeta: {
          tileWidth: tv.tileWidth,
          tileHeight: tv.tileHeight,
          columns: tv.columns,
          count: tv.frames.length,
        },
      }
    }
    case 'atlas': {
      const av = engine.buildAtlas(entry, ex.span)
      return { sprite: av.sheet, path: null, kind: 'atlas', frames: av.frames, tileMeta: null }
    }
    case 'path': {
      const path = engine.evalPath(entry, [], ex.span)
      return {
        sprite: {
          type: 'sprite',
          name: ex.name,
          w: path.viewBox?.width ?? Math.max(1, Math.ceil(path.region?.bbox?.x1 ?? 0)),
          h: path.viewBox?.height ?? Math.max(1, Math.ceil(path.region?.bbox?.y1 ?? 0)),
          data: new Uint8Array(
            (path.viewBox?.width ?? Math.max(1, Math.ceil(path.region?.bbox?.x1 ?? 0))) *
              (path.viewBox?.height ?? Math.max(1, Math.ceil(path.region?.bbox?.y1 ?? 0))) *
              4,
          ),
          pal: [],
          title: undefined,
          desc: undefined,
        },
        path,
        kind: 'path',
        frames: null,
        tileMeta: null,
      }
    }
    case 'image':
      return {
        sprite: engine.defToSprite(entry, ex.span),
        path: null,
        kind: 'image',
        frames: null,
        tileMeta: null,
      }
    default:
      throw error(
        ERROR_CODE.exportError,
        `'${ex.name}' is not exportable content (a draw, path, tileset, or atlas)`,
        entry.module.displayPath,
        ex.span,
      )
  }
}

/**
 * Writes `data`, creating parent directories as needed, and records the
 * artifact (byte length via UTF-8 for text, buffer length for binary).
 *
 * A build that would write the **same path twice** is an error, not a silent overwrite: two format
 * lines can genuinely collide (`png 8x8 16x16` — every explicit size lands on `<base>.png`; `svg`
 * plus `path` — both land on `<base>.svg`), and the symptom is one missing artifact that the
 * artifact list still claims to have produced.
 */
const write = (
  path: string,
  data: Uint8Array | string,
  out: BuiltArtifact[],
  at: { readonly file: string; readonly span: TextSpan },
): void => {
  if (out.some((a) => a.path === path)) {
    throw error(
      ERROR_CODE.exportError,
      `two export format lines both write '${path}'`,
      at.file,
      at.span,
      'give them separate export blocks (each with its own path), or drop one of the formats',
    )
  }
  mkdirSync(dirname(path), { recursive: true })
  if (typeof data === 'string') {
    writeFileSync(path, data, 'utf8')
  } else {
    writeFileSync(path, data)
  }
  out.push({ path, bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.length })
}

/**
 * Deterministic indexed-PNG palette order (spec §13, ADR-0055): transparent
 * first if the render contains it, then the sprite's authored/stamped
 * palette entries that are actually rendered (in artifact order), then any
 * remaining rendered colors in scanline order (top-to-bottom,
 * left-to-right). Throws `E018` (`exportError`) past 256 entries — the hard
 * PNG indexed-color limit.
 */
const indexedPalette = (sprite: Sprite, mod: ModuleRecord, line: FormatLine): Color[] => {
  const pal: Color[] = []
  const seen = new Set<string>()
  const rendered = new Set<string>()
  const colorKey = (c: Color): string => `${c.r},${c.g},${c.b},${c.a}`
  const pixelKey = (i: number): string =>
    `${sprite.data[i]},${sprite.data[i + 1]},${sprite.data[i + 2]},${sprite.data[i + 3]}`
  const add = (c: Color): void => {
    const k = colorKey(c)
    if (seen.has(k)) {
      return
    }
    seen.add(k)
    pal.push(c)
  }
  let transparent: Color | null = null
  for (let i = 0; i < sprite.data.length; i += 4) {
    rendered.add(pixelKey(i))
    if (sprite.data[i + 3] === 0 && !transparent) {
      transparent = {
        type: 'color',
        r: sprite.data[i] ?? 0,
        g: sprite.data[i + 1] ?? 0,
        b: sprite.data[i + 2] ?? 0,
        a: 0,
      }
    }
  }
  if (transparent) {
    add(transparent)
  }
  for (const p of sprite.pal) {
    if (rendered.has(colorKey(p.color))) {
      add(p.color)
    }
  }
  for (let i = 0; i < sprite.data.length; i += 4) {
    add({
      type: 'color',
      r: sprite.data[i] ?? 0,
      g: sprite.data[i + 1] ?? 0,
      b: sprite.data[i + 2] ?? 0,
      a: sprite.data[i + 3] ?? 0,
    })
  }
  if (pal.length > 256) {
    throw error(
      ERROR_CODE.exportError,
      `indexed PNG: tracked palette has ${pal.length} entries (max 256)`,
      mod.displayPath,
      line.span,
    )
  }
  return pal
}

/**
 * Run one export definition; returns the artifacts written. Content is
 * re-rendered per format line (not cached across lines) because a line may
 * carry its own `mode pixel`/`mode smooth` override (§13).
 */
export const runExport = (
  engine: Engine,
  mod: ModuleRecord,
  ex: ExportDefinition,
  outDir: string,
): BuiltArtifact[] => {
  const artifacts: BuiltArtifact[] = []
  const base = join(resolve(outDir), ex.basePath)
  for (const line of ex.formats) {
    // per-line render-mode override (§13)
    const prevMode = engine.modeOverride
    if (line.mode) {
      engine.modeOverride = line.mode
    }
    try {
      const content = renderContent(engine, mod, ex)
      const sprite = content.sprite
      switch (line.format) {
        case 'png': {
          const zl = line.zlib ?? 6
          const fallbackScales = line.sizes.length > 0 ? [] : [1]
          const scales = line.scales.length > 0 ? line.scales : fallbackScales
          for (const s of scales) {
            const suffix = s === 1 ? '' : `@${s}x`
            const data =
              s === 1
                ? sprite.data
                : scaleBitmap(sprite.data, sprite.w, sprite.h, sprite.w * s, sprite.h * s)
            const bytes = line.indexed
              ? encodePngIndexed(
                  data,
                  sprite.w * s,
                  sprite.h * s,
                  indexedPalette({ ...sprite, data }, mod, line),
                  zl,
                )
              : encodePngRgba(data, sprite.w * s, sprite.h * s, zl)
            write(`${base}${suffix}.png`, bytes, artifacts, {
              file: mod.displayPath,
              span: line.span,
            })
          }
          for (const sz of line.sizes) {
            const nw = sz.width
            const nh = sz.height ?? Math.max(1, Math.round((sprite.h * sz.width) / sprite.w))
            const data = scaleBitmap(sprite.data, sprite.w, sprite.h, nw, nh)
            const bytes = line.indexed
              ? encodePngIndexed(
                  data,
                  nw,
                  nh,
                  indexedPalette({ ...sprite, data, w: nw, h: nh }, mod, line),
                  zl,
                )
              : encodePngRgba(data, nw, nh, zl)
            write(`${base}.png`, bytes, artifacts, { file: mod.displayPath, span: line.span })
          }
          break
        }
        case 'svg': {
          const svg = encodeSvg(sprite, {
            ids: line.svgFlags.includes('ids'),
            classes: line.svgFlags.includes('classes'),
            inlineStyles: line.svgFlags.includes('inlineStyles'),
          })
          write(`${base}.svg`, svg, artifacts, { file: mod.displayPath, span: line.span })
          break
        }
        case 'path': {
          if (!content.path) {
            throw error(
              ERROR_CODE.exportError,
              "'path' applies to path definitions only",
              mod.displayPath,
              line.span,
            )
          }
          write(`${base}.svg`, encodePathSvg(content.path), artifacts, {
            file: mod.displayPath,
            span: line.span,
          })
          break
        }
        case 'jpeg': {
          const q = line.quality ?? 80
          let data = sprite.data
          let w = sprite.w
          let h = sprite.h
          const sz = line.sizes[0]
          const sc = line.scales[0]
          if (sz) {
            w = sz.width
            h = sz.height ?? Math.max(1, Math.round((sprite.h * sz.width) / sprite.w))
            data = scaleBitmap(sprite.data, sprite.w, sprite.h, w, h)
          } else if (sc && sc !== 1) {
            w = sprite.w * sc
            h = sprite.h * sc
            data = scaleBitmap(sprite.data, sprite.w, sprite.h, w, h)
          }
          write(`${base}.jpeg`, encodeJpeg(data, w, h, q), artifacts, {
            file: mod.displayPath,
            span: line.span,
          })
          break
        }
        case 'tiled': {
          if (content.kind !== 'tileset' || !content.tileMeta) {
            throw error(
              ERROR_CODE.exportError,
              "'tiled' applies to tilesets only (uniform tiles)",
              mod.displayPath,
              line.span,
            )
          }
          const m = content.tileMeta
          const img = `${ex.basePath.split('/').pop() ?? ex.name}.png`
          const emit = line.tiledXml
            ? tiledTsx(
                ex.name,
                img,
                sprite.w,
                sprite.h,
                m.tileWidth,
                m.tileHeight,
                m.count,
                m.columns,
              )
            : tiledTsj(
                ex.name,
                img,
                sprite.w,
                sprite.h,
                m.tileWidth,
                m.tileHeight,
                m.count,
                m.columns,
              )
          write(`${base}.${line.tiledXml ? 'tsx' : 'tsj'}`, emit, artifacts, {
            file: mod.displayPath,
            span: line.span,
          })
          break
        }
        case 'atlasJson': {
          const frames = content.frames ?? [
            { name: ex.name, x: 0, y: 0, width: sprite.w, height: sprite.h },
          ]
          const img = `${ex.basePath.split('/').pop() ?? ex.name}.png`
          write(`${base}.json`, atlasJson(img, sprite.w, sprite.h, frames), artifacts, {
            file: mod.displayPath,
            span: line.span,
          })
          break
        }
        case 'aseprite': {
          const frames = content.frames ?? [
            { name: ex.name, x: 0, y: 0, width: sprite.w, height: sprite.h },
          ]
          const img = `${ex.basePath.split('/').pop() ?? ex.name}.png`
          write(`${base}.aseprite.json`, asepriteJson(img, sprite.w, sprite.h, frames), artifacts, {
            file: mod.displayPath,
            span: line.span,
          })
          break
        }
        default:
          break
      }
    } finally {
      engine.modeOverride = prevMode
    }
  }
  return artifacts
}

/** One export path segment: one or more letters/digits/`_`/`-` — no dots, no empty run. */
const isPlainSegment = (s: string): boolean => /^[A-Za-z0-9_-]+$/.test(s)

/**
 * Validates an export `basePath` against the recipe-relative grammar (ADR-0096 §6):
 * `SEGMENT { "/" SEGMENT }` — no leading `/`, no `.`/`..` segment, no file extension (the format
 * line appends the real one). `build` defaults `--out` to the recipe's own directory and an export
 * path is relative to that, so a path escaping upward or spelling out an extension is always an
 * authoring mistake, not a legitimate destination. Tightened here (reached by `check`'s deep
 * validation via {@link validateExport}) rather than in the parser's `#parsePath`, which is shared
 * with `from`/`use` module paths that legitimately use `..` and dots.
 */
export const validateExportPath = (path: string, mod: ModuleRecord, span: TextSpan): void => {
  const segments = path.split('/')
  if (path.startsWith('/') || segments.some((s) => s === '.' || s === '..')) {
    throw error(
      ERROR_CODE.exportError,
      `export path '${path}' escapes the output directory`,
      mod.displayPath,
      span,
    )
  }
  if (segments.some((s) => s.includes('.'))) {
    throw error(
      ERROR_CODE.exportError,
      `export path '${path}' must not carry a file extension — the format line appends it`,
      mod.displayPath,
      span,
    )
  }
  if (!segments.every(isPlainSegment)) {
    throw error(
      ERROR_CODE.exportError,
      `export path '${path}' must be one or more '/'-separated segments (letters, digits, '_', '-')`,
      mod.displayPath,
      span,
    )
  }
}

/**
 * Dry-run counterpart to {@link runExport}: renders and checks every format
 * line's constraints (indexed-palette size, `tiled`/`path` applicability)
 * without writing anything. Used by `check`'s deep validation pass so export
 * errors surface before `build` runs.
 */
export const validateExport = (engine: Engine, mod: ModuleRecord, ex: ExportDefinition): void => {
  validateExportPath(ex.basePath, mod, ex.span)
  for (const line of ex.formats) {
    const prevMode = engine.modeOverride
    if (line.mode) {
      engine.modeOverride = line.mode
    }
    try {
      const content = renderContent(engine, mod, ex)
      if (line.format === 'png' && line.indexed) {
        indexedPalette(content.sprite, mod, line)
      }
      if (line.format === 'tiled' && (content.kind !== 'tileset' || !content.tileMeta)) {
        throw error(
          ERROR_CODE.exportError,
          "'tiled' applies to tilesets only (uniform tiles)",
          mod.displayPath,
          line.span,
        )
      }
      if (line.format === 'path' && !content.path) {
        throw error(
          ERROR_CODE.exportError,
          "'path' applies to path definitions only",
          mod.displayPath,
          line.span,
        )
      }
    } finally {
      engine.modeOverride = prevMode
    }
  }
}

/** Run every export in the module; backs `drawstic build`. */
export const buildModule = (engine: Engine, mod: ModuleRecord, outDir: string): BuiltArtifact[] => {
  const out: BuiltArtifact[] = []
  for (const ex of mod.exports) {
    out.push(...runExport(engine, mod, ex, outDir))
  }
  return out
}
