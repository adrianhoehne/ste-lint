# ste-lint

Checks text for simplified technical language: English against the mechanical
ASD-STE100 rules, German as an analogue. Ships a pi extension with the
`/ste-lint` command and a hook that can send an answer back for repair.

No dependencies, no models, no POS tagger. Deterministic: same text, same
findings.

## Requirements

- Node 20 or newer. The word lists are read with `node:fs`, so the package runs
  in Node, not in the browser.
- For the extension: pi, at the version installed under `~/.pi/agent/install`.

## Install

```bash
pi install /home/adrian/ste-lint          # personal, every session
pi install --local /home/adrian/ste-lint  # current project only
```

From the repository, pinned to a tag:

```bash
pi install git:github.com/adrianhoehne/ste-lint@v0.1.5
```

Try it once without saving anything:

```bash
pi -e /home/adrian/ste-lint
```

A local package is loaded from its path, not copied. After a change, `/reload`
in the running session is enough.

## Use

| Command | Effect |
|---|---|
| `/ste-lint` | check the last answer: score, grade, findings |
| `/ste-lint de` | same, language forced (`en`, `auto` also work) |
| `/ste-guard` | show the state of the repair hook |
| `/ste-guard on 85` | switch it on, threshold 85 (default 90) |
| `/ste-guard off` | switch it off |

The footer shows the state: `STE off` or `STE 85`. If the entry is missing, the
extension did not load.

When it repairs, you see three things: a notification with the score and the
number of fixes, a banner in the transcript (`STE repair round — 36/100, 8 fixes`,
expandable), and the footer `STE 90 · repairing` until the new answer arrives.
Afterwards it reports the result: `STE: repaired 36 → 94`.

The hook sits on `agent_before_settle` and only acts on an answer to you: no
`toolCall`, no subagent run, mode `tui`, mostly prose. Seven gates decide this;
each has a reason code for the log. Otherwise the answer stays untouched. Why,
with diagrams: [`docs/flows.md`](docs/flows.md).

The hook is **off** by default and does not survive a restart. It costs one extra
model round per repair.

If the hook does not fire and you want to know why: `PI_STE_LINT_DEBUG=1` writes
every decision with its reason to `~/.cache/ste-lint/guard.log`
(`PI_STE_LINT_DEBUG=/path/file.log` for another location). Without the variable
it writes nothing.

## What is checked

| Rule | Meaning | Severity |
|---|---|---|
| `LENGTH` | instruction > 20 words, description > 25 | error |
| `MULTI_ACTION` | two instructions in one sentence (`and`/`then`/`;` + command) | error |
| `STEP_SENTENCES` | more than one sentence in a numbered step | warning |
| `PASSIVE` | passive in an instruction / in a description | error / warning |
| `PASSIVE_STATE` | participle used as a state adjective | same as `PASSIVE` |
| `ING` | sentence starts with an -ing form (English only) | warning |
| `WORD` | word that is not approved, with a suggestion | error |
| `PHRASE` | phrase that is not approved, with a suggestion | error |
| `FLUFF` | filler, praise, hedging | warning |
| `DRIFT` / `DRIFT_TERM` | two names for one thing in the same text | error / warning |
| `PARAGRAPH` | paragraph > 6 sentences | warning |
| `UNTERMINATED_CODE` | code block not closed, rest not checked | warning |
| `LABEL_CASE` | `warning:` instead of `WARNING:` | warning |

Every finding carries `rule`, `severity`, `message`, `term`, `suggestion`, `vars`
and `start`/`end` as character offsets into the checked text.

## As a library

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

The language is detected. Force it with `lint(text, { language: "de" })`. An
unknown code falls back to the default language without an error; `result.language`
always reports the language that was actually used.

### Result

```
{ language, lines, units, docIssues, metrics, score, grade, gradeLabel, messages }
```

- `score`: 0–100, or `null` for empty text.
- `grade`: `ready` | `close` | `work` | `not` | `empty`; `gradeLabel` in the
  language of the text.
- `metrics`: counts per rule, words, sentences, errors, warnings.

## Word lists

The lists are plain JSON files: `lists/en.json`, `lists/de.json`. A pack holds
the word lists, the limits, abbreviations, label words and the messages in the
target language.

Add your own words:

```js
import { createLinter, readListJson } from "ste-lint";

const linter = createLinter({
  extraLists: { de: readListJson("./my-words.json") },
  limits: { procedural: 15 }, // optional
});
linter.lint("Das ist Quatsch.");
```

- `mergeLists(base, extra)` merges without touching the base: objects key by key,
  arrays by appending what is missing, everything else replaced.
- A multi-word entry in `unapproved` (`put together`) is checked like a `phrase`,
  so a list from a spreadsheet can grow into either field.
- A new language pack is another JSON file with `code`, `messages` and the lists.
  `inflection` is `"en"`, `"de"` or absent (exact matches only).

## Limits, stated plainly

- **ASD-STE100 is an English specification.** The German side is an analogue
  built on the same principles, not an ASD specification.
- No POS tagger, no model. Passive detection is a rule plus word lists.
- The score is this linter's own metric, not a certification.
- A sentence that ends with an abbreviation ("Wait etc. Next step.") stays one
  sentence. The abbreviation list prevents splitting, not joining.
- Synonym lists are editorial. Two genuine names for one device can be reported
  as drift. Drift checks the base form: `lamp` matches, `lamps` does not.
- German participles are recognised by prefix and ending, not by a form list.
  Rare forms stay undetected.
- Inline code, links and URLs are masked; tables are not.

Design decisions and their reasons: [`docs/decisions.md`](docs/decisions.md).

## Tests

```bash
npm test
```

101 tests: 77 for the linter (English, German, language detection, word lists,
offsets), 24 for the extension against a stand-in `pi` object.

## License

MIT, see [`LICENSE`](LICENSE).
