# Release 1.0 — Programm-Tracker

Ziel: erster öffentlicher Release. Vorher wird alles bereinigt, was danach ein Breaking Change
wäre — Sprachfläche, Beispiel-Korpus, Product-Skill, README, Packaging.

Status-Legende: `[ ]` offen · `[~]` läuft · `[x]` fertig (verifiziert: `bun test` + `biome check` +
`tsc --noEmit` grün, visuelle Behauptungen probe-gerendert).

## Evidenz (4 Audits, 2026-07-26)

| Audit | Kernbefund |
|---|---|
| [Sprachfläche](audit-language.md) | 9 Konstrukte tot/doppelt (release-blocking), 6 Namen kollidieren, `tileset`+`atlas` doppeln sich, 18 Mehrwege-Konflikte |
| [Session-Forensik](audit-sessions.md) | 915 Recipe-Edits vs. 22 harte Fehler — 97 % der Iteration ist blindes Bild-Anschauen; `critique` grün ↔ Human 2.4–5.5; 13,7 % aller Edits sind reines Zahlen-Nudging (C004-Gaming) |
| [Korpus-Nutzung](audit-corpus.md) | 3 Generationen pro Kategorie koexistieren; 233× `.intersect(rect)`-Handshading, 79 Hand-Kontaktschatten, 58 handgespiegelte L/R-Paare; ~40 von ~180 Namen tot |
| [Product-Skill](audit-skill.md) | Routing-Entscheidung 250 Zeilen zu spät; **kein einziges vollständiges Beispiel**; Flaggschiff-Beispiel fällt durch das eigene Gate (W002 + C002); 7 tote `examples/`-Zeiger + 69 ADR-Tokens im ausgelieferten Skill |
| [Release-Readiness](audit-openitems.md) | `release.yml` publiziert ohne `NODE_AUTH_TOKEN`; `biome check` rot; README ohne `critique`; 6 Grammatik-Lücken in der Spec |

## Entscheidungen (Architektur)

- **D1 Sprach-Freeze.** Entfernen: `cap`/`join`, `castShadow`, `seed`, `grayscale`, `drawstic N`,
  Bare-Int-Exportgröße, Bare-Filtername-Statement, `anchor` auf `fit` (→ Fehler).
  Umbenennen: `pal`→`palette`, `grad`→`gradient`, `band`→`ribbon`, `ambientOcclusion`→`ao`,
  `import`→`image`, `fit … shadow`→`fit … ground`. **`model` bleibt** (Modellieren ist der
  Mal-Fachbegriff für Volumen-Schattierung). Mergen: `tileset`+`atlas`.
- **D2 Roh-Shading-Quartett** (`rim`/`shadeRegion`/`lightRegion`/`ambientOcclusion`): höchstens EIN
  Hand-Licht-Primitiv überlebt; Entscheid per Design-Agent mit Probe-Renders.
- **D3 Ein Beispiel-Korpus pro Kategorie.** Behalten: `characters-ro2`, `scenes-v3`, `items-v2`,
  `icons`, `basic-shapes`, `showcase`, `text`. Löschen: `characters/`, `characters-ro/`, `items/`,
  `scenes/`, `scenes-v2/` (Historie bleibt in git).
  - **`scenes-v3` ist geschütztes Material.** Es hat außerhalb des Projekts viel positive Resonanz
    bekommen; **arctic, desert, island, market, reef** werden bei Umbauten pixelgenau erhalten (Ziel:
    `--diff` = 0), nicht „verbessert". Nur **volcano** und **orbit** dürfen bewusst besser werden.
    Bei mehreren vertretbaren Migrationswegen gewinnt der, der das Bild reproduziert (Schleier via
    `fill linear(...)` statt `model`, das mit formfolgenden Tönen neu anstreicht). Diese Szenen sind
    zugleich das Bildmaterial für die README (D6).
- **D4 Craft-Signal.** C004 wird beratend + bekommt einen konkreten `spread`-Vorschlag im `fix`-Feld
  (es war die meistgezählte und am leichtesten zu gamende Metrik).
- **D5 Skill-Neubau** nach der Struktur aus [audit-skill.md](audit-skill.md) §8/§9, inkl.
  ausgelieferter, lauffähiger `starters/*.drw`.
- **D6 README** für Mensch (Bilder + Syntax daneben) und LLM (kanonischer Pfad in 20 Zeilen).
- **D7 Export-Pfad-Konvention.** `build` schreibt per Default neben das Rezept; Exportpfade sind
  Basisnamen. (Beim Neu-Rendern des Korpus kostete das 5 verschiedene Konventionen und
  Junk-Verzeichnisse.)

## Phasen

### W3-0 — Shading-Rauschen `[x]`
- [x] Dither aus beiden Shading-Pfaden entfernt (`c34d432`), ADR-0091-Amendment, Korpus neu gerendert.

### W3-1 — Aufräumen ohne Sprachbruch (parallel) `[x]`
- [x] **A** Design-Entscheid Roh-Shading-Quartett → ADR-0097 (`bbc5caf`); `atlas`-Merge-Form → ADR-0096 §3.
- [x] **B** Packaging/CI: `NODE_AUTH_TOKEN`, `--provenance`, `npm pack`-Smoke-Test (`7cb4631`).
- [x] **C** ADR-Index-Korrekturen + AGENTS.md-Doks-Index (`d91ba1a`).
- [x] **E** Korpus-Konsolidierung (D3) inkl. Test-/Doc-Referenzen (`184657c`).

### W3-2 — Sprach-Freeze (sequenziell, Kern-Dateien)
- [x] Entfernungen (D1) + `fit anchor`-Fehler + `mix`-Enum-Fix (`32cd0c3`).
- [x] Umbenennungen (D1) über Parser/Eval/Lint/Spec/Skill/Beispiele (`8a2b488`).
- [x] Export-Pfad-Konvention (D7) + Lint `W016` (`8a2b488`); Pfadkollision → `E018` (`0aaf5d9`).
- [x] Roh-Shading-Quartett raus, `REGION.edge()` rein (`eb91eac`, ADR-0097).
- [x] `atlas`-Merge (ADR-0096 §3: `tileset`+`atlas` → ein `atlas` mit optionalem `tile WxH`,
      `E015`/`E016`/`E004`/`E001` + Degenerate-Guards, `tiled`-`spacing`) + Builtin-Reservierung
      (bereits erledigt, s.o.) + Licht-Auflösungsregel (ADR-0096 §4: explizit → Theme-Default →
      alleinige Modul-`light`-Bindung → `E024`) + `pin`-Transform-Bug (`stamp` zeichnet seine
      Transform-Matrix jetzt unter dem Kopf-Namen auf `DrawState.stampTransforms` auf; `pin
      HEAD.KEY`-seed-all wendet sie auf jeden lokalen Pin an, bevor die Offsets berechnet werden —
      sauberer Fix statt Fehler-Route, kein größerer Umbau nötig). tsc+biome clean, 953 Tests grün
      (+neue Atlas-Grammatik-/Sidecar-/Licht-Fallback-/Pin-Transform-Tests).

### W3-3 — Beispiele auf den kanonischen Pfad
- [x] `icons` auf `light`/`material`/`model` (`eb91eac`).
- [x] `scenes-v3` — 74 Aufrufe migriert (`e4fe7c6`). Die fünf geschützten Szenen sind
      pixel-erhaltend (arctic/desert/island/market Δmax 2, reef Δmax 8, jeweils reines
      Quantisierungsrauschen des Gradient-Pfades); volcano + orbit bewusst verbessert.
- [x] `items-v2` — 7 `tileset`s auf `atlas … tile WxH` migriert (byte-identische Sheets/Sidecars).
      `shields.drw` hatte die Migration zuerst zu *einem* `atlas` gefaltet — die Begründung „beide
      unterschieden sich nur im `pad`" war falsch, sie unterschieden sich im **Packmodus**. Damit
      war der grid-lose Shelf-Pack korpusweit unbelegt und ein Beispiel zu zwei Namen für dieselbe
      Sheet geworden. Zurückgeholt (`6ea87eb`): `shieldsGrid` (mit `tile 64x64`, für `tiled`) neben
      `shieldsAtlas` (ohne `tile`, shelf-gepackt für `atlasJson`) — Shelf-PNG und JSON wieder
      byte-identisch zum Stand vor der Migration.
- [x] Spec-Grammatik-Sync (pin/fit, behind/front, quantize, organische Konstruktoren, CLI-Tabelle,
      E026) + PNG-Decode-Diagnostik `E027` (`d1b6237`); Theme-Body-Guard `E004` (`bd1fe03`) —
      ein `fn`/`export`/Zeichenkommando/`for` im Theme-Rumpf fiel vorher stillschweigend auf den
      Boden, jetzt positionierter Fehler auf dem Statement.

### W3-4 — Product-Skill + README `[x]`
- [x] Skill-Neubau (D5), zwei Wellen (`8a35f31` Kern, `0d776e5` Craft/Referenz). Neue Struktur:
      `SKILL.md` (`<start_here>` → Routing → kanonischer Pfad → EIN vollständiges Rezept → Done-Gate),
      `language.md`, `verify.md`, `walkthrough.md`, vier Craft-Guides, `reference.md` (jetzt mit
      Inhaltsverzeichnis), lauffähige `starters/*.drw`.
      **Gemessene Ladepfade** (cl100k_base, SKILL + Craft-Guide + Starter) gegen 14 200 Tokens vorher:
      Charakter **9 956** · Szene **8 123** · Item **6 802** · Icon **6 643**. `SKILL.md` allein
      8 828 → 2 914 (−67 %).
      Verifiziert: 0 ADR-Tokens, 0 tote `examples/`-Zeiger, kein entferntes Konstrukt wird gelehrt
      (nur als „gibt's nicht mehr"-Falle genannt); das Vorzeigerezept besteht sein eigenes Gate
      (`check --lint` `[]`, `critique --as item --strict` `pass:true`, `build` schreibt beide PNGs
      mit den dokumentierten Bytezahlen).
- [x] README-Neubau (D6) mit gerenderten Beispielgrafiken (`fdd70c4`, `bd9115a`, `b1a5034`, `7d86104`).
      Auszüge werden zeilenweise gegen ihre Quelldatei bewiesen (`excerpt-of:`-Marker), vollständige
      Blöcke gegen `check` — beides per Drift-Injektion gegengeprüft.

### W3-4b — C009: zwei Defekte, drei Runden `[x]`

C009 feuerte auf praktisch jede Icon-Familie — die Hintertür, die Audit-Befund #3 anprangert. Es
steckten **zwei unabhängige Defekte** dahinter, beide gefunden, indem der Starter geprüft wurde, den
der Skill jedem Agenten zum Kopieren gibt, statt nur der Beispiel-Korpus:

- [x] **Platten-Blindheit** (`9067e93`, `9d88267`). C009 signiert die volle Deckungsmaske; bei einer
      undurchsichtigen Icon-Platte *ist* die Maske die Platte. Fix: Platte per Pixel-Evidenz erkennen
      und vor dem Signieren abziehen. Runde 1 war nur gegen die Gradienten-Platten in
      `examples/icons/` kalibriert und scheiterte am Starter, der den *anderen* kanonischen
      Licht-Kontrakt benutzt (Flachfüllung + 2px-Kantenband über `face.edge(1:1, 2)`). Gemessen an
      dessen gerendertem `mail`: Band→Innenfläche 0,1298, Innenfläche→Glyphe 0,4041 — Faktor 3
      Abstand. `PLATE_STEP_TOLERANCE` 0,06 → 0,13, im verifizierten Fenster [0,125; 0,15).
- [x] **Cross-Size-Vergleich** (`7b1c3e2`). `silhouetteSignature` ist konstruktionsbedingt
      *skaleninvariant* (Box-Resampling auf ein festes 32×32-Raster). Eine korrekt gebaute
      Größenleiter — der 16px-Handnachbau neben seinem 32/64px-Master, genau was `icon-craft.md`
      vorschreibt — signiert dann zwangsläufig gleich. Der Vergleich über Canvas-Größen hinweg war
      also ein Kategorienfehler: **15 von 23** verbliebenen Befunden waren Cross-Size-Paare mit
      bedeutungsloser Distanz. Fix: die `nearest`-Suche vergleicht nur noch Geschwister gleicher
      `sprite.w`×`sprite.h` — strukturell, ohne Namenssuffix-Liste. Die vier gleichgroßen Befunde
      (`chat16`/`phone16` 0 · `map`/`dice` 0,0813 · `video`/`gallery` 0,075 · `calculator`/`clock`
      0,0851) sind echte Craft-Signale und bleiben stehen.
- **Die Ausnahme im Done-Gate bleibt** — anders als vor der Messung geplant. `items-v2` kollabiert
      legitim bei gleicher Canvas-Größe (potions 4, shields 4, armor 3, swords 2): ein Rundschild,
      ein Buckler und eine Magiebarriere *teilen* nun mal eine kreisrunde Silhouette. Entfernt wurde
      nur die icon-spezifische Lehre, die ausschließlich *wegen* der Defekte stimmte („erwarte
      Distanz 0 zwischen jedem Paar") und „Größenvariante" als Rechtfertigung, die es nicht mehr
      geben kann. C011 wurde auf denselben Kategorienfehler geprüft und **nicht** geändert: feuert
      korpusweit null Mal, schlechteste Cross-Size-Ratio 5,52× unter dem 6×-Gate.

### W3-4c — Back-View-Prop-Spiegelung `[x]`
- [x] Starter (`615be5a`) und beide Flaggschiff-Charaktere (`761347d`) hielten ihr Prop in Front-
      *und* Back-View auf der Betrachter-Linken — eine um 180° gedrehte Figur, die heimlich die Hand
      wechselt. `bodyBack` hatte den `grip`-Pin von `bodyFront` wörtlich übernommen (knight `6:52`
      → `42:52`), der Magier fittete den Stab an `gripL`, obwohl das Rezept `gripR` bereitstellt.
      Archer (Bogen im Rücken-Sling) und Assassin (symmetrisches Dolchpaar mit `flipx`) sind korrekt.
      `character-craft.md` nannte die Regel nur in der Skeleton-Fassung („swap which pin it fits
      to"), was einen monolithischen Body-Part nicht abdeckt — Pin-Koordinaten-Fall mit Zahlen ergänzt.
      README-Hero neu gerendert.
- **Verworfen: automatische Spiegel-Paritäts-Prüfung.** Idee war, den horizontalen Tinten-Schwerpunkt
      von Front- und Back-View zu vergleichen (gegenläufige Vorzeichen = korrekt gespiegelt).
      Gemessen an genau den Fällen, die sie fangen müsste: Magier ja (−1,06/−1,37), **Ritter nein**
      (−0,13/−0,13 — das dünne Schwert verschwindet gegen den symmetrischen Umhang), Archer
      Fehlalarm (0,89/0,73, konstruktionsbedingt asymmetrisch). Einer von zwei echten Fällen bei
      einem Fehlalarm ist kein Test. Diese Defektklasse bleibt Sache des Auges — siehe W3-5.

### Bewusst NICHT im 1.0 — mit Begründung

- **`small` (5×7) kann keine Unterlängen.** `p`/`q`/`y`/`g` sind eine Zeile höher gezeichnet als die
  x-Höhen-Buchstaben und benutzen Zeile 6–7 als Pseudo-Unterlänge, weil unter der Grundlinie in einer
  7-Zeilen-Zelle kein Platz ist. Sichtbarer Effekt: sie lesen als Versalien — `sheet` beschriftet
  „map" als „maP", „trophy" als „troPhy". `micro` (3×5) ist ein echter Versalfont und in Ordnung.
  **Nicht angefasst**, weil jede Korrektur gerenderten Output ändert und der eigentliche Fix neue
  Metriken braucht (x-Höhe 4 + echte Unterlänge → eine 5×8-Zelle, also ein *neuer* Font neben
  `small`, kein Umbau von `small`). Umgangen wurde es nur im README-Hero: dort steht jetzt die
  `productivity`-Familie, deren Namen keine Unterlängen-Buchstaben enthalten.

### W3-5 — Blind-Verifikation `[~]`

Drei frische Agenten, die **nur** `skills/drawstic/**` lesen durften (kein `docs/`, kein `examples/`,
kein `src/`), in Scratch-Verzeichnissen, mit dem Auftrag, den Skill zu prüfen statt zu loben. Einer
bewusst auf einem schwachen Modell, weil ein Skill, der nur mit dem stärksten Modell funktioniert,
nicht gut genug ist.

- [x] **Icon-Familie (schwaches Modell)** — acht Wetter-Icons, alle vier Done-Bedingungen grün, kein
      einziger Fehler unterwegs. Formal tadellos, inhaltlich nicht: die „Sonne" ist ein Achteck mit
      vier Balken bis an den Plattenrand und liest als Blenden-/Rettungsring-Symbol. Der Agent setzte
      seinen eigenen Fehllese-Test darauf auf „✅ clearly = sun" und behauptete zusätzlich 2px Rand
      für alle Glyphen, den die Strahlen sichtbar verletzen.
- [x] **Szene** — Dämmerungshafen, alle vier Bedingungen grün, Tiefe und Lichtstimmung überzeugend.
      Auch hier ein geschönter Bericht: das große Boot habe „a cabin and mast" — einen Mast gibt es
      nicht, und der Rumpf liest als Schote, nicht als Kutter (das hat der Agent immerhin selbst
      relativiert).
- [ ] **Charakter** — läuft.

**Verifizierte Befunde** (jeder selbst nachgestellt, nicht aus dem Bericht übernommen):

| # | Befund | Status |
|---|---|---|
| 1 | `--silhouette` liefert bei jedem Icon auf undurchsichtiger Platte ein schwarzes Quadrat — der Fehllese-Test, den `icon-craft.md` für genau diese Kategorie vorschreibt, ist dort prinzipiell blind. Beim Charakter liefert dasselbe Kommando ein brauchbares Bild. | delegiert |
| 2 | `drawstic help` listet vier akzeptierte Flags nicht, darunter `--lint` — Bedingung 1 des Done-Gates. Die `E026`-Meldung schickt einen ausdrücklich zu `help`, wo die Antwort fehlt. | delegiert |
| 3 | Die ältesten Kernfehler tragen **gar keinen `hint`** (E006, E007, E011), die diesen Release neu gebauten (E024, E026) präzise. `E011 missing argument` nennt weder Kommando noch Argumentplatz — genau der Fehler, vor dem `character-craft.md` als „confusing … far from the real cause" warnt. | delegiert |
| 4 | **`outline`-Widerspruch aufgelöst.** SKILL.md führt es als Schritt 6 mit „do not invent a different order", der ausgelieferte Szenen-Starter enthält null `outline`-Aufrufe. Gemessen: auf einer randlos gefüllten Szene ist `outline` ein **No-op** (byte-identisches PNG), weil es gegen Transparenz umrandet. Keine Seite ist falsch — SKILL.md nennt die Bedingung nicht. | offen |
| 5 | Ein `material` ist keine Farbe: `material m = #8a5a3c cloth` und dann `m.alpha(30%)` → `E006`. Der Szenen-Builder tappte **zweimal hintereinander** hinein. Nirgends dokumentiert. | offen (Teil von #3) |
| 6 | `drawing.region` liegt im **eigenen** Raum des Parts, nicht dort, wo `fit` ihn gesetzt hat — nachgestellt: der Overlay landet im Ursprung, der Part woanders. Die Doku sagt nur „any drawing's silhouette", nicht in welchem Raum. Deshalb musste der Builder die Verschiebung von Hand ausrechnen. | offen |
| 7 | Kein Wort zu schwimmenden Objekten: „boat", „float", „moor" kommen in `scene-craft.md` nicht vor; `ground` ist nur für festen Boden dokumentiert. Reflexion und Wasserlinien-Kontakt musste der Builder per Analogie selbst herleiten. | offen |
| 8 | Die Reserved-Word-Liste ist eine flache Wortwolke ohne Kategorien — `rim` ist das natürlichste Wort für eine Bootskante, und der Builder kollidierte damit, **obwohl er die Liste gelesen hatte**. | offen (Teil von #3) |

**Durchgehendes Muster, in zwei unabhängigen Läufen bestätigt:** Ein sauberes Gate plus die
Selbstauskunft des Modells ist **kein** Craft-Nachweis. Beide Agenten beantworteten „schau es dir an"
-Rubrikpunkte großzügig zu ihren Gunsten. Konsequenz: den Fehllese-Test von einer **Urteilsfrage**
(„liest das richtig?") auf eine **Erzeugungsfrage** umstellen („nenne die zwei wahrscheinlichsten
Fehldeutungen, bevor du den Namen liest") — ein Ja/Nein lässt sich schönreden, eine erzwungene
Aufzählung nicht.

### W3-6 — Release scharf schalten
- Der Workflow ist bereits tag-getrieben und vollständig (`NODE_AUTH_TOKEN`, `--provenance`,
  npm-pack-Smoke-Test unter Node). `package.json` bleibt auf `0.0.0`; die Version stempelt der
  Workflow aus dem Tag. Es bleibt: `feature/exp` → `develop` → `main`, dann `v1.0.0` taggen und
  pushen — beides ausdrücklich Sache des Nutzers.
