// CI regression gate (ADR-0085 §5, phase 1c): every bundled example must pass
// `drawstic critique --strict` (exit 0) under its natural category profile. The
// must-fix subset (C001 empty, C007 character seam, + C003 icon centering) is
// calibrated to the corpus's measured craft floor, so a red here means a real
// structural regression in an example — not threshold noise. Runs in-process
// (no per-file process spawn) so it stays fast enough for the unit run.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { main } from '../../src/cli.js'
import type { Diagnostic } from '../../src/diagnostic.js'
import { Engine } from '../../src/eval.js'
import { censusModule } from '../../src/lint.js'

const EXAMPLES = join(process.cwd(), 'examples')

/** The `--as` category an example belongs to, from its path; `null` = agnostic (no profile). */
const categoryOf = (file: string): string | null => {
  const p = file.replace(/\\/g, '/')
  if (p.includes('/icons/')) {
    return 'icon'
  }
  if (p.includes('/characters-ro2/')) {
    return 'character'
  }
  if (p.includes('/items-v2/')) {
    return 'item'
  }
  if (p.includes('/scenes')) {
    return 'scene'
  }
  return null
}

const drwFiles = (): string[] =>
  readdirSync(EXAMPLES, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.drw'))
    .map((f) => join(EXAMPLES, f))
    .sort()

/** Runs `critique --strict` on one file with stdout muted; returns the process exit code. */
const critiqueStrict = (file: string): number => {
  const cat = categoryOf(file)
  const argv = ['critique', file, ...(cat ? ['--as', cat] : []), '--strict', '--json']
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = (() => true) as typeof process.stdout.write
  try {
    return main(argv)
  } finally {
    process.stdout.write = original
  }
}

describe('examples pass `critique --strict` (CI regression gate)', () => {
  const files = drwFiles()

  test('the example corpus is non-empty (the gate actually runs)', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  // Renders and critiques the whole corpus in-process — a few seconds on a warm machine, so the
  // default 5 s budget sits right on the edge (it has flaked at 5.09 s). 60 s keeps it a real gate.
  test('every example exits 0 under its category profile', () => {
    const failures = files.filter((f) => critiqueStrict(f) !== 0)
    expect(failures).toEqual([])
  }, 60_000)
})

/**
 * Runs `critique <file> --as <cat> --json` in-process (stdout captured, not muted) and returns the
 * `C009` diagnostic count. Backs the pinned-count regression test below.
 */
const c009Count = (file: string, category: string): number => {
  const chunks: Buffer[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    main(['critique', file, '--as', category, '--json'])
  } finally {
    process.stdout.write = original
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { diagnostics: Diagnostic[] }
  return body.diagnostics.filter((d) => d.code === 'C009').length
}

// Regression pin (release 1.0 hardening, round 2): `detectPlateFigure` briefly shared one
// calibration between C009 (src/critique.ts) and `render --silhouette` (src/preview.ts); the
// `--silhouette`-tuned gates also rejected several real, thin icon plates, so their glyphs signed
// their *full* covered mask again and collapsed to distance 0 — the exact C009-Plate-Blindheit bug
// this release already fixed, silently returning for `communication.drw`'s `phone`/`contacts`/
// `feed`. Neither "plate-detection hits" nor "render bytes" (what verification checked at the time)
// can see this regression, because the C009 signature changes without any rendered image changing.
// Fixed by giving each caller its own `PlateDetectionMode` (`'loose'` for C009, unchanged from
// before that round; `'strict'` for `--silhouette`) instead of one shared threshold — a measured
// non-icon false positive (`scenes-v3/market.drw#barrel`, keeping 13.7% of its covered mass) sits
// *below* a measured real glyph (`finance.drw#bank`, 13.5%), so no single area-fraction (or
// interior-inset, or left/right-vs-top/bottom symmetry — also measured, also non-separating)
// threshold can serve both call sites. These exact counts are `d74f9d3` (pre-regression) values;
// re-derive them with `critique <file>.drw --as <cat> --json` if a future icon/item is added and
// this test needs updating — never loosen it to make a real regression pass quietly.
describe('C009 sibling-silhouette counts are pinned (release 1.0 hardening, round 2 regression)', () => {
  const ICON_COUNTS: Record<string, number> = {
    communication: 2,
    finance: 0,
    games: 2,
    media: 2,
    productivity: 2,
    system: 0,
    weather: 0,
  }

  for (const [family, expected] of Object.entries(ICON_COUNTS)) {
    test(`icons/${family}.drw has ${expected} C009 finding(s)`, () => {
      expect(c009Count(join(EXAMPLES, 'icons', `${family}.drw`), 'icon')).toBe(expected)
    })
  }

  const ITEM_COUNTS: Record<string, number> = {
    'potions/potions': 4,
    'shields/shields': 4,
    'armor/armor': 3,
    'swords/swords': 2,
    'arcana/arcana': 0,
    'ranged/set': 0,
    'loot/loot': 0,
  }

  for (const [rel, expected] of Object.entries(ITEM_COUNTS)) {
    test(`items-v2/${rel}.drw has ${expected} C009 finding(s)`, () => {
      expect(c009Count(join(EXAMPLES, 'items-v2', `${rel}.drw`), 'item')).toBe(expected)
    })
  }

  for (const character of ['knight', 'wizard', 'archer', 'assassin']) {
    test(`characters-ro2/${character}.drw has 0 C009 findings`, () => {
      expect(c009Count(join(EXAMPLES, 'characters-ro2', `${character}.drw`), 'character')).toBe(0)
    })
  }

  test("the product skill's starter icon family still passes --strict", () => {
    const chunks: Buffer[] = []
    const original = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      return true
    }) as typeof process.stdout.write
    try {
      main([
        'critique',
        join(process.cwd(), 'skills/drawstic/starters/icon-family.drw'),
        '--as',
        'icon',
        '--strict',
        '--json',
      ])
    } finally {
      process.stdout.write = original
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      critique: { pass: boolean }
    }
    expect(body.critique.pass).toBe(true)
  })
})

// W2-1b: the RO characters must draw their C004 value spread from the material `spread`/form
// shading, never from the retired hand corner-patch idiom (a `fill` of a lit/shadow tone clipped to
// a rectangle). This guards the recipes against regressing to `fill hi(c) region.intersect(rect…)`.
describe('characters-ro2 recipes are free of the manual value-spread corner-patch idiom (W2-1b)', () => {
  /** A `fill` line clipping a *tone-shifted* colour to a sub-rect — the value-spread patch. */
  const CLIPPED_FILL = /^\s*fill\b.*\.intersect\(/
  const TONE_SHIFT = /litTone|shadowTone|\bhi\(|\blo\(|capeHi|capeDeep/
  const FN_RAMP = /^\s*fn\s+(hi|lo)\s*\(/

  const roFiles = (): string[] =>
    readdirSync(join(EXAMPLES, 'characters-ro2'), { encoding: 'utf8' })
      .filter((f) => f.endsWith('.drw'))
      .map((f) => join(EXAMPLES, 'characters-ro2', f))

  test('no `fill <tone>.intersect(rect)` patch and no `fn hi/lo` ramp survives', () => {
    const offenders: string[] = []
    for (const file of roFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (FN_RAMP.test(line) || (CLIPPED_FILL.test(line) && TONE_SHIFT.test(line))) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })
})

// ADR-0094/0097: every bundled example must be free of the non-canonical anti-patterns the census
// counts (litTone/shadowTone corner patch, stamp of a pinned part, hand contact-shadow ellipse) —
// and must not reach for any *retired* construct. AST-based, so it catches what the W2-1b regex
// above cannot: a retired command still loads and only fails at render time.
describe('examples carry no W013–W015 anti-patterns and no retired constructs (census clean)', () => {
  test('every example has all census anti-pattern counts at 0', () => {
    const offenders: string[] = []
    for (const file of drwFiles()) {
      const engine = new Engine(process.cwd())
      const mod = engine.loadEntry(file)
      const { antiPatterns } = censusModule(engine, mod)
      const total = antiPatterns.manualSpread + antiPatterns.stampWithPins + antiPatterns.handShadow
      if (total > 0) {
        offenders.push(`${file}: ${JSON.stringify(antiPatterns)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test('no example uses a retired construct', () => {
    const offenders: string[] = []
    for (const file of drwFiles()) {
      const engine = new Engine(process.cwd())
      const mod = engine.loadEntry(file)
      const retired = censusModule(engine, mod)
        .constructs.filter((c) => c.retired)
        .map((c) => c.construct)
      if (retired.length > 0) {
        offenders.push(`${file}: ${retired.join(', ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
