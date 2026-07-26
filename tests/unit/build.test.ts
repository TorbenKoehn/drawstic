// build.ts: `runExport`/`validateExport`/`buildModule` — every export format ×
// flag combination, content-kind resolution, and the indexed-palette limit.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExportDefinition } from '../../src/ast.js'
import { buildModule, runExport, validateExport } from '../../src/build.js'
import { DrawsticError } from '../../src/diagnostic.js'
import type { ModuleRecord } from '../../src/eval.js'
import { Engine } from '../../src/eval.js'
import { decodePng, encodePngRgba } from '../../src/png.js'

let n = 0
const load = (src: string): { engine: Engine; mod: ModuleRecord } => {
  const engine = new Engine(process.cwd())
  const file = join(process.cwd(), `mem-build-${n++}.drw`)
  const mod = engine.loadSource(src, file, 'mem-build.drw')
  return { engine, mod }
}

/** find one export statement by its base path (slash-normalized) — several
 *  export blocks below share a content `name`, so lookup can't go by name. */
const exportAt = (mod: ModuleRecord, basePath: string): ExportDefinition => {
  const ex = mod.exports.find((e) => e.basePath.replace(/\\/g, '/') === basePath)
  if (!ex) {
    throw new Error(`no export with basePath '${basePath}'`)
  }
  return ex
}

const plteColors = (bytes: Uint8Array): number[][] => {
  const out: number[][] = []
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let pos = 8
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos)
    const type = String.fromCodePoint(
      bytes[pos + 4] ?? 0,
      bytes[pos + 5] ?? 0,
      bytes[pos + 6] ?? 0,
      bytes[pos + 7] ?? 0,
    )
    if (type === 'PLTE') {
      for (let i = pos + 8; i < pos + 8 + len; i += 3) {
        out.push([bytes[i] ?? 0, bytes[i + 1] ?? 0, bytes[i + 2] ?? 0])
      }
      return out
    }
    pos += 12 + len
  }
  return out
}

/** walks JFIF marker segments to the SOF0 frame header and reads width/height
 *  — this codebase has no JPEG decoder, so this is the only way to verify a
 *  resize actually happened. */
const jpegDimensions = (bytes: Uint8Array): { width: number; height: number } => {
  let i = 2 // past SOI (FFD8)
  while (i + 3 < bytes.length) {
    const marker = bytes[i + 1] ?? 0
    if (marker === 0xc0) {
      const height = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0)
      const width = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0)
      return { width, height }
    }
    const len = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0)
    i += 2 + len
  }
  throw new Error('no SOF0 marker found')
}

const px = (
  data: Uint8Array,
  w: number,
  x: number,
  y: number,
): [number, number, number, number] => {
  const i = (y * w + x) * 4
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0]
}

const CONTENT_SRC = `draw solid 4x4:
  bg rgb(200, 40, 40)

draw wide 4x2:
  bg rgb(80, 80, 200)

draw partial 4x4:
  px rgb(10, 20, 30) 0:0
  px rgb(40, 50, 60) 1:1

draw swatch 3x1:
  pal:
    a, b, c = #777.tones(-10%, 0%, 10%)
  pixels:
    abc

draw tileA 2x2:
  bg rgb(255, 0, 0)

draw tileB 2x2:
  bg rgb(0, 255, 0)

tileset tiny 2x2:
  tiles tileA, tileB

draw hudA 2x2:
  bg rgb(10, 10, 200)

draw hudB 3x2:
  bg rgb(200, 10, 10)

atlas hud:
  sprites hudA, hudB
  pad 1

path frame 4x4:
  move 0:0
  line rel 3:0
  line rel 0:3
  line rel -3:0
  close

export solid out/solid-scales:
  png @1 @2 z9

export solid out/solid-bare:
  png

export solid out/solid-svg-plain:
  svg

export swatch out/ramp-svg-flags:
  svg ids classes inlineStyles

export solid out/solid-svg-mode:
  svg mode smooth

export solid out/solid-jpeg-plain:
  jpeg

export solid out/solid-jpeg-size:
  jpeg 3x3 q50

export solid out/solid-jpeg-scale:
  jpeg @2

export wide out/wide-size-w:
  png @2

export wide out/wide-size-wh-indexed:
  png 8x8 indexed

export wide out/wide-scale-indexed:
  png indexed @2

export partial out/partial-indexed:
  png indexed

export swatch out/ramp-indexed:
  png indexed

export tiny out/tiny:
  png
  tiled
  atlasJson
  aseprite

export tiny out/tiny-xml:
  tiled xml

export hud out/hud:
  png
  atlasJson
  aseprite

export frame out/frame-path:
  path

export frame out/frame-png:
  png

export solid out/solid-atlas-fallback:
  atlasJson

export solid out/solid-aseprite-fallback:
  aseprite
`

describe('buildModule — png scale/size × indexed combinations', () => {
  test('scale flags: @1 unscaled, @2 nearest-neighbor doubled, explicit zlib', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const artifacts = buildModule(engine, mod, out)
      const p1 = decodePng(new Uint8Array(readFileSync(join(out, 'out', 'solid-scales.png'))))
      const p2 = decodePng(new Uint8Array(readFileSync(join(out, 'out', 'solid-scales@2x.png'))))
      expect(p1.w).toBe(4)
      expect(p1.h).toBe(4)
      expect(p2.w).toBe(8)
      expect(p2.h).toBe(8)
      expect(px(p1.data, 4, 0, 0)).toEqual([200, 40, 40, 255])
      expect(px(p2.data, 8, 0, 0)).toEqual([200, 40, 40, 255])
      // write() records the exact byte length it wrote to disk
      const a1 = artifacts.find((a) => a.path.replace(/\\/g, '/').endsWith('out/solid-scales.png'))
      expect(a1?.bytes).toBe(readFileSync(join(out, 'out', 'solid-scales.png')).length)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('bare png: default scale [1], default zlib', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const p = decodePng(new Uint8Array(readFileSync(join(out, 'out', 'solid-bare.png'))))
      expect(p.w).toBe(4)
      expect(p.h).toBe(4)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('@N scale factor on a non-square drawing preserves aspect ratio', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const p = decodePng(new Uint8Array(readFileSync(join(out, 'out', 'wide-size-w@2x.png'))))
      expect(p.w).toBe(8)
      expect(p.h).toBe(4) // wide is 4x2; @2 scales both dims 2x -> 8x4
      expect(px(p.data, 8, 0, 0)).toEqual([80, 80, 200, 255])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('explicit WxH size + indexed: single-color palette at the resized dims', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const bytes = new Uint8Array(readFileSync(join(out, 'out', 'wide-size-wh-indexed.png')))
      const p = decodePng(bytes)
      expect(p.w).toBe(8)
      expect(p.h).toBe(8)
      expect(plteColors(bytes)).toEqual([[80, 80, 200]])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('scale + indexed: palette tracks scaled pixel data', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const bytes = new Uint8Array(readFileSync(join(out, 'out', 'wide-scale-indexed@2x.png')))
      const p = decodePng(bytes)
      expect(p.w).toBe(8)
      expect(p.h).toBe(4)
      expect(plteColors(bytes)).toEqual([[80, 80, 200]])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('indexed palette: transparent pixel first, then remaining rendered colors', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const bytes = new Uint8Array(readFileSync(join(out, 'out', 'partial-indexed.png')))
      const decoded = decodePng(bytes)
      expect(plteColors(bytes)).toEqual([
        [0, 0, 0],
        [10, 20, 30],
        [40, 50, 60],
      ])
      expect(px(decoded.data, 4, 0, 0)).toEqual([10, 20, 30, 255])
      expect(px(decoded.data, 4, 1, 1)).toEqual([40, 50, 60, 255])
      expect(px(decoded.data, 4, 2, 2)).toEqual([0, 0, 0, 0]) // untouched -> transparent
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('indexed palette: authored pal order wins over scanline order', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const bytes = new Uint8Array(readFileSync(join(out, 'out', 'ramp-indexed.png')))
      const palette = plteColors(bytes)
      expect(palette.length).toBe(3)
      expect(palette[0]?.[0]).toBeLessThan(palette[1]?.[0] ?? 0)
      expect(palette[1]?.[0]).toBeLessThan(palette[2]?.[0] ?? 0)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

describe('buildModule — svg / jpeg / path formats', () => {
  test('svg: bare line has no ids/classes/inline styles', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const svg = readFileSync(join(out, 'out', 'solid-svg-plain.svg'), 'utf8')
      expect(svg).toContain('<svg')
      expect(svg).toContain('<rect')
      expect(svg).not.toContain('id="px-')
      expect(svg).not.toContain('class="')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('svg: ids + classes + inlineStyles flags all apply', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const svg = readFileSync(join(out, 'out', 'ramp-svg-flags.svg'), 'utf8')
      expect(svg).toContain('id="px-0"')
      expect(svg).toContain('<style>')
      expect(svg).toContain('class="c-a"')
      expect(svg).toContain('class="c-b"')
      expect(svg).toContain('class="c-c"')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('svg: per-line mode override renders and restores engine.modeOverride', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      expect(engine.modeOverride).toBeNull()
      buildModule(engine, mod, out)
      expect(engine.modeOverride).toBeNull()
      expect(readFileSync(join(out, 'out', 'solid-svg-mode.svg'), 'utf8')).toContain('<svg')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('jpeg: plain, explicit size, and scale all produce a valid, correctly sized JFIF', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const plain = new Uint8Array(readFileSync(join(out, 'out', 'solid-jpeg-plain.jpeg')))
      const sized = new Uint8Array(readFileSync(join(out, 'out', 'solid-jpeg-size.jpeg')))
      const scaled = new Uint8Array(readFileSync(join(out, 'out', 'solid-jpeg-scale.jpeg')))
      for (const bytes of [plain, sized, scaled]) {
        expect(bytes[0]).toBe(0xff)
        expect(bytes[1]).toBe(0xd8)
      }
      expect(jpegDimensions(plain)).toEqual({ width: 4, height: 4 })
      expect(jpegDimensions(sized)).toEqual({ width: 3, height: 3 })
      expect(jpegDimensions(scaled)).toEqual({ width: 8, height: 8 })
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('path content: `path` line writes geometry SVG sized to the viewBox', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const svg = readFileSync(join(out, 'out', 'frame-path.svg'), 'utf8')
      expect(svg).toContain('viewBox="0 0 4 4"')
      expect(svg).toContain('<path d="M0 0 L3 0 L3 3 L0 3 Z" fill="currentColor"')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('path content: `png` line renders a blank transparent bitmap at viewBox size', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const p = decodePng(new Uint8Array(readFileSync(join(out, 'out', 'frame-png.png'))))
      expect(p.w).toBe(4)
      expect(p.h).toBe(4)
      expect(px(p.data, 4, 0, 0)).toEqual([0, 0, 0, 0])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

describe('buildModule — tileset/atlas sidecars (tiled, atlasJson, aseprite)', () => {
  test('tileset content: png sheet + tiled .tsj', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const p = decodePng(new Uint8Array(readFileSync(join(out, 'out', 'tiny.png'))))
      expect(p.w).toBe(4)
      expect(p.h).toBe(2)
      expect(px(p.data, 4, 0, 0)).toEqual([255, 0, 0, 255])
      expect(px(p.data, 4, 2, 0)).toEqual([0, 255, 0, 255])
      const tsj = JSON.parse(readFileSync(join(out, 'out', 'tiny.tsj'), 'utf8'))
      expect(tsj).toEqual({
        columns: 2,
        image: 'tiny.png',
        imageheight: 2,
        imagewidth: 4,
        margin: 0,
        name: 'tiny',
        spacing: 0,
        tilecount: 2,
        tileheight: 2,
        tilewidth: 2,
        type: 'tileset',
        version: '1.10',
      })
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('tileset content: tiled xml flag writes .tsx instead of .tsj', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const tsx = readFileSync(join(out, 'out', 'tiny-xml.tsx'), 'utf8')
      expect(tsx).toContain('<?xml version="1.0" encoding="UTF-8"?>')
      expect(tsx).toContain(
        '<tileset version="1.10" name="tiny" tilewidth="2" tileheight="2" tilecount="2" columns="2">',
      )
      expect(tsx).toContain('<image source="tiny-xml.png" width="4" height="2"/>')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('tileset content: atlasJson/aseprite use the real per-tile frame map', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const atlas = JSON.parse(readFileSync(join(out, 'out', 'tiny.json'), 'utf8'))
      expect(atlas.frames.tileA.frame).toEqual({ x: 0, y: 0, w: 2, h: 2 })
      expect(atlas.frames.tileB.frame).toEqual({ x: 2, y: 0, w: 2, h: 2 })
      const ase = JSON.parse(readFileSync(join(out, 'out', 'tiny.aseprite.json'), 'utf8'))
      expect(ase.frames.tileA.duration).toBe(100)
      expect(ase.meta.app).toBe('drawstic')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('atlas content: png packed sheet + atlasJson/aseprite frame maps', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      expect(readFileSync(join(out, 'out', 'hud.png'))).toBeDefined()
      const atlas = JSON.parse(readFileSync(join(out, 'out', 'hud.json'), 'utf8'))
      expect(atlas.frames.hudA.frame).toMatchObject({ w: 2, h: 2 })
      expect(atlas.frames.hudB.frame).toMatchObject({ w: 3, h: 2 })
      const ase = JSON.parse(readFileSync(join(out, 'out', 'hud.aseprite.json'), 'utf8'))
      expect(ase.frames.hudA.duration).toBe(100)
      expect(ase.frames.hudB.duration).toBe(100)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('draw content (no frames): atlasJson/aseprite fall back to one whole-sprite frame', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      buildModule(engine, mod, out)
      const atlas = JSON.parse(readFileSync(join(out, 'out', 'solid-atlas-fallback.json'), 'utf8'))
      expect(atlas.frames.solid.frame).toEqual({ x: 0, y: 0, w: 4, h: 4 })
      const ase = JSON.parse(
        readFileSync(join(out, 'out', 'solid-aseprite-fallback.aseprite.json'), 'utf8'),
      )
      expect(ase.frames.solid).toMatchObject({ duration: 100 })
      expect(ase.frames.solid.frame).toEqual({ x: 0, y: 0, w: 4, h: 4 })
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

describe('runExport / content resolution — failures', () => {
  const ERROR_SRC = `export ghost out/ghost:
  png

fn triple(x) = x * 3

export triple out/triple:
  png

draw solid 2x2:
  bg #ff0000

export solid out/solid-tiled-fail:
  tiled

export solid out/solid-path-fail:
  path

draw manyColors 17x17:
  for x 0..17:
    for y 0..17:
      px rgb(x*15, y*15, 0) x:y

export manyColors out/many:
  png indexed
`

  test('unknown export content name is E018', () => {
    const { engine, mod } = load(ERROR_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const ex = exportAt(mod, 'out/ghost')
      expect(() => runExport(engine, mod, ex, out)).toThrow(
        /export references unknown content 'ghost'/,
      )
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('non-exportable content (a function) is E018 with a positioned diagnostic', () => {
    const { engine, mod } = load(ERROR_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const ex = exportAt(mod, 'out/triple')
      try {
        runExport(engine, mod, ex, out)
        expect(false).toBe(true)
      } catch (e) {
        expect(e).toBeInstanceOf(DrawsticError)
        if (e instanceof DrawsticError) {
          expect(e.toDiagnostic()).toMatchObject({
            code: 'E018',
            message: "'triple' is not exportable content (a draw, path, tileset, or atlas)",
          })
        }
      }
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test("'tiled' on non-tileset content fails in both runExport and validateExport", () => {
    const { engine, mod } = load(ERROR_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const ex = exportAt(mod, 'out/solid-tiled-fail')
      expect(() => runExport(engine, mod, ex, out)).toThrow(
        /'tiled' applies to tilesets only \(uniform tiles\)/,
      )
      expect(() => validateExport(engine, mod, ex)).toThrow(
        /'tiled' applies to tilesets only \(uniform tiles\)/,
      )
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test("'path' on non-path content fails in both runExport and validateExport", () => {
    const { engine, mod } = load(ERROR_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const ex = exportAt(mod, 'out/solid-path-fail')
      expect(() => runExport(engine, mod, ex, out)).toThrow(
        /'path' applies to path definitions only/,
      )
      expect(() => validateExport(engine, mod, ex)).toThrow(
        /'path' applies to path definitions only/,
      )
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('indexed PNG past 256 tracked colors is E018 in both runExport and validateExport', () => {
    const { engine, mod } = load(ERROR_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const ex = exportAt(mod, 'out/many')
      const matcher = /indexed PNG: tracked palette has 289 entries \(max 256\)/
      expect(() => runExport(engine, mod, ex, out)).toThrow(matcher)
      expect(() => validateExport(engine, mod, ex)).toThrow(matcher)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

describe('validateExport — success paths', () => {
  test('validates every line of a well-formed export without writing anything', () => {
    const { engine, mod } = load(CONTENT_SRC)
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      expect(() => validateExport(engine, mod, exportAt(mod, 'out/solid-svg-mode'))).not.toThrow()
      expect(engine.modeOverride).toBeNull()
      expect(() =>
        validateExport(engine, mod, exportAt(mod, 'out/wide-size-wh-indexed')),
      ).not.toThrow()
      expect(() => validateExport(engine, mod, exportAt(mod, 'out/tiny'))).not.toThrow()
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})

describe('buildModule — imported image content', () => {
  test('an `import`ed PNG exports byte-identical through the image content kind', () => {
    const srcDir = mkdtempSync(join(tmpdir(), 'drawstic-'))
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const w = 3
      const h = 2
      const data = new Uint8Array([
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255, 10, 20,
        30, 128,
      ])
      writeFileSync(join(srcDir, 'image.png'), encodePngRgba(data, w, h))
      writeFileSync(
        join(srcDir, 'mod.drw'),
        'import img = image.png\n\nexport img out/img:\n  png\n',
      )
      const engine = new Engine(srcDir)
      const mod = engine.loadEntry(join(srcDir, 'mod.drw'))
      const artifacts = buildModule(engine, mod, out)
      expect(artifacts).toHaveLength(1)
      const decoded = decodePng(new Uint8Array(readFileSync(join(out, 'out', 'img.png'))))
      expect(decoded.w).toBe(w)
      expect(decoded.h).toBe(h)
      expect(Buffer.from(decoded.data).equals(Buffer.from(data))).toBe(true)
    } finally {
      rmSync(srcDir, { recursive: true, force: true })
      rmSync(out, { recursive: true, force: true })
    }
  })
})
