# 98. Multi-target export blocks: target lists, `dir`, and `file` name templates

- Status: Accepted
- Date: 2026-07-27
- Deciders: t.koehn, Claude
- Refines / amends: [ADR-0096](0096-language-freeze-for-1-0.md) §6 (recipe-relative export paths —
  the composition rule below is layered *onto* it, not around it), [ADR-0019](0019-source-first-module-references.md)
  (source-first, bareword `/`-paths), [ADR-0006](0006-modules-and-content-output-separation.md)
  (content/output separation), [ADR-0030](0030-structured-diagnostics-contract.md) (code categories),
  [ADR-0007](0007-visual-not-byte-determinism.md) (output is a pure function of the source).

## Context

`export` is the one construct in Drawstic that scales linearly with the number of drawings and
carries no reuse mechanism. Every drawing needs its own four-line block, and every block repeats the
directory and the format list verbatim:

```drw
export chat communication/chat:
  png @1 @2
  svg ids classes

export phone communication/phone:
  png @1 @2
  svg ids classes
  … ×9
```

That is `examples/icons/communication.drw` as it stands today. Measured over the bundled corpus with
`js-tiktoken` (`cl100k_base`), the same proxy and the same "count the lines as recipes actually write
them" method ADR-0096 §2 used:

| Fact | Value |
|---|---|
| `.drw` recipes in `examples/` | 31 |
| `export` statements | 145 |
| …that collapse into one block per (directory, format list) | **40** |
| tokens spent on `export` blocks today | 2 185 |
| tokens after this ADR | **911** (−1 274, **−58.3 %**) |
| `examples/icons/communication.drw` alone | 172 → **42** (−75.6 %) |
| exports whose base path *is* the drawing name | **111 / 145 (76.6 %)** |
| exports carrying a directory prefix | 63 / 145 (43.4 %) |

The 76.6 % figure is the important one: three of every four export paths in the repo are a verbatim
restatement of the name on the same line. That is not a token problem, it is a *correctness* problem —
it is a second place to spell a name, and the corpus rewrite for ADR-0096 §6 found five different
conventions precisely because that second place existed.

The backlog item (`.claude/skills/craft-eval/references/runbooks/general-backlog.md` §9.3) asks for
three things: an omitted path defaulting to the drawing name, a comma-separated target list, and
`dir`/`file` declarations with string interpolation and inflectors. This ADR accepts all three, and
**trims the proposal in four places** where it would have imported a second spelling or a
non-deterministic function into a language whose whole premise is that a recipe is a pure function of
its own source. The user has confirmed the 1.0 language freeze does not block this work.

## Decision

### 1 — Grammar

Diff-ready, in the spec's EBNF style. Replaces the current `export-def` production (§17.4) and adds
one lexical production (§17.2):

```ebnf
(* ───────────────────────────── exports ───────────────────────────── *)

export-def     = "export" export-target { "," export-target } ":" NL
                 INDENT { export-option } format-line { format-line } DEDENT ;   (* §13 *)
export-target  = NAME [ OUTPUT-PATH ] ;      (* the path is optional — it defaults to NAME *)
export-option  = dir-opt | file-opt ;        (* both optional, at most one each, before the
                                                 first format-line (E004 otherwise) *)
dir-opt        = "dir" OUTPUT-PATH NL ;      (* bareword, like every other path in the language *)
file-opt       = "file" TEMPLATE NL ;        (* the filename stem for targets without a path *)

format-line    = "png"  { out-size | Z-FLAG | "indexed" | mode-flag } NL
               | "svg"  { "ids" | "classes" | "inlineStyles" | mode-flag } NL
               | "jpeg" { out-size | Q-FLAG | mode-flag } NL
               | "path" NL
               | "tiled" [ "xml" ] NL
               | "atlasJson" NL
               | "aseprite" NL ;             (* unchanged *)
out-size       = AT-SCALE | SIZE ;           (* unchanged *)
```

```ebnf
(* colors & strings — §17.2 *)
STRING      = '"' { ? any char except '"' or newline ? } '"'
            | '"""' { ? any char ? } '"""' ;

(* a STRING read in `file` position (§13); the holes are NOT general string interpolation *)
TEMPLATE    = '"' { tmpl-char | tmpl-hole } '"' ;
tmpl-char   = ? any char except '"', '{', '}', '\' ? | "\{" | "\}" ;
tmpl-hole   = "{" { INFLECTOR } TMPL-VAR "}" ;   (* prefix application, rightmost applies first *)
INFLECTOR   = "snake" | "camel" | "pascal" | "kebab" | "upper" | "lower" ;
TMPL-VAR    = "base" ;                            (* the target's drawing name *)
```

Worked example, the whole feature in one block:

```drw
export pickaxe, axe, key, coinPouch, torch hand/torch:
  dir assets/items
  file "{kebab base}"
  png @1 @4
  atlasJson
```

writes `assets/items/pickaxe.png`, `assets/items/pickaxe@4x.png`, … `assets/items/coin-pouch.png`,
and — because `torch` carries its own path — `assets/items/hand/torch.png`.

The existing single-target form `export pickaxe assets/pick-axe:` is the `n = 1`, no-option case of
this grammar and parses byte-identically. **Nothing that parses today stops parsing.**

### 2 — Path composition, in one sentence

For each target of a block:

```
tail     = target's explicit OUTPUT-PATH  ??  render(file)  ??  target NAME
basePath = dir ? dir + "/" + tail : tail
```

`basePath` then goes through **the unchanged ADR-0096 §6 pipeline**: it is relative to `--out`,
which still defaults to the recipe's own directory; it is validated by the existing
`validateExportPath` (`SEGMENT { "/" SEGMENT }`, no leading `/`, no `.`/`..`, no file extension,
segments `[A-Za-z0-9_-]+`, positioned `E018` from `check`); and `--out` still only relocates the
whole tree. **`dir` is a prefix inside the recipe-relative space, never an escape from it** — a `..`
in `dir` fails the same check that a `..` in a per-target path fails, because the check runs on the
composed string, not on the parts.

The three tiers are **precedence, not redundancy**: the per-target path is the escape hatch for the
one target that breaks the block's pattern (`torch hand/torch` above), `file` is the pattern, and the
name is the default. That is the same shape as the language's existing three-tier size resolution
(header → `pixels` grid → module/theme default), which nobody reads as three spellings of one thing.
Mixing tiers inside one block is legal and is the intended use.

`render(file)` must be a **single path segment** — a `/` in the rendered result is `E018`
(`a 'file' template renders the filename, not a directory — put directories in 'dir'`). `dir`
declares directories, `file` declares the filename; one job each.

### 3 — The `file` template renders a **stem**, so `{ext}` and `{full}` are dropped

The backlog proposes `file "{snake base}.{ext}"` with `base` / `full` / `ext`. **Rejected**, and the
reason is not taste:

- A block emits *several* formats from one name. `file "{snake base}.{ext}"` in a `png`+`svg` block
  must render differently per line, so the template is not a filename — it is a stem generator with a
  redundant restatement of what the format line already owns. `file "{snake base}.{ext}"` and
  `file "{snake base}"` produce byte-identical artifacts for **every** well-formed use.
- The only *ill*-formed use is the one `{ext}` invites: `file "{base}.png"` in a `png`+`svg` block
  writes `base.png.svg`. A feature whose entire discriminating power is producing a broken filename
  does not earn a place in the grammar.
- The format line owning the extension is already law: the current `E018` message is literally
  *"must not carry a file extension — the format line appends it"*. `{ext}` would create a second
  authority over extensions — the exact plurality ADR-0096 was written to end.
- Keeping the stem rule keeps `@Nx` (`name@4x.png`), `.tsj`/`.tsx` and `.aseprite.json` working with
  **zero** special cases. A full-filename template would need a rule for where `@4x` goes relative to
  a template-authored dot, and `aseprite.json` has two.

`{full}` = `base + "." + ext` dies with `{ext}`; at stem level it is exactly `{base}`.

Consequently `TMPL-VAR` has one member, `base`. Writing `{ext}`, `{full}` or `{name}` is a positioned
`E028` **with the replacement in the hint**, per ADR-0094's teach-don't-just-fail rule.

### 4 — Interpolation is scoped to `file`, not a general string feature

**Decided: template holes exist only in `file` position.** String literals everywhere else keep
today's meaning exactly. The evidence is in the repo:

- `src/std/fonts/micro.drw.ts:732`/`:748` and `src/std/fonts/small.drw.ts:914`/`:934` contain
  `glyph "{"` and `glyph "}"`. Making `{` significant in every string would break the **bundled**
  fonts on day one, in precisely the construct whose content *is* a literal brace. (Survey result:
  those four lines are the only `{`-in-a-string occurrences in the whole corpus — so general
  interpolation buys nothing and costs exactly the wrong four lines.)
- `STRING` is a general expression atom (`atom = INT | FLOAT | PERCENT | COLOR | STRING | …`).
  General interpolation therefore means a general expression evaluator inside string syntax: scope
  capture, `E001` for unknown names, number→string formatting rules, colour→string formatting rules.
  That is an entire feature. The five string consumers in the language today — `text`, `title`,
  `desc`, `style`, `glyph`/`glyphs` — have never asked for one; `text` takes a literal caption,
  `glyph` takes a character.
- Scoping keeps the blast radius inside `#parseExport`. `base` is an **export-frame** variable: it
  does not exist, and cannot be given a meaning, in any other position.
- The move is one-way-compatible in the right direction: scoped → general stays possible later;
  general → scoped would be a break.

### 5 — Inflectors are template-only, and there are six of them

**Decided: not expression-level functions.** Beyond §4's argument, `title` is *already a statement
keyword* (`meta-stmt = ("title" | "desc") STRING`), and `upper`/`lower`/`base` are attractive
ordinary binding names. Promoting them to builtins would add six entries to `BUILTIN_NAMES`, all
`E007`-reserved everywhere under ADR-0096 §5, to serve a language that has **no string-producing
operation at all** (`+` is numeric/point only; there is no concat) — their results could only ever be
fed back to `text`. Template-only means: no `BUILTIN_NAMES` change, no new reserved words, no
shadowing risk.

**One word-splitting rule**, shared by all case inflectors, total and dictionary-free:

1. split at each `_` and `-` (the separator is consumed);
2. split at each lower→upper boundary (`coinPouch` → `coin`, `Pouch`);
3. split an acronym run before its final capital when a lowercase follows (`HTMLIcon` → `HTML`, `Icon`);
4. **digits never split** — they attach to the preceding word (`chat16` is one word, so `{kebab base}`
   on the corpus's `chat16`/`videocall64` is a no-op rather than a silent rename).

| Inflector | Result on `coinPouch` | Rule |
|---|---|---|
| `snake` | `coin_pouch` | words lowercased, joined `_` |
| `kebab` | `coin-pouch` | words lowercased, joined `-` |
| `camel` | `coinPouch` | first word lowercased, rest capitalized, joined `` |
| `pascal` | `CoinPouch` | all words capitalized, joined `` |
| `upper` | `COINPOUCH` | ASCII case map over the whole string |
| `lower` | `coinpouch` | ASCII case map over the whole string |

Case mapping is **ASCII-only and locale-free** — legal by construction, because D5 restricts a
Drawstic `NAME` to `[A-Za-z][A-Za-z0-9_]*`. No Turkish-`i` class of bug can exist here.

Inflectors compose by prefix juxtaposition, **rightmost applied first**:
`{upper snake base}` → `COIN_POUCH`. Chains are unbounded; every link is a total pure function.

**`title` is dropped** (the backlog listed it). Title case means capitalized words *separated by
spaces*, and a space is illegal in an export path segment — so a `title` result would always raise
`E018`. Title case *without* spaces is exactly `pascal`. Redundant by the ADR-0094 criterion, and
dropping it also avoids colliding with the `title` meta-statement.

### 6 — `plural` / `singular` are dropped, and so is anything clock-shaped

**`plural`/`singular`: rejected.**

1. Every other inflector is a total function of the input's *characters*. `plural` is a function of
   the input's *meaning*: `mouse`→`mice`, `sheep`→`sheep`, `axis`→`axes`, `octopus`→(three defensible
   answers). Any bounded ruleset is wrong for a predictable share of inputs, and it fails **silently**
   — it produces a plausible-looking wrong filename, the worst failure mode a build tool has.
2. An irregular-noun table is a table that grows. Every future entry silently changes the output
   filenames of recipes that already build — which breaks the reproducibility promise
   ([ADR-0007](0007-visual-not-byte-determinism.md)) *across engine versions*, one step removed from
   the reason dates are out.
3. Zero demand, and a one-token workaround that is already legal: the author picked the drawing name,
   so `export coin coins:` says it exactly, with no guessing.

**No date/time/clock/environment functions, ever — `{date …}` is rejected outright.** Drawstic's
core guarantee is that a recipe's output is a pure function of its source and its arguments. A clock
reading breaks that three ways: two runs of the same recipe write different files; `check`'s dry-run
plan can no longer match what `build` will write (they are separate processes, potentially separate
days); and diffing two builds becomes noise instead of signal. `{date}` is not in the grammar, and
naming it in a template is `E028` with a hint that says why, not just that.

### 7 — `dir` takes a bareword path; `file` takes a quoted template

Not an inconsistency — the existing rule, applied. Paths in Drawstic are barewords everywhere
(`from ui-parts`, `use std/themes`, `image logo = art/logo.png`, and the export base path itself);
ADR-0019 pinned "no quotes, no extension". `dir` is a path, so `dir assets/items`. `file` is a
*template* — it needs `{`, `}` and escape handling, none of which are path characters — so it is a
`STRING`. One-token measurement, in context:

```
  dir communication            4      dir "communication"          5
  dir assets/items             5      dir "assets/items"           6
```

The bareword form is **1 token cheaper per line**, on 43 % of the corpus's exports.

**The keyword names are token-neutral, so they were chosen for meaning, not cost.** Measured in
position, `dir` / `into` / `out` / `base` / `folder` / `prefix` / `root` all cost **exactly the same**
(4 tokens for `  <kw> communication`, 5 for `  <kw> assets/items`); likewise `file` / `name` / `as` /
`filename` / `pattern` all cost 8 for the whole `file "…"` line. `dir` wins because it is the
universal short word for the thing, and it cannot be misread as the *whole* path (`base`, `prefix`,
`root` all can). `file` wins over `name` because `name` is overloaded to breaking point in this
language (drawing name, palette key, binding), and over `as` because `as` is a reserved word (§17.2)
with an established aliasing meaning in `from … as …`.

Hole syntax is prefix, not UFCS: `{snake base}` = 4 tokens, `{base.snake}` = 5. Prefix is cheaper
*and* avoids re-implementing postfix/UFCS parsing inside a string mini-language that is deliberately
not an expression language (§4). Of the six inflectors, `pascal` and `kebab` cost one token more
in-hole than the rest — noted, not acted on; they are the standard names for those cases and
renaming them would trade clarity for one token.

### 8 — Block shape is fixed, so the formatter has nothing to reorder

`dir` and `file` must precede every format line, at most one of each. A `dir`/`file` after a format
line, or a second `dir`/`file`, is a positioned `E004` with a hint. This costs the parser nothing,
gives every block exactly one canonical shape, and means `fmt` never has to reorder lines (it is
line-based by design, ADR-0031, and reordering would require a reparse).

Canonical form, which `fmt` now produces and is idempotent on:

```drw
export chat, phone, contacts, videocall, share, feed:
  dir communication
  png @1 @2
  svg ids classes
```

- One block header is **one line**, however long. Drawstic has no line continuation for it, and `fmt`
  never wraps.
- Targets are separated by `", "` — comma, exactly one space. `fmt` normalizes any other spacing
  (`a ,b`, `a,  b`, `a,b`) on depth-0 lines starting with `export `, collapsing interior whitespace
  runs to one space and leaving target order, any trailing comment, and everything after the `:`
  untouched. Idempotent by construction.
- Quote style: `"` only (the lexer has no single-quoted string). `fmt` never touches string contents.
- A trailing comma before `:` is `E004`.

### 9 — One statement, N artifacts: the expansion happens in the parser

`#parseExport` **expands** a block into one resolved `ExportDefinition` per target, with `basePath`
already composed per §2. `ModuleRecord.exports` therefore stays a flat list of resolved targets, and
**every downstream consumer is untouched**: `build.ts` (`runExport`/`validateExport`), `lint.ts`
(`W002` reachability, `W016`), `cli.ts` (the `context` brief, `sheet`'s default selection in export
order, `critique`'s `paletteTargetFor` budget detection and its sibling-family count). Each expanded
definition carries the span of **its own target token**, so a diagnostic points at `coinPouch`, not
at the whole block.

Block-level facts that lints need survive on a shared, frozen `group` object referenced by every
definition of the block: the header span, the declared `dir` (and its span), whether `file` was
declared, and each target's explicit path. This is the only AST addition.

Order of `mod.exports` is declaration order, left-to-right within a block — so `sheet`'s selection
and the brief's ordering read exactly as written.

### 10 — Diagnostics

**Exactly one new error code.** Highest live `E`-code is `E027`; `E009` is retired and stays retired.

| Code | Category | Fires on |
|---|---|---|
| **`E028`** *(new)* | `template` | a `file` template is malformed or names something that is not a template variable or inflector |

Messages (all positioned at the offending `{` inside the string):

| Situation | Message | Hint |
|---|---|---|
| unknown variable | `unknown template variable 'foo' — the only variable is 'base' (the target's drawing name)` | — |
| `{ext}` / `{full}` | `'{ext}' is not a template variable — the format line owns the extension` | `write 'file "{snake base}"'; a png+svg block would render two different names` |
| `{date …}` | `'date' is not a template variable — Drawstic has no clock` | `a recipe's output is a pure function of its source (ADR-0007); a date would make the same recipe write different filenames on two runs` |
| `{plural …}` / `{title …}` | `unknown inflector 'plural' — available: snake, camel, pascal, kebab, upper, lower` | `pluralization needs a dictionary and cannot be deterministic — name the target's path explicitly: 'export coin coins:'` (for `title`: `use 'pascal'`) |
| empty hole | `empty '{}' in a file template` | `name a variable, e.g. '{base}'` |
| unterminated hole | `unterminated '{' in a file template` | `close it, or escape a literal brace as '\{'` |
| illegal escape | `'\n' is not allowed in a file template` | `a filename cannot contain a newline, tab or quote; only '\{' and '\}' are escapable here` |

**No second new code.** Everything else reuses existing categories, which is what ADR-0030 codes are
(categories, not per-message identities — `E018` already carries five distinct export messages):

- **`E004`** (parser shape): `dir`/`file` after a format line; a repeated `dir`/`file`; a trailing
  comma; a missing `:`.
- **`E018`** (`exportError`): the composed `basePath` failing `validateExportPath` — unchanged code,
  unchanged messages, now reached by `dir`- and `file`-authored paths for free; a rendered `file`
  containing `/`; and **two exports writing the same artifact path**.

That last one is a **scope fix this ADR forces**. `build.ts`'s collision check
(`two export format lines both write '<path>'`) runs against a per-export artifact list, so a
collision *between* two exports has always written silently, last-wins. Multi-target blocks and
`file` templates make that easy to hit (`file "{lower base}"` over `draw Chat` and `draw chat`), so
the check is lifted to module scope, its message extended to name both sources, and a new dry-run
`validateExportPlan` runs it from `check` **before any bytes are written** — today the error fires
mid-build, after some files already exist.

**One new lint.** Highest live `W`-code is `W017`; `W004` and `W012` are retired, `W005`/`W010`/`W011`
are burned. `W018` is taken by [ADR-0099](0099-opt-in-filtered-stamp-resampling.md), decided the same
day, so the next free code is `W019`.

| Code | Fires on | Says |
|---|---|---|
| **`W019`** *(new)* | (a) ≥2 targets in one block all carry explicit paths sharing a directory prefix; (b) exactly 1 target, a `dir` line, and no `file` | (a) `hoist the shared '<p>/' prefix into 'dir <p>'`; (b) `a single target needs no 'dir' — write 'export <n> <dir>/<tail>:'` |

Two arms, one concern: *the directory is declared in the wrong place for this block's shape*. It is
the same class as `W013`–`W015` — a canonical-path nudge that drives convergence, which is the whole
reason ADR-0096 was written.

**`W016` keeps its code and its meaning** (an export path's first segment repeating the recipe's own
directory name). It now reads the **composed** path, and when the repetition comes from `dir` it
positions on the `dir` line and its hint names `dir`. Generalizing a live lint to a new spelling of
the same mistake is not a code reuse.

### 11 — `context --json` / `check --json`

**The brief's shape does not change.** `Brief.exports[]` stays
`{ source, basePath, formats[] }` and is **one entry per resolved target** — a 4-target block emits 4
entries, in declaration order, each with the **fully composed** `basePath`. The brief's contract is
*what `build` will write*, so it must show the composition's result, not its inputs; an agent that
needed the inputs would read the recipe. Zero churn for consumers, zero churn for the product skill's
brief documentation, and `sheet`/`critique` keep reading `mod.exports` unchanged.

`check --json` gains no new field. It gains **coverage**: the new module-scope
`validateExportPlan` means a duplicate-artifact collision is now reported as a positioned `E018`
diagnostic by `check`, alongside the existing per-export validation, instead of surfacing as a
half-finished `build`.

## Consequences

- **Purely additive to the grammar.** Every `export` that parses today parses identically. This is
  the first language change since ADR-0096 that breaks nothing.
- The bundled corpus is rewritten in the same change: 145 `export` statements become 40 blocks,
  −1 274 tokens (−58.3 %) on the export surface. Per AGENTS.md §6 the product skill
  (`skills/drawstic/SKILL.md` + `reference.md`) is updated in the same change or the change is
  incomplete.
- Four things the backlog asked for are **not** shipped, each with a positioned error that teaches
  the replacement: `{ext}`, `{full}`, `title`, `plural`/`singular`. Dates were never designed.
- `{`/`}` become escapable (`\{`, `\}`) in **every** string, not only templates — a strict widening
  of an escape set that currently *rejects* `\{` outright, so nothing changes meaning.
- The silent cross-export overwrite bug is fixed as a side effect, and moves from `build`-time to
  `check`-time.
- `plural`/`singular`/`title`/`{ext}`/`{full}`/`{date}` are **burned names** in template position:
  they keep their identity as rejected spellings and are never reassigned to something else, per the
  ADR-0096 precedent.
- Touches `src/lexer.ts`, `src/parser.ts`, `src/ast.ts`, `src/build.ts`, `src/lint.ts`, `src/fmt.ts`,
  `src/cli.ts`, `src/diagnostic.ts`, `docs/language-spec.md` (§13, §17.2, §17.4, the error and lint
  tables), the product skill, and every `examples/**/*.drw`.

## Implementation plan

Ordered; each step compiles and tests green before the next.

### 1. `src/diagnostic.ts`
- Add `template: 'E028'` to `ERROR_CODE`, directly after `pngUnsupported: 'E027'`, with a comment
  naming this ADR.

### 2. `src/lexer.ts`
- `Token`: add a `raw: string` field — the exact source between the quotes, pre-unescape; the
  `file` template compiler reads it, every other string consumer keeps reading `str`.
- `push()`: default `raw: ''` in the literal alongside `str: ''`.
- Single-quoted string branch (~line 263–306): capture `const rawSlice = text.slice(i + 1, j)` before
  `push`, and pass `raw: rawSlice`.
- Triple-quoted branch (~line 220–261): pass `raw: buf` (already the verbatim inner text).
- Escape switch (~line 268): add `case '{': case '}':` alongside `case '"': case '\\':` — both emit
  the literal brace into `str`. This turns today's hard `unknown string escape` into a legal escape;
  no existing source uses it.

### 3. `src/ast.ts`
- New exported type:
  ```ts
  export type ExportGroup = {
    readonly dir: string | undefined
    readonly dirSpan: TextSpan | undefined
    readonly hasFile: boolean
    readonly explicitPaths: readonly (string | undefined)[]
    readonly span: TextSpan            // the block header
  }
  ```
- `ExportDefinition`: add `readonly group: ExportGroup`. `name`/`basePath`/`formats`/`span` keep their
  meaning — `basePath` is now the **composed** path and `span` is the **target's own** span.
- `Statement` union member at line 460: `{ kind: 'exportDefinition'; readonly defs: ExportDefinition[]; readonly span: TextSpan }`
  (`def` → `defs`).

### 4. `src/parser.ts`
- New `#parseTemplate(tok: Token): TemplatePart[]` — scans `tok.raw`; emits literal chunks and
  `{ inflectors: string[]; variable: 'base' }` holes; raises `E028` per §10's table via a new
  `#failTemplate(msg, tok, offset, hint)` that offsets the column into the string literal. Accepts
  only `\{`/`\}` escapes; any other `\` is `E028`.
- New `#renderTemplate(parts, name): string` — applies inflectors right-to-left over `name`.
- New `#splitWords(s: string): string[]` and the six inflector functions (module-level `const`
  arrows, not methods — they are pure), per §5's rules.
- Rewrite `#parseExport` (line 1642):
  1. parse `NAME [OUTPUT-PATH]` targets separated by `,` (reuse `#parsePath`; a path is present iff
     the next token is not `,` and not `:`); trailing comma → `E004`.
  2. `:` `NL` `INDENT`, then loop: `dir`/`file` lines first (each at most once, `E004` on repeat),
     then format lines via the untouched `#parseFormatLine`; a `dir`/`file` after a format line →
     `E004` with the hint `'dir'/'file' come before the format lines`.
  3. compile the `file` template once; build the shared `ExportGroup`; for each target compose
     `basePath` per §2 (a rendered `file` containing `/` → `E018` at the `file` line's span, thrown
     via `error(ERROR_CODE.exportError, …)` not `#fail`).
  4. return `{ kind: 'exportDefinition', defs, span }`.

### 5. `src/eval.ts`
- Line ~1444, `case 'exportDefinition':` → `rec.exports.push(...s.defs)`. The line-3902 case reads
  only `stmt.span` and is untouched. No `BUILTIN_NAMES` change (§5).

### 6. `src/build.ts`
- `runExport`: hoist `const stem = ex.basePath.slice(ex.basePath.lastIndexOf('/') + 1)` above the
  format loop; replace all three `` `${ex.basePath.split('/').pop() ?? ex.name}.png` `` sites
  (lines ~345, ~379, ~390) with `` `${stem}.png` ``. Same value today, computed once, and the
  `?? ex.name` fallback goes (a validated `basePath` always has a non-empty last segment).
- `runExport` signature: accept an optional shared `BuiltArtifact[]` for the collision check and
  return only its own additions, so `buildModule` can thread one list across all exports.
- `write()`: extend the collision message to name the other export
  (`two exports both write '<path>' — '<a>' and '<b>'`) when the colliding entry came from a
  different definition.
- New `plannedArtifactPaths(ex: ExportDefinition): string[]` — pure, no render (every path is static:
  base + `@Nx` + the format's extension).
- New `validateExportPlan(mod: ModuleRecord): void` — runs `plannedArtifactPaths` over
  `mod.exports`, raises `E018` on the first duplicate, positioned on the second occurrence.
- `validateExportPath` itself is **unchanged**.

### 7. `src/lint.ts`
- `lintExportPathRepeatsDir` (W016): when `ex.group.dir` is set, test its first segment and report at
  `ex.group.dirSpan` with a `dir`-worded hint; otherwise today's behaviour verbatim. Keep the
  existing "no `/` → skip" guard, which is what keeps `export loot loot:` inside `items-v2/loot/`
  clean (that guard was added because four bundled recipes tripped it).
- New `lintExportBlockDirShape` (W019), both arms per §10; runs once per block (dedupe on the shared
  `group` object identity so a 6-target block reports once, not six times). Register it beside
  `lintExportPathRepeatsDir` in the module-level lint pass.

### 8. `src/fmt.ts`
- In the main loop, after `const content = …` and only when `parenDepth === 0` and
  `content.startsWith('export ')`: match `/^export\s+([^:#]*?)\s*:(.*)$/`, split group 1 on `,`,
  trim each part, collapse interior whitespace runs to a single space, rejoin with `', '`, re-emit
  as `export <targets>:<rest>`. Leave the line untouched if the regex does not match. Idempotent by
  construction; `dir`/`file`/format lines are not touched.

### 9. `src/cli.ts`
- `buildBrief`'s `for (const ex of mod.exports)` loop is **unchanged** — it now iterates resolved
  targets. Update its doc comment to say so.
- In `check`'s deep-validation pass, call `validateExportPlan(mod)` once before the per-export
  `validateExport` loop.

### 10. `docs/language-spec.md`
- §13: rewrite around the block form; document the three-tier resolution (§2), the stem rule (§3),
  the template grammar and the six inflectors (§5), `dir` as a bareword (§7), the fixed block order
  and canonical form (§8). Keep the ADR-0096 §6 paragraph and add that `dir` composes *inside* it.
- §17.2: add the `TEMPLATE` / `tmpl-hole` / `INFLECTOR` / `TMPL-VAR` productions and note `\{`/`\}`
  in the escape set.
- §17.4: replace `export-def` with §1's block.
- Diagnostics tables: add `E028` and `W019`; amend `W016`'s row to mention `dir`.

### 11. `skills/drawstic/SKILL.md` + `skills/drawstic/reference.md`
- `SKILL.md` line ~111: replace the single `export sword sword:` example with the omitted-path form
  `export sword:` and add the multi-target block as the family idiom.
- `reference.md` line ~1031: rewrite the export section against the new grammar — target list,
  `dir`, `file` + the six inflectors, the stem rule, the three-tier precedence, and the fact that
  `{ext}`/`{date}`/`plural` are errors with hints.

### 12. `examples/**/*.drw`
- Collapse 145 statements into 42 blocks (grouping key = directory + format list). `examples/icons/*`
  is the largest win (9 exports → 1 block per family). Use `file "{kebab base}"` where a family's
  names are camelCase. `bun run drawstic check` must be clean, including `W016`/`W019`.

### 13. `AGENTS.md` + `docs/decisions/README.md`
- Add the ADR-0098 row to the decisions index; no AGENTS.md §5 doc-index entry is needed (this is an
  ADR, not a new doc), but confirm the §2 tree comment for `src/fmt.ts` still reads true.

### Tests

**Will break, and must be updated:**

| File | Why |
|---|---|
| `tests/unit/parser.test.ts` | any assertion on the `exportDefinition` statement shape (`def` → `defs`) |
| `tests/unit/build-paths.test.ts` | the collision test's message text changes; the check now also fires across exports and from `check` |
| `tests/unit/lexer.test.ts` | any whole-`Token` deep-equal assertion gains `raw`; `\{` stops throwing |
| `tests/unit/lint.test.ts` | `W016` spans when the repetition comes from `dir` |
| `tests/unit/fmt.test.ts` | export-header normalization is a new rewrite |
| `tests/unit/examples-critique.test.ts`, `tests/unit/e2e.test.ts`, `tests/unit/cli.test.ts`, `tests/unit/inspect.test.ts`, `tests/unit/sheet.test.ts` | corpus rewrite (step 12) changes recipe text, and `sheet`'s default selection reads export order |
| `tests/unit/readme.test.ts`, `tests/unit/skill-cli-sync.test.ts` | doc/skill rewrites (steps 10–11) |

**New file `tests/unit/export-block.test.ts`:**

1. `export a, b, c:` expands to three definitions, in order, each with its own span.
2. `export island:` (no path) → `basePath === 'island'`; and 111-of-145 regression guard: the
   single-target legacy form `export island island:` still parses to the identical definition.
3. `dir` composition: `dir assets/items` + `export pickaxe:` → `assets/items/pickaxe`.
4. Precedence: explicit path > `file` > name, including the mixed block from §1 (`torch hand/torch`
   lands under `dir`).
5. `file` templates: `{base}`, `{kebab base}`, `{snake base}`, `{upper snake base}`, literal affixes
   (`"icon-{kebab base}"`), `\{`/`\}` escapes.
6. Inflector table: all six against `coinPouch`, `chat16`, `HTMLIcon`, `already_snake` — asserting the
   digit rule and the acronym rule explicitly.
7. `E028` for each row of §10's message table (including `{ext}`, `{date}`, `{plural x}`, `{title x}`,
   `{}`, `{base`, `"\n"`), asserting **code, position, and hint text**.
8. `E004` for `dir` after a format line, duplicate `dir`, duplicate `file`, trailing comma.
9. `E018` for: a rendered `file` containing `/`; `dir ../x`; `dir` composing into a path with an
   extension; two targets of one block resolving to the same artifact; two *separate* exports
   resolving to the same artifact (the lifted check), raised by `validateExportPlan` before any write.
10. `W019` both arms, and `W016` reported on the `dir` line.
11. `fmt` idempotence: `export a ,b,  c:` → `export a, b, c:` → unchanged on a second pass; a trailing
    comment survives.
12. Sidecars: an `atlas` block with `dir` + `file` — the `.tsj`/`.json`/`.aseprite.json` `image` field
    is the resolved stem + `.png`, matching the `png` line's own artifact name.
13. `context --json` on a 4-target block reports 4 `exports` entries with composed `basePath`s.
