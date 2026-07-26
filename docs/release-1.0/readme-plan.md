# README-Plan (D6)

Zwei Leser, ein Dokument. Der Mensch scrollt und will in 10 Sekunden wissen, was das Ding tut —
mit Bildern. Das LLM liest linear und will in 20 Zeilen wissen, wie es das Ding benutzt.
Reihenfolge daher: **Bild zuerst, Rezept daneben, Pfad danach, Referenz zuletzt.**

## Aufbau

1. **Titel + ein Satz.** „Deterministische Grafik aus Text-Rezepten: dasselbe Rezept ergibt überall
   pixelgleiche PNG/SVG/JPEG." Darunter Badges (CI, npm, Lizenz).
2. **Hero-Zeile: drei gerenderte Beispiele nebeneinander** (Charakter-Sheet, Icon-Familie, Szene),
   je @4 skaliert. Ein Bild pro Kategorie, damit der Umfang sofort sichtbar ist.
3. **„Wie das aussieht" — 3 Blöcke Syntax ↔ Ergebnis.** Je Block: 6–12 Zeilen Rezept links (Codeblock),
   das gerenderte PNG rechts/darunter. Die Rezepte müssen **wörtlich lauffähig** sein (aus dem
   Beispielkorpus kopiert, nicht erfunden) und die Bilder aus genau diesen Rezepten stammen.
   - Block A: eine Form mit Licht + Material (`light` → `material` → `model`) → zeigt Shading.
   - Block B: eine modulare Figur (`pin`/`fit` + `skeleton`/`pose`) → zeigt Komposition.
   - Block C: eine Icon-Familie mit `export` → zeigt Wiederholbarkeit + Artefakte.
4. **Installation** (`npm i -D drawstic`, `bunx drawstic help`) und **Quickstart in 5 Zeilen**.
5. **`<!-- for LLM agents -->`-Abschnitt**: der kanonische Pfad als nummerierte Liste, der
   Verifikations-Loop als Befehlsfolge, und der Zeiger auf den ausgelieferten Skill
   (`node_modules/drawstic/skills/drawstic/SKILL.md`). Genau das, was ein Agent braucht, um ohne
   weiteres Raten anzufangen.
6. **CLI-Tabelle** — vollständig (inkl. `critique`, `sheet`, `help`, `version`), gegen `cli.ts`
   generiert/geprüft, keine veralteten Flags.
7. **Bibliotheks-Nutzung** (Subpath-Exports) — kurz, mit einem lauffähigen Snippet.
8. **Determinismus-Versprechen** (warum das Projekt existiert), Links: Sprach-Spec, ADRs, Beispiele.

## Regeln

- **Bilder liegen im Repo** (`docs/images/*.png`, aus dem Beispielkorpus gebaut) und werden über
  **absolute `raw.githubusercontent.com`-URLs** eingebunden — relative Pfade rendern auf npmjs.com
  nicht.
- Jedes Codebeispiel ist `check`-sauber; jedes Bild wird von genau dem gezeigten Rezept erzeugt.
  Ein Test hält das nach (README-Snippets extrahieren → `check`).
- Keine Behauptung ohne Deckung: keine Flags, die es nicht gibt, keine Kategorien ohne Beispiel.
- Erst schreiben, wenn der Sprach-Freeze (ADR-0096) und die Beispiel-Umschrift durch sind — sonst
  zeigt die README veraltete Syntax.
