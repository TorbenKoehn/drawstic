---
name: craft-eval
description: Runs a multi-agent OOTB craft evaluation for a Drawstic graphics category (TODO-<CAT>.md in repo root) — 7 blind builder agents, per-agent Evaluation report, consolidation report, fix wave, craft-guide distillation, skill routing. Use when executing any TODO-<category>.md or when the user asks for a "Evaluation report"-Lauf for a category (icons, characters, animation, portraits, items, tilesets, UI, scenes …).
---

# craft-eval — Multi-Agent-Kategorie-Evaluation

Bewährtes Vorgehen aus drei Szenen-Läufen (Evaluation report → Rerun → masterpiece, Ø 1,9 → 1,7 → 1,6).
Ziel jedes Laufs: (a) Meister-Artefakte der Kategorie in `examples/<cat>/`, (b) DX-findinge,
(c) ein Craft-Guide `skills/drawstic/<cat>-craft.md`, der die Qualität reproduzierbar macht.

## Phase 0 — Voraussetzungen

Lies das jeweilige `TODO-<CAT>.md` (Repo-Root). Steht dort Engine-/Skill-Vorarbeit (z. B. neuer
Export, neue Semantik): **zuerst** als eigene Welle umsetzen — Code-Agents parallel mit disjunkten
Datei-Zuständigkeiten (kein Git → Konflikte sind fatal), materielle Entscheidungen per ADR
(Skill `new-adr`), Produkt-Skill im selben Zug aktualisieren, `bun run test` grün.

## Phase 1 — 7 Builder-Agents (parallel, Hintergrund)

Modell-Mix fest: **1× fable, 3× opus, 3× sonnet** (Zuteilung steht im TODO). Prompt-Template —
Platzhalter {…} aus dem TODO füllen:

> Du bist ein LLM-Agent, der Drawstic zum ersten Mal out-of-the-box benutzt. Repo: aktueller Workspace.
> Deine EINZIGE Anleitung ist der Produkt-Skill skills/drawstic/ (SKILL.md, reference.md und die dort
> verlinkten Craft-Guides) — vollständig lesen. CLI: `bun run drawstic <cmd>` aus dem Repo-Root.
> WICHTIG: DU bist der Autor. Starte KEINE Sub-Agents, delegiere nichts.
> TABU (niemals lesen): docs/evaluation report-*, TODO*.md, docs/motif-cookbook.md, docs/dsl-examples.md,
> {BISHERIGE OUTPUTS DER KATEGORIE + NACHBAR-OUTPUTS DES LAUFS}. Ausweichen in src/ oder docs/ nur
> bei echter Blockade — und MUSS im Evaluation report als DX-finding (docs-Flucht) protokolliert werden.
> AUFGABE — DEIN MEISTERSTÜCK: {MOTIV + SPECS + GRÖSSEN aus TODO} nach {OUTPUT-PFAD}.
> Qualitätsanspruch: {KATEGORIE-QUALITÄTSKRITERIEN aus TODO}.
> WORKFLOW: wie SKILL.md (check → fmt → render → PNG per Read visuell prüfen → verfeinern), bis du
> wirklich stolz bist. Zähle ehrlich getrennt: (a) Voll-Renders nach Edits = Iterationen,
> (b) Debug-/Crop-/Fragment-Renders separat. Ende: `check --json` = `[]`, fmt-clean, Exporte lt. TODO.
> ZEUGNIS (deutsch, Schulnoten 1,0–6,0) nach {SCRATCHPAD}\evaluation report-<cat>\{name}.md:
> 1. head (Motiv, Modell, Maße, Zeilen, Iterationen Voll/Debug, Gesamtnote) ·
> 2. Notenspiegel (nur genutzte Systeme, sonst n/a): pixels+pal · Primitives · Gradients · stamp ·
>    shadow/castShadow · Texturen · Licht · Regions & Masks · Transforms (2D/3D) · path · Neue
>    Konstrukte · Kontrollfluss+rand/noise · Farbsystem · std-Module · Themes · Exporte/Sidecars ·
>    CLI check/render/fmt/context · Diagnostik — plus {KATEGORIE-ZUSATZZEILEN aus TODO} ·
> 3. Syntax-Bewertung (Schreibbarkeit, Intuitivität, Token-Ökonomie, Editierbarkeit,
>    Selbst-Verifizierbarkeit) · 4. findinge (nummeriert, E-/W-Codes, Iterationskosten, check-gefangen
>    vs. stumm) · 5. Highlights · 6. **Craft-Rückblick** (wichtigstes Kapitel): Welche
>    generalisierbaren Regeln/Rezepte/Checklisten müsste der Skill enthalten, damit ein Agent diese
>    Qualität zuverlässig beim ersten Anlauf erreicht?
> Antworte als Rohdaten: Maße, Zeilen, Iterationen, Note, Top-3-findinge, Top-3-Rückblick, Pfade.

Betriebs-Lektionen (alle drei schon passiert):
- **Sonnet-Agents delegieren gern trotz Verbot** → Ergebnis prüfen; bei Delegations-Meldung per
  SendMessage zurückschicken („DU bist der Autor, keine Sub-Agents, melde dich erst mit Artefakten").
- **API-Abbrüche (500)** → Agent per SendMessage an exakt der Stelle fortsetzen (Kontext bleibt).
- Nach Abschluss **selbst verify**: Verzeichnis-Listing (nur erwartete Artefakte, Debug-Reste
  löschen) + `check --json` über alle Recipes.

## Phase 2 — Konsolidierung (1 Opus-Agent)

Liest alle Einzel-Evaluation reportse + Vorgänger-Evaluation reportse → `docs/evaluation report-<cat>-dx-<datum>.md` in der
Struktur der Szenen-Evaluation reportse (headtabelle, Notenspiegel mit Ø, Syntax-Tabelle, Delta, konsolidierte
findinge nach Trefferhäufigkeit, Exzellenz-Konsens, Meta-findinge, priorisierte Maßnahmen,
Gesamturteil) + Abschnitt **„Rückblick-Synthese"** (deduplizierte Regeln mit Forderer-Zahl x/7).
Danach Indexzeile in AGENTS.md §5. Widersprüche zwischen Bewertern benennen, nie wegmitteln;
Iterationszahlen nie normalisieren (Fußnote statt Korrektur).

## Phase 3 — Fix-Welle

Priorisierte Maßnahmen aus dem Evaluation report umsetzen: **Code-Fixes zuerst** (parallel, disjunkte
Dateien), **docs/Skill danach** (ein Agent, kennt dann die neuen Signaturen).
**Verifikationspflicht:** keine Verhaltensaussage ohne Probe-Render im Scratchpad; widerlegte
Evaluation report-Behauptungen nicht dokumentieren, sondern als Abweichung melden. Abschluss: `bun run test`
grün + alle `examples/**/*.drw` check-clean.

## Phase 4 — Craft-Guide + Routing

1 Opus-Agent destilliert die Craft-Rückblicke (+ Lektüre der besten Artefakte) zu
`skills/drawstic/<cat>-craft.md` — Stil wie `scene-craft.md`: verbindliche Reihenfolgen,
Zahlen-Dosierungen, Copy-Paste-Idiome, Verifikations-Kadenz; alles Probe-verifiziert.
Dann Routing-Zeile in `skills/drawstic/SKILL.md` § „Craft routing" ergänzen und dort einen
kompakten Pflicht-Kern (wenige Zeilen) der Kategorie verankern. Produkt-Skill-Gesetz: präzise,
token-optimiert, nichts verwässern.

## Phase 5 — Abschluss

`bun run test` + Voll-Check aller Beispiele, TODO-<CAT>.md-DoD abhaken, Abschlussbericht
(Notentabelle, Deltas, Top-findinge, Artefakt-Pfade, Empfehlung nächster Schritt).
