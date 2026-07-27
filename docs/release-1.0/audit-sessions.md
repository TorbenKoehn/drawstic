# Audit — Session-Forensik (2026-07-26)

Korpus: 180 JSONL-Transkripte (~120 MB) unter `C:\Users\tkoeh\.claude\projects\c--Projekte-drawstic\`,
normalisiert auf 30 300 Records (12 676 Tool-Calls, 42 echte Human-Nachrichten). **81 Transkripte
schreiben `.drw`**, davon **36 reine Out-of-the-box-Builder** (craft-eval-Wellen).

## Kennzahl, an der alles hängt

**915 Recipe-Edits · 709 `render`-Aufrufe · 503 `check`/`fmt`/`critique`-Aufrufe · 22 harte `E0xx`.**
Nur ~2,4 % der Iterationsschleife ist compilergetrieben; der Rest ist ein Agent, der ein PNG anstarrt
(655 Bild-Reads in den 36 Buildern ≈ 18 Renders pro Artefakt). Nur 4 von 36 Buildern haben je in
`src/` geschaut — die Sprache ist syntaktisch ausreichend erklärt, es fehlt das **Craft-Signal**.

## Rangliste der Defekt-Muster

| # | Muster | Menge | Beleg | Fix-Ebene |
|---|---|---|---|---|
| 1 | Blinde visuelle Retry-Schleife (bis 49 Edits pro Rezept, 16 Edits am Stück ohne Render) | 915/709/22 | weather.drw ×49, assassin.drw ×46 | engine + critique |
| 2 | `check` grün, Bild falsch („stumme" Fehler) | 38 Transkripte | „Alle teuren Fehler waren semantisch stumm (`check` = `[]`)" | critique |
| 3 | `critique` besteht, Human benotet 2.4–5.5 | 4/4 Charaktere | „Builder-Selbstnoten Schnitt ~1.63 … Human-Review 2.4/3.6/4.6/5.5" | critique |
| 4 | Metrik-Gaming: blindes Zahlen-Nudging | **103 von 754 Edits = 13,7 %** | `litTone(warm, 45%)` → `26%` → `48%` → `30%` → `44%`; „C004 kostete 4 von 6 Renderbatches" | critique + skill |
| 5 | Shading liest falsch (Ridge/Banding/Rauschen) | 4 Human-Beschwerden | „wie eine Toblerone von oben"; „als hätten sie ein Rauschen drin" | engine — **gefixt** (`c34d432`) |
| 6 | Sechs koexistierende Shading-Pfade | `model` 117, `cel` 121, `rim` 86, `shadeRegion` 59, `lightRegion` 50, `ao` 26 | Skill lehrt alle sechs | D2 |
| 7 | Hand-Ton-Rampen schlagen den Helfer **377:1** | `.darken` 253 + `.lighten` 124 vs. `litTone` 1 | `fn shd(c) = c.darken(10%).mix(cool,20%)` in 6 Dateien neu erfunden | engine + skill |
| 8 | Vier Platzierungs-Idiome | `stamp` 548 (235 mit Literal-Punkt) vs. `fit` 162 | „Oracle als fit-Ziel ging nicht — Anker `32:43` von Hand gerechnet" | D1 |
| 9 | Nähte/schwebende Teile trotz Bbox-Überlappung | 55 Transkripte, W010 15× | „Faust↔Hammerschaft ohne echten Pixelkontakt trotz Bbox-Überlappung" | Schwellen offen |
| 10 | `E024`: Modul-`light` erreicht gestampte Parts nicht, nur Theme-Licht | 19 Treffer / 12 Transkripte | „Erster First-Run-Trap" | engine oder Doku |
| 11 | Palette-Key `w`/`h` kollidiert mit Canvas-Größe | E007 35× / 26 Transkripte | „4/6 Agenten trotz dokumentierter Gotcha" | teilweise gefixt |
| 12 | `W004 --fit`-Nörgelei feuert auf jeder echten Zeichnung | **90 Emissionen** — häufigste Diagnose überhaupt | universell ignoriert | lint |
| 13 | `--ascii` kann Farbarbeit nicht verifizieren | 9 Transkripte | „invertierte Rampe, für dunkle Szenen unbrauchbar" | skill |
| 14 | Prop-Orientierung pro View falsch | 5 + Human | „Schwert bei Back komplett verkehrt herum" | **gefixt** (aim/behind/front, C013) |
| 15 | `radial(c, transparent)` → Zwiebelringe | 8 Transkripte | „harter Bayer-Dither bei kleinem radial-Radius" | engine oder lint |
| 16 | Region akkumuliert nicht in `for` (still) | 4 | „8 Zahnrad-Zähne still verworfen" | **gefixt** (ADR-0081) |
| 17 | `curvePoly` baucht aus, <12px unbrauchbar | 11 | „überlappende curvePolys = Matsch" | engine oder Doku |
| 18 | Theme-`size` gilt still für header-lose Draws | 2 | „16/64-px-Icons rendern als Tile in der Ecke einer 32er-Leinwand, `check`=`[]`" | lint |
| 19 | Hand-Ellipsen-Kontaktschatten statt Konstrukt | 15 Transkripte | bewusst gewählt, weil die Doku vor Silhouetten-Verklumpung warnte | engine |
| 20 | Drei `shadow`-Oberflächen | — | „die einzige Stelle, wo Argumentreihenfolge geraten wurde" | D1 |
| 21 | Jede Szene baute die Noise-Spaltenschleife von Hand + Frequenzfalle | 7/7 | — | **gefixt** (`profile`) |

## Halluzinierte Syntax (was Agenten erfanden)

| Erfunden | Menge | Diagnose |
|---|---|---|
| `use themes` statt `use std/themes` | 806 vs. 359 Vorkommen | E008 |
| `path …` im `draw`-Body | **5 von 6** Szenen-Buildern | E004 |
| `fn …` im `draw`-Body | 3 | E004 |
| Punkt-Größenheader `draw arm 9:20:` | 4 | E004 |
| Mehrbuchstabiger Palette-Key (`skin`, `w2`) | `unknown name 'w2'` 102× | E001/E007 |
| Farb-/Konstantenbindung im `theme`-Body | 2 | E004 |
| Nicht-literale `render`-Argumente | 6 | E004 |
| `ring(...)` als Primitiv | 3 | E001 |
| `by` als Bezeichner | 1 | E004 **zeigt auf `=`** (irreführend) |
| `g = g.union(...)`-Akkumulator in `for` | 4 | *keine* — still |
| Modul-`light` erreicht gestampte Parts | 12 | E024 |
| `shadeRegion`-`amount` = Deckkraft (statt Distanzskalar) | **7/7 Szenen** | *keine* — still; „kein Doku-, sondern ein API-Design-Problem" |

## Noch offen (gegen aktuellen `src/` gegengeprüft)

1. **Kein Craft-Signal** (#1–#4) — `critique` misst Struktur, nicht Korrektheit; C004 ist die
   meistgezählte (891 Nennungen) und direkt gamebare Metrik → D4.
2. Sechs Shading-Verben / vier Platzierungs-Idiome leben in `BUILTIN_NAMES` **und** im Skill → D1/D2.
3. `litTone`/`shadowTone` sind zweitklassig (bewusst nicht in `BUILTIN_NAMES`), 1 Nutzung gegen 377
   Hand-Aufrufe.
4. `fit … anchor` wird still verworfen · `pin HEAD.KEY` ignoriert die Stamp-Transform (flipx) ·
   degenerierte Ellipsenachse rendert · `material` im Theme-Body wird still verworfen.
5. W004 nörgelt auf jeder Szenen-Leinwand · Farbverifikation braucht weiterhin PNG + Bild-Read.
