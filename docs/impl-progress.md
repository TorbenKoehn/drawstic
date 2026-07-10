# Drawstic-Transformation — Implementierungs-Fortschritt

Single Source of Truth für den autonomen Nacht-Dispatch. Spec-Quelle: der freigegebene Plan
(`~/.claude/plans/die-qualit-t-der-bilder-silly-patterson.md`). Reihenfolge strikt von oben nach unten.
Jede Einheit: real implementieren (kein Wegwerf), `bun run test` grün, Product-Skill synchron, Commit
auf `feature/exp`. Erledigte Checkbox abhaken; neue Findings unter „Emergente Punkte" anhängen.

## Phase 0 — ADRs

- [x] **0** ADRs anlegen (Format aus bestehenden `docs/decisions/*` übernehmen, höchste Nummer +1):
  ADR für `critique`-Command; ADR für Licht+Material-Modell; ADR für Anchored Assembly (`pin`/`fit`);
  ADR für In-place-v1-Break (Kollaps der `drawstic 1`/`drawstic 2`-Doppelsemantik auf eine Semantik).
  Index in `AGENTS.md` §5 / `docs/` aktuell halten wo nötig.
  → `docs/decisions/0085-critique-command.md` (0085), `0086-declarative-light-and-material.md`
  (0086), `0087-anchored-assembly.md` (0087), `0088-in-place-v1-break.md` (0088). README.md index
  + affected older ADRs' status lines (0028–0030, 0056, 0063, 0068–0070, 0072) updated to point
  forward. `AGENTS.md` §5's packaging pointer (0084) is unaffected — left as-is.

## Phase 1 — `critique`-Loop (SHIP FIRST)

- [x] **1a** `src/critique.ts` scaffold auf `inspectSprite`; billige Checks C001 (leer), C003 (optische
  Zentrierung `x0+x1==W−1`), C004 (Value/Kontrast-Spread), C006 (Palette/Komplexität), C008-pinholes,
  C012 (dynamische transparente Edge-Row); CLI-Verb `critique <file> [--json]` in `src/cli.ts`;
  Metrik-Bundle + `C0xx`-Diagnosecodes; `tests/unit/critique.test.ts` mit Fixtures. Reuse
  `inspect.ts`/`preview.ts`/`framebuffer`/`color.ts`.
  → `src/critique.ts` (`CRITIQUE_CODE`, `computeCritiqueMetrics`, `critiqueSprite`,
  `critiqueCheckDiagnostic`), `runCritique` + Dispatch/HELP in `src/cli.ts` (emitObject-Kontrakt
  `{diagnostics, critique:{pass, failedCodes, drawings}}`), 12 Tests grün. Verb-Eintrag in
  `skills/drawstic/reference.md`. Alle Checks default `warning`/Exit 0. Smoke: `critique
  examples/showcase/showcase.drw` meldet C004+C012 (nicht blockierend), Rest der `examples/` `pass:true`.
- [x] **1b** C007 (Floating-Part/Seam via 8-connected Components + Chamfer-Distanztransform, Signatur
  bbox-Overlap+Gap≥1) und C005 (Strichbreite via Distanztransform); `--strict` (Exit-Gate);
  `CritiqueProfile` + `--as icon|scene|character|item`; Tests.
  → `src/critique.ts`: `CRITIQUE_CODE` um C005/C007 erweitert; `CritiqueProfile`/`CritiqueCategory`/
  `PROFILES`/`resolveProfile` (Threshold-Tabelle, keine Inferenz); Geometrie-Scan einmalig nur bei aktivem
  Profil (`labelComponents` 8-connected, `chamferDistance` Zwei-Pass Chebyshev, `scanFloatingParts`,
  `scanStroke`); `checkFloatingPart`/`checkStrokeWidth`; `promoteStrict` (Must-fix C001/C007/C008/C012,
  +C003 bei icon/item → `error`); `critiqueSprite(name, sprite, {profile, strict})` + optionale
  `componentCount`/`minStrokeWidth` im Report. `src/cli.ts`: `--as`/`--strict` geparst, `runCritique`
  verdrahtet, `C000`-Advisory ohne Profil, `pass` = kein warning/error, Report trägt `profile`/`strict`.
  **Scoping-Entscheidung (kalibriert an den Beispielen):** C007 nur `character` (alle Character-Beispiele
  sind ncomp=1 bzw. der Skeleton-Skull hat `bboxOverlap=false` → FP-frei; icon/item feuern legitim
  mehrteilig — weather-Icons, Stiefelpaare — würden sonst falsch flaggen). C005 domination-gated
  (`STROKE_DOMINATION=0.85`, über dem dünnsten sauberen Beispiel `bow`=0.75; `width=2·ridgeDistance`,
  `floor=round(2·size/32)`, effektiv ab ≥48px greifend). `tests/unit/critique.test.ts`: +13 Tests
  (Floating-Part feuert/orbit-clean/verbunden-clean, Hairline C005 feuert/thick-clean/no-profile-silent,
  `resolveProfile`-Auswahl, Strict-Promotion inkl. C003-Profilabhängigkeit, CLI-Exit-Gate 0 vs 1) — 25
  critique-Tests grün, 669 gesamt. Reference.md `critique`-Eintrag um `--as`/`--strict` ergänzt.
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

- [ ] **1a-followup** `critique examples/showcase/showcase.drw` feuert C004 (Flat-Value) + C012
  (transparente Endzeile) auf prozeduralen Showcase-Draws. Prüfen, ob echte Craft-Mängel oder
  Threshold-Rauschen; ggf. beim `examples/`-Re-Baseline in 1c adressieren (Thresholds als gemessener
  Boden test-asserted).
- [ ] **1b-followup C012-Strict** `critique examples/icons/*.drw --as icon --strict` exit=1, weil viele
  prozedurale Icons C012 (transparente Endzeile) feuern und C012 in der Must-fix-Teilmenge liegt. Beim
  `examples/`-Re-Baseline in 1c entscheiden: Draws trimmen, Canvas-Höhe anpassen, oder C012 aus dem
  Strict-Must-fix nehmen — bevor `critique --strict` als CI-Gate über `examples/` verankert wird.
- [ ] **1b-followup C006-Profile** `CritiqueProfile.colorCeiling` steht für alle Kategorien noch auf dem
  agnostischen Default 64 (icon feuert C006 bereits auf `controller64`). In 1c pro Kategorie als
  gemessenen Boden tightenen (Icons enger als Scenes), ohne neue Fehlalarme auf sauberen Beispielen.
- [ ] **1b-followup C005-Untergrenze** `width=2·ridgeDistance` lässt C005 wegen `floor=round(2·size/32)`
  erst ab ≥48px greifen (bei 32px ist der Floor 2 = Breite eines 1px-Strichs). Falls 1c 32px-Icons mit
  Hairline-Dominanz fangen soll, `width=2·ridge−1` erwägen — dann Character/Item-Kalibrierung neu prüfen
  (even/odd-Unterschätzung könnte legitime 3–4px-Striche fälschlich flaggen).
