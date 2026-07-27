# Audit — Release-Readiness (2026-07-26)

Stand bei Audit-Beginn: `bun test` 878 grün (mit einem Timing-Flake), `tsc --noEmit` sauber,
`biome check .` **15 Fehler**.

## Release-Blocker

1. **`.github/workflows/release.yml` publiziert ohne Auth.** `setup-node` setzt
   `registry-url: https://registry.npmjs.org`, aber nirgends wird `NODE_AUTH_TOKEN` gesetzt →
   `npm publish --access public` scheitert beim ersten echten Release. `NPM_TOKEN` steht nur in
   `CONTRIBUTING.md:77` und ADR-0065, wird von keinem Workflow konsumiert.
2. **Das Repo fällt durch sein eigenes Lint-Gate.** `biome check .` meldete 15 Fehler (14 generierte
   `examples/**/*.json` + eine Testdatei); `lint` ist Pflichtschritt in `ci.yml` **und**
   `release.yml`. → gefixt in `c34d432` (generierte JSONs aus Biome ausgenommen).
3. Flakiger Gate-Test: `examples-critique` lief bei 5,09 s ins 5-s-Default-Timeout. → gefixt
   (60 s) in `c34d432`.

## Sollte vor 1.0

- `release.yml` ohne `--provenance` (widerspricht `CONTRIBUTING.md` und ADR-0065; `id-token: write`
  wird angefordert, aber nicht genutzt).
- Kein `npm pack`-Smoke-Test: `files`/`exports`/`bin`/Shebang-Fehler würden erst beim Nutzer
  auffallen (`ci.yml` testet das Repo-`dist/`, nicht das Tarball).
- `CONTRIBUTING.md:68-78` beschreibt einen Flow, den der Workflow nicht implementiert.
- **README:** `drawstic critique` fehlt komplett in der Kommando-Liste; die `render`-Flagliste ist
  veraltet (`(args)`, `--inspect`, `--explain`, `--crop`, `--fit` fehlen); `check`/`fmt` ohne
  `--lint`/`--rows`/`--stdout`/`--diff`.
- **Spec-Lücken** (§17.4 Grammatik): die komplette `pin`/`fit`-Familie hat keine Produktion;
  `behind`/`front` fehlen bei `stamp-flag`; `quantize` und die organischen Konstruktoren fehlen;
  `model`/`cel` ohne `over`; Material-Dosen und Form-Profile fehlen; `light-def`/`figure:` fehlen im
  `theme-item`. §16 CLI-Tabelle ohne `--out`/`--mode`/`--budget`.
  → **CLOSED (2026-07-26, correctness pass).** §17.4 rewritten against `src/parser.ts`/`src/eval.ts`
  directly: `pin-decl`/`fit-stmt`/`fit-ref`/`fit-source`/`fit-flag` productions added (draw-stmt);
  `behind`/`front` added to `stamp-flag`; `dome`/`lobe`/`crescent`/`ribbon` added to `draw-cmd`
  (`quantize` was already present — that part of the note was stale); `over region` added to
  `model`/`cel`; `dose-override`/`FORM-PROFILE` added to `material-def`; `light-def`/`figure-block`
  added to `theme-item` (with a footnote that a `material-def`/non-gradient binding still parses
  there but is rejected at fold time — E004, already implemented); `atlas-item`'s `place` production
  corrected to two literal `INT`s (not a point expression) plus a footnote on the `place`/`tile`
  mutual exclusivity and the `cols`-needs-`tile`/≥1-`sprites` constraints. `skeleton-def`/`pose-def`
  were checked against the parser and found already correct (no change). §16's CLI table gained
  `--out`/`--mode` on `render`, `--all` on `critique`, `help`/`version` rows, and a new paragraph on
  the universal `--budget`/`--mode` flags and the `E026` unknown-flag contract. Every new/changed
  production was exercised with a minimal recipe run through `check` (see the eval/parser test
  additions this pass). The light-def `amb`/`gain` tail was also corrected from a fixed order to
  order-free (matches `#parseLightBinding`'s loop).
- `seed`-Direktive in der Spec dokumentiert, im Code ein No-op.
  → **Verified already closed.** The `seed N` directive was removed from the language (ADR-0096 §1)
  and the spec already documents its removal with a positioned-error note (§17.4 `size-dir`
  footnote, and the stdlib §10 prose) — no stale prose describing it as valid remains anywhere in
  `docs/language-spec.md`. No change needed.
- `hue(color, targetColor)`-Overload und `x(pt)`/`y(pt)` implementiert, in der Spec nicht.
  → **CLOSED.** Documented: `hue`'s two overloads (rotate by degrees vs. set to match another
  colour's hue) in the *Colour values* section, and `x(pt)`/`y(pt)` in the *Standard library* Math
  bullet.
- `src/png.ts:175`: Adam7-interlaced PNGs werden vom Decoder nicht unterstützt und werfen einen
  nackten `Error` statt einer `DrawsticError`.
  → **CLOSED.** `decodePng` now throws a structured `PngDecodeError` (a stable `code`:
  `bad-signature`/`interlaced`/`bad-filter`) instead of a bare `Error` for all three of its failure
  modes, not just the interlaced one. `#loadImage` (the `image NAME = FILE-PATH` boundary, the only
  place besides `render --diff` that calls `decodePng`) now preserves that code as a new positioned
  diagnostic `ERROR_CODE.pngUnsupported` (`E027`) instead of the generic `E008`/`importError`, with
  the `image` statement's own span. (Decoding Adam7 remains explicitly out of scope — this is only
  about failing honestly instead of throwing an unpositioned, uncoded error.) Covered by a new test
  in `tests/unit/eval.test.ts` asserting both the `E027` code and that the span lands on the `image`
  declaration, plus `tests/unit/png.test.ts` asserting `PngDecodeError`'s `code` for all three
  failure modes.
- Stale committete Beispiel-Outputs (Rezept neuer als sein PNG) — durch das Korpus-Rebuild in
  `c34d432` und Entscheidung D3 erledigt.
- Offene, human-gegatete Messpunkte in `docs/impl-progress.md` (`measure-phase2`, `measure-phase4`).
- Bekannte Bugs: `pin HEAD.KEY` ignoriert die Stamp-Transform (flipx) · `fit … anchor` wird still
  verworfen · degenerierte Ellipsenachse rendert eine 1px-Linie · `material` im Theme-Body wird
  still verworfen.
  → **All four verified already closed**, three before this session (per `git log`) and confirmed
  still correct, one (`material` in a theme body) also already closed and re-verified:
  - `pin HEAD.KEY` transform bug: fixed in `a2d531f`/`f3adfda` ("fix pin/stamp transform bug",
    "reliable pin/fit placement through transforms").
  - `fit … anchor`: removed outright (not just fixed) by the language freeze (ADR-0096 §1) — it is
    now a positioned E004 naming the pin as the anchor already, documented in §9's anchored-assembly
    prose and reflected in the new `fit-flag` grammar (which deliberately omits `anchor`).
  - Degenerate ellipse axis: **decided already, correctly, as correct-by-construction** — a `0`-length
    axis is a legitimate 1px line (ADR-0087, supersedes the old odd `2r+1` rule), and it is already
    documented right next to `ellipse` in the §12 command table. No diagnostic warranted: a
    zero-radius circle (`r=0` ⇒ one pixel) is the same family of degenerate-but-valid case and isn't
    flagged either. No change needed.
  - `material` in a theme body: **already a positioned E004** (`#foldThemeItem`'s `materialBinding`
    case in `src/eval.ts`), naming the fix ("materials live in module scope … or a draw body, where
    `model`/`cel` reads them") — and already documented in §12's Themes section. No change needed.

## Bestätigt in Ordnung

`version`-Staging (`0.0.0`, wird im Release gestempelt), `files`, `exports`-Auflösung, `bin` +
Shebang, `engines: node >= 20`, Paket-Metadaten, `tsconfig.build.json`-Emit, `LICENSE`;
95 ADRs 0001–0095 lückenlos mit Status; `docs/decisions/README.md` vollständig (zwei inhaltliche
Korrekturen nötig); alle 63 Beispiel-Rezepte bestehen `critique --strict`.

## Correctness pass — 2026-07-26 (English)

Closed this pass: the §17.4 grammar rewrite and the §16 CLI table above; `src/png.ts`'s Adam7/
bad-signature/bad-filter decode errors (new `PngDecodeError` + `ERROR_CODE.pngUnsupported`/`E027`).
Verified-already-closed and ticked off above: the `pin`/stamp-transform bug, `fit … anchor`, the
degenerate-ellipse-axis decision, and `material` inside a theme body. `bun test` 956 pass / 0 fail,
`bunx tsc --noEmit` clean, `bunx biome check .` clean, `bun run build:examples` green (byte-identical
— the committed example PNGs/SVGs were already current, confirming the corpus doesn't silently
drift), and every new/verified grammar production was exercised by a minimal hand-written recipe
run through `drawstic check` before being written into the spec.

**Found beyond the audit's own list (not fixed — reported, not enshrined):**

- **`#foldThemeItem` (`src/eval.ts`) silently no-ops for statement kinds it doesn't recognize.**
  The parser does not restrict what can syntactically appear inside a `theme NAME:` body — it reuses
  the generic block parser, so e.g. a `pixels:` block, an `if`, a `pin`, a `call`, or any other
  `draw-stmt`-shaped statement parses there without error. `#foldThemeItem`'s switch explicitly
  handles `with`/`palette`/`style`/`sizeDirective`/`modeDirective`/`fontDirective`/`lightBinding`/
  `figureBlock`/`materialBinding` (E004)/`binding` (E004 unless `gradient`)/`filterDefinition`/
  `drawDefinition`, and **silently returns the accumulator unchanged for everything else** (the
  `default: return acc` branch) — the exact "reaches nothing, no diagnostic" class this audit's
  Part 2 flagged for `material`, just for a wider and less-likely-to-be-authored set of statement
  shapes. I did not fix this: the brief scoped Part 2 to three specific paths (all closed/verified),
  and closing this one properly means either restricting `theme-def`'s grammar at parse time (a
  bigger, more mechanical change touching the parser's shared block logic) or auditing every
  remaining `Statement` kind for a theme-appropriate rejection message — real work, not a two-line
  fix, and not clearly in scope for a spec/error-path correctness pass. Recommend a follow-up pass
  (or a dedicated ADR) before or shortly after 1.0.
- **Bundled `small` 5×7 font: descender letters read as capitals.** Investigated at a concurrent
  agent's request (font/text area, adjacent to this pass's "document real behaviour" work). `p`/`q`/
  `y`/`g` are drawn one row higher than the x-height letters, using rows 6–7 as a pseudo-descender
  (a 7-row cell has no room below the baseline) — visually indistinguishable from their capital
  forms, so `sheet` labels like "map"/"trophy" render as "maP"/"troPhy". This is a real, visible
  authoring surprise, but it is a **font-asset design defect**, not a language/grammar/diagnostic
  gap — nothing here is undocumented *behaviour* in the sense this pass is about (the glyphs render
  exactly as drawn; there's no silent misparse or dropped diagnostic). I did not touch the glyphs
  (out of scope, and explicitly a visual change the requester does not want landing quietly). If it
  gets a spec mention at all, the right place is a caveat next to the bundled-fonts description in
  §8 ("`small`'s descenders read as capitals at 5×7 — prefer `micro` where case matters, or a custom
  font"), not §17.4 (this is not a grammar fact). I'd treat it as a product/asset backlog item
  (redraw `p`/`q`/`y`/`g` with an actual descender, or document the caveat) rather than a spec
  correctness fix — recommend the other agent (or a follow-up) file it explicitly rather than it
  landing as a side effect of this pass.
