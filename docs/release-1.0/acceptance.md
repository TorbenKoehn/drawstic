# Abnahme (W3-5) — drei Blind-Läufe gegen den neuen Skill

Der Skill ist erst fertig, wenn ein **frischer Agent ohne Vorwissen** damit auf Anhieb etwas
Brauchbares baut. Prosa-Review reicht dafür nicht; die Anthropic-Skill-Leitlinie verlangt
Evaluationen *vor* dem Ausbau der Doku. Diese drei Szenarien sind die Regressionssuite des Skills.

## Szenarien

| # | Anfrage (wörtlich an den Builder) | Kategorie |
|---|---|---|
| 1 | „Zeichne mir einen 64×128 großen Ritter im Ragnarok-Online-Stil, drei Ansichten (vorne, Seite, hinten), auf einem Sheet." | character |
| 2 | „Bau mir eine Icon-Familie: 8 Icons für eine Einstellungs-App, je 16 px und 32 px, PNG und SVG." | icon |
| 3 | „Eine kleine Hafenszene in der Dämmerung, 192×128." | scene |

Je Szenario **ein frischer Agent** (kein Kontext aus dieser Session), der ausschließlich
`skills/drawstic/` lesen darf — nicht `docs/`, nicht `src/`, nicht die bestehenden Beispiele außer
über den Skill selbst. Mindestens einer der drei Läufe mit einem **schwachen Modell** (Haiku), weil
der Skill für den schwächsten plausiblen Leser funktionieren muss.

## Bestehenskriterien (alle vier, je Lauf)

1. **`check --lint --json` ist beim ersten Aufruf `[]`** — oder der Agent räumt es in einem Zyklus.
   Jeder Erstaufruf-Fehler wird protokolliert: er zeigt eine Lücke im Skill, nicht im Modell.
2. **`critique --as <cat> --strict` exit 0 und `pass:true`** binnen zwei Edit-Zyklen.
3. **`build --json` liefert eine nicht-leere `artifacts`-Liste** — der häufigste stille Ausfall
   („fertig" gemeldet, nichts geschrieben, weil kein `export`-Block existierte).
4. **Die `critique`-Rubrik ist beantwortet** — der Agent hat die vorgeschriebenen Renders ausgeführt
   und jede Frage mit einem Satz belegt.

Zusätzlich, nicht bestehensrelevant, aber protokolliert: Zensus-Anti-Pattern-Zähler (Ziel 0),
Anzahl der Render-/Edit-Runden bis zum Ziel, jede halluzinierte Syntax, jede Stelle, an der der Agent
den Skill verlassen hat (`reference.md` geöffnet, `src/` gelesen, geraten).

## Danach

- Jeder Erstaufruf-Fehler und jede Halluzination wird zu einer konkreten Skill-Änderung — Beispiel
  ergänzen, Falle an ihren Fehlercode hängen, Entscheidungsprozedur nachschärfen. Nicht zu einer
  Ermahnung im Fließtext.
- **Menschliche Benotung der drei Ergebnisse (x/10).** Die Session-Historie zeigt: Selbstnoten und
  `critique` korrelieren nicht mit Craft-Qualität (Selbstnoten ~1.6 gegen Human 2.4–5.5). Nur die
  menschliche Note entscheidet, ob der Release-Stand gut genug ist.
