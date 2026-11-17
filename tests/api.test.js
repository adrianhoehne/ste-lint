import test from "node:test";
import assert from "node:assert/strict";

import { engine, lint, repairInstructions, segment, splitSentences, countWords } from "../src/index.js";

test("a result carries everything a caller needs", () => {
  const result = lint("Acquire the cover.");
  assert.deepEqual(Object.keys(result).sort(), [
    "docIssues",
    "grade",
    "gradeLabel",
    "language",
    "lines",
    "messages",
    "metrics",
    "score",
    "units",
  ]);
  assert.equal(typeof result.metrics.words, "number");
  const issue = result.units[0].issues[0];
  assert.equal(typeof issue.rule, "string");
  assert.equal(typeof issue.message, "string");
  assert.equal(typeof issue.start, "number");
});

test("two calls give the same result", () => {
  const text = "1. Acquire the cover and check the connector.";
  assert.equal(lint(text).score, lint(text).score);
});

test("segment is usable on its own", () => {
  const { lines, units } = segment("1. Remove the cover.\n\nText here.", engine.packs.en);
  assert.equal(units.length, 2);
  assert.equal(lines.filter((l) => l.type === "text").length, 2);
});

test("repair instructions are written in the language of the text", () => {
  const de = repairInstructions(lint("Der Deckel wird entfernt."));
  assert.equal(de.length, 1);
  assert.match(de[0], /Passiv/);

  const en = repairInstructions(lint("The cover is removed."));
  assert.match(en[0], /passive voice/);
});

test("repair instructions also cover passive in a description", () => {
  const result = lint("The valve is opened by the operator.");
  assert.ok(repairInstructions(result).some((line) => /passive/.test(line)));
});

test("repair instructions respect the maximum", () => {
  const text = "Utilize the motor, ensure the lever, in order to commence and terminate.";
  const result = lint(text);
  assert.ok(repairInstructions(result, { max: 2 }).length <= 2);
});

test("repair instructions start with the errors", () => {
  const result = lint("Obviously! Acquire the cover.");
  const lines = repairInstructions(result);
  assert.match(lines[0], /Replace|Ersetzen/);
});

test("helpers are exported for callers that only need pieces", () => {
  assert.equal(countWords("one two"), 2);
  assert.equal(splitSentences("A. B.").length, 2);
});

test("metrics count what the rules report", () => {
  const result = lint("1. Acquire the lamp and check the light.");
  assert.equal(result.metrics.multiAction, 1);
  assert.equal(result.metrics.unapproved >= 1, true);
  assert.equal(result.metrics.drift, 1);
  assert.equal(result.metrics.errors >= 2, true);
});
