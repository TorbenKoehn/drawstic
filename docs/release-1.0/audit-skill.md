# Audit — Product-Skill gegen Anthropics Prompting-/Skill-Leitfäden (2026-07-26)

Geprüft gegen die live abgerufenen Anthropic-Guides (`claude-prompting-best-practices` +
`agent-skills/best-practices`). Ziel-Anwendungsfall: ein beliebiger — auch schwacher — LLM-Agent
soll aus „zeichne einen 64×128-RO-Ritter, 3 Ansichten" **im ersten oder zweiten Versuch** ein
korrektes Rezept und ein gutes Sprite erzeugen. Der Skill ist das Einzige, was er liest.

Aktuelle Ladekosten: SKILL.md ≈7,3k Tokens · character-craft ≈6,9k · reference ≈17,7k →
**14,2k Tokens, bevor die erste Rezeptzeile steht.**

## Befunde

1. **Struktur ist invertiert.** Die Routing-Tabelle (welchen Craft-Guide laden?) steht bei
   `SKILL.md:249-259` — nach 250 Zeilen. Ein Modell, das oben anfängt, schreibt ab `:102` Rezepte
   und erreicht die Tabelle nie. Zusätzlich wiederholen `SKILL.md:261-336` in 76 Zeilen den §1 der
   vier Craft-Guides, auf die sie verweisen.
2. **Kein einziges vollständiges Beispiel.** In `SKILL.md` kommt `export` nur in Prosa vor —
   das Flaggschiff-Rezept (`:108-119`) hat keinen Export-Block, obwohl Workflow-Schritt 7 `build`
   ist. Live nachgestellt: dasselbe Rezept liefert `W002 drawing 'sword' is neither exported,
   stamped, nor fitted` und `C002 edge-clip … pass:false`. **Das Vorzeigebeispiel fällt durch das
   eigene Gate.**
3. **Das Done-Gate enthält seine eigene Hintertür**: „*oder jede verbleibende `warning` bewusst
   akzeptiert*" (`:97-99`). Ein schwaches Modell nimmt immer die Klammer.
4. **Verifikation ist beschrieben, nicht spezifiziert.** Schritt 5 ist ein 9-Punkte-Menü ohne
   Default und ohne Reihenfolge; `--ascii` (das billigste) ist laut Skill selbst für Silhouetten
   unbrauchbar. Dabei liefert `critique --json` bereits ein `rubric.renders`-Array mit wörtlichen
   Befehlen — der Skill erwähnt das einmal beiläufig.
5. **Tote Zeiger im ausgelieferten Paket:** 7 Verweise auf `examples/…` und **69 `ADR-####`-Tokens**
   — `examples/` und `docs/` sind laut `package.json.files` nicht im npm-Paket.
6. **`reference.md` (948 Zeilen) hat kein Inhaltsverzeichnis**; ein `head -100` zeigt nur die
   CLI-Tabelle. Die `critique`-Zeile ist eine einzelne Tabellenzelle mit ~1900 Wörtern.
7. **Optionen ohne Default** (Guide: „gib einen Default mit Notausgang"): 9 Render-Modi,
   „pick one per family" bei Icons, zwei Export-Varianten bei Items.
8. Fünf Namen für einen Begriff („canonical path" / „the one canonical path" / „fixed build order" /
   „Canonical order" / „mandatory order").
9. Negative ohne Positiv (`:91` „`pass:true` ist notwendig, **nicht** hinreichend"), Historie inline
   („`lit L:` wurde entfernt — ADR-0094") statt in einem `<details>`-Block.
10. Frontmatter in erster Person („Use this skill when…") statt dritter; ~440 von 1024 erlaubten
    Zeichen genutzt, Trigger-Wörter wie „spritesheet", „chibi", „favicon", „.drw" fehlen.

## Top-Fehlermodi eines schwachen Modells (mit auslösendem Skill-Defekt)

| # | Fehler | Defekt |
|---|---|---|
| 1 | `build` schreibt nichts, Modell meldet Erfolg | kein `export` in irgendeinem Beispiel |
| 2 | Craft-Guide wird nie geöffnet | Routing 250 Zeilen zu spät |
| 3 | Sprite wird ausgeliefert, ohne es je gesehen zu haben | 9-Optionen-Menü ohne Default |
| 4 | „fertig" bei grünem Exit-Code trotz `pass:false` | `pass` ≠ Exit-Code in dichter Prosa erklärt |
| 5 | `stroke` auf 2px-Klinge füllt die ganze Region | Regel als Gotcha #7 auf Zeile 353 |
| 6 | `poly … w2` → `E001` | Gotcha weit weg vom Primitiv |
| 7 | fehlendes/doppeltes `light` → `E024` | Pflicht steht im Schwanz eines 15-Zeilen-Bullets |
| 8 | Turns verschwendet mit `examples/…` lesen | 7 tote Zeiger |
| 9 | Handshading mit `shadeRegion`/Ton-Patch → W012/W013 | Floor wird vor dem kanonischen Pfad eingeführt |
| 10 | `bunx` im npm-Projekt | „Runner erkennen" gefolgt von 60 hartkodierten `bunx`-Zeilen |

## Vorgeschlagene Zielstruktur

```
skills/drawstic/
├── SKILL.md            ~190 Z   Routing → Workflow → EIN vollständiges Rezept → Done-Gate
├── walkthrough.md      ~170 Z   ein kompletter Lauf Anfrage→Artefakt + 3 kurze Paare
├── language.md         ~300 Z   kanonische Sprachfläche + Fallen, je an ihren Fehlercode geknüpft
├── verify.md           ~120 Z   die Schleife als Algorithmus + Code→Fix-Tabelle
├── craft-character.md  ~300 Z   (Scaffolds wandern nach starters/)
├── craft-scene.md      ~200 Z
├── craft-icon.md       ~180 Z
├── craft-item.md       ~230 Z
├── reference.md        ~980 Z   + Inhaltsverzeichnis, aufgebrochene CLI-Sektion
└── starters/           lauffähige, `check`-saubere Rezepte (kosten erst beim Lesen Tokens)
    ├── character-3view.drw · head-archetypes.drw · icon-family.drw
    ├── item-set.drw · scene-layers.drw
```

Ladepfad für „RO-Ritter, 3 Ansichten": SKILL (2,6k) + craft-character (4,0k) + Starter (2,4k)
≈ **9k statt 14,2k** — und mit einem lauffähigen, verifizierten Startpunkt statt Prosa.

Pflichtelemente des Neubaus: `<start_here>`-Block als erster Inhalt · Verifikations-Algorithmus mit
explizitem if/then und „nicht weitermachen, bis grün" · Done-Gate mit vier Bedingungen ohne
Hintertür · jedes Beispiel in `<example>`-Tags und aus einem **echten Lauf** kopiert · null
ADR-Tokens, null `examples/`-Zeiger · ein Begriff je Konzept · Frontmatter in dritter Person mit
Trigger-dichtem `description`.

**Abnahme (Guide S19):** drei Blind-Läufe mit einem schwachen Modell — „64×128-RO-Ritter, 3 Views",
„8-Icon-Familie, 16+32px, PNG+SVG", „kleine Hafenszene in der Dämmerung" — mit den Kriterien:
`check` beim ersten Aufruf sauber, `critique --strict` binnen zwei Edit-Zyklen grün, `build`-Artefakte
nicht leer, Rubrik beantwortet.
