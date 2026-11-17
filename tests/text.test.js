import test from "node:test";
import assert from "node:assert/strict";

import { countWords, firstWords, maskInline, splitSentences } from "../src/text.js";

test("countWords counts words, not punctuation", () => {
  assert.equal(countWords("do not"), 2);
  assert.equal(countWords("e.g."), 1);
  assert.equal(countWords("air-filter"), 1);
  assert.equal(countWords("12.5 mm"), 2);
  assert.equal(countWords(""), 0);
});

test("splitSentences keeps decimals and versions in one piece", () => {
  const parts = splitSentences("Install v1.2.3 now. Values like 12.5 mm are fine.");
  assert.equal(parts.length, 2);
  assert.equal(parts[0].text, "Install v1.2.3 now.");
});

test("splitSentences does not split on a lowercase continuation", () => {
  assert.equal(splitSentences("Use the tool, e.g. the small one.").length, 1);
});

test("splitSentences returns offsets that point into the original text", () => {
  const text = "First step. Second step.";
  const parts = splitSentences(text);
  assert.equal(parts.length, 2);
  for (const part of parts) assert.equal(text.slice(part.start, part.end), part.text);
});

test("splitSentences keeps a trailing sentence without punctuation", () => {
  const parts = splitSentences("Remove the cap. Then stop");
  assert.deepEqual(parts.map((p) => p.text), ["Remove the cap.", "Then stop"]);
});

test("maskInline replaces code and URLs with spaces of equal length", () => {
  const text = "Run `npm ci` and open https://example.com now.";
  const masked = maskInline(text);
  assert.equal(masked.length, text.length);
  assert.ok(!masked.includes("npm"));
  assert.ok(!masked.includes("example.com"));
  assert.ok(masked.includes("Run"));
});

test("maskInline keeps the label of a markdown link", () => {
  const text = "Open [the cover](https://example.com/x) now.";
  const masked = maskInline(text);
  assert.equal(masked.length, text.length);
  assert.ok(masked.includes("the cover"));
  assert.ok(!masked.includes("example.com"));
});

test("firstWords shortens long sentences", () => {
  assert.equal(firstWords("one two three", 5), "one two three");
  assert.equal(firstWords("one two three four", 2), "one two…");
});
