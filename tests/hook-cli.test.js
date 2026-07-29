import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const hookPath = join(root, "hooks", "red-light-green-light.mjs");
const hooksPath = join(root, "hooks", "hooks.json");
const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "SubagentStart", "Stop"];

function fixture(t) {
  const temp = mkdtempSync(join(tmpdir(), "rlgl cli with spaces "));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const cwd = join(temp, "project with spaces");
  const claudeData = join(temp, "claude plugin data");
  const codexData = join(temp, "codex plugin data");
  mkdirSync(join(cwd, "src"), { recursive: true });
  mkdirSync(join(cwd, "docs", "plans"), { recursive: true });
  return { temp, cwd, claudeData, codexData };
}

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.PLUGIN_DATA;
  delete env.CLAUDE_PLUGIN_DATA;
  delete env.RLGL_TEST_DATA;
  return { ...env, ...extra };
}

function runHook(event, payloadText, env, options = {}) {
  return spawnSync(process.execPath, [hookPath, event], {
    shell: false,
    env: cleanEnv(env),
    input: payloadText,
    encoding: "utf8",
    timeout: options.timeout ?? 4000,
  });
}

function compactObject(stdout) {
  assert.notEqual(stdout, "");
  const parsed = JSON.parse(stdout);
  assert.equal(Array.isArray(parsed), false);
  assert.equal(parsed && typeof parsed, "object");
  assert.equal(stdout, JSON.stringify(parsed));
  return parsed;
}

function basePayload(session_id, cwd, event, extra = {}) {
  return { session_id, cwd, hook_event_name: event, ...extra };
}

test("CLI accepts every lifecycle event and emits one compact object only when output exists", (t) => {
  const { cwd, claudeData } = fixture(t);
  const env = { CLAUDE_PLUGIN_DATA: claudeData };

  const start = runHook(
    "SessionStart",
    `${JSON.stringify(basePayload("s1", cwd, "SessionStart", { source: "startup" }))}\n`,
    env,
  );
  assert.equal(start.status, 0, start.stderr);
  assert.match(compactObject(start.stdout).hookSpecificOutput.additionalContext, /RED/);

  const prompt = runHook(
    "UserPromptSubmit",
    JSON.stringify(basePayload("s1", cwd, "UserPromptSubmit", {
      prompt: "green light for implement src",
    })),
    env,
  );
  assert.equal(prompt.status, 0, prompt.stderr);
  assert.match(compactObject(prompt.stdout).hookSpecificOutput.additionalContext, /GREEN/);

  const subagent = runHook(
    "SubagentStart",
    JSON.stringify(basePayload("s1", cwd, "SubagentStart")),
    env,
  );
  assert.equal(subagent.status, 0, subagent.stderr);
  assert.match(compactObject(subagent.stdout).hookSpecificOutput.additionalContext, /GREEN/);

  const reset = runHook(
    "SessionStart",
    JSON.stringify(basePayload("red-session", cwd, "SessionStart", { source: "startup" })),
    env,
  );
  assert.equal(reset.status, 0, reset.stderr);
  const denied = runHook(
    "PreToolUse",
    JSON.stringify(basePayload("red-session", cwd, "PreToolUse", {
      tool_name: "Write",
      tool_input: { file_path: join(cwd, "src", "a.js"), content: "x" },
    })),
    env,
  );
  assert.equal(denied.status, 0, denied.stderr);
  assert.equal(compactObject(denied.stdout).hookSpecificOutput.permissionDecision, "deny");

  const stop = runHook(
    "Stop",
    JSON.stringify(basePayload("s1", cwd, "Stop", {
      last_assistant_message: "Finished.\nLIGHT_RELEASE: complete",
    })),
    env,
  );
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stdout, "");
});

test("CLI supports Codex apply_patch and paths containing spaces without a shell", (t) => {
  const { cwd, codexData } = fixture(t);
  const env = { PLUGIN_DATA: codexData };

  assert.equal(runHook(
    "SessionStart",
    JSON.stringify(basePayload("codex", cwd, "SessionStart", { source: "startup" })),
    env,
  ).status, 0);
  assert.equal(runHook(
    "UserPromptSubmit",
    JSON.stringify(basePayload("codex", cwd, "UserPromptSubmit", {
      prompt: "/light green patch src --paths src",
    })),
    env,
  ).status, 0);

  const applied = runHook(
    "PreToolUse",
    JSON.stringify(basePayload("codex", cwd, "PreToolUse", {
      tool_name: "apply_patch",
      tool_input: {
        command: "*** Begin Patch\n*** Update File: src/a.js\n@@\n-a\n+b\n*** End Patch",
      },
    })),
    env,
  );
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(applied.stdout, "");
});

test("CLI is BOM tolerant and accepts LF or CRLF terminated JSON", (t) => {
  const { cwd, claudeData } = fixture(t);
  const env = { CLAUDE_PLUGIN_DATA: claudeData };
  for (const suffix of ["\n", "\r\n"]) {
    const payload = basePayload(`bom-${suffix.length}`, cwd, "SessionStart", { source: "startup" });
    const child = runHook("SessionStart", `\uFEFF${JSON.stringify(payload)}${suffix}`, env);
    assert.equal(child.status, 0, child.stderr);
    assert.match(compactObject(child.stdout).hookSpecificOutput.additionalContext, /RED/);
  }
});

test("malformed JSON follows event-specific fail-closed exit and output contracts", (t) => {
  const { claudeData } = fixture(t);
  const env = { CLAUDE_PLUGIN_DATA: claudeData };

  for (const event of ["PreToolUse", "UserPromptSubmit"]) {
    const child = runHook(event, "{not-json\n", env);
    assert.equal(child.status, 2, `${event}: ${child.stderr}`);
    assert.ok(child.stderr.trim().length > 0, event);
    compactObject(child.stdout);
  }

  for (const event of ["SessionStart", "SubagentStart"]) {
    const child = runHook(event, "{not-json\n", env);
    assert.equal(child.status, 0, `${event}: ${child.stderr}`);
    assert.match(compactObject(child.stdout).hookSpecificOutput.additionalContext, /RED/);
  }

  const stop = runHook("Stop", "{not-json\n", env);
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stdout, "");
});

test("CLI rejects multiple JSON values and unknown event arguments", (t) => {
  const { cwd, claudeData } = fixture(t);
  const env = { CLAUDE_PLUGIN_DATA: claudeData };
  const payload = JSON.stringify(basePayload("multiple", cwd, "PreToolUse", {
    tool_name: "Read",
    tool_input: { file_path: "src/a.js" },
  }));

  const multiple = runHook("PreToolUse", `${payload}\n${payload}\n`, env);
  assert.equal(multiple.status, 2, multiple.stderr);
  assert.ok(multiple.stderr.trim().length > 0);

  const unknown = runHook("UnexpectedEvent", `${payload}\n`, env);
  assert.equal(unknown.status, 2);
  assert.equal(unknown.stdout, "");
  assert.ok(unknown.stderr.trim().length > 0);
});

test("CLI processes once after the one-second fallback without waiting forever for EOF", async (t) => {
  const { cwd, claudeData } = fixture(t);
  const child = spawn(process.execPath, [hookPath, "SessionStart"], {
    shell: false,
    env: cleanEnv({ CLAUDE_PLUGIN_DATA: claudeData }),
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {});

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdin.write(JSON.stringify(basePayload("fallback", cwd, "SessionStart", { source: "startup" })));

  const outcome = await Promise.race([
    new Promise((resolve) => child.once("close", (code) => resolve({ code }))),
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 3000)),
  ]);
  if (outcome.timeout) child.kill();

  assert.equal(outcome.timeout, undefined, "hook CLI hung waiting for EOF");
  assert.equal(outcome.code, 0, stderr);
  assert.match(compactObject(stdout).hookSpecificOutput.additionalContext, /RED/);
});

test("CLI source contains no eval, shell, or child-process execution path", () => {
  const text = readFileSync(hookPath, "utf8");
  assert.doesNotMatch(text, /\beval\s*\(/);
  assert.doesNotMatch(text, /node:child_process|\bexec(?:File|Sync)?\s*\(|\bspawn(?:Sync)?\s*\(/);
  assert.doesNotMatch(text, /shell\s*:/);
});

test("hooks.json maps exact lifecycle event arguments with static cross-platform commands", () => {
  const manifest = JSON.parse(readFileSync(hooksPath, "utf8"));
  assert.deepEqual(Object.keys(manifest.hooks), EVENTS);

  for (const event of EVENTS) {
    const groups = manifest.hooks[event];
    assert.equal(Array.isArray(groups), true, event);
    assert.equal(groups.length, 1, event);
    if (event === "SessionStart") {
      assert.equal(groups[0].matcher, "startup|resume|clear|compact|fork");
    } else {
      assert.equal(groups[0].matcher === undefined || groups[0].matcher === "*", true, event);
    }

    assert.equal(groups[0].hooks.length, 1, event);
    const hook = groups[0].hooks[0];
    assert.equal(hook.type, "command", event);
    assert.equal(
      hook.command,
      `node "\${CLAUDE_PLUGIN_ROOT}/hooks/red-light-green-light.mjs" ${event}`,
      event,
    );
    assert.equal(
      hook.commandWindows,
      `node "$env:CLAUDE_PLUGIN_ROOT\\hooks\\red-light-green-light.mjs" ${event}`,
      event,
    );
    assert.equal(hook.timeout, 5, event);
    assert.equal(typeof hook.statusMessage, "string", event);
    assert.ok(hook.statusMessage.trim().length > 0, event);
    assert.equal(Object.hasOwn(hook, "async"), false, event);
    assert.doesNotMatch(
      `${hook.command}\n${hook.commandWindows}`,
      /\$(?:\{)?ARGUMENTS|\$env:(?:tool_input|prompt|session_id)/i,
    );
  }
});
