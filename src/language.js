import { escapeRegExp } from "./text.js";

/**
 * Language detection from function words and characteristic characters.
 * No model, no dependency: correct for any text long enough to have articles.
 */

export function detectorsFor(packs) {
  return Object.entries(packs).map(([code, pack]) => ({
    code,
    words: (pack.detect?.words ?? []).map((word) => String(word).toLowerCase()),
    chars: (pack.detect?.chars ?? []).map((connective) => String(connective).toLowerCase()),
  }));
}

/** Returns the best matching language code, or null when the text is unclear. */
export function detectLanguage(text, detectors = []) {
  const lower = ` ${String(text ?? "").toLowerCase()} `;
  let best = null;
  let bestScore = 0;
  let tie = false;

  for (const detector of detectors) {
    let score = 0;
    for (const word of detector.words) {
      const wordPattern = new RegExp(`(?<![\\p{L}])${escapeRegExp(word)}(?![\\p{L}])`, "gu");
      const found = lower.match(wordPattern);
      if (found) score += found.length;
    }
    for (const char of detector.chars) {
      score += 3 * (lower.split(char).length - 1);
    }
    if (score > bestScore) {
      best = detector.code;
      bestScore = score;
      tie = false;
    } else if (score === bestScore && score > 0 && detector.code !== best) {
      tie = true;
    }
  }
  return bestScore === 0 || tie ? null : best;
}
