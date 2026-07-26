// C014 — view landmark parity (the cross-view placement check). The same figure drawn front/side/
// back must place its head, neck, shoulders and feet at the same *rows*; only widths may change.
// This is the defect class human review kept finding and every pixel check kept missing ("head
// floats above the neck", "hat sits too high").

import { describe, expect, test } from 'bun:test'
import { CRITIQUE_CODE, critiqueFamily, resolveProfile, viewLandmarks } from '../../src/critique.js'
import { Engine } from '../../src/eval.js'
import type { Sprite } from '../../src/values.js'

const engine = (): Engine => new Engine(process.cwd())

let n = 0
/** Renders every named draw of `src` into `{name, sprite}` family members. */
const family = (src: string, names: string[]): { name: string; sprite: Sprite }[] => {
  const e = engine()
  const mod = e.loadSource(src, `${process.cwd()}\\c014-${n++}.drw`, 'c014.drw')
  return names.map((name) => {
    const entry = mod.definitions.get(name)
    if (entry?.kind !== 'draw') {
      throw new Error(`no draw '${name}'`)
    }
    return { name, sprite: e.renderDraw(entry, [], entry.definition.span) }
  })
}

/** A three-view figure; `backHeadY` moves the back view's head to inject a placement defect. */
const figure = (backHeadY: number): string =>
  [
    'size 32x64',
    'mode pixel',
    '',
    'draw head 16x16:',
    '  fill #e0b080 circle(8:8, 7)',
    '',
    'draw torso 20x28:',
    '  fill #4060a0 rrect(0:0, 19:27, 3)',
    '',
    'draw figFront 32x64:',
    '  stamp torso 6:22',
    '  stamp head 8:8',
    '',
    'draw figSide 32x64:',
    '  stamp torso 6:22',
    '  stamp head 8:8',
    '',
    'draw figBack 32x64:',
    '  stamp torso 6:22',
    `  stamp head 8:${backHeadY}`,
    '',
  ].join('\n')

const VIEWS = ['figFront', 'figSide', 'figBack']
const character = { profile: resolveProfile('character') }

/** The landmarks of one rendered draw, via its coverage mask. */
const landmarksOf = (src: string, name: string): ReturnType<typeof viewLandmarks> => {
  const members = family(src, [name])
  const sprite = members[0]?.sprite
  if (!sprite) {
    throw new Error(`no sprite for '${name}'`)
  }
  const covered = new Uint8Array(sprite.w * sprite.h)
  for (let p = 0; p < covered.length; p++) {
    covered[p] = (sprite.data[p * 4 + 3] ?? 0) > 0 ? 1 : 0
  }
  return viewLandmarks(covered, sprite.w, sprite.h)
}

describe('viewLandmarks', () => {
  test('reads head top, neck, shoulder and ground contact off the coverage profile', () => {
    const lm = landmarksOf(figure(8), 'figFront')
    expect(lm).not.toBeNull()
    expect(lm?.top).toBe(9)
    expect(lm?.bottom).toBe(49)
    // the neck sits between head and torso, the shoulder line right below it
    expect(lm?.neck).toBeGreaterThan(lm?.top ?? 0)
    expect(lm?.shoulder).toBeGreaterThanOrEqual(lm?.neck ?? 0)
  })

  test('an empty sprite has no landmarks', () => {
    expect(landmarksOf('draw blank 8x8:\n  bg transparent\n', 'blank')).toBeNull()
  })
})

describe('C014 view landmark parity', () => {
  test('aligned views are silent', () => {
    const report = critiqueFamily(family(figure(8), VIEWS), character)
    expect(report?.checks.filter((c) => c.code === CRITIQUE_CODE.viewLandmarkParity)).toEqual([])
  })

  test('a head that drifted 6px up in one view is reported with the exact correction', () => {
    const report = critiqueFamily(family(figure(2), VIEWS), character)
    const found = report?.checks.filter((c) => c.code === CRITIQUE_CODE.viewLandmarkParity) ?? []
    expect(found.length).toBeGreaterThan(0)
    expect(found.every((c) => c.target === 'figBack')).toBe(true)
    const headTop = found.find((c) => c.message.includes('head top'))
    expect(headTop?.measured).toBe(6)
    expect(headTop?.severity).toBe('warning') // advisory: a one-view hat or crouch is legitimate
    expect(headTop?.fix).toContain('+6px on y')
  })

  test('it only compares views of the same subject, never two different characters', () => {
    const src = [
      figure(8),
      'draw orcFront 32x64:',
      '  fill #60a060 rect(4:30, 27:60)',
      '',
      'draw orcSide 32x64:',
      '  fill #60a060 rect(4:30, 27:60)',
      '',
    ].join('\n')
    const report = critiqueFamily(family(src, [...VIEWS, 'orcFront', 'orcSide']), character)
    // the orc sits far lower than the fig views; comparing across stems would flag every landmark
    expect(report?.checks.filter((c) => c.code === CRITIQUE_CODE.viewLandmarkParity)).toEqual([])
  })

  test('it does not run outside the character profile', () => {
    const report = critiqueFamily(family(figure(2), VIEWS), { profile: resolveProfile('item') })
    expect(report?.checks.filter((c) => c.code === CRITIQUE_CODE.viewLandmarkParity)).toEqual([])
  })
})
