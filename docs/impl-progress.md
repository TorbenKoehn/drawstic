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

- [x] **3** `pin NAME PT` (Attach-Point-Deklaration) + `fit partB.NAME partA.NAME` (kontakt-garantiertes
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
  → **3b-Zentrierung erledigt** (dieser Commit, s. Emergente Punkte). **Phase 3 abgeschlossen.** Der
  `craft-eval`-Character-Lauf ist bewusst NICHT Teil dieser Einheit (schwere Multi-Agent-Messung mit
  Review-Bedarf, human-getriggert — analog `measure-phase2`); Checkbox 3 wird für die Code-/Doku-Arbeit
  abgehakt, die Messung läuft separat.

## Phase 4 — Break schließen

- [x] **4** Product-Skill um neuen Default-Pfad neu schreiben (`SKILL.md` + `reference.md` + 4
  craft-*.md); Legacy kollabieren; `docs/language-spec.md` §Assembly + Break-Notes; `docs/best-practices.md`;
  finaler `craft-eval`-Re-Run pro Kategorie, Reports in `docs/`. Zielkorridor Overall < ~1.4.
  → **Doku-/Skill-Hälfte erledigt** (dieser Commit). Der eine verbindliche Workflow (Absicht
  deklarieren → assemblieren → `critique --as X` bis `pass:true` → Vision-Rubrik → `build`) ist jetzt
  der explizite Default: `SKILL.md` Workflow-Intro benennt den deklarativen Arc; neue kanonische
  **Recipe-anatomy**-„Declarative object"-Passage (`light`/`material`/`model`/`cel`/`lit`, engine-
  verifiziert via `render --explain`); § Scenes Mandatory-Order Schritt 1/4 + Checklist auf `light`/
  `model`/`cel`/`fit` gezogen. **Legacy kollabiert** (nur noch Floor/Escape-Hatch, keine
  Doppelanleitung): `scene-craft.md` §1 (Licht-Contract = `light sun = dir …` statt `sun`-Punkt +
  `warm`/`cool`-Triple; Hand-Töne via `litTone`/`shadowTone`), §4 (`model`/`cel` als Default, Hand-
  Quartett = `--explain`-Floor), §5 (Dosage-Tabelle als Material-Response-Default deklariert,
  Referenz fürs Hand-Tuning), §12 (critique-Gate zuerst); `best-practices.md` § Light And Shadow
  (deklarativer Default zuerst, Filter = Floor); `motif-cookbook.md` Night-Lighting (stale
  `drawstic 1`/v2-Parenthese entfernt → deklarativer Pointer); `character-craft.md` §6-Fallback-fns
  auf `litTone`/`shadowTone` vereinheitlicht. **critique-Gate** in allen vier Craft-Guide-Verifikations-
  Kadenzen verankert (icon/character/item/scene). `docs/language-spec.md` §16: `critique`-Verb + C0xx-
  Katalog-Subsection ergänzt, render-Zeile um `--silhouette`/`--explain` + Output-Precedence; §Assembly
  (§9 `pin`/`fit`) + Break-Notes (§2 Pragma inert, §14 „One semantics") waren aus 2c/3a bereits
  normativ vollständig. Alle neuen deklarativen Skill-Beispiele engine-smoke-getestet (`check` `[]` +
  `render --explain`). `tsc --noEmit` + `biome check .` clean, 749 Tests grün (unverändert — reine
  Doku). **`craft-eval`-Re-Run bewusst NICHT gefahren** (schwere Multi-Agent-Messung, human/deferred —
  s. `measure-phase2` + `measure-phase3`); die Zielkorridor-Messung < ~1.4 läuft separat.

## Character Fix-Wave

_(Fix-Wave zur Character-DX-Evaluation `docs/character-dx-evaluation-2026-07-10.md`; die Einheiten
adressieren die human-visuellen Befunde HV1–HV6 + Gesichter, oben (§9) nach Human-Grades gewichtet.)_

- [x] **a — Form-/Normalen-Shading als `model`-Default (HV1, alle 4)** ([ADR-0089](decisions/0089-form-based-shading.md)).
  Der harte, lineare Distanz-von-einem-Punkt-Veil (`shadeRegion`+`lightRegion` über die Bbox) ist als
  `model`-Body durch **form-/normalenbasiertes Shading** ersetzt: exakte innere Distanz-zur-Boundary
  (Felzenszwalb-EDT, `innerDistance2`/`edt1d` in `raster.ts`, deterministisch, großer finiter Sentinel
  statt `Infinity`) → Höhenfeld `H=sqrt(D/Dmax)` (Kuppel) → Per-Pixel-Normale `n=normalize(−∂H/∂x·puff,
  −∂H/∂y·puff, 1)` → Lambert `clamp(n·light)` + Ambient-Boden → Ton `warm→base→cool` via
  `formTone`/`litTone`/`shadowTone` (35 %-L-Boden ⇒ dunkle Basis nie `#000000`). **Smooth ist Default**
  (Pixel-Mode Bayer-gedithert für weichen Terminator), **`cel N` = dasselbe Intensitätsfeld als N saubere
  Bänder** (Opt-in, `lowerCel`) — Bänder folgen der Form statt gerader Iso-Distanz-Linien. Lowering:
  `planMaterial` → `form`-Op + rim/ao/cast (glow unverändert); `formSpecOf`/`lightVec3` in `shading.ts`;
  `render --explain` serialisiert die `form`-Op (Tönungsziele, Licht-`z`, Dosen, Bänder). Probe-Render
  (`--png@8` Kugel/Zylinder/Torso): Highlight sitzt auf der lichtzugewandten Wölbung, weicher Terminator,
  Zylinder liest als Zylinder; `cel 4` zeigt gekrümmte Bänder. `tsc`+`biome` clean, 792 Tests grün
  (shading/model/cel/light-material/cli-explain auf die neue Semantik konvertiert + neue Form-Tests).
  Alt-Primitive `shadeRegion`/`lightRegion`/`celRegion` bleiben als Floor/Escape-Hatch.
- [x] **b — `pin`/`fit` Platzierungs-*Korrektheit*, nicht nur Kontakt (HV2, schlechteste Grades)**
  ([ADR-0087](decisions/0087-anchored-assembly.md) Amendment 2). Diagnose per `--png@8`: der Wizard-Kopf
  schwebte, weil sein `chin`-Pin (lokal y34) 4–5px **unter** der Kopf-Tinte (Schädel endet ~y29) liegt —
  `fit` bringt die Pins exakt zur Deckung, aber der Pin sitzt in leerem Part-Raum, also schwebt der
  sichtbare Kopf; C007 misst Kontakt, nicht das. Der Knight-Schwert-Kipp entstand durch freies
  `stamp sword … flipy` pro View (Front hoch, Side/Back runter). Fixes: (1) **`fit` nimmt die
  `stamp`-Transform-Flags** (`flipx`/`flipy`/`rotN`/`scaleN`/`transform`/`tint`/`mask`) um die
  Footprint-Mitte; die Pins **wandern mit der Transform** (`origin = ziel − M(pin)`, andere Pins über
  dasselbe `M` registriert → Links-Schulter wird korrekt verortete Rechts-Schulter nach `flipx`, Fit-Pin
  landet exakt). (2) **`pin HEAD.KEY PT` seedet ALLE Pins** des Parts, wenn HEAD ein reales Part-Sprite
  ist (§5.8-Bug behoben; Hand-Label wie `a.hipL` weiterhin Einzelkey). (3) **Placement-Selbstcheck**:
  Chebyshev-Distanz Ziel-Pin → eigene Part-Tinte; >2px ⇒ **`W011`** (loose pin, hochkonfident,
  part-lokal, keine False-Positive-Flut); `render … --explain` berichtet je `fit` Landepunkt,
  Koinzidenz und Pin-zu-Tinte-Lücke. `#hasContact`/Contact-Shadow transform-aware. Probe-Recipe
  (`--png@8`): Kopf sitzt auf dem Hals, `fit … flipx` hält den Grip-Pin exakt in der Hand. `tsc`+`biome`
  clean, 801 Tests grün (9 neue Assembly-Tests: Pin-Koinzidenz exakt, Pin überlebt flip, Pins-durch-`M`,
  Prop-Orientierung über Views, W011 feuert/feuert-nicht, seed-all). Berührt `ast.ts`/`parser.ts`/
  `eval.ts`/`cli.ts` + spec §Anchored-assembly + SKILL/reference/character-craft.
- [x] **c — Held-Prop: Grip-Pin in der Hand + Orientierungs-Konstanz über Views (HV6)** — mit b geliefert
  (dieselbe ADR-0087-Amendment-2-Änderung). Prop trägt einen `grip`-Pin, wird einmal in wahrer
  Orientierung (Klinge oben) authored und per `fit sword.grip hand.grip` gegriffen; der Per-View-*Figur*-
  Flip ist ein **separater** `fit`, der das Prop nie berührt → Front/Side/Back zeigen denselben Griff. Ein
  bewusster Prop-Flip nutzt den eigenen `fit … flipx` (horizontal, Klinge bleibt oben — Pin reitet die
  Transform). Idiom in character-craft §5 + language-spec/reference/SKILL dokumentiert; Probe-Test grün.
- [x] **d — Back-View Part-Selektion + Prop-z-Order-Idiom (HV4, §5.17)**: reine Craft-/Doku-Einheit
  (kein Engine-Umbau — die Amendment-2-Fit-Transform aus b/c trägt bereits). Neues `character-craft.md`
  §5b (vier Regeln, alle probe-verifiziert über ein 4-Part Front/Side/Back-Rig im Scratchpad,
  `check --json`=`[]`, `--png@6`): (a) **Part-Selektion** — Rückkopf zeichnet Haar/Nacken, nie
  Gesicht; ein vorwärts-posiertes Glied (Bogenarm) liest auch von hinten als „nach vorn" und muss
  entweder umgezeichnet oder über (c) gespiegelt werden. (b) **Z-Order invertiert**: ein
  rückenmontiertes Prop (Umhang/Köcher) fittet NACH allen Gliedmaßen (oben, sichtbar); vorn/seitlich
  wird dasselbe Prop VOR dem Torso-Root gestampt (verdeckt) — der belegte Assassin-Bug (Umhang vor den
  Armen gefittet → Arme lagen sichtbar über dem Umhang). (c) **Front/Back spiegeln links↔rechts** an
  Schulter/Hüfte — dieselben ungespiegelten Part-Draws, nur der Ziel-Pin-Name tauscht Seite (behebt
  zugleich C009-Kollaps bei gleicher Prop-Seite). (d) **Side-Clamp**: ein loses Teil (Umhang) mit
  mittigem statt kantennahem Attach-Pin hängt hälftig in die Figur hinein — Fix per
  `.intersect(rect(0:0, attachX:h))` auf die pin-ferne Hälfte, der belegte Assassin-Side-Cape-Bug
  (Probe zeigt geklemmt vs. ungeklemmt nebeneinander). §1 (Build-Order), §2 (Vertikal-Budget hohe
  Kopfbedeckung), §4 (W010 ist fit-zeitpunkt-sensitiv, erster Root-`fit` warnt harmlos), §6
  (C004-Dosis-Rezept für dunkles Material) im selben Kohärenz-Pass ergänzt; zwei stale interne
  §-Verweise gefixt (§7→§3,§6 und §5→§4). `SKILL.md` §Characters Schritt 6/Checklist um Back-Idiom +
  Sheet-Auto-Exclusion nachgezogen (siehe unten). Scratchpad-Proben (`face-probe.drw`,
  `back-view-probe.drw`) sind Verifikationsartefakte, nicht Teil des Commits.
- [x] **e — Verlässliche Silhouetten-Outline für zusammengesetzte Figuren (HV5, alle 4)**
  ([ADR-0090](decisions/0090-reliable-silhouette-outline.md)). Diagnose per `--png@8` der realen
  Builder-Ausgaben + Proben: der `outline`-Filter (Dilatation → Ring) ist **kein Dilatations-Bug**,
  sondern scheitert an drei Punkten. (1) **Kein Composited-Pfad → Pro-Part-Backing**: das
  guide-nahe Idiom legte `outline` in jedes Part-`draw` (Knight 15×, Wizard 12×); nach `pin`/`fit`
  werden die Pro-Part-Ringe zu **internen dunklen Nähten**, die eine Silhouette nie schließt.
  (2) **`alpha > 0` verschluckte weiche/AA-Pixel**: bei Whole-figure-Nutzung (Archer) bekam der
  **gemandatete weiche Kontaktschatten** (`alpha 38%`) einen eigenen Ring (Probe reproduziert den
  Schatten-Ring). (3) **Schwache Defaults**: Farbe Pflicht + Breite 2 klobt einen 2px-Bogen/Stab zum
  Club. Fixes in `filterOutline` (`raster.ts`): **Silhouette ab 50% Deckung** (`OUTLINE_ALPHA_MIN=128`
  → ignoriert Schatten/AA-Fringe), **Farbe optional mit abgeleitetem Dunkelton** (`inkTone` in
  `color.ts`: OkLCh L≈0.15, C≤0.05, Hue erhalten → warm-/kühl-black je Figur), **Breite Default 1**,
  4-connected (keine Diagonal-Nubs, pixel-art-korrekt). `Args.optPaint()` (`eval.ts`) macht Farbe+Breite
  beide optional: `outline` · `outline ink` · `outline ink 2` · `outline 2`. Da nur **außerhalb** der
  Silhouette gemalt wird, frisst der Ring keine dünnen Features (1px-Stab/Finger behält Kern).
  RO-Default-Idiom: **ein bare `outline` als letzte Anweisung des Assembly-`draw`** über die
  Gesamtsilhouette — nicht pro Part. Probe-Renders (`--png@8`): Whole-figure-Bare-Outline schließt
  sauber, weicher Schatten NICHT geringt, dünner + diagonaler Stab intakt; alte `outline ink 2` klobt,
  alte 1px-Version ringt den Schatten. `tsc`+`biome` clean, 805 Tests grün (4 neue: 50%-Boden,
  dünnes-Feature-Kern-Überlebt, abgeleiteter Dunkelton, beide-optional-Parse). Doku: language-spec
  §Filters + Grammatik, reference.md (Filterzeile + Compositing-Bullet), SKILL.md §Characters (Schritt 7),
  character-craft §6 (RO-Outline-Idiom).
- [x] **f — Chibi-Gesicht/Klein-Detail bei 64×128 (HV3, schlechteste Note)**: ebenfalls reine
  Craft-/Doku-Einheit — kein neues Face-Primitive, sondern ein kopierbares Fünf-Schicht-Rezept aus
  bestehenden Primitiven, neu in `character-craft.md` §7: (1) Hautbasis via `model`, nicht `cel 2`
  (die Wizard-„Beard"-Falle bei kleinen Massen — `cel N≥3` falls doch gewünscht); (2) Auge = weiße
  Mandel + farbige Iris + dunkle Pupille + 1 Licht-Pixel (vier Zeilen, kein bloßer Punkt); (3) Braue =
  1px-Strich mit sichtbarem Abstand zum Pony; (4) Nase = 1–2px Schattenstrich, nie eine Kontur; (5)
  Mund = kurzer Strich bei ~70% Alpha. Probe-verifiziert (`face-probe.drw` im Scratchpad, 28×34
  `headFront`, `check --json`=`[]`, `--png@8`+`--png@1`): Auge mit Iris/Highlight, Braue getrennt vom
  Haar, Nase/Mund sichtbar bei beiden Renderskalen — kein „2-Punkte"-Gesicht mehr. §6-Verweis auf die
  ADR-0089-Form-Schattierung bei Chibi-Skala bereits vorher korrekt (kein Fix nötig).
- [ ] **g — Re-Render aller vier Charaktere + Human-Vision-Pass** gegen die neue Schattierung/Placement.

## Emergente Punkte

_(Findings aus `bun run test` und craft-eval-Läufen hier als neue Checkboxen anhängen.)_

- [x] **3b-centering** Kreis/Ellipse auf eine Zentrierungs-Konvention (ellipse → circles even-diameter,
  ADR-0087) + Off-by-one-Footprint in `values.ts` (`ellipseRegion` → even `c-rx..c+rx-1` × `c-ry..c+ry-1`,
  Corner-centred wie `circleRegion`); betroffene Tests/examples anpassen. **Separater Teil, NICHT in 3a.**
  → `values.ts`: `ellipseRegion` neu geschrieben — Corner-centred (`pcx=cx-0.5`), Even-Footprint
  `cx-rxi..cx+rxi-1` × `cy-ryi..cy+ryi-1`, Membership per **integer-cross-multiplied** Ellipsengleichung
  `dx²·ryi² + dy²·rxi² ≤ (rxi·ryi)²` → exakt und reduziert bit-genau auf `circleRegion`s `dx²+dy² ≤ ri²`
  bei `rxi===ryi` (garantiert: circle == ellipse(r,r), 2304 Pixel über r∈{0,1,2,3,5,8} test-gepinnt).
  Zero-Achse kollabiert auf die 1px-Spalte/-Zeile `cx`/`cy` (r=0-Dot pro Achse generalisiert); beide
  zero = 1px. Das odd `2r+1`-Legacy von ADR-0028 §3 fällt. **`ellipseSpans` gelöscht** (nur noch von der
  alten Odd-Regel genutzt → toter Code; `circleSpans` bleibt für `rrectRegion`). `values.test.ts`:
  `ellipseSpans`-Import + -Test raus, Ellipse-Tests auf Even-Extents umgestellt + Circle-Äquivalenz-Test
  ergänzt. `assembly.test.ts` `fit shadow`: Geometrie auf schmalen Fuß umgestellt (die Even-Konvektion
  verdeckt einen 1px-breiteren-rechten Odd-Rand nicht mehr; Assertion auf ein seitlich herausragendes
  Schatten-Pixel gezogen). Doku: language-spec (Shape-Tabelle + Pinned-Rasterization), reference.md
  (ellipse-Zeile), SKILL.md-Gotcha, icon-craft §4, ADR-0028 §3 (inline superseded-Note). 749 Tests grün,
  tsc + biome clean, `critique --as icon/item --strict` grün auf allen icon/item-examples (C003 hält).
  **Betroffene Laufzeit-Nutzer** (unverändert korrekt, nur 1px-Shift auf Boden/Rand): `#dropContactShadow`
  (Auto-Contact-Shadow-Ellipse), `ellipse`-Command, `ellipse(...)`-Region-Expr.
- [ ] **3b-finding: degenerierte Ellipsen-Achse** Eine Null-Achse (`ellipse c 0:ry`) rendert jetzt eine
  1px-Linie an der Integer-Spalte/-Zeile (statt der alten Odd-`2ry+1`-Linie über den Integer-Pixel — die
  x-Extents sind identisch, nur die Nicht-Null-Achse ist nun even). Real nie idiomatisch (dafür gibt es
  `line`); nur der Vollständigkeit halber gepinnt. Kontinuierlicher `test()` gibt bei Null-Achse `false`
  (wie zuvor).
- [ ] **3a-finding: fit-Source-Bareword ist immer Pin-Ref** Ein Bare-Name als `fit`-Source (`fit b a`)
  ist stets eine Pin-Referenz (Auto-Match), nie ein Point-wertiges Binding — ein Punkt als Source muss
  als Point-Literal (`x:y`) oder geklammert geschrieben werden (Disambiguierung, sonst wäre `fit b pt`
  mehrdeutig). Dokumentiert in language-spec §9 / reference. Falls je ein Point-Binding als Source
  gebraucht wird: `fit b.pin (pt)` klammern.
- [x] **3a-finding: W010 nur über gerenderte Pfade sichtbar** → **gelöst**: `runBuild` und `runSheet`
  (`cli.ts`) reichen `engine.warnings` jetzt konsistent zu `render` durch — JSON-`diagnostics` **und**
  human-Ausgabe (nach den `wrote`-Zeilen bzw. ascii/preview-Output). `sheetJson` nimmt die Diagnostics
  als Param (kein hartkodiertes `diagnostics: []` mehr). W010 bleibt `warning` → Exit 0. Tests
  (`cli.test.ts`): build-Gap-Recipe → W010 in JSON-`diagnostics` + human-Output; sheet `--all`-Gap →
  W010 in JSON-`diagnostics`. Doku: language-spec §9 (Contact guarantee: „surfaces in render/build/
  sheet"), reference.md (W010-Zeile).

- [ ] **measure-phase2** (HUMAN-GATED) craft-eval (eine Kategorie, Charaktere) gegen die dokumentierten
  Baselines fahren (schwer, Multi-Agent, Review-Bedarf) — konsolidiert am Ende/Human-getriggert. Deckt
  die Phase-2-Messung des Plans ab („misst, ob Licht+Material die Grade bewegt"); explizit NICHT im
  autonomen Einzel-Einheit-Scope, weil ein Builder-Wave + Konsolidierung + Fix-Wave menschliches
  Review braucht. **Nicht autonom anfassen — menschlich zu triggern.**
- [ ] **measure-phase4** (HUMAN-GATED) finaler `craft-eval`-Re-Run **pro Kategorie** (Blind-Rebuild mit
  dem deklarativen Default-Pfad), Grades gegen die dokumentierten Baselines, Reports in `docs/`
  ablegen, Zielkorridor Overall < ~1.4 (bes. Lighting-Achse 1.9 + Near-Neighbour-Item-Lücke). Die
  Code-/Doku-Hälfte von Phase 4 ist erledigt (Checkbox 4); diese Messung ist der human/deferred-
  getriggerte Rest (schwere Multi-Agent-Läufe, `craft-eval`-Skill), analog `measure-phase2`.
  **Voraussetzung/Kandidat** vor dem Lauf: das `2c-collapse-finding` (inerte Pragma-Zeilen strippen +
  die sechs ehemaligen `drawstic 1`-Szenen an der Veil-/Visual-Anchor-Semantik nachjustieren, falls
  pristine Beispiele gewünscht). **Nicht autonom anfassen — menschlich zu triggern.**
- [x] **4-finding: kein Skill↔CLI-Konsistenz-Test** → **gelöst**: `tests/unit/skill-cli-sync.test.ts`
  (20 Tests) prüft pro dokumentiertem Verb (`check`/`fmt`/`context`/`render`/`critique`/`sheet`/`build`)
  und pro zentralem Flag (`--explain`/`--silhouette`/`--as`/`--strict`/`--family`/`--json`), dass es in
  `src/cli.ts` verdrahtet ist (HELP-Block-Regex ODER `main()`-Dispatch-Case für Verben; Substring-Suche
  für Flags — bewusst locker, keine 1:1-Prosa-Gleichheit, damit reine Doku-Politur nicht bricht) **und**
  umgekehrt jeder tatsächlich dispatchte Verb irgendwo in `SKILL.md`/`reference.md` dokumentiert ist
  (Drift-Schutz in beide Richtungen: ein entfernter/umbenannter Verb/Flag UND ein neuer, undokumentierter
  Verb schlagen beide fehl). Garantiert: künftige Skill↔CLI-Drift wird ein failing Test, nicht mehr nur
  Handverifikation.
- [ ] **2d-finding: Auflösungsreihenfolge explicit>lit vs. Task-Wortlaut** Die Task-Notiz listete
  „`lit`-Block > explizites `light L`-Arg > Theme-Default". Umgesetzt ist **explizites `light L` >
  `lit L:`-Block > Theme-Default** — konsistent mit ADR-0086 (autoritativ: „value binding → lit block
  → theme default") und dem bereits ausgelieferten 2c-`#requireLight` (`explicit ?? draw.light`, hier
  unverändert gelassen; das Theme-Default seedet nur `draw.light`). Die essenzielle Anforderung (Theme
  = äußerster Fallback) ist erfüllt; nur die Ordnung der oberen zwei Tiers folgt ADR statt Task-Prosa.
  Numerisch gepinnt in `theme-light.test.ts`. Falls doch lit>explicit gewünscht: `#requireLight` auf
  `draw.lit ?? explicit ?? draw.themeLight` umbauen (bräuchte getrennte lit-/theme-Felder in DrawState).
- [x] **2d-finding: `material` im Theme-Body still verworfen** → **gelöst** (kleinere, saubere
  Variante, konsistent mit ADR-0086: Materials leben in Modul-/Draw-Scope, sind NICHT Teil des
  Themes): statt still zu droppen wirft `#foldThemeItem` jetzt einen eigenen `materialBinding`-Case
  ein **positioniertes E004** an der Deklaration mit hilfreichem Hint (`materials live in module
  scope … where model/cel reads them`) — exakt analog zu `#foldBinding`s Ablehnung freier Bindings.
  Theme-Material zu falten wäre der größere Weg (fold/merge/fingerprint/context) und sprengt den
  ADR-Scope; die Fehler-Variante ist die minimale, footgun-freie Lösung. Tests
  (`theme-light.test.ts`): Theme-Body-`material` → E004 mit Message/Hint; Modul-Scope-`material`
  darüber bleibt akzeptiert. Doku: language-spec §Themes + reference.md (E004 deckt jetzt auch
  `material`).

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

- [x] **1c-followup C009-Plate-Blindheit** → **gelöst = bewusst advisory**: Verhalten/Thresholds
  bewusst NICHT geändert (Risiko von False Positives; C009 advisory war die kalibrierte 1c-Entscheidung).
  Als dokumentierte bekannte Limitation geschlossen: Kommentar an `COLLAPSE_DISTANCE` in
  `src/critique.ts` (C009 signiert die *volle* Covered-Maske → bei opakem Plate = Plate-Silhouette,
  alle Glyphen kollabieren) + „Known limitations"-Abschnitt in `docs/decisions/0085-critique-command.md`.
  C009 bleibt `warning`-only (nie `--strict`-promoted) → in der Praxis kein False-Positive-Blocker.
- [x] **1c-followup C011-Margin** → **gelöst = bewusst advisory**: Verhalten/Thresholds bewusst NICHT
  geändert (gleiche Begründung wie C009). Als dokumentierte bekannte Limitation geschlossen: Kommentar
  an `PARITY_FACTOR` in `src/critique.ts` (C011 gated nur Gewicht via Covered-Count-Ratio; Margin ist
  über `familyMetrics.bbox` sichtbar, aber nicht separat gegated) + „Known limitations"-Abschnitt in
  `docs/decisions/0085-critique-command.md`.

- [x] **2b-finding `celRegion` Bereichs-Normalisierung** Ein weit entfernter synthetischer
  Directional-Lichtpunkt (`center − dir·2·Diagonale`) komprimiert das rohe `forRegionDistance`-`t` der
  Region auf ein Teilintervall (z.B. `[0.6, 1.0]`), sodass eine naive `floor(t·N)`-Bänderung die vorderen
  Bänder verschluckt (nur 2 statt 3 Bänder erscheinen). Gelöst per Zwei-Pass in `celRegion`: erst
  Region-eigene `[tMin, tMax]`-Spanne bestimmen, dann `(t−tMin)/span` remappen → alle N Bänder erscheinen
  gleichmäßig, unabhängig von der Lichtdistanz. Kontinuierliche Veils (`shadeRegion`/`lightRegion`) bleiben
  bewusst un-remappt (weiches Directional-Gefälle ist dort gewollt). Konsequenz für 2c: `cel REGION MAT N`
  kann direkt `lightPointFor(region, light)` durchreichen; `celRegion` normalisiert selbst.
- [x] **2b-finding `lowerMaterial`-Cast-Reihenfolge** → **untersucht + geschlossen: KEIN Defekt für
  assemblierte (`fit`) Multi-Part-Sprites** (2-Part-Testszenario gebaut, `assembly.test.ts`). Befund:
  jeder Part ist ein eigener `draw`, isoliert gerendert — der Cast (Silhouetten-Band offset down-light
  minus Region) landet im **part-eigenen** transparenten Margin (empirisch: Region rect(2:2,11:11) →
  Cast-Pixel bei x=12, außerhalb der Region, semi-transparent) und berührt zur `model`-Zeit NIE einen
  Nachbarn. Die einzige Cross-Part-Interaktion ist gewöhnliches source-over beim `fit`/`stamp`
  (ein Part-Schatten groundet den darunterliegenden Part, in Stamp-Reihenfolge) — deterministisch und
  gewollt (ADR-0087-Grounding), kein Fix nötig. Nur im **monolithischen** Fall (mehrere `model` in
  EINEM Draw) fällt ein späterer Cast auf einen früher gezeichneten Nachbarn — bewusste back-to-front-
  Semantik (scene-craft §8), ebenfalls kein Bug. Als bewusste Semantik dokumentiert: `shading.ts`
  (`castBand`-Doc), language-spec §Light&Material (`model`-Zeile) + reference.md. 2 neue Tests
  (Cast-Band im eigenen Margin; 2-Part-`fit`-Assembly deterministisch + unabhängige Shading).
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
- [ ] **b-finding: `pin HEAD.KEY`-seed-all kennt die Stamp-Transform NICHT.** `pin torso.neck …`
  löst die Origin aus dem **untransformierten** Part-Sprite; steht davor ein `stamp torso … flipx`,
  seedet der manuelle Pin die anderen Pins an der *unflippten* Position (Schulter-Seite stimmt dann
  nicht). Grund: `stamp` merkt sich seine Transform nicht. Idiom-Ausweg (dokumentiert): den
  gespiegelten Part per `fit` platzieren statt `stamp`+manuellem `pin` — dann reiten die Pins die
  Transform korrekt. Ein sauberer Fix bräuchte transform-tragende Stamp-Registrierung (größerer
  Umbau, außerhalb b-Scope). Für unflippte Roots (der Normalfall) irrelevant.
- [ ] **b-finding: W011-Schwelle ist Chebyshev >2px, part-lokal.** Bewusst hochkonfident/eng: fängt
  echte Float-Joints (Wizard-`chin` 4–5px daneben) ohne False-Positive-Flut. Kanten-Pins (0–1px) und
  1px-Overlap-Nähte (§4d) bleiben still. Falls je zu streng: die Konstante `LOOSE_PIN_MAX` in
  `eval.ts` heben. Misst nur die **Ziel**-Part-Seite (der platzierte Part); die Quell-Pin-Landung ist
  bereits platziert und nicht auf Ink-Nähe prüfbar.
- [ ] **b-finding: `fit … anchor` wird ignoriert.** `fit` erbt die `stamp`-Flag-Grammatik inkl.
  `anchor …`, aber für `fit` IST der Pin der Anker — `flags.anchor` wird beim Origin-Solve nicht
  gelesen. Kein Fehler, nur wirkungslos; nicht dokumentiert (kein sinnvoller `fit`-Use). Bei Bedarf
  später als E-Fehler ablehnen.
