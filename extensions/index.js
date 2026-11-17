/**
 * /ste-lint  check the last answer for simplified technical language (on request)
 * /ste-guard switch the automatic repair hook on or off
 *
 * The linter and its word lists live in ../src and ../lists; this file only
 * connects them to pi.
 *
 * The repair hook sits on `agent_before_settle`, not `turn_end`: turn_end fires
 * on every model step, including tool chains and subagent sessions. Eight gates
 * in ./guard.js decide whether a settle is really an answer to the user.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { lint, repairInstructions } from "../src/index.js";
import { assistantText, evaluateGuard } from "./guard.js";

const MAX_FINDINGS = 40;

/**
 * Why did the hook stay out? Set PI_STE_LINT_DEBUG=1 to log every decision to
 * ~/.cache/ste-lint/guard.log, or set it to a file path. Silent by default:
 * writing during a session would land in the running UI.
 */
function debugLog(entry) {
  const target = process.env.PI_STE_LINT_DEBUG;
  if (!target) return;
  const file = target === "1" ? join(homedir(), ".cache", "ste-lint", "guard.log") : target;
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // A broken log path must not break the hook.
  }
}
const DEFAULT_THRESHOLD = 90;
const MAX_REPAIRS_PER_RUN = 1;

function lastAssistant(ctx) {
  const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.() ?? [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    if (!assistantText(entry.message)) continue;
    return { entryId: entry.id, message: entry.message };
  }
  return { entryId: undefined, message: undefined };
}

function collectFindings(result) {
  const out = [];
  for (const issue of result.docIssues) {
    out.push({ line: issue.vars?.line ?? 0, severity: issue.severity, rule: issue.rule, message: issue.message });
  }
  for (const unit of result.units) {
    for (const issue of unit.issues) {
      out.push({ line: unit.line, severity: issue.severity, rule: issue.rule, message: issue.message, text: unit.text });
    }
  }
  out.sort((a, b) => (a.line || 0) - (b.line || 0));
  return out.slice(0, MAX_FINDINGS);
}

function headline(result) {
  const german = result.language === "de";
  const { errors, warnings } = result.metrics;
  const counts = german ? `${errors} Fehler, ${warnings} Warnungen` : `${errors} errors, ${warnings} warnings`;
  if (result.score === null) return german ? "Kein Text zum Prüfen" : "No text to check";
  return `STE ${result.score}/100 ${result.gradeLabel} · ${counts} · ${result.language}`;
}

/** Instruction for the model after a failed check. Keeps every fact on purpose. */
function repairPrompt(result, fixes) {
  const lines =
    result.language === "de"
      ? [
          `Deine Antwort verletzt die Regeln für vereinfachte technische Sprache (Score ${result.score}/100).`,
          "Schreibe die vollständige Antwort neu.",
          "Behalte jeden Fakt, jeden Wert und jeden Sicherheitsschritt.",
          "Behebe diese Punkte:",
        ]
      : [
          `Your answer breaks the rules for simplified technical language (score ${result.score}/100).`,
          "Write the full answer again.",
          "Keep every fact, every value and every safety step.",
          "Fix these points:",
        ];
  const footer = result.language === "de" ? "Antworte nur mit der neuen Antwort." : "Answer with the new text only.";
  return [...lines, ...fixes.map((fix) => `- ${fix}`), footer].join("\n");
}

export default async function steLint(pi) {
  // Per instance, not per module: a second package instance must not share the
  // switch with the first.
  const state = {
    enabled: false,
    threshold: DEFAULT_THRESHOLD,
    startedByUser: false,
    handledIds: new Set(),
    repairsThisRun: 0,
  };

  const showStatus = (ctx) => {
    const text = state.enabled ? `STE ${state.threshold}` : "STE aus";
    try {
      ctx?.ui?.setStatus?.("ste-lint", text);
    } catch {
      // setStatus is TUI-only; ignore elsewhere.
    }
  };

  let tui = null;
  try {
    tui = await import("@earendil-works/pi-tui");
  } catch {
    tui = null; // no terminal components: both commands still work through notify
  }

  if (tui?.Box && tui?.Text) {
    pi.registerEntryRenderer("ste-lint", (entry, { expanded }, theme) => {
      const data = entry.data ?? {};
      const box = new tui.Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.addChild(new tui.Text(theme.fg("accent", data.headline ?? "ste-lint"), 0, 0));

      const findings = data.findings ?? [];
      const shown = expanded ? findings : findings.slice(0, 6);
      for (const finding of shown) {
        const mark = finding.severity === "error" ? theme.fg("error", "✗") : theme.fg("warning", "!");
        const where = finding.line ? theme.fg("dim", `L${finding.line}`) : theme.fg("dim", "  ");
        box.addChild(new tui.Text(`${mark} ${where} ${finding.message}`, 0, 0));
      }
      if (!expanded && findings.length > shown.length) {
        box.addChild(new tui.Text(theme.fg("dim", `… ${findings.length - shown.length} more (expand the entry)`), 0, 0));
      }
      if (expanded && data.repair?.length) {
        box.addChild(new tui.Text(theme.fg("accent", "Fixes"), 0, 0));
        for (const line of data.repair) box.addChild(new tui.Text(theme.fg("dim", `- ${line}`), 0, 0));
      }
      return box;
    });
  }

  // The footer entry is the load proof and the switch state in one place.
  pi.on?.("session_start", async (_event, ctx) => showStatus(ctx));

  // Remember what started the run: only a typed prompt counts as a user run.
  pi.on?.("before_agent_start", async (event) => {
    state.startedByUser = event.messageType === "user";
    if (state.startedByUser) {
      state.repairsThisRun = 0;
      state.handledIds.clear();
    }
  });

  pi.on?.("agent_before_settle", async (event, ctx) => {
    const { entryId, message } = lastAssistant(ctx);
    const verdict = evaluateGuard({
      enabled: state.enabled,
      outcome: event.outcome,
      canContinue: event.context?.canContinue,
      mode: ctx.mode,
      startedByUser: state.startedByUser,
      message,
      messageEntryId: entryId,
      handledIds: state.handledIds,
      repairsThisRun: state.repairsThisRun,
      maxRepairs: MAX_REPAIRS_PER_RUN,
    });
    if (!verdict.allow) {
      debugLog({ event: "settle", decision: "skip", reason: verdict.reason, enabled: state.enabled, mode: ctx.mode, startedByUser: state.startedByUser });
      return undefined;
    }

    const text = assistantText(message);
    const result = lint(text);
    if (result.score === null || result.score >= state.threshold) {
      debugLog({ event: "settle", decision: "skip", reason: "score-ok", score: result.score, threshold: state.threshold, language: result.language });
      return undefined;
    }

    const fixes = repairInstructions(result, { max: 8 });
    if (!fixes.length) return undefined;

    debugLog({ event: "settle", decision: "repair", score: result.score, threshold: state.threshold, language: result.language, fixes: fixes.length });
    state.handledIds.add(entryId);
    state.repairsThisRun += 1;
    return {
      continue: true,
      entries: [
        {
          type: "custom_message",
          customType: "ste-guard",
          content: repairPrompt(result, fixes),
          display: true,
          details: {
            score: result.score,
            grade: result.grade,
            language: result.language,
            fixes,
          },
        },
      ],
    };
  });

  pi.registerCommand("ste-lint", {
    description: "Check the last answer for simplified technical language (usage: /ste-lint [en|de])",
    handler: async (args, ctx) => {
      const requested = (args ?? "").trim().toLowerCase();
      if (requested && !["en", "de", "auto"].includes(requested)) {
        ctx.ui.notify(`Unknown language "${requested}". Use en, de or auto.`, "warning");
        return;
      }

      const { message } = lastAssistant(ctx);
      const text = assistantText(message);
      if (!text) {
        ctx.ui.notify("No assistant answer to check.", "warning");
        return;
      }

      const result = lint(text, requested ? { language: requested } : undefined);
      const findings = collectFindings(result);
      const data = {
        headline: headline(result),
        language: result.language,
        score: result.score,
        grade: result.grade,
        gradeLabel: result.gradeLabel,
        findings,
        repair: repairInstructions(result),
      };

      if (tui?.Box) {
        pi.appendEntry("ste-lint", data);
      } else {
        const lines = [data.headline, ...findings.slice(0, 5).map((finding) => `- ${finding.message}`)];
        ctx.ui.notify(lines.join("\n"), result.metrics.errors ? "warning" : "info");
      }
    },
  });

  pi.registerCommand("ste-guard", {
    description: "Automatic STE repair after an answer (usage: /ste-guard [on|off|<score>])",
    handler: async (args, ctx) => {
      const [first, second] = (args ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);

      if (!first) {
        const status = state.enabled ? `an, Schwelle ${state.threshold}` : "aus";
        showStatus(ctx);
        ctx.ui.notify(`ste-guard: ${status}`, "info");
        return;
      }
      if (first === "on" || first === "off") {
        state.enabled = first === "on";
        const threshold = Number(second);
        if (Number.isFinite(threshold) && threshold > 0 && threshold <= 100) state.threshold = threshold;
        if (!state.enabled) {
          state.handledIds.clear();
          state.repairsThisRun = 0;
        }
        const status = state.enabled ? `an, Schwelle ${state.threshold}` : "aus";
        showStatus(ctx);
        ctx.ui.notify(`ste-guard: ${status}`, "info");
        return;
      }
      if (Number.isFinite(Number(first)) && Number(first) > 0 && Number(first) <= 100) {
        state.threshold = Number(first);
        state.enabled = true;
        showStatus(ctx);
        ctx.ui.notify(`ste-guard: an, Schwelle ${state.threshold}`, "info");
        return;
      }
      ctx.ui.notify("Usage: /ste-guard [on|off|80]", "warning");
    },
  });

  return { state };
}
