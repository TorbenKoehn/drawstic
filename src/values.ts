// Runtime values: points, lists, gradients, first-class transforms
// (ADR-0044), regions (ADR-0036/0039), and rendered sprites.

import type { Color } from './color.js'
import { datan2, dcosDeg, dhypot, dsinDeg, PI, roundHalfUp } from './dmath.js'

/**
 * A 2D point. `rel` marks a point built with the `rel` keyword inside a `path` pen block — an
 * offset from the current pen position rather than an absolute canvas coordinate
 * (ADR-0061). Elsewhere points are always absolute.
 */
export type Point = { type: 'point'; x: number; y: number; rel: boolean }
export type PathPoint = { readonly x: number; readonly y: number }
/**
 * One subpath: an ordered polyline approximation of the authored commands, plus
 * whether it was closed (`close`/a closed shape) for fill/stroke purposes.
 */
export type PathContour = {
  readonly points: readonly PathPoint[]
  readonly closed: boolean
}
export type PathCommand =
  | { readonly kind: 'move'; readonly to: PathPoint }
  | { readonly kind: 'line'; readonly to: PathPoint }
  | { readonly kind: 'quad'; readonly control: PathPoint; readonly to: PathPoint }
  | {
      readonly kind: 'bezier'
      readonly control1: PathPoint
      readonly control2: PathPoint
      readonly to: PathPoint
    }
  | {
      readonly kind: 'arc'
      readonly center: PathPoint
      readonly to: PathPoint
      readonly clockwise: boolean
    }
  | { readonly kind: 'close' }
/**
 * A first-class vector value (ADR-0061): pen commands plus their polyline
 * approximation. `region` caches a region-backed path's coverage (e.g. from
 * {@link pathFromRegion}) so {@link pathFillRegion} doesn't need to re-derive it.
 */
export type Path = {
  type: 'path'
  contours: readonly PathContour[]
  commands: readonly PathCommand[]
  viewBox: { readonly width: number; readonly height: number } | undefined
  region: Region | undefined
}
export type List = { type: 'list'; items: Value[] }
/**
 * A gradient value. `angle` is degrees, clockwise, meaningful for `kind: 'linear'` only. `pos` is
 * 0..1 along the gradient axis; `null` stops are spaced evenly between pinned
 * neighbours. `space` selects the interpolation colour space (ADR-0009).
 */
export type Grad = {
  type: 'grad'
  kind: 'linear' | 'radial'
  angle: number
  stops: { c: Color; pos: number | null }[]
  space: 'oklch' | 'rgb' | 'hsl'
}
/**
 * A transform value. `m` is a 16-element row-major 4×4 homogeneous matrix — see the transforms
 * section below (ADR-0044) for layout and composition order.
 */
export type Transform = { type: 'transform'; m: readonly number[] }
/** Integer pixel bounds, inclusive on all four edges (`x0 <= x1`, `y0 <= y1`). */
export type BBox = { x0: number; y0: number; x1: number; y1: number }
export type Region = {
  type: 'region'
  bbox: BBox | null
  /** Pixel-mode coverage at integer pixel (x, y). */
  has: (x: number, y: number) => boolean
  /** Continuous coverage test for smooth mode. */
  test: (fx: number, fy: number) => boolean
}
/** A rendered drawing: straight-alpha RGBA8 bitmap + its palette artifact. */
export type Sprite = {
  type: 'sprite'
  name: string
  w: number
  h: number
  /**
   * The pixel store: `w × h × 4` bytes, row-major top-to-bottom, straight-alpha
   * RGBA8 per pixel (ADR-0025) — the same layout the framebuffer, PNG, JPEG, and
   * SVG encoders consume.
   */
  data: Uint8Array
  /**
   * Deterministic palette artifact (ADR-0002/ADR-0055): `key` is the single-char
   * grid key (or `''` for non-grid entries), `source` is the declaring definition
   * name, used to order/dedupe entries in indexed-PNG export.
   */
  pal: { key: string; color: Color; source: string }[]
  title: string | undefined
  desc: string | undefined
  /**
   * The drawing's exported attach points (ADR-0087): each `pin NAME PT` in the body registers a
   * named point in this sprite's own local coordinate space, so `fit` can land one part's pin
   * exactly on another's. `undefined`/empty for a drawing with no pins. Sprites produced by paths,
   * image imports, tilesets, and atlases carry none.
   */
  pins?: ReadonlyMap<string, { readonly x: number; readonly y: number }>
  /**
   * The measured result of each declared `behind`/`front` occlusion relation (ADR-0092), captured
   * during two-phase assembly for `critique`'s C013 occlusion-parity check. `behind`/`front` name the
   * two parts (behind = the part meant to be under, front = the occluder); `overlap` is how many
   * pixels their coverages share; `violating` is how many of those the behind-part is still the
   * visible top of in the final composite (0 ⇒ the declared occlusion holds). `undefined`/empty for a
   * drawing with no relations.
   */
  occlusions?: readonly OcclusionResult[]
}

/** One measured occlusion relation (ADR-0092, C013 support). See {@link Sprite.occlusions}. */
export type OcclusionResult = {
  readonly behind: string
  readonly front: string
  readonly clause: 'behind' | 'front'
  readonly overlap: number
  readonly violating: number
}

/**
 * A first-class light source (ADR-0086). `dir` is the unit vector of the light's *travel*
 * direction: `dir 1:1` means light moving down-right, so its source sits up-left and the lit
 * edge is the up-left one. When `pos` is set the light is a point source at that canvas
 * coordinate and `dir` is derived per region (source → region) rather than used verbatim —
 * see {@link Light} consumers in `shading.ts`. `color` is the (warm) light colour, `gain`
 * scales every derived shading dose (intensity, default 1), and `amb` is the optional
 * fill/ambient light — a cool colour plus a 0..1 amount that lifts shadows so they never go
 * pure black. Constructed via {@link light}; `dir` is always normalized.
 */
export type Light = {
  type: 'light'
  dir: { readonly x: number; readonly y: number }
  pos: { readonly x: number; readonly y: number } | null
  color: Color
  gain: number
  amb: { readonly color: Color; readonly amount: number } | null
}

/**
 * Material response families (ADR-0086); each selects a baked dose profile in `shading.ts`. The
 * single source of truth is {@link MATERIAL_RESPONSES} — {@link MaterialResponse} derives from it
 * so the parser's contextual keyword set (a response word is a keyword *only* in a `material`
 * binding's response slot) and the engine's dose table can never drift apart.
 */
export const MATERIAL_RESPONSES = ['flat', 'metal', 'skin', 'cloth', 'glass', 'glow'] as const
export type MaterialResponse = (typeof MATERIAL_RESPONSES)[number]

/** Whether `s` names a material response — the contextual keyword test used by parser and eval. */
export const isMaterialResponse = (s: string): s is MaterialResponse =>
  (MATERIAL_RESPONSES as readonly string[]).includes(s)

/**
 * Form-shading profiles (ADR-0091): how the Poisson height field inflates a region. `round` (the
 * default) solves the isotropic 2D field — a disc becomes a hemisphere, a stripe a half-cylinder,
 * darkening symmetrically toward every boundary. `drape` solves a **per-row 1D** field instead
 * (curvature only *across* each horizontal row, flat along its length): a hanging cloak/drape reads
 * as a vertical half-tube that does not darken toward its hem and whose lower edge stands off,
 * instead of curling into a downward-darkening "turtle shell" the isotropic field produces on a long
 * skirt. A contextual keyword in a `material` binding's trailing slot, like a response word.
 */
export const FORM_PROFILES = ['round', 'drape'] as const
export type FormProfile = (typeof FORM_PROFILES)[number]

/** Whether `s` names a form profile — the contextual keyword test used by parser and eval. */
export const isFormProfile = (s: string): s is FormProfile =>
  (FORM_PROFILES as readonly string[]).includes(s)

/**
 * A first-class material (ADR-0086, ADR-0091): a base colour plus a `response` that selects a baked
 * shading dose profile — never the colour, which stays the author's choice. The optional
 * `shade`/`hi`/`rim`/`ao`/`spec` fields override individual doses of that profile when present;
 * `puff` overrides the response's surface-curvature gain, and `spread` scales `hi`+`shade`
 * symmetrically (the one-knob value-spread control that replaces hand `.intersect` tone patches).
 * Constructed via {@link material}.
 */
export type Material = {
  type: 'material'
  base: Color
  response: MaterialResponse
  shade?: number
  hi?: number
  rim?: number
  ao?: number
  spec?: number
  puff?: number
  spread?: number
  profile?: FormProfile
}

export type Value =
  | number
  | boolean
  | string
  | Color
  | Point
  | List
  | Grad
  | Transform
  | Region
  | Path
  | Sprite
  | Light
  | Material
  | Figure
  | Skeleton
  | Pose

export const point = (x: number, y: number, rel = false): Point => ({ type: 'point', x, y, rel })
export const list = (items: Value[]): List => ({ type: 'list', items })
export const path = (
  contours: readonly PathContour[],
  commands: readonly PathCommand[] = [],
  viewBox?: { readonly width: number; readonly height: number },
  region?: Region,
): Path => ({ type: 'path', contours, commands, viewBox, region })

/** Normalize a 2D vector to unit length; a zero vector falls back to straight-down `(0, 1)`. */
export const unitVec = (x: number, y: number): { x: number; y: number } => {
  const len = dhypot(x, y)
  return len < 1e-9 ? { x: 0, y: 1 } : { x: x / len, y: y / len }
}

/**
 * Construct a {@link Light} (pure, deterministic). `dir` — the light's travel direction — is
 * always normalized; a point light (`pos` set) keeps a nominal `dir` (default straight-down)
 * that `shading.ts` overrides per region. `gain` defaults to 1, `amb` to none.
 */
export const light = (spec: {
  dir?: { x: number; y: number }
  pos?: { x: number; y: number } | null
  color: Color
  gain?: number
  amb?: { color: Color; amount: number } | null
}): Light => ({
  type: 'light',
  dir: unitVec(spec.dir?.x ?? 0, spec.dir?.y ?? 1),
  pos: spec.pos ?? null,
  color: spec.color,
  gain: spec.gain ?? 1,
  amb: spec.amb ?? null,
})

/**
 * Construct a {@link Material} (pure, deterministic). `response` defaults to `flat`. Dose
 * overrides are attached only when defined (satisfies `exactOptionalPropertyTypes`).
 */
export const material = (
  base: Color,
  response: MaterialResponse = 'flat',
  overrides: {
    shade?: number
    hi?: number
    rim?: number
    ao?: number
    spec?: number
    puff?: number
    spread?: number
    profile?: FormProfile
  } = {},
): Material => ({
  type: 'material',
  base,
  response,
  ...(overrides.shade !== undefined ? { shade: overrides.shade } : {}),
  ...(overrides.hi !== undefined ? { hi: overrides.hi } : {}),
  ...(overrides.rim !== undefined ? { rim: overrides.rim } : {}),
  ...(overrides.ao !== undefined ? { ao: overrides.ao } : {}),
  ...(overrides.spec !== undefined ? { spec: overrides.spec } : {}),
  ...(overrides.puff !== undefined ? { puff: overrides.puff } : {}),
  ...(overrides.spread !== undefined ? { spread: overrides.spread } : {}),
  ...(overrides.profile !== undefined ? { profile: overrides.profile } : {}),
})

// ── figure proportions oracle (ADR-0093) ───────────────────────────────────

/** Which projection of a figure a guide point is read for. */
export const FIGURE_VIEWS = ['front', 'side', 'back'] as const
export type FigureView = (typeof FIGURE_VIEWS)[number]

/** Whether `s` names a figure view — the contextual keyword test used by the `fig` getters. */
export const isFigureView = (s: string): s is FigureView =>
  (FIGURE_VIEWS as readonly string[]).includes(s)

/**
 * The resolved proportion numbers a {@link Figure} carries (ADR-0093). `heads` is the figure's total
 * height in head-heights; `headW`/`neckW`/`shoulderW`/`hipW`/`eyeSep` are pixel widths; `eyeLine`/
 * `earLine` are fractions of the head height measured from the crown. These are the PROJECT's numbers
 * (declared in a theme's `figure` block) — the engine derives named guide points from them, so an
 * author reads a position instead of inventing it.
 */
export type FigureProps = {
  readonly heads: number
  readonly headW: number
  readonly eyeLine: number
  readonly earLine: number
  readonly eyeSep: number
  readonly neckW: number
  readonly shoulderW: number
  readonly hipW: number
}
/** The declared subset of {@link FigureProps} (a theme need only state what differs from the defaults). */
export type FigureSpec = Partial<FigureProps>

/**
 * A first-class figure proportions value (ADR-0093), bound as `fig` in a drawing whose theme declares
 * a `figure` block. It maps the theme's proportion numbers onto the drawing's own `w`×`h` canvas and
 * a `view`, exposing named guide points (`fig.crown`, `fig.eyeL`, `fig.earR`, `fig.neckL`, …) and
 * scalars (`fig.headH`, `fig.headW`, …) — see {@link figureField}. `fig.front`/`fig.side`/`fig.back`
 * re-view the same numbers; view-dependent getters take the view from that or an optional argument.
 */
export type Figure = {
  type: 'figure'
  readonly w: number
  readonly h: number
  readonly view: FigureView
  readonly props: FigureProps
}

/**
 * Resolve a {@link FigureSpec} into full {@link FigureProps}: canvas-independent defaults, with the
 * derived widths (`eyeSep`/`neckW`/`shoulderW`/`hipW`) scaling off `headW` when not stated so a theme
 * that declares only `headW` still gets a coherent set.
 */
export const figure = (
  w: number,
  h: number,
  spec: FigureSpec,
  view: FigureView = 'front',
): Figure => {
  const headW = spec.headW ?? 24
  const props: FigureProps = {
    heads: spec.heads ?? 4,
    headW,
    eyeLine: spec.eyeLine ?? 0.6,
    earLine: spec.earLine ?? 0.55,
    eyeSep: spec.eyeSep ?? headW * 0.42,
    neckW: spec.neckW ?? headW * 0.5,
    shoulderW: spec.shoulderW ?? headW * 1.5,
    hipW: spec.hipW ?? headW * 1.15,
  }
  return { type: 'figure', w, h, view, props }
}

/** The result of reading one {@link Figure} field: a scalar, a guide point, or a re-viewed figure. */
export type FigureField =
  | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'point'; readonly x: number; readonly y: number }
  | { readonly kind: 'figure'; readonly figure: Figure }

/**
 * Read a named guide value off a figure (ADR-0093), pure and deterministic. The figure is laid out
 * over its full canvas height: the crown sits at `y=0`, one head is `h/heads` tall, so `chin`, the
 * eye/ear lines, the shoulder and hip lines all fall out of the head height. Widths come straight from
 * the props. View selection: `front`/`side`/`back` return a re-viewed figure; every other name is a
 * scalar (`kind:'num'`) or a guide point (`kind:'point'`). Side view faces `+x`, so its single eye is
 * shifted forward off centre and its ear sits toward the back — the structural fix for "eyes too
 * central in profile". Returns `undefined` for an unknown name.
 */
export const figureField = (fig: Figure, name: string): FigureField | undefined => {
  if (isFigureView(name)) {
    return { kind: 'figure', figure: { ...fig, view: name } }
  }
  const { w, h, view, props } = fig
  const cx = w / 2
  const headH = props.heads > 0 ? h / props.heads : h
  const crownY = 0
  const chinY = headH
  const eyeY = props.eyeLine * headH
  const earY = props.earLine * headH
  const shoulderY = headH * 1.3
  const hipY = h * 0.5
  const num = (value: number): FigureField => ({ kind: 'num', value })
  const pt = (x: number, y: number): FigureField => ({ kind: 'point', x, y })
  const facing = props.headW * 0.28
  const earBack = props.headW * 0.18
  switch (name) {
    // scalars
    case 'heads':
      return num(props.heads)
    case 'headW':
      return num(props.headW)
    case 'headH':
      return num(headH)
    case 'eyeLine':
      return num(props.eyeLine)
    case 'earLine':
      return num(props.earLine)
    case 'eyeSep':
      return num(props.eyeSep)
    case 'neckW':
      return num(props.neckW)
    case 'shoulderW':
      return num(props.shoulderW)
    case 'hipW':
      return num(props.hipW)
    case 'center':
      return num(cx)
    case 'eyeY':
      return num(eyeY)
    case 'earY':
      return num(earY)
    case 'crownY':
      return num(crownY)
    case 'chinY':
      return num(chinY)
    case 'shoulderY':
      return num(shoulderY)
    case 'hipY':
      return num(hipY)
    // view-independent guide points
    case 'crown':
      return pt(cx, crownY)
    case 'chin':
      return pt(cx, chinY)
    case 'neck':
      return pt(cx, chinY)
    case 'neckL':
      return pt(cx - props.neckW / 2, chinY)
    case 'neckR':
      return pt(cx + props.neckW / 2, chinY)
    case 'shoulder':
      return pt(cx, shoulderY)
    case 'hip':
      return pt(cx, hipY)
    // view-dependent guide points
    case 'eye':
      return view === 'side' ? pt(cx + facing, eyeY) : pt(cx, eyeY)
    case 'eyeL':
      return view === 'side' ? pt(cx + facing, eyeY) : pt(cx - props.eyeSep / 2, eyeY)
    case 'eyeR':
      return view === 'side' ? pt(cx + facing, eyeY) : pt(cx + props.eyeSep / 2, eyeY)
    case 'ear':
      return view === 'side' ? pt(cx - earBack, earY) : pt(cx + props.headW / 2, earY)
    case 'earL':
      return view === 'side' ? pt(cx - earBack, earY) : pt(cx - props.headW / 2, earY)
    case 'earR':
      return view === 'side' ? pt(cx - earBack, earY) : pt(cx + props.headW / 2, earY)
    case 'shoulderL':
      return view === 'side'
        ? pt(cx - props.shoulderW * 0.18, shoulderY)
        : pt(cx - props.shoulderW / 2, shoulderY)
    case 'shoulderR':
      return view === 'side'
        ? pt(cx + props.shoulderW * 0.18, shoulderY)
        : pt(cx + props.shoulderW / 2, shoulderY)
    case 'hipL':
      return view === 'side' ? pt(cx - props.hipW * 0.18, hipY) : pt(cx - props.hipW / 2, hipY)
    case 'hipR':
      return view === 'side' ? pt(cx + props.hipW * 0.18, hipY) : pt(cx + props.hipW / 2, hipY)
    default:
      return undefined
  }
}

// ── skeleton / pose (ADR-0095) ──────────────────────────────────────────────

/**
 * One joint of a {@link Skeleton} rig (ADR-0095): a node in the parent-tree. A joint is either
 * **anchored** (`anchor` set — its position is a fixed point, typically a `fig` guide point, so the
 * rig binds to the same proportion numbers as the figure oracle, ADR-0093) or **FK** (`anchor` null —
 * its position is derived by forward kinematics from `restAngle` + `length` off its parent). `limit`
 * bounds the pose delta this joint may take (degrees); `null` = unconstrained.
 */
export type SkeletonJoint = {
  readonly name: string
  readonly parent: string | null
  readonly anchor: { readonly x: number; readonly y: number } | null
  readonly restAngle: number
  readonly length: number
  readonly limit: { readonly min: number; readonly max: number } | null
}

/**
 * A skeleton rig (ADR-0095): a named parent-tree of {@link SkeletonJoint}s (parents precede children).
 * A first-class value, resolved over a drawing's canvas + figure oracle when a `pose` is applied.
 */
export type Skeleton = {
  type: 'skeleton'
  readonly name: string
  readonly joints: readonly SkeletonJoint[]
}

/**
 * A pose over a skeleton (ADR-0095): per-joint angle **deltas** (added to each joint's rest angle),
 * the `view` it projects, and per-joint auto-Z **depth** (higher = nearer the viewer). A first-class
 * value; applied in a drawing with `pose NAME`, which solves the skeleton and binds bone anchors.
 */
export type Pose = {
  type: 'pose'
  readonly name: string
  readonly skeleton: string
  readonly view: FigureView
  readonly deltas: ReadonlyMap<string, number>
  readonly depth: ReadonlyMap<string, number>
}

/**
 * A joint after forward kinematics (ADR-0095): its posed world position, the world angle in both the
 * rest and posed configurations, and the accumulated `angleDelta` (posed − rest) a part fitted to the
 * bone inherits as its orientation. `depth` is the joint's view depth (auto-Z ordering key).
 */
export type SolvedJoint = {
  readonly name: string
  readonly parent: string | null
  readonly x: number
  readonly y: number
  readonly px: number
  readonly py: number
  readonly worldAngle: number
  readonly restWorldAngle: number
  readonly angleDelta: number
  readonly depth: number
}

/**
 * Solve a {@link Skeleton} into world-space {@link SolvedJoint}s (ADR-0095), pure and deterministic
 * (dmath only). Walks the joints in declared order (parents first): an **anchored** joint sits at its
 * fixed point and its bone direction is measured from its parent; an **FK** joint is placed at
 * `parent + length·(cos, sin)` of the accumulated world angle. Pose deltas add to each joint's local
 * angle, so a delta on a parent rotates the whole subtree (proper forward kinematics). A part fitted
 * to a joint inherits its posed position and its `angleDelta`.
 */
export const solveSkeleton = (
  skel: Skeleton,
  deltas: ReadonlyMap<string, number>,
  depth: ReadonlyMap<string, number>,
): SolvedJoint[] => {
  const solved = new Map<string, SolvedJoint>()
  const out: SolvedJoint[] = []
  for (const j of skel.joints) {
    const delta = deltas.get(j.name) ?? 0
    const parent = j.parent !== null ? solved.get(j.parent) : undefined
    let x: number
    let y: number
    let px: number
    let py: number
    let restWorldAngle: number
    let worldAngle: number
    if (j.anchor) {
      x = j.anchor.x
      y = j.anchor.y
      px = parent ? parent.x : x
      py = parent ? parent.y : y
      // The bone direction of an anchored joint is measured from its parent (0 for a parentless root).
      restWorldAngle = parent ? (datan2(y - py, x - px) * 180) / PI : 0
      worldAngle = restWorldAngle + delta
    } else if (parent) {
      px = parent.x
      py = parent.y
      restWorldAngle = parent.restWorldAngle + j.restAngle
      worldAngle = parent.worldAngle + j.restAngle + delta
      x = px + j.length * dcosDeg(worldAngle)
      y = py + j.length * dsinDeg(worldAngle)
    } else {
      // FK root with no anchor: sits at the origin, its rest angle is its world base.
      x = 0
      y = 0
      px = 0
      py = 0
      restWorldAngle = j.restAngle
      worldAngle = j.restAngle + delta
    }
    const sj: SolvedJoint = {
      name: j.name,
      parent: j.parent,
      x,
      y,
      px,
      py,
      worldAngle,
      restWorldAngle,
      angleDelta: worldAngle - restWorldAngle,
      depth: depth.get(j.name) ?? 0,
    }
    solved.set(j.name, sj)
    out.push(sj)
  }
  return out
}

export const isObj = (v: Value): v is Exclude<Value, number | boolean | string> =>
  typeof v === 'object' && v !== null

export const typeName = (v: Value): string => {
  if (typeof v === 'number') {
    return 'number'
  }
  if (typeof v === 'boolean') {
    return 'boolean'
  }
  if (typeof v === 'string') {
    return 'string'
  }
  return v.type
}

// ── transforms: 4×4 homogeneous, row-major (ADR-0044) ───────────────────────

export const IDENTITY: readonly number[] = Object.freeze([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
])

/**
 * Row-major 4×4 matrix product `a·b` — applies `b` first, then `a`; callers pick
 * the order (see {@link compose} for the reading-order-as-application-order form).
 */
export const multiplyMatrix = (a: readonly number[], b: readonly number[]): readonly number[] => {
  const r = new Array<number>(16).fill(0)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) {
        s += (a[i * 4 + k] ?? 0) * (b[k * 4 + j] ?? 0)
      }
      r[i * 4 + j] = s
    }
  }
  return r
}

/** Reading-order composition: `first.then(second)` → second ∘ first. */
export const compose = (first: readonly number[], second: readonly number[]): readonly number[] =>
  multiplyMatrix(second, first)

/**
 * Maps `(x, y)` through `m` in homogeneous coordinates (implicit `z = 0`) and
 * perspective-divides by the resulting `w`. Returns `null` when `w = 0` — the point
 * maps to infinity (a non-invertible projection, ADR-0044 §5).
 */
export const applyMatrix = (
  m: readonly number[],
  x: number,
  y: number,
): { x: number; y: number } | null => {
  const resultX = (m[0] ?? 0) * x + (m[1] ?? 0) * y + (m[3] ?? 0)
  const resultY = (m[4] ?? 0) * x + (m[5] ?? 0) * y + (m[7] ?? 0)
  const resultW = (m[12] ?? 0) * x + (m[13] ?? 0) * y + (m[15] ?? 1)
  if (resultW === 0) {
    return null
  }
  return { x: resultX / resultW, y: resultY / resultW }
}

/** Translation by `(dx, dy)` pixels. */
export const translation = (dx: number, dy: number): number[] => [
  1,
  0,
  0,
  dx,
  0,
  1,
  0,
  dy,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
]

/**
 * Rotation by degrees, clockwise on screen (y-down raster coords). Exact at
 * multiples of 90° so quarter-turns stay lossless (ADR-0043).
 */
export const rotationDeg = (deg: number): number[] => {
  const c = dcosDeg(deg)
  const s = dsinDeg(deg)
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/** Non-uniform scale about the origin `0:0`. */
export const scaling = (sx: number, sy: number): number[] => [
  sx,
  0,
  0,
  0,
  0,
  sy,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
]

/** Horizontal shear by degrees (x' = x + y·tan(deg)). */
export const skewX = (deg: number): number[] => {
  const t = dsinDeg(deg) / dcosDeg(deg)
  return [1, t, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/**
 * A 3D rotation by degrees about the x-axis, projected back to the plane by a
 * paired {@link perspectiveMatrix} (ADR-0044 §1) — used for card-flip effects.
 */
export const rotationXDeg = (deg: number): number[] => {
  const c = dcosDeg(deg)
  const s = dsinDeg(deg)
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
}

/** A 3D rotation by degrees about the y-axis; see {@link rotationXDeg}. */
export const rotationYDeg = (deg: number): number[] => {
  const c = dcosDeg(deg)
  const s = dsinDeg(deg)
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]
}

/**
 * Perspective projection at distance `d` pixels; applies to subsequent 3D terms
 * in a composed transform (ADR-0044).
 */
export const perspectiveMatrix = (d: number): number[] => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  -1 / d,
  1,
]

/** Conjugate m to the pivot p: T(p) · m · T(−p). */
export const aboutPoint = (m: readonly number[], px: number, py: number): readonly number[] =>
  multiplyMatrix(translation(px, py), multiplyMatrix(m, translation(-px, -py)))

/** The 4×4 matrix inverse via Gauss-Jordan; `undefined` when singular (non-invertible). */
export const invertMatrix = (m: readonly number[]): readonly number[] | undefined => {
  const a = m.slice()
  const inv = IDENTITY.slice()
  for (let col = 0; col < 4; col++) {
    // pivot: largest |value| in this column
    let piv = col
    for (let r = col + 1; r < 4; r++) {
      if (Math.abs(a[r * 4 + col] ?? 0) > Math.abs(a[piv * 4 + col] ?? 0)) {
        piv = r
      }
    }
    const pv = a[piv * 4 + col] ?? 0
    if (Math.abs(pv) < 1e-12) {
      return undefined
    }
    if (piv !== col) {
      for (let k = 0; k < 4; k++) {
        const t1 = a[col * 4 + k] as number
        a[col * 4 + k] = a[piv * 4 + k] as number
        a[piv * 4 + k] = t1
        const t2 = inv[col * 4 + k] as number
        inv[col * 4 + k] = inv[piv * 4 + k] as number
        inv[piv * 4 + k] = t2
      }
    }
    const d = a[col * 4 + col] as number
    for (let k = 0; k < 4; k++) {
      a[col * 4 + k] = (a[col * 4 + k] as number) / d
      inv[col * 4 + k] = (inv[col * 4 + k] as number) / d
    }
    for (let r = 0; r < 4; r++) {
      if (r === col) {
        continue
      }
      const f = a[r * 4 + col] as number
      if (f === 0) {
        continue
      }
      for (let k = 0; k < 4; k++) {
        a[r * 4 + k] = (a[r * 4 + k] as number) - f * (a[col * 4 + k] as number)
        inv[r * 4 + k] = (inv[r * 4 + k] as number) - f * (inv[col * 4 + k] as number)
      }
    }
  }
  return inv
}

// ── regions (extensional coverage, ADR-0039) ────────────────────────────────

export const emptyRegion: Region = {
  type: 'region',
  bbox: null,
  has: () => false,
  test: () => false,
}

/** Midpoint-circle span table: spans[|dy|] = max |dx| on that row (ADR-0028). */
export const circleSpans = (r: number): number[] => {
  const spans = new Array<number>(r + 1).fill(-1)
  let x = r
  let y = 0
  let e = 1 - r
  while (x >= y) {
    if ((spans[y] ?? -1) < x) {
      spans[y] = x
    }
    if ((spans[x] ?? -1) < y) {
      spans[x] = y
    }
    y++
    if (e < 0) {
      e += 2 * y + 1
    } else {
      x--
      e += 2 * (y - x) + 1
    }
  }
  return spans
}

/**
 * Even-diameter circle: footprint spans `cx-ri..cx+ri-1` (`ri = round(r)`) on each
 * axis — `2·ri` pixels wide/tall — with the disc centred at the pixel-corner
 * `(cx-0.5, cy-0.5)` so the declared radius yields a balanced pixel-perfect
 * diameter; `r = 0` is a single pixel (ADR-0056, supersedes the odd-footprint rule
 * of ADR-0028 §3). {@link ellipseRegion} shares this convention (ADR-0087), so a
 * circle is exactly the `rx === ry` ellipse — one centering rule for both shapes.
 */
export const circleRegion = (cx: number, cy: number, r: number): Region => {
  const ri = Math.max(0, roundHalfUp(r))
  if (ri === 0) {
    return {
      type: 'region',
      bbox: { x0: cx, y0: cy, x1: cx, y1: cy },
      has: (x, y) => x === cx && y === cy,
      test: (fx, fy) => fx === cx && fy === cy,
    }
  }
  const pcx = cx - 0.5
  const pcy = cy - 0.5
  const r2 = ri * ri
  return {
    type: 'region',
    bbox: { x0: cx - ri, y0: cy - ri, x1: cx + ri - 1, y1: cy + ri - 1 },
    has: (x, y) => {
      if (x < cx - ri || x > cx + ri - 1 || y < cy - ri || y > cy + ri - 1) {
        return false
      }
      const dx = x - pcx
      const dy = y - pcy
      return dx * dx + dy * dy <= r2
    },
    test: (fx, fy) => {
      const dx = fx - pcx
      const dy = fy - pcy
      return dx * dx + dy * dy <= r * r
    },
  }
}

/**
 * Even-diameter ellipse — `circle` with independent `rx`/`ry` (ADR-0087). Mirrors
 * {@link circleRegion}'s convention exactly: each axis spans a `2·ri` pixel
 * footprint (`cx-rxi..cx+rxi-1` × `cy-ryi..cy+ryi-1`, `ri = round(r)`) with the disc
 * centred at the pixel-corner `(cx-0.5, cy-0.5)`, so `ellipseRegion(cx, cy, r, r)`
 * is pixel-identical to `circleRegion(cx, cy, r)`. A zero axis collapses to the
 * single integer column/row `cx`/`cy` (the `r=0` dot generalized per axis); both
 * zero is one pixel. Supersedes the odd integer-pixel-centred rule of ADR-0028 §3
 * the same way ADR-0056 did for `circle`. The membership test is cross-multiplied
 * to integers (`dx²·ryi² + dy²·rxi² ≤ (rxi·ryi)²`) so it is exact and reduces to
 * `circleRegion`'s `dx² + dy² ≤ ri²` when `rxi === ryi`.
 */
export const ellipseRegion = (cx: number, cy: number, rx: number, ry: number): Region => {
  const rxi = Math.max(0, roundHalfUp(rx))
  const ryi = Math.max(0, roundHalfUp(ry))
  const x0 = rxi === 0 ? cx : cx - rxi
  const x1 = rxi === 0 ? cx : cx + rxi - 1
  const y0 = ryi === 0 ? cy : cy - ryi
  const y1 = ryi === 0 ? cy : cy + ryi - 1
  const pcx = cx - 0.5
  const pcy = cy - 0.5
  const inBox = (x: number, y: number): boolean => x >= x0 && x <= x1 && y >= y0 && y <= y1
  // Continuous coverage (smooth mode): the same corner-centred ellipse, cross-
  // multiplied to sidestep a divide-by-zero on a degenerate axis; matches
  // circleRegion.test when rx === ry.
  const test = (fx: number, fy: number): boolean => {
    if (rx === 0 || ry === 0) {
      return false
    }
    const dx = (fx - pcx) * ry
    const dy = (fy - pcy) * rx
    return dx * dx + dy * dy <= rx * rx * ry * ry
  }
  // A degenerate axis is already a 1px line/dot, so its bbox is its coverage.
  if (rxi === 0 || ryi === 0) {
    return { type: 'region', bbox: { x0, y0, x1, y1 }, has: inBox, test }
  }
  const rx2 = rxi * rxi
  const ry2 = ryi * ryi
  const limit = rx2 * ry2
  return {
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => {
      if (!inBox(x, y)) {
        return false
      }
      const dx = x - pcx
      const dy = y - pcy
      return dx * dx * ry2 + dy * dy * rx2 <= limit
    },
    test,
  }
}

/** Axis-aligned rect between two opposite corners, either order. */
export const rectRegion = (ax: number, ay: number, bx: number, by: number): Region => {
  const x0 = Math.min(ax, bx)
  const y0 = Math.min(ay, by)
  const x1 = Math.max(ax, bx)
  const y1 = Math.max(ay, by)
  return {
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
    test: (fx, fy) => fx >= x0 - 0.5 && fx <= x1 + 0.5 && fy >= y0 - 0.5 && fy <= y1 + 0.5,
  }
}

/**
 * Rounded rect; the corner radius is clamped to at most half the shorter side so
 * corners never overlap.
 */
export const rrectRegion = (ax: number, ay: number, bx: number, by: number, r: number): Region => {
  const x0 = Math.min(ax, bx)
  const y0 = Math.min(ay, by)
  const x1 = Math.max(ax, bx)
  const y1 = Math.max(ay, by)
  const ri = Math.max(
    0,
    Math.min(roundHalfUp(r), Math.floor((x1 - x0) / 2), Math.floor((y1 - y0) / 2)),
  )
  const spans = circleSpans(ri)
  const cornerHas = (x: number, y: number): boolean => {
    // corner centres, inset by ri
    const cx = x < x0 + ri ? x0 + ri : x > x1 - ri ? x1 - ri : null
    const cy = y < y0 + ri ? y0 + ri : y > y1 - ri ? y1 - ri : null
    if (cx === null || cy === null) {
      return true // edge band, not a corner square
    }
    const dy = Math.abs(y - cy)
    return Math.abs(x - cx) <= (spans[dy] ?? -1)
  }
  return {
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && cornerHas(x, y),
    test: (fx, fy) => {
      if (fx < x0 - 0.5 || fx > x1 + 0.5 || fy < y0 - 0.5 || fy > y1 + 0.5) {
        return false
      }
      const cx = fx < x0 + ri ? x0 + ri : fx > x1 - ri ? x1 - ri : null
      const cy = fy < y0 + ri ? y0 + ri : fy > y1 - ri ? y1 - ri : null
      if (cx === null || cy === null) {
        return true
      }
      const dx = fx - cx
      const dy = fy - cy
      return dx * dx + dy * dy <= r * r
    },
  }
}

/** Polygon region: even-odd scanline fill + inclusive Bresenham boundary. */
export const polyRegion = (pts: { x: number; y: number }[]): Region => {
  if (pts.length < 2) {
    return emptyRegion
  }
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  x0 = Math.floor(x0)
  y0 = Math.floor(y0)
  x1 = Math.ceil(x1)
  y1 = Math.ceil(y1)
  const testFill = (fx: number, fy: number): boolean => {
    let inside = false
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i] as { x: number; y: number }
      const b = pts[j] as { x: number; y: number }
      if (a.y <= fy !== b.y <= fy) {
        const xInt = a.x + ((fy - a.y) / (b.y - a.y)) * (b.x - a.x)
        if (fx < xInt) {
          inside = !inside
        }
      }
    }
    return inside
  }
  // lazy pixel bitmap: fill + boundary lines (inclusive endpoints, ADR-0028)
  let bitmap: Uint8Array | null = null
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  const build = (): Uint8Array => {
    const bm = new Uint8Array(bw * bh)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (testFill(x, y)) {
          bm[(y - y0) * bw + (x - x0)] = 1
        }
      }
    }
    // closed boundary via Bresenham
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as { x: number; y: number }
      const b = pts[(i + 1) % pts.length] as { x: number; y: number }
      bresenham(roundHalfUp(a.x), roundHalfUp(a.y), roundHalfUp(b.x), roundHalfUp(b.y), (x, y) => {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
          bm[(y - y0) * bw + (x - x0)] = 1
        }
      })
    }
    return bm
  }
  return {
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) {
        return false
      }
      bitmap ??= build()
      return bitmap[(y - y0) * bw + (x - x0)] === 1
    },
    test: testFill,
  }
}

/** Bresenham line, endpoints inclusive (ADR-0028 §4). */
export const bresenham = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: (x: number, y: number) => void,
): void => {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let e = dx + dy
  for (;;) {
    plot(x, y)
    if (x === x1 && y === y1) {
      break
    }
    const e2 = 2 * e
    if (e2 >= dy) {
      e += dy
      x += sx
    }
    if (e2 <= dx) {
      e += dx
      y += sy
    }
  }
}

export const bboxUnion = (a: BBox | null, b: BBox | null): BBox | null => {
  if (!a) {
    return b
  }
  if (!b) {
    return a
  }
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  }
}

export const bboxIntersect = (a: BBox | null, b: BBox | null): BBox | null => {
  if (!a || !b) {
    return null
  }
  const r = {
    x0: Math.max(a.x0, b.x0),
    y0: Math.max(a.y0, b.y0),
    x1: Math.min(a.x1, b.x1),
    y1: Math.min(a.y1, b.y1),
  }
  return r.x0 > r.x1 || r.y0 > r.y1 ? null : r
}

export const regionUnion = (a: Region, b: Region): Region => ({
  type: 'region',
  bbox: bboxUnion(a.bbox, b.bbox),
  has: (x, y) => a.has(x, y) || b.has(x, y),
  test: (fx, fy) => a.test(fx, fy) || b.test(fx, fy),
})

export const regionIntersect = (a: Region, b: Region): Region => ({
  type: 'region',
  bbox: bboxIntersect(a.bbox, b.bbox),
  has: (x, y) => a.has(x, y) && b.has(x, y),
  test: (fx, fy) => a.test(fx, fy) && b.test(fx, fy),
})

/**
 * Region difference (`a` minus `b`); the bbox stays `a`'s (an over-approximation — not tightened to
 * the actual remaining coverage).
 */
export const regionSubtract = (a: Region, b: Region): Region => ({
  type: 'region',
  bbox: a.bbox,
  has: (x, y) => a.has(x, y) && !b.has(x, y),
  test: (fx, fy) => a.test(fx, fy) && !b.test(fx, fy),
})

export const regionXor = (a: Region, b: Region): Region => ({
  type: 'region',
  bbox: bboxUnion(a.bbox, b.bbox),
  has: (x, y) => a.has(x, y) !== b.has(x, y),
  test: (fx, fy) => a.test(fx, fy) !== b.test(fx, fy),
})

// ── organic region constructors (ADR-0093) ──────────────────────────────────
// Style-neutral parametric shapes for heads/ears/hair/headwear: LLMs are poor at inventing point
// lists but good at parametrising named forms. All four share the even-diameter, corner-centred
// convention (ADR-0056/ADR-0087) — membership is sampled at the pixel corner so a symmetric shape
// gets a balanced `2·r` footprint — and are exact analytic tests (no polyline blocking at small
// sizes). Each is a first-class Region: maskable, model/cel-shadeable, and outline-able.

/**
 * Dome / cap (ADR-0093): the upper half of {@link ellipseRegion}`(cx, cy, rx, ry)` with a flat
 * bottom edge — a skull, helmet, or hat crown. It occupies rows `cy-ry .. cy-1` (the flat edge is the
 * widest row `cy-1`), so `(cx, cy)` is the pixel-corner centre of the flat base. By construction
 * `dome(c, rx, ry).has(x, y) === ellipse(c, rx, ry).has(x, y) && y <= cy-1` — one convention shared
 * with the ellipse it is half of.
 */
export const domeRegion = (cx: number, cy: number, rx: number, ry: number): Region => {
  const rxi = Math.max(0, roundHalfUp(rx))
  const ryi = Math.max(0, roundHalfUp(ry))
  if (rxi === 0 || ryi === 0) {
    return emptyRegion
  }
  const full = ellipseRegion(cx, cy, rx, ry)
  return {
    type: 'region',
    bbox: { x0: cx - rxi, y0: cy - ryi, x1: cx + rxi - 1, y1: cy - 1 },
    has: (x, y) => y <= cy - 1 && full.has(x, y),
    test: (fx, fy) => fy <= cy - 0.5 && full.test(fx, fy),
  }
}

/**
 * Lobe / teardrop (ADR-0093): round at `base` (a semicircle cap of diameter `w`), tapering smoothly
 * to a point at `tip` — ears, hair strands, a side nose, a plume, a hat tassel. The half-width along
 * the base→tip axis is `w/2` at the base and shrinks as a half-ellipse to 0 at the tip (C¹-smooth at
 * the base join). Exact analytic membership (axial + perpendicular projection), sampled at the pixel
 * corner so a vertical lobe gets a symmetric even footprint.
 */
export const lobeRegion = (bx: number, by: number, tx: number, ty: number, w: number): Region => {
  const r = Math.max(0.5, w / 2)
  const dx = tx - bx
  const dy = ty - by
  const len = dhypot(dx, dy)
  const ux = len < 1e-9 ? 0 : dx / len
  const uy = len < 1e-9 ? 1 : dy / len
  const inside = (px: number, py: number): boolean => {
    const rx0 = px - bx
    const ry0 = py - by
    const s = rx0 * ux + ry0 * uy // axial distance from base
    const perp = Math.abs(-rx0 * uy + ry0 * ux) // perpendicular distance
    if (s < 0) {
      return dhypot(s, perp) <= r // rounded base cap
    }
    if (s > len) {
      return false
    }
    const frac = len < 1e-9 ? 0 : s / len
    const hw = r * Math.sqrt(Math.max(0, 1 - frac * frac))
    return perp <= hw
  }
  const pad = Math.ceil(r) + 1
  const x0 = Math.floor(Math.min(bx, tx)) - pad
  const y0 = Math.floor(Math.min(by, ty)) - pad
  const x1 = Math.ceil(Math.max(bx, tx)) + pad
  const y1 = Math.ceil(Math.max(by, ty)) + pad
  return {
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && inside(x + 0.5, y + 0.5),
    test: (fx, fy) => inside(fx + 0.5, fy + 0.5),
  }
}

/**
 * Crescent / lune (ADR-0093): an outer {@link ellipseRegion} with an inner ellipse — `thick` px
 * smaller on each axis and shifted `thick` px toward `dir` — subtracted out. The band is thickest on
 * the side opposite `dir` and tapers to nothing on the `dir` side, opening the crescent that way:
 * hair fringes, hat-brim curves, eyelids, shells. Because it is built from two `ellipseRegion`s it
 * inherits their even-diameter convention exactly. A `thick` at/above a radius yields the full
 * (solid) ellipse.
 */
export const crescentRegion = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  thick: number,
  dirx: number,
  diry: number,
): Region => {
  const t = Math.max(0, thick)
  const outer = ellipseRegion(cx, cy, rx, ry)
  const irx = rx - t
  const iry = ry - t
  if (irx <= 0 || iry <= 0) {
    return outer
  }
  const u = unitVec(dirx, diry)
  const inner = ellipseRegion(cx + roundHalfUp(u.x * t), cy + roundHalfUp(u.y * t), irx, iry)
  return regionSubtract(outer, inner)
}

/**
 * Ribbon (ADR-0093; ADR-0096 §2 renamed from `band` — `band` already means cel band, ripple
 * band, gradient band): a constant-width sweep of `w` px along the quadratic arc that passes
 * through `p0`, `p1` (mid), and `p2` — a curved hat band, a belt, and, stacked, turban wraps.
 * The arc is flattened to a dense polyline (so there is no low-resolution bezier blocking) and
 * membership is the exact min-distance-to-the-polyline test, giving round end caps and a smooth,
 * even-width ribbon at any size. Sampled at the pixel corner for a balanced footprint.
 */
export const ribbonRegion = (
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  w: number,
): Region => {
  const hw = Math.max(0.5, w / 2)
  // Control point of the quadratic Bézier that interpolates p1 at t=0.5 (a true 3-point arc).
  const cxc = 2 * p1x - (p0x + p2x) / 2
  const cyc = 2 * p1y - (p0y + p2y) / 2
  const chord = dhypot(p1x - p0x, p1y - p0y) + dhypot(p2x - p1x, p2y - p1y)
  const n = Math.max(8, Math.min(160, Math.ceil(chord)))
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= n; i++) {
    const s = i / n
    const om = 1 - s
    pts.push({
      x: om * om * p0x + 2 * om * s * cxc + s * s * p2x,
      y: om * om * p0y + 2 * om * s * cyc + s * s * p2y,
    })
  }
  const segDist2 = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): number => {
    const vx = bx - ax
    const vy = by - ay
    const wx = px - ax
    const wy = py - ay
    const vv = vx * vx + vy * vy
    const tt = vv < 1e-12 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv))
    const qx = ax + tt * vx - px
    const qy = ay + tt * vy - py
    return qx * qx + qy * qy
  }
  const hw2 = hw * hw
  const inside = (px: number, py: number): boolean => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as { x: number; y: number }
      const b = pts[i + 1] as { x: number; y: number }
      if (segDist2(px, py, a.x, a.y, b.x, b.y) <= hw2) {
        return true
      }
    }
    return false
  }
  let bx0 = Number.POSITIVE_INFINITY
  let by0 = Number.POSITIVE_INFINITY
  let bx1 = Number.NEGATIVE_INFINITY
  let by1 = Number.NEGATIVE_INFINITY
  for (const p of pts) {
    bx0 = Math.min(bx0, p.x)
    by0 = Math.min(by0, p.y)
    bx1 = Math.max(bx1, p.x)
    by1 = Math.max(by1, p.y)
  }
  const pad = Math.ceil(hw) + 1
  const x0 = Math.floor(bx0) - pad
  const y0 = Math.floor(by0) - pad
  const x1 = Math.ceil(bx1) + pad
  const y1 = Math.ceil(by1) + pad
  return {
    type: 'region',
    bbox: { x0, y0, x1, y1 },
    has: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && inside(x + 0.5, y + 0.5),
    test: (fx, fy) => inside(fx + 0.5, fy + 0.5),
  }
}

/** Apply a first-class transform to a region: inverse-map membership. */
export const regionTransform = (
  region: Region,
  matrix: readonly number[],
  inverse: readonly number[],
): Region => {
  let bbox: BBox | null = null
  if (region.bbox) {
    const corners = [
      [region.bbox.x0, region.bbox.y0],
      [region.bbox.x1, region.bbox.y0],
      [region.bbox.x0, region.bbox.y1],
      [region.bbox.x1, region.bbox.y1],
    ]
    let ok = true
    let x0 = Number.POSITIVE_INFINITY
    let y0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let y1 = Number.NEGATIVE_INFINITY
    for (const [cx, cy] of corners) {
      const p = applyMatrix(matrix, cx as number, cy as number)
      if (!p) {
        ok = false
        break
      }
      x0 = Math.min(x0, p.x)
      y0 = Math.min(y0, p.y)
      x1 = Math.max(x1, p.x)
      y1 = Math.max(y1, p.y)
    }
    if (ok) {
      bbox = {
        x0: Math.floor(x0) - 1,
        y0: Math.floor(y0) - 1,
        x1: Math.ceil(x1) + 1,
        y1: Math.ceil(y1) + 1,
      }
    }
  }
  return {
    type: 'region',
    bbox,
    has: (x, y) => {
      const p = applyMatrix(inverse, x, y)
      if (!p) {
        return false
      }
      return region.has(roundHalfUp(p.x), roundHalfUp(p.y))
    },
    test: (fx, fy) => {
      const p = applyMatrix(inverse, fx, fy)
      if (!p) {
        return false
      }
      return region.test(p.x, p.y)
    },
  }
}

/** A drawing's silhouette as a region: alpha > 0 (spec §9). */
export const spriteRegion = (s: Sprite): Region => ({
  type: 'region',
  bbox: { x0: 0, y0: 0, x1: s.w - 1, y1: s.h - 1 },
  has: (x, y) => {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) {
      return false
    }
    return (s.data[(y * s.w + x) * 4 + 3] ?? 0) > 0
  },
  test: (fx, fy) => {
    const x = roundHalfUp(fx)
    const y = roundHalfUp(fy)
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) {
      return false
    }
    return (s.data[(y * s.w + x) * 4 + 3] ?? 0) > 0
  },
})

const contourBBox = (contours: readonly PathContour[]): BBox | null => {
  let box: BBox | null = null
  for (const contour of contours) {
    for (const p of contour.points) {
      const cell = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      box = bboxUnion(box, cell)
    }
  }
  return box
}

const pointOnSegment = (p: PathPoint, a: PathPoint, b: PathPoint): boolean => {
  const cross = (p.y - a.y) * (b.x - a.x) - (p.x - a.x) * (b.y - a.y)
  if (Math.abs(cross) > 1e-9) {
    return false
  }
  return (
    p.x >= Math.min(a.x, b.x) - 1e-9 &&
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    p.y >= Math.min(a.y, b.y) - 1e-9 &&
    p.y <= Math.max(a.y, b.y) + 1e-9
  )
}

/**
 * Even-odd fill of a path's closed contours (ADR-0061 §4): boundary points count as
 * inside. Open contours are ignored. Returns the cached {@link Path.region} verbatim
 * when the path already carries one (e.g. from {@link pathFromRegion}).
 */
export const pathFillRegion = (p: Path): Region => {
  if (p.region) {
    return p.region
  }
  const closed = p.contours.filter((c) => c.closed && c.points.length >= 2)
  if (closed.length === 0) {
    return emptyRegion
  }
  // `closed` is non-empty with ≥2 points per contour, so contourBBox never returns null.
  const rawBox = contourBBox(closed) as BBox
  const bbox = {
    x0: Math.floor(rawBox.x0),
    y0: Math.floor(rawBox.y0),
    x1: Math.ceil(rawBox.x1),
    y1: Math.ceil(rawBox.y1),
  }
  const test = (fx: number, fy: number): boolean => {
    const pt = { x: fx, y: fy }
    let inside = false
    for (const contour of closed) {
      for (let i = 0; i < contour.points.length; i++) {
        const a = contour.points[i]
        const b = contour.points[(i + 1) % contour.points.length]
        if (!a || !b) {
          continue
        }
        if (pointOnSegment(pt, a, b)) {
          return true
        }
        if (a.y <= fy !== b.y <= fy) {
          const xInt = a.x + ((fy - a.y) / (b.y - a.y)) * (b.x - a.x)
          if (fx < xInt) {
            inside = !inside
          }
        }
      }
    }
    return inside
  }
  return {
    type: 'region',
    bbox,
    has: (x, y) => x >= bbox.x0 && x <= bbox.x1 && y >= bbox.y0 && y <= bbox.y1 && test(x, y),
    test,
  }
}

/** Wraps a precomputed 1-bit coverage bitmap (row-major over `bbox`) as a Region. */
const bitmapRegion = (bbox: BBox, bits: Uint8Array, width: number): Region => ({
  type: 'region',
  bbox,
  has: (x, y) => {
    if (x < bbox.x0 || x > bbox.x1 || y < bbox.y0 || y > bbox.y1) {
      return false
    }
    return bits[(y - bbox.y0) * width + (x - bbox.x0)] === 1
  },
  test: (fx, fy) => {
    const x = roundHalfUp(fx)
    const y = roundHalfUp(fy)
    if (x < bbox.x0 || x > bbox.x1 || y < bbox.y0 || y > bbox.y1) {
      return false
    }
    return bits[(y - bbox.y0) * width + (x - bbox.x0)] === 1
  },
})

/**
 * Centerline stroke of every (open and closed) contour segment, `width` pixels
 * wide, round joins/caps: Bresenham the segment, stamp a disc of radius
 * `floor((wi-1)/2)` at each traversed pixel (`wi = max(1, round(width))`).
 * Rasterizes into a bitmap sized to the path's bbox plus padding.
 */
export const pathStrokeRegion = (p: Path, width: number): Region => {
  const wi = Math.max(1, roundHalfUp(width))
  let box: BBox | null = null
  const segments: { readonly a: PathPoint; readonly b: PathPoint }[] = []
  for (const contour of p.contours) {
    for (let i = 0; i + 1 < contour.points.length; i++) {
      const a = contour.points[i]
      const b = contour.points[i + 1]
      if (a && b) {
        segments.push({ a, b })
        box = bboxUnion(box, {
          x0: Math.min(a.x, b.x),
          y0: Math.min(a.y, b.y),
          x1: Math.max(a.x, b.x),
          y1: Math.max(a.y, b.y),
        })
      }
    }
    if (contour.closed && contour.points.length > 1) {
      const a = contour.points.at(-1)
      const b = contour.points[0]
      if (a && b) {
        segments.push({ a, b })
        box = bboxUnion(box, {
          x0: Math.min(a.x, b.x),
          y0: Math.min(a.y, b.y),
          x1: Math.max(a.x, b.x),
          y1: Math.max(a.y, b.y),
        })
      }
    }
  }
  if (!box) {
    return emptyRegion
  }
  const pad = wi + 1
  const bbox = {
    x0: Math.floor(box.x0) - pad,
    y0: Math.floor(box.y0) - pad,
    x1: Math.ceil(box.x1) + pad,
    y1: Math.ceil(box.y1) + pad,
  }
  const bw = bbox.x1 - bbox.x0 + 1
  const bh = bbox.y1 - bbox.y0 + 1
  const bits = new Uint8Array(bw * bh)
  const add = (x: number, y: number): void => {
    if (x >= bbox.x0 && x <= bbox.x1 && y >= bbox.y0 && y <= bbox.y1) {
      bits[(y - bbox.y0) * bw + (x - bbox.x0)] = 1
    }
  }
  const radius = Math.floor((wi - 1) / 2)
  const stamp = (x: number, y: number): void => {
    if (wi <= 1) {
      add(x, y)
      return
    }
    for (let yy = -radius; yy <= radius; yy++) {
      for (let xx = -radius; xx <= radius; xx++) {
        if (xx * xx + yy * yy <= radius * radius) {
          add(x + xx, y + yy)
        }
      }
    }
  }
  for (const seg of segments) {
    bresenham(
      roundHalfUp(seg.a.x),
      roundHalfUp(seg.a.y),
      roundHalfUp(seg.b.x),
      roundHalfUp(seg.b.y),
      stamp,
    )
  }
  return bitmapRegion(bbox, bits, bw)
}

/**
 * Applies a first-class transform (ADR-0044) to a path: every contour point (the
 * polyline used for fill/stroke) is mapped through `matrix`, every command's
 * points (`move`/`line`/`quad`/`bezier` endpoints and an `arc`'s `center` and
 * `to`) are rewritten, and `inverse` is threaded to {@link regionTransform} for a
 * cached region. Points falling on the `w = 0` plane ({@link applyMatrix}
 * returning `null`) are left unmapped rather than dropped. A mirroring transform
 * (negative 2D determinant — e.g. `flipx`/`flipy`) reverses orientation, so an
 * `arc`'s `clockwise` sweep flag is flipped to keep its direction consistent with
 * the transformed contour polyline.
 */
export const pathTransform = (
  p: Path,
  matrix: readonly number[],
  inverse: readonly number[],
): Path => {
  const tx = (pt: PathPoint): PathPoint => applyMatrix(matrix, pt.x, pt.y) ?? pt
  const mirrored = (matrix[0] ?? 0) * (matrix[5] ?? 0) - (matrix[1] ?? 0) * (matrix[4] ?? 0) < 0
  const contours = p.contours.map((c) => ({ ...c, points: c.points.map(tx) }))
  const commands = p.commands.map((cmd): PathCommand => {
    switch (cmd.kind) {
      case 'move':
      case 'line':
        return { ...cmd, to: tx(cmd.to) }
      case 'quad':
        return { ...cmd, control: tx(cmd.control), to: tx(cmd.to) }
      case 'bezier':
        return { ...cmd, control1: tx(cmd.control1), control2: tx(cmd.control2), to: tx(cmd.to) }
      case 'arc':
        return {
          ...cmd,
          center: tx(cmd.center),
          to: tx(cmd.to),
          clockwise: mirrored ? !cmd.clockwise : cmd.clockwise,
        }
      default:
        return cmd // `close` carries no points — pass through unchanged
    }
  })
  const region = p.region ? regionTransform(p.region, matrix, inverse) : undefined
  return path(contours, commands, p.viewBox, region)
}

/**
 * Wraps a Region as a command-less Path (no `contours`/`commands`) so
 * region-only shapes (masks, silhouettes) can flow through Path-typed APIs — e.g.
 * `export … path` (ADR-0061 §6). {@link pathFillRegion} returns `region` unchanged.
 */
export const pathFromRegion = (
  region: Region,
  viewBox?: { readonly width: number; readonly height: number },
): Path => path([], [], viewBox, region)
