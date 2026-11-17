/**
 * Extension tests: the seven gates and the hook itself.
 *
 *   node --test extensions/test.mjs
 *
 * No pi needed: `pi` is a stand-in, so every gate runs once — especially the one
 * that stops the loop.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

  const statuses = [];
  const ctx = {
    mode,
    sessionManager: { getBranch: () => branch, getEntries: () => branch },
    ui: {
      notify: (message, type) => notices.push({ message, type }),
      setStatus: (key, text) => statuses.push({ key, text }),
    },
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

  return { pi, handlers, commands, entries, notices, statuses, ctx, setBranch, run, fire, settle, enabled };
}

async function enabledHarness(options) {
  const h = harness(options);
  await steLint(h.pi);
  await h.run("ste-guard", "on");
  h.notices.length = 0;
  return h;
}

// ── pure gates ──────────────────────────────────────────────────────────────

test("assistantText takes text blocks only", () => {
  assert.equal(assistantText(assistantMessage("eins", [{ type: "thinking", thinking: "x" }])), "eins");
  assert.equal(assistantText(undefined), "");
});

test("hasToolCall finds tool calls", () => {
  assert.equal(hasToolCall(assistantMessage("text")), false);
  assert.equal(hasToolCall(assistantMessage("text", [{ type: "toolCall", name: "bash" }])), true);
});

test("codeShare counts fences and their content", () => {
  assert.equal(codeShare("nur Text"), 0);
  assert.equal(codeShare("```\ncode\n```"), 1);
  const mixed = "Text\n```\ncode\n```\nmehr Text";
  assert.ok(codeShare(mixed) > 0 && codeShare(mixed) < 1);
  assert.equal(codeShare(""), 1);
});

const base = { enabled: true, outcome: "completed", mode: "tui", startedByUser: true };

test("gate 1: a switched-off hook does nothing", () => {
  assert.equal(evaluateGuard({ ...base, enabled: false, message: assistantMessage("x"), messageEntryId: "a" }).reason, "disabled");
});

test("gate 2: an aborted run is left alone", () => {
  assert.equal(evaluateGuard({ ...base, outcome: "aborted", message: assistantMessage("x"), messageEntryId: "a" }).reason, "outcome:aborted");
  assert.equal(evaluateGuard({ ...base, outcome: "error", message: assistantMessage("x"), messageEntryId: "a" }).reason, "outcome:error");
});

test("gate 3: terminal mode only", () => {
  for (const mode of ["json", "print", "rpc"]) {
    assert.equal(evaluateGuard({ ...base, mode, message: assistantMessage("x"), messageEntryId: "a" }).reason, `mode:${mode}`);
  }
});

test("gate 4: only runs started by a user", () => {
  assert.equal(evaluateGuard({ ...base, startedByUser: false, message: assistantMessage("x"), messageEntryId: "a" }).reason, "not-a-user-run");
});

test("gate 5: a message with a tool call is skipped", () => {
  const message = assistantMessage("text", [{ type: "toolCall", name: "bash" }]);
  assert.equal(evaluateGuard({ ...base, message, messageEntryId: "a" }).reason, "has-tool-call");
});

test("gate 6: one repair per message", () => {
  const message = assistantMessage("text");
  assert.equal(evaluateGuard({ ...base, message, messageEntryId: "a", handledIds: new Set(["a"]) }).reason, "already-handled");
  assert.equal(evaluateGuard({ ...base, message, messageEntryId: "b", repairsThisRun: 1 }).reason, "repair-limit");
});

test("gate 7: mostly code is skipped", () => {
  const message = assistantMessage("```\nline1\nline2\nline3\nline4\n```");
  assert.equal(evaluateGuard({ ...base, message, messageEntryId: "a" }).reason, "mostly-code");
});

test("all gates green allow the repair", () => {
  assert.deepEqual(evaluateGuard({ ...base, message: assistantMessage("Remove the cover."), messageEntryId: "a" }), {
    allow: true,
    reason: "allow",
  });
});

// ── extension ───────────────────────────────────────────────────────────────

test("ste-guard is off by default", async () => {
  const h = harness();
  await steLint(h.pi);
  await h.run("ste-guard");
  assert.match(h.notices.at(-1).message, /off/);
});

test("ste-guard on and off switch the hook", async () => {
  const h = harness();
  const api = await steLint(h.pi);
  await h.run("ste-guard", "on");
  assert.equal(api.state.enabled, true);
  assert.match(h.notices.at(-1).message, /on, threshold 90/);
  await h.run("ste-guard", "off");
  assert.equal(api.state.enabled, false);
});

test("ste-guard accepts a custom threshold", async () => {
  const h = harness();
  const api = await steLint(h.pi);
  await h.run("ste-guard", "on 80");
  assert.equal(api.state.threshold, 80);
  await h.run("ste-guard", "70");
  assert.equal(api.state.threshold, 70);
  assert.equal(api.state.enabled, true);
});

test("ste-guard rejects unknown input", async () => {
  const h = harness();
  await steLint(h.pi);
  await h.run("ste-guard", "vielleicht");
  assert.match(h.notices.at(-1).message, /Usage/);
});

test("the hook repairs a bad answer once", async () => {
  const h = await enabledHarness();
  h.setBranch([entry("m1", assistantMessage(BAD_TEXT))]);
  await h.fire("before_agent_start", { messageType: "user" });

  const result = await h.settle();
  assert.equal(result.continue, true);
  assert.equal(result.entries.length, 1);

  // The prompt reaches the model but stays out of the transcript.
  const prompt = result.entries[0];
  assert.equal(prompt.type, "custom_message");
  assert.equal(prompt.customType, "ste-guard-prompt");
  assert.equal(prompt.display, false);
  assert.match(prompt.content, /Score|score/);

  // The banner is a session entry, drawn by the entry renderer.
  const banner = h.entries.at(-1);
  assert.equal(banner.type, "ste-guard");
  assert.ok(banner.data.fixes.length > 0);
  assert.equal(typeof banner.data.score, "number");

  const again = await h.settle();
  assert.equal(again, undefined);
});

test("the hook skips its own repair round", async () => {
  const h = await enabledHarness();
  h.setBranch([entry("m2", assistantMessage(BAD_TEXT))]);
  await h.fire("before_agent_start", { messageType: "custom" });
  assert.equal(await h.settle(), undefined);
});

test("the hook skips a message with a tool call", async () => {
  const h = await enabledHarness();
  h.setBranch([entry("m3", assistantMessage(BAD_TEXT, [{ type: "toolCall", name: "bash" }]))]);
  await h.fire("before_agent_start", { messageType: "user" });
  assert.equal(await h.settle(), undefined);
});

test("the hook skips an aborted run and json mode", async () => {
  const aborted = await enabledHarness();
  aborted.setBranch([entry("m4", assistantMessage(BAD_TEXT))]);
  await aborted.fire("before_agent_start", { messageType: "user" });
  assert.equal(await aborted.settle({ outcome: "aborted" }), undefined);

  const json = await enabledHarness({ mode: "json" });
  json.setBranch([entry("m5", assistantMessage(BAD_TEXT))]);
  await json.fire("before_agent_start", { messageType: "user" });
  assert.equal(await json.settle(), undefined);
});

test("the hook leaves good answers alone", async () => {
  const h = await enabledHarness();
  h.setBranch([entry("m6", assistantMessage(GOOD_TEXT))]);
  await h.fire("before_agent_start", { messageType: "user" });
  assert.equal(await h.settle(), undefined);
});

test("the footer shows the switch and follows it", async () => {
  const h = harness();
  await steLint(h.pi);
  await h.fire("session_start", {});
  assert.equal(h.statuses.at(-1).text, "STE off");

  await h.run("ste-guard", "on 80");
  assert.equal(h.statuses.at(-1).text, "STE 80");
  assert.equal(h.statuses.at(-1).key, "ste-lint");

  await h.run("ste-guard", "off");
  assert.equal(h.statuses.at(-1).text, "STE off");
});

test("a repair round is announced and its result reported", async () => {
  const h = await enabledHarness();
  h.setBranch([entry("r1", assistantMessage(BAD_TEXT))]);
  await h.fire("before_agent_start", { messageType: "user" });

  await h.settle();
  assert.match(h.notices.at(-1).message, /repair round — \d+\/100, \d+ fixes/);
  assert.equal(h.statuses.at(-1).text, "STE 90 · repairing");

  h.setBranch([entry("r1", assistantMessage(BAD_TEXT)), entry("r2", assistantMessage(GOOD_TEXT))]);
  await h.settle();
  assert.match(h.notices.at(-1).message, /STE: repaired \d+ → \d+/);
  assert.equal(h.statuses.at(-1).text, "STE 90");
});

test("diagnostics write one reason per decision", async () => {
  const file = join(tmpdir(), `ste-lint-guard-${process.pid}.log`);
  process.env.PI_STE_LINT_DEBUG = file;
  try {
    const h = await enabledHarness();
    h.setBranch([entry("m8", assistantMessage(BAD_TEXT))]);
    await h.fire("before_agent_start", { messageType: "user" });
    await h.settle();

    const lines = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const last = lines.at(-1);
    assert.equal(last.decision, "repair");
    assert.equal(typeof last.score, "number");
    assert.equal(last.language, "en");
  } finally {
    delete process.env.PI_STE_LINT_DEBUG;
    rmSync(file, { force: true });
  }
});

test("diagnostics name the reason when the hook is off", async () => {
  const file = join(tmpdir(), `ste-lint-guard-off-${process.pid}.log`);
  process.env.PI_STE_LINT_DEBUG = file;
  try {
    const h = harness();
    await steLint(h.pi);
    h.setBranch([entry("m9", assistantMessage(BAD_TEXT))]);
    await h.fire("before_agent_start", { messageType: "user" });
    await h.settle();

    const last = JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1));
    assert.equal(last.decision, "skip");
    assert.equal(last.reason, "disabled");
  } finally {
    delete process.env.PI_STE_LINT_DEBUG;
    rmSync(file, { force: true });
  }
});

test("ste-lint falls back to notify without pi-tui", async () => {
  const saved = process.env.PI_MANAGED_INSTALL_ROOT;
  delete process.env.PI_MANAGED_INSTALL_ROOT;
  try {
    const h = harness();
    await steLint(h.pi);
    h.setBranch([entry("m7", assistantMessage(BAD_TEXT))]);
    await h.run("ste-lint", "en");
    const notice = h.notices.at(-1);
    assert.match(notice.message, /STE \d+\/100/);
    assert.match(notice.message, /"Obviously"/);
    assert.equal(notice.type, "warning");
    assert.equal(h.entries.length, 0);
  } finally {
    if (saved !== undefined) process.env.PI_MANAGED_INSTALL_ROOT = saved;
  }
});

test("ste-lint draws an entry when the components resolve", async () => {
  const root = process.env.PI_MANAGED_INSTALL_ROOT;
  const version = root ? readFileSync(join(root, "current-version"), "utf8").trim() : null;
  const components = version
    ? join(root, "releases", version, "node_modules", "@earendil-works", "pi-tui", "dist", "index.js")
    : null;
  if (!components || !existsSync(components)) {
    assert.ok(true, "no managed install on this machine");
    return;
  }

  const h = harness();
  await steLint(h.pi);
  h.setBranch([entry("m10", assistantMessage(BAD_TEXT))]);
  await h.run("ste-lint", "en");
  const report = h.entries.at(-1);
  assert.equal(report.type, "ste-lint");
  assert.ok(report.data.findings.length > 0);
  assert.equal(h.notices.length, 0);
});
