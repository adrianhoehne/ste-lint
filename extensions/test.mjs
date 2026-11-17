/**
 * Tests für die Erweiterung: die acht Prüfungen und der Haken selbst.
 *
 *   node --test plugin/test.mjs
 *
 * Kein pi nötig: `pi` wird nachgebaut, damit jeder der acht Fälle einmal
 * durchlaufen wird — vor allem der Fall, der sonst zur Schleife führt.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { assistantText, codeShare, evaluateGuard, hasToolCall } from "./guard.js";
import steLint from "./index.js";

const BAD_TEXT = "Obviously, acquire the lamp. The valve is not opened.";
const GOOD_TEXT = "1. Remove the cover.\n2. Clean the valve.";

const assistantMessage = (text, extraBlocks = []) => ({
  role: "assistant",
  content: [{ type: "text", text }, ...extraBlocks],
});

const entry = (id, message) => ({ type: "message", id, parentId: null, timestamp: "", message });

function harness({ mode = "tui", enabled = false } = {}) {
  const handlers = new Map();
  const commands = new Map();
  const entries = [];
  const notices = [];
  let branch = [];

  const pi = {
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, options) => commands.set(name, options),
    registerEntryRenderer: () => {},
    appendEntry: (type, data) => entries.push({ type, data }),
  };

  const ctx = {
    mode,
    sessionManager: { getBranch: () => branch, getEntries: () => branch },
    ui: { notify: (message, type) => notices.push({ message, type }) },
  };

  const setBranch = (next) => {
    branch = next;
  };

  const run = async (name, args = "") => commands.get(name).handler(args, ctx);
  const fire = async (name, event = {}) => handlers.get(name)?.(event, ctx);

  const settle = (overrides = {}) =>
    fire("agent_before_settle", {
      outcome: "completed",
      context: { canContinue: true },
      entries: [],
      continue: false,
      ...overrides,
    });

  return { pi, handlers, commands, entries, notices, ctx, setBranch, run, fire, settle, enabled };
}

async function enabledHarness(options) {
  const h = harness(options);
  await steLint(h.pi);
  await h.run("ste-guard", "on");
  h.notices.length = 0;
  return h;
}

// ── reine Prüfungen ─────────────────────────────────────────────────────────

test("assistantText nimmt nur Textblöcke", () => {
  assert.equal(assistantText(assistantMessage("eins", [{ type: "thinking", thinking: "x" }])), "eins");
  assert.equal(assistantText(undefined), "");
});

test("hasToolCall erkennt Werkzeugaufrufe", () => {
  assert.equal(hasToolCall(assistantMessage("text")), false);
  assert.equal(hasToolCall(assistantMessage("text", [{ type: "toolCall", name: "bash" }])), true);
});

test("codeShare zählt Zäune und Zauninhalt", () => {
  assert.equal(codeShare("nur Text"), 0);
  assert.equal(codeShare("```\ncode\n```"), 1);
  const mixed = "Text\n```\ncode\n```\nmehr Text";
  assert.ok(codeShare(mixed) > 0 && codeShare(mixed) < 1);
  assert.equal(codeShare(""), 1);
});

const base = { enabled: true, outcome: "completed", canContinue: true, mode: "tui", startedByUser: true };

test("Prüfung 1: ausgeschaltet greift nicht", () => {
  assert.equal(evaluateGuard({ ...base, enabled: false, message: assistantMessage("x"), messageEntryId: "a" }).reason, "disabled");
});

test("Prüfung 2: Abbruch greift nicht", () => {
  assert.equal(evaluateGuard({ ...base, outcome: "aborted", message: assistantMessage("x"), messageEntryId: "a" }).reason, "outcome:aborted");
  assert.equal(evaluateGuard({ ...base, outcome: "error", message: assistantMessage("x"), messageEntryId: "a" }).reason, "outcome:error");
});

test("Prüfung 3: keine Fortsetzung möglich", () => {
  assert.equal(evaluateGuard({ ...base, canContinue: false, message: assistantMessage("x"), messageEntryId: "a" }).reason, "cannot-continue");
});

test("Prüfung 4: nur im TUI", () => {
  for (const mode of ["json", "print", "rpc"]) {
    assert.equal(evaluateGuard({ ...base, mode, message: assistantMessage("x"), messageEntryId: "a" }).reason, `mode:${mode}`);
  }
});

test("Prüfung 5: nur Läufe aus einer Nutzereingabe", () => {
  assert.equal(evaluateGuard({ ...base, startedByUser: false, message: assistantMessage("x"), messageEntryId: "a" }).reason, "not-a-user-run");
});

test("Prüfung 6: Nachricht mit toolCall greift nicht", () => {
  const message = assistantMessage("text", [{ type: "toolCall", name: "bash" }]);
  assert.equal(evaluateGuard({ ...base, message, messageEntryId: "a" }).reason, "has-tool-call");
});

test("Prüfung 7: dieselbe Nachricht nur einmal", () => {
  const message = assistantMessage("text");
  assert.equal(evaluateGuard({ ...base, message, messageEntryId: "a", handledIds: new Set(["a"]) }).reason, "already-handled");
  assert.equal(evaluateGuard({ ...base, message, messageEntryId: "b", repairsThisRun: 1 }).reason, "repair-limit");
});

test("Prüfung 8: überwiegend Code greift nicht", () => {
  const message = assistantMessage("```\nline1\nline2\nline3\nline4\n```");
  assert.equal(evaluateGuard({ ...base, message, messageEntryId: "a" }).reason, "mostly-code");
});

test("alle Prüfungen grün erlauben den Eingriff", () => {
  assert.deepEqual(evaluateGuard({ ...base, message: assistantMessage("Remove the cover."), messageEntryId: "a" }), {
    allow: true,
    reason: "allow",
  });
});

// ── Erweiterung ────────────────────────────────────────────────────────────

test("ste-guard ist standardmäßig aus", async () => {
  const h = harness();
  await steLint(h.pi);
  await h.run("ste-guard");
  assert.match(h.notices.at(-1).message, /aus/);
});

test("ste-guard on und off schalten den Haken", async () => {
  const h = harness();
  const api = await steLint(h.pi);
  await h.run("ste-guard", "on");
  assert.equal(api.state.enabled, true);
  assert.match(h.notices.at(-1).message, /an, Schwelle 90/);
  await h.run("ste-guard", "off");
  assert.equal(api.state.enabled, false);
});

test("ste-guard nimmt eine eigene Schwelle", async () => {
  const h = harness();
  const api = await steLint(h.pi);
  await h.run("ste-guard", "on 80");
  assert.equal(api.state.threshold, 80);
  await h.run("ste-guard", "70");
  assert.equal(api.state.threshold, 70);
  assert.equal(api.state.enabled, true);
});

test("ste-guard weist Unsinn ab", async () => {
  const h = harness();
  await steLint(h.pi);
  await h.run("ste-guard", "vielleicht");
  assert.match(h.notices.at(-1).message, /Usage/);
});

test("Haken repariert eine schlechte Antwort einmal", async () => {
  const h = await enabledHarness();
  h.setBranch([entry("m1", assistantMessage(BAD_TEXT))]);
  await h.fire("before_agent_start", { messageType: "user" });

  const result = await h.settle();
  assert.equal(result.continue, true);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].type, "custom_message");
  assert.equal(result.entries[0].customType, "ste-guard");
  assert.match(result.entries[0].content, /Score|score/);
  assert.ok(result.entries[0].details.fixes.length > 0);

  const again = await h.settle();
  assert.equal(again, undefined);
});

test("Haken greift nicht nach einer eigenen Reparaturrunde", async () => {
  const h = await enabledHarness();
  h.setBranch([entry("m2", assistantMessage(BAD_TEXT))]);
  await h.fire("before_agent_start", { messageType: "custom" });
  assert.equal(await h.settle(), undefined);
});

test("Haken greift nicht bei einer Nachricht mit toolCall", async () => {
  const h = await enabledHarness();
  h.setBranch([entry("m3", assistantMessage(BAD_TEXT, [{ type: "toolCall", name: "bash" }]))]);
  await h.fire("before_agent_start", { messageType: "user" });
  assert.equal(await h.settle(), undefined);
});

test("Haken greift nicht bei Abbruch oder im json-Modus", async () => {
  const aborted = await enabledHarness();
  aborted.setBranch([entry("m4", assistantMessage(BAD_TEXT))]);
  await aborted.fire("before_agent_start", { messageType: "user" });
  assert.equal(await aborted.settle({ outcome: "aborted" }), undefined);

  const json = await enabledHarness({ mode: "json" });
  json.setBranch([entry("m5", assistantMessage(BAD_TEXT))]);
  await json.fire("before_agent_start", { messageType: "user" });
  assert.equal(await json.settle(), undefined);
});

test("Haken lässt gute Antworten in Ruhe", async () => {
  const h = await enabledHarness();
  h.setBranch([entry("m6", assistantMessage(GOOD_TEXT))]);
  await h.fire("before_agent_start", { messageType: "user" });
  assert.equal(await h.settle(), undefined);
});

test("ste-lint prüft weiterhin auf Zuruf", async () => {
  // Ohne pi-tui fällt die Anzeige auf notify zurück; das ist der Weg, der hier
  // ohne Sitzung prüfbar ist.
  const h = harness();
  await steLint(h.pi);
  h.setBranch([entry("m7", assistantMessage(BAD_TEXT))]);
  await h.run("ste-lint", "en");
  const notice = h.notices.at(-1);
  assert.match(notice.message, /STE \d+\/100/);
  assert.match(notice.message, /"Obviously"/);
  assert.equal(notice.type, "warning");
});
