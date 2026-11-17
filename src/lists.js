/**
 * Word lists are plain JSON files. Read them, validate them, merge your own
 * additions into them, hand the result to the engine.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Directory that holds the built-in packs: en.json, de.json. */
export const LISTS_DIR = resolve(HERE, "..", "lists");

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/** Read one JSON file and check the fields the engine needs. */
export function readListJson(file) {
  const filePath = isAbsolute(file) ? file : resolve(file);
  if (!existsSync(filePath)) throw new Error(`ste-lint: list file not found: ${filePath}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`ste-lint: cannot parse ${filePath}: ${error.message}`);
  }
  return validatePack(parsed, filePath);
}

export function validatePack(raw, source = "list") {
  if (!isPlainObject(raw)) throw new Error(`ste-lint: ${source} must contain a JSON object`);
  if (typeof raw.code !== "string" || !raw.code) throw new Error(`ste-lint: ${source} needs a "code" string`);
  if (!isPlainObject(raw.messages)) throw new Error(`ste-lint: ${source} needs a "messages" object`);
  for (const key of ["unapproved", "phrases"]) {
    if (raw[key] !== undefined && !isPlainObject(raw[key])) throw new Error(`ste-lint: ${source}.${key} must be an object`);
  }
  for (const key of ["fluff", "drift", "abbreviations"]) {
    if (raw[key] !== undefined && !Array.isArray(raw[key])) throw new Error(`ste-lint: ${source}.${key} must be an array`);
  }
  return raw;
}

/** Load packs by language code. `dir` defaults to the built-in list folder. */
export function loadLists(codes = ["en", "de"], dir = LISTS_DIR) {
  const result = {};
  for (const code of codes) result[code] = readListJson(join(dir, `${code}.json`));
  return result;
}

/**
 * Deep-merge `extra` into `base` without mutating either.
 * Objects merge key by key, arrays append the entries that are not there yet,
 * everything else is replaced.
 */
export function mergeLists(base, extra) {
  if (!isPlainObject(extra)) return base;
  const result = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(extra)) {
    const current = result[key];
    if (Array.isArray(value) && Array.isArray(current)) {
      const added = value.filter((entry) => !current.some((existing) => JSON.stringify(existing) === JSON.stringify(entry)));
      result[key] = [...current, ...added];
    } else if (isPlainObject(value) && isPlainObject(current)) {
      result[key] = mergeLists(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
