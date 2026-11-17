/**
 * Turn findings into short fix instructions for a model or a user.
 * Every sentence comes from the language pack, so it matches the checked text.
 */

import { message } from "./messages.js";

const severityRank = (issue) => (issue.severity === "error" ? 0 : 1);

export function repairInstructions(result, { max = 12 } = {}) {
  const templates = result?.messages?.repair ?? {};
  const lines = [];
  const seen = new Set();

  const findings = [...(result?.docIssues ?? []), ...(result?.units ?? []).flatMap((unit) => unit.issues)];
  findings.sort((a, b) => severityRank(a) - severityRank(b) || (a.start ?? 0) - (b.start ?? 0));

  for (const issue of findings) {
    if (lines.length >= max) break;
    if (!templates[issue.rule]) continue;
    const text = message(templates, issue.rule, issue.vars ?? {});
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return lines;
}
