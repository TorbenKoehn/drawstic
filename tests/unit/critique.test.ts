import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli.js'
import {
  buildRubric,
  CRITIQUE_CODE,
  type CritiqueProfile,
  critiqueCheckDiagnostic,
  critiqueFamily,
  critiqueSprite,
  resolveProfile,
  signatureDistance,
  silhouetteSignature,
} from '../../src/critique.js'
import { Engine } from '../../src/eval.js'
import type { Sprite } from '../../src/values.js'

let n = 0
const render = (src: string, drawing: string): Sprite => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, join(process.cwd(), `critique${n++}.drw`), 'mem.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  return engine.defToSprite(entry, { line: 1, column: 1 })
}

const critique = (src: string, drawing: string) => critiqueSprite(drawing, render(src, drawing))
const byCode = <T extends { readonly code: string }>(
  checks: readonly T[],
  code: string,
): T | undefined => checks.find((c) => c.code === code)

/** RGBA of a covered pixel, or `null` for transparent — fed to {@link synthSprite} for precise pixel-geometry fixtures. */
type Px = readonly [number, number, number, number] | null

/** Builds a synthetic sprite from a per-pixel `fill` callback — exact control over the covered mask the geometry checks consume. */
const synthSprite = (
  name: string,
  w: number,
  h: number,
  fill: (x: number, y: number) => Px,
): Sprite => {
  const data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = fill(x, y)
      if (!c) {
        continue
      }
      const i = (y * w + x) * 4
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = c[3]
    }
  }
  return { type: 'sprite', name, w, h, data, pal: [], title: undefined, desc: undefined }
}

const DARK: Px = [32, 32, 32, 255]
const LIGHT: Px = [224, 224, 224, 255]
const character = resolveProfile('character') as CritiqueProfile
const icon = resolveProfile('icon') as CritiqueProfile
const item = resolveProfile('item') as CritiqueProfile
const scene = resolveProfile('scene') as CritiqueProfile

describe('C001 empty / near-empty', () => {
  test('a fully transparent sprite fires C001 with measured 0 and null metrics', () => {
    const d = critique('draw empty 3x3:\n  palette k=#000000\n', 'empty')
    expect(d.bbox).toBeNull()
    expect(d.coveredPixelCount).toBe(0)
    expect(d.luminance).toBeNull()
    const c = byCode(d.checks, CRITIQUE_CODE.empty)
    expect(c).toMatchObject({ code: 'C001', severity: 'warning', measured: 0, threshold: 1 })
    expect(c?.message).toContain('fully transparent')
  })

  test('a tiny subject on a large canvas fires C001 near-empty with the bbox area measured', () => {
    // one pixel at 5:5 on a 10x10 canvas -> bbox area 1, floor = max(4, 2%*100) = 4
    const d = critique('draw tiny 10x10:\n  palette k=#c04040\n  px k 5:5\n', 'tiny')
    expect(d.bbox).toEqual({ x: 5, y: 5, width: 1, height: 1 })
    expect(d.coveredPixelCount).toBe(1)
    const c = byCode(d.checks, CRITIQUE_CODE.empty)
    expect(c).toMatchObject({ code: 'C001', measured: 1, threshold: 4 })
    expect(c?.message).toContain('near-empty')
  })
})

describe('C003 optical centering', () => {
  test('an off-center subject fires C003 with the exact x0/x1/sum/target/offset', () => {
    // block in columns 1..3 of an 8-wide canvas: x0+x1 = 4, target = 7, offset = -3
    const row = '.wkw....'
    const src = `draw off 8x8:\n  palette w=#ffffff  k=#000000\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'off')
    expect(d.bbox).toEqual({ x: 1, y: 0, width: 3, height: 8 })
    const c = byCode(d.checks, CRITIQUE_CODE.centering)
    expect(c).toMatchObject({ code: 'C003', measured: -3, threshold: 2 })
    expect(c?.detail).toEqual({ x0: 1, x1: 3, sum: 4, target: 7, offsetY: 0 })
  })

  test('a centered subject does not fire C003', () => {
    const row = '...ww...'
    const src = `draw mid 8x8:\n  palette w=#ffffff\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'mid')
    expect(byCode(d.checks, CRITIQUE_CODE.centering)).toBeUndefined()
  })
})

describe('C004 value / contrast spread', () => {
  test('a flat single-tone fill fires C004 with spread 0', () => {
    const d = critique('draw flat 8x8:\n  bg #808080\n', 'flat')
    expect(d.coveredPixelCount).toBe(64)
    expect(d.luminance?.spread).toBe(0)
    const c = byCode(d.checks, CRITIQUE_CODE.valueSpread)
    expect(c).toMatchObject({ code: 'C004', measured: 0, threshold: 0.15 })
  })

  test('a two-tone fill with real contrast does not fire C004', () => {
    const row = 'kwkwkwkw'
    const src = `draw duo 8x8:\n  palette k=#202020  w=#e0e0e0\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'duo')
    expect(byCode(d.checks, CRITIQUE_CODE.valueSpread)).toBeUndefined()
    expect((d.luminance?.spread ?? 0) >= 0.15).toBe(true)
  })

  test('the fix names the canonical `spread` dose with a concrete multiplier', () => {
    const d = critique('draw flat 8x8:\n  bg #808080\n', 'flat')
    const c = byCode(d.checks, CRITIQUE_CODE.valueSpread)
    expect(c?.severity).toBe('warning')
    expect(c?.fix).toContain('spread')
    expect(c?.fix).toMatch(/spread \d+%/)
    // never point the agent back at the hand-shading floor the canonical lints forbid
    expect(c?.fix).not.toContain('shadeRegion')
    expect(c?.fix).not.toContain('lightRegion')
  })

  test('a near-black subject demotes C004 to a non-blocking advisory', () => {
    // linear luminance compresses toward black, so the fixed p90−p10 threshold is unreachable
    // there at any sane dose — the number is still reported, it just stops gating `pass`.
    const d = critique('draw dark 8x8:\n  bg #080808\n', 'dark')
    const c = byCode(d.checks, CRITIQUE_CODE.valueSpread)
    expect(c?.code).toBe('C004')
    expect(c?.severity).toBe('info')
    expect(c?.message).toContain('advisory')
  })
})

describe('C008 interior pinholes', () => {
  test('a 1px transparent gap enclosed by paint fires C008 with measured 1', () => {
    const src = [
      'draw hole 5x5:',
      '  palette k=#101010  w=#f0f0f0',
      '  pixels:',
      '    kwkwk',
      '    wkwkw',
      '    kw.wk',
      '    wkwkw',
      '    kwkwk',
      '',
    ].join('\n')
    const d = critique(src, 'hole')
    const c = byCode(d.checks, CRITIQUE_CODE.pinhole)
    expect(c).toMatchObject({ code: 'C008', measured: 1, threshold: 0 })
    // row 2 ("kw.wk") puts the hole at column 2 -> (2,2)
    expect(c?.detail).toEqual({
      largestInteriorHole: 1,
      locationCap: 8,
      locations: [{ x: 2, y: 2 }],
    })
    expect(c?.message).toContain('first at (2,2)')
    expect(c?.fix).toContain('first at (2,2)')
    expect(c?.fix).toContain('render #hole --crop 0:0 5x5')
    // the two-tone body keeps value contrast up, so C008 is isolated here
    expect(byCode(d.checks, CRITIQUE_CODE.valueSpread)).toBeUndefined()
  })

  test('a transparent gap open to the border is not a pinhole', () => {
    const src = [
      'draw notch 5x5:',
      '  palette k=#101010  w=#f0f0f0',
      '  pixels:',
      '    kwkwk',
      '    wkwkw',
      '    kw...',
      '    wkwkw',
      '    kwkwk',
      '',
    ].join('\n')
    const d = critique(src, 'notch')
    expect(byCode(d.checks, CRITIQUE_CODE.pinhole)).toBeUndefined()
  })

  test('several pinholes report a bounded, capped location list plus the true total', () => {
    // 10 separate 1px holes on row y=1, each isolated by a painted pixel on either side, none
    // touching the canvas border -> pinholeCount 10, but detail.locations caps at 8 with the cap
    // stated explicitly (never a silent truncation); the message/fix stay short (first + total).
    const holesX = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]
    const sprite = synthSprite('holes', 21, 3, (x, y) =>
      y === 1 && holesX.includes(x) ? null : DARK,
    )
    const d = critiqueSprite('holes', sprite)
    const c = byCode(d.checks, CRITIQUE_CODE.pinhole)
    expect(c).toMatchObject({ code: 'C008', measured: 10, threshold: 0 })
    expect(c?.detail).toEqual({
      largestInteriorHole: 1,
      locationCap: 8,
      locations: holesX.slice(0, 8).map((x) => ({ x, y: 1 })),
    })
    expect(c?.message).toContain('10 interior pinhole')
    expect(c?.message).toContain('first at (1,1)')
    expect(c?.fix).toContain('10 total, see --json for the rest')
  })
})

describe('C012 dynamic transparent trailing edge row', () => {
  test('content pushed up with an asymmetric bottom gap fires C012', () => {
    // content in rows 0-2 of an 8-tall canvas: leading 0, trailing 5, tol 1 -> excess 5
    const src = [
      'draw pad 8x8:',
      '  palette k=#202020  w=#e0e0e0',
      '  pixels:',
      '    kwkwkwkw',
      '    wkwkwkwk',
      '    kwkwkwkw',
      '    ........',
      '    ........',
      '    ........',
      '    ........',
      '    ........',
      '',
    ].join('\n')
    const d = critique(src, 'pad')
    expect(d.bbox).toEqual({ x: 0, y: 0, width: 8, height: 3 })
    const c = byCode(d.checks, CRITIQUE_CODE.trailingEdgeRow)
    expect(c).toMatchObject({ code: 'C012', measured: 5, threshold: 1 })
    expect(c?.detail).toEqual({ leading: 0, trailing: 5 })
  })

  test('symmetric breathing room (trailing ≈ leading) does not fire C012', () => {
    // content centered vertically in rows 3-4 of an 8-tall canvas: leading 3, trailing 3
    const src = [
      'draw mid 8x8:',
      '  palette w=#e0e0e0',
      '  pixels:',
      '    ........',
      '    ........',
      '    ........',
      '    wwwwwwww',
      '    wwwwwwww',
      '    ........',
      '    ........',
      '    ........',
      '',
    ].join('\n')
    const d = critique(src, 'mid')
    expect(byCode(d.checks, CRITIQUE_CODE.trailingEdgeRow)).toBeUndefined()
  })
})

describe('C006 palette / complexity budget', () => {
  test('a two-tone sprite stays under the generous default ceiling', () => {
    const row = 'kwkwkwkw'
    const src = `draw duo 8x8:\n  palette k=#202020  w=#e0e0e0\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'duo')
    expect(d.distinctColorCount).toBe(2)
    expect(byCode(d.checks, CRITIQUE_CODE.paletteBudget)).toBeUndefined()
  })
})

// A block where every pixel is a distinct opaque colour — a stand-in for a smooth
// normal-`model` sprite (ADR-0089) whose colour count blows past the tight character
// ceiling but is a defect only for an indexed-PNG / SVG target.
const manyColors = (name: string, side: number, step = 5): Sprite =>
  synthSprite(name, side, side, (x, y) => {
    const i = y * side + x
    return [i & 0xff, (i >> 8) & 0xff, (i * step) & 0xff, 255]
  })

describe('C006 export-target-aware palette budget (ADR-0085)', () => {
  test('a budgeted (indexed/SVG) target fires C006 as a pass-blocking warning at the tight ceiling', () => {
    const sprite = manyColors('grad', 20) // 400 distinct colours
    const d = critiqueSprite('grad', sprite, { profile: character, paletteTarget: 'budgeted' })
    expect(d.distinctColorCount).toBe(400)
    const c = byCode(d.checks, CRITIQUE_CODE.paletteBudget)
    expect(c).toMatchObject({
      code: 'C006',
      severity: 'warning',
      measured: 400,
      threshold: character.colorCeiling,
    })
  })

  test('an unbudgeted (RGBA/JPEG) target does not fire C006 under the generous ceiling', () => {
    const sprite = manyColors('grad', 20)
    const d = critiqueSprite('grad', sprite, { profile: character, paletteTarget: 'unbudgeted' })
    expect(byCode(d.checks, CRITIQUE_CODE.paletteBudget)).toBeUndefined()
  })

  test('the default target is unbudgeted (conservative) — omitting paletteTarget never blocks pass on colour count', () => {
    const sprite = manyColors('grad', 20)
    const d = critiqueSprite('grad', sprite, { profile: character })
    expect(byCode(d.checks, CRITIQUE_CODE.paletteBudget)).toBeUndefined()
  })

  test('an unbudgeted target still surfaces genuinely runaway sprawl as a non-blocking info', () => {
    const sprite = manyColors('huge', 72, 3) // 5184 distinct colours > RGBA ceiling
    const d = critiqueSprite('huge', sprite, { paletteTarget: 'unbudgeted' })
    const c = byCode(d.checks, CRITIQUE_CODE.paletteBudget)
    expect(c).toMatchObject({ code: 'C006', severity: 'info' })
    expect(c?.measured).toBe(d.distinctColorCount)
  })
})

describe('clean sprite and metric exposure', () => {
  test('a centered, value-varied, edge-to-edge sprite fires no checks but still exposes metrics', () => {
    const rows = Array.from({ length: 8 }, (_, y) => (y % 2 === 0 ? 'abababab' : 'babababa'))
    const src = `draw ok 8x8:\n  palette a=#303030  b=#d0d0d0\n  pixels:\n${rows.map((r) => `    ${r}`).join('\n')}\n`
    const d = critique(src, 'ok')
    expect(d.checks).toEqual([])
    expect(d.bbox).toEqual({ x: 0, y: 0, width: 8, height: 8 })
    expect(d.coveredPixelCount).toBe(64)
    expect(d.opaquePixelCount).toBe(64)
    expect(d.transparentPixelCount).toBe(0)
    expect(d.distinctColorCount).toBe(2)
    expect(d.luminance).not.toBeNull()
  })
})

describe('critiqueCheckDiagnostic', () => {
  test('anchors a check to the draw span, preserving code, warning severity, and the fix as hint', () => {
    const check = {
      code: CRITIQUE_CODE.centering,
      severity: 'warning' as const,
      message: 'off-center',
      measured: -3,
      threshold: 2,
      fix: 'move the subject +1px on x',
    }
    const diag = critiqueCheckDiagnostic(check, 'file.drw', { line: 4, column: 1 })
    expect(diag).toEqual({
      severity: 'warning',
      code: 'C003',
      message: 'off-center',
      file: 'file.drw',
      line: 4,
      column: 1,
      hint: 'move the subject +1px on x',
    })
  })
})

// ── phase 1b: profiles, C007 floating part, C005 stroke width, --strict ───────

// A body (rows 0-9 full + a 2px tab down the left) whose bbox reaches row 15, so
// the part (rows 11-14, cols 4-7) overlaps the body bbox yet sits a 1px gap
// clear of the block above it — the "meant-to-touch but doesn't" seam signature.
const floatingSprite = (): Sprite =>
  synthSprite('seam', 16, 16, (x, y) => {
    if (y <= 9) {
      return DARK
    }
    if (x <= 1) {
      return DARK
    }
    if (y >= 11 && y <= 14 && x >= 4 && x <= 7) {
      return LIGHT
    }
    return null
  })

describe('resolveProfile (--as selection, no inference)', () => {
  test('each category name resolves to its own profile with the expected gating', () => {
    expect(resolveProfile('icon')).toMatchObject({
      name: 'icon',
      checkStroke: true,
      checkFloatingPart: false,
      strictCentering: true,
    })
    expect(resolveProfile('item')).toMatchObject({ name: 'item', checkFloatingPart: false })
    expect(resolveProfile('character')).toMatchObject({
      name: 'character',
      checkStroke: true,
      checkFloatingPart: true,
      strictCentering: false,
    })
    expect(resolveProfile('scene')).toMatchObject({ name: 'scene', checkStroke: false })
  })

  test('an absent or unknown name resolves to null (no profile, no inference)', () => {
    expect(resolveProfile(null)).toBeNull()
    expect(resolveProfile(undefined)).toBeNull()
    expect(resolveProfile('sprite')).toBeNull()
  })
})

describe('C007 floating part / seam (profile-gated to character)', () => {
  test('a body-overlapping detached component fires C007 with the exact gap and part facts', () => {
    const d = critiqueSprite('seam', floatingSprite(), { profile: character })
    expect(d.componentCount).toBe(2)
    const c = byCode(d.checks, CRITIQUE_CODE.floatingPart)
    expect(c).toMatchObject({ code: 'C007', severity: 'warning', measured: 1, threshold: 0 })
    expect(c?.detail).toEqual({ partCount: 1, partSize: 16, partX: 4, partY: 11 })
    expect(c?.fix).toContain('--crop 2:9 8x8 --silhouette')
  })

  test('the same sprite is silent without a profile (C007 is not category-agnostic)', () => {
    const d = critiqueSprite('seam', floatingSprite())
    expect(d.componentCount).toBeUndefined()
    expect(byCode(d.checks, CRITIQUE_CODE.floatingPart)).toBeUndefined()
  })

  test('a detached component whose bbox is clear of the body (legit orbit) does not fire C007', () => {
    // body rows 0-7 (bbox y 0..7); part rows 11-14 sits below with a clear bbox gap
    const sprite = synthSprite('orbit', 16, 16, (x, y) => {
      if (y <= 7) {
        return DARK
      }
      if (y >= 11 && y <= 14 && x >= 5 && x <= 9) {
        return LIGHT
      }
      return null
    })
    const d = critiqueSprite('orbit', sprite, { profile: character })
    expect(d.componentCount).toBe(2)
    expect(byCode(d.checks, CRITIQUE_CODE.floatingPart)).toBeUndefined()
  })

  test('a part that actually touches the body is one component and stays clean', () => {
    // part row 10 is 8-adjacent to the body row 9 -> single connected component
    const sprite = synthSprite('joined', 16, 16, (x, y) => {
      if (y <= 9) {
        return DARK
      }
      if (y >= 10 && y <= 13 && x >= 4 && x <= 7) {
        return LIGHT
      }
      return null
    })
    const d = critiqueSprite('joined', sprite, { profile: character })
    expect(d.componentCount).toBe(1)
    expect(byCode(d.checks, CRITIQUE_CODE.floatingPart)).toBeUndefined()
  })
})

describe('C005 stroke width (profile-gated by checkStroke)', () => {
  test('a 48px sprite of 1px hairlines fires C005 with the measured min stroke and scale floor', () => {
    // vertical 1px lines every 3 columns -> every covered pixel is a width-2 ridge
    const sprite = synthSprite('hairlines', 48, 48, (x) => (x % 3 === 0 ? LIGHT : null))
    const d = critiqueSprite('hairlines', sprite, { profile: icon })
    expect(d.minStrokeWidth).toBe(2)
    const c = byCode(d.checks, CRITIQUE_CODE.strokeWidth)
    expect(c).toMatchObject({ code: 'C005', severity: 'warning', measured: 2, threshold: 3 })
    expect(c?.detail).toEqual({ thinStrokeFraction: 1, ridgeCount: 768 })
  })

  test('a thick solid block does not fire C005 (deep ridge, no thin domination)', () => {
    const sprite = synthSprite('block', 48, 48, (x, y) =>
      x >= 4 && x <= 43 && y >= 4 && y <= 43 ? LIGHT : null,
    )
    const d = critiqueSprite('block', sprite, { profile: icon })
    expect(byCode(d.checks, CRITIQUE_CODE.strokeWidth)).toBeUndefined()
    expect(d.minStrokeWidth ?? 0).toBeGreaterThan(3)
  })

  test('the hairline sprite is silent without a profile (C005 needs checkStroke)', () => {
    const sprite = synthSprite('hairlines', 48, 48, (x) => (x % 3 === 0 ? LIGHT : null))
    const d = critiqueSprite('hairlines', sprite)
    expect(d.minStrokeWidth).toBeUndefined()
    expect(byCode(d.checks, CRITIQUE_CODE.strokeWidth)).toBeUndefined()
  })
})

describe('--strict severity promotion', () => {
  const offCenter = `draw off 8x8:\n  palette w=#ffffff  k=#000000\n  pixels:\n${Array(8)
    .fill('    .wkw....')
    .join('\n')}\n`

  test('strict promotes a must-fix check (C007) to error, leaving warnings intact', () => {
    const d = critiqueSprite('seam', floatingSprite(), { profile: character, strict: true })
    expect(byCode(d.checks, CRITIQUE_CODE.floatingPart)?.severity).toBe('error')
  })

  test('strict promotes C003 only under the icon profile (item centering stays advisory)', () => {
    const iconStrict = critiqueSprite('off', render(offCenter, 'off'), {
      profile: icon,
      strict: true,
    })
    expect(byCode(iconStrict.checks, CRITIQUE_CODE.centering)?.severity).toBe('error')
    // items include diagonal weapons whose bbox parity is legitimately off, so
    // item centering is a warning even under strict.
    const itemStrict = critiqueSprite('off', render(offCenter, 'off'), {
      profile: item,
      strict: true,
    })
    expect(byCode(itemStrict.checks, CRITIQUE_CODE.centering)?.severity).toBe('warning')
    const charStrict = critiqueSprite('off', render(offCenter, 'off'), {
      profile: character,
      strict: true,
    })
    expect(byCode(charStrict.checks, CRITIQUE_CODE.centering)?.severity).toBe('warning')
  })

  test('without strict, every check stays a warning (exit 0 by default)', () => {
    const d = critiqueSprite('seam', floatingSprite(), { profile: character })
    expect(byCode(d.checks, CRITIQUE_CODE.floatingPart)?.severity).toBe('warning')
  })
})

describe('critique CLI --strict exit gate', () => {
  const runQuiet = (argv: readonly string[]): number => {
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = (() => true) as typeof process.stdout.write
    try {
      return main([...argv])
    } finally {
      process.stdout.write = original
    }
  }

  test('a must-fix finding (C001) exits 0 by default but 1 under --strict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-critique-'))
    const file = join(dir, 'blank.drw')
    writeFileSync(file, 'draw blank 4x4:\n  palette k=#000000\n')
    try {
      expect(runQuiet(['critique', file, '--json'])).toBe(0)
      expect(runQuiet(['critique', file, '--strict', '--json'])).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ── phase 1c: C002 edge-clip, silhouette signatures, C009/C011 family, rubric ──

/** Covered mask + tight bbox of a synthetic sprite, the inputs {@link silhouetteSignature} consumes. */
const coverageOf = (s: Sprite): { covered: Uint8Array; bbox: ReturnType<typeof bboxOf> } => {
  const covered = new Uint8Array(s.w * s.h)
  for (let p = 0; p < covered.length; p++) {
    covered[p] = (s.data[p * 4 + 3] ?? 0) > 0 ? 1 : 0
  }
  return { covered, bbox: bboxOf(s) }
}
const bboxOf = (s: Sprite): { x: number; y: number; width: number; height: number } | null => {
  let x0 = s.w
  let y0 = s.h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if ((s.data[(y * s.w + x) * 4 + 3] ?? 0) > 0) {
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}
const sigOf = (s: Sprite) => {
  const { covered, bbox } = coverageOf(s)
  return silhouetteSignature(covered, s.w, bbox)
}
/** A lower-left right-triangle mask, scale-independent (relative coordinates). */
const triangle =
  (w: number, h: number) =>
  (x: number, y: number): Px =>
    x / w <= y / h ? LIGHT : null

describe('C002 edge-clip (profile-gated to icon/item)', () => {
  const clipped = synthSprite('clip', 16, 16, (x, y) =>
    x <= 5 && y <= 5 ? (x % 2 === y % 2 ? DARK : LIGHT) : null,
  )
  test('opaque content touching the top-left edge fires C002 under an icon profile', () => {
    const d = critiqueSprite('clip', clipped, { profile: icon })
    const c = byCode(d.checks, CRITIQUE_CODE.edgeClip)
    expect(c).toMatchObject({ code: 'C002', severity: 'warning', threshold: 0 })
    expect(c?.detail).toEqual({ top: 1, bottom: 0, left: 1, right: 0 })
  })

  test('C002 is silent without a profile and under a scene profile (checkEdgeClip gated)', () => {
    expect(byCode(critiqueSprite('clip', clipped).checks, CRITIQUE_CODE.edgeClip)).toBeUndefined()
    expect(
      byCode(critiqueSprite('clip', clipped, { profile: scene }).checks, CRITIQUE_CODE.edgeClip),
    ).toBeUndefined()
    // characters legitimately fill the full height, so their profile opts out too
    expect(
      byCode(
        critiqueSprite('clip', clipped, { profile: character }).checks,
        CRITIQUE_CODE.edgeClip,
      ),
    ).toBeUndefined()
  })

  test('an inset subject with a transparent margin does not fire C002', () => {
    const inset = synthSprite('inset', 16, 16, (x, y) =>
      x >= 4 && x <= 11 && y >= 4 && y <= 11 ? (x % 2 === y % 2 ? DARK : LIGHT) : null,
    )
    expect(
      byCode(critiqueSprite('inset', inset, { profile: icon }).checks, CRITIQUE_CODE.edgeClip),
    ).toBeUndefined()
  })
})

describe('silhouette signatures (scale/position invariant, aspect preserving)', () => {
  test('the same shape at two sizes yields near-identical signatures', () => {
    const a = synthSprite('a', 16, 16, triangle(16, 16))
    const b = synthSprite('b', 32, 32, triangle(32, 32))
    expect(signatureDistance(sigOf(a), sigOf(b))).toBeLessThan(0.05)
  })

  test('the same shape shifted in a larger canvas is position-invariant (bbox-cropped)', () => {
    const a = synthSprite('a', 12, 12, triangle(12, 12))
    const shifted = synthSprite('b', 24, 24, (x, y) => {
      const lx = x - 6
      const ly = y - 3
      return lx >= 0 && lx < 12 && ly >= 0 && ly < 12 ? triangle(12, 12)(lx, ly) : null
    })
    expect(signatureDistance(sigOf(a), sigOf(shifted))).toBeLessThan(0.02)
  })

  test('a tall bar and a wide bar are far apart (aspect is preserved, not normalized away)', () => {
    const tall = synthSprite('t', 16, 16, (x) => (x >= 6 && x <= 9 ? LIGHT : null))
    const wide = synthSprite('w', 16, 16, (_, y) => (y >= 6 && y <= 9 ? LIGHT : null))
    expect(signatureDistance(sigOf(tall), sigOf(wide))).toBeGreaterThan(0.5)
  })

  test('an empty sprite has no signature and distance 1 to anything', () => {
    const empty = synthSprite('e', 8, 8, () => null)
    expect(sigOf(empty)).toBeNull()
    const solid = synthSprite('s', 8, 8, () => LIGHT)
    expect(signatureDistance(sigOf(empty), sigOf(solid))).toBe(1)
  })
})

describe('C009 sibling-silhouette collapse (critiqueFamily)', () => {
  const triA = (name: string, c: Px) =>
    synthSprite(name, 16, 16, (x, y) => (triangle(16, 16)(x, y) ? c : null))

  test('two identical silhouettes (a recolor pair) fire C009 for both, as an advisory warning', () => {
    const fam = critiqueFamily([
      { name: 'green', sprite: triA('green', DARK) },
      { name: 'red', sprite: triA('red', LIGHT) },
    ])
    expect(fam).not.toBeNull()
    const c9 = fam?.checks.filter((c) => c.code === CRITIQUE_CODE.siblingCollapse) ?? []
    expect(c9.map((c) => c.target).sort()).toEqual(['green', 'red'])
    expect(c9[0]).toMatchObject({ severity: 'warning', measured: 0, threshold: 0.12 })
  })

  test('C009 stays a warning even under --strict (silhouette-sharing is a first-class pattern)', () => {
    const fam = critiqueFamily(
      [
        { name: 'green', sprite: triA('green', DARK) },
        { name: 'red', sprite: triA('red', LIGHT) },
      ],
      { strict: true },
    )
    const c9 = fam?.checks.find((c) => c.code === CRITIQUE_CODE.siblingCollapse)
    expect(c9?.severity).toBe('warning')
  })

  test('two clearly different silhouettes do not fire C009', () => {
    const tri = triA('tri', LIGHT)
    const block = synthSprite('block', 16, 16, () => LIGHT)
    const fam = critiqueFamily([
      { name: 'tri', sprite: tri },
      { name: 'block', sprite: block },
    ])
    expect(fam?.checks.some((c) => c.code === CRITIQUE_CODE.siblingCollapse)).toBe(false)
  })

  test('fewer than two members returns null (nothing to compare)', () => {
    expect(critiqueFamily([{ name: 'only', sprite: triA('only', LIGHT) }])).toBeNull()
    expect(critiqueFamily([])).toBeNull()
  })

  test('character profile: one character’s own front/side/back views never fire C009 against each other', () => {
    // character-DX 2026-07-10 rerun §5.2/§9.6 (named contradiction): a character's own views are
    // SUPPOSED to read as one silhouette — C009 must not punish that under `--as character`.
    const fam = critiqueFamily(
      [
        { name: 'knightFront', sprite: triA('knightFront', DARK) },
        { name: 'knightBack', sprite: triA('knightBack', LIGHT) },
      ],
      { profile: character },
    )
    expect(fam?.checks.some((c) => c.code === CRITIQUE_CODE.siblingCollapse)).toBe(false)
  })

  test('character profile: C009 still fires between different characters (real near-neighbour siblings)', () => {
    const fam = critiqueFamily(
      [
        { name: 'knightFront', sprite: triA('knightFront', DARK) },
        { name: 'mageFront', sprite: triA('mageFront', LIGHT) },
      ],
      { profile: character },
    )
    const c9 = fam?.checks.filter((c) => c.code === CRITIQUE_CODE.siblingCollapse) ?? []
    expect(c9.map((c) => c.target).sort()).toEqual(['knightFront', 'mageFront'])
  })

  test('without a character profile, same-name-stem siblings still fire C009 (exemption is profile-gated)', () => {
    const fam = critiqueFamily([
      { name: 'knightFront', sprite: triA('knightFront', DARK) },
      { name: 'knightBack', sprite: triA('knightBack', LIGHT) },
    ])
    expect(fam?.checks.some((c) => c.code === CRITIQUE_CODE.siblingCollapse)).toBe(true)
  })

  test('a cross-size pair never fires C009 even at near-zero raw distance; a same-size pair still does (category-error fix, round 3)', () => {
    // `silhouetteSignature` is scale-invariant by construction, so the same shape at 16x16 and
    // 32x32 signs near-identically -- that is the signature working as documented (icon-craft.md
    // §6 "redraw, never scale"), not a collapse. `nearest` must never name a different-size
    // sibling even when its raw distance is the smallest in the matrix.
    const shape16 = (name: string, c: Px) =>
      synthSprite(name, 16, 16, (x, y) => (triangle(16, 16)(x, y) ? c : null))
    const shape32 = (name: string, c: Px) =>
      synthSprite(name, 32, 32, (x, y) => (triangle(32, 32)(x, y) ? c : null))
    const fam = critiqueFamily([
      { name: 'small', sprite: shape16('small', DARK) },
      { name: 'smallTwin', sprite: shape16('smallTwin', LIGHT) },
      { name: 'big', sprite: shape32('big', DARK) },
    ])
    const members = fam?.metrics.members ?? []
    const idxSmall = members.findIndex((m) => m.name === 'small')
    const idxBig = members.findIndex((m) => m.name === 'big')
    // distanceMatrix stays raw pairwise data: the cross-size pair reads as near-identical there.
    expect(fam?.metrics.distanceMatrix[idxSmall]?.[idxBig]).toBeLessThan(0.05)
    // ...but `nearest` is scoped to same-canvas-size peers: 'small' pairs with 'smallTwin', never 'big'.
    expect(members[idxSmall]?.nearest?.name).toBe('smallTwin')
    // 'big' has no same-size sibling in this family, so it gets no nearest neighbour at all.
    expect(members[idxBig]?.nearest).toBeNull()
    const c9 = fam?.checks.filter((c) => c.code === CRITIQUE_CODE.siblingCollapse) ?? []
    expect(c9.map((c) => c.target).sort()).toEqual(['small', 'smallTwin'])
    expect(c9.some((c) => c.target === 'big')).toBe(false)
  })

  test('familyMetrics exposes a symmetric distance matrix (zero diagonal), nearest, and median', () => {
    const fam = critiqueFamily([
      { name: 'a', sprite: synthSprite('a', 16, 16, () => LIGHT) },
      {
        name: 'b',
        sprite: synthSprite('b', 16, 16, (x, y) =>
          x >= 2 && x <= 13 && y >= 2 && y <= 13 ? LIGHT : null,
        ),
      },
    ])
    const m = fam?.metrics
    expect(m?.distanceMatrix.length).toBe(2)
    expect(m?.distanceMatrix[0]?.[0]).toBe(0)
    expect(m?.distanceMatrix[1]?.[1]).toBe(0)
    expect(m?.distanceMatrix[0]?.[1]).toBe(m?.distanceMatrix[1]?.[0])
    expect(m?.members[0]?.nearest?.name).toBe('b')
    expect(m?.medianCoveredPixelCount).toBe((256 + 144) / 2)
  })
})

describe('C009-Plate-Blindheit fix (plate detection + figure subtraction)', () => {
  // A minimal but real icon-craft plate/tile + glyph family (theme, palette, shared `tile(c)`
  // stamped per icon) — mirrors examples/icons/system.drw's actual construction so the fix is
  // proven against the real language surface, not just synthetic pixel fixtures.
  const plateFamily = (glyphB: string, glyphR: string): string => `
theme t:
  palette:
    k = #20242c
    l = #f7faff
    b = #3b82f0
    r = #ef5d52
  size 32x32
  mode pixel

use t

draw tile(c):
  rrect linear(90, c.mix(l, 20%), c.darken(14%)) 2:2 29:29 6 fill
  line c.mix(l, 52%) 9:2 22:2

draw iconA:
  stamp tile(b) 0:0
  ${glyphB}

draw iconC:
  stamp tile(r) 0:0
  ${glyphR}
`

  const gearGlyph = 'fill l circle(16:16, 7).subtract(circle(16:16, 3))'
  const folderGlyph = 'poly l 5:10 5:8 12:8 14:10 26:10 26:23 5:23 fill'

  test('two different glyphs on differently-accented plates no longer collapse (the plate defect)', () => {
    const fam = critiqueFamily([
      { name: 'iconA', sprite: render(plateFamily(gearGlyph, folderGlyph), 'iconA') },
      { name: 'iconC', sprite: render(plateFamily(gearGlyph, folderGlyph), 'iconC') },
    ])
    expect(fam?.checks.some((c) => c.code === CRITIQUE_CODE.siblingCollapse)).toBe(false)
    // pre-fix this measured 0 for every plate pair in the bundled corpus (the plate itself was
    // the entire signature) — assert it now reads as a real, non-trivial silhouette distance.
    expect(fam?.metrics.distanceMatrix[0]?.[1]).toBeGreaterThan(0.12)
  })

  // skills/drawstic/starters/icon-family.drw's `plate(t)` — a flat `fill t face` plus a *separate*
  // 2px alpha-blended lit/shaded contour composited only at the face's own edge
  // (`face.edge(1:1,2)` / `face.edge(-1:-1,2)`), not a continuous gradient. The tint-to-fill
  // adjacent step this creates (~0.09–0.13 across the starter's five glyphs) is bigger than a
  // gradient's own per-row step, so it needs its own regression coverage beyond `plateFamily`
  // above (round-2 follow-up: the coordinator measured this exact construction still collapsing
  // at distance 0 after the first fix).
  const edgeBandPlateFamily = (glyphB: string, glyphR: string): string => `
theme t2:
  palette:
    k = #141a26
    l = #f4f8ff
    b = #3b82f0
    r = #e0574f
  size 32x32
  mode pixel

use t2

draw plate(t):
  face = rrect(2:2, 29:29, 6)
  fill t face
  fill l.alpha(34%) face.edge(1:1, 2)
  fill k.alpha(28%) face.edge(-1:-1, 2)

draw iconA:
  stamp plate(b) 0:0
  ${glyphB}

draw iconC:
  stamp plate(r) 0:0
  ${glyphR}
`

  test('a flat-fill plate with a separate 2px edge-band tint (not a gradient) also no longer collapses', () => {
    const fam = critiqueFamily([
      { name: 'iconA', sprite: render(edgeBandPlateFamily(gearGlyph, folderGlyph), 'iconA') },
      { name: 'iconC', sprite: render(edgeBandPlateFamily(gearGlyph, folderGlyph), 'iconC') },
    ])
    expect(fam?.checks.some((c) => c.code === CRITIQUE_CODE.siblingCollapse)).toBe(false)
    expect(fam?.metrics.distanceMatrix[0]?.[1]).toBeGreaterThan(0.12)
  })

  test('a genuinely duplicated glyph on an edge-band-tint plate still collapses (C009 still bites)', () => {
    const fam = critiqueFamily([
      { name: 'iconA', sprite: render(edgeBandPlateFamily(folderGlyph, folderGlyph), 'iconA') },
      { name: 'iconC', sprite: render(edgeBandPlateFamily(folderGlyph, folderGlyph), 'iconC') },
    ])
    const c9 = fam?.checks.filter((c) => c.code === CRITIQUE_CODE.siblingCollapse) ?? []
    expect(c9.map((c) => c.target).sort()).toEqual(['iconA', 'iconC'])
    expect(fam?.metrics.distanceMatrix[0]?.[1]).toBe(0)
  })

  test('a genuinely duplicated glyph on a different-accent plate still collapses (C009 still bites)', () => {
    // Same folder glyph stamped on both a blue and a red plate — a realistic copy-paste bug.
    const fam = critiqueFamily([
      { name: 'iconA', sprite: render(plateFamily(folderGlyph, folderGlyph), 'iconA') },
      { name: 'iconC', sprite: render(plateFamily(folderGlyph, folderGlyph), 'iconC') },
    ])
    const c9 = fam?.checks.filter((c) => c.code === CRITIQUE_CODE.siblingCollapse) ?? []
    expect(c9.map((c) => c.target).sort()).toEqual(['iconA', 'iconC'])
    expect(fam?.metrics.distanceMatrix[0]?.[1]).toBe(0)
  })

  test('a plate-only tile with no glyph at all falls back to the full mask (degenerate-figure floor)', () => {
    // No stamped glyph on either tile: subtracting the plate would leave ~0px, so
    // detectPlateFigure must decline (PLATE_MIN_FIGURE_FLOOR) rather than sign an empty figure.
    const bareA = render(plateFamily('', ''), 'iconA')
    const bareC = render(plateFamily('', ''), 'iconC')
    const fam = critiqueFamily([
      { name: 'iconA', sprite: bareA },
      { name: 'iconC', sprite: bareC },
    ])
    // Falls back to the untouched covered-mask signature — the *exact* pre-fix value.
    const direct = signatureDistance(sigOf(bareA), sigOf(bareC))
    expect(fam?.metrics.distanceMatrix[0]?.[1]).toBe(direct)
  })

  test('a non-plate silhouette (touches only two canvas edges, never all four) signs its full covered mask unchanged', () => {
    // Mimics a character: a high-contrast dark outline ring around a lighter fill, touching only
    // the top+bottom edges (hair/feet) with a clear left/right margin — never all four edges, so
    // detectPlateFigure must decline for both and critiqueFamily falls back to the pre-fix
    // silhouetteSignature(covered mask) exactly.
    const outlineBlob =
      (topOffset: number) =>
      (name: string): Sprite =>
        synthSprite(name, 20, 30, (x, y) => {
          const cx = 10
          const cy = 15 + topOffset
          const dx = (x - cx) / 6
          const dy = (y - cy) / 12
          const r2 = dx * dx + dy * dy
          if (r2 > 1) {
            return null
          }
          return r2 > 0.75 ? DARK : LIGHT
        })
    const a = outlineBlob(0)('a')
    const b = outlineBlob(3)('b')
    const fam = critiqueFamily([
      { name: 'a', sprite: a },
      { name: 'b', sprite: b },
    ])
    const direct = signatureDistance(sigOf(a), sigOf(b))
    expect(fam?.metrics.distanceMatrix[0]?.[1]).toBe(direct)
  })

  test('a genuine full-canvas plate-like block (all 4 edges, solid colour) still falls back — no glyph to keep', () => {
    const solidPlate = synthSprite('solid', 24, 24, () => LIGHT)
    const tri = synthSprite('tri', 24, 24, triangle(24, 24))
    const fam = critiqueFamily([
      { name: 'solid', sprite: solidPlate },
      { name: 'tri', sprite: tri },
    ])
    // Unaffected: same numeric result as computing the raw covered-mask signatures directly.
    const direct = signatureDistance(sigOf(solidPlate), sigOf(tri))
    expect(fam?.metrics.distanceMatrix[0]?.[1]).toBe(direct)
  })

  // Regression (release 1.0 hardening, round 2): `detectPlateFigure` briefly shared one
  // calibration between C009 and `render --silhouette`; the `--silhouette`-tuned gates (added to
  // close non-icon false positives, see `PlateDetectionMode` in src/preview.ts) also rejected
  // several thin real icon plates, so C009 signed their *full* covered mask again and these three
  // real, distinct glyphs on `examples/icons/communication.drw`'s shared plate collapsed back to
  // distance 0 — the exact plate-blindness bug this describe block exists to fix. `critiqueFamily`
  // must call `detectPlateFigure` in `'loose'` mode (unchanged from before that round) so this never
  // silently returns; `tests/unit/examples-critique.test.ts` additionally pins the exact C009 count
  // per bundled icon/item family.
  test("communication.drw's phone/contacts/feed (thin glyphs on a shared plate) never collapse to distance 0", () => {
    const engine = new Engine(process.cwd())
    const mod = engine.loadEntry(join(process.cwd(), 'examples/icons/communication.drw'))
    const renderReal = (name: string): Sprite => {
      const entry = mod.definitions.get(name)
      if (entry?.kind !== 'draw') {
        throw new Error(`no drawing ${name} in communication.drw`)
      }
      return engine.renderFragment(entry, name, null, { line: 1, column: 1 })
    }
    const fam = critiqueFamily([
      { name: 'phone', sprite: renderReal('phone') },
      { name: 'contacts', sprite: renderReal('contacts') },
      { name: 'feed', sprite: renderReal('feed') },
    ])
    const idx = (name: string): number =>
      fam?.metrics.members.findIndex((m) => m.name === name) ?? -1
    const distance = (a: string, b: string): number | undefined =>
      fam?.metrics.distanceMatrix[idx(a)]?.[idx(b)]
    expect(distance('phone', 'contacts')).toBeGreaterThan(0)
    expect(distance('phone', 'feed')).toBeGreaterThan(0)
    expect(distance('contacts', 'feed')).toBeGreaterThan(0)
    const c9 = fam?.checks.filter((c) => c.code === CRITIQUE_CODE.siblingCollapse) ?? []
    expect(c9).toEqual([])
  })
})

describe('C011 family weight parity', () => {
  test('a member far lighter than the family median fires C011 with the ratio', () => {
    const big1 = synthSprite('big1', 16, 16, () => LIGHT) // 256
    const big2 = synthSprite('big2', 16, 16, (x, y) => (x >= 1 && y >= 1 ? LIGHT : null)) // 225
    const tiny = synthSprite('tiny', 16, 16, (x, y) => (x < 3 && y < 3 ? LIGHT : null)) // 9
    const fam = critiqueFamily([
      { name: 'big1', sprite: big1 },
      { name: 'big2', sprite: big2 },
      { name: 'tiny', sprite: tiny },
    ])
    const c11 = fam?.checks.filter((c) => c.code === CRITIQUE_CODE.familyParity) ?? []
    expect(c11.map((c) => c.target)).toEqual(['tiny'])
    expect(c11[0]?.measured).toBeGreaterThan(6)
  })

  test('a balanced family fires no C011', () => {
    const a = synthSprite('a', 16, 16, () => LIGHT)
    const b = synthSprite('b', 16, 16, (x) => (x >= 1 ? LIGHT : null))
    const c = synthSprite('c', 16, 16, (_, y) => (y >= 1 ? LIGHT : null))
    const fam = critiqueFamily([
      { name: 'a', sprite: a },
      { name: 'b', sprite: b },
      { name: 'c', sprite: c },
    ])
    expect(fam?.checks.some((ck) => ck.code === CRITIQUE_CODE.familyParity)).toBe(false)
  })
})

describe('buildRubric (vision rubric block, ADR-0085 §6)', () => {
  test('an icon profile yields silhouette-first renders + the family sheet + icon prompts', () => {
    const r = buildRubric(icon, 'f.drw', 'home', true)
    expect(r.renders).toEqual([
      'render f.drw#home --silhouette --png@6',
      'render f.drw#home --ascii --fit 64x64',
      'render f.drw#home --png@4',
      'sheet f.drw --png@4',
    ])
    expect(r.items.map((i) => i.id)).toEqual(['misread', 'merge-trap'])
    expect(r.note).toContain('"Yes" is not an answer')
  })

  // Blind builds answered yes/no prompts in their own favour — one graded an icon that reads as a
  // life-ring "clearly = sun". Every prompt must therefore demand an observation, which in practice
  // means an imperative ("name…", "write down…", "give…", "state…"), never a "does/is/do" question.
  test('every rubric prompt asks for an observation, not a verdict', () => {
    const all = [
      ...buildRubric(icon, 'f.drw', 'a', true).items,
      ...buildRubric(character, 'f.drw', 'a', true).items,
      ...buildRubric(item, 'f.drw', 'a', true).items,
      ...buildRubric(scene, 'f.drw', 'a', true).items,
      ...buildRubric(null, 'f.drw', 'a', false).items,
    ]
    expect(all.length).toBeGreaterThan(0)
    for (const it of all) {
      expect(it.ask).toMatch(/\b([Nn]ame|write down|[Gg]ive|[Ss]tate|[Cc]over)\b/)
      expect(it.ask).not.toMatch(/^(Does|Is|Do|Are|Can|Has|Have)\b/)
    }
  })

  test('no profile yields the agnostic rubric and no sheet render when there is no family', () => {
    const r = buildRubric(null, 'f.drw', 'x', false)
    expect(r.renders.some((cmd) => cmd.startsWith('sheet'))).toBe(false)
    expect(r.items.map((i) => i.id)).toEqual(['silhouette', 'centering'])
  })

  test('a scene profile carries the hero-contrast / no-floating / one-light prompts', () => {
    expect(buildRubric(scene, 'f.drw', 'bay', false).items.map((i) => i.id)).toEqual([
      'hero-contrast',
      'no-floating',
      'one-light',
    ])
  })
})

describe('critique CLI family selection + rubric payload', () => {
  const runCapture = (argv: readonly string[]): { code: number; json: unknown } => {
    const original = process.stdout.write.bind(process.stdout)
    let out = ''
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      return true
    }) as typeof process.stdout.write
    try {
      const code = main([...argv])
      return { code, json: JSON.parse(out) }
    } finally {
      process.stdout.write = original
    }
  }

  const familySrc = [
    'draw a 8x8:',
    '  bg #c04040',
    'draw b 8x8:',
    '  bg #40c040',
    'draw c 8x8:',
    '  bg #4040c0',
    'export a out/a:',
    '  png @1',
    'export b out/b:',
    '  png @1',
    '',
  ].join('\n')

  test('the default family is the exported draws; --family overrides it, and the rubric ships', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-family-'))
    const file = join(dir, 'set.drw')
    writeFileSync(file, familySrc)
    try {
      const def = runCapture(['critique', file, '--as', 'item', '--json'])
      const critique = (
        def.json as {
          critique: {
            familyMetrics: { members: { name: string }[] }
            rubric: { renders: string[] }
          }
        }
      ).critique
      expect(critique.familyMetrics.members.map((m) => m.name)).toEqual(['a', 'b'])
      expect(critique.rubric.renders.some((c) => c.startsWith('sheet'))).toBe(true)

      const all = runCapture(['critique', file, '--family', 'a,b,c', '--json'])
      const fm = (all.json as { critique: { familyMetrics: { members: { name: string }[] } } })
        .critique.familyMetrics
      expect(fm.members.map((m) => m.name)).toEqual(['a', 'b', 'c'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('the default family excludes a composed presentation sheet that stamps ≥2 siblings', () => {
    // character-DX 2026-07-10 rerun §5.1/§9.8: a hand-authored `draw sheet: stamp front …; stamp
    // side …` panel that is itself exported must not enter the default critique family — its
    // combined mass/palette is noise, not a view. `--family` can still name it explicitly.
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-family-'))
    const file = join(dir, 'sheetFamily.drw')
    const src = [
      'draw front 8x8:',
      '  bg #c04040',
      'draw side 8x8:',
      '  bg #40c040',
      'draw sheet 20x10:',
      '  stamp front 0:0',
      '  stamp side 10:0',
      'export front out/front:',
      '  png @1',
      'export side out/side:',
      '  png @1',
      'export sheet out/sheet:',
      '  png @1',
      '',
    ].join('\n')
    writeFileSync(file, src)
    try {
      const def = runCapture(['critique', file, '--as', 'item', '--json'])
      const critique = (
        def.json as { critique: { familyMetrics: { members: { name: string }[] } } }
      ).critique
      expect(critique.familyMetrics.members.map((m) => m.name)).toEqual(['front', 'side'])

      const withSheet = runCapture(['critique', file, '--family', 'front,side,sheet', '--json'])
      const fm = (
        withSheet.json as { critique: { familyMetrics: { members: { name: string }[] } } }
      ).critique.familyMetrics
      expect(fm.members.map((m) => m.name)).toEqual(['front', 'side', 'sheet'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('a collapsing family stays exit 0 under --strict (C009 is advisory, not a gate)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-family-'))
    const file = join(dir, 'set.drw')
    writeFileSync(file, familySrc)
    try {
      // a/b/c are identical full-canvas silhouettes -> C009 collapse, but advisory
      expect(runCapture(['critique', file, '--family', 'a,b,c', '--strict', '--json']).code).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('C006 is export-target-aware: an SVG/indexed export is budgeted, a plain PNG is not', () => {
    // A wide diagonal gradient paints >96 distinct colours. The SVG-exported draw is a
    // palette-budgeted target (C006 warning, blocks pass); the plain-PNG draw is not.
    const dir = mkdtempSync(join(tmpdir(), 'drawstic-c006-'))
    const file = join(dir, 'grad.drw')
    writeFileSync(
      file,
      [
        'gradient sky = linear(45, #0040ff, #ff8000)',
        'draw svgDraw 128x128:',
        '  fill sky rect(0:0, 128:128)',
        'draw pngDraw 128x128:',
        '  fill sky rect(0:0, 128:128)',
        'export svgDraw out/svgDraw:',
        '  svg',
        'export pngDraw out/pngDraw:',
        '  png @1',
        '',
      ].join('\n'),
    )
    try {
      const { json } = runCapture(['critique', file, '--as', 'character', '--json'])
      const drawings = (
        json as {
          critique: {
            drawings: { name: string; checks: { code: string; severity: string }[] }[]
          }
        }
      ).critique.drawings
      const c6 = (name: string) =>
        drawings.find((d) => d.name === name)?.checks.find((c) => c.code === 'C006')
      expect(c6('svgDraw')?.severity).toBe('warning')
      expect(c6('pngDraw')).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
