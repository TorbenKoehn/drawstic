// W2-4: skeleton / pose system (ADR-0095) — named joints with rest angles + length + limits,
// deterministic forward kinematics, poses as angle deltas, `fit part.pin bone JOINT` inheriting the
// solved position + orientation, and auto-Z from bone depth. End-to-end where it matters
// (render → read pixels / read --explain records → assert) plus the pure FK solver directly.

import { describe, expect, test } from 'bun:test'
import { critiqueSprite, resolveProfile } from '../../src/critique.js'
import { DrawsticError } from '../../src/diagnostic.js'
import { Engine } from '../../src/eval.js'
import { type Skeleton, type Sprite, solveSkeleton } from '../../src/values.js'

let n = 0
const engineFor = (src: string): { engine: Engine; render: (drawing: string) => Sprite } => {
  const engine = new Engine(process.cwd())
  const mod = engine.loadSource(src, `${process.cwd()}\\skel${n++}.drw`, 'skel.drw')
  const render = (drawing: string): Sprite => {
    const entry = mod.definitions.get(drawing)
    if (!entry) {
      throw new Error(`no drawing ${drawing}`)
    }
    return engine.defToSprite(entry, { line: 1, column: 1 })
  }
  return { engine, render }
}

const alpha = (s: Sprite, x: number, y: number): number => s.data[(y * s.w + x) * 4 + 3] ?? 0

// A minimal humanoid recipe: a theme with a figure oracle, one skeleton, poses, and a plain part.
const RIG = [
  'theme t:',
  '  mode pixel',
  '  light sun = dir 1:1 #ffe6b0 amb #223344 18%',
  '  figure:',
  '    heads 3.5',
  '    headW 22',
  '    shoulderW 26',
  '    hipW 20',
  '',
  'skeleton body:',
  '  pelvis at fig.hip',
  '  chest at fig.shoulder',
  '  neck at fig.neck',
  '  shoulderL at fig.shoulderL',
  '  shoulderR at fig.shoulderR',
  '  hipL at fig.hipL',
  '  hipR at fig.hipR',
  '  armR from shoulderR 90 20 limit -120:60',
  '',
  'pose front over body:',
  '  view front',
  '  chest 0 z 1',
  '  neck 0 z 2',
  '  shoulderL 0 z 3',
  '  shoulderR 0 z 3',
  '  hipL 0 z 0',
  '  hipR 0 z 0',
  '',
  'pose wave over body:',
  '  view front',
  '  armR -80 z 5',
  '',
  'pose toofar over body:',
  '  view front',
  '  armR -200 z 5',
  '',
  'draw box 8x8:',
  '  fill #88aaff rect(0:0, 7:7)',
  '  pin c 4:0',
  '  pin tip 4:7',
  'draw box2 8x8:',
  '  fill #ffaa88 rect(0:0, 7:7)',
  '  pin c 4:0',
].join('\n')

describe('solveSkeleton — forward kinematics (pure)', () => {
  const skel: Skeleton = {
    type: 'skeleton',
    name: 's',
    joints: [
      {
        name: 'root',
        parent: null,
        anchor: { x: 10, y: 10 },
        restAngle: 0,
        length: 0,
        limit: null,
      },
      { name: 'arm', parent: 'root', anchor: null, restAngle: 90, length: 20, limit: null },
      { name: 'hand', parent: 'arm', anchor: null, restAngle: 0, length: 10, limit: null },
    ],
  }

  test('an FK chain places joints by angle + length off the parent', () => {
    const [root, arm, hand] = solveSkeleton(skel, new Map(), new Map())
    expect(root).toMatchObject({ x: 10, y: 10 })
    // arm at 90° (down) length 20 → (10, 30)
    expect(arm?.x).toBeCloseTo(10, 6)
    expect(arm?.y).toBeCloseTo(30, 6)
    // hand continues 0° local (still down, world 90°) length 10 → (10, 40)
    expect(hand?.x).toBeCloseTo(10, 6)
    expect(hand?.y).toBeCloseTo(40, 6)
  })

  test('a delta on a parent rotates the whole subtree (proper FK), and angleDelta accumulates', () => {
    // bend the arm by -90° (from down to right): arm → (30,10), hand carries the parent rotation.
    const [, arm, hand] = solveSkeleton(skel, new Map([['arm', -90]]), new Map())
    expect(arm?.x).toBeCloseTo(30, 6)
    expect(arm?.y).toBeCloseTo(10, 6)
    expect(arm?.angleDelta).toBeCloseTo(-90, 6)
    // hand inherits the arm's rotation: world angle 0°, so it extends +x off the arm tip → (40,10).
    expect(hand?.x).toBeCloseTo(40, 6)
    expect(hand?.y).toBeCloseTo(10, 6)
    expect(hand?.angleDelta).toBeCloseTo(-90, 6)
  })

  test('depth carries onto the solved joint', () => {
    const [, arm] = solveSkeleton(skel, new Map(), new Map([['arm', 4]]))
    expect(arm?.depth).toBe(4)
  })
})

describe('pose apply + bone fit', () => {
  test('a pose solves the skeleton over the drawing canvas (--explain)', () => {
    const { engine, render } = engineFor(
      [RIG, 'draw f 64x128:', '  use t', '  pose front', '  fit box.c bone chest'].join('\n'),
    )
    engine.poses = []
    render('f')
    const rec = engine.poses.find((p) => p.pose === 'front')
    expect(rec).toBeDefined()
    expect(rec?.view).toBe('front')
    // pelvis is the figure hip guide point (canvas centre, hipY = h/2).
    const pelvis = rec?.joints.find((j) => j.name === 'pelvis')
    expect(pelvis).toMatchObject({ x: 32, y: 64 })
  })

  test('fit part.pin bone JOINT lands the pin on the joint position', () => {
    const { engine, render } = engineFor(
      [RIG, 'draw f 64x128:', '  use t', '  pose front', '  fit box.c bone shoulderL'].join('\n'),
    )
    engine.placements = []
    render('f')
    const p = engine.placements.find((p) => p.source === 'bone shoulderL')
    expect(p).toBeDefined()
    expect(p?.coincident).toBe(true)
    // shoulderL guide point at (19, 47.5) → rounded landing.
    expect(p?.landed).toMatchObject({ x: 19 })
  })

  test('a bone fit inherits the pose orientation (the part is rotated)', () => {
    const { engine, render } = engineFor(
      [RIG, 'draw f 64x128:', '  use t', '  pose wave', '  fit box.c bone armR'].join('\n'),
    )
    engine.placements = []
    render('f')
    const p = engine.placements.find((p) => p.source === 'bone armR')
    expect(p?.transformed).toBe(true)
  })

  test('the rest pose leaves a bone-fit part unrotated (delta 0 ⇒ authored orientation)', () => {
    const { engine, render } = engineFor(
      [RIG, 'draw f 64x128:', '  use t', '  pose front', '  fit box.c bone chest'].join('\n'),
    )
    engine.placements = []
    render('f')
    const p = engine.placements.find((p) => p.source === 'bone chest')
    expect(p?.transformed).toBe(false)
  })
})

describe('angle constraints', () => {
  test('a pose delta outside a joint limit is a positioned error, never a silent clamp', () => {
    const { render } = engineFor(
      [RIG, 'draw f 64x128:', '  use t', '  pose toofar', '  fit box.c bone armR'].join('\n'),
    )
    expect(() => render('f')).toThrow(/outside its limit/)
    expect(() => render('f')).toThrow(DrawsticError)
  })

  test('a pose delta inside the limit renders fine', () => {
    const { render } = engineFor(
      [RIG, 'draw f 64x128:', '  use t', '  pose wave', '  fit box.c bone armR'].join('\n'),
    )
    expect(() => render('f')).not.toThrow()
  })
})

describe('auto-Z from bone depth', () => {
  // fit in a mixed statement order; depth (not statement order) must resolve the paint order.
  const SRC = [
    RIG,
    'draw f 64x128:',
    '  use t',
    '  pose front',
    '  fit box.c bone shoulderL', // z3 (top)
    '  fit box2.c bone hipL', // z0 (bottom)
    '  fit box.c bone neck', // z2 (middle)
  ].join('\n')

  test('the resolved paint order follows bone depth, not statement order', () => {
    const { engine, render } = engineFor(SRC)
    engine.paintOrders = []
    render('f')
    const order = engine.paintOrders.find((p) => p.drawing === 'f')?.order ?? []
    // bottom → top by depth: hipL(z0), neck(z2), shoulderL(z3)
    expect(order.map((o) => o.reason)).toEqual(['z0', 'z2', 'z3'])
  })

  test('an explicit behind/front override wins over auto-Z depth', () => {
    // shoulderL is z3 (highest) but declared `behind` the z0 hipL — the override must sink it below.
    const src = [
      RIG,
      'draw f 64x128:',
      '  use t',
      '  pose front',
      '  fit box.c bone hipL', // z0
      '  fit box2.c bone shoulderL behind box', // z3 but forced under box (hipL)
    ].join('\n')
    const { engine, render } = engineFor(src)
    engine.paintOrders = []
    render('f')
    const order = engine.paintOrders.find((p) => p.drawing === 'f')?.order ?? []
    // box2 (behind) is emitted first (bottom), box on top.
    expect(order[0]?.reason).toBe('behind box')
    expect(order[1]?.reason).toBe('z0')
  })

  test('auto-Z keeps C013 occlusion parity clean for a declared relation', () => {
    const src = [
      RIG,
      'draw f 64x128:',
      '  use t',
      '  pose front',
      '  fit box.c bone hipL',
      '  fit box2.c bone shoulderL front box', // box2 painted over box — honoured
    ].join('\n')
    const { render } = engineFor(src)
    const s = render('f')
    const r = critiqueSprite('f', s, { profile: resolveProfile('character'), strict: true })
    expect(r.checks.some((c) => c.code === 'C013')).toBe(false)
  })
})

describe('determinism', () => {
  test('two independent renders of a posed rig are byte-identical', () => {
    const src = [
      RIG,
      'draw f 64x128:',
      '  use t',
      '  pose wave',
      '  fit box.c bone chest',
      '  fit box.c bone armR',
    ].join('\n')
    const a = engineFor(src).render('f')
    const b = engineFor(src).render('f')
    expect(Buffer.from(a.data)).toEqual(Buffer.from(b.data))
  })
})

describe('contextual keywords', () => {
  test('skeleton / pose / bone stay ordinary bindable names outside their statement slots', () => {
    const src = [
      'draw d 8x8:',
      '  skeleton = 3',
      '  pose = skeleton + 1',
      '  bone = pose * 2',
      '  fill #fff rect(0:0, bone:bone)',
    ].join('\n')
    const s = engineFor(src).render('d')
    // bone = (3+1)*2 = 8 → clipped rect fills the whole 8×8 canvas corner region.
    expect(alpha(s, 0, 0)).toBe(255)
  })
})
