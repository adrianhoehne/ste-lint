import test from "node:test";
import assert from "node:assert/strict";

import { lint } from "../src/index.js";

const issues = (result) => [...result.docIssues, ...result.units.flatMap((u) => u.issues)];
const has = (result, rule) => issues(result).some((i) => i.rule === rule);
const hasPassive = (result) => has(result, "PASSIVE") || has(result, "PASSIVE_STATE");
const words = (n, first, rest) => {
  const out = [first];
  let i = 0;
  while (out.length < n) out.push(rest[i++ % rest.length]);
  return out.join(" ") + ".";
};

test("German text is detected as German", () => {
  const result = lint("Der Deckel ist auf der Pumpe und er ist locker.");
  assert.equal(result.language, "de");
});

test("German findings are written in German", () => {
  const result = lint("Benutzen Sie den Hebel.");
  const word = result.units[0].issues.find((i) => i.rule === "WORD");
  assert.ok(word);
  assert.equal(word.suggestion, "verwenden");
  assert.match(word.message, /nicht zugelassen/);
});

test("German passive is found without a word list of participles", () => {
  assert.ok(hasPassive(lint("Der Schlauch wird entnommen.")));
  assert.ok(hasPassive(lint("Der Deckel wurde vorsichtig geöffnet.")));
  assert.ok(hasPassive(lint("Das Ventil wird nicht geöffnet.")));
});

test("German passive in a step is an error", () => {
  const result = lint("1. Der Deckel wird entfernt.");
  const issue = result.units[0].issues.find((i) => i.rule.startsWith("PASSIVE"));
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("German state passive is a separate rule", () => {
  const result = lint("Die Tür ist geschlossen.");
  assert.ok(has(result, "PASSIVE_STATE"));
});

test("German adjective is not a passive", () => {
  assert.ok(!hasPassive(lint("Die Lampe ist rot.")));
});

test("German instruction is identified by the Sie form", () => {
  const result = lint("Entfernen Sie den Deckel.");
  assert.equal(result.units[0].procedural, true);
});

test("German description is not an instruction", () => {
  const result = lint("Der Deckel wird entfernt.");
  assert.equal(result.units[0].procedural, false);
});

test("German instruction over 20 words is an error", () => {
  const body = words(21, "Entfernen", ["Sie", "die", "Schrauben", "von", "der", "Abdeckung", "der", "Pumpe"]);
  const result = lint(body);
  assert.equal(result.units[0].procedural, true);
  assert.ok(has(result, "LENGTH"));
  assert.match(result.units[0].issues.find((i) => i.rule === "LENGTH").message, /Anweisung/);
});

test("German instruction with 20 words is clean", () => {
  const body = words(20, "Entfernen", ["Sie", "die", "Schrauben", "von", "der", "Abdeckung", "der", "Pumpe"]);
  assert.ok(!has(lint(body), "LENGTH"));
});

test("German modal verb is reported", () => {
  const result = lint("Sie sollten den Deckel entfernen.");
  const word = result.units[0].issues.find((i) => i.rule === "WORD");
  assert.ok(word);
  assert.equal(word.suggestion, "müssen");
});

test("German filler is reported", () => {
  assert.ok(has(lint("Tolle Frage! Öffnen Sie den Deckel."), "FLUFF"));
  assert.ok(has(lint("Natürlich. Öffnen Sie den Deckel."), "FLUFF"));
});

test("German synonym drift is reported", () => {
  const result = lint("Prüfen Sie den Motor. Starten Sie die Maschine.");
  assert.ok(has(result, "DRIFT"));
});

test("German multi action is reported", () => {
  assert.ok(has(lint("1. Entfernen Sie die Schrauben und lösen Sie den Deckel."), "MULTI_ACTION"));
});

test("German phrase is reported", () => {
  assert.ok(has(lint("Öffnen Sie den Deckel, aufgrund der Tatsache, dass Druck anliegt."), "PHRASE"));
});

test("German lowercase label is reported", () => {
  assert.ok(has(lint("achtung: heiße Oberfläche\n1. Entfernen Sie den Deckel."), "LABEL_CASE"));
});

test("German uppercase label is accepted", () => {
  assert.ok(!has(lint("ACHTUNG: heiße Oberfläche\n1. Entfernen Sie den Deckel."), "LABEL_CASE"));
});

test("German abbreviations do not split a sentence", () => {
  const result = lint("Prüfen Sie z. B. die Pumpe. Dann starten Sie.");
  assert.equal(result.units.length, 2);
});

test("clean German text scores as STE-ready", () => {
  const result = lint("1. Entfernen Sie den Deckel.\n2. Reinigen Sie das Ventil.\n3. Setzen Sie den Deckel auf.");
  assert.equal(result.score, 100);
  assert.equal(result.grade, "ready");
  assert.equal(result.gradeLabel, "STE-gerecht");
});
