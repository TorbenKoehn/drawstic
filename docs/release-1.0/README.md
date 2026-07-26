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

### W3-4b — C009-Plate-Blindheit
- [~] C009 silhouettiert die volle Deckungsmaske; bei einer undurchsichtigen Icon-Platte *ist* die
      Maske die Platte, also kollabieren alle Geschwister auf Distanz 0 — obwohl `icon-craft.md`
      die gemeinsame Platte vorschreibt. Der Quellkommentar dokumentiert den Defekt und den Fix
      (Platte vor dem Signieren abziehen). Solange er offen ist, trägt das Done-Gate eine
      C009-Ausnahme — genau die Hintertür, die Audit-Befund #3 anprangert. Nach dem Fix: Ausnahme
      aus `SKILL.md`/`verify.md` entfernen.

### Bewusst NICHT im 1.0 — mit Begründung

- **`small` (5×7) kann keine Unterlängen.** `p`/`q`/`y`/`g` sind eine Zeile höher gezeichnet als die
  x-Höhen-Buchstaben und benutzen Zeile 6–7 als Pseudo-Unterlänge, weil unter der Grundlinie in einer
  7-Zeilen-Zelle kein Platz ist. Sichtbarer Effekt: sie lesen als Versalien — `sheet` beschriftet
  „map" als „maP", „trophy" als „troPhy". `micro` (3×5) ist ein echter Versalfont und in Ordnung.
  **Nicht angefasst**, weil jede Korrektur gerenderten Output ändert und der eigentliche Fix neue
  Metriken braucht (x-Höhe 4 + echte Unterlänge → eine 5×8-Zelle, also ein *neuer* Font neben
  `small`, kein Umbau von `small`). Umgangen wurde es nur im README-Hero: dort steht jetzt die
  `productivity`-Familie, deren Namen keine Unterlängen-Buchstaben enthalten.

### W3-5 — Verifikation
- [ ] 3 Blind-Builds (Charakter / Icon-Familie / Szene) durch frische Agenten gegen den neuen Skill.
- [ ] Befunde daraus fixen; danach Version stampfen und Release-Workflow scharf schalten.
