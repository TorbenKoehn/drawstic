// W2-2a: two-phase assembly — `behind`/`front` occlusion relations, the `aim` 1-bone solver, and
// the C013 occlusion-parity check (ADR-0092). End-to-end where it matters (render → read pixels →
// assert): a `behind` clause reorders a later placement below an earlier one, ties keep statement
// order, a conflicting pair is a positioned E025 cycle, `aim` rotates a part by the exact solved
// angle, inline paints keep their sequence slot, C013 measures the declared parity, and the whole
// pipeline is byte-deterministic.

import { describe, expect, test } from 'bun:test'
import { critiqueSprite } from '../../src/critique.js'
import { DrawsticError } from '../../src/diagnostic.js'
import { Engine } from '../../src/eval.js'
import type { Sprite } from '../../src/values.js'

let n = 0
const engineFor = (): Engine => new Engine(process.cwd())
const renderOn = (engine: Engine, src: string, drawing: string): Sprite => {
  const mod = engine.loadSource(src, `${process.cwd()}\\occ${n++}.drw`, 'occ.drw')
  const entry = mod.definitions.get(drawing)
  if (!entry) {
    throw new Error(`no drawing ${drawing}`)
  }
  return engine.defToSprite(entry, { line: 1, column: 1 })
}
const render = (src: string, drawing: string): Sprite => renderOn(engineFor(), src, drawing)

const px = (s: Sprite, x: number, y: number): [number, number, number, number] => {
  const i = (y * s.w + x) * 4
  return [s.data[i] ?? 0, s.data[i + 1] ?? 0, s.data[i + 2] ?? 0, s.data[i + 3] ?? 0]
}

// Two overlapping solid squares in distinct colours.
const SQUARES = [
  'draw red 10x10:',
  '  fill #ff0000 rect(0:0, 9:9)',
  'draw blue 10x10:',
  '  fill #0000ff rect(0:0, 9:9)',
].join('\n')

describe('behind/front — topological paint order', () => {
  test('default order is statement order (later stamp paints on top)', () => {
    const s = render(
      [SQUARES, 'draw fig 20x20:', '  stamp red 2:2', '  stamp blue 6:6'].join('\n'),
      'fig',
    )
    // overlap pixel 8:8 — blue stamped after red, so blue is on top.
    expect(px(s, 8, 8)).toEqual([0, 0, 255, 255])
  })

  test('`behind` reorders the later placement below its target', () => {
    const s = render(
      [SQUARES, 'draw fig 20x20:', '  stamp red 2:2', '  stamp blue 6:6 behind red'].join('\n'),
      'fig',
    )
    // blue declared behind red → red wins the overlap even though blue is stamped later.
    expect(px(s, 8, 8)).toEqual([255, 0, 0, 255])
    // blue still shows where red doesn't cover it (14:14).
    expect(px(s, 14, 14)).toEqual([0, 0, 255, 255])
  })

  test('`front` reorders the earlier placement below its target', () => {
    // red stamped first; `front blue` (blue placed later) would need blue first — but red references a
    // not-yet-placed part, so front is declared the other way: blue front red keeps blue on top.
    const s = render(
      [SQUARES, 'draw fig 20x20:', '  stamp red 2:2', '  stamp blue 6:6 front red'].join('\n'),
      'fig',
    )
    expect(px(s, 8, 8)).toEqual([0, 0, 255, 255])
  })

  test('minimal disruption: a single `behind` moves only its own subject', () => {
    // green stamped between red and blue with no relation; blue `behind red` must drag only blue
    // below red, leaving green on top in its sequence slot. Resolved order bottom→top: blue,red,green.
    const engine = engineFor()
    engine.paintOrders = []
    renderOn(
      engine,
      [
        SQUARES,
        'draw green 10x10:',
        '  fill #00ff00 rect(0:0, 9:9)',
        'draw fig 24x24:',
        '  stamp red 2:2',
        '  stamp green 4:4',
        '  stamp blue 6:6 behind red',
      ].join('\n'),
      'fig',
    )
    const order = (engine.paintOrders ?? [])[0]?.order.map((o) => o.name)
    expect(order).toEqual(['blue', 'red', 'green'])
  })

  test('a conflicting behind+front pair is a positioned E025 cycle', () => {
    expect(() =>
      render(
        [
          SQUARES,
          'draw fig 20x20:',
          '  stamp red 2:2',
          '  stamp blue 6:6 behind red front red',
        ].join('\n'),
        'fig',
      ),
    ).toThrow(DrawsticError)
  })

  test('an unplaced behind/front target is a positioned error', () => {
    expect(() =>
      render([SQUARES, 'draw fig 20x20:', '  stamp red 2:2 behind ghost'].join('\n'), 'fig'),
    ).toThrow(/behind\/front target 'ghost'/)
  })
})

describe('aim — 1-bone orientation solve', () => {
  // A 4x8 part: grip at 2:6, tip at 2:0 (tip directly above grip → local grip→tip points up).
  const NEEDLE = [
    'draw needle 4x8:',
    '  fill #202020 rect(1:0, 2:7)',
    '  pin grip 2:6',
    '  pin tip 2:0',
  ].join('\n')

  test('aim rotates the part by the exact solved angle (up → right ⇒ 90°)', () => {
    const engine = engineFor()
    engine.placements = []
    renderOn(
      engine,
      [
        NEEDLE,
        'draw fig 24x24:',
        '  fill #884422 rect(0:0, 0:0)', // an anchor pixel so aim has content to grip near
        '  pin a.grip 10:10',
        '  fit needle.grip a.grip aim tip 20:10', // tip should point from 10:10 toward 20:10 (right)
      ].join('\n'),
      'fig',
    )
    const rec = (engine.placements ?? []).find((p) => p.target === 'needle.grip')
    expect(rec?.aimDeg).toBe(90)
  })

  test('aim onto a target directly above the grip is 0° (no rotation)', () => {
    const engine = engineFor()
    engine.placements = []
    renderOn(
      engine,
      [
        NEEDLE,
        'draw fig 24x24:',
        '  pin a.grip 10:10',
        '  fit needle.grip a.grip aim tip 10:2', // already pointing up
      ].join('\n'),
      'fig',
    )
    const rec = (engine.placements ?? []).find((p) => p.target === 'needle.grip')
    expect(rec?.aimDeg).toBe(0)
  })

  test('an unknown aim pin is a positioned error', () => {
    expect(() =>
      render(
        [
          NEEDLE,
          'draw fig 24x24:',
          '  pin a.grip 10:10',
          '  fit needle.grip a.grip aim nope 20:10',
        ].join('\n'),
        'fig',
      ),
    ).toThrow(/no aim pin 'nope'/)
  })
})

describe('C013 — occlusion parity', () => {
  test('a satisfied `behind` records overlap with zero violations (no C013)', () => {
    const s = render(
      [SQUARES, 'draw fig 20x20:', '  stamp red 2:2', '  stamp blue 6:6 behind red'].join('\n'),
      'fig',
    )
    expect(s.occlusions?.length).toBe(1)
    const o = s.occlusions?.[0]
    expect(o?.behind).toBe('blue')
    expect(o?.front).toBe('red')
    expect(o?.overlap).toBeGreaterThan(0)
    expect(o?.violating).toBe(0)
    const report = critiqueSprite('fig', s)
    expect(report.checks.some((c) => c.code === 'C013')).toBe(false)
  })

  test('a behind that the composite cannot honor fires C013 (visible behind pixels)', () => {
    // an inline fill between the two placements is a barrier: red flushes first, so blue placed after
    // it cannot paint below red even though it declares `behind red` → violating pixels.
    const s = render(
      [
        SQUARES,
        'draw fig 20x20:',
        '  stamp red 2:2',
        '  fill #00ff00 rect(0:0, 0:0)', // barrier at a corner, no overlap with red/blue
        '  stamp blue 6:6 behind red',
      ].join('\n'),
      'fig',
    )
    const o = s.occlusions?.[0]
    expect(o?.overlap).toBeGreaterThan(0)
    expect(o?.violating).toBeGreaterThan(0)
    const report = critiqueSprite('fig', s)
    const c13 = report.checks.find((c) => c.code === 'C013')
    expect(c13?.severity).toBe('warning')
    // --strict promotes C013 to error (must-fix subset).
    const strict = critiqueSprite('fig', s, { strict: true })
    expect(strict.checks.find((c) => c.code === 'C013')?.severity).toBe('error')
  })
})

describe('inline paints keep their sequence slot', () => {
  test('an inline fill paints over an earlier stamp and under a later one', () => {
    const s = render(
      [
        SQUARES,
        'draw green 10x10:',
        '  fill #00ff00 rect(0:0, 9:9)',
        'draw fig 24x24:',
        '  stamp red 2:2', // red 2..11
        '  fill #00ff00 rect(2:2, 11:11)', // green fill over red, in sequence
        '  stamp blue 14:2', // blue elsewhere, no overlap
      ].join('\n'),
      'fig',
    )
    // the fill kept its slot: it painted over the earlier red (5:5 is green, not red).
    expect(px(s, 5, 5)).toEqual([0, 255, 0, 255])
  })

  test('`behind`/`front` stay ordinary bindable names outside stamp/fit', () => {
    const s = render(
      [
        'draw fig 6x6:',
        '  behind = 3',
        '  front = 2',
        '  fill #123456 rect(front:behind, 5:5)',
      ].join('\n'),
      'fig',
    )
    expect(px(s, 3, 4)).toEqual([0x12, 0x34, 0x56, 255])
  })
})

describe('determinism', () => {
  test('two renders of an aim + behind assembly are byte-identical', () => {
    const src = [
      SQUARES,
      'draw needle 4x8:',
      '  fill #202020 rect(1:0, 2:7)',
      '  pin grip 2:6',
      '  pin tip 2:0',
      'draw fig 24x24:',
      '  stamp red 2:2',
      '  stamp blue 6:6 behind red',
      '  pin a.grip 12:12',
      '  fit needle.grip a.grip aim tip 22:12',
    ].join('\n')
    const a = render(src, 'fig')
    const b = render(src, 'fig')
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data))
  })
})
