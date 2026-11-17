import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

import { createLinter, lint, lists, LISTS_DIR } from "../src/index.js";
import { validatePack, mergeLists, readListJson } from "../src/lists.js";

test("built-in packs are exported as plain objects", () => {
  assert.equal(lists.en.code, "en");
  assert.equal(lists.de.code, "de");
  assert.ok(Object.keys(lists.en.unapproved).length > 50);
});

test("built-in list files are readable JSON", () => {
  const pack = readListJson(join(LISTS_DIR, "en.json"));
  assert.equal(pack.code, "en");
  assert.equal(pack.limits.procedural, 20);
});

test("mergeLists adds entries and keeps the base untouched", () => {
  const base = { code: "en", messages: {}, unapproved: { utilize: "use" }, fluff: ["crucial"], drift: [["engine", "motor"]] };
  const extra = { unapproved: { leverage: "use" }, fluff: ["crucial", "robust"], drift: [["tire", "tyre"]] };
  const merged = mergeLists(base, extra);

  assert.deepEqual(merged.unapproved, { utilize: "use", leverage: "use" });
  assert.deepEqual(merged.fluff, ["crucial", "robust"]);
  assert.equal(merged.drift.length, 2);
  assert.deepEqual(Object.keys(base.unapproved), ["utilize"]);
  assert.deepEqual(base.fluff, ["crucial"]);
});

test("mergeLists replaces a suggestion for an existing word", () => {
  const merged = mergeLists({ unapproved: { ensure: "make sure" } }, { unapproved: { ensure: "check" } });
  assert.equal(merged.unapproved.ensure, "check");
});

test("own words are checked through createLinter", () => {
  const linter = createLinter({ extraLists: { en: { unapproved: { obtain: "get" } } } });
  const result = linter.lint("Obtain the lever.");
  const word = result.units[0].issues.find((i) => i.rule === "WORD");
  assert.ok(word);
  assert.equal(word.suggestion, "get");
});

test("a multi-word entry in unapproved is checked like a phrase", () => {
  const linter = createLinter({ extraLists: { en: { unapproved: { "put together": "assemble" } } } });
  const result = linter.lint("Put together the pump.");
  const issue = result.units[0].issues.find((i) => i.rule === "PHRASE");
  assert.ok(issue);
  assert.equal(issue.suggestion, "assemble");
});

test("own fluff words are checked through createLinter", () => {
  const linter = createLinter({ extraLists: { de: { fluff: ["spielend leicht"] } } });
  const result = linter.lint("Das geht spielend leicht.");
  const fluff = result.units[0].issues.find((i) => i.rule === "FLUFF");
  assert.ok(fluff);
  assert.match(fluff.term, /spielend leicht/);
});

test("limits can be overridden per linter", () => {
  const linter = createLinter({ limits: { procedural: 5 } });
  const result = linter.lint("1. Remove the cover from the pump.");
  assert.ok(result.units[0].issues.some((i) => i.rule === "LENGTH"));
});

test("a language can be forced instead of detected", () => {
  const result = lint("Der Deckel ist auf der Pumpe.", { language: "en" });
  assert.equal(result.language, "en");
});

test("readListJson reports a missing file", () => {
  assert.throws(() => readListJson(join(LISTS_DIR, "xx.json")), /list file not found/);
});

test("validatePack rejects a pack without code or messages", () => {
  assert.throws(() => validatePack({ messages: {} }, "test"), /needs a "code"/);
  assert.throws(() => validatePack({ code: "en" }, "test"), /needs a "messages"/);
});
