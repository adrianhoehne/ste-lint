/**
 * Structure: split a document into lines (code, heading, text) and sentence
 * units with absolute character offsets.
 */

import { countWords, escapeRegExp, maskInline, splitSentences } from "./text.js";
import { isProcedural } from "./procedural.js";

const FENCE = /^\s*(?:```|~~~)/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const BOLD_ONLY = /^(?:\*\*|__)(.+?)(?:\*\*|__):?$/;
const STEP = /^(?:(?:step|schritt)\s+\d+\s*[:.–-]\s*|\d+[.)]\s+)/i;
const LIST = /^(?:[-*+•]|[a-z][.)])\s+/i;

function labelPattern(pack) {
  const labels = pack?.labels ?? {};
  const words = [...(labels.warning ?? []), ...(labels.caution ?? []), ...(labels.note ?? [])];
  if (!words.length) return null;
  const escaped = words.map(escapeRegExp);
  return new RegExp(`^(${escaped.join("|")})\\s*[:–-]\\s*`, "i");
}

export function segment(text, pack = {}) {
  const source = String(text ?? "").replace(/\r\n?/g, "\n");
  const lines = [];
  const units = [];
  const abbreviations = pack.abbreviations ?? [];
  const labelRe = labelPattern(pack);

  let inCode = false;
  let codeStartLine = 0;
  let para = 0;
  let prevType = "blank";
  let pos = 0;

  for (const raw of source.split("\n")) {
    const lineStart = pos;
    pos += raw.length + 1;
    const lineNo = lines.length + 1;

    if (FENCE.test(raw)) {
      if (!inCode) codeStartLine = lineNo;
      inCode = !inCode;
      lines.push({ type: "code", raw, line: lineNo });
      continue;
    }
    if (inCode) {
      lines.push({ type: "code", raw, line: lineNo });
      continue;
    }
    if (!raw.trim()) {
      lines.push({ type: "blank", line: lineNo });
      if (prevType !== "blank") para++;
      prevType = "blank";
      continue;
    }

    const indent = raw.length - raw.trimStart().length;
    const rest = raw.slice(indent);

    const markdownHeading = HEADING.exec(rest);
    const boldLine = markdownHeading ? null : BOLD_ONLY.exec(rest);
    const headingText = markdownHeading?.[2] ?? boldLine?.[1];
    if (headingText) {
      lines.push({ type: "heading", text: headingText, line: lineNo });
      para++;
      prevType = "heading";
      continue;
    }

    let cursor = indent;
    let isStep = false;
    let isList = false;
    let prefix = "";
    const stepMatch = STEP.exec(raw.slice(cursor));
    if (stepMatch) {
      isStep = true;
      prefix = stepMatch[0];
    } else {
      const listMatch = LIST.exec(raw.slice(cursor));
      if (listMatch) {
        isList = true;
        prefix = listMatch[0];
      }
    }
    cursor += prefix.length;

    let label = "";
    if (labelRe) {
      const labelMatch = labelRe.exec(raw.slice(cursor));
      if (labelMatch) {
        label = labelMatch[0];
        cursor += label.length;
      }
    }

    const bodyRaw = raw.slice(cursor);
    if (!isStep && !isList && !label && /:\s*$/.test(bodyRaw.trim()) && countWords(bodyRaw) <= 8) {
      lines.push({ type: "heading", text: bodyRaw.trim(), line: lineNo });
      para++;
      prevType = "heading";
      continue;
    }

    if (isStep || isList || prevType !== "text") para++;

    const masked = maskInline(bodyRaw);
    const bodyOffset = lineStart + cursor;
    const unitIds = [];
    for (const sentence of splitSentences(masked, abbreviations)) {
      const unit = {
        id: units.length,
        line: lineNo,
        para,
        isStep,
        isList,
        label,
        text: bodyRaw.slice(sentence.start, sentence.end),
        masked: sentence.text,
        start: bodyOffset + sentence.start,
        end: bodyOffset + sentence.end,
        words: countWords(sentence.text),
        issues: [],
      };
      unit.procedural = isStep || isProcedural(unit.masked, pack);
      units.push(unit);
      unitIds.push(unit.id);
    }

    lines.push({ type: "text", prefix, label, isStep, unitIds, line: lineNo });
    prevType = isStep || isList ? "list" : "text";
  }

  return { lines, units, unterminatedCode: inCode ? { line: codeStartLine } : null };
}
