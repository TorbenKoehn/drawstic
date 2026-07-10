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
- [x] **1c** Silhouetten-Signaturen (Alpha→bbox-Crop→32×32 flächengewichtetes Box-Resample, aspekt-
  erhaltend zentriert, `silhouetteSignature`) + masse-normalisierte L1 (`signatureDistance`,
  Sørensen `Σ|a−b|/(Σa+Σb)` — nicht /1024, sonst verdünnt der leere Hintergrund die Formdifferenz);
  C002 (Edge-Clip, profil-gegated icon/item), C009 (Geschwister-Kollaps <0.12, advisory) + C011
  (Gewichts-Parität >6× Median, advisory) via `critiqueFamily`; Familie default `selectSheetDrawings`,
  `--family a,b,c`-Override; Vision-Rubrik (`buildRubric`: geordnete Silhouette-first-Renders +
  kategorie-Items `{id,when,ask}`) im Payload (`familyMetrics`+`rubric`). CLI `--family` geparst,
  `runCritique` verdrahtet (family-Diags an Member-Span, `pass`/`failedCodes` inkl. Family). C006-
  Ceilings pro Kategorie über gemessenem Boden (icon 320/item 192/character 96/scene 12000; agnostic
  256), C012 auf Asymmetrie kalibriert. **Must-fix-Boden gemessen kollabiert auf C001+C007 (+C003
  icon)** — alle anderen Codes advisory (Recolors/Shared-Shells/Plate-Icons teilen Silhouetten *by
  design*, offene Bow-Frames/Buchstaben-Counter erzeugen legit 1–3px-Löcher). SKILL.md Workflow-
  Schritt 6 „Critique — MANDATORY" + „Definition of done" + vier Kategorie-Checklisten; reference.md
  critique-Zeile nachgezogen. CI-Gate `tests/unit/examples-critique.test.ts` (in-process `critique
  --strict` über alle `examples/**/*.drw`, Exit 0). +20 critique-Tests (45 gesamt), 691 gesamt grün.

## Phase 2 — Deklaratives Licht + Material (Schattierung)

- [x] **2a** Reine Color-Helfer in `src/color.ts`: `litTone` (mix Richtung warm), `shadowTone`
  (OkLCh-darken + gedeckelter Hue-Nudge ≤~20°, nie Cross-Hue), `ramp(base, n)`; Unit-Tests. Sofort per
  UFCS nutzbar.
  → `src/color.ts`: `litTone`=`mix(base,light,amt)`; `shadowTone(base,cool,amt,darken=amt)` =
  `darken(l)` + `clampMag(hueDelta(base,cool)*amt, SHADOW_HUE_CAP=20)`-Nudge (0 bei achromatischem
  `cool`) + `SHADOW_DESAT=0.3`-Desaturate; `ramp(base,n)` = evener +1…0…−1-Spread über
  `litTone`/`shadowTone` mit ADR-0086-Endpunkten (`#ffe6b0`/`#2a3a5e`, `RAMP_LIT_MAX=0.3`/
  `RAMP_SHADOW_MAX=0.35`), `n<1`→`[]`, `n===1`→`[base]`; geteilter `hueDelta`-Helfer (mixHue refaktoriert).
  Dispatch-Cases in `#builtinColor` (eval.ts) für call- + method-form. `tests/unit/color.test.ts`
  +14 (Pins `#e8b784`/`#834b35`/`#c2856e`, Ramp `[#d9754b,#c04040,#320012]`; **Regression**: warme Basis
  `shadowTone` dHue ≤20° vs. nacktes `mix` >40° Richtung Magenta). `tests/unit/eval.test.ts` +1
  (UFCS im Recipe + User-`ramp`-Koexistenz). 703 Tests grün, tsc + biome clean.
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

- [x] **1a-followup** (1c) showcase C004/C012: Threshold-Rauschen, kein Craft-Mangel. C012 auf
  Asymmetrie umgestellt (zentrierte Breathing-Room feuert nicht mehr); C004 bleibt advisory (flache
  Icon-/Text-Flächen sind legitim, nicht Gate-relevant). showcase `critique --strict` grün.
- [x] **1b-followup C012-Strict** (1c) gelöst: C012 aus dem Strict-Must-fix genommen (ADR-0085 §5
  listet es nicht) **und** auf asymmetrische Boden-Padding kalibriert — beide zusammen, sodass Icons
  weder falsch feuern noch das Gate blockieren. `critique --as icon --strict` grün auf allen Icons.
- [x] **1b-followup C006-Profile** (1c) gelöst: per-Kategorie-Ceilings über gemessenem Korpus-Maximum
  gesetzt (icon-max 238→320, item 121→192, character 49→96, scene 8017→12000, agnostic 27→256). Kein
  sauberes Beispiel feuert neu C006; scene ≫ icon > item > character. C006 bleibt advisory.
- [x] **1b-followup C005-Untergrenze** (1c) bewusst *nicht* verschärft: `width=2·ridge−1` würde bei
  even/odd legitime 3–4px-Striche der Character/Item-Beispiele fälschlich flaggen (Kalibrierung aus 1b
  hält). C005 bleibt ≥48px-wirksam + advisory; 32px-Hairline-Dominanz fängt stattdessen die Vision-
  Rubrik (Silhouette-first-Render). Kein Regressionsrisiko am Gate, da C005 nicht must-fix.

- [ ] **1c-followup C009-Plate-Blindheit** C009 vergleicht die *volle* Covered-Maske; bei Icons mit
  opakem Plate ist die Silhouette = Plate, sodass alle Glyphen kollabieren (`chat~phone@0`). Heute
  unkritisch (C009 advisory), aber wenn C009 je schärfer werden soll: Signatur auf den Nicht-Plate-
  Vordergrund beschränken (z.B. dominante Randfarbe als Plate subtrahieren) oder C009 für `icon`
  überspringen. Analog bei Recolor-Varianten (identische Silhouette by design) — nur die Rubrik/der
  Agent kann „gewollt" von „Duplikat" trennen.
- [ ] **1c-followup C011-Margin** C011 flaggt heute nur Gewicht (Covered-Count-Ratio > 6× Median);
  die im Plan genannte „Margin"-Parität (einheitlicher Breathing-Room) ist als `bbox` im
  `familyMetrics` sichtbar, aber nicht separat gegated. Falls Item-Sets uneinheitliche Margins als
  Set-Inkohärenz melden sollen, eigenes Margin-Ratio ergänzen (advisory).

- [x] **2a-finding `ramp` kollidiert mit User-Bindings** `ramp` ist ein weit verbreiteter
  Recipe-Bezeichner (ADR-0060/0079; `examples/characters/{villager,skeleton,robot}.drw`,
  `items/shields.drw`, `scenes-v3/volcano.drw`, `scenes/orbit.drw`, Tests). Als unshadowbares
  `BUILTIN_NAMES`-Builtin registriert brach es 22 Tests („predefined, unshadowable name"). Lösung:
  die drei ADR-0086-Helfer werden **nicht** in `BUILTIN_NAMES` aufgenommen — Dispatch läuft rein über
  `callBuiltinOrFn`→`#callBuiltin`→`#builtinColor` (User-Fn/-Binding gewinnt, sonst Builtin). Damit
  bleiben `ramp`/`litTone`/`shadowTone` bindbar und `base.ramp(n)` trifft trotzdem das Builtin.
  Konsequenz für Phase 4: falls die Reservierung dieser Namen doch gewünscht ist, gehört das
  begleitende Umbenennen der `ramp`-Bindings in allen Examples in den „Legacy kollabieren"-Schritt,
  nicht in 2a. Inline-Kommentar an den `#builtinColor`-Cases hinterlegt.
