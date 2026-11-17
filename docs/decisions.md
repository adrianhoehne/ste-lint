# Decisions and why

Why the linter is built the way it is. For usage see the [README](../README.md).

## Word lists as JSON, not in code

A language pack is one file: word lists, limits, abbreviations, label words and
the messages in the target language. A new language is data work, not code.
`mergeLists()` and `createLinter()` add your own words without changing the base.

Multi-word entries in `unapproved` are checked like `phrases`. Anyone moving a
list from a spreadsheet into the JSON lands in the wrong field otherwise.

## Findings in the language of the checked text

A German text gets German messages. The reason is practical: a message like
`"Nutzen" is not approved` inside a German answer reads as a language error, not
as a hint.

## Offsets instead of quoting text

Every finding carries `start`/`end` into the text the caller passed in. Inline
code, links and URLs are masked with spaces of equal length first — they are not
prose, and the offsets stay valid. A plugin can highlight without searching the
text again.

## Passive: auxiliary plus participle, no tagger

`PASSIVE` allows up to four gap words between auxiliary and participle and counts
`-ly` adverbs as gaps. That was the most expensive bug in an earlier version:
`is not opened`, `is being opened` and `was carefully and slowly removed` stayed
undetected there.

German recognises participles by prefix and ending: `ge…t/en`, a separable prefix
plus `ge` (`ein-ge-baut`), `-iert`, and `be/ver/er/ent/zer/emp/miss` with `t` or
`en` at the end. A state passive (`Die Tür ist geschlossen`) is only reported when
the auxiliary is a state auxiliary. `wird geöffnet` stays a process passive and
therefore a real error in an instruction.

## Sentence classification decides the limit

20 words for an instruction, 25 for a description. Wrong classification means a
wrong limit. The imperative forms therefore live in the language pack, and German
additionally uses ending plus pronoun (`Entfernen Sie …`). A step or list item is
always an instruction, whatever its first word.

## Drift only for nouns

`DRIFT` compares names for the same thing: `lamp`/`light`, `gasket`/`seal`,
`push button`/`button`. A longer name removes the shorter one from the group,
otherwise `push button` and `button` would be reported as contradicting itself.

Verbs are left out on purpose (`connect`/`attach`, `install`/`fit`): they apply to
different objects and produce false positives that devalue the whole finding.

## Score

At most one point per sentence: error 1.0, warning 0.3. Plus document penalties
(drift 6 points, paragraph 3). Empty text gets `null` instead of 0, so "nothing to
check" does not look like "all wrong".

The score is an orientation. Anyone using it as a gate should also check
`metrics.errors`: a score of 95 can contain a hard violation that counts as a
warning.

## Hook on `agent_before_settle`, not `turn_end`

`turn_end` fires on every model step, meaning also mid tool chain and inside
subagent sessions. `agent_before_settle` fires once at the end of a run and carries
`outcome`.

Seven gates in `extensions/guard.js` filter afterwards: switched on, `outcome =
completed`, mode `tui`, run started by a user, message without `toolCall`, once per
message, mostly prose. Every gate has a reason code so a log can say why the hook
stayed out.

`context.canContinue` is deliberately **not** a gate. pi reports it as `false` to
the first handler of a boundary, because at that moment the last message is the
assistant answer. A version that checked it blocked every repair — measured, not
guessed. pi validates the continuation itself after our draft is committed and
reports a rejected one.

Also measured: the continuation from the hook does **not** arrive as
`messageType: "custom"` — `before_agent_start` does not reset the marker. The loop
is therefore stopped by gate 6 alone (one repair per run), visible in the log as
`reason: "repair-limit"`. Removing that gate builds an endless loop.

## Settings file read, never written

The hook's start state comes from `<agent-dir>/ste-lint.json`, read once at load
(`extensions/settings.js`). The extension never writes that file: no `/ste-guard`
switch is saved. Three reasons.

**One source of truth.** A file that both the user and the extension write ends up
with two states that differ: the runtime value and the one on disk. Read only,
whatever the file says is what the next start uses, and nothing can overwrite a
hand-edited comment-free JSON — including a switch the user only wanted for one
run.

**No API to use.** pi has no extension settings API. Its guidance for state
depends on the lifetime, and this state outlives a session: "Data outside one
session → External storage". A session entry would be worse than a file, because
entries follow the branch — jumping back to an old branch would restore an old
switch position.

**The whole file or nothing.** One malformed field ignores the entire file instead
of mixing a file value with a default. A mixture is nearly impossible to explain
in the status line; `config ignored (threshold)` is caught in one second. Unknown
keys stay ignored, so a newer file format with extra fields keeps the known ones.

The file ships as `assets/ste-lint.json`, so opting in is a copy, not an edit.
Without the file the hook stays off, which keeps the default cost at zero extra
model rounds.

## No browser mode

The lists are read with `node:fs` when the package loads. That keeps the package
free of a bundling step and costs the browser. A web application would have to
bundle the JSON files.
