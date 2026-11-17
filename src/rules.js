/**
 * Sentence rules. Each rule pushes findings with absolute offsets into the
 * document the caller passed to lint(), so a plugin can highlight them.
 */

import { escapeRegExp, firstToken, firstWords, tokens } from "./text.js";
import { isImperativeToken } from "./procedural.js";
import { message } from "./messages.js";
import { stems } from "./stems.js";

export const DEFAULT_LIMITS = { procedural: 20, descriptive: 25, paragraph: 6 };

/** Word-boundary regex for a term (single word or phrase). */
export function termPattern(term) {
  const body = String(term)
    .trim()
    .split(/\s+/)
    .map(escapeRegExp)
    .join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "iu");
}

export function findMatches(text, pattern) {
  const results = [];
  const scanner = pattern.flags.includes("g") ? pattern : new RegExp(pattern.source, pattern.flags + "g");
  scanner.lastIndex = 0;
  let match;
  while ((match = scanner.exec(text))) {
    results.push({ index: match.index, end: match.index + match[0].length, text: match[0] });
    if (!match[0].length) scanner.lastIndex++;
  }
  return results;
}

const containsPhrase = (haystack, needle) => termPattern(needle).test(haystack);

/** Drop a short name when a longer name of the same group contains it. */
function normalizeGroup(group) {
  const terms = [...new Set((group ?? []).map((term) => String(term).toLowerCase()))];
  return terms.filter((term) => !terms.some((other) => other !== term && containsPhrase(other, term)));
}

function passiveProfile(config) {
  if (!config) return null;
  const toSet = (list) => new Set((list ?? []).map((word) => String(word).toLowerCase()));
  return {
    auxiliaries: toSet(config.auxiliaries),
    stateAuxiliaries: toSet(config.stateAuxiliaries),
    skipWords: toSet(config.skipWords),
    notParticiples: toSet(config.notParticiples),
    stateAdjectives: toSet(config.stateAdjectives),
    irregularParticiples: toSet(config.irregularParticiples),
    participleSuffixes: (config.participleSuffixes ?? []).map((suffix) => suffix.toLowerCase()),
    participlePrefixes: (config.participlePrefixes ?? []).map((prefix) => prefix.toLowerCase()),
    participlePattern: config.participlePattern ? new RegExp(config.participlePattern, "iu") : null,
    adverbPattern: config.adverbPattern ? new RegExp(config.adverbPattern, "iu") : null,
    maxGap: config.maxGap ?? 3,
  };
}

export function buildContext(pack, options = {}) {
  const entries = Object.entries(pack.unapproved ?? {});
  const singleWordEntries = entries.filter(([word]) => !/\s/.test(word.trim()));
  // A multi-word entry in "unapproved" is handled like a phrase, so a list from
  // a spreadsheet can land in either field without a silent gap.
  const multiWordEntries = entries.filter(([word]) => /\s/.test(word.trim()));

  return {
    pack,
    limits: { ...DEFAULT_LIMITS, ...(pack.limits ?? {}), ...(options.limits ?? {}) },
    messages: pack.messages ?? {},
    inflection: pack.inflection ?? null,
    unapproved: new Map(singleWordEntries.map(([word, suggestion]) => [word.toLowerCase(), suggestion])),
    phrases: [...Object.entries(pack.phrases ?? {}), ...multiWordEntries].map(([term, suggestion]) => ({
      term: term.toLowerCase(),
      suggestion,
      re: termPattern(term),
    })),
    fluff: (pack.fluff ?? [])
      .map((term) => ({ term: String(term).toLowerCase(), re: termPattern(term) }))
      .sort((a, b) => b.term.length - a.term.length),
    drift: (pack.drift ?? []).map(normalizeGroup).filter((group) => group.length >= 2),
    passive: passiveProfile(pack.passive),
    ing: pack.ing
      ? {
          minLength: pack.ing.minLength ?? 5,
          exceptions: new Set((pack.ing.exceptions ?? []).map((word) => String(word).toLowerCase())),
        }
      : null,
    connectives: new Set((pack.procedural?.connectives ?? []).map((connective) => String(connective).toLowerCase())),
    connectiveSkip: new Set((pack.procedural?.connectiveSkip ?? []).map((connective) => String(connective).toLowerCase())),
    requireUppercaseLabels: (pack.labels ?? {}).requireUppercase !== false,
  };
}

function isParticiple(word, config) {
  if (config.irregularParticiples.has(word)) return true;
  if (config.participlePattern?.test(word)) return true;
  for (const suffix of config.participleSuffixes) {
    if (word.endsWith(suffix) && word.length > suffix.length + 2) return true;
  }
  for (const prefix of config.participlePrefixes) {
    if (word.startsWith(prefix) && /(?:t|en)$/.test(word) && word.length >= prefix.length + 4) return true;
  }
  return false;
}

/** "participle" (a real passive) | "state" (adjective from a participle) | null. */
function classifyParticiple(word, config, auxiliary) {
  if (config.notParticiples.has(word)) return null;
  if (!isParticiple(word, config)) return null;
  if (config.stateAdjectives.has(word) && config.stateAuxiliaries.has(auxiliary)) return "state";
  return "participle";
}

/** First auxiliary-plus-participle pair, or null. */
function detectPassive(wordTokens, config) {
  for (let i = 0; i < wordTokens.length; i++) {
    if (!config.auxiliaries.has(wordTokens[i].lower)) continue;
    const lastIndex = Math.min(wordTokens.length - 1, i + config.maxGap);
    for (let j = i + 1; j <= lastIndex; j++) {
      const token = wordTokens[j];
      if (config.skipWords.has(token.lower)) continue;
      if (config.adverbPattern?.test(token.lower)) continue;
      const kind = classifyParticiple(token.lower, config, wordTokens[i].lower);
      if (!kind) break;
      return { kind, from: wordTokens[i], to: token };
    }
  }
  return null;
}

/** Connective ("and", "then", "und") followed by a command form, or null. */
function detectMultiAction(wordTokens, ctx) {
  for (let i = 0; i < wordTokens.length; i++) {
    if (!ctx.connectives.has(wordTokens[i].lower)) continue;
    let j = i + 1;
    while (j < wordTokens.length && ctx.connectiveSkip.has(wordTokens[j].lower)) j++;
    const next = wordTokens[j];
    if (!next || !isImperativeToken(next.lower, ctx.pack)) continue;
    return { from: wordTokens[i], to: next };
  }
  return null;
}

const sentenceKind = (unit, ctx) =>
  ctx.messages.kinds?.[unit.procedural ? "procedural" : "descriptive"] ??
  (unit.procedural ? "procedural" : "descriptive");

export function checkUnit(unit, ctx) {
  const sentenceHead = firstWords(unit.text);
  const report = (rule, severity, fields = {}) => {
    const vars = { kind: sentenceKind(unit, ctx), head: sentenceHead, ...fields, limit: fields.limit };
    for (const key of Object.keys(vars)) if (vars[key] === undefined) delete vars[key];
    unit.issues.push({
      rule,
      severity,
      message: message(ctx.messages, rule, vars),
      vars,
      term: fields.term,
      suggestion: fields.suggestion,
      start: fields.start ?? unit.start,
      end: fields.end ?? unit.end,
    });
  };

  // LENGTH — 20 words for an instruction, 25 for a description.
  const limit = unit.procedural ? ctx.limits.procedural : ctx.limits.descriptive;
  if (unit.words > limit) report("LENGTH", "error", { words: unit.words, limit });

  // MULTI_ACTION — two instructions joined by "and", "then" or ";".
  if (unit.procedural) {
    const wordTokens = tokens(unit.masked);
    const joined = detectMultiAction(wordTokens, ctx);
    if (joined) {
      report("MULTI_ACTION", "error", {
        term: unit.masked.slice(joined.from.index, joined.to.end).trim(),
        start: unit.start + joined.from.index,
        end: unit.start + joined.to.end,
      });
    } else {
      const semicolon = unit.masked.indexOf(";");
      const after = semicolon >= 0 ? tokens(unit.masked.slice(semicolon + 1))[0] : null;
      if (after && isImperativeToken(after.lower, ctx.pack)) {
        report("MULTI_ACTION", "error", {
          term: unit.masked.slice(semicolon, semicolon + 1 + after.end).trim(),
          start: unit.start + semicolon,
          end: unit.start + semicolon + 1 + after.end,
        });
      }
    }
  }

  // PASSIVE — auxiliary plus participle, with skip words and one adverb allowed.
  if (ctx.passive) {
    const passive = detectPassive(tokens(unit.masked), ctx.passive);
    if (passive) {
      report(passive.kind === "state" ? "PASSIVE_STATE" : "PASSIVE", unit.procedural ? "error" : "warn", {
        term: unit.masked.slice(passive.from.index, passive.to.end),
        start: unit.start + passive.from.index,
        end: unit.start + passive.to.end,
      });
    }
  }

  // ING — sentence starts with an -ing form instead of a command.
  if (ctx.ing) {
    const word = firstToken(unit.masked).toLowerCase();
    if (word.length >= ctx.ing.minLength && word.endsWith("ing") && !ctx.ing.exceptions.has(word)) {
      report("ING", "warn", { term: word, start: unit.start, end: unit.start + word.length });
    }
  }

  // WORD — unapproved vocabulary, matched through the language stems.
  const reported = new Set();
  for (const token of tokens(unit.masked)) {
    if (reported.has(token.lower)) continue;
    for (const stem of stems(token.lower, ctx.inflection)) {
      const suggestion = ctx.unapproved.get(stem);
      if (suggestion === undefined) continue;
      reported.add(token.lower);
      report("WORD", "error", {
        term: token.token,
        suggestion,
        start: unit.start + token.index,
        end: unit.start + token.end,
      });
      break;
    }
  }

  // PHRASE — unapproved multi-word phrases.
  for (const phrase of ctx.phrases) {
    const hits = findMatches(unit.masked, phrase.re);
    if (!hits.length) continue;
    const hit = hits[0];
    report("PHRASE", "error", {
      term: hit.text,
      suggestion: phrase.suggestion,
      start: unit.start + hit.index,
      end: unit.start + hit.end,
    });
  }

  // FLUFF — filler, praise, hedging. Longest term wins to avoid double hits.
  const usedSpans = [];
  for (const fluff of ctx.fluff) {
    for (const hit of findMatches(unit.masked, fluff.re)) {
      if (usedSpans.some((span) => hit.index < span.end && hit.end > span.index)) continue;
      usedSpans.push({ index: hit.index, end: hit.end });
      report("FLUFF", "warn", { term: hit.text, start: unit.start + hit.index, end: unit.start + hit.end });
    }
  }

  unit.issues.sort((a, b) => a.start - b.start || a.end - b.end);
  return unit;
}
