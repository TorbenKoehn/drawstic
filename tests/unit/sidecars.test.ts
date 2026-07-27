// Export sidecars (ADR-0016): pure descriptor builders for Tiled (.tsj/.tsx),
// TexturePacker/Phaser/Pixi atlas JSON, and Aseprite sheet JSON.

import { describe, expect, test } from 'bun:test'
import { asepriteJson, atlasJson, type Frame, tiledTsj, tiledTsx } from '../../src/sidecars.js'

describe('tiledTsj', () => {
  test('builds a Tiled .tsj JSON tileset descriptor', () => {
    const out = tiledTsj('terrain', 'terrain.png', 32, 16, 16, 16, 2, 2, 0)
    expect(out.endsWith('\n')).toBe(true)
    expect(JSON.parse(out)).toEqual({
      columns: 2,
      image: 'terrain.png',
      imageheight: 16,
      imagewidth: 32,
      margin: 0,
      name: 'terrain',
      spacing: 0,
      tilecount: 2,
      tileheight: 16,
      tilewidth: 16,
      type: 'tileset',
      version: '1.10',
    })
  })

  test('reflects a non-square, multi-row grid', () => {
    const out = JSON.parse(tiledTsj('big', 'big.png', 48, 32, 8, 16, 12, 6, 0))
    expect(out).toMatchObject({
      columns: 6,
      imagewidth: 48,
      imageheight: 32,
      tilewidth: 8,
      tileheight: 16,
      tilecount: 12,
    })
  })

  test('spacing reflects the atlas pad (the grid gutter, ADR-0096 §3)', () => {
    const out = JSON.parse(tiledTsj('terrain', 'terrain.png', 34, 16, 16, 16, 2, 2, 1))
    expect(out).toMatchObject({ spacing: 1 })
  })
})

describe('tiledTsx', () => {
  test('builds a Tiled .tsx XML tileset descriptor matching the exact template', () => {
    const out = tiledTsx('terrain', 'terrain.png', 32, 16, 16, 16, 2, 2, 0)
    const expected =
      '<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" name="terrain" tilewidth="16" tileheight="16" tilecount="2" columns="2" spacing="0">\n <image source="terrain.png" width="32" height="16"/>\n</tileset>\n'
    expect(out).toBe(expected)
  })

  test('substitutes every numeric field independently', () => {
    const out = tiledTsx('big', 'big.png', 48, 32, 8, 16, 12, 6, 2)
    expect(out).toContain(
      '<tileset version="1.10" name="big" tilewidth="8" tileheight="16" tilecount="12" columns="6" spacing="2">',
    )
    expect(out).toContain('<image source="big.png" width="48" height="32"/>')
  })
})

describe('atlasJson', () => {
  const frames: Frame[] = [
    { name: 'play', x: 0, y: 0, width: 8, height: 8 },
    { name: 'pause', x: 8, y: 0, width: 8, height: 8 },
  ]

  test('builds a name-keyed frame map with meta image/size/scale', () => {
    const parsed = JSON.parse(atlasJson('hud.png', 16, 8, frames))
    expect(parsed).toEqual({
      frames: {
        play: {
          frame: { x: 0, y: 0, w: 8, h: 8 },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: 8, h: 8 },
          sourceSize: { w: 8, h: 8 },
        },
        pause: {
          frame: { x: 8, y: 0, w: 8, h: 8 },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: 8, h: 8 },
          sourceSize: { w: 8, h: 8 },
        },
      },
      meta: { image: 'hud.png', size: { w: 16, h: 8 }, scale: '1' },
    })
  })

  test('empty frame list still emits a valid, empty frame map', () => {
    const parsed = JSON.parse(atlasJson('empty.png', 4, 4, []))
    expect(parsed.frames).toEqual({})
    expect(parsed.meta).toEqual({ image: 'empty.png', size: { w: 4, h: 4 }, scale: '1' })
  })

  test('later frames with a duplicate name overwrite earlier ones (last wins)', () => {
    const dup: Frame[] = [
      { name: 'a', x: 0, y: 0, width: 1, height: 1 },
      { name: 'a', x: 5, y: 5, width: 2, height: 2 },
    ]
    const parsed = JSON.parse(atlasJson('d.png', 8, 8, dup))
    expect(parsed.frames.a.frame).toEqual({ x: 5, y: 5, w: 2, h: 2 })
  })
})

describe('asepriteJson', () => {
  const frames: Frame[] = [{ name: 'idle0', x: 0, y: 0, width: 4, height: 4 }]

  test('builds an Aseprite sheet descriptor with a fixed 100ms duration per frame', () => {
    const parsed = JSON.parse(asepriteJson('sheet.png', 4, 4, frames))
    expect(parsed).toEqual({
      frames: {
        idle0: {
          frame: { x: 0, y: 0, w: 4, h: 4 },
          rotated: false,
          trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: 4, h: 4 },
          sourceSize: { w: 4, h: 4 },
          duration: 100,
        },
      },
      meta: {
        app: 'drawstic',
        version: '1.0',
        image: 'sheet.png',
        format: 'RGBA8888',
        size: { w: 4, h: 4 },
        scale: '1',
      },
    })
  })

  test('multiple frames each get their own duration entry', () => {
    const many: Frame[] = [
      { name: 'a', x: 0, y: 0, width: 2, height: 2 },
      { name: 'b', x: 2, y: 0, width: 2, height: 2 },
      { name: 'c', x: 4, y: 0, width: 2, height: 2 },
    ]
    const parsed = JSON.parse(asepriteJson('m.png', 6, 2, many))
    expect(Object.keys(parsed.frames)).toEqual(['a', 'b', 'c'])
    for (const name of ['a', 'b', 'c']) {
      expect(parsed.frames[name].duration).toBe(100)
    }
  })
})
