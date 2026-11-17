/**
 * The engine: segment, check, add document-level findings, score.
 * One engine holds one set of language packs.
 */

import { segment } from "./segment.js";
import { buildContext, checkUnit, findMatches, termPattern } from "./rules.js";
import { message } from "./messages.js";
import { detectorsFor, detectLanguage } from "./language.js";

// Score weights: one error in a sentence costs a full sentence, a warning a
// third. Document findings cost a fixed share of the score.
const UNIT_ERROR = 1;
const UNIT_WARN = 0.3;
const DOC_ERROR = 0.06;
const DOC_WARN = 0.03;

export function createEngine({ packs, language = "auto", limits } = {}) {
  if (!packs || !Object.keys(packs).length) throw new Error("createEngine: no language packs given");

  const contexts = new Map(Object.entries(packs).map(([code, pack]) => [code, buildContext(pack, { limits })]));
  const detectors = detectorsFor(packs);
  const fallback = contexts.has(language) ? language : Object.keys(packs)[0];

  function lint(text, options = {}) {
    const source = String(text ?? "");
    const requested = options.language ?? language;
    const wanted = requested && requested !== "auto" ? requested : (detectLanguage(source, detectors) ?? fallback);
    // An unknown language code falls back instead of failing: a wrong code must
    // not stop a check. The result reports the language that was really used.
    const code = contexts.has(wanted) ? wanted : fallback;
    const ctx = contexts.get(code);
    const pack = packs[code];

    const { lines, units, unterminatedCode } = segment(source, pack);
    for (const unit of units) checkUnit(unit, ctx);

    const docIssues = [];
    const addDocIssue = (rule, severity, fields = {}) => {
      docIssues.push({
        rule,
        severity,
        message: message(ctx.messages, rule, fields),
        vars: fields,
        start: fields.start,
        end: fields.end,
      });
    };

    if (unterminatedCode) addDocIssue("UNTERMINATED_CODE", "warn", { line: unterminatedCode.line });

    if (ctx.requireUppercaseLabels) {
      for (const line of lines) {
        if (!line.label) continue;
        const word = String(line.label).replace(/[^\p{L}]/gu, "");
        if (word && word !== word.toUpperCase()) addDocIssue("LABEL_CASE", "warn", { label: word });
      }
    }

    // Synonym drift: one thing must have one name across the whole document.
    const documentText = units.map((unit) => unit.masked).join("\n");
    for (const group of ctx.drift) {
      // Report the spelling that appears in the text, so German nouns stay
      // capitalised: "Motor", not "motor".
      const variants = [];
      for (const term of group) {
        const hits = findMatches(documentText, termPattern(term));
        if (hits.length) variants.push({ term, count: hits.length, surface: hits[0].text });
      }
      if (variants.length < 2) continue;
      variants.sort((a, b) => b.count - a.count);
      const preferred = variants[0];
      const names = variants.map((entry) => `"${entry.surface}"`).join(", ");
      addDocIssue("DRIFT", "error", { names, keep: preferred.surface });
      for (const unit of units) {
        for (const variant of variants) {
          if (variant === preferred) continue;
          const hit = findMatches(unit.masked, termPattern(variant.term))[0];
          if (!hit) continue;
          unit.issues.push({
            rule: "DRIFT_TERM",
            severity: "warn",
            message: message(ctx.messages, "DRIFT_TERM", { term: hit.text, keep: preferred.surface }),
            vars: { term: hit.text, keep: preferred.surface },
            term: hit.text,
            suggestion: preferred.surface,
            start: unit.start + hit.index,
            end: unit.start + hit.end,
          });
        }
        unit.issues.sort((a, b) => a.start - b.start || a.end - b.end);
      }
    }

    // Paragraph length, ignoring steps and list items.
    const byParagraph = new Map();
    for (const unit of units) {
      if (unit.isStep || unit.isList) continue;
      const list = byParagraph.get(unit.para) ?? [];
      list.push(unit);
      byParagraph.set(unit.para, list);
    }
    for (const list of byParagraph.values()) {
      if (list.length > ctx.limits.paragraph) {
        addDocIssue("PARAGRAPH", "warn", { count: list.length, limit: ctx.limits.paragraph });
      }
    }

    // One instruction per step: more than one sentence in a step breaks it.
    const byStepLine = new Map();
    for (const unit of units) {
      if (!unit.isStep) continue;
      const list = byStepLine.get(unit.line) ?? [];
      list.push(unit);
      byStepLine.set(unit.line, list);
    }
    for (const list of byStepLine.values()) {
      if (list.length > 1) addDocIssue("STEP_SENTENCES", "warn", { count: list.length });
    }

    const issues = units.flatMap((unit) => unit.issues);
    const count = (predicate) => issues.filter(predicate).length;
    const totalWords = units.reduce((sum, u) => sum + u.words, 0);
    const metrics = {
      words: totalWords,
      sentences: units.length,
      procedural: units.filter((unit) => unit.procedural).length,
      descriptive: units.filter((unit) => !unit.procedural).length,
      avgWords: units.length ? +(totalWords / units.length).toFixed(1) : 0,
      maxWords: units.length ? Math.max(...units.map((unit) => unit.words)) : 0,
      errors: count((i) => i.severity === "error"),
      warnings: count((i) => i.severity === "warn"),
      overLimit: count((i) => i.rule === "LENGTH"),
      multiAction: count((i) => i.rule === "MULTI_ACTION"),
      passive: count((i) => i.rule === "PASSIVE"),
      passiveState: count((i) => i.rule === "PASSIVE_STATE"),
      ing: count((i) => i.rule === "ING"),
      unapproved: count((i) => i.rule === "WORD"),
      phrases: count((i) => i.rule === "PHRASE"),
      fluff: count((i) => i.rule === "FLUFF"),
      driftTerms: count((i) => i.rule === "DRIFT_TERM"),
      drift: docIssues.filter((d) => d.rule === "DRIFT").length,
      longParas: docIssues.filter((d) => d.rule === "PARAGRAPH").length,
      stepSentences: docIssues.filter((d) => d.rule === "STEP_SENTENCES").length,
    };

    let score = null;
    let grade = "empty";
    if (units.length) {
      const unitPenalty =
        units.reduce(
          (sum, u) => sum + Math.min(1, u.issues.reduce((s, i) => s + (i.severity === "error" ? UNIT_ERROR : UNIT_WARN), 0)),
          0,
        ) / units.length;
      const docPenalty = docIssues.reduce((sum, d) => sum + (d.severity === "error" ? DOC_ERROR : DOC_WARN), 0);
      score = Math.max(0, Math.min(100, Math.round(100 * (1 - unitPenalty - docPenalty))));
      grade = score >= 90 ? "ready" : score >= 70 ? "close" : score >= 40 ? "work" : "not";
    }

    return {
      language: code,
      lines,
      units,
      docIssues,
      metrics,
      score,
      grade,
      gradeLabel: ctx.messages.grades?.[grade] ?? grade,
      messages: ctx.messages,
    };
  }

  return { lint, packs, contexts, detectors, languages: Object.keys(packs) };
}
