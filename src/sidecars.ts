// Export sidecars (ADR-0016): Tiled (.tsj/.tsx), TexturePacker/Phaser/Pixi
// atlas JSON, Aseprite sheet JSON. File names are fixed so descriptors never
// collide (spec §13).

/** A packed sprite's placement within a sidecar sheet, keyed by tile index or atlas name. */
export type Frame = { name: string; x: number; y: number; width: number; height: number }

/**
 * Tiled `.tsj` (JSON) tileset descriptor for a uniform-grid `atlas` (ADR-0016; the source
 * construct was `tileset` before ADR-0096 §3 merged it into `atlas`). `spacing` is the atlas's
 * `pad` — the grid gutter between tiles, `0` when the atlas declares none.
 */
export const tiledTsj = (
  name: string,
  imageFile: string,
  imgW: number,
  imgH: number,
  tileW: number,
  tileH: number,
  count: number,
  columns: number,
  spacing: number,
): string =>
  `${JSON.stringify(
    {
      columns,
      image: imageFile,
      imageheight: imgH,
      imagewidth: imgW,
      margin: 0,
      name,
      spacing,
      tilecount: count,
      tileheight: tileH,
      tilewidth: tileW,
      type: 'tileset',
      version: '1.10',
    },
    null,
    1,
  )}\n`

/** Tiled `.tsx` (XML) tileset descriptor — same data as tiledTsj, XML form (ADR-0016). */
export const tiledTsx = (
  name: string,
  imageFile: string,
  imgW: number,
  imgH: number,
  tileW: number,
  tileH: number,
  count: number,
  columns: number,
  spacing: number,
): string =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<tileset version="1.10" name="${name}" tilewidth="${tileW}" tileheight="${tileH}" tilecount="${count}" columns="${columns}" spacing="${spacing}">\n <image source="${imageFile}" width="${imgW}" height="${imgH}"/>\n</tileset>\n`

/** TexturePacker/Phaser/Pixi frame-map atlas descriptor, name-addressed (ADR-0016). */
export const atlasJson = (
  imageFile: string,
  imgW: number,
  imgH: number,
  frames: readonly Frame[],
): string => {
  const map: Record<string, unknown> = {}
  for (const f of frames) {
    map[f.name] = {
      frame: { x: f.x, y: f.y, w: f.width, h: f.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.width, h: f.height },
      sourceSize: { w: f.width, h: f.height },
    }
  }
  return `${JSON.stringify(
    { frames: map, meta: { image: imageFile, size: { w: imgW, h: imgH }, scale: '1' } },
    null,
    1,
  )}\n`
}

/**
 * Aseprite sheet JSON descriptor; each frame gets a fixed 100ms `duration` Aseprite requires (ADR-0016).
 */
export const asepriteJson = (
  imageFile: string,
  imgW: number,
  imgH: number,
  frames: readonly Frame[],
): string => {
  const map: Record<string, unknown> = {}
  for (const f of frames) {
    map[f.name] = {
      frame: { x: f.x, y: f.y, w: f.width, h: f.height },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.width, h: f.height },
      sourceSize: { w: f.width, h: f.height },
      duration: 100,
    }
  }
  return `${JSON.stringify(
    {
      frames: map,
      meta: {
        app: 'drawstic',
        version: '1.0',
        image: imageFile,
        format: 'RGBA8888',
        size: { w: imgW, h: imgH },
        scale: '1',
      },
    },
    null,
    1,
  )}\n`
}
