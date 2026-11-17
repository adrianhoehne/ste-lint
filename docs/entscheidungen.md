# Entscheidungen und ihre Gründe

Warum der Linter so gebaut ist. Keine Bedienungsanleitung — die steht im
[README](../README.md).

## Wortlisten als JSON, nicht im Code

Ein Sprachpaket ist eine Datei: Wortlisten, Grenzwerte, Abkürzungen, Label-Wörter
und die Meldungen in der Zielsprache. Damit ist eine neue Sprache Datenarbeit,
kein Code. `mergeLists()` und `createLinter()` lassen eigene Wörter dazukommen,
ohne die Basis zu verändern.

Mehrwort-Einträge in `unapproved` werden wie `phrases` geprüft. Wer eine Liste aus
einer Tabelle übernimmt, landet sonst unweigerlich im falschen Feld.

## Befunde in der Sprache des geprüften Textes

Ein deutscher Text bekommt deutsche Meldungen. Der Grund ist praktisch: eine
Meldung wie `"Nutzen" is not approved` in einer deutschen Antwort wird als
Sprachfehler gelesen, nicht als Hinweis.

## Offsets statt Textstellen

Jeder Befund trägt `start`/`end` in den Text, den der Aufrufer übergeben hat.
Inline-Code, Links und URLs werden vorher durch Leerzeichen gleicher Länge
maskiert — sie sind keine Prosa, und Offsets bleiben gültig. Ein Plugin kann damit
markieren, ohne den Text erneut zu suchen.

## Passiv: Hilfsverb plus Partizip, kein Tagger

`PASSIVE` erlaubt bis zu vier Lückenwörter zwischen Hilfsverb und Partizip und
wertet `-ly`-Adverbien als Lücke. Das war der teuerste Fehler einer früheren
Version: `is not opened`, `is being opened` und `was carefully and slowly removed`
blieben dort unentdeckt.

Deutsch erkennt Partizipien über Präfix und Endung: `ge…t/en`, Trennvorsilbe plus
`ge` (`ein-ge-baut`), `-iert`, sowie `be/ver/er/ent/zer/emp/miss` mit `t` oder
`en` am Ende. Ein Zustandspassiv (`Die Tür ist geschlossen`) wird nur gemeldet,
wenn das Hilfsverb ein Zustandsauxiliar ist. `wird geöffnet` bleibt Vorgangspassiv
und damit ein echter Fehler in einer Anweisung.

## Satzklassifikation entscheidet über die Grenze

20 Wörter für eine Anweisung, 25 für eine Beschreibung. Falsch klassifiziert heißt
falsche Grenze. Deshalb liegen die Imperativformen im Sprachpaket, und Deutsch
nutzt zusätzlich Endung plus Pronomen (`Entfernen Sie …`). Ein Schritt oder
Listenpunkt ist immer eine Anweisung, unabhängig vom ersten Wort.

## Drift nur bei Substantiven

`DRIFT` vergleicht Namen für dieselbe Sache: `lamp`/`light`, `gasket`/`seal`,
`push button`/`button`. Ein längerer Name verdrängt den kürzeren aus der Gruppe,
sonst meldet `push button` und `button` einen Widerspruch mit sich selbst.

Verben sind bewusst nicht dabei (`connect`/`attach`, `install`/`fit`): Sie gelten
für verschiedene Objekte und erzeugen Fehlalarme, die den ganzen Befund
entwertet.

## Score

Pro Satz höchstens ein Punkt Abzug: Fehler 1,0, Warnung 0,3. Dazu Dokumentabzüge
(Drift 6 Punkte, Absatz 3). Leerer Text bekommt `null` statt 0, damit „nichts zu
prüfen" nicht wie „alles falsch" aussieht.

Der Score ist eine Orientierung. Wer ihn als Freigabe benutzt, sollte zusätzlich
`metrics.errors` prüfen: Ein Score von 95 kann einen harten Verstoß enthalten, der
als Warnung zählt.

## Haken auf `agent_before_settle`, nicht auf `turn_end`

`turn_end` feuert bei jedem Modellschritt, also auch mitten in einer Werkzeugkette
und in Subagenten-Sitzungen. `agent_before_settle` feuert einmal am Ende eines
Laufs und trägt `outcome`.

Acht Prüfungen in `extensions/guard.js` filtern danach: eingeschaltet, `outcome =
completed`, `canContinue` nicht `false`, Modus `tui`, Lauf aus einer
Nutzereingabe, Nachricht ohne `toolCall`, einmal pro Nachricht, überwiegend
Fließtext. Jede Prüfung hat einen Grund-Code, damit ein Protokoll sagt, warum der
Haken draußen blieb.

Bekannte Lücke: Es ist nicht gemessen, ob eine Fortsetzung aus dem Haken als
`messageType: "custom"` ankommt. Prüfung 5 verlässt sich darauf; falls nicht,
greift Prüfung 7 und begrenzt die Nachbesserung auf eine Runde.

## Kein Browsermodus

Die Listen werden beim Laden mit `node:fs` gelesen. Das hält das Paket frei von
Bundling-Schritten, kostet aber den Browser. Für eine Web-Anwendung müsste man die
JSON-Dateien einbinden.
