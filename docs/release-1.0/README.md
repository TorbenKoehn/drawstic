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

### W3-1 — Aufräumen ohne Sprachbruch (parallel)
- [ ] **A** Design-Entscheid Roh-Shading-Quartett + `tileset`/`atlas`-Merge-Form (Probe-Renders).
- [ ] **B** Packaging/CI: `NODE_AUTH_TOKEN`, `--provenance`, `npm pack`-Smoke-Test unter Node.
- [ ] **C** ADR-Index-Korrekturen + AGENTS.md-Doks-Index.
- [ ] **E** Korpus-Konsolidierung (D3) inkl. Test-/Doc-Referenzen.

### W3-2 — Sprach-Freeze (sequenziell, Kern-Dateien)
- [ ] Entfernungen (D1) + `fit anchor`-Fehler + `pin`-Transform-Bug + `mix`-Enum-Fix.
- [ ] Umbenennungen (D1) über Parser/Eval/Lint/Spec/Skill/Beispiele.
- [ ] `tileset`/`atlas`-Merge + Builtin-Reservierung vereinheitlichen + Export-Pfad-Konvention (D7).
- [ ] Roh-Shading-Quartett nach Entscheid A.

### W3-3 — Beispiele auf den kanonischen Pfad
- [ ] `scenes-v3` (221 Roh-Shading-Aufrufe), `icons`, `items-v2` auf `light`/`material`/`model`.
- [ ] Spec-Grammatik-Sync (pin/fit, behind/front, quantize, organische Konstruktoren, CLI-Tabelle).

### W3-4 — Product-Skill + README
- [ ] Skill-Neubau (D5) mit `starters/*.drw`, XML-Sektionen, Verifikations-Algorithmus, Done-Gate.
- [ ] README-Neubau (D6) mit gerenderten Beispielgrafiken.

### W3-5 — Verifikation
- [ ] 3 Blind-Builds (Charakter / Icon-Familie / Szene) durch frische Agenten gegen den neuen Skill.
- [ ] Befunde daraus fixen; danach Version stampfen und Release-Workflow scharf schalten.
