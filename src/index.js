/**
 * ste-lint — check text for simplified technical language.
 *
 * English follows ASD-STE100 rules that can be checked mechanically. German is
 * an analogue, not an ASD specification: ASD-STE100 exists for English only.
 *
 *   import { lint, repairInstructions } from "./src/index.js";
 *   const result = lint("1. Acquire the cover and check the lamp and the light.");
 *   result.score, result.grade, result.units, result.docIssues
 */

import { createEngine } from "./engine.js";
import { detectLanguage, detectorsFor } from "./language.js";
import { loadLists, LISTS_DIR, mergeLists, readListJson, validatePack } from "./lists.js";
import { repairInstructions } from "./repair.js";
import { DEFAULT_LIMITS } from "./rules.js";
import { segment } from "./segment.js";
import { countWords, firstWords, maskInline, splitSentences } from "./text.js";

/** Built-in language packs as raw JSON objects: { en, de }. */
export const lists = loadLists();

/** Engine with the built-in packs and automatic language detection. */
export const engine = createEngine({ packs: lists });

/** Check text. Options: { language: "auto" | "en" | "de" }. */
export function lint(text, options) {
  return engine.lint(text, options);
}

/**
 * Build an engine with your own words on top of the built-in lists.
 *
 *   const linter = createLinter({ extraLists: { de: readListJson("./woerter.json") } });
 *   linter.lint("Text")
 */
export function createLinter({ extraLists = {}, languages = Object.keys(lists), language = "auto", limits } = {}) {
  const packs = {};
  for (const code of languages) {
    packs[code] = mergeLists(lists[code] ?? { code, messages: {} }, extraLists[code]);
    validatePack(packs[code], `pack "${code}"`);
  }
  return createEngine({ packs, language, limits });
}

export { createEngine, detectLanguage, detectorsFor, LISTS_DIR, loadLists, mergeLists, readListJson };
export { repairInstructions, segment, splitSentences, countWords, maskInline, firstWords };
export const LIMITS = DEFAULT_LIMITS;
