# Audit — Korpus-Nutzung (2026-07-26)

68 Rezepte, 14 434 Zeilen (64 × `examples/**/*.drw` + 4 × `src/std/*.drw.ts`), kommentarbereinigt
gezählt. Die Zahlen sind die empirische Antwort darauf, welche Sprachfläche wirklich trägt.

## Was tatsächlich benutzt wird (Top)

`fill` 2283 · `line` 807 · `draw` 609 · `stamp` 541 · `px` 397 · `export` 249 · `pixels` 244 ·
`pin` 210 · `mask` 154 · `fit` 152 · `stroke` 121 · `curve` 118 · `cel` 112 · `model` 111 ·
`shadow` 89 · `curvePoly` 83 · `rim` 64 · `shadeRegion` 57 · `outline` 56 · `lightRegion` 49 ·
`tint` 48 · `profile` 35 · `ambientOcclusion` 26 · `castShadow` 21.
Regionen: `rect` 1025 · `poly` 586 · `circle` 557 · `ellipse` 297 · `intersect` 274 · `rrect` 191 ·
`union` 155 · `lobe` 27 · `ribbon`(`band`) 15 · `dome` 11 · `crescent` 9 · `xor` 2.

## Tote Fläche

- **Statements:** `import` 0 · `filter` 1 · `apply` 1 · `desc` 1.
- **Builtins:** `rgb`, `hsl`, `grayscale`, `min`, `sqrt`, `hypot`, `ceil`, `atan2`, `log`,
  `matrix`, `rotatex`, `quantize` — je 0. 17 von 26 Mathe-Builtins werden ≤2× benutzt.
- **Flags:** `clip`, `blend`, `dose`, `steps`, `order`, `puff`, `ao`, `tracking`, `lineheight`,
  `via` — je 0. 4 von 9 `anchor`-Werten ungenutzt.
- **Reservierte Wörter:** `rel`, `false`, `true` — je 0.
- Grob **40 von ~180 dokumentierten Namen sind tot**, weitere ~25 erscheinen ≤2× in einer Datei.

## Wiederkehrende Hand-Muster (die sprachförmigen Löcher)

| Muster | Menge | Beispiel |
|---|---|---|
| Drei-Ton-Helfer pro Datei neu erfunden (`fn lit/shd/deep`) | 6 Dateien, **113 Aufrufstellen** | `fn shd(c) = c.darken(10%).mix(cool, 20%)` — byte-identisch in archer/mage, abweichend in 4 weiteren |
| „Heller Streifen links / dunkler rechts" per `.intersect(rect())` | **233 Stellen** | `fill h.alpha(28%) shell.intersect(rect(18:6, 30:54))` — Splitkoordinate jedes Mal von Hand |
| `shadeRegion`+`lightRegion`+`stroke`-Tripel copy-paste | 22 Dateien | `icons/games.drw:47-50`, byte-identisch 5× in derselben Datei |
| `rim +1` / `rim −1` als Bevel-Paar | 3× je Datei | `icons/productivity.drw:31-47` mit fixen 50 %/35 %-Konstanten |
| Hand-gespiegelte L/R-Paare | **58 Bindungen** vs. 9 `mirror`-Blöcke | `characters-ro2/knight.drw:145-216` — `bodyFront`/`bodyBack` sind derselbe 25-Zeilen-Block |
| Noise-Horizont-Funktion neu abgeleitet | 11 Stück in 8 Dateien | `fn ridgeY(nx) = 36 + round(noise(5, nx*6, 0)*10)` |
| Kontaktschatten als Hand-Ellipse | **79 Stellen** | `fill cool.alpha(35%) ellipse(22:61, 12:2)` |
| Theme-Header pro Datei neu getippt | `light sun = dir 1:1 …` 5× wörtlich | nur **5 Rezepte** nutzen `use std/themes` |

## Mehrere Schreibweisen für dasselbe Bild

| Ergebnis | A | B | C |
|---|---|---|---|
| Gefüllte Form | Kommandoform `rect c 1:1 30:30 fill` **1226** | Paint-first `fill c rect(…)` **403** | — |
| Silhouette | `stroke k shape w1` 62 | `outline k` 37 | — |
| Richtungs-Shading | `shadeRegion`+`lightRegion` (22 Dateien) | `model`/`cel` (10 Dateien) | Ton-Fills + `.intersect(rect)` |
| Symmetrie | Hand-`xL`/`xR` 58 | `stamp flipx` 53 | `mirror`-Block 9 |
| Horizont | `profile … fill` 35 | `for x: line …` | `pixels:` |
| Zwei-Ton-Körper | `linear(90,a,b)` 85 | `.intersect(rect)`-Paar 233 | — |
| Kontaktschatten | `castShadow` 21 | Hand-Ellipse 79 | `fit … shadow` 50 |
| Palette | `pal:`-Block 26 Dateien | bare Bindungen 58 Dateien | (32 Dateien beides) |

**18 Dateien mischen A und B derselben Schreibweise in sich.** Das klarste Signal: die Generationen
`scenes → scenes-v2 → scenes-v3` und `characters → characters-ro → characters-ro2` sind drei
Antworten auf dieselbe Frage und liegen alle gleichzeitig im Repo — `scenes*` hat `model`/`cel` nie
übernommen, `characters-ro2` `mirror` nie. Daraus folgt Release-Entscheidung **D3**
(eine Generation je Kategorie).
