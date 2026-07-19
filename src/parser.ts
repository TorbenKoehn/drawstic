// Recursive-descent parser for the Recipe language, implementing the
// normative grammar of spec §17 (ADR-0052) including the pinned
// disambiguation rules D1–D8.

import type {
  Argument,
  AtlasDefinition,
  DrawDefinition,
  Expression,
  FontDefinition,
  FontItem,
  FormatLine,
  MatchArm,
  MaterialOverrideKey,
  MaterialOverrides,
  Module,
  PaletteEntry,
  PathCommand,
  PathDefinition,
  Statement,
  ThemeDefinition,
  TilesetDefinition,
} from './ast.js'
import { MATERIAL_OVERRIDE_KEYS } from './ast.js'
import { ERROR_CODE, error, type TextSpan } from './diagnostic.js'
import { lex, type Token } from './lexer.js'
import { isFormProfile, isMaterialResponse } from './values.js'

// Keyword-prefixed sequences that form one argument (D2): the keyword plus
// this many trailing expressions, e.g. `tint k 0.3` (arity 2) or `mask m`
// (arity 1). Shared by command-form (#parseCallStmt) and paren-form
// (#parseParenArg) call arguments — both surfaces accept the same keywords.
const KW_ARG_ARITY: Record<string, number> = {
  transform: 1,
  tint: 2,
  mask: 1,
  font: 1,
  cap: 1,
  join: 1,
  mode: 1,
  sha256: 1,
  anchor: 1,
  shadow: 2,
}

// Words reserved everywhere because they can appear inside an expression
// (spec §17.2); every other keyword is positional, recognized by statement
// shape in #parseStmt. `by` is *not* here — ADR-0061 removed the last
// `by`-expression (path-local `rel` replaced it) and ADR-0073 unreserved
// the now-dead word, so `by` is an ordinary bindable name again.
const RESERVED = new Set(['rel', 'if', 'then', 'else', 'true', 'false', 'transparent', 'mod', 'as'])

/**
 * Recursive-descent parser over one file's token stream (see module header
 * for the grammar it implements). One instance per parse; construct via
 * the {@link parse} entry point below rather than directly.
 */
class Parser {
  readonly #toks: Token[]
  #pos = 0
  readonly #file: string

  constructor(source: string, file: string) {
    this.#file = file
    this.#toks = lex(source, file)
  }

  // ── token helpers ─────────────────────────────────────────────────────

  /**
   * Token at `pos + k`, clamped to the final (`eof`) token — lookahead
   * never runs off the end of the stream.
   */
  readonly #peek = (k = 0): Token => {
    const t = this.#toks[Math.min(this.#pos + k, this.#toks.length - 1)]
    if (!t) {
      throw new Error('parser: empty token stream (lexer must emit EOF)')
    }
    return t
  }
  readonly #next = (): Token => {
    const t = this.#peek()
    if (t.kind !== 'eof') {
      this.#pos++
    }
    return t
  }
  readonly #at = (kind: Token['kind'], text?: string): boolean => {
    const t = this.#peek()
    return t.kind === kind && (text === undefined || t.text === text)
  }
  readonly #atName = (text: string): boolean => this.#at('name', text)
  readonly #span = (t: Token): TextSpan => ({
    line: t.line,
    column: t.col,
    endLine: t.endLine,
    endColumn: t.endCol,
  })
  /**
   * Raises a positioned {@link ERROR_CODE.syntax} (E004) error at `t`
   * (defaults to the current token). The parser never raises any other
   * error code except {@link ERROR_CODE.paletteCollision} (E007) for
   * malformed palette keys — E005 (indent) is raised earlier, by the
   * lexer.
   */
  readonly #fail = (msg: string, t = this.#peek(), hint?: string): never => {
    throw error(ERROR_CODE.syntax, msg, this.#file, this.#span(t), hint)
  }
  /**
   * Consumes and returns the current token if it matches `kind`/`text`;
   * otherwise fails (E004) with a message built from `what` or `text`.
   */
  readonly #expect = (kind: Token['kind'], text?: string, what?: string): Token => {
    if (!this.#at(kind, text)) {
      this.#fail(
        `expected ${what ?? text ?? kind}, got '${this.#peek().text || this.#peek().kind}'`,
      )
    }
    return this.#next()
  }
  /**
   * Statement terminator: consumes a trailing `NL`, or accepts `EOF`/
   * `DEDENT` as already ending the line (the last statement of a file or
   * block has no `NL` of its own). Fails (E004) otherwise.
   */
  readonly #expectNL = (): void => {
    if (this.#at('nl')) {
      this.#next()
      return
    }
    if (this.#at('eof') || this.#at('dedent')) {
      return
    }
    this.#fail(`unexpected '${this.#peek().text || this.#peek().kind}' — expected end of line`)
  }
  readonly #skipNLs = (): void => {
    while (this.#at('nl')) {
      this.#next()
    }
  }

  // ── module ────────────────────────────────────────────────────────────

  /**
   * Entry rule: `module = [version-pragma] { top-stmt } EOF` (§17.4). The
   * optional `drawstic N` pragma (ADR-0029) is only recognized as the
   * file's first line, sniffed by 3-token lookahead so a plain `drawstic`
   * binding elsewhere in the file is unaffected.
   */
  parseModule = (): Module => {
    let pragma: number | undefined
    this.#skipNLs()
    if (this.#atName('drawstic') && this.#peek(1).kind === 'int' && this.#peek(2).kind === 'nl') {
      this.#next()
      pragma = this.#next().num
      this.#next()
    }
    const stmts: Statement[] = []
    this.#skipNLs()
    while (!this.#at('eof')) {
      stmts.push(this.#parseStmt(true))
      this.#skipNLs()
    }
    return { pragma, statements: stmts, file: this.#file }
  }

  /**
   * Entry rule for a standalone expression with nothing else in the
   * source: `expr EOF`. Used by {@link parseStandaloneExpr} to parse the
   * CLI `render file#draw(args)` fragment's `<drawing><(args)>` text
   * (ADR-0067) with the exact grammar a recipe uses for a call expression
   * — no module/statement context, just one expression. Any trailing
   * token after the expression is E004, same as every other parser error.
   */
  parseStandaloneExpr = (): Expression => {
    this.#skipNLs()
    const expr = this.#parseExpr()
    this.#skipNLs()
    if (!this.#at('eof')) {
      this.#fail(`unexpected '${this.#peek().text || this.#peek().kind}' after arguments`)
    }
    return expr
  }

  // ── statements ────────────────────────────────────────────────────────

  /**
   * Parses `block = NL INDENT draw-stmt { draw-stmt } DEDENT` (§17.4) — the body
   * of any `:`-introduced construct (`if`, `repeat`, `mask`, `draw`, …).
   * Tolerates a missing trailing `DEDENT` at EOF so an unterminated final
   * block doesn't require a separate error path.
   */
  readonly #parseBlock = (): Statement[] => {
    this.#expect('nl', undefined, 'newline')
    this.#skipNLs()
    this.#expect('indent', undefined, 'an indented block')
    const stmts: Statement[] = []
    this.#skipNLs()
    while (!this.#at('dedent') && !this.#at('eof')) {
      stmts.push(this.#parseStmt(false))
      this.#skipNLs()
    }
    if (this.#at('dedent')) {
      this.#next()
    }
    return stmts
  }

  /**
   * Dispatches one statement by its leading `NAME` (D7: positional
   * keywords are recognized by statement shape, not lexer reservation).
   * Each `case` peeks ahead to confirm the shape before committing —
   * falling through to `break` lets an unmatched shape (e.g. `size` not
   * followed by a `SIZE` token) continue on to the binding/call-statement
   * fallback below instead of failing immediately, so `size`, `font`, etc.
   * remain usable as ordinary binding/call names outside their directive
   * shape. `top` is currently unused — module- vs block-level legality of
   * a given statement kind is not enforced here.
   */
  readonly #parseStmt = (top: boolean): Statement => {
    const t = this.#peek()
    if (t.kind !== 'name') {
      this.#fail(`expected a statement, got '${t.text || t.kind}'`)
    }
    this.#checkReservedBinding()
    const s = this.#span(t)
    const w = t.text

    // definitions & keyword statements, recognized by statement shape
    switch (w) {
      case 'from':
        return this.#parseFrom()
      case 'use':
        return this.#parseUse()
      case 'size':
        if (this.#peek(1).kind === 'size') {
          this.#next()
          const sz = this.#next()
          this.#expectNL()
          return { kind: 'sizeDirective', width: sz.num, height: sz.sizeH, span: s }
        }
        break
      case 'seed':
        if (this.#peek(1).kind === 'int') {
          this.#next()
          const n = this.#next().num
          this.#expectNL()
          return { kind: 'seedDirective', seed: n, span: s }
        }
        break
      case 'font': {
        // D7: font NAME ":" → definition block; font NAME NL → directive
        if (this.#peek(1).kind === 'name') {
          const after = this.#peek(2)
          if (
            (after.kind === 'op' && after.text === ':' && after.blockColon) ||
            after.kind === 'size'
          ) {
            return this.#parseFontDef()
          }
          if (after.kind === 'nl') {
            this.#next()
            const name = this.#next().text
            this.#expectNL()
            return { kind: 'fontDirective', name, span: s }
          }
        }
        break
      }
      case 'mode':
        if (this.#peek(1).kind === 'name' && this.#peek(2).kind === 'nl') {
          this.#next()
          const m = this.#next().text
          if (m !== 'pixel' && m !== 'smooth') {
            this.#fail("mode must be 'pixel' or 'smooth'")
          }
          this.#expectNL()
          return { kind: 'modeDirective', mode: m as 'pixel' | 'smooth', span: s }
        }
        break
      case 'with':
        if (this.#peek(1).kind === 'name') {
          this.#next()
          const names = this.#parseNameList()
          this.#expectNL()
          return { kind: 'with', names, span: s }
        }
        break
      case 'style':
        if (this.#peek(1).kind === 'string') {
          this.#next()
          const str = this.#next().str
          this.#expectNL()
          return { kind: 'style', text: str, span: s }
        }
        break
      case 'title':
      case 'desc':
        if (this.#peek(1).kind === 'string') {
          this.#next()
          const str = this.#next().str
          this.#expectNL()
          return { kind: 'meta', which: w, value: str, span: s }
        }
        break
      case 'draw':
        if (this.#peek(1).kind === 'name') {
          return this.#parseDraw()
        }
        break
      case 'path':
        if (this.#peek(1).kind === 'name') {
          return this.#parsePathDef()
        }
        break
      case 'theme':
        if (this.#peek(1).kind === 'name') {
          return this.#parseTheme()
        }
        break
      case 'fn':
        if (
          this.#peek(1).kind === 'name' &&
          this.#peek(2).kind === 'op' &&
          this.#peek(2).text === '('
        ) {
          return this.#parseFnDef()
        }
        break
      case 'grad':
        if (this.#peek(1).kind === 'name' && this.#peek(2).text === '=') {
          this.#next()
          const name = this.#next().text
          this.#next() // =
          const e = this.#parseExprSeq()
          this.#expectNL()
          return { kind: 'binding', names: [name], expression: e, bindKind: 'grad', span: s }
        }
        break
      case 'mask': {
        // D7: mask NAME "=" → value binding; mask NAME ":" → clip block
        if (this.#peek(1).kind === 'name') {
          const after = this.#peek(2)
          if (after.text === '=') {
            this.#next()
            const name = this.#next().text
            this.#next()
            const e = this.#parseExprSeq()
            this.#expectNL()
            return { kind: 'binding', names: [name], expression: e, bindKind: 'mask', span: s }
          }
        }
        this.#next()
        const expression = this.#parseExpr()
        this.#expect('op', ':', "':'")
        const body = this.#parseBlock()
        return { kind: 'maskBlock', expression, body, span: s }
      }
      case 'light':
        // D7: `light NAME =` → a Light value binding; anything else leaves `light`
        // an ordinary bindable/call name (contextual).
        if (this.#peek(1).kind === 'name' && this.#peek(2).text === '=') {
          return this.#parseLightBinding()
        }
        break
      case 'material':
        // D7: `material NAME =` → a Material value binding; else `material` stays a name.
        if (this.#peek(1).kind === 'name' && this.#peek(2).text === '=') {
          return this.#parseMaterialBinding()
        }
        break
      case 'lit':
        // The `lit L:` light-scoping block was removed (ADR-0094): the theme default light
        // and an explicit `light L` argument on `model`/`cel` cover both real cases. `lit` as
        // an ordinary bindable/call name (`lit = …`) is untouched — only the block shape errors.
        if (
          this.#peek(1).kind === 'name' &&
          this.#peek(2).kind === 'op' &&
          this.#peek(2).text === ':' &&
          this.#peek(2).blockColon
        ) {
          this.#fail(
            "the 'lit L:' block was removed — pass 'light L' to each model/cel, or set the theme's default light",
            t,
          )
        }
        break
      case 'pin':
        // D7: `pin NAME …` / `pin part.name …` → an attach-point declaration; `pin = …`, `pin(…)`,
        // or `pin` as a value all leave it an ordinary bindable/call name (contextual).
        if (this.#peek(1).kind === 'name') {
          return this.#parsePinDeclaration()
        }
        break
      case 'fit':
        // D7: `fit REF REF` → an anchored-assembly placement; `fit = …`, `fit(…)`, or `fit` as a
        // value leave it an ordinary bindable/call name (contextual).
        if (this.#peek(1).kind === 'name') {
          return this.#parseFit()
        }
        break
      case 'filter':
        if (
          this.#peek(1).kind === 'name' &&
          this.#peek(2).text === ':' &&
          this.#peek(2).blockColon
        ) {
          return this.#parseFilterDef()
        }
        break
      case 'import':
        if (this.#peek(1).kind === 'name' && this.#peek(2).text === '=') {
          return this.#parseImageImport()
        }
        break
      case 'tileset':
        if (this.#peek(1).kind === 'name' && this.#peek(2).kind === 'size') {
          return this.#parseTileset()
        }
        break
      case 'atlas':
        if (
          this.#peek(1).kind === 'name' &&
          this.#peek(2).text === ':' &&
          this.#peek(2).blockColon
        ) {
          return this.#parseAtlas()
        }
        break
      case 'export':
        if (this.#peek(1).kind === 'name') {
          return this.#parseExport()
        }
        break
      case 'pal':
        return this.#parsePal()
      case 'pixels':
        if (this.#peek(1).text === ':' && this.#peek(1).blockColon) {
          return this.#parsePixels()
        }
        break
      case 'if':
        return this.#parseIfStmt()
      case 'match':
        return this.#parseMatch()
      case 'repeat':
        // `repeat N:` was removed (ADR-0094) — it duplicated `for`. `repeat = …` (name binding)
        // still works; only the loop shape errors.
        if (this.#peek(1).text !== '=') {
          this.#fail("'repeat' was removed — use 'for i 0..N:' instead", t)
        }
        break
      case 'for': {
        this.#next()
        const varName = this.#expect('name', undefined, 'a loop variable').text
        const iterable = this.#parseExprSeq()
        this.#expect('op', ':', "':'")
        const body = this.#parseBlock()
        return { kind: 'for', target: varName, iterable, body, span: s }
      }
      case 'while':
        // `while cond:` was removed (ADR-0094) — an unbounded loop is a budget hazard `for`
        // never poses. `while = …` (name binding) still works; only the loop shape errors.
        if (this.#peek(1).text !== '=') {
          this.#fail("'while' was removed — iterate a bounded range with 'for i 0..N:'", t)
        }
        break
      case 'flood':
        // The `flood` fill command was removed (ADR-0094) — a special case with no distinct
        // role; fill a Region instead. `flood = …` (name binding) still works.
        if (this.#peek(1).text !== '=') {
          this.#fail("'flood' was removed — fill a region: 'fill PAINT REGION'", t)
        }
        break
      case 'replace':
        // The `replace` recolor filter was removed (ADR-0094) — an exact-RGBA swap is brittle
        // after shading/AA; recolor parametrically (draw params + `tint`) instead. `replace = …`
        // (name binding) still works.
        if (this.#peek(1).text !== '=') {
          this.#fail(
            "'replace' was removed — recolor parametrically (draw params + a 'tint' stamp flag), or 'tint' the whole frame",
            t,
          )
        }
        break
      case 'scatter':
        // D7: `scatter NAME count seed region:` is a block; a bare `scatter =`
        // or `scatter(` leaves it an ordinary bindable/call name (contextual).
        if (this.#peek(1).kind === 'name') {
          this.#next() // scatter
          const target = this.#next().text
          const count = this.#parseExpr(true)
          const seed = this.#parseExpr(true)
          const region = this.#parseExpr(true)
          this.#expect('op', ':', "':' to open the scatter body")
          const body = this.#parseBlock()
          return { kind: 'scatter', target, count, seed, region, body, span: s }
        }
        break
      case 'mirror':
        // D7: `mirror x=<n>:` / `mirror y=<n>:` is a block; anything else leaves
        // `mirror` an ordinary bindable/call name (contextual).
        if (
          (this.#peek(1).text === 'x' || this.#peek(1).text === 'y') &&
          this.#peek(1).kind === 'name' &&
          this.#peek(2).kind === 'op' &&
          this.#peek(2).text === '='
        ) {
          this.#next() // mirror
          const axis = this.#next().text as 'x' | 'y'
          this.#next() // =
          const at = this.#parseExpr()
          this.#expect('op', ':', "':' to open the mirror body")
          const body = this.#parseBlock()
          return { kind: 'mirror', axis, at, body, span: s }
        }
        break
      case 'apply':
        if (this.#peek(1).kind === 'name' && this.#peek(2).kind === 'nl') {
          this.#next()
          const name = this.#next().text
          this.#expectNL()
          return { kind: 'apply', name, span: s }
        }
        break
      default:
        break
    }

    // binding: name-list "=" expr-seq | NAME compound-op expr
    const bind = this.#tryParseBinding()
    if (bind) {
      return bind
    }

    // otherwise: a call statement (command-form or paren-form)
    void top
    return this.#parseCallStmt()
  }

  /**
   * Detects a `RESERVED = expr` / `RESERVED compound-op expr` shape — or a
   * reserved word anywhere in a `NAME, NAME, … =` list — before it can
   * either fall through `#tryParseBinding` (which only recognizes ordinary
   * names, landing on the generic "expected an expression" from
   * `#parseCallStmt` once it sees the bare `=`) or get swallowed by a
   * keyword-shaped `switch` case in `#parseStmt` (e.g. `if = 3` consuming
   * `if` before any binding check runs). Raises E004 anchored on the
   * reserved identifier itself instead of the operator. Consumes nothing;
   * a non-matching lookahead is a no-op so normal dispatch proceeds.
   */
  readonly #checkReservedBinding = (): void => {
    const t0 = this.#peek()
    const names: Token[] = [t0]
    let i = 1
    while (
      this.#peek(i).kind === 'op' &&
      this.#peek(i).text === ',' &&
      this.#peek(i + 1).kind === 'name'
    ) {
      names.push(this.#peek(i + 1))
      i += 2
    }
    const opTok = this.#peek(i)
    const isBindOp =
      opTok.kind === 'op' &&
      (opTok.text === '=' || (names.length === 1 && ['+=', '-=', '*=', '/='].includes(opTok.text)))
    if (!isBindOp) {
      return
    }
    const reserved = names.find((n) => RESERVED.has(n.text))
    if (reserved) {
      this.#fail(`'${reserved.text}' is a reserved word — pick another name`, reserved)
    }
  }

  /**
   * Speculatively parses a `binding` or `compound` statement by scanning
   * ahead for `NAME {"," NAME} ("=" | compound-op)` without consuming
   * anything; returns `null` (restoring nothing, since nothing moved) if
   * the shape doesn't match, letting `#parseStmt` fall through to a call
   * statement instead. Reserved names in this shape are already rejected
   * by `#checkReservedBinding` before `#parseStmt` reaches here, so `t0`
   * is never reserved once a binding shape matches.
   */
  readonly #tryParseBinding = (): Statement | null => {
    // lookahead: NAME { "," NAME } ( "=" | compound )
    const start = this.#pos
    const t0 = this.#peek()
    if (t0.kind !== 'name') {
      return null
    }
    const names: string[] = [t0.text]
    let i = 1
    while (
      this.#peek(i).kind === 'op' &&
      this.#peek(i).text === ',' &&
      this.#peek(i + 1).kind === 'name'
    ) {
      names.push(this.#peek(i + 1).text)
      i += 2
    }
    const opTok = this.#peek(i)
    if (opTok.kind !== 'op') {
      return null
    }
    if (opTok.text === '=') {
      this.#pos = start + i + 1
      const e = this.#parseExprSeq()
      this.#expectNL()
      return { kind: 'binding', names, expression: e, bindKind: 'plain', span: this.#span(t0) }
    }
    if (names.length === 1 && ['+=', '-=', '*=', '/='].includes(opTok.text)) {
      this.#pos = start + i + 1
      const e = this.#parseExpr()
      this.#expectNL()
      return {
        kind: 'compound',
        name: names[0] as string,
        operator: opTok.text,
        expression: e,
        span: this.#span(t0),
      }
    }
    return null
  }

  /**
   * Parses `light NAME = ( "dir" | "at" ) point COLOR [ "amb" COLOR expr ] [ "gain" expr ]`
   * (§17.4 `light-def`, ADR-0086). Inline args, no constructor parentheses: `dir`/`at` pick a
   * directional vs point source, `amb`/`gain` are order-free optional tails. Each operand parses
   * in command-arg mode (D2 whitespace-bounded) so `dir 1:1 #ffe6b0` splits cleanly. `dir`/`at`/
   * `amb`/`gain` are keywords only here — the dispatch in `#parseStmt` reached this method only on
   * the `light NAME =` shape, so they never reserve those words elsewhere.
   */
  readonly #parseLightBinding = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // light
    const name = this.#next().text
    this.#next() // =
    const srcTok = this.#peek()
    if (srcTok.kind !== 'name' || (srcTok.text !== 'dir' && srcTok.text !== 'at')) {
      this.#fail("light needs 'dir DX:DY …' (directional) or 'at X:Y …' (point source)", srcTok)
    }
    const source = this.#next().text as 'dir' | 'at'
    const vec = this.#parseExpr(true)
    const color = this.#parseExpr(true)
    let amb: { readonly color: Expression; readonly amount: Expression } | undefined
    let gain: Expression | undefined
    while (!this.#at('nl') && !this.#at('eof') && !this.#at('dedent')) {
      const kw = this.#peek()
      if (kw.kind === 'name' && kw.text === 'amb') {
        this.#next()
        const ambColor = this.#parseExpr(true)
        const ambAmount = this.#parseExpr(true)
        amb = { color: ambColor, amount: ambAmount }
        continue
      }
      if (kw.kind === 'name' && kw.text === 'gain') {
        this.#next()
        gain = this.#parseExpr(true)
        continue
      }
      this.#fail(`unexpected '${kw.text || kw.kind}' in a light binding (expected amb or gain)`, kw)
    }
    this.#expectNL()
    return { kind: 'lightBinding', name, source, vec, color, amb, gain, span: s }
  }

  /**
   * Parses `material NAME = COLOR [ RESPONSE ]` (§17.4 `material-def`, ADR-0086). `RESPONSE` is one
   * of `flat|metal|skin|cloth|glass|glow` — a keyword only in this trailing slot; a bare colour
   * with no response means `flat`. The colour parses in command-arg mode so the response word (if
   * any) stays a separate whitespace-bounded token.
   */
  readonly #parseMaterialBinding = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // material
    const name = this.#next().text
    this.#next() // =
    const color = this.#parseExpr(true)
    // Optional response word right after the colour (a keyword only in this slot).
    let response: string | undefined
    if (this.#peek().kind === 'name' && isMaterialResponse(this.#peek().text)) {
      response = this.#next().text
    }
    // Optional order-free trailing modifiers (ADR-0091): a form profile (`round`|`drape`, a bare
    // keyword flag), and dose overrides `shade`/`hi`/`rim`/`ao`/`spec`/`puff`/`spread` (each a value
    // expression). Keywords only in this slot — bindable names elsewhere.
    let profile: string | undefined
    const overrides: MaterialOverrides = {}
    while (!this.#at('nl') && !this.#at('eof') && !this.#at('dedent')) {
      const kw = this.#peek()
      if (kw.kind === 'name' && isFormProfile(kw.text)) {
        this.#next()
        profile = kw.text
        continue
      }
      if (kw.kind === 'name' && (MATERIAL_OVERRIDE_KEYS as readonly string[]).includes(kw.text)) {
        this.#next()
        overrides[kw.text as MaterialOverrideKey] = this.#parseExpr(true)
        continue
      }
      this.#fail(
        `unexpected '${kw.text || kw.kind}' in a material binding (a response ` +
          `flat|metal|skin|cloth|glass|glow, a profile round|drape, or an override ` +
          `shade|hi|rim|ao|spec|puff|spread N)`,
        kw,
      )
    }
    this.#expectNL()
    return { kind: 'materialBinding', name, color, response, profile, overrides, span: s }
  }

  /**
   * A `fit`/`pin` reference head: a bare `NAME` optionally followed by an unspaced `.NAME`
   * (`torso`, `torso.shoulder`). Returns the head and the pin (`undefined` for the bare form).
   * Consumes exactly those tokens.
   */
  readonly #parseFitRef = (): { readonly head: string; readonly pin: string | undefined } => {
    const head = this.#expect('name', undefined, 'a part name').text
    let pin: string | undefined
    if (this.#at('op', '.') && !this.#peek().spaced && this.#peek(1).kind === 'name') {
      this.#next() // .
      pin = this.#next().text
    }
    return { head, pin }
  }

  /** Whether the upcoming tokens form a bare `fit` reference (`NAME` or `NAME.NAME`) rather than a point expression. */
  readonly #atFitRef = (): boolean => {
    if (this.#peek().kind !== 'name') {
      return false
    }
    const n1 = this.#peek(1)
    // bare ref: a lone name ending the line, or a name followed by the trailing `shadow` flag.
    if (n1.kind === 'nl' || n1.kind === 'eof' || n1.kind === 'dedent') {
      return true
    }
    if (n1.kind === 'name' && n1.text === 'shadow') {
      return true
    }
    // dotted ref: NAME.NAME (unspaced dot). A point expression (`x:y`, `x+1`) instead has an
    // operator like ':' or '+' at n1, so it falls through to the expression branch.
    return n1.kind === 'op' && n1.text === '.' && !n1.spaced && this.#peek(2).kind === 'name'
  }

  /**
   * Parses `pin KEY PT` (§17.4 `pin-decl`, ADR-0087): the attach-point key (a bare `NAME` or a
   * dotted `part.name`) followed by a point expression in command-arg mode. Only reached on the
   * `pin NAME …` shape, so `pin` never reserves the word elsewhere.
   */
  readonly #parsePinDeclaration = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // pin
    let name = this.#expect('name', undefined, 'an attach-point name').text
    if (this.#at('op', '.') && !this.#peek().spaced && this.#peek(1).kind === 'name') {
      this.#next() // .
      name += `.${this.#next().text}`
    }
    const pt = this.#parseCmdArgExpr()
    this.#expectNL()
    return { kind: 'pinDeclaration', name, point: pt, span: s }
  }

  /**
   * Parses `fit TARGET SOURCE [flags] [shadow]` (§17.4 `fit-stmt`, ADR-0087). `TARGET` is always a
   * reference (`NAME`/`NAME.pin`); `SOURCE` is a reference too, or — when it isn't the bare-ref
   * shape — a canvas point expression (the ground-placement oracle). Trailing `flags` are the same
   * `stamp` transform/paint modifiers (`flipx`/`flipy`/`rotN`/`scaleN`/`transform:`/`tint:`/`mask:`,
   * ADR-0087 amendment 2); the bare `shadow` flag opts into an auto contact-shadow ellipse. `shadow`
   * is always bare in a `fit` (the auto pool), so it is read here directly rather than as a keyword.
   */
  readonly #parseFit = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // fit
    const target = this.#parseFitRef()
    let source:
      | { readonly kind: 'ref'; readonly head: string; readonly pin: string | undefined }
      | { readonly kind: 'point'; readonly expression: Expression }
    if (this.#atFitRef()) {
      const ref = this.#parseFitRef()
      source = { kind: 'ref', head: ref.head, pin: ref.pin }
    } else {
      source = { kind: 'point', expression: this.#parseCmdArgExpr() }
    }
    // Trailing modifiers: the stamp transform/paint flags (same grammar as a `call`'s arg run) plus
    // the bare `shadow` boolean and the occlusion/aim clauses (`behind`/`front` NAME, `aim` PIN PT,
    // ADR-0092) — all special-cased before the keyword check so they never eat stamp-flag args.
    const flags: Argument[] = []
    let shadow = false
    const behind: string[] = []
    const front: string[] = []
    let aim: { readonly pin: string; readonly point: Expression } | undefined
    while (!this.#at('nl') && !this.#at('eof') && !this.#at('dedent')) {
      const f = this.#peek()
      if (f.kind === 'name' && f.text === 'shadow') {
        this.#next()
        shadow = true
        continue
      }
      if (
        f.kind === 'name' &&
        (f.text === 'behind' || f.text === 'front') &&
        this.#peek(1).kind === 'name'
      ) {
        const clause = this.#next().text
        const rel = this.#next().text
        if (clause === 'behind') {
          behind.push(rel)
        } else {
          front.push(rel)
        }
        continue
      }
      if (f.kind === 'name' && f.text === 'aim' && this.#peek(1).kind === 'name') {
        this.#next()
        const pin = this.#next().text
        aim = { pin, point: this.#parseCmdArgExpr() }
        continue
      }
      if (f.kind === 'name' && KW_ARG_ARITY[f.text] !== undefined) {
        const kw = this.#next().text
        const arity = KW_ARG_ARITY[kw] ?? 1
        const parts: Expression[] = []
        for (let i = 0; i < arity; i++) {
          parts.push(this.#parseCmdArgExpr())
        }
        flags.push({ kind: 'keyword', keyword: kw, parts, span: this.#span(f) })
        continue
      }
      flags.push({ kind: 'expression', expression: this.#parseCmdArgExpr(), span: this.#span(f) })
    }
    this.#expectNL()
    return { kind: 'fit', target, source, flags, shadow, behind, front, aim, span: s }
  }

  readonly #parseFnDef = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // fn
    const name = this.#next().text
    this.#expect('op', '(')
    const params: string[] = []
    if (!this.#at('op', ')')) {
      params.push(this.#expect('name', undefined, 'a parameter name').text)
      while (this.#at('op', ',')) {
        this.#next()
        params.push(this.#expect('name', undefined, 'a parameter name').text)
      }
    }
    this.#expect('op', ')')
    this.#expect('op', '=', "'='")
    const body = this.#parseExpr()
    this.#expectNL()
    return { kind: 'functionDefinition', name, params, body, span: s }
  }

  /**
   * Parses `filter NAME: body` (§17.4 `filter-def`): reads the body as an
   * ordinary block, then rejects (E004) any statement that isn't a
   * `call` — the grammar-level `filter-cmd` restriction is enforced here
   * as a post-check rather than by a dedicated block parser.
   */
  readonly #parseFilterDef = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // filter
    const name = this.#next().text
    this.#expect('op', ':')
    const body = this.#parseBlock()
    for (const st of body) {
      if (st.kind !== 'call') {
        throw error(
          ERROR_CODE.syntax,
          'a filter body holds filter commands only',
          this.#file,
          st.span,
        )
      }
    }
    return { kind: 'filterDefinition', name, body, span: s }
  }

  // ── paths (contextual, D4) ────────────────────────────────────────────

  /**
   * Optional `(name-list)` parameter list right after a `path` name.
   * Returns `undefined` (not `[]`) when absent, distinguishing a
   * non-parametric definition from one with an explicit empty list. The
   * `(` must be unspaced — spaced would instead start a point/group in
   * the size or body that follows. (`#parseDraw` parses its own params
   * inline rather than sharing this helper.)
   */
  readonly #parsePathParams = (): string[] | undefined => {
    if (!(this.#at('op', '(') && !this.#peek().spaced)) {
      return undefined
    }
    this.#next()
    const params: string[] = []
    if (!this.#at('op', ')')) {
      params.push(this.#expect('name', undefined, 'a parameter').text)
      while (this.#at('op', ',')) {
        this.#next()
        params.push(this.#expect('name', undefined, 'a parameter').text)
      }
    }
    this.#expect('op', ')')
    return params
  }

  /**
   * Parses `path-def` (§17.4): either `path NAME [(params)] [SIZE]: body` (a
   * pen-command block) or `path NAME [(params)] = expr` (an alias or Path
   * boolean combination) — the two forms share the name/params prefix and
   * then branch on whether `=` or `SIZE`/`:` follows.
   */
  readonly #parsePathDef = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // path
    const name = this.#next().text
    const params = this.#parsePathParams()
    if (this.#at('op', '=')) {
      this.#next()
      const expression = this.#parseExprSeq()
      this.#expectNL()
      const def: PathDefinition = {
        name,
        params,
        size: undefined,
        body: { kind: 'expression', expression },
        span: s,
      }
      return { kind: 'pathDefinition', def, span: s }
    }
    let size: { width: number; height: number } | undefined
    if (this.#at('size')) {
      const t = this.#next()
      size = { width: t.num, height: t.sizeH }
    }
    this.#expect('op', ':', "':' to open the path body")
    this.#expect('nl')
    this.#skipNLs()
    this.#expect('indent', undefined, 'an indented path body')
    const commands: PathCommand[] = []
    this.#skipNLs()
    while (!this.#at('dedent') && !this.#at('eof')) {
      commands.push(this.#parsePathCommand())
      this.#expectNL()
      this.#skipNLs()
    }
    if (this.#at('dedent')) {
      this.#next()
    }
    const def: PathDefinition = {
      name,
      params,
      size,
      body: { kind: 'commands', commands },
      span: s,
    }
    return { kind: 'pathDefinition', def, span: s }
  }

  /**
   * Parses one path-command point slot: an optional leading `rel` keyword
   * (the only surviving relative-motion marker, path-local per ADR-0061)
   * followed by the point expression itself.
   */
  readonly #parseRelPoint = (): { readonly expression: Expression; readonly relative: boolean } => {
    let relative = false
    if (this.#atName('rel')) {
      relative = true
      this.#next()
    }
    return { expression: this.#parseCmdArgExpr(), relative }
  }

  /**
   * Parses `path-cmd` (§17.4): dispatches on the leading command name. Each arm
   * consumes its fixed arity of `#parseRelPoint` operands; `arc` additionally
   * requires a literal `around <center> cw|ccw` suffix.
   */
  readonly #parsePathCommand = (): PathCommand => {
    const t = this.#peek()
    const span = this.#span(t)
    const name = this.#expect('name', undefined, 'a path command').text
    switch (name) {
      case 'move': {
        const p = this.#parseRelPoint()
        return { kind: 'move', point: p.expression, relative: p.relative, span }
      }
      case 'line': {
        const p = this.#parseRelPoint()
        return { kind: 'line', point: p.expression, relative: p.relative, span }
      }
      case 'quad': {
        const c = this.#parseRelPoint()
        const p = this.#parseRelPoint()
        return {
          kind: 'quad',
          control: c.expression,
          point: p.expression,
          controlRelative: c.relative,
          pointRelative: p.relative,
          span,
        }
      }
      case 'bezier': {
        const c1 = this.#parseRelPoint()
        const c2 = this.#parseRelPoint()
        const p = this.#parseRelPoint()
        return {
          kind: 'bezier',
          control1: c1.expression,
          control2: c2.expression,
          point: p.expression,
          control1Relative: c1.relative,
          control2Relative: c2.relative,
          pointRelative: p.relative,
          span,
        }
      }
      case 'arc': {
        const p = this.#parseRelPoint()
        if (!this.#atName('around')) {
          this.#fail("path arc expects 'around <center> cw|ccw'")
        }
        this.#next()
        const center = this.#parseCmdArgExpr()
        const dir = this.#expect('name', undefined, "'cw' or 'ccw'").text
        if (dir !== 'cw' && dir !== 'ccw') {
          this.#fail("path arc direction must be 'cw' or 'ccw'")
        }
        return {
          kind: 'arc',
          point: p.expression,
          center,
          clockwise: dir === 'cw',
          pointRelative: p.relative,
          span,
        }
      }
      case 'close':
        return { kind: 'close', span }
      default:
        return this.#fail(`unknown path command '${name}'`, t)
    }
  }

  /** Assemble a bareword path from adjacent (unspaced) tokens. */
  readonly #parsePath = (): string => {
    const first = this.#next()
    let out = first.text
    if (
      first.kind !== 'name' &&
      first.kind !== 'int' &&
      !(first.kind === 'op' && (first.text === '.' || first.text === '..' || first.text === '/'))
    ) {
      this.#fail('expected a path', first)
    }
    for (;;) {
      const t = this.#peek()
      if (t.spaced || t.kind === 'nl' || t.kind === 'eof') {
        break
      }
      if (
        t.kind === 'name' ||
        t.kind === 'int' ||
        t.kind === 'size' ||
        (t.kind === 'op' && ['/', '.', '..', '-'].includes(t.text)) ||
        t.kind === 'float' // e.g. "v1.2" inside a segment
      ) {
        out += t.text
        this.#next()
        continue
      }
      break
    }
    return out
  }

  /**
   * Parses `from-stmt` (§17.4): source-first import (ADR-0019) — the module path
   * leads, then one or more `NAME [as NAME]` items.
   */
  readonly #parseFrom = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // from
    const module = this.#parsePath()
    const items: { name: string; alias: string | undefined }[] = []
    const one = (): void => {
      const name = this.#expect('name', undefined, 'an imported name').text
      let alias: string | undefined
      if (this.#atName('as')) {
        this.#next()
        alias = this.#expect('name', undefined, 'an alias').text
      }
      items.push({ name, alias })
    }
    one()
    while (this.#at('op', ',')) {
      this.#next()
      one()
    }
    this.#expectNL()
    return { kind: 'import', module, items, span: s }
  }

  /**
   * Parses `use-stmt` (§17.4): `use [MODULE-PATH] NAME`. Token count resolves the
   * ambiguity — a trailing bare `NAME` after the path means the first
   * token was a module path (imported theme); otherwise the single token
   * parsed by `#parsePath` is itself the local theme name (spec §12).
   */
  readonly #parseUse = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // use
    const first = this.#parsePath()
    if (this.#at('name')) {
      const name = this.#next().text
      this.#expectNL()
      return { kind: 'use', module: first, name, span: s }
    }
    this.#expectNL()
    return { kind: 'use', module: undefined, name: first, span: s }
  }

  /**
   * Parses `image-import` (§17.4): `import NAME = FILE-PATH [sha256 HEX]`. The
   * trailing `sha256` pin is optional and checked against the loaded
   * file's content hash at build time (E020 on mismatch), not here.
   */
  readonly #parseImageImport = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // import
    const name = this.#next().text
    this.#expect('op', '=')
    const path = this.#parsePath()
    let sha: string | undefined
    if (this.#atName('sha256')) {
      this.#next()
      const h = this.#next()
      sha = h.text
    }
    this.#expectNL()
    return { kind: 'imageImport', name, path, sha256: sha, span: s }
  }

  // ── draw / theme / font / tileset / atlas / export ───────────────────

  /**
   * Guards the draw-header size slot against the common mistake of writing
   * a point literal (`9:20`, the `x:y` grammar of ADR-0058) where a `WxH`
   * SIZE token (`9x20`) is expected. Left alone, `NUMBER ':' NUMBER` there
   * just falls through to the generic "expected ':' ..., got '9'" E004 from
   * `#expect` below — true, but it doesn't name the actual mistake. Only
   * fires when the current token isn't already `:` (i.e. a real `SIZE` or
   * no size at all was already accepted), so the generic E004 path for
   * every other unexpected token is untouched.
   */
  readonly #failOnPointSizedHeader = (): void => {
    if (this.#at('op', ':')) {
      return
    }
    const t0 = this.#peek()
    const t1 = this.#peek(1)
    const t2 = this.#peek(2)
    if (
      (t0.kind === 'int' || t0.kind === 'float') &&
      t1.kind === 'op' &&
      t1.text === ':' &&
      (t2.kind === 'int' || t2.kind === 'float')
    ) {
      throw error(
        ERROR_CODE.syntax,
        `drawing size is WxH with integer literals (e.g. 9x20) — '${t0.text}:${t2.text}' is a point`,
        this.#file,
        { line: t0.line, column: t0.col, endLine: t2.endLine, endColumn: t2.endCol },
        "use 'x' between width and height, e.g. 9x20",
      )
    }
  }

  /**
   * Parses `draw-def` (§17.4): `draw NAME [(params)] [SIZE]: body`. After parsing
   * the body as an ordinary block, re-walks it once to enforce that a
   * drawing-level `use` (ADR-0051) precedes every other statement —
   * positioned E004 otherwise.
   */
  readonly #parseDraw = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // draw
    const name = this.#next().text
    let params: string[] | undefined
    if (this.#at('op', '(') && !this.#peek().spaced) {
      this.#next()
      params = []
      if (!this.#at('op', ')')) {
        params.push(this.#expect('name', undefined, 'a parameter').text)
        while (this.#at('op', ',')) {
          this.#next()
          params.push(this.#expect('name', undefined, 'a parameter').text)
        }
      }
      this.#expect('op', ')')
    }
    let size: { width: number; height: number } | undefined
    if (this.#at('size')) {
      const t = this.#next()
      size = { width: t.num, height: t.sizeH }
    }
    this.#failOnPointSizedHeader()
    this.#expect('op', ':', "':' to open the drawing body")
    const body = this.#parseBlock()
    // `use` must lead (§6): validate position
    let seenOther = false
    for (const st of body) {
      if (st.kind === 'use') {
        if (seenOther) {
          throw error(
            ERROR_CODE.syntax,
            "drawing-level 'use' must precede all other statements",
            this.#file,
            st.span,
          )
        }
      } else {
        seenOther = true
      }
    }
    const def: DrawDefinition = { name, params, size, body, span: s }
    return { kind: 'drawDefinition', def, span: s }
  }

  /**
   * Parses `theme-def` (§17.4): `theme NAME: { theme-item }`. Reuses the ordinary
   * block parser — `theme-item` legality (spec §12) is not checked here.
   */
  readonly #parseTheme = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // theme
    const name = this.#next().text
    this.#expect('op', ':')
    const items = this.#parseBlock()
    const def: ThemeDefinition = { name, items, span: s }
    return { kind: 'themeDefinition', def, span: s }
  }

  /**
   * Parses `font-def` (§17.4): `font NAME [SIZE]: { font-item }`. Only reachable
   * via the D7 lookahead in `#parseStmt` (a `font NAME :`/`SIZE` shape,
   * as opposed to the bare `font-dir` directive). Font items have their
   * own indented-block loop rather than reusing `#parseBlock`, since a
   * `FontItem` is not a `Statement`.
   */
  readonly #parseFontDef = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // font
    const name = this.#next().text
    let size: { width: number; height: number } | undefined
    if (this.#at('size')) {
      const t = this.#next()
      size = { width: t.num, height: t.sizeH }
    }
    this.#expect('op', ':')
    this.#expect('nl')
    this.#skipNLs()
    this.#expect('indent', undefined, 'an indented font body')
    const items: FontItem[] = []
    this.#skipNLs()
    while (!this.#at('dedent') && !this.#at('eof')) {
      const t = this.#peek()
      const sp = this.#span(t)
      if (t.kind !== 'name') {
        this.#fail('expected a font item')
      }
      switch (t.text) {
        case 'with': {
          this.#next()
          items.push({ kind: 'with', name: this.#next().text, span: sp })
          break
        }
        case 'glyph': {
          this.#next()
          const ch = this.#expect('string', undefined, 'a character string').str
          if (
            this.#at('op', ':') ||
            (this.#at('size') && this.#peek(1).kind === 'op' && this.#peek(1).text === ':')
          ) {
            let glyphSize: { width: number; height: number } | undefined
            if (this.#at('size')) {
              const t = this.#next()
              glyphSize = { width: t.num, height: t.sizeH }
            }
            this.#expect('op', ':')
            const body = this.#parseBlock()
            items.push({ kind: 'inlineGlyph', char: ch, size: glyphSize, body, span: sp })
            this.#skipNLs()
            continue
          }
          const drawing = this.#expect('name', undefined, 'a drawing name').text
          items.push({ kind: 'glyph', char: ch, drawing, span: sp })
          break
        }
        case 'glyphs': {
          this.#next()
          const ts = this.#expect('name', undefined, 'a tileset name').text
          const chars = this.#expect('string', undefined, 'a character string').str
          items.push({ kind: 'glyphs', tileset: ts, chars, span: sp })
          break
        }
        case 'tracking': {
          this.#next()
          items.push({ kind: 'tracking', value: this.#expect('int').num, span: sp })
          break
        }
        case 'lineheight': {
          this.#next()
          items.push({ kind: 'lineheight', value: this.#expect('int').num, span: sp })
          break
        }
        default:
          this.#fail(`unknown font item '${t.text}'`)
      }
      this.#expectNL()
      this.#skipNLs()
    }
    if (this.#at('dedent')) {
      this.#next()
    }
    const def: FontDefinition = { name, size, items, span: s }
    return { kind: 'fontDefinition', def, span: s }
  }

  /**
   * Parses `tileset-def` (§17.4): `tileset NAME SIZE: { tileset-item }`. `tiles`
   * may repeat (entries accumulate) and `cols` may repeat (last write
   * wins) — neither is restricted to appearing once.
   */
  readonly #parseTileset = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // tileset
    const name = this.#next().text
    const sz = this.#expect('size')
    this.#expect('op', ':')
    this.#expect('nl')
    this.#skipNLs()
    this.#expect('indent')
    const tiles: string[] = []
    let cols: number | undefined
    this.#skipNLs()
    while (!this.#at('dedent') && !this.#at('eof')) {
      const t = this.#peek()
      if (this.#atName('tiles')) {
        this.#next()
        tiles.push(...this.#parseNameList())
      } else if (this.#atName('cols')) {
        this.#next()
        cols = this.#expect('int').num
      } else {
        this.#fail(`unknown tileset item '${t.text}'`)
      }
      this.#expectNL()
      this.#skipNLs()
    }
    if (this.#at('dedent')) {
      this.#next()
    }
    const def: TilesetDefinition = {
      name,
      tileWidth: sz.num,
      tileHeight: sz.sizeH,
      tiles,
      columns: cols,
      span: s,
    }
    return { kind: 'tilesetDefinition', def, span: s }
  }

  /**
   * Parses `atlas-def` (§17.4): `atlas NAME: { atlas-item }`. `place NAME x:y`
   * reads `x` and `y` as two bare `INT`s around a literal `:` — not
   * through the point-expression grammar, so `place` coordinates cannot
   * be arithmetic expressions.
   */
  readonly #parseAtlas = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // atlas
    const name = this.#next().text
    this.#expect('op', ':')
    this.#expect('nl')
    this.#skipNLs()
    this.#expect('indent')
    const sprites: string[] = []
    let pad = 0
    const place: { name: string; x: number; y: number }[] = []
    this.#skipNLs()
    while (!this.#at('dedent') && !this.#at('eof')) {
      const t = this.#peek()
      if (this.#atName('sprites')) {
        this.#next()
        sprites.push(...this.#parseNameList())
      } else if (this.#atName('pad')) {
        this.#next()
        pad = this.#expect('int').num
      } else if (this.#atName('place')) {
        this.#next()
        const n = this.#expect('name').text
        const x = this.#expect('int').num
        this.#expect('op', ':')
        const y = this.#expect('int').num
        place.push({ name: n, x, y })
      } else {
        this.#fail(`unknown atlas item '${t.text}'`)
      }
      this.#expectNL()
      this.#skipNLs()
    }
    if (this.#at('dedent')) {
      this.#next()
    }
    const def: AtlasDefinition = { name, sprites, padding: pad, place, span: s }
    return { kind: 'atlasDefinition', def, span: s }
  }

  /** Parses `export-def` (§17.4): `export NAME OUTPUT-PATH: { format-line }`. */
  readonly #parseExport = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // export
    const name = this.#next().text
    const basePath = this.#parsePath()
    this.#expect('op', ':')
    this.#expect('nl')
    this.#skipNLs()
    this.#expect('indent')
    const formats: FormatLine[] = []
    this.#skipNLs()
    while (!this.#at('dedent') && !this.#at('eof')) {
      formats.push(this.#parseFormatLine())
      this.#skipNLs()
    }
    if (this.#at('dedent')) {
      this.#next()
    }
    return { kind: 'exportDefinition', def: { name, basePath, formats, span: s }, span: s }
  }

  /**
   * Parses `format-line` (§17.4): one export line, `FORMAT { flag }`. Flags are
   * scanned in a single order-free loop and written onto `line` as they're
   * recognized — most are accepted regardless of `format` (e.g. nothing
   * stops `svg z3`); `xml` is the one flag gated on `format === 'tiled'`
   * here. Any other per-format validation happens later, not in the
   * parser. The `Z-FLAG`/`Q-FLAG` spec tokens (§17.2) have no dedicated
   * lexer kind — they arrive as plain `NAME`s and are matched here by
   * regex (`zN`, `qNN`).
   */
  readonly #parseFormatLine = (): FormatLine => {
    const t = this.#peek()
    const sp = this.#span(t)
    const fmt = this.#expect(
      'name',
      undefined,
      'a format (png/svg/jpeg/tiled/atlasJson/aseprite/path)',
    ).text
    if (!['png', 'svg', 'jpeg', 'tiled', 'atlasJson', 'aseprite', 'path'].includes(fmt)) {
      this.#fail(`unknown export format '${fmt}'`, t)
    }
    const line: FormatLine = {
      format: fmt as FormatLine['format'],
      scales: [],
      sizes: [],
      zlib: undefined,
      quality: undefined,
      indexed: false,
      svgFlags: [],
      tiledXml: false,
      mode: undefined,
      span: sp,
    }
    while (!this.#at('nl') && !this.#at('eof') && !this.#at('dedent')) {
      const f = this.#peek()
      if (f.kind === 'op' && f.text === '@') {
        this.#next()
        line.scales.push(this.#expect('int', undefined, 'a scale factor').num)
        continue
      }
      if (f.kind === 'int') {
        this.#next()
        line.sizes.push({ width: f.num, height: undefined })
        continue
      }
      if (f.kind === 'size') {
        this.#next()
        line.sizes.push({ width: f.num, height: f.sizeH })
        continue
      }
      if (f.kind === 'name') {
        const m = f.text
        if (/^z\d$/.test(m)) {
          this.#next()
          line.zlib = Number.parseInt(m.slice(1), 10)
          continue
        }
        if (/^q\d+$/.test(m)) {
          this.#next()
          line.quality = Number.parseInt(m.slice(1), 10)
          continue
        }
        if (m === 'indexed') {
          this.#next()
          line.indexed = true
          continue
        }
        if (m === 'mode') {
          this.#next()
          const mv = this.#expect('name', undefined, "'pixel' or 'smooth'").text
          if (mv !== 'pixel' && mv !== 'smooth') {
            this.#fail("mode must be 'pixel' or 'smooth'")
          }
          line.mode = mv as 'pixel' | 'smooth'
          continue
        }
        if (['ids', 'classes', 'inlineStyles'].includes(m)) {
          this.#next()
          line.svgFlags.push(m)
          continue
        }
        if (m === 'xml' && line.format === 'tiled') {
          this.#next()
          line.tiledXml = true
          continue
        }
      }
      this.#fail(`unknown export flag '${f.text}'`, f)
    }
    this.#expectNL()
    return line
  }

  // ── pal / pixels ──────────────────────────────────────────────────────

  /**
   * Parses `pal-stmt` (§17.4): the inline form (`pal k=#235 d=#555`, whitespace-
   * separated, D2) or the block form (`pal:` + indented entries, one per
   * line). Destructuring entries (`r, g, b = rgb`) are accepted only in
   * the block form — the inline form's entries are single-key only.
   */
  readonly #parsePal = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // pal
    const entries: PaletteEntry[] = []
    if (this.#at('op', ':') && this.#peek().blockColon) {
      this.#next()
      this.#expect('nl')
      this.#skipNLs()
      this.#expect('indent')
      this.#skipNLs()
      while (!this.#at('dedent') && !this.#at('eof')) {
        entries.push(this.#parsePalEntry(true))
        this.#expectNL()
        this.#skipNLs()
      }
      if (this.#at('dedent')) {
        this.#next()
      }
    } else {
      // inline form: whitespace-separated key=value entries
      while (!this.#at('nl') && !this.#at('eof')) {
        entries.push(this.#parsePalEntry(false))
      }
      this.#expectNL()
    }
    return { kind: 'palette', entries, span: s }
  }

  /**
   * A `pal` entry's key: exactly one ASCII letter (`KEY`, spec §17.2,
   * ADR-0049). A longer name fails with {@link ERROR_CODE.paletteCollision}
   * (E007) — reused here for "not a valid key shape", not only for actual
   * name collisions.
   */
  readonly #parsePaletteKey = (): Token => {
    const kt = this.#expect('name', undefined, 'a palette key')
    if (kt.text.length !== 1) {
      throw error(
        ERROR_CODE.paletteCollision,
        `palette key '${kt.text}' must be exactly one ASCII letter`,
        this.#file,
        this.#span(kt),
        'to name a color for expressions, use a plain binding instead',
      )
    }
    return kt
  }

  /**
   * Parses `pal-entry` (§17.4, extended): `KEY "=" expr`, or — when
   * `allowDestructuring` — `KEY {"," KEY} "=" expr` binding several keys
   * positionally from one list-valued expression.
   */
  readonly #parsePalEntry = (allowDestructuring: boolean): PaletteEntry => {
    const kt = this.#parsePaletteKey()
    const keys = [kt.text]
    while (allowDestructuring && this.#at('op', ',')) {
      this.#next()
      keys.push(this.#parsePaletteKey().text)
    }
    this.#expect('op', '=', "'='")
    const e = this.#parseExpr()
    if (keys.length === 1) {
      return { kind: 'entry', key: kt.text, expression: e, span: this.#span(kt) }
    }
    return { kind: 'destructure', keys, expression: e, span: this.#span(kt) }
  }

  /**
   * Parses `pixels-block` (§17.4): `pixels:` followed by one or more `PIXEL-ROW`
   * lines. Rows are consumed as opaque, pre-lexed `pixelrow` tokens (their
   * key/`.` structure isn't validated here — that's an eval-time concern,
   * spec §7). An empty block is a positioned error rather than a valid
   * zero-row pixels statement.
   */
  readonly #parsePixels = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // pixels
    this.#next() // :
    this.#expect('nl')
    this.#expect('indent')
    const rows: { text: string; span: TextSpan }[] = []
    while (this.#at('pixelrow')) {
      const t = this.#next()
      rows.push({ text: t.text, span: this.#span(t) })
      if (this.#at('nl')) {
        this.#next()
      }
    }
    this.#expect('dedent', undefined, 'the end of the pixels block')
    if (rows.length === 0) {
      this.#fail('pixels block is empty')
    }
    return { kind: 'pixels', rows, span: s }
  }

  // ── control flow ──────────────────────────────────────────────────────

  /**
   * Parses `if-stmt` (§17.4): `if expr: block [else: block]`. The optional
   * `else` is recognized only when immediately followed by `:` — plain
   * `else` cannot appear otherwise since it's reserved everywhere
   * (§17.2), so this lookahead is really just requiring the block form.
   */
  readonly #parseIfStmt = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // if
    const cond = this.#parseExpr()
    this.#expect('op', ':', "':'")
    const then = this.#parseBlock()
    let elseStatement: Statement[] | undefined
    this.#skipNLs()
    if (this.#atName('else') && this.#peek(1).text === ':') {
      this.#next()
      this.#next()
      elseStatement = this.#parseBlock()
    }
    return {
      kind: 'if',
      condition: cond,
      thenStatement: then,
      elseStatement: elseStatement,
      span: s,
    }
  }

  /**
   * Parses `match-stmt` (§17.4): `match expr: { arm }`. Each arm is either
   * `else:` or a label expression parsed with `#inArmLabel` set so
   * `#parsePointOperand` stops at the arm's first depth-0 `:` instead of
   * reading it as a point separator (D3). The arm body is a block when
   * the label's `:` opens one (`colon.blockColon`), otherwise a single
   * inline statement.
   */
  readonly #parseMatch = (): Statement => {
    const s = this.#span(this.#peek())
    this.#next() // match
    const subject = this.#parseExpr()
    this.#expect('op', ':')
    this.#expect('nl')
    this.#skipNLs()
    this.#expect('indent')
    const arms: MatchArm[] = []
    this.#skipNLs()
    while (!this.#at('dedent') && !this.#at('eof')) {
      const at = this.#peek()
      const asp = this.#span(at)
      let label: Expression | undefined
      if (this.#atName('else') && this.#peek(1).text === ':') {
        this.#next()
      } else {
        // D3: the label ends at the first depth-0 ":" of the line
        this.#inArmLabel = true
        label = this.#parseExpr()
        this.#inArmLabel = false
      }
      const colon = this.#expect('op', ':', "':' after the match label")
      let body: Statement[]
      if (colon.blockColon) {
        body = this.#parseBlock()
      } else {
        body = [this.#parseStmt(false)]
      }
      arms.push({ label, body, span: asp })
      this.#skipNLs()
    }
    if (this.#at('dedent')) {
      this.#next()
    }
    return { kind: 'match', subject, arms, span: s }
  }

  // ── call statements ───────────────────────────────────────────────────

  /**
   * Parses `call-stmt` (§17.4, ADR-0015): dispatches to paren-form (`callee(a,
   * b)`, unspaced `(`) or command-form (`callee a b`, args split at
   * depth-0 whitespace, D2) based purely on whether an unspaced `(`
   * follows the callee. In command-form, any bare `NAME` that's a key of
   * {@link KW_ARG_ARITY} is *always* read as that keyword's argument form
   * (unlike `#parseParenArg`, which only does so when the name isn't
   * itself being used as a value) — command-form has no escape hatch for
   * a binding that happens to share a name with `mask`, `tint`, etc.
   */
  readonly #parseCallStmt = (): Statement => {
    const t = this.#peek()
    const s = this.#span(t)
    if (t.kind !== 'name') {
      this.#fail(`expected a command, got '${t.text || t.kind}'`)
    }
    const callee = this.#next().text

    // paren-form: callee immediately followed by "("
    if (this.#at('op', '(') && !this.#peek().spaced) {
      this.#next()
      const args: Argument[] = []
      if (!this.#at('op', ')')) {
        args.push(this.#parseParenArg())
        while (this.#at('op', ',')) {
          this.#next()
          args.push(this.#parseParenArg())
        }
      }
      this.#expect('op', ')')
      this.#expectNL()
      return { kind: 'call', callee, args, span: s }
    }

    // command-form: args split at depth-0 whitespace (D2)
    const args: Argument[] = []
    while (!this.#at('nl') && !this.#at('eof') && !this.#at('dedent')) {
      const f = this.#peek()
      // `stamp PART PT behind/front TARGET` (ADR-0092): the occlusion clauses are contextual
      // keyword args recognized only for the `stamp` command, so `behind`/`front` stay ordinary
      // bindable names everywhere else. The one trailing token is the target part-name.
      if (
        callee === 'stamp' &&
        f.kind === 'name' &&
        (f.text === 'behind' || f.text === 'front') &&
        this.#peek(1).kind === 'name'
      ) {
        const kw = this.#next().text
        const parts: Expression[] = [this.#parseCmdArgExpr()]
        args.push({ kind: 'keyword', keyword: kw, parts, span: this.#span(f) })
        continue
      }
      if (f.kind === 'name' && KW_ARG_ARITY[f.text] !== undefined) {
        const kw = this.#next().text
        const arity = KW_ARG_ARITY[kw] ?? 1
        const parts: Expression[] = []
        for (let i = 0; i < arity; i++) {
          parts.push(this.#parseCmdArgExpr())
        }
        args.push({ kind: 'keyword', keyword: kw, parts, span: this.#span(f) })
        continue
      }
      args.push({ kind: 'expression', expression: this.#parseCmdArgExpr(), span: this.#span(f) })
    }
    this.#expectNL()
    return { kind: 'call', callee, args, span: s }
  }

  /**
   * One paren-form argument slot: keyword-prefixed sequence or expression.
   * A `KW_ARG_ARITY` name is read as a plain value expression (not the
   * keyword form) when the token right after it is a continuation
   * operator (`( , ) . [`) — i.e. when it's being *used*, not applied —
   * so `f(mask)` and `f(mask.grayscale)` pass `mask` through as a value.
   */
  readonly #parseParenArg = (): Argument => {
    const f = this.#peek()
    if (
      f.kind === 'name' &&
      KW_ARG_ARITY[f.text] !== undefined &&
      !(this.#peek(1).kind === 'op' && ['(', ',', ')', '.', '['].includes(this.#peek(1).text))
    ) {
      const kw = this.#next().text
      const arity = KW_ARG_ARITY[kw] ?? 1
      const parts: Expression[] = []
      for (let i = 0; i < arity; i++) {
        parts.push(this.#parseExpr())
      }
      return { kind: 'keyword', keyword: kw, parts, span: this.#span(f) }
    }
    return { kind: 'expression', expression: this.#parseExpr(), span: this.#span(f) }
  }

  /** One command-form argument: an expression bounded by depth-0 whitespace. */
  readonly #parseCmdArgExpr = (): Expression => this.#parseExpr(true)

  readonly #parseNameList = (): string[] => {
    const names = [this.#expect('name', undefined, 'a name').text]
    while (this.#at('op', ',')) {
      this.#next()
      names.push(this.#expect('name', undefined, 'a name').text)
    }
    return names
  }

  // ── expressions (grammar §17.4, bottom) ───────────────────────────────
  // cmdArg mode: stop at depth-0 whitespace (D2).

  // Precedence climb, loosest to tightest:
  //   parseExpr → if-expr | parseRange → parseOr → parseAnd → parseNot →
  //   parseComparison → parseSum → parseTerm → parsePointOperand (":" —
  //   ADR-0058 point arithmetic) → parsePointCoord (unary "-") →
  //   parsePostfix → parseAtom.
  // Every tier takes `cmdArg`, threaded down from the call site
  // (`#parseCmdArgExpr` passes `true`) so `#boundary` can stop at depth-0
  // whitespace anywhere in the chain (D2).

  /**
   * Parses `expr-seq = expr {"," expr}` (§17.4) — a bare comma list, used for
   * `binding` right-hand sides and `for`'s iterable. A single expression
   * with no comma is returned as-is, not wrapped in a one-element list.
   */
  readonly #parseExprSeq = (): Expression => {
    const first = this.#parseExpr()
    if (!this.#at('op', ',')) {
      return first
    }
    const items = [first]
    while (this.#at('op', ',')) {
      this.#next()
      items.push(this.#parseExpr())
    }
    return { kind: 'list', items, span: first.span }
  }

  /**
   * Bracket/paren nesting depth, incremented by `#parsePostfix` and the
   * grouping-paren/list case of `#parseAtom`. Whitespace inside brackets
   * never splits command-form arguments (D2) — `#boundary` only fires at
   * depth 0.
   */
  #depth = 0
  /**
   * Set by `#parseMatch` while parsing an arm's label so
   * `#parsePointOperand` treats a depth-0 `:` as the label terminator
   * instead of a point separator (D3).
   */
  #inArmLabel = false

  /** In cmdArg mode a spaced token at depth 0 ends the expression. */
  readonly #boundary = (cmdArg: boolean): boolean => {
    if (!cmdArg || this.#depth > 0) {
      return false
    }
    return this.#peek().spaced
  }

  readonly #parseExpr = (cmdArg = false): Expression => {
    if (this.#atName('if')) {
      return this.#parseIfExpr(cmdArg)
    }
    return this.#parseRange(cmdArg)
  }

  /**
   * Parses `if-expr = "if" expr "then" expr "else" expr` (§17.4). `cond` and
   * `then` always parse with `cmdArg = false`: the literal `then`/`else`
   * keywords are unambiguous terminators, so depth-0-whitespace boundary
   * detection (D2) isn't needed until the tail `else` branch, which is in
   * the same position the whole `if-expr` was called from and so
   * propagates the caller's original `cmdArg`.
   */
  readonly #parseIfExpr = (cmdArg: boolean): Expression => {
    const s = this.#span(this.#peek())
    this.#next() // if
    const cond = this.#parseOr(false)
    if (!this.#atName('then')) {
      this.#fail("expected 'then' in if-expression")
    }
    this.#next()
    const then = this.#atName('if') ? this.#parseIfExpr(false) : this.#parseRange(false)
    if (!this.#atName('else')) {
      this.#fail("expected 'else' in if-expression (both branches required)")
    }
    this.#next()
    const else_ = this.#atName('if') ? this.#parseIfExpr(cmdArg) : this.#parseRange(cmdArg)
    return {
      kind: 'ifExpression',
      condition: cond,
      thenExpression: then,
      elseExpression: else_,
      span: s,
    }
  }

  readonly #parseRange = (cmdArg: boolean): Expression => {
    const l = this.#parseOr(cmdArg)
    const t = this.#peek()
    if (t.kind === 'op' && (t.text === '..' || t.text === '..=') && !this.#boundary(cmdArg)) {
      this.#next()
      const r = this.#parseOr(cmdArg)
      return { kind: 'range', from: l, to: r, inclusive: t.text === '..=', span: l.span }
    }
    return l
  }

  readonly #parseOr = (cmdArg: boolean): Expression => {
    let l = this.#parseAnd(cmdArg)
    while (this.#at('op', '|') && !this.#boundary(cmdArg)) {
      this.#next()
      const r = this.#parseAnd(cmdArg)
      l = { kind: 'binary', operator: '|', left: l, right: r, span: l.span }
    }
    return l
  }

  readonly #parseAnd = (cmdArg: boolean): Expression => {
    let l = this.#parseNot(cmdArg)
    while (this.#at('op', '&') && !this.#boundary(cmdArg)) {
      this.#next()
      const r = this.#parseNot(cmdArg)
      l = { kind: 'binary', operator: '&', left: l, right: r, span: l.span }
    }
    return l
  }

  readonly #parseNot = (cmdArg: boolean): Expression => {
    if (this.#at('op', '!')) {
      const s = this.#span(this.#peek())
      this.#next()
      const e = this.#parseNot(cmdArg)
      return { kind: 'unary', operator: '!', operand: e, span: s }
    }
    return this.#parseComparison(cmdArg)
  }

  readonly #parseComparison = (cmdArg: boolean): Expression => {
    const l = this.#parseSum(cmdArg)
    const t = this.#peek()
    if (
      t.kind === 'op' &&
      ['==', '!=', '>=', '<=', '>', '<'].includes(t.text) &&
      !this.#boundary(cmdArg)
    ) {
      this.#next()
      const r = this.#parseSum(cmdArg)
      return { kind: 'binary', operator: t.text, left: l, right: r, span: l.span }
    }
    return l
  }

  /**
   * Parses `point = point-coord [":" point-coord]` (§17.4). Sits between `term`
   * and `postfix` in the climb (ADR-0058: a point literal binds tighter
   * than `* / // mod`, so `4:4 * 2` is `(4:4) * 2`).
   */
  readonly #parsePointOperand = (cmdArg: boolean): Expression => {
    const x = this.#parsePointCoord(cmdArg)
    // D1: a line-final ":" opens a block, never a point.
    // D3: at depth 0 of a match-arm label, ":" ends the label instead.
    if (
      this.#at('op', ':') &&
      !this.#peek().blockColon &&
      !this.#boundary(cmdArg) &&
      !(this.#inArmLabel && this.#depth === 0)
    ) {
      this.#next()
      const y = this.#parsePointCoord(cmdArg)
      return { kind: 'point', x, y, span: x.span }
    }
    return x
  }

  readonly #parsePointCoord = (cmdArg: boolean): Expression => {
    if (this.#at('op', '-')) {
      const s = this.#span(this.#peek())
      this.#next()
      const e = this.#parsePointCoord(cmdArg)
      return { kind: 'unary', operator: '-', operand: e, span: s }
    }
    return this.#parsePostfix(cmdArg)
  }

  readonly #parseSum = (cmdArg: boolean): Expression => {
    let l = this.#parseTerm(cmdArg)
    for (;;) {
      const t = this.#peek()
      if (t.kind === 'op' && (t.text === '+' || t.text === '-') && !this.#boundary(cmdArg)) {
        this.#next()
        const r = this.#parseTerm(cmdArg)
        l = { kind: 'binary', operator: t.text, left: l, right: r, span: l.span }
        continue
      }
      break
    }
    return l
  }

  readonly #parseTerm = (cmdArg: boolean): Expression => {
    let l = this.#parsePointOperand(cmdArg)
    for (;;) {
      const t = this.#peek()
      const isOp = t.kind === 'op' && (t.text === '*' || t.text === '/' || t.text === '//')
      const isMod = t.kind === 'name' && t.text === 'mod'
      if ((isOp || isMod) && !this.#boundary(cmdArg)) {
        this.#next()
        const r = this.#parsePointOperand(cmdArg)
        l = { kind: 'binary', operator: isMod ? 'mod' : t.text, left: l, right: r, span: l.span }
        continue
      }
      break
    }
    return l
  }

  /**
   * Parses `postfix = atom {postfix-op}` (§17.4): call/index/dot chains off one
   * atom, left-associative. `(`/`[`/`.` each bump `#depth` for their
   * interior so nested brackets don't trip the D2 whitespace boundary.
   */
  readonly #parsePostfix = (cmdArg: boolean): Expression => {
    let e = this.#parseAtom(cmdArg)
    for (;;) {
      const t = this.#peek()
      if (t.kind === 'op' && t.text === '(' && !t.spaced) {
        // D6: "(" immediately after a callee opens an argument list
        this.#next()
        this.#depth++
        const args: Argument[] = []
        if (!this.#at('op', ')')) {
          args.push(this.#parseParenArg())
          while (this.#at('op', ',')) {
            this.#next()
            args.push(this.#parseParenArg())
          }
        }
        this.#depth--
        this.#expect('op', ')')
        e = { kind: 'call', callee: e, args, span: e.span }
        continue
      }
      if (t.kind === 'op' && t.text === '[' && !this.#boundary(cmdArg)) {
        this.#next()
        this.#depth++
        const idx = this.#parseExpr()
        this.#depth--
        this.#expect('op', ']')
        e = { kind: 'index', target: e, index: idx, span: e.span }
        continue
      }
      if (t.kind === 'op' && t.text === '.' && !t.spaced) {
        const after = this.#peek(1)
        if (after.kind === 'int') {
          this.#next()
          this.#next()
          e = { kind: 'dotIndex', target: e, index: after.num, span: e.span }
          continue
        }
        if (after.kind === 'name') {
          this.#next()
          this.#next()
          let args: Argument[] | undefined
          if (this.#at('op', '(') && !this.#peek().spaced) {
            this.#next()
            this.#depth++
            args = []
            if (!this.#at('op', ')')) {
              args.push(this.#parseParenArg())
              while (this.#at('op', ',')) {
                this.#next()
                args.push(this.#parseParenArg())
              }
            }
            this.#depth--
            this.#expect('op', ')')
          }
          e = { kind: 'method', target: e, name: after.text, args, span: e.span }
          continue
        }
        this.#fail("expected an index or a name after '.'", after)
      }
      break
    }
    return e
  }

  /**
   * Parses `atom` (§17.4): the base case of the postfix/precedence climb —
   * literals, names, and parenthesized groups/lists.
   */
  readonly #parseAtom = (cmdArg: boolean): Expression => {
    const t = this.#peek()
    const s = this.#span(t)
    switch (t.kind) {
      case 'int':
      case 'float':
      case 'percent':
        // INT/FLOAT/PERCENT all collapse into one `number` node — PERCENT's
        // "/100" division already happened in the lexer (t.num), so the
        // AST can't tell a literal `10%` from a computed `0.1`.
        this.#next()
        return { kind: 'number', value: t.num, span: s }
      case 'size':
        // a SIZE token in expression position is not meaningful; reject
        this.#fail(`unexpected size literal '${t.text}' in an expression`)
        break
      case 'color':
        this.#next()
        return { kind: 'color', hex: t.text, span: s }
      case 'string':
        this.#next()
        return { kind: 'string', value: t.str, span: s }
      case 'name':
        if (t.text === 'true' || t.text === 'false') {
          this.#next()
          return { kind: 'boolean', value: t.text === 'true', span: s }
        }
        if (t.text === 'transparent') {
          this.#next()
          return { kind: 'transparent', span: s }
        }
        this.#next()
        return { kind: 'name', name: t.text, span: s }
      case 'op':
        if (t.text === '(') {
          this.#next()
          this.#depth++
          const first = this.#parseExpr()
          if (this.#at('op', ',')) {
            const items = [first]
            while (this.#at('op', ',')) {
              this.#next()
              items.push(this.#parseExpr())
            }
            this.#depth--
            this.#expect('op', ')')
            return { kind: 'list', items, span: s }
          }
          this.#depth--
          this.#expect('op', ')')
          return first
        }
        break
      default:
        break
    }
    void cmdArg
    return this.#fail(`expected an expression, got '${t.text || t.kind}'`)
  }
}

/**
 * Parses one file's source into a {@link Module}. `file` is a display
 * path only (used in positioned errors and carried onto `Module.file`),
 * not read from disk — the caller supplies `source` separately. Throws a
 * {@link DrawsticError} (E004, or E007 for a malformed palette key) on the
 * first syntax error; there is no error-recovery/multi-error mode.
 */
export const parse = (source: string, file: string): Module =>
  new Parser(source, file).parseModule()

/**
 * Parses `source` as one standalone expression — no module/statement
 * context, just `expr EOF` — via {@link Parser.parseStandaloneExpr}. Used
 * for the CLI `render file#draw(args)` fragment (ADR-0067): the caller
 * passes `<drawing><(args)>` (no whitespace between, matching D6) so the
 * result is a `call` expression whose `args` are the literal arguments.
 */
export const parseStandaloneExpr = (source: string, file: string): Expression =>
  new Parser(source, file).parseStandaloneExpr()
