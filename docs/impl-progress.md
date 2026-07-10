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
- [x] **2b** `Light`/`Material` First-Class-Values in `src/values.ts`; neues internes `src/shading.ts`
  (Encoding-Vereinigung `lightPointFor`/`lightDirOf`/`shadowOffsetFor` + `lowerMaterial`); `celRegion`
  (gebandetes Distanz-Fill) in `src/raster.ts`; Unit-Tests auf Engine-Ebene.
  → `src/values.ts`: `Light`/`Material`/`MaterialResponse`-Typen in die `Value`-Union, `light`/
  `material`/`unitVec`-Factories (rein, `dir` immer normalisiert, `pos`→nominale Down-`dir`;
  `material`-Overrides nur wenn definiert wg. `exactOptionalPropertyTypes`). `typeName` deckt beide
  über den generischen `v.type`-Zweig ab (keine Sonderfälle). `src/shading.ts` (neu): `Vec2`,
  `regionCenter`/`regionDiagonal`, Encoding-Trio (`lightPointFor` = `pos` bzw. synthetische Up-Source
  `center − dir·2·Diagonale`; `lightDirOf` = verbatim `dir` bzw. `normalize(center − pos)`;
  `shadowOffsetFor` = `round(dir·len)`), gebackene `DOSE`-Profile pro Response (scene-craft §5 →
  flat/metal/skin/cloth/glass/glow), `planMaterial` (rein, liefert inspizierbare `ShadeOp[]`-Trace für
  `--explain` in 2c; Nulldosis-Schritte entfallen) + `lowerMaterial` (führt die Trace über die
  BESTEHENDEN Primitive fill→shadeRegion→lightRegion→rim→ambientOcclusion→cast aus). Töne via
  `litTone`/`shadowTone` (2a); `×gain`, Rim-Breite/Cast-Reach aus `bbox`; `glow` = self-illuminated
  nur die eigene Region. `castBand` region-scoped (verschobenes Silhouetten-Band minus Region) über
  `regionTransform`+`regionSubtract`+`fillRegion`. `src/raster.ts`: `celRegion` als Geschwister von
  `shadeRegion`, `forRegionDistance`-Spine wiederverwendet, crisp via `set` (kein Alpha-Stacking).
  `tests/unit/shading.test.ts` (17 Tests): Factory-Normalisierung, Encoding-Kohärenz (ein Light →
  konsistenter shade-Punkt/rim-Dir/cast-Offset), per-Response-Sequenz + gerenderte Ton-Struktur
  (metal lit-warm→dark-cool, glow self-core + Nachbarn unberührt, cast down-light), celRegion N-Bänder.
  720 Tests gesamt grün, `tsc --noEmit` + `biome check .` clean. **Kein** Parser/Eval/CLI berührt (2c).
- [x] **2c** Parser/Eval: `light NAME = dir…|at…`-Binding und `material NAME = COLOR RESPONSE`-Binding
  (Inline-Args, keine Konstruktoren), `lit L:`-Block, `model`/`cel`-Dispatch; `render --explain`
  (Primitive-Expansion). **v1/v2-Branching komplett entfernen** — eine Semantik, kein Gate; Pragma
  `drawstic N` → No-op. e2e-Tests (render→decode→assert: ein Licht treibt shade+rim+shadow kohärent).
  Product-Skill + `docs/language-spec.md` §Licht&Material nachziehen.
  → **2c-SYNTAX erledigt** (additive Hälfte): AST-Kinds `lightBinding`/`materialBinding`/`litBlock`;
  Parser-Dispatch kontextuell (`light NAME =`, `material NAME =`, `lit NAME:`) + `#parseLightBinding`/
  `#parseMaterialBinding`; `values.ts` `MATERIAL_RESPONSES`/`isMaterialResponse` (MaterialResponse
  daraus abgeleitet); eval `#execLightBinding`/`#execMaterialBinding`/`#execLitBlock` (module- +
  draw-scope), `DrawState.light` (set/restore wie mask), `#execCommand`-Cases `model`/`cel` mit
  `Args.material()`/`Args.light()`/`Args.peekBareName()`, `#requireLight` → **E024** (neuer Code) bei
  fehlendem Licht; `Engine.explain` + `ExplainRecord`/`ExplainStep` + `explainShadeOp`; CLI
  `render --explain` (Output-Kind, `--json`-konform, `formatExplain`). `cel` nutzt `ramp(base,N)` +
  `lightPointFor` (2b-finding). Keyword-Disziplin verifiziert (examples nutzen `lit`/`dir`/`glow` als
  Namen — grün). 13 neue Tests (`tests/unit/light-material.test.ts` 12 + cli `--explain` 1), 733
  gesamt grün, tsc + biome clean. **KOLLAPS jetzt ebenfalls erledigt** (siehe „2c-collapse") → 2c
  mit diesem Commit vollständig.
- [x] **2d** Theme-Licht (`FoldedTheme.light`, fold/merge/fingerprint) für Cross-View-Kohärenz;
  Two-View-Character-Test (teilt Theme-Licht).
  → `eval.ts`: `FoldedTheme.light: Light | null` (+ `emptyTheme`); `#foldLight` faltet ein
  `light NAME = …` im Theme-Body (Palette-sichtbar, wie `#foldBinding`) via `#evalLightValue`;
  `#foldThemeItem`-Case `lightBinding`; `mergeThemes` `light: b.light ?? a.light` (later-wins);
  `themeFingerprint` um `lightFingerprint` erweitert (dir/pos/color/gain/amb → kein Stale-Cache);
  `#renderDrawBody` initialisiert `draw.light = theme.light` statt `null` → das per `use` angewandte
  Theme etabliert das **äußerste** Licht der Zeichnung, das durch die file-scope-Anwendung auch jede
  gestampte Part-`draw` erreicht. **Auflösungsreihenfolge** (dokumentiert, numerisch bewiesen via
  `--explain`): explizites `light L`-Arg > `lit L:`-Block > Theme-Default; fehlt alles → hartes E024.
  `#requireLight`-Doku auf die 3 Tiers gezogen. Der Theme-Licht-Name ist dekorativ (nicht als Binding
  im Draw sichtbar — `light themeName` wirft E001; für explizite Referenz an Modul-Scope binden).
  `cli.ts`: `Brief.theme.light` (formatiert via `formatThemeLight`), `context`-Textblock `## lighting`
  (nur wenn gesetzt → keine Beispiel-Regression), JSON-Parität mit `size/mode/font`. `tests/unit/
  theme-light.test.ts` (8 Tests): Two-View lit-Kante world-left in BEIDEN Views (nicht pro View
  gespiegelt), E024 ohne Theme-Licht, die 3-Tier-Auflösung einzeln, Determinismus (2× byte-identisch),
  Fingerprint-Sensitivität (nur Licht-Farbe geändert → andere Pixel), `with`-Fold later-wins. 735
  Tests grün (727+8), tsc + biome clean. Doku: language-spec §Light&Material (Auflösungsreihenfolge)
  + §Themes (`light` in der Theme-Body-Liste), reference.md (§Light&Material, §Themes, context-Zeile),
  SKILL.md (§Characters, §Declarative light, §Gotchas), character-craft.md §1/§3/§6 (Theme-Licht als
  struktureller Fix ersetzt die reine Prosa-Warnung). ADR-0086 nannte fold/merge/fingerprint bereits
  → keine ADR-Änderung nötig. **craft-eval bewusst NICHT gefahren** (schwere Multi-Agent-Messung, s.u.).

## Phase 3 — Anchored Assembly (Positionierung)

- [ ] **3** `pin NAME PT` (Attach-Point-Deklaration) + `fit partB.NAME partA.NAME` (kontakt-garantiertes
  Fügen, Gap-Meldung); Ground-Placement-Oracle formalisieren; Auto-Contact-Shadow. Kreis/Ellipse auf
  eine Zentrierungs-Konvention + Off-by-one-Footprint fixen (`values.ts`). C007 muss clean sein.
  Product-Skill + Spec nachziehen; `craft-eval` (Character) fahren, Report in `docs/`.
  → **3a-Assembly erledigt** (dieser Commit): `pin`/`fit` (AST/Parser kontextuell D7, `#execPinDeclaration`/
  `#execFit` in eval), `Sprite.pins`-Export + `DrawState.pins`-Registry, Kontakt-Garantie via
  Coverage-Snapshot + 8-Adjazenz-Check → non-fatal **W010**-Gap-Warnung (`Engine.warnings`, in `render`-
  Diagnostics + human-Ausgabe), Auto-Match gleichnamiger Pins, Ground-Oracle (Point-Source `fit b.base
  x:groundY(x)`), Auto-Contact-Shadow (`fit … shadow`, `contactShadowColor` in shading.ts). `stampSprite`-
  Pfad wiederverwendet. 13 Tests (`tests/unit/assembly.test.ts`), 748 gesamt grün, tsc+biome clean.
  Product-Skill + language-spec §9 + reference.md + character-craft §1/§4 + scene-craft §2 synchron.
  **Checkbox bleibt offen**: 3b-Zentrierung (s. Emergente Punkte) + `craft-eval`-Character-Lauf stehen aus.

## Phase 4 — Break schließen

- [ ] **4** Product-Skill um neuen Default-Pfad neu schreiben (`SKILL.md` + `reference.md` + 4
  craft-*.md); Legacy kollabieren; `docs/language-spec.md` §Assembly + Break-Notes; `docs/best-practices.md`;
  finaler `craft-eval`-Re-Run pro Kategorie, Reports in `docs/`. Zielkorridor Overall < ~1.4.

## Emergente Punkte

_(Findings aus `bun run test` und craft-eval-Läufen hier als neue Checkboxen anhängen.)_

- [ ] **3b-centering** Kreis/Ellipse auf eine Zentrierungs-Konvention (ellipse → circles even-diameter,
  ADR-0087) + Off-by-one-Footprint in `values.ts` (`ellipseRegion` → even `c-rx..c+rx-1` × `c-ry..c+ry-1`,
  Corner-centred wie `circleRegion`); betroffene Tests/examples anpassen. **Separater Teil, NICHT in 3a.**
- [ ] **3a-finding: fit-Source-Bareword ist immer Pin-Ref** Ein Bare-Name als `fit`-Source (`fit b a`)
  ist stets eine Pin-Referenz (Auto-Match), nie ein Point-wertiges Binding — ein Punkt als Source muss
  als Point-Literal (`x:y`) oder geklammert geschrieben werden (Disambiguierung, sonst wäre `fit b pt`
  mehrdeutig). Dokumentiert in language-spec §9 / reference. Falls je ein Point-Binding als Source
  gebraucht wird: `fit b.pin (pt)` klammern.
- [ ] **3a-finding: W010 nur über gerenderte Pfade sichtbar** Die Gap-Warnung sammelt sich in
  `Engine.warnings` und wird von `render` (JSON-`diagnostics` + human) ausgegeben; `build`/`sheet`
  reichen sie heute NICHT durch (kein Regressionsrisiko — der strukturelle Defekt wird ohnehin von
  `critique` C007 gefangen). Falls `build` die Gap-Warnung surface soll: `engine.warnings` in den
  build-Diagnostics-Sammler einfalten (Phase 4).

- [ ] **measure-phase2** craft-eval (eine Kategorie, Charaktere) gegen die dokumentierten Baselines
  fahren (schwer, Multi-Agent, Review-Bedarf) — konsolidiert am Ende/Human-getriggert. Deckt die
  Phase-2-Messung des Plans ab („misst, ob Licht+Material die Grade bewegt"); explizit NICHT im
  autonomen Einzel-Einheit-Scope, weil ein Builder-Wave + Konsolidierung + Fix-Wave menschliches
  Review braucht.
- [ ] **2d-finding: Auflösungsreihenfolge explicit>lit vs. Task-Wortlaut** Die Task-Notiz listete
  „`lit`-Block > explizites `light L`-Arg > Theme-Default". Umgesetzt ist **explizites `light L` >
  `lit L:`-Block > Theme-Default** — konsistent mit ADR-0086 (autoritativ: „value binding → lit block
  → theme default") und dem bereits ausgelieferten 2c-`#requireLight` (`explicit ?? draw.light`, hier
  unverändert gelassen; das Theme-Default seedet nur `draw.light`). Die essenzielle Anforderung (Theme
  = äußerster Fallback) ist erfüllt; nur die Ordnung der oberen zwei Tiers folgt ADR statt Task-Prosa.
  Numerisch gepinnt in `theme-light.test.ts`. Falls doch lit>explicit gewünscht: `#requireLight` auf
  `draw.lit ?? explicit ?? draw.themeLight` umbauen (bräuchte getrennte lit-/theme-Felder in DrawState).
- [ ] **2d-finding: `material` im Theme-Body still verworfen** Ein `material NAME = …` in einem
  Theme-Body fällt heute in `#foldThemeItem`s `default`-Zweig (stumm ignoriert), analog zur Alt-Lage
  vor ADR-0081 für freie Bindings. Kein Regressionsrisiko (niemand schreibt das; 2c hat es nie
  gefaltet), aber ein latenter Footgun. Theme-Materials sind nicht Teil von ADR-0086 (Materials leben
  in Modul-/Draw-Scope). Falls je gebraucht: entweder falten oder mit positioniertem E004 ablehnen —
  bewusst hier deferred (Scope 2d = nur Theme-Licht).

- [x] **2c-collapse** (die zweite Hälfte von 2c) — ADR-0088 umgesetzt: alle vier
  `pragma ?? LANGUAGE_VERSION >= 2`-Zweige aus `eval.ts` entfernt (E009-Versionscheck in `loadSource`,
  whole-frame-shadow-`respectMask`, `shadeRegion`-Split, stamp-`visualAnchors`); `LANGUAGE_VERSION`
  ganz gelöscht (auch aus README-API-Liste). `eval.ts` `#throughTransformAnchorPoint` +
  `#stampAnchorPoint` (nur vom Legacy-Pfad genutzt) entfernt → nur `#visualAnchorPoint` bleibt.
  `shadow`-Case: Zwei-Zahlen-Alias (`shadow dx dy p`) entfällt → nur `dx:dy`/Region; whole-frame-Shadow
  respektiert immer die Maske. `raster.ts` `shadeRegionLegacy` gelöscht, `filterShadow`-`respectMask`-
  Param weg (Maske immer respektiert). `lint.ts` **W005** (`lintOpaqueShadeRegionBase`) samt Aufruf +
  `LANGUAGE_VERSION`-Import raus. `diagnostic.ts`: **E009**-Slot als retired kommentiert (nie
  renummerieren/wiederverwenden; W005-Slot analog frei). Pragma `drawstic N` bleibt syntaktisch legal,
  ist aber inert (jedes N ok, kein Fehler mehr) — verifiziert per `check` auf `drawstic 9` (Exit 0).
  Examples: `shadow 1 1` → `shadow 1:1` in `scenes/arctic.drw` + `showcase/themes.drw` (die zwei einzigen
  Zwei-Zahlen-Shadows, hätten sonst geworfen); die inerten `drawstic 1`/`drawstic 2`-Zeilen **bewusst
  belassen** (ADR-0088: Direktive nur gehalten, damit Altdateien nicht zwangs-gestrippt werden). Tests
  auf eine Semantik konvertiert: Anchor-/Shadow-/shadeRegion-v1/v2-Tests beweisen jetzt „Pragma inert"
  (pinned == unpinned); W005- + shadeRegionLegacy-Tests entfernt; `filterShadow`-Mask-Tests auf die
  Single-Semantik umgeschrieben. 727 Tests grün (733−6), tsc + biome clean. Doku: language-spec §2/§9/
  §12/§14 + W005-Zeile + Grammar-Alias, reference.md, SKILL.md, best-practices.md bereinigt.
- [ ] **2c-finding `lit`-Block nur Bare-Name** Der `lit L:`-Block akzeptiert bewusst nur einen
  Bare-Name (`lit sun:`), keinen komplexen Ausdruck (anders als `mask expr:`), um die kontextuelle
  Dispatch-Ambiguität mit `lit = …`/`fill lit`/`fn lit` (bestehende Recipe-Nutzung von `lit`) sauber
  zu halten. Falls je `lit theme.light:` o.Ä. gebraucht wird: erst an einen Namen binden. Analog nimmt
  die `light L`-Override an `model`/`cel` einen Bare-Name-`light`-Marker (kein globaler KW_ARG), damit
  `light` nirgends global reserviert wird.
- [ ] **2c-collapse-finding: Example-Pixel-Shift der ehemaligen `drawstic 1`-Szenen** Die sechs
  `scenes/{volcano,reef,orbit,market,island,arctic}.drw` pinnten `drawstic 1` und rendern jetzt unter
  der einzigen (Ex-v2-)Semantik: opake `shadeRegion`-Basen sind Veils statt Repaints, Flip-/Rot-Anchors
  sind visuell, whole-frame-`shadow` respektiert die Maske. Alle bleiben grün unter `critique --strict`
  (Gate = C001/C007/C008), aber die Bilder haben sich sichtbar verschoben (nicht vision-verifiziert).
  Falls ein späterer `craft-eval`/Phase-4-Lauf pristine Beispiele will: inerte Pragma-Zeilen strippen
  **und** die sechs Szenen an der neuen Veil-/Visual-Anchor-Semantik nachjustieren (Shading-Dosen,
  Hausplatzierung in `market`). Bewusst hier deferred — vom Gate nicht gefordert, ADR-0088 hält die
  Pragma-Zeilen ohnehin als inerte Altlast.

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

- [x] **2b-finding `celRegion` Bereichs-Normalisierung** Ein weit entfernter synthetischer
  Directional-Lichtpunkt (`center − dir·2·Diagonale`) komprimiert das rohe `forRegionDistance`-`t` der
  Region auf ein Teilintervall (z.B. `[0.6, 1.0]`), sodass eine naive `floor(t·N)`-Bänderung die vorderen
  Bänder verschluckt (nur 2 statt 3 Bänder erscheinen). Gelöst per Zwei-Pass in `celRegion`: erst
  Region-eigene `[tMin, tMax]`-Spanne bestimmen, dann `(t−tMin)/span` remappen → alle N Bänder erscheinen
  gleichmäßig, unabhängig von der Lichtdistanz. Kontinuierliche Veils (`shadeRegion`/`lightRegion`) bleiben
  bewusst un-remappt (weiches Directional-Gefälle ist dort gewollt). Konsequenz für 2c: `cel REGION MAT N`
  kann direkt `lightPointFor(region, light)` durchreichen; `celRegion` normalisiert selbst.
- [ ] **2b-finding `lowerMaterial`-Cast-Reihenfolge** Der Cast-Schritt ist region-scoped (verschobenes
  Silhouetten-Band minus Region) und wird laut ADR-0086 als letzter Schritt der Sequenz gemalt. Da das
  Band per Konstruktion außerhalb der eigenen Region liegt, ist die Reihenfolge relativ zur eigenen
  Region unkritisch — aber es malt **über** Nachbar-Regionen, die vorher im selben `draw` gezeichnet
  wurden (das Band steckt down-light heraus). Für einzelne `model`-Objekte korrekt; bei dicht
  gepackten Multi-Part-Sprites in 2c/3 prüfen, ob Cast besser vor den Geschwistern (Ground-first,
  scene-craft §8) statt am Ende der Objekt-Sequenz läuft. Heute unkritisch (interne Maschinerie).
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
