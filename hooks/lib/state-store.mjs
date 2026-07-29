import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { createRedState } from "../../runtime/protocol.js";

const COMMON_KEYS = new Set(["mode", "grantedAt", "grantedByUserEntry"]);
const MODE_KEYS = {
  red: new Set([...COMMON_KEYS, "resetReason"]),
  yellow: new Set([...COMMON_KEYS, "planningPaths"]),
  green: new Set([...COMMON_KEYS, "scope", "scopeEnforcement", "allowedPaths", "releasePolicy"]),
};

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(state, allowed) {
  return Object.keys(state).every((key) => allowed.has(key));
}

function isStringArray(value, { allowEmpty = true } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(isNonEmptyString);
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  const prototype = Object.getPrototypeOf(state);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (!isNonEmptyString(state.grantedAt)) return false;
  if (state.grantedByUserEntry !== undefined && !isNonEmptyString(state.grantedByUserEntry)) return false;

  if (state.mode === "red") {
    return hasOnlyKeys(state, MODE_KEYS.red) && isNonEmptyString(state.resetReason);
  }

  if (state.mode === "yellow") {
    return hasOnlyKeys(state, MODE_KEYS.yellow) && isStringArray(state.planningPaths);
  }

  if (state.mode !== "green" || !hasOnlyKeys(state, MODE_KEYS.green)) return false;
  if (!isNonEmptyString(state.scope)) return false;
  if (!new Set(["semantic", "path-bound"]).has(state.scopeEnforcement)) return false;
  if (state.releasePolicy !== undefined && state.releasePolicy !== "manual") return false;
  if (state.scopeEnforcement === "path-bound") {
    return state.releasePolicy === undefined && isStringArray(state.allowedPaths, { allowEmpty: false });
  }
  return state.allowedPaths === undefined;
}

function assertValidState(state) {
  if (!validateState(state)) throw new TypeError("invalid session state");
}

export function sessionFile(dataDir, sessionId) {
  if (!isNonEmptyString(dataDir)) throw new TypeError("dataDir must be a non-empty string");
  if (!isNonEmptyString(sessionId)) throw new TypeError("sessionId must be a non-empty string");

  const root = resolve(dataDir);
  const digest = createHash("sha256").update(sessionId).digest("hex");
  const file = resolve(root, `${digest}.json`);
  const rel = relative(root, file);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("session path resolves outside plugin data root");
  }
  return file;
}

export async function loadSession({ dataDir, sessionId, now } = {}) {
  try {
    const state = JSON.parse(await readFile(sessionFile(dataDir, sessionId), "utf8"));
    assertValidState(state);
    return state;
  } catch {
    return createRedState("startup", now);
  }
}

export async function saveSession({ dataDir, sessionId, state } = {}) {
  assertValidState(state);
  const file = sessionFile(dataDir, sessionId);
  const root = resolve(dataDir);
  await mkdir(root, { recursive: true });

  const temporary = resolve(root, `.${createHash("sha256").update(sessionId).digest("hex")}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  const rel = relative(root, temporary);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("temporary session path resolves outside plugin data root");
  }

  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function resetSession({ dataDir, sessionId, reason, now } = {}) {
  const state = createRedState(reason, now);
  await saveSession({ dataDir, sessionId, state });
  return state;
}
