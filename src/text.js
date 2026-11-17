/**
 * Text helpers: word counting, inline masking, sentence splitting.
 *
 * Every function keeps character offsets valid for the original string.
 * Rules rely on that: a finding points into the text the caller passed in.
 */

// A word for our purposes: starts with a letter or digit, may contain
// apostrophes, dots, underscores, hyphens and slashes ("e.g.", "12.5", "A/B").
const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’._\-/]*/gu;

// A token for command forms and vocabulary: letters only, with inner apostrophes.
const TOKEN_RE = /[\p{L}][\p{L}'’]*/gu;

const PUNCTUATION = ".!?…";
const CLOSERS = "\"'“”„‚‘’»«)]";
const OPENERS = "\"'“”„‚‘’([";
const UPPER_OR_DIGIT = /[\p{Lu}\p{N}]/u;

/** Escape a string so it can be used inside a RegExp source. */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function countWords(text) {
  const words = String(text ?? "").match(WORD_RE);
  return words ? words.length : 0;
}

/** Iterate word tokens with their offsets. */
export function tokens(text) {
  const results = [];
  const tokenPattern = new RegExp(TOKEN_RE.source, TOKEN_RE.flags);
  let match;
  while ((match = tokenPattern.exec(text))) {
    results.push({
      token: match[0],
      lower: match[0].toLowerCase(),
      index: match.index,
      end: match.index + match[0].length,
    });
  }
  return results;
}

export function firstToken(text) {
  const match = /[\p{L}][\p{L}'’]*/u.exec(String(text ?? ""));
  return match ? match[0] : "";
}

/**
 * Replace inline code, link targets and bare URLs with spaces of equal length.
 * Code and URLs are not prose, so rules must not check them — and because the
 * replacement has the same length, every offset still points at the original.
 */
export function maskInline(text) {
  return String(text ?? "").replace(
    /`[^`]*`|!?\[[^\]]*\]\([^)\s]*\)|https?:\/\/[^\s)>\]]+/gu,
    (match) => {
      const link = /^(?:!?\[)([^\]]*)\]/.exec(match);
      if (link) return link[1] + " ".repeat(match.length - link[1].length);
      return " ".repeat(match.length);
    },
  );
}

/**
 * Split into sentences. Returns [{text, start, end}] with offsets into `text`.
 *
 * A boundary is punctuation followed by whitespace and an uppercase letter or
 * digit. That keeps "12.5", "v1.2.3" and "e.g. the" in one piece without a
 * grammar model. Abbreviations that end a sentence ("etc. Next step.") need the
 * explicit list from the language pack.
 */
export function splitSentences(text, abbreviations = []) {
  const source = String(text ?? "");
  const abbreviationSet = new Set(abbreviations.map((abbreviation) => abbreviation.toLowerCase()));
  const results = [];
  let sentenceStart = 0;
  let cursor = 0;

  const collect = (from, to) => {
    let start = from;
    let end = to;
    while (start < end && /\s/.test(source[start])) start++;
    while (end > start && /\s/.test(source[end - 1])) end--;
    if (end > start) results.push({ text: source.slice(start, end), start, end });
  };

  const isAbbreviation = (punctStart, punctEnd) => {
    if (!abbreviationSet.size) return false;
    const before = source.slice(Math.max(0, punctStart - 14), punctStart);
    const word = /[\p{L}.]+$/u.exec(before);
    if (!word) return false;
    const candidate = (word[0] + source.slice(punctStart, punctEnd)).toLowerCase();
    return abbreviationSet.has(candidate);
  };

  while (cursor < source.length) {
    if (!PUNCTUATION.includes(source[cursor])) {
      cursor++;
      continue;
    }

    let punctEnd = cursor;
    while (punctEnd < source.length && PUNCTUATION.includes(source[punctEnd])) punctEnd++;

    let closingEnd = punctEnd;
    while (closingEnd < source.length && CLOSERS.includes(source[closingEnd])) closingEnd++;

    // No whitespace after the punctuation: "12.5", "v1.2.3", first dot of "e.g.".
    if (closingEnd < source.length && !/\s/.test(source[closingEnd])) {
      cursor = closingEnd;
      continue;
    }

    let nextStart = closingEnd;
    while (nextStart < source.length && /\s/.test(source[nextStart])) nextStart++;

    if (nextStart < source.length) {
      let afterOpeners = nextStart;
      while (afterOpeners < source.length && OPENERS.includes(source[afterOpeners])) afterOpeners++;
      const next = source[afterOpeners];

      // A lowercase continuation keeps the sentence together: "e.g. the small one".
      if (next && !UPPER_OR_DIGIT.test(next)) {
        cursor = nextStart;
        continue;
      }
      if (isAbbreviation(cursor, punctEnd)) {
        cursor = nextStart;
        continue;
      }
    }

    collect(sentenceStart, punctEnd);
    sentenceStart = nextStart;
    cursor = nextStart;
  }
  collect(sentenceStart, source.length);
  return results;
}

/** Shorten a sentence for a repair message: "Remove the four screws from…" */
export function firstWords(text, maxWords = 8) {
  const words = String(text ?? "").trim().split(/\s+/);
  if (words.length <= maxWords) return words.join(" ");
  return words.slice(0, maxWords).join(" ") + "…";
}
