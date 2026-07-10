# Drawstic-Transformation — Implementierungs-Fortschritt

Single Source of Truth für den autonomen Nacht-Dispatch. Spec-Quelle: der freigegebene Plan
(`~/.claude/plans/die-qualit-t-der-bilder-silly-patterson.md`). Reihenfolge strikt von oben nach unten.
Jede Einheit: real implementieren (kein Wegwerf), `bun run test` grün, Product-Skill synchron, Commit
auf `feature/exp`. Erledigte Checkbox abhaken; neue Findings unter „Emergente Punkte" anhängen.

## Phase 0 — ADRs

- [ ] **0** ADRs anlegen (Format aus bestehenden `docs/decisions/*` übernehmen, höchste Nummer +1):
  ADR für `critique`-Command; ADR für Licht+Material-Modell; ADR für Anchored Assembly (`pin`/`fit`);
  ADR für In-place-v1-Break (Kollaps der `drawstic 1`/`drawstic 2`-Doppelsemantik auf eine Semantik).
  Index in `AGENTS.md` §5 / `docs/` aktuell halten wo nötig.

## Phase 1 — `critique`-Loop (SHIP FIRST)

- [ ] **1a** `src/critique.ts` scaffold auf `inspectSprite`; billige Checks C001 (leer), C003 (optische
  Zentrierung `x0+x1==W−1`), C004 (Value/Kontrast-Spread), C006 (Palette/Komplexität), C008-pinholes,
  C012 (dynamische transparente Edge-Row); CLI-Verb `critique <file> [--json]` in `src/cli.ts`;
  Metrik-Bundle + `C0xx`-Diagnosecodes; `tests/unit/critique.test.ts` mit Fixtures. Reuse
  `inspect.ts`/`preview.ts`/`framebuffer`/`color.ts`.
- [ ] **1b** C007 (Floating-Part/Seam via 8-connected Components + Chamfer-Distanztransform, Signatur
  bbox-Overlap+Gap≥1) und C005 (Strichbreite via Distanztransform); `--strict` (Exit-Gate);
  `CritiqueProfile` + `--as icon|scene|character|item`; Tests.
- [ ] **1c** Silhouetten-Signaturen (Alpha→32×32 box-resample, L1-Distanz); C009 (Geschwister-Kollaps,
  Schwelle <~0.12) + C011 (Familien-Gewichts/Margin-Parität); Familie default via `selectSheetDrawings`
  (`sheet.ts`); `--family a,b,c`; Vision-Rubrik-Block; Tests. Danach: Workflow in `skills/drawstic/SKILL.md`
  verpflichtend machen (critique im „Definition of done"); alle `examples/` re-baselinen (Thresholds als
  gemessener Boden test-asserted); `critique --strict` als CI-Regressions-Gate verankern.

## Phase 2 — Deklaratives Licht + Material (Schattierung)

- [ ] **2a** Reine Color-Helfer in `src/color.ts`: `litTone` (mix Richtung warm), `shadowTone`
  (OkLCh-darken + gedeckelter Hue-Nudge ≤~20°, nie Cross-Hue), `ramp(base, n)`; Unit-Tests. Sofort per
  UFCS nutzbar.
- [ ] **2b** `Light`/`Material` First-Class-Values in `src/values.ts`; neues internes `src/shading.ts`
  (Encoding-Vereinigung `lightPointFor`/`lightDirOf`/`shadowOffsetFor` + `lowerMaterial`); `celRegion`
  (gebandetes Distanz-Fill) in `src/raster.ts`; Unit-Tests auf Engine-Ebene.
- [ ] **2c** Parser/Eval: `light NAME = dir…|at…`-Binding und `material NAME = COLOR RESPONSE`-Binding
  (Inline-Args, keine Konstruktoren), `lit L:`-Block, `model`/`cel`-Dispatch; `render --explain`
  (Primitive-Expansion). **v1/v2-Branching komplett entfernen** — eine Semantik, kein Gate; Pragma
  `drawstic N` → No-op. e2e-Tests (render→decode→assert: ein Licht treibt shade+rim+shadow kohärent).
  Product-Skill + `docs/language-spec.md` §Licht&Material nachziehen.
- [ ] **2d** Theme-Licht (`FoldedTheme.light`, fold/merge/fingerprint) für Cross-View-Kohärenz;
  Two-View-Character-Test (teilt Theme-Licht). Danach `craft-eval` (Kategorie) fahren, Report in `docs/`.

## Phase 3 — Anchored Assembly (Positionierung)

- [ ] **3** `pin NAME PT` (Attach-Point-Deklaration) + `fit partB.NAME partA.NAME` (kontakt-garantiertes
  Fügen, Gap-Meldung); Ground-Placement-Oracle formalisieren; Auto-Contact-Shadow. Kreis/Ellipse auf
  eine Zentrierungs-Konvention + Off-by-one-Footprint fixen (`values.ts`). C007 muss clean sein.
  Product-Skill + Spec nachziehen; `craft-eval` (Character) fahren, Report in `docs/`.

## Phase 4 — Break schließen

- [ ] **4** Product-Skill um neuen Default-Pfad neu schreiben (`SKILL.md` + `reference.md` + 4
  craft-*.md); Legacy kollabieren; `docs/language-spec.md` §Assembly + Break-Notes; `docs/best-practices.md`;
  finaler `craft-eval`-Re-Run pro Kategorie, Reports in `docs/`. Zielkorridor Overall < ~1.4.

## Emergente Punkte

_(Findings aus `bun run test` und craft-eval-Läufen hier als neue Checkboxen anhängen.)_
