// End-to-end: full pipeline from .drw source through lexer → parser →
// evaluator → rasterizer → PNG encoder, decoded back and pixel-asserted.

import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildModule } from '../../src/build.js'
import { Engine } from '../../src/eval.js'
import { decodePng, encodePngRgba } from '../../src/png.js'
import { spriteToAscii } from '../../src/preview.js'
import { encodeSvg } from '../../src/svg.js'
import type { Sprite } from '../../src/values.js'

const indexedPaletteRgb = (bytes: Uint8Array): number[][] => {
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

const cli = (
  ...args: string[]
): { readonly exitCode: number; readonly json: unknown; readonly stdout: string } => {
  const proc = Bun.spawnSync({
    cmd: ['bun', 'run', 'src/cli.ts', ...args],
    cwd: process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new TextDecoder().decode(proc.stdout)
  return { exitCode: proc.exitCode, json: stdout ? JSON.parse(stdout) : null, stdout }
}

const spriteStats = (
  sprite: Sprite,
): {
  readonly distinctOpaqueColorCount: number
  readonly coverageBBox: { readonly width: number; readonly height: number } | null
} => {
  const colors = new Set<string>()
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (let y = 0; y < sprite.h; y++) {
    for (let x = 0; x < sprite.w; x++) {
      const i = (y * sprite.w + x) * 4
      const a = sprite.data[i + 3] ?? 0
      if (a === 0) {
        continue
      }
      colors.add(`${sprite.data[i]},${sprite.data[i + 1]},${sprite.data[i + 2]},${a}`)
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  return {
    distinctOpaqueColorCount: colors.size,
    coverageBBox:
      x0 === Number.POSITIVE_INFINITY ? null : { width: x1 - x0 + 1, height: y1 - y0 + 1 },
  }
}

describe('e2e', () => {
  test('showcase module renders a full PNG end-to-end', () => {
    const engine = new Engine(process.cwd())
    const mod = engine.loadEntry('examples/showcase/showcase.drw')
    const entry = mod.definitions.get('scene')
    expect(entry).toBeDefined()
    if (!entry) {
      return
    }
    const sprite = engine.defToSprite(entry, { line: 1, column: 1 })
    expect(sprite.w).toBe(32)
    expect(sprite.h).toBe(24)
    const png = encodePngRgba(sprite.data, sprite.w, sprite.h)
    const decoded = decodePng(png)
    expect(decoded.w).toBe(32)
    expect(decoded.h).toBe(24)
    expect(Buffer.from(decoded.data).equals(Buffer.from(sprite.data))).toBe(true)
    // the ground rect is theme black
    const i = (20 * 32 + 10) * 4
    expect([decoded.data[i], decoded.data[i + 1], decoded.data[i + 2]]).toEqual([26, 26, 26])
  })

  test('renders are deterministic across engines', () => {
    const render = (): Uint8Array => {
      const engine = new Engine(process.cwd())
      const mod = engine.loadEntry('examples/showcase/showcase.drw')
      const entry = mod.definitions.get('scene')
      if (!entry) {
        throw new Error('no scene')
      }
      return engine.defToSprite(entry, { line: 1, column: 1 }).data
    }
    expect(Buffer.from(render()).equals(Buffer.from(render()))).toBe(true)
  })

  test('build writes every export artifact', () => {
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const engine = new Engine(process.cwd())
      const mod = engine.loadEntry('examples/showcase/showcase.drw')
      const artifacts = buildModule(engine, mod, out)
      const names = artifacts.map((a) => a.path.replace(/\\/g, '/').split('/').slice(-1)[0])
      expect(names).toContain('scene.png')
      expect(names).toContain('scene@2x.png')
      expect(names).toContain('scene.svg')
      expect(names).toContain('scene.jpeg')
      expect(names).toContain('badge.png')
      expect(names).toContain('stripes.png')
      // decoded @2x is exactly 2x NN
      const p1 = decodePng(new Uint8Array(readFileSync(join(out, 'scene.png'))))
      const p2 = decodePng(new Uint8Array(readFileSync(join(out, 'scene@2x.png'))))
      expect(p2.w).toBe(p1.w * 2)
      // svg + jpeg exist and are non-trivial
      expect(readFileSync(join(out, 'scene.svg'), 'utf8')).toContain('<svg')
      const jpeg = readFileSync(join(out, 'scene.jpeg'))
      expect(jpeg[0]).toBe(0xff)
      expect(jpeg[1]).toBe(0xd8)
      // indexed badge decodes to the same pixels as an RGBA render
      expect(existsSync(join(out, 'badge.png'))).toBe(true)
      const badge = decodePng(new Uint8Array(readFileSync(join(out, 'badge.png'))))
      const entry = mod.definitions.get('badge')
      if (!entry) {
        throw new Error('no badge')
      }
      const direct = engine.defToSprite(entry, { line: 1, column: 1 })
      expect(Buffer.from(badge.data).equals(Buffer.from(direct.data))).toBe(true)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('basic-shapes examples build', () => {
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const engine = new Engine(process.cwd())
      const mod = engine.loadEntry('examples/basic-shapes/circles.drw')
      const artifacts = buildModule(engine, mod, out)
      expect(artifacts.length).toBe(4) // circleIcon: @1 @2 png + svg; circles: png
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('indexed exports track rendered colors without an authored palette', () => {
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const engine = new Engine(process.cwd())
      const mod = engine.loadSource(
        'draw auto 3x2:\n  bg #ffffff\n  px #000000 1:0\n  px #c04040 2:1\n\nexport auto out/auto:\n  png indexed\n',
        join(process.cwd(), 'mem-indexed-auto.drw'),
        'mem-indexed-auto.drw',
      )
      buildModule(engine, mod, out)
      const png = new Uint8Array(readFileSync(join(out, 'out', 'auto.png')))
      const decoded = decodePng(png)
      const entry = mod.definitions.get('auto')
      if (!entry) {
        throw new Error('no auto')
      }
      const direct = engine.defToSprite(entry, { line: 1, column: 1 })
      expect(Buffer.from(decoded.data).equals(Buffer.from(direct.data))).toBe(true)
      expect(indexedPaletteRgb(png)).toEqual([
        [255, 255, 255],
        [0, 0, 0],
        [192, 64, 64],
      ])
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('indexed exports preserve destructured palette order', () => {
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const engine = new Engine(process.cwd())
      const mod = engine.loadSource(
        'draw swatch:\n  palette:\n    a, b, c = #777.tones(-10%, 0%, 10%)\n  pixels:\n    abc\n\nexport swatch out/ramp:\n  png indexed\n',
        join(process.cwd(), 'mem-indexed-ramp.drw'),
        'mem-indexed-ramp.drw',
      )
      buildModule(engine, mod, out)
      const png = new Uint8Array(readFileSync(join(out, 'out', 'ramp.png')))
      const palette = indexedPaletteRgb(png)
      expect(palette.length).toBe(3)
      expect(palette[0]?.[0]).toBeLessThan(palette[1]?.[0] ?? 0)
      expect(palette[1]?.[0]).toBeLessThan(palette[2]?.[0] ?? 0)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  test('ascii preview uses grayscale approximation without palette keys', () => {
    const engine = new Engine(process.cwd())
    const mod = engine.loadSource(
      'draw bars 4x1:\n  px #000000 0:0\n  px #777777 1:0\n  px #ffffff 2:0\n  px #ff0000 3:0\n',
      join(process.cwd(), 'mem-e2e.drw'),
      'mem-e2e.drw',
    )
    const entry = mod.definitions.get('bars')
    if (!entry) {
      throw new Error('no bars')
    }
    const sprite = engine.defToSprite(entry, { line: 1, column: 1 })
    const ascii = spriteToAscii(sprite)
    expect(ascii).not.toContain('?')
    expect(ascii).not.toContain('r')
    expect(ascii.length).toBe(5)
  })

  test('std shapes expose generic marks', () => {
    const s = (() => {
      const engine = new Engine(process.cwd())
      const mod = engine.loadSource(
        'from std/shapes spark, dash, leaf, tri\n\ndraw d 24x8:\n  stamp spark(#ffffff) 0:0\n  stamp dash(#000000) 6:2\n  stamp leaf(#00aa00) 12:2\n  stamp tri(#ff0000) 19:2\n',
        join(process.cwd(), 'mem-std-marks.drw'),
        'mem-std-marks.drw',
      )
      const entry = mod.definitions.get('d')
      if (!entry) {
        throw new Error('no d')
      }
      return engine.defToSprite(entry, { line: 1, column: 1 })
    })()
    const stats = spriteStats(s)
    expect(stats.distinctOpaqueColorCount).toBe(4)
    expect(stats.coverageBBox?.width).toBeGreaterThan(20)
  })

  test('render preview/ascii/inspect success is JSON-addressable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-'))
    const file = join(dir, 'cli.drw')
    try {
      writeFileSync(
        file,
        'draw big 20x10:\n  bg #ffffff\n  rect #000000 2:2 17:7 fill\n\nexport big out/big:\n  png @2\n',
      )
      const ascii = cli('render', `${file}#big`, '--ascii', '--json', '--crop', '0:0', '10x5')
        .json as {
        render: { width: number; height: number; kind: string; crop: { width: number } }
      }
      expect(ascii.render.kind).toBe('ascii')
      expect(ascii.render.width).toBe(10)
      expect(ascii.render.height).toBe(5)
      expect(ascii.render.crop.width).toBe(10)

      const preview = cli('render', `${file}#big`, '--preview', '--json', '--fit', '5x5').json as {
        render: {
          width: number
          height: number
          fit: { fitted: boolean }
          stats: { unknownColorCount: number }
        }
      }
      expect(preview.render.width).toBeLessThanOrEqual(5)
      expect(preview.render.height).toBeLessThanOrEqual(5)
      expect(preview.render.fit.fitted).toBe(true)
      expect(preview.render.stats.unknownColorCount).toBeGreaterThanOrEqual(0)

      const inspect = cli('render', `${file}#big`, '--inspect', '--json').json as {
        render: {
          kind: string
          inspect: { distinctColorCount: number; alphaCoverageBBox: { width: number } }
        }
      }
      expect(inspect.render.kind).toBe('inspect')
      expect(inspect.render.inspect.distinctColorCount).toBe(2)
      expect(inspect.render.inspect.alphaCoverageBBox.width).toBe(20)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('render target errors are actionable JSON diagnostics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-'))
    const file = join(dir, 'cli.drw')
    try {
      writeFileSync(file, 'draw good 1x1:\n  bg #fff\n')
      const malformed = cli('render', file, '--json')
      expect(malformed.exitCode).toBe(1)
      expect((malformed.json as { code: string }[])[0]).toMatchObject({
        code: 'E022',
        hint: 'use <file>#<drawing>',
      })
      const unknown = cli('render', `${file}#godo`, '--json')
      expect(unknown.exitCode).toBe(1)
      expect((unknown.json as { hint: string }[])[0]?.hint).toContain('good')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('check collects independent post-parse diagnostics', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-'))
    const file = join(dir, 'bad.drw')
    try {
      writeFileSync(file, 'draw a 1x1:\n  bg missingA\n\ndraw b 1x1:\n  bg missingB\n')
      const checked = cli('check', file, '--json')
      expect(checked.exitCode).toBe(1)
      const diagnostics = checked.json as { message: string }[]
      expect(diagnostics.map((d) => d.message)).toEqual([
        "unknown name 'missingA'",
        "unknown name 'missingB'",
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('check rows, lint warnings, context exports, and fmt JSON metadata', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-'))
    const file = join(dir, 'cli.drw')
    const fmtFile = join(dir, 'fmt.drw')
    try {
      writeFileSync(
        file,
        'draw part 1x1:\n  bg #000\n\ndraw unused 2x1:\n  palette r=#f00\n  pixels:\n    r.\n\ndraw out 4x4:\n  stamp part 10:10\n\nexport out build/out:\n  png @1 @2\n',
      )
      const check = cli('check', file, '--json', '--rows', '--lint')
      expect(check.exitCode).toBe(0)
      const checkJson = check.json as {
        diagnostics: { severity: string; code: string; message: string }[]
        rows: { draw: string; actualWidths: number[] }[]
      }
      expect(checkJson.rows.find((row) => row.draw === 'unused')?.actualWidths).toEqual([2])
      expect(
        checkJson.diagnostics.some((d) => d.code === 'W002' && d.message.includes('unused')),
      ).toBe(true)
      expect(checkJson.diagnostics.some((d) => d.code === 'W003')).toBe(true)

      const context = cli('context', file, '--json').json as {
        context: {
          exports: { source: string; basePath: string; formats: { scales: number[] }[] }[]
        }
      }
      expect(context.context.exports[0]).toMatchObject({ source: 'out', basePath: 'build/out' })
      expect(context.context.exports[0]?.formats[0]?.scales).toEqual([1, 2])

      writeFileSync(fmtFile, 'draw a 2x2:\n    bg #fff\n')
      const fmt = cli('fmt', fmtFile, '--check', '--json', '--diff')
      expect(fmt.exitCode).toBe(1)
      expect(
        (
          fmt.json as {
            format: { firstChangedLine: number; changedLineCount: number; unifiedDiff: string }
          }
        ).format,
      ).toMatchObject({
        firstChangedLine: 2,
        changedLineCount: 1,
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('smooth mode renders anti-aliased coverage', () => {
    const engine = new Engine(process.cwd())
    engine.modeOverride = 'smooth'
    const mod = engine.loadSource(
      'draw d 16x16:\n  circle #000000 8:8 6 fill\n',
      join(process.cwd(), 'mem-smooth.drw'),
      'mem-smooth.drw',
    )
    const entry = mod.definitions.get('d')
    if (!entry) {
      throw new Error('no d')
    }
    const sprite = engine.defToSprite(entry, { line: 1, column: 1 })
    // some partial-alpha edge pixels exist in smooth mode
    let partial = 0
    for (let i = 3; i < sprite.data.length; i += 4) {
      const a = sprite.data[i] ?? 0
      if (a > 0 && a < 255) {
        partial++
      }
    }
    expect(partial).toBeGreaterThan(0)
  })

  const renderMem = (src: string, name: string, file: string): Sprite => {
    const engine = new Engine(process.cwd())
    const mod = engine.loadSource(src, join(process.cwd(), file), file)
    const entry = mod.definitions.get(name)
    if (!entry) {
      throw new Error(`no ${name}`)
    }
    return engine.defToSprite(entry, { line: 1, column: 1 })
  }

  const partialAlphaCount = (sprite: Sprite): number => {
    let n = 0
    for (let i = 3; i < sprite.data.length; i += 4) {
      const a = sprite.data[i] ?? 0
      if (a > 0 && a < 255) {
        n++
      }
    }
    return n
  }

  test("aa softens a rot45 stamp and the un-aa'd twin stays crisp", () => {
    const part = 'draw part 8x8:\n  bg #808080\n\n'
    const aaSprite = renderMem(
      `${part}draw d 24x24:\n  stamp part 8:8 rot45 aa\n`,
      'd',
      'mem-aa-rot45.drw',
    )
    expect(partialAlphaCount(aaSprite)).toBeGreaterThan(0)
    const nnSprite = renderMem(
      `${part}draw d 24x24:\n  stamp part 8:8 rot45\n`,
      'd',
      'mem-nn-rot45.drw',
    )
    expect(partialAlphaCount(nnSprite)).toBe(0)
  })

  test('aa composes with tint', () => {
    const src =
      'draw part 8x8:\n  bg #808080\n\ndraw d 24x24:\n  stamp part 8:8 rot45 aa tint #0000ff 1.0\n'
    const sprite = renderMem(src, 'd', 'mem-aa-tint.drw')
    const alphas = new Set<number>()
    for (let i = 0; i < sprite.data.length; i += 4) {
      const a = sprite.data[i + 3] ?? 0
      if (a === 0) {
        continue
      }
      alphas.add(a)
      expect(sprite.data[i]).toBe(0)
      expect(sprite.data[i + 1]).toBe(0)
      expect(sprite.data[i + 2]).toBe(255)
    }
    // resample -> tint -> composite: alpha is the resampled coverage, not flattened to one value
    expect(alphas.size).toBeGreaterThan(1)
  })

  test('aa shadow carries the soft contour', () => {
    const src =
      'draw part 8x8:\n  bg #808080\n\ndraw d 24x24:\n  stamp part 8:8 rot37 aa shadow 2:2 #000000ff\n'
    const sprite = renderMem(src, 'd', 'mem-aa-shadow.drw')
    // the shadow tints at amount 1, so its resampled colour collapses to pure black while the
    // resampled alpha carries the AA contour — a partial-alpha black pixel can only come from the
    // shadow layer (the part itself is opaque gray, never black).
    let shadowFringe = 0
    for (let i = 0; i < sprite.data.length; i += 4) {
      const a = sprite.data[i + 3] ?? 0
      if (
        a > 0 &&
        a < 255 &&
        sprite.data[i] === 0 &&
        sprite.data[i + 1] === 0 &&
        sprite.data[i + 2] === 0
      ) {
        shadowFringe++
      }
    }
    expect(shadowFringe).toBeGreaterThan(0)
  })

  test('svg export of an aa stamp emits fill-opacity', () => {
    const src = 'draw part 8x8:\n  bg #808080\n\ndraw d 24x24:\n  stamp part 8:8 rot45 aa\n'
    const sprite = renderMem(src, 'd', 'mem-aa-svg.drw')
    const svg = encodeSvg(sprite, { ids: false, classes: false, inlineStyles: false })
    expect(svg).toContain('fill-opacity="')
  })

  test('island scene render and export smoke', () => {
    const out = mkdtempSync(join(tmpdir(), 'drawstic-'))
    try {
      const engine = new Engine(process.cwd())
      const mod = engine.loadEntry('examples/scenes-v3/island.drw')
      const entry = mod.definitions.get('island')
      if (!entry) {
        throw new Error('no island')
      }
      const sprite = engine.defToSprite(entry, { line: 1, column: 1 })
      expect(sprite.w).toBe(192)
      expect(sprite.h).toBe(128)
      const stats = spriteStats(sprite)
      expect(stats.distinctOpaqueColorCount).toBeGreaterThan(20)
      expect(stats.coverageBBox).toEqual({ width: 192, height: 128 })
      const artifacts = buildModule(engine, mod, out)
      const names = artifacts.map((a) => a.path.replace(/\\/g, '/').split('/').slice(-1)[0])
      expect(names).toContain('island.png')
      expect(names).toContain('island@4x.png')
      const png = decodePng(new Uint8Array(readFileSync(join(out, 'island.png'))))
      expect(png.w).toBe(192)
      expect(png.h).toBe(128)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
