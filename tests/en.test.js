import test from "node:test";
import assert from "node:assert/strict";

import { lint } from "../src/index.js";

const rules = (result) => [...result.docIssues, ...result.units.flatMap((u) => u.issues)].map((i) => i.rule);
const has = (result, rule) => rules(result).includes(rule);
const hasPassive = (result) => has(result, "PASSIVE") || has(result, "PASSIVE_STATE");
const words = (n, first, rest) => {
  const out = [first];
  let i = 0;
  while (out.length < n) out.push(rest[i++ % rest.length]);
  return out.join(" ") + ".";
};

test("language is detected as English", () => {
  assert.equal(lint("The cover is on the pump and it is loose.").language, "en");
});

test("unapproved word is reported with a suggestion", () => {
  const result = lint("Acquire the lever to open the cover.");
  const word = result.units[0].issues.find((i) => i.rule === "WORD");
  assert.ok(word);
  assert.equal(word.severity, "error");
  assert.equal(word.term, "Acquire");
  assert.equal(word.suggestion, "get");
});

test("noun form of a banned verb is reported too", () => {
  const result = lint("Do the finalization of the cover.");
  assert.ok(has(result, "WORD"));
});

test("unapproved phrase is reported", () => {
  const result = lint("Acquire the lever for the purpose of opening the cover.");
  assert.ok(has(result, "PHRASE"));
});

test("instruction longer than 20 words is an error at 21", () => {
  const ok = lint(words(20, "Remove", ["the", "cover", "from", "the", "pump", "and", "put", "it", "there"]));
  assert.ok(!has(ok, "LENGTH"));
  const bad = lint(words(21, "Remove", ["the", "cover", "from", "the", "pump", "and", "put", "it", "there"]));
  assert.ok(has(bad, "LENGTH"));
});

test("description allows 25 words and reports 26", () => {
  const ok = lint(words(25, "The", ["technician", "must", "examine", "the", "assembly", "and", "record", "each", "value"]));
  assert.ok(!has(ok, "LENGTH"));
  const bad = lint(words(26, "The", ["technician", "must", "examine", "the", "assembly", "and", "record", "each", "value"]));
  assert.ok(has(bad, "LENGTH"));
});

test("a step is procedural even if it starts with a noun", () => {
  const body = words(21, "The", ["cover", "must", "come", "off", "the", "pump", "now", "and", "then"]);
  const result = lint(`1. ${body}`);
  assert.equal(result.units[0].procedural, true);
  assert.ok(has(result, "LENGTH"));
});

test("passive in a step is an error", () => {
  const result = lint("1. The valve is opened by the operator.");
  const issue = result.units[0].issues.find((i) => i.rule.startsWith("PASSIVE"));
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("passive in a description is a warning", () => {
  const result = lint("The valve is opened by the operator.");
  const issue = result.units[0].issues.find((i) => i.rule.startsWith("PASSIVE"));
  assert.ok(issue);
  assert.equal(issue.severity, "warn");
  assert.equal(result.score, 70);
});

test("passive with a skipped word is found", () => {
  assert.ok(hasPassive(lint("The valve is not opened.")));
  assert.ok(hasPassive(lint("The valve is being opened.")));
});

test("passive with an adverb and a conjunction is found", () => {
  assert.ok(hasPassive(lint("The cover was carefully and slowly removed.")));
});

test("state adjective is reported as state, not as a plain passive", () => {
  const result = lint("The switch is closed.");
  assert.ok(has(result, "PASSIVE_STATE"));
  assert.ok(!has(result, "PASSIVE"));
  assert.equal(result.units[0].issues[0].severity, "warn");
});

test("an adjective that only looks like a participle is ignored", () => {
  assert.ok(!has(lint("The lamp is red."), "PASSIVE"));
  assert.ok(!has(lint("The lamp is red."), "PASSIVE_STATE"));
});

test("curly apostrophe still counts as a command form", () => {
  const text = words(22, "Don’t", ["touch", "the", "hot", "surface", "of", "the", "pump", "again"]);
  const result = lint(text.replace(/^Don's/, "Don’t"));
  assert.equal(result.units[0].procedural, true);
  assert.ok(has(result, "LENGTH"));
});

test("two instructions in one sentence are reported", () => {
  assert.ok(has(lint("1. Remove the bolts and loosen the cover."), "MULTI_ACTION"));
});

test("one instruction in one sentence stays clean", () => {
  assert.ok(!has(lint("1. Remove the bolts."), "MULTI_ACTION"));
});

test("two sentences in one step are reported", () => {
  assert.ok(has(lint("1. Remove the bolts. Loosen the cover."), "STEP_SENTENCES"));
});

test("filler is reported", () => {
  assert.ok(has(lint("Obviously! Open the cover."), "FLUFF"));
});

test("a technical noun is not filler", () => {
  assert.ok(!has(lint("The display shows the value."), "FLUFF"));
  assert.ok(!has(lint("Set the lamp to 3."), "FLUFF"));
});

test("-ing start is reported", () => {
  assert.ok(has(lint("Using the tool, remove the cover."), "ING"));
});

test("synonym drift is reported for two names of one thing", () => {
  const result = lint("Replace the lamp. Clean the light.");
  assert.ok(has(result, "DRIFT"));
  assert.ok(has(result, "DRIFT_TERM"));
});

test("a longer name does not count as drift against its own short form", () => {
  const result = lint("Press the push button. Release the button.");
  assert.ok(!has(result, "DRIFT"));
});

test("paragraph with more than six sentences is reported", () => {
  const result = lint("One. Two. Three. Four. Five. Six. Seven.");
  assert.ok(has(result, "PARAGRAPH"));
});

test("an unclosed code block is reported and stops the check", () => {
  const result = lint("1. Remove the cap.\n```\n2. Utilize the motor.\n");
  assert.ok(has(result, "UNTERMINATED_CODE"));
  assert.ok(!has(result, "WORD"));
});

test("lowercase label is reported", () => {
  assert.ok(has(lint("warning: hot surface\n1. Remove the cover."), "LABEL_CASE"));
});

test("findings carry offsets that slice back to the term", () => {
  const text = "Acquire the lever to open the cover.";
  const result = lint(text);
  const issue = result.units[0].issues.find((i) => i.rule === "WORD");
  assert.equal(text.slice(issue.start, issue.end), "Acquire");
});

test("offsets stay correct below a step prefix and a label", () => {
  const text = "3. Ascertain the value.\nWARNING: Do not acquire the part.";
  const result = lint(text);
  const first = result.units[0].issues.find((i) => i.rule === "WORD");
  const second = result.units[1].issues.find((i) => i.rule === "WORD");
  assert.equal(text.slice(first.start, first.end), "Ascertain");
  assert.equal(text.slice(second.start, second.end), "acquire");
});

test("offsets stay correct when inline code is masked", () => {
  const text = "Run `npm ci` and acquire the part.";
  const result = lint(text);
  const issue = result.units[0].issues.find((i) => i.rule === "WORD");
  assert.equal(text.slice(issue.start, issue.end), "acquire");
});

test("empty text has no score and no grade", () => {
  const result = lint("");
  assert.equal(result.score, null);
  assert.equal(result.grade, "empty");
  assert.deepEqual(result.units, []);
});

test("clean text scores as STE-ready", () => {
  const result = lint("1. Remove the cover.\n2. Clean the valve.\n3. Install the cover.");
  assert.equal(result.score, 100);
  assert.equal(result.grade, "ready");
});
