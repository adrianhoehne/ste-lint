/**
 * Decide whether a sentence is an instruction (procedural) or a description.
 *
 * This drives the word limit (20 vs 25) and some severities, so it must be
 * data-driven: the imperative forms live in the language pack. A step or list
 * item is procedural by construction.
 */

import { firstToken, tokens } from "./text.js";

const cache = new WeakMap();

function profileFor(pack) {
  let profile = cache.get(pack);
  if (profile) return profile;
  const procedural = pack?.procedural ?? {};
  profile = {
    imperative: new Set((procedural.imperative ?? []).map((word) => word.toLowerCase())),
    negativePrefixes: (procedural.negativePrefixes ?? []).map((word) => word.toLowerCase()),
    imperativeSuffixes: procedural.imperativeSuffixes ?? [],
    pronouns: (procedural.pronouns ?? []).map((word) => word.toLowerCase()),
  };
  cache.set(pack, profile);
  return profile;
}

/** True when the token is a command form in this language. */
export function isImperativeToken(token, pack) {
  return profileFor(pack).imperative.has(String(token).toLowerCase());
}

export function isProcedural(sentence, pack) {
  const profile = profileFor(pack);
  const lower = String(sentence ?? "").trim().toLowerCase();
  if (!lower) return false;

  for (const prefix of profile.negativePrefixes) {
    const after = lower.slice(prefix.length, prefix.length + 1);
    if (lower.startsWith(prefix) && (after === "" || after === " " || after === "'" || after === "’")) return true;
  }

  const firstWord = firstToken(lower).toLowerCase();
  if (!firstWord) return false;
  if (profile.imperative.has(firstWord)) return true;

  // German: "Entfernen Sie ..." — a verb form plus the pronoun in the first words.
  if (profile.imperativeSuffixes.length && profile.pronouns.length && firstWord.length > 3) {
    if (profile.imperativeSuffixes.some((suffix) => firstWord.endsWith(suffix))) {
      const firstTokens = tokens(lower).slice(0, 5).map((token) => token.lower);
      if (firstTokens.some((token) => profile.pronouns.includes(token))) return true;
    }
  }
  return false;
}
