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
- `seed`-Direktive in der Spec dokumentiert, im Code ein No-op.
- `hue(color, targetColor)`-Overload und `x(pt)`/`y(pt)` implementiert, in der Spec nicht.
- `src/png.ts:175`: Adam7-interlaced PNGs werden vom Decoder nicht unterstützt und werfen einen
  nackten `Error` statt einer `DrawsticError`.
- Stale committete Beispiel-Outputs (Rezept neuer als sein PNG) — durch das Korpus-Rebuild in
  `c34d432` und Entscheidung D3 erledigt.
- Offene, human-gegatete Messpunkte in `docs/impl-progress.md` (`measure-phase2`, `measure-phase4`).
- Bekannte Bugs: `pin HEAD.KEY` ignoriert die Stamp-Transform (flipx) · `fit … anchor` wird still
  verworfen · degenerierte Ellipsenachse rendert eine 1px-Linie · `material` im Theme-Body wird
  still verworfen.

## Bestätigt in Ordnung

`version`-Staging (`0.0.0`, wird im Release gestempelt), `files`, `exports`-Auflösung, `bin` +
Shebang, `engines: node >= 20`, Paket-Metadaten, `tsconfig.build.json`-Emit, `LICENSE`;
95 ADRs 0001–0095 lückenlos mit Status; `docs/decisions/README.md` vollständig (zwei inhaltliche
Korrekturen nötig); alle 63 Beispiel-Rezepte bestehen `critique --strict`.
