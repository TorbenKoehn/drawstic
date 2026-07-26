# Audit — Sprachfläche (2026-07-26)

Read-only-Audit über `docs/language-spec.md`, `src/parser.ts`, `src/ast.ts`, `src/eval.ts`,
`src/values.ts`, `src/lint.ts`, `src/critique.ts`, `src/cli.ts`, `skills/drawstic/*`, ADRs.
Kriterium (Nutzer-Vorgabe): **intrinsisch** — raus fliegt, was redundant, verwirrend oder ein
Sonderfall ohne eigene Rolle ist; nicht, was zufällig unbenutzt ist.

## Release-blockierend: ENTFERNEN

| # | Konstrukt | Befund |
|---|---|---|
| 1 | `cap X` / `join X` | geparst und **verworfen** (`eval.ts:7828,7846`); ADR-0053 hat die Geometrie unbefristet vertagt; `cap` frisst zusätzlich das nächste Kommando-Argument. 0 Nutzungen. |
| 2 | `castShadow r dx:dy p` | **byte-identische Implementierung** zu `shadow r dx:dy p` (`eval.ts:4697` vs `4728`). |
| 3 | `seed N` | gespeichert, nie gelesen (`eval.ts:3725`, Kommentar „none in v1"). |
| 4 | `mode` in `KW_ARG_ARITY` (`parser.ts:35`) | kein Konsument im Kommando-Pfad. |
| 5 | `anchor` auf `fit` | geparst, explizit ignoriert (`eval.ts:2978`) → muss ein Fehler werden. |
| 6 | `grayscale(c)` | exakt `desaturate(c, 100%)` (`color.ts:279/285`). |
| 7 | `drawstic <N>` Pragma | seit ADR-0088 inert, steht noch in 11 Beispieldateien. |
| 8 | Bare-Int-Exportgröße (`png 512`) | dritte Schreibweise neben `png 512x512` und `@N`. |
| 9 | Bare-Filtername als Statement (`eval.ts:4326`) | dritter Weg neben `apply`-Statement und `apply`-Kommando. |

## Release-blockierend: UMBENENNEN (Token-neutral oder billiger)

| Name | Kollision | Neu | Δ Token |
|---|---|---|---|
| `import` | heißt überall *Modul-Import*; Drawstics Modul-Import ist `from` | `image` | 0 |
| `band` | kollidiert mit Cel-Bändern, `ripple`-Bändern, Gradient-Bändern | `ribbon` | 0 |
| `fit … shadow` | gleiches Wort wie `stamp … shadow dx:dy p`, aber 0-stellig und andere Semantik | `fit … ground` | 0 |
| `ambientOcclusion` | 4 Token für einen 1px-Helfer | `ao` | −3 |
| `pal`, `grad` | Abkürzungen ohne Gewinn | `palette`, `gradient` | 0 |

**Abgelehnt:** `model` → `form`. „Modellieren" ist der Fachbegriff für Volumen-Schattierung in
Malerei/Skulptur — der Verb-Sinn ist korrekt, der Umbau reines Rauschen.

**Bewusst behalten** (Nutzer-Entscheid): user-`font`-Blöcke, `hsl`, `rotatex`, `aseprite`.

## MERGEN / FIXEN

- `tileset` + `atlas` → **ein** Konstrukt (gleiches Anliegen: N Drawings in ein Bild + Map; heute
  zwei Member-Keywords `tiles`/`sprites`, zwei Layout-Knöpfe `cols` vs. `pad`/`place`).
- Builtin-Reservierung inkonsistent: `ramp`/`litTone`/`shadowTone` überschreibbar, `tones`/`mixes`
  reserviert (`eval.ts:6838-6842`) — eine Regel für alle.
- `mix(a,b,t,rgb)`: der dokumentierte bare Enum-Wert ist `E001`; nur `"rgb"` als String funktioniert
  — der einzige String-Enum in einer Sprache voller kontextueller Keywords.

## Mehrwege-Konflikte → der EINE kanonische Weg

| Anliegen | Wege heute | Kanonisch | Rest |
|---|---|---|---|
| Platzierung | `stamp pt`, `stamp anchor`, `fit pin`, `fit pt`, `fit bone` | `fit` (`bone` wenn gerigged) | `stamp` = Deko (W014); `anchor` auf `fit` raus |
| Kontaktschatten | `fit…shadow`, `stamp…shadow`, `shadow r`, `castShadow`, Frame-`shadow`, Hand-Ellipse | `fit … ground` + Frame-`shadow` | `castShadow` raus; Hand-Ellipse = W015 |
| Shading | `model`, `cel`, `shadeRegion`+`rim`+`ao`+`lightRegion`, Ton-Fills, `pixels:` | `model`/`cel` | Quartett → Entscheid D2; Ton-Fills = W013 |
| Symmetrie | Hand-`xL`/`xR` (58), `stamp flipx` (53), `mirror`-Block (9) | `mirror` bzw. `flipx` | Hand-Paare in den Beispielen ersetzen |
| Filter-Eingrenzung | führende Region (5 Filter) vs. `mask …:`-Block (alle) | führende Region | **inkonsistent**: entweder alle Filter oder keiner |
| Exportgröße | `@N`, `512`, `512x512` | `@N` + `WxH` | Bare-Int raus |
| Filter starten | `apply`-Stmt, `apply`-Kmd, bloßer Name | `apply` | andere zwei raus |
| Farbe | Hex, `rgb`/`hsl`/`oklch`, 8 Ops, 5 Listen-Helfer | `oklch` + UFCS-Ops | `grayscale` raus |

## Orthogonalitäts-Lücken (nach Häufigkeit)

1. `Region` hat kein `.flipx/.flipy/.rotate` (nur `path`) → jede gespiegelte Maske zahlt drauf.
2. Nur `grain/speckle/ripple/dither/quantize` nehmen eine führende Region; `outline`, `tint`,
   Frame-`shadow` nicht → Per-Part-Outline braucht einen `mask`-Block.
3. `poly` hat als einziges Strich-Primitiv kein `w<N>`.
4. `text` komponiert mit nichts (kein flip/rot/scale/tint/mask, keine Region-Form).
5. Sprites haben kein `.w`/`.h`/`.pins` → jede Layoutkonstante steht doppelt im Rezept.
6. `theme`-Bodies akzeptieren kein `fn` und keine Konstanten (E004) → Ursache der 6-fach
   duplizierten Ton-Helfer im Korpus.
7. `figure:`-Feldsatz ist geschlossen; `behind`/`front` adressieren einen Part-*Namen* (zwei
   Instanzen desselben Parts nicht unterscheidbar).

## Spec-↔-Implementierungs-Drift (Auszug)

- §17.4 EBNF: `over UNION` bei `model`/`cel` fehlt; Material-Dosen (`shade/hi/rim/ao/spec/puff/
  spread`) und Form-Profile fehlen; `light-def` und `figure:` fehlen im `theme-item`; `quantize`
  fehlt; **die komplette `pin`/`fit`-Familie hat keine Produktion**.
- §13 behauptet, SVG bilde im Smooth-Modus Primitive auf Shapes ab — falsch, `encodeSvg` emittiert
  immer Pixel-Run-`<rect>`s.
- §12: „`rgb`/`hsl` als Override übergeben" — bare Form ist `E001`.
- `hue(color, targetColor)`-Overload implementiert, nicht dokumentiert; `x(pt)`/`y(pt)` ebenso.
- `render --ascii/--preview/--inspect/--explain` und `context` verschlucken `engine.warnings`
  außerhalb von `--json`.
- Kein Unknown-Flag-Fehler in der CLI (`cli.ts:111-209`).

## Nach dem Release nachrüstbar (additiv)

Region-Flip/Rotate · führende Region auf `outline`/`tint`/Frame-`shadow` · `poly w<N>` ·
Sprite-`.w`/`.h` · `text`-Transformflags · `theme`-`fn`/Konstanten · offener `figure:`-Feldsatz ·
Tiefen-/Dunst-Konstrukt · Text-Metriken · Unknown-Flag-Diagnostik · totes `celRegion` löschen.
