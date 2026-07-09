// The framebuffer: straight-alpha RGBA8 + pinned integer source-over
// compositing (ADR-0001, ADR-0025).

import type { Color } from './color.js'
import { roundHalfUp } from './dmath.js'

/**
 * The canvas: a fixed-size straight-alpha RGBA8 bitmap with pinned Porter-Duff
 * compositing (ADR-0001, ADR-0025). Every drawing primitive writes through
 * {@link blend} or {@link set}; nothing else mutates {@link data}.
 */
export class Framebuffer {
  readonly width: number
  readonly height: number
  /**
   * The pixel store: `width × height × 4` bytes, row-major top-to-bottom,
   * straight-alpha RGBA8 per pixel — same layout as a rendered `Sprite`'s `data`.
   */
  readonly data: Uint8Array

  /** Pixel-write budget hook (spec §15); set by the evaluator. */
  onWrite: (() => void) | null = null

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8Array(width * height * 4)
  }

  /** True iff `(x, y)` addresses a pixel inside `0..width-1, 0..height-1`. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  /**
   * Porter-Duff source-over, straight alpha, round-half-up (ADR-0025 §2).
   * Fully transparent sources are never written. Out-of-bounds is clipped.
   */
  blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (a === 0 || !this.inBounds(x, y)) {
      return
    }
    this.onWrite?.()
    const i = (y * this.width + x) * 4
    const d = this.data
    if (a === 255) {
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      d[i + 3] = 255
      return
    }
    const as = a / 255
    const ad = (d[i + 3] ?? 0) / 255
    const outA = as + ad * (1 - as)
    if (outA === 0) {
      return
    }
    const f = (ad * (1 - as)) / outA
    const fs = as / outA
    d[i] = roundHalfUp((r * fs + (d[i] ?? 0) * f) * 1)
    d[i + 1] = roundHalfUp((g * fs + (d[i + 1] ?? 0) * f) * 1)
    d[i + 2] = roundHalfUp((b * fs + (d[i + 2] ?? 0) * f) * 1)
    d[i + 3] = roundHalfUp(outA * 255)
  }

  blendColor(x: number, y: number, c: Color): void {
    this.blend(x, y, c.r, c.g, c.b, c.a)
  }

  /** Raw write (filters that replace pixels wholesale). */
  set(x: number, y: number, c: Color): void {
    if (!this.inBounds(x, y)) {
      return
    }
    this.onWrite?.()
    const i = (y * this.width + x) * 4
    this.data[i] = c.r
    this.data[i + 1] = c.g
    this.data[i + 2] = c.b
    this.data[i + 3] = c.a
  }

  /** Out-of-bounds reads as fully transparent black rather than throwing. */
  get(x: number, y: number): Color {
    if (!this.inBounds(x, y)) {
      return { type: 'color', r: 0, g: 0, b: 0, a: 0 }
    }
    const i = (y * this.width + x) * 4
    return {
      type: 'color',
      r: this.data[i] ?? 0,
      g: this.data[i + 1] ?? 0,
      b: this.data[i + 2] ?? 0,
      a: this.data[i + 3] ?? 0,
    }
  }

  /** Out-of-bounds reads as `0` (transparent). */
  alphaAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) {
      return 0
    }
    return this.data[(y * this.width + x) * 4 + 3] ?? 0
  }

  /** Deep copy: an independent framebuffer with the same pixels, `onWrite` unset. */
  clone(): Framebuffer {
    const fb = new Framebuffer(this.width, this.height)
    fb.data.set(this.data)
    return fb
  }

  /** Resets every pixel to fully transparent black (`0,0,0,0`). */
  clear(): void {
    this.data.fill(0)
  }
}

/**
 * A coordinate-reflecting view over a target buffer, the single mechanism behind the
 * `mirror x=<n>:` / `mirror y=<n>:` block (ADR-0078). Every read and write reflects its
 * coordinate across the axis (`x → 2n − x` for `x`, `y → 2n − y` for `y`) and delegates to
 * the target, so all rasterization — shapes, region fills, gradients, `flood`, stamps,
 * filters — mirrors uniformly with no per-primitive code. Structurally a {@link Framebuffer}
 * (assignable to `Context.buffer`) but never allocates its own pixels: `data`/`width`/`height`
 * alias the target's.
 *
 * **Axis-once rule:** a write whose source coordinate lies exactly on the axis maps to itself,
 * so it would re-blend the pixel the normal (un-reflected) pass already painted — a seam and an
 * alpha error. Such writes are skipped; the axis line is painted once. Wrapping a
 * `MirrorFramebuffer` again composes reflections by pure delegation (nested `mirror` blocks),
 * each level skipping its own axis so shared axes and the shared centre still paint once.
 */
export class MirrorFramebuffer {
  readonly width: number
  readonly height: number
  readonly data: Uint8Array
  onWrite: (() => void) | null = null
  readonly #target: Framebuffer
  readonly #axis: 'x' | 'y'
  readonly #at: number

  constructor(target: Framebuffer, axis: 'x' | 'y', at: number) {
    this.#target = target
    this.#axis = axis
    this.#at = at
    this.width = target.width
    this.height = target.height
    this.data = target.data
  }

  /** Reflected read coordinate (no axis skip — reads mirror freely). */
  #read(x: number, y: number): { x: number; y: number } {
    return this.#axis === 'x' ? { x: 2 * this.#at - x, y } : { x, y: 2 * this.#at - y }
  }

  /** Reflected write coordinate, or `null` for a self-mapped axis pixel (skip — painted once). */
  #write(x: number, y: number): { x: number; y: number } | null {
    if (this.#axis === 'x') {
      return x === this.#at ? null : { x: 2 * this.#at - x, y }
    }
    return y === this.#at ? null : { x, y: 2 * this.#at - y }
  }

  inBounds(x: number, y: number): boolean {
    const p = this.#read(x, y)
    return this.#target.inBounds(p.x, p.y)
  }

  blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
    const p = this.#write(x, y)
    if (p) {
      this.#target.blend(p.x, p.y, r, g, b, a)
    }
  }

  blendColor(x: number, y: number, c: Color): void {
    this.blend(x, y, c.r, c.g, c.b, c.a)
  }

  set(x: number, y: number, c: Color): void {
    const p = this.#write(x, y)
    if (p) {
      this.#target.set(p.x, p.y, c)
    }
  }

  get(x: number, y: number): Color {
    const p = this.#read(x, y)
    return this.#target.get(p.x, p.y)
  }

  alphaAt(x: number, y: number): number {
    const p = this.#read(x, y)
    return this.#target.alphaAt(p.x, p.y)
  }

  /** A reflecting clone over a fresh clone of the target — keeps filter read/write coherent. */
  clone(): Framebuffer {
    return new MirrorFramebuffer(
      this.#target.clone(),
      this.#axis,
      this.#at,
    ) as unknown as Framebuffer
  }

  clear(): void {
    this.#target.clear()
  }
}
