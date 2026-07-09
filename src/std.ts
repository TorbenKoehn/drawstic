// Bundled std/ modules (ADR-0035): resolved by the engine, always available,
// version-pinned with the language version. Each recipe lives in a plain TS
// module (src/std/*.drw.ts) exporting its source as a template-string constant,
// so the same import works under Bun, Node and Deno (ADR-0065).
import microFont from './std/fonts/micro.drw.js'
import smallFont from './std/fonts/small.drw.js'
import shapes from './std/shapes.drw.js'
import themes from './std/themes.drw.js'

/**
 * Recipe source for every bundled `std/` module, keyed by import path
 * (e.g. `std/shapes`). The evaluator's module loader resolves these in
 * place of a filesystem read (ADR-0035 §3).
 */
export const STD_MODULES: Record<string, string> = {
  'std/fonts/micro': microFont,
  'std/fonts/small': smallFont,
  'std/shapes': shapes,
  'std/themes': themes,
}

/**
 * Font names that resolve globally without an explicit `from std/fonts/...`
 * import (ADR-0054 §2), mapped to their STD_MODULES key.
 */
export const STD_GLOBAL_FONTS: Readonly<Record<string, string>> = {
  micro: 'std/fonts/micro',
  small: 'std/fonts/small',
}
