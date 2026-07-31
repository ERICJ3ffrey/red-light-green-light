import { isAbsolute, relative, resolve, sep } from "node:path";

import { evaluateToolCall } from "../../runtime/command-policy.js";
import { evaluatePatch } from "../../runtime/patch-policy.js";
import {
  applyUserTransition,
  createRedState,
  detectRelease,
  parseTransitionMessage,
  renderAuthorityContext,
} from "../../runtime/protocol.js";
import { loadSession, resetSession, saveSession } from "./state-store.mjs";

const EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "SubagentStart", "Stop"]);
const RESET_SOURCES = new Set(["startup", "resume", "clear", "fork"]);
const TOOL_NAMES = new Map([
  ["bash", "bash"],
  ["write", "write"],
  ["edit", "edit"],
  ["read", "read"],
  ["glob", "find"],
  ["grep", "grep"],
  ["webfetch", "fetch_content"],
  ["websearch", "web_search"],
  ["askuserquestion", "ask_user"],
  ["apply_patch", "apply_patch"],
]);

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hostFromEnv(env = {}) {
  if (!env || typeof env !== "object") return undefined;
  if (nonEmptyString(env.PLUGIN_DATA)) return "codex";
  if (nonEmptyString(env.CLAUDE_PLUGIN_DATA)) return "claude";
  if (nonEmptyString(env.RLGL_TEST_DATA)) return "test";
  return undefined;
}

function dataDirFromEnv(env, host) {
  if (host === "codex") return env.PLUGIN_DATA;
  if (host === "claude") return env.CLAUDE_PLUGIN_DATA;
  if (host === "test") return env.RLGL_TEST_DATA;
  return undefined;
}

function isInside(root, candidate) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function runtimeInfo(payload, env) {
  if (!plainObject(payload)) throw new TypeError("Malformed hook payload.");
  if (!nonEmptyString(payload.session_id)) throw new TypeError("Hook payload is missing session_id.");
  if (!nonEmptyString(payload.cwd)) throw new TypeError("Hook payload is missing cwd.");

  const host = hostFromEnv(env);
  const dataDir = dataDirFromEnv(env, host);
  if (!host || !nonEmptyString(dataDir)) throw new TypeError("Plugin data directory is unavailable.");
  if (isInside(payload.cwd, dataDir)) throw new TypeError("Plugin state must not be stored in the project.");
  return { host, dataDir, sessionId: payload.session_id, cwd: payload.cwd };
}

function result(output = {}, { exitCode = 0, stderr = "" } = {}) {
  return { exitCode, output, stderr };
}

function contextResult(eventName, state, extra = "", options = {}) {
  const suffix = extra ? `\n\n${extra}` : "";
  return result({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: `${renderAuthorityContext(state)}${suffix}`,
    },
  }, options);
}

function denyResult(reason, options = {}) {
  return result({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: nonEmptyString(reason) ? reason : "Tool call denied by Red Light Green Light.",
    },
  }, options);
}

function failedClosed(eventName, reason = "Hook runtime failed closed.") {
  const red = createRedState("startup");
  const blocking = { exitCode: 2, stderr: `${reason}\n` };
  if (eventName === "PreToolUse") return denyResult("Hook runtime failed closed.", blocking);
  if (eventName === "UserPromptSubmit") return contextResult("UserPromptSubmit", red, "", blocking);
  if (eventName === "Stop") return result({});
  if (eventName === "SessionStart" || eventName === "SubagentStart") {
    return contextResult(eventName, red);
  }
  return contextResult("SessionStart", red, "", blocking);
}

function invalidNormalized(reason) {
  return { ok: false, reason };
}

export function normalizeToolCall(payload) {
  if (!plainObject(payload) || !nonEmptyString(payload.tool_name) || !plainObject(payload.tool_input)) {
    return invalidNormalized("Malformed tool payload.");
  }

  const rawToolName = payload.tool_name.toLowerCase();
  const toolName = TOOL_NAMES.get(rawToolName);
  const unclassified = !toolName;

  const input = { ...payload.tool_input };
  if (unclassified) return { ok: true, toolName: rawToolName, input, unclassified: true };
  if (Object.hasOwn(input, "file_path")) {
    if (Object.hasOwn(input, "path") && input.path !== input.file_path) {
      return invalidNormalized("Tool payload contains conflicting path fields.");
    }
    input.path = input.file_path;
    delete input.file_path;
  }

  if (["write", "edit", "read"].includes(toolName) && !nonEmptyString(input.path)) {
    return invalidNormalized("File tool payload is missing a path.");
  }
  if (["bash", "apply_patch"].includes(toolName) && !nonEmptyString(input.command)) {
    return invalidNormalized("Command tool payload is missing a command.");
  }
  if (toolName === "find" && !nonEmptyString(input.pattern)) {
    return invalidNormalized("Glob payload is missing a pattern.");
  }
  if (toolName === "grep" && !nonEmptyString(input.pattern)) {
    return invalidNormalized("Grep payload is missing a pattern.");
  }
  if (toolName === "fetch_content"
    && !nonEmptyString(input.url)
    && !(Array.isArray(input.urls) && input.urls.length > 0 && input.urls.every(nonEmptyString))) {
    return invalidNormalized("WebFetch payload is missing a URL.");
  }
  if (toolName === "web_search"
    && !nonEmptyString(input.query)
    && !(Array.isArray(input.queries) && input.queries.length > 0 && input.queries.every(nonEmptyString))) {
    return invalidNormalized("WebSearch payload is missing a query.");
  }
  if (toolName === "ask_user" && !(Array.isArray(input.questions) && input.questions.length > 0)) {
    return invalidNormalized("AskUserQuestion payload is missing questions.");
  }

  return { ok: true, toolName, input };
}

async function resetMalformedEvent(eventName, info) {
  try {
    const state = await resetSession({
      dataDir: info.dataDir,
      sessionId: info.sessionId,
      reason: "startup",
    });
    if (eventName === "PreToolUse") return denyResult("Hook event name mismatch.");
    if (eventName === "Stop") return result({});
    return contextResult(EVENTS.has(eventName) ? eventName : "SessionStart", state);
  } catch {
    return failedClosed(eventName);
  }
}

export async function handleHook(eventName, payload, env = {}) {
  let info;
  try {
    info = runtimeInfo(payload, env);
  } catch {
    return failedClosed(eventName);
  }

  if ((payload.hook_event_name !== undefined && payload.hook_event_name !== eventName) || !EVENTS.has(eventName)) {
    return resetMalformedEvent(eventName, info);
  }

  try {
    if (eventName === "SessionStart") {
      const state = payload.source === "compact"
        ? await loadSession({ dataDir: info.dataDir, sessionId: info.sessionId })
        : await resetSession({
            dataDir: info.dataDir,
            sessionId: info.sessionId,
            reason: RESET_SOURCES.has(payload.source) ? payload.source : "startup",
          });
      return contextResult("SessionStart", state);
    }

    if (eventName === "UserPromptSubmit") {
      const current = await loadSession({ dataDir: info.dataDir, sessionId: info.sessionId });
      if (typeof payload.prompt !== "string") {
        const state = await resetSession({
          dataDir: info.dataDir,
          sessionId: info.sessionId,
          reason: "startup",
        });
        return contextResult("UserPromptSubmit", state);
      }

      const parsed = parseTransitionMessage(payload.prompt);
      if (!parsed) return contextResult("UserPromptSubmit", current);
      if (parsed.error) {
        return contextResult("UserPromptSubmit", current, `Transition rejected: ${parsed.error}`);
      }
      if (parsed.status) {
        return contextResult("UserPromptSubmit", current, "Report the current authority status to the user. Do not change it.");
      }

      const state = applyUserTransition(current, parsed.transition, {
        userEntry: nonEmptyString(payload.user_entry_id)
          ? payload.user_entry_id
          : `UserPromptSubmit:${info.sessionId}`,
      });
      await saveSession({ dataDir: info.dataDir, sessionId: info.sessionId, state });
      const extra = parsed.task
        ? `Task supplied with this transition:\n${parsed.task}`
        : "Acknowledge this authority transition only. No task was provided, so do not start work.";
      return contextResult("UserPromptSubmit", state, extra);
    }

    if (eventName === "PreToolUse") {
      const state = await loadSession({ dataDir: info.dataDir, sessionId: info.sessionId });
      const normalized = normalizeToolCall(payload);
      if (!normalized.ok) return denyResult(normalized.reason);
      if (normalized.toolName === "apply_patch" && info.host === "claude") {
        return denyResult("apply_patch is not a recognized Claude hook tool.");
      }

      const decision = normalized.toolName === "apply_patch"
        ? evaluatePatch(normalized.input.command, state, { cwd: info.cwd })
        : evaluateToolCall(
            { toolName: normalized.toolName, input: normalized.input },
            state,
            { cwd: info.cwd },
          );

      if (!decision.allow && decision.resetToRed) {
        await resetSession({
          dataDir: info.dataDir,
          sessionId: info.sessionId,
          reason: "scope-drift",
        });
      }
      return decision.allow ? result({}) : denyResult(decision.reason);
    }

    if (eventName === "SubagentStart") {
      const state = await loadSession({ dataDir: info.dataDir, sessionId: info.sessionId });
      return contextResult("SubagentStart", state);
    }

    const state = await loadSession({ dataDir: info.dataDir, sessionId: info.sessionId });
    const release = typeof payload.last_assistant_message === "string"
      ? detectRelease(payload.last_assistant_message)
      : undefined;
    if (release && !(release === "complete" && state.releasePolicy === "manual")) {
      await resetSession({
        dataDir: info.dataDir,
        sessionId: info.sessionId,
        reason: release,
      });
    }
    return result({});
  } catch {
    return failedClosed(eventName);
  }
}
