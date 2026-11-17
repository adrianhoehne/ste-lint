/**
 * The guard settings file: <agent-dir>/ste-lint.json.
 *
 * Read once when the extension loads. The extension never writes it, so the
 * switch cannot drift away from what the user put on disk: a restart starts
 * from the file, or from off when there is no file.
 *
 *   { "version": 1, "guard": { "enabled": true, "threshold": 90 } }
 *
 * The file counts as a unit. One broken field disables the whole file, because a
 * mix of file values and defaults is harder to explain than "ignored, reason in
 * the log". A shipped copy of this file is in ../assets/ste-lint.json.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CONFIG_NAME = "ste-lint.json";
export const DEFAULT_GUARD = Object.freeze({ enabled: false, threshold: 90 });
const SUPPORTED_VERSION = 1;

/**
 * <agent-dir>/ste-lint.json. The agent directory is pi's config directory:
 * PI_CODING_AGENT_DIR when set, ~/.pi/agent otherwise. PI_STE_LINT_STATE points
 * at another file as a whole, which the tests use.
 */
export function configPath(env = process.env) {
  const override = (env.PI_STE_LINT_STATE ?? "").trim();
  if (override) return override;
  const agentDir = (env.PI_CODING_AGENT_DIR ?? "").trim() || join(homedir(), ".pi", "agent");
  return join(agentDir, CONFIG_NAME);
}

const isThreshold = (value) => Number.isInteger(value) && value > 0 && value <= 100;
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Read the guard section. Never throws: a missing, unreadable or broken file
 * yields the defaults plus a reason code for the debug log.
 *
 * `source` is "config" when the file supplied both values, "default" otherwise.
 * Reasons: loaded, missing, unreadable, corrupt, version, no-guard, enabled,
 * threshold.
 */
export function readGuardConfig(file = configPath()) {
  const fallback = (reason) => ({ ...DEFAULT_GUARD, source: "default", reason, file });

  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return fallback(error?.code === "ENOENT" ? "missing" : "unreadable");
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return fallback("corrupt");
  }
  if (!isObject(data)) return fallback("corrupt");
  if (data.version !== undefined && data.version !== SUPPORTED_VERSION) return fallback("version");

  const guard = data.guard;
  if (!isObject(guard)) return fallback("no-guard");
  if (typeof guard.enabled !== "boolean") return fallback("enabled");
  if (!isThreshold(guard.threshold)) return fallback("threshold");

  return { enabled: guard.enabled, threshold: guard.threshold, source: "config", reason: "loaded", file };
}
