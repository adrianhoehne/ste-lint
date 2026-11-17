/**
 * Gate logic for the repair hook.
 *
 * No pi imports and no session state: every decision is made from the values
 * that `index.js` passes in. That keeps the eight conditions testable without a
 * running session, which is the only way to be sure the hook stays out of
 * subagent runs, tool chains and machine-readable modes.
 */

/** Text blocks of an assistant message, joined. Thinking and tool calls are ignored. */
export function assistantText(message) {
  const blocks = message?.content ?? [];
  return blocks
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

export function hasToolCall(message) {
  const blocks = message?.content ?? [];
  return blocks.some((block) => block?.type === "toolCall");
}

/** Share of characters that stand in a fenced code block. 1 means "all code". */
export function codeShare(text) {
  const source = String(text ?? "");
  if (!source.trim()) return 1;
  let inside = 0;
  let inFence = false;
  for (const line of source.split("\n")) {
    const isFence = /^\s*(?:```|~~~)/.test(line);
    if (isFence) inFence = !inFence;
    if (isFence || inFence) inside += line.length + 1;
  }
  return Math.min(1, inside / (source.length || 1));
}

/**
 * Decide whether the hook may repair this settle.
 *
 * Every gate has a reason, so a debug log says why the hook stayed out.
 *
 * @returns {{ allow: boolean, reason: string }}
 */
export function evaluateGuard({
  enabled = false,
  outcome,
  canContinue,
  mode,
  startedByUser = false,
  message,
  messageEntryId,
  handledIds = new Set(),
  repairsThisRun = 0,
  maxRepairs = 1,
  minProseShare = 0.5,
} = {}) {
  if (!enabled) return { allow: false, reason: "disabled" };
  if (outcome !== "completed") return { allow: false, reason: `outcome:${outcome ?? "unknown"}` };
  if (canContinue === false) return { allow: false, reason: "cannot-continue" };
  if (mode !== "tui") return { allow: false, reason: `mode:${mode ?? "unknown"}` };
  if (!startedByUser) return { allow: false, reason: "not-a-user-run" };
  if (!message) return { allow: false, reason: "no-message" };
  if (hasToolCall(message)) return { allow: false, reason: "has-tool-call" };
  if (!messageEntryId || handledIds.has(messageEntryId)) return { allow: false, reason: "already-handled" };
  if (repairsThisRun >= maxRepairs) return { allow: false, reason: "repair-limit" };

  const text = assistantText(message);
  if (!text) return { allow: false, reason: "no-text" };
  if (1 - codeShare(text) < minProseShare) return { allow: false, reason: "mostly-code" };

  return { allow: true, reason: "allow" };
}
