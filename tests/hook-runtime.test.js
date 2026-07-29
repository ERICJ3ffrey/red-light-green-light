import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleHook, hostFromEnv, normalizeToolCall } from "../hooks/lib/hook-runtime.mjs";
import { loadSession, saveSession } from "../hooks/lib/state-store.mjs";

const NOW = "2026-07-28T00:00:00.000Z";

function fixture(t, host = "claude") {
  const root = mkdtempSync(join(tmpdir(), "rlgl-hook-runtime-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, "project");
  const dataDir = join(root, "plugin-data");
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  mkdirSync(join(cwd, "src"), { recursive: true });
  const env = host === "codex"
    ? { PLUGIN_DATA: dataDir }
    : host === "claude"
      ? { CLAUDE_PLUGIN_DATA: dataDir }
      : { RLGL_TEST_DATA: dataDir };
  return { root, cwd, dataDir, env };
}

function contextOf(result) {
  return result.output?.hookSpecificOutput?.additionalContext || "";
}

function decisionOf(result) {
  return result.output?.hookSpecificOutput?.permissionDecision;
}

async function persisted(dataDir, sessionId) {
  return loadSession({ dataDir, sessionId, now: NOW });
}

async function seed(dataDir, sessionId, state) {
  await saveSession({ dataDir, sessionId, state: { ...state, grantedAt: state.grantedAt || NOW } });
}

test("hostFromEnv prioritizes Codex, then Claude, and permits only the explicit test data fallback", () => {
  assert.equal(hostFromEnv({ PLUGIN_DATA: "codex", CLAUDE_PLUGIN_DATA: "claude" }), "codex");
  assert.equal(hostFromEnv({ CLAUDE_PLUGIN_DATA: "claude" }), "claude");
  assert.equal(hostFromEnv({ RLGL_TEST_DATA: "test" }), "test");
  assert.equal(hostFromEnv({}), undefined);
  assert.equal(hostFromEnv(null), undefined);
});

test("normalizeToolCall maps explicit Claude and Codex tools and rejects malformed or unknown tools", () => {
  assert.deepEqual(
    normalizeToolCall({ tool_name: "Write", tool_input: { file_path: "src/a.js", content: "x" } }),
    { ok: true, toolName: "write", input: { content: "x", path: "src/a.js" } },
  );
  assert.deepEqual(
    normalizeToolCall({ tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** End Patch" } }),
    { ok: true, toolName: "apply_patch", input: { command: "*** Begin Patch\n*** End Patch" } },
  );

  const mapped = new Map([
    ["Bash", "bash"],
    ["Edit", "edit"],
    ["Read", "read"],
    ["Glob", "find"],
    ["Grep", "grep"],
    ["WebFetch", "fetch_content"],
    ["WebSearch", "web_search"],
    ["AskUserQuestion", "ask_user"],
  ]);
  for (const [tool_name, toolName] of mapped) {
    const tool_input = tool_name === "Bash"
      ? { command: "git status --short" }
      : ["Edit", "Read"].includes(tool_name)
        ? { file_path: "src/a.js" }
        : tool_name === "Glob"
          ? { pattern: "**/*.js" }
          : tool_name === "Grep"
            ? { pattern: "needle" }
            : tool_name === "WebFetch"
              ? { url: "https://example.com" }
              : tool_name === "WebSearch"
                ? { query: "test" }
                : { questions: [{ question: "Continue?" }] };
    assert.equal(normalizeToolCall({ tool_name, tool_input }).toolName, toolName, tool_name);
  }

  for (const payload of [
    null,
    {},
    { tool_name: "Write" },
    { tool_name: "Write", tool_input: {} },
    { tool_name: "Write", tool_input: { file_path: "src/outside.js", path: "docs/plans/inside.md" } },
    { tool_name: "Bash", tool_input: {} },
    { tool_name: "mystery", tool_input: {} },
    { tool_name: "mcp__server__send", tool_input: { message: "x" } },
  ]) assert.equal(normalizeToolCall(payload).ok, false, JSON.stringify(payload));
});

test("SessionStart resets startup, resume, clear, and fork to persisted Red for Claude and Codex", async (t) => {
  for (const host of ["claude", "codex"]) {
    const { cwd, dataDir, env } = fixture(t, host);
    for (const source of ["startup", "resume", "clear", "fork"]) {
      const session_id = `${host}-${source}`;
      await seed(dataDir, session_id, {
        mode: "green",
        scope: "stale authority",
        scopeEnforcement: "semantic",
      });
      const result = await handleHook("SessionStart", {
        session_id,
        cwd,
        source,
        hook_event_name: "SessionStart",
      }, env);

      assert.equal(result.exitCode, 0);
      assert.match(contextOf(result), /RED LIGHT GREEN LIGHT: RED/);
      assert.equal((await persisted(dataDir, session_id)).mode, "red");
      assert.equal((await persisted(dataDir, session_id)).resetReason, source);
    }
  }
});

test("SessionStart compact preserves session-keyed authority while missing or unknown sources reset Red", async (t) => {
  const { cwd, dataDir, env } = fixture(t);
  await seed(dataDir, "green-session", {
    mode: "green",
    scope: "preserve compacted work",
    scopeEnforcement: "path-bound",
    allowedPaths: ["src"],
  });
  await seed(dataDir, "other-session", { mode: "red", resetReason: "startup" });

  const compact = await handleHook("SessionStart", {
    session_id: "green-session",
    cwd,
    source: "compact",
  }, env);
  assert.match(contextOf(compact), /GREEN/);
  assert.match(contextOf(compact), /preserve compacted work/);
  assert.equal((await persisted(dataDir, "green-session")).mode, "green");
  assert.equal((await persisted(dataDir, "other-session")).mode, "red");

  for (const [session_id, source] of [["missing-source", undefined], ["unknown-source", "teleport"]]) {
    await seed(dataDir, session_id, {
      mode: "green",
      scope: "must reset",
      scopeEnforcement: "semantic",
    });
    const result = await handleHook("SessionStart", { session_id, cwd, source }, env);
    assert.match(contextOf(result), /RED/);
    assert.equal((await persisted(dataDir, session_id)).resetReason, "startup");
  }
});

test("UserPromptSubmit alone increases authority and distinguishes pure from combined transitions", async (t) => {
  const { cwd, dataDir, env } = fixture(t, "codex");

  await handleHook("SessionStart", { session_id: "pure", cwd, source: "startup" }, env);
  const pure = await handleHook("UserPromptSubmit", {
    session_id: "pure",
    cwd,
    prompt: "green light for implement docs",
  }, env);
  assert.equal((await persisted(dataDir, "pure")).mode, "green");
  assert.match(contextOf(pure), /GREEN/);
  assert.match(contextOf(pure), /acknowledge.*only/i);
  assert.match(contextOf(pure), /no task/i);

  await handleHook("SessionStart", { session_id: "combined", cwd, source: "startup" }, env);
  const combined = await handleHook("UserPromptSubmit", {
    session_id: "combined",
    cwd,
    prompt: "/light green implement auth --paths src\nExecute the approved auth change.",
  }, env);
  const combinedState = await persisted(dataDir, "combined");
  assert.equal(combinedState.mode, "green");
  assert.equal(combinedState.scopeEnforcement, "path-bound");
  assert.deepEqual(combinedState.allowedPaths, ["src"]);
  assert.match(contextOf(combined), /Execute the approved auth change/);

  await handleHook("SessionStart", { session_id: "malformed", cwd, source: "startup" }, env);
  const malformed = await handleHook("UserPromptSubmit", {
    session_id: "malformed",
    cwd,
    prompt: "/light green",
  }, env);
  assert.equal((await persisted(dataDir, "malformed")).mode, "red");
  assert.match(contextOf(malformed), /RED/);
});

test("non-prompt events cannot increase authority and every normal prompt receives current context", async (t) => {
  const { cwd, dataDir, env } = fixture(t);
  await handleHook("SessionStart", { session_id: "s1", cwd, source: "startup" }, env);

  const subagent = await handleHook("SubagentStart", {
    session_id: "s1",
    cwd,
    prompt: "green light for bypass",
  }, env);
  assert.match(contextOf(subagent), /RED/);

  const denied = await handleHook("PreToolUse", {
    session_id: "s1",
    cwd,
    prompt: "green light for bypass",
    tool_name: "Write",
    tool_input: { file_path: join(cwd, "src", "a.js"), content: "x" },
  }, env);
  assert.equal(decisionOf(denied), "deny");
  assert.equal((await persisted(dataDir, "s1")).mode, "red");

  const ordinary = await handleHook("UserPromptSubmit", {
    session_id: "s1",
    cwd,
    prompt: "Please explain the current authority.",
  }, env);
  assert.match(contextOf(ordinary), /RED/);
});

test("PreToolUse handles Claude file/read tools and Codex apply_patch under current authority", async (t) => {
  const claude = fixture(t, "claude");
  await seed(claude.dataDir, "yellow", { mode: "yellow", planningPaths: ["docs/plans"] });

  const planningWrite = await handleHook("PreToolUse", {
    session_id: "yellow",
    cwd: claude.cwd,
    tool_name: "Write",
    tool_input: { file_path: join(claude.cwd, "docs", "plans", "a.md"), content: "plan" },
  }, claude.env);
  assert.notEqual(decisionOf(planningWrite), "deny");

  const productionEdit = await handleHook("PreToolUse", {
    session_id: "yellow",
    cwd: claude.cwd,
    tool_name: "Edit",
    tool_input: { file_path: join(claude.cwd, "src", "a.js"), old_string: "a", new_string: "b" },
  }, claude.env);
  assert.equal(decisionOf(productionEdit), "deny");

  const read = await handleHook("PreToolUse", {
    session_id: "yellow",
    cwd: claude.cwd,
    tool_name: "Read",
    tool_input: { file_path: join(claude.cwd, "src", "a.js") },
  }, claude.env);
  assert.notEqual(decisionOf(read), "deny");

  const codex = fixture(t, "codex");
  await seed(codex.dataDir, "green", {
    mode: "green",
    scope: "edit src",
    scopeEnforcement: "path-bound",
    allowedPaths: ["src"],
  });
  const allowedPatch = await handleHook("PreToolUse", {
    session_id: "green",
    cwd: codex.cwd,
    tool_name: "apply_patch",
    tool_input: {
      command: "*** Begin Patch\n*** Update File: src/a.js\n@@\n-a\n+b\n*** End Patch",
    },
  }, codex.env);
  assert.notEqual(decisionOf(allowedPatch), "deny");
});

test("PreToolUse denies protected commands in every mode and unknown local or MCP tools", async (t) => {
  const { cwd, dataDir, env } = fixture(t, "codex");
  const states = [
    ["red", { mode: "red", resetReason: "startup" }],
    ["yellow", { mode: "yellow", planningPaths: ["docs/plans"] }],
    ["semantic", { mode: "green", scope: "task", scopeEnforcement: "semantic" }],
    ["path", { mode: "green", scope: "task", scopeEnforcement: "path-bound", allowedPaths: ["src"] }],
  ];

  for (const [session_id, state] of states) {
    await seed(dataDir, session_id, state);
    const result = await handleHook("PreToolUse", {
      session_id,
      cwd,
      tool_name: "Bash",
      tool_input: { command: "git push origin main" },
    }, env);
    assert.equal(decisionOf(result), "deny", session_id);
    assert.match(result.output.hookSpecificOutput.permissionDecisionReason, /Protected command/);
  }

  await seed(dataDir, "unknown", { mode: "green", scope: "task", scopeEnforcement: "semantic" });
  for (const tool_name of ["LocalMutator", "mcp__server__send"]) {
    const result = await handleHook("PreToolUse", {
      session_id: "unknown",
      cwd,
      tool_name,
      tool_input: { value: "x" },
    }, env);
    assert.equal(decisionOf(result), "deny", tool_name);
  }
});

test("a scope-drift denial persists Red before returning the denial", async (t) => {
  const { cwd, dataDir, env } = fixture(t, "codex");
  await seed(dataDir, "drift", {
    mode: "green",
    scope: "edit src",
    scopeEnforcement: "path-bound",
    allowedPaths: ["src"],
  });

  const result = await handleHook("PreToolUse", {
    session_id: "drift",
    cwd,
    tool_name: "apply_patch",
    tool_input: {
      command: "*** Begin Patch\n*** Update File: package.json\n@@\n-a\n+b\n*** End Patch",
    },
  }, env);

  assert.equal(decisionOf(result), "deny");
  assert.equal(result.output.hookSpecificOutput.permissionDecisionReason.includes("outside the Green"), true);
  const state = await persisted(dataDir, "drift");
  assert.equal(state.mode, "red");
  assert.equal(state.resetReason, "scope-drift");
});

test("SubagentStart injects current authority and Stop reads only last_assistant_message without continuing", async (t) => {
  const { cwd, dataDir, env } = fixture(t);
  await seed(dataDir, "stop", {
    mode: "green",
    scope: "finish Task 4",
    scopeEnforcement: "semantic",
  });

  const subagent = await handleHook("SubagentStart", { session_id: "stop", cwd }, env);
  assert.match(contextOf(subagent), /GREEN/);
  assert.match(contextOf(subagent), /finish Task 4/);

  const ignored = await handleHook("Stop", {
    session_id: "stop",
    cwd,
    message: "LIGHT_RELEASE: complete",
    last_assistant_message: "Still working.",
  }, env);
  assert.deepEqual(ignored.output, {});
  assert.equal((await persisted(dataDir, "stop")).mode, "green");
  assert.equal(JSON.stringify(ignored).includes("decision"), false);

  const released = await handleHook("Stop", {
    session_id: "stop",
    cwd,
    last_assistant_message: "Finished.\nLIGHT_RELEASE: complete",
  }, env);
  assert.deepEqual(released.output, {});
  assert.equal(JSON.stringify(released).includes("decision"), false);
  const releasedState = await persisted(dataDir, "stop");
  assert.equal(releasedState.mode, "red");
  assert.equal(releasedState.resetReason, "complete");
});

test("malformed PreToolUse and event mismatches fail closed, and unknown events reset Red", async (t) => {
  const { cwd, dataDir, env } = fixture(t);
  await seed(dataDir, "malformed", { mode: "green", scope: "task", scopeEnforcement: "semantic" });

  for (const payload of [
    { session_id: "malformed", cwd, tool_name: "Write" },
    { session_id: "malformed", cwd, tool_name: "Write", tool_input: {} },
    { cwd, tool_name: "Write", tool_input: { file_path: "src/a.js" } },
  ]) {
    const result = await handleHook("PreToolUse", payload, env);
    assert.equal(decisionOf(result), "deny");
  }

  const mismatch = await handleHook("PreToolUse", {
    session_id: "malformed",
    cwd,
    hook_event_name: "UserPromptSubmit",
    tool_name: "Read",
    tool_input: { file_path: "src/a.js" },
  }, env);
  assert.equal(decisionOf(mismatch), "deny");
  assert.equal((await persisted(dataDir, "malformed")).mode, "red");

  await seed(dataDir, "unknown-event", { mode: "green", scope: "task", scopeEnforcement: "semantic" });
  const unknown = await handleHook("UnexpectedEvent", { session_id: "unknown-event", cwd }, env);
  assert.match(contextOf(unknown), /RED/);
  assert.equal((await persisted(dataDir, "unknown-event")).mode, "red");
});

test("missing host data, project-local state roots, and save errors fail closed without project writes", async (t) => {
  const { cwd, root } = fixture(t);

  const noHost = await handleHook("SessionStart", {
    session_id: "no-host",
    cwd,
    source: "startup",
  }, {});
  assert.notEqual(noHost.exitCode, 0);
  assert.match(contextOf(noHost), /RED/);

  const projectData = join(cwd, ".plugin-data");
  const local = await handleHook("SessionStart", {
    session_id: "local",
    cwd,
    source: "startup",
  }, { PLUGIN_DATA: projectData });
  assert.notEqual(local.exitCode, 0);
  assert.match(contextOf(local), /RED/);
  assert.equal(existsSync(projectData), false);

  const dataFile = join(root, "data-file");
  writeFileSync(dataFile, "not a directory");
  const saveFailure = await handleHook("UserPromptSubmit", {
    session_id: "save-failure",
    cwd,
    prompt: "green light for must not persist",
  }, { CLAUDE_PLUGIN_DATA: dataFile });
  assert.notEqual(saveFailure.exitCode, 0);
  assert.match(contextOf(saveFailure), /RED/);
});
