import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { main } from '../../src/cli.js'
import {
  CRITIQUE_CODE,
  type CritiqueProfile,
  critiqueCheckDiagnostic,
  critiqueSprite,
  resolveProfile,
} from '../../src/critique.js'
import { Engine } from '../../src/eval.js'
import type { Sprite } from '../../src/values.js'

let n = 0
const render = (src: string, drawing: string): Sprite => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\critique${n++}.drw`, 'mem.drw')
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

describe('C001 empty / near-empty', () => {
  test('a fully transparent sprite fires C001 with measured 0 and null metrics', () => {
    const d = critique('draw empty 3x3:\n  pal k=#000000\n', 'empty')
    expect(d.bbox).toBeNull()
    expect(d.coveredPixelCount).toBe(0)
    expect(d.luminance).toBeNull()
    const c = byCode(d.checks, CRITIQUE_CODE.empty)
    expect(c).toMatchObject({ code: 'C001', severity: 'warning', measured: 0, threshold: 1 })
    expect(c?.message).toContain('fully transparent')
  })

  test('a tiny subject on a large canvas fires C001 near-empty with the bbox area measured', () => {
    // one pixel at 5:5 on a 10x10 canvas -> bbox area 1, floor = max(4, 2%*100) = 4
    const d = critique('draw tiny 10x10:\n  pal k=#c04040\n  px k 5:5\n', 'tiny')
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
    const src = `draw off 8x8:\n  pal w=#ffffff  k=#000000\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'off')
    expect(d.bbox).toEqual({ x: 1, y: 0, width: 3, height: 8 })
    const c = byCode(d.checks, CRITIQUE_CODE.centering)
    expect(c).toMatchObject({ code: 'C003', measured: -3, threshold: 2 })
    expect(c?.detail).toEqual({ x0: 1, x1: 3, sum: 4, target: 7, offsetY: 0 })
  })

  test('a centered subject does not fire C003', () => {
    const row = '...ww...'
    const src = `draw mid 8x8:\n  pal w=#ffffff\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
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
    const src = `draw duo 8x8:\n  pal k=#202020  w=#e0e0e0\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'duo')
    expect(byCode(d.checks, CRITIQUE_CODE.valueSpread)).toBeUndefined()
    expect((d.luminance?.spread ?? 0) >= 0.15).toBe(true)
  })
})

describe('C008 interior pinholes', () => {
  test('a 1px transparent gap enclosed by paint fires C008 with measured 1', () => {
    const src = [
      'draw hole 5x5:',
      '  pal k=#101010  w=#f0f0f0',
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
    expect(c?.detail).toEqual({ largestInteriorHole: 1 })
    // the two-tone body keeps value contrast up, so C008 is isolated here
    expect(byCode(d.checks, CRITIQUE_CODE.valueSpread)).toBeUndefined()
  })

  test('a transparent gap open to the border is not a pinhole', () => {
    const src = [
      'draw notch 5x5:',
      '  pal k=#101010  w=#f0f0f0',
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
})

describe('C012 dynamic transparent trailing edge row', () => {
  test('a fully transparent bottom row with content above fires C012', () => {
    const src = [
      'draw pad 4x4:',
      '  pal k=#202020  w=#e0e0e0',
      '  pixels:',
      '    kwkw',
      '    wkwk',
      '    kwkw',
      '    ....',
      '',
    ].join('\n')
    const d = critique(src, 'pad')
    expect(d.bbox).toEqual({ x: 0, y: 0, width: 4, height: 3 })
    const c = byCode(d.checks, CRITIQUE_CODE.trailingEdgeRow)
    expect(c).toMatchObject({ code: 'C012', measured: 1, threshold: 0 })
  })
})

describe('C006 palette / complexity budget', () => {
  test('a two-tone sprite stays under the generous default ceiling', () => {
    const row = 'kwkwkwkw'
    const src = `draw duo 8x8:\n  pal k=#202020  w=#e0e0e0\n  pixels:\n${Array(8).fill(`    ${row}`).join('\n')}\n`
    const d = critique(src, 'duo')
    expect(d.distinctColorCount).toBe(2)
    expect(byCode(d.checks, CRITIQUE_CODE.paletteBudget)).toBeUndefined()
  })
})

describe('clean sprite and metric exposure', () => {
  test('a centered, value-varied, edge-to-edge sprite fires no checks but still exposes metrics', () => {
    const rows = Array.from({ length: 8 }, (_, y) => (y % 2 === 0 ? 'abababab' : 'babababa'))
    const src = `draw ok 8x8:\n  pal a=#303030  b=#d0d0d0\n  pixels:\n${rows.map((r) => `    ${r}`).join('\n')}\n`
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
  const offCenter = `draw off 8x8:\n  pal w=#ffffff  k=#000000\n  pixels:\n${Array(8)
    .fill('    .wkw....')
    .join('\n')}\n`

  test('strict promotes a must-fix check (C007) to error, leaving warnings intact', () => {
    const d = critiqueSprite('seam', floatingSprite(), { profile: character, strict: true })
    expect(byCode(d.checks, CRITIQUE_CODE.floatingPart)?.severity).toBe('error')
  })

  test('strict promotes C003 only under an icon/item profile, not character', () => {
    const iconStrict = critiqueSprite('off', render(offCenter, 'off'), {
      profile: icon,
      strict: true,
    })
    expect(byCode(iconStrict.checks, CRITIQUE_CODE.centering)?.severity).toBe('error')
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
    writeFileSync(file, 'draw blank 4x4:\n  pal k=#000000\n')
    try {
      expect(runQuiet(['critique', file, '--json'])).toBe(0)
      expect(runQuiet(['critique', file, '--strict', '--json'])).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
