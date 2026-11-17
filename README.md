# ste-lint

Prüft Text auf vereinfachte technische Sprache: Englisch nach den mechanisch
prüfbaren ASD-STE100-Regeln, Deutsch als Entsprechung. Dazu eine pi-Erweiterung
mit dem Befehl `/ste-lint` und einem Haken, der eine Antwort nachbessern lässt.

Keine Abhängigkeiten, keine Modelle, kein POS-Tagger. Deterministisch: gleicher
Text, gleiche Befunde.

## Voraussetzungen

- Node 20 oder neuer (die Wortlisten werden mit `node:fs` gelesen, das Paket
  läuft nicht im Browser).
- Für die Erweiterung: pi. Gebaut und geprüft gegen die Version, die unter
  `~/.pi/agent/install` liegt.

## Installieren

```bash
pi install /home/adrian/ste-lint          # persönlich, in jeder Sitzung
pi install --local /home/adrian/ste-lint  # nur im aktuellen Projekt
```

Aus einem Git-Repository, sobald es eins gibt:

```bash
pi install git:github.com/<konto>/ste-lint@v0.1.0
```

Einmal ausprobieren, ohne etwas zu speichern:

```bash
pi -e /home/adrian/ste-lint
```

Ein lokales Paket wird von seinem Pfad geladen, nicht kopiert. Nach einer
Änderung genügt `/reload` in der laufenden Sitzung.

## Benutzen

| Befehl | Wirkung |
|---|---|
| `/ste-lint` | prüft die letzte Antwort: Score, Grad, Befunde |
| `/ste-lint de` | dasselbe, Sprache erzwungen (auch `en`, `auto`) |
| `/ste-guard` | zeigt den Zustand des Reparaturhakens |
| `/ste-guard on 85` | schaltet ihn ein, Schwelle 85 (Standard 90) |
| `/ste-guard off` | schaltet ihn aus |

Der Haken sitzt auf `agent_before_settle` und greift nur, wenn die Sitzung
wirklich eine Antwort an dich ist: kein `toolCall`, kein Subagenten-Lauf, Modus
`tui`, überwiegend Fließtext. Sonst bleibt sie unangetastet. Begründung mit
Bildern: [`docs/ablaeufe.md`](docs/ablaeufe.md).

Standardmäßig ist der Haken **aus**. Er kostet eine zusätzliche Modellrunde pro
Nachbesserung.

## Was geprüft wird

| Regel | Bedeutung | Schwere |
|---|---|---|
| `LENGTH` | Anweisung > 20 Wörter, Beschreibung > 25 | Fehler |
| `MULTI_ACTION` | zwei Anweisungen in einem Satz (`and`/`und`/`then`/`;` + Befehl) | Fehler |
| `STEP_SENTENCES` | mehr als ein Satz in einem nummerierten Schritt | Warnung |
| `PASSIVE` | Passiv in einer Anweisung / in einer Beschreibung | Fehler / Warnung |
| `PASSIVE_STATE` | Partizip als Zustandsadjektiv („is closed", „ist geschlossen") | wie `PASSIVE` |
| `ING` | Satz beginnt mit einer -ing-Form (nur Englisch) | Warnung |
| `WORD` | nicht zugelassenes Wort, mit Vorschlag | Fehler |
| `PHRASE` | nicht zugelassene Wendung, mit Vorschlag | Fehler |
| `FLUFF` | Füllwort, Lob, Absicherung | Warnung |
| `DRIFT` / `DRIFT_TERM` | zwei Namen für eine Sache im selben Text | Fehler / Warnung |
| `PARAGRAPH` | Absatz > 6 Sätze | Warnung |
| `UNTERMINATED_CODE` | Codeblock nicht geschlossen, Rest ungeprüft | Warnung |
| `LABEL_CASE` | „warning:" statt „WARNING:" | Warnung |

Jeder Befund trägt `rule`, `severity`, `message`, `term`, `suggestion`, `vars`
und `start`/`end` als Zeichen-Offset in den geprüften Text.

## Als Bibliothek

```js
import { lint, repairInstructions } from "ste-lint";

const text =
  "Obviously, this is a great setup. To replace the lamp, you should first ascertain that the cover is removed.";
const result = lint(text);
result.score;      // 35
result.grade;      // "not"
result.gradeLabel; // "Not STE"
result.metrics;    // { errors: 2, warnings: 2, … }
repairInstructions(result);
// [ 'Replace "should" with "must".', 'Replace "ascertain" with "find out".', … ]
```

Die Sprache wird erkannt. Erzwingen mit `lint(text, { language: "de" })`. Ein
unbekannter Code fällt still auf die Standardsprache zurück; `result.language`
meldet immer die Sprache, die wirklich geprüft wurde.

### Ergebnis

```
{ language, lines, units, docIssues, metrics, score, grade, gradeLabel, messages }
```

- `score`: 0–100 oder `null` bei leerem Text.
- `grade`: `ready` | `close` | `work` | `not` | `empty`, `gradeLabel` in der
  Sprache des Textes.
- `metrics`: Zählwerte je Regel, Wörter, Sätze, Fehler, Warnungen.

## Wortlisten

Die Listen sind reine JSON-Dateien: `lists/en.json`, `lists/de.json`. Ein Pack
enthält Wortlisten, Grenzwerte, Abkürzungen, Label-Wörter und die Meldungen in
der Zielsprache.

Eigene Wörter dazugeben:

```js
import { createLinter, readListJson } from "ste-lint";

const linter = createLinter({
  extraLists: { de: readListJson("./meine-woerter.json") },
  limits: { procedural: 15 }, // optional
});
linter.lint("Das ist Quatsch.");
```

- `mergeLists(base, extra)` fügt zusammen, ohne die Basis zu verändern: Objekte
  werden schlüsselweise gemischt, Arrays angehängt, alles andere ersetzt.
- Mehrwort-Einträge in `unapproved` („put together") werden wie `phrases`
  geprüft. Eine Liste aus einer Tabelle darf also in beide Felder wachsen.
- Ein neues Sprachpaket ist eine weitere JSON-Datei mit `code`, `messages` und
  den Listen; `inflection` ist `"en"`, `"de"` oder fehlt (dann nur exakte
  Treffer).

## Grenzen, offen gesagt

- **ASD-STE100 gilt nur für Englisch.** Die deutsche Seite ist eine Entsprechung
  nach denselben Prinzipien, keine ASD-Spezifikation.
- Kein POS-Tagger, kein Modell. Passive Erkennung ist Regel plus Wortliste.
- Der Score ist die Metrik dieses Linters, keine Zertifizierung.
- Ein Satz, der mit einer Abkürzung endet („Wait etc. Next step."), bleibt ein
  Satz. Die Abkürzungsliste verhindert das Trennen, nicht das Zusammenhalten.
- Synonym-Listen sind redaktionell. Technische Geräte mit zwei echten Namen
  können als Drift gemeldet werden. Drift prüft die Grundform: „lamp" trifft,
  „lamps" nicht.
- Deutsche Partizipien werden über Präfix und Endung erkannt, nicht über eine
  Formenliste. Seltene Formen bleiben unentdeckt.
- Inline-Code, Links und URLs werden ausgeblendet, Tabellen nicht.

Technische Entscheidungen und ihre Begründung: [`docs/entscheidungen.md`](docs/entscheidungen.md).

## Tests

```bash
npm test
```

99 Tests: 77 für den Linter (Englisch, Deutsch, Spracherkennung, Wortlisten,
Offsets), 22 für die Erweiterung mit nachgebautem `pi`-Objekt.

## Lizenz

MIT, siehe [`LICENSE`](LICENSE).
